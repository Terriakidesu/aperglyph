import { createId, migrateDocument } from '../core/document';
import type { DiagramDocument } from '../core/types';

const DATABASE_NAME = 'aperglyph-local';
const DATABASE_VERSION = 2;
const DOCUMENTS_STORE = 'documents';
const RECOVERY_STORE = 'recovery';
const ACTIVE_RECOVERY_ID = 'active-recovery';

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

export interface StorageEstimate {
  usage: number;
  quota: number;
  usageRatio: number;
  persistent: boolean;
}

const memoryDocuments = new Map<string, StoredDocument>();
let memoryRecovery: RecoverySnapshot | null = null;
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
    return;
  }
  const database = await openDatabase();
  const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
  transaction.objectStore(DOCUMENTS_STORE).delete(id);
  await transactionComplete(transaction);
}

export async function saveRecoverySnapshot(document: DiagramDocument): Promise<void> {
  const snapshot: RecoverySnapshot = { id: ACTIVE_RECOVERY_ID, document: structuredClone(document), savedAt: Date.now() };
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

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Local storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Local storage transaction was aborted.'));
  });
}
