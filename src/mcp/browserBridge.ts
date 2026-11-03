import { invoke, isTauri } from '@tauri-apps/api/core';
import { connectionAnchorPoints } from '../core/anchors';
import { nodeCenter } from '../core/geometry';
import { AuthoringBatchCommand, applyAuthoringBatch, prepareAuthoringBatch } from '../core/authoring';
import type { AuthoringOperation } from '../core/authoring';
import { collectDiagnostics } from '../core/diagnostics';
import { createDocument, serializeProject, validateProjectDocument } from '../core/document';
import { exportErdSql } from '../core/erd';
import { edgeRoute } from '../core/routing';
import { exportDiagramText } from '../core/interoperability';
import { editorEvents } from '../core/events';
import type { DiagramDocument, DiagramEdge, DiagramNode, Point, Viewport } from '../core/types';
import { layoutErdNodes, layoutNodes } from '../core/layout';
import type { LayoutMode } from '../core/layout';
import { duplicateDocument, listDocuments, loadDocument, rememberActiveDocument, saveDocument } from '../persistence';
import { documentToSvg, renderSvgToPng } from '../persistence/files';
import { pluginManager } from '../plugins';
import { getActivePage, useEditorStore } from '../store/editorStore';

const CONFIG_KEY = 'aperglyph.mcp.bridge';
const MAX_CACHE_ENTRIES = 256;
const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
const REVISION_SEED = Date.now() * 1000 + Math.floor(Math.random() * 1000);

export interface McpBridgeConfiguration {
  token: string;
  allowEdits: boolean;
  allowDeletes: boolean;
  allowExports: boolean;
}

export interface McpBridgeSnapshot {
  status: 'disabled' | 'connecting' | 'connected' | 'error';
  editorId: string;
  message: string;
}

interface BridgeRequest {
  type: 'request';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

const editorId = `editor_${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const listeners = new Set<() => void>();
const idempotency = new Map<string, { fingerprint: string; result?: unknown; promise?: Promise<unknown> }>();
const revisions = new Map<string, number>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let attempt = 0;
let snapshot: McpBridgeSnapshot = { status: 'disabled', editorId, message: 'Pair with a local AperGlyph MCP companion to enable access.' };

export function getMcpBridgeConfiguration(): McpBridgeConfiguration {
  try {
    const value = localStorage.getItem(CONFIG_KEY);
    if (!value) return { token: '', allowEdits: false, allowDeletes: false, allowExports: false };
    const parsed = JSON.parse(value) as Partial<McpBridgeConfiguration>;
    return { token: typeof parsed.token === 'string' ? parsed.token : '', allowEdits: parsed.allowEdits === true, allowDeletes: parsed.allowDeletes === true, allowExports: parsed.allowExports === true };
  } catch {
    return { token: '', allowEdits: false, allowDeletes: false, allowExports: false };
  }
}

export function setMcpBridgeConfiguration(configuration: McpBridgeConfiguration): void {
  const normalized = { token: configuration.token.trim(), allowEdits: configuration.allowEdits === true, allowDeletes: configuration.allowDeletes === true, allowExports: configuration.allowExports === true };
  try {
    if (normalized.token) localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    setSnapshot({ status: 'error', message: 'Browser storage is unavailable; MCP pairing could not be saved.' });
    return;
  }
  if (!normalized.token) {
    disconnect();
    setSnapshot({ status: 'disabled', message: 'MCP access is disabled.' });
  } else if (started) {
    disconnect();
    connect();
  }
}

export function getMcpBridgeSnapshot(): McpBridgeSnapshot {
  return snapshot;
}

export function subscribeMcpBridge(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startMcpBrowserBridge(): () => void {
  started = true;
  connect();
  return () => {
    started = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    disconnect();
  };
}

editorEvents.on('document:changed', ({ document }) => {
  revisions.set(document.id, getRevision(document.id) + 1);
  notifyDocumentEvent('document.changed', { documentId: document.id, revision: getRevision(document.id) });
});
editorEvents.on('document:opened', ({ document }) => {
  revisions.set(document.id, getRevision(document.id) + 1);
  notifyDocumentEvent('document.opened', { documentId: document.id, revision: getRevision(document.id) });
});

function connect(): void {
  if (!started || socket || !getMcpBridgeConfiguration().token) return;
  if (typeof WebSocket === 'undefined') {
    setSnapshot({ status: 'error', message: 'This browser does not support WebSocket connections.' });
    return;
  }
  setSnapshot({ status: 'connecting', message: 'Connecting to the local MCP companion…' });
  try {
    const next = new WebSocket('ws://127.0.0.1:47777');
    socket = next;
    next.addEventListener('open', () => {
      const configuration = getMcpBridgeConfiguration();
      next.send(JSON.stringify({ type: 'auth', token: configuration.token, editorId, application: 'AperGlyph' }));
    });
    next.addEventListener('message', (event) => {
      if (typeof event.data !== 'string' || byteLength(event.data) > MAX_MESSAGE_BYTES) {
        next.close(1009, 'Message too large');
        return;
      }
      let message: Record<string, unknown>;
      try { message = JSON.parse(event.data) as Record<string, unknown>; } catch { return; }
      if (message.type === 'ready') {
        attempt = 0;
        setSnapshot({ status: 'connected', message: 'Connected to the local MCP companion.' });
        return;
      }
      if (message.type === 'auth-error') {
        setSnapshot({ status: 'error', message: typeof message.message === 'string' ? message.message : 'MCP authentication failed.' });
        next.close(1008, 'Authentication failed');
        return;
      }
      if (message.type === 'request' && typeof message.id === 'string' && typeof message.method === 'string') {
        void handleRequest(next, message as unknown as BridgeRequest);
      }
    });
    next.addEventListener('close', () => {
      if (socket !== next) return;
      socket = null;
      if (!started || !getMcpBridgeConfiguration().token || snapshot.status === 'error') return;
      setSnapshot({ status: 'connecting', message: 'Companion disconnected; retrying…' });
      const delay = Math.min(15_000, 500 * 2 ** Math.min(attempt++, 5));
      reconnectTimer = setTimeout(connect, delay);
    });
    next.addEventListener('error', () => {
      if (snapshot.status !== 'error') setSnapshot({ status: 'connecting', message: 'Waiting for the local MCP companion…' });
    });
  } catch (error) {
    setSnapshot({ status: 'error', message: error instanceof Error ? error.message : 'Unable to connect to the local MCP companion.' });
  }
}

function disconnect(): void {
  const current = socket;
  socket = null;
  if (current && current.readyState < WebSocket.CLOSING) current.close(1000, 'Pairing changed');
}

async function handleRequest(target: WebSocket, request: BridgeRequest): Promise<void> {
  try {
    const result = await dispatch(request.method, request.params ?? {});
    if (target.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify({ type: 'response', id: request.id, result });
      if (byteLength(payload) > MAX_MESSAGE_BYTES) throw new Error('The response is too large for the local bridge. Narrow the query or export a smaller page/selection.');
      target.send(payload);
    }
  } catch (error) {
    if (target.readyState === WebSocket.OPEN) target.send(JSON.stringify({ type: 'response', id: request.id, error: error instanceof Error ? error.message : String(error) }));
  }
}

async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
  const store = useEditorStore.getState();
  const active = store.document;
  const activePageId = store.activePageId;
  const pageId = typeof params.pageId === 'string' ? params.pageId : activePageId;
  const page = typeof params.pageId === 'string'
    ? active.pages.find((candidate) => candidate.id === params.pageId)
    : getActivePage(active, activePageId);
  if (!page) throw new Error(`Page '${pageId}' does not exist in the active document.`);
  const requireEdit = () => {
    if (!getMcpBridgeConfiguration().allowEdits) throw new Error('This editor is paired in read-only mode. Enable edit access in Preferences to allow MCP changes.');
  };
  const requireDelete = () => {
    if (!getMcpBridgeConfiguration().allowDeletes) throw new Error('This MCP request may remove or restore diagram objects. Enable delete access in Preferences to allow destructive operations and history replay.');
  };
  const requireExport = () => {
    if (!getMcpBridgeConfiguration().allowExports) throw new Error('MCP export is not permitted. Enable export access in Preferences to allow file content to leave the editor.');
  };
  const requireDocument = () => {
    if (typeof params.documentId === 'string' && params.documentId !== active.id) throw new Error(`Document '${params.documentId}' is not open in this editor (active document is '${active.id}').`);
  };
  const requireRevision = () => {
    requireDocument();
    return requireCurrentRevision();
  };
  const requireCurrentRevision = () => {
    const expected = params.expectedRevision;
    if (!Number.isInteger(expected)) throw new Error('expectedRevision is required for this operation. Read the editor context and retry.');
    const actual = getRevision(active.id);
    if (expected !== actual) throw new Error(`Revision conflict: expected ${expected}, current revision is ${actual}. Read the diagram again before retrying.`);
    return actual;
  };

  switch (method) {
    case 'context.get':
      return {
        editorId,
        documentId: active.id,
        documentName: active.name,
        diagramType: active.diagramType,
        palette: active.palette,
        stylePresets: active.stylePresets,
        styleDefaults: active.styleDefaults,
        activePageId,
        activePageName: getActivePage(active, activePageId)?.name,
        revision: getRevision(active.id),
        isDirty: store.isDirty,
        saveStatus: store.isDirty ? 'pending-autosave' : 'saved',
        lastSavedAt: store.lastSavedAt,
        selection: { ids: store.selectedIds, primaryId: store.primarySelectedId },
        viewport: store.viewport,
        history: { canUndo: store.commandManager.canUndo, canRedo: store.commandManager.canRedo, lastAction: store.commandManager.lastAction },
        permissions: { read: true, edit: getMcpBridgeConfiguration().allowEdits, delete: getMcpBridgeConfiguration().allowDeletes, export: getMcpBridgeConfiguration().allowExports },
      };
    case 'documents.list': {
      const documents = await listDocuments();
      return documents.map(({ id, name, diagramType, updatedAt, favorite, trashedAt }) => ({ id, name, diagramType, updatedAt, favorite, trashedAt }));
    }
    case 'documents.open': {
      requireEdit();
      const id = requiredString(params.documentId, 'documentId');
      const requestId = requiredString(params.requestId, 'requestId');
      return applyIdempotently(requestId, { method, params }, async () => {
        requireCurrentRevision();
        await flushActiveBeforeSwitch(active.id);
        const sourceRevision = getRevision(active.id);
        const loaded = await loadDocument(id);
        if (!loaded) throw new Error(`Document '${id}' could not be found in this browser workspace.`);
        if (useEditorStore.getState().document.id !== active.id || getRevision(active.id) !== sourceRevision) throw new Error('The active document changed while the requested document was loading. Retry the open operation.');
        await rememberActiveDocument(id);
        useEditorStore.getState().setDocument(loaded);
        return { documentId: loaded.id, name: loaded.name, revision: getRevision(loaded.id) };
      });
    }
    case 'documents.duplicate': {
      requireEdit();
      requireDocument();
      const requestId = requiredString(params.requestId, 'requestId');
      return applyIdempotently(requestId, { method, params }, async () => {
        requireRevision();
        await flushActiveBeforeSwitch(active.id);
        const sourceRevision = getRevision(active.id);
        const duplicate = await duplicateDocument(active.id);
        if (!duplicate) throw new Error(`Document '${active.id}' could not be duplicated.`);
        if (useEditorStore.getState().document.id !== active.id || getRevision(active.id) !== sourceRevision) throw new Error('The active document changed while the copy was being created. Retry the duplicate operation.');
        await rememberActiveDocument(duplicate.id);
        useEditorStore.getState().setDocument(duplicate);
        return { documentId: duplicate.id, name: duplicate.name, revision: getRevision(duplicate.id) };
      });
    }
    case 'documents.create': {
      requireEdit();
      const type = typeof params.diagramType === 'string' ? params.diagramType : 'general';
      if (!['general', 'flowchart', 'erd', 'dfd', 'use-case'].includes(type)) throw new Error(`Unsupported diagram type '${type}'.`);
      const requestId = requiredString(params.requestId, 'requestId');
      return applyIdempotently(requestId, { method, params }, async () => {
        requireCurrentRevision();
        await flushActiveBeforeSwitch(active.id);
        const created = createDocument(typeof params.name === 'string' ? params.name : 'Untitled diagram', type as DiagramDocument['diagramType']);
        await rememberActiveDocument(created.id);
        useEditorStore.getState().setDocument(created);
        return { documentId: created.id, pageId: created.pages[0].id, revision: getRevision(created.id) };
      });
    }
    case 'diagram.get': {
      requireDocument();
      const result = getGeometry(active, page, params.includeRoutes !== false);
      const { offset, limit } = pagination(params);
      return {
        document: { id: active.id, name: active.name, diagramType: active.diagramType, schemaVersion: active.schemaVersion, createdAt: active.createdAt, updatedAt: active.updatedAt, palette: active.palette, stylePresets: active.stylePresets, styleDefaults: active.styleDefaults },
        pages: active.pages.map((candidate) => ({ id: candidate.id, name: candidate.name, nodeCount: candidate.nodes.length, edgeCount: candidate.edges.length })),
        page: { ...result.page, nodes: result.page.nodes.slice(offset, offset + limit), edges: result.page.edges.slice(offset, offset + limit) },
        counts: { nodes: result.page.nodes.length, edges: result.page.edges.length },
        offset, limit,
        nextOffset: offset + limit < Math.max(result.page.nodes.length, result.page.edges.length) ? offset + limit : null,
        revision: getRevision(active.id),
      };
    }
    case 'objects.query': {
      requireDocument();
      return queryObjects(page.nodes, page.edges, params);
    }
    case 'geometry.get': {
      requireDocument();
      const result = getGeometry(active, page, true);
      const { offset, limit } = pagination(params);
      return {
        page: { ...result.page, nodes: result.page.nodes.slice(offset, offset + limit), edges: result.page.edges.slice(offset, offset + limit) },
        counts: { nodes: result.page.nodes.length, edges: result.page.edges.length },
        offset,
        limit,
        nextOffset: offset + limit < Math.max(result.page.nodes.length, result.page.edges.length) ? offset + limit : null,
        revision: result.revision,
      };
    }
    case 'capabilities.get':
      return getCapabilities();
    case 'shapes.list':
      return pluginManager.list().map((plugin) => ({
        id: plugin.id, name: plugin.name, description: plugin.description,
        shapes: plugin.shapes.map((shape) => ({ id: shape.id, type: shape.type, label: shape.label, category: shape.category, aliases: shape.aliases, tags: shape.tags, semanticRole: shape.semanticRole, notation: shape.notation, defaultSize: shape.defaultSize, defaultStyle: shape.defaultStyle, defaultData: shape.defaultData, boundary: shape.boundary, container: shape.container })),
        connectors: plugin.connectors,
      }));
    case 'operations.preview': {
      requireDocument();
      checkOptionalRevision(params, active.id);
      const operations = parseOperations(params.operations);
      const prepared = prepareAuthoringBatch(operations);
      const result = applyAuthoringBatch(active, page.id, prepared);
      const changedNodeIds = new Set(result.changedNodeIds);
      const changedEdgeIds = new Set(result.changedEdgeIds);
      return {
        valid: true,
        aliases: result.aliases,
        changedNodeIds: result.changedNodeIds,
        changedEdgeIds: result.changedEdgeIds,
        affectedPageIds: result.affectedPageIds,
        document: { id: result.document.id, name: result.document.name, diagramType: result.document.diagramType, palette: result.document.palette, stylePresets: result.document.stylePresets, styleDefaults: result.document.styleDefaults },
        pages: result.affectedPageIds.map((id) => {
          const affected = result.document.pages.find((candidate) => candidate.id === id);
          return affected ? { id, name: affected.name, settings: affected.settings } : { id, deleted: true };
        }),
        nodes: result.document.pages.flatMap((candidate) => candidate.nodes.filter((node) => changedNodeIds.has(node.id)).map((node) => ({ pageId: candidate.id, ...node }))),
        edges: result.document.pages.flatMap((candidate) => candidate.edges.filter((edge) => changedEdgeIds.has(edge.id)).map((edge) => ({ pageId: candidate.id, ...edge }))),
        revision: getRevision(active.id),
      };
    }
    case 'operations.apply': {
      requireEdit();
      const requestId = requiredString(params.requestId, 'requestId');
      const operations = parseOperations(params.operations);
      if (operations.some((operation) => ['node.delete', 'edge.delete', 'page.delete'].includes(operation.op))) requireDelete();
      return applyIdempotently(requestId, { method, params }, () => {
        requireRevision();
        const prepared = prepareAuthoringBatch(operations);
        const command = new AuthoringBatchCommand(page.id, prepared, typeof params.label === 'string' ? params.label : 'MCP authoring batch');
        const latest = useEditorStore.getState();
        if (latest.document.id !== active.id) throw new Error('The active document changed before this request could be applied.');
        latest.executeCommand(command);
        const result = command.result;
        if (!result) throw new Error('The authoring batch did not produce a result.');
        const current = useEditorStore.getState();
        const visiblePage = result.affectedPageIds.find((id) => current.document.pages.some((candidate) => candidate.id === id))
          ?? (current.document.pages.some((candidate) => candidate.id === current.activePageId) ? current.activePageId : current.document.pages[0]?.id);
        if (visiblePage && visiblePage !== current.activePageId) current.setActivePage(visiblePage);
        const selected = [...result.changedNodeIds, ...result.changedEdgeIds];
        current.setSelection(selected.filter((id) => idExistsOnPage(useEditorStore.getState().document, visiblePage ?? '', id)));
        return {
          applied: true,
          label: command.label,
          aliases: result.aliases,
          changedNodeIds: result.changedNodeIds,
          changedEdgeIds: result.changedEdgeIds,
          affectedPageIds: result.affectedPageIds,
          revision: getRevision(active.id),
          saveStatus: useEditorStore.getState().isDirty ? 'pending-autosave' : 'saved',
          undoAvailable: useEditorStore.getState().commandManager.canUndo,
        };
      });
    }
    case 'layout.preview': {
      requireDocument();
      checkOptionalRevision(params, active.id);
      return calculateLayout(active, page, params);
    }
    case 'layout.apply': {
      requireEdit();
      const requestId = requiredString(params.requestId, 'requestId');
      return applyIdempotently(requestId, { method, params }, () => {
        requireRevision();
        const layoutOperation = parseLayoutOperation(params);
        const prepared = prepareAuthoringBatch([layoutOperation]);
        const command = new AuthoringBatchCommand(page.id, prepared, typeof params.label === 'string' ? params.label : `MCP layout · ${layoutOperation.mode}`);
        useEditorStore.getState().executeCommand(command);
        const result = command.result;
        if (!result) throw new Error('The layout did not produce a result.');
        return { applied: true, changedNodeIds: result.changedNodeIds, revision: getRevision(active.id), saveStatus: 'pending-autosave' };
      });
    }
    case 'diagram.validate':
      requireDocument();
      return {
        documentId: active.id,
        revision: getRevision(active.id),
        diagnostics: [
          ...collectDiagnostics(active, params.scope === 'page' ? 'page' : 'document', page.id),
          ...validateProjectDocument(active).map((message, index) => {
            const pageIndex = /^pages\[(\d+)\]/.exec(message)?.[1];
            const pageId = pageIndex === undefined ? undefined : active.pages[Number(pageIndex)]?.id;
            return { id: `structure-${index}`, severity: 'error' as const, code: 'core.invalid-document', plugin: 'core', message, ...(pageId ? { pageId } : {}) };
          }).filter((diagnostic) => params.scope !== 'page' || !diagnostic.pageId || diagnostic.pageId === page.id),
        ],
      };
    case 'view.get':
      return { pageId: activePageId, selection: { ids: store.selectedIds, primaryId: store.primarySelectedId }, viewport: store.viewport };
    case 'view.set': {
      requireEdit();
      editorEvents.emit('editor:focus-requested', undefined);
      if (typeof params.pageId === 'string') {
        if (!active.pages.some((candidate) => candidate.id === params.pageId)) throw new Error(`Page '${params.pageId}' does not exist.`);
        store.setActivePage(params.pageId);
      }
      if (params.viewport && isRecord(params.viewport)) store.setViewport(validateViewport(params.viewport as Partial<Viewport>));
      if (Array.isArray(params.selection)) {
        const currentPage = getActivePage(useEditorStore.getState().document, useEditorStore.getState().activePageId);
        const ids = params.selection.filter((id): id is string => typeof id === 'string' && idExistsOnPage(active, currentPage.id, id));
        store.setSelection(ids);
      }
      return { pageId: useEditorStore.getState().activePageId, viewport: useEditorStore.getState().viewport, selection: useEditorStore.getState().selectedIds };
    }
    case 'history.get':
      return { canUndo: store.commandManager.canUndo, canRedo: store.commandManager.canRedo, lastAction: store.commandManager.lastAction, revision: getRevision(active.id) };
    case 'history.undo':
    case 'history.redo': {
      requireEdit();
      requireDelete();
      const requestId = requiredString(params.requestId, 'requestId');
      return applyIdempotently(requestId, { method, params }, () => {
        requireRevision();
        if (method === 'history.undo') useEditorStore.getState().undo();
        else useEditorStore.getState().redo();
        const current = useEditorStore.getState();
        return { applied: true, canUndo: current.commandManager.canUndo, canRedo: current.commandManager.canRedo, lastAction: current.commandManager.lastAction, revision: getRevision(current.document.id), saveStatus: current.isDirty ? 'pending-autosave' : 'saved' };
      });
    }
    case 'diagram.preview': {
      requireDocument();
      requireExport();
      const selectedPage = active.pages.find((candidate) => candidate.id === page.id)!;
      const svg = documentToSvg(selectedPage.nodes, selectedPage.edges, selectedPage.settings.background, selectedPage.settings.width, selectedPage.settings.height);
      if (byteLength(svg) > MAX_MESSAGE_BYTES - 1024) throw new Error('The rendered SVG preview is too large to send through the local bridge. Reduce the page contents or export selected objects.');
      return { documentId: active.id, pageId: page.id, width: page.settings.width, height: page.settings.height, mimeType: 'image/svg+xml', svg };
    }
    case 'screenshot.app-ui': {
      requireDocument();
      requireExport();
      if (!isTauri()) throw new Error('A full application-window screenshot is available only in the AperGlyph desktop app.');
      return { mimeType: 'image/png', data: await invoke<string>('capture_app_window_screenshot') };
    }
    case 'screenshot.canvas': {
      requireDocument();
      requireExport();
      const scale = params.scale === undefined ? 2 : Number(params.scale);
      if (!Number.isInteger(scale) || scale < 1 || scale > 3) throw new Error('scale must be an integer between 1 and 3.');
      const width = Math.round(page.settings.width * scale);
      const height = Math.round(page.settings.height * scale);
      assertRasterSize(width, height);
      const svg = documentToSvg(page.nodes, page.edges, page.settings.background, page.settings.width, page.settings.height);
      const png = await renderSvgToPng(svg, width, height);
      if (png.size > MAX_MESSAGE_BYTES / 2) throw new Error('The canvas screenshot is too large for the local bridge. Reduce the page dimensions or screenshot scale.');
      return { mimeType: 'image/png', data: await blobToBase64(png), width, height, pageId: page.id };
    }
    case 'diagram.export':
      requireDocument();
      requireExport();
      return exportArtifact(active, page, typeof params.format === 'string' ? params.format : 'project');
    case 'document.save': {
      requireEdit();
      const savedRevision = requireRevision();
      await saveDocument(active);
      if (useEditorStore.getState().document.id !== active.id || getRevision(active.id) !== savedRevision) throw new Error('The document changed while it was being saved; the newer revision remains dirty and will be autosaved.');
      useEditorStore.getState().markSaved(Date.now());
      return { saved: true, savedAt: useEditorStore.getState().lastSavedAt, revision: getRevision(active.id) };
    }
    default:
      throw new Error(`Unknown editor bridge method '${method}'.`);
  }
}

function getRevision(documentId: string): number {
  if (!revisions.has(documentId)) revisions.set(documentId, REVISION_SEED);
  return revisions.get(documentId)!;
}

function checkOptionalRevision(params: Record<string, unknown>, documentId: string): void {
  if (params.expectedRevision === undefined) return;
  if (!Number.isInteger(params.expectedRevision)) throw new Error('expectedRevision must be an integer.');
  const actual = getRevision(documentId);
  if (params.expectedRevision !== actual) throw new Error(`Revision conflict: expected ${params.expectedRevision}, current revision is ${actual}.`);
}

function parseOperations(value: unknown): AuthoringOperation[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('operations must be a non-empty array.');
  if (value.length > 2000) throw new Error('A batch may contain at most 2000 operations.');
  return value as AuthoringOperation[];
}

function parseLayoutOperation(params: Record<string, unknown>): Extract<AuthoringOperation, { op: 'layout.apply' }> {
  const modes: LayoutMode[] = ['hierarchical', 'dag', 'horizontal', 'vertical', 'tree', 'grid', 'compact', 'radial'];
  const mode = params.mode;
  if (typeof mode !== 'string' || !modes.includes(mode as LayoutMode)) throw new Error(`mode must be one of: ${modes.join(', ')}.`);
  return {
    op: 'layout.apply', mode: mode as LayoutMode,
    ...(typeof params.pageId === 'string' ? { pageId: params.pageId } : {}),
    ...(Array.isArray(params.nodeIds) ? { nodeIds: params.nodeIds.filter((id): id is string => typeof id === 'string') } : {}),
    ...(Array.isArray(params.pinnedIds) ? { pinnedIds: params.pinnedIds.filter((id): id is string => typeof id === 'string') } : {}),
    ...(typeof params.spacing === 'number' ? { spacing: params.spacing } : {}),
  };
}

function calculateLayout(document: DiagramDocument, page: DiagramDocument['pages'][number], params: Record<string, unknown>) {
  const operation = parseLayoutOperation({ ...params, pageId: page.id });
  const pinned = new Set(operation.pinnedIds ?? []);
  const requested = operation.nodeIds !== undefined ? new Set(operation.nodeIds) : undefined;
  const missingId = [...(requested ?? []), ...pinned].find((id) => !page.nodes.some((node) => node.id === id));
  if (missingId) throw new Error(`Layout references missing node '${missingId}'.`);
  const nodes = page.nodes.filter((node) => (!requested || requested.has(node.id)) && !node.locked && !pinned.has(node.id));
  if (!nodes.length) throw new Error('Layout has no unlocked, unpinned nodes to arrange.');
  const positions = document.diagramType === 'erd' && nodes.every((node) => node.type === 'entity')
    ? layoutErdNodes(nodes, page.edges, operation.mode === 'horizontal' ? 'horizontal' : 'vertical')
    : layoutNodes(nodes, page.edges, operation.mode);
  const spacing = operation.spacing ?? 1;
  if (spacing < 0.25 || spacing > 4 || !Number.isFinite(spacing)) throw new Error('Layout spacing must be between 0.25 and 4.');
  scalePositions(positions, spacing);
  return { pageId: page.id, mode: operation.mode, positions, pinnedIds: [...pinned], revision: getRevision(document.id) };
}

function getGeometry(document: DiagramDocument, page: DiagramDocument['pages'][number], includeRoutes: boolean) {
  const nodes = page.nodes.map((node) => {
    const shape = pluginManager.getShape(node.library, node.type);
    return {
      ...node,
      bounds: { x: node.position.x, y: node.position.y, width: node.size.width, height: node.size.height },
      center: { x: node.position.x + node.size.width / 2, y: node.position.y + node.size.height / 2 },
      anchors: connectionAnchorPoints(node, shape?.anchors).map(({ anchor, point }) => ({ ...anchor, point })),
    };
  });
  const nodeMap = new Map(page.nodes.map((node) => [node.id, node]));
  const edges = page.edges.map((edge) => {
    const source = edge.source.nodeId ? nodeMap.get(edge.source.nodeId) : undefined;
    const target = edge.target.nodeId ? nodeMap.get(edge.target.nodeId) : undefined;
    return { ...edge, ...(includeRoutes ? { computedRoute: edgeRoute(edge, source, target, page.nodes) } : {}) };
  });
  return { page: { ...page, nodes, edges }, pageId: page.id, revision: getRevision(document.id) };
}

function queryObjects(nodes: DiagramNode[], edges: DiagramEdge[], params: Record<string, unknown>) {
  const ids = Array.isArray(params.ids) ? new Set(params.ids.filter((value): value is string => typeof value === 'string')) : null;
  const type = typeof params.type === 'string' ? params.type : undefined;
  const label = typeof params.label === 'string' ? params.label.toLocaleLowerCase() : undefined;
  const nodeResults = nodes.filter((node) => (!ids || ids.has(node.id)) && (!type || node.type === type) && (!label || String(node.data.label ?? '').toLocaleLowerCase().includes(label)));
  const connectedTo = typeof params.connectedTo === 'string' ? params.connectedTo : undefined;
  let edgeResults = edges.filter((edge) => (!ids || ids.has(edge.id)) && (!type || edge.type === type) && (!label || String(edge.data.label ?? '').toLocaleLowerCase().includes(label)) && (!connectedTo || edge.source.nodeId === connectedTo || edge.target.nodeId === connectedTo));
  const region = isRecord(params.region) ? params.region as { x?: number; y?: number; width?: number; height?: number } : null;
  if (region && (![region.x, region.y, region.width, region.height].every((value) => value === undefined || Number.isFinite(value)) || (region.width ?? 0) < 0 || (region.height ?? 0) < 0)) {
    throw new Error('region must contain finite coordinates and non-negative width and height.');
  }
  const filteredNodes = region ? nodeResults.filter((node) => intersects(node.position, node.size, region)) : nodeResults;
  if (region) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    edgeResults = edgeResults.filter((edge) => {
      const points = [edge.source.point, edge.target.point, ...edge.waypoints,
        ...(edge.source.nodeId && byId.has(edge.source.nodeId) ? [nodeCenter(byId.get(edge.source.nodeId)!)] : []),
        ...(edge.target.nodeId && byId.has(edge.target.nodeId) ? [nodeCenter(byId.get(edge.target.nodeId)!)] : []),
      ].filter((point): point is Point => Boolean(point));
      if (!points.length) return false;
      const bounds = { x: Math.min(...points.map((point) => point.x)), y: Math.min(...points.map((point) => point.y)), width: Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)), height: Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)) };
      return intersects(bounds, { width: bounds.width, height: bounds.height }, region);
    });
  }
  const { offset, limit } = pagination(params);
  return {
    nodes: filteredNodes.slice(offset, offset + limit),
    edges: edgeResults.slice(offset, offset + limit),
    count: { nodes: filteredNodes.length, edges: edgeResults.length },
    offset, limit, nextOffset: offset + limit < Math.max(filteredNodes.length, edgeResults.length) ? offset + limit : null,
  };
}

function pagination(params: Record<string, unknown>): { offset: number; limit: number } {
  const offset = params.offset === undefined ? 0 : Number(params.offset);
  const limit = params.limit === undefined ? 1000 : Number(params.limit);
  if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('limit must be an integer between 1 and 5000.');
  return { offset, limit };
}

function intersects(position: Point, size: { width: number; height: number }, region: { x?: number; y?: number; width?: number; height?: number }): boolean {
  const x = region.x ?? 0; const y = region.y ?? 0; const width = region.width ?? 0; const height = region.height ?? 0;
  return position.x <= x + width && position.y <= y + height && position.x + size.width >= x && position.y + size.height >= y;
}

function getCapabilities() {
  return {
    diagramTypes: ['general', 'flowchart', 'erd', 'dfd', 'use-case'],
    features: ['documents', 'pages', 'shape-catalog', 'absolute-geometry', 'styles', 'groups', 'containers', 'connections', 'anchors', 'waypoints', 'routing', 'layout-preview', 'validation', 'history', 'svg-preview', 'native-export', 'sql-export', 'mermaid-export', 'plantuml-export', 'png-export', 'pdf-export', 'app-ui-screenshot', 'canvas-screenshot'],
    limits: { operationsPerBatch: 2000, messageBytes: MAX_MESSAGE_BYTES },
    coordinateSystem: 'Diagram world coordinates in CSS pixels; node.position is the top-left corner.',
  };
}

async function exportArtifact(document: DiagramDocument, page: DiagramDocument['pages'][number], format: string): Promise<Record<string, unknown>> {
  if (format === 'project') return textArtifact(format, 'application/json', `${safeFilename(document.name)}.wdiag`, serializeProject(document));
  if (format === 'json') return textArtifact(format, 'application/json', `${safeFilename(document.name)}.json`, JSON.stringify(document, null, 2));
  if (format === 'sql') return textArtifact(format, 'text/sql', `${safeFilename(document.name)}.sql`, exportErdSql(document, page.id));
  if (format === 'mermaid' || format === 'plantuml') return textArtifact(format, 'text/plain', `${safeFilename(document.name)}.${format === 'mermaid' ? 'mmd' : 'puml'}`, exportDiagramText(document, format, page.id));
  const svg = documentToSvg(page.nodes, page.edges, page.settings.background, page.settings.width, page.settings.height);
  if (byteLength(svg) > MAX_MESSAGE_BYTES - 2048) throw new Error('The rendered export is too large for the local bridge. Reduce the page contents or export a smaller page.');
  if (format === 'svg') return textArtifact(format, 'image/svg+xml', `${safeFilename(document.name)}.svg`, svg);
  if (format === 'png') {
    assertRasterSize(page.settings.width * 2, page.settings.height * 2);
    const blob = await renderSvgToPng(svg, page.settings.width * 2, page.settings.height * 2);
    if (blob.size > MAX_MESSAGE_BYTES / 2) throw new Error('The PNG export is too large for the local bridge. Reduce the page contents or export a smaller page.');
    return { format, mimeType: blob.type, filename: `${safeFilename(document.name)}.png`, data: await blobToBase64(blob) };
  }
  if (format === 'pdf') {
    assertRasterSize(page.settings.width * 2, page.settings.height * 2);
    const { PDFDocument } = await import('pdf-lib');
    const png = await renderSvgToPng(svg, page.settings.width * 2, page.settings.height * 2);
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(await png.arrayBuffer());
    const pdfPage = pdf.addPage([page.settings.width, page.settings.height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: page.settings.width, height: page.settings.height });
    const bytes = await pdf.save();
    if (bytes.byteLength > MAX_MESSAGE_BYTES / 2) throw new Error('The PDF export is too large for the local bridge. Reduce the page contents or export a smaller page.');
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return { format, mimeType: 'application/pdf', filename: `${safeFilename(document.name)}.pdf`, data: btoa(binary) };
  }
  throw new Error('Unsupported export format. Choose project, json, sql, mermaid, plantuml, svg, png, or pdf.');
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

async function applyIdempotently<T>(requestId: string, request: unknown, work: () => T | Promise<T>): Promise<T> {
  if (requestId.length > 200) throw new Error('requestId must be 200 characters or fewer.');
  const fingerprint = JSON.stringify(request);
  const existing = idempotency.get(requestId);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new Error(`requestId '${requestId}' was already used with a different request.`);
    if (existing.promise) return structuredClone(await existing.promise) as T;
    return structuredClone(existing.result) as T;
  }
  const entry: { fingerprint: string; result?: unknown; promise?: Promise<unknown> } = { fingerprint };
  idempotency.set(requestId, entry);
  const promise = Promise.resolve().then(work);
  entry.promise = promise;
  let result: T;
  try {
    result = await promise;
  } catch (error) {
    idempotency.delete(requestId);
    throw error;
  }
  entry.result = structuredClone(result);
  entry.promise = undefined;
  while (idempotency.size > MAX_CACHE_ENTRIES) idempotency.delete(idempotency.keys().next().value!);
  return structuredClone(result);
}

function textArtifact(format: string, mimeType: string, filename: string, text: string): Record<string, unknown> {
  if (byteLength(text) > MAX_MESSAGE_BYTES - 2048) throw new Error('The export is too large for the local bridge. Export a single page or reduce its contents.');
  return { format, mimeType, filename, text };
}

async function flushActiveBeforeSwitch(documentId: string): Promise<void> {
  const before = useEditorStore.getState();
  if (before.document.id !== documentId) throw new Error('The active document changed before this request could be completed.');
  if (!before.isDirty) return;
  const revision = getRevision(documentId);
  await saveDocument(before.document);
  const after = useEditorStore.getState();
  if (after.document.id !== documentId || getRevision(documentId) !== revision) throw new Error('The current document changed while it was being saved. Retry after autosave completes.');
  after.markSaved(Date.now());
}

function validateViewport(value: Partial<Viewport>): Viewport {
  const next = { x: Number(value.x), y: Number(value.y), zoom: Number(value.zoom) };
  if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !Number.isFinite(next.zoom) || next.zoom < 0.05 || next.zoom > 8) throw new Error('Viewport coordinates must be finite and zoom must be between 0.05 and 8.');
  return next;
}

function idExistsOnPage(document: DiagramDocument, pageId: string, id: string): boolean {
  const target = document.pages.find((candidate) => candidate.id === pageId);
  return Boolean(target?.nodes.some((node) => node.id === id) || target?.edges.some((edge) => edge.id === id));
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value;
}

function setSnapshot(next: Omit<McpBridgeSnapshot, 'editorId'>): void {
  snapshot = { ...next, editorId };
  listeners.forEach((listener) => listener());
}

function notifyDocumentEvent(event: string, data: Record<string, unknown>): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'event', event, data }));
}

function safeFilename(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').toLowerCase() || 'untitled-diagram';
}

function scalePositions(positions: Record<string, Point>, factor: number): void {
  const ids = Object.keys(positions);
  if (factor === 1 || ids.length < 2) return;
  const center = ids.reduce((acc, id) => ({ x: acc.x + positions[id].x / ids.length, y: acc.y + positions[id].y / ids.length }), { x: 0, y: 0 });
  ids.forEach((id) => {
    positions[id] = { x: center.x + (positions[id].x - center.x) * factor, y: center.y + (positions[id].y - center.y) * factor };
  });
}

function assertRasterSize(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > 40_000_000) {
    throw new Error('Raster exports are limited to 40 million pixels. Reduce the page dimensions before exporting PNG or PDF.');
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
