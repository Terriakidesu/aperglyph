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
  defaultValue?: string;
  description?: string;
  reference?: EntityReference;
}

export type ReferentialAction = 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION';

export interface EntityReference {
  entityId: string;
  fieldId?: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

export type EntityVariant = 'key-field' | 'key-field-type' | 'field-type' | 'field' | 'field-nullability' | 'key-field-nullability' | 'key-field-type-nullability';
export type EntityColumnId = 'key' | 'field' | 'type' | 'nullable';
export interface EntityColumn {
  id: EntityColumnId;
  label: string;
  x: number;
  width: number;
}

export interface ErdDiagnostic {
  severity: 'warning' | 'error';
  message: string;
  nodeId?: string;
}

export const ERD_HEADER_HEIGHT = 34;
export const ERD_COLUMN_HEADER_HEIGHT = 21;
export const ERD_ROW_HEIGHT = 27;

export const entityVariantOptions: Array<{ value: EntityVariant; label: string }> = [
  { value: 'key-field-type', label: 'Key · Field · Data type' },
  { value: 'key-field', label: 'Key · Field' },
  { value: 'field-type', label: 'Field · Data type' },
  { value: 'field', label: 'Field only' },
  { value: 'field-nullability', label: 'Field · Nullability' },
  { value: 'key-field-nullability', label: 'Key · Field · Nullability' },
  { value: 'key-field-type-nullability', label: 'Key · Field · Data type · Nullability' },
];

export function normalizeEntityVariant(value: unknown): EntityVariant {
  return entityVariantOptions.some((option) => option.value === value) ? value as EntityVariant : 'key-field-type';
}

export function entityAutoHeight(fields: unknown, variant: unknown = 'key-field-type', columnHeaders = false): number {
  return ERD_HEADER_HEIGHT + (columnHeaders ? ERD_COLUMN_HEADER_HEIGHT : 0) + Math.max(1, normalizeEntityFields(fields).length) * ERD_ROW_HEIGHT;
}

export function entityColumns(variant: unknown, width: number): EntityColumn[] {
  const ids = columnsForVariant(variant);
  const keyWidth = ids.includes('key') ? 38 : 0;
  const typeWidth = ids.includes('type') ? Math.min(82, Math.max(58, width * 0.3)) : 0;
  const nullableWidth = ids.includes('nullable') ? 62 : 0;
  const fieldWidth = Math.max(48, width - keyWidth - typeWidth - nullableWidth);
  const widths: Record<EntityColumnId, number> = { key: keyWidth, field: fieldWidth, type: typeWidth, nullable: nullableWidth };
  let x = 0;
  return ids.map((id) => {
    const column = { id, label: columnLabel(id), x, width: widths[id] };
    x += column.width;
    return column;
  });
}

export function entityFieldValue(field: EntityField, column: EntityColumnId): string {
  if (column === 'key') return field.primaryKey && field.foreignKey ? 'PK/FK' : field.primaryKey ? 'PK' : field.foreignKey ? 'FK' : field.unique ? 'UQ' : '';
  if (column === 'field') return field.name;
  if (column === 'type') return field.type;
  return field.nullable ? 'NULL' : 'NOT NULL';
}

export function entityFieldPortOffset(fields: unknown, index: number, columnHeaders = false): number {
  const fieldTop = ERD_HEADER_HEIGHT + (columnHeaders ? ERD_COLUMN_HEADER_HEIGHT : 0);
  const height = entityAutoHeight(fields, 'key-field-type', columnHeaders);
  return (fieldTop + index * ERD_ROW_HEIGHT + ERD_ROW_HEIGHT / 2) / Math.max(1, height);
}

function columnsForVariant(value: unknown): EntityColumnId[] {
  switch (normalizeEntityVariant(value)) {
    case 'key-field': return ['key', 'field'];
    case 'field-type': return ['field', 'type'];
    case 'field': return ['field'];
    case 'field-nullability': return ['field', 'nullable'];
    case 'key-field-nullability': return ['key', 'field', 'nullable'];
    case 'key-field-type-nullability': return ['key', 'field', 'type', 'nullable'];
    default: return ['key', 'field', 'type'];
  }
}

function columnLabel(column: EntityColumnId): string {
  if (column === 'key') return 'Key';
  if (column === 'field') return 'Field';
  if (column === 'type') return 'Data type';
  return 'Null';
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
    ...(overrides.defaultValue === undefined ? {} : { defaultValue: overrides.defaultValue }),
    ...(overrides.description === undefined ? {} : { description: overrides.description }),
    ...(overrides.reference ? { reference: structuredClone(overrides.reference) } : {}),
  };
}

/** Parse one attribute per line from the compact text form used by SQL notes. */
export function parseEntityFields(raw: string): EntityField[] {
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.includes('·')
      ? line.split('·').map((part) => part.trim()).filter(Boolean)
      : line.split(/\s+/).map((part) => part.trim()).filter(Boolean);
    const name = parts.shift() ?? 'new_field';
    const type = parts.length > 0 && !isFieldFlag(parts[0]) ? parts.shift()! : 'varchar';
    const flags = new Set(parts.map((part) => part.toUpperCase().replace(/[:,]$/, '')));
    return createEntityField({
      name,
      type,
      primaryKey: flags.has('PK') || flags.has('PRIMARY') || flags.has('PRIMARY KEY'),
      foreignKey: flags.has('FK') || flags.has('FOREIGN') || flags.has('FOREIGN KEY'),
      unique: flags.has('UQ') || flags.has('UNIQUE'),
      nullable: !(flags.has('NN') || flags.has('NOT') || flags.has('NOT NULL')),
    });
  });
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
      defaultValue: typeof field.defaultValue === 'string' ? field.defaultValue : undefined,
      description: typeof field.description === 'string' ? field.description : undefined,
      reference: isRecord(field.reference) && typeof field.reference.entityId === 'string' ? {
        entityId: field.reference.entityId,
        ...(typeof field.reference.fieldId === 'string' ? { fieldId: field.reference.fieldId } : {}),
        ...(isReferentialAction(field.reference.onDelete) ? { onDelete: field.reference.onDelete } : {}),
        ...(isReferentialAction(field.reference.onUpdate) ? { onUpdate: field.reference.onUpdate } : {}),
      } : undefined,
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
        if (field.reference && !entityIds.has(field.reference.entityId)) diagnostics.push({ severity: 'error', message: `${label || 'Entity'} attribute “${field.name}” references a missing entity.`, nodeId: entity.id });
        if (field.reference && !field.foreignKey) diagnostics.push({ severity: 'warning', message: `${label || 'Entity'} attribute “${field.name}” has a reference but is not marked FK.`, nodeId: entity.id });
      });
    });
    page.edges.forEach((edge) => {
      if (!edge.source.nodeId || !edge.target.nodeId || !entityIds.has(edge.source.nodeId) || !entityIds.has(edge.target.nodeId)) diagnostics.push({ severity: 'warning', message: 'ERD relationships should connect two entities.' });
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

function isFieldFlag(value: string): boolean {
  return ['PK', 'FK', 'UQ', 'NN', 'PRIMARY', 'PRIMARY KEY', 'FOREIGN', 'FOREIGN KEY', 'UNIQUE', 'NOT', 'NOT NULL'].includes(value.toUpperCase().replace(/[:,]$/, ''));
}

function isReferentialAction(value: unknown): value is ReferentialAction {
  return value === 'CASCADE' || value === 'RESTRICT' || value === 'SET NULL' || value === 'NO ACTION';
}
