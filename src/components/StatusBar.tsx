import { HelpCircle, Minus, Plus } from 'lucide-react';
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
  return <div className="status-bar"><div className="status-left"><button className="status-toggle" title="Toggle snapping" aria-label="Toggle snapping" aria-pressed={page?.settings.snapToGrid ?? true} onClick={() => updatePageSettings({ snapToGrid: !(page?.settings.snapToGrid ?? true) }, page?.id, 'Toggle snap')}>Snap {page?.settings.snapToGrid ? 'on' : 'off'}</button></div><div className="status-right"><div className="zoom-control"><button title="Zoom out" aria-label="Zoom out" onClick={() => updateViewport({ zoom: Math.max(.25, viewport.zoom - .1) })}><Minus size={13} /></button><button className="zoom-reset" title="Zoom to 100%" aria-label="Zoom to 100%" onClick={() => updateViewport({ zoom: 1 })}>{zoom}%</button><button title="Zoom in" aria-label="Zoom in" onClick={() => updateViewport({ zoom: Math.min(3, viewport.zoom + .1) })}><Plus size={13} /></button></div><button className="help-button" title="Keyboard shortcuts · ⌘K" aria-label="Keyboard shortcuts" onClick={() => editorEvents.emit('ui:shortcuts', undefined)}><HelpCircle size={15} /></button></div></div>;
}
