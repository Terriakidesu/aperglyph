import { editorEvents } from '../core/events';
import { documentToSvg } from './files';
import type { DiagramDocument } from '../core/types';
import { clearRecoverySnapshot, saveDocument, saveRecoverySnapshot } from './indexedDb';

interface AutosaveOptions {
  saveDelay?: number;
  recoveryDelay?: number;
  onSaved?: (document: DiagramDocument) => void;
  onError?: (error: Error) => void;
}

export class AutosaveController {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDocument: DiagramDocument | null = null;
  private unsubscribeChanged: (() => void) | null = null;
  private unsubscribeOpened: (() => void) | null = null;
  private readonly options: Required<Pick<AutosaveOptions, 'saveDelay' | 'recoveryDelay'>> & Omit<AutosaveOptions, 'saveDelay' | 'recoveryDelay'>;

  constructor(options: AutosaveOptions = {}) {
    this.options = { saveDelay: 700, recoveryDelay: 220, ...options };
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
  }

  schedule(document: DiagramDocument): void {
    this.pendingDocument = structuredClone(document);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = setTimeout(() => {
      if (this.pendingDocument) void this.saveRecovery(this.pendingDocument);
    }, this.options.recoveryDelay);
    this.saveTimer = setTimeout(() => {
      if (this.pendingDocument) void this.save(this.pendingDocument);
    }, this.options.saveDelay);
  }

  async flush(document?: DiagramDocument): Promise<void> {
    const pending = document ?? this.pendingDocument;
    if (!pending) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    await this.save(pending);
  }

  private async save(document: DiagramDocument): Promise<void> {
    try {
      await saveDocument(document, createThumbnail(document));
      await clearRecoverySnapshot();
      this.pendingDocument = null;
      this.options.onSaved?.(document);
      editorEvents.emit('storage:saved', { documentId: document.id });
    } catch (error) {
      this.reportError(error);
    }
  }

  private async saveRecovery(document: DiagramDocument): Promise<void> {
    try {
      await saveRecoverySnapshot(document);
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error('Unable to save this diagram locally.');
    this.options.onError?.(normalized);
    editorEvents.emit('storage:error', { error: normalized });
  }
}

function createThumbnail(document: DiagramDocument): string | undefined {
  const page = document.pages[0];
  if (!page) return undefined;
  try {
    const svg = documentToSvg(page.nodes.filter((node) => !node.hidden), page.edges, page.settings.background, page.settings.width, page.settings.height);
    const thumbnail = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    return thumbnail.length <= 600000 ? thumbnail : undefined;
  } catch {
    return undefined;
  }
}
