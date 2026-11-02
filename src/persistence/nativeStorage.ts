import { invoke, isTauri } from '@tauri-apps/api/core';
import type { DiagramDocument } from '../core/types';
import type { DocumentSnapshot, RecoverySnapshot, StorageEstimate, StoredDocument, StoredDocumentSummary } from './indexedDb';
import type { LocalTemplate } from './templates';
import { editorEvents } from '../core/events';

const nativePreferenceCache = new Map<string, string>();
let nativeStorageShimInstalled = false;

export function isDesktopApp(): boolean {
  return isTauri();
}

export async function initializeNativeStorage(): Promise<void> {
  if (!isDesktopApp()) return;
  const entries = await invoke<Array<[string, string]>>('list_preferences');
  nativePreferenceCache.clear();
  entries.forEach(([key, value]) => nativePreferenceCache.set(key, value));
  installNativeStorageShim();
}

export function getCachedNativePreference(key: string): string | undefined {
  return nativePreferenceCache.get(key);
}

export async function saveNativeDocument(document: DiagramDocument, thumbnail?: string | null): Promise<void> {
  await invoke<StoredDocument>('save_document', {
    document,
    thumbnail: typeof thumbnail === 'string' ? thumbnail : null,
    clearThumbnail: thumbnail === null,
  });
}

export function saveNativeDocumentThumbnail(id: string, revision: number, thumbnail: string): Promise<boolean> {
  return invoke<boolean>('save_document_thumbnail', { id, revision, thumbnail });
}

export function loadNativeDocument(id: string): Promise<StoredDocument | null> {
  return invoke<StoredDocument | null>('load_document', { id });
}

export function listNativeDocuments(includeTrashed = false): Promise<StoredDocument[]> {
  return invoke<StoredDocument[]>('list_documents', { includeTrashed });
}

export function listNativeDocumentSummaries(includeTrashed = false): Promise<StoredDocumentSummary[]> {
  return invoke<StoredDocumentSummary[]>('list_document_summaries', { includeTrashed });
}

export function updateNativeDocumentMetadata(id: string, changes: Pick<StoredDocument, 'favorite' | 'trashedAt'>): Promise<void> {
  const payload = { ...changes } as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(changes, 'trashedAt') && changes.trashedAt === undefined) payload.trashedAt = null;
  return invoke('update_document_metadata', { id, changes: payload });
}

export function renameNativeDocument(id: string, name: string): Promise<DiagramDocument | null> {
  return invoke<StoredDocument | null>('rename_document', { id, name }).then((record) => record?.document ?? null);
}

export function duplicateNativeDocument(id: string): Promise<DiagramDocument | null> {
  const newId = `doc_${globalThis.crypto.randomUUID()}`;
  return invoke<StoredDocument | null>('duplicate_document', { id, newId }).then((record) => record?.document ?? null);
}

export function deleteNativeDocument(id: string): Promise<void> {
  return invoke('delete_document', { id });
}

export function clearNativeDocuments(): Promise<void> {
  return invoke('clear_all_documents');
}

export function restoreNativeWorkspaceData(
  documents: StoredDocument[],
  snapshots: DocumentSnapshot[],
  recovery: Array<{ id: string; document: DiagramDocument; savedAt: number }>,
  replace = true,
  templates: LocalTemplate[] = [],
  preferences: Record<string, string> = {},
): Promise<void> {
  return invoke('restore_workspace_data', {
    documents,
    snapshots,
    recovery,
    templates,
    preferences: Object.entries(preferences),
    replace,
  }).then(async () => {
    await listNativePreferences();
  });
}

export interface NativeWorkspaceExportSnapshot {
  documents: StoredDocument[];
  snapshots: DocumentSnapshot[];
  recovery: RecoverySnapshot[];
  templates: LocalTemplate[];
  preferences: Array<[string, string]>;
}

export function exportNativeWorkspaceSnapshot(): Promise<NativeWorkspaceExportSnapshot> {
  return invoke<NativeWorkspaceExportSnapshot>('export_workspace_snapshot');
}

export function saveNativeSnapshot(snapshot: DocumentSnapshot, limit: number): Promise<void> {
  return invoke('save_snapshot', { snapshot, limit });
}

export function listNativeSnapshots(documentId?: string): Promise<DocumentSnapshot[]> {
  return invoke<DocumentSnapshot[]>('list_snapshots', { documentId: documentId ?? null });
}

export function loadNativeSnapshot(id: string): Promise<DocumentSnapshot | null> {
  return invoke<DocumentSnapshot | null>('load_snapshot', { id });
}

export function deleteNativeSnapshot(id: string): Promise<void> {
  return invoke('delete_snapshot', { id });
}

export function clearNativeSnapshots(): Promise<void> {
  return invoke('clear_snapshots');
}

export function saveNativeRecovery(document: DiagramDocument, savedAt: number): Promise<void> {
  return invoke('save_recovery', { document, savedAt });
}

export function getNativeRecovery(documentId?: string): Promise<RecoverySnapshot | null> {
  return invoke<RecoverySnapshot | null>('get_recovery', { documentId: documentId ?? null });
}

export function listNativeRecovery(): Promise<RecoverySnapshot[]> {
  return invoke<RecoverySnapshot[]>('list_recovery');
}

export function clearNativeRecovery(documentId?: string, savedBeforeOrAt?: number): Promise<void> {
  return invoke('clear_recovery', { documentId: documentId ?? null, savedBeforeOrAt: savedBeforeOrAt ?? null });
}

export function listNativeTemplates(): Promise<LocalTemplate[]> {
  return invoke<LocalTemplate[]>('list_templates');
}

export function saveNativeTemplate(template: LocalTemplate): Promise<void> {
  return invoke('save_template', { template });
}

export function deleteNativeTemplate(id: string): Promise<void> {
  return invoke('delete_template', { id });
}

export function setNativePreference(key: string, value: string): Promise<void> {
  nativePreferenceCache.set(key, value);
  return invoke<void>('set_preference', { key, value }).catch((error: unknown) => {
    reportPreferenceError(error);
    throw error;
  });
}

export async function getNativePreference(key: string): Promise<string | null> {
  const value = await invoke<string | null>('get_preference', { key });
  if (value === null) nativePreferenceCache.delete(key);
  else nativePreferenceCache.set(key, value);
  return value;
}

export async function listNativePreferences(): Promise<Record<string, string>> {
  const entries = await invoke<Array<[string, string]>>('list_preferences');
  nativePreferenceCache.clear();
  entries.forEach(([key, value]) => nativePreferenceCache.set(key, value));
  return Object.fromEntries(entries);
}

export function deleteNativePreference(key: string): Promise<void> {
  nativePreferenceCache.delete(key);
  return invoke<void>('delete_preference', { key }).catch((error: unknown) => {
    reportPreferenceError(error);
    throw error;
  });
}

export async function getNativeStorageEstimate(): Promise<StorageEstimate> {
  const usage = await invoke<number>('get_storage_usage');
  return { usage, quota: 0, usageRatio: 0, persistent: true };
}

export function flushNativeStorage(): Promise<void> {
  return invoke('flush_storage');
}

export function nativeDataDirectory(): Promise<string> {
  return invoke<string>('get_data_directory');
}

function installNativeStorageShim(): void {
  if (nativeStorageShimInstalled || typeof globalThis.window === 'undefined') return;
  const storage: Storage = {
    get length() { return nativePreferenceCache.size; },
    clear() {
      const keys = [...nativePreferenceCache.keys()];
      nativePreferenceCache.clear();
      keys.forEach((key) => void deleteNativePreference(key).catch(() => undefined));
    },
    getItem(key: string) { return nativePreferenceCache.get(key) ?? null; },
    key(index: number) { return [...nativePreferenceCache.keys()][index] ?? null; },
    removeItem(key: string) { void deleteNativePreference(key).catch(() => undefined); },
    setItem(key: string, value: string) { void setNativePreference(key, value).catch(() => undefined); },
  };
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    nativeStorageShimInstalled = true;
  } catch (error) {
    reportPreferenceError(error);
    throw new Error('Unable to connect desktop preferences to the native workspace database.');
  }
}

function reportPreferenceError(error: unknown): void {
  const normalized = error instanceof Error ? error : new Error('Unable to save a desktop preference.');
  editorEvents.emit('storage:error', { error: normalized });
}
