# ERD connector readability and connection-aware layout

**Status:** Proposed  
**Scope:** ERD routing, table placement, and the explicit layout workflow

## Problem

The saved ERD has 32 tables and 36 foreign-key connectors. Its current route
scan reports no connector segments crossing table interiors, but the supplied
screenshots still show dense shared corridors, overlapping parallel lines,
crowded bends, and connectors competing with crow's-foot markers near tables.
Obstacle avoidance alone is not enough to make a dense ERD readable.

Table positions also affect routing quality. Today, routing mostly adapts to
fixed table positions; an explicit layout operation should be able to move
eligible tables to make the relationship graph easier to read.

## Goals

- Make connector paths visually distinct, especially at shared table edges and
  in dense relationship clusters.
- Reposition tables based on their foreign-key connections when the user asks
  to optimize the ERD layout.
- Preserve table/field semantics and manual user intent.
- Keep the operation deterministic, undoable, local-first, and usable without
  WASM through a TypeScript fallback.
- Keep ordinary routing from unexpectedly moving tables.

## Non-goals

- Do not automatically rearrange tables after every edit, route calculation, or
  page load.
- Do not change foreign-key metadata, endpoint field anchors, cardinality, or
  relationship direction to improve appearance.
- Do not promise that crossings can always be eliminated in a dense graph; when
  unavoidable, make them deliberate and legible.

## Existing baseline and architecture

- The Rust diagram engine already exports orthogonal routing to WASM; the
  TypeScript router remains the fallback.
- ERDs already use field-row anchors and have an ERD-specific hierarchical
  layout function in `src/core/layout.ts`.
- The editor already has an auto-layout action and undoable layout command.
- Locked nodes and explicit `pinnedIds` are understood by parts of the
  authoring/layout API; the new ERD operation must apply equivalent guarantees
  in the interactive editor.
- Saved-document baseline: 32 tables, 36 FK edges, all edges in `simple` mode,
  zero table-blocked segments, zero validation diagnostics, and approximately
  20,777 diagram units of total routed length. The route scan found 23 routes
  with two turns and 13 with four turns. Keep this as a comparison fixture;
  route length alone is not a readability score.

## Proposed interaction

Add an explicit **Optimize ERD layout** action, separate from normal routing.
It arranges connected tables and recalculates automatic routes as one
undoable operation. The action should:

1. Use the full page by default, with a clear path to optimize a selected
   connected subset later if that is practical without splitting relationships
   at the selection boundary.
2. Treat locked tables and user-pinned tables as fixed obstacles/anchors.
3. Preserve manually routed edges and waypoints; optimize automatic edges
   around them. If a manual route cannot be preserved safely, report that
   rather than silently discarding it.
4. Leave non-entity objects and unrelated page content in place.
5. Provide one undo entry and support redo; show the user that tables may move
   before applying the operation.

Do not add a persistent pin property solely for this feature initially. Reuse
the existing locked state and, if needed, pass a one-operation pin set through
the layout command/API.

## Implementation plan

### 1. Establish a legibility score and regression fixture

- Capture a reproducible route/layout baseline from the saved ERD and add a
  fixture or generated graph with crowded endpoints, parallel edges, and
  unavoidable crossings.
- Measure separately: table-obstacle intersections, overlapping collinear
  segments, near-parallel spacing, crossings, bend count, minimum segment
  length, endpoint-marker clearance, and total path length.
- Use lexicographic priorities rather than one length-only objective:
  1. Valid orthogonal paths that avoid non-endpoint tables.
  2. Clear endpoint escape segments and marker/crow's-foot space.
  3. Avoid shared path overlap, crowded bends, and unnecessary crossings.
  4. Prefer fewer turns and adequate parallel spacing.
  5. Minimize route length and unnecessary changes from the previous route.

### 2. Improve route deconfliction

- Extend route scoring in `crates/diagram-engine/src/routing.rs` and keep
  matching TypeScript behavior in `src/core/routing.ts`.
- Reserve an endpoint lead-in zone for each connector. Do not put bends, jumps,
  or another connector through marker/crow's-foot clearance.
- Allocate distinct parallel lanes where space permits; penalize coincident
  segments more strongly than simple crossings.
- Keep bridge generation conservative: suppress jumps near endpoints, bends,
  markers, and multi-edge junctions.
- Route edges in a stable order and include previously routed paths in
  occupancy scoring. Use a bounded refinement pass if rerouting can reduce
  conflicts without oscillation.
- Validate every returned path before rendering. If WASM produces no usable
  route, fall back to TypeScript; never emit a diagonal or table-interior
  segment as a side effect of optimization.

### 3. Add connection-aware ERD placement

- Build a weighted table graph from FK edges and field-anchor metadata. Weight
  relationships without changing their semantics; account for parallel
  relationships between the same pair of tables.
- Seed positions using the existing ERD layout, then perform deterministic,
  bounded local improvements such as swapping peers within a layer and nudging
  connected tables to reduce edge crossings and route detours.
- Optimize a combined objective: route conflicts/crossings first, then turns
  and path length, then page area and displacement from the starting layout.
- Keep locked/pinned tables fixed and prevent moved tables from colliding.
  Unconnected tables and non-entity page objects remain unchanged.
- Return proposed positions and routing results without mutating the document;
  apply them through the existing undoable layout command only after the
  operation completes successfully.

### 4. Run expensive optimization through the existing WASM boundary

- Batch graph/layout inputs rather than crossing the JS/WASM boundary for
  individual score terms.
- Run the full optimization in the layout worker where practical; retain a
  deterministic TypeScript fallback for browsers without WASM and for tests.
- Bound iterations and expose cancellation/stale-document checks so an old
  optimization cannot overwrite edits made while it was running.
- Keep normal viewport routing responsive; do not turn each pointer movement
  into a global layout optimization.

### 5. Expose and explain the action

- Add **Optimize ERD layout** to the existing ERD arrange/layout controls and
  command entry points.
- Make clear that this is an explicit operation that may move unlocked tables.
- Return a useful no-op/result state when all eligible tables are pinned or
  when the graph cannot be improved.
- Preserve existing generic layout modes and behavior for non-ERD diagrams.

## Likely implementation areas

- `crates/diagram-engine/src/routing.rs` and `crates/diagram-engine/src/lib.rs`
- `src/core/routing.ts` and `src/core/routingWasm.ts`
- `src/core/layout.ts` and `src/core/layout.test.ts`
- `src/workers/layout.worker.ts` and `src/spatial/layoutClient.ts` (or a
  dedicated layout client if routing/layout responsibilities need separation)
- `src/store/editorStore.ts` and the existing layout command in
  `src/core/commands.ts`
- `src/components/PropertiesPanel.tsx` / `src/components/EditorScreen.tsx` for
  the explicit action
- Rust, TypeScript, and Playwright tests for route quality, undo/redo, and the
  ERD workflow

## Validation and acceptance criteria

- All resulting connector segments remain orthogonal and avoid non-endpoint
  table interiors.
- Endpoint stubs and crow's-foot markers have visible clearance; no jump or
  bend is placed in their protected area.
- The crowded fixture and saved ERD show fewer overlapping/shared segments and
  fewer crowded turns than baseline, without a material increase in total
  route length or page area. Record the metrics and screenshots for review.
- When crossings are unavoidable, bridge rendering is unambiguous and does not
  create malformed jumps at junctions.
- Optimization is deterministic for the same document, options, and pinned set.
- Locked/pinned table positions, manual routes, waypoints, and relationship
  metadata are preserved.
- The operation is one undoable command; undo restores exact positions and
  redo reapplies them.
- WASM and TypeScript fallback paths pass the same route/layout regression
  cases.
- Existing routing, layout, persistence/export, and document-validation tests
  continue to pass; the saved ERD remains valid and saved after browser-level
  verification.

## Rollout order

1. Add metrics and fixtures; establish before/after screenshot review.
2. Improve endpoint clearance, route lanes, and bridge suppression.
3. Implement and test the pure connection-aware placement optimizer.
4. Integrate bounded WASM/worker execution and fallback behavior.
5. Add the explicit UI command, undo/redo coverage, and end-to-end ERD check.
6. Re-run the optimizer on a copy of the saved ERD; only replace the saved
   layout after visual review confirms the improvement.
