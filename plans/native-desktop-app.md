# Native desktop app and disk-backed persistence

**Status:** Proposed

## Objective

Ship an installable, offline-first AperGlyph desktop application that stores
documents, recovery data, snapshots, and templates on disk through Rust rather
than IndexedDB. Preserve the existing editor, document format, and web app.

The desktop app must not depend on browser storage for durable user data.

## Important performance distinction

IndexedDB is a suspected contributor to hangs, not a confirmed root cause.
Its asynchronous transactions do not eliminate main-thread serialization,
cloning, rendering, and geometry work around persistence.

Current source shows several other candidates:

- `AutosaveController.schedule()` clones the full document on every change.
- Recovery and normal saves perform additional document cloning.
- Every normal autosave generates an SVG thumbnail through `documentToSvg()`;
  this may repeat expensive route/export calculations on the UI thread.
- Document listing loads and migrates complete document payloads.
- Snapshot listing/pruning can read all stored snapshots.
- Routing WASM currently runs synchronously when called from canvas routing;
  WASM itself does not mean work is off the UI thread.

The desktop work therefore includes measuring and separating these costs. Do
not promise that switching databases alone eliminates freezes.

## Architecture decision

Use **Tauri 2 with a Rust backend**, reusing the React/Vite editor.

- Native shell: windows, menus, file dialogs, OS file associations, and app
  lifecycle integration.
- Native persistence: SQLite accessed only by Rust, on a dedicated persistence
  worker/thread with serialized writes and asynchronous frontend requests.
- Editor: reuse the existing document model, commands, canvas, and plugins.
- Geometry: retain WASM/worker routing for the shared frontend initially; use
  native `diagram-engine` calls for expensive batched desktop jobs where
  profiling justifies the IPC cost.
- Web distribution: keep IndexedDB behind a separate storage adapter.

This is a native desktop package with a webview-based editor, not a rewrite of
the canvas into native widgets. Electron adds unnecessary runtime size for the
current Rust-based project; a complete native-UI rewrite is out of scope.

## Persistence design

### One authoritative desktop workspace

- Place a versioned SQLite database in the OS application-data directory, not
  alongside the installed executable or in the source repository.
- Store documents, document metadata, recovery records, snapshots, templates,
  session state, and preferences through the native backend.
- Separate lightweight document summaries from full document bodies; gallery
  listing must not deserialize every diagram.
- Store thumbnails separately, with a document revision tag. Generate them
  lazily and less frequently than document saves.
- Use transactions, schema migrations, foreign keys, and indexes for document
  ID, modification time, trash status, and snapshot retention queries.
- Evaluate WAL mode and an explicit durability policy with crash tests. A save
  acknowledgement must correspond to a committed transaction, not a queued job.
- Keep recovery data per document rather than one global active-recovery slot.
- Retain bounded snapshots and trash/restore behavior.

### Portable diagram files

- Keep `.wdiag` import/export compatible with the web app.
- Provide native Open, Save As/export, and workspace backup dialogs.
- Initially the database is authoritative; exported files are copies, and the
  UI must not imply that autosave also updates an exported file.
- Treat continuous editing of external `.wdiag` files as a separately scoped
  follow-up requiring file conflict detection and an explicit source-of-truth
  policy.
- Write exported files via a temporary sibling file and an OS-appropriate
  atomic replacement strategy. Test replacement and crash behavior on Windows.
- Back up SQLite using its backup facilities or a consistent export, never by
  naively copying a live database while ignoring its WAL.

### Storage boundary

Introduce a backend-neutral asynchronous persistence contract under
`src/persistence/`:

- Document summaries, load/save, rename, duplicate, favorite, trash/restore.
- Snapshots/checkpoints, recovery, retention, and workspace backup/restore.
- Templates, preferences, and session restoration.
- Storage health, structured failures, and durability acknowledgements.

Choose the adapter explicitly at startup: native backend in desktop builds,
IndexedDB in web builds, and an in-memory adapter in tests. Remove direct
IndexedDB imports from shared consumers such as autosave. If desktop storage
fails, show an actionable error; never silently switch to browser or volatile
storage and report success.

## Save scheduling and responsiveness

- Track pending revisions without cloning the entire diagram on every event;
  verify the store's immutable-update guarantees before retaining references.
- Serialize at the debounced save boundary and measure frontend IPC overhead.
- Allow at most one in-flight write per document and coalesce pending changes
  to the latest revision. Never let an older save overwrite a newer revision.
- Acknowledge saves by document ID and revision. Only clear dirty/recovery state
  for the acknowledged revision; edits made during a save remain pending.
- Decouple thumbnail generation, snapshots, and retention cleanup from the
  critical save acknowledgement.
- Move expensive geometry/thumbnail work out of the main thread where practical;
  simply placing database writes in Rust does not move React or export work.
- Define a bounded close/quit flow: flush pending saves, wait for native commit,
  and offer retry/export/cancel on failure. Do not rely on `beforeunload` for
  successful asynchronous persistence.
- Reject stale background-job results after document switches or later edits.

## Browser-to-desktop migration

The desktop webview cannot automatically read IndexedDB from an existing
Chrome/Edge browser origin. Migration must be explicit:

1. Export a workspace backup from the existing web app, or export individual
   `.wdiag` files.
2. Import through a native dialog; validate size limits, schema, and documents.
3. Preview import counts and collisions; offer merge/replace with confirmation.
4. Restore transactionally and verify documents, snapshots, templates, metadata,
   and recovery information supported by the backup format.
5. Report unsupported/skipped fields instead of silently losing them.
6. Keep the browser workspace and original backup untouched until the user has
   verified the desktop workspace. Never delete browser storage automatically.

## Desktop integration and security

- Windows first; evaluate macOS/Linux packaging after the Windows release gates.
- Add `src-tauri/` to the Cargo workspace and reuse `crates/diagram-engine`.
- Bundle frontend assets locally; disable service-worker registration and the
  web update flow in desktop builds.
- Add application menus, standard shortcuts, file-open handling, and window
  state restoration. Start with one workspace-owning application instance;
  forward subsequent file-open requests to it.
- Use narrow Tauri capabilities and typed commands. Avoid arbitrary filesystem
  paths, shell execution, remote navigation, and generic SQL exposure.
- Restrict file access to app-managed storage or explicit user-selected files;
  validate imported content and use a restrictive content security policy.
- Keep MCP pairing secrets out of the database backups and repository. Review
  desktop bridge/origin permissions before enabling editor automation there.
- Configure installer signing and a separate signed desktop update process;
  keep manual/offline installation supported.

## Delivery phases

### 1. Measure the current hangs

- Instrument edit-to-save timing, cloning, thumbnail/export routing, main-thread
  long tasks, transaction latency, and memory growth.
- Reproduce with the 32-table/36-edge ERD and larger generated documents.
- Compare normal editing with thumbnail generation disabled and persistence
  stubbed in development. Use these comparisons for diagnosis, not as a
  production data-safety workaround.

### 2. Extract the persistence contract

- Define common types independently of `indexedDb.ts`.
- Migrate shared callers and add adapter contract tests.
- Preserve existing web workspace/import/export behavior.

### 3. Build the desktop shell and native backend

- Add Tauri development/build configuration and Rust SQLite persistence.
- Implement migrations, summaries, saves, recovery, snapshots, and templates.
- Make native initialization failure visible before editing begins.

### 4. Harden the save pipeline

- Add revision-safe write scheduling and background thumbnail generation.
- Implement close/quit flushing, disk-full handling, and crash recovery.
- Verify that desktop durable-data flows make no IndexedDB calls.

### 5. Add migration and native workflows

- Workspace backup import/export, `.wdiag` dialogs, file associations, menus,
  and session restoration.
- Test migration on a copy of the current workspace; do not overwrite it during
  development.

### 6. Package and verify

- Produce a Windows installer and test fresh install, upgrade, offline launch,
  database migration, and uninstall behavior that preserves user data by default.
- Add platform-specific CI and document backup/recovery locations.
- Compare responsiveness against the web baseline before claiming a hang fix.

## Test and release gates

- Native document editing, autosave, reopen, recovery, snapshots, templates,
  trash/restore, and backup round trips work with IndexedDB unavailable.
- Browser adapter behavior and existing `.wdiag` compatibility remain intact.
- Slow saves and rapid edits cannot reorder writes or incorrectly clear dirty
  state. Test document switching and closing during an in-flight write.
- Crash/forced-termination, disk-full, permission-denied, locked/corrupt database,
  and failed migration tests preserve the last committed data or provide a
  clear recovery path. No silent success or empty-workspace fallback.
- Native backend contract tests run in Rust; shared scheduling and adapter
  tests run in Vitest. Validate native dialogs/lifecycle with Tauri-compatible
  integration testing and manual Windows smoke tests, not Playwright alone.
- Repeated open/edit/close cycles do not grow memory or database size without
  bounds; snapshot/thumbnail retention is enforced.
- Profile the reference ERD and a documented large fixture on the same hardware.
  Target no persistence-induced UI task over 50 ms, responsive pan/zoom during
  saves, and visible save-state updates. Measure latency distributions and
  investigate any remaining routing/rendering stalls separately.

## Relationship to other plans

- `plans/erd-connection-aware-layout.md` addresses crowded connector geometry;
  native persistence does not replace that work.
- The existing local-first web/PWA roadmap remains supported. Desktop adds an
  alternative durable backend without introducing accounts or a server.
- This document plans the work only; it does not authorize moving or deleting
  existing user data or implementing the desktop application yet.
