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
    expect(parsed.recovery.some((snapshot) => snapshot.document.id === document.id)).toBe(true);
    await restoreWorkspaceBackup(raw);
    const restored = await getRecoverySnapshot(document.id);
    expect(restored?.document.id).toBe(document.id);
    expect(restored?.savedAt).toBe(1234);
  });

  it('round trips recovery records for multiple documents and accepts older backup versions', async () => {
    const first = createDocument('First recovery');
    const second = createDocument('Second recovery');
    await saveRecoverySnapshot(first, 1100);
    await saveRecoverySnapshot(second, 2200);
    const parsed = parseWorkspaceBackup(await createWorkspaceBackup());
    expect(parsed.recovery.map((snapshot) => snapshot.document.id)).toContain(second.id);
    expect(parsed.recovery.map((snapshot) => snapshot.document.id)).toContain(first.id);
    expect(parsed.recovery.find((snapshot) => snapshot.document.id === second.id)?.savedAt).toBe(2200);
    await restoreWorkspaceBackup(JSON.stringify(parsed));
    expect((await getRecoverySnapshot(first.id))?.savedAt).toBe(1100);
    expect((await getRecoverySnapshot(second.id))?.savedAt).toBe(2200);

    const legacy = parseWorkspaceBackup(JSON.stringify({
      format: 'aperglyph-workspace',
      formatVersion: 1,
      exportedAt: 100,
      documents: [],
      snapshots: [],
      templates: [],
      preferences: {},
      recovery: { document: first, savedAt: 300 },
    }));
    expect(legacy.recovery).toHaveLength(1);
    expect(legacy.recovery[0].id).toBe(`recovery-${first.id}`);
  });

  it('previews incoming item counts and ID collisions before applying a restore', async () => {
    const document = createDocument('Preview collision');
    await saveDocument(document);
    const raw = await createWorkspaceBackup();
    const { previewWorkspaceBackup } = await import('./workspace');
    const preview = await previewWorkspaceBackup(raw);
    expect(preview.counts.documents).toBeGreaterThanOrEqual(1);
    expect(preview.collisions.documents).toBeGreaterThanOrEqual(1);
  });

  it('merges backups without removing local-only documents and replaces matching records', async () => {
    const source = createDocument('Imported value');
    await saveDocument(source);
    const raw = await createWorkspaceBackup();
    const localOnly = createDocument('Keep local value');
    await saveDocument(localOnly);
    const overwritten = { ...source, name: 'Local collision', updatedAt: source.updatedAt + 100 };
    await saveDocument(overwritten);

    await restoreWorkspaceBackup(raw, { replace: false });

    const records = await listDocuments();
    expect(records.some((record) => record.id === localOnly.id)).toBe(true);
    expect(records.find((record) => record.id === source.id)?.name).toBe('Imported value');
  });

  it('does not restore a recovery record belonging to another remembered document', async () => {
    const recoveryDocument = createDocument('Other recovery');
    await saveRecoverySnapshot(recoveryDocument, 2345);
    expect(await getRecoverySnapshot('not-the-active-document')).toBeNull();
    expect((await getRecoverySnapshot(recoveryDocument.id))?.document.id).toBe(recoveryDocument.id);
  });
});
