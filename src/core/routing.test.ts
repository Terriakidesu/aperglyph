import { describe, expect, it } from 'vitest';
import { createEdge, createNode } from './document';
import { calculateRouteJumps, curvedPath, edgeRoute, edgeRouting, isValidOrthogonalRoute, jumpMaskPaths, MIN_SEGMENT_LENGTH, NODE_CLEARANCE, normalizeRoute, parallelRoutingLane, pointsToPath, PORT_STUB_LENGTH, portDirection, routeTurnPenalty, sortRoutesForJumps } from './routing';

describe('connector routing', () => {
  it('routes a straight connector between boundaries', () => {
    const source = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 100, height: 50 } });
    const target = createNode('rectangle', { x: 300, y: 0 }, { size: { width: 100, height: 50 } });
    const route = edgeRoute(createEdge({ nodeId: source.id }, { nodeId: target.id }), source, target);
    expect(route).toEqual([{ x: 100, y: 25 }, { x: 300, y: 25 }]);
  });

  it('separates parallel straight connectors without moving their endpoints', () => {
    const source = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 100, height: 50 } });
    const target = createNode('rectangle', { x: 300, y: 0 }, { size: { width: 100, height: 50 } });
    const edge = createEdge({ nodeId: source.id }, { nodeId: target.id }, { data: { parallelOffset: 20 } });
    const route = edgeRoute(edge, source, target);
    expect(route[0]).toEqual({ x: 100, y: 25 });
    expect(route.at(-1)).toEqual({ x: 300, y: 25 });
    expect(route[1].y).toBe(45);
  });

  it('uses plugin connector routing without losing the semantic edge type', () => {
    const source = createNode('entity', { x: 0, y: 0 });
    const target = createNode('entity', { x: 300, y: 0 });
    const edge = createEdge({ nodeId: source.id }, { nodeId: target.id }, { type: 'relationship' });
    expect(edgeRouting(edge)).toBe('orthogonal');
    const route = edgeRoute(edge, source, target, [source, target]);
    expect(route.every((point, index) => index === 0 || point.x === route[index - 1].x || point.y === route[index - 1].y)).toBe(true);
  });

  it('keeps ERD field connectors on their rows after resizing', () => {
    const source = createNode('entity', { x: 0, y: 0 }, {
      size: { width: 200, height: 300 },
      data: { label: 'users', fields: [
        { id: 'id', name: 'id', type: 'uuid', primaryKey: true, foreignKey: false, unique: false, nullable: false },
        { id: 'email', name: 'email', type: 'text', primaryKey: false, foreignKey: false, unique: false, nullable: false },
        { id: 'created', name: 'created', type: 'date', primaryKey: false, foreignKey: false, unique: false, nullable: false },
      ] },
    });
    const target = createNode('rectangle', { x: 400, y: 0 });
    const edge = createEdge({ nodeId: source.id, port: 'right', anchorId: 'field-1-right', offset: 0.8 }, { nodeId: target.id, port: 'left' });
    const route = edgeRoute(edge, source, target);
    expect(route[0].x).toBe(200);
    expect(route[0].y).toBeCloseTo(30 + (300 - 30) * 0.5);
  });

  it('faces ERD foreign-key endpoints toward the referenced table', () => {
    const source = createNode('entity', { x: 400, y: 0 }, { size: { width: 200, height: 80 }, data: { fields: [{ id: 'source-id', name: 'source_id' }, { id: 'ref', name: 'reference_id' }] } });
    const target = createNode('entity', { x: 0, y: 0 }, { size: { width: 200, height: 55 }, data: { fields: [{ id: 'target-id', name: 'target_id' }] } });
    const edge = createEdge(
      { nodeId: source.id, port: 'right', anchorId: 'field-1-right' },
      { nodeId: target.id, port: 'left', anchorId: 'field-0-left' },
      { type: 'relationship', data: { relationship: 'foreign-key' }, routing: { mode: 'simple' } },
    );
    const route = edgeRoute(edge, source, target, [source, target]);
    expect(route[0].x).toBe(400);
    expect(route.at(-1)?.x).toBe(200);
    expect(route[0].y).toBeGreaterThan(30);
    expect(route.at(-1)?.y).toBeGreaterThan(30);
  });

  it('derives field anchors for older ERD relationship metadata', () => {
    const source = createNode('entity', { x: 0, y: 0 }, {
      size: { width: 200, height: 300 },
      data: { label: 'users', fields: [
        { id: 'id', name: 'id', type: 'uuid', primaryKey: true, foreignKey: false, unique: false, nullable: false },
        { id: 'account', name: 'account_id', type: 'uuid', primaryKey: false, foreignKey: true, unique: false, nullable: false },
      ] },
    });
    const target = createNode('rectangle', { x: 400, y: 0 });
    const edge = createEdge({ nodeId: source.id, port: 'right', offset: 0.85 }, { nodeId: target.id, port: 'left' }, { data: { sourceFieldId: 'account' } });
    const route = edgeRoute(edge, source, target);
    expect(route[0].y).toBeCloseTo(30 + (300 - 30) * 0.75);
  });

  it('routes orthogonal connectors through axis-aligned bends', () => {
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 180 });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal' });
    const route = edgeRoute(edge, source, target);
    expect(route.every((point, index) => index === 0 || point.x === route[index - 1].x || point.y === route[index - 1].y)).toBe(true);
    expect(pointsToPath(route)).toContain('L');
  });

  it('scores terminal bends so facing row ports use two bends rather than four', () => {
    const source = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 100, height: 100 } });
    const target = createNode('rectangle', { x: 400, y: 200 }, { size: { width: 100, height: 100 } });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal', routing: { mode: 'simple' } });
    const route = edgeRoute(edge, source, target, [source, target]);
    expect(route).toHaveLength(4);
    expect(route[0].y).toBe(route[1].y);
    expect(route[1].x).toBe(route[2].x);
    expect(route[2].y).toBe(route[3].y);
  });

  it('increases turn penalties by tier, with no cost for a straight path', () => {
    expect([0, 1, 2, 3, 4, 5].map(routeTurnPenalty)).toEqual([0, 24, 200, 500, 1200, 2000]);
  });

  it('detours around nearby notation but ignores the same connector’s own notation', () => {
    const edge = createEdge(
      { point: { x: 0, y: 16 } },
      { point: { x: 100, y: 16 } },
      { type: 'orthogonal', routing: { mode: 'simple' } },
    );
    const irrelevantObstacle = createNode('rectangle', { x: 1000, y: 1000 }, { size: { width: 10, height: 10 } });
    const notation = { left: 40, top: -8, right: 60, bottom: 8 };
    const awayFromOtherNotation = edgeRoute(edge, undefined, undefined, [irrelevantObstacle], {
      markerObstacles: [{ edgeId: 'other-connector', bounds: notation }],
    });
    expect(awayFromOtherNotation).toHaveLength(4);
    expect(awayFromOtherNotation[1].y).toBe(20);
    expect(awayFromOtherNotation[1].y).toBe(awayFromOtherNotation[2].y);

    const ownNotation = edgeRoute(edge, undefined, undefined, [irrelevantObstacle], {
      markerObstacles: [{ edgeId: edge.id, bounds: notation }],
    });
    expect(ownNotation).toEqual([{ x: 0, y: 16 }, { x: 100, y: 16 }]);
  });

  it('treats an explicit port as authoritative for the first and last segment', () => {
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: -180 });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal' });
    const route = edgeRoute(edge, source, target);
    expect(route[1].x - route[0].x).toBeGreaterThanOrEqual(PORT_STUB_LENGTH);
    expect(route[1].y).toBe(route[0].y);
    expect(route.at(-1)!.x - route.at(-2)!.x).toBeGreaterThanOrEqual(PORT_STUB_LENGTH);
    expect(route.at(-1)!.y).toBe(route.at(-2)!.y);
  });

  it('normalizes cardinal port aliases and keeps node clearance separate from stubs', () => {
    expect(portDirection('right')).toBe('east');
    expect(portDirection('east')).toBe('east');
    expect(portDirection('center')).toBeUndefined();
    expect(NODE_CLEARANCE).not.toBe(PORT_STUB_LENGTH);
  });

  it('rejects invalid accelerated paths that are diagonal or cross obstacle interiors', () => {
    const start = { x: 0, y: 50 };
    const end = { x: 100, y: 50 };
    const obstacle = { left: 30, top: 30, right: 70, bottom: 70 };
    expect(isValidOrthogonalRoute([start, { x: 100, y: 100 }, end], start, end, [])).toBe(false);
    expect(isValidOrthogonalRoute([start, end], start, end, [obstacle])).toBe(false);
    expect(isValidOrthogonalRoute([start, { x: 0, y: 100 }, { x: 100, y: 100 }, end], start, end, [obstacle])).toBe(true);
  });

  it('assigns deterministic lanes to parallel orthogonal connectors', () => {
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 0 });
    const first = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal' });
    const second = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal' });
    const lane = parallelRoutingLane(second, [second, first]);
    expect(lane).toMatchObject({ count: 2, spacing: 16 });
    expect([0, 1]).toContain(lane?.index);
    expect(parallelRoutingLane(second, [first, second])).toEqual(lane);
    const route = edgeRoute(second, source, target, [source, target], { lane });
    expect(route.some((point) => point.y !== route[0].y)).toBe(true);
  });

  it('uses a nearby corridor for a second ERD relationship into an upper table', () => {
    const field = (id: string, name: string) => ({ id, name, type: 'bigint', primaryKey: name === 'id', foreignKey: name !== 'id', unique: false, nullable: false });
    const booking = createNode('entity', { x: -26, y: 181 }, { size: { width: 220, height: 142 }, data: { fields: [field('b0', 'id'), field('b1', 'customer_id'), field('b2', 'staff_id'), field('b3', 'package_id')] } });
    const transaction = createNode('entity', { x: -26, y: 359 }, { size: { width: 220, height: 115 }, data: { fields: [field('t0', 'id'), field('t1', 'booking_id'), field('t2', 'package_id')] } });
    const customer = createNode('entity', { x: -298, y: 84 }, { size: { width: 220, height: 61 }, data: { fields: [field('c0', 'id')] } });
    const staff = createNode('entity', { x: -26, y: 84 }, { size: { width: 220, height: 61 }, data: { fields: [field('s0', 'id')] } });
    const service = createNode('entity', { x: 246, y: 84 }, { size: { width: 220, height: 61 }, data: { fields: [field('p0', 'id')] } });
    const payment = createNode('entity', { x: -26, y: 510 }, { size: { width: 220, height: 88 } });
    const edge = createEdge({ nodeId: transaction.id, port: 'right', anchorId: 'field-2-right', offset: 0.88 }, { nodeId: service.id, port: 'left', anchorId: 'field-0-left', offset: 0.5 }, { type: 'relationship', routing: { mode: 'auto' }, data: { relationship: 'foreign-key' } });
    const route = edgeRoute(edge, transaction, service, [customer, staff, service, booking, transaction, payment], {
      otherRoutes: [
        [{ x: -26, y: 255.5 }, { x: -50, y: 255.5 }, { x: -50, y: 165 }, { x: -54, y: 165 }, { x: -54, y: 131.5 }, { x: -78, y: 131.5 }],
        [{ x: 194, y: 282.5 }, { x: 218, y: 282.5 }, { x: 218, y: 131.5 }, { x: 194, y: 131.5 }],
        [{ x: 194, y: 309.5 }, { x: 220, y: 309.5 }, { x: 220, y: 339 }, { x: 222, y: 339 }, { x: 222, y: 131.5 }, { x: 246, y: 131.5 }],
        [{ x: 194, y: 433.5 }, { x: 222, y: 433.5 }, { x: 222, y: 228.5 }, { x: 194, y: 228.5 }],
      ],
    });
    expect(Math.max(...route.map((point) => point.x)), JSON.stringify(route)).toBeLessThan(320);
  });

  it('uses the previous route as a stability preference when it remains clear', () => {
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 180 });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal' });
    const previous = edgeRoute(edge, source, target, [source, target]);
    const next = edgeRoute(edge, source, target, [source, target], { previousRoute: previous });
    expect(next).toEqual(previous);
  });

  it('handles diagonal existing routes when an edge changes to orthogonal routing', () => {
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 180 });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal' });
    expect(() => edgeRoute(edge, source, target, [source, target], {
      otherRoutes: [[{ x: 100, y: 50 }, { x: 240, y: 140 }]],
    })).not.toThrow();
  });

  it('honors hard route constraints and simple routing mode', () => {
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 180 });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, {
      type: 'orthogonal',
      routing: { mode: 'manual', constraints: [{ axis: 'y', value: 140, strength: 'hard' }] },
    });
    const route = edgeRoute(edge, source, target);
    expect(route.some((point) => point.y === 140)).toBe(true);
    const simple = edgeRoute({ ...edge, routing: { mode: 'simple' }, }, source, target);
    expect(simple.length).toBeLessThanOrEqual(5);
  });

  it('uses nearby lanes to avoid reusing an occupied path in simple mode', () => {
    const source = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 100, height: 100 } });
    const target = createNode('rectangle', { x: 276, y: 100 }, { size: { width: 100, height: 100 } });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal', routing: { mode: 'simple' } });
    const occupied = [{ x: 124, y: 50 }, { x: 252, y: 50 }, { x: 252, y: 150 }];
    const route = edgeRoute(edge, source, target, [source, target], { otherRoutes: [occupied] });
    expect(route).toContainEqual({ x: 124, y: 150 });
    expect(route).not.toContainEqual({ x: 252, y: 50 });
  });

  it.each(['auto', 'simple'] as const)('does not add turns just to stay farther from nearby wires in %s mode', (mode) => {
    const edge = createEdge({ point: { x: 0, y: 50 } }, { point: { x: 300, y: 50 } }, { type: 'orthogonal', routing: { mode } });
    const irrelevantObstacle = createNode('rectangle', { x: 1000, y: 1000 }, { size: { width: 10, height: 10 } });
    const nearbyRoutes = [54, 58, 62].map((y) => [{ x: 0, y }, { x: 300, y }]);
    expect(edgeRoute(edge, undefined, undefined, [irrelevantObstacle], { otherRoutes: nearbyRoutes })).toEqual([
      { x: 0, y: 50 }, { x: 300, y: 50 },
    ]);
  });

  it.each(['auto', 'simple'] as const)('prefers one clean crossing over an unnecessary dogleg in %s mode', (mode) => {
    const edge = createEdge({ point: { x: 0, y: 50 } }, { point: { x: 300, y: 50 } }, { type: 'orthogonal', routing: { mode } });
    const irrelevantObstacle = createNode('rectangle', { x: 1000, y: 1000 }, { size: { width: 10, height: 10 } });
    const oneCrossing = [[{ x: 150, y: 30 }, { x: 150, y: 70 }]];
    expect(edgeRoute(edge, undefined, undefined, [irrelevantObstacle], { otherRoutes: oneCrossing })).toEqual([
      { x: 0, y: 50 }, { x: 300, y: 50 },
    ]);
  });

  it.each(['auto', 'simple'] as const)('uses a two-bend channel around a cluster instead of weaving through it in %s mode', (mode) => {
    const edge = createEdge({ point: { x: 0, y: 50 } }, { point: { x: 300, y: 50 } }, { type: 'orthogonal', routing: { mode } });
    const irrelevantObstacle = createNode('rectangle', { x: 1000, y: 1000 }, { size: { width: 10, height: 10 } });
    const crossings = [100, 200].map((x) => [{ x, y: 30 }, { x, y: 70 }]);
    const route = edgeRoute(edge, undefined, undefined, [irrelevantObstacle], { otherRoutes: crossings });
    expect(route).toHaveLength(4);
    expect(route[1].y).toBe(route[2].y);
    expect(route[1].y < 30 || route[1].y > 70).toBe(true);
    expect(crossesRoutes(route, crossings)).toBe(false);
  });

  it('chooses the shorter clear corridor when direct doglegs are blocked', () => {
    const edge = createEdge({ point: { x: 0, y: 70 } }, { point: { x: 100, y: 70 } }, { type: 'orthogonal', routing: { mode: 'simple' } });
    const blocker = createNode('rectangle', { x: 40, y: 30 }, { size: { width: 20, height: 60 } });
    const lowerCorridor = blocker.position.y + blocker.size.height + NODE_CLEARANCE;
    expect(edgeRoute(edge, undefined, undefined, [blocker])).toEqual([
      { x: 0, y: 70 },
      { x: 0, y: lowerCorridor },
      { x: 100, y: lowerCorridor },
      { x: 100, y: 70 },
    ]);
  });

  it('uses an obstacle-aware search instead of crossing a table when no simple corridor is clear', () => {
    const edge = createEdge({ point: { x: 0, y: 100 } }, { point: { x: 400, y: 100 } }, { type: 'orthogonal', routing: { mode: 'simple' } });
    const obstacles = [
      createNode('rectangle', { x: 150, y: 80 }, { size: { width: 100, height: 40 } }),
      createNode('rectangle', { x: -5, y: 0 }, { size: { width: 10, height: 80 } }),
      createNode('rectangle', { x: -5, y: 120 }, { size: { width: 10, height: 80 } }),
      createNode('rectangle', { x: 395, y: 0 }, { size: { width: 10, height: 80 } }),
      createNode('rectangle', { x: 395, y: 120 }, { size: { width: 10, height: 80 } }),
    ];
    const route = edgeRoute(edge, undefined, undefined, obstacles);
    expect(route.length).toBeGreaterThan(4);
    expect(route.every((point, index) => index === 0 || point.x === route[index - 1].x || point.y === route[index - 1].y)).toBe(true);
    expect(route.slice(1).some((point, index) => obstacles.some((node) => segmentCrossesRect(route[index], point, node)))).toBe(false);
  });

  it('normalizes duplicate and collinear points and rounds orthogonal corners', () => {
    expect(normalizeRoute([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }])).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }]);
    expect(MIN_SEGMENT_LENGTH).toBe(12);
    expect(pointsToPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], [], 8)).toContain('Q 100 0');
  });

  it('routes around an intervening node instead of crossing its bounds', () => {
    const source = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 90, height: 60 } });
    const target = createNode('rectangle', { x: 330, y: 0 }, { size: { width: 90, height: 60 } });
    const blocker = createNode('rectangle', { x: 160, y: -25 }, { size: { width: 90, height: 110 } });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal' });
    const route = edgeRoute(edge, source, target, [source, target, blocker]);
    expect(route.slice(1).every((point, index) => {
      const previous = route[index];
      return previous.x === point.x || previous.y === point.y;
    })).toBe(true);
    expect(route.some((point) => point.y < blocker.position.y || point.y > blocker.position.y + blocker.size.height)).toBe(true);
    expect(route.slice(1).some((point, index) => segmentCrossesRect(route[index], point, blocker))).toBe(false);
  });

  it('supports free-standing connector endpoints', () => {
    const edge = createEdge({ point: { x: 40, y: 80 } }, { point: { x: 300, y: 220 } });
    expect(edgeRoute(edge)).toEqual([{ x: 40, y: 80 }, { x: 300, y: 220 }]);
  });

  it('renders a self-loop outside the owning node', () => {
    const node = createNode('rectangle', { x: 100, y: 100 }, { size: { width: 120, height: 70 } });
    const edge = createEdge({ nodeId: node.id, port: 'right' }, { nodeId: node.id, port: 'bottom' }, { type: 'orthogonal' });
    const route = edgeRoute(edge, node, node, [node]);
    expect(route.length).toBeGreaterThan(2);
    expect(route[0]).toEqual({ x: 220, y: 135 });
    expect(route.at(-1)).toEqual({ x: 160, y: 170 });
    expect(route.some((point) => point.x > 220)).toBe(true);
  });

  it('chooses a free side for an automatic self-loop', () => {
    const node = createNode('rectangle', { x: 100, y: 100 }, { size: { width: 120, height: 70 } });
    const blocker = createNode('rectangle', { x: 260, y: 90 }, { size: { width: 100, height: 90 } });
    const edge = createEdge({ nodeId: node.id }, { nodeId: node.id }, { type: 'orthogonal' });
    const route = edgeRoute(edge, node, node, [node, blocker]);
    expect(route.some((point) => point.x < node.position.x)).toBe(true);
  });

  it('keeps free endpoint marker directions outside the connector', () => {
    const edge = createEdge({ point: { x: 40, y: 80 } }, { point: { x: 300, y: 220 } });
    const route = edgeRoute(edge);
    const sourceDirection = { x: route[0].x - route[1].x, y: route[0].y - route[1].y };
    const targetDirection = { x: route[1].x - route[0].x, y: route[1].y - route[0].y };
    expect(sourceDirection.x).toBeLessThan(0);
    expect(targetDirection.x).toBeGreaterThan(0);
  });

  it('uses endpoint tangents for curved connectors', () => {
    const path = curvedPath([{ x: 100, y: 20 }, { x: 100, y: 280 }], { x: 0, y: 1 }, { x: 0, y: 1 });
    expect(path).toContain('C 100 129.2, 100 170.8, 100 280');
  });

  it('adds a bridge to the later orthogonal route at a crossing', () => {
    const routes = [
      { id: 'horizontal', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
      { id: 'vertical', points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] },
    ];
    const jumps = calculateRouteJumps(routes);
    expect(jumps.get('horizontal')).toHaveLength(0);
    expect(jumps.get('vertical')).toEqual([{ segmentIndex: 0, point: { x: 50, y: 50 }, orientation: 'vertical' }]);
    expect(pointsToPath(routes[1].points, jumps.get('vertical'))).toContain('Q 57 50 50 58');
    expect(jumpMaskPaths(routes[1].points, jumps.get('vertical') ?? [])).toEqual(['M 50 42 L 50 58']);
  });

  it('keeps the higher-priority connector continuous at a crossing', () => {
    const routes = [
      { id: 'horizontal', crossingPriority: 10, points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
      { id: 'vertical', crossingPriority: 0, points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] },
    ];
    const jumps = calculateRouteJumps(routes);
    expect(jumps.get('horizontal')).toEqual([{ segmentIndex: 0, point: { x: 50, y: 50 }, orientation: 'horizontal' }]);
    expect(jumps.get('vertical')).toHaveLength(0);
  });

  it('allows a bridge near the OTHER wire bend when the jumping wire has room', () => {
    const routes = [
      { id: 'bent', points: [{ x: 0, y: 50 }, { x: 25, y: 50 }, { x: 100, y: 50 }] },
      { id: 'near-bend', points: [{ x: 19, y: 0 }, { x: 19, y: 100 }] },
      { id: 'near-endpoint', points: [{ x: 70, y: 0 }, { x: 70, y: 65 }] },
    ];
    const jumps = calculateRouteJumps(routes);
    expect(jumps.get('bent')).toHaveLength(0);
    expect(jumps.get('near-bend')).toEqual([{ segmentIndex: 0, point: { x: 19, y: 50 }, orientation: 'vertical' }]);
    expect(jumps.get('near-endpoint')).toEqual([{ segmentIndex: 0, point: { x: 70, y: 50 }, orientation: 'vertical' }]);
  });

  it('does not bridge a clear crossing crowded by a nearby connector junction', () => {
    const routes = [
      { id: 'horizontal', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
      { id: 'vertical', points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] },
      { id: 'branch', points: [{ x: 50, y: 50 }, { x: 50, y: 90 }] },
    ];
    const jumps = calculateRouteJumps(routes);
    expect(jumps.get('horizontal')).toHaveLength(0);
    expect(jumps.get('vertical')).toHaveLength(0);
  });

  it('does not hide a bridge because an unrelated route has a nearby bend', () => {
    const jumps = calculateRouteJumps([
      { id: 'a-horizontal', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
      { id: 'z-vertical', points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] },
      { id: 'nearby', points: [{ x: 65, y: 30 }, { x: 65, y: 55 }, { x: 95, y: 55 }] },
    ]);
    expect(jumps.get('z-vertical')).toContainEqual({ segmentIndex: 0, point: { x: 50, y: 50 }, orientation: 'vertical' });
  });

  it('paints the selected or later-id route last for consistent bridges', () => {
    const routes = sortRoutesForJumps([
      { id: 'z-route', crossingPriority: 1 },
      { id: 'b-route', crossingPriority: 0 },
      { id: 'a-route', crossingPriority: 0 },
    ]);
    expect(routes.map((route) => route.id)).toEqual(['a-route', 'b-route', 'z-route']);
  });
});

function segmentCrossesRect(start: { x: number; y: number }, end: { x: number; y: number }, node: ReturnType<typeof createNode>): boolean {
  if (start.y === end.y) return start.y > node.position.y && start.y < node.position.y + node.size.height && Math.max(start.x, end.x) > node.position.x && Math.min(start.x, end.x) < node.position.x + node.size.width;
  return start.x > node.position.x && start.x < node.position.x + node.size.width && Math.max(start.y, end.y) > node.position.y && Math.min(start.y, end.y) < node.position.y + node.size.height;
}

function crossesRoutes(route: { x: number; y: number }[], others: { x: number; y: number }[][]): boolean {
  return route.slice(1).some((end, index) => others.some((other) => other.slice(1).some((otherEnd, otherIndex) => {
    const start = route[index];
    const otherStart = other[otherIndex];
    if (start.y === end.y && otherStart.x === otherEnd.x) {
      return otherStart.x > Math.min(start.x, end.x) && otherStart.x < Math.max(start.x, end.x)
        && start.y > Math.min(otherStart.y, otherEnd.y) && start.y < Math.max(otherStart.y, otherEnd.y);
    }
    if (start.x === end.x && otherStart.y === otherEnd.y) {
      return start.x > Math.min(otherStart.x, otherEnd.x) && start.x < Math.max(otherStart.x, otherEnd.x)
        && otherStart.y > Math.min(start.y, end.y) && otherStart.y < Math.max(start.y, end.y);
    }
    return false;
  })));
}
