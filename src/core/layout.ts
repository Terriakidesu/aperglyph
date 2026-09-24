import type { DiagramEdge, DiagramNode, Point } from './types';

export type LayoutMode = 'hierarchical' | 'dag' | 'horizontal' | 'vertical' | 'tree' | 'grid' | 'compact' | 'radial';

export type ErdLayoutDirection = 'vertical' | 'horizontal';

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

/**
 * Dependency-aware placement for entity relationship diagrams.
 *
 * ERD relationships are stored from the dependent table (the FK) to the
 * referenced table (the PK).  That is the useful direction for editing and
 * exporting, but the visual hierarchy is the reverse: referenced tables form
 * the first level and dependents follow below them.  Keeping that distinction
 * here prevents the generic graph layout from turning a schema into one long
 * column.
 */
export function layoutErdNodes(nodes: DiagramNode[], edges: DiagramEdge[], direction: ErdLayoutDirection = 'vertical'): Record<string, Point> {
  if (nodes.length === 0) return {};

  const nodeIds = new Set(nodes.map((node) => node.id));
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const parents = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const children = new Map(nodes.map((node) => [node.id, [] as string[]]));
  edges.forEach((edge) => {
    const child = edge.source.nodeId;
    const parent = edge.target.nodeId;
    if (!child || !parent || child === parent || !nodeIds.has(child) || !nodeIds.has(parent)) return;
    if (!parents.get(child)!.includes(parent)) parents.get(child)!.push(parent);
    if (!children.get(parent)!.includes(child)) children.get(parent)!.push(child);
  });

  // Longest dependency path gives stable levels for DAGs while still
  // producing a useful bounded result for mutually-referencing tables.
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  const levelOf = (id: string): number => {
    const cached = levels.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const level = Math.max(0, ...(parents.get(id) ?? []).map((parent) => levelOf(parent) + 1));
    visiting.delete(id);
    levels.set(id, level);
    return level;
  };
  nodes.forEach((node) => levelOf(node.id));

  const layerMap = new Map<number, string[]>();
  nodes.forEach((node) => {
    const level = levels.get(node.id) ?? 0;
    layerMap.set(level, [...(layerMap.get(level) ?? []), node.id]);
  });
  const layerLevels = [...layerMap.keys()].sort((left, right) => left - right);
  const layers = new Map(layerLevels.map((level) => [level, (layerMap.get(level) ?? []).sort((left, right) => order.get(left)! - order.get(right)!)]));
  const neighbors = new Map(nodes.map((node) => [node.id, [...new Set([...(parents.get(node.id) ?? []), ...(children.get(node.id) ?? [])])]]));

  // Repeated downward/upward barycentric sweeps reduce crossings without
  // making the result depend on the order in which SQL tables were declared.
  for (let iteration = 0; iteration < 6; iteration += 1) {
    for (let index = 1; index < layerLevels.length; index += 1) reorderLayer(layerLevels[index], layerLevels[index - 1], false);
    for (let index = layerLevels.length - 2; index >= 0; index -= 1) reorderLayer(layerLevels[index], layerLevels[index + 1], true);
  }

  function reorderLayer(level: number, referenceLevel: number, reverse: boolean): void {
    const layer = layers.get(level);
    const reference = layers.get(referenceLevel);
    if (!layer || !reference || layer.length < 2) return;
    const referencePosition = new Map(reference.map((id, index) => [id, index]));
    const scored = layer.map((id, index) => {
      const connected = (neighbors.get(id) ?? []).filter((neighbor) => levels.get(neighbor) === referenceLevel);
      const barycenter = connected.length > 0
        ? connected.reduce((total, neighbor) => total + (referencePosition.get(neighbor) ?? 0), 0) / connected.length
        : Number.POSITIVE_INFINITY;
      return { id, index, barycenter };
    });
    scored.sort((left, right) => {
      if (left.barycenter !== right.barycenter) return reverse ? right.barycenter - left.barycenter : left.barycenter - right.barycenter;
      return left.index - right.index;
    });
    layers.set(level, scored.map((entry) => entry.id));
  }

  const maxWidth = Math.max(...nodes.map((node) => node.size.width));
  const maxHeight = Math.max(...nodes.map((node) => node.size.height));
  const crossGap = Math.max(52, Math.min(92, maxWidth * 0.22));
  const layerGap = Math.max(36, Math.min(58, maxHeight * 0.2));
  const positions: Record<string, Point> = {};
  let layerOffset = 0;

  layerLevels.forEach((level) => {
    const ids = layers.get(level) ?? [];
    const layerNodes = ids.map((id) => nodes.find((node) => node.id === id)!).filter(Boolean);
    if (direction === 'vertical') {
      const width = layerNodes.reduce((total, node) => total + node.size.width, 0) + Math.max(0, layerNodes.length - 1) * crossGap;
      let cursor = -width / 2;
      layerNodes.forEach((node) => {
        positions[node.id] = { x: cursor, y: layerOffset };
        cursor += node.size.width + crossGap;
      });
      layerOffset += Math.max(...layerNodes.map((node) => node.size.height)) + layerGap;
    } else {
      const height = layerNodes.reduce((total, node) => total + node.size.height, 0) + Math.max(0, layerNodes.length - 1) * layerGap;
      let cursor = -height / 2;
      layerNodes.forEach((node) => {
        positions[node.id] = { x: layerOffset, y: cursor };
        cursor += node.size.height + layerGap;
      });
      layerOffset += Math.max(...layerNodes.map((node) => node.size.width)) + crossGap;
    }
  });
  return packDisconnectedComponents(nodes, positions, parents, children, crossGap, direction);
}

function packDisconnectedComponents(
  nodes: DiagramNode[],
  positions: Record<string, Point>,
  parents: Map<string, string[]>,
  children: Map<string, string[]>,
  gap: number,
  direction: ErdLayoutDirection,
): Record<string, Point> {
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const components: string[][] = [];
  const visited = new Set<string>();
  nodes.forEach((node) => {
    if (visited.has(node.id)) return;
    const component: string[] = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length > 0) {
      const id = queue.shift()!;
      component.push(id);
      [...(parents.get(id) ?? []), ...(children.get(id) ?? [])].forEach((neighbor) => {
        if (visited.has(neighbor)) return;
        visited.add(neighbor);
        queue.push(neighbor);
      });
    }
    components.push(component.sort((left, right) => nodeOrder.get(left)! - nodeOrder.get(right)!));
  });
  if (components.length < 2) return positions;

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  components.forEach((ids) => compactComponentLayers(ids, positions, nodeMap, gap, direction));
  const bounds = components.map((ids) => {
    const minX = Math.min(...ids.map((id) => positions[id].x));
    const minY = Math.min(...ids.map((id) => positions[id].y));
    const maxX = Math.max(...ids.map((id) => positions[id].x + nodeMap.get(id)!.size.width));
    const maxY = Math.max(...ids.map((id) => positions[id].y + nodeMap.get(id)!.size.height));
    return { ids, width: maxX - minX, height: maxY - minY, minX, minY };
  });

  let bestColumns = 1;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let columns = 1; columns <= components.length; columns += 1) {
    const columnWidths = Array.from({ length: columns }, () => 0);
    const rowHeights = Array.from({ length: Math.ceil(components.length / columns) }, () => 0);
    bounds.forEach((component, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      columnWidths[column] = Math.max(columnWidths[column], component.width);
      rowHeights[row] = Math.max(rowHeights[row], component.height);
    });
    const width = columnWidths.reduce((total, value) => total + value, 0) + Math.max(0, columns - 1) * gap;
    const height = rowHeights.reduce((total, value) => total + value, 0) + Math.max(0, rowHeights.length - 1) * gap;
    const area = width * height;
    if (area < bestArea) {
      bestArea = area;
      bestColumns = columns;
    }
  }

  const columnWidths = Array.from({ length: bestColumns }, () => 0);
  const rowCount = Math.ceil(bounds.length / bestColumns);
  const rowHeights = Array.from({ length: rowCount }, () => 0);
  bounds.forEach((component, index) => {
    const column = index % bestColumns;
    const row = Math.floor(index / bestColumns);
    columnWidths[column] = Math.max(columnWidths[column], component.width);
    rowHeights[row] = Math.max(rowHeights[row], component.height);
  });
  const columnOffsets = columnWidths.map((_, index) => columnWidths.slice(0, index).reduce((total, value) => total + value + gap, 0));
  const rowOffsets = rowHeights.map((_, index) => rowHeights.slice(0, index).reduce((total, value) => total + value + gap, 0));
  bounds.forEach((component, index) => {
    const column = index % bestColumns;
    const row = Math.floor(index / bestColumns);
    const offset = { x: columnOffsets[column] - component.minX, y: rowOffsets[row] - component.minY };
    component.ids.forEach((id) => {
      positions[id] = { x: positions[id].x + offset.x, y: positions[id].y + offset.y };
    });
  });
  return positions;
}

function compactComponentLayers(
  ids: string[],
  positions: Record<string, Point>,
  nodeMap: Map<string, DiagramNode>,
  gap: number,
  direction: ErdLayoutDirection,
): void {
  const minCross = Math.min(...ids.map((id) => direction === 'vertical' ? positions[id].x : positions[id].y));
  const maxCross = Math.max(...ids.map((id) => {
    const node = nodeMap.get(id)!;
    return direction === 'vertical' ? positions[id].x + node.size.width : positions[id].y + node.size.height;
  }));
  const center = (minCross + maxCross) / 2;
  const layers = new Map<string, string[]>();
  ids.forEach((id) => {
    const layer = direction === 'vertical' ? positions[id].y : positions[id].x;
    const key = String(Math.round(layer * 1000));
    layers.set(key, [...(layers.get(key) ?? []), id]);
  });
  layers.forEach((layerIds) => {
    layerIds.sort((left, right) => (direction === 'vertical' ? positions[left].x - positions[right].x : positions[left].y - positions[right].y));
    const size = layerIds.reduce((total, id) => total + (direction === 'vertical' ? nodeMap.get(id)!.size.width : nodeMap.get(id)!.size.height), 0) + Math.max(0, layerIds.length - 1) * gap;
    let cursor = center - size / 2;
    layerIds.forEach((id) => {
      if (direction === 'vertical') {
        positions[id] = { ...positions[id], x: cursor };
        cursor += nodeMap.get(id)!.size.width + gap;
      } else {
        positions[id] = { ...positions[id], y: cursor };
        cursor += nodeMap.get(id)!.size.height + gap;
      }
    });
  });
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
