import { Keyboard, ListTree, Maximize2, Minimize2, MonitorPlay, PanelLeftClose, PanelRightClose, Shapes } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CLIPBOARD_MIME, parseClipboardPayload, serializeClipboardPayload } from '../core/commands';
import { createNode as buildNode } from '../core/document';
import { editorEvents } from '../core/events';
import { getActivePage, useEditorStore } from '../store/editorStore';
import { saveLocalTemplate } from '../persistence';
import { CanvasViewport } from './CanvasViewport';
import { EditorToolbar } from './EditorToolbar';
import { EditorTopBar } from './EditorTopBar';
import { PageTabs } from './PageTabs';
import { PropertiesPanel } from './PropertiesPanel';
import { OutlinePanel } from './OutlinePanel';
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
  const [leftOpen, setLeftOpen] = useState(() => readStoredBoolean('aperglyph.editor.left-open', true));
  const [rightOpen, setRightOpen] = useState(() => readStoredBoolean('aperglyph.editor.right-open', true));
  const [leftPanel, setLeftPanel] = useState<'shapes' | 'outline'>(() => readStoredPanel());
  const [focusMode, setFocusMode] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(() => Boolean(globalThis.document?.fullscreenElement));
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
    { id: 'toggle-outline', label: 'Show outline', hint: 'Workspace', run: () => { setLeftPanel('outline'); setLeftOpen(true); } },
    { id: 'toggle-focus', label: focusMode ? 'Exit focus mode' : 'Enter focus mode', hint: 'Workspace', run: () => setFocusMode((value) => !value) },
    { id: 'toggle-presentation', label: presentationMode ? 'Exit presentation mode' : 'Enter presentation mode', hint: 'Workspace', run: () => setPresentationMode((value) => !value) },
    { id: 'save-template', label: 'Save current document as template', hint: 'Templates', run: () => { const name = globalThis.prompt('Template name', document.name); if (name?.trim()) saveLocalTemplate(document, name); } },
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
    try {
      globalThis.localStorage?.setItem('aperglyph.editor.left-open', JSON.stringify(leftOpen));
      globalThis.localStorage?.setItem('aperglyph.editor.right-open', JSON.stringify(rightOpen));
      globalThis.localStorage?.setItem('aperglyph.editor.left-panel', leftPanel);
    } catch {
      // Local UI preferences are optional.
    }
  }, [leftOpen, leftPanel, rightOpen]);

  const viewportKey = `${document.id}:${activePageId}`;
  const restoredViewportKey = useRef<string | null>(null);
  const skipViewportSaveKey = useRef<string | null>(null);
  useEffect(() => {
    if (restoredViewportKey.current === viewportKey) return;
    restoredViewportKey.current = viewportKey;
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(`aperglyph.viewport.${viewportKey}`) ?? 'null') as { x?: number; y?: number; zoom?: number } | null;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.zoom)) {
        skipViewportSaveKey.current = viewportKey;
        useEditorStore.getState().updateViewport({ x: saved.x, y: saved.y, zoom: saved.zoom });
      }
    } catch {
      // Preferred zoom is optional local UI state.
    }
  }, [viewportKey]);

  useEffect(() => {
    if (skipViewportSaveKey.current === viewportKey) {
      skipViewportSaveKey.current = null;
      return;
    }
    try {
      globalThis.localStorage?.setItem(`aperglyph.viewport.${viewportKey}`, JSON.stringify(viewport));
    } catch {
      // Preferred zoom is optional local UI state.
    }
  }, [viewport, viewportKey]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(globalThis.document?.fullscreenElement));
    globalThis.document?.addEventListener('fullscreenchange', onFullscreenChange);
    return () => globalThis.document?.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (globalThis.document?.fullscreenElement) await globalThis.document.exitFullscreen?.();
      else await globalThis.document?.documentElement.requestFullscreen?.();
    } catch {
      // Fullscreen is optional and may be blocked by the browser.
    }
  };

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
      if (event.key === 'Escape') { editorEvents.emit('interaction:cancel', undefined); setShowPalette(false); setShowShortcuts(false); setFocusMode(false); setPresentationMode(false); setTool('select'); return; }
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

  return <main className={`editor-shell ${focusMode ? 'focus-mode' : ''} ${presentationMode ? 'presentation-mode' : ''}`}>
    <EditorTopBar onExit={onExit} />
    <div className="editor-workspace">
      <EditorToolbar />
      {leftOpen && (leftPanel === 'outline' ? <OutlinePanel /> : <ShapeLibrary />)}
      <section className="canvas-column"><CanvasViewport /><PageTabs /><StatusBar /></section>
      {rightOpen && <PropertiesPanel />}
      <div className="workspace-toggles"><button onClick={() => { setLeftPanel('outline'); setLeftOpen(true); }} title="Show outline" aria-label="Show outline"><ListTree size={14} /></button><button onClick={() => { setLeftPanel('shapes'); setLeftOpen(true); }} title="Show shapes" aria-label="Show shapes"><Shapes size={14} /></button><button onClick={() => setLeftOpen((open) => !open)} title="Toggle left panel" aria-label="Toggle left panel">{leftOpen ? <PanelLeftClose size={15} /> : <span>Left</span>}</button><button onClick={() => setRightOpen((open) => !open)} title="Toggle properties panel" aria-label="Toggle properties panel">{rightOpen ? <PanelRightClose size={15} /> : <span>Inspector</span>}</button><button onClick={() => setFocusMode((value) => !value)} title={focusMode ? 'Exit focus mode' : 'Focus mode'} aria-label={focusMode ? 'Exit focus mode' : 'Focus mode'}><Maximize2 size={14} /></button><button onClick={() => setPresentationMode((value) => !value)} title={presentationMode ? 'Exit presentation mode' : 'Presentation mode'} aria-label={presentationMode ? 'Exit presentation mode' : 'Presentation mode'}><MonitorPlay size={14} /></button><button onClick={() => void toggleFullscreen()} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>{fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button></div>
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

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return value === null || value === undefined ? fallback : JSON.parse(value) === true;
  } catch {
    return fallback;
  }
}

function readStoredPanel(): 'shapes' | 'outline' {
  try {
    return globalThis.localStorage?.getItem('aperglyph.editor.left-panel') === 'outline' ? 'outline' : 'shapes';
  } catch {
    return 'shapes';
  }
}
