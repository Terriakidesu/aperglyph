import { ChevronDown, Copy, EyeOff, Group, Link2, Lock, Paintbrush, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { edgeRouting } from '../core/routing';
import type { DiagramDocument, DiagramEdge, DiagramNode } from '../core/types';

interface ContextualToolbarProps {
  kind: 'node' | 'selection' | 'edge';
  x: number;
  y: number;
  nodes?: DiagramNode[];
  grouped?: boolean;
  edge?: DiagramEdge;
  document: DiagramDocument;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleLock: () => void;
  onToggleHidden?: () => void;
  onFormatPainter?: () => void;
  onFill?: (color: string) => void;
  onAlign?: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  onDistribute?: (axis: 'horizontal' | 'vertical') => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onZOrder?: (action: 'forward' | 'backward' | 'front' | 'back') => void;
  onEdgeRouting?: (type: string) => void;
  onReverse?: () => void;
  onSwapMarkers?: () => void;
  onAddWaypoint?: () => void;
  onResetEdge?: () => void;
}

export function ContextualToolbar({ kind, x, y, nodes = [], grouped = false, edge, document, onDuplicate, onDelete, onToggleLock, onToggleHidden, onFormatPainter, onFill, onAlign, onDistribute, onGroup, onUngroup, onZOrder, onEdgeRouting, onReverse, onSwapMarkers, onAddWaypoint, onResetEdge }: ContextualToolbarProps) {
  const [menu, setMenu] = useState<'align' | 'distribute' | 'layer' | 'fill' | null>(null);
  const closeMenu = () => setMenu(null);
  return <div className={`contextual-toolbar contextual-toolbar-${kind}`} style={{ left: x, top: y }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
    {kind === 'edge' && edge ? <>
      <label className="contextual-select"><span>Routing</span><select aria-label="Connector routing" value={edgeRouting(edge)} onChange={(event) => onEdgeRouting?.(event.target.value)}><option value="straight">Straight</option><option value="curved">Curved</option><option value="orthogonal">Orthogonal</option></select></label>
      <button onClick={onReverse} title="Reverse connector"><RotateCcw size={13} /> Reverse</button>
      <button onClick={onSwapMarkers} title="Swap connector markers"><Link2 size={13} /> Markers</button>
      <button onClick={onAddWaypoint} title="Add waypoint">+ Waypoint</button>
      <button onClick={onResetEdge} title="Reset connector route"><RotateCcw size={13} /> Reset</button>
      <button className="contextual-danger" onClick={onDelete} title="Delete connector"><Trash2 size={13} /></button>
    </> : kind === 'selection' ? <>
      <ToolbarMenu label="Align" open={menu === 'align'} onToggle={() => setMenu(menu === 'align' ? null : 'align')}><div className="contextual-menu-grid">{(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((alignment) => <button key={alignment} onClick={() => { onAlign?.(alignment); closeMenu(); }}>{alignment}</button>)}</div></ToolbarMenu>
      <ToolbarMenu label="Distribute" open={menu === 'distribute'} onToggle={() => setMenu(menu === 'distribute' ? null : 'distribute')}><button onClick={() => { onDistribute?.('horizontal'); closeMenu(); }}>Horizontal</button><button onClick={() => { onDistribute?.('vertical'); closeMenu(); }}>Vertical</button></ToolbarMenu>
      {grouped ? <span className="contextual-group-status" title="These objects are grouped"><Group size={13} /> Grouped</span> : <button onClick={onGroup} title="Group selection"><Group size={13} /> Group</button>}<button onClick={onUngroup} title="Ungroup selection">Ungroup</button>
      <ToolbarMenu label="Layer" open={menu === 'layer'} onToggle={() => setMenu(menu === 'layer' ? null : 'layer')}><button onClick={() => { onZOrder?.('front'); closeMenu(); }}>Bring to front</button><button onClick={() => { onZOrder?.('forward'); closeMenu(); }}>Bring forward</button><button onClick={() => { onZOrder?.('backward'); closeMenu(); }}>Send backward</button><button onClick={() => { onZOrder?.('back'); closeMenu(); }}>Send to back</button></ToolbarMenu>
      <button onClick={onToggleLock} title="Lock or unlock selection"><Lock size={13} /> Lock</button><button onClick={onDuplicate} title="Duplicate selection"><Copy size={13} /></button><button className="contextual-danger" onClick={onDelete} title="Delete selection"><Trash2 size={13} /></button>
    </> : <>
      {onFill && <ToolbarMenu label="Fill" open={menu === 'fill'} onToggle={() => setMenu(menu === 'fill' ? null : 'fill')}><div className="contextual-color-grid">{document.palette.slice(0, 8).map((color) => <button key={color} aria-label={`Fill ${color}`} title={color} style={{ background: color }} onClick={() => { onFill(color); closeMenu(); }} />)}</div></ToolbarMenu>}
      {onFormatPainter && <button onClick={onFormatPainter} title="Format painter"><Paintbrush size={13} /> Paint</button>}
      <button onClick={onDuplicate} title="Duplicate selection"><Copy size={13} /> Duplicate</button><button onClick={onToggleLock} title="Lock or unlock selection"><Lock size={13} /></button>{onToggleHidden && <button onClick={onToggleHidden} title="Hide selected object"><EyeOff size={13} /> Hide</button>}
      {onZOrder && <ToolbarMenu label="Layer" open={menu === 'layer'} onToggle={() => setMenu(menu === 'layer' ? null : 'layer')}><button onClick={() => { onZOrder('front'); closeMenu(); }}>Bring to front</button><button onClick={() => { onZOrder('forward'); closeMenu(); }}>Bring forward</button><button onClick={() => { onZOrder('backward'); closeMenu(); }}>Send backward</button><button onClick={() => { onZOrder('back'); closeMenu(); }}>Send to back</button></ToolbarMenu>}
      <button className="contextual-danger" onClick={onDelete} title="Delete selection"><Trash2 size={13} /></button>
    </>}
  </div>;
}

function ToolbarMenu({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <div className="contextual-menu-wrap"><button onClick={onToggle} aria-expanded={open}>{label} <ChevronDown size={11} /></button>{open && <div className="contextual-menu">{children}</div>}</div>;
}
