import { createDocument, createNode, parseProject, serializeProject } from '../core/document';
import { exportDiagramText, parseDiagramText } from '../core/interoperability';
import { ERD_COLUMN_HEADER_HEIGHT, ERD_HEADER_HEIGHT, entityColumns, entityFieldValue, entityLayoutMetrics, exportErdSql, normalizeEntityFields, parseErdSql } from '../core/erd';
import { nodeCenter, nodeFlipTransform } from '../core/geometry';
import { calculateRouteJumps, curvedPath, edgeRoute, edgeRouting, jumpMaskPaths, parallelEdgeOffset, parallelRoutingLane, pointsToPath } from '../core/routing';
import { notationRenderer, shapeSilhouette } from '../core/silhouettes';
import { nodeTextLayout } from '../core/text';
import type { DiagramDocument, DiagramEdge, DiagramNode, EdgeMarker, Point } from '../core/types';
import { pluginManager } from '../plugins';

const MAX_IMPORTED_FILE_BYTES = 10 * 1024 * 1024;

export interface ExportOptions {
  pageId?: string;
  selectionIds?: string[];
  allPages?: boolean;
  contentBounds?: boolean;
  transparent?: boolean;
  outlineOnly?: boolean;
  scale?: 1 | 2 | 4;
  padding?: number;
}

export function downloadProject(document: DiagramDocument): void {
  downloadBlob(new Blob([serializeProject(document)], { type: 'application/json' }), `${safeFilename(document.name)}.wdiag`);
}

export function downloadMermaid(document: DiagramDocument, pageId = document.pages[0]?.id): void {
  downloadBlob(new Blob([exportDiagramText(document, 'mermaid', pageId)], { type: 'text/plain' }), `${safeFilename(document.name)}.mmd`);
}

export function downloadPlantUml(document: DiagramDocument, pageId = document.pages[0]?.id): void {
  downloadBlob(new Blob([exportDiagramText(document, 'plantuml', pageId)], { type: 'text/plain' }), `${safeFilename(document.name)}.puml`);
}

export function downloadSql(document: DiagramDocument, pageId = document.pages[0]?.id): void {
  downloadBlob(new Blob([exportErdSql(document, pageId)], { type: 'text/sql' }), `${safeFilename(document.name)}.sql`);
}

export function downloadSvg(document: DiagramDocument, pageId = document.pages[0]?.id, options: Omit<ExportOptions, 'pageId' | 'scale'> = {}): void {
  if (options.allPages) {
    document.pages.forEach((page, index) => downloadSvgPage(document, page, options, document.pages.length > 1 ? `-${index + 1}-${safeFilename(page.name)}` : ''));
    return;
  }
  const page = document.pages.find((candidate) => candidate.id === pageId) ?? document.pages[0];
  if (!page) return;
  downloadSvgPage(document, page, options);
}

function downloadSvgPage(document: DiagramDocument, page: DiagramDocument['pages'][number], options: Omit<ExportOptions, 'pageId' | 'scale'>, suffix = ''): void {
  const scene = exportScene(page, options.selectionIds);
  const bounds = options.contentBounds ? contentBounds(scene.nodes, scene.edges, page.settings.width, page.settings.height, options.padding ?? 32) : pageExportBounds(page.settings.width, page.settings.height);
  const svg = documentToSvg(scene.nodes, scene.edges, page.settings.background, bounds.width, bounds.height, { ...options, viewBox: bounds });
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeFilename(document.name)}${suffix}.svg`);
}

export async function downloadPng(document: DiagramDocument, options: ExportOptions = {}): Promise<void> {
  const pages = options.allPages ? document.pages : [document.pages.find((candidate) => candidate.id === (options.pageId ?? document.pages[0]?.id)) ?? document.pages[0]].filter(Boolean);
  const scale = options.scale ?? 2;
  for (const [index, page] of pages.entries()) {
    const scene = exportScene(page, options.selectionIds);
    const bounds = options.contentBounds ? contentBounds(scene.nodes, scene.edges, page.settings.width, page.settings.height, options.padding ?? 32) : pageExportBounds(page.settings.width, page.settings.height);
    const svg = documentToSvg(scene.nodes, scene.edges, page.settings.background, bounds.width, bounds.height, { transparent: options.transparent, outlineOnly: options.outlineOnly, viewBox: bounds });
    const png = await renderSvgToPng(svg, Math.round(bounds.width * scale), Math.round(bounds.height * scale));
    const suffix = pages.length > 1 ? `-${index + 1}-${safeFilename(page.name)}` : '';
    downloadBlob(png, `${safeFilename(document.name)}${suffix}.png`);
  }
}

export async function downloadPdf(document: DiagramDocument, options: ExportOptions = {}): Promise<void> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const pages = options.pageId ? document.pages.filter((page) => page.id === options.pageId) : document.pages;
  for (const page of pages) {
    const scene = exportScene(page, options.selectionIds);
    const bounds = options.contentBounds ? contentBounds(scene.nodes, scene.edges, page.settings.width, page.settings.height, options.padding ?? 32) : pageExportBounds(page.settings.width, page.settings.height);
    const svg = documentToSvg(scene.nodes, scene.edges, page.settings.background, bounds.width, bounds.height, { transparent: options.transparent, outlineOnly: options.outlineOnly, viewBox: bounds });
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

export function printDocument(document: DiagramDocument, options: ExportOptions = {}): void {
  const page = document.pages.find((candidate) => candidate.id === (options.pageId ?? document.pages[0]?.id)) ?? document.pages[0];
  if (!page) return;
  const scene = exportScene(page, options.selectionIds);
  const bounds = options.contentBounds ? contentBounds(scene.nodes, scene.edges, page.settings.width, page.settings.height, options.padding ?? 32) : pageExportBounds(page.settings.width, page.settings.height);
  const svg = documentToSvg(scene.nodes, scene.edges, page.settings.background, bounds.width, bounds.height, { transparent: false, outlineOnly: options.outlineOnly ?? true, viewBox: bounds });
  const printWindow = globalThis.window?.open('', '_blank');
  if (!printWindow) {
    void downloadPdf(document, { ...options, pageId: page.id, outlineOnly: options.outlineOnly ?? true });
    return;
  }
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(document.name)} — ${escapeXml(page.name)}</title><style>@page{margin:.5in}html,body{margin:0;background:#fff}body{display:flex;align-items:flex-start;justify-content:center}svg{display:block;width:100%;height:auto;max-height:100vh}</style></head><body>${svg}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.addEventListener('afterprint', () => printWindow.close(), { once: true });
  printWindow.print();
}

export async function copySelectionSvg(document: DiagramDocument, pageId: string, selectionIds: string[]): Promise<boolean> {
  if (!globalThis.navigator?.clipboard?.write || typeof globalThis.ClipboardItem === 'undefined') return false;
  const page = document.pages.find((candidate) => candidate.id === pageId) ?? document.pages[0];
  if (!page) return false;
  const scene = exportScene(page, selectionIds);
  const bounds = contentBounds(scene.nodes, scene.edges, page.settings.width, page.settings.height, 16);
  const svg = documentToSvg(scene.nodes, scene.edges, page.settings.background, bounds.width, bounds.height, { viewBox: bounds });
  await globalThis.navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml': new Blob([svg], { type: 'image/svg+xml' }), 'text/plain': new Blob([svg], { type: 'text/plain' }) })]);
  return true;
}

export async function copySelectionPng(document: DiagramDocument, pageId: string, selectionIds: string[], scale: 1 | 2 | 4 = 2): Promise<boolean> {
  if (!globalThis.navigator?.clipboard?.write || typeof globalThis.ClipboardItem === 'undefined') return false;
  const page = document.pages.find((candidate) => candidate.id === pageId) ?? document.pages[0];
  if (!page) return false;
  const scene = exportScene(page, selectionIds);
  const bounds = contentBounds(scene.nodes, scene.edges, page.settings.width, page.settings.height, 16);
  const svg = documentToSvg(scene.nodes, scene.edges, page.settings.background, bounds.width, bounds.height, { viewBox: bounds });
  const png = await renderSvgToPng(svg, Math.round(bounds.width * scale), Math.round(bounds.height * scale));
  await globalThis.navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  return true;
}

export function readProjectFile(file: File): Promise<DiagramDocument> {
  return file.text().then(parseProject);
}

export function readDiagramFile(file: File): Promise<DiagramDocument> {
  if (file.size > MAX_IMPORTED_FILE_BYTES) return Promise.reject(new Error('This imported file is too large to open safely.'));
  const name = file.name.toLowerCase();
  const mimeType = file.type.split(';', 1)[0].trim().toLowerCase();
  if (name.endsWith('.mmd') || name.endsWith('.mermaid')) return file.text().then((text) => parseDiagramText(text, 'mermaid'));
  if (name.endsWith('.puml') || name.endsWith('.plantuml')) return file.text().then((text) => parseDiagramText(text, 'plantuml'));
  if (name.endsWith('.sql')) return file.text().then((text) => parseErdSql(text, file.name.replace(/\.sql$/i, '') || 'Imported SQL schema'));
  if (name.endsWith('.svg') || mimeType === 'image/svg+xml') return file.text().then((text) => createImageDocument(file.name, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeSvg(text))}`));
  if (mimeType.startsWith('image/') && !mimeType.includes('svg')) return file.arrayBuffer().then((buffer) => createImageDocument(file.name, `data:${mimeType};base64,${bytesToBase64(new Uint8Array(buffer))}`));
  return readProjectFile(file);
}

export function sanitizeSvg(value: string): string {
  if (value.length > 10 * 1024 * 1024) throw new Error('This SVG is too large to import safely.');
  const withoutUnsafeBlocks = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<\s*(?:script|foreignObject|iframe|object|embed|audio|video|link|animate|animateMotion|animateTransform|set)\b[\s\S]*?<\s*\/\s*(?:script|foreignObject|iframe|object|embed|audio|video|link|animate|animateMotion|animateTransform|set)\s*>/gi, '')
    .replace(/<\s*(?:script|foreignObject|iframe|object|embed|audio|video|link|animate|animateMotion|animateTransform|set)\b[^>]*\/\s*>/gi, '')
    .replace(/<\s*style\b[\s\S]*?<\s*\/\s*style\s*>/gi, '');
  const svgCandidate = withoutUnsafeBlocks.replace(/^\uFEFF/, '').trim();
  if (!/^<\s*svg(?:\s|>)/i.test(svgCandidate) || (!/<\s*\/\s*svg\s*>\s*$/i.test(svgCandidate) && !/^<\s*svg\b[\s\S]*\/\s*>\s*$/i.test(svgCandidate))) throw new Error('This file does not contain a valid SVG image.');

  // Prefer the browser's XML parser so quoted `>` characters and namespaces
  // are handled correctly. The fallback keeps imports testable in workers and
  // non-DOM environments.
  const Parser = globalThis.DOMParser;
  const Serializer = globalThis.XMLSerializer;
  if (Parser && Serializer) {
    const parsed = new Parser().parseFromString(withoutUnsafeBlocks, 'image/svg+xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement?.nodeName.toLowerCase() !== 'svg') throw new Error('This file does not contain a valid SVG image.');
    parsed.querySelectorAll('script,foreignObject,iframe,object,embed,audio,video,link,style,animate,animateMotion,animateTransform,set').forEach((element) => element.remove());
    parsed.querySelectorAll('*').forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith('on') || (name === 'href' || name === 'xlink:href' || name === 'src') && !safeSvgReference(value) || name === 'style' && unsafeSvgStyle(value)) element.removeAttribute(attribute.name);
      });
    });
    return new Serializer().serializeToString(parsed.documentElement);
  }

  return withoutUnsafeBlocks.replace(/<[^>]*>/g, (tag) => tag.replace(/\s+([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, (attribute, name: string, doubleQuoted: string | undefined, singleQuoted: string | undefined, bare: string | undefined) => {
    const lower = name.toLowerCase();
    const attributeValue = (doubleQuoted ?? singleQuoted ?? bare ?? '').trim();
    if (lower.startsWith('on') || ((lower === 'href' || lower === 'xlink:href' || lower === 'src') && !safeSvgReference(attributeValue)) || (lower === 'style' && unsafeSvgStyle(attributeValue))) return '';
    return attribute;
  }));
}

function safeSvgReference(value: string): boolean {
  if (value.startsWith('#')) return true;
  return /^data:image\/(?:png|jpeg|gif|webp|bmp|avif);/i.test(value);
}

function unsafeSvgStyle(value: string): boolean {
  return /(?:url\s*\(|@import|expression\s*\(|javascript:|vbscript:)/i.test(value);
}

function createImageDocument(name: string, src: string): DiagramDocument {
  const document = createDocument(name, 'general');
  document.pages[0].name = 'Imported image';
  document.pages[0].nodes.push(createNode('image', { x: 0, y: 0 }, { size: { width: 420, height: 300 }, data: { label: name, src }, style: { fill: 'transparent', stroke: 'transparent', radius: 0 } }));
  return document;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(binary);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    output += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] + (index + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') + (index + 2 < bytes.length ? alphabet[c & 63] : '=');
  }
  return output;
}

export function documentToSvg(nodes: DiagramNode[], edges: DiagramEdge[], background: string, width: number, height: number, options: { transparent?: boolean; outlineOnly?: boolean; viewBox?: { x: number; y: number; width: number; height: number } } = {}): string {
  const outlineOnly = options.outlineOnly === true;
  const exportBackground = outlineOnly ? '#ffffff' : background;
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const routeEntries = edges
    .filter((edge) => edgeRouting(edge) === 'orthogonal')
    .map((edge) => {
      const offset = parallelEdgeOffset(edge, edges);
      const routedEdge = offset === 0 ? edge : { ...edge, data: { ...edge.data, parallelOffset: offset } };
      return {
        id: edge.id,
        points: edgeRoute(routedEdge, edge.source.nodeId ? nodeMap.get(edge.source.nodeId) : undefined, edge.target.nodeId ? nodeMap.get(edge.target.nodeId) : undefined, nodes, {
          lane: edgeRouting(edge) === 'orthogonal' ? parallelRoutingLane(edge, edges) : undefined,
        }),
        crossingPriority: edge.routing?.crossingPriority ?? 0,
      };
    });
  const routeJumps = calculateRouteJumps(routeEntries);
  const edgeMarkup = edges.map((edge) => {
    const source = edge.source.nodeId ? nodeMap.get(edge.source.nodeId) : undefined;
    const target = edge.target.nodeId ? nodeMap.get(edge.target.nodeId) : undefined;
    const offset = parallelEdgeOffset(edge, edges);
    const routedEdge = offset === 0 ? edge : { ...edge, data: { ...edge.data, parallelOffset: offset } };
    const route = edgeRoute(routedEdge, source, target, nodes, {
      lane: edgeRouting(edge) === 'orthogonal' ? parallelRoutingLane(edge, edges) : undefined,
    });
    if (route.length < 2) return '';
    const start = route[0];
    const end = route.at(-1) ?? start;
    const startDirection = endpointDirection(start, route[1], source);
    const endDirection = endpointDirection(end, route.at(-2) ?? start, target);
    const startMarkerDirection = markerDirection(start, route[1]);
    const endMarkerDirection = markerDirection(end, route.at(-2) ?? start);
    const curveStartDirection = source ? startDirection : { x: -startDirection.x, y: -startDirection.y };
    const curveEndDirection = target ? { x: -endDirection.x, y: -endDirection.y } : endDirection;
    const jumps = routeJumps.get(edge.id) ?? [];
    const renderedJumps = edge.style.jumpStyle === 'arc' || edge.style.jumpStyle === undefined ? jumps : [];
     const routing = edgeRouting(edge);
      const path = routing === 'curved' ? curvedPath(route, curveStartDirection, curveEndDirection) : pointsToPath(route, renderedJumps, routing === 'orthogonal' ? edge.style.cornerRadius ?? 0 : 0);
     const masks = routing === 'orthogonal' && edge.style.jumpStyle !== 'none'
      ? jumpMaskPaths(route, jumps).map((mask) => `<path d="${mask}" fill="none" stroke="${escapeXml(exportBackground)}" stroke-width="${edge.style.strokeWidth + 4}" stroke-linecap="round"/>`).join('')
      : '';
    const edgeStroke = outlineOnly ? '#000000' : edge.style.stroke;
     const line = `<path d="${path}" fill="none" stroke="${escapeXml(edgeStroke)}" stroke-width="${edge.style.strokeWidth}" opacity="${edge.style.opacity ?? 1}"${edge.style.dash === 'dashed' ? ' stroke-dasharray="8 6"' : edge.style.dash === 'dotted' ? ' stroke-dasharray="2 5"' : ''}/>`;
      return `${masks}${line}${svgEndpointMarker(start, startMarkerDirection, edge.style.startMarker, edgeStroke, exportBackground, 'start', edge.style.opacity ?? 1)}${svgEndpointMarker(end, endMarkerDirection, edge.style.endMarker, edgeStroke, exportBackground, 'end', edge.style.opacity ?? 1)}`;
  }).join('');
  const nodeMarkup = nodes.map((node) => renderNode(node, outlineOnly)).join('');
  const viewBox = options.viewBox ?? { x: 0, y: 0, width, height };
  const backgroundMarkup = options.transparent ? '' : `<rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="${escapeXml(exportBackground)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${outlineOnly ? '#000000' : '#8a92ab'}"/></marker><marker id="arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto"><path d="M8,0 L0,4 L8,8 z" fill="${outlineOnly ? '#000000' : '#8a92ab'}"/></marker></defs>${backgroundMarkup}${edgeMarkup}${nodeMarkup}</svg>`;
}

function svgEndpointMarker(point: Point, direction: Point, marker: EdgeMarker, stroke: string, fill: string, endpoint: 'start' | 'end', opacity = 1): string {
  if (marker === 'none') return '';
  const angle = directionAngle(direction);
  const line = `fill="none" stroke="${escapeXml(stroke)}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;
  const circle = (center = 6) => `<circle cx="${center}" cy="0" r="6" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="1.6"/>`;
  const bar = (offset = 0) => `<path d="M ${offset} -7 L ${offset} 7" ${line}/>`;
  const crowfoot = (junction = 11) => `<path d="M ${junction} 0 L 0 -7 M ${junction} 0 L 0 0 M ${junction} 0 L 0 7" ${line}/>`;
  const glyph = marker === 'arrow'
    ? `<path d="M 0 0 L 10 -6 L 10 6 Z" fill="${escapeXml(stroke)}"/>`
    : marker === 'bar' ? bar()
      : marker === 'circle' ? circle()
        : marker === 'crowfoot' ? crowfoot()
          : marker === 'circle-bar' ? `${circle(18)}${bar()}`
            : marker === 'bar-crowfoot' ? `${bar(16)}${crowfoot()}`
              : `${circle(18)}${crowfoot()}`;
  const opacityMarkup = opacity === 1 ? '' : ` opacity="${opacity}"`;
  return `<g transform="translate(${point.x} ${point.y}) rotate(${angle})"${opacityMarkup}>${glyph}</g>`;
}

function outwardDirection(point: Point, neighbor: Point): Point {
  const dx = point.x - neighbor.x;
  const dy = point.y - neighbor.y;
  if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 0.001) return { x: Math.sign(dx), y: 0 };
  if (Math.abs(dy) > 0.001) return { x: 0, y: Math.sign(dy) };
  return { x: 1, y: 0 };
}

function endpointDirection(point: Point, neighbor: Point, node?: DiagramNode): Point {
  return node ? outwardDirection(point, nodeCenter(node)) : { x: point.x - neighbor.x, y: point.y - neighbor.y };
}

function markerDirection(point: Point, neighbor: Point): Point {
  return directionBetween(point, neighbor);
}

function directionBetween(from: Point, to: Point): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length > 0.001 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : { x: 1, y: 0 };
}

function directionAngle(direction: Point): number {
  const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
  return Math.abs(angle) === 180 ? 180 : angle;
}

function shapeRenderer(node: DiagramNode): string {
  const renderer = pluginManager.getShape(node.library, node.type)?.renderer
    ?? (node.library === 'dfd' && node.type === 'process' ? 'ellipse' : node.type);
  return notationRenderer(renderer, node);
}

function svgTextMarkup(node: DiagramNode, label: string, width: number, height: number, fill: string, options: { align?: 'left' | 'center' | 'right'; vertical?: 'top' | 'middle' | 'bottom'; padding?: number; fontFamily?: string } = {}): string {
  const layout = nodeTextLayout(label, node.style, width, height, options);
  const fontFamily = options.fontFamily ?? 'sans-serif';
  const content = layout.lines.length === 1
    ? escapeXml(layout.lines[0])
    : layout.lines.map((line, index) => `<tspan x="${layout.x}" dy="${index === 0 ? 0 : layout.lineHeight}">${escapeXml(line)}</tspan>`).join('');
  return `<text x="${layout.x}" y="${layout.firstBaseline}" text-anchor="${layout.textAnchor}" fill="${escapeXml(fill)}" font-family="${fontFamily}" font-size="${node.style.fontSize}" font-weight="${node.style.fontWeight}" opacity="${node.style.opacity}">${content}</text>`;
}

function renderNode(node: DiagramNode, outlineOnly = false): string {
  if (outlineOnly) {
    node = {
      ...node,
      style: {
        ...node.style,
        fill: outlineFill(node.style.fill),
        stroke: '#000000',
        textColor: '#000000',
        opacity: 1,
      },
    };
  }
  const { x, y } = node.position;
  const { width, height } = node.size;
  const fill = escapeXml(outlineOnly ? outlineFill(node.style.fill) : node.style.fill);
  const stroke = escapeXml(outlineOnly ? '#000000' : node.style.stroke);
  const label = escapeXml(typeof node.data.label === 'string' ? node.data.label : node.type);
  const rawLabel = typeof node.data.label === 'string' ? node.data.label : node.type;
  const textColor = escapeXml(outlineOnly ? '#000000' : node.style.textColor);
  const radius = node.style.radius;
  const renderer = shapeRenderer(node);
  const flipTransform = nodeFlipTransform(node);
  const transform = `translate(${x} ${y}) rotate(${node.rotation} ${width / 2} ${height / 2})${flipTransform ? ` ${flipTransform}` : ''}`;
  if (renderer === 'image') {
    const source = typeof node.data.src === 'string' && node.data.src.startsWith('data:image/') ? node.data.src : '';
    const labelMarkup = source ? '' : svgTextMarkup(node, rawLabel, width, height, textColor);
    return `<g transform="${transform}"><rect width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" stroke-width="${node.style.strokeWidth}" opacity="${node.style.opacity}"/>${source ? `<image href="${escapeXml(source)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>` : labelMarkup}</g>`;
  }
  const silhouette = shapeSilhouette(renderer, width, height, radius);
  if (silhouette) {
    const primitiveMarkup = svgSilhouetteMarkup(silhouette, fill, stroke, node.style.strokeWidth, node.style.opacity, renderer === 'line' || renderer === 'arrow-line' ? 'url(#arrow)' : undefined);
    const numberMarkup = renderer === 'gane-process' && typeof node.data.number === 'string'
      ? `<text x="${width / 2}" y="17" text-anchor="middle" fill="${textColor}" font-family="sans-serif" font-size="9" font-weight="600">${escapeXml(node.data.number)}</text>`
      : '';
    const labelOptions = ['package', 'folded-note', 'system-boundary'].includes(renderer)
      ? { align: 'left' as const, vertical: 'top' as const, padding: 14 }
      : renderer === 'actor' ? { vertical: 'bottom' as const } : {};
    const labelMarkup = ['line', 'arrow-line'].includes(renderer) ? '' : svgTextMarkup(node, rawLabel, width, height, textColor, labelOptions);
    return `<g transform="${transform}">${primitiveMarkup}${numberMarkup}${labelMarkup}</g>`;
  }
  if (renderer === 'entity') {
      const fields = normalizeEntityFields(node.data.fields);
      const columns = entityColumns(node.data.entityVariant, width);
      const showColumnHeaders = node.data.columnHeaders === true;
      const striped = node.data.striped !== false;
      const isWeak = node.data.weak === true;
      const isView = node.data.view === true;
         const rowFill = outlineOnly ? outlineFill(typeof node.data.rowFill === 'string' ? node.data.rowFill : node.style.fill) : typeof node.data.rowFill === 'string' ? node.data.rowFill : node.style.fill;
         const stripeFill = outlineOnly ? '#ffffff' : typeof node.data.stripeFill === 'string' ? node.data.stripeFill : rowFill === '#f2f3f7' ? '#e3e5e9' : '#252c3c';
         const headerFill = outlineOnly ? '#ffffff' : typeof node.data.headerFill === 'string' ? node.data.headerFill : node.style.stroke;
      const headerHeight = ERD_HEADER_HEIGHT;
      const { fieldTop, rowHeight } = entityLayoutMetrics(fields, height, showColumnHeaders);
     const columnHeaders = showColumnHeaders
       ? `<g><rect y="${headerHeight}" width="${width}" height="${ERD_COLUMN_HEADER_HEIGHT}" fill="${escapeXml(headerFill)}" opacity="0.42"/><line x1="0" y1="${fieldTop}" x2="${width}" y2="${fieldTop}" stroke="${stroke}" stroke-opacity="0.55"/>${columns.map((column) => `<text x="${column.id === 'key' ? column.x + column.width / 2 : column.x + 7}" y="${headerHeight + 15}" fill="${textColor}" font-family="monospace" font-size="9" font-weight="600"${column.id === 'key' ? ' text-anchor="middle"' : ''}>${escapeXml(column.label)}</text>`).join('')}</g>`
       : '';
     const fieldMarkup = fields.map((field, index) => {
       const rowY = fieldTop + index * rowHeight;
       const values = columns.map((column) => {
         const value = entityFieldValue(field, column.id);
         if (!value) return '';
         const isKey = column.id === 'key';
         const className = isKey ? ' font-weight="600" font-size="9" text-anchor="middle"' : column.id === 'field' ? ` font-size="10"${field.primaryKey ? ' text-decoration="underline"' : ''}${field.foreignKey ? ' font-style="italic"' : ''}` : ' fill-opacity="0.68" font-size="9"';
         const x = isKey ? column.x + column.width / 2 : column.x + 7;
          return `<text x="${x}" y="${rowY + rowHeight / 2 + 4}" fill="${textColor}" font-family="monospace"${className}>${escapeXml(value)}</text>`;
       }).join('');
       const dividers = columns.slice(0, -1).map((column) => `<line x1="${column.x + column.width}" y1="${rowY}" x2="${column.x + column.width}" y2="${rowY + rowHeight}" stroke="${stroke}" stroke-opacity="0.45"/>`).join('');
       return `<g><rect y="${rowY}" width="${width}" height="${rowHeight}" fill="${escapeXml(striped && index % 2 === 1 ? stripeFill : rowFill)}"/><line x1="0" y1="${rowY + rowHeight}" x2="${width}" y2="${rowY + rowHeight}" stroke="${stroke}" stroke-opacity="0.34"/>${dividers}${values}</g>`;
     }).join('');
         return `<g transform="${transform}" opacity="${node.style.opacity}"><rect width="${width}" height="${height}" rx="${radius}" fill="${escapeXml(rowFill)}" stroke="${stroke}" stroke-width="${node.style.strokeWidth}"${node.data.associative || isView ? ' stroke-dasharray="5 3"' : ''}/>${isWeak ? `<rect x="4" y="4" width="${Math.max(0, width - 8)}" height="${Math.max(0, height - 8)}" rx="${Math.max(0, radius - 2)}" fill="none" stroke="${stroke}" stroke-width="${node.style.strokeWidth}"/>` : ''}<rect width="${width}" height="${headerHeight}" rx="${radius}" fill="${escapeXml(headerFill)}"/><line x1="0" y1="${headerHeight}" x2="${width}" y2="${headerHeight}" stroke="${stroke}"/>${columnHeaders}<g>${fieldMarkup}</g><text x="${width / 2}" y="23" fill="${textColor}" font-family="monospace" font-size="${node.style.fontSize}" font-weight="${node.style.fontWeight}" text-anchor="middle">${label}</text></g>`;
   }
   if (renderer === 'boundary') {
       return `<g transform="${transform}"><rect width="${width}" height="${height}" rx="${radius}" fill="none" stroke="${stroke}" stroke-width="${node.style.strokeWidth}" stroke-dasharray="7 5" opacity="${node.style.opacity}"/>${svgTextMarkup(node, rawLabel, width, height, textColor, { align: 'left', vertical: 'top', padding: 18, fontFamily: 'monospace' })}</g>`;
  }
     return `<g transform="${transform}"><rect width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${node.style.strokeWidth}" opacity="${node.style.opacity}"/>${svgTextMarkup(node, rawLabel, width, height, textColor)}</g>`;
}

function svgSilhouetteMarkup(silhouette: ReturnType<typeof shapeSilhouette>, fill: string, stroke: string, strokeWidth: number, opacity: number, markerEnd?: string): string {
  if (!silhouette) return '';
  return silhouette.parts.map((part) => {
    const common = `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"`;
    if (part.kind === 'rect') return `<rect x="${part.x}" y="${part.y}" width="${part.width}" height="${part.height}" rx="${part.radius ?? 0}" ${common}/>`;
    if (part.kind === 'ellipse') return `<ellipse cx="${part.cx}" cy="${part.cy}" rx="${part.rx}" ry="${part.ry}" ${common}/>`;
    if (part.kind === 'polygon') return `<polygon points="${part.points.map((point) => `${point.x},${point.y}`).join(' ')}" ${common}/>`;
    if (part.kind === 'line') return `<line x1="${part.x1}" y1="${part.y1}" x2="${part.x2}" y2="${part.y2}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"${markerEnd ? ` marker-end="${markerEnd}"` : ''}/>`;
    return `<path d="${part.d}" fill-rule="${part.fillRule ?? 'nonzero'}" ${common}/>`;
  }).join('');
}

function exportScene(page: { nodes: DiagramNode[]; edges: DiagramEdge[] }, selectionIds?: string[]): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  if (!selectionIds || selectionIds.length === 0) return { nodes: page.nodes, edges: page.edges };
  const selected = new Set(selectionIds);
  const selectedEdges = page.edges.filter((edge) => selected.has(edge.id));
  const selectedNodeIds = new Set(page.nodes.filter((node) => selected.has(node.id)).map((node) => node.id));
  selectedEdges.forEach((edge) => {
    if (edge.source.nodeId) selectedNodeIds.add(edge.source.nodeId);
    if (edge.target.nodeId) selectedNodeIds.add(edge.target.nodeId);
  });
  const nodes = page.nodes.filter((node) => selectedNodeIds.has(node.id));
  const edges = page.edges.filter((edge) => selected.has(edge.id) || (edge.source.nodeId !== undefined && edge.target.nodeId !== undefined && selectedNodeIds.has(edge.source.nodeId) && selectedNodeIds.has(edge.target.nodeId) && selected.has(edge.source.nodeId) && selected.has(edge.target.nodeId)));
  return { nodes, edges };
}

export function pageExportBounds(pageWidth: number, pageHeight: number): { x: number; y: number; width: number; height: number } {
  return { x: -pageWidth / 2, y: -pageHeight / 2, width: pageWidth, height: pageHeight };
}

export function contentBounds(nodes: DiagramNode[], edges: DiagramEdge[], pageWidth: number, pageHeight: number, padding = 32): { x: number; y: number; width: number; height: number } {
  const points = [
    ...nodes.flatMap((node) => [node.position, { x: node.position.x + node.size.width, y: node.position.y + node.size.height }]),
    ...edges.flatMap((edge) => [edge.source.point, edge.target.point].filter((point): point is Point => Boolean(point))),
    ...edges.flatMap((edge) => edge.waypoints),
  ];
  if (points.length === 0) return pageExportBounds(pageWidth, pageHeight);
  const minX = Math.min(...points.map((point) => point.x)) - padding;
  const minY = Math.min(...points.map((point) => point.y)) - padding;
  const maxX = Math.max(...points.map((point) => point.x)) + padding;
  const maxY = Math.max(...points.map((point) => point.y)) + padding;
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

function outlineFill(value: string): string {
  return value === 'none' || value === 'transparent' ? 'none' : '#ffffff';
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character);
}
