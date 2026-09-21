import { describe, expect, it } from 'vitest';
import { parseShapeDrop, serializeShapeDrop } from './shapeTransfer';

describe('shape drag transfer', () => {
  it('round trips a shape payload', () => {
    const raw = serializeShapeDrop('erd', {
      id: 'entity',
      type: 'entity',
      label: 'Entity',
      icon: 'table',
      defaultSize: { width: 230, height: 88 },
      defaultData: { label: 'table_name' },
    });
    expect(parseShapeDrop({ getData: (type) => type === 'application/x-aperglyph-shape' ? raw : '' })).toMatchObject({
      libraryId: 'erd',
      type: 'entity',
      defaultSize: { width: 230, height: 88 },
    });
  });

  it('rejects malformed external drag data', () => {
    expect(parseShapeDrop({ getData: () => '{"type":"rectangle"}' })).toBeNull();
  });
});
