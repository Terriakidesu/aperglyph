import { describe, expect, it } from 'vitest';
import { createDocument, createNode } from './document';
import { entityAutoHeight, entityColumns, entityFieldLabel, entityFieldPortOffset, entityFieldValue, normalizeEntityFields, parseEntityFields, parseErdSql, exportErdSql, validateErd } from './erd';

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

  it('imports and exports composite SQL keys, indexes, and referential actions', () => {
    const document = parseErdSql(`CREATE TABLE customers (id uuid PRIMARY KEY, region text PRIMARY KEY, email text UNIQUE);\nCREATE TABLE orders (customer_id uuid NOT NULL, customer_region text, CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id, customer_region) REFERENCES customers (id, region) ON DELETE CASCADE ON UPDATE RESTRICT);\nCREATE INDEX orders_email_idx ON orders (customer_id);`);
    const customers = document.pages[0].nodes.find((node) => node.data.label === 'customers');
    const orders = document.pages[0].nodes.find((node) => node.data.label === 'orders');
    expect(customers).toBeDefined();
    expect(normalizeEntityFields(customers!.data.fields).filter((field) => field.primaryKey)).toHaveLength(2);
    expect(normalizeEntityFields(orders!.data.fields).filter((field) => field.reference?.entityId === customers!.id)).toHaveLength(2);
    expect(document.pages[0].edges).toHaveLength(1);
    expect(exportErdSql(document)).toContain('ON DELETE CASCADE');
    expect(exportErdSql(document)).toContain('CREATE INDEX');
  });

  it('keeps composite unique constraints as indexes instead of column uniques', () => {
    const document = parseErdSql('CREATE TABLE memberships (tenant_id uuid, user_id uuid, CONSTRAINT memberships_unique UNIQUE (tenant_id, user_id));');
    const fields = normalizeEntityFields(document.pages[0].nodes[0].data.fields);
    expect(fields.every((field) => !field.unique)).toBe(true);
    expect(exportErdSql(document)).toContain('CREATE UNIQUE INDEX "memberships_unique"');
    expect(exportErdSql(document)).not.toContain('tenant_id" uuid UNIQUE');
  });
});
