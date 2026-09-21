import { describe, expect, it } from 'vitest';
import { createNode } from './document';
import { connectionOffset, nearestConnectionPort, nodeConnectionPoint } from './geometry';

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

  it('keeps attached endpoints at arbitrary positions along a port', () => {
    const node = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 200, height: 100 } });
    const point = nodeConnectionPoint(node, { x: 300, y: 80 }, 'right', 0.8);
    expect(point).toEqual({ x: 200, y: 80 });
    expect(connectionOffset(node, point, 'right')).toBeCloseTo(0.8);
  });

  it('uses ellipse geometry for DFD process bubbles', () => {
    const node = createNode('process', { x: 0, y: 0 }, { library: 'dfd', size: { width: 100, height: 60 } });
    const point = nodeConnectionPoint(node, { x: 200, y: 200 });
    expect(point.x).toBeCloseTo(73.39, 1);
    expect(point.y).toBeCloseTo(56.51, 1);
  });

  it('uses a definition-provided boundary for extensible shapes', () => {
    const node = createNode('custom-bubble', { x: 0, y: 0 }, { boundary: 'ellipse', size: { width: 100, height: 60 } });
    const point = nodeConnectionPoint(node, { x: 200, y: 200 });
    expect(point.x).toBeCloseTo(73.39, 1);
    expect(point.y).toBeCloseTo(56.51, 1);
  });

  it('uses a flowchart silhouette edge instead of its bounding rectangle', () => {
    const node = createNode('manual-input', { x: 0, y: 0 }, { library: 'flowchart', size: { width: 100, height: 100 } });
    const point = nodeConnectionPoint(node, { x: 200, y: 200 });
    expect(point.x).toBeCloseTo(84.75, 1);
    expect(point.y).toBeCloseTo(84.75, 1);
  });
});
