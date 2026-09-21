import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const target = 'wasm32-unknown-unknown';
const packageName = 'aperglyph-diagram-engine';
const wasmInput = join(root, 'target', target, 'release', 'aperglyph_diagram_engine.wasm');
const output = join(root, 'public', 'wasm');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
}

try {
  run('cargo', ['build', '-p', packageName, '--release', '--target', target]);
  if (!existsSync(wasmInput)) throw new Error(`Rust did not produce ${wasmInput}`);

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  run('wasm-bindgen', [wasmInput, '--target', 'web', '--out-dir', output, '--out-name', 'aperglyph_diagram_engine']);
} catch (error) {
  console.error('\nUnable to build AperGlyph WASM. Install the required tools with:');
  console.error('  rustup target add wasm32-unknown-unknown');
  console.error('  cargo install wasm-bindgen-cli --version 0.2.128 --locked');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
