import { Keyboard, PanelLeftClose, PanelRightClose } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CLIPBOARD_MIME, parseClipboardPayload, serializeClipboardPayload } from '../core/commands';
import { createNode as buildNode } from '../core/document';
import { editorEvents } from '../core/events';
import { getActivePage, useEditorStore } from '../store/editorStore';
import { CanvasViewport } from './CanvasViewport';
import { EditorToolbar } from './EditorToolbar';
import { EditorTopBar } from './EditorTopBar';
import { PageTabs } from './PageTabs';
import { PropertiesPanel } from './PropertiesPanel';
import { ShapeLibrary } from './ShapeLibrary';
import { StatusBar } from './StatusBar';

interface EditorScreenProps { onExit: () => void }

export function EditorScreen({ onExit }: EditorScreenProps) {
  const activeTool = useEditorStore((state) => state.activeTool);
  const setTool = useEditorStore((state) => state.setTool);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const selectAll = useEditorStore((state) => state.selectAll);
  const copySelection = useEditorStore((state) => state.copySelection);
  const cutSelection = useEditorStore((state) => state.cutSelection);
  const pasteClipboard = useEditorStore((state) => state.pasteClipboard);
  const pastePayload = useEditorStore((state) => state.pastePayload);
  const duplicateSelection = useEditorStore((state) => state.duplicateSelection);
  const rotateSelection = useEditorStore((state) => state.rotateSelection);
  const groupSelection = useEditorStore((state) => state.groupSelection);
  const ungroupSelection = useEditorStore((state) => state.ungroupSelection);
  const nudgeSelection = useEditorStore((state) => state.nudgeSelection);
  const addNode = useEditorStore((state) => state.createNode);
  const createPage = useEditorStore((state) => state.createPage);
  const autoLayout = useEditorStore((state) => state.autoLayout);
  const resetEdge = useEditorStore((state) => state.resetEdge);
  const updatePageSettings = useEditorStore((state) => state.updatePageSettings);
  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const viewport = useEditorStore((state) => state.viewport);
  const page = getActivePage(document, activePageId);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const paletteInputRef = useRef<HTMLInputElement>(null);

  const paletteCommands: PaletteCommand[] = [
    { id: 'add-rectangle', label: 'Add rectangle', hint: 'Canvas', run: () => addNode(buildNode('rectangle', { x: -viewport.x - 90, y: -viewport.y - 44 }, { data: { label: 'Rectangle' } })) },
    { id: 'fit-page', label: 'Fit page', hint: 'Viewport', run: () => editorEvents.emit('viewport:fit', { scope: 'page' }) },
    { id: 'fit-selection', label: 'Fit selection', hint: 'Viewport', run: () => editorEvents.emit('viewport:fit', { scope: 'selection' }) },
    { id: 'zoom-100', label: 'Zoom to 100%', hint: 'Viewport', run: () => useEditorStore.getState().updateViewport({ zoom: 1 }) },
    { id: 'toggle-grid', label: page?.settings.gridVisible ? 'Hide grid' : 'Show grid', hint: 'Canvas', run: () => updatePageSettings({ gridVisible: !(page?.settings.gridVisible ?? true) }, activePageId, 'Toggle grid') },
    { id: 'reset-connector', label: 'Reset connector route', hint: 'Selection', run: () => resetEdge() },
    { id: 'duplicate', label: 'Duplicate selection', hint: 'Selection', shortcut: '⌘D', run: () => duplicateSelection() },
    { id: 'group', label: 'Group selection', hint: 'Selection', shortcut: '⌘G', run: () => groupSelection() },
    { id: 'new-page', label: 'Add page', hint: 'Pages', run: () => createPage() },
    { id: 'auto-layout', label: 'Auto layout', hint: 'Arrange', run: () => { void autoLayout(); } },
    { id: 'shortcuts', label: 'Open keyboard shortcuts', hint: 'Help', run: () => setShowShortcuts(true) },
  ];
  const matchingCommands = paletteCommands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(paletteQuery.trim().toLowerCase()));

  const writeSystemClipboard = async () => {
    const payload = copySelection();
    if (!payload) return;
    const serialized = serializeClipboardPayload(payload);
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          [CLIPBOARD_MIME]: new Blob([serialized], { type: CLIPBOARD_MIME }),
          'text/plain': new Blob([serialized], { type: 'text/plain' }),
        })]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(serialized);
      }
    } catch {
      // The command-level clipboard remains available when browser permissions
      // or an insecure context deny system clipboard access.
    }
  };

  const readSystemClipboard = async () => {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (!item.types.includes(CLIPBOARD_MIME)) continue;
          const blob = await item.getType(CLIPBOARD_MIME);
          const payload = parseClipboardPayload(await blob.text());
          if (payload) {
            pastePayload(payload);
            return;
          }
        }
      }
      if (navigator.clipboard?.readText) {
        const payload = parseClipboardPayload(await navigator.clipboard.readText());
        if (payload) {
          pastePayload(payload);
          return;
        }
      }
    } catch {
      // Fall back to the last in-app copy below.
    }
    pasteClipboard();
  };

  useEffect(() => {
    if (showPalette) {
      paletteInputRef.current?.focus();
      setPaletteIndex(0);
    }
  }, [showPalette]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, [contenteditable="true"]')) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); setShowPalette(true); setShowShortcuts(false); return; }
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(); return; }
       if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); void writeSystemClipboard(); return; }
       if (modifier && event.key.toLowerCase() === 'x') { event.preventDefault(); void writeSystemClipboard().finally(cutSelection); return; }
       if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); void readSystemClipboard(); return; }
      if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); return; }
      if (modifier && event.key.toLowerCase() === 'g') { event.preventDefault(); event.shiftKey ? ungroupSelection() : groupSelection(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
      if (event.key === 'Escape') { editorEvents.emit('interaction:cancel', undefined); setShowPalette(false); setShowShortcuts(false); setTool('select'); return; }
      if (!modifier && !event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const distance = event.shiftKey ? (page?.settings.snapToGrid ? page.settings.gridSize : 10) : 1;
        nudgeSelection({ x: event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0, y: event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0 });
        return;
      }
      if (!modifier && event.key.toLowerCase() === 'r') { rotateSelection(); return; }
      const shortcuts: Record<string, typeof activeTool> = { v: 'select', h: 'pan', c: 'connector', t: 'text' };
      if (shortcuts[event.key.toLowerCase()]) setTool(shortcuts[event.key.toLowerCase()]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
   }, [copySelection, cutSelection, deleteSelection, duplicateSelection, groupSelection, nudgeSelection, page?.settings.gridSize, page?.settings.snapToGrid, pasteClipboard, pastePayload, redo, rotateSelection, selectAll, setTool, ungroupSelection, undo]);

  useEffect(() => editorEvents.on('ui:shortcuts', () => setShowShortcuts(true)), []);

  return <main className="editor-shell">
    <EditorTopBar onExit={onExit} />
    <div className="editor-workspace">
      <EditorToolbar />
      {leftOpen && <ShapeLibrary />}
      <section className="canvas-column"><CanvasViewport /><PageTabs /><StatusBar /></section>
      {rightOpen && <PropertiesPanel />}
      <div className="workspace-toggles"><button onClick={() => setLeftOpen((open) => !open)} title="Toggle shapes panel">{leftOpen ? <PanelLeftClose size={15} /> : <span>Shapes</span>}</button><button onClick={() => setRightOpen((open) => !open)} title="Toggle properties panel">{rightOpen ? <PanelRightClose size={15} /> : <span>Inspector</span>}</button></div>
    </div>
    <button className="keyboard-button" onClick={() => setShowShortcuts(true)}><Keyboard size={14} /> Shortcuts</button>
     {showShortcuts && <div className="modal-backdrop" onClick={() => setShowShortcuts(false)}><div className="shortcuts-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="panel-kicker">AperGlyph</span><h2>Keyboard shortcuts</h2></div><button className="icon-button" aria-label="Close shortcuts" onClick={() => setShowShortcuts(false)}>×</button></div><div className="shortcut-list"><Shortcut keys="V" label="Select tool" /><Shortcut keys="H" label="Pan canvas" /><Shortcut keys="C" label="Create connector" /><Shortcut keys="T" label="Add text" /><Shortcut keys="← ↑ → ↓" label="Nudge selection" /><Shortcut keys="Shift + arrows" label="Nudge by grid" /><Shortcut keys="Alt + drag" label="Duplicate while dragging" /><Shortcut keys="⌘ K" label="Command palette" /><Shortcut keys="⌘ Z" label="Undo last action" /><Shortcut keys="⌘ ⇧ Z" label="Redo action" /><Shortcut keys="Delete" label="Delete selection" /></div></div></div>}
     {showPalette && <div className="command-palette-backdrop" onMouseDown={() => setShowPalette(false)}><div className="command-palette" onMouseDown={(event) => event.stopPropagation()}><div className="command-palette-search"><span>⌘K</span><input ref={paletteInputRef} aria-label="Search commands" placeholder="Search commands…" value={paletteQuery} onChange={(event) => { setPaletteQuery(event.target.value); setPaletteIndex(0); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setShowPalette(false); } else if (event.key === 'ArrowDown') { event.preventDefault(); setPaletteIndex((index) => Math.min(index + 1, Math.max(0, matchingCommands.length - 1))); } else if (event.key === 'ArrowUp') { event.preventDefault(); setPaletteIndex((index) => Math.max(0, index - 1)); } else if (event.key === 'Enter') { event.preventDefault(); const command = matchingCommands[paletteIndex]; if (command) { command.run(); setShowPalette(false); setPaletteQuery(''); } } }} /></div><div className="command-list">{matchingCommands.length === 0 ? <span className="command-empty">No matching commands</span> : matchingCommands.map((command, index) => <button key={command.id} className={index === paletteIndex ? 'command-item active' : 'command-item'} onMouseEnter={() => setPaletteIndex(index)} onClick={() => { command.run(); setShowPalette(false); setPaletteQuery(''); }}><span>{command.label}</span><small>{command.shortcut ?? command.hint}</small></button>)}</div></div></div>}
   </main>;
}

interface PaletteCommand {
  id: string;
  label: string;
  hint: string;
  shortcut?: string;
  run: () => void;
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return <div className="shortcut-row"><span>{label}</span><kbd>{keys}</kbd></div>;
}
