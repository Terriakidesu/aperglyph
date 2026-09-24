import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CLIPBOARD_MIME, parseClipboardPayload, serializeClipboardPayload } from '../core/commands';
import { collectDiagnostics, isDiagnosticsEnabled } from '../core/diagnostics';
import { createNode as buildNode } from '../core/document';
import { editorEvents } from '../core/events';
import { getSnapSettings } from '../core/snapping';
import { getActivePage, useEditorStore } from '../store/editorStore';
import { getSnapshotLimit, normalizeSnapshotLimit, readDiagramFile, rememberActiveDocument, saveLocalTemplate, setSnapshotLimit } from '../persistence';
import { CanvasViewport } from './CanvasViewport';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { EditorToolbar } from './EditorToolbar';
import { EditorTopBar, type ViewPreferences } from './EditorTopBar';
import { PageTabs } from './PageTabs';
import { PropertiesPanel } from './PropertiesPanel';
import { OutlinePanel } from './OutlinePanel';
import { PreferencesDialog } from './PreferencesDialog';
import { ShapeLibrary } from './ShapeLibrary';
import { StatusBar } from './StatusBar';

interface EditorScreenProps { onExit: () => void }

const VIEW_PREFERENCES_KEY = 'aperglyph.editor.view';
const DEFAULT_VIEW_PREFERENCES: ViewPreferences = { rulers: true, guides: true, minimap: true, showPorts: false, connectionHints: true };

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
  const clearFormatPainter = useEditorStore((state) => state.clearFormatPainter);
  const document = useEditorStore((state) => state.document);
  const setDocument = useEditorStore((state) => state.setDocument);
  const activePageId = useEditorStore((state) => state.activePageId);
  const viewport = useEditorStore((state) => state.viewport);
  const page = getActivePage(document, activePageId);
  const [leftOpen, setLeftOpen] = useState(() => readStoredBoolean('aperglyph.editor.left-open', true));
  const [rightOpen, setRightOpen] = useState(() => readStoredBoolean('aperglyph.editor.right-open', true));
  const [leftWidth, setLeftWidth] = useState(() => readStoredNumber('aperglyph.editor.left-width', 228, 'left'));
  const [rightWidth, setRightWidth] = useState(() => readStoredNumber('aperglyph.editor.right-width', 288, 'right'));
  const [leftPanel, setLeftPanel] = useState<'shapes' | 'outline'>(() => readStoredPanel());
  const [viewPreferences, setViewPreferences] = useState<ViewPreferences>(() => readViewPreferences());
  const [focusMode, setFocusMode] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(() => Boolean(globalThis.document?.fullscreenElement));
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [snapshotLimit, setSnapshotLimitState] = useState(getSnapshotLimit);
  const [validationEnabled, setValidationEnabled] = useState(isDiagnosticsEnabled);
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const panelResizeRef = useRef<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null);

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
    { id: 'diagnostics', label: 'Open diagnostics', hint: 'Validation', run: () => setShowDiagnostics(true) },
    { id: 'save-template', label: 'Save current document as template', hint: 'Templates', run: () => { const name = globalThis.prompt('Template name', document.name); if (name?.trim()) saveLocalTemplate(document, name); } },
    { id: 'shortcuts', label: 'Open keyboard shortcuts', hint: 'Help', run: () => setShowShortcuts(true) },
  ];
  const matchingCommands = paletteCommands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(paletteQuery.trim().toLowerCase()));
  const diagnosticCount = validationEnabled ? collectDiagnostics(document).filter((diagnostic) => diagnostic.severity !== 'info').length : 0;

  const updateViewPreferences = (changes: Partial<ViewPreferences>) => setViewPreferences((current) => ({ ...current, ...changes }));
  const openDocument = (next: typeof document) => {
    rememberActiveDocument(next.id);
    setDocument(next);
  };

  const importFileAtPoint = async (file: File, point: { x: number; y: number }) => {
    try {
      const imported = await readDiagramFile(file);
      const importedPage = imported.pages[0];
      if (!importedPage || (importedPage.nodes.length === 0 && importedPage.edges.length === 0)) return;
      const points = importedPage.nodes.flatMap((node) => [node.position, { x: node.position.x + node.size.width, y: node.position.y + node.size.height }]);
      const minX = Math.min(...points.map((value) => value.x));
      const maxX = Math.max(...points.map((value) => value.x));
      const minY = Math.min(...points.map((value) => value.y));
      const maxY = Math.max(...points.map((value) => value.y));
      pastePayload({ nodes: importedPage.nodes, edges: importedPage.edges }, { x: point.x - (minX + maxX) / 2, y: point.y - (minY + maxY) / 2 });
    } catch {
      editorEvents.emit('storage:error', { error: new Error('Unable to import this file into the canvas.') });
    }
  };

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
      globalThis.localStorage?.setItem('aperglyph.editor.left-width', String(leftWidth));
      globalThis.localStorage?.setItem('aperglyph.editor.right-width', String(rightWidth));
      globalThis.localStorage?.setItem(VIEW_PREFERENCES_KEY, JSON.stringify(viewPreferences));
    } catch {
      // Local UI preferences are optional.
    }
  }, [leftOpen, leftPanel, leftWidth, rightOpen, rightWidth, viewPreferences]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const resize = panelResizeRef.current;
      if (!resize) return;
      const delta = event.clientX - resize.startX;
      if (resize.side === 'left') setLeftWidth(clampPanelWidth(resize.startWidth + delta, 'left'));
      else setRightWidth(clampPanelWidth(resize.startWidth - delta, 'right'));
    };
    const end = () => {
      if (!panelResizeRef.current) return;
      panelResizeRef.current = null;
      globalThis.document?.body.classList.remove('panel-resizing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  const beginPanelResize = (side: 'left' | 'right', event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    panelResizeRef.current = { side, startX: event.clientX, startWidth: side === 'left' ? leftWidth : rightWidth };
    globalThis.document?.body.classList.add('panel-resizing');
  };

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
       if (event.key === 'Escape') { editorEvents.emit('interaction:cancel', undefined); clearFormatPainter(); setShowPalette(false); setShowShortcuts(false); setShowDiagnostics(false); setFocusMode(false); setPresentationMode(false); setTool('select'); return; }
      if (!modifier && !event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const distance = event.shiftKey ? (page && getSnapSettings(page.settings).grid ? page.settings.gridSize : 10) : 1;
        nudgeSelection({ x: event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0, y: event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0 });
        return;
      }
      if (!modifier && event.key.toLowerCase() === 'r') { rotateSelection(); return; }
      const shortcuts: Record<string, typeof activeTool> = { v: 'select', h: 'pan', c: 'connector', t: 'text' };
      if (shortcuts[event.key.toLowerCase()]) setTool(shortcuts[event.key.toLowerCase()]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    }, [clearFormatPainter, copySelection, cutSelection, deleteSelection, duplicateSelection, groupSelection, nudgeSelection, page?.settings.gridSize, page?.settings.snapToGrid, pasteClipboard, pastePayload, redo, rotateSelection, selectAll, setTool, ungroupSelection, undo]);

  useEffect(() => {
    const unsubscribeShortcuts = editorEvents.on('ui:shortcuts', () => setShowShortcuts(true));
    const unsubscribeDiagnostics = editorEvents.on('ui:diagnostics', () => setShowDiagnostics(true));
    const unsubscribePalette = editorEvents.on('ui:palette', () => { setShowPalette(true); setShowShortcuts(false); });
    const unsubscribePreferences = editorEvents.on('ui:preferences', () => setShowPreferences(true));
    const unsubscribeProperties = editorEvents.on('ui:toggle-properties', () => setRightOpen((open) => !open));
    const unsubscribeSettings = editorEvents.on('diagnostics:changed', ({ enabled }) => setValidationEnabled(enabled));
    return () => { unsubscribeShortcuts(); unsubscribeDiagnostics(); unsubscribePalette(); unsubscribePreferences(); unsubscribeProperties(); unsubscribeSettings(); };
  }, []);

  const workspaceStyle = { '--left-panel-width': `${leftWidth}px`, '--right-panel-width': `${rightWidth}px` } as CSSProperties;
  return <main className={`editor-shell ${focusMode ? 'focus-mode' : ''} ${presentationMode ? 'presentation-mode' : ''}`}>
     <EditorTopBar onExit={onExit} onOpenDocument={openDocument} onOpenPreferences={() => setShowPreferences(true)} onDiagnostics={() => setShowDiagnostics(true)} diagnosticCount={diagnosticCount} view={viewPreferences} gridVisible={page?.settings.gridVisible ?? true} onViewChange={updateViewPreferences} onToggleGrid={() => updatePageSettings({ gridVisible: !(page?.settings.gridVisible ?? true) }, activePageId, 'Toggle grid')} onFitPage={() => editorEvents.emit('viewport:fit', { scope: 'page' })} onFitSelection={() => editorEvents.emit('viewport:fit', { scope: 'selection' })} onZoom100={() => useEditorStore.getState().updateViewport({ zoom: 1 })} onToggleFocus={() => setFocusMode((value) => !value)} onToggleFullscreen={() => void toggleFullscreen()} onTogglePresentation={() => setPresentationMode((value) => !value)} fullscreen={fullscreen} focusMode={focusMode} presentationMode={presentationMode} />
    <div className="editor-workspace" style={workspaceStyle}>
      <EditorToolbar />
      {leftOpen && (leftPanel === 'outline' ? <OutlinePanel activePanel={leftPanel} onPanelChange={setLeftPanel} onCollapse={() => setLeftOpen(false)} /> : <ShapeLibrary activePanel={leftPanel} onPanelChange={setLeftPanel} onCollapse={() => setLeftOpen(false)} />)}
      {leftOpen && <PanelResizeHandle side="left" width={leftWidth} onWidthChange={(value) => setLeftWidth(clampPanelWidth(value, 'left'))} onPointerDown={(event) => beginPanelResize('left', event)} />}
       <section className="canvas-column"><CanvasViewport onImportFile={importFileAtPoint} view={viewPreferences} /><PageTabs /><StatusBar /></section>
      {rightOpen && <PanelResizeHandle side="right" width={rightWidth} onWidthChange={(value) => setRightWidth(clampPanelWidth(value, 'right'))} onPointerDown={(event) => beginPanelResize('right', event)} />}
       {rightOpen && <PropertiesPanel />}
       {!leftOpen && <DockReopenButton side="left" onClick={() => setLeftOpen(true)} />}
       {!rightOpen && <DockReopenButton side="right" onClick={() => setRightOpen(true)} />}
      </div>
      {showDiagnostics && <DiagnosticsPanel onClose={() => setShowDiagnostics(false)} />}
      {showPreferences && <PreferencesDialog view={viewPreferences} onViewChange={updateViewPreferences} pageSettings={page?.settings} onPageSettingsChange={(changes) => updatePageSettings(changes, activePageId, 'Update preferences')} leftWidth={leftWidth} rightWidth={rightWidth} onWidthChange={(side, value) => side === 'left' ? setLeftWidth(clampPanelWidth(value, 'left')) : setRightWidth(clampPanelWidth(value, 'right'))} snapshotLimit={snapshotLimit} onSnapshotLimitChange={(value) => { const next = setSnapshotLimit(normalizeSnapshotLimit(value)); setSnapshotLimitState(next); }} onRestoreDefaults={() => { setViewPreferences(DEFAULT_VIEW_PREFERENCES); setLeftWidth(228); setRightWidth(288); setSnapshotLimitState(setSnapshotLimit(31)); if (page) updatePageSettings({ gridSize: 16, snapSettings: { grid: true, objects: true, guides: true, ports: true } }, page.id, 'Restore editor defaults'); }} onClose={() => setShowPreferences(false)} />}
     {showShortcuts && <div className="modal-backdrop" onClick={() => setShowShortcuts(false)}><div className="shortcuts-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="panel-kicker">AperGlyph</span><h2>Keyboard shortcuts</h2></div><button className="icon-button" aria-label="Close shortcuts" onClick={() => setShowShortcuts(false)}>×</button></div><div className="shortcut-list"><Shortcut keys="V" label="Select tool" /><Shortcut keys="H" label="Pan tool" /><Shortcut keys="Space + drag" label="Temporarily pan canvas" /><Shortcut keys="C" label="Create connector" /><Shortcut keys="T" label="Add text" /><Shortcut keys="← ↑ → ↓" label="Nudge selection" /><Shortcut keys="Shift + arrows" label="Nudge by grid" /><Shortcut keys="Alt + drag" label="Duplicate while dragging" /><Shortcut keys="⌘ K" label="Command palette" /><Shortcut keys="⌘ Z" label="Undo last action" /><Shortcut keys="⌘ ⇧ Z" label="Redo action" /><Shortcut keys="Delete" label="Delete selection" /></div></div></div>}
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

function readStoredNumber(key: string, fallback: number, side: 'left' | 'right'): number {
  try {
    const stored = globalThis.localStorage?.getItem(key);
    if (stored === null || stored === undefined || stored.trim() === '') return fallback;
    const value = Number(stored);
    return Number.isFinite(value) ? clampPanelWidth(value, side) : fallback;
  } catch {
    return fallback;
  }
}

function clampPanelWidth(value: number, side: 'left' | 'right' = 'left'): number {
  return side === 'right' ? Math.min(400, Math.max(220, Math.round(value))) : Math.min(360, Math.max(180, Math.round(value)));
}

function readViewPreferences(): ViewPreferences {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(VIEW_PREFERENCES_KEY) ?? 'null') as Partial<ViewPreferences> | null;
    if (!value || typeof value !== 'object') return DEFAULT_VIEW_PREFERENCES;
    return {
      rulers: typeof value.rulers === 'boolean' ? value.rulers : DEFAULT_VIEW_PREFERENCES.rulers,
      guides: typeof value.guides === 'boolean' ? value.guides : DEFAULT_VIEW_PREFERENCES.guides,
      minimap: typeof value.minimap === 'boolean' ? value.minimap : DEFAULT_VIEW_PREFERENCES.minimap,
      showPorts: typeof value.showPorts === 'boolean' ? value.showPorts : DEFAULT_VIEW_PREFERENCES.showPorts,
      connectionHints: typeof value.connectionHints === 'boolean' ? value.connectionHints : DEFAULT_VIEW_PREFERENCES.connectionHints,
    };
  } catch {
    return DEFAULT_VIEW_PREFERENCES;
  }
}

function PanelResizeHandle({ side, width, onWidthChange, onPointerDown }: { side: 'left' | 'right'; width: number; onWidthChange: (width: number) => void; onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void }) {
  const minimum = side === 'right' ? 220 : 180;
  const maximum = side === 'right' ? 400 : 360;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 40 : 10;
    const direction = event.key === 'ArrowRight' ? (side === 'left' ? 1 : -1) : event.key === 'ArrowLeft' ? (side === 'left' ? -1 : 1) : 0;
    if (direction !== 0) {
      event.preventDefault();
      onWidthChange(width + direction * step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onWidthChange(minimum);
    } else if (event.key === 'End') {
      event.preventDefault();
      onWidthChange(maximum);
    }
  };
  return <div className={`panel-resize-handle panel-resize-${side}`} role="separator" tabIndex={0} aria-label={`Resize ${side} panel`} aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width} aria-valuetext={`${width}px`} onKeyDown={onKeyDown} onPointerDown={onPointerDown} />;
}

function DockReopenButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const left = side === 'left';
  return <button className={`dock-reopen dock-reopen-${side}`} title={`Open ${left ? 'workspace' : 'properties'} panel`} aria-label={`Open ${left ? 'workspace' : 'properties'} panel`} onClick={onClick}>{left ? <PanelLeftOpen size={15} /> : <PanelRightOpen size={15} />}</button>;
}
