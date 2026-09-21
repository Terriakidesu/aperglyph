import { describe, expect, it } from 'vitest';
import { createDocument, createEdge, createNode, migrateDocument, parseProject, serializeProject, validateProjectDocument } from './document';
import { createTemplateDocument } from './templates';

describe('AperGlyph document model', () => {
  it('creates a versioned document with a page', () => {
    const document = createDocument('Architecture map', 'flowchart');
    expect(document.schemaVersion).toBe(1);
    expect(document.pages).toHaveLength(1);
    expect(document.diagramType).toBe('flowchart');
  });

  it('keeps a blank general template empty', () => {
    const document = createTemplateDocument('Blank', 'general');
    expect(document.pages[0].nodes).toHaveLength(0);
    expect(document.pages[0].edges).toHaveLength(0);
  });

  it('round trips a project through the native file format', () => {
    const document = createDocument('Round trip');
    document.pages[0].nodes.push(createNode('process', { x: 120, y: 80 }));
    const parsed = parseProject(serializeProject(document));
    expect(parsed.id).toBe(document.id);
    expect(parsed.pages[0].nodes[0].position).toEqual({ x: 120, y: 80 });
  });

  it('round trips free connector endpoints', () => {
    const document = createDocument('Free endpoint');
    const target = createNode('rectangle', { x: 300, y: 120 });
    document.pages[0].nodes.push(target);
    document.pages[0].edges.push({
      ...createEdge({ point: { x: 80, y: 90 } }, { nodeId: target.id }),
      waypoints: [{ x: 180, y: 90 }],
    });
    const parsed = parseProject(serializeProject(document));
    expect(parsed.pages[0].edges[0].source).toEqual({ point: { x: 80, y: 90 } });
  });

  it('repairs stale free points when an endpoint is attached to a node', () => {
    const document = createDocument('Attached endpoint');
    const source = createNode('entity', { x: 0, y: 0 });
    const target = createNode('entity', { x: 400, y: 0 });
    document.pages[0].nodes.push(source, target);
    document.pages[0].edges.push({
      ...createEdge({ nodeId: source.id, port: 'right', point: { x: 250, y: 44 } }, { nodeId: target.id, port: 'left', point: { x: 150, y: 44 } }),
    });
    const migrated = migrateDocument(document);
    expect(migrated.pages[0].edges[0].source.point).toBeUndefined();
    expect(migrated.pages[0].edges[0].target.point).toBeUndefined();
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

  it('converts legacy ERD arrow defaults to standard relationship markers', () => {
    const document = createDocument('Legacy ERD', 'erd');
    const source = createNode('entity', { x: 0, y: 0 });
    const target = createNode('entity', { x: 300, y: 0 });
    document.pages[0].nodes.push(source, target);
    document.pages[0].edges.push({
      id: 'edge_erd_legacy', type: 'orthogonal', source: { nodeId: source.id }, target: { nodeId: target.id }, waypoints: [],
      style: { stroke: '#888', strokeWidth: 1, dash: 'solid', startMarker: 'none', endMarker: 'arrow', labelColor: '#888' }, data: {},
    });
    const migrated = migrateDocument(document);
    expect(migrated.pages[0].edges[0].style.startMarker).toBe('bar');
    expect(migrated.pages[0].edges[0].style.endMarker).toBe('crowfoot');
  });

  it('rejects malformed imported geometry and endpoint references', () => {
    const document = createDocument('Unsafe');
    const raw = JSON.parse(serializeProject(document)) as Record<string, unknown>;
    const nested = raw.document as Record<string, unknown>;
    const pages = nested.pages as Array<Record<string, unknown>>;
    const page = pages[0];
    page.nodes = [{ ...(document.pages[0].nodes[0] ?? createNode('rectangle', { x: 0, y: 0 })), id: 'node_a', position: { x: Infinity, y: 0 } }];
    page.edges = [{ id: 'edge_a', type: 'straight', source: { nodeId: 'node_a' }, target: { nodeId: 'missing' }, waypoints: [], style: { stroke: '#fff', strokeWidth: 1, dash: 'solid', startMarker: 'none', endMarker: 'arrow', labelColor: '#fff' }, data: {} }];
    expect(validateProjectDocument(nested).some((message) => message.includes('finite'))).toBe(true);
    expect(validateProjectDocument(nested).some((message) => message.includes('missing node'))).toBe(true);
    expect(() => parseProject(JSON.stringify({ format: 'aperglyph', formatVersion: 1, document: nested }))).toThrow(/Invalid AperGlyph project/);
  });
});
