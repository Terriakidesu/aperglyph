import type { LayoutMode } from '../core/layout';

type WasmLayoutHierarchy = (sizes: Float64Array, edges: Uint32Array, horizontal: boolean, gapX: number, gapY: number) => Float64Array;

interface WasmModule {
  default: () => Promise<unknown>;
  layout_hierarchy: WasmLayoutHierarchy;
}

interface LayoutRequest {
  requestId: number;
  nodes: Array<{ id: string; width: number; height: number }>;
  edges: Array<{ source: number; target: number }>;
  mode: LayoutMode;
}

const scope = self as unknown as { onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null; postMessage: (message: unknown) => void };
let wasmLayout: WasmLayoutHierarchy | null = null;
const wasmReady = loadWasm();

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    await wasmReady;
    const positions = wasmLayout && !['grid', 'compact'].includes(request.mode)
      ? layoutWithWasm(request)
      : layoutWithTypeScript(request);
    scope.postMessage({ requestId: request.requestId, positions });
  } catch (error) {
    scope.postMessage({ requestId: request.requestId, error: error instanceof Error ? error.message : 'Layout failed.' });
  }
};

async function loadWasm(): Promise<void> {
  try {
    const moduleUrl = new URL(`${import.meta.env.BASE_URL}wasm/aperglyph_diagram_engine.js`, self.location.origin).href;
    const module = await import(/* @vite-ignore */ moduleUrl) as unknown as WasmModule;
    await module.default();
    wasmLayout = module.layout_hierarchy;
  } catch {
    wasmLayout = null;
  }
}

function layoutWithWasm(request: LayoutRequest): Array<{ x: number; y: number }> {
  const sizes = new Float64Array(request.nodes.length * 2);
  request.nodes.forEach((node, index) => {
    sizes[index * 2] = node.width;
    sizes[index * 2 + 1] = node.height;
  });
  const edges = new Uint32Array(request.edges.length * 2);
  request.edges.forEach((edge, index) => {
    edges[index * 2] = edge.source;
    edges[index * 2 + 1] = edge.target;
  });
  const packed = wasmLayout!(sizes, edges, request.mode !== 'vertical' && request.mode !== 'tree', 72, 56);
  return unpackPositions(packed);
}

function layoutWithTypeScript(request: LayoutRequest): Array<{ x: number; y: number }> {
  const positions = request.nodes.map(() => ({ x: 0, y: 0 }));
  if (request.nodes.length === 0) return positions;
  if (request.mode === 'grid' || request.mode === 'compact') {
    const columns = request.mode === 'compact' ? 4 : Math.ceil(Math.sqrt(request.nodes.length));
    const width = Math.max(...request.nodes.map((node) => node.width));
    const height = Math.max(...request.nodes.map((node) => node.height));
    request.nodes.forEach((_, index) => { positions[index] = { x: (index % columns) * (width + 48), y: Math.floor(index / columns) * (height + 48) }; });
    return positions;
  }
  const incoming = request.nodes.map(() => 0);
  const outgoing = request.nodes.map(() => [] as number[]);
  request.edges.forEach(({ source, target }) => { if (source < positions.length && target < positions.length && source !== target) { outgoing[source].push(target); incoming[target] += 1; } });
  const levels = request.nodes.map(() => -1);
  const queue = request.nodes.map((_, index) => index).filter((index) => incoming[index] === 0);
  if (queue.length === 0) queue.push(0);
  queue.forEach((index) => { levels[index] = 0; });
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const source = queue[cursor];
    outgoing[source].forEach((target) => {
      levels[target] = Math.max(levels[target], levels[source] + 1);
      incoming[target] -= 1;
      if (incoming[target] === 0) queue.push(target);
    });
  }
  const maxLevel = Math.max(0, ...levels);
  levels.forEach((level, index) => { if (level < 0) levels[index] = maxLevel + 1; });
  const offsets = new Map<number, number>();
  const width = Math.max(...request.nodes.map((node) => node.width));
  const height = Math.max(...request.nodes.map((node) => node.height));
  request.nodes.forEach((_, index) => {
    const level = levels[index];
    const offset = offsets.get(level) ?? 0;
    offsets.set(level, offset + 1);
    positions[index] = request.mode === 'vertical' || request.mode === 'tree'
      ? { x: offset * (width + 72), y: level * (height + 56) }
      : { x: level * (width + 72), y: offset * (height + 56) };
  });
  return positions;
}

function unpackPositions(packed: Float64Array): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < packed.length; index += 2) positions.push({ x: packed[index], y: packed[index + 1] });
  return positions;
}
