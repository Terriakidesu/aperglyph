import { describe, expect, it } from 'vitest';
import { createEdge, createNode } from './document';
import { layoutNodes } from './layout';

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
});
