import { describe, expect, it } from 'vitest';
import { CommandManager, UpdateDocumentPaletteCommand, UpdateNodeCommand, UpdateNodeStylesCommand, UpdateStylePresetsCommand } from './commands';
import { createDocument, createNode, defaultNodeStyle, migrateDocument } from './document';
import { wrapText } from './text';

describe('styling system', () => {
  it('wraps long labels deterministically and preserves explicit line breaks', () => {
    expect(wrapText('one two three four', 42, 12)).toEqual(['one', 'two', 'three', 'four']);
    expect(wrapText('one\ntwo', 200, 12)).toEqual(['one', 'two']);
  });

  it('merges style patches without replacing unrelated formatting', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const node = createNode('rectangle', { x: 0, y: 0 });
    document.pages[0].nodes.push(node);
    const manager = new CommandManager();
    const next = manager.execute(new UpdateNodeStylesCommand(pageId, { [node.id]: { fill: '#ffffff', fontSize: 20 } }, 'Change style'), document);
    expect(next.pages[0].nodes[0].style).toMatchObject({ fill: '#ffffff', fontSize: 20, stroke: node.style.stroke, opacity: node.style.opacity });
  });

  it('updates wrapped node height as an undoable label edit', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const node = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 72, height: 40 } });
    document.pages[0].nodes.push(node);
    const manager = new CommandManager();
    const next = manager.execute(new UpdateNodeCommand(pageId, node.id, { data: { label: 'A much longer wrapped label that needs more than one line' } }), document);
    expect(next.pages[0].nodes[0].size.height).toBeGreaterThan(node.size.height);
  });

  it('migrates style, canvas, palette, and preset defaults for older documents', () => {
    const document = createDocument('Legacy');
    const node = createNode('rectangle', { x: 0, y: 0 }, { data: { label: 'Legacy node' } });
    const legacyNode = structuredClone(node) as unknown as Record<string, unknown>;
    const legacyStyle = legacyNode.style as unknown as Record<string, unknown>;
    delete legacyStyle.fontSize;
    delete legacyStyle.fontWeight;
    delete legacyStyle.textAlign;
    delete legacyStyle.verticalAlign;
    delete legacyStyle.textWrap;
    delete legacyStyle.autoHeight;
    document.pages[0].nodes.push(legacyNode as unknown as typeof node);
    const legacy = structuredClone(document) as Partial<typeof document>;
    delete (legacy as Record<string, unknown>).palette;
    delete (legacy as Record<string, unknown>).stylePresets;
    delete (legacy.pages![0].settings as unknown as Record<string, unknown>).canvasTheme;
    const migrated = migrateDocument(legacy);
    expect(migrated.palette.length).toBeGreaterThan(0);
    expect(migrated.stylePresets).toEqual([]);
    expect(migrated.pages[0].settings.canvasTheme).toBe('dark');
    expect(migrated.pages[0].nodes[0].style.fontSize).toBe(12);
    expect(migrated.pages[0].nodes[0].style.textWrap).toBe(true);
    expect(defaultNodeStyle.fontSize).toBe(12);
  });

  it('keeps palette and style preset updates in document history', () => {
    const document = createDocument();
    const manager = new CommandManager();
    const withPalette = manager.execute(new UpdateDocumentPaletteCommand(['#fff']), document);
    const withPreset = manager.execute(new UpdateStylePresetsCommand([{ id: 'preset_1', name: 'Focus', style: { fill: '#fff' } }]), withPalette);
    expect(withPreset.palette).toEqual(['#fff']);
    expect(withPreset.stylePresets[0].style).toEqual({ fill: '#fff' });
    expect(manager.undo(withPreset)?.palette).toEqual(['#fff']);
  });
});
