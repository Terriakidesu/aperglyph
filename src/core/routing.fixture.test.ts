import crmProject from '../../tests/fixtures/crm-physical-database.wdiag?raw';
import { expect, test } from 'vitest';
import { parseProject } from './document';
import { calculateRouteJumps, diagramRoutes, endpointMarkerObstacles } from './routing';

test('CRMMDSS physical database routes preserve all tables and use compact field-to-field self references', () => {
  const document = parseProject(crmProject);
  const page = document.pages[0];
  const optimizedNodes = page.nodes;
  const after = collectRoutes(page.nodes, page.edges);
  const report = {
    tables: optimizedNodes.length,
    relationships: page.edges.length,
    after: { bends: after.totalBends, maxBends: after.maxBends, crossings: after.crossings, tableIntersections: after.tableIntersections, visibleJumps: after.visibleJumps },
    selfReferences: page.edges.filter((edge) => edge.source.nodeId === edge.target.nodeId).map((edge) => ({
      table: page.nodes.find((node) => node.id === edge.source.nodeId)?.data.label,
      bends: after.bendsByEdge.find((route) => route.edgeId === edge.id)?.bends,
    })),
    worstRoutes: after.bendsByEdge.sort((a, b) => b.bends - a.bends).slice(0, 5).map((route) => ({
      ...route,
      points: after.routes.find((candidate) => candidate.edgeId === route.edgeId)?.points,
    })),
  };
  console.info(JSON.stringify(report));

  expect(optimizedNodes.filter((node) => node.type === 'entity')).toHaveLength(49);
  expect(page.edges).toHaveLength(59);
  expect(after.routes.every(({ points }) => points.length >= 2 && points.every((point, index) => index === 0 || sameAxis(points[index - 1], point)))).toBe(true);
  expect(after.tableIntersections).toBe(0);
  expect(after.totalBends).toBeLessThanOrEqual(188);
  expect(after.maxBends).toBeLessThanOrEqual(8);
  expect(after.crossings).toBeLessThanOrEqual(100);
  for (const edge of page.edges.filter((edge) => edge.source.nodeId === edge.target.nodeId)) {
    const route = after.routes.find((route) => route.edgeId === edge.id)!;
    expect(countBends(route.points), edge.id).toBe(2);
    const owner = page.nodes.find((node) => node.id === edge.source.nodeId)!;
    expect(route.points.slice(1).some((end, index) => segmentIntersectsNode(route.points[index], end, owner)), edge.id).toBe(false);
  }
}, 60000);

function collectRoutes(nodes: ReturnType<typeof parseProject>['pages'][number]['nodes'], edges: ReturnType<typeof parseProject>['pages'][number]['edges']) {
  const routed = diagramRoutes(nodes, edges);
  const routes = routed.map((route) => ({ edgeId: route.id, points: route.points }));
  const jumps = calculateRouteJumps(routed);
  const markers = endpointMarkerObstacles(nodes, edges);

  const bendsByEdge = routes.map(({ edgeId, points }) => ({ edgeId, bends: countBends(points) }));
  const segments = routes.flatMap(({ edgeId, points }) => points.slice(1).map((end, index) => ({ edgeId, start: points[index], end })));
  let tableIntersections = 0;
  let crossings = 0;

  for (const { edgeId, start, end } of segments) {
    const edge = edges.find((candidate) => candidate.id === edgeId)!;
    for (const node of nodes) {
      if (node.id === edge.source.nodeId || node.id === edge.target.nodeId) continue;
      if (segmentIntersectsNode(start, end, node)) tableIntersections += 1;
    }
  }

  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const a = segments[left];
      const b = segments[right];
      if (a.edgeId !== b.edgeId && segmentsCross(a.start, a.end, b.start, b.end)) crossings += 1;
    }
  }

  return {
    routes,
    bendsByEdge,
    totalBends: bendsByEdge.reduce((total, route) => total + route.bends, 0),
    maxBends: Math.max(...bendsByEdge.map((route) => route.bends)),
    crossings,
    tableIntersections,
    visibleJumps: [...jumps.values()].reduce((total, value) => total + value.length, 0),
    markerZones: markers.length,
  };
}

function countBends(points: Array<{ x: number; y: number }>): number {
  let bends = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    if (!sameAxis(points[index - 1], points[index]) || !sameAxis(points[index], points[index + 1])) continue;
    const beforeVertical = Math.abs(points[index - 1].x - points[index].x) < 0.01;
    const afterVertical = Math.abs(points[index].x - points[index + 1].x) < 0.01;
    if (beforeVertical !== afterVertical) bends += 1;
  }
  return bends;
}

function sameAxis(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01;
}

function segmentsCross(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): boolean {
  const aHorizontal = Math.abs(a.y - b.y) < 0.01;
  const bHorizontal = Math.abs(c.y - d.y) < 0.01;
  if (aHorizontal === bHorizontal) return false;
  const horizontalStart = aHorizontal ? a : c;
  const horizontalEnd = aHorizontal ? b : d;
  const verticalStart = aHorizontal ? c : a;
  const verticalEnd = aHorizontal ? d : b;
  return verticalStart.x > Math.min(horizontalStart.x, horizontalEnd.x) + 1
    && verticalStart.x < Math.max(horizontalStart.x, horizontalEnd.x) - 1
    && horizontalStart.y > Math.min(verticalStart.y, verticalEnd.y) + 1
    && horizontalStart.y < Math.max(verticalStart.y, verticalEnd.y) - 1;
}

function segmentIntersectsNode(start: { x: number; y: number }, end: { x: number; y: number }, node: { position: { x: number; y: number }; size: { width: number; height: number } }): boolean {
  const right = node.position.x + node.size.width;
  const bottom = node.position.y + node.size.height;
  if (Math.abs(start.y - end.y) < 0.01) {
    return start.y > node.position.y + 0.5 && start.y < bottom - 0.5
      && Math.max(start.x, end.x) > node.position.x + 0.5 && Math.min(start.x, end.x) < right - 0.5;
  }
  if (Math.abs(start.x - end.x) < 0.01) {
    return start.x > node.position.x + 0.5 && start.x < right - 0.5
      && Math.max(start.y, end.y) > node.position.y + 0.5 && Math.min(start.y, end.y) < bottom - 0.5;
  }
  return true;
}
