import { migrateDocument } from '../core/document';
import type { DiagramDocument } from '../core/types';

const TEMPLATE_KEY = 'aperglyph.local-templates';

export interface LocalTemplate {
  id: string;
  name: string;
  createdAt: number;
  document: DiagramDocument;
}

export function listLocalTemplates(): LocalTemplate[] {
  if (typeof globalThis.localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(globalThis.localStorage.getItem(TEMPLATE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLocalTemplate).map((template) => ({ ...template, document: migrateDocument(template.document) }));
  } catch {
    return [];
  }
}

export function saveLocalTemplate(document: DiagramDocument, name: string): LocalTemplate | null {
  if (!name.trim() || typeof globalThis.localStorage === 'undefined') return null;
  const template: LocalTemplate = { id: `template_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name: name.trim(), createdAt: Date.now(), document: structuredClone(document) };
  const templates = [template, ...listLocalTemplates()].slice(0, 100);
  try {
    globalThis.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
    return template;
  } catch {
    return null;
  }
}

export function deleteLocalTemplate(id: string): void {
  if (typeof globalThis.localStorage === 'undefined') return;
  try {
    globalThis.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(listLocalTemplates().filter((template) => template.id !== id)));
  } catch {
    // Local templates are optional and never block editing.
  }
}

/** Replace local templates during an explicit workspace restore. */
export function replaceLocalTemplates(templates: LocalTemplate[]): void {
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

function isLocalTemplate(value: unknown): value is LocalTemplate {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.name === 'string' && typeof record.createdAt === 'number' && Boolean(record.document && typeof record.document === 'object');
}
