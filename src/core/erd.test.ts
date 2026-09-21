import { describe, expect, it } from 'vitest';
import { createDocument, createNode } from './document';
import { entityAutoHeight, entityColumns, entityFieldLabel, entityFieldPortOffset, entityFieldValue, normalizeEntityFields, parseEntityFields, validateErd } from './erd';

describe('ERD semantic model', () => {
  it('normalizes legacy compact attributes', () => {
    const fields = normalizeEntityFields(['id · uuid · PK', 'email · varchar · UQ · NN']);
    expect(fields[0]).toMatchObject({ name: 'id', type: 'uuid', primaryKey: true, nullable: true });
    expect(fields[1]).toMatchObject({ unique: true, nullable: false });
    expect(entityFieldLabel(fields[0])).toContain('PK');
  });

  it('reports duplicate ERD attributes', () => {
    const document = createDocument('Accounts', 'erd');
    const entity = createNode('entity', { x: 0, y: 0 }, { data: { label: 'users', fields: ['id · uuid', 'id · uuid'] } });
    document.pages[0].nodes.push(entity);
    expect(validateErd(document).some((diagnostic) => diagnostic.message.includes('duplicate'))).toBe(true);
  });

  it('fits an entity to its current row count', () => {
    expect(entityAutoHeight(['id · uuid', 'name · varchar'])).toBe(88);
    expect(entityAutoHeight(['id · uuid', 'name · varchar', 'created · date'])).toBe(115);
    expect(entityAutoHeight([])).toBe(61);
  });

  it('supports selectable entity column variants and row anchors', () => {
    expect(entityColumns('key-field', 230).map((column) => column.id)).toEqual(['key', 'field']);
    expect(entityColumns('key-field-type', 230).map((column) => column.id)).toEqual(['key', 'field', 'type']);
    const field = normalizeEntityFields(['id · uuid · PK · NN'])[0];
    expect(entityFieldValue(field, 'key')).toBe('PK');
    expect(entityFieldValue(field, 'field')).toBe('id');
    expect(entityFieldValue(field, 'type')).toBe('uuid');
    expect(entityFieldPortOffset(['id · uuid', 'name · varchar'], 1)).toBeCloseTo(74.5 / 88);
    expect(entityAutoHeight(['id · uuid', 'name · varchar'], 'key-field', true)).toBe(109);
  });

  it('parses pasted attributes with compact flags', () => {
    const fields = parseEntityFields('id uuid PK NN\ncustomer_id uuid FK\nemail varchar UQ');
    expect(fields).toMatchObject([
      { name: 'id', type: 'uuid', primaryKey: true, nullable: false },
      { name: 'customer_id', type: 'uuid', foreignKey: true },
      { name: 'email', type: 'varchar', unique: true },
    ]);
  });

  it('validates explicit foreign-key references', () => {
    const document = createDocument('Accounts', 'erd');
    const entity = createNode('entity', { x: 0, y: 0 }, { data: { label: 'users', fields: [{ name: 'account_id', type: 'uuid', foreignKey: true, reference: { entityId: 'missing' } }] } });
    document.pages[0].nodes.push(entity);
    expect(validateErd(document).some((diagnostic) => diagnostic.message.includes('references a missing entity'))).toBe(true);
  });
});
