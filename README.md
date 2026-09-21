# AperGlyph

AperGlyph is an offline-first diagram studio for the open web. It supports general diagrams, flowcharts, ERDs, DFDs, and UML use-case diagrams without accounts, a backend, or cloud storage.

## Highlights

- SVG editing canvas with ports, resizing, text editing, routed connectors, waypoints, snapping, and alignment guides.
- Undoable page CRUD, copy/paste, duplicate, grouping, rotation, alignment, distribution, z-order, locking, and automatic layout.
- ERD primary/foreign keys, nullable fields, cardinality markers, and semantic diagnostics.
- IndexedDB documents and recovery snapshots with autosave.
- SVG, PNG, PDF, and `.wdiag` project export.
- RBush broad-phase spatial indexing in a Web Worker with Rust/WASM scoring and graph layout.
- Installable PWA with offline precaching, update prompts, and GitHub Pages base-path support.

## Development

```sh
npm install
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.128 --locked
npm run dev
```

`npm run dev` and `npm run build` generate the ignored `public/wasm` assets automatically. If WASM cannot load, the TypeScript implementation remains available as a compatibility fallback.

Useful commands:

```sh
npm run typecheck
npm test
npm run bench
npm run test:e2e
npm run build
cargo test --workspace
```

Playwright browsers are installed separately when needed:

```sh
npx playwright install chromium
```

## Deployment

For a root deployment, the default base path (`/`) is correct. For a GitHub Pages project site, set the base path while building:

```sh
VITE_BASE_PATH=/aperglyph/ npm run build
```

The included `.github/workflows/deploy-pages.yml` does this automatically using the repository name. WASM worker URLs, the PWA manifest, icons, and service-worker scope all use the configured base.

## Architecture

The document model is authoritative; SVG is presentation; IndexedDB is persistence. Spatial queries use this pipeline:

```text
React canvas → SpatialWorkerClient → RBush broad phase → Rust/WASM narrow/scoring work
```

Automatic graph layout uses the same worker boundary and returns positions to an undoable `LayoutNodesCommand`. The `.wdiag` format is JSON with explicit format and schema versions. Imported documents are validated for bounded strings, finite geometry, sensible dimensions, collection limits, duplicate IDs, and valid edge references before migration.

## Privacy

AperGlyph does not require an account and does not send diagrams to a server. Browser storage, downloads, and installed PWA caches remain on the device unless the user exports or moves a file themselves.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).
