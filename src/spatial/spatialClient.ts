import type { SpatialBounds, SpatialNode, SpatialRequestPayload, SpatialResponse } from './types';

interface PendingRequest {
  resolve: (value: string[]) => void;
  reject: (reason: Error) => void;
}

/**
 * Main-thread boundary for spatial queries. The worker owns the R-tree; the
 * fallback keeps editing functional in browsers that cannot create workers.
 */
export class SpatialWorkerClient {
  private worker: Worker | null;
  private readonly fallback = new Map<string, SpatialNode>();
  private readonly pending = new Map<number, PendingRequest>();
  private requestId = 0;

  constructor() {
    if (typeof Worker === 'undefined') {
      this.worker = null;
      return;
    }
    try {
      this.worker = new Worker(new URL('../workers/spatial.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<SpatialResponse>) => this.handleResponse(event.data);
      this.worker.onerror = (event) => {
        this.worker?.terminate();
        this.worker = null;
        this.rejectAll(new Error(event.message || 'Spatial worker failed.'));
      };
    } catch {
      this.worker = null;
    }
  }

  async initialize(nodes: SpatialNode[]): Promise<void> {
    this.fallback.clear();
    nodes.forEach((node) => this.fallback.set(node.id, node));
    if (!this.worker) return;
    await this.send({ kind: 'initialize', nodes });
  }

  async upsert(nodes: SpatialNode[]): Promise<void> {
    nodes.forEach((node) => this.fallback.set(node.id, node));
    if (!this.worker || nodes.length === 0) return;
    await this.send({ kind: 'upsert', nodes });
  }

  async remove(ids: string[]): Promise<void> {
    ids.forEach((id) => this.fallback.delete(id));
    if (!this.worker || ids.length === 0) return;
    await this.send({ kind: 'remove', ids });
  }

  queryViewport(bounds: SpatialBounds): Promise<string[]> {
    if (!this.worker) return Promise.resolve(this.fallbackQuery(bounds));
    return this.send({ kind: 'queryViewport', bounds });
  }

  queryNearby(x: number, y: number, radius: number): Promise<string[]> {
    if (!this.worker) {
      const bounds = { minX: x - radius, minY: y - radius, maxX: x + radius, maxY: y + radius };
      return Promise.resolve(this.fallbackQuery(bounds));
    }
    return this.send({ kind: 'queryNearby', x, y, radius });
  }

  terminate(): void {
    this.worker?.terminate();
    this.rejectAll(new Error('Spatial worker was terminated.'));
  }

  private send(message: SpatialRequestPayload): Promise<string[]> {
    if (!this.worker) return Promise.resolve([]);
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker!.postMessage({ ...message, requestId });
    });
  }

  private handleResponse(response: SpatialResponse): void {
    if (response.kind === 'ready') {
      this.pending.get(response.requestId)?.resolve([]);
    } else if (response.kind === 'result') {
      this.pending.get(response.requestId)?.resolve(response.ids);
    } else {
      this.pending.get(response.requestId)?.reject(new Error(response.message));
    }
    this.pending.delete(response.requestId);
  }

  private fallbackQuery(bounds: SpatialBounds): string[] {
    return [...this.fallback.values()]
      .filter((node) => node.minX <= bounds.maxX && node.maxX >= bounds.minX && node.minY <= bounds.maxY && node.maxY >= bounds.minY)
      .map((node) => node.id);
  }

  private rejectAll(error: Error): void {
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
  }
}
