import { ChevronDown, Circle, Database, Diamond, Minus, MousePointer2, Plus, RectangleHorizontal, Search, Square, Table2, Type, Workflow } from 'lucide-react';
import { useState } from 'react';
import { createNode } from '../core/document';
import type { DiagramType, NodeStyle } from '../core/types';
import { useEditorStore } from '../store/editorStore';

interface ShapeItem { type: string; label: string; icon: typeof Square; style?: Partial<NodeStyle>; size?: { width: number; height: number }; data?: Record<string, unknown> }

const generalShapes: ShapeItem[] = [
  { type: 'rectangle', label: 'Rectangle', icon: Square },
  { type: 'rounded-rectangle', label: 'Rounded rectangle', icon: RectangleHorizontal },
  { type: 'circle', label: 'Circle', icon: Circle, size: { width: 112, height: 112 } },
  { type: 'diamond', label: 'Diamond', icon: Diamond, size: { width: 160, height: 110 } },
  { type: 'text', label: 'Text', icon: Type, size: { width: 190, height: 56 }, data: { label: 'Text label' } },
  { type: 'line', label: 'Line', icon: Minus, size: { width: 190, height: 32 } },
];

const libraryShapes: Record<DiagramType, ShapeItem[]> = {
  general: generalShapes,
  flowchart: [
    { type: 'start', label: 'Start / end', icon: Circle, size: { width: 160, height: 64 }, style: { fill: '#15362f', stroke: '#43d6a6', radius: 32 } },
    { type: 'process', label: 'Process', icon: Square, data: { label: 'Process' } },
    { type: 'decision', label: 'Decision', icon: Diamond, size: { width: 160, height: 112 }, style: { fill: '#302a4c', stroke: '#9c86ff' }, data: { label: 'Decision?' } },
    { type: 'input', label: 'Input / output', icon: RectangleHorizontal, style: { fill: '#1f2e43', stroke: '#76b8ff' } },
  ],
  erd: [
    { type: 'entity', label: 'Entity', icon: Table2, size: { width: 220, height: 150 }, style: { fill: '#1d2334', stroke: '#8496ff' }, data: { label: 'table_name', fields: ['id · uuid · PK', 'name · varchar'] } },
    { type: 'attribute', label: 'Attribute', icon: Database, size: { width: 180, height: 64 }, data: { label: 'attribute' } },
  ],
  dfd: [
    { type: 'process', label: 'Process', icon: Workflow, style: { fill: '#302a4c', stroke: '#9c86ff' } },
    { type: 'external', label: 'External entity', icon: Square, style: { fill: '#1b3035', stroke: '#42c8d4' } },
    { type: 'store', label: 'Data store', icon: Database, style: { fill: '#302b24', stroke: '#e0a95b' } },
  ],
  'use-case': [
    { type: 'actor', label: 'Actor', icon: Circle, size: { width: 120, height: 140 }, style: { fill: '#182a32', stroke: '#55bed2' }, data: { label: 'Actor' } },
    { type: 'use-case', label: 'Use case', icon: Circle, size: { width: 190, height: 72 }, style: { fill: '#2a2550', stroke: '#9c86ff', radius: 36 }, data: { label: 'Use case' } },
    { type: 'boundary', label: 'System boundary', icon: Square, size: { width: 260, height: 180 }, style: { fill: '#151927', stroke: '#747d98', radius: 18 }, data: { label: 'System' } },
  ],
};

function shapeIcon(item: ShapeItem) {
  const Icon = item.icon;
  return <div className={`shape-mini ${item.type}`}><Icon size={16} /></div>;
}

export function ShapeLibrary() {
  const document = useEditorStore((state) => state.document);
  const create = useEditorStore((state) => state.createNode);
  const [search, setSearch] = useState('');
  const [openGroups, setOpenGroups] = useState({ basics: true, library: true });
  const type = document.diagramType;
  const library = libraryShapes[type] ?? generalShapes;
  const filteredGeneral = generalShapes.filter((item) => item.label.toLowerCase().includes(search.toLowerCase()));
  const filteredLibrary = library.filter((item) => item.label.toLowerCase().includes(search.toLowerCase()));

  const addShape = (item: ShapeItem) => {
    const node = createNode(item.type, { x: -90, y: -50 }, { library: type, size: item.size, style: item.style, data: item.data ?? { label: item.label } });
    create(node);
  };

  return <aside className="shape-library">
    <div className="panel-title-row"><div><span className="panel-kicker">Library</span><h2>Shapes</h2></div><button className="icon-button"><Plus size={17} /></button></div>
    <div className="library-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search shapes" /></div>
    <div className="library-scroll">
      <div className="shape-group"><button className="group-heading" onClick={() => setOpenGroups((state) => ({ ...state, basics: !state.basics }))}><span>Basic shapes</span><ChevronDown size={14} className={!openGroups.basics ? 'collapsed' : ''} /></button>{openGroups.basics && <div className="shape-list">{filteredGeneral.map((item) => <button className="shape-item" key={item.type} onClick={() => addShape(item)}>{shapeIcon(item)}<span>{item.label}</span><span className="shape-drag-hint">+</span></button>)}</div>}</div>
      <div className="shape-group"><button className="group-heading" onClick={() => setOpenGroups((state) => ({ ...state, library: !state.library }))}><span>{type === 'use-case' ? 'UML use case' : `${type.toUpperCase()} library`}</span><ChevronDown size={14} className={!openGroups.library ? 'collapsed' : ''} /></button>{openGroups.library && <div className="shape-list">{filteredLibrary.map((item) => <button className="shape-item" key={item.type} onClick={() => addShape(item)}>{shapeIcon(item)}<span>{item.label}</span><span className="shape-drag-hint">+</span></button>)}</div>}</div>
    </div>
    <div className="library-footnote"><MousePointer2 size={14} /><span>Click a shape to add it<br />to the center of your canvas.</span></div>
  </aside>;
}
