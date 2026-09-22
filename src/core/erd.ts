import { createEdge, createId } from './document';
import type { Diagnostic, DiagramDocument, DiagramEdge, DiagramNode, Size } from './types';

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
  /** SQL constraint identity used to preserve composite foreign keys. */
  constraintId?: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

export interface EntityIndex {
  id: string;
  name: string;
  fieldIds: string[];
  unique: boolean;
}

export type EntityVariant = 'key-field' | 'key-field-type' | 'field-type' | 'field' | 'field-nullability' | 'key-field-nullability' | 'key-field-type-nullability';
export type EntityColumnId = 'key' | 'field' | 'type' | 'nullable';
export interface EntityColumn {
  id: EntityColumnId;
  label: string;
  x: number;
  width: number;
}

export interface ErdDiagnostic extends Diagnostic {}

export const ERD_HEADER_HEIGHT = 34;
export const ERD_COLUMN_HEADER_HEIGHT = 21;
export const ERD_ROW_HEIGHT = 27;

export interface EntityLayoutMetrics {
  fieldTop: number;
  rowHeight: number;
  fieldCount: number;
}

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

/** Minimum usable bounds for an entity table, based on its visible columns and rows. */
export function entityMinimumSize(fields: unknown, variant: unknown = 'key-field-type', columnHeaders = false): Size {
  const columns = entityColumns(variant, 0);
  const columnWidth = columns.reduce((total, column) => total + column.width, 0);
  return {
    width: Math.max(120, columnWidth),
    height: entityAutoHeight(fields, variant, columnHeaders),
  };
}

/**
 * Keep a manually resized entity table filled instead of leaving unused space
 * below its fixed-height rows. Natural-sized entities retain the established
 * 27px row height; extra height is distributed evenly across their fields.
 */
export function entityLayoutMetrics(fields: unknown, height: number, columnHeaders = false): EntityLayoutMetrics {
  const fieldCount = Math.max(1, normalizeEntityFields(fields).length);
  const fieldTop = ERD_HEADER_HEIGHT + (columnHeaders ? ERD_COLUMN_HEADER_HEIGHT : 0);
  const availableHeight = Math.max(0, height - fieldTop);
  return {
    fieldTop,
    rowHeight: Math.max(ERD_ROW_HEIGHT, availableHeight / fieldCount),
    fieldCount,
  };
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

export function entityFieldPortOffset(fields: unknown, index: number, columnHeaders = false, nodeHeight?: number): number {
  const height = nodeHeight ?? entityAutoHeight(fields, 'key-field-type', columnHeaders);
  const { fieldTop, rowHeight } = entityLayoutMetrics(fields, height, columnHeaders);
  return (fieldTop + index * rowHeight + rowHeight / 2) / Math.max(1, height);
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
        ...(typeof field.reference.constraintId === 'string' ? { constraintId: field.reference.constraintId } : {}),
        ...(isReferentialAction(field.reference.onDelete) ? { onDelete: field.reference.onDelete } : {}),
        ...(isReferentialAction(field.reference.onUpdate) ? { onUpdate: field.reference.onUpdate } : {}),
      } : undefined,
    });
    return createEntityField({ id: `field_${index}_attribute`, name: `field_${index + 1}` });
  });
}

export function normalizeEntityIndexes(value: unknown, fields: EntityField[] = []): EntityIndex[] {
  if (!Array.isArray(value)) return [];
  const fieldIds = new Set(fields.map((field) => field.id));
  return value.flatMap((index, indexNumber) => {
    if (!isRecord(index)) return [];
    const name = typeof index.name === 'string' ? index.name.trim() : '';
    const ids = Array.isArray(index.fieldIds)
      ? index.fieldIds.filter((fieldId): fieldId is string => typeof fieldId === 'string' && fieldIds.has(fieldId))
      : [];
    if (!name || ids.length === 0) return [];
    return [{
      id: typeof index.id === 'string' && index.id.trim() ? index.id : `index_${indexNumber}_${slugify(name)}`,
      name,
      fieldIds: [...new Set(ids)],
      unique: index.unique === true,
    }];
  });
}

export function entityPrimaryKeyFields(node: DiagramNode): EntityField[] {
  return normalizeEntityFields(node.data.fields).filter((field) => field.primaryKey);
}

/** Build a relationship for an explicit FK without guessing from geometry. */
export function relationshipForForeignKey(page: DiagramDocument['pages'][number], sourceEntityId: string, fieldId: string): DiagramEdge | null {
  const source = page.nodes.find((node) => node.id === sourceEntityId && node.type === 'entity');
  if (!source) return null;
  const fields = normalizeEntityFields(source.data.fields);
  const field = fields.find((candidate) => candidate.id === fieldId && candidate.foreignKey && candidate.reference?.entityId);
  if (!field?.reference?.entityId) return null;
  const target = page.nodes.find((node) => node.id === field.reference?.entityId && node.type === 'entity');
  if (!target || target.id === source.id) return null;
  const targetFields = normalizeEntityFields(target.data.fields);
  const relatedFields = field.reference.constraintId
    ? fields.filter((candidate) => candidate.reference?.constraintId === field.reference?.constraintId && candidate.reference?.entityId === target.id)
    : [field];
  const relatedTargetFields = relatedFields
    .map((candidate) => targetFields.find((targetField) => targetField.id === candidate.reference?.fieldId))
    .filter((candidate): candidate is EntityField => Boolean(candidate));
  const targetField = targetFields.find((candidate) => candidate.id === field.reference?.fieldId) ?? targetFields.find((candidate) => candidate.primaryKey);
  const sourceFieldIds = relatedFields.map((candidate) => candidate.id);
  const targetFieldIds = relatedTargetFields.length > 0 ? relatedTargetFields.map((candidate) => candidate.id) : targetField ? [targetField.id] : [];
  return createEdge(
    { nodeId: source.id, port: 'right', anchorId: `field-${fields.indexOf(field)}-right`, offset: entityFieldPortOffset(fields, fields.indexOf(field), source.data.columnHeaders === true, source.size.height) },
    { nodeId: target.id, port: 'left', ...(targetField ? { anchorId: `field-${targetFields.indexOf(targetField)}-left` } : {}), ...(targetField ? { offset: entityFieldPortOffset(targetFields, targetFields.indexOf(targetField), target.data.columnHeaders === true, target.size.height) } : {}) },
    {
      type: 'orthogonal',
      style: { startMarker: relatedFields.some((candidate) => candidate.nullable) ? 'circle-bar' : 'bar', endMarker: 'bar-crowfoot' },
      data: { label: field.nullable ? '0..N : 0..1' : '1 : N', relationship: 'foreign-key', sourceFieldId: field.id, targetFieldId: targetField?.id, sourceFieldIds, targetFieldIds },
    },
  );
}

/** Add FK fields to the source side of a relationship when a schema has no
 * explicit field metadata yet. Existing fields are left untouched. */
export function foreignKeyForRelationship(document: DiagramDocument, pageId: string, edgeId: string): DiagramDocument {
  const next = structuredClone(document);
  const page = next.pages.find((candidate) => candidate.id === pageId);
  const edge = page?.edges.find((candidate) => candidate.id === edgeId);
  if (!page || !edge?.source.nodeId || !edge.target.nodeId) return next;
  const source = page.nodes.find((node) => node.id === edge.source.nodeId && node.type === 'entity');
  const target = page.nodes.find((node) => node.id === edge.target.nodeId && node.type === 'entity');
  if (!source || !target) return next;
  const sourceFields = normalizeEntityFields(source.data.fields);
  const targetFields = normalizeEntityFields(target.data.fields);
  const targetKeys = targetFields.filter((field) => field.primaryKey);
  if (targetKeys.length === 0) return next;
  const constraintId = typeof edge.data.constraintId === 'string' ? edge.data.constraintId : `fk_${edge.id}`;
  const fields = targetKeys.map((targetField) => createEntityField({
    name: `${slugify(String(target.data.label ?? 'entity'))}_${targetField.name}`,
    type: targetField.type,
    foreignKey: true,
    nullable: edge.style.startMarker === 'circle' || edge.style.startMarker === 'circle-bar' || edge.style.startMarker === 'circle-crowfoot',
    reference: { entityId: target.id, fieldId: targetField.id, constraintId, onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
  })).filter((field) => !sourceFields.some((existing) => existing.name.toLowerCase() === field.name.toLowerCase()));
  if (fields.length === 0) return next;
  source.data.fields = [...sourceFields, ...fields];
  source.size.height = entityAutoHeight(source.data.fields, source.data.entityVariant, source.data.columnHeaders === true);
  edge.data = { ...edge.data, relationship: 'foreign-key', constraintId, sourceFieldId: fields[0].id, targetFieldId: targetKeys[0].id, sourceFieldIds: fields.map((field) => field.id), targetFieldIds: targetKeys.map((field) => field.id) };
  return next;
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
    const tableNames = new Map<string, string>();
    entities.forEach((entity) => {
      const label = typeof entity.data.label === 'string' ? entity.data.label.trim() : '';
      if (!label) diagnostics.push({ severity: 'error', code: 'erd.missing-table-name', message: 'Entity is missing a table name.', pageId: page.id, nodeId: entity.id });
      const normalizedLabel = label.toLowerCase();
      if (normalizedLabel && tableNames.has(normalizedLabel)) diagnostics.push({ severity: 'error', code: 'erd.duplicate-table-name', message: `Table name “${label}” is used more than once.`, pageId: page.id, nodeId: entity.id });
      if (normalizedLabel) tableNames.set(normalizedLabel, entity.id);
      const fields = normalizeEntityFields(entity.data.fields);
      if (fields.length === 0) diagnostics.push({ severity: 'warning', code: 'erd.empty-entity', message: `${label || 'Entity'} has no attributes.`, pageId: page.id, nodeId: entity.id });
      const seen = new Set<string>();
      fields.forEach((field) => {
        const name = field.name.trim().toLowerCase();
        if (!name) diagnostics.push({ severity: 'error', code: 'erd.unnamed-attribute', message: `${label || 'Entity'} contains an unnamed attribute.`, pageId: page.id, nodeId: entity.id });
        if (seen.has(name)) diagnostics.push({ severity: 'error', code: 'erd.duplicate-attribute', message: `${label || 'Entity'} contains duplicate attribute “${field.name}”.`, pageId: page.id, nodeId: entity.id });
        seen.add(name);
        if (field.reference && !entityIds.has(field.reference.entityId)) diagnostics.push({ severity: 'error', code: 'erd.missing-reference-entity', message: `${label || 'Entity'} attribute “${field.name}” references a missing entity.`, pageId: page.id, nodeId: entity.id });
        if (field.reference && !field.foreignKey) diagnostics.push({ severity: 'warning', code: 'erd.reference-not-fk', message: `${label || 'Entity'} attribute “${field.name}” has a reference but is not marked FK.`, pageId: page.id, nodeId: entity.id });
        if (field.reference && entityIds.has(field.reference.entityId)) {
          const referencedEntity = entities.find((candidate) => candidate.id === field.reference?.entityId);
          const referencedFields = referencedEntity ? normalizeEntityFields(referencedEntity.data.fields) : [];
           if (field.reference.fieldId && !referencedFields.some((candidate) => candidate.id === field.reference?.fieldId)) diagnostics.push({ severity: 'error', code: 'erd.missing-reference-field', message: `${label || 'Entity'} attribute “${field.name}” references a missing attribute.`, pageId: page.id, nodeId: entity.id });
           const targetField = referencedFields.find((candidate) => candidate.id === field.reference?.fieldId);
           const targetHasSingleColumnUniqueIndex = targetField
             ? normalizeEntityIndexes(referencedEntity?.data.indexes, referencedFields).some((index) => index.unique && index.fieldIds.length === 1 && index.fieldIds[0] === targetField.id)
             : false;
           if (targetField && !targetField.primaryKey && !targetField.unique && !targetHasSingleColumnUniqueIndex) diagnostics.push({ severity: 'warning', code: 'erd.reference-not-key', message: `${label || 'Entity'} attribute “${field.name}” references an attribute that is not a key or unique.`, pageId: page.id, nodeId: entity.id });
        }
      });
      normalizeEntityIndexes(entity.data.indexes, fields).forEach((index) => {
        if (index.fieldIds.length === 0) diagnostics.push({ severity: 'warning', code: 'erd.empty-index', message: `${label || 'Entity'} contains an index with no attributes.`, pageId: page.id, nodeId: entity.id });
      });
    });
    page.edges.forEach((edge) => {
      if (!edge.source.nodeId || !edge.target.nodeId || !entityIds.has(edge.source.nodeId) || !entityIds.has(edge.target.nodeId)) diagnostics.push({ severity: 'warning', code: 'erd.invalid-relationship', message: 'ERD relationships should connect two entities.', pageId: page.id, edgeId: edge.id });
      if (edge.source.nodeId && edge.target.nodeId && edge.source.nodeId === edge.target.nodeId) diagnostics.push({ severity: 'error', code: 'erd.self-relationship', message: 'An ERD relationship must connect distinct entities.', pageId: page.id, edgeId: edge.id });
      const source = entities.find((node) => node.id === edge.source.nodeId);
      if (source && edge.data.sourceFieldId) {
        const field = normalizeEntityFields(source.data.fields).find((candidate) => candidate.id === edge.data.sourceFieldId);
        const optional = edge.style.startMarker === 'circle' || edge.style.startMarker === 'circle-bar' || edge.style.startMarker === 'circle-crowfoot';
        if (field && field.nullable !== optional) diagnostics.push({ severity: 'warning', code: 'erd.optionality-mismatch', message: `Relationship optionality does not match “${field.name}” nullability.`, pageId: page.id, edgeId: edge.id });
      }
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

export { exportErdSql, exportSql, importErdSql, parseErdSql } from './erdSql';
