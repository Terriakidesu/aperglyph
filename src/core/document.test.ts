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

  it('round trips orthogonal routing intent without persisting a generated route', () => {
    const document = createDocument('Routing intent');
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 0 });
    document.pages[0].nodes.push(source, target);
    document.pages[0].edges.push(createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, {
      type: 'orthogonal',
      routing: { mode: 'manual', constraints: [{ axis: 'y', value: 120, strength: 'hard' }] },
      style: { cornerRadius: 8 },
    }));
    const parsed = parseProject(serializeProject(document));
    expect(parsed.pages[0].edges[0].routing).toEqual({ mode: 'manual', constraints: [{ axis: 'y', value: 120, strength: 'hard' }] });
    expect(parsed.pages[0].edges[0].style.cornerRadius).toBe(8);
    expect(parsed.pages[0].edges[0]).not.toHaveProperty('computedRoute');
  });

  it('restores semantic defaults for legacy DFD pages', () => {
    const document = createDocument('Legacy DFD', 'dfd');
    delete (document.pages[0] as { data?: unknown }).data;
    const migrated = migrateDocument(document);
    expect(migrated.pages[0].data).toEqual({ dfdLevel: 0, dataDictionary: [] });
  });

  it('migrates the legacy snap switch into independent snap targets', () => {
    const document = createDocument('Legacy snapping');
    const legacy = structuredClone(document) as typeof document;
    delete (legacy.pages[0].settings as Partial<typeof legacy.pages[0]['settings']>).snapSettings;
    legacy.pages[0].settings.snapToGrid = false;
    const migrated = migrateDocument(legacy);
    expect(migrated.pages[0].settings.snapSettings).toEqual({ grid: false, objects: false, guides: false, ports: false });
  });

  it('preserves partial independent snap settings during migration', () => {
    const document = createDocument('Independent snapping');
    const legacy = structuredClone(document) as typeof document;
    legacy.pages[0].settings.snapToGrid = true;
    legacy.pages[0].settings.snapSettings = { grid: false, objects: true, guides: false, ports: true };
    const migrated = migrateDocument(legacy);
    expect(migrated.pages[0].settings.snapSettings).toEqual({ grid: false, objects: true, guides: false, ports: true });
    expect(migrated.pages[0].settings.snapToGrid).toBe(false);
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

  it('clamps undersized ERD nodes to their visible content', () => {
    const document = createDocument('Clamped ERD', 'erd');
    const entity = createNode('entity', { x: 0, y: 0 }, {
      size: { width: 48, height: 32 },
      data: { label: 'users', entityVariant: 'key-field', fields: ['id · uuid', 'name · varchar'] },
    });
    document.pages[0].nodes.push(entity);
    const migrated = migrateDocument(document);
    expect(migrated.pages[0].nodes[0].size).toEqual({ width: 120, height: 88 });
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

  it('rejects container ownership that references a missing node', () => {
    const document = createDocument('Container ownership');
    document.pages[0].nodes.push({ ...createNode('rectangle', { x: 0, y: 0 }), containerId: 'missing-container' });
    expect(validateProjectDocument(document).some((message) => message.includes('containerId references a missing node'))).toBe(true);
  });

  it('requires container ownership to point at a container node', () => {
    const document = createDocument('Container ownership');
    const owner = createNode('rectangle', { x: 0, y: 0 });
    const child = { ...createNode('rectangle', { x: 40, y: 50 }), containerId: owner.id };
    document.pages[0].nodes.push(owner, child);
    expect(validateProjectDocument(document).some((message) => message.includes('must reference a container node'))).toBe(true);
  });
});
