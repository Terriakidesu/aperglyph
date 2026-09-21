import { parseProject, serializeProject } from '../core/document';
import { normalizeEntityFields } from '../core/erd';
import { nodeCenter } from '../core/geometry';
import { curvedPath, edgeRoute, pointsToPath } from '../core/routing';
import type { DiagramDocument, DiagramEdge, DiagramNode, EdgeMarker, Point } from '../core/types';

export interface ExportOptions {
  pageId?: string;
  contentBounds?: boolean;
  transparent?: boolean;
  scale?: 1 | 2 | 4;
}

export function downloadProject(document: DiagramDocument): void {
  downloadBlob(new Blob([serializeProject(document)], { type: 'application/json' }), `${safeFilename(document.name)}.wdiag`);
}

export function downloadSvg(document: DiagramDocument, pageId = document.pages[0]?.id, options: Omit<ExportOptions, 'pageId' | 'scale'> = {}): void {
  const page = document.pages.find((candidate) => candidate.id === pageId) ?? document.pages[0];
  if (!page) return;
  const bounds = options.contentBounds ? contentBounds(page.nodes, page.settings.width, page.settings.height) : { x: 0, y: 0, width: page.settings.width, height: page.settings.height };
  const svg = documentToSvg(page.nodes, page.edges, page.settings.background, bounds.width, bounds.height, { ...options, viewBox: bounds });
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeFilename(document.name)}.svg`);
}

export async function downloadPng(document: DiagramDocument, options: ExportOptions = {}): Promise<void> {
  const page = document.pages.find((candidate) => candidate.id === (options.pageId ?? document.pages[0]?.id)) ?? document.pages[0];
  if (!page) return;
  const bounds = options.contentBounds ? contentBounds(page.nodes, page.settings.width, page.settings.height) : { x: 0, y: 0, width: page.settings.width, height: page.settings.height };
  const scale = options.scale ?? 2;
  const svg = documentToSvg(page.nodes, page.edges, page.settings.background, bounds.width, bounds.height, { transparent: options.transparent, viewBox: bounds });
  const png = await renderSvgToPng(svg, Math.round(bounds.width * scale), Math.round(bounds.height * scale));
  downloadBlob(png, `${safeFilename(document.name)}.png`);
}

export async function downloadPdf(document: DiagramDocument, options: ExportOptions = {}): Promise<void> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const pages = options.pageId ? document.pages.filter((page) => page.id === options.pageId) : document.pages;
  for (const page of pages) {
    const bounds = options.contentBounds ? contentBounds(page.nodes, page.settings.width, page.settings.height) : { x: 0, y: 0, width: page.settings.width, height: page.settings.height };
    const svg = documentToSvg(page.nodes, page.edges, page.settings.background, bounds.width, bounds.height, { transparent: options.transparent, viewBox: bounds });
    const png = await renderSvgToPng(svg, Math.round(bounds.width * (options.scale ?? 2)), Math.round(bounds.height * (options.scale ?? 2)));
    const image = await pdf.embedPng(await png.arrayBuffer());
    const pdfPage = pdf.addPage([bounds.width, bounds.height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: bounds.width, height: bounds.height });
  }
  if (pdf.getPageCount() === 0) return;
  const bytes = await pdf.save();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  downloadBlob(new Blob([buffer], { type: 'application/pdf' }), `${safeFilename(document.name)}.pdf`);
}

export function readProjectFile(file: File): Promise<DiagramDocument> {
  return file.text().then(parseProject);
}

export function documentToSvg(nodes: DiagramNode[], edges: DiagramEdge[], background: string, width: number, height: number, options: { transparent?: boolean; viewBox?: { x: number; y: number; width: number; height: number } } = {}): string {
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
  const viewBox = options.viewBox ?? { x: 0, y: 0, width, height };
  const backgroundMarkup = options.transparent ? '' : `<rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="${escapeXml(background)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8a92ab"/></marker><marker id="arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto"><path d="M8,0 L0,4 L8,8 z" fill="#8a92ab"/></marker></defs>${backgroundMarkup}${edgeMarkup}${nodeMarkup}</svg>`;
}

function svgEndpointMarker(point: Point, direction: Point, marker: EdgeMarker, stroke: string, fill: string, endpoint: 'start' | 'end'): string {
  if (marker === 'none') return '';
  const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
  const line = `fill="none" stroke="${escapeXml(stroke)}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;
  const circle = `<circle cx="0" cy="0" r="6" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="1.6"/>`;
  const bar = `<path d="M 0 -7 L 0 7" ${line}/>`;
  const crowfoot = (offset = 0) => `<path d="M ${offset} 0 L ${offset - 11} -7 M ${offset} 0 L ${offset - 11} 0 M ${offset} 0 L ${offset - 11} 7" ${line}/>`;
  const glyph = marker === 'arrow'
    ? `<path d="${endpoint === 'start' ? 'M 0 0 L -10 -6 L -10 6 Z' : 'M 0 0 L 10 -6 L 10 6 Z'}" fill="${escapeXml(stroke)}"/>`
    : marker === 'bar' ? bar
      : marker === 'circle' ? circle
        : marker === 'crowfoot' ? crowfoot()
          : marker === 'circle-bar' ? `${circle}<path d="M 10 -7 L 10 7" ${line}/>`
            : marker === 'bar-crowfoot' ? `${bar}${crowfoot(-5)}`
              : `${circle}${crowfoot(-8)}`;
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
  const transform = `translate(${x} ${y}) rotate(${node.rotation} ${width / 2} ${height / 2})`;
  if (node.type === 'entity') {
    const fields = normalizeEntityFields(node.data.fields);
    const striped = node.data.striped !== false;
    const rowFill = typeof node.data.rowFill === 'string' ? node.data.rowFill : node.style.fill;
    const stripeFill = typeof node.data.stripeFill === 'string' ? node.data.stripeFill : rowFill === '#f2f3f7' ? '#e3e5e9' : '#252c3c';
    const headerFill = typeof node.data.headerFill === 'string' ? node.data.headerFill : node.style.stroke;
    const headerHeight = 34;
    const rowHeight = 27;
    const keyColumnWidth = 38;
    const typeColumnWidth = Math.min(82, Math.max(58, width * 0.3));
    const typeColumnX = width - typeColumnWidth;
    const fieldMarkup = fields.map((field, index) => {
      const rowY = headerHeight + index * rowHeight;
      const key = field.primaryKey && field.foreignKey ? 'PK/FK' : field.primaryKey ? 'PK' : field.foreignKey ? 'FK' : field.unique ? 'UQ' : '';
      return `<g><rect y="${rowY}" width="${width}" height="${rowHeight}" fill="${escapeXml(striped && index % 2 === 1 ? stripeFill : rowFill)}"/><line x1="0" y1="${rowY + rowHeight}" x2="${width}" y2="${rowY + rowHeight}" stroke="${stroke}" stroke-opacity="0.34"/><line x1="${keyColumnWidth}" y1="${rowY}" x2="${keyColumnWidth}" y2="${rowY + rowHeight}" stroke="${stroke}" stroke-opacity="0.45"/><line x1="${typeColumnX}" y1="${rowY}" x2="${typeColumnX}" y2="${rowY + rowHeight}" stroke="${stroke}" stroke-opacity="0.45"/>${key ? `<text x="${keyColumnWidth / 2}" y="${rowY + 18}" fill="${escapeXml(node.style.textColor)}" font-family="monospace" font-size="9" font-weight="600" text-anchor="middle">${key}</text>` : ''}<text x="${keyColumnWidth + 8}" y="${rowY + 18}" fill="${escapeXml(node.style.textColor)}" font-family="monospace" font-size="10"${field.primaryKey ? ' text-decoration="underline"' : ''}${field.foreignKey ? ' font-style="italic"' : ''}>${escapeXml(field.name)}</text><text x="${typeColumnX + 7}" y="${rowY + 18}" fill="${escapeXml(node.style.textColor)}" fill-opacity="0.68" font-family="monospace" font-size="9">${escapeXml(field.type)}</text></g>`;
    }).join('');
     return `<g transform="${transform}"><rect width="${width}" height="${height}" rx="${radius}" fill="${escapeXml(rowFill)}" stroke="${stroke}" stroke-width="${node.style.strokeWidth}"${node.data.associative ? ' stroke-dasharray="5 3"' : ''} opacity="${node.style.opacity}"/><rect width="${width}" height="${headerHeight}" rx="${radius}" fill="${escapeXml(headerFill)}" opacity="${node.style.opacity}"/><line x1="0" y1="${headerHeight}" x2="${width}" y2="${headerHeight}" stroke="${stroke}"/><g>${fieldMarkup}</g><text x="${width / 2}" y="23" fill="${escapeXml(node.style.textColor)}" font-family="monospace" font-size="13" font-weight="600" text-anchor="middle">${label}</text></g>`;
  }
  if (node.library === 'dfd' && node.type === 'process') {
     return `<g transform="${transform}"><ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${node.style.strokeWidth}" opacity="${node.style.opacity}"/><text x="${width / 2}" y="${height / 2 + 5}" text-anchor="middle" fill="${escapeXml(node.style.textColor)}" font-family="sans-serif" font-size="12">${label}</text></g>`;
  }
  if (node.library === 'dfd' && node.type === 'store') {
     return `<g transform="${transform}"><line x1="0" y1="10" x2="${width}" y2="10" stroke="${stroke}" stroke-width="${node.style.strokeWidth}"/><line x1="0" y1="${height - 10}" x2="${width}" y2="${height - 10}" stroke="${stroke}" stroke-width="${node.style.strokeWidth}"/><text x="${width / 2}" y="${height / 2 + 5}" text-anchor="middle" fill="${escapeXml(node.style.textColor)}" font-family="sans-serif" font-size="12">${label}</text></g>`;
  }
  if (node.type === 'use-case') {
     return `<g transform="${transform}"><ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${node.style.strokeWidth}" opacity="${node.style.opacity}"/><text x="${width / 2}" y="${height / 2 + 5}" text-anchor="middle" fill="${escapeXml(node.style.textColor)}" font-family="sans-serif" font-size="12">${label}</text></g>`;
  }
  if (node.type === 'actor') {
    const center = width / 2;
     return `<g transform="${transform}"><circle cx="${center}" cy="22" r="14" fill="${fill}" stroke="${stroke}" stroke-width="${node.style.strokeWidth}"/><path d="M${center} 36 L${center} 84 M${center - 22} 52 L${center + 22} 52 M${center} 84 L${center - 18} 116 M${center} 84 L${center + 18} 116" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/><text x="${center}" y="${height - 8}" text-anchor="middle" fill="${escapeXml(node.style.textColor)}" font-family="sans-serif" font-size="12">${label}</text></g>`;
  }
  if (node.type === 'boundary') {
     return `<g transform="${transform}"><rect width="${width}" height="${height}" rx="${radius}" fill="none" stroke="${stroke}" stroke-width="${node.style.strokeWidth}" stroke-dasharray="7 5"/><text x="18" y="27" fill="${escapeXml(node.style.textColor)}" font-family="monospace" font-size="11" font-weight="600">${label}</text></g>`;
  }
  if (node.type === 'diamond' || node.type === 'decision') {
     return `<g transform="${transform}"><polygon points="${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}" fill="${fill}" stroke="${stroke}"/><text x="${width / 2}" y="${height / 2 + 5}" text-anchor="middle" fill="${escapeXml(node.style.textColor)}" font-family="sans-serif" font-size="12">${label}</text></g>`;
  }
   return `<g transform="${transform}"><rect width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}"/><text x="${width / 2}" y="${height / 2 + 5}" text-anchor="middle" fill="${escapeXml(node.style.textColor)}" font-family="sans-serif" font-size="12">${label}</text></g>`;
}

function contentBounds(nodes: DiagramNode[], pageWidth: number, pageHeight: number): { x: number; y: number; width: number; height: number } {
  if (nodes.length === 0) return { x: 0, y: 0, width: pageWidth, height: pageHeight };
  const padding = 32;
  const minX = Math.min(...nodes.map((node) => node.position.x)) - padding;
  const minY = Math.min(...nodes.map((node) => node.position.y)) - padding;
  const maxX = Math.max(...nodes.map((node) => node.position.x + node.size.width)) + padding;
  const maxY = Math.max(...nodes.map((node) => node.position.y + node.size.height)) + padding;
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function renderSvgToPng(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Canvas export is unavailable in this browser.'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Unable to encode PNG export.')), 'image/png');
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to render SVG export.'));
    };
    image.src = url;
  });
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
