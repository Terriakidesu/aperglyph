# Changelog

All notable changes to AperGlyph are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Rust/WASM geometry worker integration
- Spatial indexing and viewport virtualization
- Additional diagram plugins and export formats

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
