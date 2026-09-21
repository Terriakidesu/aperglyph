import { ChevronDown, Circle, Database, Diamond, Minus, MousePointer2, Plus, RectangleHorizontal, Search, Square, Table2, Type, Workflow } from 'lucide-react';
import { useState } from 'react';
import { pluginManager } from '../plugins';
import type { ShapeDefinition, ShapeIconId } from '../plugins';
import { createNode } from '../core/document';
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
  const [openGroups, setOpenGroups] = useState({ basics: true, library: true });
  const plugin = pluginManager.get(document.diagramType);
  const basicShapes = pluginManager.get('general').shapes;
  const libraryShapes = plugin.id === 'general' ? [] : plugin.shapes;
  const matches = (shape: ShapeDefinition) => `${shape.label} ${shape.tags?.join(' ') ?? ''}`.toLowerCase().includes(search.toLowerCase());

  const addShape = (shape: ShapeDefinition) => {
    create(createNode(shape.type, { x: -90, y: -50 }, {
      library: plugin.id,
      size: shape.defaultSize,
      style: shape.defaultStyle,
      data: shape.defaultData ?? { label: shape.label },
    }));
  };

  return <aside className="shape-library">
    <div className="panel-title-row"><div><span className="panel-kicker">Library</span><h2>Shapes</h2></div><button className="icon-button"><Plus size={17} /></button></div>
    <div className="library-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search shapes" /></div>
    <div className="library-scroll">
      <ShapeGroup title="Basic shapes" shapes={basicShapes.filter(matches)} open={openGroups.basics} onToggle={() => setOpenGroups((state) => ({ ...state, basics: !state.basics }))} onAdd={addShape} />
      {libraryShapes.length > 0 && <ShapeGroup title={`${plugin.name} library`} shapes={libraryShapes.filter(matches)} open={openGroups.library} onToggle={() => setOpenGroups((state) => ({ ...state, library: !state.library }))} onAdd={addShape} />}
    </div>
    <div className="library-footnote"><MousePointer2 size={14} /><span>Click a shape to add it<br />to the center of your canvas.</span></div>
  </aside>;
}

function ShapeGroup({ title, shapes, open, onToggle, onAdd }: { title: string; shapes: ShapeDefinition[]; open: boolean; onToggle: () => void; onAdd: (shape: ShapeDefinition) => void }) {
  return <div className="shape-group"><button className="group-heading" onClick={onToggle}><span>{title}</span><ChevronDown size={14} className={!open ? 'collapsed' : ''} /></button>{open && <div className="shape-list">{shapes.map((shape) => <button className="shape-item" key={`${shape.id}-${shape.type}`} onClick={() => onAdd(shape)}>{shapeIcon(shape)}<span>{shape.label}</span><span className="shape-drag-hint">+</span></button>)}</div>}</div>;
}

function shapeIcon(shape: ShapeDefinition) {
  const Icon = iconMap[shape.icon];
  return <div className={`shape-mini ${shape.type}`}><Icon size={16} /></div>;
}
