import { ChevronDown, ChevronRight, Circle, Eye, EyeOff, GitBranch, GripVertical, Lock, Unlock, Search, Square, Triangle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DiagramEdge, DiagramNode } from '../core/types';
import { getActivePage, useEditorStore } from '../store/editorStore';

const OUTLINE_EXPANSION_KEY = 'aperglyph.outline.expanded';

export function OutlinePanel() {
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
  const groups = useMemo(() => {
    const grouped = new Map<string, DiagramNode[]>();
    for (const node of page?.nodes ?? []) {
      if (!node.groupId) continue;
      const nodes = grouped.get(node.groupId) ?? [];
      nodes.push(node);
      grouped.set(node.groupId, nodes);
    }
    return grouped;
  }, [page?.nodes]);
  const groupEntries = [...groups.entries()].sort(([, left], [, right]) => nodeLabel(left[0]).localeCompare(nodeLabel(right[0])));
  const ungroupedNodes = (page?.nodes ?? []).filter((node) => !node.groupId).sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));
  const visibleEdges = (page?.edges ?? []).filter((edge) => matches(`${edgeLabel(edge)} ${edge.id} ${edge.type}`));

  const setGroupExpanded = (groupId: string, value: boolean) => {
    const next = { ...expanded, [groupId]: value };
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

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    if (draggedId && draggedId !== targetId) reorderNodes([draggedId], targetId);
    setDraggedId(null);
  };

  return <aside className="outline-panel">
    <div className="panel-title-row"><div><span className="panel-kicker">Workspace</span><h2>Outline</h2></div><span className="outline-count">{page?.nodes.length ?? 0}</span></div>
    <div className="outline-search"><Search size={14} /><input aria-label="Search outline" placeholder="Find objects…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <div className="outline-scroll">
      <div className="outline-page-row"><span className="outline-tree-stem" /><span className="outline-page-dot" /><strong>{page?.name ?? 'Page'}</strong><small>{page?.nodes.length ?? 0} objects</small></div>
      {groupEntries.map(([groupId, nodes]) => {
        const matchingNodes = nodes.filter((node) => matches(`${nodeLabel(node)} ${node.type} ${node.id}`));
        const groupName = `Group: ${nodeLabel(nodes[0])}`;
        if (normalizedQuery && !matches(`${groupName} ${groupId}`) && matchingNodes.length === 0) return null;
        const isExpanded = expanded[groupId] !== false;
        return <div className="outline-group" key={groupId}>
          <div className="outline-row outline-group-row" role="button" tabIndex={0} onClick={() => setSelection(nodes.map((node) => node.id), nodes[0]?.id ?? null)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection(nodes.map((node) => node.id), nodes[0]?.id ?? null); } }}>
            <button className="outline-expand" aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${groupName}`} onClick={(event) => { event.stopPropagation(); setGroupExpanded(groupId, !isExpanded); }}>{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
            <GripVertical className="outline-grip" size={12} /><span className="outline-group-marker" /><strong>{groupName}</strong><small>{nodes.length}</small>
          </div>
          {isExpanded && <div className="outline-children">{(normalizedQuery ? matchingNodes : nodes).map((node) => <OutlineNode key={node.id} node={node} selected={selectedIds.includes(node.id)} label={nodeLabel(node)} editingId={editingId} draft={draft} setDraft={setDraft} onSelect={() => setSelection([node.id], node.id)} onRename={() => commitRename(node.id, 'node')} onBeginRename={() => beginRename(node.id, nodeLabel(node))} onRenameKeyDown={(event) => onRenameKeyDown(event, node.id, 'node')} onToggleHidden={() => updateNode(node.id, { hidden: !node.hidden }, node.hidden ? 'Show object' : 'Hide object')} onToggleLocked={() => updateNode(node.id, { locked: !node.locked }, node.locked ? 'Unlock object' : 'Lock object')} onDragStart={() => setDraggedId(node.id)} onDrop={handleDrop} />)}</div>}
        </div>;
      })}
      {ungroupedNodes.filter((node) => matches(`${nodeLabel(node)} ${node.type} ${node.id}`)).map((node) => <OutlineNode key={node.id} node={node} selected={selectedIds.includes(node.id)} label={nodeLabel(node)} editingId={editingId} draft={draft} setDraft={setDraft} onSelect={() => setSelection([node.id], node.id)} onRename={() => commitRename(node.id, 'node')} onBeginRename={() => beginRename(node.id, nodeLabel(node))} onRenameKeyDown={(event) => onRenameKeyDown(event, node.id, 'node')} onToggleHidden={() => updateNode(node.id, { hidden: !node.hidden }, node.hidden ? 'Show object' : 'Hide object')} onToggleLocked={() => updateNode(node.id, { locked: !node.locked }, node.locked ? 'Unlock object' : 'Lock object')} onDragStart={() => setDraggedId(node.id)} onDrop={handleDrop} />)}
      {visibleEdges.map((edge) => <OutlineEdge key={edge.id} edge={edge} selected={selectedIds.includes(edge.id)} label={edgeLabel(edge)} editingId={editingId} draft={draft} setDraft={setDraft} onSelect={() => setSelection([edge.id], edge.id)} onBeginRename={() => beginRename(edge.id, edgeLabel(edge))} onRename={() => commitRename(edge.id, 'edge')} onRenameKeyDown={(event) => onRenameKeyDown(event, edge.id, 'edge')} />)}
      {(page?.nodes.length ?? 0) === 0 && (page?.edges.length ?? 0) === 0 && <div className="outline-empty">No objects on this page yet.</div>}
      {normalizedQuery && visibleEdges.length === 0 && groupEntries.every(([, nodes]) => nodes.every((node) => !matches(`${nodeLabel(node)} ${node.type} ${node.id}`))) && ungroupedNodes.every((node) => !matches(`${nodeLabel(node)} ${node.type} ${node.id}`)) && <div className="outline-empty">No objects match “{query}”.</div>}
    </div>
  </aside>;
}

function OutlineNode({ node, selected, label, editingId, draft, setDraft, onSelect, onRename, onBeginRename, onRenameKeyDown, onToggleHidden, onToggleLocked, onDragStart, onDrop }: { node: DiagramNode; selected: boolean; label: string; editingId: string | null; draft: string; setDraft: (value: string) => void; onSelect: () => void; onRename: () => void; onBeginRename: () => void; onRenameKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void; onToggleHidden: () => void; onToggleLocked: () => void; onDragStart: () => void; onDrop: (event: ReactDragEvent<HTMLDivElement>, targetId: string) => void }) {
  const Icon = node.type === 'ellipse' || node.type === 'circle' || node.type === 'use-case' ? Circle : node.type === 'decision' || node.type === 'diamond' ? Triangle : Square;
  return <div className={`outline-row outline-node-row ${selected ? 'selected' : ''} ${node.hidden ? 'hidden' : ''}`} role="button" tabIndex={0} draggable={!node.locked} onClick={onSelect} onDoubleClick={onBeginRename} onDragStart={onDragStart} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }}>
    <GripVertical className="outline-grip" size={12} /><Icon size={13} className="outline-node-icon" /><span className="outline-label">{editingId === node.id ? <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={onRename} onKeyDown={onRenameKeyDown} onClick={(event) => event.stopPropagation()} aria-label={`Rename ${label}`} /> : label}</span><button className="outline-action" title={node.hidden ? 'Show object' : 'Hide object'} aria-label={node.hidden ? 'Show object' : 'Hide object'} onClick={(event) => { event.stopPropagation(); onToggleHidden(); }}>{node.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button><button className="outline-action" title={node.locked ? 'Unlock object' : 'Lock object'} aria-label={node.locked ? 'Unlock object' : 'Lock object'} onClick={(event) => { event.stopPropagation(); onToggleLocked(); }}>{node.locked ? <Lock size={12} /> : <Unlock size={12} />}</button></div>;
}

function OutlineEdge({ edge, selected, label, editingId, draft, setDraft, onSelect, onBeginRename, onRename, onRenameKeyDown }: { edge: DiagramEdge; selected: boolean; label: string; editingId: string | null; draft: string; setDraft: (value: string) => void; onSelect: () => void; onBeginRename: () => void; onRename: () => void; onRenameKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void }) {
  return <div className={`outline-row outline-edge-row ${selected ? 'selected' : ''}`} role="button" tabIndex={0} onClick={onSelect} onDoubleClick={onBeginRename} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }}><GitBranch size={13} className="outline-edge-icon" /><span className="outline-label">{editingId === edge.id ? <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={onRename} onKeyDown={onRenameKeyDown} onClick={(event) => event.stopPropagation()} aria-label={`Rename ${label}`} /> : label}</span></div>;
}
