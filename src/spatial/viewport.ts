import type { Point, Size, Viewport } from '../core/types';
import type { SpatialBounds, SpatialNode } from './types';

export function nodeToSpatialNode(id: string, position: Point, size: Size): SpatialNode {
  return { id, minX: position.x, minY: position.y, maxX: position.x + size.width, maxY: position.y + size.height };
}

export function viewportBounds(viewport: Viewport, size: Size, overscan = 240): SpatialBounds {
  const worldWidth = size.width / viewport.zoom;
  const worldHeight = size.height / viewport.zoom;
  const worldOverscan = overscan / viewport.zoom;
  const centerX = -viewport.x;
  const centerY = -viewport.y;
  return {
    minX: centerX - worldWidth / 2 - worldOverscan,
    minY: centerY - worldHeight / 2 - worldOverscan,
    maxX: centerX + worldWidth / 2 + worldOverscan,
    maxY: centerY + worldHeight / 2 + worldOverscan,
  };
}
