import { createDocument, createEdge, createNode } from './document';
import { entityAutoHeight, normalizeEntityFields, normalizeEntityIndexes, type EntityField, type EntityIndex } from './erd';
import type { DiagramDocument, DiagramNode } from './types';

const MAX_SQL_LENGTH = 10 * 1024 * 1024;
const MAX_SQL_TABLES = 50000;
const MAX_SQL_INDEXES = 100000;
const SQL_IDENTIFIER = '(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*)';
const QUALIFIED_IDENTIFIER = `${SQL_IDENTIFIER}(?:\\s*\\.\\s*${SQL_IDENTIFIER})*`;

/** A bounded, dependency-free SQL schema interchange for ERD documents. */
export function parseErdSql(sql: string, name = 'Imported SQL schema'): DiagramDocument {
  if (sql.length > MAX_SQL_LENGTH) throw new Error('This SQL schema is too large to import safely.');
  const source = stripSqlComments(sql);
  const document = createDocument(name, 'erd');
  const page = document.pages[0];
  const tableEntries = parseCreateTables(source);
  const standaloneIndexes = parseCreateIndexes(source);
  if (tableEntries.length > MAX_SQL_TABLES || standaloneIndexes.length > MAX_SQL_INDEXES) throw new Error('This SQL schema contains too many tables or indexes.');
  const tables = new Map<string, DiagramNode>();
  const pendingReferences: Array<{ source: DiagramNode; reference: ParsedReference }> = [];

  tableEntries.forEach((entry, index) => {
    const parsed = parseTableBody(entry.body);
    const node = createNode('entity', { x: (index % 4) * 330 - 420, y: Math.floor(index / 4) * 260 - 180 }, {
      library: 'erd',
      size: { width: 250, height: entityAutoHeight(parsed.fields, 'key-field-type', false) },
      data: { label: entry.name, fields: parsed.fields, indexes: parsed.indexes, striped: true, headerFill: '#272147' },
    });
    page.nodes.push(node);
    addTableAliases(tables, entry.name, node);
    parsed.references.forEach((reference) => pendingReferences.push({ source: node, reference }));
  });

  // Explicit CREATE INDEX statements are kept separate from foreign-key
  // metadata. A database may choose not to index a foreign key, and silently
  // inventing indexes changes the imported schema.
  standaloneIndexes.forEach((index) => {
    const table = findTable(tables, index.tableName);
    if (!table) return;
    const fields = normalizeEntityFields(table.data.fields);
    const fieldIds = index.fieldNames
      .map((fieldName) => fields.find((field) => sameIdentifier(field.name, fieldName))?.id)
      .filter((fieldId): fieldId is string => Boolean(fieldId));
    if (fieldIds.length === 0) return;
    const indexes = normalizeEntityIndexes(table.data.indexes, fields);
    if (!indexes.some((candidate) => candidate.name.toLowerCase() === index.name.toLowerCase())) {
      table.data.indexes = [...indexes, { id: `index_${slug(index.name)}`, name: index.name, fieldIds, unique: index.unique }];
    }
  });

  pendingReferences.forEach(({ source, reference }) => {
    const target = findTable(tables, reference.targetName);
    if (!target) return;
    const sourceFields = normalizeEntityFields(source.data.fields);
    const targetFields = normalizeEntityFields(target.data.fields);
    const targetNames = reference.targetFields.length > 0
      ? reference.targetFields
      : targetFields.filter((field) => field.primaryKey).map((field) => field.name);
    const sourceFieldIds: string[] = [];
    const targetFieldIds: string[] = [];
    reference.fieldNames.forEach((fieldName, index) => {
      const field = sourceFields.find((candidate) => sameIdentifier(candidate.name, fieldName));
      const targetField = targetFields.find((candidate) => sameIdentifier(candidate.name, targetNames[index] ?? ''))
        ?? targetFields.find((candidate) => candidate.primaryKey && targetFieldIds.length === 0);
      if (!field || !targetField) return;
      field.foreignKey = true;
      field.reference = {
        entityId: target.id,
        fieldId: targetField.id,
        ...(reference.constraintId ? { constraintId: reference.constraintId } : {}),
        onDelete: normalizeAction(reference.onDelete),
        onUpdate: normalizeAction(reference.onUpdate),
      };
      sourceFieldIds.push(field.id);
      targetFieldIds.push(targetField.id);
    });
    if (sourceFieldIds.length === 0) return;
    source.data.fields = sourceFields;
    source.size.height = entityAutoHeight(sourceFields, source.data.entityVariant, source.data.columnHeaders === true);
    const firstSource = sourceFields.find((field) => field.id === sourceFieldIds[0]);
    const firstTarget = targetFields.find((field) => field.id === targetFieldIds[0]);
    page.edges.push(createEdge(
      { nodeId: source.id, port: 'right' },
      { nodeId: target.id, port: 'left' },
      {
        type: 'orthogonal',
        style: { startMarker: firstSource?.nullable ? 'circle-bar' : 'bar', endMarker: 'bar-crowfoot' },
        data: {
          label: firstSource?.nullable ? '0..N : 0..1' : '1 : N',
          relationship: 'foreign-key',
          sourceFieldId: firstSource?.id,
          targetFieldId: firstTarget?.id,
          sourceFieldIds,
          targetFieldIds,
          ...(reference.constraintId ? { constraintId: reference.constraintId } : {}),
        },
      },
    ));
  });

  document.updatedAt = Date.now();
  return document;
}

export function exportErdSql(document: DiagramDocument, pageId = document.pages[0]?.id): string {
  const page = document.pages.find((candidate) => candidate.id === pageId) ?? document.pages[0];
  if (!page) return '';
  const entities = page.nodes.filter((node) => node.type === 'entity');
  const entityById = new Map(entities.map((node) => [node.id, node]));
  const tables = entities.map((entity) => {
    const tableName = String(entity.data.label ?? entity.id);
    const fields = normalizeEntityFields(entity.data.fields);
    const lines = fields.map((field) => `  ${identifier(field.name)} ${sqlType(field.type)}${field.nullable ? '' : ' NOT NULL'}${field.unique ? ' UNIQUE' : ''}${field.defaultValue ? ` DEFAULT ${safeDefault(field.defaultValue)}` : ''}`);
    const primary = fields.filter((field) => field.primaryKey).map((field) => identifier(field.name));
    if (primary.length > 0) lines.push(`  PRIMARY KEY (${primary.join(', ')})`);

    const foreignKeys = groupForeignKeys(fields, entityById);
    foreignKeys.forEach((foreignKey) => {
      const target = entityById.get(foreignKey.entityId);
      if (!target) return;
      const targetFields = normalizeEntityFields(target.data.fields);
      const pairs = foreignKey.fields
        .map((entry) => ({ source: entry.field, target: targetFields.find((candidate) => candidate.id === entry.reference.fieldId) }))
        .filter((pair): pair is { source: EntityField; target: EntityField } => Boolean(pair.target));
      if (pairs.length === 0) return;
      const constraint = foreignKey.constraintId ? `CONSTRAINT ${identifier(foreignKey.constraintId)} ` : '';
      const actions = `${sqlAction('ON DELETE', foreignKey.onDelete)}${sqlAction('ON UPDATE', foreignKey.onUpdate)}`;
      lines.push(`  ${constraint}FOREIGN KEY (${pairs.map((pair) => identifier(pair.source.name)).join(', ')}) REFERENCES ${identifier(String(target.data.label ?? target.id))} (${pairs.map((pair) => identifier(pair.target.name)).join(', ')})${actions}`);
    });

    return `CREATE TABLE ${identifier(tableName)} (\n${lines.join(',\n')}\n);`;
  });
  const indexes = entities.flatMap((entity) => {
    const fields = normalizeEntityFields(entity.data.fields);
    return normalizeEntityIndexes(entity.data.indexes, fields).flatMap((index) => {
      const indexFields = index.fieldIds.map((fieldId) => fields.find((field) => field.id === fieldId)?.name).filter((value): value is string => Boolean(value));
      if (indexFields.length === 0) return [];
      return [`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${identifier(index.name)} ON ${identifier(String(entity.data.label ?? entity.id))} (${indexFields.map(identifier).join(', ')});`];
    });
  });
  return [...tables, ...indexes].join('\n\n');
}

export const importErdSql = parseErdSql;
export const exportSql = exportErdSql;

interface ParsedTableEntry { name: string; body: string }
interface ParsedReference {
  fieldNames: string[];
  targetName: string;
  targetFields: string[];
  constraintId?: string;
  onDelete?: string;
  onUpdate?: string;
}
interface ParsedTable { fields: EntityField[]; indexes: EntityIndex[]; references: ParsedReference[] }
interface ParsedIndex { name: string; tableName: string; fieldNames: string[]; unique: boolean }

function parseCreateTables(sql: string): ParsedTableEntry[] {
  const entries: ParsedTableEntry[] = [];
  const pattern = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(${QUALIFIED_IDENTIFIER})\\s*\\(`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql))) {
    const openIndex = pattern.lastIndex - 1;
    const closeIndex = matchingParenthesis(sql, openIndex);
    if (closeIndex < 0) break;
    entries.push({ name: unquoteQualifiedIdentifier(match[1]), body: sql.slice(openIndex + 1, closeIndex) });
    pattern.lastIndex = closeIndex + 1;
  }
  return entries;
}

function parseCreateIndexes(sql: string): ParsedIndex[] {
  const indexes: ParsedIndex[] = [];
  const pattern = new RegExp(`create\\s+(unique\\s+)?index\\s+(?:if\\s+not\\s+exists\\s+)?(${QUALIFIED_IDENTIFIER})\\s+on\\s+(${QUALIFIED_IDENTIFIER})\\s*\\(([^)]*)\\)`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql))) {
    indexes.push({ name: unquoteQualifiedIdentifier(match[2]), tableName: unquoteQualifiedIdentifier(match[3]), fieldNames: splitIdentifiers(match[4]), unique: Boolean(match[1]) });
  }
  return indexes;
}

function parseTableBody(body: string): ParsedTable {
  const fields: EntityField[] = [];
  const indexes: Array<EntityIndex & { fieldNames?: string[] }> = [];
  const references: ParsedReference[] = [];
  const primaryNames = new Set<string>();
  let constraintNumber = 0;

  splitTopLevel(body).forEach((part) => {
    const text = part.trim();
    if (!text) return;

    const primary = text.match(new RegExp(`^(?:constraint\\s+(${SQL_IDENTIFIER})\\s+)?primary\\s+key\\s*\\(([^)]+)\\)`, 'i'));
    if (primary) {
      splitIdentifiers(primary[2]).forEach((name) => primaryNames.add(name.toLowerCase()));
      return;
    }
    const unique = text.match(new RegExp(`^(?:constraint\\s+(${SQL_IDENTIFIER})\\s+)?unique(?:\\s+(?:key|index)(?:\\s+(${SQL_IDENTIFIER}))?)?\\s*\\(([^)]+)\\)`, 'i'));
    if (unique) {
      const fieldNames = splitIdentifiers(unique[3]);
      indexes.push({ id: `index_unique_${indexes.length}`, name: unique[1] ? unquoteIdentifier(unique[1]) : unique[2] ? unquoteIdentifier(unique[2]) : `unique_${indexes.length + 1}`, fieldIds: [], unique: true });
      indexes.at(-1)!.fieldNames = fieldNames;
      return;
    }
    const foreign = text.match(new RegExp(`^(?:constraint\\s+(${SQL_IDENTIFIER})\\s+)?foreign\\s+key\\s*\\(([^)]+)\\)\\s*references\\s+(${QUALIFIED_IDENTIFIER})\\s*\\(([^)]+)\\)([\\s\\S]*)$`, 'i'));
    if (foreign) {
      references.push({
        fieldNames: splitIdentifiers(foreign[2]),
        targetName: unquoteQualifiedIdentifier(foreign[3]),
        targetFields: splitIdentifiers(foreign[4]),
        constraintId: foreign[1] ? unquoteIdentifier(foreign[1]) : `fk_${constraintNumber++}`,
        onDelete: actionFromTail(foreign[5], 'delete'),
        onUpdate: actionFromTail(foreign[5], 'update'),
      });
      return;
    }

    const column = text.match(new RegExp(`^(${SQL_IDENTIFIER})\\s+([\\s\\S]+)$`, 'i'));
    if (!column || /^(?:check|constraint|index|exclude)\\b/i.test(text)) return;
    const name = unquoteIdentifier(column[1]);
    const definition = column[2].trim();
    const type = columnType(definition);
    const tail = definition.slice(type.length).trim();
    const field: EntityField = {
      id: `field_${fields.length}_${slug(name)}`,
      name,
      type: type || 'varchar',
      primaryKey: /\bprimary\s+key\b/i.test(tail),
      foreignKey: /\bforeign\s+key\b/i.test(tail),
      unique: /\bunique\b/i.test(tail),
      nullable: !/\bnot\s+null\b/i.test(tail),
      ...(defaultValue(tail) ? { defaultValue: defaultValue(tail) } : {}),
    };
    fields.push(field);
    const inlineReference = tail.match(new RegExp(`\\breferences\\s+(${QUALIFIED_IDENTIFIER})(?:\\s*\\(([^)]+)\\))?([\\s\\S]*)`, 'i'));
    if (inlineReference) {
      field.foreignKey = true;
      references.push({
        fieldNames: [name],
        targetName: unquoteQualifiedIdentifier(inlineReference[1]),
        targetFields: inlineReference[2] ? splitIdentifiers(inlineReference[2]) : [],
        constraintId: `fk_${slug(name)}`,
        onDelete: actionFromTail(inlineReference[3], 'delete'),
        onUpdate: actionFromTail(inlineReference[3], 'update'),
      });
    }
  });

  fields.forEach((field) => {
    if (primaryNames.has(field.name.toLowerCase())) field.primaryKey = true;
  });
  indexes.forEach((index) => {
    const names = index.fieldNames ?? [];
    index.fieldIds = names.flatMap((name) => fields.filter((field) => sameIdentifier(field.name, name)).map((field) => field.id));
    delete index.fieldNames;
  });
  return { fields, indexes: indexes.filter((index) => index.fieldIds.length > 0), references };
}

function groupForeignKeys(fields: EntityField[], entities: Map<string, DiagramNode>): Array<{ entityId: string; constraintId?: string; onDelete?: string; onUpdate?: string; fields: Array<{ field: EntityField; reference: NonNullable<EntityField['reference']> }> }> {
  const groups = new Map<string, { entityId: string; constraintId?: string; onDelete?: string; onUpdate?: string; fields: Array<{ field: EntityField; reference: NonNullable<EntityField['reference']> }> }>();
  fields.forEach((field) => {
    const reference = field.reference;
    if (!reference || !entities.has(reference.entityId)) return;
    const key = `${reference.entityId}:${reference.constraintId ?? reference.fieldId ?? field.id}`;
    const group = groups.get(key) ?? { entityId: reference.entityId, constraintId: reference.constraintId, onDelete: reference.onDelete, onUpdate: reference.onUpdate, fields: [] };
    group.fields.push({ field, reference });
    groups.set(key, group);
  });
  return [...groups.values()];
}

function addTableAliases(tables: Map<string, DiagramNode>, name: string, node: DiagramNode): void {
  const normalized = canonicalIdentifier(name);
  tables.set(normalized, node);
  const last = splitQualifiedIdentifier(name).at(-1);
  if (last) tables.set(canonicalIdentifier(last), node);
}

function findTable(tables: Map<string, DiagramNode>, name: string): DiagramNode | undefined {
  return tables.get(canonicalIdentifier(name)) ?? tables.get(canonicalIdentifier(splitQualifiedIdentifier(name).at(-1) ?? name));
}

function columnType(definition: string): string {
  let depth = 0;
  let quote = '';
  for (let index = 0; index < definition.length; index += 1) {
    const character = definition[index];
    if (quote) {
      if (character === quote && definition[index + 1] === quote) { index += 1; continue; }
      if (character === quote) quote = '';
      continue;
    }
    if (character === '`' || character === '"' || character === "'") { quote = character; continue; }
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (depth === 0 && /\s/.test(character)) {
      const rest = definition.slice(index).trimStart();
      if (/^(?:not\s+null|primary\s+key|foreign\s+key|unique|default|references|check|constraint|collate|generated|comment)\b/i.test(rest)) return definition.slice(0, index).trim();
    }
  }
  return definition.trim();
}

function defaultValue(tail: string): string | undefined {
  return tail.match(/\bdefault\s+(.+?)(?=\s+(?:not\s+null|primary|unique|references|constraint|check|collate|generated|comment)\b|$)/i)?.[1]?.trim();
}

function matchingParenthesis(value: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let index = open; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) { index += 1; continue; }
      if (character === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '`' || character === '"' || character === "'") { quote = character; continue; }
    if (character === '(') depth += 1;
    if (character === ')' && --depth === 0) return index;
  }
  return -1;
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) { index += 1; continue; }
      if (character === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '`' || character === '"' || character === "'") { quote = character; continue; }
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) { parts.push(value.slice(start, index)); start = index + 1; }
  }
  parts.push(value.slice(start));
  return parts;
}

function splitIdentifiers(value: string): string[] { return splitTopLevel(value).map((part) => unquoteQualifiedIdentifier(part.trim())).filter(Boolean); }

function splitQualifiedIdentifier(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) { index += 1; continue; }
      if (character === quote) quote = '';
    } else if (character === '`' || character === '"' || character === '[') quote = character === '[' ? ']' : character;
    else if (character === '.') { parts.push(value.slice(start, index).trim()); start = index + 1; }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function unquoteIdentifier(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('`') && trimmed.endsWith('`')) || (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) return trimmed.slice(1, -1).replace(/""/g, '"');
  return trimmed;
}

function unquoteQualifiedIdentifier(value: string): string { return splitQualifiedIdentifier(value).map(unquoteIdentifier).join('.'); }
function canonicalIdentifier(value: string): string { return unquoteQualifiedIdentifier(value).toLowerCase(); }
function sameIdentifier(left: string, right: string): boolean { return canonicalIdentifier(left) === canonicalIdentifier(right); }
function identifier(value: string): string { return splitQualifiedIdentifier(value).map((part) => `"${unquoteIdentifier(part).replace(/"/g, '""')}"`).join('.'); }
function slug(value: string): string { return canonicalIdentifier(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field'; }
function sqlType(value: string): string { return value.trim().replace(/[^\w() ,.[\]-]/g, '') || 'varchar'; }
function safeDefault(value: string): string { return value.replace(/[;\u0000-\u001f]/g, '').trim(); }
function actionFromTail(tail: string, kind: 'delete' | 'update'): string | undefined { return tail.match(new RegExp(`on\\s+${kind}\\s+(cascade|restrict|set\\s+null|no\\s+action)`, 'i'))?.[1]?.toUpperCase(); }
function normalizeAction(value: string | undefined): 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION' { return value === 'CASCADE' || value === 'RESTRICT' || value === 'SET NULL' || value === 'NO ACTION' ? value : 'NO ACTION'; }
function sqlAction(prefix: string, value: string | undefined): string { return value ? ` ${prefix} ${value}` : ''; }

function stripSqlComments(value: string): string {
  let output = '';
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (quote) {
      output += character;
      if (character === quote && next === quote) { output += next; index += 1; continue; }
      if (character === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '`' || character === '"' || character === "'") { quote = character; output += character; continue; }
    if (character === '-' && next === '-') {
      while (index < value.length && value[index] !== '\n') index += 1;
      output += '\n';
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (index < value.length && !(value[index] === '*' && value[index + 1] === '/')) index += 1;
      index += 1;
      output += ' ';
      continue;
    }
    output += character;
  }
  return output;
}
