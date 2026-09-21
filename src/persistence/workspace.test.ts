import { describe, expect, it } from 'vitest';
import { createDocument, createNode } from '../core/document';
import { createWorkspaceBackup, parseWorkspaceBackup, restoreWorkspaceBackup } from './workspace';
import { getRecoverySnapshot, listDocumentSnapshots, listDocuments, saveDocument, saveDocumentSnapshot, saveRecoverySnapshot } from './indexedDb';

describe('workspace backup', () => {
  it('round trips documents and bounded metadata through a local backup', async () => {
    const document = createDocument('Backup test');
    document.pages[0].nodes.push(createNode('rectangle', { x: 24, y: 32 }));
    await saveDocument(document, 'data:image/svg+xml;base64,thumbnail', { favorite: true });
    await saveDocumentSnapshot(document, { kind: 'checkpoint', name: 'Before experiment' });

    const raw = await createWorkspaceBackup();
    const parsed = parseWorkspaceBackup(raw);
    expect(parsed.documents.some((record) => record.id === document.id && record.favorite)).toBe(true);
    expect(parsed.snapshots.some((snapshot) => snapshot.name === 'Before experiment')).toBe(true);

    await restoreWorkspaceBackup(raw);
    const restored = (await listDocuments()).find((record) => record.id === document.id);
    expect(restored?.document.pages[0].nodes[0].position).toEqual({ x: 24, y: 32 });
    expect((await listDocumentSnapshots(document.id)).find((snapshot) => snapshot.name === 'Before experiment')?.kind).toBe('checkpoint');
  });

  it('rejects unsupported or malformed workspace backups before restore', () => {
    expect(() => parseWorkspaceBackup(JSON.stringify({ format: 'other', formatVersion: 1 }))).toThrow(/supported/);
    expect(() => parseWorkspaceBackup(JSON.stringify({ format: 'aperglyph-workspace', formatVersion: 1, documents: [{}], snapshots: [], templates: [], preferences: {} }))).toThrow(/documents\[0\]/);
  });

  it('rejects stored metadata that does not match its document', async () => {
    const document = createDocument('Metadata check');
    await saveDocument(document);
    const backup = JSON.parse(await createWorkspaceBackup()) as { documents: Array<{ id: string }> };
    backup.documents[0].id = 'not-the-document-id';
    expect(() => parseWorkspaceBackup(JSON.stringify(backup))).toThrow(/id does not match/);
  });

  it('fully replaces stale documents during the default restore', async () => {
    const source = createDocument('Restore source');
    await saveDocument(source);
    const raw = await createWorkspaceBackup();
    const stale = createDocument('Stale document');
    await saveDocument(stale);
    await restoreWorkspaceBackup(raw);
    expect((await listDocuments()).some((record) => record.id === stale.id)).toBe(false);
    expect((await listDocuments()).some((record) => record.id === source.id)).toBe(true);
  });

  it('keeps automatic snapshots inside the hard retention limit', async () => {
    const document = createDocument('Snapshot limit');
    for (let index = 0; index < 40; index += 1) {
      await saveDocumentSnapshot(document, { savedAt: index + 1, kind: 'automatic' });
    }
    expect(await listDocumentSnapshots(document.id)).toHaveLength(31);
  });

  it('preserves a recovery snapshot even when its document has not been saved yet', async () => {
    const document = createDocument('Unsaved recovery');
    await saveRecoverySnapshot(document, 1234);
    const raw = await createWorkspaceBackup();
    const parsed = parseWorkspaceBackup(raw);
    expect(parsed.recovery?.document.id).toBe(document.id);
    await restoreWorkspaceBackup(raw);
    const restored = await getRecoverySnapshot();
    expect(restored?.document.id).toBe(document.id);
    expect(restored?.savedAt).toBe(1234);
  });
});
