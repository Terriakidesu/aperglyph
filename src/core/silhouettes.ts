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
    case 'actor': {
      const minimum = Math.min(width, height);
      const headRadius = minimum * .1;
      const headCenterY = height * .2;
      const bodyTop = height * .32;
      const shoulderY = height * .43;
      const bodyBottom = height * .65;
      const armHalfWidth = width * .21;
      const legHalfWidth = width * .18;
      return { parts: [
        { kind: 'ellipse', cx: width / 2, cy: headCenterY, rx: headRadius, ry: headRadius },
        { kind: 'line', x1: width / 2, y1: bodyTop, x2: width / 2, y2: bodyBottom },
        { kind: 'line', x1: width / 2 - armHalfWidth, y1: shoulderY, x2: width / 2 + armHalfWidth, y2: shoulderY },
        { kind: 'line', x1: width / 2, y1: bodyBottom, x2: width / 2 - legHalfWidth, y2: height * .9 },
        { kind: 'line', x1: width / 2, y1: bodyBottom, x2: width / 2 + legHalfWidth, y2: height * .9 },
      ] };
    }
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
    {
      const inset = Math.min(28, width * .2);
      return { parts: [{ kind: 'polygon', points: polygon([[inset, 0], [width - inset, 0], [width, height], [0, height]]) }] };
    }
    case 'manual-operation': {
      const inset = Math.min(28, width * .2);
      return { parts: [{ kind: 'polygon', points: polygon([[0, 0], [width, 0], [width - inset, height], [inset, height]]) }] };
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
      return { parts: [{ kind: 'polygon', points: polygon([[width / 2, 0], [width, height / 2], [width / 2, height], [0, height / 2]]) }, { kind: 'line', x1: 0, y1: height / 2, x2: width, y2: height / 2 }] };
    case 'collate':
      return { parts: [{ kind: 'polygon', points: polygon([[0, 0], [width, 0], [width / 2, height / 2], [width, height], [0, height], [width / 2, height / 2]]) }] };
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
    case 'predefined-process': {
      const divider = Math.min(16, width / 2);
      return { parts: [{ kind: 'rect', x: 0, y: 0, width, height }, { kind: 'line', x1: divider, y1: 0, x2: divider, y2: height }, { kind: 'line', x1: width - divider, y1: 0, x2: width - divider, y2: height }] };
    }
    case 'delay':
      return { parts: [{ kind: 'path', d: delayPath(width, height) }] };
    case 'display':
      return { parts: [{ kind: 'path', d: displayPath(width, height) }] };
    case 'off-page-connector':
      return { parts: [{ kind: 'polygon', points: polygon([[0, 0], [width, 0], [width, height * .68], [width / 2, height], [0, height * .68]]) }] };
    case 'stored-data':
      return { parts: [{ kind: 'path', d: storedDataPath(width, height) }] };
    case 'internal-storage':
      return { parts: [{ kind: 'rect', x: 0, y: 0, width, height }, { kind: 'line', x1: Math.min(width * .12, 24), y1: 0, x2: Math.min(width * .12, 24), y2: height }, { kind: 'line', x1: 0, y1: Math.min(height * .22, 20), x2: width, y2: Math.min(height * .22, 20) }] };
    case 'package':
      return { parts: [{ kind: 'path', d: packagePath(width, height) }] };
    case 'folded-note':
      return { parts: [{ kind: 'path', d: foldedNotePath(width, height), fillRule: 'evenodd' }] };
    case 'system-boundary':
      return { parts: [{ kind: 'rect', x: 0, y: 0, width, height }] };
    case 'arrow-line':
    case 'line':
      return { parts: [{ kind: 'line', x1: 0, y1: height / 2, x2: width, y2: height / 2 }] };
    case 'dfd-store':
    case 'store': {
      const inset = Math.min(10, height / 2);
      return { parts: [{ kind: 'line', x1: 0, y1: inset, x2: width, y2: inset }, { kind: 'line', x1: 0, y1: height - inset, x2: width, y2: height - inset }] };
    }
    case 'dfd-gane-store': {
      const inset = Math.min(18, width);
      return { parts: [{ kind: 'path', d: `M ${inset} 0 H ${width} V ${height} H ${inset} Z` }, { kind: 'line', x1: inset, y1: 0, x2: inset, y2: height }] };
    }
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
  if (renderer === 'gane-process') return roundedBoundary(width, height, Math.min(10, height / 2));
  if (renderer === 'rounded-rectangle' || renderer === 'callout' || renderer === 'start') return roundedBoundary(width, height, radius || 22);
  if (renderer === 'rectangle' || renderer === 'text' || renderer === 'external' || renderer === 'gane-external' || renderer === 'schema' || renderer === 'system-boundary') {
    const corner = renderer === 'schema' || renderer === 'system-boundary' ? 0 : Math.min(Math.max(0, radius), width / 2, height / 2);
    return corner > 0 ? roundedBoundary(width, height, corner) : polygon([[0, 0], [width, 0], [width, height], [0, height]]);
  }
  if (renderer === 'document' || renderer === 'multiple-document') return documentBoundary(width, height);
  if (renderer === 'database' || renderer === 'cylinder') return cylinderBoundary(width, height);
  if (renderer === 'cloud') return cloudBoundary(width, height);
  if (renderer === 'stored-data') return storedDataBoundary(width, height);
  if (renderer === 'predefined-process' || renderer === 'internal-storage') return polygon([[0, 0], [width, 0], [width, height], [0, height]]);
  if (renderer === 'delay') return delayBoundary(width, height);
  if (renderer === 'display') return displayBoundary(width, height);
  if (renderer === 'off-page-connector') return polygon([[0, 0], [width, 0], [width, height * .68], [width / 2, height], [0, height * .68]]);
  if (renderer === 'dfd-store' || renderer === 'store') {
    const inset = Math.min(10, height / 2);
    return polygon([[0, inset], [width, inset], [width, height - inset], [0, height - inset]]);
  }
  if (renderer === 'dfd-gane-store') {
    const inset = Math.min(18, width);
    return polygon([[inset, 0], [width, 0], [width, height], [inset, height]]);
  }
  if (renderer === 'package') return packageBoundary(width, height);
  if (renderer === 'folded-note') return foldedNoteBoundary(width, height);
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
  return `M 0 ${top} C 0 0 ${width} 0 ${width} ${top} L ${width} ${bottom} C ${width} ${height} 0 ${height} 0 ${bottom} Z`;
}

function cloudPath(width: number, height: number): string {
  return `M ${width * .18} ${height * .72} C ${width * .02} ${height * .72} ${width * .02} ${height * .42} ${width * .2} ${height * .4} C ${width * .18} ${height * .12} ${width * .5} ${height * .02} ${width * .64} ${height * .24} C ${width * .82} ${height * .1} ${width * .96} ${height * .28} ${width * .9} ${height * .46} C ${width * .98} ${height * .52} ${width * .96} ${height * .76} ${width * .8} ${height * .76} Z`;
}

function documentPath(width: number, height: number, offsetX = 0, offsetY = 0): string {
  const localWidth = Math.max(24, width);
  const localHeight = Math.max(24, height);
  const wave = Math.min(16, localHeight * .2);
  return `M ${offsetX} ${offsetY} H ${offsetX + localWidth} V ${offsetY + localHeight - wave} Q ${offsetX + localWidth * .75} ${offsetY + localHeight} ${offsetX + localWidth * .5} ${offsetY + localHeight - wave} Q ${offsetX + localWidth * .25} ${offsetY + localHeight - wave * 2} ${offsetX} ${offsetY + localHeight - wave} Z`;
}

function documentBoundary(width: number, height: number): Point[] {
  const wave = Math.min(16, height * .2);
  const points: Point[] = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height - wave }];
  appendQuadratic(points, points.at(-1)!, { x: width * .75, y: height }, { x: width * .5, y: height - wave });
  appendQuadratic(points, points.at(-1)!, { x: width * .25, y: height - wave * 2 }, { x: 0, y: height - wave });
  points.push({ x: 0, y: 0 });
  return points;
}

function cloudBoundary(width: number, height: number): Point[] {
  const points = [{ x: width * .18, y: height * .72 }];
  appendCubic(points, points[0], { x: width * .02, y: height * .72 }, { x: width * .02, y: height * .42 }, { x: width * .2, y: height * .4 });
  appendCubic(points, points.at(-1)!, { x: width * .18, y: height * .12 }, { x: width * .5, y: height * .02 }, { x: width * .64, y: height * .24 });
  appendCubic(points, points.at(-1)!, { x: width * .82, y: height * .1 }, { x: width * .96, y: height * .28 }, { x: width * .9, y: height * .46 });
  appendCubic(points, points.at(-1)!, { x: width * .98, y: height * .52 }, { x: width * .96, y: height * .76 }, { x: width * .8, y: height * .76 });
  return points;
}

function storedDataPath(width: number, height: number): string {
  const side = Math.min(16, width * .16);
  return `M ${side} 0 H ${width - side} C ${width} 0 ${width} ${height} ${width - side} ${height} H ${side} C 0 ${height} 0 0 ${side} 0 Z`;
}

function storedDataBoundary(width: number, height: number): Point[] {
  const side = Math.min(16, width * .16);
  const points = [{ x: side, y: 0 }, { x: width - side, y: 0 }];
  appendCubic(points, points.at(-1)!, { x: width, y: 0 }, { x: width, y: height }, { x: width - side, y: height });
  points.push({ x: side, y: height });
  appendCubic(points, points.at(-1)!, { x: 0, y: height }, { x: 0, y: 0 }, { x: side, y: 0 });
  return points;
}

function delayPath(width: number, height: number): string {
  const radiusX = Math.min(28, width / 2);
  const radiusY = height / 2;
  return `M 0 0 H ${width - radiusX} A ${radiusX} ${radiusY} 0 0 1 ${width - radiusX} ${height} H 0 Z`;
}

function displayPath(width: number, height: number): string {
  const curve = Math.min(28, width * .2);
  return `M 0 0 H ${width - curve} Q ${width} ${height / 2} ${width - curve} ${height} H 0 Q ${curve} ${height / 2} 0 0 Z`;
}

function packagePath(width: number, height: number): string {
  const tabHeight = Math.min(16, height * .2);
  const fold = Math.min(16, width * .12);
  const tab = Math.max(0, Math.min(width * .34, width - fold * 2));
  return `M 0 ${tabHeight} H ${tab} V 0 H ${tab + fold} L ${tab + fold * 2} ${tabHeight} H ${width} V ${height} H 0 Z`;
}

function packageBoundary(width: number, height: number): Point[] {
  const tabHeight = Math.min(16, height * .2);
  const fold = Math.min(16, width * .12);
  const tab = Math.max(0, Math.min(width * .34, width - fold * 2));
  return polygon([[0, tabHeight], [tab, tabHeight], [tab, 0], [tab + fold, 0], [tab + fold * 2, tabHeight], [width, tabHeight], [width, height], [0, height]]);
}

function foldedNotePath(width: number, height: number): string {
  const fold = Math.min(18, width * .2, height * .25);
  return `M 0 0 H ${width - fold} L ${width} ${fold} V ${height} H 0 Z M ${width - fold} 0 V ${fold} H ${width}`;
}

function foldedNoteBoundary(width: number, height: number): Point[] {
  const fold = Math.min(18, width * .2, height * .25);
  return polygon([[0, 0], [width - fold, 0], [width, fold], [width, height], [0, height]]);
}

function roundedBoundary(width: number, height: number, radius: number): Point[] {
  const inset = Math.min(Math.max(0, radius), width / 2, height / 2);
  return polygon([[inset, 0], [width - inset, 0], [width, inset], [width, height - inset], [width - inset, height], [inset, height], [0, height - inset], [0, inset]]);
}

function cylinderBoundary(width: number, height: number): Point[] {
  const top = height * .18;
  const bottom = height * .82;
  const points = [{ x: 0, y: top }];
  appendCubic(points, points[0], { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: top });
  points.push({ x: width, y: bottom });
  appendCubic(points, points.at(-1)!, { x: width, y: height }, { x: 0, y: height }, { x: 0, y: bottom });
  return points;
}

function delayBoundary(width: number, height: number): Point[] {
  const radiusX = Math.min(28, width / 2);
  const radiusY = height / 2;
  const centerX = width - radiusX;
  const points: Point[] = [{ x: 0, y: 0 }, { x: centerX, y: 0 }];
  for (let index = 1; index <= 12; index += 1) {
    const angle = -Math.PI / 2 + Math.PI * index / 12;
    points.push({ x: centerX + Math.cos(angle) * radiusX, y: radiusY + Math.sin(angle) * radiusY });
  }
  points.push({ x: 0, y: height });
  return points;
}

function displayBoundary(width: number, height: number): Point[] {
  const curve = Math.min(28, width * .2);
  const points: Point[] = [{ x: 0, y: 0 }, { x: width - curve, y: 0 }];
  appendQuadratic(points, points.at(-1)!, { x: width, y: height / 2 }, { x: width - curve, y: height });
  points.push({ x: 0, y: height });
  appendQuadratic(points, points.at(-1)!, { x: curve, y: height / 2 }, { x: 0, y: 0 });
  return points;
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

function appendQuadratic(points: Point[], from: Point, control: Point, to: Point): void {
  for (let index = 1; index <= 8; index += 1) {
    const t = index / 8;
    const inverse = 1 - t;
    points.push({
      x: inverse ** 2 * from.x + 2 * inverse * t * control.x + t ** 2 * to.x,
      y: inverse ** 2 * from.y + 2 * inverse * t * control.y + t ** 2 * to.y,
    });
  }
}
