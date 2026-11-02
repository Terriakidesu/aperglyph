import { describe, expect, it } from 'vitest';
import { applyAuthoringBatch, AuthoringBatchCommand, prepareAuthoringBatch } from './authoring';
import { CommandManager } from './commands';
import { createDocument, createEdge, createNode } from './document';

describe('authoring transactions', () => {
  it('creates shapes and connections with batch-local aliases and exact geometry', () => {
    const document = createDocument('Automation', 'general');
    const pageId = document.pages[0].id;
    const prepared = prepareAuthoringBatch([
      { op: 'node.create', alias: 'start', node: { type: 'rectangle', position: { x: 20, y: 30 }, data: { label: 'Start' } } },
      { op: 'node.create', alias: 'finish', node: { type: 'circle', position: { x: 280, y: 30 }, size: { width: 100, height: 100 }, data: { label: 'Finish' } } },
      { op: 'edge.create', alias: 'flow', edge: createEdge({ nodeId: '$start', port: 'east' }, { nodeId: '$finish', port: 'west' }, { type: 'orthogonal', data: { label: 'continue' } }) },
      { op: 'edge.update', edgeId: '$flow', patch: { waypoints: [{ x: 180, y: 75 }], style: { stroke: '#ff0000' } } },
    ]);

    const result = applyAuthoringBatch(document, pageId, prepared);
    const page = result.document.pages[0];
    expect(page.nodes).toHaveLength(2);
    expect(page.nodes.find((node) => node.id === result.aliases.start)?.position).toEqual({ x: 20, y: 30 });
    expect(page.edges[0]).toMatchObject({
      source: { nodeId: result.aliases.start, port: 'east' },
      target: { nodeId: result.aliases.finish, port: 'west' },
      waypoints: [{ x: 180, y: 75 }],
      style: { stroke: '#ff0000' },
    });
    expect(result.changedNodeIds).toEqual([result.aliases.start, result.aliases.finish]);
    expect(result.changedEdgeIds).toEqual([result.aliases.flow]);
  });

  it('applies relative and absolute moves while preserving other geometry', () => {
    const document = createDocument();
    const page = document.pages[0];
    const first = createNode('rectangle', { x: 10, y: 20 });
    const second = createNode('rectangle', { x: 50, y: 60 });
    page.nodes.push(first, second);
    const prepared = prepareAuthoringBatch([
      { op: 'node.move', nodeId: first.id, delta: { x: 5, y: -10 } },
      { op: 'node.move', positions: { [second.id]: { x: 100, y: 120 } } },
    ]);

    const result = applyAuthoringBatch(document, page.id, prepared);
    expect(result.document.pages[0].nodes.map((node) => node.position)).toEqual([{ x: 15, y: 10 }, { x: 100, y: 120 }]);
  });

  it('rejects a failed operation without returning a partially edited document', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const prepared = prepareAuthoringBatch([
      { op: 'node.create', node: { id: 'temporary', type: 'rectangle', position: { x: 0, y: 0 } } },
      { op: 'edge.create', edge: createEdge({ nodeId: 'temporary' }, { nodeId: 'missing' }) },
    ]);

    expect(() => applyAuthoringBatch(document, pageId, prepared)).toThrow(/missing node/);
    expect(document.pages[0].nodes).toHaveLength(0);
    expect(document.pages[0].edges).toHaveLength(0);
  });

  it('enforces page and lock safety', () => {
    const document = createDocument();
    const page = document.pages[0];
    const locked = createNode('rectangle', { x: 0, y: 0 });
    locked.locked = true;
    page.nodes.push(locked);

    expect(() => applyAuthoringBatch(document, page.id, prepareAuthoringBatch([
      { op: 'node.move', nodeId: locked.id, position: { x: 10, y: 10 } },
    ]))).toThrow(/locked/);
    expect(() => applyAuthoringBatch(document, page.id, prepareAuthoringBatch([
      { op: 'page.delete', pageId: page.id },
    ]))).toThrow(/last remaining page/);
  });

  it('duplicates pages with fresh object references and resolves the page alias in later operations', () => {
    const document = createDocument();
    const source = document.pages[0];
    const node = createNode('rectangle', { x: 20, y: 30 }, { data: { label: 'Original' } });
    source.nodes.push(node);
    source.edges.push(createEdge({ nodeId: node.id }, { point: { x: 400, y: 80 } }));
    const result = applyAuthoringBatch(document, source.id, prepareAuthoringBatch([
      { op: 'page.duplicate', pageId: source.id, alias: 'copy' },
      { op: 'page.rename', pageId: '$copy', name: 'Automated copy' },
    ]));
    const copy = result.document.pages.find((page) => page.id === result.aliases.copy)!;

    expect(copy.name).toBe('Automated copy');
    expect(copy.nodes[0].id).not.toBe(node.id);
    expect(copy.edges[0].source.nodeId).toBe(copy.nodes[0].id);
    expect(copy.edges[0].target.point).toEqual({ x: 400, y: 80 });
  });

  it('duplicates nodes with remapped edge anchors and resolves the duplicate alias', () => {
    const document = createDocument();
    const page = document.pages[0];
    const source = createNode('rectangle', { x: 10, y: 20 }, { data: { label: 'Original' } });
    const target = createNode('circle', { x: 240, y: 20 });
    page.nodes.push(source, target);
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' });
    edge.waypoints = [{ x: 180, y: 55 }];
    page.edges.push(edge);

    const result = applyAuthoringBatch(document, page.id, prepareAuthoringBatch([
      { op: 'node.duplicate', nodeId: source.id, alias: 'copy', position: { x: 50, y: 70 }, includeEdges: true },
      { op: 'node.update', nodeId: '$copy', patch: { data: { label: 'Copied' } } },
    ]));
    const copy = result.document.pages[0].nodes.find((node) => node.id === result.aliases.copy)!;
    const copiedEdge = result.document.pages[0].edges.find((candidate) => candidate.id !== edge.id)!;

    expect(copy.position).toEqual({ x: 50, y: 70 });
    expect(copy.data.label).toBe('Copied');
    expect(copiedEdge.source).toMatchObject({ nodeId: copy.id, port: 'right' });
    expect(copiedEdge.target.nodeId).toBe(target.id);
    expect(copiedEdge.waypoints).toEqual([{ x: 220, y: 105 }]);
    expect(result.changedEdgeIds).toEqual([copiedEdge.id]);
  });

  it('merges partial page settings and validates container ownership', () => {
    const document = createDocument();
    const root = document.pages[0];
    const result = applyAuthoringBatch(document, root.id, prepareAuthoringBatch([
      { op: 'page.create', name: 'Notes', alias: 'notes', page: { settings: { width: 1200, snapToGrid: false } } },
      { op: 'node.create', pageId: '$notes', alias: 'frame', node: { type: 'frame', position: { x: 0, y: 0 }, container: true } },
      { op: 'node.create', pageId: '$notes', node: { type: 'rectangle', position: { x: 20, y: 30 }, containerId: '$frame' } },
    ]));
    const notes = result.document.pages.find((page) => page.id === result.aliases.notes)!;
    expect(notes.settings.width).toBe(1200);
    expect(notes.settings.snapToGrid).toBe(false);
    expect(notes.settings.snapSettings).toMatchObject({ grid: false, objects: false, guides: false, ports: false });
    expect(notes.nodes[1].containerId).toBe(result.aliases.frame);

    expect(() => applyAuthoringBatch(document, root.id, prepareAuthoringBatch([
      { op: 'node.create', alias: 'ordinary', node: { type: 'rectangle', position: { x: 0, y: 0 } } },
      { op: 'node.create', node: { type: 'rectangle', position: { x: 0, y: 0 }, containerId: '$ordinary' } },
    ]))).toThrow(/not a container/);
  });

  it('records a whole successful batch as one undoable command and stores no history on failure', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const manager = new CommandManager();
    const command = new AuthoringBatchCommand(pageId, prepareAuthoringBatch([
      { op: 'node.create', node: { type: 'rectangle', position: { x: 5, y: 8 } } },
      { op: 'node.create', node: { type: 'circle', position: { x: 40, y: 50 } } },
    ]), 'Create two shapes');
    const after = manager.execute(command, document);

    expect(after.pages[0].nodes).toHaveLength(2);
    expect(manager.lastAction).toBe('Create two shapes');
    expect(manager.undo(after)?.pages[0].nodes).toHaveLength(0);
    expect(manager.redo(document)?.pages[0].nodes).toHaveLength(2);

    const failing = new CommandManager();
    const invalid = new AuthoringBatchCommand(pageId, prepareAuthoringBatch([
      { op: 'node.create', node: { id: 'partial', type: 'rectangle', position: { x: 0, y: 0 } } },
      { op: 'edge.create', edge: { type: 'straight', source: { nodeId: 'partial' }, target: { nodeId: 'missing' } } },
    ]));
    expect(() => failing.execute(invalid, document)).toThrow(/missing node/);
    expect(failing.canUndo).toBe(false);
    expect(document.pages[0].nodes).toHaveLength(0);
  });
});
