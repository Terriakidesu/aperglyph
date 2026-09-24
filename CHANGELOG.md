# Changelog

All notable changes to AperGlyph are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Added searchable shape metadata with aliases, semantic roles, notation tags, categories, and category-aware common-first library groups.
- Added shared silhouette primitives for common polygons, documents, storage symbols, clouds, packages, folded notes, and flowchart operations across canvas, previews, hit testing, and SVG export.
- Expanded the General, Flowchart, ERD, DFD, and UML use-case libraries with common-first symbols, aliases, semantic roles, relationship presets, and notation-aware metadata.
- Added metadata-driven Yourdon/DeMarco and Gane/Sarson DFD shape variants without changing process, external-entity, or data-store semantic node types.
- Added an undoable DFD page inspector with level/decomposition context and editable data-dictionary entries, including flow-name consistency diagnostics.
- Added duplicate and blank data-dictionary validation so DFD documentation remains unambiguous.
- Added free-space-aware automatic self-loop side selection and explicit crossing priorities so selected or prioritized connectors remain visually continuous.
- Added Auto/Simple/Manual orthogonal modes, hard/soft route constraints, draggable segment handles, minimum-segment normalization, and optional rounded orthogonal corners shared by canvas and SVG export.
- Added sparse rectilinear visibility-graph routing with deterministic parallel lanes, bend/crossing/overlap/proximity costs, soft connector awareness, and previous-route stability preferences.
- Added authoritative orthogonal port directions, separate node-clearance and port-stub geometry, terminal marker clearance, and persisted route intent/constraint metadata.
- Integrated the Rust/WASM geometry crate into the spatial worker's viewport and nearby-query narrow phase.
- Added a reproducible `npm run build:wasm` pipeline and automatic WASM generation before development and production builds.
- Added undoable page creation, deletion, renaming, duplication, reordering, and settings updates.
- Added copy, cut, paste, duplicate, grouping, rotation, alignment, distribution, z-order, select-all, and lock enforcement.
- Added PNG and PDF export alongside SVG and `.wdiag`, including content-bounds and selection-aware image export.
- Added Rust/WASM graph layout in a dedicated worker with a TypeScript fallback, plus grid, tree, and hierarchy layout commands.
- Added standard flowchart symbols, Playwright workflows, Vitest performance benchmarks, CI, GitHub Pages deployment, and project documentation.
- Added install/offline/update PWA lifecycle UX and bounded `.wdiag` import validation.
- Added validated system clipboard integration for copy, cut, and paste with an in-memory fallback.
- Added correctly oriented straight/curved arrowheads, draggable/reconnectable connector endpoints, connector reset defaults, and editor-session restoration after reload.
- Added searchable shape-library groups with favorites, recents, center insertion, drag/drop previews, and shared preview/final geometry.
- Added connector quick-create, self-loops, parallel routing, waypoints, draggable labels, marker/routing controls, line jumps, and semantic plugin connector routing.
- Added explicit nested container ownership with Outline hierarchy controls, cycle validation, safe child movement, and ownership recovery when a container is deleted.
- Added bounded local snapshots, named checkpoints, configurable retention, recovery timestamp preservation, and versioned full-workspace backup/restore.
- Added richer ERD field metadata/paste tools, DFD process numbering checks, and UML use-case/package validation and relationship shapes.

### Changed
- Promoted common selection actions—fit, duplicate, group, lock, and delete—to a centered top-bar Quick actions cluster with selection-aware states.
- Improved touchpad navigation: two-finger scrolling pans the canvas, pinch/Ctrl+scroll zooms around the pointer, and high-frequency wheel events are batched for smoother movement.
- Improved editor control discoverability with explicit active-tool status, clearer snapping/grid states, keyboard-accessible panel resizing, consistent pan guidance, and dismissible page/zoom/snap menus.
- Orthogonal routing now preserves semantic endpoint intent while keeping generated routes runtime-only and export-compatible.

- Kept RBush as the broad-phase spatial index while using Rust for batched rectangle scoring and graph layout, with TypeScript fallbacks when WASM cannot load.
- Added configurable Vite base-path handling for root and GitHub Pages project deployments.
- Upgraded the Vitest benchmark/test toolchain to the patched v5 API with zero reported npm audit vulnerabilities.

### Fixed

- Fixed a stack overflow when changing a straight or curved connector to orthogonal routing while route-stability scoring inspected its diagonal path.
- Kept inline text editing reliable after selection renders expand the shape library and inspector workload.
- Prevented rotated explicit ports from introducing diagonal first segments and penalized immediate route reversals during search.

## [0.13.0] - 2026-09-22

### Added

- Added a persisted styling system with color pickers, recent colors, document palettes, stroke width, opacity, corner radius, text size, weight, alignment, wrapping, and automatic wrapped-label height.
- Added independent light/dark canvas themes with per-page background and grid presentation controls.
- Added undoable format painter, style copy/paste, formatting reset, same-type style application, reusable style presets, and mixed-value multi-selection editing.

### Changed

- Extended SVG and canvas rendering to use the shared text layout and style models, including connector opacity and styled labels.
- Migrated legacy documents into the new style, palette, preset, and canvas-theme defaults without changing the schema version.

## [0.12.0] - 2026-09-22

### Added

- Added the searchable Outline panel with click selection, inline renaming, group expansion, hide/show, lock/unlock, and drag-based object reordering.
- Added minimap navigation, rulers, draggable and lockable guides, guide deletion, canvas background control, and persisted per-document/page viewport state.
- Added focus, fullscreen, and presentation modes with persisted workspace panel preferences.
- Added local document thumbnails, favorites, sorting and diagram-type filtering, rename/duplicate actions, drag-and-drop project opening, and a trash with restore or permanent deletion.
- Added locally persisted custom templates and a command-palette action for saving the current document as a template.

### Changed

- Hidden objects are excluded from canvas navigation and selection queries while remaining available in the Outline for recovery.

## [0.11.0] - 2026-09-21

### Added

- Added one-pixel and grid-step keyboard nudging, axis-constrained movement, aspect-ratio-preserving resize, and Alt-drag duplication.
- Added clean Escape cancellation for active canvas interactions and persistent canvas-hint dismissal.
- Added equal-gap distribution for differently sized selections and common multi-selection property editing.
- Added Fit Selection, Fit Page, 100% zoom, grid controls, connector target previews, distinct ports and resize handles, and persistent Inspector sections.
- Added the Ctrl/Cmd+K command palette for common viewport, selection, page, layout, and help actions.

### Changed

- Added tooltips and accessible labels to icon-only interaction controls.

## [0.10.1] - 2026-09-21

### Fixed

- Corrected combined ERD cardinality markers so bars/circles stay toward the connector and Crow's Foot prongs face the entity.

## [0.10.0] - 2026-09-21

### Added

- Added a semantic DFD validation module for process, external-entity, and data-store roles.
- Added warnings for direct External Entity ↔ Data Store flows, unlabeled flows, isolated elements, and self-connections.
- Added DFD semantic guidance and diagnostics to the Inspector.
- Updated the DFD template to use anchored orthogonal data-flow connectors.
- Updated ERD entities to standard table notation with PK/FK key columns, typed attributes, associative-table borders, and Crow’s Foot cardinality.
- Updated DFD symbols to standard process bubbles, external-entity rectangles, and data-store parallel lines.
- Updated UML use cases to render as standard ellipses while retaining stick-figure actors and system boundaries.
- Added corner resizing, double-click text editing, selected-node connection ports, canvas context menus, and stable orthogonal waypoint editing.
- ERD entities now auto-fit vertically when attributes are added or removed.

### Fixed

- Corrected Crow’s Foot orientation so relationship prongs face the entity, and migrated legacy ERD arrow defaults to relationship markers.
- Prevented orthogonal fallback routes from degrading into diagonal segments when obstacles block the preferred dogleg.

## [0.9.0] - 2026-09-21

### Added

- Added semantic ERD entity attributes with primary/foreign-key, uniqueness, nullability, validation, and striped-row display controls.
- Added selectable connector objects with undoable endpoint, port, routing, label, style, marker, waypoint, and delete editing.
- Added cardinality marker presets including bars, circles, and Crow's Foot combinations for every diagram type.
- Added draggable orthogonal waypoints and obstacle-aware routing around node bounds.
- Anchored new and migrated orthogonal connectors to stable node ports.

### Fixed

- Prevented text inside shapes from becoming browser-selected or dragging independently of its parent shape.
- Corrected pan/camera coordinate math so the canvas follows the pointer and partially visible nodes remain rendered.
- Made the Inspector scrollable for complete connector editing controls.

## [0.8.0] - 2026-09-21

### Added

- Added a framework-independent `DiagramPlugin` contract.
- Added a plugin manager with built-in General, Flowchart, ERD, DFD, and UML use-case modules.
- Moved shape definitions and connector definitions out of the React shape-library component.
- Added plugin registry tests and fallback behavior for future diagram standards.

## [0.7.0] - 2026-09-21

### Added

- Added a connector routing module shared by the editor and SVG exporter.
- Added true straight, curved, and orthogonal connector paths.
- Added waypoint-aware orthogonal routing.
- Added visible top, right, bottom, and left connection ports in Connector mode.
- Added explicit connector endpoint port persistence.
- Added start and end arrow markers to canvas and SVG export.

## [0.6.0] - 2026-09-21

### Added

- Added worker-assisted nearby-node candidate queries for dragging.
- Added object snapping to node edges and centers.
- Added alignment guide overlays during drag previews.
- Improved grid snapping for multi-selection moves by preserving relative spacing.

## [0.5.2] - 2026-09-21

### Fixed

- Made canvas panning track the pointer on a requestAnimationFrame boundary.
- Paused spatial culling queries during pan gestures to remove camera lag.
- Flushed the final camera position when a pan gesture ends.

## [0.5.1] - 2026-09-21

### Fixed

- Routed connectors to node boundaries instead of node centers.
- Added explicit top, right, bottom, left, center, and compass port support.
- Applied the same connector geometry to live previews and SVG export.

## [0.5.0] - 2026-09-21

### Added

- Added an R-tree spatial index running in a dedicated Web Worker.
- Added viewport and nearby-object query protocols with batched node bounds.
- Added overscanned SVG viewport culling for large documents.
- Added a resilient main-thread spatial fallback when workers are unavailable.
- Added packed Rust/WASM viewport rectangle query primitives.

## [0.4.2] - 2026-09-21

### Added

- Added this changelog.

## [0.4.1] - 2026-09-21

### Fixed

- Excluded Cargo `target/**` artifacts from the Vite watcher to prevent Windows `EBUSY` errors when Rust test binaries are locked.

## [0.4.0] - 2026-09-21

### Added

- Added IndexedDB-backed local document storage.
- Added debounced autosave and recovery snapshots.
- Added recent local diagrams to the workspace home screen.
- Added `.wdiag` import and export.
- Added client-side SVG export helpers.
- Added storage estimation and recovery controls.

## [0.3.0] - 2026-09-21

### Added

- Added the AperGlyph home workspace and editor shell.
- Added the SVG canvas with world-coordinate camera transforms.
- Added node selection, marquee selection, drag previews, and batch move commands.
- Added Space-to-pan, Hand tool, middle-mouse panning, wheel zoom, and grid snapping.
- Added generic, Flowchart, ERD, DFD, and UML use-case shape libraries.
- Added connector creation, properties inspection, pages, shortcuts, and responsive styling.
- Removed runtime dependence on external fonts and CDNs.

## [0.2.0] - 2026-09-21

### Added

- Added the versioned diagram document model.
- Added pages, nodes, edges, styles, endpoints, and viewport types.
- Added immutable document commands with undo and redo history.
- Added the typed editor event bus and Zustand editor store.
- Added document migrations and native project serialization.
- Added the initial Rust geometry crate with WASM-bindgen exports.

## [0.1.0] - 2026-09-21

### Added

- Added the TypeScript/Vite/React application foundation.
- Added PWA manifest and Workbox asset precaching.
- Added the Rust workspace and `aperglyph-diagram-engine` crate.
- Added local PWA icons and static-hosting-ready configuration.
