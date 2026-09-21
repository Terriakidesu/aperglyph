import RBush from 'rbush';
import type { SpatialBounds, SpatialEngine, SpatialNode, SpatialRequest, SpatialResponse } from '../spatial/types';

interface TreeItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

const tree = new RBush<TreeItem>();
const items = new Map<string, TreeItem>();
type WasmQueryViewport = (rects: Float64Array, minX: number, minY: number, maxX: number, maxY: number) => Uint32Array;
type WasmRankNearby = (rects: Float64Array, x: number, y: number, radius: number, maxResults: number) => Uint32Array;
interface WasmModule {
  default: () => Promise<unknown>;
  query_viewport: WasmQueryViewport;
  rank_nearby: WasmRankNearby;
}

let wasmQueryViewport: WasmQueryViewport | null = null;
let wasmRankNearby: WasmRankNearby | null = null;
const wasmReady = loadWasm();
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<SpatialRequest>) => void) | null;
  postMessage: (message: SpatialResponse) => void;
};

let requestChain = Promise.resolve();
workerScope.onmessage = (event) => {
  requestChain = requestChain.then(() => handleRequest(event.data));
};

async function handleRequest(request: SpatialRequest): Promise<void> {
  try {
    switch (request.kind) {
      case 'initialize':
        await wasmReady;
        tree.clear();
        items.clear();
        tree.load(request.nodes.map(toTreeItem));
        request.nodes.forEach((node) => items.set(node.id, toTreeItem(node)));
        respond({ kind: 'ready', requestId: request.requestId, engine: activeEngine() });
        break;
      case 'upsert':
        request.nodes.forEach(upsert);
        respond({ kind: 'ready', requestId: request.requestId });
        break;
      case 'remove':
        request.ids.forEach(remove);
        respond({ kind: 'ready', requestId: request.requestId });
        break;
      case 'queryViewport':
        await wasmReady;
        respond({ kind: 'result', requestId: request.requestId, ids: queryBounds(request.bounds) });
        break;
      case 'queryNearby': {
        await wasmReady;
        const bounds = { minX: request.x - request.radius, minY: request.y - request.radius, maxX: request.x + request.radius, maxY: request.y + request.radius };
        respond({ kind: 'result', requestId: request.requestId, ids: queryNearby(bounds, request.x, request.y, request.radius, request.limit ?? 256) });
        break;
      }
    }
  } catch (error) {
    respond({ kind: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : 'Spatial query failed.' });
  }
}

async function loadWasm(): Promise<void> {
  try {
    const moduleUrl = new URL(`${import.meta.env.BASE_URL}wasm/aperglyph_diagram_engine.js`, self.location.origin).href;
    const module = await import(/* @vite-ignore */ moduleUrl) as unknown as WasmModule;
    await module.default();
    wasmQueryViewport = module.query_viewport;
    wasmRankNearby = module.rank_nearby;
  } catch {
    // The TypeScript/RBush implementation remains the compatibility path when
    // the optional WASM asset cannot be loaded.
    wasmQueryViewport = null;
    wasmRankNearby = null;
  }
}

function activeEngine(): SpatialEngine {
  return wasmQueryViewport ? 'wasm' : 'typescript';
}

function queryBounds(bounds: SpatialBounds): string[] {
  const candidates = tree.search(bounds);
  if (!wasmQueryViewport || candidates.length === 0) return candidates.map((item) => item.id);

  const rects = new Float64Array(candidates.length * 4);
  candidates.forEach((item, index) => {
    const offset = index * 4;
    rects[offset] = item.minX;
    rects[offset + 1] = item.minY;
    rects[offset + 2] = item.maxX - item.minX;
    rects[offset + 3] = item.maxY - item.minY;
  });
  const indexes = wasmQueryViewport(rects, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
  return Array.from(indexes, (index) => candidates[index]?.id).filter((id): id is string => Boolean(id));
}

function queryNearby(bounds: SpatialBounds, x: number, y: number, radius: number, limit: number): string[] {
  const candidates = tree.search(bounds);
  if (!wasmRankNearby || candidates.length === 0) return candidates
    .map((item) => {
      const nearestX = Math.max(item.minX, Math.min(x, item.maxX));
      const nearestY = Math.max(item.minY, Math.min(y, item.maxY));
      const dx = x - nearestX;
      const dy = y - nearestY;
      return { item, distanceSquared: dx * dx + dy * dy };
    })
    .filter(({ distanceSquared }) => distanceSquared <= radius * radius)
    .sort((left, right) => left.distanceSquared - right.distanceSquared)
    .slice(0, Math.max(1, limit))
    .map(({ item }) => item.id);
  const rects = new Float64Array(candidates.length * 4);
  candidates.forEach((item, index) => {
    const offset = index * 4;
    rects[offset] = item.minX;
    rects[offset + 1] = item.minY;
    rects[offset + 2] = item.maxX - item.minX;
    rects[offset + 3] = item.maxY - item.minY;
  });
  const indexes = wasmRankNearby(rects, x, y, radius, Math.max(1, limit));
  return Array.from(indexes, (index) => candidates[index]?.id).filter((id): id is string => Boolean(id));
}

function upsert(node: SpatialNode): void {
  remove(node.id);
  const item = toTreeItem(node);
  items.set(node.id, item);
  tree.insert(item);
}

function remove(id: string): void {
  const item = items.get(id);
  if (!item) return;
  tree.remove(item, (left, right) => left.id === right.id);
  items.delete(id);
}

function toTreeItem(node: SpatialNode): TreeItem {
  return { minX: node.minX, minY: node.minY, maxX: node.maxX, maxY: node.maxY, id: node.id };
}

function respond(message: SpatialResponse): void {
  workerScope.postMessage(message);
}
