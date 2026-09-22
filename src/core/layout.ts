import type { DiagramEdge, DiagramNode, Point } from './types';

export type LayoutMode = 'hierarchical' | 'dag' | 'horizontal' | 'vertical' | 'tree' | 'grid' | 'compact' | 'radial';

export function layoutNodes(nodes: DiagramNode[], edges: DiagramEdge[], mode: LayoutMode): Record<string, Point> {
  if (nodes.length === 0) return {};
  if (mode === 'grid' || mode === 'compact') return gridLayout(nodes, mode === 'compact' ? 4 : Math.ceil(Math.sqrt(nodes.length)));
  if (mode === 'radial') return radialLayout(nodes);

  const nodeIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  edges.forEach((edge) => {
    if (!edge.source.nodeId || !edge.target.nodeId) return;
    if (!nodeIds.has(edge.source.nodeId) || !nodeIds.has(edge.target.nodeId) || edge.source.nodeId === edge.target.nodeId) return;
    outgoing.get(edge.source.nodeId)?.push(edge.target.nodeId);
    indegree.set(edge.target.nodeId, (indegree.get(edge.target.nodeId) ?? 0) + 1);
  });

  const levels = new Map<string, number>();
  let frontier = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  if (frontier.length === 0) frontier = [nodes[0].id];
  frontier.forEach((id) => levels.set(id, 0));
  const visited = new Set<string>();
  while (frontier.length > 0) {
    const next: string[] = [];
    frontier.forEach((id) => {
      if (visited.has(id)) return;
      visited.add(id);
      const level = levels.get(id) ?? 0;
      outgoing.get(id)?.forEach((child) => {
        levels.set(child, Math.max(levels.get(child) ?? 0, level + 1));
        if (!next.includes(child)) next.push(child);
      });
    });
    frontier = next.filter((id) => !visited.has(id));
  }
  nodes.forEach((node) => { if (!levels.has(node.id)) levels.set(node.id, Math.max(0, ...levels.values()) + 1); });

  const columns = new Map<number, DiagramNode[]>();
  nodes.forEach((node) => {
    const level = levels.get(node.id) ?? 0;
    columns.set(level, [...(columns.get(level) ?? []), node]);
  });
  const maxWidth = Math.max(...nodes.map((node) => node.size.width));
  const maxHeight = Math.max(...nodes.map((node) => node.size.height));
  const gapX = Math.max(72, maxWidth * 0.45);
  const gapY = Math.max(56, maxHeight * 0.45);
  const positions: Record<string, Point> = {};
  [...columns.entries()].sort(([left], [right]) => left - right).forEach(([level, column]) => {
    column.forEach((node, index) => {
      if (mode === 'vertical' || mode === 'tree') positions[node.id] = { x: index * (maxWidth + gapX), y: level * (maxHeight + gapY) };
      else positions[node.id] = { x: level * (maxWidth + gapX), y: index * (maxHeight + gapY) };
    });
  });
  return positions;
}

function radialLayout(nodes: DiagramNode[]): Record<string, Point> {
  if (nodes.length === 1) return { [nodes[0].id]: { x: 0, y: 0 } };
  const radius = Math.max(180, nodes.length * 42);
  return Object.fromEntries(nodes.map((node, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / nodes.length;
    return [node.id, { x: Math.round(Math.cos(angle) * radius - node.size.width / 2), y: Math.round(Math.sin(angle) * radius - node.size.height / 2) }];
  }));
}

function gridLayout(nodes: DiagramNode[], columns: number): Record<string, Point> {
  const maxWidth = Math.max(...nodes.map((node) => node.size.width));
  const maxHeight = Math.max(...nodes.map((node) => node.size.height));
  const gapX = Math.max(48, maxWidth * 0.35);
  const gapY = Math.max(48, maxHeight * 0.35);
  return Object.fromEntries(nodes.map((node, index) => [node.id, {
    x: (index % columns) * (maxWidth + gapX),
    y: Math.floor(index / columns) * (maxHeight + gapY),
  }]));
}
