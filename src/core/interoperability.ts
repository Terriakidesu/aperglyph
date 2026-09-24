import { importDiagramCode } from './codeImport';
import type { DiagramDocument, DiagramEdge, DiagramNode } from './types';

export type InterchangeFormat = 'mermaid' | 'plantuml';
const MAX_INTERCHANGE_LENGTH = 10 * 1024 * 1024;

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
  const imported = importDiagramCode(text, format);
  if (!imported.document) throw new Error(imported.diagnostics[0]?.message ?? 'Unable to parse diagram source.');
  return imported.document;
}

export function parseMermaid(text: string): DiagramDocument {
  const imported = importDiagramCode(text, 'mermaid');
  if (!imported.document) throw new Error(imported.diagnostics[0]?.message ?? 'Unable to parse Mermaid source.');
  return imported.document;
}

export function parsePlantUml(text: string): DiagramDocument {
  const imported = importDiagramCode(text, 'plantuml');
  if (!imported.document) throw new Error(imported.diagnostics[0]?.message ?? 'Unable to parse PlantUML source.');
  return imported.document;
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
