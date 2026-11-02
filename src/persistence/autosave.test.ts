import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocument } from '../core/document';

const { saveDocument } = vi.hoisted(() => ({ saveDocument: vi.fn() }));

vi.mock('./indexedDb', () => ({
  clearRecoverySnapshot: vi.fn().mockResolvedValue(undefined),
  getSnapshotLimit: vi.fn(() => 31),
  saveDocument,
  saveDocumentSnapshot: vi.fn().mockResolvedValue(undefined),
  saveDocumentThumbnail: vi.fn().mockResolvedValue(true),
  saveRecoverySnapshot: vi.fn().mockResolvedValue(undefined),
}));

import { AutosaveController } from './autosave';

describe('autosave flush', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('retains later documents from a failed batch and retries them on flush', async () => {
    vi.useFakeTimers();
    const first = createDocument('First');
    const second = createDocument('Second');
    const attempts: string[] = [];
    let failFirstAttempt = true;
    saveDocument.mockImplementation(async (document: { id: string }) => {
      attempts.push(document.id);
      if (document.id === first.id && failFirstAttempt) {
        failFirstAttempt = false;
        throw new Error('simulated disk error');
      }
    });

    const autosave = new AutosaveController({ recoveryDelay: 10_000 });
    autosave.schedule(first);
    autosave.schedule(second);

    await expect(autosave.flush()).rejects.toThrow('simulated disk error');
    expect(attempts).toEqual([first.id]);

    await autosave.flush();
    expect(attempts).toEqual([first.id, first.id, second.id]);
    autosave.stop();
  });
});
