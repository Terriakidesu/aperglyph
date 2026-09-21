import { create } from 'zustand';
import {
  CommandManager,
  CreateEdgeCommand,
  CreateNodeCommand,
  DeleteNodesCommand,
  MoveNodesCommand,
  UpdateEdgeCommand,
  UpdateNodeCommand,
} from '../core/commands';
import { createDocument, createEdge, createNode } from '../core/document';
import { editorEvents } from '../core/events';
import type { DiagramDocument, DiagramEdge, DiagramNode, EdgePatch, NodePatch, Point, ToolId, Viewport } from '../core/types';

interface EditorStore {
  document: DiagramDocument;
  activePageId: string;
  selectedIds: string[];
  primarySelectedId: string | null;
  activeTool: ToolId;
  viewport: Viewport;
  isDirty: boolean;
  lastSavedAt: number | null;
  lastAction: string | null;
  commandManager: CommandManager;
  setDocument: (document: DiagramDocument) => void;
  markSaved: (savedAt?: number) => void;
  setActivePage: (pageId: string) => void;
  setSelection: (ids: string[], primaryId?: string | null) => void;
  setTool: (tool: ToolId) => void;
  setViewport: (viewport: Viewport) => void;
  updateViewport: (changes: Partial<Viewport>) => void;
  createNode: (node: DiagramNode) => void;
  createEdge: (edge: DiagramEdge) => void;
  updateEdge: (edgeId: string, changes: EdgePatch, label?: string) => void;
  moveNodes: (positions: Record<string, Point>) => void;
  updateNode: (nodeId: string, changes: NodePatch, label?: string) => void;
  deleteSelection: () => void;
  undo: () => void;
  redo: () => void;
  reset: (name?: string, type?: DiagramDocument['diagramType']) => void;
}

const initialDocument = createDocument();

function historySnapshot(manager: CommandManager) {
  return {
    lastAction: manager.lastAction,
  };
}

export const useEditorStore = create<EditorStore>((set, get) => {
  const manager = new CommandManager();
  const updateDocument = (document: DiagramDocument, action: string) => {
    const history = historySnapshot(manager);
    set({ document, isDirty: true, ...history });
    editorEvents.emit('document:changed', { document, action });
    editorEvents.emit('history:changed', { canUndo: manager.canUndo, canRedo: manager.canRedo, lastAction: manager.lastAction });
  };

  return {
    document: initialDocument,
    activePageId: initialDocument.pages[0].id,
    selectedIds: [],
    primarySelectedId: null,
    activeTool: 'select',
    viewport: { x: 0, y: 0, zoom: 1 },
    isDirty: false,
    lastSavedAt: null,
    lastAction: null,
    commandManager: manager,
    setDocument: (document) => {
      manager.clear();
      set({ document, activePageId: document.pages[0]?.id ?? '', selectedIds: [], primarySelectedId: null, isDirty: false, lastSavedAt: document.updatedAt, lastAction: null });
      editorEvents.emit('document:opened', { document });
      editorEvents.emit('history:changed', { canUndo: false, canRedo: false, lastAction: null });
    },
    markSaved: (savedAt = Date.now()) => set({ isDirty: false, lastSavedAt: savedAt }),
    setActivePage: (pageId) => set({ activePageId: pageId, selectedIds: [], primarySelectedId: null }),
    setSelection: (ids, primaryId = ids.at(-1) ?? null) => {
      set({ selectedIds: ids, primarySelectedId: primaryId });
      editorEvents.emit('selection:changed', { ids });
    },
    setTool: (activeTool) => set({ activeTool }),
    setViewport: (viewport) => {
      set({ viewport });
      editorEvents.emit('viewport:changed', viewport);
    },
    updateViewport: (changes) => {
      const viewport = { ...get().viewport, ...changes };
      set({ viewport });
      editorEvents.emit('viewport:changed', viewport);
    },
    createNode: (node) => {
      const { activePageId, document } = get();
      const next = manager.execute(new CreateNodeCommand(activePageId, node), document);
      updateDocument(next, 'Create node');
      get().setSelection([node.id], node.id);
      editorEvents.emit('node:created', { nodeId: node.id });
    },
    createEdge: (edge) => {
      const { activePageId, document } = get();
      const next = manager.execute(new CreateEdgeCommand(activePageId, edge), document);
      updateDocument(next, 'Create connector');
      get().setSelection([edge.id], edge.id);
      editorEvents.emit('edge:created', { edgeId: edge.id });
    },
    updateEdge: (edgeId, changes, label) => {
      const { activePageId, document } = get();
      const next = manager.execute(new UpdateEdgeCommand(activePageId, edgeId, changes, label), document);
      updateDocument(next, label ?? 'Update connector');
      editorEvents.emit('edge:changed', { edgeId });
    },
    moveNodes: (positions) => {
      const { activePageId, document } = get();
      const ids = Object.keys(positions);
      const next = manager.execute(new MoveNodesCommand(activePageId, positions), document);
      updateDocument(next, 'Move selection');
      editorEvents.emit('node:moved', { nodeIds: ids, positions });
    },
    updateNode: (nodeId, changes, label) => {
      const { activePageId, document } = get();
      const next = manager.execute(new UpdateNodeCommand(activePageId, nodeId, changes, label), document);
      updateDocument(next, label ?? 'Update node');
    },
    deleteSelection: () => {
      const { activePageId, document, selectedIds } = get();
      if (selectedIds.length === 0) return;
      const page = getActivePage(document, activePageId);
      const selectedNodeIds = selectedIds.filter((id) => page?.nodes.some((node) => node.id === id));
      const removedEdgeIds = page?.edges.filter((edge) => selectedIds.includes(edge.id) || selectedNodeIds.includes(edge.source.nodeId) || selectedNodeIds.includes(edge.target.nodeId)).map((edge) => edge.id) ?? [];
      const next = manager.execute(new DeleteNodesCommand(activePageId, selectedIds), document);
      updateDocument(next, 'Delete selection');
      set({ selectedIds: [], primarySelectedId: null });
      if (selectedNodeIds.length > 0) editorEvents.emit('node:removed', { nodeIds: selectedNodeIds });
      if (removedEdgeIds.length > 0) editorEvents.emit('edge:removed', { edgeIds: removedEdgeIds });
    },
    undo: () => {
      const { document } = get();
      const next = manager.undo(document);
      if (!next) return;
      set({ document: next, isDirty: true, lastAction: manager.lastAction });
      editorEvents.emit('document:changed', { document: next, action: 'Undo' });
      editorEvents.emit('history:changed', { canUndo: manager.canUndo, canRedo: manager.canRedo, lastAction: manager.lastAction });
    },
    redo: () => {
      const { document } = get();
      const next = manager.redo(document);
      if (!next) return;
      set({ document: next, isDirty: true, lastAction: manager.lastAction });
      editorEvents.emit('document:changed', { document: next, action: 'Redo' });
      editorEvents.emit('history:changed', { canUndo: manager.canUndo, canRedo: manager.canRedo, lastAction: manager.lastAction });
    },
    reset: (name = 'Untitled diagram', type = 'general') => {
      const document = createDocument(name, type);
      manager.clear();
      set({ document, activePageId: document.pages[0].id, selectedIds: [], primarySelectedId: null, isDirty: true, lastSavedAt: null, lastAction: null, viewport: { x: 0, y: 0, zoom: 1 } });
      editorEvents.emit('document:opened', { document });
      editorEvents.emit('history:changed', { canUndo: false, canRedo: false, lastAction: null });
    },
  };
});

export function getActivePage(document: DiagramDocument, pageId: string) {
  return document.pages.find((page) => page.id === pageId) ?? document.pages[0];
}

export { createEdge, createNode };
