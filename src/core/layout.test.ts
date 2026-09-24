import { describe, expect, it } from 'vitest';
import { createEdge, createNode } from './document';
import { layoutErdNodes, layoutNodes } from './layout';

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
      expect(positions[node.id].x).toBeGreaterThanOrEqual(positions[previous.id].x + previous.size.width + 52);
    }));
  });
});
