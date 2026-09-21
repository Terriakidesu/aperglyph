# Contributing to AperGlyph

Thanks for helping improve AperGlyph. Keep changes focused, local-first, and compatible with the document model.

## Before opening a pull request

Run the relevant checks:

```sh
npm run typecheck
npm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run build
```

Run `npm run test:e2e` for UI changes. Install Chromium first with `npx playwright install chromium`.

## Design guidelines

- Treat `DiagramDocument` as the source of truth; do not persist rendered SVG.
- User-facing document mutations should be `DocumentCommand` operations so undo/redo remains coherent.
- Keep persistence browser-local and avoid adding network or account requirements.
- Validate imported data at the file boundary and keep migrations explicit.
- Preserve the RBush/Web Worker broad phase and use WASM for meaningful batched geometry or layout work.
- Add or update focused Vitest tests for core behavior and Playwright coverage for user workflows.

## Commits and pull requests

Use a concise imperative commit subject, describe user-visible behavior, and include test results. UI changes should include screenshots or a short interaction description when useful.
