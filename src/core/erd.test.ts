import { describe, expect, it } from 'vitest';
import { createDocument, createNode } from './document';
import { entityFieldLabel, normalizeEntityFields, validateErd } from './erd';

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
});
