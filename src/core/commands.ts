import { cloneDocument, clonePageWithNewIds, createId, createPage, getPage } from './document';
import { getSnapSettings } from './snapping';
import { wrappedNodeHeight } from './text';
import type { ClipboardPayload, DiagramDocument, DiagramEdge, DiagramGuide, DiagramNode, DiagramPage, EdgePatch, NodePatch, NodeStyle, PageSettingsPatch, Point, StylePreset } from './types';

export const CLIPBOARD_MIME = 'application/x-aperglyph';
const CLIPBOARD_FORMAT = 'aperglyph-clipboard';
const CLIPBOARD_VERSION = 1;
const MAX_CLIPBOARD_ITEMS = 10000;

export interface DocumentCommand {
  label: string;
  execute(document: DiagramDocument): DiagramDocument;
}

interface HistoryEntry {
  command: DocumentCommand;
  before: DiagramDocument;
  after: DiagramDocument;
}

export class CommandManager {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  execute(command: DocumentCommand, document: DiagramDocument): DiagramDocument {
    const before = cloneDocument(document);
    const after = command.execute(before);
    this.undoStack.push({ command, before, after: cloneDocument(after) });
    this.redoStack = [];
    return after;
  }

  undo(document: DiagramDocument): DiagramDocument | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return cloneDocument(entry.before);
  }

  redo(document: DiagramDocument): DiagramDocument | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return cloneDocument(entry.after);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get lastAction(): string | null { return this.undoStack.at(-1)?.command.label ?? null; }
}

export class CreateNodeCommand implements DocumentCommand {
  readonly label = 'Create node';
  constructor(private readonly pageId: string, private readonly node: DiagramNode) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    getPage(next, this.pageId)?.nodes.push(structuredClone(this.node));
    next.updatedAt = Date.now();
    return next;
  }
}

export class CreateEdgeCommand implements DocumentCommand {
  readonly label = 'Create connector';
  constructor(private readonly pageId: string, private readonly edge: DiagramEdge) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const page = getPage(next, this.pageId);
    if (page && endpointExists(page.nodes, this.edge.source) && endpointExists(page.nodes, this.edge.target)) {
      page.edges.push(structuredClone(this.edge));
    }
    next.updatedAt = Date.now();
    return next;
  }
}

/** Creates the shape and its first connector as one undoable operation. */
export class CreateNodeAndEdgeCommand implements DocumentCommand {
  readonly label = 'Create connected shape';

  constructor(private readonly pageId: string, private readonly node: DiagramNode, private readonly edge: DiagramEdge) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const page = getPage(next, this.pageId);
    if (!page || page.nodes.some((node) => node.id === this.node.id) || page.edges.some((edge) => edge.id === this.edge.id)) return next;
    page.nodes.push(structuredClone(this.node));
    page.edges.push(structuredClone(this.edge));
    next.updatedAt = Date.now();
    return next;
  }
}

export class DeleteNodesCommand implements DocumentCommand {
  readonly label = 'Delete selection';
  constructor(private readonly pageId: string, private readonly selectionIds: string[]) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const page = getPage(next, this.pageId);
    if (page) {
      const ids = new Set(this.selectionIds);
      const removedNodes = page.nodes.filter((node) => ids.has(node.id) && !node.locked);
      const removedNodeIds = new Set(removedNodes.map((node) => node.id));
      page.nodes = page.nodes.filter((node) => !removedNodeIds.has(node.id));
      // Removing an owner must not leave dangling container references in the
      // surviving document. Children remain on the canvas and become root
      // objects, which is safer than silently deleting more user content.
      page.nodes = page.nodes.map((node) => removedNodeIds.has(node.containerId ?? '') ? { ...node, containerId: undefined } : node);
      page.edges = page.edges.filter((edge) => !ids.has(edge.id) && (edge.source.nodeId === undefined || !removedNodeIds.has(edge.source.nodeId)) && (edge.target.nodeId === undefined || !removedNodeIds.has(edge.target.nodeId)));

      // Deleting a decomposed process should not leave its retained child
      // page claiming an owner that no longer exists. The child page remains
      // available as user content, but becomes a normal root page.
      removedNodes.forEach((node) => {
        const childPageId = typeof node.data.childPageId === 'string' ? node.data.childPageId : undefined;
        if (!childPageId) return;
        next.pages = next.pages.map((candidate) => candidate.id === childPageId && candidate.data?.parentPageId === page.id && candidate.data.parentProcessId === node.id
          ? { ...candidate, data: withoutDataKeys(candidate.data, ['parentPageId', 'parentProcessId']) }
          : candidate);
      });
    }
    next.updatedAt = Date.now();
    return next;
  }
}

export class MoveNodesCommand implements DocumentCommand {
  readonly label = 'Move selection';
  constructor(private readonly pageId: string, private readonly positions: Record<string, Point>) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const page = getPage(next, this.pageId);
    if (page) {
      const positions = expandContainerPositions(page.nodes, this.positions);
      page.nodes = page.nodes.map((node) => positions[node.id]
        ? node.locked ? node : { ...node, position: { ...positions[node.id] } }
        : node);
    }
    next.updatedAt = Date.now();
    return next;
  }
}

/** Move explicit container children by the same delta, without inferring
 * ownership from overlap. Nested ownership is resolved until it stabilizes. */
function expandContainerPositions(nodes: DiagramNode[], requested: Record<string, Point>): Record<string, Point> {
  const positions = { ...requested };
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((node) => {
      if (!node.containerId || positions[node.id]) return;
      const parent = nodes.find((candidate) => candidate.id === node.containerId);
      const parentTarget = parent && positions[parent.id];
      if (!parent || !parentTarget) return;
      positions[node.id] = {
        x: node.position.x + parentTarget.x - parent.position.x,
        y: node.position.y + parentTarget.y - parent.position.y,
      };
      changed = true;
    });
  }
  return positions;
}

export class LayoutNodesCommand implements DocumentCommand {
  readonly label: string;
  constructor(private readonly pageId: string, private readonly positions: Record<string, Point>, mode: string) {
    this.label = `Auto layout · ${mode}`;
  }

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const page = getPage(next, this.pageId);
    if (page) page.nodes = page.nodes.map((node) => this.positions[node.id] && !node.locked ? { ...node, position: { ...this.positions[node.id] } } : node);
    next.updatedAt = Date.now();
    return next;
  }
}

export class UpdateNodeCommand implements DocumentCommand {
  readonly label: string;
  constructor(
    private readonly pageId: string,
    private readonly nodeId: string,
    private readonly changes: NodePatch,
    label = 'Update node',
  ) {
    this.label = label;
  }

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const page = getPage(next, this.pageId);
    if (page) {
      const node = page.nodes.find((candidate) => candidate.id === this.nodeId);
      const changes = node ? validNodePatch(page.nodes, node, this.changes) : this.changes;
      page.nodes = page.nodes.map((node) => node.id === this.nodeId
        ? applyNodePatch(node, changes)
        : node);
    }
    next.updatedAt = Date.now();
    return next;
  }
}

export class UpdateNodesCommand implements DocumentCommand {
  readonly label: string;
  constructor(private readonly pageId: string, private readonly nodeIds: string[], private readonly changes: NodePatch, label = 'Update selection') {
    this.label = label;
  }

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const ids = new Set(this.nodeIds);
    const page = getPage(next, this.pageId);
    if (page) {
      const nodes = page.nodes.slice();
      nodes.forEach((node, index) => {
        if (ids.has(node.id)) nodes[index] = applyNodePatch(node, validNodePatch(nodes, node, this.changes));
      });
      page.nodes = nodes;
    }
    next.updatedAt = Date.now();
    return next;
  }
}

/** Updates different style patches in one history entry without replacing
 * unrelated node properties or the style fields that are not being changed. */
export class UpdateNodeStylesCommand implements DocumentCommand {
  readonly label: string;
  constructor(private readonly pageId: string, private readonly styles: Record<string, Partial<NodeStyle>>, label = 'Update styles') {
    this.label = label;
  }

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const page = getPage(next, this.pageId);
    if (page) page.nodes = page.nodes.map((node) => this.styles[node.id] ? applyNodePatch(node, { style: this.styles[node.id] }) : node);
    next.updatedAt = Date.now();
    return next;
  }
}

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributionAxis = 'horizontal' | 'vertical';
export type ZOrderAction = 'forward' | 'backward' | 'front' | 'back';

export class CreatePageCommand implements DocumentCommand {
  readonly label = 'Create page';
  constructor(private readonly page: DiagramPage, private readonly index?: number) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const index = this.index === undefined ? next.pages.length : Math.max(0, Math.min(this.index, next.pages.length));
    next.pages.splice(index, 0, structuredClone(this.page));
    next.updatedAt = Date.now();
    return next;
  }
}

/** Creates a levelled DFD child page and links the selected process to it. */
export class CreateDfdChildPageCommand implements DocumentCommand {
  readonly label = 'Create child DFD page';
  readonly childPageId = createId('page');
  constructor(private readonly parentPageId: string, private readonly processId: string) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const parent = getPage(next, this.parentPageId);
    const process = parent?.nodes.find((node) => node.id === this.processId && node.type === 'process');
    if (!parent || !process || next.pages.some((page) => page.id === this.childPageId) || (typeof process.data.childPageId === 'string' && next.pages.some((page) => page.id === process.data.childPageId))) return next;
    const level = typeof parent.data?.dfdLevel === 'number' ? parent.data.dfdLevel + 1 : 1;
    const child = createPage(typeof process.data.label === 'string' && process.data.label.trim() ? process.data.label.trim() : `Process ${this.processId}`);
    child.id = this.childPageId;
    child.data = { dfdLevel: level, parentPageId: parent.id, parentProcessId: process.id, dataDictionary: [] };
    parent.nodes = parent.nodes.map((node) => node.id === process.id ? { ...node, data: { ...node.data, childPageId: child.id } } : node);
    next.pages.push(child);
    next.updatedAt = Date.now();
    return next;
  }
}

export class DeletePageCommand implements DocumentCommand {
  readonly label = 'Delete page';
  constructor(private readonly pageId: string) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    if (next.pages.length > 1 && next.pages.some((page) => page.id === this.pageId)) {
      const orphanedPages = new Set<string>([this.pageId]);
      let changed = true;
      while (changed) {
        changed = false;
        next.pages.forEach((page) => {
          if (typeof page.data?.parentPageId === 'string' && orphanedPages.has(page.data.parentPageId) && !orphanedPages.has(page.id)) {
            orphanedPages.add(page.id);
            changed = true;
          }
        });
      }
      next.pages = next.pages.filter((page) => page.id !== this.pageId);
      next.pages = next.pages.map((page) => {
        const data = page.data;
        const parentRemoved = typeof data?.parentPageId === 'string' && orphanedPages.has(data.parentPageId);
        const nodes = page.nodes.map((node) => {
          const childPageId = typeof node.data.childPageId === 'string' ? node.data.childPageId : undefined;
          return childPageId && orphanedPages.has(childPageId)
            ? { ...node, data: withoutDataKeys(node.data, ['childPageId']) }
            : node;
        });
        if (!parentRemoved && nodes.every((node, index) => node === page.nodes[index])) return page;
        return {
          ...page,
          ...(parentRemoved ? { data: withoutDataKeys(data, ['parentPageId', 'parentProcessId', 'dfdLevel']) } : {}),
          nodes,
        };
      });
    }
    next.updatedAt = Date.now();
    return next;
  }
}

export class RenamePageCommand implements DocumentCommand {
  readonly label = 'Rename page';
  constructor(private readonly pageId: string, private readonly name: string) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    next.pages = next.pages.map((page) => page.id === this.pageId ? { ...page, name: this.name.trim() || page.name } : page);
    next.updatedAt = Date.now();
    return next;
  }
}

export class RenameDocumentCommand implements DocumentCommand {
  readonly label = 'Rename document';
  constructor(private readonly name: string) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    next.name = this.name.trim() || next.name;
    next.updatedAt = Date.now();
    return next;
  }
}

export class DuplicatePageCommand implements DocumentCommand {
  readonly label = 'Duplicate page';
  private readonly duplicate: DiagramPage;
  constructor(page: DiagramPage, private readonly index?: number) {
    this.duplicate = clonePageWithNewIds(page);
  }

  get pageId(): string { return this.duplicate.id; }

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const index = this.index === undefined ? next.pages.length : Math.max(0, Math.min(this.index, next.pages.length));
    next.pages.splice(index, 0, structuredClone(this.duplicate));
    next.updatedAt = Date.now();
    return next;
  }
}

export class ReorderPageCommand implements DocumentCommand {
  readonly label = 'Reorder page';
  constructor(private readonly pageId: string, private readonly toIndex: number) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const fromIndex = next.pages.findIndex((page) => page.id === this.pageId);
    if (fromIndex >= 0) {
      const [page] = next.pages.splice(fromIndex, 1);
      next.pages.splice(Math.max(0, Math.min(this.toIndex, next.pages.length)), 0, page);
    }
    next.updatedAt = Date.now();
    return next;
  }
}

export class UpdatePageSettingsCommand implements DocumentCommand {
  readonly label: string;
  constructor(private readonly pageId: string, private readonly changes: PageSettingsPatch, label = 'Update page settings') {
    this.label = label;
  }

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    next.pages = next.pages.map((page) => {
      if (page.id !== this.pageId) return page;
      const changes = this.changes;
      const legacySnap = changes.snapToGrid;
      const snapSettings = {
        ...(legacySnap === undefined
          ? getSnapSettings(page.settings)
          : { grid: legacySnap, objects: legacySnap, guides: legacySnap, ports: legacySnap }),
        ...changes.snapSettings,
      };
      const { snapSettings: _partialSnapSettings, ...pageSettingChanges } = changes;
      return {
        ...page,
        settings: {
          ...page.settings,
          ...pageSettingChanges,
          snapToGrid: snapSettings.grid,
          snapSettings,
        },
      };
    });
    next.updatedAt = Date.now();
    return next;
  }
}

export class UpdateDocumentPaletteCommand implements DocumentCommand {
  readonly label = 'Update document palette';
  constructor(private readonly palette: string[]) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    next.palette = [...new Set(this.palette)].slice(0, 64);
    next.updatedAt = Date.now();
    return next;
  }
}

export class UpdateStylePresetsCommand implements DocumentCommand {
  readonly label: string;
  constructor(private readonly presets: StylePreset[], label = 'Update style presets') {
    this.label = label;
  }

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    next.stylePresets = structuredClone(this.presets).slice(0, 64);
    next.updatedAt = Date.now();
    return next;
  }
}

export class UpdatePageGuidesCommand implements DocumentCommand {
  readonly label: string;
  constructor(private readonly pageId: string, private readonly guides: DiagramGuide[], label = 'Update guides') {
    this.label = label;
  }

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    next.pages = next.pages.map((page) => page.id === this.pageId ? { ...page, guides: structuredClone(this.guides) } : page);
    next.updatedAt = Date.now();
    return next;
  }
}

export class DuplicateSelectionCommand implements DocumentCommand {
  readonly label = 'Duplicate selection';
  constructor(private readonly pageId: string, private readonly payload: ClipboardPayload) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const page = getPage(next, this.pageId);
    if (page) {
      page.nodes.push(...structuredClone(this.payload.nodes));
      page.edges.push(...structuredClone(this.payload.edges));
    }
    next.updatedAt = Date.now();
    return next;
  }
}

export class RotateNodesCommand implements DocumentCommand {
  readonly label = 'Rotate selection';
  constructor(private readonly pageId: string, private readonly nodeIds: string[], private readonly degrees = 90) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const ids = new Set(this.nodeIds);
    const degrees = this.degrees;
    next.pages = next.pages.map((page) => page.id !== this.pageId ? page : {
      ...page,
      nodes: page.nodes.map((node) => ids.has(node.id) && !node.locked ? { ...node, rotation: normalizeRotation(node.rotation + degrees) } : node),
    });
    next.updatedAt = Date.now();
    return next;
  }
}

export class AlignNodesCommand implements DocumentCommand {
  readonly label: string;
  constructor(private readonly pageId: string, private readonly nodeIds: string[], private readonly alignment: Alignment) {
    this.label = `Align ${alignment}`;
  }

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const ids = new Set(this.nodeIds);
    const page = getPage(next, this.pageId);
    const nodes = page?.nodes.filter((node) => ids.has(node.id) && !node.locked) ?? [];
    if (page && nodes.length > 1) {
      const left = Math.min(...nodes.map((node) => node.position.x));
      const top = Math.min(...nodes.map((node) => node.position.y));
      const right = Math.max(...nodes.map((node) => node.position.x + node.size.width));
      const bottom = Math.max(...nodes.map((node) => node.position.y + node.size.height));
      const center = (left + right) / 2;
      const middle = (top + bottom) / 2;
      page.nodes = page.nodes.map((node) => {
        if (!ids.has(node.id) || node.locked) return node;
        const position = { ...node.position };
        if (this.alignment === 'left') position.x = left;
        if (this.alignment === 'center') position.x = center - node.size.width / 2;
        if (this.alignment === 'right') position.x = right - node.size.width;
        if (this.alignment === 'top') position.y = top;
        if (this.alignment === 'middle') position.y = middle - node.size.height / 2;
        if (this.alignment === 'bottom') position.y = bottom - node.size.height;
        return { ...node, position };
      });
    }
    next.updatedAt = Date.now();
    return next;
  }
}

export class DistributeNodesCommand implements DocumentCommand {
  readonly label: string;
  constructor(private readonly pageId: string, private readonly nodeIds: string[], private readonly axis: DistributionAxis) {
    this.label = `Distribute ${axis}`;
  }

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const ids = new Set(this.nodeIds);
    const page = getPage(next, this.pageId);
    const nodes = page?.nodes.filter((node) => ids.has(node.id) && !node.locked).sort((a, b) => this.axis === 'horizontal' ? a.position.x - b.position.x : a.position.y - b.position.y) ?? [];
    if (page && nodes.length > 2) {
      const first = nodes[0];
      const last = nodes.at(-1)!;
      const start = this.axis === 'horizontal' ? first.position.x : first.position.y;
      const end = this.axis === 'horizontal' ? last.position.x + last.size.width : last.position.y + last.size.height;
      const occupied = nodes.reduce((total, node) => total + (this.axis === 'horizontal' ? node.size.width : node.size.height), 0);
      const gap = (end - start - occupied) / (nodes.length - 1);
      let cursor = start;
      const positions = new Map(nodes.map((node) => {
        const position = this.axis === 'horizontal' ? { x: cursor, y: node.position.y } : { x: node.position.x, y: cursor };
        cursor += (this.axis === 'horizontal' ? node.size.width : node.size.height) + gap;
        return [node.id, position] as const;
      }));
      page.nodes = page.nodes.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node);
    }
    next.updatedAt = Date.now();
    return next;
  }
}

export class SetZOrderCommand implements DocumentCommand {
  readonly label: string;
  constructor(private readonly pageId: string, private readonly nodeIds: string[], private readonly action: ZOrderAction) {
    this.label = action === 'front' ? 'Bring to front' : action === 'back' ? 'Send to back' : action === 'forward' ? 'Bring forward' : 'Send backward';
  }

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const page = getPage(next, this.pageId);
    const ids = new Set(this.nodeIds);
    if (page) {
      const nodes = page.nodes.filter((node) => ids.has(node.id) && !node.locked);
      if (this.action === 'front') {
        const max = Math.max(0, ...page.nodes.map((node) => node.zIndex ?? 0));
        nodes.forEach((node, index) => { node.zIndex = max + index + 1; });
      } else if (this.action === 'back') {
        const min = Math.min(0, ...page.nodes.map((node) => node.zIndex ?? 0));
        nodes.forEach((node, index) => { node.zIndex = min - nodes.length + index; });
      } else {
        const delta = this.action === 'forward' ? 1 : -1;
        nodes.forEach((node) => { node.zIndex = (node.zIndex ?? 0) + delta; });
      }
    }
    next.updatedAt = Date.now();
    return next;
  }
}

export class ReorderNodesCommand implements DocumentCommand {
  readonly label = 'Reorder objects';
  constructor(private readonly pageId: string, private readonly nodeIds: string[], private readonly targetId: string) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const page = getPage(next, this.pageId);
    if (!page) return next;
    const movingIds = new Set(page.nodes.filter((node) => this.nodeIds.includes(node.id) && !node.locked).map((node) => node.id));
    if (movingIds.size === 0 || movingIds.has(this.targetId)) return next;
    const moving = page.nodes.filter((node) => movingIds.has(node.id));
    const remaining = page.nodes.filter((node) => !movingIds.has(node.id));
    const targetIndex = remaining.findIndex((node) => node.id === this.targetId);
    if (targetIndex < 0) return next;
    remaining.splice(targetIndex, 0, ...moving);
    page.nodes = remaining.map((node, index) => ({ ...node, zIndex: index }));
    next.updatedAt = Date.now();
    return next;
  }
}

export class GroupNodesCommand implements DocumentCommand {
  readonly label = 'Group selection';
  private readonly groupId = createId('group');
  constructor(private readonly pageId: string, private readonly nodeIds: string[]) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const ids = new Set(this.nodeIds);
    next.pages = next.pages.map((page) => page.id !== this.pageId ? page : { ...page, nodes: page.nodes.map((node) => ids.has(node.id) ? { ...node, groupId: this.groupId } : node) });
    next.updatedAt = Date.now();
    return next;
  }
}

export class UngroupNodesCommand implements DocumentCommand {
  readonly label = 'Ungroup selection';
  constructor(private readonly pageId: string, private readonly nodeIds: string[]) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const ids = new Set(this.nodeIds);
    next.pages = next.pages.map((page) => {
      if (page.id !== this.pageId) return page;
      const groups = new Set(page.nodes.filter((node) => ids.has(node.id) && node.groupId).map((node) => node.groupId!));
      return { ...page, nodes: page.nodes.map((node) => groups.has(node.groupId ?? '') ? { ...node, groupId: undefined } : node) };
    });
    next.updatedAt = Date.now();
    return next;
  }
}

export function selectionClipboard(document: DiagramDocument, pageId: string, selectionIds: string[]): ClipboardPayload {
  const page = getPage(document, pageId);
  if (!page) return { nodes: [], edges: [] };
  const ids = new Set(selectionIds);
  const nodes = page.nodes.filter((node) => ids.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = page.edges.filter((edge) => ids.has(edge.id) || (edge.source.nodeId !== undefined && edge.target.nodeId !== undefined && nodeIds.has(edge.source.nodeId) && nodeIds.has(edge.target.nodeId)));
  return { nodes: structuredClone(nodes), edges: structuredClone(edges) };
}

export function serializeClipboardPayload(payload: ClipboardPayload): string {
  return JSON.stringify({ format: CLIPBOARD_FORMAT, version: CLIPBOARD_VERSION, payload });
}

/** Parse untrusted system clipboard text without allowing malformed objects into commands. */
export function parseClipboardPayload(raw: string): ClipboardPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.format !== CLIPBOARD_FORMAT || parsed.version !== CLIPBOARD_VERSION || !isRecord(parsed.payload)) return null;
    const payload = parsed.payload;
    if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges) || payload.nodes.length > MAX_CLIPBOARD_ITEMS || payload.edges.length > MAX_CLIPBOARD_ITEMS) return null;
    if (!payload.nodes.every(isClipboardNode) || !payload.edges.every(isClipboardEdge)) return null;
    return structuredClone(payload as unknown as ClipboardPayload);
  } catch {
    return null;
  }
}

export function offsetClipboard(payload: ClipboardPayload, offset: Point = { x: 24, y: 24 }): ClipboardPayload {
  const nodeIds = new Map<string, string>();
  const groupIds = new Map<string, string>();
  const nodes = payload.nodes.map((node) => {
    const id = createId('node');
    nodeIds.set(node.id, id);
    const groupId = node.groupId ? (groupIds.get(node.groupId) ?? (() => {
      const next = createId('group');
      groupIds.set(node.groupId!, next);
      return next;
    })()) : undefined;
    return { ...structuredClone(node), id, groupId, position: { x: node.position.x + offset.x, y: node.position.y + offset.y }, zIndex: (node.zIndex ?? 0) + 1 };
  }).map((node, index) => ({
    ...node,
    containerId: payload.nodes[index].containerId ? nodeIds.get(payload.nodes[index].containerId!) : undefined,
  }));
  const edges = payload.edges.map((edge) => ({
    ...structuredClone(edge),
    id: createId('edge'),
    source: offsetEndpoint(edge.source, nodeIds, offset),
    target: offsetEndpoint(edge.target, nodeIds, offset),
    waypoints: edge.waypoints.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y })),
  }));
  return { nodes, edges };
}

function normalizeRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

function applyNodePatch(node: DiagramNode, changes: NodePatch): DiagramNode {
  if (node.locked && changes.locked !== false && !Object.keys(changes).every((key) => key === 'hidden')) return node;
  const next: DiagramNode = {
    ...node,
    ...changes,
    style: changes.style ? { ...node.style, ...changes.style } : node.style,
    data: changes.data ? { ...node.data, ...changes.data } : node.data,
  };
  const widthChanged = changes.size?.width !== undefined && changes.size.width !== node.size.width;
  const textChanged = changes.data?.label !== undefined
    || changes.style?.textWrap !== undefined
    || changes.style?.autoHeight !== undefined
    || changes.style?.fontSize !== undefined
    || changes.style?.fontWeight !== undefined
    || widthChanged;
  if (textChanged && next.type !== 'entity' && next.style.textWrap && next.style.autoHeight) {
    next.size = { ...next.size, height: wrappedNodeHeight(next) };
  }
  return next;
}

function validNodePatch(nodes: DiagramNode[], node: DiagramNode, changes: NodePatch): NodePatch {
  if (!Object.prototype.hasOwnProperty.call(changes, 'containerId')) return changes;
  if (changes.containerId === undefined) return changes;
  const owner = nodes.find((candidate) => candidate.id === changes.containerId);
  if (!owner || !owner.container || owner.id === node.id || containsContainer(nodes, owner.id, node.id)) {
    const { containerId: _ignored, ...safeChanges } = changes;
    return safeChanges;
  }
  return changes;
}

function containsContainer(nodes: DiagramNode[], startId: string, targetId: string): boolean {
  const visited = new Set<string>();
  let current: string | undefined = startId;
  while (current) {
    if (current === targetId || visited.has(current)) return true;
    visited.add(current);
    current = nodes.find((node) => node.id === current)?.containerId;
  }
  return false;
}

function isClipboardNode(value: unknown): value is DiagramNode {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.library !== 'string' || typeof value.type !== 'string') return false;
  if (!isPoint(value.position) || !isSize(value.size) || !Number.isFinite(value.rotation) || !isRecord(value.style) || !isRecord(value.data)) return false;
  return typeof value.style.fill === 'string'
    && typeof value.style.stroke === 'string'
    && Number.isFinite(value.style.strokeWidth)
    && Number.isFinite(value.style.radius)
    && Number.isFinite(value.style.opacity)
    && typeof value.style.textColor === 'string'
    && (value.locked === undefined || typeof value.locked === 'boolean')
    && (value.hidden === undefined || typeof value.hidden === 'boolean')
    && (value.groupId === undefined || typeof value.groupId === 'string')
    && (value.zIndex === undefined || Number.isFinite(value.zIndex));
}

function isClipboardEdge(value: unknown): value is DiagramEdge {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string' || !isEndpoint(value.source) || !isEndpoint(value.target) || !Array.isArray(value.waypoints) || !isRecord(value.style) || !isRecord(value.data)) return false;
  return value.waypoints.length <= MAX_CLIPBOARD_ITEMS
    && value.waypoints.every(isPoint)
    && typeof value.style.stroke === 'string'
    && Number.isFinite(value.style.strokeWidth)
    && typeof value.style.dash === 'string'
    && typeof value.style.startMarker === 'string'
    && typeof value.style.endMarker === 'string'
    && typeof value.style.labelColor === 'string';
}

function isEndpoint(value: unknown): value is DiagramEdge['source'] {
  return isRecord(value)
    && (typeof value.nodeId === 'string' || isPoint(value.point))
    && (value.port === undefined || typeof value.port === 'string')
    && (value.anchorId === undefined || typeof value.anchorId === 'string')
    && (value.offset === undefined || (typeof value.offset === 'number' && Number.isFinite(value.offset) && value.offset >= 0 && value.offset <= 1))
    && (value.point === undefined || isPoint(value.point));
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isSize(value: unknown): value is { width: number; height: number } {
  return isRecord(value) && typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0 && typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0;
}

function endpointExists(nodes: DiagramNode[], endpoint: DiagramEdge['source']): boolean {
  return endpoint.point !== undefined || (endpoint.nodeId !== undefined && nodes.some((node) => node.id === endpoint.nodeId));
}

function offsetEndpoint(endpoint: DiagramEdge['source'], nodeIds: Map<string, string>, offset: Point): DiagramEdge['source'] {
  if (endpoint.nodeId) return { ...endpoint, nodeId: nodeIds.get(endpoint.nodeId) ?? endpoint.nodeId, point: undefined };
  return endpoint.point ? { ...endpoint, offset: undefined, point: { x: endpoint.point.x + offset.x, y: endpoint.point.y + offset.y } } : { ...endpoint };
}

/** Keep attached endpoints node-relative and free endpoints point-relative. */
function mergeEndpoint(current: DiagramEdge['source'], patch: DiagramEdge['source']): DiagramEdge['source'] {
  // A node attachment is a complete geometric identity. Do not inherit a
  // port or offset from the previous node when the new anchor omits it.
  if (patch.nodeId) {
    return {
      nodeId: patch.nodeId,
      ...(patch.port === undefined ? {} : { port: patch.port }),
      ...(patch.anchorId === undefined ? {} : { anchorId: patch.anchorId }),
      ...(patch.offset === undefined ? {} : { offset: patch.offset }),
    };
  }
  // A free point is also complete; attached geometry must not survive the
  // transition back to a free endpoint.
  if (patch.point) return { point: { ...patch.point } };
  return { ...current, ...patch };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutDataKeys(data: Record<string, unknown> | undefined, keys: string[]): Record<string, unknown> {
  const next = { ...(data ?? {}) };
  keys.forEach((key) => delete next[key]);
  return next;
}

export class UpdateEdgeCommand implements DocumentCommand {
  readonly label: string;
  constructor(
    private readonly pageId: string,
    private readonly edgeId: string,
    private readonly changes: EdgePatch,
    label = 'Update connector',
  ) {
    this.label = label;
  }

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const page = getPage(next, this.pageId);
    if (page) {
      page.edges = page.edges.map((edge) => edge.id === this.edgeId
        ? {
          ...edge,
          ...this.changes,
          source: this.changes.source ? mergeEndpoint(edge.source, this.changes.source) : edge.source,
          target: this.changes.target ? mergeEndpoint(edge.target, this.changes.target) : edge.target,
          style: this.changes.style ? { ...edge.style, ...this.changes.style } : edge.style,
          data: this.changes.data ? { ...edge.data, ...this.changes.data } : edge.data,
          waypoints: this.changes.waypoints ? this.changes.waypoints.map((point) => ({ ...point })) : edge.waypoints,
        }
        : edge);
    }
    next.updatedAt = Date.now();
    return next;
  }
}

export class ResetEdgeCommand implements DocumentCommand {
  readonly label = 'Reset connector';
  constructor(private readonly pageId: string, private readonly edgeId: string, private readonly diagramType: DiagramDocument['diagramType']) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    const page = getPage(next, this.pageId);
    if (page) {
      const relationship = this.diagramType === 'erd';
      page.edges = page.edges.map((edge) => edge.id !== this.edgeId ? edge : {
        ...edge,
        type: relationship || this.diagramType === 'dfd' ? 'orthogonal' : 'straight',
        source: { ...edge.source, port: undefined, anchorId: undefined, offset: undefined },
        target: { ...edge.target, port: undefined, anchorId: undefined, offset: undefined },
        waypoints: [],
        style: {
          ...edge.style,
          dash: 'solid',
          startMarker: relationship ? 'bar' : 'none',
          endMarker: relationship ? 'crowfoot' : 'arrow',
        },
      });
    }
    next.updatedAt = Date.now();
    return next;
  }
}
