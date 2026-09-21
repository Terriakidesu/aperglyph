import { cloneDocument, clonePageWithNewIds, createId, getPage } from './document';
import type { ClipboardPayload, DiagramDocument, DiagramEdge, DiagramNode, DiagramPage, EdgePatch, NodePatch, PageSettingsPatch, Point } from './types';

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
    if (page && page.nodes.some((node) => node.id === this.edge.source.nodeId) && page.nodes.some((node) => node.id === this.edge.target.nodeId)) {
      page.edges.push(structuredClone(this.edge));
    }
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
      const removedNodeIds = new Set(page.nodes.filter((node) => ids.has(node.id) && !node.locked).map((node) => node.id));
      page.nodes = page.nodes.filter((node) => !removedNodeIds.has(node.id));
      page.edges = page.edges.filter((edge) => !ids.has(edge.id) && !removedNodeIds.has(edge.source.nodeId) && !removedNodeIds.has(edge.target.nodeId));
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
      page.nodes = page.nodes.map((node) => this.positions[node.id]
        ? node.locked ? node : { ...node, position: { ...this.positions[node.id] } }
        : node);
    }
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
      page.nodes = page.nodes.map((node) => node.id === this.nodeId
        ? node.locked && this.changes.locked !== false
          ? node
          : { ...node, ...this.changes, style: this.changes.style ? { ...node.style, ...this.changes.style } : node.style, data: this.changes.data ? { ...node.data, ...this.changes.data } : node.data }
        : node);
    }
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

export class DeletePageCommand implements DocumentCommand {
  readonly label = 'Delete page';
  constructor(private readonly pageId: string) {}

  execute(document: DiagramDocument): DiagramDocument {
    const next = cloneDocument(document);
    if (next.pages.length > 1) next.pages = next.pages.filter((page) => page.id !== this.pageId);
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
    next.pages = next.pages.map((page) => page.id === this.pageId ? { ...page, settings: { ...page.settings, ...this.changes } } : page);
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
      const first = this.axis === 'horizontal' ? nodes[0].position.x : nodes[0].position.y;
      const lastNode = nodes.at(-1)!;
      const last = this.axis === 'horizontal' ? lastNode.position.x : lastNode.position.y;
      const step = (last - first) / (nodes.length - 1);
      const positions = new Map(nodes.map((node, index) => [node.id, this.axis === 'horizontal' ? { x: first + step * index, y: node.position.y } : { x: node.position.x, y: first + step * index }]));
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
  const edges = page.edges.filter((edge) => ids.has(edge.id) || (nodeIds.has(edge.source.nodeId) && nodeIds.has(edge.target.nodeId)));
  return { nodes: structuredClone(nodes), edges: structuredClone(edges) };
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
  });
  const edges = payload.edges.map((edge) => ({
    ...structuredClone(edge),
    id: createId('edge'),
    source: { ...edge.source, nodeId: nodeIds.get(edge.source.nodeId) ?? edge.source.nodeId },
    target: { ...edge.target, nodeId: nodeIds.get(edge.target.nodeId) ?? edge.target.nodeId },
    waypoints: edge.waypoints.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y })),
  }));
  return { nodes, edges };
}

function normalizeRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
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
          source: this.changes.source ? { ...edge.source, ...this.changes.source } : edge.source,
          target: this.changes.target ? { ...edge.target, ...this.changes.target } : edge.target,
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
