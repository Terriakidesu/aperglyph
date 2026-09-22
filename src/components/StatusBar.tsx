import { AlertTriangle, CheckCircle2, CloudOff, HelpCircle, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { collectDiagnostics, isDiagnosticsEnabled } from '../core/diagnostics';
import { editorEvents } from '../core/events';
import { getSnapSettings } from '../core/snapping';
import type { Point, SnapSettings } from '../core/types';
import { getActivePage, useEditorStore } from '../store/editorStore';

const zoomOptions = [25, 50, 75, 100, 125, 150, 200];

export function StatusBar() {
  const viewport = useEditorStore((state) => state.viewport);
  const updateViewport = useEditorStore((state) => state.updateViewport);
  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const updatePageSettings = useEditorStore((state) => state.updatePageSettings);
  const [validationEnabled, setValidationEnabled] = useState(isDiagnosticsEnabled);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [snapOpen, setSnapOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  useEffect(() => editorEvents.on('diagnostics:changed', ({ enabled }) => setValidationEnabled(enabled)), []);
  useEffect(() => editorEvents.on('pointer:changed', setPointer), []);
  const page = getActivePage(document, activePageId);
  const zoom = Math.round(viewport.zoom * 100);
  const snapSettings: SnapSettings = page ? getSnapSettings(page.settings) : { grid: true, objects: true, guides: true, ports: true };
  const diagnosticCount = validationEnabled ? collectDiagnostics(document, 'page', activePageId).filter((diagnostic) => diagnostic.severity !== 'info').length : 0;
  const selectedNodes = page?.nodes.filter((node) => selectedIds.includes(node.id)) ?? [];
  const selectedCount = selectedIds.length;
  const selectionSize = selectedNodes.length > 0 ? {
    width: Math.max(...selectedNodes.map((node) => node.position.x + node.size.width)) - Math.min(...selectedNodes.map((node) => node.position.x)),
    height: Math.max(...selectedNodes.map((node) => node.position.y + node.size.height)) - Math.min(...selectedNodes.map((node) => node.position.y)),
  } : null;
  const toggleSnap = (key: keyof SnapSettings) => {
    if (!page) return;
    updatePageSettings({ snapSettings: { [key]: !snapSettings[key] } }, page.id, `Toggle ${key} snapping`);
  };
  const setZoom = (value: number) => {
    updateViewport({ zoom: value / 100 });
    setZoomOpen(false);
  };
  return <div className="status-bar">
    <div className="status-left">
      <span className="status-mode"><i className="status-dot" /> Ready</span>
      <span className="status-divider" />
      <span className="status-selection">{selectedCount > 0 ? `${selectedCount} selected` : `${(page?.nodes.length ?? 0) + (page?.edges.length ?? 0)} objects`}</span>
      {selectionSize ? <span className="status-selection-size">{Math.round(selectionSize.width)} × {Math.round(selectionSize.height)}</span> : <span className="status-coordinate">X {pointer ? Math.round(pointer.x) : '—'} Y {pointer ? Math.round(pointer.y) : '—'}</span>}
      <div className="status-popover-wrap"><button className={`status-toggle ${snapOpen ? 'active' : ''}`} title="Snap settings" aria-label="Snap settings" aria-expanded={snapOpen} onClick={() => setSnapOpen((open) => !open)}>Snap {Object.values(snapSettings).some(Boolean) ? '✓' : 'off'} ▾</button>{snapOpen && <div className="status-popover snap-popover"><strong>Snap settings</strong>{(['grid', 'objects', 'guides', 'ports'] as Array<keyof SnapSettings>).map((key) => <label key={key}><input type="checkbox" checked={snapSettings[key]} onChange={() => toggleSnap(key)} />{key === 'grid' ? 'Grid' : key === 'objects' ? 'Objects' : key === 'guides' ? 'Guides' : 'Connection ports'}</label>)}<label className="snap-grid-size">Grid size<input aria-label="Snap grid size" type="number" min="1" max="512" value={page?.settings.gridSize ?? 16} onChange={(event) => { if (!page) return; const value = Math.min(512, Math.max(1, Number(event.target.value) || page.settings.gridSize)); updatePageSettings({ gridSize: value }, page.id, 'Change grid size'); }} /> px</label><small>Hold Alt to temporarily disable snapping.</small></div>}</div>
      <button className="status-grid" title="Toggle grid" onClick={() => page && updatePageSettings({ gridVisible: !page.settings.gridVisible }, page.id, 'Toggle grid')}>Grid {page?.settings.gridSize ?? 16}px</button>
      <span className="status-local"><CloudOff size={12} /> Local only</span>
      <button className={`status-diagnostics ${diagnosticCount > 0 ? 'has-diagnostics' : ''}`} title={diagnosticCount > 0 ? 'Open diagnostics' : 'No active diagnostics'} aria-label="Open diagnostics" onClick={() => editorEvents.emit('ui:diagnostics', undefined)}>{diagnosticCount > 0 ? <><AlertTriangle size={12} /> <span>{diagnosticCount} issue{diagnosticCount === 1 ? '' : 's'}</span></> : <CheckCircle2 size={12} />}</button>
    </div>
    <div className="status-right"><div className="zoom-control"><button title="Zoom out" aria-label="Zoom out" onClick={() => updateViewport({ zoom: Math.max(.2, viewport.zoom - .1) })}><Minus size={13} /></button><div className="zoom-popover-wrap"><button className="zoom-reset" title="Zoom percentage" aria-label="Zoom percentage" aria-expanded={zoomOpen} onClick={() => setZoomOpen((open) => !open)}>{zoom}%</button>{zoomOpen && <div className="status-popover zoom-popover"><strong>Zoom</strong>{zoomOptions.map((value) => <button key={value} className={zoom === value ? 'active' : ''} onClick={() => setZoom(value)}>{value}%</button>)}<div className="zoom-popover-divider" /><button onClick={() => { editorEvents.emit('viewport:fit', { scope: 'page' }); setZoomOpen(false); }}>Fit page</button><button onClick={() => { editorEvents.emit('viewport:fit', { scope: 'selection' }); setZoomOpen(false); }}>Fit selection</button></div>}</div><button title="Zoom in" aria-label="Zoom in" onClick={() => updateViewport({ zoom: Math.min(3, viewport.zoom + .1) })}><Plus size={13} /></button></div><button className="help-button" title="Keyboard shortcuts · ⌘K" aria-label="Keyboard shortcuts" onClick={() => editorEvents.emit('ui:shortcuts', undefined)}><HelpCircle size={15} /></button></div>
  </div>;
}
