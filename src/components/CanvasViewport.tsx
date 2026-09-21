import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { createEdge, createNode as buildNode } from '../core/document';
import { ERD_HEADER_HEIGHT, ERD_ROW_HEIGHT, normalizeEntityFields } from '../core/erd';
import { editorEvents } from '../core/events';
import { curvedPath, edgeRoute, pointsToPath } from '../core/routing';
import { getActivePage, useEditorStore } from '../store/editorStore';
import type { DiagramEdge, DiagramNode, EdgeMarker, Endpoint, Point, Size, Viewport } from '../core/types';
import { nearestConnectionPort, nodeCenter, nodeConnectionPoint } from '../core/geometry';
import type { ConnectionPort } from '../core/geometry';
import { nodeToSpatialNode, snapNodes, SpatialWorkerClient, viewportBounds } from '../spatial';
import type { AlignmentGuide, SpatialNode } from '../spatial';

interface CanvasSize { width: number; height: number }
interface Marquee { start: Point; current: Point }
interface ConnectorAnchor { nodeId: string; port?: ConnectionPort }
type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';
interface ContextMenuState { x: number; y: number; target: { kind: 'canvas' | 'node' | 'edge'; id?: string } }
interface TextEditState { kind: 'node' | 'edge'; id: string; value: string }

interface DragSession {
  mode: 'drag' | 'pan' | 'marquee' | 'waypoint' | 'resize' | 'endpoint';
  pointerId: number;
  startWorld: Point;
  startClient: Point;
  initialPositions?: Record<string, Point>;
  initialViewport?: Viewport;
  edgeId?: string;
  waypointIndex?: number;
  nodeId?: string;
  resizeHandle?: ResizeHandle;
  initialNode?: { position: Point; size: Size };
  endpoint?: 'source' | 'target';
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;

export function CanvasViewport() {
  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const frameRef = useRef<number | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ session: DragSession; screen: Point } | null>(null);
  const isPanningRef = useRef(false);
  const [size, setSize] = useState<CanvasSize>({ width: 900, height: 700 });
  const [dragPreview, setDragPreview] = useState<Record<string, Point>>({});
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [connectorStart, setConnectorStart] = useState<ConnectorAnchor | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string> | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [snapCandidateIds, setSnapCandidateIds] = useState<string[]>([]);
  const [waypointPreview, setWaypointPreview] = useState<{ edgeId: string; index: number; point: Point } | null>(null);
  const [endpointPreview, setEndpointPreview] = useState<{ edgeId: string; endpoint: 'source' | 'target'; anchor: Endpoint; point: Point } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ nodeId: string; position: Point; size: Size } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const lastClickRef = useRef<{ kind: 'node' | 'edge'; id: string; time: number } | null>(null);
  const spatialClient = useMemo(() => new SpatialWorkerClient(), []);
  const indexedPageRef = useRef<string | null>(null);
  const indexedNodesRef = useRef(new Map<string, SpatialNode>());
  const spatialReadyRef = useRef(false);
  const spatialQueryRef = useRef(0);

  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const activeTool = useEditorStore((state) => state.activeTool);
  const viewport = useEditorStore((state) => state.viewport);
  const setSelection = useEditorStore((state) => state.setSelection);
  const moveNodes = useEditorStore((state) => state.moveNodes);
  const createConnector = useEditorStore((state) => state.createEdge);
  const addNode = useEditorStore((state) => state.createNode);
  const setTool = useEditorStore((state) => state.setTool);
  const addEdge = useEditorStore((state) => state.createEdge);
  const updateEdge = useEditorStore((state) => state.updateEdge);
  const updateNode = useEditorStore((state) => state.updateNode);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const updateViewport = useEditorStore((state) => state.updateViewport);
  const page = getActivePage(document, activePageId);

  useEffect(() => {
    if (!stageRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    });
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  const fitViewport = useCallback((scope: 'page' | 'selection') => {
    if (!page || size.width <= 0 || size.height <= 0) return;
    const selectedNodes = page.nodes.filter((node) => selectedIds.includes(node.id));
    const bounds = scope === 'selection' && selectedNodes.length > 0
      ? {
        x: Math.min(...selectedNodes.map((node) => node.position.x)),
        y: Math.min(...selectedNodes.map((node) => node.position.y)),
        width: Math.max(...selectedNodes.map((node) => node.position.x + node.size.width)) - Math.min(...selectedNodes.map((node) => node.position.x)),
        height: Math.max(...selectedNodes.map((node) => node.position.y + node.size.height)) - Math.min(...selectedNodes.map((node) => node.position.y)),
      }
      : { x: -page.settings.width / 2, y: -page.settings.height / 2, width: page.settings.width, height: page.settings.height };
    const padding = 72;
    const zoom = Math.min(3, Math.max(MIN_ZOOM, Math.min((size.width - padding * 2) / Math.max(1, bounds.width), (size.height - padding * 2) / Math.max(1, bounds.height))));
    updateViewport({ zoom, x: -(bounds.x + bounds.width / 2), y: -(bounds.y + bounds.height / 2) });
  }, [page, selectedIds, size.height, size.width, updateViewport]);

  useEffect(() => editorEvents.on('viewport:fit', ({ scope }) => fitViewport(scope)), [fitViewport]);

  useEffect(() => {
    if (textEdit) {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    }
  }, [textEdit]);

  useEffect(() => {
    if (activeTool !== 'connector') setConnectorStart(null);
  }, [activeTool]);

  useEffect(() => () => spatialClient.terminate(), [spatialClient]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.repeat) setSpacePressed(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePressed(false);
    };
    const onBlur = () => setSpacePressed(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const screenPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const worldPoint = useCallback((event: { clientX: number; clientY: number }, camera = viewport) => {
    const screen = screenPoint(event);
    return {
      x: (screen.x - size.width / 2) / camera.zoom - camera.x,
      y: (screen.y - size.height / 2) / camera.zoom - camera.y,
    };
  }, [screenPoint, size.height, size.width, viewport]);

  const beginTextEdit = (kind: 'node' | 'edge', id: string) => {
    if (kind === 'node') {
      const node = page?.nodes.find((candidate) => candidate.id === id);
      if (!node || node.locked) return;
      setSelection([id], id);
      setTextEdit({ kind, id, value: typeof node.data.label === 'string' ? node.data.label : node.type });
    } else {
      const edge = page?.edges.find((candidate) => candidate.id === id);
      if (!edge) return;
      setSelection([id], id);
      setTextEdit({ kind, id, value: typeof edge.data.label === 'string' ? edge.data.label : '' });
    }
    setContextMenu(null);
  };

  const commitTextEdit = () => {
    if (!textEdit) return;
    const value = textEdit.value.trim();
    if (textEdit.kind === 'node') {
      const node = page?.nodes.find((candidate) => candidate.id === textEdit.id);
      if (node) updateNode(node.id, { data: { label: value || node.type } }, 'Edit label');
    } else {
      updateEdge(textEdit.id, { data: { label: value } }, 'Edit connector label');
    }
    setTextEdit(null);
  };

  const handleContextMenu = (event: ReactMouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    const target = event.target as Element;
    const nodeTarget = target.closest?.('[data-node-id]');
    const edgeTarget = target.closest?.('[data-edge-id]');
    const menuTarget = nodeTarget?.getAttribute('data-node-id')
      ? { kind: 'node' as const, id: nodeTarget.getAttribute('data-node-id') ?? undefined }
      : edgeTarget?.getAttribute('data-edge-id')
        ? { kind: 'edge' as const, id: edgeTarget.getAttribute('data-edge-id') ?? undefined }
        : { kind: 'canvas' as const };
    if (menuTarget.id) setSelection([menuTarget.id], menuTarget.id);
    else setSelection([]);
    setTextEdit(null);
    const point = screenPoint(event);
    setContextMenu({ x: point.x, y: point.y, target: menuTarget });
  };

  const duplicateContextTarget = () => {
    const target = contextMenu?.target;
    if (!target?.id || !page) return;
    const node = target.kind === 'node' ? page.nodes.find((candidate) => candidate.id === target.id) : undefined;
    if (node) {
      const copy = buildNode(node.type, { x: node.position.x + 24, y: node.position.y + 24 }, {
        library: node.library,
        size: { ...node.size },
        style: { ...node.style },
        data: structuredClone(node.data),
      });
      copy.rotation = node.rotation;
      copy.zIndex = (node.zIndex ?? 0) + 1;
      addNode(copy);
    } else if (target.kind === 'edge') {
      const edge = page.edges.find((candidate) => candidate.id === target.id);
      if (edge) {
        const copy = createEdge(edge.source, edge.target, { type: edge.type, data: structuredClone(edge.data), style: structuredClone(edge.style) });
        copy.waypoints = edge.waypoints.map((point) => ({ ...point }));
        addEdge(copy);
      }
    }
    setContextMenu(null);
  };

  const deleteContextTarget = () => {
    if (!contextMenu || contextMenu.target.kind === 'canvas') {
      setSelection([]);
      setContextMenu(null);
      return;
    }
    if (contextMenu.target.id) setSelection([contextMenu.target.id], contextMenu.target.id);
    deleteSelection();
    setContextMenu(null);
  };

  const queryVisibleNodes = useCallback(async () => {
    if (!page || !spatialReadyRef.current || isPanningRef.current) return;
    const queryId = ++spatialQueryRef.current;
    try {
      const ids = await spatialClient.queryViewport(viewportBounds(viewport, { width: size.width, height: size.height }));
      if (queryId === spatialQueryRef.current) setVisibleNodeIds(new Set(ids));
    } catch {
      if (queryId === spatialQueryRef.current) setVisibleNodeIds(new Set(page.nodes.map((node) => node.id)));
    }
  }, [page, size.height, size.width, spatialClient, viewport]);

  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    const nextNodes = page.nodes.map((node) => nodeToSpatialNode(node.id, node.position, node.size));
    const nextMap = new Map(nextNodes.map((node) => [node.id, node]));
    const syncIndex = async () => {
      spatialReadyRef.current = false;
      setVisibleNodeIds(null);
      try {
        if (indexedPageRef.current !== page.id) {
          await spatialClient.initialize(nextNodes);
          indexedPageRef.current = page.id;
        } else {
          const changed = nextNodes.filter((node) => {
            const previous = indexedNodesRef.current.get(node.id);
            return !previous || previous.minX !== node.minX || previous.minY !== node.minY || previous.maxX !== node.maxX || previous.maxY !== node.maxY;
          });
          const removed = [...indexedNodesRef.current.keys()].filter((id) => !nextMap.has(id));
          await spatialClient.upsert(changed);
          await spatialClient.remove(removed);
        }
        indexedNodesRef.current = nextMap;
        spatialReadyRef.current = true;
        if (!cancelled) await queryVisibleNodes();
      } catch {
        spatialReadyRef.current = true;
        indexedNodesRef.current = nextMap;
        if (!cancelled) setVisibleNodeIds(new Set(nextNodes.map((node) => node.id)));
      }
    };
    void syncIndex();
    return () => { cancelled = true; };
  }, [page?.id, page?.nodes, spatialClient]);

  useEffect(() => {
    void queryVisibleNodes();
  }, [queryVisibleNodes]);

  const beginResizeInteraction = (event: ReactPointerEvent<SVGRectElement>, node: DiagramNode, handle: ResizeHandle) => {
    if (activeTool !== 'select' || spacePressed || event.button === 1 || node.locked) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setSelection([node.id], node.id);
    dragRef.current = {
      mode: 'resize',
      pointerId: event.pointerId,
      startWorld: worldPoint(event),
      startClient: screenPoint(event),
      nodeId: node.id,
      resizeHandle: handle,
      initialNode: { position: { ...node.position }, size: { ...node.size } },
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const beginNodeInteraction = (event: ReactPointerEvent<SVGElement>, node: DiagramNode, port?: ConnectionPort) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    if (activeTool === 'pan' || spacePressed || event.button === 1) {
      const point = worldPoint(event);
      dragRef.current = { mode: 'pan', pointerId: event.pointerId, startWorld: point, startClient: screenPoint(event), initialViewport: viewport };
      isPanningRef.current = true;
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (node.locked) {
      setSelection([node.id], node.id);
      return;
    }
    if (activeTool === 'connector') {
      const anchor = { nodeId: node.id, port } satisfies ConnectorAnchor;
      if (!connectorStart) {
        setConnectorStart(anchor);
      } else if (connectorStart.nodeId !== node.id) {
        const sourceNode = page?.nodes.find((candidate) => candidate.id === connectorStart.nodeId);
        const source = sourceNode ? { nodeId: connectorStart.nodeId, port: connectorStart.port ?? nearestConnectionPort(sourceNode, nodeCenter(node)) } : connectorStart;
        const target = { nodeId: node.id, port: port ?? (sourceNode ? nearestConnectionPort(node, nodeCenter(sourceNode)) : undefined) };
        const edgeOptions = document.diagramType === 'erd'
          ? { type: 'orthogonal' as const, style: { startMarker: 'bar' as const, endMarker: 'crowfoot' as const } }
          : document.diagramType === 'dfd'
            ? { type: 'orthogonal' as const }
            : undefined;
        createConnector(createEdge(source, target, edgeOptions));
        setConnectorStart(null);
      }
      return;
    }
    if (activeTool !== 'select') {
      setSelection([node.id], node.id);
      return;
    }

    const now = Date.now();
    if (event.button === 0 && !event.shiftKey && lastClickRef.current?.kind === 'node' && lastClickRef.current.id === node.id && now - lastClickRef.current.time < 350) {
      lastClickRef.current = null;
      dragRef.current = null;
      beginTextEdit('node', node.id);
      return;
    }
    if (event.button === 0 && !event.shiftKey) lastClickRef.current = { kind: 'node', id: node.id, time: now };

    const groupSelection = node.groupId ? page?.nodes.filter((candidate) => candidate.groupId === node.groupId).map((candidate) => candidate.id) ?? [node.id] : [node.id];
    let nextSelection = selectedIds;
    if (event.shiftKey) {
      const groupIsSelected = groupSelection.every((id) => selectedIds.includes(id));
      nextSelection = groupIsSelected
        ? selectedIds.filter((id) => !groupSelection.includes(id))
        : [...new Set([...selectedIds, ...groupSelection])];
    } else if (!selectedIds.includes(node.id) || groupSelection.some((id) => !selectedIds.includes(id))) {
      nextSelection = groupSelection;
    }
    setSelection(nextSelection, node.id);
    const positions = Object.fromEntries((nextSelection.length ? nextSelection : [node.id]).map((id) => {
      const current = page?.nodes.find((candidate) => candidate.id === id);
      return [id, current ? { ...current.position } : { x: 0, y: 0 }];
    }));
    const point = worldPoint(event);
    const session: DragSession = { mode: 'drag', pointerId: event.pointerId, startWorld: point, startClient: screenPoint(event), initialPositions: positions };
    dragRef.current = session;
    setAlignmentGuides([]);
    setSnapCandidateIds([]);
    const selectedNodes = page?.nodes.filter((candidate) => nextSelection.includes(candidate.id)) ?? [];
    if (selectedNodes.length > 0) {
      const minX = Math.min(...selectedNodes.map((candidate) => candidate.position.x));
      const minY = Math.min(...selectedNodes.map((candidate) => candidate.position.y));
      const maxX = Math.max(...selectedNodes.map((candidate) => candidate.position.x + candidate.size.width));
      const maxY = Math.max(...selectedNodes.map((candidate) => candidate.position.y + candidate.size.height));
      const radius = Math.max(500, Math.max(maxX - minX, maxY - minY) + 320);
      void spatialClient.queryNearby((minX + maxX) / 2, (minY + maxY) / 2, radius).then((ids) => {
        if (dragRef.current !== session) return;
        const fallbackIds = page?.nodes.filter((candidate) => !nextSelection.includes(candidate.id)).map((candidate) => candidate.id) ?? [];
        setSnapCandidateIds(ids.length > 0 ? ids : fallbackIds);
      }).catch(() => {
        if (dragRef.current === session) setSnapCandidateIds(page?.nodes.filter((candidate) => !nextSelection.includes(candidate.id)).map((candidate) => candidate.id) ?? []);
      });
    }
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const beginEdgeInteraction = (event: ReactPointerEvent<SVGGElement>, edge: DiagramEdge) => {
    if (activeTool === 'pan' || spacePressed || event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      const point = worldPoint(event);
      dragRef.current = { mode: 'pan', pointerId: event.pointerId, startWorld: point, startClient: screenPoint(event), initialViewport: viewport };
      isPanningRef.current = true;
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool !== 'select') return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    const now = Date.now();
    if (event.button === 0 && !event.shiftKey && lastClickRef.current?.kind === 'edge' && lastClickRef.current.id === edge.id && now - lastClickRef.current.time < 350) {
      lastClickRef.current = null;
      beginTextEdit('edge', edge.id);
      return;
    }
    if (event.button === 0 && !event.shiftKey) lastClickRef.current = { kind: 'edge', id: edge.id, time: now };
    const nextSelection = event.shiftKey
      ? selectedIds.includes(edge.id)
        ? selectedIds.filter((id) => id !== edge.id)
        : [...selectedIds, edge.id]
      : [edge.id];
    setSelection(nextSelection, nextSelection.includes(edge.id) ? edge.id : nextSelection.at(-1) ?? null);
  };

  const beginWaypointInteraction = (event: ReactPointerEvent<SVGCircleElement>, edge: DiagramEdge, index: number, point: Point) => {
    if (activeTool !== 'select' || spacePressed || event.button === 1) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setSelection([edge.id], edge.id);
    const session: DragSession = { mode: 'waypoint', pointerId: event.pointerId, startWorld: worldPoint(event), startClient: screenPoint(event), edgeId: edge.id, waypointIndex: index };
    dragRef.current = session;
    setWaypointPreview({ edgeId: edge.id, index, point: { ...point } });
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const beginEndpointInteraction = (event: ReactPointerEvent<SVGCircleElement>, edge: DiagramEdge, endpoint: 'source' | 'target', point: Point) => {
    if (activeTool !== 'select' || spacePressed || event.button === 1) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setSelection([edge.id], edge.id);
    dragRef.current = {
      mode: 'endpoint',
      pointerId: event.pointerId,
      startWorld: worldPoint(event),
      startClient: screenPoint(event),
      edgeId: edge.id,
      endpoint,
    };
    setEndpointPreview({ edgeId: edge.id, endpoint, anchor: { ...edge[endpoint] }, point: { ...point } });
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const updateEndpointPreview = (session: DragSession, point: Point) => {
    if (!session.edgeId || !session.endpoint || !page) return;
    const edge = page.edges.find((candidate) => candidate.id === session.edgeId);
    if (!edge) return;
    const oppositeNodeId = session.endpoint === 'source' ? edge.target.nodeId : edge.source.nodeId;
    const currentAnchor = edge[session.endpoint];
    const candidate = page.nodes
      .filter((node) => node.id !== oppositeNodeId)
      .filter((node) => point.x >= node.position.x && point.x <= node.position.x + node.size.width && point.y >= node.position.y && point.y <= node.position.y + node.size.height)
      .sort((left, right) => (right.zIndex ?? 0) - (left.zIndex ?? 0))[0]
      ?? page.nodes.find((node) => node.id === currentAnchor.nodeId);
    if (!candidate) return;
    const port = nearestConnectionPort(candidate, point);
    const anchor = { nodeId: candidate.id, port };
    setEndpointPreview({ edgeId: edge.id, endpoint: session.endpoint, anchor, point: nodeConnectionPoint(candidate, point, port) });
  };

  const beginCanvasInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    setContextMenu(null);
    const target = event.target as Element;
    if (target.closest?.('[data-node-id]') || target.closest?.('[data-edge-id]')) return;
    const point = worldPoint(event);
    const screen = screenPoint(event);
    if (activeTool === 'pan' || spacePressed || event.button === 1) {
      dragRef.current = { mode: 'pan', pointerId: event.pointerId, startWorld: point, startClient: screen, initialViewport: viewport };
      isPanningRef.current = true;
    } else if (activeTool === 'shape') {
      addNode(buildNode('rectangle', { x: point.x - 90, y: point.y - 44 }, { data: { label: 'Rectangle' } }));
      setTool('select');
    } else if (activeTool === 'text') {
      addNode(buildNode('text', { x: point.x - 95, y: point.y - 28 }, { size: { width: 190, height: 56 }, data: { label: 'Text label' }, style: { fill: 'transparent', stroke: 'transparent', radius: 0 } }));
      setTool('select');
    } else if (activeTool === 'select') {
      if (!event.shiftKey) setSelection([]);
      setAlignmentGuides([]);
      setSnapCandidateIds([]);
      dragRef.current = { mode: 'marquee', pointerId: event.pointerId, startWorld: point, startClient: screen };
      setMarquee({ start: point, current: point });
    }
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.mode === 'pan' && session.initialViewport) {
      pendingPanRef.current = { session, screen: screenPoint(event) };
      if (!panFrameRef.current) {
        panFrameRef.current = requestAnimationFrame(() => {
          const pending = pendingPanRef.current;
          panFrameRef.current = null;
          if (!pending?.session.initialViewport) return;
          updateViewport({
            x: pending.session.initialViewport.x + (pending.screen.x - pending.session.startClient.x) / pending.session.initialViewport.zoom,
            y: pending.session.initialViewport.y + (pending.screen.y - pending.session.startClient.y) / pending.session.initialViewport.zoom,
          });
        });
      }
      return;
    }
    const point = worldPoint(event);
    if (session.mode === 'endpoint') {
      updateEndpointPreview(session, point);
    } else if (session.mode === 'resize' && session.initialNode && session.nodeId && session.resizeHandle) {
      const { position, size: initialSize } = session.initialNode;
      const delta = { x: point.x - session.startWorld.x, y: point.y - session.startWorld.y };
      const minWidth = 48;
      const minHeight = 32;
      const initialRight = position.x + initialSize.width;
      const initialBottom = position.y + initialSize.height;
      let left = position.x;
      let right = initialRight;
      let top = position.y;
      let bottom = initialBottom;
      if (session.resizeHandle.includes('w')) left = Math.min(initialRight - minWidth, position.x + delta.x);
      if (session.resizeHandle.includes('e')) right = Math.max(position.x + minWidth, initialRight + delta.x);
      if (session.resizeHandle.includes('n')) top = Math.min(initialBottom - minHeight, position.y + delta.y);
      if (session.resizeHandle.includes('s')) bottom = Math.max(position.y + minHeight, initialBottom + delta.y);
      setResizePreview({ nodeId: session.nodeId, position: { x: left, y: top }, size: { width: right - left, height: bottom - top } });
    } else if (session.mode === 'waypoint' && session.edgeId && session.waypointIndex !== undefined) {
      const gridSize = page?.settings.gridSize ?? 16;
      const nextPoint = page?.settings.snapToGrid ? { x: Math.round(point.x / gridSize) * gridSize, y: Math.round(point.y / gridSize) * gridSize } : point;
      setWaypointPreview({ edgeId: session.edgeId, index: session.waypointIndex, point: nextPoint });
    } else if (session.mode === 'drag' && session.initialPositions) {
      const delta = { x: point.x - session.startWorld.x, y: point.y - session.startWorld.y };
      const desiredPositions = Object.fromEntries(Object.entries(session.initialPositions).map(([id, position]) => [id, { x: position.x + delta.x, y: position.y + delta.y }]));
      const movingNodes = page?.nodes.filter((node) => Object.hasOwn(session.initialPositions ?? {}, node.id)) ?? [];
      const candidateNodes = page?.nodes.filter((node) => snapCandidateIds.includes(node.id)) ?? [];
      const snapped = snapNodes(movingNodes, desiredPositions, candidateNodes, { gridSize: page?.settings.gridSize ?? 16, snapToGrid: page?.settings.snapToGrid ?? false, threshold: 10 / viewport.zoom });
      const preview = snapped.positions;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        setDragPreview(preview);
        setAlignmentGuides(snapped.guides);
      });
    } else if (session.mode === 'marquee') {
      setMarquee({ start: session.startWorld, current: point });
    }
  };

  const finishPointerInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.mode === 'pan') {
      if (panFrameRef.current) cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = null;
      const pending = pendingPanRef.current;
      if (pending?.session === session && session.initialViewport) {
        updateViewport({
          x: session.initialViewport.x + (pending.screen.x - session.startClient.x) / session.initialViewport.zoom,
          y: session.initialViewport.y + (pending.screen.y - session.startClient.y) / session.initialViewport.zoom,
        });
      }
      pendingPanRef.current = null;
      isPanningRef.current = false;
    } else if (session.mode === 'resize') {
      const nodeId = session.nodeId;
      const preview = resizePreview;
      if (nodeId && preview?.nodeId === nodeId) {
        updateNode(nodeId, { position: preview.position, size: preview.size }, 'Resize node');
        setResizePreview(null);
      }
    } else if (session.mode === 'endpoint' && session.edgeId && session.endpoint && endpointPreview?.edgeId === session.edgeId && endpointPreview.endpoint === session.endpoint) {
      const edge = page?.edges.find((candidate) => candidate.id === session.edgeId);
      if (edge && !sameEndpoint(edge[session.endpoint], endpointPreview.anchor)) {
        const changes = session.endpoint === 'source'
          ? { source: endpointPreview.anchor }
          : { target: endpointPreview.anchor };
        updateEdge(edge.id, { ...changes, ...(edge[session.endpoint].nodeId !== endpointPreview.anchor.nodeId ? { waypoints: [] } : {}) }, `Move ${session.endpoint} endpoint`);
      }
      setEndpointPreview(null);
    } else if (session.mode === 'waypoint' && session.edgeId && session.waypointIndex !== undefined && waypointPreview?.edgeId === session.edgeId && waypointPreview.index === session.waypointIndex) {
      const edge = page?.edges.find((candidate) => candidate.id === session.edgeId);
      if (edge) {
        const waypoints = edge.waypoints.slice();
        if (session.waypointIndex < waypoints.length) waypoints[session.waypointIndex] = waypointPreview.point;
        else waypoints.splice(Math.min(session.waypointIndex, waypoints.length), 0, waypointPreview.point);
        updateEdge(edge.id, { waypoints }, 'Move waypoint');
      }
      setWaypointPreview(null);
    } else if (session.mode === 'drag' && Object.keys(dragPreview).length > 0) {
      moveNodes(dragPreview);
      setDragPreview({});
      setAlignmentGuides([]);
      setSnapCandidateIds([]);
    } else if (session.mode === 'marquee' && marquee && page) {
      const left = Math.min(marquee.start.x, marquee.current.x);
      const right = Math.max(marquee.start.x, marquee.current.x);
      const top = Math.min(marquee.start.y, marquee.current.y);
      const bottom = Math.max(marquee.start.y, marquee.current.y);
      const ids = page.nodes.filter((node) => {
        const position = dragPreview[node.id] ?? node.position;
        return position.x < right && position.x + node.size.width > left && position.y < bottom && position.y + node.size.height > top;
      }).map((node) => node.id);
      setSelection(ids, ids.at(-1) ?? null);
      setMarquee(null);
      setAlignmentGuides([]);
      setSnapCandidateIds([]);
    }
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
    const before = worldPoint(event);
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || nextZoom === viewport.zoom) return;
    const screen = screenPoint(event);
    updateViewport({ zoom: nextZoom, x: (screen.x - size.width / 2) / nextZoom - before.x, y: (screen.y - size.height / 2) / nextZoom - before.y });
  };

  const transform = `translate(${size.width / 2 + viewport.x * viewport.zoom} ${size.height / 2 + viewport.y * viewport.zoom}) scale(${viewport.zoom})`;
  const gridSize = page?.settings.gridSize ?? 16;
  const gridId = `grid-${page?.id ?? 'page'}`;
  const marqueeRect = marquee ? {
    x: Math.min(marquee.start.x, marquee.current.x), y: Math.min(marquee.start.y, marquee.current.y),
    width: Math.abs(marquee.current.x - marquee.start.x), height: Math.abs(marquee.current.y - marquee.start.y),
  } : null;

  const renderedNodes = page?.nodes.filter((node) => !visibleNodeIds || visibleNodeIds.has(node.id)).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)) ?? [];
  const nodeMap = useMemo(() => new Map((page?.nodes ?? []).map((node) => {
    const moved = dragPreview[node.id] ? { ...node, position: dragPreview[node.id] } : node;
    return [node.id, resizePreview?.nodeId === node.id ? { ...moved, position: resizePreview.position, size: resizePreview.size } : moved] as const;
  })), [dragPreview, page?.nodes, resizePreview]);
  const renderedEdges = page?.edges.filter((edge) => !visibleNodeIds || visibleNodeIds.has(edge.source.nodeId) || visibleNodeIds.has(edge.target.nodeId)) ?? [];
  const editBox = useMemo(() => {
    if (!textEdit || !page) return null;
    if (textEdit.kind === 'node') {
      const node = nodeMap.get(textEdit.id);
      if (!node) return null;
      const width = Math.max(110, Math.min(360, node.size.width * viewport.zoom));
      return {
        left: size.width / 2 + (node.position.x + viewport.x) * viewport.zoom + (node.size.width * viewport.zoom - width) / 2,
        top: size.height / 2 + (node.position.y + viewport.y) * viewport.zoom + (node.size.height * viewport.zoom - 30) / 2,
        width,
      };
    }
    const edge = page.edges.find((candidate) => candidate.id === textEdit.id);
    const source = edge ? nodeMap.get(edge.source.nodeId) : undefined;
    const target = edge ? nodeMap.get(edge.target.nodeId) : undefined;
    if (!edge || !source || !target) return null;
    const route = edgeRoute(edge, source, target, [...nodeMap.values()]);
    const start = route[0];
    const end = route.at(-1) ?? start;
    const point = route.length === 2 ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : route[Math.floor(route.length / 2)] ?? start;
    return { left: size.width / 2 + (point.x + viewport.x) * viewport.zoom - 80, top: size.height / 2 + (point.y + viewport.y) * viewport.zoom - 15, width: 160 };
  }, [nodeMap, page, size.height, size.width, textEdit, viewport]);

  return <div className={`canvas-stage ${activeTool === 'pan' || spacePressed ? 'pan-mode' : ''} ${activeTool === 'connector' ? 'connector-mode' : ''}`} ref={stageRef}>
    <div className="canvas-hint"><span className="hint-key">Hold Space</span> + drag to pan <span className="hint-separator">·</span> <span className="hint-key">Scroll</span> to zoom</div>
    <svg ref={svgRef} className="diagram-canvas" width={size.width} height={size.height} onPointerDown={beginCanvasInteraction} onPointerMove={handlePointerMove} onPointerUp={finishPointerInteraction} onPointerCancel={finishPointerInteraction} onWheel={handleWheel} onContextMenu={handleContextMenu}>
      <defs>
        <pattern id={gridId} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse"><path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="#2c3346" strokeWidth="0.7" opacity="0.62" /></pattern>
        <marker id="arrow-end" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 z" fill="#8a92ab" /></marker>
        <marker id="arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M8,0 L0,4 L8,8 z" fill="#8a92ab" /></marker>
        <marker id="arrow-end-active" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 z" fill="#9c86ff" /></marker>
      </defs>
      <rect className="canvas-background" width={size.width} height={size.height} fill="#0f121a" />
      <g transform={transform}>
        <rect x={-10000} y={-10000} width={20000} height={20000} fill={page?.settings.gridVisible ? `url(#${gridId})` : '#10131c'} />
        <g className="edge-layer">{renderedEdges.map((edge) => {
          const previewEdge = endpointPreview?.edgeId === edge.id ? { ...edge, [endpointPreview.endpoint]: endpointPreview.anchor } as DiagramEdge : edge;
          const previewWaypoints = waypointPreview?.edgeId === edge.id
            ? (() => { const next = previewEdge.waypoints.slice(); if (waypointPreview.index < next.length) next[waypointPreview.index] = waypointPreview.point; else next.splice(Math.min(waypointPreview.index, next.length), 0, waypointPreview.point); return next; })()
            : previewEdge.waypoints;
          const preview = waypointPreview?.edgeId === edge.id ? { ...previewEdge, waypoints: previewWaypoints } : previewEdge;
          return <EdgeView key={edge.id} edge={preview} source={nodeMap.get(preview.source.nodeId)} target={nodeMap.get(preview.target.nodeId)} obstacles={[...nodeMap.values()]} selected={selectedIds.includes(edge.id)} onPointerDown={beginEdgeInteraction} onDoubleClick={(event, selectedEdge) => beginTextEdit('edge', selectedEdge.id)} onWaypointPointerDown={beginWaypointInteraction} markerFill={page?.settings.background ?? '#10131c'} />;
        })}</g>
         <g className="node-layer">{renderedNodes.map((node) => { const previewNode = nodeMap.get(node.id) ?? node; return <NodeView key={node.id} node={previewNode} position={previewNode.position} selected={selectedIds.includes(node.id)} connectorStart={connectorStart?.nodeId === node.id} showPorts={activeTool === 'connector' || selectedIds.includes(node.id)} diagramType={document.diagramType} onPointerDown={beginNodeInteraction} onResizePointerDown={beginResizeInteraction} onDoubleClick={(event, selectedNode) => beginTextEdit('node', selectedNode.id)} />; })}</g>
         <g className="edge-endpoint-layer">{renderedEdges.map((edge) => {
           const previewEdge = endpointPreview?.edgeId === edge.id ? { ...edge, [endpointPreview.endpoint]: endpointPreview.anchor } as DiagramEdge : edge;
           return <EdgeEndpointHandles key={`handles-${edge.id}`} edge={previewEdge} source={nodeMap.get(previewEdge.source.nodeId)} target={nodeMap.get(previewEdge.target.nodeId)} obstacles={[...nodeMap.values()]} selected={selectedIds.includes(edge.id)} onPointerDown={beginEndpointInteraction} />;
         })}</g>
        <g className="alignment-guide-layer">{alignmentGuides.map((guide, index) => guide.orientation === 'vertical'
          ? <line key={`vertical-${index}`} className="alignment-guide" x1={guide.position} y1={guide.start} x2={guide.position} y2={guide.end} />
          : <line key={`horizontal-${index}`} className="alignment-guide" x1={guide.start} y1={guide.position} x2={guide.end} y2={guide.position} />)}</g>
        {marqueeRect && <rect className="selection-marquee" x={marqueeRect.x} y={marqueeRect.y} width={marqueeRect.width} height={marqueeRect.height} />}
      </g>
    </svg>
    {editBox && textEdit && <input ref={textInputRef} className="canvas-text-editor" style={{ left: editBox.left, top: editBox.top, width: editBox.width }} value={textEdit.value} onChange={(event) => setTextEdit({ ...textEdit, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitTextEdit(); } if (event.key === 'Escape') { event.preventDefault(); setTextEdit(null); } }} onBlur={commitTextEdit} onPointerDown={(event) => event.stopPropagation()} aria-label="Edit diagram text" />}
    {contextMenu && <div className="canvas-context-menu" style={{ left: Math.min(contextMenu.x, Math.max(8, size.width - 178)), top: Math.min(contextMenu.y, Math.max(8, size.height - 170)) }} onPointerDown={(event) => event.stopPropagation()}>
      {contextMenu.target.kind !== 'canvas' && <button onClick={() => { if (contextMenu.target.kind !== 'canvas' && contextMenu.target.id) beginTextEdit(contextMenu.target.kind, contextMenu.target.id); }}>{contextMenu.target.kind === 'node' ? 'Edit text' : 'Edit label'}</button>}
      {contextMenu.target.kind !== 'canvas' && <button onClick={duplicateContextTarget}>Duplicate</button>}
      {contextMenu.target.kind !== 'canvas' && <button className="context-danger" onClick={deleteContextTarget}>Delete</button>}
      {contextMenu.target.kind === 'canvas' && <button onClick={() => { setSelection([]); setContextMenu(null); }}>Clear selection</button>}
    </div>}
    <div className="canvas-coordinates">{Math.round(viewport.x)}, {Math.round(viewport.y)}</div>
  </div>;
}

function EdgeView({ edge, source, target, obstacles, selected, onPointerDown, onDoubleClick, onWaypointPointerDown, markerFill }: { edge: DiagramEdge; source?: DiagramNode; target?: DiagramNode; obstacles: DiagramNode[]; selected: boolean; onPointerDown: (event: ReactPointerEvent<SVGGElement>, edge: DiagramEdge) => void; onDoubleClick: (event: ReactMouseEvent<SVGGElement>, edge: DiagramEdge) => void; onWaypointPointerDown: (event: ReactPointerEvent<SVGCircleElement>, edge: DiagramEdge, index: number, point: Point) => void; markerFill: string }) {
  if (!source || !target) return null;
  const route = edgeRoute(edge, source, target, obstacles);
  const start = route[0];
  const end = route[route.length - 1];
  const path = edge.type === 'curved' ? curvedPath(route) : pointsToPath(route);
  const label = typeof edge.data?.label === 'string' ? edge.data.label : null;
  const labelPoint = route.length === 2 ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : route[Math.floor(route.length / 2)] ?? start;
  const startDirection = outwardDirection(start, nodeCenter(source));
  const endDirection = outwardDirection(end, nodeCenter(target));
  const waypointHandles = selected && edge.type === 'orthogonal'
    ? edge.waypoints.length > 0
      ? edge.waypoints.map((point, index) => <circle key={`waypoint-${index}`} className="edge-waypoint" cx={point.x} cy={point.y} r="5" onPointerDown={(event) => onWaypointPointerDown(event, edge, index, point)} />)
      : route.slice(1, -1).map((point, index) => <circle key={`auto-waypoint-${point.x}-${point.y}-${index}`} className="edge-waypoint auto" cx={point.x} cy={point.y} r="5" onPointerDown={(event) => onWaypointPointerDown(event, edge, index, point)} />)
    : null;
  return <g className={`canvas-edge ${selected ? 'selected' : ''}`} data-edge-id={edge.id} onPointerDown={(event) => onPointerDown(event, edge)} onDoubleClick={(event) => onDoubleClick(event, edge)}>
    <path className="edge-shadow" d={path} fill="none" stroke="#0a0c12" strokeWidth={edge.style.strokeWidth + 5} opacity="0.72" pointerEvents="none" />
    {selected && <path className="edge-selection" d={path} fill="none" stroke="#a28fff" strokeWidth={edge.style.strokeWidth + 5} opacity="0.22" pointerEvents="none" />}
    <path className="edge-visible" d={path} fill="none" stroke={edge.style.stroke} strokeWidth={edge.style.strokeWidth} strokeDasharray={edge.style.dash === 'dashed' ? '8 6' : edge.style.dash === 'dotted' ? '2 5' : undefined} pointerEvents="none" />
    <path className="edge-hit-area" d={path} fill="none" stroke="#ffffff" strokeOpacity="0" strokeWidth={Math.max(14, edge.style.strokeWidth + 8)} pointerEvents="stroke" />
    {renderEndpointMarker(start, startDirection, edge.style.startMarker, edge.style.stroke, markerFill, 'start')}
    {renderEndpointMarker(end, endDirection, edge.style.endMarker, edge.style.stroke, markerFill, 'end')}
    {waypointHandles}
    {label && <g className="edge-label-group" transform={`translate(${labelPoint.x} ${labelPoint.y})`} pointerEvents="none"><rect x={-28} y={-12} width={56} height={22} rx={11} fill="#171b28" stroke={selected ? '#7968c5' : '#3a4258'} /><text className="edge-label" textAnchor="middle" y="4">{label}</text></g>}
  </g>;
}

function EdgeEndpointHandles({ edge, source, target, obstacles, selected, onPointerDown }: { edge: DiagramEdge; source?: DiagramNode; target?: DiagramNode; obstacles: DiagramNode[]; selected: boolean; onPointerDown: (event: ReactPointerEvent<SVGCircleElement>, edge: DiagramEdge, endpoint: 'source' | 'target', point: Point) => void }) {
  if (!selected || !source || !target) return null;
  const route = edgeRoute(edge, source, target, obstacles);
  const start = route[0];
  const end = route.at(-1) ?? start;
  return <>
    <circle className="edge-endpoint-handle source" data-edge-endpoint="source" cx={start.x} cy={start.y} r="7" onPointerDown={(event) => onPointerDown(event, edge, 'source', start)} />
    <circle className="edge-endpoint-handle target" data-edge-endpoint="target" cx={end.x} cy={end.y} r="7" onPointerDown={(event) => onPointerDown(event, edge, 'target', end)} />
  </>;
}

function outwardDirection(point: Point, neighbor: Point): Point {
  const dx = point.x - neighbor.x;
  const dy = point.y - neighbor.y;
  if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 0.001) return { x: Math.sign(dx), y: 0 };
  if (Math.abs(dy) > 0.001) return { x: 0, y: Math.sign(dy) };
  return { x: 1, y: 0 };
}

function renderEndpointMarker(point: Point, direction: Point, marker: EdgeMarker, stroke: string, fill: string, key: string) {
  if (marker === 'none') return null;
  const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
  const strokeWidth = 1.6;
  const lineProps = { fill: 'none', stroke, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const circle = <circle cx="0" cy="0" r="6" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  const bar = <path d="M 0 -7 L 0 7" {...lineProps} />;
  // Crow's-foot prongs face the entity. `direction` points away from the
  // entity along the connector, so the glyph extends along local -X.
  const crowfoot = (offset = 0) => <path d={`M ${offset} 0 L ${offset - 11} -7 M ${offset} 0 L ${offset - 11} 0 M ${offset} 0 L ${offset - 11} 7`} {...lineProps} />;
  const glyph = marker === 'arrow'
    ? <path d={key === 'start' ? 'M 0 0 L -10 -6 L -10 6 Z' : 'M 0 0 L 10 -6 L 10 6 Z'} fill={stroke} />
    : marker === 'bar' ? bar
      : marker === 'circle' ? circle
        : marker === 'crowfoot' ? crowfoot()
          : marker === 'circle-bar' ? <>{circle}<path d="M 10 -7 L 10 7" {...lineProps} /></>
              : marker === 'bar-crowfoot' ? <>{bar}{crowfoot(-5)}</>
                : <>{circle}{crowfoot(-8)}</>;
  return <g key={key} className="edge-marker" transform={`translate(${point.x} ${point.y}) rotate(${angle})`} pointerEvents="none">{glyph}</g>;
}

function sameEndpoint(left: Endpoint, right: Endpoint): boolean {
  return left.nodeId === right.nodeId && left.port === right.port;
}

function NodeView({ node, position, selected, connectorStart, showPorts, diagramType, onPointerDown, onResizePointerDown, onDoubleClick }: { node: DiagramNode; position: Point; selected: boolean; connectorStart: boolean; showPorts: boolean; diagramType: string; onPointerDown: (event: ReactPointerEvent<SVGElement>, node: DiagramNode, port?: ConnectionPort) => void; onResizePointerDown: (event: ReactPointerEvent<SVGRectElement>, node: DiagramNode, handle: ResizeHandle) => void; onDoubleClick: (event: ReactMouseEvent<SVGGElement>, node: DiagramNode) => void }) {
  const width = node.size.width;
  const height = node.size.height;
  const label = typeof node.data.label === 'string' ? node.data.label : node.type;
  const commonProps = { fill: node.style.fill, stroke: node.style.stroke, strokeWidth: node.style.strokeWidth, opacity: node.style.opacity };
  const shape = (() => {
    if (node.type === 'diamond' || node.type === 'decision') {
      const points = `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
      return <polygon points={points} {...commonProps} />;
    }
    if (node.type === 'circle' || node.type === 'use-case' || (diagramType === 'dfd' && node.type === 'process')) return <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...commonProps} />;
    if (node.type === 'line') return <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} markerEnd="url(#arrow-end)" />;
    if (node.type === 'actor') return <g><circle cx={width / 2} cy={28} r={16} {...commonProps} /><path d={`M${width / 2} 44 L${width / 2} 91 M${width / 2 - 25} 60 L${width / 2 + 25} 60 M${width / 2} 91 L${width / 2 - 21} 124 M${width / 2} 91 L${width / 2 + 21} 124`} fill="none" stroke={node.style.stroke} strokeWidth="3" strokeLinecap="round" /></g>;
    if (node.type === 'database') return <path d={`M 0 ${height * .18} C 0 0 ${width} 0 ${width} ${height * .18} L ${width} ${height * .8} C ${width} ${height + height * .02} 0 ${height + height * .02} 0 ${height * .8} Z M 0 ${height * .18} C 0 ${height * .36} ${width} ${height * .36} ${width} ${height * .18}`} {...commonProps} />;
    if (node.type === 'stored-data') return <path d={`M 12 0 H ${width - 12} Q ${width} 0 ${width} 12 V ${height - 12} Q ${width} ${height} ${width - 12} ${height} H 12 Q 0 ${height} 0 ${height - 12} V 12 Q 0 0 12 0 Z`} {...commonProps} />;
    if (node.type === 'document' || node.type === 'multiple-document') return <path d={`M 0 0 H ${width} V ${height - 16} Q ${width * .75} ${height} ${width * .5} ${height - 16} Q ${width * .25} ${height - 32} 0 ${height - 16} Z`} {...commonProps} />;
    if (node.type === 'manual-input') return <polygon points={`18,0 ${width},0 ${width - 18},${height} 0,${height}`} {...commonProps} />;
    if (node.type === 'preparation') return <polygon points={`24,0 ${width - 24},0 ${width},${height / 2} ${width - 24},${height} 24,${height} 0,${height / 2}`} {...commonProps} />;
    if (node.type === 'predefined-process') return <g><rect width={width} height={height} {...commonProps} /><line x1="16" y1="0" x2="16" y2={height} stroke={node.style.stroke} /><line x1={width - 16} y1="0" x2={width - 16} y2={height} stroke={node.style.stroke} /></g>;
    if (node.type === 'delay') return <path d={`M 0 0 H ${width - 28} A 28 ${height / 2} 0 0 1 ${width - 28} ${height} H 0 Z`} {...commonProps} />;
    if (node.type === 'display') return <path d={`M 0 0 H ${width - 28} Q ${width} ${height / 2} ${width - 28} ${height} H 0 Q 28 ${height / 2} 0 0 Z`} {...commonProps} />;
    if (node.type === 'connector') return <circle cx={width / 2} cy={height / 2} r={Math.min(width, height) / 2 - 2} {...commonProps} />;
    if (node.type === 'off-page-connector') return <polygon points={`0,0 ${width},0 ${width},${height * .68} ${width / 2},${height} 0,${height * .68}`} {...commonProps} />;
    if (node.type === 'entity') {
      const fields = normalizeEntityFields(node.data.fields);
      const striped = node.data.striped !== false;
      const rowFill = typeof node.data.rowFill === 'string' ? node.data.rowFill : node.style.fill;
      const stripeFill = typeof node.data.stripeFill === 'string' ? node.data.stripeFill : rowFill === '#f2f3f7' ? '#e3e5e9' : '#252c3c';
      const headerFill = typeof node.data.headerFill === 'string' ? node.data.headerFill : node.style.stroke;
      const textColor = node.style.textColor;
      const headerHeight = ERD_HEADER_HEIGHT;
      const rowHeight = ERD_ROW_HEIGHT;
      const keyColumnWidth = 38;
      const typeColumnWidth = Math.min(82, Math.max(58, width * 0.3));
      const typeColumnX = width - typeColumnWidth;
      return <g><rect width={width} height={height} rx={node.style.radius} fill={rowFill} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} strokeDasharray={node.data.associative ? '5 3' : undefined} opacity={node.style.opacity} /><rect width={width} height={headerHeight} rx={node.style.radius} fill={headerFill} opacity={node.style.opacity} /><line x1="0" y1={headerHeight} x2={width} y2={headerHeight} stroke={node.style.stroke} strokeWidth="1" />{fields.map((field, index) => { const y = headerHeight + index * rowHeight; const key = field.primaryKey && field.foreignKey ? 'PK/FK' : field.primaryKey ? 'PK' : field.foreignKey ? 'FK' : field.unique ? 'UQ' : ''; return <g key={field.id}><rect x="0" y={y} width={width} height={rowHeight} fill={striped && index % 2 === 1 ? stripeFill : rowFill} /><line x1="0" y1={y + rowHeight} x2={width} y2={y + rowHeight} stroke={node.style.stroke} strokeOpacity="0.34" /><line x1={keyColumnWidth} y1={y} x2={keyColumnWidth} y2={y + rowHeight} stroke={node.style.stroke} strokeOpacity="0.45" /><line x1={typeColumnX} y1={y} x2={typeColumnX} y2={y + rowHeight} stroke={node.style.stroke} strokeOpacity="0.45" />{key && <text className="node-field-key" style={{ fill: textColor }} x={keyColumnWidth / 2} y={y + 18}>{key}</text>}<text className="node-field-name" style={{ fill: textColor, textDecoration: field.primaryKey ? 'underline' : undefined, fontStyle: field.foreignKey ? 'italic' : undefined }} x={keyColumnWidth + 8} y={y + 18}>{field.name}</text><text className="node-field-type" style={{ fill: textColor }} x={typeColumnX + 7} y={y + 18}>{field.type}</text></g>; })}<text className="node-entity-title" style={{ fill: node.style.textColor === '#f4f5fa' ? '#ffffff' : textColor }} x={width / 2} y="23" textAnchor="middle">{label}</text></g>;
    }
    if (diagramType === 'dfd' && node.type === 'store') return <g><line x1="0" y1="10" x2={width} y2="10" stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} /><line x1="0" y1={height - 10} x2={width} y2={height - 10} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} /><text className="node-label" x={width / 2} y={height / 2 + 5}>{label}</text></g>;
    if (node.type === 'store') return <g><rect width={width} height={height} rx="4" {...commonProps} /><line x1="0" y1="12" x2={width} y2="12" stroke={node.style.stroke} opacity="0.5" /><text className="node-label" x={width / 2} y={height / 2 + 5}>{label}</text></g>;
    if (node.type === 'boundary') return <g><rect width={width} height={height} rx={node.style.radius} fill="none" stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} strokeDasharray="7 5" /><text className="boundary-label" x="18" y="27">{label}</text></g>;
    const radius = node.type === 'rounded-rectangle' || node.type === 'start' || node.type === 'use-case' ? Math.min(node.style.radius || 22, height / 2) : node.style.radius;
    return <rect width={width} height={height} rx={radius} {...commonProps} />;
  })();
  const labelNode = !['entity', 'actor', 'store', 'boundary', 'line'].includes(node.type) ? <text className={`node-label ${node.type === 'start' || node.type === 'use-case' ? 'node-label-strong' : ''}`} x={width / 2} y={height / 2 + 5}>{label}</text> : node.type === 'actor' ? <text className="node-label" x={width / 2} y={height - 10}>{label}</text> : null;
  const ports: Array<{ id: ConnectionPort; x: number; y: number }> = [{ id: 'top', x: width / 2, y: 0 }, { id: 'right', x: width, y: height / 2 }, { id: 'bottom', x: width / 2, y: height }, { id: 'left', x: 0, y: height / 2 }];
  const resizeHandles: Array<{ id: ResizeHandle; x: number; y: number; cursor: string }> = [
    { id: 'nw', x: -4, y: -4, cursor: 'nwse-resize' },
    { id: 'ne', x: width - 4, y: -4, cursor: 'nesw-resize' },
    { id: 'se', x: width - 4, y: height - 4, cursor: 'nwse-resize' },
    { id: 'sw', x: -4, y: height - 4, cursor: 'nesw-resize' },
  ];
  return <g className={`canvas-node ${selected ? 'selected' : ''} ${connectorStart ? 'connector-start' : ''}`} data-node-id={node.id} transform={`translate(${position.x} ${position.y}) rotate(${node.rotation} ${width / 2} ${height / 2})`} onPointerDown={(event) => onPointerDown(event, node)} onDoubleClick={(event) => onDoubleClick(event, node)}>
    {shape}
    {labelNode}
    {showPorts && <g className="connection-ports">{ports.map((port) => <circle key={port.id} className="connection-port" data-port={port.id} cx={port.x} cy={port.y} r="5" onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, node, port.id); }} />)}</g>}
     {selected && <g className="node-handles" pointerEvents="all"><rect x={-5} y={-5} width={width + 10} height={height + 10} rx={node.style.radius + 3} fill="none" stroke="#a28fff" strokeWidth="1.5" strokeDasharray="4 3" pointerEvents="none" />{resizeHandles.map((handle) => <rect key={handle.id} className="handle" x={handle.x} y={handle.y} width="8" height="8" style={{ cursor: handle.cursor }} onPointerDown={(event) => onResizePointerDown(event, node, handle.id)} />)}</g>}
  </g>;
}
