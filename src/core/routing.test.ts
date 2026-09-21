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

  it('routes around an intervening node instead of crossing its bounds', () => {
    const source = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 90, height: 60 } });
    const target = createNode('rectangle', { x: 330, y: 0 }, { size: { width: 90, height: 60 } });
    const blocker = createNode('rectangle', { x: 160, y: -25 }, { size: { width: 90, height: 110 } });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal' });
    const route = edgeRoute(edge, source, target, [source, target, blocker]);
    expect(route.slice(1).every((point, index) => {
      const previous = route[index];
      return previous.x === point.x || previous.y === point.y;
    })).toBe(true);
    expect(route.some((point) => point.y < blocker.position.y || point.y > blocker.position.y + blocker.size.height)).toBe(true);
    expect(route.slice(1).some((point, index) => segmentCrossesRect(route[index], point, blocker))).toBe(false);
  });
});

function segmentCrossesRect(start: { x: number; y: number }, end: { x: number; y: number }, node: ReturnType<typeof createNode>): boolean {
  if (start.y === end.y) return start.y > node.position.y && start.y < node.position.y + node.size.height && Math.max(start.x, end.x) > node.position.x && Math.min(start.x, end.x) < node.position.x + node.size.width;
  return start.x > node.position.x && start.x < node.position.x + node.size.width && Math.max(start.y, end.y) > node.position.y && Math.min(start.y, end.y) < node.position.y + node.size.height;
}
