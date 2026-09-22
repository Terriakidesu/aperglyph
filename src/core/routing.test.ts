import { describe, expect, it } from 'vitest';
import { createEdge, createNode } from './document';
import { calculateRouteJumps, curvedPath, edgeRoute, edgeRouting, jumpMaskPaths, pointsToPath } from './routing';

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
    expect(route[0].y).toBeCloseTo(34 + (300 - 34) * 0.5);
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
    expect(route[0].y).toBeCloseTo(34 + (300 - 34) * 0.75);
  });

  it('routes orthogonal connectors through axis-aligned bends', () => {
    const source = createNode('rectangle', { x: 0, y: 0 });
    const target = createNode('rectangle', { x: 300, y: 180 });
    const edge = createEdge({ nodeId: source.id, port: 'right' }, { nodeId: target.id, port: 'left' }, { type: 'orthogonal' });
    const route = edgeRoute(edge, source, target);
    expect(route.every((point, index) => index === 0 || point.x === route[index - 1].x || point.y === route[index - 1].y)).toBe(true);
    expect(pointsToPath(route)).toContain('L');
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
});

function segmentCrossesRect(start: { x: number; y: number }, end: { x: number; y: number }, node: ReturnType<typeof createNode>): boolean {
  if (start.y === end.y) return start.y > node.position.y && start.y < node.position.y + node.size.height && Math.max(start.x, end.x) > node.position.x && Math.min(start.x, end.x) < node.position.x + node.size.width;
  return start.x > node.position.x && start.x < node.position.x + node.size.width && Math.max(start.y, end.y) > node.position.y && Math.min(start.y, end.y) < node.position.y + node.size.height;
}
