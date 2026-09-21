import { Command, Grid3X3, HelpCircle, Minus, Plus, Ruler } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';

export function StatusBar() {
  const viewport = useEditorStore((state) => state.viewport);
  const updateViewport = useEditorStore((state) => state.updateViewport);
  const zoom = Math.round(viewport.zoom * 100);
  return <div className="status-bar"><div className="status-left"><span className="status-mode"><span className="status-dot" /> Ready</span><span className="status-divider" /><span><Grid3X3 size={13} /> Snap on</span><span><Ruler size={13} /> 16 px grid</span></div><div className="status-right"><span className="shortcut-hint"><Command size={12} /> K for shortcuts</span><span className="status-divider" /><div className="zoom-control"><button onClick={() => updateViewport({ zoom: Math.max(.25, viewport.zoom - .1) })}><Minus size={13} /></button><span>{zoom}%</span><button onClick={() => updateViewport({ zoom: Math.min(3, viewport.zoom + .1) })}><Plus size={13} /></button></div><button className="help-button"><HelpCircle size={15} /></button></div></div>;
}
