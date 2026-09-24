import { describe, expect, it } from 'vitest';
import { createDocument, createEdge, createNode, serializeProject } from '../core/document';
import { contentBounds, documentToSvg, pageExportBounds, sanitizeSvg } from './files';

describe('native file helpers', () => {
  it('produces a self-contained SVG scene', () => {
    const document = createDocument('SVG test');
    document.pages[0].nodes.push(createNode('rectangle', { x: 30, y: 40 }));
    const svg = documentToSvg(document.pages[0].nodes, [], '#10131c', 800, 600);
    expect(svg).toContain('<svg');
    expect(svg).toContain('>rectangle</text>');
  });

  it('uses the centered canvas page coordinates for full-page export bounds', () => {
    expect(pageExportBounds(1600, 1000)).toEqual({ x: -800, y: -500, width: 1600, height: 1000 });
    expect(contentBounds([], [], 1600, 1000)).toEqual(pageExportBounds(1600, 1000));
    const node = createNode('rectangle', { x: -90, y: -44 });
    const svg = documentToSvg([node], [], '#10131c', 1600, 1000, { viewBox: pageExportBounds(1600, 1000) });
    expect(svg).toContain('viewBox="-800 -500 1600 1000"');
    expect(svg).toContain('translate(-90 -44)');
  });

  it('exports an ink-saving outline-only SVG suitable for printing', () => {
    const node = createNode('rectangle', { x: 30, y: 40 }, { style: { fill: '#2c2752', stroke: '#907bff', textColor: '#f4f5fa' } });
    const svg = documentToSvg([node], [], '#10131c', 800, 600, { outlineOnly: true });
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toContain('rgb(');
    expect(svg).not.toContain('#907bff');
    expect(svg).not.toContain('#f4f5fa');
  });

  it('serializes a native project for import/export', () => {
    const document = createDocument('Project');
    expect(serializeProject(document)).toContain('"format": "aperglyph"');
  });

  it('removes executable and remote SVG content while keeping the drawing', () => {
    const svg = sanitizeSvg('<svg onload="javascript:alert(1)"><script>alert(1)</script><animate attributeName="href" to="javascript:alert(2)"/><rect width="20" height="20" fill="red"/><image href="https://example.com/a.png" /></svg>');
    expect(svg).toContain('<rect');
    expect(svg).not.toMatch(/script|animate|onload|https?:/i);
    expect(() => sanitizeSvg('<html><script>alert(1)</script></html>')).toThrow(/valid SVG/);
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

  it('turns every endpoint notation with the connector tangent', () => {
    const edge = createEdge({ point: { x: 40, y: 80 } }, { point: { x: 300, y: 220 } }, { style: { startMarker: 'bar', endMarker: 'crowfoot' } });
    const svg = documentToSvg([], [edge], '#10131c', 400, 300);
    expect(svg).toContain('translate(40 80) rotate(28.30075576600638)');
    expect(svg).toContain('translate(300 220) rotate(-151.69924423399362)');
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
    expect(svg).toMatch(/Q (?:57 50 50 58|50 43 58 50)/);
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

  it('exports shared common silhouettes and metadata-driven Gane-Sarson DFD variants', () => {
    const documentNode = createNode('document', { x: 0, y: 0 }, { library: 'flowchart', data: { label: 'Report' } });
    const packageNode = createNode('package', { x: 220, y: 0 }, { library: 'use-case', data: { label: 'Billing' } });
    const process = createNode('process', { x: 0, y: 160 }, { library: 'dfd', size: { width: 140, height: 84 }, data: { label: 'Validate', number: '1.0', notation: 'gane-sarson' } });
    const store = createNode('store', { x: 220, y: 160 }, { library: 'dfd', size: { width: 160, height: 64 }, data: { label: 'Orders', notation: 'gane-sarson' } });
    const svg = documentToSvg([documentNode, packageNode, process, store], [], '#10131c', 600, 400);
    expect(svg).toContain('>Report</text>');
    expect(svg).toContain('>Billing</text>');
    expect(svg).toContain('>Validate</text>');
    expect(svg).toContain('>1.0</text>');
    expect(svg).toContain('M 18 0 H 160 V 64 H 18 Z');
  });

  it('keeps responsive actor geometry in exported SVG', () => {
    const small = createNode('actor', { x: 0, y: 0 }, { library: 'use-case', size: { width: 120, height: 140 }, data: { label: 'Small actor' } });
    const large = createNode('actor', { x: 180, y: 0 }, { library: 'use-case', size: { width: 180, height: 210 }, data: { label: 'Large actor' } });
    const svg = documentToSvg([small, large], [], '#10131c', 500, 300);
    expect(svg).toContain('cx="60" cy="28" rx="12" ry="12"');
    expect(svg).toContain('cx="90" cy="42" rx="18" ry="18"');
  });
});
