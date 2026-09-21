import { entityFieldPortOffset, normalizeEntityFields } from './erd';
import { nodeCenter, nodeConnectionPoint } from './geometry';
import type { ConnectionPort } from './geometry';
import type { DiagramNode, Point } from './types';
import type { ShapeAnchor, ShapeAnchorResolver } from '../plugins/types';

export interface ResolvedConnectionAnchor {
  anchor: ShapeAnchor & { nodeId: string };
  point: Point;
  /** Unrotated world coordinates, useful for rendering a node-local port. */
  localPoint: Point;
}

const cardinalPorts: ConnectionPort[] = ['top', 'right', 'bottom', 'left'];

/** Default anchors shared by every shape in the library. */
export const cardinalAnchors: ShapeAnchorResolver = () => cardinalPorts.map((port) => ({ id: port, port }));

/** ERD anchors include the standard perimeter points and one point per field row. */
export const entityFieldAnchors: ShapeAnchorResolver = (node) => {
  const fields = normalizeEntityFields(node.data.fields);
  const columnHeaders = node.data.columnHeaders === true;
  const anchors: ShapeAnchor[] = [
    { id: 'top', port: 'top' },
    { id: 'bottom', port: 'bottom' },
  ];
  fields.forEach((_, index) => {
    const offset = entityFieldPortOffset(fields, index, columnHeaders);
    anchors.push({ id: `field-${index}-left`, port: 'left', offset });
    anchors.push({ id: `field-${index}-right`, port: 'right', offset });
  });
  return anchors;
};

/**
 * Resolves definition-provided anchors and falls back to the same four
 * cardinal points for unknown or legacy nodes.
 */
export function connectionAnchorPoints(node: DiagramNode, resolver?: ShapeAnchorResolver): ResolvedConnectionAnchor[] {
  const anchors = resolver?.(node) ?? cardinalAnchors(node);
  const center = nodeCenter(node);
  return anchors.map((anchor) => {
    const point = nodeConnectionPoint(node, center, anchor.port, anchor.offset);
    return {
      anchor: { nodeId: node.id, ...anchor },
      point,
      localPoint: rotateAround(point, center, -node.rotation),
    };
  });
}

function rotateAround(point: Point, center: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
}
