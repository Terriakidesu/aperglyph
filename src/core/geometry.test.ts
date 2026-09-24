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

  it('reflects explicit ports and offsets with the node silhouette', () => {
    const node = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 200, height: 100 }, flipX: true, flipY: true });
    expect(nodeConnectionPoint(node, { x: 0, y: 0 }, 'right')).toEqual({ x: 0, y: 50 });
    expect(nodeConnectionPoint(node, { x: 0, y: 0 }, 'bottom', 0.25)).toEqual({ x: 150, y: 0 });
    expect(connectionOffset(node, { x: 150, y: 0 }, 'bottom')).toBeCloseTo(0.25);
    expect(nearestConnectionPort(node, { x: 260, y: 50 })).toBe('left');
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
    expect(point.x).toBeCloseTo(100, 1);
    expect(point.y).toBeCloseTo(100, 1);
  });

  it.each(['database', 'cylinder', 'cloud', 'stored-data', 'manual-operation', 'delay', 'display'])('keeps %s connector intersections within the rendered bounds', (type) => {
    const node = createNode(type, { x: 0, y: 0 }, { library: type === 'manual-operation' || type === 'delay' || type === 'display' ? 'flowchart' : 'general', size: { width: 180, height: 90 } });
    const point = nodeConnectionPoint(node, { x: 360, y: 180 });
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(180);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeLessThanOrEqual(90);
  });

  it('attaches corrected non-rectangular symbols from cardinal and diagonal directions', () => {
    const shapes = [
      ['ellipse', 'general'], ['diamond', 'general'], ['cloud', 'general'], ['cylinder', 'general'],
      ['document', 'flowchart'], ['stored-data', 'flowchart'], ['manual-operation', 'flowchart'],
      ['delay', 'flowchart'], ['display', 'flowchart'], ['off-page-connector', 'flowchart'],
    ] as const;
    const targets = [{ x: 90, y: -180 }, { x: 360, y: 45 }, { x: 90, y: 270 }, { x: -180, y: 45 }, { x: 360, y: 180 }];
    shapes.forEach(([type, library]) => {
      const node = createNode(type, { x: 0, y: 0 }, { library, size: { width: 180, height: 90 } });
      targets.forEach((target) => {
        const point = nodeConnectionPoint(node, target);
        expect(point.x, `${library}/${type} x`).toBeGreaterThanOrEqual(0);
        expect(point.x, `${library}/${type} x`).toBeLessThanOrEqual(180);
        expect(point.y, `${library}/${type} y`).toBeGreaterThanOrEqual(0);
        expect(point.y, `${library}/${type} y`).toBeLessThanOrEqual(90);
      });
    });
  });

  it('updates the DFD connector boundary with the selected notation', () => {
    const process = createNode('process', { x: 0, y: 0 }, { library: 'dfd', size: { width: 120, height: 84 }, data: { notation: 'gane-sarson' } });
    const point = nodeConnectionPoint(process, { x: 300, y: 42 });
    expect(point).toEqual({ x: 120, y: 42 });
  });
});
