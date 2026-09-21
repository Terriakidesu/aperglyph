import { createId, migrateDocument } from '../core/document';
import type { DiagramDocument } from '../core/types';

const DATABASE_NAME = 'aperglyph-local';
const DATABASE_VERSION = 3;
const DOCUMENTS_STORE = 'documents';
const RECOVERY_STORE = 'recovery';
const SNAPSHOTS_STORE = 'snapshots';
const ACTIVE_RECOVERY_ID = 'active-recovery';
export const DEFAULT_SNAPSHOT_LIMIT = 31;
export const SNAPSHOT_LIMIT_KEY = 'aperglyph.snapshot-limit';

export interface StoredDocument {
  id: string;
  name: string;
  diagramType: DiagramDocument['diagramType'];
  schemaVersion: number;
  document: DiagramDocument;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  favorite?: boolean;
  trashedAt?: number;
}

export interface RecoverySnapshot {
  id: string;
  document: DiagramDocument;
  savedAt: number;
}

export type SnapshotKind = 'automatic' | 'checkpoint';

export interface DocumentSnapshot {
  id: string;
  documentId: string;
  document: DiagramDocument;
  savedAt: number;
  kind: SnapshotKind;
  name?: string;
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  usageRatio: number;
  persistent: boolean;
}

export function normalizeSnapshotLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SNAPSHOT_LIMIT;
  return Math.min(365, Math.max(1, Math.floor(value)));
}

export function getSnapshotLimit(): number {
  try {
    const value = Number(globalThis.localStorage?.getItem(SNAPSHOT_LIMIT_KEY));
    return normalizeSnapshotLimit(value);
  } catch {
    return DEFAULT_SNAPSHOT_LIMIT;
  }
}

export function setSnapshotLimit(value: number): number {
  const limit = normalizeSnapshotLimit(value);
  try {
    globalThis.localStorage?.setItem(SNAPSHOT_LIMIT_KEY, String(limit));
  } catch {
    // Retention is still applied for the current caller when preferences are unavailable.
  }
  return limit;
}

const memoryDocuments = new Map<string, StoredDocument>();
let memoryRecovery: RecoverySnapshot | null = null;
const memorySnapshots = new Map<string, DocumentSnapshot>();
let databasePromise: Promise<IDBDatabase> | null = null;

function supportsIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  if (!supportsIndexedDb()) return Promise.reject(new Error('IndexedDB is unavailable in this environment.'));
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Unable to open local storage.'));
    request.onupgradeneeded = () => {
      const database = request.result;
      const documents = database.objectStoreNames.contains(DOCUMENTS_STORE)
        ? request.transaction?.objectStore(DOCUMENTS_STORE)
        : database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' });
      if (documents && !documents.indexNames.contains('updatedAt')) documents.createIndex('updatedAt', 'updatedAt');
      if (!database.objectStoreNames.contains(RECOVERY_STORE)) database.createObjectStore(RECOVERY_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        const snapshots = database.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'id' });
        snapshots.createIndex('documentId', 'documentId');
        snapshots.createIndex('savedAt', 'savedAt');
      } else {
        const snapshots = request.transaction?.objectStore(SNAPSHOTS_STORE);
        if (snapshots && !snapshots.indexNames.contains('documentId')) snapshots.createIndex('documentId', 'documentId');
        if (snapshots && !snapshots.indexNames.contains('savedAt')) snapshots.createIndex('savedAt', 'savedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local storage request failed.'));
  });
}

function createStoredDocument(document: DiagramDocument, thumbnail?: string, metadata: Pick<StoredDocument, 'favorite' | 'trashedAt'> = {}): StoredDocument {
  return {
    id: document.id,
    name: document.name,
    diagramType: document.diagramType,
    schemaVersion: document.schemaVersion,
    document: structuredClone(document),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    thumbnail,
    ...metadata,
  };
}

export async function saveDocument(document: DiagramDocument, thumbnail?: string, metadata?: Pick<StoredDocument, 'favorite' | 'trashedAt'>): Promise<void> {
  const existing = metadata ? undefined : await readStoredDocument(document.id);
  const record = createStoredDocument(document, thumbnail ?? existing?.thumbnail, {
    favorite: metadata?.favorite ?? existing?.favorite,
    trashedAt: metadata?.trashedAt ?? existing?.trashedAt,
  });
  if (!supportsIndexedDb()) {
    memoryDocuments.set(record.id, record);
    return;
  }
  const database = await openDatabase();
  const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
  transaction.objectStore(DOCUMENTS_STORE).put(record);
  await transactionComplete(transaction);
}

export async function loadDocument(id: string): Promise<DiagramDocument | null> {
  if (!supportsIndexedDb()) return memoryDocuments.get(id)?.document ? migrateDocument(memoryDocuments.get(id)!.document) : null;
  const database = await openDatabase();
  const record = await requestResult<StoredDocument | undefined>(database.transaction(DOCUMENTS_STORE, 'readonly').objectStore(DOCUMENTS_STORE).get(id));
  return record?.document ? migrateDocument(record.document) : null;
}

export async function listDocuments(): Promise<StoredDocument[]> {
  if (!supportsIndexedDb()) return [...memoryDocuments.values()].filter((record) => !record.trashedAt).sort(sortNewest);
  const database = await openDatabase();
  const records = await requestResult<StoredDocument[]>(database.transaction(DOCUMENTS_STORE, 'readonly').objectStore(DOCUMENTS_STORE).getAll());
  return records.filter((record) => !record.trashedAt).sort(sortNewest).map((record) => ({ ...record, document: migrateDocument(record.document) }));
}

export async function listTrashedDocuments(): Promise<StoredDocument[]> {
  if (!supportsIndexedDb()) return [...memoryDocuments.values()].filter((record) => Boolean(record.trashedAt)).sort(sortNewest);
  const database = await openDatabase();
  const records = await requestResult<StoredDocument[]>(database.transaction(DOCUMENTS_STORE, 'readonly').objectStore(DOCUMENTS_STORE).getAll());
  return records.filter((record) => Boolean(record.trashedAt)).sort(sortNewest).map((record) => ({ ...record, document: migrateDocument(record.document) }));
}

export async function updateDocumentMetadata(id: string, changes: Pick<StoredDocument, 'favorite' | 'trashedAt'>): Promise<void> {
  const existing = await readStoredDocument(id);
  if (!existing) return;
  const next = { ...existing, ...changes };
  if (Object.prototype.hasOwnProperty.call(changes, 'trashedAt') && changes.trashedAt === undefined) delete next.trashedAt;
  if (!supportsIndexedDb()) {
    memoryDocuments.set(id, next);
    return;
  }
  const database = await openDatabase();
  const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
  transaction.objectStore(DOCUMENTS_STORE).put(next);
  await transactionComplete(transaction);
}

export async function trashDocument(id: string): Promise<void> {
  await updateDocumentMetadata(id, { trashedAt: Date.now() });
}

export async function restoreDocument(id: string): Promise<void> {
  await updateDocumentMetadata(id, { trashedAt: undefined });
}

export async function renameDocument(id: string, name: string): Promise<DiagramDocument | null> {
  const existing = await readStoredDocument(id);
  if (!existing || !name.trim()) return null;
  const document = migrateDocument({ ...existing.document, name: name.trim(), updatedAt: Date.now() });
  await saveDocument(document, existing.thumbnail, { favorite: existing.favorite, trashedAt: existing.trashedAt });
  return document;
}

export async function duplicateDocument(id: string): Promise<DiagramDocument | null> {
  const existing = await readStoredDocument(id);
  if (!existing) return null;
  const now = Date.now();
  const document = migrateDocument({ ...structuredClone(existing.document), id: createId('doc'), name: `${existing.document.name} copy`, createdAt: now, updatedAt: now });
  await saveDocument(document, existing.thumbnail, { favorite: false });
  return document;
}

export async function deleteDocument(id: string): Promise<void> {
  if (!supportsIndexedDb()) {
    memoryDocuments.delete(id);
  } else {
    const database = await openDatabase();
    const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
    transaction.objectStore(DOCUMENTS_STORE).delete(id);
    await transactionComplete(transaction);
  }
  const snapshots = await listDocumentSnapshots(id);
  await Promise.all(snapshots.map((snapshot) => deleteDocumentSnapshot(snapshot.id)));
}

/** Delete every stored document. Used only by an explicit full workspace restore. */
export async function clearAllDocuments(): Promise<void> {
  if (!supportsIndexedDb()) {
    memoryDocuments.clear();
    return;
  }
  const database = await openDatabase();
  const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
  transaction.objectStore(DOCUMENTS_STORE).clear();
  await transactionComplete(transaction);
}

/**
 * Restore the document portion of a workspace as one storage transaction.
 * IndexedDB rolls the whole transaction back when any write fails, so a quota
 * or serialization error cannot leave a half-replaced workspace behind.
 */
export async function restoreWorkspaceData(
  documents: StoredDocument[],
  snapshots: DocumentSnapshot[],
  recovery: { document: DiagramDocument; savedAt: number } | null,
  replace = true,
): Promise<void> {
  const nextDocuments = documents.map((record) => structuredClone(record));
  const nextSnapshots = snapshots.map((snapshot) => structuredClone(snapshot));
  const nextRecovery = recovery
    ? { id: ACTIVE_RECOVERY_ID, document: structuredClone(recovery.document), savedAt: recovery.savedAt }
    : null;

  if (!supportsIndexedDb()) {
    const documentsMap = replace ? new Map<string, StoredDocument>() : new Map(memoryDocuments);
    const snapshotsMap = replace ? new Map<string, DocumentSnapshot>() : new Map(memorySnapshots);
    nextDocuments.forEach((record) => documentsMap.set(record.id, record));
    nextSnapshots.forEach((snapshot) => snapshotsMap.set(snapshot.id, snapshot));
    if (replace || nextRecovery) memoryRecovery = nextRecovery;
    memoryDocuments.clear();
    documentsMap.forEach((record, id) => memoryDocuments.set(id, record));
    memorySnapshots.clear();
    snapshotsMap.forEach((snapshot, id) => memorySnapshots.set(id, snapshot));
    return;
  }

  const database = await openDatabase();
  const transaction = database.transaction([DOCUMENTS_STORE, SNAPSHOTS_STORE, RECOVERY_STORE], 'readwrite');
  const documentStore = transaction.objectStore(DOCUMENTS_STORE);
  const snapshotStore = transaction.objectStore(SNAPSHOTS_STORE);
  const recoveryStore = transaction.objectStore(RECOVERY_STORE);
  if (replace) {
    documentStore.clear();
    snapshotStore.clear();
    recoveryStore.delete(ACTIVE_RECOVERY_ID);
  }
  nextDocuments.forEach((record) => documentStore.put(record));
  nextSnapshots.forEach((snapshot) => snapshotStore.put(snapshot));
  if (nextRecovery) recoveryStore.put(nextRecovery);
  await transactionComplete(transaction);
}

export async function saveDocumentSnapshot(document: DiagramDocument, options: { id?: string; savedAt?: number; kind?: SnapshotKind; name?: string; limit?: number } = {}): Promise<DocumentSnapshot> {
  const snapshot: DocumentSnapshot = {
    id: options.id ?? createId('snapshot'),
    documentId: document.id,
    document: structuredClone(document),
    savedAt: options.savedAt ?? Date.now(),
    kind: options.kind ?? 'automatic',
    ...(options.name?.trim() ? { name: options.name.trim().slice(0, 128) } : {}),
  };
  if (!supportsIndexedDb()) {
    memorySnapshots.set(snapshot.id, snapshot);
  } else {
    const database = await openDatabase();
    const transaction = database.transaction(SNAPSHOTS_STORE, 'readwrite');
    transaction.objectStore(SNAPSHOTS_STORE).put(snapshot);
    await transactionComplete(transaction);
  }
  await pruneDocumentSnapshots(snapshot.documentId, options.limit ?? getSnapshotLimit());
  return snapshot;
}

export async function listDocumentSnapshots(documentId: string): Promise<DocumentSnapshot[]> {
  const records = !supportsIndexedDb()
    ? [...memorySnapshots.values()]
    : await readAllSnapshots();
  return records
    .filter((snapshot) => snapshot.documentId === documentId)
    .sort((left, right) => right.savedAt - left.savedAt)
    .map((snapshot) => ({ ...snapshot, document: migrateDocument(snapshot.document) }));
}

export async function listAllDocumentSnapshots(): Promise<DocumentSnapshot[]> {
  const records = !supportsIndexedDb() ? [...memorySnapshots.values()] : await readAllSnapshots();
  return records
    .sort((left, right) => right.savedAt - left.savedAt)
    .map((snapshot) => ({ ...snapshot, document: migrateDocument(snapshot.document) }));
}

export async function loadDocumentSnapshot(id: string): Promise<DocumentSnapshot | null> {
  const snapshot = !supportsIndexedDb()
    ? memorySnapshots.get(id)
    : await readSnapshot(id);
  return snapshot ? { ...snapshot, document: migrateDocument(snapshot.document) } : null;
}

export async function deleteDocumentSnapshot(id: string): Promise<void> {
  if (!supportsIndexedDb()) {
    memorySnapshots.delete(id);
    return;
  }
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOTS_STORE, 'readwrite');
  transaction.objectStore(SNAPSHOTS_STORE).delete(id);
  await transactionComplete(transaction);
}

export async function clearAllDocumentSnapshots(): Promise<void> {
  if (!supportsIndexedDb()) {
    memorySnapshots.clear();
    return;
  }
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOTS_STORE, 'readwrite');
  transaction.objectStore(SNAPSHOTS_STORE).clear();
  await transactionComplete(transaction);
}

export async function pruneDocumentSnapshots(documentId: string, limit = DEFAULT_SNAPSHOT_LIMIT): Promise<void> {
  const snapshots = await listDocumentSnapshots(documentId);
  const boundedLimit = Math.max(1, Math.floor(limit));
  if (snapshots.length <= boundedLimit) return;

  // Keep named checkpoints ahead of automatic snapshots, while still applying
  // a hard bound when a user creates more checkpoints than the configured cap.
  const keep = [...snapshots]
    .sort((left, right) => Number(right.kind === 'checkpoint') - Number(left.kind === 'checkpoint') || right.savedAt - left.savedAt)
    .slice(0, boundedLimit);
  const keepIds = new Set(keep.map((snapshot) => snapshot.id));
  await Promise.all(snapshots.filter((snapshot) => !keepIds.has(snapshot.id)).map((snapshot) => deleteDocumentSnapshot(snapshot.id)));
}

export async function saveRecoverySnapshot(document: DiagramDocument, savedAt = Date.now()): Promise<void> {
  const snapshot: RecoverySnapshot = { id: ACTIVE_RECOVERY_ID, document: structuredClone(document), savedAt };
  if (!supportsIndexedDb()) {
    memoryRecovery = snapshot;
    return;
  }
  const database = await openDatabase();
  const transaction = database.transaction(RECOVERY_STORE, 'readwrite');
  transaction.objectStore(RECOVERY_STORE).put(snapshot);
  await transactionComplete(transaction);
}

export async function getRecoverySnapshot(): Promise<RecoverySnapshot | null> {
  if (!supportsIndexedDb()) return memoryRecovery ? { ...memoryRecovery, document: migrateDocument(memoryRecovery.document) } : null;
  const database = await openDatabase();
  const snapshot = await requestResult<RecoverySnapshot | undefined>(database.transaction(RECOVERY_STORE, 'readonly').objectStore(RECOVERY_STORE).get(ACTIVE_RECOVERY_ID));
  return snapshot ? { ...snapshot, document: migrateDocument(snapshot.document) } : null;
}

export async function clearRecoverySnapshot(): Promise<void> {
  if (!supportsIndexedDb()) {
    memoryRecovery = null;
    return;
  }
  const database = await openDatabase();
  const transaction = database.transaction(RECOVERY_STORE, 'readwrite');
  transaction.objectStore(RECOVERY_STORE).delete(ACTIVE_RECOVERY_ID);
  await transactionComplete(transaction);
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export async function getStorageEstimate(): Promise<StorageEstimate> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usage: 0, quota: 0, usageRatio: 0, persistent: false };
  }
  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage ?? 0;
  const quota = estimate.quota ?? 0;
  const persistent = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  return { usage, quota, usageRatio: quota > 0 ? usage / quota : 0, persistent };
}

function sortNewest(a: StoredDocument, b: StoredDocument): number {
  return b.updatedAt - a.updatedAt;
}

async function readStoredDocument(id: string): Promise<StoredDocument | undefined> {
  if (!supportsIndexedDb()) return memoryDocuments.get(id);
  const database = await openDatabase();
  return requestResult<StoredDocument | undefined>(database.transaction(DOCUMENTS_STORE, 'readonly').objectStore(DOCUMENTS_STORE).get(id));
}

async function readAllSnapshots(): Promise<DocumentSnapshot[]> {
  const database = await openDatabase();
  return requestResult<DocumentSnapshot[]>(database.transaction(SNAPSHOTS_STORE, 'readonly').objectStore(SNAPSHOTS_STORE).getAll());
}

async function readSnapshot(id: string): Promise<DocumentSnapshot | undefined> {
  const database = await openDatabase();
  return requestResult<DocumentSnapshot | undefined>(database.transaction(SNAPSHOTS_STORE, 'readonly').objectStore(SNAPSHOTS_STORE).get(id));
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Local storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Local storage transaction was aborted.'));
  });
}
