import { migrateDocument } from '../core/document';
import type { DiagramDocument } from '../core/types';
import { deleteNativeTemplate, isDesktopApp, listNativeTemplates, saveNativeTemplate } from './nativeStorage';

const TEMPLATE_KEY = 'aperglyph.local-templates';

export interface LocalTemplate {
  id: string;
  name: string;
  createdAt: number;
  document: DiagramDocument;
}

export async function listLocalTemplates(): Promise<LocalTemplate[]> {
  if (isDesktopApp()) return listNativeTemplates();
  if (typeof globalThis.localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(globalThis.localStorage.getItem(TEMPLATE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLocalTemplate).map((template) => ({ ...template, document: migrateDocument(template.document) }));
  } catch {
    return [];
  }
}

export async function saveLocalTemplate(document: DiagramDocument, name: string): Promise<LocalTemplate | null> {
  if (!name.trim() || (!isDesktopApp() && typeof globalThis.localStorage === 'undefined')) return null;
  const template: LocalTemplate = { id: `template_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name: name.trim(), createdAt: Date.now(), document: structuredClone(document) };
  if (isDesktopApp()) {
    try {
      await saveNativeTemplate(template);
      return template;
    } catch {
      return null;
    }
  }
  const templates = [template, ...(await listLocalTemplates())].slice(0, 100);
  try {
    globalThis.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
    return template;
  } catch {
    return null;
  }
}

export async function deleteLocalTemplate(id: string): Promise<void> {
  if (isDesktopApp()) return deleteNativeTemplate(id);
  if (typeof globalThis.localStorage === 'undefined') return;
  try {
    globalThis.localStorage.setItem(TEMPLATE_KEY, JSON.stringify((await listLocalTemplates()).filter((template) => template.id !== id)));
  } catch {
    // Local templates are optional and never block editing.
  }
}

/** Replace local templates during an explicit workspace restore. */
export async function replaceLocalTemplates(templates: LocalTemplate[]): Promise<void> {
  if (isDesktopApp()) return;
  if (typeof globalThis.localStorage === 'undefined') return;
  const safeTemplates = templates.slice(0, 100).map((template) => ({
    id: template.id,
    name: template.name.trim().slice(0, 256),
    createdAt: Number.isFinite(template.createdAt) ? template.createdAt : Date.now(),
    document: structuredClone(migrateDocument(template.document)),
  }));
  try {
    globalThis.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(safeTemplates));
  } catch {
    // Templates are optional and never block editing.
  }
}

/** Merge backup templates by stable ID, preserving local-only templates. */
export async function mergeLocalTemplates(templates: LocalTemplate[]): Promise<void> {
  if (isDesktopApp()) return;
  if (typeof globalThis.localStorage === 'undefined') return;
  const existing = await listLocalTemplates();
  const merged = new Map(existing.map((template) => [template.id, template]));
  templates.forEach((template) => merged.set(template.id, {
    id: template.id,
    name: template.name.trim().slice(0, 256),
    createdAt: Number.isFinite(template.createdAt) ? template.createdAt : Date.now(),
    document: structuredClone(migrateDocument(template.document)),
  }));
  try {
    globalThis.localStorage.setItem(TEMPLATE_KEY, JSON.stringify([...merged.values()].slice(-100)));
  } catch {
    // Templates are optional and never block editing.
  }
}

function isLocalTemplate(value: unknown): value is LocalTemplate {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.name === 'string' && typeof record.createdAt === 'number' && Boolean(record.document && typeof record.document === 'object');
}
