import { Keyboard, PanelLeftClose, PanelRightClose, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { CanvasViewport } from './CanvasViewport';
import { EditorToolbar } from './EditorToolbar';
import { EditorTopBar } from './EditorTopBar';
import { PageTabs } from './PageTabs';
import { PropertiesPanel } from './PropertiesPanel';
import { ShapeLibrary } from './ShapeLibrary';
import { StatusBar } from './StatusBar';

interface EditorScreenProps { onExit: () => void }

export function EditorScreen({ onExit }: EditorScreenProps) {
  const activeTool = useEditorStore((state) => state.activeTool);
  const setTool = useEditorStore((state) => state.setTool);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, [contenteditable="true"]')) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
      if (event.key === 'Escape') { setTool('select'); return; }
      const shortcuts: Record<string, typeof activeTool> = { v: 'select', h: 'pan', c: 'connector', t: 'text' };
      if (shortcuts[event.key.toLowerCase()]) setTool(shortcuts[event.key.toLowerCase()]);
      if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); setShowShortcuts(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteSelection, redo, setTool, undo]);

  return <main className="editor-shell">
    <EditorTopBar onExit={onExit} />
    <div className="editor-workspace">
      <EditorToolbar />
      {leftOpen && <ShapeLibrary />}
      <section className="canvas-column"><CanvasViewport /><PageTabs /><StatusBar /></section>
      {rightOpen && <PropertiesPanel />}
      <div className="workspace-toggles"><button onClick={() => setLeftOpen((open) => !open)} title="Toggle shapes panel">{leftOpen ? <PanelLeftClose size={15} /> : <span>Shapes</span>}</button><button onClick={() => setRightOpen((open) => !open)} title="Toggle properties panel">{rightOpen ? <PanelRightClose size={15} /> : <span>Inspector</span>}</button></div>
    </div>
    <button className="keyboard-button" onClick={() => setShowShortcuts(true)}><Keyboard size={14} /> Shortcuts</button>
    {showShortcuts && <div className="modal-backdrop" onClick={() => setShowShortcuts(false)}><div className="shortcuts-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="panel-kicker">AperGlyph</span><h2>Keyboard shortcuts</h2></div><button className="icon-button" onClick={() => setShowShortcuts(false)}>×</button></div><div className="shortcut-list"><Shortcut keys="V" label="Select tool" /><Shortcut keys="H" label="Pan canvas" /><Shortcut keys="C" label="Create connector" /><Shortcut keys="T" label="Add text" /><Shortcut keys="⌘ Z" label="Undo last action" /><Shortcut keys="⌘ ⇧ Z" label="Redo action" /><Shortcut keys="Delete" label="Delete selection" /></div></div></div>}
  </main>;
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return <div className="shortcut-row"><span>{label}</span><kbd>{keys}</kbd></div>;
}
