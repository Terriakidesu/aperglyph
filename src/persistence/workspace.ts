import { migrateDocument, validateProjectDocument } from '../core/document';
import type { DiagramDocument } from '../core/types';
import {
  listAllDocumentSnapshots,
  listDocumentSummaries,
  listDocuments,
  listRecoverySnapshots,
  listTrashedDocumentSummaries,
  listTrashedDocuments,
  restoreWorkspaceData,
  type DocumentSnapshot,
  type RecoverySnapshot,
  type StoredDocument,
} from './indexedDb';
import { listLocalTemplates, mergeLocalTemplates, replaceLocalTemplates, type LocalTemplate } from './templates';
import { forgetActiveDocument } from './session';
import { exportNativeWorkspaceSnapshot, isDesktopApp, listNativePreferences } from './nativeStorage';

export const WORKSPACE_BACKUP_FORMAT = 'aperglyph-workspace';
export const WORKSPACE_BACKUP_VERSION = 2;
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const MAX_BACKUP_DOCUMENTS = 5000;
const MAX_BACKUP_TEMPLATES = 100;
const MAX_BACKUP_SNAPSHOTS = 10000;
const TEMPLATE_STORAGE_KEY = 'aperglyph.local-templates';

export interface WorkspaceBackup {
  format: typeof WORKSPACE_BACKUP_FORMAT;
  formatVersion: typeof WORKSPACE_BACKUP_VERSION;
  exportedAt: number;
  documents: StoredDocument[];
  snapshots: DocumentSnapshot[];
  templates: LocalTemplate[];
  preferences: Record<string, string>;
  recovery: RecoverySnapshot[];
}

export interface WorkspaceRestoreResult {
  documents: number;
  snapshots: number;
  templates: number;
  preferences: number;
}

export interface WorkspaceBackupPreview {
  counts: {
    documents: number;
    snapshots: number;
    templates: number;
    preferences: number;
    recovery: number;
  };
  collisions: {
    documents: number;
    snapshots: number;
    templates: number;
    preferences: number;
    recovery: number;
  };
}

export async function createWorkspaceBackup(): Promise<string> {
  const [documents, snapshots, recovery, templates, preferences] = isDesktopApp()
    ? await exportNativeWorkspaceSnapshot().then((snapshot) => [
      snapshot.documents,
      snapshot.snapshots,
      snapshot.recovery,
      snapshot.templates,
      Object.fromEntries(snapshot.preferences),
    ] as const)
    : await Promise.all([
      Promise.all([listDocuments(), listTrashedDocuments()]).then(([saved, trashed]) => [...saved, ...trashed]),
      listAllDocumentSnapshots(),
      listRecoverySnapshots(),
      listLocalTemplates(),
      readPreferences(),
    ]);
  const backup: WorkspaceBackup = {
    format: WORKSPACE_BACKUP_FORMAT,
    formatVersion: WORKSPACE_BACKUP_VERSION,
    exportedAt: Date.now(),
    documents: documents.map((record) => structuredClone(record)),
    snapshots: snapshots.map((snapshot) => structuredClone(snapshot)),
    templates: templates.map((template) => structuredClone(template)),
    preferences,
    recovery: recovery.map((snapshot) => structuredClone(snapshot)),
  };
  return JSON.stringify(backup, null, 2);
}

export async function previewWorkspaceBackup(raw: string): Promise<WorkspaceBackupPreview> {
  const backup = parseWorkspaceBackup(raw);
  const [existingDocuments, existingSnapshots, existingTemplates, existingPreferences, existingRecovery] = await Promise.all([
    Promise.all([listDocumentSummaries(), listTrashedDocumentSummaries()]).then(([active, trashed]) => [...active, ...trashed]),
    listAllDocumentSnapshots(),
    listLocalTemplates(),
    readPreferences(),
    listRecoverySnapshots(),
  ]);
  const documentIds = new Set(existingDocuments.map((record) => record.id));
  const snapshotIds = new Set(existingSnapshots.map((snapshot) => snapshot.id));
  const templateIds = new Set(existingTemplates.map((template) => template.id));
  const preferenceKeys = new Set(Object.keys(existingPreferences));
  const recoveryIds = new Set(existingRecovery.map((snapshot) => snapshot.document.id));
  return {
    counts: {
      documents: backup.documents.length,
      snapshots: backup.snapshots.length,
      templates: backup.templates.length,
      preferences: Object.keys(backup.preferences).length,
      recovery: backup.recovery.length,
    },
    collisions: {
      documents: backup.documents.filter((record) => documentIds.has(record.id)).length,
      snapshots: backup.snapshots.filter((snapshot) => snapshotIds.has(snapshot.id)).length,
      templates: backup.templates.filter((template) => templateIds.has(template.id)).length,
      preferences: Object.keys(backup.preferences).filter((key) => preferenceKeys.has(key)).length,
      recovery: backup.recovery.filter((snapshot) => recoveryIds.has(snapshot.document.id)).length,
    },
  };
}

export function parseWorkspaceBackup(raw: string): WorkspaceBackup {
  if (raw.length > MAX_BACKUP_BYTES) throw new Error('This workspace backup is too large to import safely.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isRecord(value) || value.format !== WORKSPACE_BACKUP_FORMAT || (value.formatVersion !== 1 && value.formatVersion !== WORKSPACE_BACKUP_VERSION)) {
    throw new Error('This file is not a supported AperGlyph workspace backup.');
  }
  if (!Array.isArray(value.documents) || value.documents.length > MAX_BACKUP_DOCUMENTS) throw new Error('The workspace backup contains too many documents.');
  if (!Array.isArray(value.snapshots) || value.snapshots.length > MAX_BACKUP_SNAPSHOTS) throw new Error('The workspace backup contains too many snapshots.');
  if (!Array.isArray(value.templates) || value.templates.length > MAX_BACKUP_TEMPLATES) throw new Error('The workspace backup contains too many templates.');

  const documents = value.documents.map((record, index) => parseStoredDocument(record, `documents[${index}]`));
  const snapshots = value.snapshots.map((snapshot, index) => parseSnapshot(snapshot, `snapshots[${index}]`));
  const templates = value.templates.map((template, index) => parseTemplate(template, `templates[${index}]`));
  const preferences = parsePreferences(value.preferences);
  const recovery = parseRecoveries(value.recovery);

  return {
    format: WORKSPACE_BACKUP_FORMAT,
    formatVersion: WORKSPACE_BACKUP_VERSION,
    exportedAt: Number.isFinite(value.exportedAt) ? Number(value.exportedAt) : Date.now(),
    documents,
    snapshots,
    templates,
    preferences,
    recovery,
  };
}

/**
 * Restore after parsing the entire file first. The default is a full replace,
 * which makes the operation match the backup wording and avoids silently
 * leaving stale documents behind. Callers should confirm this destructive step
 * in the UI before invoking it.
 */
export async function restoreWorkspaceBackup(raw: string, options: { replace?: boolean } = {}): Promise<WorkspaceRestoreResult> {
  const backup = parseWorkspaceBackup(raw);
  const replace = options.replace !== false;
  await restoreWorkspaceData(backup.documents, backup.snapshots, backup.recovery, replace, backup.templates, backup.preferences);
  // Desktop restore commits all backup components in one SQLite transaction.
  // The browser backend keeps templates and preferences in localStorage.
  if (!isDesktopApp()) {
    if (replace) {
      await replaceLocalTemplates(backup.templates);
      await restorePreferences(backup.preferences);
    } else {
      await mergeLocalTemplates(backup.templates);
      await mergePreferences(backup.preferences);
    }
  }
  if (replace) {
    await forgetActiveDocument();
  }

  return {
    documents: backup.documents.length,
    snapshots: backup.snapshots.length,
    templates: backup.templates.length,
    preferences: Object.keys(backup.preferences).length,
  };
}

export function downloadWorkspaceBackup(raw: string, filename = 'aperglyph-workspace-backup.json'): void {
  if (typeof document === 'undefined') return;
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
}

function parseStoredDocument(value: unknown, path: string): StoredDocument {
  if (!isRecord(value) || !isRecord(value.document)) throw new Error(`${path} is invalid.`);
  const errors = validateProjectDocument(value.document);
  if (errors.length > 0) throw new Error(`${path}.document is invalid: ${errors[0]}`);
  if (value.schemaVersion !== undefined && value.schemaVersion !== (value.document.schemaVersion ?? 1)) throw new Error(`${path}.schemaVersion does not match its document.`);
  const document = migrateDocument(value.document as Partial<DiagramDocument>);
  if (typeof value.id !== 'string' || value.id !== document.id) throw new Error(`${path}.id does not match its document.`);
  if (value.diagramType !== undefined && value.diagramType !== document.diagramType) throw new Error(`${path}.diagramType does not match its document.`);
  if (value.name !== undefined && value.name !== document.name) throw new Error(`${path}.name does not match its document.`);
  if (!Number.isFinite(value.createdAt) || Number(value.createdAt) !== document.createdAt) throw new Error(`${path}.createdAt does not match its document.`);
  if (!Number.isFinite(value.updatedAt) || Number(value.updatedAt) !== document.updatedAt) throw new Error(`${path}.updatedAt does not match its document.`);
  return {
    id: document.id,
    name: document.name,
    diagramType: document.diagramType,
    schemaVersion: document.schemaVersion,
    document,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    ...(typeof value.thumbnail === 'string' && value.thumbnail.length <= 600000 ? { thumbnail: value.thumbnail } : {}),
    ...(typeof value.favorite === 'boolean' ? { favorite: value.favorite } : {}),
    ...(Number.isFinite(value.trashedAt) ? { trashedAt: Number(value.trashedAt) } : {}),
  };
}

function parseSnapshot(value: unknown, path: string): DocumentSnapshot {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.documentId !== 'string' || !value.documentId.trim() || !isRecord(value.document)) throw new Error(`${path} is invalid.`);
  const errors = validateProjectDocument(value.document);
  if (errors.length > 0) throw new Error(`${path}.document is invalid: ${errors[0]}`);
  if (value.kind !== 'automatic' && value.kind !== 'checkpoint') throw new Error(`${path}.kind is invalid.`);
  if (!Number.isFinite(value.savedAt)) throw new Error(`${path}.savedAt is invalid.`);
  const document = migrateDocument(value.document as Partial<DiagramDocument>);
  if (document.id !== value.documentId) throw new Error(`${path}.documentId does not match its document.`);
  return {
    id: value.id.slice(0, 256),
    documentId: value.documentId.slice(0, 256),
    document,
    savedAt: Number(value.savedAt),
    kind: value.kind,
    ...(typeof value.name === 'string' && value.name.trim() ? { name: value.name.trim().slice(0, 128) } : {}),
  };
}

function parseTemplate(value: unknown, path: string): LocalTemplate {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string' || !value.name.trim() || !isRecord(value.document)) throw new Error(`${path} is invalid.`);
  const errors = validateProjectDocument(value.document);
  if (errors.length > 0) throw new Error(`${path}.document is invalid: ${errors[0]}`);
  return {
    id: value.id.slice(0, 256),
    name: value.name.trim().slice(0, 256),
    createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : Date.now(),
    document: migrateDocument(value.document as Partial<DiagramDocument>),
  };
}

function parseRecoveries(value: unknown): RecoverySnapshot[] {
  if (value === null || value === undefined) return [];
  const records = Array.isArray(value) ? value : [value];
  if (records.length > MAX_BACKUP_DOCUMENTS) throw new Error('The workspace backup contains too many recovery records.');
  const latestByDocument = new Map<string, RecoverySnapshot>();
  records.forEach((record, index) => {
    const snapshot = parseRecovery(record, `recovery[${index}]`);
    const existing = latestByDocument.get(snapshot.document.id);
    if (!existing || snapshot.savedAt > existing.savedAt) latestByDocument.set(snapshot.document.id, snapshot);
  });
  return [...latestByDocument.values()].sort((left, right) => right.savedAt - left.savedAt);
}

function parseRecovery(value: unknown, path: string): RecoverySnapshot {
  if (!isRecord(value) || !isRecord(value.document) || !Number.isFinite(value.savedAt)) throw new Error(`${path} is invalid.`);
  const errors = validateProjectDocument(value.document);
  if (errors.length > 0) throw new Error(`${path}.document is invalid: ${errors[0]}`);
  const document = migrateDocument(value.document as Partial<DiagramDocument>);
  const id = typeof value.id === 'string' && value.id.trim() && value.id !== 'active-recovery'
    ? value.id.slice(0, 256)
    : `recovery-${document.id}`;
  return { id, document, savedAt: Number(value.savedAt) };
}

function parsePreferences(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('preferences must be an object.');
  const preferences: Record<string, string> = {};
  for (const [key, item] of Object.entries(value).slice(0, 256)) {
    if (!/^aperglyph\./.test(key) || key.startsWith('aperglyph.mcp.') || key === TEMPLATE_STORAGE_KEY || typeof item !== 'string' || item.length > 200000) continue;
    preferences[key.slice(0, 256)] = item;
  }
  return preferences;
}

async function readPreferences(): Promise<Record<string, string>> {
  if (isDesktopApp()) return listNativePreferences();
  const preferences: Record<string, string> = {};
  if (typeof globalThis.localStorage === 'undefined') return preferences;
  try {
    for (let index = 0; index < globalThis.localStorage.length; index += 1) {
      const key = globalThis.localStorage.key(index);
      if (!key || !key.startsWith('aperglyph.') || key.startsWith('aperglyph.mcp.') || key === TEMPLATE_STORAGE_KEY) continue;
      const value = globalThis.localStorage.getItem(key);
      if (value !== null && value.length <= 200000) preferences[key] = value;
    }
  } catch {
    // Preferences are optional in restricted storage contexts.
  }
  return preferences;
}

async function restorePreferences(preferences: Record<string, string>): Promise<void> {
  if (typeof globalThis.localStorage === 'undefined') return;
  try {
    const staleKeys: string[] = [];
    for (let index = 0; index < globalThis.localStorage.length; index += 1) {
      const key = globalThis.localStorage.key(index);
      if (key?.startsWith('aperglyph.') && !key.startsWith('aperglyph.mcp.') && key !== TEMPLATE_STORAGE_KEY) staleKeys.push(key);
    }
    staleKeys.forEach((key) => globalThis.localStorage.removeItem(key));
    Object.entries(preferences).forEach(([key, value]) => globalThis.localStorage.setItem(key, value));
  } catch {
    // Preferences are optional and never block document restoration.
  }
}

async function mergePreferences(preferences: Record<string, string>): Promise<void> {
  if (typeof globalThis.localStorage === 'undefined') return;
  try {
    Object.entries(preferences).forEach(([key, value]) => globalThis.localStorage.setItem(key, value));
  } catch {
    // Preferences are optional and never block document restoration.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
