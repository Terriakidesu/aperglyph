import { Keyboard, PanelLeftClose, PanelRightClose } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CLIPBOARD_MIME, parseClipboardPayload, serializeClipboardPayload } from '../core/commands';
import { editorEvents } from '../core/events';
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
  const selectAll = useEditorStore((state) => state.selectAll);
  const copySelection = useEditorStore((state) => state.copySelection);
  const cutSelection = useEditorStore((state) => state.cutSelection);
  const pasteClipboard = useEditorStore((state) => state.pasteClipboard);
  const pastePayload = useEditorStore((state) => state.pastePayload);
  const duplicateSelection = useEditorStore((state) => state.duplicateSelection);
  const rotateSelection = useEditorStore((state) => state.rotateSelection);
  const groupSelection = useEditorStore((state) => state.groupSelection);
  const ungroupSelection = useEditorStore((state) => state.ungroupSelection);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const writeSystemClipboard = async () => {
    const payload = copySelection();
    if (!payload) return;
    const serialized = serializeClipboardPayload(payload);
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          [CLIPBOARD_MIME]: new Blob([serialized], { type: CLIPBOARD_MIME }),
          'text/plain': new Blob([serialized], { type: 'text/plain' }),
        })]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(serialized);
      }
    } catch {
      // The command-level clipboard remains available when browser permissions
      // or an insecure context deny system clipboard access.
    }
  };

  const readSystemClipboard = async () => {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (!item.types.includes(CLIPBOARD_MIME)) continue;
          const blob = await item.getType(CLIPBOARD_MIME);
          const payload = parseClipboardPayload(await blob.text());
          if (payload) {
            pastePayload(payload);
            return;
          }
        }
      }
      if (navigator.clipboard?.readText) {
        const payload = parseClipboardPayload(await navigator.clipboard.readText());
        if (payload) {
          pastePayload(payload);
          return;
        }
      }
    } catch {
      // Fall back to the last in-app copy below.
    }
    pasteClipboard();
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, [contenteditable="true"]')) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(); return; }
       if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); void writeSystemClipboard(); return; }
       if (modifier && event.key.toLowerCase() === 'x') { event.preventDefault(); void writeSystemClipboard().finally(cutSelection); return; }
       if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); void readSystemClipboard(); return; }
      if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); return; }
      if (modifier && event.key.toLowerCase() === 'g') { event.preventDefault(); event.shiftKey ? ungroupSelection() : groupSelection(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
      if (event.key === 'Escape') { setTool('select'); return; }
      if (!modifier && event.key.toLowerCase() === 'r') { rotateSelection(); return; }
      const shortcuts: Record<string, typeof activeTool> = { v: 'select', h: 'pan', c: 'connector', t: 'text' };
      if (shortcuts[event.key.toLowerCase()]) setTool(shortcuts[event.key.toLowerCase()]);
      if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); setShowShortcuts(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
   }, [copySelection, cutSelection, deleteSelection, duplicateSelection, groupSelection, pasteClipboard, pastePayload, redo, rotateSelection, selectAll, setTool, ungroupSelection, undo]);

  useEffect(() => editorEvents.on('ui:shortcuts', () => setShowShortcuts(true)), []);

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
