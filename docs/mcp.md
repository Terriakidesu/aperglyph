# MCP authoring

AperGlyph exposes the open browser editor to MCP clients through a local companion. The browser remains authoritative: editing operations run through AperGlyph's document command manager, appear in the canvas, participate in undo/redo, and are autosaved by the normal editor.

## Start and pair

1. Start the local editor (`npm run dev`, or open the installed AperGlyph app).
2. Configure your MCP client to launch `npm run mcp` in the AperGlyph repository using stdio transport. The MCP server starts the companion and prints a pairing token to its **stderr/logs**.
3. In AperGlyph, open **Preferences → MCP access**, paste the token, and select **Connect**. The editor is read-only until **Allow MCP clients to edit this document** is enabled. Deletion and exports also have separate grants.

Do not run a second copy of the companion in a separate terminal while your MCP client is already launching it. If the MCP client hides server stderr, set a fixed `APERGLYPH_MCP_TOKEN` in the MCP server environment and paste that same value into Preferences.

The companion does not read or write IndexedDB itself. It can only request operations from an explicitly paired browser editor. If multiple editors are paired, tools require the `editorId` returned by `get_editor_context`.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `APERGLYPH_MCP_TOKEN` | Random 32-byte token | Use a fixed pairing token. It must be at least 24 characters. |
| `APERGLYPH_MCP_ALLOWED_ORIGINS` | Localhost origins | Comma-separated exact browser origins for a hosted AperGlyph app. |

For example, a hosted app may need `APERGLYPH_MCP_ALLOWED_ORIGINS=https://your-aperglyph-host.example`. Only add origins you trust. The browser token is saved locally in the app; use **Revoke access** to remove it. The MCP companion must be running while an MCP client uses the integration.

## Tools and resources

Tools include:

- Discovery and workspace: `get_capabilities`, `list_shape_types`, `list_documents`, `create_document`, `open_document`, `duplicate_document`.
- Inspection: `get_editor_context`, `get_diagram`, `query_objects`, `get_geometry`, `validate_diagram`, `get_history`, `get_view`.
- Editing and arrangement: `preview_operations`, `apply_operations`, `preview_layout`, `apply_layout`, `set_view`, `undo`, `redo`.
- Output: `render_preview`, `export_diagram`, `save_document`.

Resources expose the editor context, current diagram, shape catalog, and page diagrams under `aperglyph://editor/context`, `aperglyph://diagram/current`, `aperglyph://catalog/shapes`, and `aperglyph://diagram/{pageId}`. Changes notify MCP resource subscribers.

## Geometry and operations

Positions are diagram world coordinates in CSS pixels. A node's `position` is its top-left corner; a node's `size` is width/height. Angles are degrees. Endpoint `port` values are `top`, `right`, `bottom`, or `left`; shape-specific anchors can be inspected with `get_geometry`. Endpoints can instead use free-space `{ "point": { "x": 400, "y": 160 } }`. Edge `waypoints` are absolute world-space points.

`apply_operations` takes a non-empty list of operations and applies the whole list atomically as **one undo step**. The supported `op` values are:

- `document.rename`, `document.palette`, `document.style-presets`, `document.shape-defaults`
- `page.create`, `page.duplicate`, `page.rename`, `page.delete`, `page.reorder`, `page.settings`, `page.data`, `page.guides`
- `node.create`, `node.duplicate`, `node.update`, `node.move`, `node.delete`, `node.align`, `node.distribute`, `node.z-order`, `node.reorder`, `node.group`, `node.ungroup`
- `edge.create`, `edge.update`, `edge.delete`
- `layout.apply`

Shape creation accepts a shape type, optional library, exact position/size, style/data, rotation, lock/visibility, and grouping/container properties. Catalog and saved document defaults are applied, then explicit values override them. Node duplication accepts `nodeId`, optional exact `position` (or an `offset`, defaulting to `{x:24,y:24}`), and optional `includeEdges`. A node or edge `id` may be supplied; otherwise AperGlyph generates it. Set `alias` on create/duplicate operations to refer to generated IDs elsewhere in the same batch as `$alias`.

Example (create two nodes, attach a routed connector, and then adjust the exact route):

```json
{
  "documentId": "doc_...",
  "pageId": "page_...",
  "expectedRevision": 12,
  "requestId": "diagram-change-001",
  "label": "Add the request flow",
  "operations": [
    {
      "op": "node.create",
      "alias": "request",
      "node": {
        "library": "flowchart",
        "type": "process",
        "position": { "x": 80, "y": 120 },
        "size": { "width": 190, "height": 82 },
        "data": { "label": "Receive request" }
      }
    },
    {
      "op": "node.create",
      "alias": "database",
      "node": {
        "library": "general",
        "type": "cylinder",
        "position": { "x": 430, "y": 120 },
        "data": { "label": "Orders" }
      }
    },
    {
      "op": "edge.create",
      "alias": "stores",
      "edge": {
        "type": "orthogonal",
        "source": { "nodeId": "$request", "port": "right" },
        "target": { "nodeId": "$database", "port": "left" },
        "data": { "label": "persist" },
        "waypoints": []
      }
    },
    {
      "op": "edge.update",
      "edgeId": "$stores",
      "patch": { "waypoints": [{ "x": 340, "y": 160 }], "routing": { "mode": "manual" } }
    }
  ]
}
```

Call `get_editor_context` before a mutation and use its `revision` as `expectedRevision`. A stale revision is rejected rather than overwriting concurrent manual edits. `requestId` is an idempotency key: a repeat with the same arguments returns the original response; reusing it for different arguments is rejected. Use `preview_operations` to validate a proposed batch before applying it. Project-structure errors reject the whole batch; semantic validator findings are returned by `validate_diagram` and do not silently mutate the diagram.

For automatic arrangement, call `preview_layout` first, then `apply_layout` with the returned mode and a fresh revision. Layout preserves locked/pinned objects. Export formats are `project`, `json`, `sql`, `mermaid`, `plantuml`, `svg`, `png`, and `pdf`; PNG/PDF payloads are base64 encoded.

## Security notes

- The companion binds only to IPv4 loopback; it is not a remote MCP server.
- Browser origin checks are enforced, and every bridge session must authenticate with the pairing token.
- Read access is the default. Editing/view changes, document switching/duplication, explicit save, undo, and redo require edit permission. Since undo/redo may remove objects or restore a deletion, both also require delete permission.
- The bridge limits operation batches to 2,000 operations and paginates scene/object reads (up to 5,000 objects per page of results).
- Diagram text is untrusted content. AperGlyph does not evaluate labels as code, execute shell commands, connect to databases, or grant arbitrary filesystem access.
