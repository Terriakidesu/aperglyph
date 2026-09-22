import { describe, expect, it } from 'vitest';
import { AlignNodesCommand, CommandManager, CreateEdgeCommand, CreateNodeAndEdgeCommand, CreateNodeCommand, CreatePageCommand, DeleteNodesCommand, DistributeNodesCommand, DuplicateSelectionCommand, GroupNodesCommand, LayoutNodesCommand, MoveNodesCommand, RenamePageCommand, ResetEdgeCommand, ReorderNodesCommand, RotateNodesCommand, SetZOrderCommand, UngroupNodesCommand, UpdateEdgeCommand, UpdateNodesCommand, UpdatePageGuidesCommand, parseClipboardPayload, selectionClipboard, offsetClipboard, serializeClipboardPayload } from './commands';
import { createDocument, createEdge, createNode, createPage } from './document';
import { edgeRoute } from './routing';

describe('command history', () => {
  it('supports execute, undo, and redo', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const node = createNode('rectangle', { x: 10, y: 20 });
    const manager = new CommandManager();
    const withNode = manager.execute(new CreateNodeCommand(pageId, node), document);
    expect(withNode.pages[0].nodes).toHaveLength(1);
    expect(manager.canUndo).toBe(true);

    const empty = manager.undo(withNode);
    expect(empty?.pages[0].nodes).toHaveLength(0);
    expect(manager.canRedo).toBe(true);

    const restored = manager.redo(empty!);
    expect(restored?.pages[0].nodes[0].id).toBe(node.id);
  });

  it('records a single move command for a batch of nodes', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const first = createNode('rectangle', { x: 0, y: 0 });
    const second = createNode('rectangle', { x: 100, y: 0 });
    document.pages[0].nodes.push(first, second);
    const manager = new CommandManager();
    const moved = manager.execute(new MoveNodesCommand(pageId, {
      [first.id]: { x: 20, y: 30 },
      [second.id]: { x: 120, y: 30 },
    }), document);
    expect(moved.pages[0].nodes.map((node) => node.position.y)).toEqual([30, 30]);
  });

  it('moves explicitly owned container children with their container', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const container = createNode('frame', { x: 0, y: 0 }, { container: true });
    const child = { ...createNode('rectangle', { x: 40, y: 50 }), containerId: container.id };
    document.pages[0].nodes.push(container, child);
    const moved = new CommandManager().execute(new MoveNodesCommand(pageId, { [container.id]: { x: 100, y: 80 } }), document);
    expect(moved.pages[0].nodes.find((node) => node.id === child.id)?.position).toEqual({ x: 140, y: 130 });
  });

  it('moves nested container descendants by the accumulated parent delta', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const outer = createNode('frame', { x: 0, y: 0 }, { container: true });
    const inner = { ...createNode('section', { x: 40, y: 50 }, { container: true }), containerId: outer.id };
    const child = { ...createNode('rectangle', { x: 80, y: 100 }), containerId: inner.id };
    document.pages[0].nodes.push(outer, inner, child);
    const moved = new CommandManager().execute(new MoveNodesCommand(pageId, { [outer.id]: { x: 100, y: 120 } }), document);
    expect(moved.pages[0].nodes.find((node) => node.id === inner.id)?.position).toEqual({ x: 140, y: 170 });
    expect(moved.pages[0].nodes.find((node) => node.id === child.id)?.position).toEqual({ x: 180, y: 220 });
  });

  it('detaches surviving children when their container is deleted', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const container = createNode('frame', { x: 0, y: 0 }, { container: true });
    const child = { ...createNode('rectangle', { x: 40, y: 50 }), containerId: container.id };
    document.pages[0].nodes.push(container, child);
    const next = new CommandManager().execute(new DeleteNodesCommand(pageId, [container.id]), document);
    expect(next.pages[0].nodes).toHaveLength(1);
    expect(next.pages[0].nodes[0].containerId).toBeUndefined();
  });

  it('remaps explicit container ownership when duplicating a selection', () => {
    const container = createNode('frame', { x: 0, y: 0 }, { container: true });
    const child = { ...createNode('rectangle', { x: 40, y: 50 }), containerId: container.id };
    const payload = offsetClipboard({ nodes: [child, container], edges: [] });
    expect(payload.nodes[0].containerId).toBe(payload.nodes[1].id);
    expect(payload.nodes[0].containerId).not.toBe(container.id);
  });

  it('updates and deletes connectors independently of their nodes', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 0 });
    const edge = createEdge({ nodeId: source.id }, { nodeId: target.id });
    document.pages[0].nodes.push(source, target);
    const manager = new CommandManager();
    const withEdge = manager.execute(new CreateEdgeCommand(pageId, edge), document);
    const updated = manager.execute(new UpdateEdgeCommand(pageId, edge.id, {
      type: 'orthogonal',
      source: { nodeId: source.id, port: 'right' },
      data: { label: 'owns' },
    }), withEdge);
    expect(updated.pages[0].edges[0]).toMatchObject({ type: 'orthogonal', source: { port: 'right' }, data: { label: 'owns' } });

    const withoutEdge = manager.execute(new DeleteNodesCommand(pageId, [edge.id]), updated);
    expect(withoutEdge.pages[0].nodes).toHaveLength(2);
    expect(withoutEdge.pages[0].edges).toHaveLength(0);
  });

  it('creates a quick-created shape and connector in one history entry', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const source = createNode('rectangle', { x: 0, y: 0 });
    const created = createNode('circle', { x: 300, y: 0 });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: created.id, port: 'left' });
    document.pages[0].nodes.push(source);
    const manager = new CommandManager();
    const next = manager.execute(new CreateNodeAndEdgeCommand(pageId, created, edge), document);
    expect(next.pages[0].nodes).toHaveLength(2);
    expect(next.pages[0].edges).toHaveLength(1);
    expect(manager.undo(next)?.pages[0].nodes).toHaveLength(1);
  });

  it('creates and offsets free endpoints', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const target = createNode('rectangle', { x: 300, y: 0 });
    document.pages[0].nodes.push(target);
    const edge = createEdge({ point: { x: 20, y: 30 } }, { nodeId: target.id });
    const manager = new CommandManager();
    const next = manager.execute(new CreateEdgeCommand(pageId, edge), document);
    const payload = selectionClipboard(next, pageId, [edge.id]);
    const offset = offsetClipboard(payload, { x: 24, y: 18 });
    expect(offset.edges[0].source.point).toEqual({ x: 44, y: 48 });
  });

  it('clears stale free geometry when reconnecting an endpoint to a node', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 0 });
    const edge = createEdge({ nodeId: source.id }, { point: { x: 40, y: 300 } });
    document.pages[0].nodes.push(source, target);

    const manager = new CommandManager();
    const withEdge = manager.execute(new CreateEdgeCommand(pageId, edge), document);
    const updated = manager.execute(new UpdateEdgeCommand(pageId, edge.id, {
      target: { nodeId: target.id, port: 'left' },
    }), withEdge);
    const nextEdge = updated.pages[0].edges[0];

    expect(nextEdge.target).toEqual({ nodeId: target.id, port: 'left', point: undefined });
    expect(edgeRoute(nextEdge, source, target)[0]).toEqual({ x: 180, y: 44 });
  });

  it('supports page lifecycle commands', () => {
    const document = createDocument();
    const page = createPage('Review');
    const manager = new CommandManager();
    const withPage = manager.execute(new CreatePageCommand(page), document);
    expect(withPage.pages.map((item) => item.name)).toEqual(['Page 1', 'Review']);
    const renamed = manager.execute(new RenamePageCommand(page.id, 'Architecture'), withPage);
    expect(renamed.pages[1].name).toBe('Architecture');
  });

  it('duplicates, aligns, distributes, rotates, and reorders selection geometry', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const first = createNode('rectangle', { x: 0, y: 0 });
    const second = createNode('rectangle', { x: 240, y: 40 });
    const third = createNode('rectangle', { x: 520, y: 100 });
    document.pages[0].nodes.push(first, second, third);
    const manager = new CommandManager();
    const aligned = manager.execute(new AlignNodesCommand(pageId, [first.id, second.id, third.id], 'top'), document);
    expect(aligned.pages[0].nodes.map((node) => node.position.y)).toEqual([0, 0, 0]);
    const distributed = manager.execute(new DistributeNodesCommand(pageId, [first.id, second.id, third.id], 'horizontal'), aligned);
    expect(distributed.pages[0].nodes.map((node) => node.position.x)).toEqual([0, 260, 520]);
    const rotated = manager.execute(new RotateNodesCommand(pageId, [first.id], 90), distributed);
    expect(rotated.pages[0].nodes[0].rotation).toBe(90);
    const reordered = manager.execute(new SetZOrderCommand(pageId, [first.id], 'front'), rotated);
    expect(reordered.pages[0].nodes[0].zIndex).toBeGreaterThan(reordered.pages[0].nodes[1].zIndex ?? 0);
    const payload = offsetClipboard(selectionClipboard(reordered, pageId, [first.id]), { x: 24, y: 24 });
    const duplicated = manager.execute(new DuplicateSelectionCommand(pageId, payload), reordered);
    expect(duplicated.pages[0].nodes).toHaveLength(4);
  });

  it('distributes different-sized nodes with equal gaps', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const first = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 40, height: 30 } });
    const second = createNode('rectangle', { x: 100, y: 0 }, { size: { width: 80, height: 30 } });
    const third = createNode('rectangle', { x: 300, y: 0 }, { size: { width: 60, height: 30 } });
    document.pages[0].nodes.push(first, second, third);
    const distributed = new CommandManager().execute(new DistributeNodesCommand(pageId, [first.id, second.id, third.id], 'horizontal'), document);
    const nodes = distributed.pages[0].nodes;
    expect(nodes[1].position.x - (nodes[0].position.x + nodes[0].size.width)).toBe(90);
    expect(nodes[2].position.x - (nodes[1].position.x + nodes[1].size.width)).toBe(90);
  });

  it('updates shared selection properties as one command', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const first = createNode('rectangle', { x: 0, y: 0 });
    const second = createNode('rectangle', { x: 100, y: 0 });
    document.pages[0].nodes.push(first, second);
    const manager = new CommandManager();
    const updated = manager.execute(new UpdateNodesCommand(pageId, [first.id, second.id], { style: { opacity: 0.6 }, locked: true }, 'Update selection'), document);
    expect(updated.pages[0].nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, locked: true, style: expect.objectContaining({ opacity: 0.6 }) }),
      expect.objectContaining({ id: second.id, locked: true, style: expect.objectContaining({ opacity: 0.6 }) }),
    ]));
  });

  it('updates guides and outline reorder as undoable commands', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const first = createNode('rectangle', { x: 0, y: 0 });
    const second = createNode('ellipse', { x: 100, y: 0 });
    document.pages[0].nodes.push(first, second);
    const manager = new CommandManager();
    const withGuide = manager.execute(new UpdatePageGuidesCommand(pageId, [{ id: 'guide-1', orientation: 'vertical', position: 120 }]), document);
    expect(withGuide.pages[0].guides).toEqual([{ id: 'guide-1', orientation: 'vertical', position: 120 }]);
    const reordered = manager.execute(new ReorderNodesCommand(pageId, [second.id], first.id), withGuide);
    expect(reordered.pages[0].nodes.map((node) => node.id)).toEqual([second.id, first.id]);
  });

  it('preserves locked objects during outline reorder', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const first = createNode('rectangle', { x: 0, y: 0 });
    const locked = { ...createNode('ellipse', { x: 100, y: 0 }), locked: true };
    const last = createNode('rectangle', { x: 200, y: 0 });
    document.pages[0].nodes.push(first, locked, last);
    const reordered = new CommandManager().execute(new ReorderNodesCommand(pageId, [locked.id, last.id], first.id), document);
    expect(reordered.pages[0].nodes.map((node) => node.id)).toEqual([last.id, first.id, locked.id]);
  });

  it('keeps grouping and layout undoable and validates clipboard payloads', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const first = createNode('rectangle', { x: 0, y: 0 });
    const second = createNode('rectangle', { x: 240, y: 120 });
    document.pages[0].nodes.push(first, second);
    const manager = new CommandManager();
    const grouped = manager.execute(new GroupNodesCommand(pageId, [first.id, second.id]), document);
    expect(grouped.pages[0].nodes.map((node) => node.groupId)).toEqual([expect.any(String), expect.any(String)]);
    const ungrouped = manager.execute(new UngroupNodesCommand(pageId, [first.id]), grouped);
    expect(ungrouped.pages[0].nodes.every((node) => node.groupId === undefined)).toBe(true);
    const laidOut = manager.execute(new LayoutNodesCommand(pageId, { [first.id]: { x: 12, y: 24 }, [second.id]: { x: 300, y: 24 } }, 'horizontal'), ungrouped);
    expect(laidOut.pages[0].nodes.map((node) => node.position.x)).toEqual([12, 300]);
    const payload = selectionClipboard(laidOut, pageId, [first.id, second.id]);
    expect(parseClipboardPayload(serializeClipboardPayload(payload))).toEqual(payload);
    expect(parseClipboardPayload('{"format":"aperglyph-clipboard","version":1,"payload":{"nodes":[{}],"edges":[]}}')).toBeNull();
  });

  it('resets a connector to the diagram defaults', () => {
    const document = createDocument('Reset', 'general');
    const pageId = document.pages[0].id;
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 0 });
    const edge = createEdge({ nodeId: source.id, port: 'bottom' }, { nodeId: target.id, port: 'top' }, { type: 'orthogonal', style: { dash: 'dotted', startMarker: 'bar', endMarker: 'circle' } });
    edge.waypoints = [{ x: 100, y: 200 }];
    document.pages[0].nodes.push(source, target);
    document.pages[0].edges.push(edge);
    const reset = new CommandManager().execute(new ResetEdgeCommand(pageId, edge.id, 'general'), document);
    expect(reset.pages[0].edges[0]).toMatchObject({ type: 'straight', source: { port: undefined }, target: { port: undefined }, waypoints: [], style: { dash: 'solid', startMarker: 'none', endMarker: 'arrow' } });
  });
});
