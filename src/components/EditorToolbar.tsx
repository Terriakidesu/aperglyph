import { Grid3X3, Hand, MousePointer2, Plus, Spline, Type, ZoomIn } from 'lucide-react';
import type { ToolId } from '../core/types';
import { useEditorStore } from '../store/editorStore';

const tools: Array<{ id: ToolId; label: string; icon: typeof MousePointer2; shortcut: string }> = [
  { id: 'select', label: 'Select', icon: MousePointer2, shortcut: 'V' },
  { id: 'pan', label: 'Pan canvas', icon: Hand, shortcut: 'H' },
  { id: 'connector', label: 'Connector', icon: Spline, shortcut: 'C' },
  { id: 'text', label: 'Text', icon: Type, shortcut: 'T' },
];

export function EditorToolbar() {
  const activeTool = useEditorStore((state) => state.activeTool);
  const setTool = useEditorStore((state) => state.setTool);
  const viewport = useEditorStore((state) => state.viewport);
  const updateViewport = useEditorStore((state) => state.updateViewport);
  return <aside className="tool-rail">
    <div className="tool-group main-tools">
      {tools.map(({ id, label, icon: Icon, shortcut }) => <button key={id} className={`rail-button ${activeTool === id ? 'active' : ''}`} onClick={() => setTool(id)} title={`${label} (${shortcut})`}><Icon size={18} /><span>{label}</span>{activeTool === id && <i />}</button>)}
    </div>
    <div className="rail-separator" />
    <button className="rail-button rail-add" title="Add shape"><Plus size={18} /><span>Shape</span></button>
    <div className="rail-spacer" />
    <button className="rail-button" title="Toggle grid"><Grid3X3 size={17} /><span>Grid</span></button>
    <button className="rail-button" title="Zoom to fit" onClick={() => updateViewport({ x: 0, y: 0, zoom: 1 })}><ZoomIn size={18} /><span>Fit</span></button>
    <div className="rail-user">AG</div>
  </aside>;
}
