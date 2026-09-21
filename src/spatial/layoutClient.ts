import type { LayoutMode } from '../core/layout';
import type { DiagramEdge, DiagramNode, Point } from '../core/types';

interface LayoutRequest {
  requestId: number;
  nodes: Array<{ id: string; width: number; height: number }>;
  edges: Array<{ source: number; target: number }>;
  mode: LayoutMode;
}

interface LayoutResponse {
  requestId: number;
  positions?: Array<{ x: number; y: number }>;
  error?: string;
}

interface PendingRequest {
  ids: string[];
  resolve: (positions: Record<string, Point>) => void;
  reject: (error: Error) => void;
}

/** Main-thread boundary for batched graph layout in the layout worker. */
export class LayoutWorkerClient {
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();

  constructor() {
    if (typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('../workers/layout.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<LayoutResponse>) => this.handleResponse(event.data);
      this.worker.onerror = (event) => {
        this.rejectAll(new Error(event.message || 'Layout worker failed.'));
        this.worker?.terminate();
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  layout(nodes: DiagramNode[], edges: DiagramEdge[], mode: LayoutMode): Promise<Record<string, Point>> {
    if (!this.worker) return Promise.reject(new Error('Layout worker is unavailable.'));
    const indexById = new Map(nodes.map((node, index) => [node.id, index]));
    const requestId = ++this.requestId;
    const request: LayoutRequest = {
      requestId,
      nodes: nodes.map((node) => ({ id: node.id, width: node.size.width, height: node.size.height })),
      edges: edges.flatMap((edge) => {
        if (!edge.source.nodeId || !edge.target.nodeId) return [];
        const source = indexById.get(edge.source.nodeId);
        const target = indexById.get(edge.target.nodeId);
        return source === undefined || target === undefined ? [] : [{ source, target }];
      }),
      mode,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { ids: nodes.map((node) => node.id), resolve, reject });
      this.worker!.postMessage(request);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.rejectAll(new Error('Layout worker was terminated.'));
  }

  private handleResponse(response: LayoutResponse): void {
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    if (response.error || !response.positions) {
      pending.reject(new Error(response.error ?? 'Layout failed.'));
      return;
    }
    pending.resolve(Object.fromEntries(pending.ids.map((id, index) => [id, response.positions?.[index] ?? { x: 0, y: 0 }])));
  }

  private rejectAll(error: Error): void {
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
  }
}
