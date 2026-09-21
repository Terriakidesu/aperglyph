import { Command, Grid3X3, HelpCircle, Minus, Palette, Plus, Ruler } from 'lucide-react';
import { editorEvents } from '../core/events';
import { getActivePage, useEditorStore } from '../store/editorStore';

export function StatusBar() {
  const viewport = useEditorStore((state) => state.viewport);
  const updateViewport = useEditorStore((state) => state.updateViewport);
  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const updatePageSettings = useEditorStore((state) => state.updatePageSettings);
  const page = getActivePage(document, activePageId);
  const zoom = Math.round(viewport.zoom * 100);
  return <div className="status-bar"><div className="status-left"><span className="status-mode"><span className="status-dot" /> Ready</span><span className="status-divider" /><button className="status-toggle" title="Toggle snapping" aria-label="Toggle snapping" onClick={() => updatePageSettings({ snapToGrid: !(page?.settings.snapToGrid ?? true) }, page?.id, 'Toggle snap')}><Grid3X3 size={13} /> Snap {page?.settings.snapToGrid ? 'on' : 'off'}</button><button className="status-toggle" title="Toggle grid" aria-label="Toggle grid" onClick={() => updatePageSettings({ gridVisible: !(page?.settings.gridVisible ?? true) }, page?.id, 'Toggle grid')}><Ruler size={13} /> {page?.settings.gridSize ?? 16} px grid</button>{page && <label className="status-color" title="Canvas background"><Palette size={13} /><input aria-label="Canvas background" type="color" value={page.settings.background.startsWith('#') ? page.settings.background : '#10131c'} onChange={(event) => updatePageSettings({ background: event.target.value }, page.id, 'Change canvas background')} /></label>}</div><div className="status-right"><span className="shortcut-hint"><Command size={12} /> K for commands</span><span className="status-divider" /><div className="zoom-control"><button title="Zoom out" aria-label="Zoom out" onClick={() => updateViewport({ zoom: Math.max(.25, viewport.zoom - .1) })}><Minus size={13} /></button><button className="zoom-reset" title="Zoom to 100%" aria-label="Zoom to 100%" onClick={() => updateViewport({ zoom: 1 })}>{zoom}%</button><button title="Zoom in" aria-label="Zoom in" onClick={() => updateViewport({ zoom: Math.min(3, viewport.zoom + .1) })}><Plus size={13} /></button></div><button className="help-button" title="Keyboard shortcuts" aria-label="Keyboard shortcuts" onClick={() => editorEvents.emit('ui:shortcuts', undefined)}><HelpCircle size={15} /></button></div></div>;
}
