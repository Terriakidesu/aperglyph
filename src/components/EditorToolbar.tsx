import { Hand, MousePointer2, Spline, Type } from 'lucide-react';
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
  return <aside className="tool-rail" aria-label="Editor tools">
    <div className="tool-group main-tools" role="toolbar" aria-label="Canvas tools">
      {tools.map(({ id, label, icon: Icon, shortcut }) => <button key={id} className={`rail-button ${activeTool === id ? 'active' : ''}`} onClick={() => setTool(id)} title={`${label} (${shortcut})`} aria-label={`${label} tool`} aria-pressed={activeTool === id} data-tool={id}><Icon size={18} /><span>{label}</span><kbd className="rail-shortcut">{shortcut}</kbd>{activeTool === id && <i aria-hidden="true" />}</button>)}
    </div>
    <div className="rail-separator" />
    <div className="rail-spacer" />
  </aside>;
}
