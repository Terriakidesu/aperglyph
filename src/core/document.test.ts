import { describe, expect, it } from 'vitest';
import { createDocument, createNode, migrateDocument, parseProject, serializeProject } from './document';

describe('AperGlyph document model', () => {
  it('creates a versioned document with a page', () => {
    const document = createDocument('Architecture map', 'flowchart');
    expect(document.schemaVersion).toBe(1);
    expect(document.pages).toHaveLength(1);
    expect(document.diagramType).toBe('flowchart');
  });

  it('round trips a project through the native file format', () => {
    const document = createDocument('Round trip');
    document.pages[0].nodes.push(createNode('process', { x: 120, y: 80 }));
    const parsed = parseProject(serializeProject(document));
    expect(parsed.id).toBe(document.id);
    expect(parsed.pages[0].nodes[0].position).toEqual({ x: 120, y: 80 });
  });

  it('rejects unrelated JSON', () => {
    expect(() => parseProject('{"hello":"world"}')).toThrow();
  });

  it('anchors legacy orthogonal connectors to stable ports during migration', () => {
    const document = createDocument('Anchored');
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 0 });
    document.pages[0].nodes.push(source, target);
    document.pages[0].edges.push({
      id: 'edge_legacy', type: 'orthogonal', source: { nodeId: source.id }, target: { nodeId: target.id }, waypoints: [],
      style: { stroke: '#888', strokeWidth: 1, dash: 'solid', startMarker: 'none', endMarker: 'arrow', labelColor: '#888' }, data: {},
    });
    const migrated = migrateDocument(document);
    expect(migrated.pages[0].edges[0].source.port).toBe('right');
    expect(migrated.pages[0].edges[0].target.port).toBe('left');
  });
});
