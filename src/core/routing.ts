import { nodeCenter, nodeConnectionPoint } from './geometry';
import { connectionAnchorPoints, entityFieldAnchors } from './anchors';
import { normalizeEntityFields } from './erd';
import type { DiagramEdge, DiagramNode, EdgeMarker, Endpoint, Point, PortDirection } from './types';

export const NODE_CLEARANCE = 16;
export const PORT_STUB_LENGTH = 24;
const EPSILON = 0.001;
const JUMP_HALF_LENGTH = 8;
const JUMP_HEIGHT = 7;

export interface RoutingEndpoint {
  point: Point;
  direction?: PortDirection;
}

export interface RouteOptions {
  nodeClearance?: number;
  portStubLength?: number;
  previousRoute?: Point[];
  otherRoutes?: ReadonlyArray<Point[]>;
  lane?: RoutingLane;
}

export interface RoutingLane {
  index: number;
  count: number;
  spacing?: number;
}

export interface RouteJump {
  segmentIndex: number;
  point: Point;
  orientation: 'horizontal' | 'vertical';
}

export type EdgeRouting = 'straight' | 'orthogonal' | 'curved';

/** Resolve a plugin connector's semantic type to its geometric route mode. */
export function edgeRouting(edge: DiagramEdge): EdgeRouting {
  const persisted = edge.data?.routing;
  if (persisted === 'straight' || persisted === 'orthogonal' || persisted === 'curved') return persisted;
  if (edge.type === 'orthogonal' || edge.type === 'curved' || edge.type === 'straight') return edge.type;
  if (edge.type === 'relationship' || edge.type === 'identifying' || edge.type === 'data-flow') return 'orthogonal';
  return 'straight';
}

/** Stable visual separation for multiple connectors between the same nodes. */
export function parallelEdgeOffset(edge: DiagramEdge, edges: DiagramEdge[]): number {
  const sourceId = edge.source.nodeId;
  const targetId = edge.target.nodeId;
  if (!sourceId || !targetId || sourceId === targetId) return 0;
  const parallel = edges.filter((candidate) => {
    const candidateSource = candidate.source.nodeId;
    const candidateTarget = candidate.target.nodeId;
    return (candidateSource === sourceId && candidateTarget === targetId) || (candidateSource === targetId && candidateTarget === sourceId);
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (parallel.length < 2) return 0;
  const index = parallel.findIndex((candidate) => candidate.id === edge.id);
  return (index - (parallel.length - 1) / 2) * 20;
}

/** Deterministic orthogonal lane assignment for parallel connectors. */
export function parallelRoutingLane(edge: DiagramEdge, edges: DiagramEdge[]): RoutingLane | undefined {
  const sourceId = edge.source.nodeId;
  const targetId = edge.target.nodeId;
  if (!sourceId || !targetId || sourceId === targetId) return undefined;
  const parallel = edges.filter((candidate) => {
    const candidateSource = candidate.source.nodeId;
    const candidateTarget = candidate.target.nodeId;
    return (candidateSource === sourceId && candidateTarget === targetId) || (candidateSource === targetId && candidateTarget === sourceId);
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (parallel.length < 2) return undefined;
  const index = parallel.findIndex((candidate) => candidate.id === edge.id);
  return { index: edge.routing?.lane ?? index, count: parallel.length, spacing: 16 };
}

/**
 * Returns the rendered connector route. Orthogonal routes use a small
 * visibility-grid search so bends stay outside node rectangles instead of
 * taking a dogleg through a nearby shape.
 */
export function edgeRoute(edge: DiagramEdge, source?: DiagramNode, target?: DiagramNode, obstacles: DiagramNode[] = [], options: RouteOptions = {}): Point[] {
  const sourceEndpoint = semanticFieldEndpoint(edge, edge.source, source, 'source');
  const targetEndpoint = semanticFieldEndpoint(edge, edge.target, target, 'target');
  const start = resolveEndpointPoint(sourceEndpoint, source, targetEndpoint.point ?? (target ? nodeCenter(target) : undefined));
  const end = resolveEndpointPoint(targetEndpoint, target, sourceEndpoint.point ?? (source ? nodeCenter(source) : undefined));
  if (!start || !end) return [];
  if (source && target && source.id === target.id) return selfLoopRoute(source, start, end, sourceEndpoint.port);
  const routing = edgeRouting(edge);
  if (routing !== 'orthogonal') return routing === 'straight' && Number.isFinite(edge.data?.parallelOffset) && Number(edge.data?.parallelOffset) !== 0
    ? parallelRoute(start, end, Number(edge.data?.parallelOffset))
    : [start, end];
  if (!source && !target && obstacles.length === 0) return legacyOrthogonalRoute(start, end, edge.waypoints);

  const nodeClearance = options.nodeClearance ?? NODE_CLEARANCE;
  const requestedStub = options.portStubLength ?? PORT_STUB_LENGTH;
  const rectangles = obstacles.map((node) => inflate(node, nodeClearance));
  const startDirection = source ? routingDirection(sourceEndpoint, source, start, end) : cardinalDirection(start, end);
  const endDirection = target ? routingDirection(targetEndpoint, target, end, start) : cardinalDirection(end, start);
  const startStub = Math.max(requestedStub, markerTerminalLength(edge.style.startMarker));
  const endStub = Math.max(requestedStub, markerTerminalLength(edge.style.endMarker));
  const startExit = source ? shift(start, startDirection, startStub) : start;
  const endEntry = target ? shift(end, endDirection, endStub) : end;
  const route: Point[] = [start];
  appendPoint(route, startExit);

  let current = startExit;
  for (const destination of [...edge.waypoints, endEntry]) {
    appendRoute(route, routeBetween(current, destination, rectangles, options));
    current = destination;
  }
  appendPoint(route, end);
  return simplifyRoute(route);
}

function parallelRoute(start: Point, end: Point, offset: number): Point[] {
  const length = Math.max(EPSILON, distanceBetween(start, end));
  const normal = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
  const shift = { x: normal.x * offset, y: normal.y * offset };
  return [start, { x: start.x + shift.x, y: start.y + shift.y }, { x: end.x + shift.x, y: end.y + shift.y }, end];
}

function selfLoopRoute(node: DiagramNode, start: Point, end: Point, port?: string): Point[] {
  const side = port === 'left' || port === 'top' || port === 'bottom' || port === 'right' ? port : 'right';
  const gap = Math.max(44, Math.max(node.size.width, node.size.height) * 0.35);
  if (side === 'left' || side === 'right') {
    const direction = side === 'right' ? 1 : -1;
    const outer = (side === 'right' ? node.position.x + node.size.width : node.position.x) + direction * gap;
    const far = outer + direction * gap * 0.55;
    return simplifyRoute([start, { x: outer, y: start.y }, { x: far, y: (start.y + end.y) / 2 }, { x: outer, y: end.y }, end]);
  }
  const direction = side === 'bottom' ? 1 : -1;
  const outer = (side === 'bottom' ? node.position.y + node.size.height : node.position.y) + direction * gap;
  const far = outer + direction * gap * 0.55;
  return simplifyRoute([start, { x: start.x, y: outer }, { x: (start.x + end.x) / 2, y: far }, { x: end.x, y: outer }, end]);
}

/** Resolves an endpoint to its current world-space location. */
export function resolveEndpointPoint(endpoint: Endpoint, node?: DiagramNode, toward?: Point): Point | null {
  // An attached endpoint is authoritative even if an older document also
  // contains a stale free-point value. Otherwise the stale point can leave a
  // visible gap between the connector notation and the node boundary.
  if (node && endpoint.nodeId) {
    const anchor = endpoint.anchorId
      ? connectionAnchorPoints(node, node.type === 'entity' ? entityFieldAnchors : undefined).find((candidate) => candidate.anchor.id === endpoint.anchorId)
      : undefined;
    if (anchor) return anchor.point;
    return nodeConnectionPoint(node, toward ?? nodeCenter(node), endpoint.port, endpoint.offset);
  }
  if (endpoint.point) return { ...endpoint.point };
  if (!node) return null;
  return nodeConnectionPoint(node, toward ?? nodeCenter(node), endpoint.port, endpoint.offset);
}

/** Add a field anchor to older ERD edges that persisted only field metadata. */
function semanticFieldEndpoint(edge: DiagramEdge, endpoint: Endpoint, node: DiagramNode | undefined, side: 'source' | 'target'): Endpoint {
  if (!node || node.type !== 'entity' || endpoint.anchorId) return endpoint;
  const fieldKey = side === 'source' ? 'sourceFieldId' : 'targetFieldId';
  const fieldId = typeof edge.data?.[fieldKey] === 'string' ? edge.data[fieldKey] as string : undefined;
  if (!fieldId) return endpoint;
  const index = normalizeEntityFields(node.data.fields).findIndex((field) => field.id === fieldId);
  if (index < 0) return endpoint;
  const port = endpoint.port === 'left' || endpoint.port === 'right' ? endpoint.port : side === 'source' ? 'right' : 'left';
  return { ...endpoint, anchorId: `field-${index}-${port}` };
}

export function pointsToPath(points: Point[], jumps: readonly RouteJump[] = []): string {
  if (points.length === 0) return '';
  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
    const from = points[segmentIndex];
    const to = points[segmentIndex + 1];
    const segmentJumps = jumps
      .filter((jump) => jump.segmentIndex === segmentIndex)
      .sort((left, right) => distanceAlongSegment(left.point, from) - distanceAlongSegment(right.point, from));
    let cursor = from;
    segmentJumps.forEach((jump) => {
      const span = jumpSpan(jump.point, from, to);
      if (!span || distanceBetween(cursor, span.before) < EPSILON) return;
      commands.push(`L ${span.before.x} ${span.before.y}`);
      const control = jump.orientation === 'horizontal'
        ? { x: jump.point.x, y: jump.point.y - JUMP_HEIGHT }
        : { x: jump.point.x + JUMP_HEIGHT, y: jump.point.y };
      commands.push(`Q ${control.x} ${control.y} ${span.after.x} ${span.after.y}`);
      cursor = span.after;
    });
    commands.push(`L ${to.x} ${to.y}`);
  }
  return commands.join(' ');
}

/** Finds interior crossings between orthogonal routes and assigns the jump to
 * the later route so the wire order stays deterministic. */
export function calculateRouteJumps(routes: ReadonlyArray<{ id: string; points: Point[] }>): Map<string, RouteJump[]> {
  const jumps = new Map<string, RouteJump[]>();
  routes.forEach((route) => jumps.set(route.id, []));
  for (let leftIndex = 0; leftIndex < routes.length; leftIndex += 1) {
    const left = routes[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < routes.length; rightIndex += 1) {
      const right = routes[rightIndex];
      for (let leftSegment = 0; leftSegment < left.points.length - 1; leftSegment += 1) {
        for (let rightSegment = 0; rightSegment < right.points.length - 1; rightSegment += 1) {
          const crossing = orthogonalCrossing(left.points[leftSegment], left.points[leftSegment + 1], right.points[rightSegment], right.points[rightSegment + 1]);
          if (!crossing) continue;
          const routeJumps = jumps.get(right.id) ?? [];
          if (!routeJumps.some((jump) => distanceBetween(jump.point, crossing.point) < JUMP_HALF_LENGTH * 2)) {
            routeJumps.push({ segmentIndex: rightSegment, point: crossing.point, orientation: crossing.orientation });
            jumps.set(right.id, routeJumps);
          }
        }
      }
    }
  }
  return jumps;
}

/** Returns straight spans that should be painted over lower wires before the
 * curved jump is drawn. */
export function jumpMaskPaths(points: Point[], jumps: readonly RouteJump[]): string[] {
  return jumps.flatMap((jump) => {
    const from = points[jump.segmentIndex];
    const to = points[jump.segmentIndex + 1];
    if (!from || !to) return [];
    const span = jumpSpan(jump.point, from, to);
    return span ? [`M ${span.before.x} ${span.before.y} L ${span.after.x} ${span.after.y}`] : [];
  });
}

interface OrthogonalCrossing { point: Point; orientation: 'horizontal' | 'vertical' }

function orthogonalCrossing(leftStart: Point, leftEnd: Point, rightStart: Point, rightEnd: Point): OrthogonalCrossing | null {
  const leftHorizontal = almostEqual(leftStart.y, leftEnd.y) && !almostEqual(leftStart.x, leftEnd.x);
  const rightHorizontal = almostEqual(rightStart.y, rightEnd.y) && !almostEqual(rightStart.x, rightEnd.x);
  if (leftHorizontal === rightHorizontal) return null;
  const horizontalStart = leftHorizontal ? leftStart : rightStart;
  const horizontalEnd = leftHorizontal ? leftEnd : rightEnd;
  const verticalStart = leftHorizontal ? rightStart : leftStart;
  const verticalEnd = leftHorizontal ? rightEnd : leftEnd;
  const point = { x: verticalStart.x, y: horizontalStart.y };
  if (!strictlyBetween(point.x, horizontalStart.x, horizontalEnd.x, JUMP_HALF_LENGTH) || !strictlyBetween(point.y, verticalStart.y, verticalEnd.y, JUMP_HALF_LENGTH)) return null;
  return { point, orientation: leftHorizontal ? 'vertical' : 'horizontal' };
}

function jumpSpan(point: Point, from: Point, to: Point): { before: Point; after: Point } | null {
  const length = distanceBetween(from, to);
  if (length < EPSILON) return null;
  const unit = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  return {
    before: { x: point.x - unit.x * JUMP_HALF_LENGTH, y: point.y - unit.y * JUMP_HALF_LENGTH },
    after: { x: point.x + unit.x * JUMP_HALF_LENGTH, y: point.y + unit.y * JUMP_HALF_LENGTH },
  };
}

function strictlyBetween(value: number, first: number, second: number, margin: number): boolean {
  return value > Math.min(first, second) + margin && value < Math.max(first, second) - margin;
}

function distanceAlongSegment(point: Point, from: Point): number {
  return Math.hypot(point.x - from.x, point.y - from.y);
}

function distanceBetween(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function curvedPath(points: Point[], startDirection?: Point, endDirection?: Point): string {
  if (points.length < 2) return pointsToPath(points);
  const [start, end] = [points[0], points[points.length - 1]];
  const distance = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
  const handle = Math.max(70, distance * .42);
  const startTangent = normalizeDirection(startDirection ?? dominantDirection(start, end));
  const endTangent = normalizeDirection(endDirection ?? dominantDirection(start, end));
  const firstControl = { x: start.x + startTangent.x * handle, y: start.y + startTangent.y * handle };
  const secondControl = { x: end.x - endTangent.x * handle, y: end.y - endTangent.y * handle };
  return `M ${start.x} ${start.y} C ${firstControl.x} ${firstControl.y}, ${secondControl.x} ${secondControl.y}, ${end.x} ${end.y}`;
}

function dominantDirection(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: Math.sign(dx) || 1, y: 0 };
  return { x: 0, y: Math.sign(dy) || 1 };
}

function normalizeDirection(direction: Point): Point {
  const length = Math.hypot(direction.x, direction.y);
  return length > EPSILON ? { x: direction.x / length, y: direction.y / length } : { x: 1, y: 0 };
}

interface Rect { left: number; right: number; top: number; bottom: number }
interface GraphPoint extends Point { index: number }
interface SearchState { point: number; direction: number; key: string }

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

function routeBetween(from: Point, to: Point, obstacles: Rect[], options: RouteOptions): Point[] {
  if (samePoint(from, to)) return [from];
  const laneRoute = options.lane ? explicitLaneRoute(from, to, obstacles, options.lane) : null;
  if (laneRoute) return laneRoute;
  if (sameAxis(from, to) && clearSegment(from, to, obstacles) && !options.lane && !(options.otherRoutes && options.otherRoutes.length > 0)) return [from, to];

  const points = visibilityGraphPoints(from, to, obstacles, options.lane);
  const graph = buildVisibilityGraph(points, obstacles);
  const start = points.findIndex((point) => samePoint(point, from));
  const goal = points.findIndex((point) => samePoint(point, to));
  if (start < 0 || goal < 0) return fallbackOrthogonalRoute(from, to, obstacles);
  const open: SearchState[] = [{ point: start, direction: -1, key: stateKey(start, -1) }];
  const states = new Map<string, SearchState>(open.map((state) => [state.key, state]));
  const scores = new Map<string, number>([[open[0].key, 0]]);
  const parents = new Map<string, string>();
  const maxStates = Math.max(2000, points.length * 4);

  while (open.length > 0 && states.size <= maxStates) {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    open.forEach((state, index) => {
      const point = points[state.point];
      const score = (scores.get(state.key) ?? Number.POSITIVE_INFINITY) + Math.abs(point.x - to.x) + Math.abs(point.y - to.y);
      if (score < bestScore) { bestScore = score; bestIndex = index; }
    });
    const current = open.splice(bestIndex, 1)[0];
    if (current.point === goal) return reconstructRoute(current.key, states, parents, points);

    for (const neighbor of graph[current.point]) {
      const fromPoint = points[current.point];
      const toPoint = points[neighbor.point];
      const length = Math.abs(toPoint.x - fromPoint.x) + Math.abs(toPoint.y - fromPoint.y);
      const cost = (scores.get(current.key) ?? 0)
        + length
        + (current.direction >= 0 && current.direction !== neighbor.direction ? 32 : 0)
        + routeSegmentPenalty(fromPoint, toPoint, options)
        + routeChangePenalty(fromPoint, toPoint, options.previousRoute);
      const key = stateKey(neighbor.point, neighbor.direction);
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

function explicitLaneRoute(from: Point, to: Point, obstacles: Rect[], lane: RoutingLane): Point[] | null {
  if (lane.count < 2 || !sameAxis(from, to)) return null;
  const offset = (lane.index - (lane.count - 1) / 2) * (lane.spacing ?? 16);
  if (Math.abs(offset) < EPSILON) return null;
  const first = almostEqual(from.y, to.y)
    ? { x: from.x, y: from.y + offset }
    : { x: from.x + offset, y: from.y };
  const second = almostEqual(from.y, to.y)
    ? { x: to.x, y: to.y + offset }
    : { x: to.x + offset, y: to.y };
  if (!clearSegment(from, first, obstacles) || !clearSegment(first, second, obstacles) || !clearSegment(second, to, obstacles)) return null;
  return [from, first, second, to];
}

interface GraphNeighbor { point: number; direction: number }

function visibilityGraphPoints(from: Point, to: Point, obstacles: Rect[], lane?: RoutingLane): GraphPoint[] {
  const points: GraphPoint[] = [];
  const add = (point: Point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || blockedPoint(point, obstacles)) return;
    if (points.some((candidate) => samePoint(candidate, point))) return;
    points.push({ ...point, index: points.length });
  };
  add(from);
  add(to);
  obstacles.forEach((rect) => {
    add({ x: rect.left, y: rect.top });
    add({ x: rect.right, y: rect.top });
    add({ x: rect.right, y: rect.bottom });
    add({ x: rect.left, y: rect.bottom });
  });

  // Add only projections onto obstacle boundaries, rather than every X × Y
  // intersection. This keeps useful corridor gates while avoiding irrelevant
  // Cartesian-grid states as diagrams grow.
  for (let pass = 0; pass < 2; pass += 1) {
    const seeds = points.slice();
    obstacles.forEach((rect) => seeds.forEach((seed) => {
      add({ x: rect.left, y: seed.y });
      add({ x: rect.right, y: seed.y });
      add({ x: seed.x, y: rect.top });
      add({ x: seed.x, y: rect.bottom });
    }));
  }

  if (lane && lane.count > 1) {
    const spacing = lane.spacing ?? 16;
    const offset = (lane.index - (lane.count - 1) / 2) * spacing;
    if (almostEqual(from.y, to.y)) {
      add({ x: from.x, y: from.y + offset });
      add({ x: to.x, y: to.y + offset });
    } else if (almostEqual(from.x, to.x)) {
      add({ x: from.x + offset, y: from.y });
      add({ x: to.x + offset, y: to.y });
    }
  }
  return points;
}

function buildVisibilityGraph(points: GraphPoint[], obstacles: Rect[]): GraphNeighbor[][] {
  const graph: GraphNeighbor[][] = points.map(() => []);
  points.forEach((point, pointIndex) => {
    const candidates = points
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(({ candidate }) => sameAxis(point, candidate) && !samePoint(point, candidate))
      .filter(({ candidate }) => clearSegment(point, candidate, obstacles));
    const directions = new Map<number, { candidateIndex: number; distance: number }>();
    candidates.forEach(({ candidate, candidateIndex }) => {
      const direction = candidate.x > point.x ? 1 : candidate.x < point.x ? 0 : candidate.y > point.y ? 3 : 2;
      const distance = Math.abs(candidate.x - point.x) + Math.abs(candidate.y - point.y);
      const current = directions.get(direction);
      if (!current || distance < current.distance) directions.set(direction, { candidateIndex, distance });
    });
    directions.forEach(({ candidateIndex }) => {
      const candidate = points[candidateIndex];
      const direction = candidate.x > point.x ? 1 : candidate.x < point.x ? 0 : candidate.y > point.y ? 3 : 2;
      graph[pointIndex].push({ point: candidateIndex, direction });
    });
  });
  return graph;
}

function reconstructRoute(key: string, states: Map<string, SearchState>, parents: Map<string, string>, graphPoints: Point[]): Point[] {
  const route: Point[] = [];
  let current: string | undefined = key;
  while (current) {
    const state = states.get(current);
    if (!state) break;
    route.push({ x: graphPoints[state.point].x, y: graphPoints[state.point].y });
    current = parents.get(current);
  }
  return route.reverse();
}

function routeSegmentPenalty(from: Point, to: Point, options: RouteOptions): number {
  const routes = options.otherRoutes ?? [];
  let penalty = 0;
  routes.forEach((route) => {
    for (let index = 0; index < route.length - 1; index += 1) {
      const existingStart = route[index];
      const existingEnd = route[index + 1];
      if (segmentsOverlap(from, to, existingStart, existingEnd)) penalty += 140;
      else if (segmentsCross(from, to, existingStart, existingEnd)) penalty += 90;
      else if (axisSegmentDistance(from, to, existingStart, existingEnd) <= 8) penalty += 10;
    }
  });
  return penalty;
}

function routeChangePenalty(from: Point, to: Point, previousRoute?: Point[]): number {
  if (!previousRoute || previousRoute.length < 2) return 0;
  const matchesPrevious = previousRoute.slice(0, -1).some((previousStart, index) => {
    const previousEnd = previousRoute[index + 1];
    return segmentsOverlap(from, to, previousStart, previousEnd) || axisSegmentDistance(from, to, previousStart, previousEnd) <= 2;
  });
  return matchesPrevious ? 0 : 12;
}

function segmentsOverlap(leftStart: Point, leftEnd: Point, rightStart: Point, rightEnd: Point): boolean {
  if (almostEqual(leftStart.y, leftEnd.y) && almostEqual(rightStart.y, rightEnd.y) && almostEqual(leftStart.y, rightStart.y)) {
    return Math.min(leftEnd.x, leftStart.x) < Math.max(rightEnd.x, rightStart.x) - EPSILON
      && Math.max(leftEnd.x, leftStart.x) > Math.min(rightEnd.x, rightStart.x) + EPSILON;
  }
  if (almostEqual(leftStart.x, leftEnd.x) && almostEqual(rightStart.x, rightEnd.x) && almostEqual(leftStart.x, rightStart.x)) {
    return Math.min(leftEnd.y, leftStart.y) < Math.max(rightEnd.y, rightStart.y) - EPSILON
      && Math.max(leftEnd.y, leftStart.y) > Math.min(rightEnd.y, rightStart.y) + EPSILON;
  }
  return false;
}

function segmentsCross(leftStart: Point, leftEnd: Point, rightStart: Point, rightEnd: Point): boolean {
  const leftHorizontal = almostEqual(leftStart.y, leftEnd.y);
  const rightHorizontal = almostEqual(rightStart.y, rightEnd.y);
  if (leftHorizontal === rightHorizontal) return false;
  const horizontalStart = leftHorizontal ? leftStart : rightStart;
  const horizontalEnd = leftHorizontal ? leftEnd : rightEnd;
  const verticalStart = leftHorizontal ? rightStart : leftStart;
  const verticalEnd = leftHorizontal ? rightEnd : leftEnd;
  return strictlyBetween(verticalStart.x, horizontalStart.x, horizontalEnd.x, 0)
    && strictlyBetween(horizontalStart.y, verticalStart.y, verticalEnd.y, 0);
}

function axisSegmentDistance(leftStart: Point, leftEnd: Point, rightStart: Point, rightEnd: Point): number {
  if (almostEqual(leftStart.y, leftEnd.y) && almostEqual(rightStart.y, rightEnd.y)) {
    if (Math.max(Math.min(leftEnd.x, leftStart.x), Math.min(rightEnd.x, rightStart.x)) <= Math.min(Math.max(leftEnd.x, leftStart.x), Math.max(rightEnd.x, rightStart.x))) return Math.abs(leftStart.y - rightStart.y);
    return Math.min(Math.abs(leftStart.x - rightEnd.x), Math.abs(rightStart.x - leftEnd.x));
  }
  if (almostEqual(leftStart.x, leftEnd.x) && almostEqual(rightStart.x, rightEnd.x)) {
    if (Math.max(Math.min(leftEnd.y, leftStart.y), Math.min(rightEnd.y, rightStart.y)) <= Math.min(Math.max(leftEnd.y, leftStart.y), Math.max(rightEnd.y, rightStart.y))) return Math.abs(leftStart.x - rightStart.x);
    return Math.min(Math.abs(leftStart.y - rightEnd.y), Math.abs(rightStart.y - leftEnd.y));
  }
  if (almostEqual(leftStart.y, leftEnd.y)) {
    const horizontal = leftStart;
    const vertical = rightStart;
    const horizontalRange = [Math.min(leftStart.x, leftEnd.x), Math.max(leftStart.x, leftEnd.x)];
    const verticalRange = [Math.min(rightStart.y, rightEnd.y), Math.max(rightStart.y, rightEnd.y)];
    const xDistance = vertical.x < horizontalRange[0] ? horizontalRange[0] - vertical.x : vertical.x > horizontalRange[1] ? vertical.x - horizontalRange[1] : 0;
    const yDistance = horizontal.y < verticalRange[0] ? verticalRange[0] - horizontal.y : horizontal.y > verticalRange[1] ? horizontal.y - verticalRange[1] : 0;
    return Math.hypot(xDistance, yDistance);
  }
  return axisSegmentDistance(rightStart, rightEnd, leftStart, leftEnd);
}

function fallbackOrthogonalRoute(from: Point, to: Point, obstacles: Rect[]): Point[] {
  const levels = uniqueSorted([from.y, to.y, ...obstacles.flatMap((rect) => [rect.top - 1, rect.bottom + 1])]);
  for (const y of levels) {
    const bends = [{ x: from.x, y }, { x: to.x, y }];
    if (clearSegment(from, bends[0], obstacles) && clearSegment(bends[0], bends[1], obstacles) && clearSegment(bends[1], to, obstacles)) return [from, ...bends, to];
  }
  const columns = uniqueSorted([from.x, to.x, ...obstacles.flatMap((rect) => [rect.left - 1, rect.right + 1])]);
  for (const x of columns) {
    const bends = [{ x, y: from.y }, { x, y: to.y }];
    if (clearSegment(from, bends[0], obstacles) && clearSegment(bends[0], bends[1], obstacles) && clearSegment(bends[1], to, obstacles)) return [from, ...bends, to];
  }
  // A route must remain orthogonal even when every detour is blocked. The
  // caller can still edit this dogleg, but it must never silently become a
  // diagonal connector.
  return [from, { x: to.x, y: from.y }, to];
}

function inflate(node: DiagramNode, padding: number): Rect {
  return {
    left: node.position.x - padding,
    right: node.position.x + node.size.width + padding,
    top: node.position.y - padding,
    bottom: node.position.y + node.size.height + padding,
  };
}

export function portDirection(port?: string): PortDirection | undefined {
  if (port === 'top' || port === 'north') return 'north';
  if (port === 'right' || port === 'east') return 'east';
  if (port === 'bottom' || port === 'south') return 'south';
  if (port === 'left' || port === 'west') return 'west';
  return undefined;
}

function routingDirection(endpoint: Endpoint, node: DiagramNode, boundary: Point, fallbackTarget: Point): Point {
  const explicit = portDirection(endpoint.port);
  if (!explicit) return exitDirection(node, boundary, fallbackTarget);
  const radians = node.rotation * Math.PI / 180;
  const local = explicit === 'north' ? { x: 0, y: -1 } : explicit === 'east' ? { x: 1, y: 0 } : explicit === 'south' ? { x: 0, y: 1 } : { x: -1, y: 0 };
  return {
    x: Math.round(local.x * Math.cos(radians) - local.y * Math.sin(radians)),
    y: Math.round(local.x * Math.sin(radians) + local.y * Math.cos(radians)),
  };
}

function markerTerminalLength(marker: EdgeMarker): number {
  switch (marker) {
    case 'arrow': return 14;
    case 'bar': return 10;
    case 'crowfoot': return 18;
    case 'circle-bar': return 22;
    case 'bar-crowfoot': return 24;
    case 'circle-crowfoot': return 26;
    case 'circle': return 12;
    default: return 0;
  }
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

function cardinalDirection(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
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

function stateKey(point: number, direction: number): string {
  return `${point}:${direction}`;
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
