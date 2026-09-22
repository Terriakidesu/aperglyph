import { create } from 'zustand';
import {
  AlignNodesCommand,
  CommandManager,
  CreateEdgeCommand,
  CreateDfdChildPageCommand,
  CreateNodeAndEdgeCommand,
  CreatePageCommand,
  CreateNodeCommand,
  DeleteNodesCommand,
  DeletePageCommand,
  DistributeNodesCommand,
  DuplicatePageCommand,
  DuplicateSelectionCommand,
  GroupNodesCommand,
  LayoutNodesCommand,
  MoveNodesCommand,
  RenamePageCommand,
  ReorderPageCommand,
  ResetEdgeCommand,
  ReorderNodesCommand,
  RotateNodesCommand,
  SetZOrderCommand,
  UngroupNodesCommand,
  UpdateEdgeCommand,
  UpdateDocumentPaletteCommand,
  UpdateNodeCommand,
  UpdateNodeStylesCommand,
  UpdateNodesCommand,
  UpdatePageGuidesCommand,
  UpdatePageSettingsCommand,
  UpdateStylePresetsCommand,
  offsetClipboard,
  selectionClipboard,
} from '../core/commands';
import { createDocument, createEdge, createNode, createPage as buildPage, defaultNodeStyle } from '../core/document';
import { editorEvents } from '../core/events';
import type { Alignment, DistributionAxis, ZOrderAction } from '../core/commands';
import type { DocumentCommand } from '../core/commands';
import { layoutNodes } from '../core/layout';
import type { LayoutMode } from '../core/layout';
import { LayoutWorkerClient } from '../spatial/layoutClient';
import type { ClipboardPayload, DiagramDocument, DiagramEdge, DiagramGuide, DiagramNode, EdgePatch, NodePatch, NodeStyle, PageSettingsPatch, Point, StylePreset, ToolId, Viewport } from '../core/types';
import { pluginManager } from '../plugins';

interface EditorStore {
  document: DiagramDocument;
  activePageId: string;
  selectedIds: string[];
  primarySelectedId: string | null;
  activeTool: ToolId;
  viewport: Viewport;
  clipboard: ClipboardPayload | null;
  styleClipboard: Partial<NodeStyle> | null;
  formatPainter: Partial<NodeStyle> | null;
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
  createNodeAndEdge: (node: DiagramNode, edge: DiagramEdge) => void;
  executeCommand: (command: DocumentCommand) => void;
  updateEdge: (edgeId: string, changes: EdgePatch, label?: string) => void;
  resetEdge: (edgeId?: string) => void;
  moveNodes: (positions: Record<string, Point>) => void;
  reorderNodes: (nodeIds: string[], targetId: string) => void;
  nudgeSelection: (delta: Point) => void;
  updateNode: (nodeId: string, changes: NodePatch, label?: string) => void;
  updateNodes: (nodeIds: string[], changes: NodePatch, label?: string) => void;
  copyStyle: () => void;
  pasteStyle: () => void;
  resetFormatting: () => void;
  applyStyleToSameType: () => void;
  activateFormatPainter: () => void;
  clearFormatPainter: () => void;
  updatePalette: (palette: string[], label?: string) => void;
  saveStylePreset: (name: string, style?: Partial<NodeStyle>) => void;
  applyStylePreset: (presetId: string) => void;
  deleteStylePreset: (presetId: string) => void;
  deleteSelection: () => void;
  selectAll: () => void;
  copySelection: () => ClipboardPayload | null;
  cutSelection: () => void;
  pasteClipboard: () => void;
  pastePayload: (payload: ClipboardPayload, offset?: Point) => void;
  duplicateSelection: (offset?: Point) => string[];
  rotateSelection: (degrees?: number) => void;
  alignSelection: (alignment: Alignment) => void;
  distributeSelection: (axis: DistributionAxis) => void;
  setZOrder: (action: ZOrderAction) => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  autoLayout: (mode?: LayoutMode) => Promise<void>;
  createPage: (name?: string) => void;
  createDfdChildPage: (processId: string) => void;
  deletePage: (pageId?: string) => void;
  renamePage: (pageId: string, name: string) => void;
  duplicatePage: (pageId?: string) => void;
  reorderPage: (pageId: string, toIndex: number) => void;
  updatePageSettings: (changes: PageSettingsPatch, pageId?: string, label?: string) => void;
  updateGuides: (guides: DiagramGuide[], pageId?: string, label?: string) => void;
  undo: () => void;
  redo: () => void;
  reset: (name?: string, type?: DiagramDocument['diagramType']) => void;
}

const initialDocument = createDocument();
const layoutClient = new LayoutWorkerClient();

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
    clipboard: null,
    styleClipboard: null,
    formatPainter: null,
    isDirty: false,
    lastSavedAt: null,
    lastAction: null,
    commandManager: manager,
    setDocument: (document) => {
      manager.clear();
      set({ document, activePageId: document.pages[0]?.id ?? '', selectedIds: [], primarySelectedId: null, styleClipboard: null, formatPainter: null, isDirty: false, lastSavedAt: document.updatedAt, lastAction: null });
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
    createNodeAndEdge: (node, edge) => {
      const { activePageId, document } = get();
      const next = manager.execute(new CreateNodeAndEdgeCommand(activePageId, node, edge), document);
      updateDocument(next, 'Create connected shape');
      get().setSelection([node.id, edge.id], edge.id);
      editorEvents.emit('node:created', { nodeId: node.id });
      editorEvents.emit('edge:created', { edgeId: edge.id });
    },
    executeCommand: (command) => {
      const { document } = get();
      const next = manager.execute(command, document);
      updateDocument(next, command.label);
    },
    updateEdge: (edgeId, changes, label) => {
      const { activePageId, document } = get();
      const connector = changes.type ? pluginManager.get(document.diagramType)?.connectors.find((candidate) => candidate.id === changes.type) : undefined;
      const normalizedChanges: EdgePatch = connector
        ? {
          ...changes,
          style: { ...connector.defaultStyle, ...changes.style },
           data: { routing: connector.routing, ...(connector.label.startsWith('«') ? { label: connector.label } : {}), ...changes.data },
        }
        : changes;
      const next = manager.execute(new UpdateEdgeCommand(activePageId, edgeId, normalizedChanges, label), document);
      updateDocument(next, label ?? 'Update connector');
      editorEvents.emit('edge:changed', { edgeId });
    },
    resetEdge: (edgeId) => {
      const { activePageId, document, primarySelectedId } = get();
      const page = getActivePage(document, activePageId);
      const targetId = edgeId ?? primarySelectedId;
      if (!page || !targetId || !page.edges.some((edge) => edge.id === targetId)) return;
      const next = manager.execute(new ResetEdgeCommand(activePageId, targetId, document.diagramType), document);
      updateDocument(next, 'Reset connector');
      editorEvents.emit('edge:changed', { edgeId: targetId });
    },
    moveNodes: (positions) => {
      const { activePageId, document } = get();
      const ids = Object.keys(positions);
      const next = manager.execute(new MoveNodesCommand(activePageId, positions), document);
      updateDocument(next, 'Move selection');
      editorEvents.emit('node:moved', { nodeIds: ids, positions });
    },
    reorderNodes: (nodeIds, targetId) => {
      const { activePageId, document } = get();
      if (nodeIds.length === 0 || nodeIds.includes(targetId)) return;
      const next = manager.execute(new ReorderNodesCommand(activePageId, nodeIds, targetId), document);
      updateDocument(next, 'Reorder objects');
    },
    nudgeSelection: (delta) => {
      const { activePageId, document, selectedIds } = get();
      const page = getActivePage(document, activePageId);
      if (!page) return;
      const nodeIds = selectedIds.filter((id) => page.nodes.some((node) => node.id === id && !node.hidden));
      const positions = Object.fromEntries(nodeIds.map((id) => {
        const node = page.nodes.find((candidate) => candidate.id === id)!;
        return [id, { x: node.position.x + delta.x, y: node.position.y + delta.y }];
      }));
      if (Object.keys(positions).length === 0) return;
      const next = manager.execute(new MoveNodesCommand(activePageId, positions), document);
      updateDocument(next, 'Nudge selection');
      editorEvents.emit('node:moved', { nodeIds, positions });
    },
    updateNode: (nodeId, changes, label) => {
      const { activePageId, document } = get();
      const next = manager.execute(new UpdateNodeCommand(activePageId, nodeId, changes, label), document);
      updateDocument(next, label ?? 'Update node');
    },
    updateNodes: (nodeIds, changes, label = 'Update selection') => {
      const { activePageId, document } = get();
      if (nodeIds.length === 0) return;
      const next = manager.execute(new UpdateNodesCommand(activePageId, nodeIds, changes, label), document);
      updateDocument(next, label);
    },
    copyStyle: () => {
      const { document, activePageId, primarySelectedId, selectedIds } = get();
      const page = getActivePage(document, activePageId);
      const node = page?.nodes.find((candidate) => candidate.id === primarySelectedId)
        ?? page?.nodes.find((candidate) => selectedIds.includes(candidate.id));
      if (node) set({ styleClipboard: structuredClone(node.style) });
    },
    pasteStyle: () => {
      const { document, activePageId, selectedIds, styleClipboard } = get();
      if (!styleClipboard) return;
      const page = getActivePage(document, activePageId);
      const nodeIds = selectedIds.filter((id) => page?.nodes.some((node) => node.id === id));
      if (nodeIds.length === 0) return;
      const next = manager.execute(new UpdateNodesCommand(activePageId, nodeIds, { style: styleClipboard }, 'Paste style'), document);
      updateDocument(next, 'Paste style');
    },
    resetFormatting: () => {
      const { document, activePageId, selectedIds } = get();
      const page = getActivePage(document, activePageId);
      if (!page) return;
      const styles = Object.fromEntries(page.nodes.filter((node) => selectedIds.includes(node.id)).map((node) => {
        const shape = pluginManager.getShape(node.library, node.type);
        const special = node.type === 'entity' ? { textWrap: false, autoHeight: false } : {};
        return [node.id, { ...defaultNodeStyle, ...special, ...(shape?.defaultStyle ?? {}) }];
      }));
      if (Object.keys(styles).length === 0) return;
      const next = manager.execute(new UpdateNodeStylesCommand(activePageId, styles, 'Reset formatting'), document);
      updateDocument(next, 'Reset formatting');
    },
    applyStyleToSameType: () => {
      const { document, activePageId, primarySelectedId } = get();
      const page = getActivePage(document, activePageId);
      const source = page?.nodes.find((node) => node.id === primarySelectedId);
      if (!page || !source) return;
      const styles = Object.fromEntries(page.nodes.filter((node) => node.library === source.library && node.type === source.type).map((node) => [node.id, structuredClone(source.style)]));
      const next = manager.execute(new UpdateNodeStylesCommand(activePageId, styles, 'Apply style to same shapes'), document);
      updateDocument(next, 'Apply style to same shapes');
    },
    activateFormatPainter: () => {
      const { document, activePageId, primarySelectedId, selectedIds } = get();
      const page = getActivePage(document, activePageId);
      const node = page?.nodes.find((candidate) => candidate.id === primarySelectedId)
        ?? page?.nodes.find((candidate) => selectedIds.includes(candidate.id));
      if (node) set({ formatPainter: structuredClone(node.style) });
    },
    clearFormatPainter: () => set({ formatPainter: null }),
    updatePalette: (palette, label = 'Update document palette') => {
      const { document } = get();
      const next = manager.execute(new UpdateDocumentPaletteCommand(palette), document);
      updateDocument(next, label);
    },
    saveStylePreset: (name, style) => {
      const { document, activePageId, primarySelectedId, selectedIds } = get();
      const page = getActivePage(document, activePageId);
      const node = page?.nodes.find((candidate) => candidate.id === primarySelectedId)
        ?? page?.nodes.find((candidate) => selectedIds.includes(candidate.id));
      const trimmed = name.trim();
      if (!node || !trimmed) return;
      const preset: StylePreset = { id: `preset_${Date.now().toString(36)}`, name: trimmed, style: structuredClone(style ?? node.style) };
      const next = manager.execute(new UpdateStylePresetsCommand([...document.stylePresets, preset], 'Save style preset'), document);
      updateDocument(next, 'Save style preset');
    },
    applyStylePreset: (presetId) => {
      const { document, activePageId, selectedIds } = get();
      const preset = document.stylePresets.find((candidate) => candidate.id === presetId);
      const page = getActivePage(document, activePageId);
      const nodeIds = selectedIds.filter((id) => page?.nodes.some((node) => node.id === id));
      if (!preset || nodeIds.length === 0) return;
      const next = manager.execute(new UpdateNodesCommand(activePageId, nodeIds, { style: preset.style }, `Apply style preset · ${preset.name}`), document);
      updateDocument(next, `Apply style preset · ${preset.name}`);
    },
    deleteStylePreset: (presetId) => {
      const { document } = get();
      if (!document.stylePresets.some((preset) => preset.id === presetId)) return;
      const next = manager.execute(new UpdateStylePresetsCommand(document.stylePresets.filter((preset) => preset.id !== presetId), 'Delete style preset'), document);
      updateDocument(next, 'Delete style preset');
    },
    selectAll: () => {
      const { document, activePageId } = get();
      const page = getActivePage(document, activePageId);
      if (!page) return;
      get().setSelection([...page.nodes.filter((node) => !node.hidden).map((node) => node.id), ...page.edges.map((edge) => edge.id)]);
    },
    copySelection: () => {
      const { document, activePageId, selectedIds } = get();
      const payload = selectionClipboard(document, activePageId, selectedIds);
      if (payload.nodes.length > 0 || payload.edges.length > 0) set({ clipboard: payload });
      return payload.nodes.length > 0 || payload.edges.length > 0 ? payload : null;
    },
    cutSelection: () => {
      get().copySelection();
      get().deleteSelection();
    },
    pasteClipboard: () => {
      const { clipboard } = get();
      if (!clipboard || (clipboard.nodes.length === 0 && clipboard.edges.length === 0)) return;
      get().pastePayload(clipboard);
    },
     pastePayload: (source, offset = { x: 24, y: 24 }) => {
      const { document, activePageId } = get();
      if (source.nodes.length === 0 && source.edges.length === 0) return;
       const payload = offsetClipboard(source, offset);
      const next = manager.execute(new DuplicateSelectionCommand(activePageId, payload), document);
      updateDocument(next, 'Paste selection');
      get().setSelection([...payload.nodes.map((node) => node.id), ...payload.edges.map((edge) => edge.id)]);
    },
    duplicateSelection: (offset = { x: 24, y: 24 }) => {
      const { document, activePageId, selectedIds } = get();
      const source = selectionClipboard(document, activePageId, selectedIds);
      if (source.nodes.length === 0 && source.edges.length === 0) return [];
      const payload = offsetClipboard(source, offset);
      const next = manager.execute(new DuplicateSelectionCommand(activePageId, payload), document);
      updateDocument(next, 'Duplicate selection');
      const ids = [...payload.nodes.map((node) => node.id), ...payload.edges.map((edge) => edge.id)];
      get().setSelection(ids);
      return ids;
    },
    rotateSelection: (degrees = 90) => {
      const { activePageId, document, selectedIds } = get();
      const nodeIds = selectedIds.filter((id) => getActivePage(document, activePageId)?.nodes.some((node) => node.id === id));
      if (nodeIds.length === 0) return;
      const next = manager.execute(new RotateNodesCommand(activePageId, nodeIds, degrees), document);
      updateDocument(next, 'Rotate selection');
    },
    alignSelection: (alignment) => {
      const { activePageId, document, selectedIds } = get();
      const next = manager.execute(new AlignNodesCommand(activePageId, selectedIds, alignment), document);
      updateDocument(next, `Align ${alignment}`);
    },
    distributeSelection: (axis) => {
      const { activePageId, document, selectedIds } = get();
      const next = manager.execute(new DistributeNodesCommand(activePageId, selectedIds, axis), document);
      updateDocument(next, `Distribute ${axis}`);
    },
    setZOrder: (action) => {
      const { activePageId, document, selectedIds } = get();
      const next = manager.execute(new SetZOrderCommand(activePageId, selectedIds, action), document);
      updateDocument(next, action === 'front' ? 'Bring to front' : action === 'back' ? 'Send to back' : action === 'forward' ? 'Bring forward' : 'Send backward');
    },
    groupSelection: () => {
      const { activePageId, document, selectedIds } = get();
      const nodeIds = selectedIds.filter((id) => getActivePage(document, activePageId)?.nodes.some((node) => node.id === id));
      if (nodeIds.length < 2) return;
      const next = manager.execute(new GroupNodesCommand(activePageId, nodeIds), document);
      updateDocument(next, 'Group selection');
    },
    ungroupSelection: () => {
      const { activePageId, document, selectedIds } = get();
      const next = manager.execute(new UngroupNodesCommand(activePageId, selectedIds), document);
      updateDocument(next, 'Ungroup selection');
    },
    autoLayout: async (mode = 'hierarchical') => {
      const { activePageId, document, selectedIds } = get();
      const page = getActivePage(document, activePageId);
      if (!page) return;
      const selected = page.nodes.filter((node) => selectedIds.includes(node.id));
      const targets = selected.length > 1 ? selected : page.nodes;
      let positions: Record<string, Point>;
      try {
        positions = await layoutClient.layout(targets, page.edges, mode);
      } catch {
        positions = layoutNodes(targets, page.edges, mode);
      }
      if (Object.keys(positions).length === 0) return;
      const current = get();
      if (current.document !== document || current.activePageId !== activePageId) return;
      const next = manager.execute(new LayoutNodesCommand(activePageId, positions, mode), document);
      updateDocument(next, `Auto layout · ${mode}`);
    },
    createPage: (name) => {
      const { document, activePageId } = get();
      const page = buildPage(name?.trim() || `Page ${document.pages.length + 1}`);
      if (document.diagramType === 'dfd') {
        const parent = document.pages.find((candidate) => candidate.id === activePageId);
        page.data = { dfdLevel: typeof parent?.data?.dfdLevel === 'number' ? parent.data.dfdLevel : 0, dataDictionary: [] };
      }
      const next = manager.execute(new CreatePageCommand(page), document);
      updateDocument(next, 'Create page');
      set({ activePageId: page.id, selectedIds: [], primarySelectedId: null });
    },
    createDfdChildPage: (processId) => {
      const { activePageId, document } = get();
      if (document.diagramType !== 'dfd') return;
      const command = new CreateDfdChildPageCommand(activePageId, processId);
      const next = manager.execute(command, document);
      if (next.pages.length === document.pages.length) return;
      updateDocument(next, command.label);
      set({ activePageId: command.childPageId, selectedIds: [], primarySelectedId: null });
    },
    deletePage: (pageId = get().activePageId) => {
      const { document, activePageId } = get();
      if (document.pages.length <= 1) return;
      const targetIndex = document.pages.findIndex((page) => page.id === pageId);
      if (targetIndex < 0) return;
      const next = manager.execute(new DeletePageCommand(pageId), document);
      updateDocument(next, 'Delete page');
      const nextPage = next.pages[Math.min(targetIndex, next.pages.length - 1)];
      set({ activePageId: nextPage?.id ?? activePageId, selectedIds: [], primarySelectedId: null });
    },
    renamePage: (pageId, name) => {
      const { document } = get();
      const next = manager.execute(new RenamePageCommand(pageId, name), document);
      updateDocument(next, 'Rename page');
    },
    duplicatePage: (pageId = get().activePageId) => {
      const { document } = get();
      const pageIndex = document.pages.findIndex((page) => page.id === pageId);
      const page = document.pages[pageIndex];
      if (!page) return;
      const command = new DuplicatePageCommand(page, pageIndex + 1);
      const next = manager.execute(command, document);
      updateDocument(next, 'Duplicate page');
      set({ activePageId: command.pageId, selectedIds: [], primarySelectedId: null });
    },
    reorderPage: (pageId, toIndex) => {
      const { document } = get();
      const next = manager.execute(new ReorderPageCommand(pageId, toIndex), document);
      updateDocument(next, 'Reorder page');
    },
    updatePageSettings: (changes, pageId = get().activePageId, label = 'Update page settings') => {
      const { document } = get();
      const next = manager.execute(new UpdatePageSettingsCommand(pageId, changes, label), document);
      updateDocument(next, label);
    },
    updateGuides: (guides, pageId = get().activePageId, label = 'Update guides') => {
      const { document } = get();
      const next = manager.execute(new UpdatePageGuidesCommand(pageId, guides, label), document);
      updateDocument(next, label);
    },
    deleteSelection: () => {
      const { activePageId, document, selectedIds } = get();
      if (selectedIds.length === 0) return;
      const page = getActivePage(document, activePageId);
      const selectedNodeIds = selectedIds.filter((id) => page?.nodes.some((node) => node.id === id));
      const removedEdgeIds = page?.edges.filter((edge) => selectedIds.includes(edge.id) || (edge.source.nodeId !== undefined && selectedNodeIds.includes(edge.source.nodeId)) || (edge.target.nodeId !== undefined && selectedNodeIds.includes(edge.target.nodeId))).map((edge) => edge.id) ?? [];
      const next = manager.execute(new DeleteNodesCommand(activePageId, selectedIds), document);
      updateDocument(next, 'Delete selection');
      set({ selectedIds: [], primarySelectedId: null });
      if (selectedNodeIds.length > 0) editorEvents.emit('node:removed', { nodeIds: selectedNodeIds });
      if (removedEdgeIds.length > 0) editorEvents.emit('edge:removed', { edgeIds: removedEdgeIds });
    },
    undo: () => {
      const { document, activePageId } = get();
      const next = manager.undo(document);
      if (!next) return;
      const pageStillExists = next.pages.some((page) => page.id === activePageId);
      set({ document: next, activePageId: pageStillExists ? activePageId : next.pages[0]?.id ?? '', ...(pageStillExists ? {} : { selectedIds: [], primarySelectedId: null }), isDirty: true, lastAction: manager.lastAction });
      editorEvents.emit('document:changed', { document: next, action: 'Undo' });
      editorEvents.emit('history:changed', { canUndo: manager.canUndo, canRedo: manager.canRedo, lastAction: manager.lastAction });
    },
    redo: () => {
      const { document, activePageId } = get();
      const next = manager.redo(document);
      if (!next) return;
      const pageStillExists = next.pages.some((page) => page.id === activePageId);
      set({ document: next, activePageId: pageStillExists ? activePageId : next.pages[0]?.id ?? '', ...(pageStillExists ? {} : { selectedIds: [], primarySelectedId: null }), isDirty: true, lastAction: manager.lastAction });
      editorEvents.emit('document:changed', { document: next, action: 'Redo' });
      editorEvents.emit('history:changed', { canUndo: manager.canUndo, canRedo: manager.canRedo, lastAction: manager.lastAction });
    },
    reset: (name = 'Untitled diagram', type = 'general') => {
      const document = createDocument(name, type);
      manager.clear();
      set({ document, activePageId: document.pages[0].id, selectedIds: [], primarySelectedId: null, styleClipboard: null, formatPainter: null, isDirty: true, lastSavedAt: null, lastAction: null, viewport: { x: 0, y: 0, zoom: 1 } });
      editorEvents.emit('document:opened', { document });
      editorEvents.emit('history:changed', { canUndo: false, canRedo: false, lastAction: null });
    },
  };
});

export function getActivePage(document: DiagramDocument, pageId: string) {
  return document.pages.find((page) => page.id === pageId) ?? document.pages[0];
}

export { createEdge, createNode };
