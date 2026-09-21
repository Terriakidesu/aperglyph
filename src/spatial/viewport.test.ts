import { describe, expect, it } from 'vitest';
import { nodeToSpatialNode, viewportBounds } from './viewport';

describe('viewport spatial helpers', () => {
  it('converts a node into an indexable bounding box', () => {
    expect(nodeToSpatialNode('node-1', { x: 20, y: 30 }, { width: 100, height: 60 })).toEqual({
      id: 'node-1', minX: 20, minY: 30, maxX: 120, maxY: 90,
    });
  });

  it('adds overscan in world coordinates', () => {
    const bounds = viewportBounds({ x: 0, y: 0, zoom: 2 }, { width: 1000, height: 600 }, 200);
    expect(bounds).toEqual({ minX: -350, minY: -250, maxX: 350, maxY: 250 });
  });
});
