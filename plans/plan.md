# AperGlyph roadmap after 0.10

This document supersedes the original linear Phase 1–16 implementation plan.
Those phases described the foundation that now exists in the repository. The
roadmap below starts from the current `0.10.x` editor and prioritizes workflow
speed, local data safety, semantic diagram features, and polish.

## Product direction

AperGlyph remains:

> **Local-first, offline-first, static-hostable, serverless, and account-free.**

The editor must remain fully usable without a backend, account, network, or
cloud storage. New features should improve the number of ideas a user can
express per click without introducing server dependencies.

The document model remains authoritative, SVG remains presentation, IndexedDB
remains local persistence, and the plugin registry remains the extension point
for diagram standards and shapes.

### Guardrails

- No server, authentication, account, telemetry requirement, or cloud storage.
- No artificial document, page, or object quota; report browser/device limits
  honestly instead.
- All edits remain undoable commands and all durable data remains local-first.
- Imported content is treated as untrusted and validated/sanitized.
- New plugin behavior belongs in a plugin, not in generic editor conditionals.
- Heavy geometry, spatial, routing, and layout work may use the existing
  worker/WASM boundary, but the UI must retain a TypeScript fallback.
- Cloud collaboration and synchronization stay optional post-1.0 ideas, never
  a prerequisite for using the editor.

## Completed architecture and current features

These capabilities are established in the current repository and should not be
listed as future work unless a follow-up enhancement is explicitly described
below.

### Editor foundation

- Document model and schema versioning
- SVG canvas
- Pan and zoom
- Selection and multi-selection
- Resize and rotation
- Inline text editing
- Undo and redo
- Copy, cut, paste, and duplicate
- Group and ungroup
- Alignment and distribution
- Z-order operations
- Locking
- Page create, delete, rename, duplicate, reorder, and settings
- Grid snapping and object snapping
- Alignment guides
- Context menus and keyboard shortcuts

### Connectors and geometry

- Connector ports and endpoint reconnection
- Anchor snapping across built-in and plugin shapes
- ERD field-row anchors
- Straight, curved, and orthogonal routing
- Waypoints and waypoint editing
- Obstacle-aware routing
- Connector jumps
- Endpoint and cardinality markers
- SVG/canvas marker direction consistency
- Connector labels and route/style editing

### Persistence and delivery

- IndexedDB document storage
- Debounced autosave
- Crash/recovery state
- Editor-session restoration
- Versioned `.wdiag` JSON import/export
- SVG, PNG, and PDF export
- Selection-aware/content-bounds export
- Installable PWA
- Offline application mode
- Update detection and save-before-reload handling
- GitHub Pages/static-host deployment
- Bounded import validation and migration handling

### Runtime and engineering

- Rust/WASM geometry/runtime crate
- Spatial worker with RBush broad phase and WASM narrow-phase support
- WASM graph layout with TypeScript fallback
- Plugin registry for General, Flowchart, ERD, DFD, and UML Use Case
- Hot-reloadable shape definitions
- Vitest unit tests and benchmarks
- Playwright browser workflows
- CI/CD
- README, changelog, licensing, and security documentation

## Priority and release rules

- **P0:** core workflow blocker or high-frequency operation; do first in the
  target release.
- **P1:** important quality-of-life improvement; schedule after the P0 path is
  reliable.
- **P2:** useful polish or advanced workflow; schedule only after the release
  acceptance criteria are met.

Each release should ship with unit coverage for document behavior, browser
coverage for the user workflow, migration/import coverage where relevant, and
no known data-loss path.

## v0.11 — Interaction QoL

**Goal:** make common editing operations fast enough that users rarely need to
hunt through panels.

### P0

- Arrow keys nudge the selection by 1 px.
- Shift + Arrow nudges by grid size, or 10 px when grid snapping is off.
- Shift while dragging constrains movement to the dominant X/Y axis.
- Shift while resizing preserves aspect ratio.
- Alt/Option-drag duplicates the selection.
- Escape exits a drag, resize, rotate, connector, text, or menu operation
  cleanly.
- Equal-spacing commands work for horizontal and vertical selections.
- Resize handles are visually distinct from connector ports.
- Multi-selection exposes a common-property editor.
- Fit Selection, Fit Page, and 100% zoom are real viewport commands.
- Grid visibility can be toggled from the toolbar/status bar.
- Connecting shows a clear target preview and snap indication.
- Reset Connector Route restores automatic routing and clears manual waypoints.
- Icon-only controls have useful tooltips.
- The introductory canvas hint disappears after first use.
- Inspector section collapse state persists locally.

### P1/P2

- Alt/Option-resize from center.
- `F2` or Enter renames the selected object.
- Repeat last transform or duplicate spacing.
- Select all objects of the same type.
- Expand selection to connected objects.
- Lock/unlock the entire selection.
- Flip horizontally or vertically.
- Reset rotation.
- Replace a shape while preserving its connections.
- Match width, height, or complete size.
- Smart repeated duplication.
- Isolation mode and double-click-to-enter-group behavior.
- Breadcrumbs for nested group editing.
- Cleaner handles, movement delta, rotation-angle, and resize-dimension
  tooltips.
- Selection count in the status bar.

### Command palette

Add `Ctrl/Cmd + K` as the scalable command entry point. It should search
commands by name, show shortcuts, and execute actions such as:

```text
Add rectangle       Align center          Duplicate selection
Fit selection       Toggle grid           Export PNG
Add page            Auto layout           Open shortcuts
Switch library      Reset connector       Open diagnostics
```

Custom shortcuts, conflict detection, and command remapping are P2 follow-up
work, not prerequisites for the first palette.

### Acceptance

- A user can move, constrain, duplicate, rename, align, and route objects
  without opening a properties panel for routine operations.
- Continuous pointer movement produces one meaningful history entry.
- Fit Selection, Fit Page, 100% zoom, and grid toggle are test-covered.
- Escape cannot leave a half-created node, edge, or text editor behind.

## v0.12 — Navigation and workspace QoL

**Goal:** make medium and large diagrams and document collections manageable.

### Outline/layers panel

Provide an object outline that combines layer management, object finding, group
navigation, and z-order control:

```text
OUTLINE

▼ Page 1
  ▼ Group: Authentication
      □ Login
      □ Validate User
      ◇ Valid?
      ─ success
      ─ failure
```

Support click-to-select, double-click rename, hide/show, lock/unlock, drag
reorder, search/filter, and group hierarchy expansion.

### Canvas navigation

- Zoom to selected object and zoom presets
- Minimap
- Rulers
- Drag-created guides from rulers
- Custom guide deletion and locking
- Background color quick control
- Fullscreen editing and focus mode that hides panels
- Presentation/preview mode
- Persist panel state and preferred zoom behavior
- Named canvas bookmarks/views as P2

### Workspace and templates

- Actual local document thumbnails
- Favorite/pin documents
- Sort by name, date, and diagram type
- Filter by diagram type
- Duplicate and rename from the home screen
- Trash/recycle bin with restore
- Drag `.wdiag` onto the home screen
- Template browser
- Save a page/document as a local template
- Local user templates, categories, and favorites
- Recent templates

### Acceptance

- A user can find and focus any labeled object without visually locating it on
  the canvas.
- A document with hundreds of objects remains navigable through the outline,
  search, minimap, and zoom-to-object workflow.
- Home-screen thumbnails, sorting, favorites, and trash survive reloads.

## v0.13 — Styling system

**Goal:** produce professional-looking diagrams without repetitive manual
formatting.

### Visual controls

- Full color picker
- Recent colors
- Document-level palette
- Stroke width
- Opacity
- Corner radius
- Text size and font weight
- Horizontal and vertical text alignment
- Text wrapping
- Automatic node height for wrapped text
- Independent light/dark canvas themes

### Reusable formatting

- Format Painter
- Copy style and paste style
- Reset formatting
- Reusable style presets
- Apply style to all objects of the same type
- Multi-selection style editing through the common-property inspector

### Acceptance

- Shared style properties can be edited for a selection without overwriting
  unrelated values.
- Wrapped text does not clip and node height updates predictably.
- Copy/paste style and reset formatting are undoable and persist locally.

## v0.14 — Connector and container upgrade

**Goal:** reduce the number of steps needed to construct and maintain diagrams.

### Connectors

- Drag a connector into empty space to quick-create a shape.
- Show a hover target preview while connecting.
- Stronger endpoint snap indication.
- Reverse connector direction.
- Swap start/end markers.
- Reset routing and reset all waypoints.
- Double-click a segment to add a waypoint.
- Double-click a waypoint to remove it.
- Auto/manual routing toggle.
- Parallel connector separation.
- Self-loop connectors.
- Connector hover highlights both endpoints.
- Draggable connector labels.
- Multiple labels as a P2 capability.
- Label background/halo and position presets.
- Line-jump style selector.
- Route locking as a P2 capability.
- Trace connected objects as a P2 capability.

Quick-create should offer the shape library and search directly at the empty
endpoint:

```text
Selected node ── drag connector ──► empty canvas
                                  ├ Process
                                  ├ Decision
                                  ├ Rectangle
                                  └ Search…
```

The selected shape is created and connected in one undoable operation.

### Generic containers

Add reusable containers, frames, tables, images, icons, notes, sticky notes,
callouts, sections, headers, swimlane-like containers, hyperlinks, page links,
and object metadata. Containers should optionally own their children so moving
or resizing a container can move or auto-resize its contents.

This generic behavior should also support UML boundaries, schemas, systems,
swimlanes, and future architecture diagrams.

### Acceptance

- A connector can create and connect a new shape without returning to the
  library.
- Route reset, waypoint add/remove, marker swap, and label movement are
  undoable.
- Containers have explicit ownership semantics and cannot accidentally absorb
  unrelated objects.

## v0.15 — Local-first reliability

**Goal:** make a no-cloud editor safe enough for serious work.

### Local history and snapshots

- Bounded local version snapshots
- Manual checkpoints with user names
- Restore a previous snapshot
- Configurable snapshot limit
- Combine continuous edits into one history entry

Suggested defaults:

```text
Hourly snapshots: last 24 hours
Daily snapshots:  last 7 days
Manual checkpoints: user controlled
```

### Workspace backup

Add a first-class home-screen backup/restore flow:

```text
Backup & Restore

Export workspace backup
Import workspace backup

Documents: 27
Storage: 18.4 MB
Last backup: 8 days ago
```

The initial backup can be a client-generated archive containing documents,
templates, preferences, and thumbnails. Export all diagrams and restore the
full workspace must be P0 for this release.

### Browser storage and files

- Storage usage details
- Persistent-storage status and request flow
- Browser quota warning before pressure causes failures
- Backup reminder
- File System Access API integration where supported:
  - Open from disk
  - Save
  - Save As
  - Remember a previously opened file handle
- Harden `pagehide` and visibility lifecycle persistence.

### `.wdiag` evolution

Keep old JSON `.wdiag` files importable. When assets are introduced, migrate
the format toward a container such as:

```text
diagram.wdiag
├── document.json
├── metadata.json
├── thumbnail.webp
└── assets/
```

Use explicit format versions and migrations rather than breaking existing
documents.

### Acceptance

- A user can export and restore the complete local workspace without a server.
- Snapshot limits are bounded and visible.
- Quota/storage failures produce actionable UI instead of silent data loss.
- Existing JSON `.wdiag` files still open after the container migration work.

## v0.16 — Semantic diagram upgrade

**Goal:** make the built-in diagram modules more useful without leaking their
rules into the generic editor.

### ERD

- Drag to reorder attributes
- Keyboard row navigation: Enter next field, Tab next column, Shift+Tab previous
- Paste multiple fields, for example:

  ```text
  id uuid PK
  customer_id uuid FK
  created_at timestamp
  ```

- Default value and description fields
- Composite primary keys
- Index definitions
- Explicit FK reference targets
- Referential actions: CASCADE, RESTRICT, SET NULL, NO ACTION
- Auto-create a relationship from an FK
- Auto-create an FK from a relationship
- Relationship optionality validation
- Duplicate table
- Schema/container support
- SQL import and SQL export

### DFD

- Process numbering (`1.0`, `2.0`, `3.0`)
- Context, Level 0, Level 1, and Level 2 pages
- Decompose a process into a new child DFD page
- Parent-process to child-page linking
- Balance checking
- Input/output consistency
- Data dictionary
- Data-store numbering
- External-entity consistency
- Deeper validation for invalid source/target combinations, unlabeled flows,
  processes without input/output, and isolated objects

The primary decomposition workflow is:

```text
Right-click Process 2.0
        ↓
Create child DFD
        ↓
New Page: Process 2.0
        ↓
Parent process links to that page
```

### UML Use Case

- Actor, use case, system boundary, package, and note shapes
- Association, `«include»`, `«extend»`, and generalization relationships
- Actor and use-case generalization
- Automatic stereotype labels
- Containment behavior and system-boundary auto-resize
- Package containment
- Validation for include/extend direction, actors inside boundaries, invalid
  relationships, and disconnected use cases

Selecting an `«include»` or `«extend»` relationship should configure the dashed
style and stereotype automatically.

### Flowchart

- Swimlanes, containers, subprocesses, and page-linked subprocesses
- Decision quick labels: Yes/No, True/False, or custom
- Automatic branch-label placement
- Step numbering
- Off-page links
- Start/end validation
- Unreachable-node detection
- Flow-direction checking

Creating a branch from a decision should offer automatic `Yes` and `No`
labels.

## v0.17 — Validation and diagnostics

**Goal:** provide one discoverable place to find and repair semantic problems.

Create a centralized diagnostics panel:

```text
DIAGNOSTICS
────────────────────

2 Errors
5 Warnings

ERD
! customer_id references missing entity
! Duplicate attribute "email"

DFD
! Data flow has no label

UML
! Actor placed inside system boundary
```

Required behavior:

- Click a diagnostic to locate/focus the problem object.
- Double-click to select it.
- Quick fixes where safe.
- Ignore/suppress a selected warning.
- Filter by severity, plugin, and page.
- Validate the current page or whole document.
- Show error/warning counts in the status bar.
- Provide a beginner-friendly validation toggle.

The plugin contract should support the equivalent of:

```ts
validate(document): Diagnostic[]
quickFix(diagnostic): Command | null
```

## v0.18 — Layout and performance upgrade

**Goal:** deepen the existing Rust/WASM engine and make large local documents
predictable rather than replacing the current architecture.

### Candidate engine work

- Segment intersection
- Exact hit testing
- Snap scoring
- Route simplification
- Obstacle graph generation
- Orthogonal routing
- Graph ordering and crossing minimization
- Layout compaction
- Batched worker mutations
- Incremental route recalculation
- Incremental layout
- Edge viewport virtualization
- Lazy thumbnail generation
- Progressive large-file loading
- Memory-pressure warnings
- Development performance HUD

### Layout modes

- Hierarchical
- Tree
- DAG
- Compact
- Grid
- Radial
- ERD-specific
- Flowchart-specific

Benchmark real editor workloads, not only isolated functions:

```text
1K objects   10K objects   25K objects   50K objects
```

Measure load, initial render, pan/zoom, drag, selection, routing, autosave,
worker latency, and memory consumption.

### Acceptance

- Normal editing and pan/zoom remain responsive on representative documents.
- Large layout/routing work stays off the main thread.
- Benchmarks identify regressions before they are shipped.
- Incremental updates avoid rebuilding complete indexes for one moved object.

## v0.19 — Accessibility and device support

**Goal:** make editing reliable for keyboard, touch, pen, and assistive
technology users.

- Complete keyboard-only editing
- Predictable focus order
- Proper ARIA labels and roles
- Focus-visible treatment
- High-contrast mode
- Reduced-motion mode
- Color-blind-friendly palettes
- Adjustable UI scaling
- Optional larger touch handles
- Pinch zoom
- Two-finger pan
- Long-press context menu
- Touch-friendly inspector controls
- Pen support as P2

Test at minimum on Chrome, Edge, Firefox, Safari, Android tablet, and iPad.

## v0.20 — Interoperability

**Goal:** make local documents useful outside AperGlyph while keeping every
operation client-side.

### Import

- Drag files directly into the editor
- Safe SVG import
- Image import
- JSON debug import/export
- Mermaid import/export
- PlantUML import/export where applicable
- draw.io interoperability as a deliberately bounded P2 project

### Export

- Copy selection as PNG
- Copy selection as SVG
- Export padding control
- Width/height or DPI control
- Export preview
- Print
- True vector PDF
- Standalone SVG with embedded assets
- ZIP/all-pages export

## v0.21+ — Additional diagram plugins

Use the existing plugin architecture and prioritize modules in this order:

```text
UML Class
    ↓
UML Activity
    ↓
BPMN
    ↓
UML Sequence
    ↓
Mind Map
    ↓
Org Chart
    ↓
Network Diagram
    ↓
Wireframe
    ↓
AWS / Azure / GCP architecture
```

UML Class is the first priority because its attributes, relationships, and
containers overlap with the existing ERD machinery.

The following remain local-only extension ideas unless a future project
decision explicitly changes the product boundary:

- Custom local plugin loading
- Third-party stencil packs
- Local theme/stencil sharing
- Advanced vector-path editor
- Freehand drawing
- Presentation transitions and animation

## v1.0 — Stable release candidate

Version 1.0 is about reliability and a coherent supported surface, not another
large feature dump.

### Release gates

- No obvious dead controls or unfinished primary workflows
- No known data-loss bugs
- Reliable autosave, recovery, snapshot, and workspace restore behavior
- Migration tests and corrupted-file handling
- Stable `.wdiag` specification and migration documentation
- Complete keyboard workflow and accessibility pass
- Tablet usability pass
- Browser compatibility pass
- Stable General, Flowchart, ERD, DFD, and UML Use Case modules
- Reliable SVG, PNG, PDF, print, and `.wdiag` workflows
- Verified performance targets
- Complete user/developer documentation and licensing information

### Performance targets

| Scenario | Target |
| --- | --- |
| Normal editing | 60 FPS where practical |
| Pan/zoom | Approximately 60 FPS |
| Dragging | No obvious frame drops |
| Input response | Less than 50 ms perceived |
| Main-thread long tasks | Avoid work over 50 ms |
| 1,000 objects | Effortless normal editing |
| 10,000 objects | Smooth with virtualization/incremental work |
| 50,000 objects | Stress-test target with documented limits |
| Large layout operations | Worker-only |

## Detailed deferred QoL backlog

The release sections contain the committed sequence. The following backlog is
the source pool for future P1/P2 planning and should not be mistaken for work
already scheduled in a release.

### Editing and selection

- Repeat transforms, same-style selection, invert selection, connected-object
  expansion, group isolation, nested-group breadcrumbs
- Whole-selection lock/unlock, flip, reset rotation, coordinate/size rounding
- Shape replacement preserving connections
- Match width/height/size and smart repeated duplication
- Smaller handles, movement/rotation/resize tooltips, selection count
- Common-property multi-selection editor

### Canvas and navigation

- Zoom presets, minimap, rulers, ruler guides, named views/bookmarks
- Guide deletion/locking, dot/line/no-grid modes, quick background control
- Fullscreen, focus, presentation/preview modes
- Persist panel and preferred zoom state

### Shapes and libraries

- Favorites and recently used shapes
- Fuzzy search, aliases, tags, and keyboard-only insertion
- Persist collapsed sections
- Show/hide libraries and pin categories
- Hover previews
- Default styles per shape type
- User-created presets
- Local stencil libraries
- Safe SVG shape import
- Replace selected shape from the library

### Connectors

- Lock manual routes, trace connected objects, multiple labels
- Label halos/backgrounds and position presets
- Line-jump styles
- Parallel-edge separation, self-loops, endpoint hover highlighting
- Reverse direction and marker swapping
- Auto/manual routing mode

### Styling

- Full picker, recent colors, document palette
- Stroke width, opacity, radius, text size/weight/alignment/wrapping
- Format painter, style copy/paste, reset, reusable presets
- Apply styles to same object type
- UI theme independent from canvas theme

### Pages, workspace, and templates

- Page thumbnails and drag-to-reorder tabs
- Orientation presets: A4, Letter, 16:9, custom
- Fixed-page/infinite-canvas modes
- Page search and off-page links
- Duplicate page shortcut
- Workspace folders/categories
- Bulk `.wdiag` import
- Storage usage and persistent-storage status
- Backup reminders
- Template favorites, recent templates, and categories

### History, import, export, and validation

- History panel with chronological command labels
- Named checkpoints and checkpoint restore
- Copy-selection image/vector workflows
- Export preview, DPI/size controls, padding, print, vector PDF
- Safe SVG/image import, JSON debug tools, interop formats
- Dedicated diagnostics, click-to-focus, counts, quick fixes, suppression,
  page/document validation

### Accessibility, UI, and help

- High contrast, reduced motion, color-blind palettes, UI scaling
- Larger touch controls and pen support
- Light theme and system theme
- Persistent hint dismissal
- Toasts for save/export/import failures
- Undo toast after deletion
- Searchable settings and shortcut reference
- Restore UI defaults
- First-run onboarding and interactive tutorial
- Contextual help and “What’s new” after upgrades

## Post-1.0 optional cloud layer

Cloud functionality is deliberately outside the path to 1.0 and must remain
optional. If it is ever introduced, it may provide accounts, synchronization,
shared links, comments, multiplayer, and server-side version sync, but the
local/offline editor and local file formats must continue to work independently.
