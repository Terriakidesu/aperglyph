import type { DiagramNode, Point, ShapeBoundary } from './types';
import { notationRenderer, silhouetteBoundaryPoints } from './silhouettes';

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
export function nodeConnectionPoint(node: DiagramNode, toward: Point, port?: string, offset = 0.5): Point {
  const center = nodeCenter(node);
  const localTarget = rotateAround(toward, center, -node.rotation);
  const fixedPort = normalizePort(port);
  const target = fixedPort ? portPoint(center, node.size.width / 2, node.size.height / 2, fixedPort, offset) : localTarget;
  const localPoint = shapeEdgePoint(node, target);
  return rotateAround(localPoint, center, node.rotation);
}

/**
 * Finds the rendered shape edge instead of intersecting only the persisted
 * rectangle/ellipse/diamond hint. Connector anchors therefore stay on the
 * visible edge of flowchart silhouettes and plugin-provided shapes.
 */
function shapeEdgePoint(node: DiagramNode, target: Point): Point {
  const center = nodeCenter(node);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (Math.abs(dx) < Number.EPSILON && Math.abs(dy) < Number.EPSILON) return center;
  const renderer = notationRenderer(inferredRenderer(node), node);
  const halfWidth = node.size.width / 2 || 1;
  const halfHeight = node.size.height / 2 || 1;
  if (renderer === 'ellipse' || renderer === 'use-case') {
    const scale = 1 / Math.sqrt((dx * dx) / (halfWidth * halfWidth) + (dy * dy) / (halfHeight * halfHeight));
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  }
  const polygon = shapePolygon(node, renderer);
  if (polygon) return polygonIntersection(center, target, polygon);
  const boundary = node.boundary ?? inferredBoundary(node);
  if (boundary === 'ellipse') {
    const scale = 1 / Math.sqrt((dx * dx) / (halfWidth * halfWidth) + (dy * dy) / (halfHeight * halfHeight));
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  }
  if (boundary === 'diamond') return polygonIntersection(center, target, diamondPoints(node));
  return polygonIntersection(center, target, roundedRectanglePoints(node, node.style.radius));
}

function inferredRenderer(node: DiagramNode): string {
  if (node.library === 'dfd' && node.type === 'process') return 'ellipse';
  if (node.library === 'dfd' && node.type === 'store') return 'dfd-store';
  if (node.library === 'flowchart' && node.type === 'connector') return 'ellipse';
  if (node.library === 'flowchart' && node.type === 'multiple-document') return 'document';
  if (node.type === 'circle') return 'ellipse';
  if (node.type === 'use-case') return 'use-case';
  if (node.type === 'diamond' || node.type === 'decision') return 'diamond';
  return node.type;
}

function shapePolygon(node: DiagramNode, renderer: string): Point[] | null {
  const sharedBoundary = silhouetteBoundaryPoints(renderer, node.size.width, node.size.height, node.style.radius);
  if (sharedBoundary) return offsetPoints(node, sharedBoundary.map((point) => [point.x, point.y]));
  switch (renderer) {
    case 'diamond':
    case 'decision':
      return diamondPoints(node);
    case 'manual-input':
      return offsetPoints(node, [[18, 0], [node.size.width, 0], [node.size.width - 18, node.size.height], [0, node.size.height]]);
    case 'preparation':
      return offsetPoints(node, [[24, 0], [node.size.width - 24, 0], [node.size.width, node.size.height / 2], [node.size.width - 24, node.size.height], [24, node.size.height], [0, node.size.height / 2]]);
    case 'off-page-connector':
      return offsetPoints(node, [[0, 0], [node.size.width, 0], [node.size.width, node.size.height * .68], [node.size.width / 2, node.size.height], [0, node.size.height * .68]]);
    case 'document':
      return documentPoints(node);
    case 'database':
      return databasePoints(node);
    case 'display':
      return displayPoints(node);
    case 'delay':
      return delayPoints(node);
    case 'stored-data':
      return roundedRectanglePoints(node, 12);
    case 'boundary':
    case 'predefined-process':
    case 'entity':
    case 'dfd-store':
    case 'store':
    case 'actor':
    case 'line':
      return roundedRectanglePoints(node, renderer === 'boundary' ? node.style.radius : 0);
    case 'rounded-rectangle':
    case 'start':
      return roundedRectanglePoints(node, Math.min(node.style.radius || 22, node.size.height / 2));
    default:
      return renderer === 'rectangle' || renderer === 'input' || renderer === 'text'
        ? roundedRectanglePoints(node, node.style.radius)
        : null;
  }
}

function diamondPoints(node: DiagramNode): Point[] {
  return offsetPoints(node, [[node.size.width / 2, 0], [node.size.width, node.size.height / 2], [node.size.width / 2, node.size.height], [0, node.size.height / 2]]);
}

function roundedRectanglePoints(node: DiagramNode, radius: number): Point[] {
  const width = node.size.width;
  const height = node.size.height;
  const corner = Math.min(Math.max(0, radius), width / 2, height / 2);
  if (corner <= Number.EPSILON) return offsetPoints(node, [[0, 0], [width, 0], [width, height], [0, height]]);
  const points: Point[] = [];
  const corners = [
    { x: corner, y: corner, start: Math.PI, end: Math.PI * 1.5 },
    { x: width - corner, y: corner, start: Math.PI * 1.5, end: Math.PI * 2 },
    { x: width - corner, y: height - corner, start: 0, end: Math.PI * .5 },
    { x: corner, y: height - corner, start: Math.PI * .5, end: Math.PI },
  ];
  corners.forEach((cornerPoint) => {
    for (let index = 0; index <= 6; index += 1) {
      const angle = cornerPoint.start + (cornerPoint.end - cornerPoint.start) * index / 6;
      points.push({ x: node.position.x + cornerPoint.x + Math.cos(angle) * corner, y: node.position.y + cornerPoint.y + Math.sin(angle) * corner });
    }
  });
  return points;
}

function documentPoints(node: DiagramNode): Point[] {
  const { width, height } = node.size;
  const points: Point[] = [{ x: node.position.x, y: node.position.y }, { x: node.position.x + width, y: node.position.y }, { x: node.position.x + width, y: node.position.y + height - 16 }];
  appendQuadratic(points, { x: node.position.x + width, y: node.position.y + height - 16 }, { x: node.position.x + width * .75, y: node.position.y + height }, { x: node.position.x + width * .5, y: node.position.y + height - 16 });
  appendQuadratic(points, { x: node.position.x + width * .5, y: node.position.y + height - 16 }, { x: node.position.x + width * .25, y: node.position.y + height - 32 }, { x: node.position.x, y: node.position.y + height - 16 });
  points.push({ x: node.position.x, y: node.position.y });
  return points;
}

function databasePoints(node: DiagramNode): Point[] {
  const { width, height } = node.size;
  const left = node.position.x;
  const top = node.position.y;
  const points: Point[] = [{ x: left, y: top + height * .18 }];
  appendCubic(points, points[0], { x: left, y: top }, { x: left + width, y: top }, { x: left + width, y: top + height * .18 });
  points.push({ x: left + width, y: top + height * .8 });
  appendCubic(points, points.at(-1)!, { x: left + width, y: top + height + height * .02 }, { x: left, y: top + height + height * .02 }, { x: left, y: top + height * .8 });
  points.push(points[0]);
  return points;
}

function displayPoints(node: DiagramNode): Point[] {
  const { width, height } = node.size;
  const left = node.position.x;
  const top = node.position.y;
  const right = left + width - 28;
  const points: Point[] = [{ x: left, y: top }, { x: right, y: top }];
  appendQuadratic(points, points.at(-1)!, { x: left + width, y: top + height / 2 }, { x: right, y: top + height });
  points.push({ x: left, y: top + height });
  appendQuadratic(points, points.at(-1)!, { x: left + 28, y: top + height / 2 }, { x: left, y: top });
  return points;
}

function delayPoints(node: DiagramNode): Point[] {
  const { width, height } = node.size;
  const left = node.position.x;
  const top = node.position.y;
  const radiusX = 28;
  const centerX = left + width - radiusX;
  const points: Point[] = [{ x: left, y: top }, { x: centerX, y: top }];
  for (let index = 1; index <= 8; index += 1) {
    const angle = -Math.PI / 2 + Math.PI * index / 8;
    points.push({ x: centerX + Math.cos(angle) * radiusX, y: top + height / 2 + Math.sin(angle) * height / 2 });
  }
  points.push({ x: left, y: top + height });
  return points;
}

function offsetPoints(node: DiagramNode, points: Array<[number, number]>): Point[] {
  return points.map(([x, y]) => ({ x: node.position.x + x, y: node.position.y + y }));
}

function appendQuadratic(points: Point[], from: Point, control: Point, to: Point): void {
  for (let index = 1; index <= 8; index += 1) {
    const t = index / 8;
    const inverse = 1 - t;
    points.push({
      x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
      y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
    });
  }
}

function appendCubic(points: Point[], from: Point, firstControl: Point, secondControl: Point, to: Point): void {
  for (let index = 1; index <= 8; index += 1) {
    const t = index / 8;
    const inverse = 1 - t;
    points.push({
      x: inverse ** 3 * from.x + 3 * inverse ** 2 * t * firstControl.x + 3 * inverse * t ** 2 * secondControl.x + t ** 3 * to.x,
      y: inverse ** 3 * from.y + 3 * inverse ** 2 * t * firstControl.y + 3 * inverse * t ** 2 * secondControl.y + t ** 3 * to.y,
    });
  }
}

function polygonIntersection(origin: Point, target: Point, polygon: Point[]): Point {
  const direction = { x: target.x - origin.x, y: target.y - origin.y };
  let nearest: Point | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  polygon.forEach((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    const segment = { x: end.x - start.x, y: end.y - start.y };
    const denominator = direction.x * segment.y - direction.y * segment.x;
    if (Math.abs(denominator) < Number.EPSILON) return;
    const relative = { x: start.x - origin.x, y: start.y - origin.y };
    const distance = (relative.x * segment.y - relative.y * segment.x) / denominator;
    const along = (relative.x * direction.y - relative.y * direction.x) / denominator;
    if (distance < -Number.EPSILON || along < -Number.EPSILON || along > 1 + Number.EPSILON || distance >= nearestDistance) return;
    nearestDistance = distance;
    nearest = { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
  });
  return nearest ?? target;
}

function inferredBoundary(node: DiagramNode): ShapeBoundary {
  if (node.type === 'circle' || node.type === 'use-case' || (node.library === 'dfd' && node.type === 'process')) return 'ellipse';
  if (node.type === 'diamond' || node.type === 'decision') return 'diamond';
  return 'rectangle';
}

function portPoint(center: Point, halfWidth: number, halfHeight: number, port: Exclude<ConnectionPort, 'north' | 'east' | 'south' | 'west'>, offset = 0.5): Point {
  const ratio = Math.min(1, Math.max(0, Number.isFinite(offset) ? offset : 0.5));
  switch (port) {
    case 'top': return { x: center.x - halfWidth + halfWidth * 2 * ratio, y: center.y - halfHeight };
    case 'right': return { x: center.x + halfWidth, y: center.y - halfHeight + halfHeight * 2 * ratio };
    case 'bottom': return { x: center.x - halfWidth + halfWidth * 2 * ratio, y: center.y + halfHeight };
    case 'left': return { x: center.x - halfWidth, y: center.y - halfHeight + halfHeight * 2 * ratio };
    default: return center;
  }
}

/** Returns the normalized position of a world-space point along a cardinal
 * node port so multiple relationships can attach to different rows/columns. */
export function connectionOffset(node: DiagramNode, point: Point, port?: string): number | undefined {
  const fixedPort = normalizePort(port);
  if (!fixedPort || fixedPort === 'center') return undefined;
  const center = nodeCenter(node);
  const localPoint = rotateAround(point, center, -node.rotation);
  const halfWidth = node.size.width / 2 || 1;
  const halfHeight = node.size.height / 2 || 1;
  const ratio = fixedPort === 'top' || fixedPort === 'bottom'
    ? (localPoint.x - (center.x - halfWidth)) / (halfWidth * 2)
    : (localPoint.y - (center.y - halfHeight)) / (halfHeight * 2);
  return Math.min(1, Math.max(0, ratio));
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
