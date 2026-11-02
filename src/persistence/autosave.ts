import { editorEvents } from '../core/events';
import type { DiagramDocument } from '../core/types';
import { clearRecoverySnapshot, getSnapshotLimit, saveDocument, saveDocumentSnapshot, saveDocumentThumbnail, saveRecoverySnapshot } from './indexedDb';
import { ThumbnailWorkerClient } from './thumbnailClient';

interface AutosaveOptions {
  saveDelay?: number;
  recoveryDelay?: number;
  snapshotInterval?: number;
  snapshotLimit?: number;
  onSaved?: (document: DiagramDocument) => void;
  onError?: (error: Error) => void;
}

interface PendingDocument {
  document: DiagramDocument;
  revision: number;
}

export class AutosaveController {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingDocuments = new Map<string, PendingDocument>();
  private readonly revisionByDocument = new Map<string, number>();
  private saveChain: Promise<void> = Promise.resolve();
  private unsubscribeChanged: (() => void) | null = null;
  private unsubscribeOpened: (() => void) | null = null;
  private readonly thumbnailWorker = new ThumbnailWorkerClient();
  private readonly options: Required<Pick<AutosaveOptions, 'saveDelay' | 'recoveryDelay'>> & Omit<AutosaveOptions, 'saveDelay' | 'recoveryDelay'>;
  private readonly lastSnapshotAt = new Map<string, number>();

  constructor(options: AutosaveOptions = {}) {
    this.options = { saveDelay: 700, recoveryDelay: 220, snapshotInterval: 60 * 60 * 1000, snapshotLimit: 31, ...options };
  }

  start(): () => void {
    const queue = ({ document }: { document: DiagramDocument }) => this.schedule(document);
    this.unsubscribeChanged = editorEvents.on('document:changed', queue);
    this.unsubscribeOpened = editorEvents.on('document:opened', queue);
    return () => this.stop();
  }

  stop(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.unsubscribeChanged?.();
    this.unsubscribeOpened?.();
    this.unsubscribeChanged = null;
    this.unsubscribeOpened = null;
    this.thumbnailWorker.close();
  }

  schedule(document: DiagramDocument): void {
    // Editor commands replace documents immutably. Keep the committed object
    // reference here instead of cloning the entire graph for each pointer edit;
    // persistence performs the one required serialization at its boundary.
    const revision = this.nextRevision(document.id);
    this.pendingDocuments.set(document.id, { document, revision });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = setTimeout(() => {
      const pending = [...this.pendingDocuments.values()].at(-1);
      if (pending) void this.saveRecovery(pending.document, pending.revision);
    }, this.options.recoveryDelay);
    this.saveTimer = setTimeout(() => { void this.flushPending().catch(() => undefined); }, this.options.saveDelay);
  }

  async flush(document?: DiagramDocument): Promise<void> {
    if (document) this.pendingDocuments.set(document.id, { document, revision: this.nextRevision(document.id) });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    do {
      await this.flushPending();
    } while (this.pendingDocuments.size > 0);
  }

  private flushPending(): Promise<void> {
    if (this.pendingDocuments.size === 0) return this.saveChain;
    const batch = new Map(this.pendingDocuments);
    this.pendingDocuments.clear();
    const next = this.saveChain.catch(() => undefined).then(async () => {
      const entries = [...batch.entries()];
      for (let index = 0; index < entries.length; index += 1) {
        const [documentId, queued] = entries[index];
        let pending: PendingDocument | undefined = queued;
        while (pending) {
          try {
            await this.save(pending.document, pending.revision);
          } catch (error) {
            if (!this.pendingDocuments.has(documentId)) this.pendingDocuments.set(documentId, pending);
            for (const [remainingId, remaining] of entries.slice(index + 1)) {
              if (!this.pendingDocuments.has(remainingId)) this.pendingDocuments.set(remainingId, remaining);
            }
            throw error;
          }
          pending = this.pendingDocuments.get(documentId);
          if (pending) this.pendingDocuments.delete(documentId);
        }
      }
    });
    this.saveChain = next;
    return this.saveChain;
  }

  private async save(document: DiagramDocument, revision: number): Promise<void> {
    try {
      const startedAt = performance.now();
      // A changed document must not display an old thumbnail. The replacement
      // preview is rendered lazily in a worker after the durable save finishes.
      await saveDocument(document, null);
      recordTiming('document-save', startedAt);
      this.options.onSaved?.(document);
      editorEvents.emit('storage:saved', { documentId: document.id });
      void clearRecoverySnapshot(document.id, revision).catch((error) => this.reportError(error));
      this.scheduleMaintenance(document);
    } catch (error) {
      this.reportError(error);
      throw error;
    }
  }

  private scheduleMaintenance(document: DiagramDocument): void {
    const run = () => { void this.maintain(document); };
    const idleWindow = globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 1000);
  }

  private async maintain(document: DiagramDocument): Promise<void> {
    try {
      const startedAt = performance.now();
      const thumbnail = await this.thumbnailWorker.create(document);
      recordTiming('thumbnail-worker', startedAt);
      if (thumbnail) await saveDocumentThumbnail(document.id, document.updatedAt, thumbnail);

      const now = Date.now();
      const lastSnapshot = this.lastSnapshotAt.get(document.id) ?? 0;
      if (now - lastSnapshot >= (this.options.snapshotInterval ?? 60 * 60 * 1000)) {
        const snapshotStartedAt = performance.now();
        await saveDocumentSnapshot(document, { kind: 'automatic', name: 'Automatic snapshot', limit: this.options.snapshotLimit ?? getSnapshotLimit() });
        recordTiming('snapshot-save', snapshotStartedAt);
        this.lastSnapshotAt.set(document.id, now);
      }
    } catch (error) {
      this.reportError(error);
    }
  }

  private async saveRecovery(document: DiagramDocument, revision: number): Promise<void> {
    try {
      await saveRecoverySnapshot(document, revision);
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error('Unable to save this diagram locally.');
    this.options.onError?.(normalized);
    editorEvents.emit('storage:error', { error: normalized });
  }

  private nextRevision(documentId: string): number {
    const revision = Math.max(Date.now(), (this.revisionByDocument.get(documentId) ?? 0) + 1);
    this.revisionByDocument.set(documentId, revision);
    return revision;
  }
}

function recordTiming(name: string, start: number): void {
  try {
    if (typeof performance === 'undefined') return;
    const measurementName = `aperglyph.persistence.${name}`;
    const measure = performance.measure(measurementName, { start, end: performance.now() });
    if (import.meta.env.DEV) console.debug(`[AperGlyph profile] ${measurementName}: ${measure.duration.toFixed(1)} ms`);
    performance.clearMeasures(measurementName);
  } catch {
    // Performance instrumentation must never make saving fail.
  }
}
