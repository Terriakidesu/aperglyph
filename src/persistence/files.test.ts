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
    expect(svg).toContain('M 0 0 L -11 -7');
  });

  it('orients end arrowheads into the target node', () => {
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 0 });
    const edge = createEdge({ nodeId: source.id }, { nodeId: target.id }, { style: { endMarker: 'arrow' } });
    const svg = documentToSvg([source, target], [edge], '#10131c', 800, 600);
    expect(svg).toContain('<g transform="translate(300 44) rotate(180)"><path d="M 0 0 L 10 -6 L 10 6 Z"');
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
});
