import { describe, expect, it } from 'vitest';
import { createNode } from './document';
import { nearestConnectionPort, nodeConnectionPoint } from './geometry';

describe('node connector geometry', () => {
  it('connects a rectangle at its boundary', () => {
    const node = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 100, height: 50 } });
    expect(nodeConnectionPoint(node, { x: 300, y: 25 })).toEqual({ x: 100, y: 25 });
  });

  it('connects a diamond at its sloped boundary', () => {
    const node = createNode('diamond', { x: 0, y: 0 }, { size: { width: 100, height: 100 } });
    const point = nodeConnectionPoint(node, { x: 200, y: 200 });
    expect(point.x).toBeCloseTo(75);
    expect(point.y).toBeCloseTo(75);
  });

  it('honors explicit ports and rotation', () => {
    const node = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 100, height: 40 } });
    expect(nodeConnectionPoint(node, { x: 0, y: 0 }, 'right')).toEqual({ x: 100, y: 20 });
    node.rotation = 90;
    const point = nodeConnectionPoint(node, { x: 0, y: 0 }, 'right');
    expect(point.x).toBeCloseTo(50);
    expect(point.y).toBeCloseTo(70);
  });

  it('chooses a stable cardinal port for orthogonal connections', () => {
    const node = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 100, height: 40 } });
    expect(nearestConnectionPort(node, { x: 300, y: 10 })).toBe('right');
    expect(nearestConnectionPort(node, { x: 20, y: 200 })).toBe('bottom');
  });
});
