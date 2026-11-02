import { createId, migrateDocument } from '../core/document';
import type { DiagramDocument } from '../core/types';
import {
  clearNativeDocuments,
  clearNativeRecovery,
  clearNativeSnapshots,
  deleteNativeDocument,
  deleteNativeSnapshot,
  duplicateNativeDocument,
  getNativeRecovery,
  getNativeStorageEstimate,
  isDesktopApp,
  listNativeDocuments,
  listNativeDocumentSummaries,
  listNativeRecovery,
  listNativeSnapshots,
  loadNativeDocument,
  loadNativeSnapshot,
  renameNativeDocument,
  restoreNativeWorkspaceData,
  saveNativeDocument,
  saveNativeDocumentThumbnail,
  saveNativeRecovery,
  saveNativeSnapshot,
  updateNativeDocumentMetadata,
} from './nativeStorage';

const DATABASE_NAME = 'aperglyph-local';
const DATABASE_VERSION = 3;
const DOCUMENTS_STORE = 'documents';
const RECOVERY_STORE = 'recovery';
const SNAPSHOTS_STORE = 'snapshots';
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

export type StoredDocumentSummary = Omit<StoredDocument, 'document'>;

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
const memoryRecovery = new Map<string, RecoverySnapshot>();
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

function createStoredDocument(document: DiagramDocument, thumbnail: string | null | undefined, metadata: Pick<StoredDocument, 'favorite' | 'trashedAt'> = {}, existing?: StoredDocument): StoredDocument {
  const trashedAt = Object.prototype.hasOwnProperty.call(metadata, 'trashedAt') ? metadata.trashedAt : existing?.trashedAt;
  return {
    id: document.id,
    name: document.name,
    diagramType: document.diagramType,
    schemaVersion: document.schemaVersion,
    document: structuredClone(document),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    ...(thumbnail === null ? {} : thumbnail !== undefined ? { thumbnail } : existing?.thumbnail ? { thumbnail: existing.thumbnail } : {}),
    favorite: metadata.favorite ?? existing?.favorite ?? false,
    ...(trashedAt !== undefined ? { trashedAt } : {}),
  };
}

export async function saveDocument(document: DiagramDocument, thumbnail?: string | null, metadata?: Pick<StoredDocument, 'favorite' | 'trashedAt'>): Promise<void> {
  if (isDesktopApp()) return saveNativeDocument(document, thumbnail);
  const existing = metadata ? undefined : await readStoredDocument(document.id);
  const record = createStoredDocument(document, thumbnail, metadata ?? {}, existing);
  if (!supportsIndexedDb()) {
    memoryDocuments.set(record.id, record);
    return;
  }
  const database = await openDatabase();
  const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
  transaction.objectStore(DOCUMENTS_STORE).put(record);
  await transactionComplete(transaction);
}

/** Update a lazily generated preview only if it still matches the saved revision. */
export async function saveDocumentThumbnail(id: string, revision: number, thumbnail: string): Promise<boolean> {
  if (isDesktopApp()) return saveNativeDocumentThumbnail(id, revision, thumbnail);
  if (!supportsIndexedDb()) {
    const record = memoryDocuments.get(id);
    if (!record || record.updatedAt !== revision) return false;
    memoryDocuments.set(id, { ...record, thumbnail });
    return true;
  }
  const database = await openDatabase();
  const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
  const transactionDone = transactionComplete(transaction);
  const store = transaction.objectStore(DOCUMENTS_STORE);
  const record = await requestResult<StoredDocument | undefined>(store.get(id));
  if (!record || record.updatedAt !== revision) {
    await transactionDone;
    return false;
  }
  store.put({ ...record, thumbnail });
  await transactionDone;
  return true;
}

export async function loadDocument(id: string): Promise<DiagramDocument | null> {
  if (isDesktopApp()) {
    const record = await loadNativeDocument(id);
    return record?.document ? migrateDocument(record.document) : null;
  }
  if (!supportsIndexedDb()) return memoryDocuments.get(id)?.document ? migrateDocument(memoryDocuments.get(id)!.document) : null;
  const database = await openDatabase();
  const record = await requestResult<StoredDocument | undefined>(database.transaction(DOCUMENTS_STORE, 'readonly').objectStore(DOCUMENTS_STORE).get(id));
  return record?.document ? migrateDocument(record.document) : null;
}

export async function listDocuments(): Promise<StoredDocument[]> {
  if (isDesktopApp()) return (await listNativeDocuments()).map((record) => ({ ...record, document: migrateDocument(record.document) }));
  if (!supportsIndexedDb()) return [...memoryDocuments.values()].filter((record) => !record.trashedAt).sort(sortNewest);
  const database = await openDatabase();
  const records = await requestResult<StoredDocument[]>(database.transaction(DOCUMENTS_STORE, 'readonly').objectStore(DOCUMENTS_STORE).getAll());
  return records.filter((record) => !record.trashedAt).sort(sortNewest).map((record) => ({ ...record, document: migrateDocument(record.document) }));
}

export async function listDocumentSummaries(): Promise<StoredDocumentSummary[]> {
  if (isDesktopApp()) return listNativeDocumentSummaries(false);
  return (await listDocuments()).map(({ document: _document, ...summary }) => summary);
}

export async function listTrashedDocumentSummaries(): Promise<StoredDocumentSummary[]> {
  if (isDesktopApp()) return listNativeDocumentSummaries(true).then((records) => records.filter((record) => Boolean(record.trashedAt)));
  return (await listTrashedDocuments()).map(({ document: _document, ...summary }) => summary);
}

export async function listTrashedDocuments(): Promise<StoredDocument[]> {
  if (isDesktopApp()) return (await listNativeDocuments(true)).filter((record) => Boolean(record.trashedAt)).map((record) => ({ ...record, document: migrateDocument(record.document) }));
  if (!supportsIndexedDb()) return [...memoryDocuments.values()].filter((record) => Boolean(record.trashedAt)).sort(sortNewest);
  const database = await openDatabase();
  const records = await requestResult<StoredDocument[]>(database.transaction(DOCUMENTS_STORE, 'readonly').objectStore(DOCUMENTS_STORE).getAll());
  return records.filter((record) => Boolean(record.trashedAt)).sort(sortNewest).map((record) => ({ ...record, document: migrateDocument(record.document) }));
}

export async function updateDocumentMetadata(id: string, changes: Pick<StoredDocument, 'favorite' | 'trashedAt'>): Promise<void> {
  if (isDesktopApp()) return updateNativeDocumentMetadata(id, changes);
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
  if (isDesktopApp()) return renameNativeDocument(id, name);
  const existing = await readStoredDocument(id);
  if (!existing || !name.trim()) return null;
  const document = migrateDocument({ ...existing.document, name: name.trim(), updatedAt: Date.now() });
  await saveDocument(document, existing.thumbnail, { favorite: existing.favorite, trashedAt: existing.trashedAt });
  return document;
}

export async function duplicateDocument(id: string): Promise<DiagramDocument | null> {
  if (isDesktopApp()) return duplicateNativeDocument(id);
  const existing = await readStoredDocument(id);
  if (!existing) return null;
  const now = Date.now();
  const document = migrateDocument({ ...structuredClone(existing.document), id: createId('doc'), name: `${existing.document.name} copy`, createdAt: now, updatedAt: now });
  await saveDocument(document, existing.thumbnail, { favorite: false });
  return document;
}

export async function deleteDocument(id: string): Promise<void> {
  if (isDesktopApp()) return deleteNativeDocument(id);
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
  if (isDesktopApp()) return clearNativeDocuments();
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
  recovery: RecoverySnapshot[],
  replace = true,
  templates: Array<{ id: string; name: string; createdAt: number; document: DiagramDocument }> = [],
  preferences: Record<string, string> = {},
): Promise<void> {
  if (isDesktopApp()) {
    await restoreNativeWorkspaceData(documents, snapshots, recovery, replace, templates, preferences);
    return;
  }
  const nextDocuments = documents.map((record) => structuredClone(record));
  const nextSnapshots = snapshots.map((snapshot) => structuredClone(snapshot));
  const nextRecovery = recovery.map((snapshot) => ({
    ...snapshot,
    id: `recovery-${snapshot.document.id}`,
    document: structuredClone(snapshot.document),
  }));

  if (!supportsIndexedDb()) {
    const documentsMap = replace ? new Map<string, StoredDocument>() : new Map(memoryDocuments);
    const snapshotsMap = replace ? new Map<string, DocumentSnapshot>() : new Map(memorySnapshots);
    nextDocuments.forEach((record) => documentsMap.set(record.id, record));
    nextSnapshots.forEach((snapshot) => snapshotsMap.set(snapshot.id, snapshot));
    if (replace) memoryRecovery.clear();
    nextRecovery.forEach((snapshot) => memoryRecovery.set(snapshot.id, snapshot));
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
    recoveryStore.clear();
  }
  nextDocuments.forEach((record) => documentStore.put(record));
  nextSnapshots.forEach((snapshot) => snapshotStore.put(snapshot));
  nextRecovery.forEach((snapshot) => recoveryStore.put(snapshot));
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
  if (isDesktopApp()) {
    await saveNativeSnapshot(snapshot, options.limit ?? getSnapshotLimit());
    return snapshot;
  }
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
  if (isDesktopApp()) return listNativeSnapshots(documentId);
  const records = !supportsIndexedDb()
    ? [...memorySnapshots.values()]
    : await readAllSnapshots();
  return records
    .filter((snapshot) => snapshot.documentId === documentId)
    .sort((left, right) => right.savedAt - left.savedAt)
    .map((snapshot) => ({ ...snapshot, document: migrateDocument(snapshot.document) }));
}

export async function listAllDocumentSnapshots(): Promise<DocumentSnapshot[]> {
  if (isDesktopApp()) return listNativeSnapshots();
  const records = !supportsIndexedDb() ? [...memorySnapshots.values()] : await readAllSnapshots();
  return records
    .sort((left, right) => right.savedAt - left.savedAt)
    .map((snapshot) => ({ ...snapshot, document: migrateDocument(snapshot.document) }));
}

export async function loadDocumentSnapshot(id: string): Promise<DocumentSnapshot | null> {
  if (isDesktopApp()) return loadNativeSnapshot(id);
  const snapshot = !supportsIndexedDb()
    ? memorySnapshots.get(id)
    : await readSnapshot(id);
  return snapshot ? { ...snapshot, document: migrateDocument(snapshot.document) } : null;
}

export async function deleteDocumentSnapshot(id: string): Promise<void> {
  if (isDesktopApp()) return deleteNativeSnapshot(id);
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
  if (isDesktopApp()) return clearNativeSnapshots();
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
  if (isDesktopApp()) return saveNativeRecovery(document, savedAt);
  const snapshot: RecoverySnapshot = { id: `recovery-${document.id}`, document: structuredClone(document), savedAt };
  if (!supportsIndexedDb()) {
    const current = memoryRecovery.get(snapshot.id);
    if (current && current.savedAt >= savedAt) return;
    memoryRecovery.set(snapshot.id, snapshot);
    return;
  }
  const database = await openDatabase();
  const transaction = database.transaction(RECOVERY_STORE, 'readwrite');
  const store = transaction.objectStore(RECOVERY_STORE);
  const records = await requestResult<RecoverySnapshot[]>(store.getAll());
  const current = records
    .filter((entry) => entry.document.id === document.id)
    .sort((left, right) => right.savedAt - left.savedAt)[0];
  if (!current || current.savedAt < savedAt) {
    records.filter((entry) => entry.document.id === document.id).forEach((entry) => store.delete(entry.id));
    store.put(snapshot);
  }
  await transactionComplete(transaction);
}

export async function getRecoverySnapshot(documentId?: string): Promise<RecoverySnapshot | null> {
  if (isDesktopApp()) return getNativeRecovery(documentId);
  return (await listRecoverySnapshots()).find((snapshot) => !documentId || snapshot.document.id === documentId) ?? null;
}

export async function listRecoverySnapshots(): Promise<RecoverySnapshot[]> {
  if (isDesktopApp()) return listNativeRecovery();
  const records = !supportsIndexedDb()
    ? [...memoryRecovery.values()]
    : await requestResult<RecoverySnapshot[]>(
      (await openDatabase()).transaction(RECOVERY_STORE, 'readonly').objectStore(RECOVERY_STORE).getAll(),
    );
  const latestByDocument = new Map<string, RecoverySnapshot>();
  records.forEach((snapshot) => {
    const current = latestByDocument.get(snapshot.document.id);
    if (!current || snapshot.savedAt > current.savedAt) latestByDocument.set(snapshot.document.id, snapshot);
  });
  return [...latestByDocument.values()]
    .sort((left, right) => right.savedAt - left.savedAt)
    .map((snapshot) => ({ ...snapshot, document: migrateDocument(snapshot.document) }));
}

export async function clearRecoverySnapshot(documentId?: string, savedBeforeOrAt?: number): Promise<void> {
  if (isDesktopApp()) return clearNativeRecovery(documentId, savedBeforeOrAt);
  if (!supportsIndexedDb()) {
    for (const [id, snapshot] of memoryRecovery) {
      if ((!documentId || snapshot.document.id === documentId)
        && (savedBeforeOrAt === undefined || snapshot.savedAt <= savedBeforeOrAt)) memoryRecovery.delete(id);
    }
    return;
  }
  const database = await openDatabase();
  const transaction = database.transaction(RECOVERY_STORE, 'readwrite');
  const store = transaction.objectStore(RECOVERY_STORE);
  const records = await requestResult<RecoverySnapshot[]>(store.getAll());
  records.forEach((snapshot) => {
    if ((!documentId || snapshot.document.id === documentId)
      && (savedBeforeOrAt === undefined || snapshot.savedAt <= savedBeforeOrAt)) store.delete(snapshot.id);
  });
  await transactionComplete(transaction);
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (isDesktopApp()) return false;
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export async function getStorageEstimate(): Promise<StorageEstimate> {
  if (isDesktopApp()) return getNativeStorageEstimate();
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
