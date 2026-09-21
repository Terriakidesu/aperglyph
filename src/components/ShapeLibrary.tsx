import { ChevronDown, Circle, Database, Diamond, Minus, MousePointer2, Plus, RectangleHorizontal, Search, Square, Table2, Type, Workflow } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { pluginManager } from '../plugins';
import type { ShapeDefinition, ShapeIconId } from '../plugins';
import { createNode } from '../core/document';
import { SHAPE_DRAG_MIME, serializeShapeDrop } from '../core/shapeTransfer';
import { useEditorStore } from '../store/editorStore';

const iconMap: Record<ShapeIconId, typeof Square> = {
  square: Square,
  'rounded-rectangle': RectangleHorizontal,
  circle: Circle,
  diamond: Diamond,
  text: Type,
  line: Minus,
  database: Database,
  table: Table2,
  workflow: Workflow,
};

export function ShapeLibrary() {
  const document = useEditorStore((state) => state.document);
  const create = useEditorStore((state) => state.createNode);
  const [search, setSearch] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ general: true });
  const plugins = useSyncExternalStore(pluginManager.subscribe, pluginManager.getSnapshot, pluginManager.getSnapshot);
  const generalPlugin = pluginManager.get('general');
  const matches = (shape: ShapeDefinition) => `${shape.label} ${shape.tags?.join(' ') ?? ''}`.toLowerCase().includes(search.toLowerCase());

  const addShape = (shape: ShapeDefinition, libraryId: string) => {
    create(createNode(shape.type, { x: -90, y: -50 }, {
      library: libraryId,
      size: shape.defaultSize,
      boundary: shape.boundary,
      style: shape.defaultStyle,
      data: shape.defaultData ?? { label: shape.label },
    }));
  };

  return <aside className="shape-library">
    <div className="panel-title-row"><div><span className="panel-kicker">Library</span><h2>Shapes</h2></div><button className="icon-button" title="Add rectangle" onClick={() => addShape(generalPlugin.shapes[0], generalPlugin.id)}><Plus size={17} /></button></div>
    <div className="library-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search shapes" /></div>
     <div className="library-scroll">
       {plugins.map((plugin) => {
         const open = openGroups[plugin.id] ?? true;
          return <ShapeGroup key={plugin.id} title={plugin.id === 'general' ? 'Basic shapes' : `${plugin.name} shapes`} shapes={plugin.shapes.filter(matches)} open={open} onToggle={() => setOpenGroups((state) => ({ ...state, [plugin.id]: !open }))} onAdd={(shape) => addShape(shape, plugin.id)} libraryId={plugin.id} />;
       })}
    </div>
     <div className="library-footnote"><MousePointer2 size={14} /><span>Click to add a shape<br />or drag it onto the canvas.</span></div>
  </aside>;
}

function ShapeGroup({ title, shapes, open, onToggle, onAdd, libraryId }: { title: string; shapes: ShapeDefinition[]; open: boolean; onToggle: () => void; onAdd: (shape: ShapeDefinition) => void; libraryId: string }) {
  return <div className="shape-group"><button className="group-heading" onClick={onToggle}><span>{title}</span><ChevronDown size={14} className={!open ? 'collapsed' : ''} /></button>{open && <div className="shape-list">{shapes.map((shape) => <button className="shape-item" draggable key={`${shape.id}-${shape.type}`} onClick={() => onAdd(shape)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; const payload = serializeShapeDrop(libraryId, shape); event.dataTransfer.setData(SHAPE_DRAG_MIME, payload); event.dataTransfer.setData('text/plain', payload); }} title={`Drag ${shape.label} onto the canvas`}>{shapeIcon(shape)}<span>{shape.label}</span><span className="shape-drag-hint">+</span></button>)}</div>}</div>;
}

function shapeIcon(shape: ShapeDefinition) {
  const Icon = iconMap[shape.icon] ?? Square;
  return <div className={`shape-mini ${shape.type}`}><Icon size={16} /></div>;
}
