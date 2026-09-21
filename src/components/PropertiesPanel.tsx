import { AlignCenter, ChevronDown, Copy, GitBranch, KeyRound, Link2, Lock, MoreHorizontal, Palette, Plus, RotateCw, Trash2, Unlock } from 'lucide-react';
import { useMemo } from 'react';
import { validateDfd } from '../core/dfd';
import { createEntityField, entityAutoHeight, normalizeEntityFields, validateErd } from '../core/erd';
import { nodeCenter } from '../core/geometry';
import type { DiagramDocument, DiagramEdge, DiagramNode, EdgeMarker, EdgePatch, EdgeStyle, Point } from '../core/types';
import { pluginManager } from '../plugins';
import { getActivePage, useEditorStore } from '../store/editorStore';
import type { EntityField } from '../core/erd';

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

  if (selectedIds.length > 1) return <EmptyProperties multiSelection={selectedIds.length} />;
  if (selectedEdge) return <EdgePropertiesPanel edge={selectedEdge} nodes={page?.nodes ?? []} diagramType={document.diagramType} document={document} />;
  if (!selectedNode) return <EmptyProperties />;
  return <NodePropertiesPanel node={selectedNode} document={document} />;
}

function EmptyProperties({ multiSelection }: { multiSelection?: number }) {
  return <aside className="properties-panel empty-properties">
    <InspectorHeading />
    {multiSelection ? <div className="multi-selection"><div className="multi-icon"><AlignCenter size={20} /></div><strong>{multiSelection} objects selected</strong><span>Move or align them together</span><div className="quick-actions"><button><AlignCenter size={14} /> Align</button><button><Copy size={14} /> Duplicate</button></div></div> : <div className="no-selection"><div className="no-selection-art"><div /><div /><div /></div><strong>Nothing selected</strong><span>Select an object to<br />inspect its properties.</span></div>}
  </aside>;
}

function InspectorHeading() {
  return <div className="panel-title-row"><div><span className="panel-kicker">Inspector</span><h2>Properties</h2></div><button className="icon-button"><MoreHorizontal size={17} /></button></div>;
}

function NodePropertiesPanel({ node, document }: { node: DiagramNode; document: DiagramDocument }) {
  const updateNode = useEditorStore((state) => state.updateNode);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const label = typeof node.data.label === 'string' ? node.data.label : node.type;
  const updateLabel = (value: string) => updateNode(node.id, { data: { label: value } }, 'Edit label');
  const isErdEntity = document.diagramType === 'erd' && node.type === 'entity';
  const isDfdElement = document.diagramType === 'dfd' && ['process', 'external', 'store'].includes(node.type);
  const entityFields = isErdEntity ? normalizeEntityFields(node.data.fields) : [];
  const diagnostics = isErdEntity ? validateErd(document).filter((diagnostic) => diagnostic.nodeId === node.id) : [];
  const dfdDiagnostics = isDfdElement ? validateDfd(document).filter((diagnostic) => diagnostic.nodeId === node.id) : [];
  const updateFields = (fields: EntityField[], action = 'Update attributes') => updateNode(node.id, { data: { fields }, size: { ...node.size, height: entityAutoHeight(fields) } }, action);
  const updateField = (index: number, changes: Partial<EntityField>) => updateFields(entityFields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...changes } : field), 'Edit attribute');

  return <aside className="properties-panel">
    <InspectorHeading />
    <div className="selected-summary"><div className={`selected-type-icon ${node.type}`}><Palette size={16} /></div><div><strong>{node.type.replace('-', ' ')}</strong><span>{node.id.slice(0, 16)}</span></div><button className="icon-button"><MoreHorizontal size={16} /></button></div>
    <div className="property-section"><div className="property-heading"><span>Content</span><ChevronDown size={14} /></div><label className="field-label">Label<input value={label} onChange={(event) => updateLabel(event.target.value)} /></label></div>
    {isErdEntity && <div className="property-section entity-properties"><div className="property-heading"><span>Attributes</span><button className="property-add" title="Add attribute" onClick={() => updateFields([...entityFields, createEntityField()], 'Add attribute')}><Plus size={13} /></button></div><div className="entity-field-list">{entityFields.map((field, index) => <div className="entity-field-row" key={field.id}><div className="entity-field-inputs"><input aria-label={`Attribute ${index + 1} name`} value={field.name} onChange={(event) => updateField(index, { name: event.target.value })} /><input aria-label={`Attribute ${index + 1} type`} value={field.type} onChange={(event) => updateField(index, { type: event.target.value })} /></div><div className="entity-field-actions"><button className={field.primaryKey ? 'field-flag active' : 'field-flag'} title="Primary key" onClick={() => updateField(index, { primaryKey: !field.primaryKey })}><KeyRound size={11} /></button><button className={field.foreignKey ? 'field-flag active' : 'field-flag'} title="Foreign key" onClick={() => updateField(index, { foreignKey: !field.foreignKey })}><Link2 size={11} /></button><button className={field.nullable ? 'field-flag' : 'field-flag active'} title="Nullable" onClick={() => updateField(index, { nullable: !field.nullable })}>N</button><button className="field-delete" title="Delete attribute" onClick={() => updateFields(entityFields.filter((_, fieldIndex) => fieldIndex !== index), 'Delete attribute')}><Trash2 size={11} /></button></div></div>)}</div><div className="entity-style-toggle"><span>Striped rows</span><button className={node.data.striped !== false ? 'toggle-button active' : 'toggle-button'} onClick={() => updateNode(node.id, { data: { striped: node.data.striped === false } }, 'Toggle row striping')}><span /></button></div>{diagnostics.map((diagnostic) => <div className={`erd-diagnostic ${diagnostic.severity}`} key={diagnostic.message}>{diagnostic.message}</div>)}</div>}
    {isDfdElement && <div className="property-section"><div className="property-heading"><span>DFD semantics</span><ChevronDown size={14} /></div><span className="inspector-hint">{node.type === 'external' ? 'External entities exchange data through processes.' : node.type === 'store' ? 'Data stores should be mediated by processes.' : 'Processes transform incoming data into outgoing data.'}</span>{dfdDiagnostics.map((diagnostic) => <div className={`erd-diagnostic ${diagnostic.severity}`} key={diagnostic.message}>{diagnostic.message}</div>)}</div>}
    <div className="property-section"><div className="property-heading"><span>Layout</span><ChevronDown size={14} /></div><div className="coordinate-grid"><label className="field-label">X<input type="number" value={Math.round(node.position.x)} onChange={(event) => updateNode(node.id, { position: { ...node.position, x: Number(event.target.value) } }, 'Move node')} /></label><label className="field-label">Y<input type="number" value={Math.round(node.position.y)} onChange={(event) => updateNode(node.id, { position: { ...node.position, y: Number(event.target.value) } }, 'Move node')} /></label><label className="field-label">W<input type="number" value={Math.round(node.size.width)} onChange={(event) => updateNode(node.id, { size: { ...node.size, width: Number(event.target.value) } }, 'Resize node')} /></label><label className="field-label">H<input type="number" value={Math.round(node.size.height)} onChange={(event) => updateNode(node.id, { size: { ...node.size, height: Number(event.target.value) } }, 'Resize node')} /></label></div></div>
    <div className="property-section"><div className="property-heading"><span>Appearance</span><ChevronDown size={14} /></div><div className="color-row"><span>Fill</span><div className="swatches">{swatches.map((color) => <button key={color} className={`swatch ${node.style.fill === color ? 'selected' : ''}`} style={{ background: color }} onClick={() => updateNode(node.id, { style: { fill: color } }, 'Change fill')} />)}</div></div><div className="color-row"><span>Stroke</span><button className="stroke-preview" style={{ borderColor: node.style.stroke }} onClick={() => updateNode(node.id, { style: { stroke: node.style.stroke === '#59627a' ? '#9c86ff' : '#59627a' } }, 'Change stroke')}><span style={{ background: node.style.stroke }} /></button></div></div>
    <div className="property-bottom-actions"><button title={node.locked ? 'Unlock' : 'Lock'} onClick={() => updateNode(node.id, { locked: !node.locked }, node.locked ? 'Unlock node' : 'Lock node')}>{node.locked ? <Unlock size={15} /> : <Lock size={15} />}</button><button title="Rotate"><RotateCw size={15} /></button><button title="Delete" className="danger" onClick={deleteSelection}><Trash2 size={15} /></button></div>
  </aside>;
}

function EdgePropertiesPanel({ edge, nodes, diagramType, document }: { edge: DiagramEdge; nodes: DiagramNode[]; diagramType: string; document: DiagramDocument }) {
  const updateEdge = useEditorStore((state) => state.updateEdge);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const plugin = pluginManager.get(diagramType);
  const patch = (changes: EdgePatch, action = 'Update connector') => updateEdge(edge.id, changes, action);
  const updateSource = (changes: Partial<DiagramEdge['source']>, action = 'Edit source connection') => patch({ source: { ...edge.source, ...changes }, ...(changes.nodeId && changes.nodeId !== edge.source.nodeId ? { waypoints: [] } : {}) }, action);
  const updateTarget = (changes: Partial<DiagramEdge['target']>, action = 'Edit target connection') => patch({ target: { ...edge.target, ...changes }, ...(changes.nodeId && changes.nodeId !== edge.target.nodeId ? { waypoints: [] } : {}) }, action);
  const sourceNode = nodes.find((node) => node.id === edge.source.nodeId);
  const targetNode = nodes.find((node) => node.id === edge.target.nodeId);
  const label = typeof edge.data.label === 'string' ? edge.data.label : '';
  const addWaypoint = () => {
    const source = sourceNode ? nodeCenter(sourceNode) : { x: 0, y: 0 };
    const target = targetNode ? nodeCenter(targetNode) : source;
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
    <div className="selected-summary"><div className="selected-type-icon edge"><GitBranch size={16} /></div><div><strong>connector</strong><span>{edge.id.slice(0, 16)}</span></div><button className="icon-button"><MoreHorizontal size={16} /></button></div>
    <div className="property-section"><div className="property-heading"><span>Connector</span><ChevronDown size={14} /></div><label className="field-label">Label<input value={label} placeholder="Optional label" onChange={(event) => patch({ data: { label: event.target.value } }, 'Edit connector label')} /></label><label className="field-label edge-field-label">Routing<select className="inspector-select" value={edge.type} onChange={(event) => patch({ type: event.target.value, waypoints: event.target.value === 'orthogonal' ? edge.waypoints : [] }, 'Change connector routing')}>{connectorTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label className="field-label edge-field-label">Cardinality<select className="inspector-select" value={cardinality} onChange={(event) => { const option = cardinalityOptions.find((candidate) => candidate.value === event.target.value); if (option) patch({ style: { startMarker: option.start, endMarker: option.end } }, 'Change cardinality'); }}>{cardinality === 'custom' && <option value="custom">Custom markers</option>}{cardinalityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><span className="inspector-hint">{connectorHint}</span>{dfdDiagnostics.map((diagnostic) => <div className={`erd-diagnostic ${diagnostic.severity}`} key={diagnostic.message}>{diagnostic.message}</div>)}</div>
    <div className="property-section"><div className="property-heading"><span>Connections</span><ChevronDown size={14} /></div><div className="edge-endpoint"><strong>Start</strong><label className="field-label">Node<select className="inspector-select" value={edge.source.nodeId} onChange={(event) => updateSource({ nodeId: event.target.value })}>{nodes.map((node) => <option key={node.id} value={node.id}>{nodeLabel(node)}</option>)}</select></label><label className="field-label">Port<select className="inspector-select" value={edge.source.port ?? ''} onChange={(event) => updateSource({ port: event.target.value || undefined }, 'Change source port')}>{portOptions.map((port) => <option key={port.value} value={port.value}>{port.label}</option>)}</select></label></div><div className="edge-endpoint"><strong>End</strong><label className="field-label">Node<select className="inspector-select" value={edge.target.nodeId} onChange={(event) => updateTarget({ nodeId: event.target.value })}>{nodes.map((node) => <option key={node.id} value={node.id}>{nodeLabel(node)}</option>)}</select></label><label className="field-label">Port<select className="inspector-select" value={edge.target.port ?? ''} onChange={(event) => updateTarget({ port: event.target.value || undefined }, 'Change target port')}>{portOptions.map((port) => <option key={port.value} value={port.value}>{port.label}</option>)}</select></label></div></div>
    {edge.type === 'orthogonal' && <div className="property-section"><div className="property-heading"><span>Waypoints</span><button className="property-add" title="Add waypoint" onClick={addWaypoint}><Plus size={13} /></button></div>{edge.waypoints.length === 0 ? <span className="inspector-hint">No waypoints. The route will use automatic bends.</span> : <div className="waypoint-list">{edge.waypoints.map((point, index) => <div className="waypoint-row" key={`${index}-${point.x}-${point.y}`}><span>{index + 1}</span><input aria-label={`Waypoint ${index + 1} X`} type="number" value={Math.round(point.x)} onChange={(event) => updateWaypoint(index, { x: Number(event.target.value) })} /><input aria-label={`Waypoint ${index + 1} Y`} type="number" value={Math.round(point.y)} onChange={(event) => updateWaypoint(index, { y: Number(event.target.value) })} /><button className="field-delete" title="Delete waypoint" onClick={() => removeWaypoint(index)}><Trash2 size={11} /></button></div>)}</div>}</div>}
    <div className="property-section"><div className="property-heading"><span>Appearance</span><ChevronDown size={14} /></div><label className="field-label edge-field-label">Line style<select className="inspector-select" value={edge.style.dash} onChange={(event) => patch({ style: { dash: event.target.value as EdgeStyle['dash'] } }, 'Change line style')}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label><label className="field-label edge-field-label">Start marker<select className="inspector-select" value={edge.style.startMarker} onChange={(event) => patch({ style: { startMarker: event.target.value as EdgeMarker } }, 'Change start marker')}>{markerOptions.map((marker) => <option key={marker.value} value={marker.value}>{marker.label}</option>)}</select></label><label className="field-label edge-field-label">End marker<select className="inspector-select" value={edge.style.endMarker} onChange={(event) => patch({ style: { endMarker: event.target.value as EdgeMarker } }, 'Change end marker')}>{markerOptions.map((marker) => <option key={marker.value} value={marker.value}>{marker.label}</option>)}</select></label></div>
    <div className="property-bottom-actions"><button title="Delete connector" className="danger" onClick={deleteSelection}><Trash2 size={15} /></button></div>
  </aside>;
}

function nodeLabel(node: DiagramNode): string {
  const label = typeof node.data.label === 'string' ? node.data.label.trim() : '';
  return label || node.type;
}
