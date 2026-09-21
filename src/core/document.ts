import type {
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
  DiagramPage,
  DiagramType,
  EdgeStyle,
  NodeStyle,
  Point,
  SerializedProject,
} from './types';

export const CURRENT_SCHEMA_VERSION = 1;

export const defaultNodeStyle: NodeStyle = {
  fill: '#171b28',
  stroke: '#59627a',
  strokeWidth: 1.5,
  radius: 10,
  opacity: 1,
  textColor: '#f4f5fa',
};

export const defaultEdgeStyle: EdgeStyle = {
  stroke: '#8a92ab',
  strokeWidth: 1.6,
  dash: 'solid',
  startMarker: 'none',
  endMarker: 'arrow',
  labelColor: '#aeb5c9',
};

export function createId(prefix = 'id'): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid}`;
}

export function createPage(name = 'Page 1'): DiagramPage {
  return {
    id: createId('page'),
    name,
    nodes: [],
    edges: [],
    settings: {
      width: 1600,
      height: 1000,
      background: '#10131c',
      gridSize: 16,
      gridVisible: true,
      snapToGrid: true,
    },
  };
}

export function createDocument(
  name = 'Untitled diagram',
  diagramType: DiagramType = 'general',
): DiagramDocument {
  const now = Date.now();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: createId('doc'),
    name,
    diagramType,
    pages: [createPage()],
    createdAt: now,
    updatedAt: now,
  };
}

export function createNode(
  type: string,
  position: Point,
  options: Partial<Pick<DiagramNode, 'library' | 'size' | 'data'>> & { style?: Partial<NodeStyle> } = {},
): DiagramNode {
  return {
    id: createId('node'),
    library: options.library ?? 'general',
    type,
    position: { ...position },
    size: options.size ?? { width: 180, height: 88 },
    rotation: 0,
    style: { ...defaultNodeStyle, ...options.style },
    data: options.data ?? { label: type },
    zIndex: 0,
  };
}

export function createEdge(
  source: DiagramEdge['source'],
  target: DiagramEdge['target'],
  options: Partial<Pick<DiagramEdge, 'type' | 'data'>> & { style?: Partial<EdgeStyle> } = {},
): DiagramEdge {
  return {
    id: createId('edge'),
    type: options.type ?? 'straight',
    source: { ...source },
    target: { ...target },
    waypoints: [],
    style: { ...defaultEdgeStyle, ...options.style },
    data: options.data ?? {},
  };
}

export function cloneDocument(document: DiagramDocument): DiagramDocument {
  return structuredClone(document);
}

export function getPage(document: DiagramDocument, pageId: string): DiagramPage | undefined {
  return document.pages.find((page) => page.id === pageId);
}

export function getNode(document: DiagramDocument, pageId: string, nodeId: string): DiagramNode | undefined {
  return getPage(document, pageId)?.nodes.find((node) => node.id === nodeId);
}

export function serializeProject(document: DiagramDocument): string {
  const project: SerializedProject = {
    format: 'aperglyph',
    formatVersion: 1,
    document,
  };
  return JSON.stringify(project, null, 2);
}

export function parseProject(raw: string): DiagramDocument {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.format !== 'aperglyph' || !isRecord(parsed.document)) {
    throw new Error('This file is not a valid AperGlyph project.');
  }

  const document = parsed.document as Partial<DiagramDocument>;
  if (typeof document.id !== 'string' || typeof document.name !== 'string' || !Array.isArray(document.pages)) {
    throw new Error('The AperGlyph project is missing required document fields.');
  }

  return migrateDocument(document);
}

export function migrateDocument(input: Partial<DiagramDocument>): DiagramDocument {
  const base = createDocument(input.name ?? 'Recovered diagram', input.diagramType ?? 'general');
  const pages = Array.isArray(input.pages) && input.pages.length > 0
    ? input.pages.map((page, index) => ({
      ...createPage(page.name ?? `Page ${index + 1}`),
      ...page,
      settings: { ...createPage().settings, ...(page.settings ?? {}) },
      nodes: Array.isArray(page.nodes) ? page.nodes : [],
      edges: Array.isArray(page.edges) ? page.edges : [],
    }))
    : base.pages;

  return {
    ...base,
    ...input,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: input.id ?? base.id,
    name: input.name ?? base.name,
    diagramType: input.diagramType ?? base.diagramType,
    pages,
    createdAt: input.createdAt ?? base.createdAt,
    updatedAt: input.updatedAt ?? Date.now(),
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
