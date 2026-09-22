import { HelpCircle, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { collectDiagnostics, isDiagnosticsEnabled } from '../core/diagnostics';
import { editorEvents } from '../core/events';
import type { Point } from '../core/types';
import { getActivePage, useEditorStore } from '../store/editorStore';

export function StatusBar() {
  const viewport = useEditorStore((state) => state.viewport);
  const updateViewport = useEditorStore((state) => state.updateViewport);
  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const updatePageSettings = useEditorStore((state) => state.updatePageSettings);
  const [validationEnabled, setValidationEnabled] = useState(isDiagnosticsEnabled);
  const [pointer, setPointer] = useState<Point | null>(null);
  useEffect(() => editorEvents.on('diagnostics:changed', ({ enabled }) => setValidationEnabled(enabled)), []);
  useEffect(() => editorEvents.on('pointer:changed', setPointer), []);
  const page = getActivePage(document, activePageId);
  const zoom = Math.round(viewport.zoom * 100);
  const diagnosticCount = validationEnabled ? collectDiagnostics(document, 'page', activePageId).filter((diagnostic) => diagnostic.severity !== 'info').length : 0;
  const selectedNodes = page?.nodes.filter((node) => selectedIds.includes(node.id)) ?? [];
  const selectedCount = selectedIds.length;
  const selectionSize = selectedNodes.length > 0 ? {
    width: Math.max(...selectedNodes.map((node) => node.position.x + node.size.width)) - Math.min(...selectedNodes.map((node) => node.position.x)),
    height: Math.max(...selectedNodes.map((node) => node.position.y + node.size.height)) - Math.min(...selectedNodes.map((node) => node.position.y)),
  } : null;
  return <div className="status-bar"><div className="status-left"><span className="status-mode"><i className="status-dot" /> Ready</span><span className="status-divider" /><span className="status-selection">{selectedCount > 0 ? `${selectedCount} selected` : `${(page?.nodes.length ?? 0) + (page?.edges.length ?? 0)} objects`}</span>{selectionSize ? <span className="status-selection-size">{Math.round(selectionSize.width)} × {Math.round(selectionSize.height)}</span> : <span className="status-coordinate">X {pointer ? Math.round(pointer.x) : '—'} Y {pointer ? Math.round(pointer.y) : '—'}</span>}<button className="status-toggle" title="Toggle snapping" aria-label="Toggle snapping" aria-pressed={page?.settings.snapToGrid ?? true} onClick={() => updatePageSettings({ snapToGrid: !(page?.settings.snapToGrid ?? true) }, page?.id, 'Toggle snap')}>Snap {page?.settings.snapToGrid ? '✓' : 'off'}</button><button className="status-grid" title="Toggle grid" onClick={() => updatePageSettings({ gridVisible: !(page?.settings.gridVisible ?? true) }, page?.id, 'Toggle grid')}>Grid {page?.settings.gridSize ?? 16}px</button><button className={`status-diagnostics ${diagnosticCount > 0 ? 'has-diagnostics' : ''}`} title={diagnosticCount > 0 ? 'Open diagnostics' : 'No active diagnostics'} aria-label="Open diagnostics" onClick={() => editorEvents.emit('ui:diagnostics', undefined)}>Diagnostics{diagnosticCount > 0 && <strong>{diagnosticCount}</strong>}</button></div><div className="status-right"><div className="zoom-control"><button title="Zoom out" aria-label="Zoom out" onClick={() => updateViewport({ zoom: Math.max(.25, viewport.zoom - .1) })}><Minus size={13} /></button><button className="zoom-reset" title="Zoom to 100%" aria-label="Zoom to 100%" onClick={() => updateViewport({ zoom: 1 })}>{zoom}%</button><button title="Zoom in" aria-label="Zoom in" onClick={() => updateViewport({ zoom: Math.min(3, viewport.zoom + .1) })}><Plus size={13} /></button></div><button className="help-button" title="Keyboard shortcuts · ⌘K" aria-label="Keyboard shortcuts" onClick={() => editorEvents.emit('ui:shortcuts', undefined)}><HelpCircle size={15} /></button></div></div>;
}
