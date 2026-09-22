import { createDocument, createEdge, createNode } from './document';
import type { DiagramDocument, DiagramEdge, DiagramNode } from './types';

export type InterchangeFormat = 'mermaid' | 'plantuml';
const MAX_INTERCHANGE_LENGTH = 10 * 1024 * 1024;
const MAX_INTERCHANGE_NODES = 50000;
const MAX_INTERCHANGE_EDGES = 100000;

/** Export a small, deliberately loss-bounded graph representation. */
export function exportDiagramText(document: DiagramDocument, format: InterchangeFormat = 'mermaid', pageId = document.pages[0]?.id): string {
  const page = document.pages.find((candidate) => candidate.id === pageId) ?? document.pages[0];
  if (!page) return format === 'plantuml' ? '@startuml\n@enduml' : 'graph TD';
  return format === 'plantuml' ? exportPlantUml(page.nodes, page.edges) : exportMermaid(page.nodes, page.edges);
}

export function exportMermaid(nodes: DiagramNode[], edges: DiagramEdge[]): string {
  const ids = new Map(nodes.map((node, index) => [node.id, `n${index + 1}`]));
  const declarations = nodes.map((node) => {
    const id = ids.get(node.id)!;
    const label = mermaidLabel(node);
    if (node.type === 'diamond' || node.type === 'decision') return `  ${id}{${label}}`;
    if (node.type === 'circle' || node.type === 'connector' || node.type === 'use-case' || node.type === 'process') return `  ${id}((${label}))`;
    return `  ${id}[${label}]`;
  });
  const links = edges.flatMap((edge) => {
    const source = edge.source.nodeId ? ids.get(edge.source.nodeId) : undefined;
    const target = edge.target.nodeId ? ids.get(edge.target.nodeId) : undefined;
    if (!source || !target) return [];
    const label = typeof edge.data.label === 'string' ? edge.data.label.trim() : '';
    return [`  ${source} -->${label ? `|${escapeMermaid(label)}|` : ''} ${target}`];
  });
  return ['graph TD', ...declarations, ...links].join('\n');
}

export function exportPlantUml(nodes: DiagramNode[], edges: DiagramEdge[]): string {
  const ids = new Map(nodes.map((node, index) => [node.id, `n${index + 1}`]));
  const declarations = nodes.map((node) => {
    const id = ids.get(node.id)!;
    const label = plantUmlLabel(node);
    const keyword = node.type === 'use-case' ? 'usecase' : node.type === 'actor' ? 'actor' : node.type === 'database' ? 'database' : 'rectangle';
    return `${keyword} "${escapePlantUml(label)}" as ${id}`;
  });
  const links = edges.flatMap((edge) => {
    const source = edge.source.nodeId ? ids.get(edge.source.nodeId) : undefined;
    const target = edge.target.nodeId ? ids.get(edge.target.nodeId) : undefined;
    if (!source || !target) return [];
    const label = typeof edge.data.label === 'string' ? edge.data.label.trim() : '';
    return [`${source} --> ${target}${label ? ` : ${escapePlantUml(label)}` : ''}`];
  });
  return ['@startuml', ...declarations, ...links, '@enduml'].join('\n');
}

export function parseDiagramText(text: string, format: InterchangeFormat = 'mermaid'): DiagramDocument {
  if (text.length > MAX_INTERCHANGE_LENGTH) throw new Error('This interchange file is too large to import safely.');
  return format === 'plantuml' ? parsePlantUml(text) : parseMermaid(text);
}

export function parseMermaid(text: string): DiagramDocument {
  const document = createDocument('Imported Mermaid diagram', 'general');
  const page = document.pages[0];
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const ensureNode = (token: string): DiagramNode => {
    const parsed = parseMermaidNode(token);
    const existing = nodes.get(parsed.id);
    if (existing) return existing;
    if (nodes.size >= MAX_INTERCHANGE_NODES) throw new Error('This interchange file contains too many objects.');
    const index = nodes.size;
    const node = createNode(parsed.type, { x: (index % 4) * 240, y: Math.floor(index / 4) * 150 }, { data: { label: parsed.label } });
    nodes.set(parsed.id, node);
    return node;
  };
  text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^%%/.test(line) && !/^graph\b/i.test(line) && !/^flowchart\b/i.test(line)).forEach((line) => {
    const arrow = line.search(/[-=.]+>/);
    if (arrow < 0) {
      const node = ensureNode(line);
      if (!page.nodes.includes(node)) page.nodes.push(node);
      return;
    }
    const arrowMatch = line.slice(arrow).match(/^[-=.]+>/);
    const arrowLength = arrowMatch?.[0].length ?? 3;
    const left = ensureNode(line.slice(0, arrow).trim());
    const rightText = line.slice(arrow + arrowLength).trim();
    const labelMatch = rightText.match(/^\|([^|]*)\|\s*/);
    const label = labelMatch?.[1]?.trim() ?? '';
    const right = ensureNode((labelMatch ? rightText.slice(labelMatch[0].length) : rightText).trim());
    if (!page.nodes.includes(left)) page.nodes.push(left);
    if (!page.nodes.includes(right)) page.nodes.push(right);
    if (edges.length >= MAX_INTERCHANGE_EDGES) throw new Error('This interchange file contains too many connectors.');
    edges.push(createEdge({ nodeId: left.id }, { nodeId: right.id }, { data: label ? { label } : {} }));
  });
  page.edges = edges;
  return document;
}

export function parsePlantUml(text: string): DiagramDocument {
  const document = createDocument('Imported PlantUML diagram', 'general');
  const page = document.pages[0];
  const nodes = new Map<string, DiagramNode>();
  const ensureNode = (id: string, label = id, keyword = 'rectangle'): DiagramNode => {
    const existing = nodes.get(id);
    if (existing) return existing;
    if (nodes.size >= MAX_INTERCHANGE_NODES) throw new Error('This interchange file contains too many objects.');
    const type = keyword.toLowerCase() === 'usecase' ? 'use-case' : keyword.toLowerCase() === 'actor' ? 'actor' : keyword.toLowerCase() === 'database' ? 'database' : 'rectangle';
    const index = nodes.size;
    const node = createNode(type, { x: (index % 4) * 240, y: Math.floor(index / 4) * 150 }, { library: type === 'use-case' || type === 'actor' ? 'use-case' : 'flowchart', data: { label } });
    nodes.set(id, node);
    return node;
  };
  text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const declaration = line.match(/^(rectangle|usecase|actor|database)\s+"([^"]*)"\s+as\s+([\w-]+)/i);
    if (declaration) {
      const node = ensureNode(declaration[3], declaration[2], declaration[1]);
      if (!page.nodes.includes(node)) page.nodes.push(node);
      return;
    }
    const relation = line.match(/^([\w-]+)\s+[-.]+>\s+([\w-]+)(?:\s*:\s*(.*))?$/);
    if (!relation) return;
    const source = ensureNode(relation[1]);
    const target = ensureNode(relation[2]);
    if (!page.nodes.includes(source)) page.nodes.push(source);
    if (!page.nodes.includes(target)) page.nodes.push(target);
    if (page.edges.length >= MAX_INTERCHANGE_EDGES) throw new Error('This interchange file contains too many connectors.');
    page.edges.push(createEdge({ nodeId: source.id }, { nodeId: target.id }, { data: relation[3]?.trim() ? { label: relation[3].trim() } : {} }));
  });
  return document;
}

function parseMermaidNode(token: string): { id: string; label: string; type: string } {
  const trimmed = token.replace(/^[-.]+/, '').trim();
  const idMatch = trimmed.match(/^([\w-]+)/);
  const id = idMatch?.[1] ?? `node-${Math.random().toString(36).slice(2, 8)}`;
  const rest = trimmed.slice(id.length).trim();
  if (rest.startsWith('((')) return { id, type: 'circle', label: rest.slice(2).split('))')[0] || id };
  if (rest.startsWith('{')) return { id, type: 'diamond', label: rest.slice(1).split('}')[0] || id };
  if (rest.startsWith('[')) return { id, type: 'rectangle', label: rest.slice(1).split(']')[0] || id };
  return { id, type: 'rectangle', label: id };
}

function mermaidLabel(node: DiagramNode): string {
  return escapeMermaid(typeof node.data.label === 'string' ? node.data.label : node.type);
}

function plantUmlLabel(node: DiagramNode): string {
  return typeof node.data.label === 'string' ? node.data.label : node.type;
}

function escapeMermaid(value: string): string {
  return value.replace(/[\[\]{}|]/g, '').replace(/\s+/g, ' ').trim() || 'Unnamed';
}

function escapePlantUml(value: string): string {
  return value.replace(/"/g, "'").replace(/\r?\n/g, ' ').trim() || 'Unnamed';
}
