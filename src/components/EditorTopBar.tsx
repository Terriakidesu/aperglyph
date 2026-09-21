import { CloudOff, Download, History, MoreHorizontal, Redo2, Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { deleteDocumentSnapshot, downloadPdf, downloadPng, downloadProject, downloadSvg, getSnapshotLimit, listDocumentSnapshots, loadDocumentSnapshot, normalizeSnapshotLimit, printDocument, pruneDocumentSnapshots, saveDocumentSnapshot, setSnapshotLimit } from '../persistence';
import type { DocumentSnapshot } from '../persistence';
import { useEditorStore } from '../store/editorStore';
import { LogoMark } from './LogoMark';

interface EditorTopBarProps {
  onExit: () => void;
}

type ExportScale = 1 | 2 | 4;

export function EditorTopBar({ onExit }: EditorTopBarProps) {
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
  const [transparent, setTransparent] = useState(false);
  const [outlineOnly, setOutlineOnly] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<DocumentSnapshot[]>([]);
  const [snapshotLimit, setSnapshotLimitState] = useState(getSnapshotLimit);
  const selectionIds = selectedIds.length > 0 ? selectedIds : undefined;
  const inspectDocument = () => { void navigator.clipboard?.writeText(JSON.stringify(document, null, 2)); };
  const closeExport = () => setExportOpen(false);

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
      <div className="editor-brand-wrap"><button className="back-to-home" onClick={onExit} aria-label="Back to workspace"><X size={17} /></button><LogoMark compact /><span className="topbar-divider" /><div className="document-title"><strong>{document.name}</strong><span><span className={`save-dot ${isDirty ? 'dirty' : ''}`} /> {isDirty ? 'Unsaved changes' : 'Saved locally'}</span></div></div>
      <div className="topbar-center"><div className="mode-switch"><button className={!inspectOpen ? 'mode-switch-active' : ''} onClick={() => setInspectOpen(false)} aria-pressed={!inspectOpen}>Design</button><button className={inspectOpen ? 'mode-switch-active' : ''} onClick={() => setInspectOpen(true)} aria-pressed={inspectOpen}>Inspect</button></div></div>
       <div className="editor-actions"><div className="history-actions"><button className="icon-button" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)"><Undo2 size={17} /></button><button className="icon-button" disabled={!canRedo} onClick={redo} title="Redo (⌘⇧Z)"><Redo2 size={17} /></button></div><span className="topbar-divider" /><div className="snapshot-wrap"><button className="secondary-button topbar-history" onClick={() => setSnapshotsOpen((open) => !open)} title="Local snapshots"><History size={14} /> History</button>{snapshotsOpen && <SnapshotMenu snapshots={snapshots} snapshotLimit={snapshotLimit} onLimitChange={(value) => void changeSnapshotLimit(value)} onCheckpoint={() => void createCheckpoint()} onRestore={(snapshot) => void restoreSnapshot(snapshot)} onDelete={(snapshot) => void removeSnapshot(snapshot)} />}</div><span className="sync-status"><CloudOff size={15} /> Device only</span><div className="topbar-export-wrap"><button className="secondary-button topbar-export" onClick={() => setExportOpen((open) => !open)}><Download size={15} /> Export</button>{exportOpen && <ExportMenu document={document} activePageId={activePageId} selectionIds={selectionIds} scale={exportScale} transparent={transparent} outlineOnly={outlineOnly} setScale={setExportScale} setTransparent={setTransparent} setOutlineOnly={setOutlineOnly} close={closeExport} />}</div><button className="icon-button" title="Export options" onClick={() => setExportOpen((open) => !open)}><MoreHorizontal size={18} /></button></div>
    </header>
    {inspectOpen && <div className="inspect-drawer"><div className="inspect-heading"><strong>Document inspector</strong><div><button className="secondary-button" onClick={inspectDocument}>Copy JSON</button><button className="icon-button" onClick={() => setInspectOpen(false)} aria-label="Close inspector"><X size={15} /></button></div></div><pre>{JSON.stringify(document, null, 2)}</pre></div>}
  </>;
}

function SnapshotMenu({ snapshots, snapshotLimit, onLimitChange, onCheckpoint, onRestore, onDelete }: { snapshots: DocumentSnapshot[]; snapshotLimit: number; onLimitChange: (value: number) => void; onCheckpoint: () => void; onRestore: (snapshot: DocumentSnapshot) => void; onDelete: (snapshot: DocumentSnapshot) => void }) {
  return <div className="topbar-menu snapshot-menu" onPointerDown={(event) => event.stopPropagation()}><div className="snapshot-menu-heading"><strong>Local snapshots</strong><span>{snapshots.length} / {snapshotLimit} retained</span></div><label className="snapshot-limit">Keep <select aria-label="Snapshot retention limit" value={snapshotLimit} onChange={(event) => onLimitChange(Number(event.target.value))}><option value="12">12 snapshots</option><option value="31">31 snapshots</option><option value="90">90 snapshots</option><option value="180">180 snapshots</option><option value="365">365 snapshots</option></select></label><button className="snapshot-create" onClick={onCheckpoint}>+ Create named checkpoint</button>{snapshots.length === 0 ? <span className="snapshot-empty">No snapshots yet. Automatic snapshots are kept hourly.</span> : <div className="snapshot-list">{snapshots.map((snapshot) => <div className="snapshot-row" key={snapshot.id}><button className="snapshot-restore" onClick={() => onRestore(snapshot)}><span>{snapshot.name ?? (snapshot.kind === 'checkpoint' ? 'Checkpoint' : 'Automatic snapshot')}</span><small>{snapshot.kind === 'checkpoint' ? 'Checkpoint' : 'Automatic'} · {formatSnapshotTime(snapshot.savedAt)}</small></button><button className="snapshot-delete" title="Delete snapshot" aria-label={`Delete ${snapshot.name ?? 'snapshot'}`} onClick={() => onDelete(snapshot)}>×</button></div>)}</div>}</div>;
}

function formatSnapshotTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(timestamp);
}

function ExportMenu({ document, activePageId, selectionIds, scale, transparent, outlineOnly, setScale, setTransparent, setOutlineOnly, close }: { document: Parameters<typeof downloadProject>[0]; activePageId: string; selectionIds?: string[]; scale: ExportScale; transparent: boolean; outlineOnly: boolean; setScale: (scale: ExportScale) => void; setTransparent: (transparent: boolean) => void; setOutlineOnly: (outlineOnly: boolean) => void; close: () => void }) {
  return <div className="topbar-menu export-menu" onPointerDown={(event) => event.stopPropagation()}>
    <strong>Export diagram</strong>
    <button onClick={() => { downloadProject(document); close(); }}>AperGlyph project (.wdiag)</button>
    <div className="export-options"><label>Scale<select value={scale} onChange={(event) => setScale(Number(event.target.value) as ExportScale)}><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label><button className={transparent ? 'export-toggle active' : 'export-toggle'} onClick={() => setTransparent(!transparent)}>Transparent background</button><button className={outlineOnly ? 'export-toggle active' : 'export-toggle'} onClick={() => setOutlineOnly(!outlineOnly)}>{outlineOnly ? 'Color export' : 'Outline-only for print'}</button></div>
    <button onClick={() => { printDocument(document, { pageId: activePageId, contentBounds: true, outlineOnly: true }); close(); }}>Print current page · outline-only</button>
    <button onClick={() => { downloadSvg(document, activePageId, { contentBounds: true, transparent, outlineOnly }); close(); }}>SVG · current page</button>
    <button onClick={() => { void downloadPng(document, { pageId: activePageId, contentBounds: true, selectionIds, scale, transparent, outlineOnly }); close(); }}>{selectionIds ? 'PNG · selection' : 'PNG · current page'}</button>
    <button onClick={() => { void downloadPng(document, { allPages: true, contentBounds: true, scale, transparent, outlineOnly }); close(); }}>PNG · all pages</button>
    <button onClick={() => { void downloadPdf(document, { pageId: activePageId, contentBounds: true, selectionIds, scale, transparent, outlineOnly }); close(); }}>{selectionIds ? 'PDF · selection' : 'PDF · current page'}</button>
    <button onClick={() => { void downloadPdf(document, { contentBounds: true, scale, transparent, outlineOnly }); close(); }}>PDF · all pages</button>
  </div>;
}
