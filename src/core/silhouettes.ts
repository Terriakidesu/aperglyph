import type { DiagramNode, Point } from './types';

export type SilhouettePart =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; radius?: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'polygon'; points: Point[] }
  | { kind: 'path'; d: string; fillRule?: 'nonzero' | 'evenodd' }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number };

export interface ShapeSilhouette {
  parts: SilhouettePart[];
}

/**
 * Shared geometry for built-in silhouettes. Canvas and SVG export consume the
 * same local-coordinate primitives so previews, hit testing, and exports do
 * not drift apart as the stencil library grows.
 */
export function shapeSilhouette(renderer: string, width: number, height: number, radius = 0): ShapeSilhouette | null {
  const corner = Math.min(Math.max(0, radius), width / 2, height / 2);
  switch (renderer) {
    case 'rectangle':
    case 'text':
    case 'external':
    case 'gane-external':
    case 'schema':
      return { parts: [{ kind: 'rect', x: 0, y: 0, width, height, radius: renderer === 'schema' ? 0 : corner }] };
    case 'gane-process':
      return { parts: [{ kind: 'rect', x: 0, y: 0, width, height, radius: Math.min(10, height / 2) }] };
    case 'rounded-rectangle':
    case 'callout':
    case 'start':
      return { parts: [{ kind: 'rect', x: 0, y: 0, width, height, radius: Math.min(corner || 22, height / 2) }] };
    case 'use-case':
      return { parts: [{ kind: 'ellipse', cx: width / 2, cy: height / 2, rx: width / 2, ry: height / 2 }] };
    case 'ellipse':
    case 'circle':
      return { parts: [{ kind: 'ellipse', cx: width / 2, cy: height / 2, rx: width / 2, ry: height / 2 }] };
    case 'diamond':
    case 'decision':
      return { parts: [{ kind: 'polygon', points: polygon([[width / 2, 0], [width, height / 2], [width / 2, height], [0, height / 2]]) }] };
    case 'triangle':
      return { parts: [{ kind: 'polygon', points: polygon([[width / 2, 0], [width, height], [0, height]]) }] };
    case 'hexagon':
    case 'loop-limit': {
      const inset = Math.min(width * .2, height * .45);
      return { parts: [{ kind: 'polygon', points: polygon([[inset, 0], [width - inset, 0], [width, height / 2], [width - inset, height], [inset, height], [0, height / 2]]) }] };
    }
    case 'pentagon':
      return { parts: [{ kind: 'polygon', points: polygon([[width * .2, 0], [width * .8, 0], [width, height * .52], [width / 2, height], [0, height * .52]]) }] };
    case 'parallelogram':
    case 'input': {
      const slant = Math.min(28, width * .22);
      return { parts: [{ kind: 'polygon', points: polygon([[slant, 0], [width, 0], [width - slant, height], [0, height]]) }] };
    }
    case 'manual-input':
      return { parts: [{ kind: 'polygon', points: polygon([[0, height * .2], [width, 0], [width, height], [0, height]]) }] };
    case 'trapezoid':
    case 'manual-operation': {
      const inset = Math.min(28, width * .2);
      return { parts: [{ kind: 'polygon', points: polygon([[inset, 0], [width - inset, 0], [width, height], [0, height]]) }] };
    }
    case 'preparation': {
      const inset = Math.min(28, width * .16);
      return { parts: [{ kind: 'polygon', points: polygon([[inset, 0], [width - inset, 0], [width, height / 2], [width - inset, height], [inset, height], [0, height / 2]]) }] };
    }
    case 'merge':
      return { parts: [{ kind: 'polygon', points: polygon([[0, 0], [width, 0], [width / 2, height]]) }] };
    case 'extract':
      return { parts: [{ kind: 'polygon', points: polygon([[width / 2, 0], [width, height], [0, height]]) }] };
    case 'sort':
      return { parts: [{ kind: 'polygon', points: polygon([[width / 2, 0], [width, height / 2], [width / 2, height], [0, height / 2]]) }, { kind: 'line', x1: width * .18, y1: height / 2, x2: width * .82, y2: height / 2 }] };
    case 'collate':
      return { parts: [{ kind: 'polygon', points: polygon([[0, 0], [width, 0], [width * .64, height / 2], [width, height], [0, height], [width * .36, height / 2]]) }] };
    case 'cylinder':
    case 'database':
      return { parts: [{ kind: 'path', d: cylinderPath(width, height) }, { kind: 'path', d: `M 0 ${height * .18} C 0 ${height * .36} ${width} ${height * .36} ${width} ${height * .18}` }] };
    case 'cloud':
      return { parts: [{ kind: 'path', d: cloudPath(width, height) }] };
    case 'document':
      return { parts: [{ kind: 'path', d: documentPath(width, height) }] };
    case 'multiple-document':
      return { parts: [
        { kind: 'path', d: documentPath(width - 16, height - 8, 0, 8) },
        { kind: 'path', d: documentPath(width - 8, height - 4, 8, 4) },
        { kind: 'path', d: documentPath(width - 16, height, 16, 0) },
      ] };
    case 'predefined-process':
      return { parts: [{ kind: 'rect', x: 0, y: 0, width, height }, { kind: 'line', x1: 16, y1: 0, x2: 16, y2: height }, { kind: 'line', x1: width - 16, y1: 0, x2: width - 16, y2: height }] };
    case 'delay':
      return { parts: [{ kind: 'path', d: delayPath(width, height) }] };
    case 'display':
      return { parts: [{ kind: 'path', d: displayPath(width, height) }] };
    case 'off-page-connector':
      return { parts: [{ kind: 'polygon', points: polygon([[0, 0], [width, 0], [width, height * .68], [width / 2, height], [0, height * .68]]) }] };
    case 'stored-data':
      return { parts: [{ kind: 'path', d: storedDataPath(width, height) }] };
    case 'internal-storage':
      return { parts: [{ kind: 'rect', x: 0, y: 0, width, height }, { kind: 'line', x1: 18, y1: 0, x2: 18, y2: height }, { kind: 'line', x1: width - 18, y1: 0, x2: width - 18, y2: height }] };
    case 'package':
      return { parts: [{ kind: 'path', d: packagePath(width, height) }] };
    case 'folded-note':
      return { parts: [{ kind: 'path', d: foldedNotePath(width, height), fillRule: 'evenodd' }] };
    case 'system-boundary':
      return { parts: [{ kind: 'rect', x: 0, y: 0, width, height }] };
    case 'arrow-line':
    case 'line':
      return { parts: [{ kind: 'line', x1: 0, y1: height / 2, x2: width, y2: height / 2 }] };
    case 'dfd-gane-store':
      return { parts: [{ kind: 'path', d: `M 18 0 H ${width} V ${height} H 18 Z` }, { kind: 'line', x1: 18, y1: 0, x2: 18, y2: height }] };
    default:
      return null;
  }
}

/** Polygonal approximation used by connector boundary intersection math. */
export function silhouetteBoundaryPoints(renderer: string, width: number, height: number, radius = 0): Point[] | null {
  const geometry = shapeSilhouette(renderer, width, height, radius);
  const polygonPart = geometry?.parts.find((part): part is Extract<SilhouettePart, { kind: 'polygon' }> => part.kind === 'polygon');
  if (polygonPart) return polygonPart.points;
  if (renderer === 'ellipse' || renderer === 'circle' || renderer === 'use-case') return null;
  if (renderer === 'rectangle' || renderer === 'text' || renderer === 'external' || renderer === 'gane-external' || renderer === 'schema' || renderer === 'system-boundary') return polygon([[0, 0], [width, 0], [width, height], [0, height]]);
  if (renderer === 'rounded-rectangle' || renderer === 'callout' || renderer === 'start' || renderer === 'gane-process' || renderer === 'gane-external') return roundedBoundary(width, height, radius || 22);
  if (renderer === 'document' || renderer === 'multiple-document') return documentBoundary(width, height);
  if (renderer === 'database' || renderer === 'cylinder') return cylinderBoundary(width, height);
  if (renderer === 'cloud') return cloudBoundary(width, height);
  if (renderer === 'stored-data') return roundedBoundary(width, height, 12);
  if (renderer === 'predefined-process' || renderer === 'internal-storage') return polygon([[0, 0], [width, 0], [width, height], [0, height]]);
  if (renderer === 'delay') return delayBoundary(width, height);
  if (renderer === 'display') return displayBoundary(width, height);
  if (renderer === 'off-page-connector') return polygon([[0, 0], [width, 0], [width, height * .68], [width / 2, height], [0, height * .68]]);
  if (renderer === 'dfd-gane-store') return polygon([[18, 0], [width, 0], [width, height], [18, height]]);
  if (renderer === 'package') return polygon([[0, 16], [64, 16], [64, 0], [112, 0], [128, 16], [width, 16], [width, height], [0, height]]);
  if (renderer === 'folded-note') return polygon([[0, 0], [width - 18, 0], [width, 18], [width, height], [0, height]]);
  return null;
}

/** Resolve metadata-driven notation variants without creating parallel
 * semantic node types. DFD documents keep process/external/store roles while
 * the renderer changes for the selected Yourdon-DeMarco or Gane-Sarson form. */
export function notationRenderer(renderer: string, node: Pick<DiagramNode, 'library' | 'type' | 'data'>, diagramType?: string): string {
  if (node.library !== 'dfd' && diagramType !== 'dfd') return renderer;
  const notation = node.data.notation;
  if (notation !== 'gane-sarson') return renderer;
  if (node.type === 'process') return 'gane-process';
  if (node.type === 'external') return 'gane-external';
  if (node.type === 'store') return 'dfd-gane-store';
  return renderer;
}

function polygon(points: Array<[number, number]>): Point[] {
  return points.map(([x, y]) => ({ x, y }));
}

function cylinderPath(width: number, height: number): string {
  const top = height * .18;
  const bottom = height * .82;
  return `M 0 ${top} C 0 0 ${width} 0 ${width} ${top} L ${width} ${bottom} C ${width} ${height + height * .02} 0 ${height + height * .02} 0 ${bottom} Z`;
}

function cloudPath(width: number, height: number): string {
  return `M ${width * .18} ${height * .72} C ${width * .02} ${height * .72} ${width * .02} ${height * .42} ${width * .2} ${height * .4} C ${width * .18} ${height * .12} ${width * .5} ${height * .02} ${width * .64} ${height * .24} C ${width * .84} ${height * .1} ${width} ${height * .28} ${width * .9} ${height * .46} C ${width * 1.05} ${height * .52} ${width * .98} ${height * .76} ${width * .8} ${height * .76} Z`;
}

function documentPath(width: number, height: number, offsetX = 0, offsetY = 0): string {
  const localWidth = Math.max(24, width);
  const localHeight = Math.max(24, height);
  const wave = Math.min(16, localHeight * .2);
  return `M ${offsetX} ${offsetY} H ${offsetX + localWidth} V ${offsetY + localHeight - wave} Q ${offsetX + localWidth * .75} ${offsetY + localHeight} ${offsetX + localWidth * .5} ${offsetY + localHeight - wave} Q ${offsetX + localWidth * .25} ${offsetY + localHeight - wave * 2} ${offsetX} ${offsetY + localHeight - wave} Z`;
}

function documentBoundary(width: number, height: number): Point[] {
  const wave = Math.min(16, height * .2);
  return polygon([[0, 0], [width, 0], [width, height - wave], [width * .5, height - wave], [0, height - wave]]);
}

function cloudBoundary(width: number, height: number): Point[] {
  return polygon([
    [width * .18, height * .72], [width * .02, height * .72], [width * .02, height * .42],
    [width * .2, height * .4], [width * .18, height * .12], [width * .5, height * .02],
    [width * .64, height * .24], [width * .84, height * .1], [width, height * .28],
    [width * .9, height * .46], [width, height * .52], [width * .98, height * .76], [width * .8, height * .76],
  ]);
}

function storedDataPath(width: number, height: number): string {
  const side = Math.min(16, width * .16);
  return `M ${side} 0 H ${width - side} C ${width} 0 ${width} ${height} ${width - side} ${height} H ${side} C 0 ${height} 0 0 ${side} 0 Z`;
}

function delayPath(width: number, height: number): string {
  const radius = Math.min(28, height / 2);
  return `M 0 0 H ${width - radius} A ${radius} ${radius} 0 0 1 ${width - radius} ${height} H 0 Z`;
}

function displayPath(width: number, height: number): string {
  const curve = Math.min(28, width * .2);
  return `M 0 0 H ${width - curve} Q ${width} ${height / 2} ${width - curve} ${height} H 0 Q ${curve} ${height / 2} 0 0 Z`;
}

function packagePath(width: number, height: number): string {
  const tab = Math.min(64, width * .34);
  return `M 0 16 H ${tab} V 0 H ${tab + 48} L ${tab + 64} 16 H ${width} V ${height} H 0 Z`;
}

function foldedNotePath(width: number, height: number): string {
  const fold = Math.min(18, width * .2, height * .25);
  return `M 0 0 H ${width - fold} L ${width} ${fold} V ${height} H 0 Z M ${width - fold} 0 V ${fold} H ${width}`;
}

function roundedBoundary(width: number, height: number, radius: number): Point[] {
  const inset = Math.min(Math.max(0, radius), width / 2, height / 2);
  return polygon([[inset, 0], [width - inset, 0], [width, inset], [width, height - inset], [width - inset, height], [inset, height], [0, height - inset], [0, inset]]);
}

function cylinderBoundary(width: number, height: number): Point[] {
  const curve = Math.min(12, height * .18);
  return polygon([[0, curve], [width, curve], [width, height - curve], [0, height - curve]]);
}

function delayBoundary(width: number, height: number): Point[] {
  const radius = Math.min(28, height / 2);
  return polygon([[0, 0], [width - radius, 0], [width, height / 2], [width - radius, height], [0, height]]);
}

function displayBoundary(width: number, height: number): Point[] {
  const curve = Math.min(28, width * .2);
  return polygon([[0, 0], [width - curve, 0], [width, height / 2], [width - curve, height], [0, height], [curve, height / 2]]);
}
