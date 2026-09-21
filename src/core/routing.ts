import { nodeCenter, nodeConnectionPoint } from './geometry';
import type { DiagramEdge, DiagramNode, Point } from './types';

export function edgeRoute(edge: DiagramEdge, source: DiagramNode, target: DiagramNode): Point[] {
  const start = nodeConnectionPoint(source, nodeCenter(target), edge.source.port);
  const end = nodeConnectionPoint(target, nodeCenter(source), edge.target.port);
  if (edge.type !== 'orthogonal') return [start, end];

  const points = [start, ...edge.waypoints, end];
  return points.slice(1).reduce<Point[]>((route, point) => {
    const previous = route[route.length - 1];
    if (samePoint(previous, point)) return route;
    if (previous.x === point.x || previous.y === point.y) return [...route, point];
    const horizontalFirst = Math.abs(point.x - previous.x) >= Math.abs(point.y - previous.y);
    const bend = horizontalFirst ? { x: point.x, y: previous.y } : { x: previous.x, y: point.y };
    return [...route, bend, point];
  }, [points[0]]);
}

export function pointsToPath(points: Point[]): string {
  if (points.length === 0) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

export function curvedPath(points: Point[]): string {
  if (points.length < 2) return pointsToPath(points);
  const [start, end] = [points[0], points[points.length - 1]];
  const curve = Math.max(70, Math.abs(end.x - start.x) * .42);
  return `M ${start.x} ${start.y} C ${start.x + (end.x > start.x ? curve : -curve)} ${start.y}, ${end.x - (end.x > start.x ? curve : -curve)} ${end.y}, ${end.x} ${end.y}`;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}
