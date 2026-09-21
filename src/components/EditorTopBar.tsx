import { CloudOff, Download, MoreHorizontal, Redo2, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { downloadPdf, downloadPng, downloadProject, downloadSvg } from '../persistence';
import { useEditorStore } from '../store/editorStore';
import { LogoMark } from './LogoMark';

interface EditorTopBarProps {
  onExit: () => void;
}

export function EditorTopBar({ onExit }: EditorTopBarProps) {
  const document = useEditorStore((state) => state.document);
  const isDirty = useEditorStore((state) => state.isDirty);
  const canUndo = useEditorStore((state) => state.commandManager.canUndo);
  const canRedo = useEditorStore((state) => state.commandManager.canRedo);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const activePageId = useEditorStore((state) => state.activePageId);
  const [exportOpen, setExportOpen] = useState(false);

  return <header className="editor-topbar">
    <div className="editor-brand-wrap"><button className="back-to-home" onClick={onExit} aria-label="Back to workspace"><X size={17} /></button><LogoMark compact /><span className="topbar-divider" /><div className="document-title"><strong>{document.name}</strong><span><span className={`save-dot ${isDirty ? 'dirty' : ''}`} /> {isDirty ? 'Unsaved changes' : 'Saved locally'}</span></div></div>
    <div className="topbar-center"><div className="mode-switch"><button className="mode-switch-active">Design</button><button>Inspect</button></div></div>
    <div className="editor-actions"><div className="history-actions"><button className="icon-button" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)"><Undo2 size={17} /></button><button className="icon-button" disabled={!canRedo} onClick={redo} title="Redo (⌘⇧Z)"><Redo2 size={17} /></button></div><span className="topbar-divider" /><button className="sync-status"><CloudOff size={15} /> Device only</button><div className="topbar-export-wrap"><button className="secondary-button topbar-export" onClick={() => setExportOpen((open) => !open)}><Download size={15} /> Export</button>{exportOpen && <div className="topbar-menu" onPointerDown={(event) => event.stopPropagation()}><strong>Export diagram</strong><button onClick={() => { downloadProject(document); setExportOpen(false); }}>AperGlyph project (.wdiag)</button><button onClick={() => { downloadSvg(document, activePageId, { contentBounds: true }); setExportOpen(false); }}>SVG · content bounds</button><button onClick={() => { void downloadPng(document, { pageId: activePageId, contentBounds: true, scale: 2 }); setExportOpen(false); }}>PNG · 2×</button><button onClick={() => { void downloadPdf(document, { contentBounds: true, scale: 2 }); setExportOpen(false); }}>PDF · all pages</button></div>}</div><button className="icon-button" title="Export options" onClick={() => setExportOpen((open) => !open)}><MoreHorizontal size={18} /></button></div>
  </header>;
}
