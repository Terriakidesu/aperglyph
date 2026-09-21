import { AlignCenter, ChevronDown, Copy, GitBranch, KeyRound, Link2, Lock, Palette, Plus, RotateCcw, RotateCw, Trash2, Unlock } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { validateDfd } from '../core/dfd';
import { createEntityField, entityAutoHeight, entityVariantOptions, normalizeEntityFields, validateErd } from '../core/erd';
import { editorEvents } from '../core/events';
import { nodeCenter } from '../core/geometry';
import type { DiagramDocument, DiagramEdge, DiagramNode, EdgeMarker, EdgePatch, EdgeStyle, Endpoint, Point } from '../core/types';
import { resolveEndpointPoint } from '../core/routing';
import { pluginManager } from '../plugins';
import { getActivePage, useEditorStore } from '../store/editorStore';
import type { EntityField, EntityVariant } from '../core/erd';

const swatches = ['#171b28', '#2c2752', '#1f2e43', '#15362f', '#302b24', '#f2f3f7'];
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
  if (!selectedNode) return <EmptyProperties />;
  return <NodePropertiesPanel node={selectedNode} document={document} />;
}

function EmptyProperties({ multiSelection }: { multiSelection?: number }) {
  const alignSelection = useEditorStore((state) => state.alignSelection);
  const distributeSelection = useEditorStore((state) => state.distributeSelection);
  const duplicateSelection = useEditorStore((state) => state.duplicateSelection);
  const groupSelection = useEditorStore((state) => state.groupSelection);
  const ungroupSelection = useEditorStore((state) => state.ungroupSelection);
  const setZOrder = useEditorStore((state) => state.setZOrder);
  return <aside className="properties-panel empty-properties">
    <InspectorHeading />
    {multiSelection ? <div className="multi-selection"><div className="multi-icon"><AlignCenter size={20} /></div><strong>{multiSelection} objects selected</strong><span>Move or align them together</span><div className="quick-actions"><button title="Align left" onClick={() => alignSelection('left')}><AlignCenter size={14} /> Left</button><button title="Align centers" onClick={() => alignSelection('center')}><AlignCenter size={14} /> Center</button><button title="Align right" onClick={() => alignSelection('right')}><AlignCenter size={14} /> Right</button><button title="Align top" onClick={() => alignSelection('top')}><AlignCenter size={14} /> Top</button><button title="Align middle" onClick={() => alignSelection('middle')}><AlignCenter size={14} /> Middle</button><button title="Align bottom" onClick={() => alignSelection('bottom')}><AlignCenter size={14} /> Bottom</button><button title="Distribute horizontally" onClick={() => distributeSelection('horizontal')}><AlignCenter size={14} /> Dist. H</button><button title="Distribute vertically" onClick={() => distributeSelection('vertical')}><AlignCenter size={14} /> Dist. V</button><button title="Fit selection" onClick={() => editorEvents.emit('viewport:fit', { scope: 'selection' })}>Fit selection</button><button title="Duplicate selection" onClick={() => duplicateSelection()}><Copy size={14} /> Duplicate</button><button title="Group selection" onClick={groupSelection}>Group</button><button title="Ungroup selection" onClick={ungroupSelection}>Ungroup</button><button title="Bring selection to front" onClick={() => setZOrder('front')}>Bring front</button><button title="Send selection to back" onClick={() => setZOrder('back')}>Send back</button></div></div> : <div className="no-selection"><div className="no-selection-art"><div /><div /><div /></div><strong>Nothing selected</strong><span>Select an object to<br />inspect its properties.</span></div>}
  </aside>;
}

function MultiSelectionProperties({ selectedIds, document, activePageId }: { selectedIds: string[]; document: DiagramDocument; activePageId: string }) {
  const updateNodes = useEditorStore((state) => state.updateNodes);
  const alignSelection = useEditorStore((state) => state.alignSelection);
  const distributeSelection = useEditorStore((state) => state.distributeSelection);
  const duplicateSelection = useEditorStore((state) => state.duplicateSelection);
  const groupSelection = useEditorStore((state) => state.groupSelection);
  const ungroupSelection = useEditorStore((state) => state.ungroupSelection);
  const setZOrder = useEditorStore((state) => state.setZOrder);
  const page = getActivePage(document, activePageId);
  const nodes = page?.nodes.filter((node) => selectedIds.includes(node.id)) ?? [];
  const nodeIds = nodes.map((node) => node.id);
  const common = <T,>(values: T[]): T | undefined => values.length > 0 && values.every((value) => value === values[0]) ? values[0] : undefined;
  const fill = common(nodes.map((node) => node.style.fill));
  const stroke = common(nodes.map((node) => node.style.stroke));
  const opacity = common(nodes.map((node) => node.style.opacity));
  const allLocked = nodes.length > 0 && nodes.every((node) => node.locked);
  const setStyle = (style: Partial<DiagramNode['style']>, label: string) => updateNodes(nodeIds, { style }, label);
  return <aside className="properties-panel empty-properties">
    <InspectorHeading />
    <div className="multi-selection"><div className="multi-icon"><AlignCenter size={20} /></div><strong>{selectedIds.length} objects selected</strong><span>{nodes.length > 0 ? 'Edit shared properties or arrange them together' : 'Move or arrange them together'}</span></div>
    {nodes.length > 0 && <InspectorSection id="selection.common" title="Common properties"><div className="color-row"><span>Fill</span><div className="swatches">{swatches.map((color) => <button key={color} aria-label={`Set selection fill ${color}`} title={`Set selection fill ${color}`} className={`swatch ${fill === color ? 'selected' : ''}`} style={{ background: color }} onClick={() => setStyle({ fill: color }, 'Change selection fill')} />)}</div></div><div className="color-row"><span>Stroke</span><button className="stroke-preview" aria-label="Toggle selection stroke" title="Toggle selection stroke" style={{ borderColor: stroke ?? '#59627a' }} onClick={() => setStyle({ stroke: stroke === '#59627a' ? '#9c86ff' : '#59627a' }, 'Change selection stroke')}><span style={{ background: stroke ?? '#59627a' }} /></button></div><label className="field-label selection-opacity">Opacity<select className="inspector-select" aria-label="Selection opacity" value={opacity === undefined ? '' : String(opacity)} onChange={(event) => setStyle({ opacity: Number(event.target.value) }, 'Change selection opacity')}><option value="">Mixed</option><option value="1">100%</option><option value="0.8">80%</option><option value="0.6">60%</option><option value="0.4">40%</option></select></label><button className="selection-lock" title={allLocked ? 'Unlock selection' : 'Lock selection'} onClick={() => updateNodes(nodeIds, { locked: !allLocked }, allLocked ? 'Unlock selection' : 'Lock selection')}>{allLocked ? <Unlock size={14} /> : <Lock size={14} />} {allLocked ? 'Unlock selection' : 'Lock selection'}</button></InspectorSection>}
    <div className="quick-actions"><button title="Align left" onClick={() => alignSelection('left')}><AlignCenter size={14} /> Left</button><button title="Align centers" onClick={() => alignSelection('center')}><AlignCenter size={14} /> Center</button><button title="Align right" onClick={() => alignSelection('right')}><AlignCenter size={14} /> Right</button><button title="Align top" onClick={() => alignSelection('top')}><AlignCenter size={14} /> Top</button><button title="Align middle" onClick={() => alignSelection('middle')}><AlignCenter size={14} /> Middle</button><button title="Align bottom" onClick={() => alignSelection('bottom')}><AlignCenter size={14} /> Bottom</button><button title="Distribute horizontally" onClick={() => distributeSelection('horizontal')}><AlignCenter size={14} /> Dist. H</button><button title="Distribute vertically" onClick={() => distributeSelection('vertical')}><AlignCenter size={14} /> Dist. V</button><button title="Fit selection" onClick={() => editorEvents.emit('viewport:fit', { scope: 'selection' })}>Fit selection</button><button title="Duplicate selection" onClick={() => duplicateSelection()}><Copy size={14} /> Duplicate</button><button title="Group selection" onClick={groupSelection}>Group</button><button title="Ungroup selection" onClick={ungroupSelection}>Ungroup</button><button title="Bring selection to front" onClick={() => setZOrder('front')}>Bring front</button><button title="Send selection to back" onClick={() => setZOrder('back')}>Send back</button></div>
  </aside>;
}

function InspectorHeading() {
  return <div className="panel-title-row"><div><span className="panel-kicker">Inspector</span><h2>Properties</h2></div></div>;
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

function NodePropertiesPanel({ node, document }: { node: DiagramNode; document: DiagramDocument }) {
  const updateNode = useEditorStore((state) => state.updateNode);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const label = typeof node.data.label === 'string' ? node.data.label : node.type;
  const updateLabel = (value: string) => updateNode(node.id, { data: { label: value } }, 'Edit label');
  // Shape libraries can be mixed on a page, so an ERD entity must expose its
  // field editor even when it was dropped onto a general diagram.
  const isErdEntity = node.type === 'entity';
  const isDfdElement = document.diagramType === 'dfd' && ['process', 'external', 'store'].includes(node.type);
  const entityFields = isErdEntity ? normalizeEntityFields(node.data.fields) : [];
  const diagnostics = isErdEntity ? validateErd(document).filter((diagnostic) => diagnostic.nodeId === node.id) : [];
  const dfdDiagnostics = isDfdElement ? validateDfd(document).filter((diagnostic) => diagnostic.nodeId === node.id) : [];
  const updateFields = (fields: EntityField[], action = 'Update attributes') => updateNode(node.id, { data: { fields }, size: { ...node.size, height: entityAutoHeight(fields, node.data.entityVariant, node.data.columnHeaders === true) } }, action);
  const updateField = (index: number, changes: Partial<EntityField>) => updateFields(entityFields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...changes } : field), 'Edit attribute');
  const updateVariant = (entityVariant: EntityVariant) => updateNode(node.id, { data: { entityVariant } }, 'Change entity table layout');
  const toggleColumnHeaders = () => updateNode(node.id, { data: { columnHeaders: node.data.columnHeaders !== true }, size: { ...node.size, height: entityAutoHeight(entityFields, node.data.entityVariant, node.data.columnHeaders !== true) } }, 'Toggle entity column headings');

  return <aside className="properties-panel">
    <InspectorHeading />
     <div className="selected-summary"><div className={`selected-type-icon ${node.type}`}><Palette size={16} /></div><div><strong>{node.type.replace('-', ' ')}</strong><span>{node.id.slice(0, 16)}</span></div></div>
    <InspectorSection id="node.content" title="Content"><label className="field-label">Label<input value={label} onChange={(event) => updateLabel(event.target.value)} /></label></InspectorSection>
    {isErdEntity && <InspectorSection id="node.entity-layout" title="Table layout" className="entity-layout-properties"><label className="field-label">Columns<select className="inspector-select" aria-label="Entity table layout" value={(node.data.entityVariant as EntityVariant | undefined) ?? 'key-field-type'} onChange={(event) => updateVariant(event.target.value as EntityVariant)}>{entityVariantOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><div className="entity-style-toggle"><span>Column headings</span><button title="Toggle column headings" aria-label="Toggle column headings" className={node.data.columnHeaders === true ? 'toggle-button active' : 'toggle-button'} onClick={toggleColumnHeaders}><span /></button></div></InspectorSection>}
    {isErdEntity && <InspectorSection id="node.attributes" title="Attributes" className="entity-properties" action={<button className="property-add" title="Add attribute" aria-label="Add attribute" onClick={() => updateFields([...entityFields, createEntityField()], 'Add attribute')}><Plus size={13} /></button>}><div className="entity-field-list">{entityFields.map((field, index) => <div className="entity-field-row" key={field.id}><div className="entity-field-inputs"><input aria-label={`Attribute ${index + 1} name`} value={field.name} onChange={(event) => updateField(index, { name: event.target.value })} /><input aria-label={`Attribute ${index + 1} type`} value={field.type} onChange={(event) => updateField(index, { type: event.target.value })} /></div><div className="entity-field-actions"><button className={field.primaryKey ? 'field-flag active' : 'field-flag'} title="Primary key" onClick={() => updateField(index, { primaryKey: !field.primaryKey })}><KeyRound size={11} /></button><button className={field.foreignKey ? 'field-flag active' : 'field-flag'} title="Foreign key" onClick={() => updateField(index, { foreignKey: !field.foreignKey })}><Link2 size={11} /></button><button className={field.nullable ? 'field-flag' : 'field-flag active'} title="Nullable" onClick={() => updateField(index, { nullable: !field.nullable })}>N</button><button className="field-delete" title="Delete attribute" onClick={() => updateFields(entityFields.filter((_, fieldIndex) => fieldIndex !== index), 'Delete attribute')}><Trash2 size={11} /></button></div></div>)}</div><div className="entity-style-toggle"><span>Striped rows</span><button title="Toggle row striping" aria-label="Toggle row striping" className={node.data.striped !== false ? 'toggle-button active' : 'toggle-button'} onClick={() => updateNode(node.id, { data: { striped: node.data.striped === false } }, 'Toggle row striping')}><span /></button></div>{diagnostics.map((diagnostic) => <div className={`erd-diagnostic ${diagnostic.severity}`} key={diagnostic.message}>{diagnostic.message}</div>)}</InspectorSection>}
    {isDfdElement && <InspectorSection id="node.dfd" title="DFD semantics"><span className="inspector-hint">{node.type === 'external' ? 'External entities exchange data through processes.' : node.type === 'store' ? 'Data stores should be mediated by processes.' : 'Processes transform incoming data into outgoing data.'}</span>{dfdDiagnostics.map((diagnostic) => <div className={`erd-diagnostic ${diagnostic.severity}`} key={diagnostic.message}>{diagnostic.message}</div>)}</InspectorSection>}
    <InspectorSection id="node.layout" title="Layout"><div className="coordinate-grid"><label className="field-label">X<input type="number" value={Math.round(node.position.x)} onChange={(event) => updateNode(node.id, { position: { ...node.position, x: Number(event.target.value) } }, 'Move node')} /></label><label className="field-label">Y<input type="number" value={Math.round(node.position.y)} onChange={(event) => updateNode(node.id, { position: { ...node.position, y: Number(event.target.value) } }, 'Move node')} /></label><label className="field-label">W<input type="number" value={Math.round(node.size.width)} onChange={(event) => updateNode(node.id, { size: { ...node.size, width: Number(event.target.value) } }, 'Resize node')} /></label><label className="field-label">H<input type="number" value={Math.round(node.size.height)} onChange={(event) => updateNode(node.id, { size: { ...node.size, height: Number(event.target.value) } }, 'Resize node')} /></label></div></InspectorSection>
    <InspectorSection id="node.appearance" title="Appearance"><div className="color-row"><span>Fill</span><div className="swatches">{swatches.map((color) => <button key={color} aria-label={`Set fill ${color}`} title={`Set fill ${color}`} className={`swatch ${node.style.fill === color ? 'selected' : ''}`} style={{ background: color }} onClick={() => updateNode(node.id, { style: { fill: color } }, 'Change fill')} />)}</div></div><div className="color-row"><span>Stroke</span><button className="stroke-preview" aria-label="Toggle stroke color" title="Toggle stroke color" style={{ borderColor: node.style.stroke }} onClick={() => updateNode(node.id, { style: { stroke: node.style.stroke === '#59627a' ? '#9c86ff' : '#59627a' } }, 'Change stroke')}><span style={{ background: node.style.stroke }} /></button></div></InspectorSection>
    <div className="property-bottom-actions"><button title={node.locked ? 'Unlock' : 'Lock'} onClick={() => updateNode(node.id, { locked: !node.locked }, node.locked ? 'Unlock node' : 'Lock node')}>{node.locked ? <Unlock size={15} /> : <Lock size={15} />}</button><button title="Rotate clockwise" aria-label="Rotate clockwise" disabled={node.locked} onClick={() => useEditorStore.getState().rotateSelection(90)}><RotateCw size={15} /></button><button title="Delete" className="danger" onClick={deleteSelection}><Trash2 size={15} /></button></div>
  </aside>;
}

function EdgePropertiesPanel({ edge, nodes, diagramType, document }: { edge: DiagramEdge; nodes: DiagramNode[]; diagramType: string; document: DiagramDocument }) {
  const updateEdge = useEditorStore((state) => state.updateEdge);
  const resetEdge = useEditorStore((state) => state.resetEdge);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const plugin = pluginManager.get(diagramType);
  const patch = (changes: EdgePatch, action = 'Update connector') => updateEdge(edge.id, changes, action);
  const updateSource = (changes: Partial<DiagramEdge['source']>, action = 'Edit source connection') => patch({ source: { ...edge.source, ...changes }, ...(Object.prototype.hasOwnProperty.call(changes, 'nodeId') && changes.nodeId !== edge.source.nodeId ? { waypoints: [] } : {}) }, action);
  const updateTarget = (changes: Partial<DiagramEdge['target']>, action = 'Edit target connection') => patch({ target: { ...edge.target, ...changes }, ...(Object.prototype.hasOwnProperty.call(changes, 'nodeId') && changes.nodeId !== edge.target.nodeId ? { waypoints: [] } : {}) }, action);
  const sourceNode = nodes.find((node) => node.id === edge.source.nodeId);
  const targetNode = nodes.find((node) => node.id === edge.target.nodeId);
  const label = typeof edge.data.label === 'string' ? edge.data.label : '';
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
    ...(edge.type === 'straight' || edge.type === 'curved' || edge.type === 'orthogonal' ? [] : [{ value: edge.type, label: `Custom (${edge.type})` }]),
  ];
  const connectorHint = plugin.connectors.map((connector) => connector.label).join(' · ');
  const cardinality = cardinalityOptions.find((option) => option.start === edge.style.startMarker && option.end === edge.style.endMarker)?.value ?? 'custom';
  const dfdDiagnostics = diagramType === 'dfd' ? validateDfd(document).filter((diagnostic) => diagnostic.edgeId === edge.id) : [];

  return <aside className="properties-panel edge-properties-panel">
    <InspectorHeading />
     <div className="selected-summary"><div className="selected-type-icon edge"><GitBranch size={16} /></div><div><strong>connector</strong><span>{edge.id.slice(0, 16)}</span></div></div>
    <InspectorSection id="edge.connector" title="Connector"><label className="field-label">Label<input value={label} placeholder="Optional label" onChange={(event) => patch({ data: { label: event.target.value } }, 'Edit connector label')} /></label><label className="field-label edge-field-label">Routing<select className="inspector-select" value={edge.type} onChange={(event) => patch({ type: event.target.value, waypoints: event.target.value === 'orthogonal' ? edge.waypoints : [] }, 'Change connector routing')}>{connectorTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label className="field-label edge-field-label">Cardinality<select className="inspector-select" value={cardinality} onChange={(event) => { const option = cardinalityOptions.find((candidate) => candidate.value === event.target.value); if (option) patch({ style: { startMarker: option.start, endMarker: option.end } }, 'Change cardinality'); }}>{cardinality === 'custom' && <option value="custom">Custom markers</option>}{cardinalityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><span className="inspector-hint">{connectorHint}</span>{dfdDiagnostics.map((diagnostic) => <div className={`erd-diagnostic ${diagnostic.severity}`} key={diagnostic.message}>{diagnostic.message}</div>)}</InspectorSection>
    <InspectorSection id="edge.connections" title="Connections"><span className="inspector-hint connection-hint">Drag the endpoint handles anywhere on the canvas, or reconnect them to a node.</span><EndpointEditor label="Start" endpoint={edge.source} otherEndpoint={edge.target} node={sourceNode} otherNode={targetNode} nodes={nodes} onChange={updateSource} /><EndpointEditor label="End" endpoint={edge.target} otherEndpoint={edge.source} node={targetNode} otherNode={sourceNode} nodes={nodes} onChange={updateTarget} /></InspectorSection>
    {edge.type === 'orthogonal' && <InspectorSection id="edge.waypoints" title="Waypoints" action={<button className="property-add" title="Add waypoint" aria-label="Add waypoint" onClick={addWaypoint}><Plus size={13} /></button>}>{edge.waypoints.length === 0 ? <span className="inspector-hint">No waypoints. The route will use automatic bends.</span> : <div className="waypoint-list">{edge.waypoints.map((point, index) => <div className="waypoint-row" key={`${index}-${point.x}-${point.y}`}><span>{index + 1}</span><input aria-label={`Waypoint ${index + 1} X`} type="number" value={Math.round(point.x)} onChange={(event) => updateWaypoint(index, { x: Number(event.target.value) })} /><input aria-label={`Waypoint ${index + 1} Y`} type="number" value={Math.round(point.y)} onChange={(event) => updateWaypoint(index, { y: Number(event.target.value) })} /><button className="field-delete" title="Delete waypoint" aria-label={`Delete waypoint ${index + 1}`} onClick={() => removeWaypoint(index)}><Trash2 size={11} /></button></div>)}</div>}</InspectorSection>}
    <InspectorSection id="edge.appearance" title="Appearance"><label className="field-label edge-field-label">Line style<select className="inspector-select" value={edge.style.dash} onChange={(event) => patch({ style: { dash: event.target.value as EdgeStyle['dash'] } }, 'Change line style')}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label><label className="field-label edge-field-label">Start marker<select className="inspector-select" value={edge.style.startMarker} onChange={(event) => patch({ style: { startMarker: event.target.value as EdgeMarker } }, 'Change start marker')}>{markerOptions.map((marker) => <option key={marker.value} value={marker.value}>{marker.label}</option>)}</select></label><label className="field-label edge-field-label">End marker<select className="inspector-select" value={edge.style.endMarker} onChange={(event) => patch({ style: { endMarker: event.target.value as EdgeMarker } }, 'Change end marker')}>{markerOptions.map((marker) => <option key={marker.value} value={marker.value}>{marker.label}</option>)}</select></label></InspectorSection>
     <div className="property-bottom-actions"><button title="Reset connector" onClick={() => resetEdge(edge.id)}><RotateCcw size={15} /></button><button title="Delete connector" className="danger" onClick={deleteSelection}><Trash2 size={15} /></button></div>
  </aside>;
}

function nodeLabel(node: DiagramNode): string {
  const label = typeof node.data.label === 'string' ? node.data.label.trim() : '';
  return label || node.type;
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
