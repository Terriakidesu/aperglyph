import type { DiagramDocument } from '../core/types';

interface ThumbnailResponse {
  requestId: number;
  thumbnail?: string;
  error?: string;
}

interface PendingThumbnail {
  resolve: (thumbnail: string | null) => void;
}

/** Keeps SVG preview generation off the editor's main thread. */
export class ThumbnailWorkerClient {
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingThumbnail>();

  create(document: DiagramDocument): Promise<string | null> {
    if (typeof Worker === 'undefined') return Promise.resolve(null);
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./thumbnail.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event: MessageEvent<ThumbnailResponse>) => {
          const pending = this.pending.get(event.data.requestId);
          if (!pending) return;
          this.pending.delete(event.data.requestId);
          pending.resolve(event.data.thumbnail ?? null);
        };
        this.worker.onerror = () => this.failAll();
      } catch {
        return Promise.resolve(null);
      }
    }
    const requestId = ++this.requestId;
    return new Promise((resolve) => {
      this.pending.set(requestId, { resolve });
      this.worker!.postMessage({ requestId, document });
    });
  }

  close(): void {
    this.worker?.terminate();
    this.worker = null;
    this.failAll();
  }

  private failAll(): void {
    this.pending.forEach(({ resolve }) => resolve(null));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
