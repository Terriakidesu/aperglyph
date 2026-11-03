import { describe, expect, it } from 'vitest';
import { createEdge, createNode } from './document';
import { layoutErdNodes, layoutNodes, optimizeErdLayout } from './layout';

describe('automatic layout', () => {
  it('places a directed graph into hierarchical levels', () => {
    const first = createNode('rectangle', { x: 500, y: 500 });
    const second = createNode('rectangle', { x: -200, y: 300 });
    const third = createNode('rectangle', { x: 900, y: -100 });
    const positions = layoutNodes([first, second, third], [createEdge({ nodeId: first.id }, { nodeId: second.id }), createEdge({ nodeId: second.id }, { nodeId: third.id })], 'hierarchical');
    expect(positions[first.id].x).toBeLessThan(positions[second.id].x);
    expect(positions[second.id].x).toBeLessThan(positions[third.id].x);
  });

  it('creates deterministic grid positions', () => {
    const nodes = Array.from({ length: 5 }, (_, index) => createNode('rectangle', { x: index * 10, y: index * 10 }));
    const positions = layoutNodes(nodes, [], 'grid');
    expect(positions[nodes[0].id]).toEqual({ x: 0, y: 0 });
    expect(positions[nodes[4].id].y).toBeGreaterThan(positions[nodes[0].id].y);
  });

  it('packs ERD dependencies into compact levels and keeps each level collision-free', () => {
    const customer = createNode('entity', { x: 0, y: 0 }, { size: { width: 220, height: 120 } });
    const staff = createNode('entity', { x: 0, y: 0 }, { size: { width: 220, height: 120 } });
    const service = createNode('entity', { x: 0, y: 0 }, { size: { width: 260, height: 120 } });
    const booking = createNode('entity', { x: 0, y: 0 }, { size: { width: 250, height: 150 } });
    const transaction = createNode('entity', { x: 0, y: 0 }, { size: { width: 280, height: 150 } });
    const payment = createNode('entity', { x: 0, y: 0 }, { size: { width: 220, height: 120 } });
    const edge = (source: typeof booking, target: typeof customer) => createEdge({ nodeId: source.id }, { nodeId: target.id }, { data: { relationship: 'foreign-key' } });
    const positions = layoutErdNodes([customer, staff, service, booking, transaction, payment], [
      edge(booking, customer), edge(booking, staff), edge(transaction, booking), edge(transaction, service), edge(payment, transaction),
    ]);

    expect(positions[customer.id].y).toBeLessThan(positions[booking.id].y);
    expect(positions[booking.id].y).toBeLessThan(positions[transaction.id].y);
    expect(positions[transaction.id].y).toBeLessThan(positions[payment.id].y);
    expect(Math.abs(positions[customer.id].x - positions[staff.id].x)).toBeGreaterThan(0);
    expect(Math.abs(positions[staff.id].x - positions[service.id].x)).toBeGreaterThan(0);

    const layers = new Map<number, typeof customer[]>();
    [customer, staff, service, booking, transaction, payment].forEach((node) => {
      const layer = Math.round(positions[node.id].y);
      layers.set(layer, [...(layers.get(layer) ?? []), node]);
    });
    layers.forEach((layer) => layer.sort((left, right) => positions[left.id].x - positions[right.id].x));
    layers.forEach((layer) => layer.slice(1).forEach((node, index) => {
      const previous = layer[index];
      expect(positions[node.id].x).toBeGreaterThanOrEqual(positions[previous.id].x + previous.size.width + 32);
    }));
  });

  it('optimizes connected ERD tables deterministically without moving pinned or unrelated objects', () => {
    const account = createNode('entity', { x: 0, y: 0 }, { size: { width: 220, height: 120 } });
    const invoice = { ...createNode('entity', { x: 0, y: 0 }, { size: { width: 240, height: 130 } }), locked: true };
    const receipt = createNode('entity', { x: 0, y: 0 }, { size: { width: 220, height: 120 } });
    const unrelated = createNode('entity', { x: 900, y: 600 }, { size: { width: 220, height: 120 } });
    const note = createNode('text', { x: 1100, y: 600 });
    const manual = { ...createEdge({ nodeId: invoice.id }, { nodeId: account.id }, { data: { relationship: 'foreign-key' } }), waypoints: [{ x: 120, y: 75 }] };
    const automatic = createEdge({ nodeId: receipt.id }, { nodeId: account.id }, { data: { relationship: 'foreign-key' } });
    const nodes = [account, invoice, receipt, unrelated, note];
    const edges = [manual, automatic];
    const first = optimizeErdLayout(nodes, edges, { pinnedIds: [account.id] });
    const second = optimizeErdLayout(nodes, edges, { pinnedIds: [account.id] });

    expect(first.positions).toEqual(second.positions);
    expect(first.positions[invoice.id]).toBeUndefined();
    expect(first.positions[account.id]).toBeUndefined();
    expect(first.positions[unrelated.id]).toBeUndefined();
    expect(first.positions[note.id]).toBeUndefined();
    expect(first.positions[receipt.id]).toBeDefined();
    expect(manual.waypoints).toEqual([{ x: 120, y: 75 }]);
  });

  it('keeps endpoints of hand-routed relationships fixed while optimizing automatic neighbors', () => {
    const parent = createNode('entity', { x: 0, y: 0 });
    const child = createNode('entity', { x: 0, y: 0 });
    const neighbor = createNode('entity', { x: 0, y: 0 });
    const manual = {
      ...createEdge({ nodeId: child.id }, { nodeId: parent.id }, { data: { relationship: 'foreign-key' } }),
      waypoints: [{ x: 280, y: 76 }],
    };
    const automatic = createEdge({ nodeId: neighbor.id }, { nodeId: parent.id }, {
      data: { relationship: 'foreign-key' },
    });
    const result = optimizeErdLayout([parent, child, neighbor], [manual, automatic]);

    expect(result.positions[parent.id]).toBeUndefined();
    expect(result.positions[child.id]).toBeUndefined();
    expect(result.positions[neighbor.id]).toBeDefined();
    expect(manual.waypoints).toEqual([{ x: 280, y: 76 }]);
  });

  it('produces a bounded deterministic proposal for the 32-table / 36-edge ERD reference size', () => {
    const nodes = Array.from({ length: 32 }, (_, index) => createNode('entity', {
      x: (index % 4) * 320,
      y: Math.floor(index / 4) * 220,
    }, { size: { width: 200, height: 120 } }));
    nodes[0] = { ...nodes[0], locked: true };
    const edges = Array.from({ length: 31 }, (_, index) => createEdge(
      { nodeId: nodes[index + 1].id },
      { nodeId: nodes[Math.floor(index / 2)].id },
      { data: { relationship: 'foreign-key' } },
    ));
    for (let index = 0; index < 5; index += 1) {
      edges.push(createEdge(
        { nodeId: nodes[20 + index].id },
        { nodeId: nodes[index + 1].id },
        { data: { relationship: 'foreign-key' } },
      ));
    }

    const startedAt = performance.now();
    const first = optimizeErdLayout(nodes, edges);
    const elapsed = performance.now() - startedAt;
    const second = optimizeErdLayout(nodes, edges);

    expect(edges).toHaveLength(36);
    expect(first.positions).toEqual(second.positions);
    expect(first.positions[nodes[0].id]).toBeUndefined();
    expect(Number.isFinite(first.score)).toBe(true);
    expect(elapsed).toBeLessThan(5_000);
    const positioned = nodes.map((node) => ({ ...node, position: first.positions[node.id] ?? node.position }));
    const boundsArea = (items: typeof nodes) => {
      const left = Math.min(...items.map((node) => node.position.x));
      const top = Math.min(...items.map((node) => node.position.y));
      const right = Math.max(...items.map((node) => node.position.x + node.size.width));
      const bottom = Math.max(...items.map((node) => node.position.y + node.size.height));
      return (right - left) * (bottom - top);
    };
    expect(boundsArea(positioned)).toBeLessThanOrEqual(boundsArea(nodes));
    for (let left = 0; left < positioned.length; left += 1) {
      for (let right = left + 1; right < positioned.length; right += 1) {
        const a = positioned[left];
        const b = positioned[right];
        const separated = a.position.x + a.size.width <= b.position.x + 0.01
          || b.position.x + b.size.width <= a.position.x + 0.01
          || a.position.y + a.size.height <= b.position.y + 0.01
          || b.position.y + b.size.height <= a.position.y + 0.01;
        expect(separated).toBe(true);
      }
    }
  });
});
