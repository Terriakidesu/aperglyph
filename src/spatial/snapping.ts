import type { DiagramNode, Point } from '../core/types';

export interface AlignmentGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
}

export interface SnapOptions {
  gridSize: number;
  snapToGrid: boolean;
  /** Master switch used by the editor's Snap control. */
  snapToObjects?: boolean;
  threshold: number;
}

export interface SnapResult {
  positions: Record<string, Point>;
  guides: AlignmentGuide[];
}

export interface DragSnapModifiers {
  /** Constrain the movement to the dominant axis, as used by Shift-drag. */
  constrainAxis?: boolean;
  /** Alt/Option is a temporary, per-drag snapping override. */
  disableSnapping?: boolean;
}

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/** Snap a moving selection to a grid and to nearby node edges/centers. */
export function snapNodes(
  movingNodes: DiagramNode[],
  desiredPositions: Record<string, Point>,
  candidateNodes: DiagramNode[],
  options: SnapOptions,
): SnapResult {
  const positions = { ...desiredPositions };
  const movingBounds = selectionBounds(movingNodes, positions);
  if (!movingBounds) return { positions, guides: [] };

  if (options.snapToGrid && options.gridSize > 0) {
    const gridDelta = {
      x: Math.round(movingBounds.minX / options.gridSize) * options.gridSize - movingBounds.minX,
      y: Math.round(movingBounds.minY / options.gridSize) * options.gridSize - movingBounds.minY,
    };
    shiftPositions(positions, gridDelta);
    movingBounds.minX += gridDelta.x;
    movingBounds.maxX += gridDelta.x;
    movingBounds.minY += gridDelta.y;
    movingBounds.maxY += gridDelta.y;
  }

  const movingIds = new Set(movingNodes.map((node) => node.id));
  const candidates = options.snapToObjects === false ? [] : candidateNodes.filter((node) => !movingIds.has(node.id));
  const xMatch = closestMatch(axisTargets(movingBounds.minX, movingBounds.maxX), candidates.flatMap((node) => {
    const bounds = nodeBounds(node);
    return axisTargets(bounds.minX, bounds.maxX).map((target) => ({ value: target, nodeBounds: bounds }));
  }), options.threshold);
  const yMatch = closestMatch(axisTargets(movingBounds.minY, movingBounds.maxY), candidates.flatMap((node) => {
    const bounds = nodeBounds(node);
    return axisTargets(bounds.minY, bounds.maxY).map((target) => ({ value: target, nodeBounds: bounds }));
  }), options.threshold);

  const guides: AlignmentGuide[] = [];
  if (xMatch) {
    const delta = xMatch.value - xMatch.source;
    shiftPositions(positions, { x: delta, y: 0 });
    movingBounds.minX += delta;
    movingBounds.maxX += delta;
    guides.push({ orientation: 'vertical', position: xMatch.value, start: Math.min(movingBounds.minY, xMatch.nodeBounds.minY) - 28, end: Math.max(movingBounds.maxY, xMatch.nodeBounds.maxY) + 28 });
  }
  if (yMatch) {
    const delta = yMatch.value - yMatch.source;
    shiftPositions(positions, { x: 0, y: delta });
    movingBounds.minY += delta;
    movingBounds.maxY += delta;
    guides.push({ orientation: 'horizontal', position: yMatch.value, start: Math.min(movingBounds.minX, yMatch.nodeBounds.minX) - 28, end: Math.max(movingBounds.maxX, yMatch.nodeBounds.maxX) + 28 });
  }
  return { positions, guides };
}

/**
 * Resolve a drag in one place for both the animation preview and pointer
 * release. Keeping this calculation pure prevents a quick release from
 * committing a different position than the one shown during the drag.
 */
export function snapDraggedNodes(
  movingNodes: DiagramNode[],
  initialPositions: Record<string, Point>,
  start: Point,
  current: Point,
  candidateNodes: DiagramNode[],
  options: SnapOptions,
  modifiers: DragSnapModifiers = {},
): SnapResult {
  const rawDelta = { x: current.x - start.x, y: current.y - start.y };
  const delta = modifiers.constrainAxis
    ? Math.abs(rawDelta.x) >= Math.abs(rawDelta.y) ? { x: rawDelta.x, y: 0 } : { x: 0, y: rawDelta.y }
    : rawDelta;
  const desiredPositions = Object.fromEntries(
    Object.entries(initialPositions).map(([id, position]) => [id, { x: position.x + delta.x, y: position.y + delta.y }]),
  );
  const snappingEnabled = options.snapToGrid && !modifiers.disableSnapping;
  return snapNodes(movingNodes, desiredPositions, candidateNodes, {
    ...options,
    snapToGrid: snappingEnabled,
    snapToObjects: snappingEnabled && options.snapToObjects !== false,
  });
}

function selectionBounds(nodes: DiagramNode[], positions: Record<string, Point>): Bounds | null {
  if (nodes.length === 0) return null;
  const bounds = nodes.map((node) => {
    const position = positions[node.id] ?? node.position;
    return { minX: position.x, minY: position.y, maxX: position.x + node.size.width, maxY: position.y + node.size.height };
  });
  return {
    minX: Math.min(...bounds.map((item) => item.minX)),
    minY: Math.min(...bounds.map((item) => item.minY)),
    maxX: Math.max(...bounds.map((item) => item.maxX)),
    maxY: Math.max(...bounds.map((item) => item.maxY)),
  };
}

function nodeBounds(node: DiagramNode): Bounds {
  return { minX: node.position.x, minY: node.position.y, maxX: node.position.x + node.size.width, maxY: node.position.y + node.size.height };
}

function axisTargets(min: number, max: number): number[] {
  return [min, (min + max) / 2, max];
}

function closestMatch(sourceTargets: number[], targetTargets: Array<{ value: number; nodeBounds: Bounds }>, threshold: number): { source: number; value: number; nodeBounds: Bounds } | null {
  let best: { source: number; value: number; nodeBounds: Bounds; distance: number } | null = null;
  sourceTargets.forEach((source) => targetTargets.forEach((target) => {
    const distance = Math.abs(target.value - source);
    if (distance <= threshold && (!best || distance < best.distance)) best = { source, value: target.value, nodeBounds: target.nodeBounds, distance };
  }));
  return best;
}

function shiftPositions(positions: Record<string, Point>, delta: Point): void {
  Object.keys(positions).forEach((id) => {
    positions[id] = { x: positions[id].x + delta.x, y: positions[id].y + delta.y };
  });
}
