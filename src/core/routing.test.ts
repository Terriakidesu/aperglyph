import { describe, expect, it } from 'vitest';
import { createEdge, createNode } from './document';
import { edgeRoute, pointsToPath } from './routing';

describe('connector routing', () => {
  it('routes a straight connector between boundaries', () => {
    const source = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 100, height: 50 } });
    const target = createNode('rectangle', { x: 300, y: 0 }, { size: { width: 100, height: 50 } });
    const route = edgeRoute(createEdge({ nodeId: source.id }, { nodeId: target.id }), source, target);
    expect(route).toEqual([{ x: 100, y: 25 }, { x: 300, y: 25 }]);
  });

  it('routes orthogonal connectors through axis-aligned bends', () => {
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 180 });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal' });
    const route = edgeRoute(edge, source, target);
    expect(route.every((point, index) => index === 0 || point.x === route[index - 1].x || point.y === route[index - 1].y)).toBe(true);
    expect(pointsToPath(route)).toContain('L');
  });
});
