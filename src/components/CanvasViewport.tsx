import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { createEdge, createId, createNode as buildNode } from '../core/document';
import { SHAPE_DRAG_MIME, parseShapeDrop } from '../core/shapeTransfer';
import type { ShapeDropPayload } from '../core/shapeTransfer';
import { connectionAnchorPoints as resolveConnectionAnchorPoints } from '../core/anchors';
import type { ResolvedConnectionAnchor } from '../core/anchors';
import { ERD_COLUMN_HEADER_HEIGHT, ERD_HEADER_HEIGHT, ERD_ROW_HEIGHT, entityColumns, entityFieldValue, normalizeEntityFields } from '../core/erd';
import { editorEvents } from '../core/events';
import { calculateRouteJumps, curvedPath, edgeRoute, jumpMaskPaths, pointsToPath } from '../core/routing';
import type { RouteJump } from '../core/routing';
import { getActivePage, useEditorStore } from '../store/editorStore';
import type { DiagramEdge, DiagramGuide, DiagramNode, EdgeMarker, Endpoint, GuideOrientation, Point, Size, Viewport } from '../core/types';
import { connectionOffset, nearestConnectionPort, nodeCenter, nodeConnectionPoint } from '../core/geometry';
import type { ConnectionPort } from '../core/geometry';
import { pluginManager } from '../plugins';
import { nodeToSpatialNode, snapNodes, SpatialWorkerClient, viewportBounds } from '../spatial';
import type { AlignmentGuide, SpatialNode } from '../spatial';

interface CanvasSize { width: number; height: number }
interface Marquee { start: Point; current: Point }
interface ConnectorAnchor { nodeId: string; port?: ConnectionPort; offset?: number }
type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';
interface ContextMenuState { x: number; y: number; target: { kind: 'canvas' | 'node' | 'edge'; id?: string } }
interface TextEditState { kind: 'node' | 'edge'; id: string; value: string }

interface DragSession {
  mode: 'drag' | 'pan' | 'marquee' | 'waypoint' | 'resize' | 'endpoint' | 'connector';
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
  connectorSource?: ConnectorAnchor;
}

interface EndpointPreview {
  edgeId: string;
  endpoint: 'source' | 'target';
  anchor: Endpoint;
  point: Point;
}

interface ConnectorDragPreview {
  source: ConnectorAnchor;
  start: Point;
  current: Point;
  target?: ResolvedConnectionAnchor;
}

interface ShapeDragPreview {
  payload: ShapeDropPayload;
  point: Point;
}

interface GuideDrag {
  id: string;
  orientation: GuideOrientation;
  pointerId: number;
  initialPosition: number;
  isNew: boolean;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const ENDPOINT_SNAP_DISTANCE = 24;

interface RulerMark {
  value: number;
  screen: number;
  major: boolean;
}

function buildRulerMarks(size: CanvasSize, viewport: Viewport): { horizontal: RulerMark[]; vertical: RulerMark[] } {
  const step = viewport.zoom < 0.35 ? 500 : viewport.zoom < 0.75 ? 200 : 100;
  const build = (length: number, center: number, zoom: number) => {
    const start = center - length / 2 / zoom;
    const end = center + length / 2 / zoom;
    const first = Math.floor(start / step) * step;
    const marks: RulerMark[] = [];
    for (let value = first; value <= end + step; value += step) {
      const screen = length / 2 + (value - center) * zoom;
      if (screen >= 0 && screen <= length) marks.push({ value, screen, major: Math.abs(value / step) % 5 === 0 });
    }
    return marks;
  };
  return { horizontal: build(size.width, -viewport.x, viewport.zoom), vertical: build(size.height, -viewport.y, viewport.zoom) };
}

function asConnectionPort(value: string | null): ConnectionPort | undefined {
  if (value === 'top' || value === 'right' || value === 'bottom' || value === 'left' || value === 'center' || value === 'north' || value === 'east' || value === 'south' || value === 'west') return value;
  return undefined;
}

function distanceBetween(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
}

function shapeConnectionAnchorPoints(node: DiagramNode): ResolvedConnectionAnchor[] {
  return resolveConnectionAnchorPoints(node, pluginManager.getShape(node.library, node.type)?.anchors);
}

function nearestConnectionAnchor(nodes: DiagramNode[], point: Point, excludedNodeId?: string, maxDistance = ENDPOINT_SNAP_DISTANCE): ResolvedConnectionAnchor | null {
  let nearest: ResolvedConnectionAnchor | null = null;
  let nearestDistance = maxDistance;
  nodes.forEach((node) => {
    if (node.id === excludedNodeId || node.hidden) return;
    shapeConnectionAnchorPoints(node).forEach((candidate) => {
      const distance = distanceBetween(candidate.point, point);
      if (distance <= nearestDistance) {
        nearestDistance = distance;
        nearest = candidate;
      }
    });
  });
  return nearest;
}

function connectionDropAnchor(event: ReactPointerEvent<SVGSVGElement>, point: Point, nodes: DiagramNode[], sourceNodeId: string): ConnectorAnchor | null {
  const nearest = nearestConnectionAnchor(nodes, point, sourceNodeId);
  if (nearest) return nearest.anchor;
  const element = globalThis.document.elementFromPoint(event.clientX, event.clientY);
  const portElement = element?.closest?.('[data-connection-port]');
  const nodeElement = element?.closest?.('[data-node-id]');
  const nodeId = nodeElement?.getAttribute('data-node-id');
  if (!nodeId || nodeId === sourceNodeId) return null;
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.hidden) return null;
  const explicitPort = asConnectionPort(portElement?.getAttribute('data-connection-port') ?? null);
  const port = explicitPort ?? nearestConnectionPort(node, point);
  const rawOffset = portElement?.getAttribute('data-connection-offset');
  const explicitOffset = rawOffset ? Number(rawOffset) : undefined;
  const offset = explicitOffset !== undefined && Number.isFinite(explicitOffset)
    ? explicitOffset
    : explicitPort ? undefined : connectionOffset(node, point, port);
  return { nodeId, port, ...(offset === undefined ? {} : { offset }) };
}

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
  const [endpointPreview, setEndpointPreview] = useState<EndpointPreview | null>(null);
  const endpointPreviewRef = useRef<EndpointPreview | null>(null);
  const [connectorDragPreview, setConnectorDragPreview] = useState<ConnectorDragPreview | null>(null);
  const [shapeDragPreview, setShapeDragPreview] = useState<ShapeDragPreview | null>(null);
  const [resizePreview, setResizePreview] = useState<{ nodeId: string; position: Point; size: Size } | null>(null);
  const [guidePreview, setGuidePreview] = useState<DiagramGuide | null>(null);
  const [showCanvasHint, setShowCanvasHint] = useState(() => {
    try {
      return globalThis.localStorage?.getItem('aperglyph.canvas-hint-dismissed') !== 'true';
    } catch {
      return true;
    }
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const lastClickRef = useRef<{ kind: 'node' | 'edge'; id: string; time: number } | null>(null);
  const spatialClient = useMemo(() => new SpatialWorkerClient(), []);
  const indexedPageRef = useRef<string | null>(null);
  const indexedNodesRef = useRef(new Map<string, SpatialNode>());
  const spatialReadyRef = useRef(false);
  const spatialQueryRef = useRef(0);

  // Shape definitions are an external, HMR-aware catalog. Subscribing here
  // makes updated anchor resolvers visible without restarting the editor.
  useSyncExternalStore(pluginManager.subscribe, pluginManager.getSnapshot, pluginManager.getSnapshot);

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
  const duplicateSelection = useEditorStore((state) => state.duplicateSelection);
  const updateEdge = useEditorStore((state) => state.updateEdge);
  const updateNode = useEditorStore((state) => state.updateNode);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const updateViewport = useEditorStore((state) => state.updateViewport);
  const updateGuides = useEditorStore((state) => state.updateGuides);
  const guideDragRef = useRef<GuideDrag | null>(null);
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
    const selectedNodes = page.nodes.filter((node) => !node.hidden && selectedIds.includes(node.id));
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
  }, [textEdit?.kind, textEdit?.id]);

  useEffect(() => {
    if (activeTool !== 'connector') setConnectorStart(null);
  }, [activeTool]);

  useEffect(() => editorEvents.on('interaction:cancel', () => {
    const session = dragRef.current;
    const guideDrag = guideDragRef.current;
    if (session && svgRef.current?.hasPointerCapture(session.pointerId)) svgRef.current.releasePointerCapture(session.pointerId);
    if (guideDrag && svgRef.current?.hasPointerCapture(guideDrag.pointerId)) svgRef.current.releasePointerCapture(guideDrag.pointerId);
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (panFrameRef.current) cancelAnimationFrame(panFrameRef.current);
    frameRef.current = null;
    panFrameRef.current = null;
    pendingPanRef.current = null;
    isPanningRef.current = false;
    dragRef.current = null;
    endpointPreviewRef.current = null;
    setDragPreview({});
    setMarquee(null);
    setAlignmentGuides([]);
    setSnapCandidateIds([]);
    setConnectorStart(null);
    setConnectorDragPreview(null);
    setEndpointPreview(null);
    setWaypointPreview(null);
    setResizePreview(null);
    setGuidePreview(null);
    guideDragRef.current = null;
    setShapeDragPreview(null);
    setTextEdit(null);
    setContextMenu(null);
  }), []);

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

  const dismissCanvasHint = () => {
    if (!showCanvasHint) return;
    setShowCanvasHint(false);
    try {
      globalThis.localStorage?.setItem('aperglyph.canvas-hint-dismissed', 'true');
    } catch {
      // Some embedded contexts deny local storage; the in-memory dismissal is
      // still useful for the current editor session.
    }
  };

  const guidePositionFromEvent = (event: { clientX: number; clientY: number }, orientation: GuideOrientation) => {
    const point = worldPoint(event);
    return orientation === 'vertical' ? point.x : point.y;
  };

  const beginGuideDrag = (event: ReactPointerEvent<HTMLElement | SVGLineElement>, orientation: GuideOrientation, guide?: DiagramGuide) => {
    if (event.button !== 0 || guide?.locked) return;
    event.preventDefault();
    event.stopPropagation();
    const position = guide?.position ?? guidePositionFromEvent(event, orientation);
    guideDragRef.current = { id: guide?.id ?? createId('guide'), orientation, pointerId: event.pointerId, initialPosition: position, isNew: !guide };
    setGuidePreview({ id: guide?.id ?? guideDragRef.current.id, orientation, position, ...(guide?.locked ? { locked: true } : {}) });
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const updateGuideDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = guideDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    setGuidePreview({ id: drag.id, orientation: drag.orientation, position: guidePositionFromEvent(event, drag.orientation) });
    return true;
  };

  const finishGuideDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = guideDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    const position = guidePreview?.position ?? drag.initialPosition;
    const guides = (page?.guides ?? []).filter((guide) => guide.id !== drag.id);
    if (page && Math.abs(position) < 100000000) updateGuides([...guides, { id: drag.id, orientation: drag.orientation, position }], page.id, drag.isNew ? 'Add guide' : 'Move guide');
    setGuidePreview(null);
    guideDragRef.current = null;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    return true;
  };

  const removeGuide = (guideId: string) => {
    if (!page) return;
    const guide = page.guides?.find((candidate) => candidate.id === guideId);
    if (guide?.locked) return;
    updateGuides((page.guides ?? []).filter((candidate) => candidate.id !== guideId), page.id, 'Delete guide');
  };

  const toggleGuideLock = (guideId: string) => {
    if (!page) return;
    updateGuides((page.guides ?? []).map((guide) => guide.id === guideId ? { ...guide, locked: !guide.locked } : guide), page.id, 'Lock guide');
  };

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
        boundary: node.boundary,
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
      if (queryId === spatialQueryRef.current) setVisibleNodeIds(new Set(page.nodes.filter((node) => !node.hidden).map((node) => node.id)));
    }
  }, [page, size.height, size.width, spatialClient, viewport]);

  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    const nextNodes = page.nodes.filter((node) => !node.hidden).map((node) => nodeToSpatialNode(node.id, node.position, node.size));
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

  const createConnection = (sourceAnchor: ConnectorAnchor, targetAnchor: ConnectorAnchor): boolean => {
    if (!page || sourceAnchor.nodeId === targetAnchor.nodeId) return false;
    const sourceNode = page.nodes.find((candidate) => candidate.id === sourceAnchor.nodeId);
    const targetNode = page.nodes.find((candidate) => candidate.id === targetAnchor.nodeId);
    if (!sourceNode || !targetNode) return false;
    const sourcePort = sourceAnchor.port ?? nearestConnectionPort(sourceNode, nodeCenter(targetNode));
    const targetPort = targetAnchor.port ?? nearestConnectionPort(targetNode, nodeCenter(sourceNode));
    const source = { nodeId: sourceNode.id, port: sourcePort, ...(sourceAnchor.offset === undefined ? {} : { offset: sourceAnchor.offset }) };
    const target = { nodeId: targetNode.id, port: targetPort, ...(targetAnchor.offset === undefined ? {} : { offset: targetAnchor.offset }) };
    const edgeOptions = document.diagramType === 'erd'
      ? { type: 'orthogonal' as const, style: { startMarker: 'bar' as const, endMarker: 'crowfoot' as const } }
      : document.diagramType === 'dfd'
        ? { type: 'orthogonal' as const }
        : undefined;
    createConnector(createEdge(source, target, edgeOptions));
    return true;
  };

  const dropPosition = (point: Point, shapeSize: Size): Point => {
    const raw = { x: point.x - shapeSize.width / 2, y: point.y - shapeSize.height / 2 };
    if (!page?.settings.snapToGrid) return raw;
    const gridSize = page.settings.gridSize;
    return { x: Math.round(raw.x / gridSize) * gridSize, y: Math.round(raw.y / gridSize) * gridSize };
  };

  const handleShapeDragOver = (event: ReactDragEvent<SVGSVGElement>) => {
    const payload = parseShapeDrop(event.dataTransfer);
    if (!payload && !Array.from(event.dataTransfer.types).includes(SHAPE_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setShapeDragPreview({ payload: payload ?? { libraryId: 'general', type: 'rectangle', label: 'Drop shape', defaultSize: { width: 180, height: 88 } }, point: worldPoint(event) });
  };

  const handleShapeDrop = (event: ReactDragEvent<SVGSVGElement>) => {
    const payload = parseShapeDrop(event.dataTransfer);
    if (!payload) return;
    event.preventDefault();
    const point = worldPoint(event);
    const shapeSize = payload.defaultSize ?? { width: 180, height: 88 };
    const position = dropPosition(point, shapeSize);
    const node = buildNode(payload.type, position, {
      library: payload.libraryId,
      size: payload.defaultSize,
      boundary: payload.boundary,
      style: payload.defaultStyle,
      data: payload.defaultData ?? { label: payload.label },
    });
    addNode(node);
    setShapeDragPreview(null);
    setTool('select');
  };

  const beginResizeInteraction = (event: ReactPointerEvent<SVGRectElement>, node: DiagramNode, handle: ResizeHandle) => {
    if (activeTool !== 'select' || spacePressed || event.button === 1 || node.locked) return;
    event.preventDefault();
    event.stopPropagation();
    dismissCanvasHint();
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

  const beginNodeInteraction = (event: ReactPointerEvent<SVGElement>, node: DiagramNode, port?: ConnectionPort, offset?: number) => {
    event.preventDefault();
    event.stopPropagation();
    dismissCanvasHint();
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

    if (port !== undefined && (activeTool === 'select' || activeTool === 'connector')) {
      const anchor = { nodeId: node.id, port, ...(offset === undefined ? {} : { offset }) } satisfies ConnectorAnchor;
      if (activeTool === 'connector' && connectorStart) {
        if (connectorStart.nodeId !== node.id) {
          createConnection(connectorStart, anchor);
          setConnectorStart(null);
          setConnectorDragPreview(null);
          dragRef.current = null;
        }
        return;
      }
      if (activeTool === 'select') setSelection([node.id], node.id);
      setConnectorStart(anchor);
      const point = worldPoint(event);
      const startPoint = nodeConnectionPoint(node, point, port, offset);
      dragRef.current = {
        mode: 'connector',
        pointerId: event.pointerId,
        startWorld: point,
        startClient: screenPoint(event),
        connectorSource: anchor,
      };
      setConnectorDragPreview({ source: anchor, start: startPoint, current: startPoint });
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (activeTool === 'connector') {
      const anchor = { nodeId: node.id, port, ...(offset === undefined ? {} : { offset }) } satisfies ConnectorAnchor;
      if (!connectorStart) {
        setConnectorStart(anchor);
      } else if (connectorStart.nodeId !== node.id) {
        createConnection(connectorStart, anchor);
        setConnectorStart(null);
      }
      return;
    }
    if (activeTool !== 'select') {
      setSelection([node.id], node.id);
      return;
    }

    const now = Date.now();
    if (event.button === 0 && !event.shiftKey && !event.altKey && lastClickRef.current?.kind === 'node' && lastClickRef.current.id === node.id && now - lastClickRef.current.time < 350) {
      lastClickRef.current = null;
      dragRef.current = null;
      beginTextEdit('node', node.id);
      return;
    }
    if (event.button === 0 && !event.shiftKey && !event.altKey) lastClickRef.current = { kind: 'node', id: node.id, time: now };

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
    let dragSelection = nextSelection.length ? nextSelection : [node.id];
    let dragPage = page;
    if (event.button === 0 && event.altKey) {
      duplicateSelection({ x: 0, y: 0 });
      const state = useEditorStore.getState();
      dragSelection = state.selectedIds;
      dragPage = getActivePage(state.document, state.activePageId);
    }
    const positions = Object.fromEntries(dragSelection.map((id) => {
      const current = dragPage?.nodes.find((candidate) => candidate.id === id);
      return [id, current ? { ...current.position } : { x: 0, y: 0 }];
    }));
    const point = worldPoint(event);
    const session: DragSession = { mode: 'drag', pointerId: event.pointerId, startWorld: point, startClient: screenPoint(event), initialPositions: positions };
    dragRef.current = session;
    setAlignmentGuides([]);
    setSnapCandidateIds([]);
    const selectedNodes = dragPage?.nodes.filter((candidate) => dragSelection.includes(candidate.id)) ?? [];
    if (selectedNodes.length > 0) {
      const minX = Math.min(...selectedNodes.map((candidate) => candidate.position.x));
      const minY = Math.min(...selectedNodes.map((candidate) => candidate.position.y));
      const maxX = Math.max(...selectedNodes.map((candidate) => candidate.position.x + candidate.size.width));
      const maxY = Math.max(...selectedNodes.map((candidate) => candidate.position.y + candidate.size.height));
      const radius = Math.max(500, Math.max(maxX - minX, maxY - minY) + 320);
      void spatialClient.queryNearby((minX + maxX) / 2, (minY + maxY) / 2, radius).then((ids) => {
        if (dragRef.current !== session) return;
         const fallbackIds = dragPage?.nodes.filter((candidate) => !dragSelection.includes(candidate.id)).map((candidate) => candidate.id) ?? [];
        setSnapCandidateIds(ids.length > 0 ? ids : fallbackIds);
      }).catch(() => {
        if (dragRef.current === session) setSnapCandidateIds(dragPage?.nodes.filter((candidate) => !dragSelection.includes(candidate.id)).map((candidate) => candidate.id) ?? []);
      });
    }
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const beginEdgeInteraction = (event: ReactPointerEvent<SVGGElement>, edge: DiagramEdge) => {
    dismissCanvasHint();
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
    dismissCanvasHint();
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
    dismissCanvasHint();
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
    const preview: EndpointPreview = { edgeId: edge.id, endpoint, anchor: { ...edge[endpoint] }, point: { ...point } };
    endpointPreviewRef.current = preview;
    setEndpointPreview(preview);
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const updateEndpointPreview = (session: DragSession, point: Point) => {
    if (!session.edgeId || !session.endpoint || !page) return;
    const edge = page.edges.find((candidate) => candidate.id === session.edgeId);
    if (!edge) return;
    const oppositeNodeId = session.endpoint === 'source' ? edge.target.nodeId : edge.source.nodeId;
    const nearest = nearestConnectionAnchor(page.nodes, point, oppositeNodeId);
    if (nearest) {
      const preview: EndpointPreview = { edgeId: edge.id, endpoint: session.endpoint, anchor: nearest.anchor, point: nearest.point };
      endpointPreviewRef.current = preview;
      setEndpointPreview(preview);
      return;
    }
    const candidate = page.nodes
      .filter((node) => !node.hidden && (!oppositeNodeId || node.id !== oppositeNodeId))
      .filter((node) => point.x >= node.position.x - ENDPOINT_SNAP_DISTANCE && point.x <= node.position.x + node.size.width + ENDPOINT_SNAP_DISTANCE && point.y >= node.position.y - ENDPOINT_SNAP_DISTANCE && point.y <= node.position.y + node.size.height + ENDPOINT_SNAP_DISTANCE)
      .sort((left, right) => (right.zIndex ?? 0) - (left.zIndex ?? 0))[0]
    if (candidate) {
      const port = nearestConnectionPort(candidate, point);
      const offset = connectionOffset(candidate, point, port);
      const anchor = { nodeId: candidate.id, port, ...(offset === undefined ? {} : { offset }) };
      const preview: EndpointPreview = { edgeId: edge.id, endpoint: session.endpoint, anchor, point: nodeConnectionPoint(candidate, point, port, offset) };
      endpointPreviewRef.current = preview;
      setEndpointPreview(preview);
      return;
    }
    const preview: EndpointPreview = { edgeId: edge.id, endpoint: session.endpoint, anchor: { nodeId: undefined, port: undefined, point: { ...point } }, point: { ...point } };
    endpointPreviewRef.current = preview;
    setEndpointPreview(preview);
  };

  const beginCanvasInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    setContextMenu(null);
    dismissCanvasHint();
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
    if (updateGuideDrag(event)) return;
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
    if (session.mode === 'connector' && connectorDragPreview) {
      const snapped = page ? nearestConnectionAnchor(page.nodes, point, session.connectorSource?.nodeId) : null;
      setConnectorDragPreview({ ...connectorDragPreview, current: snapped?.point ?? point, target: snapped ?? undefined });
    } else if (session.mode === 'endpoint') {
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
      if (event.shiftKey) {
        const ratio = initialSize.width / Math.max(1, initialSize.height);
        let width = right - left;
        let height = bottom - top;
        if (width / Math.max(1, initialSize.width) >= height / Math.max(1, initialSize.height)) {
          width = Math.max(minWidth, width);
          height = Math.max(minHeight, width / ratio);
        } else {
          height = Math.max(minHeight, height);
          width = Math.max(minWidth, height * ratio);
        }
        if (session.resizeHandle.includes('w')) left = initialRight - width;
        else right = position.x + width;
        if (session.resizeHandle.includes('n')) top = initialBottom - height;
        else bottom = position.y + height;
      }
      setResizePreview({ nodeId: session.nodeId, position: { x: left, y: top }, size: { width: right - left, height: bottom - top } });
    } else if (session.mode === 'waypoint' && session.edgeId && session.waypointIndex !== undefined) {
      const gridSize = page?.settings.gridSize ?? 16;
      const nextPoint = page?.settings.snapToGrid ? { x: Math.round(point.x / gridSize) * gridSize, y: Math.round(point.y / gridSize) * gridSize } : point;
      setWaypointPreview({ edgeId: session.edgeId, index: session.waypointIndex, point: nextPoint });
    } else if (session.mode === 'drag' && session.initialPositions) {
      const rawDelta = { x: point.x - session.startWorld.x, y: point.y - session.startWorld.y };
      const delta = event.shiftKey
        ? Math.abs(rawDelta.x) >= Math.abs(rawDelta.y) ? { x: rawDelta.x, y: 0 } : { x: 0, y: rawDelta.y }
        : rawDelta;
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
    if (finishGuideDrag(event)) return;
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
    } else if (session.mode === 'connector' && session.connectorSource) {
      const moved = distanceBetween(screenPoint(event), session.startClient) > 5;
      if (moved) {
        const point = worldPoint(event);
        const target = page ? connectionDropAnchor(event, point, page.nodes, session.connectorSource.nodeId) : null;
        if (target) createConnection(session.connectorSource, target);
        setConnectorStart(null);
      } else if (activeTool !== 'connector') {
        setConnectorStart(null);
      }
      setConnectorDragPreview(null);
    } else if (session.mode === 'resize') {
      const nodeId = session.nodeId;
      const preview = resizePreview;
      if (nodeId && preview?.nodeId === nodeId) {
        updateNode(nodeId, { position: preview.position, size: preview.size }, 'Resize node');
        setResizePreview(null);
      }
    } else if (session.mode === 'endpoint' && session.edgeId && session.endpoint && endpointPreviewRef.current?.edgeId === session.edgeId && endpointPreviewRef.current.endpoint === session.endpoint) {
      const edge = page?.edges.find((candidate) => candidate.id === session.edgeId);
      const preview = endpointPreviewRef.current;
      if (edge && preview && !sameEndpoint(edge[session.endpoint], preview.anchor)) {
        const changes = session.endpoint === 'source'
          ? { source: preview.anchor }
          : { target: preview.anchor };
        updateEdge(edge.id, { ...changes, ...(edge[session.endpoint].nodeId !== preview.anchor.nodeId ? { waypoints: [] } : {}) }, `Move ${session.endpoint} endpoint`);
      }
      endpointPreviewRef.current = null;
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
      const ids = page.nodes.filter((node) => !node.hidden).filter((node) => {
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

  const renderedNodes = page?.nodes.filter((node) => !node.hidden && (!visibleNodeIds || visibleNodeIds.has(node.id))).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)) ?? [];
  const nodeMap = useMemo(() => new Map((page?.nodes ?? []).map((node) => {
    const moved = dragPreview[node.id] ? { ...node, position: dragPreview[node.id] } : node;
    return [node.id, resizePreview?.nodeId === node.id ? { ...moved, position: resizePreview.position, size: resizePreview.size } : moved] as const;
  })), [dragPreview, page?.nodes, resizePreview]);
  const renderedEdges = page?.edges.filter((edge) => !visibleNodeIds || !edge.source.nodeId || !edge.target.nodeId || visibleNodeIds.has(edge.source.nodeId) || visibleNodeIds.has(edge.target.nodeId)) ?? [];
  const connectionTarget = connectorDragPreview?.target
    ? { nodeId: connectorDragPreview.target.anchor.nodeId, point: connectorDragPreview.target.point }
    : endpointPreview?.anchor.nodeId
      ? { nodeId: endpointPreview.anchor.nodeId, point: endpointPreview.point }
      : null;
  const routeEntries = useMemo(() => renderedEdges.map((edge) => {
    const source = edge.source.nodeId ? nodeMap.get(edge.source.nodeId) : undefined;
    const target = edge.target.nodeId ? nodeMap.get(edge.target.nodeId) : undefined;
    return { id: edge.id, points: edgeRoute(edge, source, target, [...nodeMap.values()]) };
  }), [nodeMap, renderedEdges]);
  const edgeRoutes = useMemo(() => new Map(routeEntries.map((entry) => [entry.id, entry.points])), [routeEntries]);
  const edgeJumps = useMemo(() => calculateRouteJumps(routeEntries.filter((entry) => renderedEdges.some((edge) => edge.id === entry.id && edge.type === 'orthogonal'))), [renderedEdges, routeEntries]);
  const editBox = useMemo(() => {
    if (!textEdit || !page) return null;
    if (textEdit.kind === 'node') {
      const node = nodeMap.get(textEdit.id);
      if (!node) return null;
      const width = Math.max(110, Math.min(360, node.size.width * viewport.zoom));
      const isEntity = node.type === 'entity';
      const isBoundary = node.type === 'boundary';
      const localAnchor = {
        x: node.position.x + (isBoundary ? 18 : node.size.width / 2),
        y: node.position.y + (isEntity ? ERD_HEADER_HEIGHT - 11 : isBoundary ? 27 : node.type === 'actor' ? node.size.height - 10 : node.size.height / 2 + 5),
      };
      const anchor = rotatePoint(localAnchor, nodeCenter(node), node.rotation);
      const anchorScreen = {
        x: size.width / 2 + (anchor.x + viewport.x) * viewport.zoom,
        y: size.height / 2 + (anchor.y + viewport.y) * viewport.zoom,
      };
      return {
        left: anchorScreen.x - (isBoundary ? 0 : width / 2),
        top: anchorScreen.y - 20,
        width,
        textAlign: isBoundary ? 'left' as const : 'center' as const,
      };
    }
    const edge = page.edges.find((candidate) => candidate.id === textEdit.id);
    const source = edge?.source.nodeId ? nodeMap.get(edge.source.nodeId) : undefined;
    const target = edge?.target.nodeId ? nodeMap.get(edge.target.nodeId) : undefined;
    if (!edge) return null;
    const route = edgeRoute(edge, source, target, [...nodeMap.values()]);
    if (route.length < 2) return null;
    const start = route[0];
    const end = route.at(-1) ?? start;
    const point = route.length === 2 ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : route[Math.floor(route.length / 2)] ?? start;
     return { left: size.width / 2 + (point.x + viewport.x) * viewport.zoom - 80, top: size.height / 2 + (point.y + viewport.y) * viewport.zoom - 15, width: 160, textAlign: 'center' as const };
  }, [nodeMap, page, size.height, size.width, textEdit, viewport]);
  const shapePreview = shapeDragPreview
    ? (() => {
      const shapeSize = shapeDragPreview.payload.defaultSize ?? { width: 180, height: 88 };
      const position = dropPosition(shapeDragPreview.point, shapeSize);
      return { ...shapeSize, position, label: shapeDragPreview.payload.label };
    })()
    : null;
  const rulerMarks = buildRulerMarks(size, viewport);
  const minimapWidth = 180;
  const minimapHeight = 112;
  const minimapPageWidth = page?.settings.width ?? 1600;
  const minimapPageHeight = page?.settings.height ?? 1000;
  const minimapScale = Math.min((minimapWidth - 12) / minimapPageWidth, (minimapHeight - 12) / minimapPageHeight);
  const minimapOffset = { x: (minimapWidth - minimapPageWidth * minimapScale) / 2, y: (minimapHeight - minimapPageHeight * minimapScale) / 2 };
  const minimapPoint = (point: Point) => ({ x: minimapOffset.x + (point.x + minimapPageWidth / 2) * minimapScale, y: minimapOffset.y + (point.y + minimapPageHeight / 2) * minimapScale });
  const visibleWorld = { x: -viewport.x - size.width / 2 / viewport.zoom, y: -viewport.y - size.height / 2 / viewport.zoom, width: size.width / viewport.zoom, height: size.height / viewport.zoom };
  const minimapViewport = minimapPoint(visibleWorld);

  return <div className={`canvas-stage ${activeTool === 'pan' || spacePressed ? 'pan-mode' : ''} ${activeTool === 'connector' ? 'connector-mode' : ''}`} ref={stageRef}>
     {showCanvasHint && <div className="canvas-hint"><span className="hint-key">Hold Space</span> + drag to pan <span className="hint-separator">·</span> <span className="hint-key">Scroll</span> to zoom</div>}
     <div className="canvas-ruler canvas-ruler-top" aria-label="Horizontal ruler" onPointerDown={(event) => beginGuideDrag(event, 'vertical')}>{rulerMarks.horizontal.map((mark) => <span key={mark.value} className={mark.major ? 'ruler-mark major' : 'ruler-mark'} style={{ left: mark.screen }}><i />{mark.major && mark.value}</span>)}</div>
     <div className="canvas-ruler canvas-ruler-left" aria-label="Vertical ruler" onPointerDown={(event) => beginGuideDrag(event, 'horizontal')}>{rulerMarks.vertical.map((mark) => <span key={mark.value} className={mark.major ? 'ruler-mark major' : 'ruler-mark'} style={{ top: mark.screen }}><i />{mark.major && mark.value}</span>)}</div>
    <svg ref={svgRef} className="diagram-canvas" width={size.width} height={size.height} onPointerDown={beginCanvasInteraction} onPointerMove={handlePointerMove} onPointerUp={finishPointerInteraction} onPointerCancel={finishPointerInteraction} onWheel={handleWheel} onContextMenu={handleContextMenu} onDragOver={handleShapeDragOver} onDrop={handleShapeDrop} onDragLeave={(event) => { if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) setShapeDragPreview(null); }}>
      <defs>
        <pattern id={gridId} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse"><path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="#2c3346" strokeWidth="0.7" opacity="0.62" /></pattern>
        <marker id="arrow-end" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 z" fill="#8a92ab" /></marker>
        <marker id="arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M8,0 L0,4 L8,8 z" fill="#8a92ab" /></marker>
        <marker id="arrow-end-active" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 z" fill="#9c86ff" /></marker>
      </defs>
      <rect className="canvas-background" width={size.width} height={size.height} fill="#0f121a" />
       <g transform={transform}>
         <rect x={-10000} y={-10000} width={20000} height={20000} fill={page?.settings.gridVisible ? `url(#${gridId})` : '#10131c'} />
         {shapePreview && <g className="shape-drop-preview" transform={`translate(${shapePreview.position.x} ${shapePreview.position.y})`} pointerEvents="none"><rect width={shapePreview.width} height={shapePreview.height} rx="8" /><text x={shapePreview.width / 2} y={shapePreview.height / 2 + 4} textAnchor="middle">{shapePreview.label}</text></g>}
         {connectorDragPreview && <path className="connector-drag-preview" d={`M ${connectorDragPreview.start.x} ${connectorDragPreview.start.y} L ${connectorDragPreview.current.x} ${connectorDragPreview.current.y}`} fill="none" />}
         <g className="guide-layer">{(page?.guides ?? []).map((guide) => guide.orientation === 'vertical'
           ? <line key={guide.id} className={`canvas-guide ${guide.locked ? 'locked' : ''}`} x1={guide.position} y1={-minimapPageHeight / 2} x2={guide.position} y2={minimapPageHeight / 2} onPointerDown={(event) => beginGuideDrag(event, 'vertical', guide)} onDoubleClick={() => removeGuide(guide.id)} />
           : <line key={guide.id} className={`canvas-guide ${guide.locked ? 'locked' : ''}`} x1={-minimapPageWidth / 2} y1={guide.position} x2={minimapPageWidth / 2} y2={guide.position} onPointerDown={(event) => beginGuideDrag(event, 'horizontal', guide)} onDoubleClick={() => removeGuide(guide.id)} />)}{guidePreview && (guidePreview.orientation === 'vertical'
           ? <line className="canvas-guide preview" x1={guidePreview.position} y1={-minimapPageHeight} x2={guidePreview.position} y2={minimapPageHeight} />
           : <line className="canvas-guide preview" x1={-minimapPageWidth} y1={guidePreview.position} x2={minimapPageWidth} y2={guidePreview.position} />)}</g>
         <g className="edge-layer">{renderedEdges.map((edge) => {
          const previewEdge = endpointPreview?.edgeId === edge.id ? { ...edge, [endpointPreview.endpoint]: endpointPreview.anchor } as DiagramEdge : edge;
          const previewWaypoints = waypointPreview?.edgeId === edge.id
            ? (() => { const next = previewEdge.waypoints.slice(); if (waypointPreview.index < next.length) next[waypointPreview.index] = waypointPreview.point; else next.splice(Math.min(waypointPreview.index, next.length), 0, waypointPreview.point); return next; })()
            : previewEdge.waypoints;
          const preview = waypointPreview?.edgeId === edge.id ? { ...previewEdge, waypoints: previewWaypoints } : previewEdge;
          const isPreview = endpointPreview?.edgeId === edge.id || waypointPreview?.edgeId === edge.id;
          return <EdgeView key={edge.id} edge={preview} source={preview.source.nodeId ? nodeMap.get(preview.source.nodeId) : undefined} target={preview.target.nodeId ? nodeMap.get(preview.target.nodeId) : undefined} obstacles={[...nodeMap.values()]} route={isPreview ? undefined : edgeRoutes.get(edge.id)} jumps={isPreview ? [] : edgeJumps.get(edge.id) ?? []} background={page?.settings.background ?? '#10131c'} selected={selectedIds.includes(edge.id)} onPointerDown={beginEdgeInteraction} onDoubleClick={(event, selectedEdge) => beginTextEdit('edge', selectedEdge.id)} onWaypointPointerDown={beginWaypointInteraction} />;
        })}</g>
         <g className="node-layer">{renderedNodes.map((node) => { const previewNode = nodeMap.get(node.id) ?? node; return <NodeView key={node.id} node={previewNode} position={previewNode.position} selected={selectedIds.includes(node.id)} connectorStart={connectorStart?.nodeId === node.id} connectorTarget={connectionTarget?.nodeId === node.id} showPorts={activeTool === 'connector' || selectedIds.includes(node.id)} diagramType={document.diagramType} onPointerDown={beginNodeInteraction} onResizePointerDown={beginResizeInteraction} onDoubleClick={(event, selectedNode) => beginTextEdit('node', selectedNode.id)} />; })}</g>
         {connectionTarget && <g className="connection-target-preview" pointerEvents="none"><circle cx={connectionTarget.point.x} cy={connectionTarget.point.y} r="10" /><circle cx={connectionTarget.point.x} cy={connectionTarget.point.y} r="4" /></g>}
         <g className="edge-marker-layer">{renderedEdges.map((edge) => {
           const previewEdge = endpointPreview?.edgeId === edge.id ? { ...edge, [endpointPreview.endpoint]: endpointPreview.anchor } as DiagramEdge : edge;
           return <EdgeMarkersView key={`markers-${edge.id}`} edge={previewEdge} source={previewEdge.source.nodeId ? nodeMap.get(previewEdge.source.nodeId) : undefined} target={previewEdge.target.nodeId ? nodeMap.get(previewEdge.target.nodeId) : undefined} obstacles={[...nodeMap.values()]} markerFill={page?.settings.background ?? '#10131c'} />;
         })}</g>
         <g className="edge-endpoint-layer">{renderedEdges.map((edge) => {
           const previewEdge = endpointPreview?.edgeId === edge.id ? { ...edge, [endpointPreview.endpoint]: endpointPreview.anchor } as DiagramEdge : edge;
           return <EdgeEndpointHandles key={`handles-${edge.id}`} edge={previewEdge} source={previewEdge.source.nodeId ? nodeMap.get(previewEdge.source.nodeId) : undefined} target={previewEdge.target.nodeId ? nodeMap.get(previewEdge.target.nodeId) : undefined} obstacles={[...nodeMap.values()]} selected={selectedIds.includes(edge.id)} onPointerDown={beginEndpointInteraction} />;
         })}</g>
        <g className="alignment-guide-layer">{alignmentGuides.map((guide, index) => guide.orientation === 'vertical'
          ? <line key={`vertical-${index}`} className="alignment-guide" x1={guide.position} y1={guide.start} x2={guide.position} y2={guide.end} />
          : <line key={`horizontal-${index}`} className="alignment-guide" x1={guide.start} y1={guide.position} x2={guide.end} y2={guide.position} />)}</g>
        {marqueeRect && <rect className="selection-marquee" x={marqueeRect.x} y={marqueeRect.y} width={marqueeRect.width} height={marqueeRect.height} />}
      </g>
    </svg>
     {editBox && textEdit && <input ref={textInputRef} className="canvas-text-editor" style={{ left: editBox.left, top: editBox.top, width: editBox.width, textAlign: editBox.textAlign }} value={textEdit.value} onChange={(event) => setTextEdit({ ...textEdit, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); commitTextEdit(); } if (event.key === 'Escape') { event.preventDefault(); setTextEdit(null); } }} onBlur={commitTextEdit} onPointerDown={(event) => event.stopPropagation()} aria-label="Edit diagram text" />}
     {contextMenu && <div className="canvas-context-menu" style={{ left: Math.min(contextMenu.x, Math.max(8, size.width - 178)), top: Math.min(contextMenu.y, Math.max(8, size.height - 170)) }} onPointerDown={(event) => event.stopPropagation()}>
      {contextMenu.target.kind !== 'canvas' && <button onClick={() => { if (contextMenu.target.kind !== 'canvas' && contextMenu.target.id) beginTextEdit(contextMenu.target.kind, contextMenu.target.id); }}>{contextMenu.target.kind === 'node' ? 'Edit text' : 'Edit label'}</button>}
      {contextMenu.target.kind !== 'canvas' && <button onClick={duplicateContextTarget}>Duplicate</button>}
      {contextMenu.target.kind !== 'canvas' && <button className="context-danger" onClick={deleteContextTarget}>Delete</button>}
       {contextMenu.target.kind === 'canvas' && <button onClick={() => { setSelection([]); setContextMenu(null); }}>Clear selection</button>}
     </div>}
     <div className="canvas-minimap" style={{ width: minimapWidth, height: minimapHeight }} onPointerDown={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); const x = ((event.clientX - rect.left - minimapOffset.x) / minimapScale) - minimapPageWidth / 2; const y = ((event.clientY - rect.top - minimapOffset.y) / minimapScale) - minimapPageHeight / 2; updateViewport({ x: -x, y: -y }); }} aria-label="Diagram minimap">
       <svg width={minimapWidth} height={minimapHeight} viewBox={`0 0 ${minimapWidth} ${minimapHeight}`}><rect className="minimap-page" x={minimapOffset.x} y={minimapOffset.y} width={minimapPageWidth * minimapScale} height={minimapPageHeight * minimapScale} />{(page?.nodes ?? []).filter((node) => !node.hidden).map((node) => { const point = minimapPoint(node.position); return <rect key={node.id} className={selectedIds.includes(node.id) ? 'minimap-node selected' : 'minimap-node'} x={point.x} y={point.y} width={Math.max(2, node.size.width * minimapScale)} height={Math.max(2, node.size.height * minimapScale)} />; })}<rect className="minimap-viewport" x={minimapViewport.x} y={minimapViewport.y} width={Math.max(2, visibleWorld.width * minimapScale)} height={Math.max(2, visibleWorld.height * minimapScale)} /></svg>
     </div>
     {(page?.guides?.length ?? 0) > 0 && <div className="guide-controls"><span>Guides</span>{page?.guides?.map((guide) => <div key={guide.id} className="guide-control"><i className={guide.orientation} /><button title={guide.locked ? 'Unlock guide' : 'Lock guide'} aria-label={guide.locked ? 'Unlock guide' : 'Lock guide'} onClick={() => toggleGuideLock(guide.id)}>{guide.locked ? <span>•</span> : <span>○</span>}</button><button title="Delete guide" aria-label="Delete guide" disabled={guide.locked} onClick={() => removeGuide(guide.id)}>×</button></div>)}</div>}
     <div className="canvas-coordinates">{Math.round(viewport.x)}, {Math.round(viewport.y)}</div>
  </div>;
}

function EdgeView({ edge, source, target, obstacles, route: providedRoute, jumps, background, selected, onPointerDown, onDoubleClick, onWaypointPointerDown }: { edge: DiagramEdge; source?: DiagramNode; target?: DiagramNode; obstacles: DiagramNode[]; route?: Point[]; jumps: RouteJump[]; background: string; selected: boolean; onPointerDown: (event: ReactPointerEvent<SVGGElement>, edge: DiagramEdge) => void; onDoubleClick: (event: ReactMouseEvent<SVGGElement>, edge: DiagramEdge) => void; onWaypointPointerDown: (event: ReactPointerEvent<SVGCircleElement>, edge: DiagramEdge, index: number, point: Point) => void }) {
  const route = providedRoute ?? edgeRoute(edge, source, target, obstacles);
  if (route.length < 2) return null;
  const start = route[0];
  const end = route[route.length - 1];
  const label = typeof edge.data?.label === 'string' ? edge.data.label : null;
  const labelPoint = route.length === 2 ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : route[Math.floor(route.length / 2)] ?? start;
  const startDirection = endpointDirection(start, route[1], source);
  const endDirection = endpointDirection(end, route.at(-2) ?? start, target);
  const curveStartDirection = source ? startDirection : { x: -startDirection.x, y: -startDirection.y };
  const curveEndDirection = target ? { x: -endDirection.x, y: -endDirection.y } : endDirection;
  const path = edge.type === 'curved' ? curvedPath(route, curveStartDirection, curveEndDirection) : pointsToPath(route, jumps);
  const masks = edge.type === 'orthogonal' ? jumpMaskPaths(route, jumps) : [];
  const waypointHandles = selected && edge.type === 'orthogonal'
    ? edge.waypoints.length > 0
      ? edge.waypoints.map((point, index) => <circle key={`waypoint-${index}`} className="edge-waypoint" cx={point.x} cy={point.y} r="5" onPointerDown={(event) => onWaypointPointerDown(event, edge, index, point)} />)
      : route.slice(1, -1).map((point, index) => <circle key={`auto-waypoint-${point.x}-${point.y}-${index}`} className="edge-waypoint auto" cx={point.x} cy={point.y} r="5" onPointerDown={(event) => onWaypointPointerDown(event, edge, index, point)} />)
    : null;
  return <g className={`canvas-edge ${selected ? 'selected' : ''}`} data-edge-id={edge.id} onPointerDown={(event) => onPointerDown(event, edge)} onDoubleClick={(event) => onDoubleClick(event, edge)}>
    <path className="edge-shadow" d={path} fill="none" stroke="#0a0c12" strokeWidth={edge.style.strokeWidth + 5} opacity="0.72" pointerEvents="none" />
    {selected && <path className="edge-selection" d={path} fill="none" stroke="#a28fff" strokeWidth={edge.style.strokeWidth + 5} opacity="0.22" pointerEvents="none" />}
    {masks.map((mask, index) => <path key={`jump-mask-${index}`} d={mask} fill="none" stroke={background} strokeWidth={edge.style.strokeWidth + 4} strokeLinecap="round" pointerEvents="none" />)}
    <path className="edge-visible" d={path} fill="none" stroke={edge.style.stroke} strokeWidth={edge.style.strokeWidth} strokeDasharray={edge.style.dash === 'dashed' ? '8 6' : edge.style.dash === 'dotted' ? '2 5' : undefined} pointerEvents="none" />
    <path className="edge-hit-area" d={path} fill="none" stroke="#ffffff" strokeOpacity="0" strokeWidth={Math.max(14, edge.style.strokeWidth + 8)} pointerEvents="stroke" />
    {waypointHandles}
    {label && <g className="edge-label-group" transform={`translate(${labelPoint.x} ${labelPoint.y})`} pointerEvents="none"><rect x={-28} y={-12} width={56} height={22} rx={11} fill="#171b28" stroke={selected ? '#7968c5' : '#3a4258'} /><text className="edge-label" textAnchor="middle" y="4">{label}</text></g>}
  </g>;
}

function EdgeMarkersView({ edge, source, target, obstacles, markerFill }: { edge: DiagramEdge; source?: DiagramNode; target?: DiagramNode; obstacles: DiagramNode[]; markerFill: string }) {
  const route = edgeRoute(edge, source, target, obstacles);
  if (route.length < 2) return null;
  const start = route[0];
  const end = route[route.length - 1];
  const startMarkerDirection = markerDirection(start, route[1], source);
  const endMarkerDirection = markerDirection(end, route.at(-2) ?? start, target);
  const startArrowDirection = markerArrowDirection(start, route[1]);
  const endArrowDirection = markerArrowDirection(end, route.at(-2) ?? start);
  return <>{renderEndpointMarker(start, edge.style.startMarker === 'arrow' ? startArrowDirection : startMarkerDirection, edge.style.startMarker, edge.style.stroke, markerFill, 'start')}{renderEndpointMarker(end, edge.style.endMarker === 'arrow' ? endArrowDirection : endMarkerDirection, edge.style.endMarker, edge.style.stroke, markerFill, 'end')}</>;
}

function EdgeEndpointHandles({ edge, source, target, obstacles, selected, onPointerDown }: { edge: DiagramEdge; source?: DiagramNode; target?: DiagramNode; obstacles: DiagramNode[]; selected: boolean; onPointerDown: (event: ReactPointerEvent<SVGCircleElement>, edge: DiagramEdge, endpoint: 'source' | 'target', point: Point) => void }) {
  if (!selected) return null;
  const route = edgeRoute(edge, source, target, obstacles);
  if (route.length < 2) return null;
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

function endpointDirection(point: Point, neighbor: Point, node?: DiagramNode): Point {
  return node ? outwardDirection(point, nodeCenter(node)) : { x: point.x - neighbor.x, y: point.y - neighbor.y };
}

function markerDirection(point: Point, neighbor: Point, node?: DiagramNode): Point {
  if (node) return endpointDirection(point, neighbor, node);
  return directionBetween(point, neighbor);
}

/** Arrowheads follow the actual connector tangent, including diagonal spans. */
function markerArrowDirection(point: Point, neighbor: Point): Point {
  return directionBetween(point, neighbor);
}

function directionBetween(from: Point, to: Point): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length > 0.001 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : { x: 1, y: 0 };
}

function directionAngle(direction: Point): number {
  const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
  return Math.abs(angle) === 180 ? 180 : angle;
}

function renderEndpointMarker(point: Point, direction: Point, marker: EdgeMarker, stroke: string, fill: string, key: string) {
  if (marker === 'none') return null;
  const angle = directionAngle(direction);
  const strokeWidth = 1.6;
  const lineProps = { fill: 'none', stroke, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  // The connector terminates at the shape boundary. The glyph's +X axis
  // extends back into the connector, keeping the notation outside the shape.
  const circle = (center = 6) => <circle cx={center} cy="0" r="6" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  const bar = (offset = 0) => <path d={`M ${offset} -7 L ${offset} 7`} {...lineProps} />;
  // +X points back into the connector. Keep combined notation ordered from
  // the connector toward the shape: bar/circle first, crowfoot last.
  const crowfoot = (junction = 11) => <path d={`M ${junction} 0 L 0 -7 M ${junction} 0 L 0 0 M ${junction} 0 L 0 7`} {...lineProps} />;
  const glyph = marker === 'arrow'
    ? <path d="M 0 0 L 10 -6 L 10 6 Z" fill={stroke} />
    : marker === 'bar' ? bar()
      : marker === 'circle' ? circle()
        : marker === 'crowfoot' ? crowfoot()
          : marker === 'circle-bar' ? <>{circle(18)}{bar()}</>
              : marker === 'bar-crowfoot' ? <>{bar(16)}{crowfoot()}</>
                : <>{circle(18)}{crowfoot()}</>;
  return <g key={key} className="edge-marker" transform={`translate(${point.x} ${point.y}) rotate(${angle})`} pointerEvents="none">{glyph}</g>;
}

function sameEndpoint(left: Endpoint, right: Endpoint): boolean {
  return left.nodeId === right.nodeId
    && left.port === right.port
    && left.offset === right.offset
    && left.point?.x === right.point?.x
    && left.point?.y === right.point?.y;
}

function shapeRenderer(node: DiagramNode, diagramType?: string): string {
  return pluginManager.getShape(node.library, node.type)?.renderer
    ?? (diagramType === 'dfd' && node.type === 'process' ? 'ellipse' : node.type);
}

function NodeView({ node, position, selected, connectorStart, connectorTarget, showPorts, diagramType, onPointerDown, onResizePointerDown, onDoubleClick }: { node: DiagramNode; position: Point; selected: boolean; connectorStart: boolean; connectorTarget: boolean; showPorts: boolean; diagramType: string; onPointerDown: (event: ReactPointerEvent<SVGElement>, node: DiagramNode, port?: ConnectionPort, offset?: number) => void; onResizePointerDown: (event: ReactPointerEvent<SVGRectElement>, node: DiagramNode, handle: ResizeHandle) => void; onDoubleClick: (event: ReactMouseEvent<SVGGElement>, node: DiagramNode) => void }) {
  const width = node.size.width;
  const height = node.size.height;
  const label = typeof node.data.label === 'string' ? node.data.label : node.type;
  const renderer = shapeRenderer(node, diagramType);
  const commonProps = { fill: node.style.fill, stroke: node.style.stroke, strokeWidth: node.style.strokeWidth, opacity: node.style.opacity };
  const shape = (() => {
    if (renderer === 'diamond' || renderer === 'decision') {
      const points = `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
      return <polygon points={points} {...commonProps} />;
    }
    if (renderer === 'ellipse' || renderer === 'circle' || renderer === 'use-case') return <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...commonProps} />;
    if (renderer === 'line') return <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} markerEnd="url(#arrow-end)" />;
    if (renderer === 'actor') return <g><circle cx={width / 2} cy={28} r={16} {...commonProps} /><path d={`M${width / 2} 44 L${width / 2} 91 M${width / 2 - 25} 60 L${width / 2 + 25} 60 M${width / 2} 91 L${width / 2 - 21} 124 M${width / 2} 91 L${width / 2 + 21} 124`} fill="none" stroke={node.style.stroke} strokeWidth="3" strokeLinecap="round" /></g>;
    if (renderer === 'database') return <path d={`M 0 ${height * .18} C 0 0 ${width} 0 ${width} ${height * .18} L ${width} ${height * .8} C ${width} ${height + height * .02} 0 ${height + height * .02} 0 ${height * .8} Z M 0 ${height * .18} C 0 ${height * .36} ${width} ${height * .36} ${width} ${height * .18}`} {...commonProps} />;
    if (renderer === 'stored-data') return <path d={`M 12 0 H ${width - 12} Q ${width} 0 ${width} 12 V ${height - 12} Q ${width} ${height} ${width - 12} ${height} H 12 Q 0 ${height} 0 ${height - 12} V 12 Q 0 0 12 0 Z`} {...commonProps} />;
    if (renderer === 'document') return <path d={`M 0 0 H ${width} V ${height - 16} Q ${width * .75} ${height} ${width * .5} ${height - 16} Q ${width * .25} ${height - 32} 0 ${height - 16} Z`} {...commonProps} />;
    if (renderer === 'manual-input') return <polygon points={`18,0 ${width},0 ${width - 18},${height} 0,${height}`} {...commonProps} />;
    if (renderer === 'preparation') return <polygon points={`24,0 ${width - 24},0 ${width},${height / 2} ${width - 24},${height} 24,${height} 0,${height / 2}`} {...commonProps} />;
    if (renderer === 'predefined-process') return <g><rect width={width} height={height} {...commonProps} /><line x1="16" y1="0" x2="16" y2={height} stroke={node.style.stroke} /><line x1={width - 16} y1="0" x2={width - 16} y2={height} stroke={node.style.stroke} /></g>;
    if (renderer === 'delay') return <path d={`M 0 0 H ${width - 28} A 28 ${height / 2} 0 0 1 ${width - 28} ${height} H 0 Z`} {...commonProps} />;
    if (renderer === 'display') return <path d={`M 0 0 H ${width - 28} Q ${width} ${height / 2} ${width - 28} ${height} H 0 Q 28 ${height / 2} 0 0 Z`} {...commonProps} />;
    if (renderer === 'off-page-connector') return <polygon points={`0,0 ${width},0 ${width},${height * .68} ${width / 2},${height} 0,${height * .68}`} {...commonProps} />;
    if (renderer === 'entity') {
      const fields = normalizeEntityFields(node.data.fields);
      const columns = entityColumns(node.data.entityVariant, width);
      const striped = node.data.striped !== false;
      const showColumnHeaders = node.data.columnHeaders === true;
      const rowFill = typeof node.data.rowFill === 'string' ? node.data.rowFill : node.style.fill;
      const stripeFill = typeof node.data.stripeFill === 'string' ? node.data.stripeFill : rowFill === '#f2f3f7' ? '#e3e5e9' : '#252c3c';
      const headerFill = typeof node.data.headerFill === 'string' ? node.data.headerFill : node.style.stroke;
      const textColor = node.style.textColor;
      const fieldTop = ERD_HEADER_HEIGHT + (showColumnHeaders ? ERD_COLUMN_HEADER_HEIGHT : 0);
      return <g>
        <rect width={width} height={height} rx={node.style.radius} fill={rowFill} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} strokeDasharray={node.data.associative ? '5 3' : undefined} opacity={node.style.opacity} />
        <rect width={width} height={ERD_HEADER_HEIGHT} rx={node.style.radius} fill={headerFill} opacity={node.style.opacity} />
        <line x1="0" y1={ERD_HEADER_HEIGHT} x2={width} y2={ERD_HEADER_HEIGHT} stroke={node.style.stroke} strokeWidth="1" />
        {showColumnHeaders && <g className="entity-column-headers"><rect y={ERD_HEADER_HEIGHT} width={width} height={ERD_COLUMN_HEADER_HEIGHT} fill={headerFill} opacity="0.42" /><line x1="0" y1={fieldTop} x2={width} y2={fieldTop} stroke={node.style.stroke} strokeOpacity="0.55" />{columns.map((column) => <text key={column.id} className="node-field-column-header" x={column.id === 'key' ? column.x + column.width / 2 : column.x + 7} y={ERD_HEADER_HEIGHT + 15} textAnchor={column.id === 'key' ? 'middle' : undefined}>{column.label}</text>)}</g>}
        {fields.map((field, index) => { const y = fieldTop + index * ERD_ROW_HEIGHT; return <g key={field.id}><rect x="0" y={y} width={width} height={ERD_ROW_HEIGHT} fill={striped && index % 2 === 1 ? stripeFill : rowFill} /><line x1="0" y1={y + ERD_ROW_HEIGHT} x2={width} y2={y + ERD_ROW_HEIGHT} stroke={node.style.stroke} strokeOpacity="0.34" />{columns.slice(0, -1).map((column) => <line key={`divider-${column.id}`} x1={column.x + column.width} y1={y} x2={column.x + column.width} y2={y + ERD_ROW_HEIGHT} stroke={node.style.stroke} strokeOpacity="0.45" />)}{columns.map((column) => { const value = entityFieldValue(field, column.id); if (!value) return null; const isKey = column.id === 'key'; return <text key={column.id} className={isKey ? 'node-field-key' : column.id === 'field' ? 'node-field-name' : 'node-field-type'} style={{ fill: textColor, textDecoration: column.id === 'field' && field.primaryKey ? 'underline' : undefined, fontStyle: column.id === 'field' && field.foreignKey ? 'italic' : undefined }} x={isKey ? column.x + column.width / 2 : column.x + 7} y={y + 18} textAnchor={isKey ? 'middle' : undefined}>{value}</text>; })}</g>; })}
        <text className="node-entity-title" style={{ fill: node.style.textColor === '#f4f5fa' ? '#ffffff' : textColor }} x={width / 2} y="23" textAnchor="middle">{label}</text>
      </g>;
    }
    if (renderer === 'dfd-store' || (diagramType === 'dfd' && renderer === 'store')) return <g><line x1="0" y1="10" x2={width} y2="10" stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} /><line x1="0" y1={height - 10} x2={width} y2={height - 10} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} /><text className="node-label" x={width / 2} y={height / 2 + 5}>{label}</text></g>;
    if (renderer === 'store') return <g><rect width={width} height={height} rx="4" {...commonProps} /><line x1="0" y1="12" x2={width} y2="12" stroke={node.style.stroke} opacity="0.5" /><text className="node-label" x={width / 2} y={height / 2 + 5}>{label}</text></g>;
    if (renderer === 'boundary') return <g><rect width={width} height={height} rx={node.style.radius} fill="none" stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} strokeDasharray="7 5" /><text className="boundary-label" x="18" y="27">{label}</text></g>;
    const radius = renderer === 'rounded-rectangle' || renderer === 'start' || renderer === 'use-case' ? Math.min(node.style.radius || 22, height / 2) : node.style.radius;
    return <rect width={width} height={height} rx={radius} {...commonProps} />;
  })();
  const labelNode = !['entity', 'actor', 'store', 'dfd-store', 'boundary', 'line'].includes(renderer) ? <text className={`node-label ${renderer === 'start' || renderer === 'use-case' ? 'node-label-strong' : ''}`} x={width / 2} y={height / 2 + 5}>{label}</text> : renderer === 'actor' ? <text className="node-label" x={width / 2} y={height - 10}>{label}</text> : null;
  const ports = shapeConnectionAnchorPoints(node).map(({ anchor, localPoint }) => ({
    id: anchor.id,
    port: anchor.port,
    offset: anchor.offset,
    x: localPoint.x - node.position.x,
    y: localPoint.y - node.position.y,
    fieldPort: anchor.id.startsWith('field-'),
  }));
  const resizeHandles: Array<{ id: ResizeHandle; x: number; y: number; cursor: string }> = [
    { id: 'nw', x: -4, y: -4, cursor: 'nwse-resize' },
    { id: 'ne', x: width - 4, y: -4, cursor: 'nesw-resize' },
    { id: 'se', x: width - 4, y: height - 4, cursor: 'nwse-resize' },
    { id: 'sw', x: -4, y: height - 4, cursor: 'nesw-resize' },
  ];
  return <g className={`canvas-node ${selected ? 'selected' : ''} ${connectorStart ? 'connector-start' : ''} ${connectorTarget ? 'connector-target' : ''}`} data-node-id={node.id} transform={`translate(${position.x} ${position.y}) rotate(${node.rotation} ${width / 2} ${height / 2})`} onPointerDown={(event) => onPointerDown(event, node)} onDoubleClick={(event) => onDoubleClick(event, node)}>
    {shape}
    {labelNode}
     {showPorts && <g className="connection-ports">{ports.map((port) => <circle key={port.id} className={port.fieldPort ? 'connection-port field-port' : 'connection-port'} data-port={port.id} data-connection-port={port.port} data-connection-offset={port.offset} cx={port.x} cy={port.y} r={port.fieldPort ? 4 : 5} onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, node, port.port, port.offset); }} />)}</g>}
     {selected && <g className="node-handles" pointerEvents="all"><rect x={-5} y={-5} width={width + 10} height={height + 10} rx={node.style.radius + 3} fill="none" stroke="#a28fff" strokeWidth="1.5" strokeDasharray="4 3" pointerEvents="none" />{resizeHandles.map((handle) => <rect key={handle.id} className="handle" x={handle.x} y={handle.y} width="8" height="8" style={{ cursor: handle.cursor }} onPointerDown={(event) => onResizePointerDown(event, node, handle.id)} />)}</g>}
  </g>;
}
