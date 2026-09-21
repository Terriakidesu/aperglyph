import { AlignCenter, ChevronDown, Copy, Lock, MoreHorizontal, Palette, RotateCw, Trash2, Unlock } from 'lucide-react';
import { useMemo } from 'react';
import { getActivePage } from '../store/editorStore';
import { useEditorStore } from '../store/editorStore';

const swatches = ['#171b28', '#2c2752', '#1f2e43', '#15362f', '#302b24', '#f2f3f7'];

export function PropertiesPanel() {
  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const primaryId = useEditorStore((state) => state.primarySelectedId);
  const updateNode = useEditorStore((state) => state.updateNode);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const page = getActivePage(document, activePageId);
  const selected = useMemo(() => page?.nodes.find((node) => node.id === primaryId), [page, primaryId]);

  if (!selected || selectedIds.length > 1) {
    return <aside className="properties-panel empty-properties"><div className="panel-title-row"><div><span className="panel-kicker">Inspector</span><h2>Properties</h2></div><button className="icon-button"><MoreHorizontal size={17} /></button></div>{selectedIds.length > 1 ? <div className="multi-selection"><div className="multi-icon"><AlignCenter size={20} /></div><strong>{selectedIds.length} objects selected</strong><span>Move or align them together</span><div className="quick-actions"><button><AlignCenter size={14} /> Align</button><button><Copy size={14} /> Duplicate</button></div></div> : <div className="no-selection"><div className="no-selection-art"><div /><div /><div /></div><strong>Nothing selected</strong><span>Select an object to<br />inspect its properties.</span></div>}</aside>;
  }

  const label = typeof selected.data.label === 'string' ? selected.data.label : selected.type;
  const updateLabel = (value: string) => updateNode(selected.id, { data: { label: value } }, 'Edit label');
  return <aside className="properties-panel">
    <div className="panel-title-row"><div><span className="panel-kicker">Inspector</span><h2>Properties</h2></div><button className="icon-button"><MoreHorizontal size={17} /></button></div>
    <div className="selected-summary"><div className={`selected-type-icon ${selected.type}`}><Palette size={16} /></div><div><strong>{selected.type.replace('-', ' ')}</strong><span>{selected.id.slice(0, 16)}</span></div><button className="icon-button"><MoreHorizontal size={16} /></button></div>
    <div className="property-section"><div className="property-heading"><span>Content</span><ChevronDown size={14} /></div><label className="field-label">Label<input value={label} onChange={(event) => updateLabel(event.target.value)} /></label></div>
    <div className="property-section"><div className="property-heading"><span>Layout</span><ChevronDown size={14} /></div><div className="coordinate-grid"><label className="field-label">X<input type="number" value={Math.round(selected.position.x)} onChange={(event) => updateNode(selected.id, { position: { ...selected.position, x: Number(event.target.value) } }, 'Move node')} /></label><label className="field-label">Y<input type="number" value={Math.round(selected.position.y)} onChange={(event) => updateNode(selected.id, { position: { ...selected.position, y: Number(event.target.value) } }, 'Move node')} /></label><label className="field-label">W<input type="number" value={Math.round(selected.size.width)} onChange={(event) => updateNode(selected.id, { size: { ...selected.size, width: Number(event.target.value) } }, 'Resize node')} /></label><label className="field-label">H<input type="number" value={Math.round(selected.size.height)} onChange={(event) => updateNode(selected.id, { size: { ...selected.size, height: Number(event.target.value) } }, 'Resize node')} /></label></div></div>
    <div className="property-section"><div className="property-heading"><span>Appearance</span><ChevronDown size={14} /></div><div className="color-row"><span>Fill</span><div className="swatches">{swatches.map((color) => <button key={color} className={`swatch ${selected.style.fill === color ? 'selected' : ''}`} style={{ background: color }} onClick={() => updateNode(selected.id, { style: { fill: color } }, 'Change fill')} />)}</div></div><div className="color-row"><span>Stroke</span><button className="stroke-preview" style={{ borderColor: selected.style.stroke }} onClick={() => updateNode(selected.id, { style: { stroke: selected.style.stroke === '#59627a' ? '#9c86ff' : '#59627a' } }, 'Change stroke')}><span style={{ background: selected.style.stroke }} /></button></div></div>
    <div className="property-bottom-actions"><button title={selected.locked ? 'Unlock' : 'Lock'} onClick={() => updateNode(selected.id, { locked: !selected.locked }, selected.locked ? 'Unlock node' : 'Lock node')}>{selected.locked ? <Unlock size={15} /> : <Lock size={15} />}</button><button title="Rotate"><RotateCw size={15} /></button><button title="Delete" className="danger" onClick={deleteSelection}><Trash2 size={15} /></button></div>
  </aside>;
}
