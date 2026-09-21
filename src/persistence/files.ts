import { parseProject, serializeProject } from '../core/document';
import { curvedPath, edgeRoute, pointsToPath } from '../core/routing';
import type { DiagramDocument, DiagramEdge, DiagramNode } from '../core/types';

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
    const route = edgeRoute(edge, source, target);
    const path = edge.type === 'curved' ? curvedPath(route) : pointsToPath(route);
    return `<path d="${path}" fill="none" stroke="${escapeXml(edge.style.stroke)}" stroke-width="${edge.style.strokeWidth}"${edge.style.dash === 'dashed' ? ' stroke-dasharray="8 6"' : ''}${edge.style.startMarker === 'arrow' ? ' marker-start="url(#arrow-start)"' : ''}${edge.style.endMarker === 'arrow' ? ' marker-end="url(#arrow)"' : ''}/>`;
  }).join('');
  const nodeMarkup = nodes.map(renderNode).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8a92ab"/></marker><marker id="arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto"><path d="M8,0 L0,4 L8,8 z" fill="#8a92ab"/></marker></defs><rect width="100%" height="100%" fill="${escapeXml(background)}"/>${edgeMarkup}${nodeMarkup}</svg>`;
}

function renderNode(node: DiagramNode): string {
  const { x, y } = node.position;
  const { width, height } = node.size;
  const fill = escapeXml(node.style.fill);
  const stroke = escapeXml(node.style.stroke);
  const label = escapeXml(typeof node.data.label === 'string' ? node.data.label : node.type);
  const radius = node.style.radius;
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
