import { ChevronDown, ChevronRight, Circle, Eye, EyeOff, GitBranch, GripVertical, Lock, Unlock, Search, Square, Triangle } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { DiagramEdge, DiagramNode } from '../core/types';
import { getActivePage, useEditorStore } from '../store/editorStore';
import { LeftDockHeader, type LeftPanelId } from './DockHeader';

const OUTLINE_EXPANSION_KEY = 'aperglyph.outline.expanded';

export function OutlinePanel({ activePanel = 'outline', onPanelChange, onCollapse }: { activePanel?: LeftPanelId; onPanelChange?: (panel: LeftPanelId) => void; onCollapse?: () => void }) {
  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const setSelection = useEditorStore((state) => state.setSelection);
  const updateNode = useEditorStore((state) => state.updateNode);
  const updateEdge = useEditorStore((state) => state.updateEdge);
  const reorderNodes = useEditorStore((state) => state.reorderNodes);
  const page = getActivePage(document, activePageId);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const draggedIdRef = useRef<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(globalThis.localStorage?.getItem(OUTLINE_EXPANSION_KEY) ?? '{}') as Record<string, boolean>;
    } catch {
      return {};
    }
  });

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (value: string) => !normalizedQuery || value.toLowerCase().includes(normalizedQuery);
  const nodeLabel = (node: DiagramNode) => typeof node.data.label === 'string' && node.data.label.trim() ? node.data.label : node.type;
  const edgeLabel = (edge: DiagramEdge) => typeof edge.data.label === 'string' && edge.data.label.trim() ? edge.data.label : edge.type;
  const nodes = page?.nodes ?? [];
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const groups = useMemo(() => {
    const grouped = new Map<string, DiagramNode[]>();
    for (const node of nodes) {
      if (!node.groupId) continue;
      const groupedNodes = grouped.get(node.groupId) ?? [];
      groupedNodes.push(node);
      grouped.set(node.groupId, groupedNodes);
    }
    return grouped;
  }, [nodes]);
  const groupEntries = [...groups.entries()].sort(([, left], [, right]) => nodeLabel(left[0]).localeCompare(nodeLabel(right[0])));
  const topLevelContainers = nodes
    .filter((node) => node.container && !node.groupId && !node.containerId)
    .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));
  const rootNodes = nodes
    .filter((node) => !node.groupId && !node.container && (!node.containerId || !nodeById.has(node.containerId)))
    .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));
  const visibleEdges = (page?.edges ?? []).filter((edge) => matches(`${edgeLabel(edge)} ${edge.id} ${edge.type}`));
  const nodeMatches = (node: DiagramNode) => matches(`${nodeLabel(node)} ${node.type} ${node.id}`);
  const containerContainsMatch = (containerId: string, visited = new Set<string>()): boolean => {
    if (visited.has(containerId)) return false;
    visited.add(containerId);
    return nodes.some((node) => node.containerId === containerId && !node.groupId && (node.container ? matches(`Container: ${nodeLabel(node)} ${node.id}`) || containerContainsMatch(node.id, visited) : nodeMatches(node)));
  };

  const setExpandedState = (key: string, value: boolean) => {
    const next = { ...expanded, [key]: value };
    setExpanded(next);
    try {
      globalThis.localStorage?.setItem(OUTLINE_EXPANSION_KEY, JSON.stringify(next));
    } catch {
      // Expansion state is optional UI state.
    }
  };

  const beginRename = (id: string, value: string) => {
    setEditingId(id);
    setDraft(value);
  };

  const commitRename = (id: string, kind: 'node' | 'edge') => {
    const value = draft.trim();
    if (value) {
      if (kind === 'node') updateNode(id, { data: { label: value } }, 'Rename object');
      else updateEdge(id, { data: { label: value } }, 'Rename connector');
    }
    setEditingId(null);
  };

  const onRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, id: string, kind: 'node' | 'edge') => {
    if (event.key === 'Enter') { event.preventDefault(); commitRename(id, kind); }
    if (event.key === 'Escape') { event.preventDefault(); setEditingId(null); }
  };

  const beginDrag = (id: string) => {
    draggedIdRef.current = id;
    setDraggedId(id);
  };

  const endDrag = () => {
    draggedIdRef.current = null;
    setDraggedId(null);
  };

  const wouldCreateContainerCycle = (childId: string, ownerId: string): boolean => {
    const visited = new Set<string>();
    let current: string | undefined = ownerId;
    while (current) {
      if (current === childId || visited.has(current)) return true;
      visited.add(current);
      current = nodeById.get(current)?.containerId;
    }
    return false;
  };

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>, targetId?: string, mode: 'reorder' | 'owner' | 'root' = 'reorder') => {
    event.preventDefault();
    const sourceId = draggedIdRef.current ?? draggedId;
    if (!sourceId) return;
    const source = nodeById.get(sourceId);
    const target = targetId ? nodeById.get(targetId) : undefined;
    if (!source) {
      endDrag();
      return;
    }
    if (mode === 'owner' && target?.container && source.id !== target.id && !wouldCreateContainerCycle(source.id, target.id)) {
      if (source.containerId !== target.id) updateNode(source.id, { containerId: target.id }, 'Assign container ownership');
    } else if (mode === 'root') {
      if (source.containerId) updateNode(source.id, { containerId: undefined }, 'Remove container ownership');
    } else if (targetId && source.id !== targetId) {
      reorderNodes([source.id], targetId);
    }
    endDrag();
  };

  const renderNode = (node: DiagramNode): ReactNode => <OutlineNode
    key={node.id}
    node={node}
    selected={selectedIds.includes(node.id)}
    label={nodeLabel(node)}
    editingId={editingId}
    draft={draft}
    setDraft={setDraft}
    onSelect={() => setSelection([node.id], node.id)}
    onRename={() => commitRename(node.id, 'node')}
    onBeginRename={() => beginRename(node.id, nodeLabel(node))}
    onRenameKeyDown={(event) => onRenameKeyDown(event, node.id, 'node')}
    onToggleHidden={() => updateNode(node.id, { hidden: !node.hidden }, node.hidden ? 'Show object' : 'Hide object')}
    onToggleLocked={() => updateNode(node.id, { locked: !node.locked }, node.locked ? 'Unlock object' : 'Lock object')}
    onDragStart={() => beginDrag(node.id)}
    onDragEnd={endDrag}
    onDrop={handleDrop}
  />;

  const renderContainer = (container: DiagramNode, depth = 0): ReactNode => {
    const directChildren = nodes
      .filter((node) => node.containerId === container.id && !node.groupId)
      .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));
    const matchingChildren = directChildren.filter((node) => node.container ? matches(`Container: ${nodeLabel(node)} ${node.id}`) || containerContainsMatch(node.id) : nodeMatches(node));
    const containerName = `Container: ${nodeLabel(container)}`;
    const containerMatches = matches(`${containerName} ${container.id}`);
    if (normalizedQuery && !containerMatches && matchingChildren.length === 0) return null;
    const expansionKey = `container:${container.id}`;
    const isExpanded = expanded[expansionKey] !== false;
    const visibleChildren = normalizedQuery && !containerMatches ? matchingChildren : directChildren;
    return <div className="outline-group outline-container" key={container.id} style={{ marginLeft: depth * 8 }}>
      <div
        className={`outline-row outline-group-row ${selectedIds.includes(container.id) ? 'selected' : ''} ${draggedId === container.id ? 'dragging' : ''}`}
        role="button"
        tabIndex={0}
        draggable={!container.locked}
        data-container-id={container.id}
        onClick={() => setSelection([container.id], container.id)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection([container.id], container.id); } }}
        onDragStart={() => beginDrag(container.id)}
        onDragEnd={endDrag}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, container.id, 'owner')}
      >
        <button className="outline-expand" aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${containerName}`} onClick={(event) => { event.stopPropagation(); setExpandedState(expansionKey, !isExpanded); }}>{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
        <GripVertical className="outline-grip" size={12} /><span className="outline-group-marker" /><strong>{containerName}</strong><small>{directChildren.length}</small>
      </div>
      {isExpanded && <div className="outline-children">{visibleChildren.map((child) => child.container ? renderContainer(child, depth + 1) : renderNode(child))}</div>}
    </div>;
  };

  const anyObjectMatches = nodes.some((node) => matches(`${nodeLabel(node)} ${node.type} ${node.id}`)) || (page?.edges ?? []).some((edge) => matches(`${edgeLabel(edge)} ${edge.id} ${edge.type}`));

  return <aside className="outline-panel">
    <LeftDockHeader activePanel={activePanel} onChange={onPanelChange ?? (() => undefined)} onCollapse={onCollapse ?? (() => undefined)} badge={<span className="outline-count">{page?.nodes.length ?? 0}</span>} />
    <div className="outline-search"><Search size={14} /><input aria-label="Search outline" placeholder="Find objects…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <div className="outline-scroll">
      <div className="outline-page-row" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(event, undefined, 'root')}><span className="outline-tree-stem" /><span className="outline-page-dot" /><strong>{page?.name ?? 'Page'}</strong><small>{page?.nodes.length ?? 0} objects</small></div>
      {groupEntries.map(([groupId, groupedNodes]) => {
        const matchingNodes = groupedNodes.filter((node) => matches(`${nodeLabel(node)} ${node.type} ${node.id}`));
        const groupName = `Group: ${nodeLabel(groupedNodes[0])}`;
        if (normalizedQuery && !matches(`${groupName} ${groupId}`) && matchingNodes.length === 0) return null;
        const isExpanded = expanded[groupId] !== false;
        return <div className="outline-group" key={groupId}>
          <div className={`outline-row outline-group-row ${selectedIds.some((id) => groupedNodes.some((node) => node.id === id)) ? 'selected' : ''}`} role="button" tabIndex={0} onClick={() => setSelection(groupedNodes.map((node) => node.id), groupedNodes[0]?.id ?? null)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection(groupedNodes.map((node) => node.id), groupedNodes[0]?.id ?? null); } }}>
            <button className="outline-expand" aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${groupName}`} onClick={(event) => { event.stopPropagation(); setExpandedState(groupId, !isExpanded); }}>{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
            <GripVertical className="outline-grip" size={12} /><span className="outline-group-marker" /><strong>{groupName}</strong><small>{groupedNodes.length}</small>
          </div>
          {isExpanded && <div className="outline-children">{(normalizedQuery ? matchingNodes : groupedNodes).map(renderNode)}</div>}
        </div>;
      })}
      {topLevelContainers.map((container) => renderContainer(container))}
      {rootNodes.filter(nodeMatches).map(renderNode)}
      {visibleEdges.map((edge) => <OutlineEdge key={edge.id} edge={edge} selected={selectedIds.includes(edge.id)} label={edgeLabel(edge)} editingId={editingId} draft={draft} setDraft={setDraft} onSelect={() => setSelection([edge.id], edge.id)} onBeginRename={() => beginRename(edge.id, edgeLabel(edge))} onRename={() => commitRename(edge.id, 'edge')} onRenameKeyDown={(event) => onRenameKeyDown(event, edge.id, 'edge')} />)}
      {(nodes.length === 0 && (page?.edges.length ?? 0) === 0) && <div className="outline-empty">No objects on this page yet.</div>}
      {normalizedQuery && !anyObjectMatches && <div className="outline-empty">No objects match “{query}”.</div>}
    </div>
  </aside>;
}

function OutlineNode({ node, selected, label, editingId, draft, setDraft, onSelect, onRename, onBeginRename, onRenameKeyDown, onToggleHidden, onToggleLocked, onDragStart, onDragEnd, onDrop }: { node: DiagramNode; selected: boolean; label: string; editingId: string | null; draft: string; setDraft: (value: string) => void; onSelect: () => void; onRename: () => void; onBeginRename: () => void; onRenameKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void; onToggleHidden: () => void; onToggleLocked: () => void; onDragStart: () => void; onDragEnd: () => void; onDrop: (event: ReactDragEvent<HTMLDivElement>, targetId?: string, mode?: 'reorder' | 'owner' | 'root') => void }) {
  const Icon = node.type === 'ellipse' || node.type === 'circle' || node.type === 'use-case' ? Circle : node.type === 'decision' || node.type === 'diamond' ? Triangle : Square;
  return <div className={`outline-row outline-node-row ${selected ? 'selected' : ''} ${node.hidden ? 'hidden' : ''}`} role="button" tabIndex={0} draggable={!node.locked} data-outline-node-id={node.id} data-container-owner={node.containerId ?? ''} onClick={onSelect} onDoubleClick={onBeginRename} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }}>
    <GripVertical className="outline-grip" size={12} /><Icon size={13} className="outline-node-icon" /><span className="outline-label">{editingId === node.id ? <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={onRename} onKeyDown={onRenameKeyDown} onClick={(event) => event.stopPropagation()} aria-label={`Rename ${label}`} /> : label}</span><button className="outline-action" title={node.hidden ? 'Show object' : 'Hide object'} aria-label={node.hidden ? 'Show object' : 'Hide object'} onClick={(event) => { event.stopPropagation(); onToggleHidden(); }}>{node.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button><button className="outline-action" title={node.locked ? 'Unlock object' : 'Lock object'} aria-label={node.locked ? 'Unlock object' : 'Lock object'} onClick={(event) => { event.stopPropagation(); onToggleLocked(); }}>{node.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
  </div>;
}

function OutlineEdge({ edge, selected, label, editingId, draft, setDraft, onSelect, onBeginRename, onRename, onRenameKeyDown }: { edge: DiagramEdge; selected: boolean; label: string; editingId: string | null; draft: string; setDraft: (value: string) => void; onSelect: () => void; onBeginRename: () => void; onRename: () => void; onRenameKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void }) {
  return <div className={`outline-row outline-edge-row ${selected ? 'selected' : ''}`} role="button" tabIndex={0} data-edge-id={edge.id} onClick={onSelect} onDoubleClick={onBeginRename} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }}><GitBranch size={13} className="outline-edge-icon" /><span className="outline-label">{editingId === edge.id ? <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={onRename} onKeyDown={onRenameKeyDown} onClick={(event) => event.stopPropagation()} aria-label={`Rename ${label}`} /> : label}</span></div>;
}
