import { nearestConnectionPort, nodeCenter } from './geometry';
import { wrappedNodeHeight } from './text';
import type {
  CanvasTheme,
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
  DiagramPage,
  DiagramType,
  EdgeStyle,
  FontWeight,
  NodeStyle,
  Point,
  SerializedProject,
  ShapeBoundary,
  TextAlign,
  VerticalAlign,
} from './types';
import { defaultSnapSettings } from './snapping';

export const CURRENT_SCHEMA_VERSION = 1;
const MAX_PAGES = 1000;
const MAX_NODES_PER_PAGE = 50000;
const MAX_EDGES_PER_PAGE = 100000;
const MAX_WAYPOINTS_PER_EDGE = 10000;
const MAX_STRING_LENGTH = 10000;
const MAX_PROJECT_BYTES = 50 * 1024 * 1024;
const diagramTypes = new Set<DiagramType>(['general', 'flowchart', 'erd', 'dfd', 'use-case']);
const edgeMarkers = new Set(['none', 'arrow', 'bar', 'circle', 'crowfoot', 'circle-bar', 'bar-crowfoot', 'circle-crowfoot']);
const edgeDashes = new Set(['solid', 'dashed', 'dotted']);
const edgeJumpStyles = new Set(['arc', 'gap', 'none']);
const canvasThemes = new Set<CanvasTheme>(['dark', 'light']);
const textAlignments = new Set<TextAlign>(['left', 'center', 'right']);
const verticalAlignments = new Set<VerticalAlign>(['top', 'middle', 'bottom']);
const fontWeights = new Set<FontWeight>([400, 500, 600, 700]);

export const defaultDocumentPalette = ['#171b28', '#2c2752', '#1f2e43', '#15362f', '#302b24', '#f2f3f7'];

export const defaultNodeStyle: NodeStyle = {
  fill: '#171b28',
  stroke: '#59627a',
  strokeWidth: 1.5,
  radius: 10,
  opacity: 1,
  textColor: '#f4f5fa',
  fontSize: 12,
  fontWeight: 500,
  textAlign: 'center',
  verticalAlign: 'middle',
  textWrap: true,
  autoHeight: true,
};

export const defaultEdgeStyle: EdgeStyle = {
  stroke: '#8a92ab',
  strokeWidth: 1.6,
  dash: 'solid',
  startMarker: 'none',
  endMarker: 'arrow',
  labelColor: '#aeb5c9',
  opacity: 1,
  jumpStyle: 'arc',
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
      canvasTheme: 'dark',
      gridSize: 16,
      gridVisible: true,
      snapToGrid: true,
      snapSettings: { ...defaultSnapSettings },
    },
    guides: [],
  };
}

export function createDocument(
  name = 'Untitled diagram',
  diagramType: DiagramType = 'general',
): DiagramDocument {
  const now = Date.now();
  const page = createPage();
  if (diagramType === 'dfd') page.data = { dfdLevel: 0, dataDictionary: [] };
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: createId('doc'),
    name,
    diagramType,
    pages: [page],
    palette: [...defaultDocumentPalette],
    stylePresets: [],
    styleDefaults: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function createNode(
  type: string,
  position: Point,
  options: Partial<Pick<DiagramNode, 'library' | 'size' | 'data' | 'container'>> & { style?: Partial<NodeStyle>; boundary?: ShapeBoundary } = {},
): DiagramNode {
  const node: DiagramNode = {
    id: createId('node'),
    library: options.library ?? 'general',
    type,
    position: { ...position },
    size: options.size ?? { width: 180, height: 88 },
    rotation: 0,
    ...(options.boundary ? { boundary: options.boundary } : {}),
    ...(options.container ? { container: true } : {}),
    style: {
      ...defaultNodeStyle,
      ...(type === 'entity' ? { textWrap: false, autoHeight: false } : {}),
      ...options.style,
    },
    data: options.data ?? { label: type },
    zIndex: 0,
  };
  const requiredHeight = wrappedNodeHeight(node);
  if (requiredHeight > node.size.height) node.size = { ...node.size, height: requiredHeight };
  return node;
}

export function createEdge(
  source: DiagramEdge['source'],
  target: DiagramEdge['target'],
  options: Partial<Pick<DiagramEdge, 'type' | 'data' | 'routing'>> & { style?: Partial<EdgeStyle> } = {},
): DiagramEdge {
  return {
    id: createId('edge'),
    type: options.type ?? 'straight',
    source: { ...source },
    target: { ...target },
    waypoints: [],
    style: { ...defaultEdgeStyle, ...options.style },
    data: options.data ?? {},
    ...(options.routing ? { routing: structuredClone(options.routing) } : {}),
  };
}

export function cloneDocument(document: DiagramDocument): DiagramDocument {
  return structuredClone(document);
}

/** Clone a page with fresh IDs so it can safely coexist with the source page. */
export function clonePageWithNewIds(source: DiagramPage, name = `${source.name} copy`): DiagramPage {
  const groupIds = new Map<string, string>();
  const nodeIds = new Map<string, string>();
  const nodes = source.nodes.map((node) => {
    const id = createId('node');
    nodeIds.set(node.id, id);
    const groupId = node.groupId
      ? (groupIds.get(node.groupId) ?? (() => {
        const next = createId('group');
        groupIds.set(node.groupId!, next);
        return next;
      })())
      : undefined;
    return { ...structuredClone(node), id, groupId };
  }).map((node, index) => ({
    ...node,
    containerId: source.nodes[index].containerId ? nodeIds.get(source.nodes[index].containerId!) : undefined,
  }));
  const edges = source.edges.map((edge) => ({
    ...structuredClone(edge),
    id: createId('edge'),
    source: remapEndpoint(edge.source, nodeIds),
    target: remapEndpoint(edge.target, nodeIds),
  }));
  return {
    ...structuredClone(source),
    id: createId('page'),
    name,
    nodes,
    edges,
  };
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
  if (raw.length > MAX_PROJECT_BYTES) throw new Error('This AperGlyph project is too large to import safely.');
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.format !== 'aperglyph' || !isRecord(parsed.document)) {
    throw new Error('This file is not a valid AperGlyph project.');
  }
  if (parsed.formatVersion !== undefined && parsed.formatVersion !== 1) throw new Error('Unsupported AperGlyph project format version.');
  const errors = validateProjectDocument(parsed.document);
  if (errors.length > 0) throw new Error(`Invalid AperGlyph project: ${errors[0]}`);
  return migrateDocument(parsed.document as Partial<DiagramDocument>);
}

export function validateProjectDocument(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['document must be an object'];
  if (!isBoundedString(value.id, 'document.id', 1, 256, errors)) return errors;
  isBoundedString(value.name, 'document.name', 1, 256, errors);
  if (value.schemaVersion !== undefined && (!isInteger(value.schemaVersion) || value.schemaVersion < 1 || value.schemaVersion > CURRENT_SCHEMA_VERSION)) errors.push('document.schemaVersion is unsupported');
  if (value.diagramType !== undefined && (typeof value.diagramType !== 'string' || !diagramTypes.has(value.diagramType as DiagramType))) errors.push('document.diagramType is invalid');
  validatePalette(value.palette, 'document.palette', errors);
  validateStylePresets(value.stylePresets, 'document.stylePresets', errors);
  validateStyleDefaults(value.styleDefaults, 'document.styleDefaults', errors);
  finiteInRange(value.createdAt, 'document.createdAt', 0, 100000000000000, errors);
  finiteInRange(value.updatedAt, 'document.updatedAt', 0, 100000000000000, errors);
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > MAX_PAGES) {
    errors.push(`document.pages must contain between 1 and ${MAX_PAGES} pages`);
    return errors;
  }
  const pageIds = new Set<string>();
  value.pages.forEach((page, pageIndex) => validatePage(page, pageIndex, pageIds, errors));
  return errors;
}

function validatePalette(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 64) { errors.push(`${path} must contain at most 64 colors`); return; }
  value.forEach((color, index) => isBoundedString(color, `${path}[${index}]`, 1, 64, errors));
}

function validateStylePresets(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 64) { errors.push(`${path} must contain at most 64 presets`); return; }
  value.forEach((preset, index) => {
    const presetPath = `${path}[${index}]`;
    if (!isRecord(preset)) { errors.push(`${presetPath} must be an object`); return; }
    isBoundedString(preset.id, `${presetPath}.id`, 1, 256, errors);
    isBoundedString(preset.name, `${presetPath}.name`, 1, 128, errors);
    if (!isRecord(preset.style)) errors.push(`${presetPath}.style must be an object`);
    else validatePartialNodeStyle(preset.style, `${presetPath}.style`, errors);
  });
}

function validateStyleDefaults(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || Object.keys(value).length > 128) {
    errors.push(`${path} must contain at most 128 shape defaults`);
    return;
  }
  Object.entries(value).forEach(([key, style]) => {
    if (key.length < 1 || key.length > 256) errors.push(`${path}.${key} has an invalid shape key`);
    if (!isRecord(style)) errors.push(`${path}.${key} must be an object`);
    else validatePartialNodeStyle(style, `${path}.${key}`, errors);
  });
}

function validatePage(value: unknown, pageIndex: number, pageIds: Set<string>, errors: string[]): void {
  const path = `pages[${pageIndex}]`;
  if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
  if (!isBoundedString(value.id, `${path}.id`, 1, 256, errors)) return;
  if (pageIds.has(value.id as string)) errors.push(`${path}.id is duplicated`);
  pageIds.add(value.id as string);
  isBoundedString(value.name, `${path}.name`, 1, 256, errors);
  if (!Array.isArray(value.nodes) || value.nodes.length > MAX_NODES_PER_PAGE) errors.push(`${path}.nodes exceeds the maximum size`);
  if (!Array.isArray(value.edges) || value.edges.length > MAX_EDGES_PER_PAGE) errors.push(`${path}.edges exceeds the maximum size`);
  validatePageSettings(value.settings, `${path}.settings`, errors);
  if (value.data !== undefined) validateData(value.data, `${path}.data`, errors);
  if (value.guides !== undefined) {
    if (!Array.isArray(value.guides) || value.guides.length > 1000) errors.push(`${path}.guides exceeds the maximum size`);
    else value.guides.forEach((guide, index) => validateGuide(guide, `${path}.guides[${index}]`, errors));
  }
  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const edges = Array.isArray(value.edges) ? value.edges : [];
  const nodeIds = new Set<string>();
  nodes.forEach((node, index) => validateNode(node, `${path}.nodes[${index}]`, nodeIds, errors));
  nodes.forEach((node, index) => {
    if (!isRecord(node) || node.containerId === undefined) return;
    if (typeof node.containerId !== 'string' || !nodeIds.has(node.containerId)) errors.push(`${path}.nodes[${index}].containerId references a missing node`);
    if (node.containerId === node.id) errors.push(`${path}.nodes[${index}].containerId cannot reference itself`);
    const owner = nodes.find((candidate) => isRecord(candidate) && candidate.id === node.containerId);
    if (owner && owner.container !== true) errors.push(`${path}.nodes[${index}].containerId must reference a container node`);
  });
  nodes.forEach((node, index) => {
    if (!isRecord(node) || typeof node.id !== 'string') return;
    const visited = new Set<string>();
    let owner = typeof node.containerId === 'string' ? node.containerId : undefined;
    while (owner) {
      if (visited.has(owner)) {
        errors.push(`${path}.nodes[${index}].containerId contains a cycle`);
        break;
      }
      visited.add(owner);
      const parent = nodes.find((candidate) => isRecord(candidate) && candidate.id === owner);
      owner = parent && typeof parent.containerId === 'string' ? parent.containerId : undefined;
    }
  });
  const edgeIds = new Set<string>();
  edges.forEach((edge, index) => validateEdge(edge, `${path}.edges[${index}]`, edgeIds, nodeIds, errors));
}

function validatePageSettings(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
  finiteInRange(value.width, `${path}.width`, 320, 100000, errors);
  finiteInRange(value.height, `${path}.height`, 240, 100000, errors);
  isBoundedString(value.background, `${path}.background`, 1, 64, errors);
  if (value.canvasTheme !== undefined && (typeof value.canvasTheme !== 'string' || !canvasThemes.has(value.canvasTheme as CanvasTheme))) errors.push(`${path}.canvasTheme is invalid`);
  finiteInRange(value.gridSize, `${path}.gridSize`, 1, 512, errors);
  if (typeof value.gridVisible !== 'boolean') errors.push(`${path}.gridVisible must be boolean`);
  if (value.snapToGrid !== undefined && typeof value.snapToGrid !== 'boolean') errors.push(`${path}.snapToGrid must be boolean`);
  if (value.snapSettings !== undefined) {
    const snapSettings = value.snapSettings;
    if (!isRecord(snapSettings)) errors.push(`${path}.snapSettings must be an object`);
    else (['grid', 'objects', 'guides', 'ports'] as const).forEach((key) => {
      if (snapSettings[key] !== undefined && typeof snapSettings[key] !== 'boolean') errors.push(`${path}.snapSettings.${key} must be boolean`);
    });
  }
}

function validateGuide(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
  isBoundedString(value.id, `${path}.id`, 1, 256, errors);
  if (value.orientation !== 'horizontal' && value.orientation !== 'vertical') errors.push(`${path}.orientation is invalid`);
  finiteInRange(value.position, `${path}.position`, -100000000, 100000000, errors);
  if (value.locked !== undefined && typeof value.locked !== 'boolean') errors.push(`${path}.locked must be boolean`);
}

function validateNode(value: unknown, path: string, ids: Set<string>, errors: string[]): void {
  if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
  if (!isBoundedString(value.id, `${path}.id`, 1, 256, errors)) return;
  if (ids.has(value.id as string)) errors.push(`${path}.id is duplicated`);
  ids.add(value.id as string);
  isBoundedString(value.library, `${path}.library`, 1, 128, errors);
  isBoundedString(value.type, `${path}.type`, 1, 128, errors);
  validatePoint(value.position, `${path}.position`, errors);
  if (!isRecord(value.size)) errors.push(`${path}.size must be an object`);
  else { finiteInRange(value.size.width, `${path}.size.width`, 1, 100000, errors); finiteInRange(value.size.height, `${path}.size.height`, 1, 100000, errors); }
  finiteInRange(value.rotation, `${path}.rotation`, -360000, 360000, errors);
  if (value.boundary !== undefined && value.boundary !== 'rectangle' && value.boundary !== 'ellipse' && value.boundary !== 'diamond') errors.push(`${path}.boundary is invalid`);
  if (value.locked !== undefined && typeof value.locked !== 'boolean') errors.push(`${path}.locked must be boolean`);
  if (value.hidden !== undefined && typeof value.hidden !== 'boolean') errors.push(`${path}.hidden must be boolean`);
  if (value.groupId !== undefined) isBoundedString(value.groupId, `${path}.groupId`, 1, 256, errors);
  if (value.containerId !== undefined) isBoundedString(value.containerId, `${path}.containerId`, 1, 256, errors);
  if (value.container !== undefined && typeof value.container !== 'boolean') errors.push(`${path}.container must be boolean`);
  if (value.zIndex !== undefined) finiteInRange(value.zIndex, `${path}.zIndex`, -100000000, 100000000, errors);
  validateNodeStyle(value.style, `${path}.style`, errors);
  validateData(value.data, `${path}.data`, errors);
}

function validateNodeStyle(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
  isBoundedString(value.fill, `${path}.fill`, 1, 64, errors);
  isBoundedString(value.stroke, `${path}.stroke`, 1, 64, errors);
  finiteInRange(value.strokeWidth, `${path}.strokeWidth`, 0, 100, errors);
  finiteInRange(value.radius, `${path}.radius`, 0, 100000, errors);
  finiteInRange(value.opacity, `${path}.opacity`, 0, 1, errors);
  isBoundedString(value.textColor, `${path}.textColor`, 1, 64, errors);
  if (value.fontSize !== undefined) finiteInRange(value.fontSize, `${path}.fontSize`, 6, 96, errors);
  if (value.fontWeight !== undefined && (typeof value.fontWeight !== 'number' || !fontWeights.has(value.fontWeight as FontWeight))) errors.push(`${path}.fontWeight is invalid`);
  if (value.textAlign !== undefined && (typeof value.textAlign !== 'string' || !textAlignments.has(value.textAlign as TextAlign))) errors.push(`${path}.textAlign is invalid`);
  if (value.verticalAlign !== undefined && (typeof value.verticalAlign !== 'string' || !verticalAlignments.has(value.verticalAlign as VerticalAlign))) errors.push(`${path}.verticalAlign is invalid`);
  if (value.textWrap !== undefined && typeof value.textWrap !== 'boolean') errors.push(`${path}.textWrap must be boolean`);
  if (value.autoHeight !== undefined && typeof value.autoHeight !== 'boolean') errors.push(`${path}.autoHeight must be boolean`);
}

function validatePartialNodeStyle(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (value.fill !== undefined) isBoundedString(value.fill, `${path}.fill`, 1, 64, errors);
  if (value.stroke !== undefined) isBoundedString(value.stroke, `${path}.stroke`, 1, 64, errors);
  if (value.strokeWidth !== undefined) finiteInRange(value.strokeWidth, `${path}.strokeWidth`, 0, 100, errors);
  if (value.radius !== undefined) finiteInRange(value.radius, `${path}.radius`, 0, 100000, errors);
  if (value.opacity !== undefined) finiteInRange(value.opacity, `${path}.opacity`, 0, 1, errors);
  if (value.textColor !== undefined) isBoundedString(value.textColor, `${path}.textColor`, 1, 64, errors);
  if (value.fontSize !== undefined) finiteInRange(value.fontSize, `${path}.fontSize`, 6, 96, errors);
  if (value.fontWeight !== undefined && (typeof value.fontWeight !== 'number' || !fontWeights.has(value.fontWeight as FontWeight))) errors.push(`${path}.fontWeight is invalid`);
  if (value.textAlign !== undefined && (typeof value.textAlign !== 'string' || !textAlignments.has(value.textAlign as TextAlign))) errors.push(`${path}.textAlign is invalid`);
  if (value.verticalAlign !== undefined && (typeof value.verticalAlign !== 'string' || !verticalAlignments.has(value.verticalAlign as VerticalAlign))) errors.push(`${path}.verticalAlign is invalid`);
  if (value.textWrap !== undefined && typeof value.textWrap !== 'boolean') errors.push(`${path}.textWrap must be boolean`);
  if (value.autoHeight !== undefined && typeof value.autoHeight !== 'boolean') errors.push(`${path}.autoHeight must be boolean`);
}

function validateEdge(value: unknown, path: string, ids: Set<string>, nodeIds: Set<string>, errors: string[]): void {
  if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
  if (!isBoundedString(value.id, `${path}.id`, 1, 256, errors)) return;
  if (ids.has(value.id as string)) errors.push(`${path}.id is duplicated`);
  ids.add(value.id as string);
  isBoundedString(value.type, `${path}.type`, 1, 128, errors);
  validateEndpoint(value.source, `${path}.source`, nodeIds, errors);
  validateEndpoint(value.target, `${path}.target`, nodeIds, errors);
  if (!Array.isArray(value.waypoints) || value.waypoints.length > MAX_WAYPOINTS_PER_EDGE) errors.push(`${path}.waypoints exceeds the maximum size`);
  (Array.isArray(value.waypoints) ? value.waypoints : []).forEach((point, index) => validatePoint(point, `${path}.waypoints[${index}]`, errors));
  if (!isRecord(value.style)) errors.push(`${path}.style must be an object`);
  else {
    isBoundedString(value.style.stroke, `${path}.style.stroke`, 1, 64, errors);
    finiteInRange(value.style.strokeWidth, `${path}.style.strokeWidth`, 0, 100, errors);
    if (value.style.opacity !== undefined) finiteInRange(value.style.opacity, `${path}.style.opacity`, 0, 1, errors);
    if (value.style.jumpStyle !== undefined && (typeof value.style.jumpStyle !== 'string' || !edgeJumpStyles.has(value.style.jumpStyle))) errors.push(`${path}.style.jumpStyle is invalid`);
    if (value.style.cornerRadius !== undefined) finiteInRange(value.style.cornerRadius, `${path}.style.cornerRadius`, 0, 100, errors);
    if (typeof value.style.dash !== 'string' || !edgeDashes.has(value.style.dash)) errors.push(`${path}.style.dash is invalid`);
    if (typeof value.style.startMarker !== 'string' || !edgeMarkers.has(value.style.startMarker)) errors.push(`${path}.style.startMarker is invalid`);
    if (typeof value.style.endMarker !== 'string' || !edgeMarkers.has(value.style.endMarker)) errors.push(`${path}.style.endMarker is invalid`);
    isBoundedString(value.style.labelColor, `${path}.style.labelColor`, 1, 64, errors);
  }
  validateEdgeRouting(value.routing, `${path}.routing`, errors);
  validateData(value.data, `${path}.data`, errors);
}

function validateEdgeRouting(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
  if (value.mode !== 'auto' && value.mode !== 'simple' && value.mode !== 'manual') errors.push(`${path}.mode is invalid`);
  if (value.lane !== undefined) finiteInRange(value.lane, `${path}.lane`, -1000, 1000, errors);
  if (value.crossingPriority !== undefined) finiteInRange(value.crossingPriority, `${path}.crossingPriority`, -1000000, 1000000, errors);
  if (value.constraints !== undefined) {
    if (!Array.isArray(value.constraints) || value.constraints.length > MAX_WAYPOINTS_PER_EDGE) errors.push(`${path}.constraints exceeds the maximum size`);
    (Array.isArray(value.constraints) ? value.constraints : []).forEach((constraint, index) => {
      const constraintPath = `${path}.constraints[${index}]`;
      if (!isRecord(constraint)) { errors.push(`${constraintPath} must be an object`); return; }
      if (constraint.axis !== 'x' && constraint.axis !== 'y') errors.push(`${constraintPath}.axis is invalid`);
      finiteInRange(constraint.value, `${constraintPath}.value`, -100000000, 100000000, errors);
      if (constraint.strength !== 'soft' && constraint.strength !== 'hard') errors.push(`${constraintPath}.strength is invalid`);
    });
  }
}

function validateEndpoint(value: unknown, path: string, nodeIds: Set<string>, errors: string[]): void {
  if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
  const hasNode = value.nodeId !== undefined;
  const hasPoint = value.point !== undefined;
  if (!hasNode && !hasPoint) errors.push(`${path} must reference a node or contain a free point`);
  if (hasNode && isBoundedString(value.nodeId, `${path}.nodeId`, 1, 256, errors) && !nodeIds.has(value.nodeId)) errors.push(`${path}.nodeId references a missing node`);
  if (hasPoint) validatePoint(value.point, `${path}.point`, errors);
  if (value.offset !== undefined) finiteInRange(value.offset, `${path}.offset`, 0, 1, errors);
  if (value.port !== undefined) isBoundedString(value.port, `${path}.port`, 1, 32, errors);
  if (value.anchorId !== undefined) isBoundedString(value.anchorId, `${path}.anchorId`, 1, 128, errors);
}

function validatePoint(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
  finiteInRange(value.x, `${path}.x`, -100000000, 100000000, errors);
  finiteInRange(value.y, `${path}.y`, -100000000, 100000000, errors);
}

function validateData(value: unknown, path: string, errors: string[], depth = 0): void {
  if (depth > 8) { errors.push(`${path} is nested too deeply`); return; }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) errors.push(`${path} contains a non-finite number`);
    return;
  }
  if (typeof value === 'string') { if (value.length > MAX_STRING_LENGTH) errors.push(`${path} contains an oversized string`); return; }
  if (Array.isArray(value)) { if (value.length > 10000) errors.push(`${path} contains too many items`); value.forEach((item, index) => validateData(item, `${path}[${index}]`, errors, depth + 1)); return; }
  if (!isRecord(value)) { errors.push(`${path} contains an unsupported value`); return; }
  const keys = Object.keys(value);
  if (keys.length > 256) errors.push(`${path} contains too many fields`);
  keys.forEach((key) => { if (key.length > 256) errors.push(`${path} contains an oversized key`); validateData(value[key], `${path}.${key}`, errors, depth + 1); });
}

function isBoundedString(value: unknown, path: string, minimum: number, maximum: number, errors: string[]): value is string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) { errors.push(`${path} must be a string between ${minimum} and ${maximum} characters`); return false; }
  return true;
}

function finiteInRange(value: unknown, path: string, minimum: number, maximum: number, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) errors.push(`${path} must be a finite number between ${minimum} and ${maximum}`);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function migrateDocument(input: Partial<DiagramDocument>): DiagramDocument {
  const base = createDocument(input.name ?? 'Recovered diagram', input.diagramType ?? 'general');
  const pages = Array.isArray(input.pages) && input.pages.length > 0
    ? input.pages.map((page, index) => {
      const nodes = Array.isArray(page.nodes) ? page.nodes.map(migrateNode) : [];
      const diagramType = input.diagramType ?? base.diagramType;
      const data = isRecord(page.data)
        ? structuredClone(page.data)
        : diagramType === 'dfd'
          ? { dfdLevel: 0, dataDictionary: [] }
          : undefined;
      return {
        ...createPage(page.name ?? `Page ${index + 1}`),
        ...page,
        settings: {
          ...createPage().settings,
          ...(page.settings ?? {}),
          snapToGrid: page.settings?.snapSettings?.grid ?? page.settings?.snapToGrid ?? true,
          snapSettings: {
            ...defaultSnapSettings,
            ...(page.settings?.snapToGrid === undefined ? {} : {
              grid: page.settings.snapToGrid,
              objects: page.settings.snapToGrid,
              guides: page.settings.snapToGrid,
              ports: page.settings.snapToGrid,
            }),
            ...(page.settings?.snapSettings ?? {}),
          },
        },
        ...(data ? { data } : {}),
        nodes,
        edges: Array.isArray(page.edges) ? page.edges.map((edge) => migrateEdge(edge, nodes, diagramType)) : [],
      };
    })
    : base.pages;

  return {
    ...base,
    ...input,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: input.id ?? base.id,
    name: input.name ?? base.name,
    diagramType: input.diagramType ?? base.diagramType,
    pages,
    palette: normalizePalette(input.palette),
    stylePresets: normalizeStylePresets(input.stylePresets),
    styleDefaults: normalizeStyleDefaults(input.styleDefaults),
    createdAt: input.createdAt ?? base.createdAt,
    updatedAt: input.updatedAt ?? Date.now(),
  };
}

function migrateNode(node: DiagramNode): DiagramNode {
  const legacyEntity = node.type === 'entity' && node.style?.textWrap === undefined && node.style?.autoHeight === undefined;
  const migrated: DiagramNode = {
    ...node,
    style: {
      ...defaultNodeStyle,
      ...(legacyEntity ? { textWrap: false, autoHeight: false } : {}),
      ...(node.style ?? {}),
    },
    data: node.data ?? {},
  };
  const requiredHeight = wrappedNodeHeight(migrated);
  if (migrated.type !== 'entity') {
    return requiredHeight > migrated.size.height
      ? { ...migrated, size: { ...migrated.size, height: requiredHeight } }
      : migrated;
  }
  const fieldCount = Math.max(1, Array.isArray(migrated.data.fields) ? migrated.data.fields.length : 0);
  const minimumHeight = 34 + (migrated.data.columnHeaders === true ? 21 : 0) + fieldCount * 27;
  const minimumWidth = migrated.data.entityVariant === 'key-field-type-nullability' ? 206 : migrated.data.entityVariant === 'key-field-type' || migrated.data.entityVariant === undefined ? 144 : migrated.data.entityVariant === 'key-field-nullability' ? 148 : 120;
  return { ...migrated, size: { width: Math.max(migrated.size.width, minimumWidth), height: Math.max(migrated.size.height, minimumHeight, requiredHeight) } };
}

function normalizePalette(value: unknown): string[] {
  if (!Array.isArray(value)) return [...defaultDocumentPalette];
  const colors = value.filter((color): color is string => typeof color === 'string' && color.length > 0 && color.length <= 64);
  return [...new Set(colors)].slice(0, 64);
}

function normalizeStylePresets(value: unknown): DiagramDocument['stylePresets'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((preset) => {
    if (!isRecord(preset) || typeof preset.id !== 'string' || typeof preset.name !== 'string' || !isRecord(preset.style)) return [];
    return [{ id: preset.id, name: preset.name, style: structuredClone(preset.style) }];
  }).slice(0, 64) as DiagramDocument['stylePresets'];
}

function normalizeStyleDefaults(value: unknown): DiagramDocument['styleDefaults'] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, style]) => {
    if (!isRecord(style) || key.length < 1 || key.length > 256) return [];
    return [[key, structuredClone(style) as Partial<NodeStyle>]];
  }).slice(0, 128));
}

function anchorOrthogonalEdge(edge: DiagramEdge, nodes: DiagramNode[]): DiagramEdge {
  if (edge.type !== 'orthogonal') return edge;
  if (!edge.source.nodeId || !edge.target.nodeId) return edge;
  const source = nodes.find((node) => node.id === edge.source.nodeId);
  const target = nodes.find((node) => node.id === edge.target.nodeId);
  if (!source || !target) return edge;
  return {
    ...edge,
    source: { ...edge.source, port: edge.source.port ?? nearestConnectionPort(source, nodeCenter(target)) },
    target: { ...edge.target, port: edge.target.port ?? nearestConnectionPort(target, nodeCenter(source)) },
  };
}

function migrateEdge(edge: DiagramEdge, nodes: DiagramNode[], diagramType: DiagramType): DiagramEdge {
  const anchored = anchorOrthogonalEdge({
    ...edge,
    style: { ...defaultEdgeStyle, ...(edge.style ?? {}) },
    data: { ...(edge.data ?? {}) },
    source: normalizeAttachedEndpoint(edge.source, nodes),
    target: normalizeAttachedEndpoint(edge.target, nodes),
  }, nodes);
  if (diagramType !== 'erd' || anchored.style.startMarker !== 'none' || anchored.style.endMarker !== 'arrow') return anchored;
  return {
    ...anchored,
    style: { ...anchored.style, startMarker: 'bar', endMarker: 'crowfoot' },
  };
}

function normalizeAttachedEndpoint(endpoint: DiagramEdge['source'], nodes: DiagramNode[]): DiagramEdge['source'] {
  if (!endpoint.nodeId || !nodes.some((node) => node.id === endpoint.nodeId)) return endpoint;
  return { ...endpoint, point: undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function remapEndpoint(endpoint: DiagramEdge['source'], nodeIds: Map<string, string>): DiagramEdge['source'] {
  if (!endpoint.nodeId) return { ...endpoint, point: endpoint.point ? { ...endpoint.point } : undefined };
  return { ...endpoint, nodeId: nodeIds.get(endpoint.nodeId) ?? endpoint.nodeId, point: undefined };
}
