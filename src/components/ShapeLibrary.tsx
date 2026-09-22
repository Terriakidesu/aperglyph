import { ChevronDown, Circle, Database, Diamond, MousePointer2, RectangleHorizontal, Search, Square, Star, Table2, Type, Workflow } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { pluginManager } from '../plugins';
import type { ShapeDefinition, ShapeIconId } from '../plugins';
import { createNode } from '../core/document';
import { SHAPE_DRAG_MIME, serializeShapeDrop } from '../core/shapeTransfer';
import { useEditorStore } from '../store/editorStore';

const FAVORITES_KEY = 'aperglyph.shape-library.favorites';
const RECENT_KEY = 'aperglyph.shape-library.recent';

const iconMap: Record<ShapeIconId, typeof Square> = {
  square: Square,
  'rounded-rectangle': RectangleHorizontal,
  circle: Circle,
  diamond: Diamond,
  text: Type,
  line: RectangleHorizontal,
  database: Database,
  table: Table2,
  workflow: Workflow,
};

type LibraryFilter = 'all' | 'favorites' | 'recent';
type LibraryScope = 'all' | string;

export function ShapeLibrary() {
  const document = useEditorStore((state) => state.document);
  const viewport = useEditorStore((state) => state.viewport);
  const create = useEditorStore((state) => state.createNode);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>(() => readLibraryFilter());
  const [libraryScope, setLibraryScope] = useState<LibraryScope>(() => readLibraryScope());
  const [favorites, setFavorites] = useState<string[]>(readList(FAVORITES_KEY));
  const [recent, setRecent] = useState<string[]>(readList(RECENT_KEY));
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => readGroups());
  const plugins = useSyncExternalStore(pluginManager.subscribe, pluginManager.getSnapshot, pluginManager.getSnapshot);
  const normalizedSearch = search.trim().toLowerCase();
  const shapeKey = (libraryId: string, shape: ShapeDefinition) => `${libraryId}:${shape.type}`;
  const isFavorite = (libraryId: string, shape: ShapeDefinition) => favorites.includes(shapeKey(libraryId, shape));
  const matches = (shape: ShapeDefinition, libraryId: string) => {
    if (libraryScope !== 'all' && libraryScope !== libraryId) return false;
    if (normalizedSearch && !`${shape.label} ${shape.tags?.join(' ') ?? ''}`.toLowerCase().includes(normalizedSearch)) return false;
    const key = shapeKey(libraryId, shape);
    if (filter === 'favorites') return favorites.includes(key);
    if (filter === 'recent') return recent.includes(key);
    return true;
  };

  const visibleCount = plugins.reduce((count, plugin) => count + plugin.shapes.filter((shape) => matches(shape, plugin.id)).length, 0);
  const countVisible = normalizedSearch.length > 0 || filter !== 'all' || libraryScope !== 'all';

  const addShape = (shape: ShapeDefinition, libraryId: string) => {
    const size = shape.defaultSize ?? { width: 180, height: 88 };
    const next = [shapeKey(libraryId, shape), ...recent.filter((key) => key !== shapeKey(libraryId, shape))].slice(0, 12);
    setRecent(next);
    writeList(RECENT_KEY, next);
    create(createNode(shape.type, { x: -viewport.x - size.width / 2, y: -viewport.y - size.height / 2 }, {
      library: libraryId,
      size,
      boundary: shape.boundary,
      container: shape.container,
      style: shape.defaultStyle,
      data: shape.defaultData ?? { label: shape.label },
    }));
  };

  const toggleFavorite = (libraryId: string, shape: ShapeDefinition) => {
    const key = shapeKey(libraryId, shape);
    const next = favorites.includes(key) ? favorites.filter((item) => item !== key) : [key, ...favorites].slice(0, 64);
    setFavorites(next);
    writeList(FAVORITES_KEY, next);
  };

  return <aside className="shape-library">
    <div className="panel-title-row shape-library-heading"><div><span className="panel-kicker">Library</span><h2>Shapes</h2></div>{countVisible && <span className="library-count">{visibleCount}</span>}</div>
    <div className="library-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search shapes" aria-label="Search shapes" /></div>
    <div className="library-filters" role="tablist" aria-label="Shape library filters">
      {(['all', 'favorites', 'recent'] as LibraryFilter[]).map((value) => <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? 'active' : ''} onClick={() => { setFilter(value); writeLibraryFilter(value); }}>{value === 'all' ? 'All' : value === 'favorites' ? 'Favorites' : 'Recent'}</button>)}
    </div>
    <label className="library-scope"><span>Library</span><select aria-label="Shape library category" value={libraryScope} onChange={(event) => { setLibraryScope(event.target.value); writeLibraryScope(event.target.value); }}><option value="all">All libraries</option>{plugins.map((plugin) => <option key={plugin.id} value={plugin.id}>{plugin.name}</option>)}</select></label>
    <div className="library-scroll">
      {plugins.map((plugin) => {
        const shapes = plugin.shapes.filter((shape) => matches(shape, plugin.id));
        if (shapes.length === 0) return null;
        const open = openGroups[plugin.id] ?? true;
         return <ShapeGroup key={plugin.id} title={plugin.id === 'general' ? 'Basic shapes' : `${plugin.name} shapes`} shapes={shapes} open={open} onToggle={() => {
          const next = { ...openGroups, [plugin.id]: !open };
          setOpenGroups(next);
          writeGroups(next);
         }} onAdd={(shape) => addShape(shape, plugin.id)} libraryId={plugin.id} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} isRecent={(shape) => recent.includes(shapeKey(plugin.id, shape))} />;
      })}
      {plugins.every((plugin) => plugin.shapes.every((shape) => !matches(shape, plugin.id))) && <div className="library-empty"><Search size={15} /><span>No shapes match this filter.</span></div>}
    </div>
    <div className="library-footnote"><MousePointer2 size={14} /><span>Click to add at the viewport center<br />or drag a shape onto the canvas.</span></div>
  </aside>;
}

function ShapeGroup({ title, shapes, open, onToggle, onAdd, libraryId, isFavorite, onToggleFavorite, isRecent }: { title: string; shapes: ShapeDefinition[]; open: boolean; onToggle: () => void; onAdd: (shape: ShapeDefinition) => void; libraryId: string; isFavorite: (libraryId: string, shape: ShapeDefinition) => boolean; onToggleFavorite: (libraryId: string, shape: ShapeDefinition) => void; isRecent: (shape: ShapeDefinition) => boolean }) {
  return <div className="shape-group"><button className="group-heading" onClick={onToggle}><span>{title}</span><ChevronDown size={14} className={!open ? 'collapsed' : ''} /></button>{open && <div className="shape-list">{shapes.map((shape) => <div className={`shape-item-row ${isRecent(shape) ? 'recent' : ''}`} key={`${shape.id}-${shape.type}`}><button className="shape-item" draggable title={`Drag ${shape.label} onto the canvas`} onClick={() => onAdd(shape)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; const payload = serializeShapeDrop(libraryId, shape); event.dataTransfer.setData(SHAPE_DRAG_MIME, payload); event.dataTransfer.setData('text/plain', payload); }}>{shapeIcon(shape)}<span>{shape.label}</span><span className="shape-drag-hint">+</span></button><button className={isFavorite(libraryId, shape) ? 'shape-favorite active' : 'shape-favorite'} title={isFavorite(libraryId, shape) ? `Remove ${shape.label} from favorites` : `Favorite ${shape.label}`} aria-label={isFavorite(libraryId, shape) ? `Remove ${shape.label} from favorites` : `Favorite ${shape.label}`} onClick={() => onToggleFavorite(libraryId, shape)}><Star size={12} fill={isFavorite(libraryId, shape) ? 'currentColor' : 'none'} /></button></div>)}</div>}</div>;
}

function shapeIcon(shape: ShapeDefinition) {
  const Icon = iconMap[shape.icon] ?? Square;
  return <div className={`shape-mini ${shape.type}`}><Icon size={16} /></div>;
}

function readList(key: string): string[] {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(key) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 64) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, value: string[]): void {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* optional UI preference */ }
}

function readGroups(): Record<string, boolean> {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem('aperglyph.shape-library.groups') ?? '{}') as unknown;
    return value && typeof value === 'object' ? value as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

function writeGroups(value: Record<string, boolean>): void {
  try { globalThis.localStorage?.setItem('aperglyph.shape-library.groups', JSON.stringify(value)); } catch { /* optional UI preference */ }
}

function readLibraryFilter(): LibraryFilter {
  try {
    const value = globalThis.localStorage?.getItem('aperglyph.shape-library.filter');
    return value === 'favorites' || value === 'recent' ? value : 'all';
  } catch {
    return 'all';
  }
}

function writeLibraryFilter(value: LibraryFilter): void {
  try { globalThis.localStorage?.setItem('aperglyph.shape-library.filter', value); } catch { /* optional UI preference */ }
}

function readLibraryScope(): LibraryScope {
  try { return globalThis.localStorage?.getItem('aperglyph.shape-library.scope') ?? 'all'; } catch { return 'all'; }
}

function writeLibraryScope(value: LibraryScope): void {
  try { globalThis.localStorage?.setItem('aperglyph.shape-library.scope', value); } catch { /* optional UI preference */ }
}
