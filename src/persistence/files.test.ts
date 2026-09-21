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
    expect(svg).toContain('M 0 0 L 11 -7');
  });
});
