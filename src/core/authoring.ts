import {
  AlignNodesCommand,
  CreateEdgeCommand,
  CreateNodeCommand,
  CreatePageCommand,
  DeleteNodesCommand,
  DeletePageCommand,
  DistributeNodesCommand,
  DocumentCommand,
  LayoutNodesCommand,
  MoveNodesCommand,
  RenameDocumentCommand,
  RenamePageCommand,
  ReorderNodesCommand,
  ReorderPageCommand,
  SetZOrderCommand,
  UpdateEdgeCommand,
  UpdateNodeCommand,
  UpdatePageDataCommand,
  UpdatePageGuidesCommand,
  UpdatePageSettingsCommand,
  UpdateDocumentPaletteCommand,
  UpdateStylePresetsCommand,
  UpdateShapeDefaultsCommand,
  UngroupNodesCommand,
} from './commands';
import { validateProjectDocument, createId, createEdge, createNode, createPage, clonePageWithNewIds, defaultEdgeStyle } from './document';
import { layoutErdNodes, layoutNodes } from './layout';
import type { LayoutMode } from './layout';
import { connectionAnchorPoints } from './anchors';
import { pluginManager } from '../plugins';
import type { DiagramDocument, DiagramEdge, DiagramNode, DiagramPage, EdgePatch, NodePatch, PageSettingsPatch, Point } from './types';

/**
 * The transport-neutral, atomic editing contract used by MCP and other
 * automation clients. IDs may refer to an alias declared by an earlier
 * create operation (for example `$customer`).
 */
export type AuthoringOperation =
  | { op: 'document.rename'; name: string }
  | { op: 'document.palette'; palette: string[] }
  | { op: 'document.style-presets'; presets: DiagramDocument['stylePresets'] }
  | { op: 'document.shape-defaults'; defaults: DiagramDocument['styleDefaults'] }
  | { op: 'page.create'; name?: string; page?: Omit<Partial<DiagramPage>, 'settings'> & { settings?: PageSettingsPatch }; alias?: string; index?: number }
  | { op: 'page.duplicate'; pageId: string; name?: string; alias?: string; index?: number }
  | { op: 'page.rename'; pageId: string; name: string }
  | { op: 'page.delete'; pageId: string }
  | { op: 'page.reorder'; pageId: string; index: number }
  | { op: 'page.settings'; pageId?: string; settings: PageSettingsPatch }
  | { op: 'page.data'; pageId?: string; data: Record<string, unknown> }
  | { op: 'page.guides'; pageId?: string; guides: NonNullable<DiagramPage['guides']> }
  | { op: 'node.create'; pageId?: string; node: Partial<DiagramNode> & Pick<DiagramNode, 'type' | 'position'>; alias?: string }
  | { op: 'node.duplicate'; pageId?: string; nodeId: string; id?: string; alias?: string; position?: Point; offset?: Point; includeEdges?: boolean }
  | { op: 'node.update'; pageId?: string; nodeId: string; patch: NodePatch }
  | { op: 'node.move'; pageId?: string; nodeId?: string; position?: Point; positions?: Record<string, Point>; delta?: Point }
  | { op: 'node.delete'; pageId?: string; nodeIds: string[] }
  | { op: 'node.align'; pageId?: string; nodeIds: string[]; alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' }
  | { op: 'node.distribute'; pageId?: string; nodeIds: string[]; axis: 'horizontal' | 'vertical' }
  | { op: 'node.z-order'; pageId?: string; nodeIds: string[]; action: 'forward' | 'backward' | 'front' | 'back' }
  | { op: 'node.reorder'; pageId?: string; nodeIds: string[]; targetId: string }
  | { op: 'node.group'; pageId?: string; nodeIds: string[]; groupId?: string }
  | { op: 'node.ungroup'; pageId?: string; nodeIds: string[] }
  | { op: 'edge.create'; pageId?: string; edge: Partial<DiagramEdge> & Pick<DiagramEdge, 'type' | 'source' | 'target'>; alias?: string }
  | { op: 'edge.update'; pageId?: string; edgeId: string; patch: EdgePatch }
  | { op: 'edge.delete'; pageId?: string; edgeIds: string[] }
  | { op: 'layout.apply'; pageId?: string; mode: LayoutMode; nodeIds?: string[]; pinnedIds?: string[]; spacing?: number };

export interface PreparedAuthoringBatch {
  operations: AuthoringOperation[];
  aliases: Record<string, string>;
}

export interface AuthoringBatchResult {
  document: DiagramDocument;
  aliases: Record<string, string>;
  changedNodeIds: string[];
  changedEdgeIds: string[];
  affectedPageIds: string[];
}

const MAX_AUTHORING_OPERATIONS = 2000;

export function prepareAuthoringBatch(operations: AuthoringOperation[]): PreparedAuthoringBatch {
  if (!Array.isArray(operations) || operations.length === 0) throw new Error('Provide at least one authoring operation.');
  if (operations.length > MAX_AUTHORING_OPERATIONS) throw new Error(`A batch may contain at most ${MAX_AUTHORING_OPERATIONS} operations.`);
  const aliases: Record<string, string> = {};
  const prepared = operations.map((operation) => {
    if (!operation || typeof operation !== 'object' || typeof operation.op !== 'string') throw new Error('Every operation must have an op name.');
    if (operation.op === 'node.create') {
      const node = structuredClone(operation.node);
      node.id ||= createId('node');
      if (operation.alias) registerAlias(aliases, operation.alias, node.id);
      return { ...operation, node };
    }
    if (operation.op === 'node.duplicate') {
      const id = operation.id || createId('node');
      if (operation.alias) registerAlias(aliases, operation.alias, id);
      return { ...operation, id };
    }
    if (operation.op === 'edge.create') {
      const input = structuredClone(operation.edge);
      const defaults = createEdge(input.source, input.target, { type: input.type, data: input.data, routing: input.routing, style: input.style });
      const edge: DiagramEdge = { ...defaults, ...input, id: input.id || createId('edge'), style: { ...defaultEdgeStyle, ...input.style }, data: input.data ?? {}, waypoints: input.waypoints ?? [] };
      if (operation.alias) registerAlias(aliases, operation.alias, edge.id);
      return { ...operation, edge };
    }
    if (operation.op === 'page.create') {
      const input = structuredClone(operation.page ?? {});
      const base = createPage(input.name ?? operation.name);
      const snapSettings = {
        ...(input.settings?.snapToGrid === undefined ? base.settings.snapSettings : {
          grid: input.settings.snapToGrid,
          objects: input.settings.snapToGrid,
          guides: input.settings.snapToGrid,
          ports: input.settings.snapToGrid,
        }),
        ...input.settings?.snapSettings,
      };
      const page: DiagramPage = {
        ...base,
        ...input,
        name: input.name ?? operation.name ?? base.name,
        settings: {
          ...base.settings,
          ...input.settings,
          snapToGrid: snapSettings.grid,
          snapSettings,
        },
        nodes: input.nodes ?? [],
        edges: input.edges ?? [],
        guides: input.guides ?? [],
      };
      page.id ||= createId('page');
      if (operation.alias) registerAlias(aliases, operation.alias, page.id);
      return { ...operation, page };
    }
    return structuredClone(operation);
  });
  return { operations: prepared, aliases };
}

export function applyAuthoringBatch(
  document: DiagramDocument,
  defaultPageId: string,
  prepared: PreparedAuthoringBatch,
): AuthoringBatchResult {
  let next = structuredClone(document);
  const changedNodeIds = new Set<string>();
  const changedEdgeIds = new Set<string>();
  const affectedPageIds = new Set<string>();
  const aliases = prepared.aliases;
  const resolve = (id: string | undefined): string | undefined => {
    if (!id) return id;
    const key = id.startsWith('$') || id.startsWith('@') ? id.slice(1) : id;
    return aliases[key] ?? id;
  };
  const pageIdFor = (id?: string) => resolve(id) ?? defaultPageId;
  const pageFor = (id?: string) => {
    const pageId = pageIdFor(id);
    const page = next.pages.find((candidate) => candidate.id === pageId);
    if (!page) throw new Error(`Page '${pageId}' does not exist.`);
    return page;
  };
  const run = (command: DocumentCommand) => { next = command.execute(next); };

  for (const operation of prepared.operations) {
    switch (operation.op) {
      case 'document.rename':
        if (!operation.name.trim()) throw new Error('Document name cannot be empty.');
        run(new RenameDocumentCommand(operation.name));
        break;
      case 'document.palette':
        run(new UpdateDocumentPaletteCommand(operation.palette));
        break;
      case 'document.style-presets':
        run(new UpdateStylePresetsCommand(operation.presets));
        break;
      case 'document.shape-defaults':
        run(new UpdateShapeDefaultsCommand(operation.defaults));
        break;
      case 'page.create': {
        const page = structuredClone(operation.page as DiagramPage);
        if (!page.name.trim()) throw new Error('Page name cannot be empty.');
        page.name = page.name.trim();
        if (next.diagramType === 'dfd' && !page.data) {
          const parent = next.pages.find((candidate) => candidate.id === defaultPageId);
          page.data = { dfdLevel: typeof parent?.data?.dfdLevel === 'number' ? parent.data.dfdLevel : 0, dataDictionary: [] };
        }
        validatePageIndex(operation.index, next.pages.length);
        if (next.pages.some((candidate) => candidate.id === page.id)) throw new Error(`Page ID '${page.id}' already exists.`);
        run(new CreatePageCommand(page, operation.index));
        affectedPageIds.add(page.id);
        break;
      }
      case 'page.duplicate': {
        const sourcePageId = resolve(operation.pageId)!;
        const source = pageFor(sourcePageId);
        const duplicate = clonePageWithNewIds(source, operation.name?.trim() || `${source.name} copy`);
        if (operation.alias) registerAlias(aliases, operation.alias, duplicate.id);
        validatePageIndex(operation.index, next.pages.length);
        run(new CreatePageCommand(duplicate, operation.index));
        duplicate.nodes.forEach((node) => changedNodeIds.add(node.id));
        duplicate.edges.forEach((edge) => changedEdgeIds.add(edge.id));
        affectedPageIds.add(duplicate.id);
        break;
      }
      case 'page.rename': {
        const pageId = resolve(operation.pageId)!;
        pageFor(pageId);
        if (!operation.name.trim()) throw new Error('Page name cannot be empty.');
        run(new RenamePageCommand(pageId, operation.name));
        affectedPageIds.add(pageId);
        break;
      }
      case 'page.delete': {
        const pageId = resolve(operation.pageId)!;
        if (next.pages.length < 2) throw new Error('The last remaining page cannot be deleted.');
        pageFor(pageId);
        run(new DeletePageCommand(pageId));
        affectedPageIds.add(pageId);
        break;
      }
      case 'page.reorder': {
        const pageId = resolve(operation.pageId)!;
        pageFor(pageId);
        validatePageIndex(operation.index, next.pages.length - 1);
        run(new ReorderPageCommand(pageId, operation.index));
        affectedPageIds.add(pageId);
        break;
      }
      case 'page.settings': {
        const pageId = pageIdFor(operation.pageId);
        pageFor(pageId);
        run(new UpdatePageSettingsCommand(pageId, operation.settings));
        affectedPageIds.add(pageId);
        break;
      }
      case 'page.data': {
        const pageId = pageIdFor(operation.pageId);
        pageFor(pageId);
        run(new UpdatePageDataCommand(pageId, operation.data));
        affectedPageIds.add(pageId);
        break;
      }
      case 'page.guides': {
        const pageId = pageIdFor(operation.pageId);
        pageFor(pageId);
        run(new UpdatePageGuidesCommand(pageId, operation.guides));
        affectedPageIds.add(pageId);
        break;
      }
      case 'node.create': {
        const page = pageFor(operation.pageId);
        const input = operation.node;
        const library = input.library ?? next.diagramType;
        const definition = pluginManager.getShape(library, input.type)
          ?? pluginManager.get(next.diagramType).shapes.find((shape) => shape.type === input.type);
        const savedStyle = next.styleDefaults?.[`${library}:${input.type}`];
        const created = createNode(input.type, input.position, {
          library,
          size: input.size ?? definition?.defaultSize,
          style: { ...definition?.defaultStyle, ...savedStyle, ...input.style },
          data: { ...definition?.defaultData, ...input.data },
          boundary: input.boundary ?? definition?.boundary,
          container: input.container ?? definition?.container,
        });
        const node: DiagramNode = {
          ...created,
          ...input,
          id: input.id!,
          ...(Object.prototype.hasOwnProperty.call(input, 'containerId') ? { containerId: resolve(input.containerId) } : {}),
          style: { ...created.style, ...input.style },
          data: { ...created.data, ...input.data },
        };
        ensureUniqueId(next, node.id, 'node');
        assertContainerOwner(page.nodes, node.id, node.containerId);
        run(new CreateNodeCommand(page.id, node));
        changedNodeIds.add(node.id);
        affectedPageIds.add(page.id);
        break;
      }
      case 'node.duplicate': {
        const page = pageFor(operation.pageId);
        const sourceId = resolve(operation.nodeId)!;
        const source = page.nodes.find((node) => node.id === sourceId);
        if (!source) throw new Error(`Node '${sourceId}' does not exist on page '${page.id}'.`);
        const id = operation.id;
        if (!id) throw new Error('node.duplicate must be passed through prepareAuthoringBatch before it is applied.');
        ensureUniqueId(next, id, 'node');
        const offset = operation.offset ?? { x: 24, y: 24 };
        assertPoint(offset, 'Duplicate offset');
        const position = operation.position ?? { x: source.position.x + offset.x, y: source.position.y + offset.y };
        assertPoint(position, 'Duplicate position');
        const copyDelta = { x: position.x - source.position.x, y: position.y - source.position.y };
        const duplicate: DiagramNode = {
          ...structuredClone(source),
          id,
          position: { ...position },
          locked: false,
          groupId: source.groupId ? createId('group') : undefined,
          zIndex: Math.max(0, ...page.nodes.map((node) => node.zIndex ?? 0)) + 1,
        };
        assertContainerOwner(page.nodes, duplicate.id, duplicate.containerId);
        run(new CreateNodeCommand(page.id, duplicate));
        changedNodeIds.add(id);
        if (operation.includeEdges) {
          const linked = page.edges.filter((edge) => edge.source.nodeId === sourceId || edge.target.nodeId === sourceId);
          linked.forEach((edge) => {
            const copied: DiagramEdge = {
              ...structuredClone(edge),
              id: createId('edge'),
              source: duplicateEndpoint(edge.source, sourceId, id, copyDelta),
              target: duplicateEndpoint(edge.target, sourceId, id, copyDelta),
              waypoints: edge.waypoints.map((point) => ({ x: point.x + copyDelta.x, y: point.y + copyDelta.y })),
            };
            run(new CreateEdgeCommand(page.id, copied));
            changedEdgeIds.add(copied.id);
          });
        }
        affectedPageIds.add(page.id);
        break;
      }
      case 'node.update': {
        const page = pageFor(operation.pageId);
        const nodeId = resolve(operation.nodeId)!;
        const node = page.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) throw new Error(`Node '${nodeId}' does not exist on page '${page.id}'.`);
        if (operation.patch.id !== undefined && operation.patch.id !== nodeId) throw new Error('Node IDs are immutable; create a replacement node if a new ID is required.');
        if (node.locked && operation.patch.locked !== false && !Object.keys(operation.patch).every((key) => key === 'hidden')) throw new Error(`Node '${nodeId}' is locked.`);
        const patch = resolveNodePatch(operation.patch, resolve);
        if (Object.prototype.hasOwnProperty.call(patch, 'containerId')) assertContainerOwner(page.nodes, nodeId, patch.containerId);
        run(new UpdateNodeCommand(page.id, nodeId, patch));
        changedNodeIds.add(nodeId);
        affectedPageIds.add(page.id);
        break;
      }
      case 'node.move': {
        const page = pageFor(operation.pageId);
        let positions: Record<string, Point> = Object.fromEntries(Object.entries(operation.positions ?? {}).map(([id, position]) => [resolve(id)!, position]));
        if (operation.nodeId) {
          const nodeId = resolve(operation.nodeId)!;
          const node = page.nodes.find((candidate) => candidate.id === nodeId);
          if (!node) throw new Error(`Node '${nodeId}' does not exist on page '${page.id}'.`);
          if (operation.position) positions[nodeId] = operation.position;
          else if (operation.delta) positions[nodeId] = { x: node.position.x + operation.delta.x, y: node.position.y + operation.delta.y };
        }
        if (!Object.keys(positions).length) throw new Error('node.move requires a position, positions map, or delta.');
        for (const id of Object.keys(positions)) {
          const node = page.nodes.find((candidate) => candidate.id === id);
          if (!node) throw new Error(`Node '${id}' does not exist on page '${page.id}'.`);
          if (node.locked) throw new Error(`Node '${id}' is locked.`);
          assertPoint(positions[id], `Position for node '${id}'`);
          changedNodeIds.add(id);
        }
        const originalPositions = new Map(page.nodes.map((node) => [node.id, node.position]));
        run(new MoveNodesCommand(page.id, positions));
        const movedPage = next.pages.find((candidate) => candidate.id === page.id);
        movedPage?.nodes.forEach((node) => {
          const previous = originalPositions.get(node.id);
          if (previous && (previous.x !== node.position.x || previous.y !== node.position.y)) changedNodeIds.add(node.id);
        });
        affectedPageIds.add(page.id);
        break;
      }
      case 'node.delete': {
        const page = pageFor(operation.pageId);
        const nodeIds = operation.nodeIds.map((id) => resolve(id)!);
        if (!nodeIds.length) throw new Error('node.delete requires at least one node ID.');
        nodeIds.forEach((id) => {
          const node = page.nodes.find((candidate) => candidate.id === id);
          if (!node) throw new Error(`Node '${id}' does not exist on page '${page.id}'.`);
          if (node.locked) throw new Error(`Node '${id}' is locked.`);
          changedNodeIds.add(id);
        });
        page.nodes.filter((node) => node.containerId && nodeIds.includes(node.containerId)).forEach((node) => changedNodeIds.add(node.id));
        page.edges.forEach((edge) => {
          if (nodeIds.includes(edge.source.nodeId ?? '') || nodeIds.includes(edge.target.nodeId ?? '')) changedEdgeIds.add(edge.id);
        });
        run(new DeleteNodesCommand(page.id, nodeIds));
        affectedPageIds.add(page.id);
        break;
      }
      case 'node.align': {
        const page = pageFor(operation.pageId);
        const ids = resolveIds(operation.nodeIds, resolve);
        if (ids.length < 2) throw new Error('Alignment requires at least two nodes.');
        requireNodes(page, ids);
        requireUnlockedNodes(page, ids);
        run(new AlignNodesCommand(page.id, ids, operation.alignment));
        ids.forEach((id) => changedNodeIds.add(id));
        affectedPageIds.add(page.id);
        break;
      }
      case 'node.distribute': {
        const page = pageFor(operation.pageId);
        const ids = resolveIds(operation.nodeIds, resolve);
        if (ids.length < 3) throw new Error('Distribution requires at least three nodes.');
        requireNodes(page, ids);
        requireUnlockedNodes(page, ids);
        run(new DistributeNodesCommand(page.id, ids, operation.axis));
        ids.forEach((id) => changedNodeIds.add(id));
        affectedPageIds.add(page.id);
        break;
      }
      case 'node.z-order': {
        const page = pageFor(operation.pageId);
        const ids = resolveIds(operation.nodeIds, resolve);
        if (!ids.length) throw new Error('node.z-order requires at least one node ID.');
        requireNodes(page, ids);
        requireUnlockedNodes(page, ids);
        run(new SetZOrderCommand(page.id, ids, operation.action));
        ids.forEach((id) => changedNodeIds.add(id));
        affectedPageIds.add(page.id);
        break;
      }
      case 'node.reorder': {
        const page = pageFor(operation.pageId);
        const ids = resolveIds(operation.nodeIds, resolve);
        const targetId = resolve(operation.targetId)!;
        if (!ids.length) throw new Error('node.reorder requires at least one node ID.');
        if (ids.includes(targetId)) throw new Error('The reorder target cannot be one of the moving nodes.');
        requireNodes(page, [...ids, targetId]);
        requireUnlockedNodes(page, ids);
        run(new ReorderNodesCommand(page.id, ids, targetId));
        ids.forEach((id) => changedNodeIds.add(id));
        affectedPageIds.add(page.id);
        break;
      }
      case 'node.group': {
        const page = pageFor(operation.pageId);
        const ids = resolveIds(operation.nodeIds, resolve);
        requireNodes(page, ids);
        if (ids.length < 2) throw new Error('Grouping requires at least two nodes.');
        requireUnlockedNodes(page, ids);
        const groupId = operation.groupId ?? createId('group');
        run(new GroupNodesByIdCommand(page.id, ids, groupId));
        ids.forEach((id) => changedNodeIds.add(id));
        affectedPageIds.add(page.id);
        break;
      }
      case 'node.ungroup': {
        const page = pageFor(operation.pageId);
        const ids = resolveIds(operation.nodeIds, resolve);
        if (!ids.length) throw new Error('node.ungroup requires at least one node ID.');
        requireNodes(page, ids);
        requireUnlockedNodes(page, ids);
        if (!page.nodes.some((node) => ids.includes(node.id) && node.groupId)) throw new Error('None of the selected nodes belong to a group.');
        const selectedGroups = new Set(page.nodes.filter((node) => ids.includes(node.id) && node.groupId).map((node) => node.groupId!));
        run(new UngroupNodesCommand(page.id, ids));
        page.nodes.filter((node) => selectedGroups.has(node.groupId ?? '')).forEach((node) => changedNodeIds.add(node.id));
        affectedPageIds.add(page.id);
        break;
      }
      case 'edge.create': {
        const page = pageFor(operation.pageId);
        if (!operation.edge.id) throw new Error('edge.create must be passed through prepareAuthoringBatch before it is applied.');
        const edge = resolveEdge(operation.edge as DiagramEdge, resolve);
        const definition = pluginManager.get(next.diagramType).connectors.find((candidate) => candidate.id === edge.type);
        if (definition) {
          edge.style = { ...defaultEdgeStyle, ...definition.defaultStyle, ...edge.style };
          edge.data = {
            routing: definition.routing,
            ...(definition.label.startsWith('«') ? { label: definition.label } : {}),
            ...edge.data,
          };
        }
        ensureUniqueId(next, edge.id, 'edge');
        assertEdgeEndpoints(page, edge);
        run(new CreateEdgeCommand(page.id, edge));
        changedEdgeIds.add(edge.id);
        affectedPageIds.add(page.id);
        break;
      }
      case 'edge.update': {
        const page = pageFor(operation.pageId);
        const edgeId = resolve(operation.edgeId)!;
        const edge = page.edges.find((candidate) => candidate.id === edgeId);
        if (!edge) throw new Error(`Edge '${edgeId}' does not exist on page '${page.id}'.`);
        const patch = resolveEdgePatch(operation.patch, resolve);
        assertEdgeEndpoints(page, {
          ...edge,
          ...patch,
          source: patch.source ?? edge.source,
          target: patch.target ?? edge.target,
          style: patch.style ? { ...edge.style, ...patch.style } : edge.style,
          data: patch.data ? { ...edge.data, ...patch.data } : edge.data,
          waypoints: patch.waypoints ?? edge.waypoints,
        });
        run(new UpdateEdgeCommand(page.id, edgeId, patch));
        changedEdgeIds.add(edgeId);
        affectedPageIds.add(page.id);
        break;
      }
      case 'edge.delete': {
        const page = pageFor(operation.pageId);
        const ids = resolveIds(operation.edgeIds, resolve);
        if (!ids.length) throw new Error('edge.delete requires at least one edge ID.');
        ids.forEach((id) => {
          if (!page.edges.some((edge) => edge.id === id)) throw new Error(`Edge '${id}' does not exist on page '${page.id}'.`);
          changedEdgeIds.add(id);
        });
        run(new DeleteEdgesCommand(page.id, ids));
        affectedPageIds.add(page.id);
        break;
      }
      case 'layout.apply': {
        const page = pageFor(operation.pageId);
        const selectedIds = operation.nodeIds?.map((id) => resolve(id)!) ?? page.nodes.map((node) => node.id);
        const pinned = new Set(operation.pinnedIds?.map((id) => resolve(id)!) ?? []);
        const missingId = [...selectedIds, ...pinned].find((id) => !page.nodes.some((node) => node.id === id));
        if (missingId) throw new Error(`Layout references missing node '${missingId}'.`);
        const nodes = page.nodes.filter((node) => selectedIds.includes(node.id) && !node.locked && !pinned.has(node.id));
        if (!nodes.length) throw new Error('Layout has no unlocked, unpinned nodes to arrange.');
        const positions = next.diagramType === 'erd' && nodes.every((node) => node.type === 'entity')
          ? layoutErdNodes(nodes, page.edges, operation.mode === 'horizontal' ? 'horizontal' : 'vertical')
          : layoutNodes(nodes, page.edges, operation.mode);
        const factor = operation.spacing === undefined ? 1 : operation.spacing;
        if (!Number.isFinite(factor) || factor < 0.25 || factor > 4) throw new Error('Layout spacing must be between 0.25 and 4.');
        if (factor !== 1) scaleLayoutPositions(positions, factor);
        run(new LayoutNodesCommand(page.id, positions, operation.mode));
        Object.keys(positions).forEach((id) => changedNodeIds.add(id));
        affectedPageIds.add(page.id);
        break;
      }
      default:
        throw new Error(`Unsupported authoring operation '${(operation as { op: string }).op}'.`);
    }
  }

  const errors = validateProjectDocument(next);
  if (errors.length) throw new Error(`The operation batch would make the diagram invalid: ${errors[0]}`);
  return { document: next, aliases: { ...aliases }, changedNodeIds: [...changedNodeIds], changedEdgeIds: [...changedEdgeIds], affectedPageIds: [...affectedPageIds] };
}

export class AuthoringBatchCommand implements DocumentCommand {
  readonly label: string;
  result: AuthoringBatchResult | null = null;

  constructor(private readonly pageId: string, private readonly prepared: PreparedAuthoringBatch, label = 'Apply authoring batch') {
    this.label = label.slice(0, 160) || 'Apply authoring batch';
  }

  execute(document: DiagramDocument): DiagramDocument {
    this.result = applyAuthoringBatch(document, this.pageId, this.prepared);
    return this.result.document;
  }
}

class GroupNodesByIdCommand implements DocumentCommand {
  readonly label = 'Group nodes';
  constructor(private readonly pageId: string, private readonly nodeIds: string[], private readonly groupId: string) {}
  execute(document: DiagramDocument): DiagramDocument {
    const next = structuredClone(document);
    const ids = new Set(this.nodeIds);
    const page = next.pages.find((candidate) => candidate.id === this.pageId);
    if (page) page.nodes = page.nodes.map((node) => ids.has(node.id) ? { ...node, groupId: this.groupId } : node);
    next.updatedAt = Date.now();
    return next;
  }
}

class DeleteEdgesCommand implements DocumentCommand {
  readonly label = 'Delete connectors';
  constructor(private readonly pageId: string, private readonly edgeIds: string[]) {}
  execute(document: DiagramDocument): DiagramDocument {
    const next = structuredClone(document);
    const page = next.pages.find((candidate) => candidate.id === this.pageId);
    if (page) page.edges = page.edges.filter((edge) => !this.edgeIds.includes(edge.id));
    next.updatedAt = Date.now();
    return next;
  }
}

function registerAlias(aliases: Record<string, string>, alias: string, id: string): void {
  if (!/^[A-Za-z][\w.-]{0,63}$/.test(alias)) throw new Error(`Invalid alias '${alias}'. Use a letter followed by letters, numbers, '.', '_' or '-'.`);
  if (Object.prototype.hasOwnProperty.call(aliases, alias)) throw new Error(`Alias '${alias}' is already defined in this batch.`);
  aliases[alias] = id;
}

function ensureUniqueId(document: DiagramDocument, id: string, kind: 'node' | 'edge'): void {
  const duplicate = document.pages.some((page) => page.nodes.some((node) => node.id === id) || page.edges.some((edge) => edge.id === id));
  if (duplicate) throw new Error(`${kind === 'node' ? 'Object' : 'Connector'} ID '${id}' already exists.`);
}

function requireNodes(page: DiagramPage, ids: string[]): void {
  ids.forEach((id) => { if (!page.nodes.some((node) => node.id === id)) throw new Error(`Node '${id}' does not exist on page '${page.id}'.`); });
}

function requireUnlockedNodes(page: DiagramPage, ids: string[]): void {
  ids.forEach((id) => { if (page.nodes.find((node) => node.id === id)?.locked) throw new Error(`Node '${id}' is locked.`); });
}

function assertContainerOwner(nodes: DiagramNode[], nodeId: string, containerId: unknown): void {
  if (containerId === undefined) return;
  if (typeof containerId !== 'string') throw new Error(`Container reference for node '${nodeId}' must be a node ID or omitted.`);
  const owner = nodes.find((candidate) => candidate.id === containerId);
  if (!owner || !owner.container) throw new Error(`Container '${containerId}' does not exist or is not a container.`);
  const visited = new Set<string>();
  let current: DiagramNode | undefined = owner;
  while (current) {
    if (current.id === nodeId) throw new Error(`Assigning container '${containerId}' would create a container cycle.`);
    if (visited.has(current.id)) throw new Error(`The existing container hierarchy contains a cycle at '${current.id}'.`);
    visited.add(current.id);
    current = current.containerId ? nodes.find((candidate) => candidate.id === current!.containerId) : undefined;
  }
}

function resolveIds(ids: string[], resolve: (id?: string) => string | undefined): string[] {
  return [...new Set(ids.map((id) => resolve(id)!))];
}

function resolveNodePatch(patch: NodePatch, resolve: (id?: string) => string | undefined): NodePatch {
  return { ...structuredClone(patch), ...(Object.prototype.hasOwnProperty.call(patch, 'containerId') ? { containerId: resolve(patch.containerId) } : {}) };
}

function resolveEdge(edge: DiagramEdge, resolve: (id?: string) => string | undefined): DiagramEdge {
  return {
    ...structuredClone(edge),
    source: { ...edge.source, ...(edge.source.nodeId ? { nodeId: resolve(edge.source.nodeId) } : {}) },
    target: { ...edge.target, ...(edge.target.nodeId ? { nodeId: resolve(edge.target.nodeId) } : {}) },
  };
}

function resolveEdgePatch(patch: EdgePatch, resolve: (id?: string) => string | undefined): EdgePatch {
  return {
    ...structuredClone(patch),
    ...(patch.source ? { source: { ...patch.source, ...(patch.source.nodeId ? { nodeId: resolve(patch.source.nodeId) } : {}) } } : {}),
    ...(patch.target ? { target: { ...patch.target, ...(patch.target.nodeId ? { nodeId: resolve(patch.target.nodeId) } : {}) } } : {}),
  };
}

function duplicateEndpoint(endpoint: DiagramEdge['source'], sourceId: string, duplicateId: string, offset: Point): DiagramEdge['source'] {
  if (endpoint.nodeId === sourceId) return { ...endpoint, nodeId: duplicateId, point: undefined };
  if (endpoint.nodeId) return { ...endpoint };
  return endpoint.point ? { ...endpoint, point: { x: endpoint.point.x + offset.x, y: endpoint.point.y + offset.y } } : { ...endpoint };
}

function assertEdgeEndpoints(page: DiagramPage, edge: DiagramEdge): void {
  for (const side of ['source', 'target'] as const) {
    const endpoint = edge[side];
    const node = endpoint.nodeId ? page.nodes.find((candidate) => candidate.id === endpoint.nodeId) : undefined;
    if (endpoint.nodeId && !node) throw new Error(`${side} endpoint references missing node '${endpoint.nodeId}'.`);
    if (!endpoint.nodeId && !endpoint.point) throw new Error(`${side} endpoint must reference a node or a free-space point.`);
    if (endpoint.point) assertPoint(endpoint.point, `${side} endpoint point`);
    if (endpoint.offset !== undefined && (!Number.isFinite(endpoint.offset) || endpoint.offset < 0 || endpoint.offset > 1)) throw new Error(`${side} endpoint offset must be between 0 and 1.`);
    if (endpoint.port && !['top', 'right', 'bottom', 'left', 'center', 'north', 'east', 'south', 'west'].includes(endpoint.port)) throw new Error(`${side} endpoint uses an unsupported port '${endpoint.port}'.`);
    if (node && endpoint.anchorId) {
      const shape = pluginManager.getShape(node.library, node.type);
      const anchors = connectionAnchorPoints(node, shape?.anchors);
      if (!anchors.some(({ anchor }) => anchor.id === endpoint.anchorId)) throw new Error(`${side} endpoint references missing anchor '${endpoint.anchorId}' on node '${node.id}'.`);
    }
  }
  edge.waypoints.forEach((point, index) => assertPoint(point, `Waypoint ${index + 1}`));
}

function assertPoint(point: Point, label: string): void {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw new Error(`${label} must contain finite x and y coordinates.`);
}

function validatePageIndex(index: number | undefined, pageCount: number): void {
  if (index !== undefined && (!Number.isInteger(index) || index < 0 || index > pageCount)) {
    throw new Error(`Page index must be an integer between 0 and ${pageCount}.`);
  }
}

function scaleLayoutPositions(positions: Record<string, Point>, factor: number): void {
  const ids = Object.keys(positions);
  if (ids.length < 2) return;
  const center = ids.reduce((acc, id) => ({ x: acc.x + positions[id].x / ids.length, y: acc.y + positions[id].y / ids.length }), { x: 0, y: 0 });
  ids.forEach((id) => {
    positions[id] = {
      x: center.x + (positions[id].x - center.x) * factor,
      y: center.y + (positions[id].y - center.y) * factor,
    };
  });
}
