import { createId } from './document';
import type { DiagramDocument, DiagramNode } from './types';

export interface EntityField {
  id: string;
  name: string;
  type: string;
  primaryKey: boolean;
  foreignKey: boolean;
  unique: boolean;
  nullable: boolean;
}

export interface ErdDiagnostic {
  severity: 'warning' | 'error';
  message: string;
  nodeId?: string;
}

export const ERD_HEADER_HEIGHT = 34;
export const ERD_ROW_HEIGHT = 27;

export function entityAutoHeight(fields: unknown): number {
  return ERD_HEADER_HEIGHT + Math.max(1, normalizeEntityFields(fields).length) * ERD_ROW_HEIGHT;
}

export function createEntityField(overrides: Partial<EntityField> = {}): EntityField {
  return {
    id: overrides.id ?? createId('field'),
    name: overrides.name ?? 'new_field',
    type: overrides.type ?? 'varchar',
    primaryKey: overrides.primaryKey ?? false,
    foreignKey: overrides.foreignKey ?? false,
    unique: overrides.unique ?? false,
    nullable: overrides.nullable ?? true,
  };
}

/** Converts the original compact string field format into structured fields. */
export function normalizeEntityFields(value: unknown): EntityField[] {
  if (!Array.isArray(value)) return [];
  return value.map((field, index) => {
    if (typeof field === 'string') {
      const parts = field.split('·').map((part) => part.trim()).filter(Boolean);
      const flags = new Set(parts.slice(2).map((part) => part.toUpperCase()));
      return createEntityField({
        id: `field_${index}_${slugify(parts[0] ?? 'attribute')}`,
        name: parts[0] ?? `field_${index + 1}`,
        type: parts[1] ?? 'varchar',
        primaryKey: flags.has('PK') || flags.has('PRIMARY KEY'),
        foreignKey: flags.has('FK') || flags.has('FOREIGN KEY'),
        unique: flags.has('UQ') || flags.has('UNIQUE'),
        nullable: !flags.has('NN') && !flags.has('NOT NULL'),
      });
    }
    if (isRecord(field)) return createEntityField({
      id: typeof field.id === 'string' ? field.id : undefined,
      name: typeof field.name === 'string' ? field.name : undefined,
      type: typeof field.type === 'string' ? field.type : undefined,
      primaryKey: field.primaryKey === true,
      foreignKey: field.foreignKey === true,
      unique: field.unique === true,
      nullable: field.nullable !== false,
    });
    return createEntityField({ id: `field_${index}_attribute`, name: `field_${index + 1}` });
  });
}

export function entityFieldLabel(field: EntityField): string {
  const flags = [field.primaryKey ? 'PK' : '', field.foreignKey ? 'FK' : '', field.unique ? 'UQ' : '', field.nullable ? '' : 'NN'].filter(Boolean).join(' ');
  return `${field.name} · ${field.type}${flags ? ` · ${flags}` : ''}`;
}

export function validateErd(document: DiagramDocument): ErdDiagnostic[] {
  const diagnostics: ErdDiagnostic[] = [];
  document.pages.forEach((page) => {
    const entities = page.nodes.filter((node) => node.type === 'entity');
    const entityIds = new Set(entities.map((node) => node.id));
    entities.forEach((entity) => {
      const label = typeof entity.data.label === 'string' ? entity.data.label.trim() : '';
      if (!label) diagnostics.push({ severity: 'error', message: 'Entity is missing a table name.', nodeId: entity.id });
      const fields = normalizeEntityFields(entity.data.fields);
      if (fields.length === 0) diagnostics.push({ severity: 'warning', message: `${label || 'Entity'} has no attributes.`, nodeId: entity.id });
      const seen = new Set<string>();
      fields.forEach((field) => {
        const name = field.name.trim().toLowerCase();
        if (!name) diagnostics.push({ severity: 'error', message: `${label || 'Entity'} contains an unnamed attribute.`, nodeId: entity.id });
        if (seen.has(name)) diagnostics.push({ severity: 'error', message: `${label || 'Entity'} contains duplicate attribute “${field.name}”.`, nodeId: entity.id });
        seen.add(name);
      });
    });
    page.edges.forEach((edge) => {
      if (!entityIds.has(edge.source.nodeId) || !entityIds.has(edge.target.nodeId)) diagnostics.push({ severity: 'warning', message: 'ERD relationships should connect two entities.' });
    });
  });
  return diagnostics;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'attribute';
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
