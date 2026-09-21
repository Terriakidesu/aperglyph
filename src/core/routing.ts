import { nodeCenter, nodeConnectionPoint } from './geometry';
import type { DiagramEdge, DiagramNode, Point } from './types';

const ROUTE_PADDING = 18;
const EPSILON = 0.001;

/**
 * Returns the rendered connector route. Orthogonal routes use a small
 * visibility-grid search so bends stay outside node rectangles instead of
 * taking a dogleg through a nearby shape.
 */
export function edgeRoute(edge: DiagramEdge, source: DiagramNode, target: DiagramNode, obstacles: DiagramNode[] = []): Point[] {
  const start = nodeConnectionPoint(source, nodeCenter(target), edge.source.port);
  const end = nodeConnectionPoint(target, nodeCenter(source), edge.target.port);
  if (edge.type !== 'orthogonal') return [start, end];
  if (obstacles.length === 0) return legacyOrthogonalRoute(start, end, edge.waypoints);

  const rectangles = obstacles.map((node) => inflate(node, ROUTE_PADDING));
  const startDirection = exitDirection(source, start, nodeCenter(target));
  const endDirection = exitDirection(target, end, nodeCenter(source));
  const startExit = shift(start, startDirection, ROUTE_PADDING);
  const endEntry = shift(end, endDirection, ROUTE_PADDING);
  const route: Point[] = [start];
  appendPoint(route, startExit);

  let current = startExit;
  for (const destination of [...edge.waypoints, endEntry]) {
    appendRoute(route, routeBetween(current, destination, rectangles));
    current = destination;
  }
  appendPoint(route, end);
  return simplifyRoute(route);
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

interface Rect { left: number; right: number; top: number; bottom: number }
interface SearchState { i: number; j: number; direction: number; key: string }

function legacyOrthogonalRoute(start: Point, end: Point, waypoints: Point[]): Point[] {
  const points = [start, ...waypoints, end];
  return points.slice(1).reduce<Point[]>((route, point) => {
    const previous = route[route.length - 1];
    if (samePoint(previous, point)) return route;
    if (sameAxis(previous, point)) return [...route, point];
    const horizontalFirst = Math.abs(point.x - previous.x) >= Math.abs(point.y - previous.y);
    const bend = horizontalFirst ? { x: point.x, y: previous.y } : { x: previous.x, y: point.y };
    return [...route, bend, point];
  }, [points[0]]);
}

function routeBetween(from: Point, to: Point, obstacles: Rect[]): Point[] {
  if (samePoint(from, to)) return [from];
  if (sameAxis(from, to) && clearSegment(from, to, obstacles)) return [from, to];

  const xs = uniqueSorted([from.x, to.x, ...obstacles.flatMap((rect) => [rect.left, rect.right])]);
  const ys = uniqueSorted([from.y, to.y, ...obstacles.flatMap((rect) => [rect.top, rect.bottom])]);
  const start = { i: indexOf(xs, from.x), j: indexOf(ys, from.y) };
  const goal = { i: indexOf(xs, to.x), j: indexOf(ys, to.y) };
  const open: SearchState[] = [{ ...start, direction: -1, key: stateKey(start.i, start.j, -1) }];
  const states = new Map<string, SearchState>(open.map((state) => [state.key, state]));
  const scores = new Map<string, number>([[open[0].key, 0]]);
  const parents = new Map<string, string>();
  const maxStates = Math.max(2000, xs.length * ys.length * 4);

  while (open.length > 0 && states.size <= maxStates) {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    open.forEach((state, index) => {
      const score = (scores.get(state.key) ?? Number.POSITIVE_INFINITY) + Math.abs(xs[state.i] - to.x) + Math.abs(ys[state.j] - to.y);
      if (score < bestScore) { bestScore = score; bestIndex = index; }
    });
    const current = open.splice(bestIndex, 1)[0];
    if (current.i === goal.i && current.j === goal.j) return reconstructRoute(current.key, states, parents, xs, ys);

    for (const neighbor of neighbors(current, xs.length, ys.length)) {
      const fromPoint = { x: xs[current.i], y: ys[current.j] };
      const toPoint = { x: xs[neighbor.i], y: ys[neighbor.j] };
      if (blockedPoint(toPoint, obstacles) && !(neighbor.i === goal.i && neighbor.j === goal.j)) continue;
      if (!clearSegment(fromPoint, toPoint, obstacles)) continue;
      const cost = (scores.get(current.key) ?? 0) + Math.abs(toPoint.x - fromPoint.x) + Math.abs(toPoint.y - fromPoint.y) + (current.direction >= 0 && current.direction !== neighbor.direction ? 24 : 0);
      const key = stateKey(neighbor.i, neighbor.j, neighbor.direction);
      if (cost >= (scores.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      const next = { ...neighbor, key };
      states.set(key, next);
      scores.set(key, cost);
      parents.set(key, current.key);
      open.push(next);
    }
  }

  return fallbackOrthogonalRoute(from, to, obstacles);
}

function neighbors(state: SearchState, width: number, height: number): SearchState[] {
  return [
    { i: state.i - 1, j: state.j, direction: 0, key: '' },
    { i: state.i + 1, j: state.j, direction: 1, key: '' },
    { i: state.i, j: state.j - 1, direction: 2, key: '' },
    { i: state.i, j: state.j + 1, direction: 3, key: '' },
  ].filter((neighbor) => neighbor.i >= 0 && neighbor.i < width && neighbor.j >= 0 && neighbor.j < height);
}

function reconstructRoute(key: string, states: Map<string, SearchState>, parents: Map<string, string>, xs: number[], ys: number[]): Point[] {
  const points: Point[] = [];
  let current: string | undefined = key;
  while (current) {
    const state = states.get(current);
    if (!state) break;
    points.push({ x: xs[state.i], y: ys[state.j] });
    current = parents.get(current);
  }
  return points.reverse();
}

function fallbackOrthogonalRoute(from: Point, to: Point, obstacles: Rect[]): Point[] {
  const candidates = [
    [{ x: to.x, y: from.y }],
    [{ x: from.x, y: to.y }],
  ];
  for (const [bend] of candidates) {
    if (clearSegment(from, bend, obstacles) && clearSegment(bend, to, obstacles)) return [from, bend, to];
  }
  return [from, to];
}

function inflate(node: DiagramNode, padding: number): Rect {
  return {
    left: node.position.x - padding,
    right: node.position.x + node.size.width + padding,
    top: node.position.y - padding,
    bottom: node.position.y + node.size.height + padding,
  };
}

function exitDirection(node: DiagramNode, boundary: Point, fallbackTarget: Point): Point {
  const center = nodeCenter(node);
  let dx = boundary.x - center.x;
  let dy = boundary.y - center.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) {
    dx = fallbackTarget.x - center.x;
    dy = fallbackTarget.y - center.y;
  }
  if (Math.abs(dx) >= Math.abs(dy)) return { x: Math.sign(dx) || 1, y: 0 };
  return { x: 0, y: Math.sign(dy) || 1 };
}

function shift(point: Point, direction: Point, distance: number): Point {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
}

function clearSegment(from: Point, to: Point, obstacles: Rect[]): boolean {
  if (!sameAxis(from, to)) return false;
  return !obstacles.some((rect) => {
    if (almostEqual(from.y, to.y)) {
      return from.y > rect.top + EPSILON && from.y < rect.bottom - EPSILON && Math.max(from.x, to.x) > rect.left + EPSILON && Math.min(from.x, to.x) < rect.right - EPSILON;
    }
    return from.x > rect.left + EPSILON && from.x < rect.right - EPSILON && Math.max(from.y, to.y) > rect.top + EPSILON && Math.min(from.y, to.y) < rect.bottom - EPSILON;
  });
}

function blockedPoint(point: Point, obstacles: Rect[]): boolean {
  return obstacles.some((rect) => point.x > rect.left + EPSILON && point.x < rect.right - EPSILON && point.y > rect.top + EPSILON && point.y < rect.bottom - EPSILON);
}

function appendRoute(route: Point[], segment: Point[]): void {
  segment.forEach((point) => appendPoint(route, point));
}

function appendPoint(route: Point[], point: Point): void {
  const last = route.at(-1);
  if (!last || !samePoint(last, point)) route.push(point);
}

function simplifyRoute(points: Point[]): Point[] {
  const simplified: Point[] = [];
  points.forEach((point) => {
    appendPoint(simplified, point);
    while (simplified.length >= 3) {
      const [left, middle, right] = simplified.slice(-3);
      if (collinear(left, middle, right)) simplified.splice(simplified.length - 2, 1);
      else break;
    }
  });
  return simplified;
}

function uniqueSorted(values: number[]): number[] {
  return values.sort((left, right) => left - right).filter((value, index, all) => index === 0 || !almostEqual(value, all[index - 1]));
}

function indexOf(values: number[], value: number): number {
  const index = values.findIndex((candidate) => almostEqual(candidate, value));
  return index >= 0 ? index : values.push(value) - 1;
}

function stateKey(i: number, j: number, direction: number): string {
  return `${i}:${j}:${direction}`;
}

function sameAxis(left: Point, right: Point): boolean {
  return almostEqual(left.x, right.x) || almostEqual(left.y, right.y);
}

function collinear(left: Point, middle: Point, right: Point): boolean {
  return (almostEqual(left.x, middle.x) && almostEqual(middle.x, right.x)) || (almostEqual(left.y, middle.y) && almostEqual(middle.y, right.y));
}

function samePoint(left: Point, right: Point): boolean {
  return almostEqual(left.x, right.x) && almostEqual(left.y, right.y);
}

function almostEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < EPSILON;
}
