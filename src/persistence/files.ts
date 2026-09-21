import { parseProject, serializeProject } from '../core/document';
import { entityFieldLabel, normalizeEntityFields } from '../core/erd';
import { nodeCenter } from '../core/geometry';
import { curvedPath, edgeRoute, pointsToPath } from '../core/routing';
import type { DiagramDocument, DiagramEdge, DiagramNode, EdgeMarker, Point } from '../core/types';

export function downloadProject(document: DiagramDocument): void {
  downloadBlob(new Blob([serializeProject(document)], { type: 'application/json' }), `${safeFilename(document.name)}.wdiag`);
}

export function downloadSvg(document: DiagramDocument, pageId = document.pages[0]?.id): void {
  const page = document.pages.find((candidate) => candidate.id === pageId) ?? document.pages[0];
  if (!page) return;
  const svg = documentToSvg(page.nodes, page.edges, page.settings.background, page.settings.width, page.settings.height);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeFilename(document.name)}.svg`);
}

export function readProjectFile(file: File): Promise<DiagramDocument> {
  return file.text().then(parseProject);
}

export function documentToSvg(nodes: DiagramNode[], edges: DiagramEdge[], background: string, width: number, height: number): string {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edgeMarkup = edges.map((edge) => {
    const source = nodeMap.get(edge.source.nodeId);
    const target = nodeMap.get(edge.target.nodeId);
    if (!source || !target) return '';
    const route = edgeRoute(edge, source, target, nodes);
    const path = edge.type === 'curved' ? curvedPath(route) : pointsToPath(route);
    const start = route[0];
    const end = route.at(-1) ?? start;
    const startDirection = outwardDirection(start, nodeCenter(source));
    const endDirection = outwardDirection(end, nodeCenter(target));
    const line = `<path d="${path}" fill="none" stroke="${escapeXml(edge.style.stroke)}" stroke-width="${edge.style.strokeWidth}"${edge.style.dash === 'dashed' ? ' stroke-dasharray="8 6"' : edge.style.dash === 'dotted' ? ' stroke-dasharray="2 5"' : ''}/>`;
    return `${line}${svgEndpointMarker(start, startDirection, edge.style.startMarker, edge.style.stroke, background, 'start')}${svgEndpointMarker(end, endDirection, edge.style.endMarker, edge.style.stroke, background, 'end')}`;
  }).join('');
  const nodeMarkup = nodes.map(renderNode).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8a92ab"/></marker><marker id="arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto"><path d="M8,0 L0,4 L8,8 z" fill="#8a92ab"/></marker></defs><rect width="100%" height="100%" fill="${escapeXml(background)}"/>${edgeMarkup}${nodeMarkup}</svg>`;
}

function svgEndpointMarker(point: Point, direction: Point, marker: EdgeMarker, stroke: string, fill: string, endpoint: 'start' | 'end'): string {
  if (marker === 'none') return '';
  const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
  const line = `fill="none" stroke="${escapeXml(stroke)}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;
  const circle = `<circle cx="0" cy="0" r="6" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="1.6"/>`;
  const bar = `<path d="M 0 -7 L 0 7" ${line}/>`;
  const crowfoot = (offset = 0) => `<path d="M ${offset} 0 L ${offset + 11} -7 M ${offset} 0 L ${offset + 11} 0 M ${offset} 0 L ${offset + 11} 7" ${line}/>`;
  const glyph = marker === 'arrow'
    ? `<path d="${endpoint === 'start' ? 'M 0 0 L -10 -6 L -10 6 Z' : 'M 0 0 L 10 -6 L 10 6 Z'}" fill="${escapeXml(stroke)}"/>`
    : marker === 'bar' ? bar
      : marker === 'circle' ? circle
        : marker === 'crowfoot' ? crowfoot()
          : marker === 'circle-bar' ? `${circle}<path d="M 10 -7 L 10 7" ${line}/>`
            : marker === 'bar-crowfoot' ? `${bar}${crowfoot(5)}`
              : `${circle}${crowfoot(8)}`;
  return `<g transform="translate(${point.x} ${point.y}) rotate(${angle})">${glyph}</g>`;
}

function outwardDirection(point: Point, neighbor: Point): Point {
  const dx = point.x - neighbor.x;
  const dy = point.y - neighbor.y;
  if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 0.001) return { x: Math.sign(dx), y: 0 };
  if (Math.abs(dy) > 0.001) return { x: 0, y: Math.sign(dy) };
  return { x: 1, y: 0 };
}

function renderNode(node: DiagramNode): string {
  const { x, y } = node.position;
  const { width, height } = node.size;
  const fill = escapeXml(node.style.fill);
  const stroke = escapeXml(node.style.stroke);
  const label = escapeXml(typeof node.data.label === 'string' ? node.data.label : node.type);
  const radius = node.style.radius;
  if (node.type === 'entity') {
    const fields = normalizeEntityFields(node.data.fields);
    const striped = node.data.striped !== false;
    const rowFill = typeof node.data.rowFill === 'string' ? node.data.rowFill : node.style.fill;
    const stripeFill = typeof node.data.stripeFill === 'string' ? node.data.stripeFill : rowFill === '#f2f3f7' ? '#e3e5e9' : '#252c3c';
    const headerFill = typeof node.data.headerFill === 'string' ? node.data.headerFill : node.style.stroke;
    const headerHeight = 42;
    const rowHeight = 27;
    const fieldMarkup = fields.map((field, index) => `<g><rect y="${headerHeight + index * rowHeight}" width="${width}" height="${rowHeight}" fill="${escapeXml(striped && index % 2 === 1 ? stripeFill : rowFill)}"/><text x="16" y="${headerHeight + 18 + index * rowHeight}" fill="${escapeXml(node.style.textColor)}" font-family="monospace" font-size="10">${escapeXml(entityFieldLabel(field))}</text></g>`).join('');
    return `<g transform="translate(${x} ${y})"><rect width="${width}" height="${height}" rx="${radius}" fill="${escapeXml(rowFill)}" stroke="${stroke}" stroke-width="${node.style.strokeWidth}" opacity="${node.style.opacity}"/><rect width="${width}" height="${headerHeight}" rx="${radius}" fill="${escapeXml(headerFill)}" opacity="${node.style.opacity}"/><line x1="0" y1="${headerHeight}" x2="${width}" y2="${headerHeight}" stroke="${stroke}"/><g>${fieldMarkup}</g><text x="16" y="27" fill="${escapeXml(node.style.textColor)}" font-family="monospace" font-size="13" font-weight="600">${label}</text></g>`;
  }
  if (node.type === 'diamond' || node.type === 'decision') {
    return `<g transform="translate(${x} ${y})"><polygon points="${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}" fill="${fill}" stroke="${stroke}"/><text x="${width / 2}" y="${height / 2 + 5}" text-anchor="middle" fill="${escapeXml(node.style.textColor)}" font-family="sans-serif" font-size="12">${label}</text></g>`;
  }
  return `<g transform="translate(${x} ${y})"><rect width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}"/><text x="${width / 2}" y="${height / 2 + 5}" text-anchor="middle" fill="${escapeXml(node.style.textColor)}" font-family="sans-serif" font-size="12">${label}</text></g>`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function safeFilename(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').toLowerCase() || 'untitled-diagram';
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character);
}
