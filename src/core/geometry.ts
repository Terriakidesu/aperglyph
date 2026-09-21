import type { DiagramNode, Point } from './types';

export type ConnectionPort = 'top' | 'right' | 'bottom' | 'left' | 'center' | 'north' | 'east' | 'south' | 'west';

export function nodeCenter(node: DiagramNode): Point {
  return { x: node.position.x + node.size.width / 2, y: node.position.y + node.size.height / 2 };
}

/** Selects the closest cardinal port so an orthogonal connection can keep a
 * stable anchor after its route is recalculated. */
export function nearestConnectionPort(node: DiagramNode, toward: Point): Exclude<ConnectionPort, 'center' | 'north' | 'east' | 'south' | 'west'> {
  const center = nodeCenter(node);
  const localTarget = rotateAround(toward, center, -node.rotation);
  const dx = localTarget.x - center.x;
  const dy = localTarget.y - center.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/**
 * Find the point where a connector ray exits a node. The calculation happens
 * in the node's local coordinate space so rotated nodes keep correct ports.
 */
export function nodeConnectionPoint(node: DiagramNode, toward: Point, port?: string): Point {
  const center = nodeCenter(node);
  const localTarget = rotateAround(toward, center, -node.rotation);
  const halfWidth = node.size.width / 2;
  const halfHeight = node.size.height / 2;
  let localPoint: Point;

  const fixedPort = normalizePort(port);
  if (fixedPort) {
    localPoint = portPoint(center, halfWidth, halfHeight, fixedPort);
  } else {
    const dx = localTarget.x - center.x;
    const dy = localTarget.y - center.y;
    if (Math.abs(dx) < Number.EPSILON && Math.abs(dy) < Number.EPSILON) return center;
    if (node.type === 'circle' || node.type === 'use-case' || (node.library === 'dfd' && node.type === 'process')) {
      const radiusX = halfWidth || 1;
      const radiusY = halfHeight || 1;
      const scale = 1 / Math.sqrt((dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY));
      localPoint = { x: center.x + dx * scale, y: center.y + dy * scale };
    } else if (node.type === 'diamond' || node.type === 'decision') {
      const scale = 1 / (Math.abs(dx) / (halfWidth || 1) + Math.abs(dy) / (halfHeight || 1));
      localPoint = { x: center.x + dx * scale, y: center.y + dy * scale };
    } else {
      const horizontalScale = halfWidth / Math.max(Math.abs(dx), Number.EPSILON);
      const verticalScale = halfHeight / Math.max(Math.abs(dy), Number.EPSILON);
      const scale = Math.min(horizontalScale, verticalScale);
      localPoint = { x: center.x + dx * scale, y: center.y + dy * scale };
    }
  }

  return rotateAround(localPoint, center, node.rotation);
}

function portPoint(center: Point, halfWidth: number, halfHeight: number, port: Exclude<ConnectionPort, 'north' | 'east' | 'south' | 'west'>): Point {
  switch (port) {
    case 'top': return { x: center.x, y: center.y - halfHeight };
    case 'right': return { x: center.x + halfWidth, y: center.y };
    case 'bottom': return { x: center.x, y: center.y + halfHeight };
    case 'left': return { x: center.x - halfWidth, y: center.y };
    default: return center;
  }
}

function normalizePort(port?: string): Exclude<ConnectionPort, 'north' | 'east' | 'south' | 'west'> | undefined {
  if (!port) return undefined;
  if (port === 'north') return 'top';
  if (port === 'east') return 'right';
  if (port === 'south') return 'bottom';
  if (port === 'west') return 'left';
  if (port === 'top' || port === 'right' || port === 'bottom' || port === 'left' || port === 'center') return port;
  return undefined;
}

function rotateAround(point: Point, center: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
}
