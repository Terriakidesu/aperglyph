import { Layers3, MoreHorizontal, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getSnapSettings } from '../core/snapping';
import { useEditorStore } from '../store/editorStore';

export function PageTabs() {
  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const setActivePage = useEditorStore((state) => state.setActivePage);
  const createPage = useEditorStore((state) => state.createPage);
  const renamePage = useEditorStore((state) => state.renamePage);
  const duplicatePage = useEditorStore((state) => state.duplicatePage);
  const deletePage = useEditorStore((state) => state.deletePage);
  const reorderPage = useEditorStore((state) => state.reorderPage);
  const updatePageSettings = useEditorStore((state) => state.updatePageSettings);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const activeIndex = document.pages.findIndex((page) => page.id === activePageId);
  const activePage = document.pages[activeIndex] ?? document.pages[0];

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (!tabsRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const promptRename = () => {
    if (!activePage) return;
    const name = window.prompt('Page name', activePage.name);
    if (name !== null) renamePage(activePage.id, name);
    setMenuOpen(false);
  };

  const promptSettings = () => {
    if (!activePage) return;
    const width = Number(window.prompt('Canvas width', String(activePage.settings.width)));
    const height = Number(window.prompt('Canvas height', String(activePage.settings.height)));
    const gridSize = Number(window.prompt('Grid size', String(activePage.settings.gridSize)));
    const background = window.prompt('Canvas background color', activePage.settings.background);
    const changes = {
      ...(Number.isFinite(width) && width >= 320 ? { width } : {}),
      ...(Number.isFinite(height) && height >= 240 ? { height } : {}),
      ...(Number.isFinite(gridSize) && gridSize >= 1 ? { gridSize } : {}),
      ...(background?.trim() ? { background: background.trim() } : {}),
    };
    if (Object.keys(changes).length > 0) updatePageSettings(changes, activePage.id, 'Update page settings');
    setMenuOpen(false);
  };

  const toggleCanvasTheme = () => {
    if (!activePage) return;
    const light = activePage.settings.canvasTheme !== 'light';
    updatePageSettings({ canvasTheme: light ? 'light' : 'dark', background: light ? '#f6f7fb' : '#10131c' }, activePage.id, `Use ${light ? 'light' : 'dark'} canvas`);
    setMenuOpen(false);
  };

  return <div className="page-tabs" ref={tabsRef}>
    <div className="page-tabs-label"><Layers3 size={13} /><span>Pages</span></div>
    <div className="page-tabs-scroll"><div className="page-tabs-inner">
      {document.pages.map((page, index) => <button key={page.id} draggable className={`page-tab ${page.id === activePageId ? 'active' : ''} ${draggedPageId === page.id ? 'dragging' : ''}`} aria-current={page.id === activePageId ? 'page' : undefined} aria-label={`Open page ${index + 1}: ${page.name}`} title={`${page.name} · Double-click to rename · Drag to reorder`} onClick={() => { setActivePage(page.id); setMenuOpen(false); }} onDoubleClick={() => { const name = window.prompt('Page name', page.name); if (name !== null) renamePage(page.id, name); }} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; setDraggedPageId(page.id); }} onDragEnd={() => setDraggedPageId(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!draggedPageId || draggedPageId === page.id) return; const targetIndex = document.pages.findIndex((candidate) => candidate.id === page.id); if (targetIndex >= 0) reorderPage(draggedPageId, targetIndex); setDraggedPageId(null); }}><span className="page-number">{String(index + 1).padStart(2, '0')}</span>{page.name}</button>)}
      <button className="add-page" title="Add page" aria-label="Create page" onClick={() => createPage()}><Plus size={15} /></button>
      <button className={`page-more ${menuOpen ? 'active' : ''}`} title="Page actions" aria-label="Page actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={16} /></button>
        </div></div>
        {menuOpen && activePage && <div className="page-menu" role="menu" aria-label={`Actions for ${activePage.name}`} onPointerDown={(event) => event.stopPropagation()}>
        <strong>{activePage.name}</strong>
        <button onClick={promptRename}>Rename</button>
        <button onClick={() => { duplicatePage(activePage.id); setMenuOpen(false); }}>Duplicate</button>
        <button disabled={activeIndex <= 0} onClick={() => { reorderPage(activePage.id, activeIndex - 1); setMenuOpen(false); }}>Move left</button>
        <button disabled={activeIndex >= document.pages.length - 1} onClick={() => { reorderPage(activePage.id, activeIndex + 1); setMenuOpen(false); }}>Move right</button>
        <button onClick={() => updatePageSettings({ gridVisible: !activePage.settings.gridVisible }, activePage.id, 'Toggle grid')}>{activePage.settings.gridVisible ? 'Hide grid' : 'Show grid'}</button>
         <button onClick={() => updatePageSettings({ snapSettings: { ...getSnapSettings(activePage.settings), grid: !getSnapSettings(activePage.settings).grid } }, activePage.id, 'Toggle grid snapping')}>{getSnapSettings(activePage.settings).grid ? 'Disable grid snapping' : 'Enable grid snapping'}</button>
        <button onClick={toggleCanvasTheme}>Use {activePage.settings.canvasTheme === 'light' ? 'dark' : 'light'} canvas</button>
        <label className="page-color-input">Canvas color<input type="color" value={/^#[0-9a-f]{6}$/i.test(activePage.settings.background) ? activePage.settings.background : '#10131c'} onChange={(event) => updatePageSettings({ background: event.target.value }, activePage.id, 'Change canvas color')} /></label>
        <button onClick={promptSettings}>Page settings</button>
        <button className="context-danger" disabled={document.pages.length <= 1} onClick={() => { deletePage(activePage.id); setMenuOpen(false); }}>Delete</button>
       </div>}
     <span className="page-count">{document.pages.length} page{document.pages.length === 1 ? '' : 's'}</span>
  </div>;
}
