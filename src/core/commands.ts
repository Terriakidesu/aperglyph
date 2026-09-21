import { cloneDocument, getPage } from './document';
import type { DiagramDocument, DiagramEdge, DiagramNode, EdgePatch, NodePatch, Point } from './types';

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
      page.nodes = page.nodes.filter((node) => !ids.has(node.id));
      page.edges = page.edges.filter((edge) => !ids.has(edge.id) && !ids.has(edge.source.nodeId) && !ids.has(edge.target.nodeId));
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
        ? { ...node, position: { ...this.positions[node.id] } }
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
        ? { ...node, ...this.changes, style: this.changes.style ? { ...node.style, ...this.changes.style } : node.style, data: this.changes.data ? { ...node.data, ...this.changes.data } : node.data }
        : node);
    }
    next.updatedAt = Date.now();
    return next;
  }
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
