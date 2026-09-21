import { describe, expect, it } from 'vitest';
import { createDocument, createEdge, createNode, serializeProject } from '../core/document';
import { documentToSvg } from './files';

describe('native file helpers', () => {
  it('produces a self-contained SVG scene', () => {
    const document = createDocument('SVG test');
    document.pages[0].nodes.push(createNode('rectangle', { x: 30, y: 40 }));
    const svg = documentToSvg(document.pages[0].nodes, [], '#10131c', 800, 600);
    expect(svg).toContain('<svg');
    expect(svg).toContain('>rectangle</text>');
  });

  it('serializes a native project for import/export', () => {
    const document = createDocument('Project');
    expect(serializeProject(document)).toContain('"format": "aperglyph"');
  });

  it('exports cardinality markers with the connector geometry', () => {
    const source = createNode('entity', { x: 0, y: 0 });
    const target = createNode('entity', { x: 300, y: 0 });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal', style: { startMarker: 'bar', endMarker: 'crowfoot' } });
    const svg = documentToSvg([source, target], [edge], '#10131c', 800, 600);
    expect(svg).toContain('M 0 -7 L 0 7');
    expect(svg).toContain('M 11 0 L 0 -7');
  });

  it('keeps combined cardinality symbols outside the entity boundary', () => {
    const edge = createEdge({ point: { x: 40, y: 80 } }, { point: { x: 300, y: 80 } }, { style: { startMarker: 'bar-crowfoot', endMarker: 'circle-crowfoot' } });
    const svg = documentToSvg([], [edge], '#10131c', 400, 200);
    expect(svg).toContain('M 16 -7 L 16 7');
    expect(svg).toContain('cx="18" cy="0" r="6"');
    expect(svg).toContain('M 11 0 L 0 -7 M 11 0 L 0 0 M 11 0 L 0 7');
  });

  it('orients end arrowheads into the target node', () => {
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 0 });
    const edge = createEdge({ nodeId: source.id }, { nodeId: target.id }, { style: { endMarker: 'arrow' } });
    const svg = documentToSvg([source, target], [edge], '#10131c', 800, 600);
    expect(svg).toContain('<g transform="translate(300 44) rotate(180)"><path d="M 0 0 L 10 -6 L 10 6 Z"');
  });

  it('turns straight arrowheads along the line direction', () => {
    const edge = createEdge({ point: { x: 40, y: 80 } }, { point: { x: 300, y: 220 } }, { style: { endMarker: 'arrow' } });
    const svg = documentToSvg([], [edge], '#10131c', 400, 300);
    expect(svg).toContain('translate(300 220) rotate(-151.69924423399362)');
  });

  it('keeps start arrowheads pointed into the connector', () => {
    const edge = createEdge({ point: { x: 40, y: 80 } }, { point: { x: 300, y: 220 } }, { style: { startMarker: 'arrow', endMarker: 'none' } });
    const svg = documentToSvg([], [edge], '#10131c', 400, 300);
    expect(svg).toContain('translate(40 80) rotate(28.30075576600638)');
  });

  it('rotates attached straight arrowheads with a diagonal connector tangent', () => {
    const source = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 100, height: 50 } });
    const target = createNode('rectangle', { x: 300, y: 200 }, { size: { width: 100, height: 50 } });
    const edge = createEdge({ nodeId: source.id }, { nodeId: target.id }, { style: { endMarker: 'arrow' } });
    const svg = documentToSvg([source, target], [edge], '#10131c', 500, 400);
    expect(svg).toContain('translate(312.5 200) rotate(-146.30993247402023)');
  });

  it('exports bridge jumps where orthogonal connectors cross', () => {
    const horizontal = createEdge({ point: { x: 0, y: 50 } }, { point: { x: 100, y: 50 } }, { type: 'orthogonal' });
    const vertical = createEdge({ point: { x: 50, y: 0 } }, { point: { x: 50, y: 100 } }, { type: 'orthogonal' });
    const svg = documentToSvg([], [horizontal, vertical], '#10131c', 160, 160);
    expect(svg).toContain('Q 57 50 50 58');
    expect(svg).toContain('stroke="#10131c"');
  });

  it('exports standard ERD key columns and standard DFD/UML silhouettes', () => {
    const entity = createNode('entity', { x: 0, y: 0 }, {
      library: 'erd',
      data: { label: 'Users', fields: [{ id: 'id', name: 'UserID', type: 'uuid', primaryKey: true, foreignKey: false, unique: false, nullable: false }] },
    });
    const process = createNode('process', { x: 300, y: 0 }, { library: 'dfd', size: { width: 120, height: 120 }, data: { label: 'Process' } });
    const store = createNode('store', { x: 500, y: 0 }, { library: 'dfd', size: { width: 160, height: 64 }, data: { label: 'Store' } });
    const useCase = createNode('use-case', { x: 0, y: 180 }, { library: 'use-case', size: { width: 180, height: 72 }, data: { label: 'Use case' } });
    const svg = documentToSvg([entity, process, store, useCase], [], '#10131c', 800, 600);
    expect(svg).toContain('>PK</text>');
    expect(svg).toContain('text-decoration="underline"');
    expect(svg).toContain('<ellipse cx="60" cy="60" rx="60" ry="60"');
    expect(svg).toContain('<line x1="0" y1="10" x2="160" y2="10"');
    expect(svg).toContain('<ellipse cx="90" cy="36" rx="90" ry="36"');
  });

  it('exports the selected ERD column variant and optional headings', () => {
    const entity = createNode('entity', { x: 0, y: 0 }, {
      library: 'erd',
      size: { width: 230, height: 109 },
      data: { label: 'Users', entityVariant: 'key-field', columnHeaders: true, fields: ['id · uuid · PK'] },
    });
    const svg = documentToSvg([entity], [], '#10131c', 400, 300);
    expect(svg).toContain('>Key</text>');
    expect(svg).toContain('>Field</text>');
    expect(svg).not.toContain('>Data type</text>');
  });
});
