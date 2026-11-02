#!/usr/bin/env node
import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = 47777;
const MAX_PAYLOAD = 10 * 1024 * 1024;
const token = process.env.APERGLYPH_MCP_TOKEN || randomBytes(32).toString('base64url');
const extraOrigins = new Set((process.env.APERGLYPH_MCP_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean));
const editors = new Map();
const pending = new Map();

if (token.length < 24) throw new Error('APERGLYPH_MCP_TOKEN must be at least 24 characters long.');

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT, maxPayload: MAX_PAYLOAD });
const server = new McpServer({ name: 'aperglyph-mcp', version: '0.1.0' }, { maxToolInputElements: 100_000 });

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (extraOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function tokenMatches(candidate) {
  if (typeof candidate !== 'string') return false;
  const expected = Buffer.from(token);
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

wss.on('connection', (socket, request) => {
  const origin = request.headers.origin;
  if (!isAllowedOrigin(origin)) {
    socket.close(1008, 'Browser origin is not allowed');
    return;
  }

  let authenticated = false;
  let editorId;
  const authTimeout = setTimeout(() => socket.close(1008, 'Authentication required'), 10_000);

  socket.on('message', (raw) => {
    if (raw.byteLength > MAX_PAYLOAD) {
      socket.close(1009, 'Message too large');
      return;
    }
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      socket.close(1007, 'Invalid JSON');
      return;
    }

    if (!authenticated) {
      if (message?.type !== 'auth' || !tokenMatches(message.token) || typeof message.editorId !== 'string' || message.application !== 'AperGlyph') {
        socket.send(JSON.stringify({ type: 'auth-error', message: 'Pairing token was not accepted.' }));
        socket.close(1008, 'Authentication failed');
        return;
      }
      clearTimeout(authTimeout);
      authenticated = true;
      editorId = message.editorId;
      const oldSocket = editors.get(editorId);
      if (oldSocket && oldSocket !== socket) oldSocket.close(1000, 'Editor reconnected');
      editors.set(editorId, socket);
      socket.send(JSON.stringify({ type: 'ready', editorId }));
      return;
    }

    if (message?.type === 'response' && typeof message.id === 'string') {
      const item = pending.get(message.id);
      if (!item || item.socket !== socket) return;
      pending.delete(message.id);
      clearTimeout(item.timeout);
      if (message.error) item.reject(new Error(String(message.error)));
      else item.resolve(message.result);
      return;
    }

    if (message?.type === 'event' && typeof message.event === 'string') {
      if (server.isConnected()) {
        Promise.all([
          server.server.sendResourceUpdated({ uri: 'aperglyph://editor/context' }),
          server.server.sendResourceUpdated({ uri: 'aperglyph://diagram/current' }),
        ]).catch(() => undefined);
      }
    }
  });

  socket.on('close', () => {
    clearTimeout(authTimeout);
    if (editorId && editors.get(editorId) === socket) editors.delete(editorId);
    for (const [id, item] of pending) {
      if (item.socket !== socket) continue;
      pending.delete(id);
      clearTimeout(item.timeout);
      item.reject(new Error('The paired editor disconnected before responding.'));
    }
  });
  socket.on('error', (error) => process.stderr.write(`AperGlyph bridge socket error: ${error.message}\n`));
});

async function callEditor(method, args = {}) {
  const { editorId: requestedEditorId, ...params } = args;
  let editorId = requestedEditorId;
  if (editorId) {
    if (typeof editorId !== 'string' || !editors.has(editorId)) throw new Error(`Editor '${editorId}' is not connected. Call get_editor_context first to discover connected editor IDs.`);
  } else if (editors.size === 1) {
    editorId = editors.keys().next().value;
  } else if (editors.size === 0) {
    throw new Error(`No AperGlyph editor is paired. Open AperGlyph, then enter the companion token under Preferences → MCP access. Companion WebSocket: ws://127.0.0.1:${PORT}.`);
  } else {
    throw new Error(`More than one editor is connected. Supply editorId to target one: ${[...editors.keys()].join(', ')}.`);
  }

  const socket = editors.get(editorId);
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('The paired editor is no longer connected.');
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`AperGlyph did not respond to '${method}' within 90 seconds.`));
    }, 90_000);
    pending.set(id, { socket, resolve, reject, timeout });
    try {
      socket.send(JSON.stringify({ type: 'request', id, method, params }));
    } catch (error) {
      pending.delete(id);
      clearTimeout(timeout);
      reject(error);
    }
  });
}

function jsonResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function registerTool(name, description, method, inputSchema = {}) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      const result = await callEditor(method, args ?? {});
      return jsonResult(result);
    } catch (error) {
      return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
  });
}

const target = { editorId: z.string().optional().describe('Connected editor ID. Required when multiple browser editors are paired.') };
const docPage = {
  ...target,
  documentId: z.string().optional().describe('Must match the active document ID returned by get_editor_context.'),
  pageId: z.string().optional().describe('Target page; defaults to the active page.'),
};
const revision = z.number().int().describe('Revision from get_editor_context or the previous mutation response. Stale revisions are rejected.');
const requestId = z.string().min(1).max(200).describe('Unique idempotency key. Retrying the same requestId and arguments will not repeat the change.');

server.registerTool('get_capabilities', { description: 'List diagram families, operation limits, units, and supported MCP capabilities.' }, async () => jsonResult({
  diagramTypes: ['general', 'flowchart', 'erd', 'dfd', 'use-case'],
  features: ['documents', 'pages', 'shape-catalog', 'absolute-geometry', 'styles', 'groups', 'containers', 'connections', 'anchors', 'waypoints', 'routing', 'layout-preview', 'validation', 'history', 'svg-preview', 'native-export', 'sql-export', 'mermaid-export', 'plantuml-export', 'png-export', 'pdf-export'],
  limits: { operationsPerBatch: 2000, messageBytes: MAX_PAYLOAD },
  coordinateSystem: 'Diagram world coordinates in CSS pixels; node.position is the top-left corner.',
}));
registerTool('get_editor_context', 'Read the paired editor, active document/page, revision, save status, selection, view, history, and permissions.', 'context.get', target);
registerTool('list_documents', 'List documents stored in the paired browser workspace without reading their contents.', 'documents.list', target);
registerTool('create_document', 'Create and open a local document in the paired editor. Requires the active revision and an idempotency key.', 'documents.create', { ...target, expectedRevision: revision, requestId, name: z.string().optional(), diagramType: z.enum(['general', 'flowchart', 'erd', 'dfd', 'use-case']).optional() });
registerTool('open_document', 'Open a stored browser-workspace document in the paired editor. Requires the active revision and an idempotency key.', 'documents.open', { ...target, expectedRevision: revision, requestId, documentId: z.string().min(1) });
registerTool('duplicate_document', 'Duplicate the active document in the browser workspace and switch the paired editor to the copy. Requires the active revision and an idempotency key.', 'documents.duplicate', { ...docPage, expectedRevision: revision, requestId });
registerTool('get_diagram', 'Read page contents, styles, semantics, exact geometry, connections, and computed routes. Results are paginated (limit up to 5000).', 'diagram.get', { ...docPage, includeRoutes: z.boolean().optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(5000).optional() });
registerTool('query_objects', 'Filter shapes/connectors by ID, type, label, connected node, or world-coordinate region. Results are paginated.', 'objects.query', { ...docPage, ids: z.array(z.string()).optional(), type: z.string().optional(), label: z.string().optional(), connectedTo: z.string().optional(), region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(5000).optional() });
registerTool('get_geometry', 'Read node bounds and stable connection anchors, plus computed edge routes and waypoints. Results are paginated.', 'geometry.get', { ...docPage, offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(5000).optional() });
registerTool('list_shape_types', 'Discover shape libraries, shape types, defaults, semantic roles, and connector types.', 'shapes.list', target);
registerTool('preview_operations', 'Validate and preview a proposed atomic operation batch without changing the document. Operations use {op: ...}; aliases can reference earlier creates as $alias.', 'operations.preview', { ...docPage, expectedRevision: z.number().int().optional(), operations: z.array(z.record(z.string(), z.unknown())).min(1).max(2000) });
registerTool('apply_operations', 'Atomically apply document/page/shape/style/geometry/connection/group/layout changes through editor commands. One batch is one undo step. Node positions are top-left world coordinates in CSS pixels. Requires edit permission, expectedRevision, and requestId.', 'operations.apply', { ...docPage, expectedRevision: revision, requestId, label: z.string().max(160).optional(), operations: z.array(z.record(z.string(), z.unknown())).min(1).max(2000) });
registerTool('preview_layout', 'Calculate layout positions without applying them. Supports hierarchical, dag, horizontal, vertical, tree, grid, compact, and radial modes; locked/pinned nodes are preserved.', 'layout.preview', { ...docPage, expectedRevision: z.number().int().optional(), mode: z.enum(['hierarchical', 'dag', 'horizontal', 'vertical', 'tree', 'grid', 'compact', 'radial']), nodeIds: z.array(z.string()).optional(), pinnedIds: z.array(z.string()).optional(), spacing: z.number().min(0.25).max(4).optional() });
registerTool('apply_layout', 'Apply a layout as one undoable, revision-checked editor command. Requires edit permission and requestId.', 'layout.apply', { ...docPage, expectedRevision: revision, requestId, label: z.string().max(160).optional(), mode: z.enum(['hierarchical', 'dag', 'horizontal', 'vertical', 'tree', 'grid', 'compact', 'radial']), nodeIds: z.array(z.string()).optional(), pinnedIds: z.array(z.string()).optional(), spacing: z.number().min(0.25).max(4).optional() });
registerTool('validate_diagram', 'Run built-in semantic and structural validators without changing the document.', 'diagram.validate', { ...docPage, scope: z.enum(['page', 'document']).optional() });
registerTool('get_view', 'Read current page, viewport, and selection.', 'view.get', target);
registerTool('set_view', 'Change active page, viewport, or selection in the paired editor. Requires edit permission.', 'view.set', { ...target, pageId: z.string().optional(), viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(), selection: z.array(z.string()).optional() });
registerTool('get_history', 'Read undo/redo availability and current revision.', 'history.get', target);
registerTool('undo', 'Undo the latest editor command. Because it can restore or remove objects, it requires both edit and delete permission, expectedRevision, and a unique requestId.', 'history.undo', { ...target, expectedRevision: revision, requestId });
registerTool('redo', 'Redo the latest editor command. Because it can reapply destructive changes, it requires both edit and delete permission, expectedRevision, and a unique requestId.', 'history.redo', { ...target, expectedRevision: revision, requestId });
registerTool('render_preview', 'Render the page to SVG text for visual inspection. The editor remains unchanged.', 'diagram.preview', docPage);
registerTool('export_diagram', 'Export the active document/page as native AperGlyph project, JSON, SQL, Mermaid, PlantUML, SVG, PNG, or PDF. Binary exports are base64 encoded.', 'diagram.export', { ...docPage, format: z.enum(['project', 'json', 'sql', 'mermaid', 'plantuml', 'svg', 'png', 'pdf']) });
registerTool('save_document', 'Explicitly save the current document to the browser workspace and report save status.', 'document.save', { ...docPage, expectedRevision: revision });

server.registerResource('editor-context', 'aperglyph://editor/context', { description: 'Current paired editor context and revision.', mimeType: 'application/json' }, async (uri) => {
  const value = await callEditor('context.get');
  return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value) }] };
});
server.registerResource('current-diagram', 'aperglyph://diagram/current', { description: 'The active page diagram, with geometry and computed routes.', mimeType: 'application/json' }, async (uri) => {
  const value = await callEditor('diagram.get', { limit: 5000 });
  return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value) }] };
});
server.registerResource('shape-catalog', 'aperglyph://catalog/shapes', { description: 'Supported diagram families, shape types, defaults, and connectors.', mimeType: 'application/json' }, async (uri) => {
  const value = await callEditor('shapes.list');
  return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value) }] };
});
server.registerResource('page-diagram', new ResourceTemplate('aperglyph://diagram/{pageId}', { list: undefined }), { description: 'A page by ID, including positions, anchors, connections, and computed routes.', mimeType: 'application/json' }, async (uri, extra) => {
  const pageId = extra?.arguments?.pageId;
  if (typeof pageId !== 'string') throw new Error('A pageId is required.');
  const value = await callEditor('diagram.get', { pageId, limit: 5000 });
  return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);

const originMessage = extraOrigins.size ? ` Extra browser origins: ${[...extraOrigins].join(', ')}.` : ' By default, only localhost browser origins are accepted.';
process.stderr.write(`AperGlyph MCP companion listening on ws://127.0.0.1:${PORT}\n`);
process.stderr.write(`Pairing token: ${token}\n`);
process.stderr.write(`Paste this token in AperGlyph → Preferences → MCP access.${originMessage}\n`);

async function shutdown() {
  for (const socket of editors.values()) socket.close(1001, 'MCP companion shutting down');
  wss.close();
  await server.close().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
