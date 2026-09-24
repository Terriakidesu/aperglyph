import { AlertTriangle, CheckCircle2, ChevronDown, Command, Download, Eye, FileText, History, Maximize2, MoreHorizontal, Redo2, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { editorEvents } from '../core/events';
import { createId } from '../core/document';
import type { DiagramDocument } from '../core/types';
import { copySelectionPng, copySelectionSvg, createWorkspaceBackup, deleteDocumentSnapshot, downloadMermaid, downloadPdf, downloadPng, downloadPlantUml, downloadProject, downloadSql, downloadSvg, downloadWorkspaceBackup, getSnapshotLimit, listDocumentSnapshots, loadDocumentSnapshot, normalizeSnapshotLimit, printDocument, pruneDocumentSnapshots, readDiagramFile, rememberActiveDocument, saveDocumentSnapshot, setSnapshotLimit } from '../persistence';
import type { DocumentSnapshot } from '../persistence';
import { useEditorStore } from '../store/editorStore';
import { LogoMark } from './LogoMark';

interface EditorTopBarProps {
  onExit: () => void;
  onDiagnostics?: () => void;
  diagnosticCount?: number;
  view: ViewPreferences;
  gridVisible: boolean;
  onViewChange: (changes: Partial<ViewPreferences>) => void;
  onToggleGrid: () => void;
  onFitPage: () => void;
  onFitSelection: () => void;
  onZoom100: () => void;
  onToggleFocus: () => void;
  onToggleFullscreen: () => void;
  onTogglePresentation: () => void;
  fullscreen: boolean;
  focusMode: boolean;
  presentationMode: boolean;
  onOpenDocument?: (document: DiagramDocument) => void;
  onOpenPreferences?: () => void;
}

type ExportScale = 1 | 2 | 4;

export interface ViewPreferences {
  rulers: boolean;
  guides: boolean;
  minimap: boolean;
  showPorts: boolean;
  connectionHints: boolean;
}

export function EditorTopBar({ onExit, onDiagnostics, diagnosticCount = 0, view, gridVisible, onViewChange, onToggleGrid, onFitPage, onFitSelection, onZoom100, onToggleFocus, onToggleFullscreen, onTogglePresentation, fullscreen, focusMode, presentationMode, onOpenDocument, onOpenPreferences }: EditorTopBarProps) {
  const document = useEditorStore((state) => state.document);
  const isDirty = useEditorStore((state) => state.isDirty);
  const canUndo = useEditorStore((state) => state.commandManager.canUndo);
  const canRedo = useEditorStore((state) => state.commandManager.canRedo);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const [exportOpen, setExportOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [exportScale, setExportScale] = useState<ExportScale>(2);
  const [exportPadding, setExportPadding] = useState(32);
  const [transparent, setTransparent] = useState(false);
  const [outlineOnly, setOutlineOnly] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<DocumentSnapshot[]>([]);
  const [snapshotLimit, setSnapshotLimitState] = useState(getSnapshotLimit);
  const [viewOpen, setViewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [documentMenuOpen, setDocumentMenuOpen] = useState(false);
  const [documentInfoOpen, setDocumentInfoOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(document.name);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectionIds = selectedIds.length > 0 ? selectedIds : undefined;
  const inspectDocument = () => { void navigator.clipboard?.writeText(JSON.stringify(document, null, 2)); };
  const closeExport = () => setExportOpen(false);
  useEffect(() => { if (!editingTitle) setTitleDraft(document.name); }, [document.name, editingTitle]);
  const commitTitle = () => {
    const nextName = titleDraft.trim();
    if (nextName && nextName !== document.name) useEditorStore.getState().renameDocument(nextName);
    setEditingTitle(false);
  };
  useEffect(() => {
    const closeMenus = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setExportOpen(false);
      setInspectOpen(false);
      setSnapshotsOpen(false);
      setViewOpen(false);
      setMoreOpen(false);
      setDocumentMenuOpen(false);
      setDocumentInfoOpen(false);
    };
    window.addEventListener('keydown', closeMenus);
    return () => window.removeEventListener('keydown', closeMenus);
  }, []);
  const duplicateCurrentDocument = () => {
    const now = Date.now();
    const duplicate = { ...structuredClone(document), id: createId('doc'), name: `${document.name} copy`, createdAt: now, updatedAt: now };
    onOpenDocument?.(duplicate);
    setDocumentMenuOpen(false);
  };
  const openFile = async (file: File) => {
    try {
      onOpenDocument?.(await readDiagramFile(file));
      setDocumentMenuOpen(false);
    } catch {
      editorEvents.emit('storage:error', { error: new Error('Unable to open this diagram file.') });
    }
  };
  const createBackup = async () => {
    try { downloadWorkspaceBackup(await createWorkspaceBackup(), `${document.name}-workspace-backup.json`); } catch { editorEvents.emit('storage:error', { error: new Error('Unable to create a workspace backup.') }); }
    setDocumentMenuOpen(false);
  };

  const refreshSnapshots = async () => {
    setSnapshots(await listDocumentSnapshots(document.id));
  };

  useEffect(() => {
    if (snapshotsOpen) void refreshSnapshots();
  }, [document.id, snapshotsOpen]);

  const createCheckpoint = async () => {
    const name = globalThis.prompt('Checkpoint name', `${document.name} checkpoint`);
    if (!name?.trim()) return;
    await saveDocumentSnapshot(document, { kind: 'checkpoint', name: name.trim() });
    await refreshSnapshots();
  };

  const restoreSnapshot = async (snapshot: DocumentSnapshot) => {
    if (!globalThis.confirm(`Restore “${snapshot.name ?? 'this snapshot'}”? Current unsaved changes will be replaced.`)) return;
    const restored = await loadDocumentSnapshot(snapshot.id);
    if (!restored) return;
    useEditorStore.getState().setDocument(restored.document);
    setSnapshotsOpen(false);
  };

  const removeSnapshot = async (snapshot: DocumentSnapshot) => {
    await deleteDocumentSnapshot(snapshot.id);
    await refreshSnapshots();
  };

  const changeSnapshotLimit = async (value: number) => {
    const nextLimit = setSnapshotLimit(normalizeSnapshotLimit(value));
    setSnapshotLimitState(nextLimit);
    await pruneDocumentSnapshots(document.id, nextLimit);
    await refreshSnapshots();
  };

  return <>
    <header className="editor-topbar">
      <div className="editor-brand-wrap"><button className="back-to-home" onClick={onExit} aria-label="Back to workspace"><X size={17} /></button><LogoMark compact /><span className="topbar-divider" /><div className="document-title-wrap"><div className="document-title">{editingTitle ? <input className="document-title-input" aria-label="Document title" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={commitTitle} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitTitle(); } if (event.key === 'Escape') { setTitleDraft(document.name); setEditingTitle(false); } }} autoFocus /> : <button className="document-title-button" title="Rename document" onClick={() => setEditingTitle(true)}><strong>{document.name}</strong></button>}<button className="document-menu-toggle" title="Document menu" aria-label="Document menu" aria-expanded={documentMenuOpen} onClick={() => setDocumentMenuOpen((open) => !open)}><ChevronDown size={13} /></button><span><span className={`save-dot ${isDirty ? 'dirty' : ''}`} /> {isDirty ? 'Unsaved changes' : 'Saved locally'}</span></div>{documentMenuOpen && <DocumentMenu onRename={() => { setDocumentMenuOpen(false); setEditingTitle(true); }} onNew={() => { useEditorStore.getState().reset(); rememberActiveDocument(useEditorStore.getState().document.id); setDocumentMenuOpen(false); }} onOpen={() => fileInputRef.current?.click()} onDuplicate={duplicateCurrentDocument} onInfo={() => { setDocumentMenuOpen(false); setDocumentInfoOpen(true); }} onBackup={() => void createBackup()} onPrint={() => { printDocument(document, { pageId: activePageId, contentBounds: true, padding: 32, outlineOnly: true }); setDocumentMenuOpen(false); }} />}{documentInfoOpen && <DocumentInfo document={document} onClose={() => setDocumentInfoOpen(false)} />}</div><input ref={fileInputRef} className="visually-hidden" type="file" accept=".wdiag,.mmd,.mermaid,.puml,.plantuml,.sql,.svg,image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void openFile(file); }} /></div>
          <div className="editor-actions"><div className="history-actions"><button className="icon-button" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)" aria-label="Undo"><Undo2 size={17} /></button><button className="icon-button" disabled={!canRedo} onClick={redo} title="Redo (⌘⇧Z)" aria-label="Redo"><Redo2 size={17} /></button></div><span className="topbar-divider" />
        {onDiagnostics && <button className={`secondary-button diagnostics-button ${diagnosticCount > 0 ? 'has-diagnostics' : ''}`} onClick={onDiagnostics} title={diagnosticCount > 0 ? `Open diagnostics · ${diagnosticCount} issues` : 'No active diagnostics'} aria-label="Open diagnostics">{diagnosticCount > 0 ? <><AlertTriangle size={14} /><span className="diagnostics-label">Diagnostics</span><span>{diagnosticCount}</span></> : <CheckCircle2 size={14} />}</button>}
         <div className="view-menu-wrap"><button className={`secondary-button topbar-view ${viewOpen ? 'active' : ''}`} onClick={() => setViewOpen((open) => !open)} title="Canvas view" aria-haspopup="menu" aria-expanded={viewOpen}><Eye size={14} /> View</button>{viewOpen && <ViewMenu view={view} gridVisible={gridVisible} onViewChange={onViewChange} onToggleGrid={onToggleGrid} onFitPage={onFitPage} onFitSelection={onFitSelection} onZoom100={onZoom100} onToggleFocus={onToggleFocus} onToggleFullscreen={onToggleFullscreen} onTogglePresentation={onTogglePresentation} fullscreen={fullscreen} focusMode={focusMode} presentationMode={presentationMode} />}</div>
         <div className="topbar-export-wrap"><button className="secondary-button topbar-export" onClick={() => setExportOpen((open) => !open)} title="Export diagram" aria-haspopup="menu" aria-expanded={exportOpen}><Download size={15} /> Export</button>{exportOpen && <ExportMenu document={document} activePageId={activePageId} selectionIds={selectionIds} scale={exportScale} padding={exportPadding} transparent={transparent} outlineOnly={outlineOnly} setScale={setExportScale} setPadding={setExportPadding} setTransparent={setTransparent} setOutlineOnly={setOutlineOnly} close={closeExport} />}</div>
         <button className="command-trigger" title="Open command palette · ⌘K" aria-label="Open command palette" onClick={() => editorEvents.emit('ui:palette', undefined)}><Command size={13} /><span>Search</span><kbd>⌘K</kbd></button><div className="topbar-more-wrap"><button className={`icon-button ${moreOpen ? 'active' : ''}`} title="More editor actions" aria-label="More editor actions" onClick={() => setMoreOpen((open) => !open)}><MoreHorizontal size={18} /></button>{moreOpen && <MoreMenu onInspect={() => { setInspectOpen(true); setMoreOpen(false); }} onHistory={() => { setMoreOpen(false); setSnapshotsOpen(true); }} onShortcuts={() => { setMoreOpen(false); editorEvents.emit('ui:shortcuts', undefined); }} onPreferences={() => { setMoreOpen(false); onOpenPreferences?.(); }} />}{snapshotsOpen && <SnapshotMenu snapshots={snapshots} snapshotLimit={snapshotLimit} onLimitChange={(value) => void changeSnapshotLimit(value)} onCheckpoint={() => void createCheckpoint()} onRestore={(snapshot) => void restoreSnapshot(snapshot)} onDelete={(snapshot) => void removeSnapshot(snapshot)} />}</div>
      </div>
    </header>
    {inspectOpen && <div className="inspect-drawer"><div className="inspect-heading"><strong>Document inspector</strong><div><button className="secondary-button" onClick={inspectDocument}>Copy JSON</button><button className="icon-button" onClick={() => setInspectOpen(false)} aria-label="Close inspector"><X size={15} /></button></div></div><pre>{JSON.stringify(document, null, 2)}</pre></div>}
  </>;
}

function DocumentMenu({ onRename, onNew, onOpen, onDuplicate, onInfo, onBackup, onPrint }: { onRename: () => void; onNew: () => void; onOpen: () => void; onDuplicate: () => void; onInfo: () => void; onBackup: () => void; onPrint: () => void }) {
  return <div className="topbar-menu document-menu" onPointerDown={(event) => event.stopPropagation()}><strong>Document</strong><button onClick={onRename}>Rename</button><button onClick={onNew}>New diagram</button><button onClick={onOpen}>Open / Import</button><button onClick={onDuplicate}>Duplicate document</button><div className="view-menu-divider" /><button onClick={onInfo}><FileText size={13} /> Document information</button><button onClick={onBackup}>Workspace backup</button><button onClick={onPrint}>Print</button></div>;
}

function DocumentInfo({ document, onClose }: { document: DiagramDocument; onClose: () => void }) {
  const pageObjects = document.pages.reduce((total, page) => total + page.nodes.length + page.edges.length, 0);
  return <div className="document-info-popover"><div><strong>Document information</strong><button className="icon-button" aria-label="Close document information" onClick={onClose}><X size={14} /></button></div><dl><dt>Name</dt><dd>{document.name}</dd><dt>Type</dt><dd>{document.diagramType}</dd><dt>Pages</dt><dd>{document.pages.length}</dd><dt>Objects</dt><dd>{pageObjects}</dd><dt>Created</dt><dd>{new Date(document.createdAt).toLocaleString()}</dd><dt>Updated</dt><dd>{new Date(document.updatedAt).toLocaleString()}</dd></dl></div>;
}

function MoreMenu({ onInspect, onHistory, onShortcuts, onPreferences }: { onInspect: () => void; onHistory: () => void; onShortcuts: () => void; onPreferences: () => void }) {
  return <div className="topbar-menu more-menu" onPointerDown={(event) => event.stopPropagation()}>
    <strong>More editor actions</strong>
    <button onClick={onHistory}><History size={13} /> History</button>
    <button onClick={onInspect}>Inspect document</button>
    <button onClick={onShortcuts}>Keyboard shortcuts</button>
    <button onClick={onPreferences}>Preferences</button>
  </div>;
}

function ViewMenu({ view, gridVisible, onViewChange, onToggleGrid, onFitPage, onFitSelection, onZoom100, onToggleFocus, onToggleFullscreen, onTogglePresentation, fullscreen, focusMode, presentationMode }: { view: ViewPreferences; gridVisible: boolean; onViewChange: (changes: Partial<ViewPreferences>) => void; onToggleGrid: () => void; onFitPage: () => void; onFitSelection: () => void; onZoom100: () => void; onToggleFocus: () => void; onToggleFullscreen: () => void; onTogglePresentation: () => void; fullscreen: boolean; focusMode: boolean; presentationMode: boolean }) {
  return <div className="topbar-menu view-menu" onPointerDown={(event) => event.stopPropagation()}>
    <strong>Canvas view</strong>
    <ViewToggle label="Grid" value={gridVisible} onClick={onToggleGrid} />
    <ViewToggle label="Rulers" value={view.rulers} onClick={() => onViewChange({ rulers: !view.rulers })} />
    <ViewToggle label="Guides" value={view.guides} onClick={() => onViewChange({ guides: !view.guides })} />
    <ViewToggle label="Minimap" value={view.minimap} onClick={() => onViewChange({ minimap: !view.minimap })} />
    <ViewToggle label="Show ports" value={view.showPorts} onClick={() => onViewChange({ showPorts: !view.showPorts })} />
    <ViewToggle label="Canvas hints" value={view.connectionHints} onClick={() => onViewChange({ connectionHints: !view.connectionHints })} />
    <div className="view-menu-divider" />
    <button onClick={onFitPage}>Fit page</button>
    <button onClick={onFitSelection}>Fit selection</button>
    <button onClick={onZoom100}>100% zoom</button>
    <div className="view-menu-divider" />
    <button onClick={onToggleFocus}>{focusMode ? 'Exit focus mode' : 'Focus mode'}</button>
    <button onClick={onTogglePresentation}>{presentationMode ? 'Exit presentation' : 'Presentation'}</button>
    <button onClick={onToggleFullscreen}><Maximize2 size={13} /> {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
  </div>;
}

function ViewToggle({ label, value, onClick }: { label: string; value: boolean; onClick: () => void }) {
  return <button className={`view-menu-toggle ${value ? 'enabled' : ''}`} aria-pressed={value} onClick={onClick}><span>{label}</span><small>{value ? 'On' : 'Off'}</small></button>;
}

function SnapshotMenu({ snapshots, snapshotLimit, onLimitChange, onCheckpoint, onRestore, onDelete }: { snapshots: DocumentSnapshot[]; snapshotLimit: number; onLimitChange: (value: number) => void; onCheckpoint: () => void; onRestore: (snapshot: DocumentSnapshot) => void; onDelete: (snapshot: DocumentSnapshot) => void }) {
  return <div className="topbar-menu snapshot-menu" onPointerDown={(event) => event.stopPropagation()}><div className="snapshot-menu-heading"><strong>Local snapshots</strong><span>{snapshots.length} / {snapshotLimit} retained</span></div><label className="snapshot-limit">Keep <select aria-label="Snapshot retention limit" value={snapshotLimit} onChange={(event) => onLimitChange(Number(event.target.value))}><option value="12">12 snapshots</option><option value="31">31 snapshots</option><option value="90">90 snapshots</option><option value="180">180 snapshots</option><option value="365">365 snapshots</option></select></label><button className="snapshot-create" onClick={onCheckpoint}>+ Create named checkpoint</button>{snapshots.length === 0 ? <span className="snapshot-empty">No snapshots yet. Automatic snapshots are kept hourly.</span> : <div className="snapshot-list">{snapshots.map((snapshot) => <div className="snapshot-row" key={snapshot.id}><button className="snapshot-restore" onClick={() => onRestore(snapshot)}><span>{snapshot.name ?? (snapshot.kind === 'checkpoint' ? 'Checkpoint' : 'Automatic snapshot')}</span><small>{snapshot.kind === 'checkpoint' ? 'Checkpoint' : 'Automatic'} · {formatSnapshotTime(snapshot.savedAt)}</small></button><button className="snapshot-delete" title="Delete snapshot" aria-label={`Delete ${snapshot.name ?? 'snapshot'}`} onClick={() => onDelete(snapshot)}>×</button></div>)}</div>}</div>;
}

function formatSnapshotTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(timestamp);
}

function ExportMenu({ document, activePageId, selectionIds, scale, padding, transparent, outlineOnly, setScale, setPadding, setTransparent, setOutlineOnly, close }: { document: Parameters<typeof downloadProject>[0]; activePageId: string; selectionIds?: string[]; scale: ExportScale; padding: number; transparent: boolean; outlineOnly: boolean; setScale: (scale: ExportScale) => void; setPadding: (padding: number) => void; setTransparent: (transparent: boolean) => void; setOutlineOnly: (outlineOnly: boolean) => void; close: () => void }) {
  return <div className="topbar-menu export-menu" onPointerDown={(event) => event.stopPropagation()}>
    <strong>Export diagram</strong>
    <button onClick={() => { downloadProject(document); close(); }}>AperGlyph project (.wdiag)</button>
    <button onClick={() => { downloadMermaid(document, activePageId); close(); }}>Mermaid (.mmd)</button>
    <button onClick={() => { downloadPlantUml(document, activePageId); close(); }}>PlantUML (.puml)</button>
    {document.diagramType === 'erd' && <button onClick={() => { downloadSql(document, activePageId); close(); }}>SQL schema (.sql)</button>}
     <div className="export-options"><label>Scale<select value={scale} onChange={(event) => setScale(Number(event.target.value) as ExportScale)}><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label><label>Padding<input aria-label="Export padding" type="number" min="0" max="240" step="4" value={padding} onChange={(event) => setPadding(Math.min(240, Math.max(0, Number(event.target.value) || 0)))} /></label><button className={transparent ? 'export-toggle active' : 'export-toggle'} onClick={() => setTransparent(!transparent)}>Transparent background</button><button className={outlineOnly ? 'export-toggle active' : 'export-toggle'} onClick={() => setOutlineOnly(!outlineOnly)}>{outlineOnly ? 'Color export' : 'Outline-only for print'}</button></div>
     <button onClick={() => { printDocument(document, { pageId: activePageId, contentBounds: true, padding, outlineOnly: true }); close(); }}>Print current page · outline-only</button>
     <button onClick={() => { downloadSvg(document, activePageId, { contentBounds: true, padding, transparent, outlineOnly, selectionIds }); close(); }}>{selectionIds ? 'SVG · selection' : 'SVG · current page'}</button>
     {selectionIds && <><button onClick={() => { void copySelectionSvg(document, activePageId, selectionIds); close(); }}>Copy selection · SVG</button><button onClick={() => { void copySelectionPng(document, activePageId, selectionIds, scale); close(); }}>Copy selection · PNG</button></>}
     <button onClick={() => { void downloadPng(document, { pageId: activePageId, contentBounds: true, padding, selectionIds, scale, transparent, outlineOnly }); close(); }}>{selectionIds ? 'PNG · selection' : 'PNG · current page'}</button>
     <button onClick={() => { void downloadPng(document, { allPages: true, contentBounds: true, padding, scale, transparent, outlineOnly }); close(); }}>PNG · all pages</button>
     <button onClick={() => { void downloadPdf(document, { pageId: activePageId, contentBounds: true, padding, selectionIds, scale, transparent, outlineOnly }); close(); }}>{selectionIds ? 'PDF · selection' : 'PDF · current page'}</button>
     <button onClick={() => { void downloadPdf(document, { contentBounds: true, padding, scale, transparent, outlineOnly }); close(); }}>PDF · all pages</button>
  </div>;
}
