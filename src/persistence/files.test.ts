import { describe, expect, it } from 'vitest';
import { createDocument, createNode, serializeProject } from '../core/document';
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
});
