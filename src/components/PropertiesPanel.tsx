import { AlignCenter, ArrowLeftRight, Brush, ChevronDown, Clipboard, ClipboardPaste, Copy, GitBranch, KeyRound, Link2, Lock, Palette, Plus, RotateCcw, RotateCw, Save, Trash2, Unlock } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { validateDfd } from '../core/dfd';
import { createEntityField, entityAutoHeight, entityVariantOptions, foreignKeyForRelationship, normalizeEntityFields, normalizeEntityIndexes, parseEntityFields, relationshipForForeignKey, validateErd } from '../core/erd';
import { editorEvents } from '../core/events';
import { getSnapSettings } from '../core/snapping';
import { nodeCenter } from '../core/geometry';
import type { DiagramDocument, DiagramEdge, DiagramNode, DiagramPage, EdgeMarker, EdgePatch, EdgeStyle, Endpoint, NodeStyle, Point } from '../core/types';
import { edgeRouting, orthogonalRoutingMode, resolveEndpointPoint } from '../core/routing';
import { pluginManager } from '../plugins';
import { getActivePage, useEditorStore } from '../store/editorStore';
import type { EntityField, EntityReference, EntityVariant, ReferentialAction } from '../core/erd';
import { InspectorDockHeader } from './DockHeader';
import type { LayoutMode } from '../core/layout';

const portOptions = [
  { value: '', label: 'Auto boundary' },
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
];
const markerOptions: Array<{ value: EdgeMarker; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'bar', label: 'Bar · 1' },
  { value: 'circle', label: 'Circle · 0..1' },
  { value: 'crowfoot', label: "Crow's foot · N" },
  { value: 'circle-bar', label: 'Circle + bar · 0..1' },
  { value: 'bar-crowfoot', label: "Bar + crow's foot · 1..N" },
  { value: 'circle-crowfoot', label: "Circle + crow's foot · 0..N" },
];
const cardinalityOptions: Array<{ value: string; label: string; start: EdgeMarker; end: EdgeMarker }> = [
  { value: '1:1', label: '1 : 1', start: 'bar', end: 'bar' },
  { value: '1:0..1', label: '1 : 0..1', start: 'bar', end: 'circle-bar' },
  { value: '1:N', label: '1 : N', start: 'bar', end: 'crowfoot' },
  { value: '1:1..N', label: '1 : 1..N', start: 'bar', end: 'bar-crowfoot' },
  { value: '1:0..N', label: '1 : 0..N', start: 'bar', end: 'circle-crowfoot' },
  { value: 'N:N', label: 'N : N', start: 'crowfoot', end: 'crowfoot' },
  { value: '1..N:1..N', label: '1..N : 1..N', start: 'bar-crowfoot', end: 'bar-crowfoot' },
  { value: '0..N:0..N', label: '0..N : 0..N', start: 'circle-crowfoot', end: 'circle-crowfoot' },
];
const arrangeModes: LayoutMode[] = ['hierarchical', 'dag', 'horizontal', 'vertical', 'tree', 'grid', 'compact', 'radial'];

export function PropertiesPanel() {
  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const primaryId = useEditorStore((state) => state.primarySelectedId);
  const page = getActivePage(document, activePageId);
  const selectedNode = useMemo(() => page?.nodes.find((node) => node.id === primaryId), [page, primaryId]);
  const selectedEdge = useMemo(() => page?.edges.find((edge) => edge.id === primaryId), [page, primaryId]);

  if (selectedIds.length > 1) return <MultiSelectionProperties selectedIds={selectedIds} document={document} activePageId={activePageId} />;
  if (selectedEdge) return <EdgePropertiesPanel edge={selectedEdge} nodes={page?.nodes ?? []} diagramType={document.diagramType} document={document} />;
   if (!selectedNode) return <EmptyProperties document={document} page={page} />;
   return <NodePropertiesPanel node={selectedNode} document={document} activePageId={activePageId} />;
}

function EmptyProperties({ document, page }: { document: DiagramDocument; page?: DiagramPage }) {
  const updatePageSettings = useEditorStore((state) => state.updatePageSettings);
  const settings = page?.settings;
  return <aside className="properties-panel empty-properties">
     <InspectorHeading />
     {page && <div className="page-summary"><strong>{page.name}</strong><span>Page settings · nothing selected</span></div>}
     {settings && <>
       <InspectorSection id="page.canvas" title="Canvas"><label className="field-label">Background<div className="page-background-field"><input aria-label="Page background" type="color" value={/^#[0-9a-f]{6}$/i.test(settings.background) ? settings.background : '#10131c'} onChange={(event) => updatePageSettings({ background: event.target.value }, page?.id, 'Change page background')} /><span>{settings.background}</span></div></label><div className="coordinate-grid"><label className="field-label">Width<input aria-label="Page width" type="number" min="320" value={settings.width} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 320) updatePageSettings({ width: value }, page?.id, 'Change page width'); }} /></label><label className="field-label">Height<input aria-label="Page height" type="number" min="240" value={settings.height} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 240) updatePageSettings({ height: value }, page?.id, 'Change page height'); }} /></label></div><label className="field-label">Theme<select className="inspector-select" aria-label="Page theme" value={settings.canvasTheme} onChange={(event) => updatePageSettings({ canvasTheme: event.target.value as DiagramPage['settings']['canvasTheme'] }, page?.id, 'Change page theme')}><option value="dark">Dark canvas</option><option value="light">Light canvas</option></select></label></InspectorSection>
       <InspectorSection id="page.grid" title="Grid"><label className="field-label">Grid size<input aria-label="Grid size" type="number" min="1" max="240" value={settings.gridSize} onChange={(event) => updatePageSettings({ gridSize: Math.max(1, Number(event.target.value) || settings.gridSize) }, page?.id, 'Change grid size')} /></label><div className="empty-setting-toggles"><div className="entity-style-toggle"><span>Show grid</span><button className={settings.gridVisible ? 'toggle-button active' : 'toggle-button'} aria-label="Toggle page grid" aria-pressed={settings.gridVisible} onClick={() => updatePageSettings({ gridVisible: !settings.gridVisible }, page?.id, 'Toggle grid')}><span /></button></div><div className="entity-style-toggle"><span>Snap to grid</span><button className={getSnapSettings(settings).grid ? 'toggle-button active' : 'toggle-button'} aria-label="Toggle page snapping" aria-pressed={getSnapSettings(settings).grid} onClick={() => updatePageSettings({ snapSettings: { grid: !getSnapSettings(settings).grid } }, page?.id, 'Toggle grid snapping')}><span /></button></div></div></InspectorSection>
       <InspectorSection id="page.document" title="Document"><div className="page-stat-list"><span><strong>{page.nodes.length}</strong> objects</span><span><strong>{page.edges.length}</strong> connectors</span><span><strong>{document.pages.length}</strong> pages</span></div></InspectorSection>
     </>}
     <InspectorSection id="page.shortcuts" title="Shortcuts"><div className="empty-shortcuts"><span><kbd>V</kbd> Select</span><span><kbd>C</kbd> Connector</span><span><kbd>Space</kbd> Pan</span><span><kbd>⌘ K</kbd> Commands</span></div></InspectorSection>
   </aside>;
 }

function EntityAdvancedFields({ fields, entities, indexes, updateFields, updateIndexes, onCreateRelationship }: { fields: EntityField[]; entities: DiagramNode[]; indexes: ReturnType<typeof normalizeEntityIndexes>; updateFields: (fields: EntityField[], action?: string) => void; updateIndexes: (indexes: ReturnType<typeof normalizeEntityIndexes>, action?: string) => void; onCreateRelationship: (fieldId: string) => void }) {
  const [pasteText, setPasteText] = useState('');
  const updateField = (index: number, changes: Partial<EntityField>) => updateFields(fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...changes } : field), 'Edit attribute metadata');
  const moveField = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = fields.slice();
    [next[index], next[target]] = [next[target], next[index]];
    updateFields(next, 'Reorder attributes');
  };
  const addPastedFields = () => {
    const parsed = parseEntityFields(pasteText);
    if (parsed.length === 0) return;
    updateFields([...fields, ...parsed], 'Paste attributes');
    setPasteText('');
  };
  const referenceFor = (field: EntityField): EntityReference | undefined => field.reference;
  const addIndex = () => {
    const selected = fields.filter((field) => field.primaryKey || field.unique).slice(0, 1);
    if (selected.length === 0) return;
    updateIndexes([...indexes, { id: `index_${Date.now().toString(36)}`, name: `idx_${selected[0].name}`, fieldIds: [selected[0].id], unique: false }], 'Add entity index');
  };
  return <InspectorSection id="node.attributes-advanced" title="Attribute tools" className="entity-advanced-properties">
    <label className="field-label">Paste attributes<textarea aria-label="Paste attributes" value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={'id uuid PK\ncustomer_id uuid FK'} rows={3} /></label>
    <button className="secondary-button entity-paste-button" disabled={!pasteText.trim()} onClick={addPastedFields}><ClipboardPaste size={12} /> Add pasted attributes</button>
    <div className="entity-order-list">{fields.map((field, index) => <div className="entity-order-row" key={field.id}><span>{index + 1}. {field.name || 'Unnamed attribute'}</span><button title="Move attribute up" aria-label={`Move attribute ${index + 1} up`} disabled={index === 0} onClick={() => moveField(index, -1)}>↑</button><button title="Move attribute down" aria-label={`Move attribute ${index + 1} down`} disabled={index === fields.length - 1} onClick={() => moveField(index, 1)}>↓</button><button className={field.unique ? 'field-flag active' : 'field-flag'} title="Unique" aria-label={`Unique attribute ${index + 1}`} onClick={() => updateField(index, { unique: !field.unique })}>UQ</button></div>)}</div>
    {fields.map((field, index) => {
      const reference = referenceFor(field);
      const targetEntity = entities.find((entity) => entity.id === reference?.entityId);
      const targetFields = targetEntity ? normalizeEntityFields(targetEntity.data.fields) : [];
      const updateReference = (changes: Partial<EntityReference>) => updateField(index, { foreignKey: true, reference: { ...(reference ?? { entityId: '' }), ...changes } });
       return <div className="entity-field-metadata" key={`metadata-${field.id}`}><strong>{field.name || `Attribute ${index + 1}`}</strong><label className="field-label">Default value<input aria-label={`Attribute ${index + 1} default value`} value={field.defaultValue ?? ''} onChange={(event) => updateField(index, { defaultValue: event.target.value })} /></label><label className="field-label">Description<input aria-label={`Attribute ${index + 1} description`} value={field.description ?? ''} onChange={(event) => updateField(index, { description: event.target.value })} /></label>{field.foreignKey && <><label className="field-label">References entity<select className="inspector-select" aria-label={`Attribute ${index + 1} reference entity`} value={reference?.entityId ?? ''} onChange={(event) => updateReference({ entityId: event.target.value, fieldId: undefined })}><option value="">Choose entity…</option>{entities.map((entity) => <option key={entity.id} value={entity.id}>{nodeLabel(entity)}</option>)}</select></label>{reference?.entityId && <label className="field-label">References field<select className="inspector-select" aria-label={`Attribute ${index + 1} reference field`} value={reference.fieldId ?? ''} onChange={(event) => updateReference({ fieldId: event.target.value || undefined })}><option value="">Any key</option>{targetFields.map((targetField) => <option key={targetField.id} value={targetField.id}>{targetField.name}</option>)}</select></label>}<div className="style-range-row"><label className="field-label">On delete<select className="inspector-select" aria-label={`Attribute ${index + 1} delete action`} value={reference?.onDelete ?? 'NO ACTION'} onChange={(event) => updateReference({ onDelete: event.target.value as ReferentialAction })}><option>NO ACTION</option><option>RESTRICT</option><option>CASCADE</option><option>SET NULL</option></select></label><label className="field-label">On update<select className="inspector-select" aria-label={`Attribute ${index + 1} update action`} value={reference?.onUpdate ?? 'NO ACTION'} onChange={(event) => updateReference({ onUpdate: event.target.value as ReferentialAction })}><option>NO ACTION</option><option>RESTRICT</option><option>CASCADE</option><option>SET NULL</option></select></label></div><button className="text-button" onClick={() => onCreateRelationship(field.id)}>Create relationship</button></>}</div>;
     })}
    <div className="entity-index-list"><strong>Indexes</strong>{indexes.map((index) => <div className="entity-order-row" key={index.id}><span>{index.unique ? 'UNIQUE ' : ''}{index.name} · {index.fieldIds.length} field{index.fieldIds.length === 1 ? '' : 's'}</span><button className="field-delete" title="Delete index" aria-label={`Delete index ${index.name}`} onClick={() => updateIndexes(indexes.filter((candidate) => candidate.id !== index.id), 'Delete entity index')}>×</button></div>)}<button className="secondary-button entity-paste-button" disabled={fields.filter((field) => field.primaryKey || field.unique).length === 0} onClick={addIndex}><Plus size={12} /> Add index</button></div>
  </InspectorSection>;
}

function MultiSelectionProperties({ selectedIds, document, activePageId }: { selectedIds: string[]; document: DiagramDocument; activePageId: string }) {
  const alignSelection = useEditorStore((state) => state.alignSelection);
  const distributeSelection = useEditorStore((state) => state.distributeSelection);
  const duplicateSelection = useEditorStore((state) => state.duplicateSelection);
  const groupSelection = useEditorStore((state) => state.groupSelection);
  const ungroupSelection = useEditorStore((state) => state.ungroupSelection);
  const setZOrder = useEditorStore((state) => state.setZOrder);
  const autoLayout = useEditorStore((state) => state.autoLayout);
  const updateNodes = useEditorStore((state) => state.updateNodes);
  const page = getActivePage(document, activePageId);
  const nodes = page?.nodes.filter((node) => selectedIds.includes(node.id)) ?? [];
  const allLocked = nodes.length > 0 && nodes.every((node) => node.locked);
  return <aside className="properties-panel empty-properties">
    <InspectorHeading />
    <div className="multi-selection"><div className="multi-icon"><AlignCenter size={20} /></div><strong>{selectedIds.length} objects selected</strong><span>{nodes.length > 0 ? 'Edit shared properties or arrange them together' : 'Move or arrange them together'}</span></div>
     {nodes.length > 0 && <InspectorSection id="selection.common" title="Common properties"><StyleControls nodes={nodes} document={document} /><SelectionStyleActions nodes={nodes} document={document} /><button className="selection-lock" title={allLocked ? 'Unlock selection' : 'Lock selection'} onClick={() => updateNodes(nodes.map((node) => node.id), { locked: !allLocked }, allLocked ? 'Unlock selection' : 'Lock selection')}>{allLocked ? <Unlock size={14} /> : <Lock size={14} />} {allLocked ? 'Unlock selection' : 'Lock selection'}</button></InspectorSection>}
     <InspectorSection id="selection.arrange" title="Arrange"><div className="arrange-actions">{arrangeModes.map((mode) => <button key={mode} onClick={() => { void autoLayout(mode); }}>{mode.replace('-', ' ')}</button>)}</div></InspectorSection>
     <div className="quick-actions"><button title="Align left" onClick={() => alignSelection('left')}><AlignCenter size={14} /> Left</button><button title="Align centers" onClick={() => alignSelection('center')}><AlignCenter size={14} /> Center</button><button title="Align right" onClick={() => alignSelection('right')}><AlignCenter size={14} /> Right</button><button title="Align top" onClick={() => alignSelection('top')}><AlignCenter size={14} /> Top</button><button title="Align middle" onClick={() => alignSelection('middle')}><AlignCenter size={14} /> Middle</button><button title="Align bottom" onClick={() => alignSelection('bottom')}><AlignCenter size={14} /> Bottom</button><button title="Distribute horizontally" onClick={() => distributeSelection('horizontal')}><AlignCenter size={14} /> Dist. H</button><button title="Distribute vertically" onClick={() => distributeSelection('vertical')}><AlignCenter size={14} /> Dist. V</button><button title="Fit selection" onClick={() => editorEvents.emit('viewport:fit', { scope: 'selection' })}>Fit selection</button><button title="Duplicate selection" onClick={() => duplicateSelection()}><Copy size={14} /> Duplicate</button><button title="Group selection" onClick={groupSelection}>Group</button><button title="Ungroup selection" onClick={ungroupSelection}>Ungroup</button><button title="Bring selection to front" onClick={() => setZOrder('front')}>Bring front</button><button title="Send selection to back" onClick={() => setZOrder('back')}>Send back</button></div>
  </aside>;
}

function InspectorHeading() {
  return <InspectorDockHeader onCollapse={() => editorEvents.emit('ui:toggle-properties', undefined)} />;
}

const INSPECTOR_SECTIONS_KEY = 'aperglyph.inspector.sections';

function InspectorSection({ id, title, children, action, className = '' }: { id: string; title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(() => {
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(INSPECTOR_SECTIONS_KEY) ?? '{}') as Record<string, boolean>;
      return saved[id] !== false;
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(INSPECTOR_SECTIONS_KEY) ?? '{}') as Record<string, boolean>;
      globalThis.localStorage?.setItem(INSPECTOR_SECTIONS_KEY, JSON.stringify({ ...saved, [id]: next }));
    } catch {
      // Inspector state is a convenience; a storage denial should not block editing.
    }
  };
  return <div className={`property-section ${className} ${open ? '' : 'collapsed'}`}><div className="property-heading" role="button" tabIndex={0} aria-expanded={open} onClick={toggle} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } }}><span>{title}</span><span className="property-heading-actions"><span onClick={(event) => event.stopPropagation()}>{action}</span><ChevronDown size={14} /></span></div>{open && children}</div>;
}

function StyleControls({ nodes, document }: { nodes: DiagramNode[]; document: DiagramDocument }) {
  const updateNodes = useEditorStore((state) => state.updateNodes);
  const updatePalette = useEditorStore((state) => state.updatePalette);
  const [recentColors, setRecentColors] = useState(readRecentColors);
  const nodeIds = nodes.map((node) => node.id);
  const common = <T,>(values: T[]): T | undefined => values.length > 0 && values.every((value) => value === values[0]) ? values[0] : undefined;
  const fill = common(nodes.map((node) => node.style.fill));
  const stroke = common(nodes.map((node) => node.style.stroke));
  const textColor = common(nodes.map((node) => node.style.textColor));
  const strokeWidth = common(nodes.map((node) => node.style.strokeWidth));
  const opacity = common(nodes.map((node) => node.style.opacity));
  const radius = common(nodes.map((node) => node.style.radius));
  const fontSize = common(nodes.map((node) => node.style.fontSize));
  const fontWeight = common(nodes.map((node) => node.style.fontWeight));
  const textAlign = common(nodes.map((node) => node.style.textAlign));
  const verticalAlign = common(nodes.map((node) => node.style.verticalAlign));
  const textWrap = common(nodes.map((node) => node.style.textWrap));
  const autoHeight = common(nodes.map((node) => node.style.autoHeight));
  const setStyle = (style: Partial<NodeStyle>, label: string) => updateNodes(nodeIds, { style }, label);
  const colors = [...new Set([...document.palette, ...recentColors])];
  const rememberColor = (color: string) => rememberRecentColor(color);
  const colorChange = (field: 'fill' | 'stroke' | 'textColor', color: string, label: string) => {
    setRecentColors(rememberColor(color));
    setStyle({ [field]: color } as Partial<NodeStyle>, label);
  };

  return <div className="style-controls">
    <ColorField label="Fill" value={fill} colors={colors} onChange={(color) => colorChange('fill', color, 'Change fill')} onAddToPalette={() => fill && updatePalette([...document.palette, fill])} />
    <ColorField label="Stroke" value={stroke} colors={colors} onChange={(color) => colorChange('stroke', color, 'Change stroke')} onAddToPalette={() => stroke && updatePalette([...document.palette, stroke])} />
    <ColorField label="Text" value={textColor} colors={colors} onChange={(color) => colorChange('textColor', color, 'Change text color')} onAddToPalette={() => textColor && updatePalette([...document.palette, textColor])} />
    <div className="style-range-row"><label className="field-label">Stroke width<input aria-label="Stroke width" type="number" min="0" max="100" step="0.5" value={strokeWidth === undefined ? '' : strokeWidth} placeholder="Mixed" onChange={(event) => { if (event.target.value) setStyle({ strokeWidth: Number(event.target.value) }, 'Change stroke width'); }} /></label><label className="field-label">Radius<input aria-label="Corner radius" type="number" min="0" max="1000" step="1" value={radius === undefined ? '' : radius} placeholder="Mixed" onChange={(event) => { if (event.target.value) setStyle({ radius: Number(event.target.value) }, 'Change corner radius'); }} /></label></div>
    <label className="field-label style-opacity">Opacity <span className="range-value">{opacity === undefined ? 'Mixed' : `${Math.round(opacity * 100)}%`}</span><input aria-label="Opacity" type="range" min="0" max="1" step="0.05" value={opacity ?? 1} onChange={(event) => setStyle({ opacity: Number(event.target.value) }, 'Change opacity')} /></label>
    <div className="style-range-row"><label className="field-label">Text size<input aria-label="Text size" type="number" min="6" max="96" step="1" value={fontSize === undefined ? '' : fontSize} placeholder="Mixed" onChange={(event) => { if (event.target.value) setStyle({ fontSize: Number(event.target.value) }, 'Change text size'); }} /></label><label className="field-label">Weight<select aria-label="Font weight" className="inspector-select" value={fontWeight === undefined ? '' : String(fontWeight)} onChange={(event) => { if (event.target.value) setStyle({ fontWeight: Number(event.target.value) as NodeStyle['fontWeight'] }, 'Change font weight'); }}><option value="">Mixed</option><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option></select></label></div>
    <div className="style-range-row"><label className="field-label">Horizontal<select aria-label="Horizontal text alignment" className="inspector-select" value={textAlign ?? ''} onChange={(event) => { if (event.target.value) setStyle({ textAlign: event.target.value as NodeStyle['textAlign'] }, 'Change horizontal text alignment'); }}><option value="">Mixed</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label className="field-label">Vertical<select aria-label="Vertical text alignment" className="inspector-select" value={verticalAlign ?? ''} onChange={(event) => { if (event.target.value) setStyle({ verticalAlign: event.target.value as NodeStyle['verticalAlign'] }, 'Change vertical text alignment'); }}><option value="">Mixed</option><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label></div>
    <div className="style-toggle-list"><div className="entity-style-toggle"><span>Wrap text</span><button className={textWrap === true ? 'toggle-button active' : 'toggle-button'} aria-label="Toggle text wrapping" aria-pressed={textWrap === true} onClick={() => setStyle({ textWrap: textWrap !== true }, 'Toggle text wrapping')}><span /></button></div><div className="entity-style-toggle"><span>Auto height</span><button className={autoHeight === true ? 'toggle-button active' : 'toggle-button'} aria-label="Toggle automatic node height" aria-pressed={autoHeight === true} onClick={() => setStyle({ autoHeight: autoHeight !== true }, 'Toggle automatic node height')}><span /></button></div></div>
  </div>;
}

function ColorField({ label, value, colors, onChange, onAddToPalette }: { label: string; value?: string; colors: string[]; onChange: (color: string) => void; onAddToPalette: () => void }) {
  const pickerValue = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#171b28';
  return <div className="color-field"><div className="color-field-heading"><span>{label}</span><button className="palette-add" title={`Add ${label.toLowerCase()} to document palette`} aria-label={`Add ${label.toLowerCase()} to document palette`} onClick={onAddToPalette}><Plus size={11} /></button></div><div className="color-input-row"><input aria-label={`${label} color picker`} type="color" value={pickerValue} onChange={(event) => onChange(event.target.value)} /><input aria-label={`${label} color value`} className="color-value-input" value={value ?? ''} placeholder="Mixed" onChange={(event) => { if (event.target.value.trim()) onChange(event.target.value); }} /></div><div className="color-palette">{colors.map((color) => <button key={color} aria-label={`Set ${label.toLowerCase()} ${color}`} title={color} className={`swatch ${value === color ? 'selected' : ''}`} style={{ background: color }} onClick={() => onChange(color)} />)}</div></div>;
}

function SelectionStyleActions({ nodes, document }: { nodes: DiagramNode[]; document: DiagramDocument }) {
  const copyStyle = useEditorStore((state) => state.copyStyle);
  const pasteStyle = useEditorStore((state) => state.pasteStyle);
  const resetFormatting = useEditorStore((state) => state.resetFormatting);
  const applyStyleToSameType = useEditorStore((state) => state.applyStyleToSameType);
  const activateFormatPainter = useEditorStore((state) => state.activateFormatPainter);
  const clearFormatPainter = useEditorStore((state) => state.clearFormatPainter);
  const styleClipboard = useEditorStore((state) => state.styleClipboard);
  const formatPainter = useEditorStore((state) => state.formatPainter);
  const applyStylePreset = useEditorStore((state) => state.applyStylePreset);
  const deleteStylePreset = useEditorStore((state) => state.deleteStylePreset);
  const saveStylePreset = useEditorStore((state) => state.saveStylePreset);
  const [presetId, setPresetId] = useState('');
  const savePreset = () => {
    const name = globalThis.prompt('Style preset name', nodes[0]?.type ?? 'Custom style');
    if (name?.trim()) saveStylePreset(name);
  };
  return <div className="style-actions"><div className="style-action-row"><button title="Copy style" onClick={copyStyle}><Clipboard size={13} /> Copy</button><button title="Paste style" disabled={!styleClipboard} onClick={pasteStyle}><ClipboardPaste size={13} /> Paste</button><button title={formatPainter ? 'Cancel format painter' : 'Format painter'} className={formatPainter ? 'active' : ''} onClick={() => formatPainter ? clearFormatPainter() : activateFormatPainter()}><Brush size={13} /> {formatPainter ? 'Cancel' : 'Paint'}</button></div><div className="style-action-row"><button title="Reset formatting" onClick={resetFormatting}><RotateCcw size={13} /> Reset</button><button title="Apply this style to all matching shapes" onClick={applyStyleToSameType}>Same type</button><button title="Save style preset" onClick={savePreset}><Save size={13} /> Save</button></div>{document.stylePresets.length > 0 && <div className="preset-row"><select aria-label="Style preset" className="inspector-select" value={presetId} onChange={(event) => { setPresetId(event.target.value); if (event.target.value) applyStylePreset(event.target.value); }}><option value="">Apply preset…</option>{document.stylePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select>{presetId && <button className="field-delete" title="Delete style preset" aria-label="Delete style preset" onClick={() => { deleteStylePreset(presetId); setPresetId(''); }}><Trash2 size={11} /></button>}</div>}</div>;
}

function readRecentColors(): string[] {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem('aperglyph.recent-colors') ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter((color): color is string => typeof color === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

function rememberRecentColor(color: string): string[] {
  if (!color.trim()) return readRecentColors();
  try {
    const recent = readRecentColors();
    const next = [color, ...recent.filter((item) => item !== color)].slice(0, 12);
    globalThis.localStorage?.setItem('aperglyph.recent-colors', JSON.stringify(next));
    return next;
  } catch {
    // Recent colors are a convenience and must not block a style edit.
    return readRecentColors();
  }
}

function NodePropertiesPanel({ node, document, activePageId }: { node: DiagramNode; document: DiagramDocument; activePageId: string }) {
  const updateNode = useEditorStore((state) => state.updateNode);
  const createEdge = useEditorStore((state) => state.createEdge);
  const duplicateSelection = useEditorStore((state) => state.duplicateSelection);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const label = typeof node.data.label === 'string' ? node.data.label : node.type;
  const updateLabel = (value: string) => updateNode(node.id, { data: { label: value } }, 'Edit label');
  const shapeDefinition = pluginManager.getShape(node.library, node.type);
  const notationOptions = shapeDefinition?.notationOptions ?? [];
  const notation = typeof node.data.notation === 'string' && notationOptions.some((option) => option.value === node.data.notation)
    ? node.data.notation
    : shapeDefinition?.notation ?? notationOptions[0]?.value ?? '';
  // Shape libraries can be mixed on a page, so an ERD entity must expose its
  // field editor even when it was dropped onto a general diagram.
  const isErdEntity = node.type === 'entity';
  const isDfdElement = document.diagramType === 'dfd' && ['process', 'external', 'store'].includes(node.type);
  const entityFields = isErdEntity ? normalizeEntityFields(node.data.fields) : [];
  const entityIndexes = isErdEntity ? normalizeEntityIndexes(node.data.indexes, entityFields) : [];
  const diagnostics = isErdEntity ? validateErd(document).filter((diagnostic) => diagnostic.nodeId === node.id) : [];
  const dfdDiagnostics = isDfdElement ? validateDfd(document).filter((diagnostic) => diagnostic.nodeId === node.id) : [];
  const page = getActivePage(document, activePageId);
  const [aspectRatioLocked, setAspectRatioLocked] = useState(false);
  const containers = page?.nodes.filter((candidate) => candidate.container && candidate.id !== node.id && !isContainerDescendant(page.nodes, candidate.id, node.id)) ?? [];
  const updateFields = (fields: EntityField[], action = 'Update attributes') => updateNode(node.id, { data: { fields }, size: { ...node.size, height: entityAutoHeight(fields, node.data.entityVariant, node.data.columnHeaders === true) } }, action);
  const updateIndexes = (indexes: ReturnType<typeof normalizeEntityIndexes>, action = 'Update indexes') => updateNode(node.id, { data: { indexes } }, action);
  const updateField = (index: number, changes: Partial<EntityField>) => updateFields(entityFields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...changes } : field), 'Edit attribute');
  const updateVariant = (entityVariant: EntityVariant) => updateNode(node.id, { data: { entityVariant } }, 'Change entity table layout');
  const toggleColumnHeaders = () => updateNode(node.id, { data: { columnHeaders: node.data.columnHeaders !== true }, size: { ...node.size, height: entityAutoHeight(entityFields, node.data.entityVariant, node.data.columnHeaders !== true) } }, 'Toggle entity column headings');

  return <aside className="properties-panel">
    <InspectorHeading />
     <div className="selected-summary"><div className={`selected-type-icon ${node.type}`}><Palette size={16} /></div><div><strong>{node.type.replace('-', ' ')}</strong><span>{node.id.slice(0, 16)}</span></div></div>
     <InspectorSection id="node.content" title="Content"><label className="field-label">Label<input value={label} onChange={(event) => updateLabel(event.target.value)} /></label></InspectorSection>
     {notationOptions.length > 0 && <InspectorSection id="node.notation" title="Notation"><label className="field-label">Notation<select aria-label="Shape notation" className="inspector-select" value={notation} onChange={(event) => updateNode(node.id, { data: { notation: event.target.value } }, 'Change shape notation')}>{notationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><span className="inspector-hint">The semantic role stays the same; only the notation silhouette changes.</span></InspectorSection>}
    {isErdEntity && <InspectorSection id="node.entity-layout" title="Table layout" className="entity-layout-properties"><label className="field-label">Columns<select className="inspector-select" aria-label="Entity table layout" value={(node.data.entityVariant as EntityVariant | undefined) ?? 'key-field-type'} onChange={(event) => updateVariant(event.target.value as EntityVariant)}>{entityVariantOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><div className="entity-style-toggle"><span>Column headings</span><button title="Toggle column headings" aria-label="Toggle column headings" className={node.data.columnHeaders === true ? 'toggle-button active' : 'toggle-button'} onClick={toggleColumnHeaders}><span /></button></div></InspectorSection>}
    {isErdEntity && <InspectorSection id="node.attributes" title="Attributes" className="entity-properties" action={<button className="property-add" title="Add attribute" aria-label="Add attribute" onClick={() => updateFields([...entityFields, createEntityField()], 'Add attribute')}><Plus size={13} /></button>}><div className="entity-field-list">{entityFields.map((field, index) => <div className="entity-field-row" key={field.id}><div className="entity-field-inputs"><input aria-label={`Attribute ${index + 1} name`} value={field.name} onChange={(event) => updateField(index, { name: event.target.value })} /><input aria-label={`Attribute ${index + 1} type`} value={field.type} onChange={(event) => updateField(index, { type: event.target.value })} /></div><div className="entity-field-actions"><button className={field.primaryKey ? 'field-flag active' : 'field-flag'} title="Primary key" onClick={() => updateField(index, { primaryKey: !field.primaryKey })}><KeyRound size={11} /></button><button className={field.foreignKey ? 'field-flag active' : 'field-flag'} title="Foreign key" onClick={() => updateField(index, { foreignKey: !field.foreignKey })}><Link2 size={11} /></button><button className={field.nullable ? 'field-flag' : 'field-flag active'} title="Nullable" onClick={() => updateField(index, { nullable: !field.nullable })}>N</button><button className="field-delete" title="Delete attribute" onClick={() => updateFields(entityFields.filter((_, fieldIndex) => fieldIndex !== index), 'Delete attribute')}><Trash2 size={11} /></button></div></div>)}</div><div className="entity-style-toggle"><span>Striped rows</span><button title="Toggle row striping" aria-label="Toggle row striping" className={node.data.striped !== false ? 'toggle-button active' : 'toggle-button'} onClick={() => updateNode(node.id, { data: { striped: node.data.striped === false } }, 'Toggle row striping')}><span /></button></div>{diagnostics.map((diagnostic) => <div className={`erd-diagnostic ${diagnostic.severity}`} key={diagnostic.message}>{diagnostic.message}</div>)}</InspectorSection>}
     {isDfdElement && <InspectorSection id="node.dfd" title="DFD semantics"><span className="inspector-hint">{node.type === 'external' ? 'External entities exchange data through processes.' : node.type === 'store' ? 'Data stores should be mediated by processes.' : 'Processes transform incoming data into outgoing data.'}</span>{dfdDiagnostics.map((diagnostic) => <div className={`erd-diagnostic ${diagnostic.severity}`} key={diagnostic.message}>{diagnostic.message}</div>)}</InspectorSection>}
     <InspectorSection id="node.container" title="Container ownership"><label className="field-label">Owned by<select className="inspector-select" value={node.containerId ?? ''} onChange={(event) => updateNode(node.id, { containerId: event.target.value || undefined }, event.target.value ? 'Assign container ownership' : 'Remove container ownership')}><option value="">No container</option>{containers.map((container) => <option key={container.id} value={container.id}>{typeof container.data.label === 'string' ? container.data.label : container.type}</option>)}</select></label><span className="inspector-hint">Ownership is explicit. Moving a container moves assigned children; overlap alone never captures objects.</span>{node.container && <span className="inspector-hint">This object is a container shape.</span>}</InspectorSection>
      <InspectorSection id="node.layout" title="Transform"><div className="coordinate-grid"><label className="field-label">X<input aria-label="Node X position" type="number" value={Math.round(node.position.x)} onChange={(event) => updateNode(node.id, { position: { ...node.position, x: Number(event.target.value) } }, 'Move node')} /></label><label className="field-label">Y<input aria-label="Node Y position" type="number" value={Math.round(node.position.y)} onChange={(event) => updateNode(node.id, { position: { ...node.position, y: Number(event.target.value) } }, 'Move node')} /></label><label className="field-label">W<input aria-label="Node width" type="number" min="48" value={Math.round(node.size.width)} onChange={(event) => { const width = Math.max(48, Number(event.target.value) || node.size.width); const height = aspectRatioLocked ? Math.max(32, Math.round(width * node.size.height / Math.max(1, node.size.width))) : node.size.height; updateNode(node.id, { size: { width, height } }, 'Resize node'); }} /></label><label className="field-label">H<input aria-label="Node height" type="number" min="32" value={Math.round(node.size.height)} onChange={(event) => { const height = Math.max(32, Number(event.target.value) || node.size.height); const width = aspectRatioLocked ? Math.max(48, Math.round(height * node.size.width / Math.max(1, node.size.height))) : node.size.width; updateNode(node.id, { size: { width, height } }, 'Resize node'); }} /></label></div><div className="transform-row"><label className="field-label">Rotation<input aria-label="Node rotation" type="number" min="-360" max="360" step="1" value={Math.round(node.rotation)} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateNode(node.id, { rotation: ((value % 360) + 360) % 360 }, 'Rotate node'); }} /></label><button className={aspectRatioLocked ? 'transform-toggle active' : 'transform-toggle'} aria-label="Lock aspect ratio" aria-pressed={aspectRatioLocked} title="Preserve aspect ratio" onClick={() => setAspectRatioLocked((locked) => !locked)}><Link2 size={13} /> {aspectRatioLocked ? 'Locked' : 'Lock ratio'}</button><button className="transform-reset" aria-label="Reset rotation" title="Reset rotation" onClick={() => updateNode(node.id, { rotation: 0 }, 'Reset rotation')}><RotateCcw size={13} /> Reset</button></div></InspectorSection>
     <InspectorSection id="node.appearance" title="Appearance"><StyleControls nodes={[node]} document={document} /><SelectionStyleActions nodes={[node]} document={document} /></InspectorSection>
      <div className="property-bottom-actions"><button title={node.locked ? 'Unlock' : 'Lock'} onClick={() => updateNode(node.id, { locked: !node.locked }, node.locked ? 'Unlock node' : 'Lock node')}>{node.locked ? <Unlock size={15} /> : <Lock size={15} />}</button><button title="Rotate clockwise" aria-label="Rotate clockwise" disabled={node.locked} onClick={() => useEditorStore.getState().rotateSelection(90)}><RotateCw size={15} /></button>{isErdEntity && <button title="Duplicate table" aria-label="Duplicate table" onClick={() => duplicateSelection()}><Copy size={15} /></button>}<button title="Delete" className="danger" onClick={deleteSelection}><Trash2 size={15} /></button></div>
      {isErdEntity && <EntityAdvancedFields fields={entityFields} indexes={entityIndexes} entities={page?.nodes.filter((candidate) => candidate.type === 'entity' && candidate.id !== node.id) ?? []} updateFields={updateFields} updateIndexes={updateIndexes} onCreateRelationship={(fieldId) => { const edge = page ? relationshipForForeignKey(page, node.id, fieldId) : null; if (edge && !page?.edges.some((candidate) => candidate.data.sourceFieldId === fieldId || (Array.isArray(candidate.data.sourceFieldIds) && candidate.data.sourceFieldIds.includes(fieldId)))) createEdge(edge); }} />}
     {isDfdElement && <DfdMetadataPanel node={node} />}
   </aside>;
 }

function DfdMetadataPanel({ node }: { node: DiagramNode }) {
  const updateNode = useEditorStore((state) => state.updateNode);
  const createDfdChildPage = useEditorStore((state) => state.createDfdChildPage);
  const setActivePage = useEditorStore((state) => state.setActivePage);
  const document = useEditorStore((state) => state.document);
  const childPageId = typeof node.data.childPageId === 'string' ? node.data.childPageId : undefined;
  const childPage = childPageId ? document.pages.find((page) => page.id === childPageId) : undefined;
  return <InspectorSection id="node.dfd-number" title="DFD metadata"><label className="field-label">{node.type === 'store' ? 'Data-store number' : 'Process number'}<input aria-label={node.type === 'store' ? 'Data-store number' : 'Process number'} value={typeof node.data.number === 'string' ? node.data.number : ''} placeholder={node.type === 'store' ? 'D1' : '1.0'} onChange={(event) => updateNode(node.id, { data: { number: event.target.value } }, node.type === 'store' ? 'Edit data-store number' : 'Edit process number')} /></label><span className="inspector-hint">Use hierarchical numbers such as 1.0, 1.1, or 2.0 when balancing DFD levels.</span>{node.type === 'process' && (childPage ? <button className="secondary-button" onClick={() => setActivePage(childPage.id)}>Open child page · {childPage.name}</button> : <button className="secondary-button" onClick={() => createDfdChildPage(node.id)}>Create child DFD page</button>)}</InspectorSection>;
}

function EdgePropertiesPanel({ edge, nodes, diagramType, document }: { edge: DiagramEdge; nodes: DiagramNode[]; diagramType: string; document: DiagramDocument }) {
  const updateEdge = useEditorStore((state) => state.updateEdge);
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const resetEdge = useEditorStore((state) => state.resetEdge);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const plugin = pluginManager.get(diagramType);
  const patch = (changes: EdgePatch, action = 'Update connector') => updateEdge(edge.id, changes, action);
  const updateSource = (changes: Partial<DiagramEdge['source']>, action = 'Edit source connection') => patch({ source: { ...edge.source, ...changes, ...((Object.prototype.hasOwnProperty.call(changes, 'nodeId') || Object.prototype.hasOwnProperty.call(changes, 'port')) && !Object.prototype.hasOwnProperty.call(changes, 'anchorId') ? { anchorId: undefined } : {}) }, ...(Object.prototype.hasOwnProperty.call(changes, 'nodeId') && changes.nodeId !== edge.source.nodeId ? { waypoints: [] } : {}) }, action);
  const updateTarget = (changes: Partial<DiagramEdge['target']>, action = 'Edit target connection') => patch({ target: { ...edge.target, ...changes, ...((Object.prototype.hasOwnProperty.call(changes, 'nodeId') || Object.prototype.hasOwnProperty.call(changes, 'port')) && !Object.prototype.hasOwnProperty.call(changes, 'anchorId') ? { anchorId: undefined } : {}) }, ...(Object.prototype.hasOwnProperty.call(changes, 'nodeId') && changes.nodeId !== edge.target.nodeId ? { waypoints: [] } : {}) }, action);
  const sourceNode = nodes.find((node) => node.id === edge.source.nodeId);
  const targetNode = nodes.find((node) => node.id === edge.target.nodeId);
  const label = typeof edge.data.label === 'string' ? edge.data.label : '';
  const labelPositionPreset = typeof edge.data.labelPositionPreset === 'string' ? edge.data.labelPositionPreset : 'center';
  const labelBackground = typeof edge.data.labelBackground === 'string' && /^#[0-9a-f]{6}$/i.test(edge.data.labelBackground) ? edge.data.labelBackground : '#10131c';
  const addWaypoint = () => {
   const source = resolveEndpointPoint(edge.source, sourceNode, targetNode ? nodeCenter(targetNode) : edge.target.point) ?? { x: 0, y: 0 };
   const target = resolveEndpointPoint(edge.target, targetNode, sourceNode ? nodeCenter(sourceNode) : edge.source.point) ?? source;
    const midpoint = { x: Math.round((source.x + target.x) / 2), y: Math.round((source.y + target.y) / 2) };
    patch({ waypoints: [...edge.waypoints, midpoint] }, 'Add waypoint');
  };
  const updateWaypoint = (index: number, changes: Partial<Point>) => patch({ waypoints: edge.waypoints.map((point, pointIndex) => pointIndex === index ? { ...point, ...changes } : point) }, 'Edit waypoint');
  const removeWaypoint = (index: number) => patch({ waypoints: edge.waypoints.filter((_, pointIndex) => pointIndex !== index) }, 'Delete waypoint');
   const connectorTypes = [
     { value: 'straight', label: 'Straight' },
     { value: 'curved', label: 'Curved' },
     { value: 'orthogonal', label: 'Orthogonal' },
     ...plugin.connectors.filter((connector) => !['straight', 'curved', 'orthogonal'].includes(connector.id)).map((connector) => ({ value: connector.id, label: connector.label })),
     ...(edge.type === 'straight' || edge.type === 'curved' || edge.type === 'orthogonal' || plugin.connectors.some((connector) => connector.id === edge.type) ? [] : [{ value: edge.type, label: `Custom (${edge.type})` }]),
   ];
  const connectorHint = plugin.connectors.map((connector) => connector.label).join(' · ');
  const cardinality = cardinalityOptions.find((option) => option.start === edge.style.startMarker && option.end === edge.style.endMarker)?.value ?? 'custom';
  const dfdDiagnostics = diagramType === 'dfd' ? validateDfd(document).filter((diagnostic) => diagnostic.edgeId === edge.id) : [];
   const manualRouting = orthogonalRoutingMode(edge) === 'manual' || edge.waypoints.length > 0;
  const reverseDirection = () => patch({ source: edge.target, target: edge.source, waypoints: edge.waypoints.slice().reverse() }, 'Reverse connector direction');
  const swapMarkers = () => patch({ style: { startMarker: edge.style.endMarker, endMarker: edge.style.startMarker } }, 'Swap connector markers');
   const toggleRouting = () => patch({ routing: { ...(edge.routing ?? {}), mode: manualRouting ? 'auto' : 'manual' }, ...(manualRouting ? { waypoints: [] } : {}) }, manualRouting ? 'Use automatic routing' : 'Use manual routing');
  const createForeignKey = () => executeCommand({ label: 'Create foreign key from relationship', execute: (current) => foreignKeyForRelationship(current, useEditorStore.getState().activePageId, edge.id) });

  return <aside className="properties-panel edge-properties-panel">
    <InspectorHeading />
     <div className="selected-summary"><div className="selected-type-icon edge"><GitBranch size={16} /></div><div><strong>connector</strong><span>{edge.id.slice(0, 16)}</span></div></div>
     <InspectorSection id="edge.connector" title="Connector"><label className="field-label">Label<input value={label} placeholder="Optional label" onChange={(event) => patch({ data: { label: event.target.value } }, 'Edit connector label')} /></label><label className="field-label edge-field-label">Label position<select className="inspector-select" value={labelPositionPreset} onChange={(event) => patch({ data: { labelPositionPreset: event.target.value, labelPosition: event.target.value === 'custom' ? edge.data.labelPosition : undefined } }, 'Change label position')}><option value="start">Near start</option><option value="quarter">Quarter</option><option value="center">Center</option><option value="three-quarter">Three-quarter</option><option value="end">Near end</option><option value="custom">Custom drag position</option></select></label><label className="field-label edge-field-label">Label background<div className="color-input-row"><input aria-label="Connector label background" type="color" value={labelBackground} onChange={(event) => patch({ data: { labelBackground: event.target.value } }, 'Change label background')} /><button className="secondary-button label-reset" onClick={() => patch({ data: { labelBackground: undefined } }, 'Reset label background')}>Canvas</button></div></label><label className="field-label edge-field-label">Routing<select className="inspector-select" value={edge.type} onChange={(event) => patch({ type: event.target.value, waypoints: event.target.value === 'orthogonal' ? edge.waypoints : [] }, 'Change connector routing')}>{connectorTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>{edgeRouting(edge) === 'orthogonal' && <label className="field-label edge-field-label">Orthogonal mode<select aria-label="Orthogonal routing mode" className="inspector-select" value={orthogonalRoutingMode(edge)} onChange={(event) => patch({ routing: { ...(edge.routing ?? {}), mode: event.target.value as 'auto' | 'simple' | 'manual' } }, 'Change orthogonal routing mode')}><option value="auto">Auto · stable</option><option value="simple">Simple · 1–2 bends</option><option value="manual">Manual · constraints</option></select></label>}<label className="field-label edge-field-label">Cardinality<select className="inspector-select" value={cardinality} onChange={(event) => { const option = cardinalityOptions.find((candidate) => candidate.value === event.target.value); if (option) patch({ style: { startMarker: option.start, endMarker: option.end } }, 'Change cardinality'); }}>{cardinality === 'custom' && <option value="custom">Custom markers</option>}{cardinalityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><div className="edge-quick-actions"><button title="Reverse connector direction" onClick={reverseDirection}><ArrowLeftRight size={13} /> Reverse</button><button title="Swap start and end markers" onClick={swapMarkers}>Swap markers</button><button title={manualRouting ? 'Use automatic routing' : 'Use manual routing'} onClick={toggleRouting}>{manualRouting ? 'Auto route' : 'Manual route'}</button><button title="Reset all waypoints" onClick={() => patch({ waypoints: [], data: { routingMode: 'auto' } }, 'Reset all waypoints')}>Reset route</button></div><span className="inspector-hint">{connectorHint}</span>{dfdDiagnostics.map((diagnostic) => <div className={`erd-diagnostic ${diagnostic.severity}`} key={diagnostic.message}>{diagnostic.message}</div>)}</InspectorSection>
      <InspectorSection id="edge.connections" title="Connections"><span className="inspector-hint connection-hint">Drag the endpoint handles anywhere on the canvas, or reconnect them to a node.</span><EndpointEditor label="Start" endpoint={edge.source} otherEndpoint={edge.target} node={sourceNode} otherNode={targetNode} nodes={nodes} onChange={updateSource} /><EndpointEditor label="End" endpoint={edge.target} otherEndpoint={edge.source} node={targetNode} otherNode={sourceNode} nodes={nodes} onChange={updateTarget} />{diagramType === 'erd' && sourceNode?.type === 'entity' && targetNode?.type === 'entity' && <button className="secondary-button" onClick={createForeignKey}>Create FK from relationship</button>}</InspectorSection>
     {edgeRouting(edge) === 'orthogonal' && <InspectorSection id="edge.waypoints" title="Waypoints" action={<button className="property-add" title="Add waypoint" aria-label="Add waypoint" onClick={addWaypoint}><Plus size={13} /></button>}>{edge.waypoints.length === 0 ? <span className="inspector-hint">No waypoints. The route will use automatic bends.</span> : <div className="waypoint-list">{edge.waypoints.map((point, index) => <div className="waypoint-row" key={`${index}-${point.x}-${point.y}`}><span>{index + 1}</span><input aria-label={`Waypoint ${index + 1} X`} type="number" value={Math.round(point.x)} onChange={(event) => updateWaypoint(index, { x: Number(event.target.value) })} /><input aria-label={`Waypoint ${index + 1} Y`} type="number" value={Math.round(point.y)} onChange={(event) => updateWaypoint(index, { y: Number(event.target.value) })} /><button className="field-delete" title="Delete waypoint" aria-label={`Delete waypoint ${index + 1}`} onClick={() => removeWaypoint(index)}><Trash2 size={11} /></button></div>)}</div>}</InspectorSection>}
    <InspectorSection id="edge.appearance" title="Appearance"><label className="field-label edge-field-label">Line style<select className="inspector-select" value={edge.style.dash} onChange={(event) => patch({ style: { dash: event.target.value as EdgeStyle['dash'] } }, 'Change line style')}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label><label className="field-label edge-field-label">Start marker<select className="inspector-select" value={edge.style.startMarker} onChange={(event) => patch({ style: { startMarker: event.target.value as EdgeMarker } }, 'Change start marker')}>{markerOptions.map((marker) => <option key={marker.value} value={marker.value}>{marker.label}</option>)}</select></label><label className="field-label edge-field-label">End marker<select className="inspector-select" value={edge.style.endMarker} onChange={(event) => patch({ style: { endMarker: event.target.value as EdgeMarker } }, 'Change end marker')}>{markerOptions.map((marker) => <option key={marker.value} value={marker.value}>{marker.label}</option>)}</select></label></InspectorSection>
     <InspectorSection id="edge.line-style" title="Line appearance"><EdgeStyleControls edge={edge} document={document} patch={patch} /></InspectorSection>
      <div className="property-bottom-actions"><button title="Reset connector" onClick={() => resetEdge(edge.id)}><RotateCcw size={15} /></button><button title="Delete connector" className="danger" onClick={deleteSelection}><Trash2 size={15} /></button></div>
  </aside>;
}

function EdgeStyleControls({ edge, document, patch }: { edge: DiagramEdge; document: DiagramDocument; patch: (changes: EdgePatch, action?: string) => void }) {
  const updatePalette = useEditorStore((state) => state.updatePalette);
  return <div className="style-controls"><ColorField label="Stroke" value={edge.style.stroke} colors={document.palette} onChange={(color) => patch({ style: { stroke: color } }, 'Change connector color')} onAddToPalette={() => updatePalette([...document.palette, edge.style.stroke])} /><div className="style-range-row"><label className="field-label">Stroke width<input aria-label="Connector stroke width" type="number" min="0" max="100" step="0.5" value={edge.style.strokeWidth} onChange={(event) => patch({ style: { strokeWidth: Number(event.target.value) } }, 'Change connector stroke width')} /></label><label className="field-label">Opacity<input aria-label="Connector opacity" type="range" min="0" max="1" step="0.05" value={edge.style.opacity ?? 1} onChange={(event) => patch({ style: { opacity: Number(event.target.value) } }, 'Change connector opacity')} /></label></div><label className="field-label edge-field-label">Corner radius<input aria-label="Connector corner radius" type="number" min="0" max="32" step="1" value={edge.style.cornerRadius ?? 0} onChange={(event) => patch({ style: { cornerRadius: Math.max(0, Math.min(32, Number(event.target.value) || 0)) } }, 'Change connector corner radius')} /></label><label className="field-label edge-field-label">Line jump<select className="inspector-select" value={edge.style.jumpStyle ?? 'arc'} onChange={(event) => patch({ style: { jumpStyle: event.target.value as EdgeStyle['jumpStyle'] } }, 'Change line jump style')}><option value="arc">Arc</option><option value="gap">Gap</option><option value="none">None</option></select></label></div>;
}

function nodeLabel(node: DiagramNode): string {
  const label = typeof node.data.label === 'string' ? node.data.label.trim() : '';
  return label || node.type;
}

function isContainerDescendant(nodes: DiagramNode[], candidateId: string, ancestorId: string): boolean {
  const visited = new Set<string>();
  let current: string | undefined = candidateId;
  while (current) {
    if (current === ancestorId || visited.has(current)) return true;
    visited.add(current);
    current = nodes.find((node) => node.id === current)?.containerId;
  }
  return false;
}

function EndpointEditor({ label, endpoint, otherEndpoint, node, otherNode, nodes, onChange }: { label: string; endpoint: Endpoint; otherEndpoint: Endpoint; node?: DiagramNode; otherNode?: DiagramNode; nodes: DiagramNode[]; onChange: (changes: Partial<Endpoint>, action?: string) => void }) {
  const otherPoint = otherEndpoint.point ?? (otherNode ? nodeCenter(otherNode) : undefined);
  const freePoint = endpoint.point ?? (node ? resolveEndpointPoint(endpoint, node, otherPoint) ?? { x: 0, y: 0 } : { x: 0, y: 0 });
  const setNode = (nodeId: string) => {
    if (nodeId) {
      onChange({ nodeId, port: undefined, offset: undefined, point: undefined }, `Reconnect ${label.toLowerCase()} endpoint`);
      return;
    }
    onChange({ nodeId: undefined, port: undefined, offset: undefined, point: freePoint }, `Free ${label.toLowerCase()} endpoint`);
  };
  const updatePoint = (axis: 'x' | 'y', value: string) => onChange({ point: { ...freePoint, [axis]: Number(value) } }, `Move ${label.toLowerCase()} endpoint`);
  return <div className="edge-endpoint"><strong>{label}</strong><label className="field-label">Node<select className="inspector-select" value={endpoint.nodeId ?? ''} onChange={(event) => setNode(event.target.value)}><option value="">Free point</option>{nodes.map((candidate) => <option key={candidate.id} value={candidate.id}>{nodeLabel(candidate)}</option>)}</select></label>{endpoint.nodeId ? <label className="field-label">Port<select className="inspector-select" value={endpoint.port ?? ''} onChange={(event) => onChange({ port: event.target.value || undefined }, `Change ${label.toLowerCase()} port`)}>{portOptions.map((port) => <option key={port.value} value={port.value}>{port.label}</option>)}</select></label> : <div className="coordinate-grid endpoint-coordinates"><label className="field-label">X<input type="number" value={Math.round(freePoint.x)} onChange={(event) => updatePoint('x', event.target.value)} /></label><label className="field-label">Y<input type="number" value={Math.round(freePoint.y)} onChange={(event) => updatePoint('y', event.target.value)} /></label></div>}</div>;
}
