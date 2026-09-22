import { Hand, LayoutGrid, MousePointer2, Spline, Type, ZoomIn } from 'lucide-react';
import { useState } from 'react';
import { editorEvents } from '../core/events';
import type { LayoutMode } from '../core/layout';
import type { ToolId } from '../core/types';
import { getActivePage, useEditorStore } from '../store/editorStore';

const tools: Array<{ id: ToolId; label: string; icon: typeof MousePointer2; shortcut: string }> = [
  { id: 'select', label: 'Select', icon: MousePointer2, shortcut: 'V' },
  { id: 'pan', label: 'Pan canvas', icon: Hand, shortcut: 'H' },
  { id: 'connector', label: 'Connector', icon: Spline, shortcut: 'C' },
  { id: 'text', label: 'Text', icon: Type, shortcut: 'T' },
];

export function EditorToolbar() {
  const activeTool = useEditorStore((state) => state.activeTool);
  const setTool = useEditorStore((state) => state.setTool);
  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const autoLayout = useEditorStore((state) => state.autoLayout);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const page = getActivePage(document, activePageId);
  return <aside className="tool-rail">
    <div className="tool-group main-tools">
      {tools.map(({ id, label, icon: Icon, shortcut }) => <button key={id} className={`rail-button ${activeTool === id ? 'active' : ''}`} onClick={() => setTool(id)} title={`${label} (${shortcut})`}><Icon size={18} /><span>{label}</span>{activeTool === id && <i />}</button>)}
    </div>
    <div className="rail-separator" />
     <div className="rail-arrange"><button className={`rail-button ${arrangeOpen ? 'active' : ''}`} title="Arrange layout" onClick={() => setArrangeOpen((open) => !open)}><LayoutGrid size={17} /><span>Arrange</span></button>{arrangeOpen && <div className="rail-popover"><strong>Arrange</strong>{(['hierarchical', 'dag', 'horizontal', 'vertical', 'tree', 'grid', 'compact', 'radial'] as LayoutMode[]).map((mode) => <button key={mode} onClick={() => { void autoLayout(mode); setArrangeOpen(false); }}>{mode.replace('-', ' ')}</button>)}</div>}</div>
    <div className="rail-spacer" />
      <button className="rail-button" title="Fit page" aria-label="Fit page" onClick={() => editorEvents.emit('viewport:fit', { scope: 'page' })}><ZoomIn size={18} /><span>Fit</span></button>
    <div className="rail-user">AG</div>
  </aside>;
}
