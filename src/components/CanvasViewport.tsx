import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { Lock, Ruler, Trash2, Unlock } from 'lucide-react';
import { createEdge, createId, createNode as buildNode } from '../core/document';
import { SHAPE_DRAG_MIME, parseShapeDrop } from '../core/shapeTransfer';
import type { ShapeDropPayload } from '../core/shapeTransfer';
import { connectionAnchorPoints as resolveConnectionAnchorPoints } from '../core/anchors';
import type { ResolvedConnectionAnchor } from '../core/anchors';
import { ERD_HEADER_HEIGHT, entityMinimumSize } from '../core/erd';
import { editorEvents } from '../core/events';
import { getSnapSettings } from '../core/snapping';
import { calculateRouteJumps, curvedPath, edgeRoute, edgeRouting, jumpMaskPaths, orthogonalRoutingMode, parallelEdgeOffset, parallelRoutingLane, pointsToPath } from '../core/routing';
import type { RouteJump } from '../core/routing';
import { getActivePage, useEditorStore } from '../store/editorStore';
import type { DiagramEdge, DiagramGuide, DiagramNode, EdgeMarker, Endpoint, GuideOrientation, Point, RouteConstraint, Size, Viewport } from '../core/types';
import { connectionOffset, nearestConnectionPort, nodeCenter, nodeConnectionPoint } from '../core/geometry';
import type { ConnectionPort } from '../core/geometry';
import { pluginManager } from '../plugins';
import { nodeToSpatialNode, snapDraggedNodes, SpatialWorkerClient, viewportBounds } from '../spatial';
import type { AlignmentGuide, SpatialNode } from '../spatial';
import { NodeGraphic } from './NodeGraphic';
import { ContextualToolbar } from './ContextualToolbar';

interface CanvasSize { width: number; height: number }
interface WorldBounds { x: number; y: number; width: number; height: number }
interface Marquee { start: Point; current: Point }
interface ConnectorAnchor { nodeId: string; port?: ConnectionPort; anchorId?: string; offset?: number }
type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';
interface ContextMenuState { x: number; y: number; target: { kind: 'canvas' | 'node' | 'edge'; id?: string } }
interface TextEditState { kind: 'node' | 'edge'; id: string; value: string }

interface DragSession {
  mode: 'drag' | 'pan' | 'marquee' | 'waypoint' | 'segment' | 'resize' | 'endpoint' | 'connector' | 'label';
  pointerId: number;
  startWorld: Point;
  startClient: Point;
  /** Alt starts a fine-positioning drag and keeps snapping disabled. */
  disableSnapping?: boolean;
  initialPositions?: Record<string, Point>;
  initialViewport?: Viewport;
  edgeId?: string;
  waypointIndex?: number;
  segmentIndex?: number;
  segmentAxis?: 'x' | 'y';
  initialSegmentValue?: number;
  nodeId?: string;
  resizeHandle?: ResizeHandle;
  initialNode?: { position: Point; size: Size };
  resizeMinimum?: Size;
  endpoint?: 'source' | 'target';
  connectorSource?: ConnectorAnchor;
  labelStart?: Point;
}

interface EndpointPreview {
  edgeId: string;
  endpoint: 'source' | 'target';
  anchor: Endpoint;
  point: Point;
}

interface SegmentPreview {
  edgeId: string;
  segmentIndex: number;
  axis: 'x' | 'y';
  value: number;
}

function edgeWithSegmentConstraint(edge: DiagramEdge, axis: 'x' | 'y', value: number, previousValue?: number): DiagramEdge {
  const routing = edge.routing ?? { mode: orthogonalRoutingMode(edge) };
  const constraints = (routing.constraints ?? []).filter((constraint) => !(constraint.axis === axis && (Math.abs(constraint.value - value) < 2 || (previousValue !== undefined && Math.abs(constraint.value - previousValue) < 2))));
  const nextConstraint: RouteConstraint = { axis, value, strength: 'hard' };
  return { ...edge, routing: { ...routing, mode: 'manual', constraints: [...constraints, nextConstraint] } };
}

interface ConnectorDragPreview {
  source: ConnectorAnchor;
  start: Point;
  current: Point;
  target?: ResolvedConnectionAnchor;
}

interface QuickCreateState {
  source: ConnectorAnchor;
  point: Point;
  screen: Point;
  disableSnapping: boolean;
}

interface ShapeDragPreview {
  payload: ShapeDropPayload;
  point: Point;
  disableSnapping: boolean;
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
const DOUBLE_CLICK_WINDOW_MS = 600;

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

function endpointPoint(endpoint: Endpoint, node: DiagramNode | undefined, toward?: Point): Point | undefined {
  if (node && endpoint.anchorId) {
    const anchor = shapeConnectionAnchorPoints(node).find((candidate) => candidate.anchor.id === endpoint.anchorId);
    if (anchor) return anchor.point;
  }
  if (node) return nodeConnectionPoint(node, toward ?? nodeCenter(node), endpoint.port, endpoint.offset);
  return endpoint.point;
}

function resizeGeometry(initial: { position: Point; size: Size }, handle: ResizeHandle, start: Point, current: Point, preserveAspect: boolean, minimum: Size = { width: 48, height: 32 }): { position: Point; size: Size } {
  const minWidth = Math.max(48, minimum.width);
  const minHeight = Math.max(32, minimum.height);
  const delta = { x: current.x - start.x, y: current.y - start.y };
  const initialRight = initial.position.x + initial.size.width;
  const initialBottom = initial.position.y + initial.size.height;
  let left = initial.position.x;
  let right = initialRight;
  let top = initial.position.y;
  let bottom = initialBottom;
  if (handle.includes('w')) left = Math.min(initialRight - minWidth, initial.position.x + delta.x);
  if (handle.includes('e')) right = Math.max(initial.position.x + minWidth, initialRight + delta.x);
  if (handle.includes('n')) top = Math.min(initialBottom - minHeight, initial.position.y + delta.y);
  if (handle.includes('s')) bottom = Math.max(initial.position.y + minHeight, initialBottom + delta.y);
  if (preserveAspect) {
    const ratio = initial.size.width / Math.max(1, initial.size.height);
    let width = right - left;
    let height = bottom - top;
    if (width / Math.max(1, initial.size.width) >= height / Math.max(1, initial.size.height)) {
      width = Math.max(minWidth, width);
      height = Math.max(minHeight, width / ratio);
      width = Math.max(minWidth, height * ratio);
    } else {
      height = Math.max(minHeight, height);
      width = Math.max(minWidth, height * ratio);
      height = Math.max(minHeight, width / ratio);
    }
    if (handle.includes('w')) left = initialRight - width;
    else right = initial.position.x + width;
    if (handle.includes('n')) top = initialBottom - height;
    else bottom = initial.position.y + height;
  }
  return { position: { x: left, y: top }, size: { width: right - left, height: bottom - top } };
}

function navigationBounds(nodes: DiagramNode[], edges: DiagramEdge[], visibleWorld: WorldBounds): WorldBounds {
  const points: Point[] = [
    { x: visibleWorld.x, y: visibleWorld.y },
    { x: visibleWorld.x + visibleWorld.width, y: visibleWorld.y + visibleWorld.height },
  ];
  nodes.filter((node) => !node.hidden).forEach((node) => {
    points.push(node.position, { x: node.position.x + node.size.width, y: node.position.y + node.size.height });
  });
  edges.forEach((edge) => {
    if (edge.source.point) points.push(edge.source.point);
    if (edge.target.point) points.push(edge.target.point);
    points.push(...edge.waypoints);
  });
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const padding = Math.max(96, Math.min(480, Math.max(contentWidth, contentHeight) * 0.12));
  const width = Math.max(640, contentWidth + padding * 2);
  const height = Math.max(420, contentHeight + padding * 2);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
}

function rotatedNodeBounds(node: DiagramNode): WorldBounds {
  const center = nodeCenter(node);
  const corners = [
    node.position,
    { x: node.position.x + node.size.width, y: node.position.y },
    { x: node.position.x + node.size.width, y: node.position.y + node.size.height },
    { x: node.position.x, y: node.position.y + node.size.height },
  ].map((point) => rotatePoint(point, center, node.rotation));
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function clampEntityNodeSize(node: DiagramNode): DiagramNode {
  if (node.type !== 'entity') return node;
  const minimum = entityMinimumSize(node.data.fields, node.data.entityVariant, node.data.columnHeaders === true);
  if (node.size.width >= minimum.width && node.size.height >= minimum.height) return node;
  return { ...node, size: { width: Math.max(node.size.width, minimum.width), height: Math.max(node.size.height, minimum.height) } };
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

function connectionDropAnchor(event: ReactPointerEvent<SVGSVGElement>, point: Point, nodes: DiagramNode[], sourceNodeId: string, snappingEnabled = true, maxDistance = ENDPOINT_SNAP_DISTANCE): ConnectorAnchor | null {
  const nearest = snappingEnabled ? nearestConnectionAnchor(nodes, point, sourceNodeId, maxDistance) : null;
  if (nearest) return { nodeId: nearest.anchor.nodeId, port: nearest.anchor.port, anchorId: nearest.anchor.id, ...(nearest.anchor.offset === undefined ? {} : { offset: nearest.anchor.offset }) };
  const element = globalThis.document.elementFromPoint(event.clientX, event.clientY);
  const portElement = element?.closest?.('[data-connection-port]');
  const nodeElement = element?.closest?.('[data-node-id]');
  const nodeId = nodeElement?.getAttribute('data-node-id');
  if (!nodeId || nodeId === sourceNodeId) return null;
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.hidden) return null;
  const explicitPort = asConnectionPort(portElement?.getAttribute('data-connection-port') ?? null);
  if (!snappingEnabled && !explicitPort) return null;
  const port = explicitPort ?? nearestConnectionPort(node, point);
  const rawOffset = portElement?.getAttribute('data-connection-offset');
  const explicitOffset = rawOffset ? Number(rawOffset) : undefined;
  const offset = explicitOffset !== undefined && Number.isFinite(explicitOffset)
    ? explicitOffset
    : explicitPort ? undefined : connectionOffset(node, point, port);
  const anchorId = portElement?.getAttribute('data-port') ?? undefined;
  return { nodeId, port, ...(anchorId ? { anchorId } : {}), ...(offset === undefined ? {} : { offset }) };
}

interface CanvasViewportProps {
  onImportFile?: (file: File, point: Point) => void | Promise<void>;
  view?: CanvasViewOptions;
}

interface CanvasViewOptions {
  rulers: boolean;
  guides: boolean;
  minimap: boolean;
  showPorts: boolean;
  connectionHints: boolean;
}

const DEFAULT_CANVAS_VIEW: CanvasViewOptions = { rulers: true, guides: true, minimap: true, showPorts: false, connectionHints: true };

export function CanvasViewport({ onImportFile, view = DEFAULT_CANVAS_VIEW }: CanvasViewportProps) {
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
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [waypointPreview, setWaypointPreview] = useState<{ edgeId: string; index: number; point: Point } | null>(null);
  const [segmentPreview, setSegmentPreview] = useState<SegmentPreview | null>(null);
  const [labelPreview, setLabelPreview] = useState<{ edgeId: string; point: Point } | null>(null);
  const [endpointPreview, setEndpointPreview] = useState<EndpointPreview | null>(null);
  const endpointPreviewRef = useRef<EndpointPreview | null>(null);
  const [connectorDragPreview, setConnectorDragPreview] = useState<ConnectorDragPreview | null>(null);
  const [quickCreate, setQuickCreate] = useState<QuickCreateState | null>(null);
  const [quickCreateSearch, setQuickCreateSearch] = useState('');
  const [shapeDragPreview, setShapeDragPreview] = useState<ShapeDragPreview | null>(null);
  const [resizePreview, setResizePreview] = useState<{ nodeId: string; position: Point; size: Size } | null>(null);
  const [guidePreview, setGuidePreview] = useState<DiagramGuide | null>(null);
  const [guidesOpen, setGuidesOpen] = useState(false);
  const [pointerWorld, setPointerWorld] = useState<Point | null>(null);
  const [showCanvasHint, setShowCanvasHint] = useState(() => {
    try {
      return globalThis.localStorage?.getItem('aperglyph.canvas-hint-dismissed') !== 'true';
    } catch {
      return true;
    }
  });
  const previousHintsPreference = useRef(view.connectionHints);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const lastClickRef = useRef<{ kind: 'node' | 'edge'; id: string; time: number } | null>(null);
  const spatialClient = useMemo(() => new SpatialWorkerClient(), []);
  const indexedPageRef = useRef<string | null>(null);
  const indexedNodesRef = useRef(new Map<string, SpatialNode>());
  const spatialReadyRef = useRef(false);
  const spatialQueryRef = useRef(0);
  const routeCacheRef = useRef(new Map<string, Point[]>());

  useEffect(() => {
    if (view.connectionHints && !previousHintsPreference.current) setShowCanvasHint(true);
    previousHintsPreference.current = view.connectionHints;
  }, [view.connectionHints]);

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
  const createNodeAndEdge = useEditorStore((state) => state.createNodeAndEdge);
  const setTool = useEditorStore((state) => state.setTool);
  const addEdge = useEditorStore((state) => state.createEdge);
  const duplicateSelection = useEditorStore((state) => state.duplicateSelection);
  const copySelection = useEditorStore((state) => state.copySelection);
  const cutSelection = useEditorStore((state) => state.cutSelection);
  const pasteClipboard = useEditorStore((state) => state.pasteClipboard);
  const selectAll = useEditorStore((state) => state.selectAll);
  const alignSelection = useEditorStore((state) => state.alignSelection);
  const distributeSelection = useEditorStore((state) => state.distributeSelection);
  const groupSelection = useEditorStore((state) => state.groupSelection);
  const ungroupSelection = useEditorStore((state) => state.ungroupSelection);
  const setZOrder = useEditorStore((state) => state.setZOrder);
  const updateNodes = useEditorStore((state) => state.updateNodes);
  const updateEdge = useEditorStore((state) => state.updateEdge);
  const resetEdge = useEditorStore((state) => state.resetEdge);
  const updateNode = useEditorStore((state) => state.updateNode);
  const formatPainter = useEditorStore((state) => state.formatPainter);
  const activateFormatPainter = useEditorStore((state) => state.activateFormatPainter);
  const clearFormatPainter = useEditorStore((state) => state.clearFormatPainter);
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

  useEffect(() => {
    if ((page?.nodes.length ?? 0) + (page?.edges.length ?? 0) > 0) setShowCanvasHint(false);
  }, [page?.edges.length, page?.nodes.length]);

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
    setQuickCreate(null);
    setQuickCreateSearch('');
    setEndpointPreview(null);
    setWaypointPreview(null);
    setSegmentPreview(null);
    setLabelPreview(null);
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
    if (menuTarget.id && !selectedIds.includes(menuTarget.id)) setSelection([menuTarget.id], menuTarget.id);
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
         container: node.container,
        style: { ...node.style },
        data: structuredClone(node.data),
      });
       copy.rotation = node.rotation;
       copy.zIndex = (node.zIndex ?? 0) + 1;
       if (node.containerId && page.nodes.some((candidate) => candidate.id === node.containerId && candidate.container)) copy.containerId = node.containerId;
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

  const toggleSelectedLock = () => {
    const nodes = page?.nodes.filter((node) => selectedIds.includes(node.id)) ?? [];
    if (nodes.length === 0) return;
    const locked = !nodes.every((node) => node.locked);
    updateNodes(nodes.map((node) => node.id), { locked }, locked ? 'Lock selection' : 'Unlock selection');
  };

  const toggleSelectedHidden = () => {
    const nodes = page?.nodes.filter((node) => selectedIds.includes(node.id)) ?? [];
    if (nodes.length === 0) return;
    const hidden = !nodes.every((node) => node.hidden);
    updateNodes(nodes.map((node) => node.id), { hidden }, hidden ? 'Hide selection' : 'Show selection');
  };

  const selectConnected = (nodeId: string) => {
    if (!page) return;
    const ids = new Set<string>([nodeId]);
    page.edges.forEach((edge) => {
      if (edge.source.nodeId === nodeId || edge.target.nodeId === nodeId) {
        ids.add(edge.id);
        if (edge.source.nodeId) ids.add(edge.source.nodeId);
        if (edge.target.nodeId) ids.add(edge.target.nodeId);
      }
    });
    setSelection([...ids], nodeId);
  };

  const selectSameType = (nodeId: string) => {
    const source = page?.nodes.find((node) => node.id === nodeId);
    if (!source || !page) return;
    const ids = page.nodes.filter((node) => !node.hidden && node.type === source.type).map((node) => node.id);
    setSelection(ids, nodeId);
  };

  const reverseContextEdge = (edgeId: string) => {
    const edge = page?.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) return;
    updateEdge(edgeId, { source: edge.target, target: edge.source, waypoints: edge.waypoints.slice().reverse() }, 'Reverse connector direction');
  };

  const addContextWaypoint = (edgeId: string) => {
    const edge = page?.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) return;
    const sourceNode = edge.source.nodeId ? page?.nodes.find((node) => node.id === edge.source.nodeId) : undefined;
    const targetNode = edge.target.nodeId ? page?.nodes.find((node) => node.id === edge.target.nodeId) : undefined;
    const route = edgeRoute(edge, sourceNode, targetNode, page.nodes);
    const point = route[Math.floor(route.length / 2)] ?? endpointPoint(edge.source, sourceNode, targetNode ? nodeCenter(targetNode) : edge.target.point) ?? { x: 0, y: 0 };
    updateEdge(edgeId, { waypoints: [...edge.waypoints, { x: Math.round(point.x), y: Math.round(point.y) }] }, 'Add waypoint');
  };

  const swapContextMarkers = (edgeId: string) => {
    const edge = page?.edges.find((candidate) => candidate.id === edgeId);
    if (edge) updateEdge(edgeId, { style: { startMarker: edge.style.endMarker, endMarker: edge.style.startMarker } }, 'Swap connector markers');
  };

  const selectedNodeItems = page?.nodes.filter((node) => !node.hidden && selectedIds.includes(node.id)) ?? [];
  const selectedEdgeItems = page?.edges.filter((edge) => selectedIds.includes(edge.id)) ?? [];
  const toolbarKind: 'node' | 'selection' | 'edge' | null = selectedNodeItems.length > 1
    ? 'selection'
    : selectedNodeItems.length === 1
      ? 'node'
      : selectedEdgeItems.length === 1
        ? 'edge'
        : null;
  const toolbarSelectionIsGrouped = toolbarKind === 'selection'
    && selectedNodeItems.length > 1
    && Boolean(selectedNodeItems[0]?.groupId)
    && selectedNodeItems.every((node) => node.groupId === selectedNodeItems[0]?.groupId);
  const toolbarEdge = toolbarKind === 'edge' ? selectedEdgeItems[0] : undefined;
  const toolbarPoint = (() => {
    if (!toolbarKind || !page) return null;
    let worldPoint: Point;
    let worldTop: number;
    if (toolbarEdge) {
      const source = toolbarEdge.source.nodeId ? page.nodes.find((node) => node.id === toolbarEdge.source.nodeId) : undefined;
      const target = toolbarEdge.target.nodeId ? page.nodes.find((node) => node.id === toolbarEdge.target.nodeId) : undefined;
      const route = edgeRoute(toolbarEdge, source, target, page.nodes);
      worldPoint = route[Math.floor(route.length / 2)] ?? toolbarEdge.source.point ?? toolbarEdge.target.point ?? { x: 0, y: 0 };
      worldTop = Math.min(...route.map((point) => point.y));
    } else {
      const nodes = selectedNodeItems;
      const minX = Math.min(...nodes.map((node) => node.position.x));
      const maxX = Math.max(...nodes.map((node) => node.position.x + node.size.width));
      const minY = Math.min(...nodes.map((node) => node.position.y));
      worldPoint = { x: (minX + maxX) / 2, y: minY };
      worldTop = minY;
    }
    const screen = {
      x: size.width / 2 + (worldPoint.x + viewport.x) * viewport.zoom,
      y: size.height / 2 + (worldTop + viewport.y) * viewport.zoom,
    };
    const toolbarWidth = toolbarKind === 'edge' ? 440 : toolbarKind === 'selection' ? 410 : 280;
    return { x: Math.min(Math.max(8, screen.x - toolbarWidth / 2), Math.max(8, size.width - toolbarWidth - 8)), y: Math.min(Math.max(8, screen.y - 46), Math.max(8, size.height - 42)) };
  })();
  const applySelectedFill = (color: string) => {
    if (selectedNodeItems.length > 0) updateNodes(selectedNodeItems.map((node) => node.id), { style: { fill: color } }, 'Set fill color');
  };
  const changeEdgeRouting = (routing: string) => {
    if (toolbarEdge) updateEdge(toolbarEdge.id, { data: { routing } }, 'Change connector routing');
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

  const buildConnectionEdge = (sourceAnchor: ConnectorAnchor, targetAnchor: ConnectorAnchor, allowSelfLoop = false, additionalNodes: DiagramNode[] = []): DiagramEdge | null => {
    if (!page || (!allowSelfLoop && sourceAnchor.nodeId === targetAnchor.nodeId)) return null;
    const sourceNode = [...page.nodes, ...additionalNodes].find((candidate) => candidate.id === sourceAnchor.nodeId);
    const targetNode = [...page.nodes, ...additionalNodes].find((candidate) => candidate.id === targetAnchor.nodeId);
    if (!sourceNode || !targetNode) return null;
    const sourcePort = sourceAnchor.port ?? nearestConnectionPort(sourceNode, nodeCenter(targetNode));
    const targetPort = targetAnchor.port ?? nearestConnectionPort(targetNode, nodeCenter(sourceNode));
    const source = { nodeId: sourceNode.id, port: sourcePort, ...(sourceAnchor.anchorId ? { anchorId: sourceAnchor.anchorId } : {}), ...(sourceAnchor.offset === undefined ? {} : { offset: sourceAnchor.offset }) };
    const target = { nodeId: targetNode.id, port: targetPort, ...(targetAnchor.anchorId ? { anchorId: targetAnchor.anchorId } : {}), ...(targetAnchor.offset === undefined ? {} : { offset: targetAnchor.offset }) };
    const branchCount = document.diagramType === 'flowchart' && sourceNode.type === 'decision'
      ? page.edges.filter((edge) => edge.source.nodeId === sourceNode.id).length
      : -1;
    const branchLabel = branchCount === 0 ? 'Yes' : branchCount === 1 ? 'No' : undefined;
    const edgeOptions = document.diagramType === 'erd'
      ? { type: 'orthogonal' as const, style: { startMarker: 'bar' as const, endMarker: 'crowfoot' as const } }
      : document.diagramType === 'dfd'
        ? { type: 'orthogonal' as const }
        : branchLabel
          ? { data: { label: branchLabel } }
          : undefined;
    return createEdge(source, target, edgeOptions);
  };

  const createConnection = (sourceAnchor: ConnectorAnchor, targetAnchor: ConnectorAnchor): boolean => {
    const edge = buildConnectionEdge(sourceAnchor, targetAnchor, true);
    if (!edge) return false;
    createConnector(edge);
    return true;
  };

  const createQuickShape = (shape: ReturnType<typeof pluginManager.list>[number]['shapes'][number], libraryId: string) => {
    if (!quickCreate || !page) return;
    const size = shape.defaultSize ?? { width: 180, height: 88 };
    const position = dropPosition(quickCreate.point, size, quickCreate.disableSnapping);
    const node = buildNode(shape.type, position, {
      library: libraryId,
      size,
      boundary: shape.boundary,
      container: shape.container,
      style: shape.defaultStyle,
      data: shape.defaultData ?? { label: shape.label },
    });
    const sourceNode = page.nodes.find((candidate) => candidate.id === quickCreate.source.nodeId);
    if (!sourceNode) return;
    const target = { nodeId: node.id, port: nearestConnectionPort(node, nodeCenter(sourceNode)) } satisfies ConnectorAnchor;
    const edge = buildConnectionEdge(quickCreate.source, target, false, [node]);
    if (!edge) return;
    createNodeAndEdge(node, edge);
    setQuickCreate(null);
    setQuickCreateSearch('');
  };

  const dropPosition = (point: Point, shapeSize: Size, disableSnapping = false): Point => {
    const raw = { x: point.x - shapeSize.width / 2, y: point.y - shapeSize.height / 2 };
    if (!page || !getSnapSettings(page.settings).grid || disableSnapping) return raw;
    const gridSize = page.settings.gridSize;
    return { x: Math.round(raw.x / gridSize) * gridSize, y: Math.round(raw.y / gridSize) * gridSize };
  };

  const handleShapeDragOver = (event: ReactDragEvent<SVGSVGElement>) => {
    if (event.dataTransfer.files?.length && onImportFile) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      return;
    }
    const payload = parseShapeDrop(event.dataTransfer);
    if (!payload && !Array.from(event.dataTransfer.types).includes(SHAPE_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setShapeDragPreview({ payload: payload ?? { libraryId: 'general', type: 'rectangle', label: 'Drop shape', defaultSize: { width: 180, height: 88 } }, point: worldPoint(event), disableSnapping: event.altKey });
  };

  const handleShapeDrop = (event: ReactDragEvent<SVGSVGElement>) => {
    const file = event.dataTransfer.files?.[0];
    if (file && onImportFile) {
      event.preventDefault();
      void onImportFile(file, worldPoint(event));
      setShapeDragPreview(null);
      return;
    }
    const payload = parseShapeDrop(event.dataTransfer);
    if (!payload) return;
    event.preventDefault();
    const point = worldPoint(event);
    const shapeSize = payload.defaultSize ?? { width: 180, height: 88 };
    const position = dropPosition(point, shapeSize, event.altKey);
    const node = buildNode(payload.type, position, {
      library: payload.libraryId,
      size: payload.defaultSize,
      boundary: payload.boundary,
      container: payload.container,
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
      resizeMinimum: node.type === 'entity' ? entityMinimumSize(node.data.fields, node.data.entityVariant, node.data.columnHeaders === true) : undefined,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const beginNodeInteraction = (event: ReactPointerEvent<SVGElement>, node: DiagramNode, port?: ConnectionPort, offset?: number, anchorId?: string) => {
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

    if (formatPainter && activeTool === 'select' && port === undefined && event.button === 0) {
      updateNode(node.id, { style: formatPainter }, 'Format painter');
      clearFormatPainter();
      setSelection([node.id], node.id);
      return;
    }

    if (port !== undefined && (activeTool === 'select' || activeTool === 'connector')) {
      const anchor = { nodeId: node.id, port, ...(anchorId ? { anchorId } : {}), ...(offset === undefined ? {} : { offset }) } satisfies ConnectorAnchor;
      if (activeTool === 'connector' && connectorStart) {
        createConnection(connectorStart, anchor);
        setConnectorStart(null);
        setConnectorDragPreview(null);
        dragRef.current = null;
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
        disableSnapping: event.altKey,
        connectorSource: anchor,
      };
      setConnectorDragPreview({ source: anchor, start: startPoint, current: startPoint });
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (activeTool === 'connector') {
      if (!port && page && !getSnapSettings(page.settings).ports) return;
      const anchor = { nodeId: node.id, port, ...(anchorId ? { anchorId } : {}), ...(offset === undefined ? {} : { offset }) } satisfies ConnectorAnchor;
      if (!connectorStart) {
        setConnectorStart(anchor);
      } else {
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
    if (event.button === 0 && !event.shiftKey && !event.altKey && lastClickRef.current?.kind === 'node' && lastClickRef.current.id === node.id && now - lastClickRef.current.time < DOUBLE_CLICK_WINDOW_MS) {
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
    const session: DragSession = { mode: 'drag', pointerId: event.pointerId, startWorld: point, startClient: screenPoint(event), disableSnapping: event.altKey, initialPositions: positions };
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
    const nextSelection = event.shiftKey
      ? selectedIds.includes(edge.id)
        ? selectedIds.filter((id) => id !== edge.id)
        : [...selectedIds, edge.id]
      : [edge.id];
    setSelection(nextSelection, nextSelection.includes(edge.id) ? edge.id : nextSelection.at(-1) ?? null);
  };

  const beginEdgeDoubleClick = (event: ReactMouseEvent<SVGGElement>, edge: DiagramEdge) => {
    const target = event.target as Element;
    const waypoint = target.closest?.('[data-waypoint-index]');
    if (waypoint && edge.waypoints.length > 0) {
      const index = Number(waypoint.getAttribute('data-waypoint-index'));
      if (Number.isInteger(index) && index >= 0 && index < edge.waypoints.length) {
        updateEdge(edge.id, { waypoints: edge.waypoints.filter((_, pointIndex) => pointIndex !== index) }, 'Delete waypoint');
        return;
      }
    }
    if (edgeRouting(edge) === 'orthogonal' && target.closest?.('.edge-hit-area')) {
      const route = edgeRoute(edge, edge.source.nodeId ? nodeMap.get(edge.source.nodeId) : undefined, edge.target.nodeId ? nodeMap.get(edge.target.nodeId) : undefined, [...nodeMap.values()]);
      const nearest = nearestRoutePoint(route, worldPoint(event));
      if (nearest) {
        const nextPoint = page && getSnapSettings(page.settings).grid
          ? { x: Math.round(nearest.point.x / page.settings.gridSize) * page.settings.gridSize, y: Math.round(nearest.point.y / page.settings.gridSize) * page.settings.gridSize }
          : nearest.point;
        const waypoints = edge.waypoints.slice();
        waypoints.splice(Math.min(nearest.segmentIndex, waypoints.length), 0, nextPoint);
        updateEdge(edge.id, { waypoints }, 'Add waypoint');
        return;
      }
    }
    beginTextEdit('edge', edge.id);
  };

  const beginLabelInteraction = (event: ReactPointerEvent<SVGGElement>, edge: DiagramEdge, point: Point) => {
    if (activeTool !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelection([edge.id], edge.id);
    const start = worldPoint(event);
    dragRef.current = { mode: 'label', pointerId: event.pointerId, startWorld: start, startClient: screenPoint(event), edgeId: edge.id, labelStart: point };
    setLabelPreview({ edgeId: edge.id, point: { ...point } });
    svgRef.current?.setPointerCapture(event.pointerId);
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

  const beginSegmentInteraction = (event: ReactPointerEvent<SVGLineElement>, edge: DiagramEdge, index: number, start: Point, end: Point) => {
    if (activeTool !== 'select' || spacePressed || event.button === 1) return;
    event.preventDefault();
    event.stopPropagation();
    dismissCanvasHint();
    setContextMenu(null);
    setSelection([edge.id], edge.id);
    const axis = Math.abs(end.x - start.x) > Math.abs(end.y - start.y) ? 'y' : 'x';
    const point = worldPoint(event);
    dragRef.current = {
      mode: 'segment',
      pointerId: event.pointerId,
      startWorld: point,
      startClient: screenPoint(event),
      edgeId: edge.id,
      segmentIndex: index,
      segmentAxis: axis,
      initialSegmentValue: axis === 'x' ? start.x : start.y,
    };
    setSegmentPreview({ edgeId: edge.id, segmentIndex: index, axis, value: axis === 'x' ? point.x : point.y });
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
      disableSnapping: event.altKey,
      edgeId: edge.id,
      endpoint,
    };
    const preview: EndpointPreview = { edgeId: edge.id, endpoint, anchor: { ...edge[endpoint] }, point: { ...point } };
    endpointPreviewRef.current = preview;
    setEndpointPreview(preview);
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const updateEndpointPreview = (session: DragSession, point: Point, disableSnapping = false, maxDistance = ENDPOINT_SNAP_DISTANCE) => {
    if (!session.edgeId || !session.endpoint || !page) return;
    const edge = page.edges.find((candidate) => candidate.id === session.edgeId);
    if (!edge) return;
    const snappingEnabled = getSnapSettings(page.settings).ports && !disableSnapping && !session.disableSnapping;
    // Endpoint edits may intentionally reconnect to the other endpoint's node
    // to form a self-loop. Connector creation has its own self-loop policy;
    // do not apply that exclusion while an existing endpoint is being edited.
    const nearest = snappingEnabled ? nearestConnectionAnchor(page.nodes, point, undefined, maxDistance) : null;
    if (nearest) {
      const anchor = { nodeId: nearest.anchor.nodeId, port: nearest.anchor.port, anchorId: nearest.anchor.id, ...(nearest.anchor.offset === undefined ? {} : { offset: nearest.anchor.offset }) };
      const preview: EndpointPreview = { edgeId: edge.id, endpoint: session.endpoint, anchor, point: nearest.point };
      endpointPreviewRef.current = preview;
      setEndpointPreview(preview);
      return;
    }
    const candidate = snappingEnabled ? page.nodes
      .filter((node) => !node.hidden)
      .filter((node) => point.x >= node.position.x - maxDistance && point.x <= node.position.x + node.size.width + maxDistance && point.y >= node.position.y - maxDistance && point.y <= node.position.y + node.size.height + maxDistance)
      .sort((left, right) => (right.zIndex ?? 0) - (left.zIndex ?? 0))[0] : undefined;
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
    const pointer = worldPoint(event);
    setPointerWorld(pointer);
    editorEvents.emit('pointer:changed', pointer);
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
      const snappingEnabled = page ? getSnapSettings(page.settings).ports && !event.altKey && !session.disableSnapping : false;
      const snapped = snappingEnabled ? nearestConnectionAnchor(page?.nodes ?? [], point, session.connectorSource?.nodeId, ENDPOINT_SNAP_DISTANCE / viewport.zoom) : null;
      setConnectorDragPreview({ ...connectorDragPreview, current: snapped?.point ?? point, target: snapped ?? undefined });
    } else if (session.mode === 'label' && session.edgeId) {
      setLabelPreview({ edgeId: session.edgeId, point });
    } else if (session.mode === 'endpoint') {
      updateEndpointPreview(session, point, event.altKey, ENDPOINT_SNAP_DISTANCE / viewport.zoom);
    } else if (session.mode === 'resize' && session.initialNode && session.nodeId && session.resizeHandle) {
       setResizePreview({ nodeId: session.nodeId, ...resizeGeometry(session.initialNode, session.resizeHandle, session.startWorld, point, event.shiftKey, session.resizeMinimum) });
    } else if (session.mode === 'waypoint' && session.edgeId && session.waypointIndex !== undefined) {
      const gridSize = page?.settings.gridSize ?? 16;
      const nextPoint = page && getSnapSettings(page.settings).grid && !event.altKey && !session.disableSnapping
        ? { x: Math.round(point.x / gridSize) * gridSize, y: Math.round(point.y / gridSize) * gridSize }
        : point;
      setWaypointPreview({ edgeId: session.edgeId, index: session.waypointIndex, point: nextPoint });
    } else if (session.mode === 'segment' && session.edgeId && session.segmentIndex !== undefined && session.segmentAxis) {
      const gridSize = page?.settings.gridSize ?? 16;
      const rawValue = session.segmentAxis === 'x' ? point.x : point.y;
      const value = page && getSnapSettings(page.settings).grid && !event.altKey && !session.disableSnapping
        ? Math.round(rawValue / gridSize) * gridSize
        : rawValue;
      setSegmentPreview({ edgeId: session.edgeId, segmentIndex: session.segmentIndex, axis: session.segmentAxis, value });
    } else if (session.mode === 'drag' && session.initialPositions) {
      const movingNodes = page?.nodes.filter((node) => Object.hasOwn(session.initialPositions ?? {}, node.id)) ?? [];
      const candidateNodes = page?.nodes.filter((node) => snapCandidateIds.includes(node.id)) ?? [];
       const snap = page ? getSnapSettings(page.settings) : undefined;
       const snapped = snapDraggedNodes(movingNodes, session.initialPositions, session.startWorld, point, candidateNodes, { gridSize: page?.settings.gridSize ?? 16, snapToGrid: snap?.grid ?? false, snapToObjects: snap?.objects ?? false, snapToGuides: snap?.guides ?? false, guides: page?.guides ?? [], threshold: 10 / viewport.zoom }, { constrainAxis: event.shiftKey, disableSnapping: event.altKey || session.disableSnapping });
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
         const snappingEnabled = page ? getSnapSettings(page.settings).ports && !event.altKey && !session.disableSnapping : false;
        const target = page ? connectionDropAnchor(event, point, page.nodes, session.connectorSource.nodeId, snappingEnabled, ENDPOINT_SNAP_DISTANCE / viewport.zoom) : null;
        if (target) createConnection(session.connectorSource, target);
        else if (page) setQuickCreate({ source: session.connectorSource, point, screen: screenPoint(event), disableSnapping: event.altKey || Boolean(session.disableSnapping) });
        setConnectorStart(null);
      } else if (activeTool !== 'connector') {
        setConnectorStart(null);
      }
      setConnectorDragPreview(null);
    } else if (session.mode === 'resize') {
      const nodeId = session.nodeId;
      if (nodeId && session.initialNode && session.resizeHandle) {
        const geometry = resizeGeometry(session.initialNode, session.resizeHandle, session.startWorld, worldPoint(event), event.shiftKey, session.resizeMinimum);
        updateNode(nodeId, geometry, 'Resize node');
        setResizePreview(null);
      }
    } else if (session.mode === 'endpoint' && session.edgeId && session.endpoint) {
      // React state may still contain the previous pointermove when the user
      // releases quickly. Resolve the release point synchronously so an
      // endpoint cannot commit the previous unsnapped position.
      updateEndpointPreview(session, worldPoint(event), event.altKey, ENDPOINT_SNAP_DISTANCE / viewport.zoom);
      const edge = page?.edges.find((candidate) => candidate.id === session.edgeId);
      const preview = endpointPreviewRef.current;
      if (edge && preview && preview.edgeId === session.edgeId && preview.endpoint === session.endpoint && !sameEndpoint(edge[session.endpoint], preview.anchor)) {
        const changes = session.endpoint === 'source'
          ? { source: preview.anchor }
          : { target: preview.anchor };
        updateEdge(edge.id, { ...changes, ...(edge[session.endpoint].nodeId !== preview.anchor.nodeId ? { waypoints: [] } : {}) }, `Move ${session.endpoint} endpoint`);
      }
      endpointPreviewRef.current = null;
      setEndpointPreview(null);
    } else if (session.mode === 'label' && session.edgeId) {
      const preview = labelPreview;
      if (preview?.edgeId === session.edgeId && session.labelStart && distanceBetween(preview.point, session.labelStart) > 1) {
        updateEdge(session.edgeId, { data: { labelPosition: preview.point } }, 'Move connector label');
      }
      setLabelPreview(null);
    } else if (session.mode === 'segment' && session.edgeId && session.segmentAxis && segmentPreview?.edgeId === session.edgeId && segmentPreview.axis === session.segmentAxis) {
      const edge = page?.edges.find((candidate) => candidate.id === session.edgeId);
      if (edge) {
        updateEdge(edge.id, { routing: edgeWithSegmentConstraint(edge, session.segmentAxis, segmentPreview.value, session.initialSegmentValue).routing }, 'Move connector segment');
      }
      setSegmentPreview(null);
    } else if (session.mode === 'waypoint' && session.edgeId && session.waypointIndex !== undefined && waypointPreview?.edgeId === session.edgeId && waypointPreview.index === session.waypointIndex) {
      const edge = page?.edges.find((candidate) => candidate.id === session.edgeId);
      if (edge) {
        const waypoints = edge.waypoints.slice();
        if (session.waypointIndex < waypoints.length) waypoints[session.waypointIndex] = waypointPreview.point;
        else waypoints.splice(Math.min(session.waypointIndex, waypoints.length), 0, waypointPreview.point);
        updateEdge(edge.id, { waypoints }, 'Move waypoint');
      }
      setWaypointPreview(null);
    } else if (session.mode === 'drag' && session.initialPositions) {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      const moved = distanceBetween(screenPoint(event), session.startClient) > 2;
      if (moved && page) {
        const point = worldPoint(event);
        const movingNodes = page.nodes.filter((node) => Object.hasOwn(session.initialPositions!, node.id));
        const candidateNodes = page.nodes.filter((node) => snapCandidateIds.includes(node.id));
         const snap = getSnapSettings(page.settings);
         const snapped = snapDraggedNodes(movingNodes, session.initialPositions, session.startWorld, point, candidateNodes, { gridSize: page.settings.gridSize, snapToGrid: snap.grid, snapToObjects: snap.objects, snapToGuides: snap.guides, guides: page.guides ?? [], threshold: 10 / viewport.zoom }, { constrainAxis: event.shiftKey, disableSnapping: event.altKey || session.disableSnapping });
        moveNodes(snapped.positions);
      }
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

  const clearPointerPosition = () => {
    setPointerWorld(null);
    editorEvents.emit('pointer:changed', null);
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
  const canvasBackground = page?.settings.background ?? '#10131c';
  const canvasGridColor = page?.settings.canvasTheme === 'light' ? '#cbd2df' : '#2c3346';
  const gridId = `grid-${page?.id ?? 'page'}`;
  const marqueeRect = marquee ? {
    x: Math.min(marquee.start.x, marquee.current.x), y: Math.min(marquee.start.y, marquee.current.y),
    width: Math.abs(marquee.current.x - marquee.start.x), height: Math.abs(marquee.current.y - marquee.start.y),
  } : null;

  const renderedNodes = page?.nodes.filter((node) => !node.hidden && (!visibleNodeIds || visibleNodeIds.has(node.id))).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)) ?? [];
  const nodeMap = useMemo(() => new Map((page?.nodes ?? []).map((node) => {
    const clamped = clampEntityNodeSize(node);
    const moved = dragPreview[node.id] ? { ...clamped, position: dragPreview[node.id] } : clamped;
    const preview = resizePreview?.nodeId === node.id ? { ...moved, position: resizePreview.position, size: resizePreview.size } : moved;
    return [node.id, clampEntityNodeSize(preview)] as const;
  })), [dragPreview, page?.nodes, resizePreview]);
  const groupBounds = (() => {
    const groups = new Map<string, DiagramNode[]>();
    nodeMap.forEach((node) => {
      if (node.hidden || !node.groupId) return;
      const members = groups.get(node.groupId) ?? [];
      members.push(node);
      groups.set(node.groupId, members);
    });
    return [...groups.entries()].map(([id, members]) => {
      const bounds = members.map(rotatedNodeBounds);
      const minX = Math.min(...bounds.map((value) => value.x)) - 14;
      const minY = Math.min(...bounds.map((value) => value.y)) - 14;
      const maxX = Math.max(...bounds.map((value) => value.x + value.width)) + 14;
      const maxY = Math.max(...bounds.map((value) => value.y + value.height)) + 14;
      return { id, members, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, selected: members.every((node) => selectedIds.includes(node.id)) };
    });
  })();
  const renderedEdges = page?.edges.filter((edge) => !visibleNodeIds || !edge.source.nodeId || !edge.target.nodeId || visibleNodeIds.has(edge.source.nodeId) || visibleNodeIds.has(edge.target.nodeId)) ?? [];
  const connectionTarget = connectorDragPreview?.target
    ? { nodeId: connectorDragPreview.target.anchor.nodeId, point: connectorDragPreview.target.point }
    : endpointPreview?.anchor.nodeId
      ? { nodeId: endpointPreview.anchor.nodeId, point: endpointPreview.point }
      : null;
  const routeEntries = useMemo(() => {
    const routes: Array<{ id: string; points: Point[]; crossingPriority?: number }> = [];
    renderedEdges.forEach((edge) => {
      const source = edge.source.nodeId ? nodeMap.get(edge.source.nodeId) : undefined;
      const target = edge.target.nodeId ? nodeMap.get(edge.target.nodeId) : undefined;
      const parallelOffset = parallelEdgeOffset(edge, page?.edges ?? renderedEdges);
      const routedEdge = parallelOffset === 0 ? edge : { ...edge, data: { ...edge.data, parallelOffset } };
      const previewEdge = segmentPreview?.edgeId === edge.id
        ? edgeWithSegmentConstraint(routedEdge, segmentPreview.axis, segmentPreview.value)
        : routedEdge;
      routes.push({
        id: edge.id,
        points: edgeRoute(previewEdge, source, target, [...nodeMap.values()], {
          previousRoute: routeCacheRef.current.get(edge.id),
          otherRoutes: routes.map((route) => route.points),
          lane: edgeRouting(edge) === 'orthogonal' ? parallelRoutingLane(edge, page?.edges ?? renderedEdges) : undefined,
        }),
        crossingPriority: selectedIds.includes(edge.id) ? 1000000 : edge.routing?.crossingPriority ?? 0,
      });
    });
    return routes;
  }, [nodeMap, page?.edges, renderedEdges, segmentPreview, selectedIds]);
  useEffect(() => {
    const currentIds = new Set(routeEntries.map((entry) => entry.id));
    routeEntries.forEach((entry) => routeCacheRef.current.set(entry.id, entry.points));
    routeCacheRef.current.forEach((_route, id) => { if (!currentIds.has(id)) routeCacheRef.current.delete(id); });
  }, [routeEntries]);
  const edgeRoutes = useMemo(() => new Map(routeEntries.map((entry) => [entry.id, entry.points])), [routeEntries]);
  const edgeJumps = useMemo(() => calculateRouteJumps(routeEntries.filter((entry) => renderedEdges.some((edge) => edge.id === entry.id && edgeRouting(edge) === 'orthogonal'))), [renderedEdges, routeEntries]);
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
     const point = labelPointForEdge(edge, route);
     return { left: size.width / 2 + (point.x + viewport.x) * viewport.zoom - 80, top: size.height / 2 + (point.y + viewport.y) * viewport.zoom - 15, width: 160, textAlign: 'center' as const };
  }, [nodeMap, page, size.height, size.width, textEdit, viewport]);
  const shapePreview = shapeDragPreview
    ? (() => {
      const shapeSize = shapeDragPreview.payload.defaultSize ?? { width: 180, height: 88 };
       const position = dropPosition(shapeDragPreview.point, shapeSize, shapeDragPreview.disableSnapping);
      return { ...shapeSize, position, label: shapeDragPreview.payload.label };
    })()
    : null;
  const shapePreviewNode = shapePreview && shapeDragPreview
    ? buildNode(shapeDragPreview.payload.type, shapePreview.position, {
      library: shapeDragPreview.payload.libraryId,
      size: { width: shapePreview.width, height: shapePreview.height },
      boundary: shapeDragPreview.payload.boundary,
      container: shapeDragPreview.payload.container,
      style: shapeDragPreview.payload.defaultStyle,
      data: shapeDragPreview.payload.defaultData ?? { label: shapePreview.label },
    })
    : null;
  const rulerMarks = buildRulerMarks(size, viewport);
  const minimapWidth = 180;
  const minimapHeight = 112;
  const visibleWorld = { x: -viewport.x - size.width / 2 / viewport.zoom, y: -viewport.y - size.height / 2 / viewport.zoom, width: size.width / viewport.zoom, height: size.height / viewport.zoom };
  const minimapWorld = navigationBounds(page?.nodes ?? [], page?.edges ?? [], visibleWorld);
  const minimapScale = Math.min((minimapWidth - 12) / minimapWorld.width, (minimapHeight - 12) / minimapWorld.height);
  const minimapOffset = { x: (minimapWidth - minimapWorld.width * minimapScale) / 2, y: (minimapHeight - minimapWorld.height * minimapScale) / 2 };
  const minimapPoint = (point: Point) => ({ x: minimapOffset.x + (point.x - minimapWorld.x) * minimapScale, y: minimapOffset.y + (point.y - minimapWorld.y) * minimapScale });
  const minimapRect = (bounds: WorldBounds) => ({ ...minimapPoint({ x: bounds.x, y: bounds.y }), width: bounds.width * minimapScale, height: bounds.height * minimapScale });
  const minimapViewport = minimapRect(visibleWorld);
  const guideWorld = { left: visibleWorld.x - visibleWorld.width, right: visibleWorld.x + visibleWorld.width * 2, top: visibleWorld.y - visibleWorld.height, bottom: visibleWorld.y + visibleWorld.height * 2 };
  const pointerScreen = pointerWorld ? { x: size.width / 2 + (pointerWorld.x + viewport.x) * viewport.zoom, y: size.height / 2 + (pointerWorld.y + viewport.y) * viewport.zoom } : null;
  const quickCreateMatches = pluginManager.list().flatMap((plugin) => plugin.shapes.map((shape) => ({ pluginId: plugin.id, shape }))).filter(({ shape }) => [shape.label, shape.semanticRole, shape.notation, shape.category, ...(shape.aliases ?? []), ...(shape.tags ?? [])].filter(Boolean).join(' ').toLowerCase().includes(quickCreateSearch.trim().toLowerCase())).slice(0, 8);

    return <div className={`canvas-stage ${activeTool === 'pan' || spacePressed ? 'pan-mode' : ''} ${activeTool === 'connector' ? 'connector-mode' : ''} ${formatPainter ? 'format-painter-mode' : ''}`} ref={stageRef} onPointerLeave={clearPointerPosition}>
      {view.connectionHints && showCanvasHint && <div className="canvas-hint"><span className="hint-key">H</span> Pan tool <span className="hint-separator">·</span> <span className="hint-key">Space</span> + drag to pan <span className="hint-separator">·</span> <span className="hint-key">Scroll</span> to zoom</div>}
      {view.rulers && <><div className="canvas-ruler canvas-ruler-top" aria-label="Horizontal ruler" onPointerDown={(event) => beginGuideDrag(event, 'vertical')}>{rulerMarks.horizontal.map((mark) => <span key={mark.value} className={mark.major ? 'ruler-mark major' : 'ruler-mark'} style={{ left: mark.screen }}><i />{mark.major && mark.value}</span>)}{pointerScreen && <span className="ruler-pointer ruler-pointer-horizontal" style={{ left: pointerScreen.x }}><i>{Math.round(pointerWorld?.x ?? 0)}</i></span>}</div><div className="canvas-ruler canvas-ruler-left" aria-label="Vertical ruler" onPointerDown={(event) => beginGuideDrag(event, 'horizontal')}>{rulerMarks.vertical.map((mark) => <span key={mark.value} className={mark.major ? 'ruler-mark major' : 'ruler-mark'} style={{ top: mark.screen }}><i />{mark.major && mark.value}</span>)}{pointerScreen && <span className="ruler-pointer ruler-pointer-vertical" style={{ top: pointerScreen.y }}><i>{Math.round(pointerWorld?.y ?? 0)}</i></span>}</div></>}
    <svg ref={svgRef} className="diagram-canvas" width={size.width} height={size.height} onPointerDown={beginCanvasInteraction} onPointerMove={handlePointerMove} onPointerUp={finishPointerInteraction} onPointerCancel={finishPointerInteraction} onWheel={handleWheel} onContextMenu={handleContextMenu} onDragOver={handleShapeDragOver} onDrop={handleShapeDrop} onDragLeave={(event) => { if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) setShapeDragPreview(null); }}>
      <defs>
         <pattern id={gridId} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse"><path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke={canvasGridColor} strokeWidth="0.7" opacity={page?.settings.canvasTheme === 'light' ? '0.7' : '0.62'} /></pattern>
        <marker id="arrow-end" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 z" fill="#8a92ab" /></marker>
        <marker id="arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M8,0 L0,4 L8,8 z" fill="#8a92ab" /></marker>
        <marker id="arrow-end-active" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 z" fill="#9c86ff" /></marker>
      </defs>
       <rect className="canvas-background" width={size.width} height={size.height} fill={canvasBackground} />
        <g transform={transform}>
          <rect x={-10000} y={-10000} width={20000} height={20000} fill={page?.settings.gridVisible ? `url(#${gridId})` : canvasBackground} />
          {shapePreviewNode && <g className="shape-drop-preview" transform={`translate(${shapePreviewNode.position.x} ${shapePreviewNode.position.y})`} pointerEvents="none"><NodeGraphic node={shapePreviewNode} diagramType={document.diagramType} /></g>}
         {connectorDragPreview && <path className="connector-drag-preview" d={`M ${connectorDragPreview.start.x} ${connectorDragPreview.start.y} L ${connectorDragPreview.current.x} ${connectorDragPreview.current.y}`} fill="none" />}
           {view.guides && <g className="guide-layer">{(page?.guides ?? []).map((guide) => guide.orientation === 'vertical'
            ? <line key={guide.id} className={`canvas-guide ${guide.locked ? 'locked' : ''}`} x1={guide.position} y1={guideWorld.top} x2={guide.position} y2={guideWorld.bottom} onPointerDown={(event) => beginGuideDrag(event, 'vertical', guide)} onDoubleClick={() => removeGuide(guide.id)} />
            : <line key={guide.id} className={`canvas-guide ${guide.locked ? 'locked' : ''}`} x1={guideWorld.left} y1={guide.position} x2={guideWorld.right} y2={guide.position} onPointerDown={(event) => beginGuideDrag(event, 'horizontal', guide)} onDoubleClick={() => removeGuide(guide.id)} />)}{guidePreview && (guidePreview.orientation === 'vertical'
             ? <line className="canvas-guide preview" x1={guidePreview.position} y1={guideWorld.top} x2={guidePreview.position} y2={guideWorld.bottom} />
              : <line className="canvas-guide preview" x1={guideWorld.left} y1={guidePreview.position} x2={guideWorld.right} y2={guidePreview.position} />)}</g>}
          {groupBounds.length > 0 && <g className="group-bounds-layer">{groupBounds.map((group) => { const label = `Group · ${group.members.length} objects`; return <g key={group.id} className={group.selected ? 'group-boundary selected' : 'group-boundary'}><rect className="group-boundary-outline" x={group.bounds.x} y={group.bounds.y} width={group.bounds.width} height={group.bounds.height} rx="10" /><rect className="group-boundary-label-bg" x={group.bounds.x + 8} y={group.bounds.y - 18} width={Math.max(104, label.length * 5.7 + 14)} height="16" rx="4" /><text className="group-boundary-label" x={group.bounds.x + 15} y={group.bounds.y - 7}>{label}</text></g>; })}</g>}
          <g className="edge-layer">{renderedEdges.map((edge) => {
          const previewEdge = endpointPreview?.edgeId === edge.id ? { ...edge, [endpointPreview.endpoint]: endpointPreview.anchor } as DiagramEdge : edge;
          const previewWaypoints = waypointPreview?.edgeId === edge.id
            ? (() => { const next = previewEdge.waypoints.slice(); if (waypointPreview.index < next.length) next[waypointPreview.index] = waypointPreview.point; else next.splice(Math.min(waypointPreview.index, next.length), 0, waypointPreview.point); return next; })()
            : previewEdge.waypoints;
          const preview = waypointPreview?.edgeId === edge.id ? { ...previewEdge, waypoints: previewWaypoints } : previewEdge;
          const isPreview = endpointPreview?.edgeId === edge.id || waypointPreview?.edgeId === edge.id;
             return <EdgeView key={edge.id} edge={preview} source={preview.source.nodeId ? nodeMap.get(preview.source.nodeId) : undefined} target={preview.target.nodeId ? nodeMap.get(preview.target.nodeId) : undefined} obstacles={[...nodeMap.values()]} route={isPreview ? undefined : edgeRoutes.get(edge.id)} jumps={isPreview ? [] : edgeJumps.get(edge.id) ?? []} background={canvasBackground} selected={selectedIds.includes(edge.id)} labelPointOverride={labelPreview?.edgeId === edge.id ? labelPreview.point : undefined} onPointerDown={beginEdgeInteraction} onDoubleClick={beginEdgeDoubleClick} onLabelPointerDown={beginLabelInteraction} onHover={setHoveredEdgeId} onWaypointPointerDown={beginWaypointInteraction} onSegmentPointerDown={beginSegmentInteraction} />;
        })}</g>
          <g className="node-layer">{renderedNodes.map((node) => { const previewNode = nodeMap.get(node.id) ?? node; return <NodeView key={node.id} node={previewNode} position={previewNode.position} selected={selectedIds.includes(node.id)} connectorStart={connectorStart?.nodeId === node.id} connectorTarget={connectionTarget?.nodeId === node.id} showPorts={view.showPorts || activeTool === 'connector' || selectedIds.includes(node.id)} diagramType={document.diagramType} onPointerDown={beginNodeInteraction} onResizePointerDown={beginResizeInteraction} onDoubleClick={(event, selectedNode) => beginTextEdit('node', selectedNode.id)} />; })}</g>
         {connectionTarget && <g className="connection-target-preview" pointerEvents="none"><circle cx={connectionTarget.point.x} cy={connectionTarget.point.y} r="10" /><circle cx={connectionTarget.point.x} cy={connectionTarget.point.y} r="4" /></g>}
         <g className="edge-marker-layer">{renderedEdges.map((edge) => {
           const previewEdge = endpointPreview?.edgeId === edge.id ? { ...edge, [endpointPreview.endpoint]: endpointPreview.anchor } as DiagramEdge : edge;
              return <EdgeMarkersView key={`markers-${edge.id}`} edge={previewEdge} source={previewEdge.source.nodeId ? nodeMap.get(previewEdge.source.nodeId) : undefined} target={previewEdge.target.nodeId ? nodeMap.get(previewEdge.target.nodeId) : undefined} obstacles={[...nodeMap.values()]} route={endpointPreview?.edgeId === edge.id ? undefined : edgeRoutes.get(edge.id)} markerFill={canvasBackground} />;
         })}</g>
         <g className="edge-endpoint-layer">{renderedEdges.map((edge) => {
           const previewEdge = endpointPreview?.edgeId === edge.id ? { ...edge, [endpointPreview.endpoint]: endpointPreview.anchor } as DiagramEdge : edge;
             return <EdgeEndpointHandles key={`handles-${edge.id}`} edge={previewEdge} source={previewEdge.source.nodeId ? nodeMap.get(previewEdge.source.nodeId) : undefined} target={previewEdge.target.nodeId ? nodeMap.get(previewEdge.target.nodeId) : undefined} obstacles={[...nodeMap.values()]} selected={selectedIds.includes(edge.id)} hovered={hoveredEdgeId === edge.id} onPointerDown={beginEndpointInteraction} />;
         })}</g>
        <g className="alignment-guide-layer">{alignmentGuides.map((guide, index) => guide.orientation === 'vertical'
          ? <line key={`vertical-${index}`} className="alignment-guide" x1={guide.position} y1={guide.start} x2={guide.position} y2={guide.end} />
          : <line key={`horizontal-${index}`} className="alignment-guide" x1={guide.start} y1={guide.position} x2={guide.end} y2={guide.position} />)}</g>
        {marqueeRect && <rect className="selection-marquee" x={marqueeRect.x} y={marqueeRect.y} width={marqueeRect.width} height={marqueeRect.height} />}
      </g>
    </svg>
       {editBox && textEdit && <input ref={textInputRef} className="canvas-text-editor" style={{ left: editBox.left, top: editBox.top, width: editBox.width, textAlign: editBox.textAlign }} value={textEdit.value} onChange={(event) => setTextEdit({ ...textEdit, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); commitTextEdit(); } if (event.key === 'Escape') { event.preventDefault(); setTextEdit(null); } }} onBlur={commitTextEdit} onPointerDown={(event) => event.stopPropagation()} aria-label="Edit diagram text" />}
       {toolbarKind && toolbarPoint && !contextMenu && !textEdit && !quickCreate && <ContextualToolbar kind={toolbarKind} x={toolbarPoint.x} y={toolbarPoint.y} nodes={selectedNodeItems} grouped={toolbarSelectionIsGrouped} edge={toolbarEdge} document={document} onDuplicate={() => duplicateSelection()} onDelete={deleteSelection} onToggleLock={toggleSelectedLock} onToggleHidden={toolbarKind === 'node' ? toggleSelectedHidden : undefined} onFormatPainter={toolbarKind === 'node' ? activateFormatPainter : undefined} onFill={toolbarKind === 'node' || toolbarKind === 'selection' ? applySelectedFill : undefined} onAlign={toolbarKind === 'selection' ? alignSelection : undefined} onDistribute={toolbarKind === 'selection' ? distributeSelection : undefined} onGroup={toolbarKind === 'selection' ? groupSelection : undefined} onUngroup={toolbarKind === 'selection' ? ungroupSelection : undefined} onZOrder={toolbarKind !== 'edge' ? setZOrder : undefined} onEdgeRouting={toolbarKind === 'edge' ? changeEdgeRouting : undefined} onReverse={toolbarEdge ? () => reverseContextEdge(toolbarEdge.id) : undefined} onSwapMarkers={toolbarEdge ? () => swapContextMarkers(toolbarEdge.id) : undefined} onAddWaypoint={toolbarEdge ? () => addContextWaypoint(toolbarEdge.id) : undefined} onResetEdge={toolbarEdge ? () => resetEdge(toolbarEdge.id) : undefined} />}
        {contextMenu && <div className="canvas-context-menu" style={{ left: Math.min(contextMenu.x, Math.max(8, size.width - 218)), top: Math.min(contextMenu.y, Math.max(8, size.height - 360)) }} onPointerDown={(event) => event.stopPropagation()}>
       {contextMenu.target.kind === 'canvas' && <><button onClick={() => { pasteClipboard(); setContextMenu(null); }}>Paste</button><button onClick={() => { selectAll(); setContextMenu(null); }}>Select all</button><button onClick={() => { setSelection([]); setContextMenu(null); }}>Clear selection</button><div className="context-menu-divider" /><button onClick={() => { editorEvents.emit('viewport:fit', { scope: 'page' }); setContextMenu(null); }}>Fit page</button><button onClick={() => { useEditorStore.getState().updateViewport({ zoom: 1 }); setContextMenu(null); }}>100% zoom</button></>}
       {contextMenu.target.kind === 'node' && contextMenu.target.id && <><button onClick={() => beginTextEdit('node', contextMenu.target.id!)}>Edit text</button><div className="context-menu-divider" /><button onClick={() => { void copySelection(); setContextMenu(null); }}>Copy</button><button onClick={() => { cutSelection(); setContextMenu(null); }}>Cut</button><button onClick={duplicateContextTarget}>Duplicate</button><div className="context-menu-divider" /><button onClick={() => { setZOrder('forward'); setContextMenu(null); }}>Bring forward</button><button onClick={() => { setZOrder('backward'); setContextMenu(null); }}>Send backward</button><button onClick={() => { setZOrder('front'); setContextMenu(null); }}>Bring to front</button><button onClick={() => { setZOrder('back'); setContextMenu(null); }}>Send to back</button><div className="context-menu-divider" /><button onClick={() => { toggleSelectedLock(); setContextMenu(null); }}>{page?.nodes.find((node) => node.id === contextMenu.target.id)?.locked ? 'Unlock' : 'Lock'}</button><button onClick={() => { toggleSelectedHidden(); setContextMenu(null); }}>{page?.nodes.find((node) => node.id === contextMenu.target.id)?.hidden ? 'Show' : 'Hide'}</button><button onClick={() => { selectConnected(contextMenu.target.id!); setContextMenu(null); }}>Select connected</button><button onClick={() => { selectSameType(contextMenu.target.id!); setContextMenu(null); }}>Select same type</button><button className="context-danger" onClick={deleteContextTarget}>Delete</button></>}
       {contextMenu.target.kind === 'edge' && contextMenu.target.id && <><button onClick={() => beginTextEdit('edge', contextMenu.target.id!)}>Edit label</button><button onClick={() => { reverseContextEdge(contextMenu.target.id!); setContextMenu(null); }}>Reverse</button><button onClick={() => { addContextWaypoint(contextMenu.target.id!); setContextMenu(null); }}>Add waypoint</button><button onClick={() => { resetEdge(contextMenu.target.id!); setContextMenu(null); }}>Reset route</button><button className="context-danger" onClick={deleteContextTarget}>Delete</button></>}
       </div>}
      {quickCreate && <div className="quick-create-menu" style={{ left: Math.min(Math.max(8, quickCreate.screen.x), Math.max(8, size.width - 224)), top: Math.min(Math.max(30, quickCreate.screen.y), Math.max(30, size.height - 248)) }} onPointerDown={(event) => event.stopPropagation()}><div className="quick-create-heading"><span>Quick create</span><button title="Cancel quick create" aria-label="Cancel quick create" onClick={() => { setQuickCreate(null); setQuickCreateSearch(''); }}>×</button></div><input autoFocus aria-label="Search quick create shapes" placeholder="Search shapes…" value={quickCreateSearch} onChange={(event) => setQuickCreateSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setQuickCreate(null); setQuickCreateSearch(''); } }} /><div className="quick-create-list">{quickCreateMatches.length === 0 ? <span className="command-empty">No matching shapes</span> : quickCreateMatches.map(({ pluginId, shape }) => <button key={`${pluginId}:${shape.id}`} onClick={() => createQuickShape(shape, pluginId)}><span className={`shape-mini ${shape.type}`}>{shapeIconForQuickCreate(shape.icon)}</span><span>{shape.label}</span><small>{pluginId === 'general' ? 'Basic' : pluginId}</small></button>)}</div></div>}
       {view.minimap && <div className="canvas-minimap" style={{ width: minimapWidth, height: minimapHeight }} onPointerDown={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); const x = minimapWorld.x + (event.clientX - rect.left - minimapOffset.x) / minimapScale; const y = minimapWorld.y + (event.clientY - rect.top - minimapOffset.y) / minimapScale; updateViewport({ x: -x, y: -y }); }} aria-label="Diagram minimap">
        <svg width={minimapWidth} height={minimapHeight} viewBox={`0 0 ${minimapWidth} ${minimapHeight}`}><rect className="minimap-world" x={minimapOffset.x} y={minimapOffset.y} width={minimapWorld.width * minimapScale} height={minimapWorld.height * minimapScale} />{(page?.nodes ?? []).filter((node) => !node.hidden).map((node) => { const point = minimapPoint(node.position); return <rect key={node.id} className={selectedIds.includes(node.id) ? 'minimap-node selected' : 'minimap-node'} x={point.x} y={point.y} width={Math.max(2, node.size.width * minimapScale)} height={Math.max(2, node.size.height * minimapScale)} />; })}<rect className="minimap-viewport" x={minimapViewport.x} y={minimapViewport.y} width={Math.max(2, minimapViewport.width)} height={Math.max(2, minimapViewport.height)} /></svg>
       </div>}
       {view.guides && (page?.guides?.length ?? 0) > 0 && <details className="guide-controls" open={guidesOpen} onToggle={(event) => setGuidesOpen(event.currentTarget.open)}><summary><Ruler size={12} /> Guides <span>{page?.guides?.length}</span></summary><div className="guide-control-list">{page?.guides?.map((guide) => <div key={guide.id} className="guide-control"><i className={guide.orientation} /><span>{guide.orientation === 'vertical' ? `X ${Math.round(guide.position)}` : `Y ${Math.round(guide.position)}`}</span><button title={guide.locked ? 'Unlock guide' : 'Lock guide'} aria-label={guide.locked ? 'Unlock guide' : 'Lock guide'} onClick={() => toggleGuideLock(guide.id)}>{guide.locked ? <Lock size={12} /> : <Unlock size={12} />}</button><button title="Delete guide" aria-label="Delete guide" disabled={guide.locked} onClick={() => removeGuide(guide.id)}><Trash2 size={12} /></button></div>)}</div></details>}
   </div>;
}

function EdgeView({ edge, source, target, obstacles, route: providedRoute, jumps, background, selected, labelPointOverride, onPointerDown, onDoubleClick, onLabelPointerDown, onHover, onWaypointPointerDown, onSegmentPointerDown }: { edge: DiagramEdge; source?: DiagramNode; target?: DiagramNode; obstacles: DiagramNode[]; route?: Point[]; jumps: RouteJump[]; background: string; selected: boolean; labelPointOverride?: Point; onPointerDown: (event: ReactPointerEvent<SVGGElement>, edge: DiagramEdge) => void; onDoubleClick: (event: ReactMouseEvent<SVGGElement>, edge: DiagramEdge) => void; onLabelPointerDown: (event: ReactPointerEvent<SVGGElement>, edge: DiagramEdge, point: Point) => void; onHover: (edgeId: string | null) => void; onWaypointPointerDown: (event: ReactPointerEvent<SVGCircleElement>, edge: DiagramEdge, index: number, point: Point) => void; onSegmentPointerDown: (event: ReactPointerEvent<SVGLineElement>, edge: DiagramEdge, index: number, start: Point, end: Point) => void }) {
  const route = providedRoute ?? edgeRoute(edge, source, target, obstacles);
  if (route.length < 2) return null;
  const start = route[0];
  const end = route[route.length - 1];
  const label = typeof edge.data?.label === 'string' ? edge.data.label : null;
  const labelPoint = labelPointOverride ?? labelPointForEdge(edge, route);
  const startDirection = endpointDirection(start, route[1], source);
  const endDirection = endpointDirection(end, route.at(-2) ?? start, target);
  const curveStartDirection = source ? startDirection : { x: -startDirection.x, y: -startDirection.y };
  const curveEndDirection = target ? { x: -endDirection.x, y: -endDirection.y } : endDirection;
  const jumpStyle = edge.style.jumpStyle ?? 'arc';
  const renderedJumps = jumpStyle === 'arc' ? jumps : [];
   const routing = edgeRouting(edge);
    const path = routing === 'curved' && route.length <= 2 ? curvedPath(route, curveStartDirection, curveEndDirection) : pointsToPath(route, renderedJumps, routing === 'orthogonal' ? edge.style.cornerRadius ?? 0 : 0);
   const masks = routing === 'orthogonal' && jumpStyle !== 'none' ? jumpMaskPaths(route, jumps) : [];
    const waypointHandles = selected && routing === 'orthogonal'
      ? edge.waypoints.length > 0
        ? edge.waypoints.map((point, index) => <circle key={`waypoint-${index}`} className="edge-waypoint" data-waypoint-index={index} cx={point.x} cy={point.y} r="5" onPointerDown={(event) => onWaypointPointerDown(event, edge, index, point)} />)
      : route.slice(1, -1).map((point, index) => <circle key={`auto-waypoint-${point.x}-${point.y}-${index}`} className="edge-waypoint auto" cx={point.x} cy={point.y} r="5" onPointerDown={(event) => onWaypointPointerDown(event, edge, index, point)} />)
     : null;
   const segmentHandles = selected && routing === 'orthogonal'
     ? <g className="edge-segment-handles">{route.slice(0, -1).map((point, index) => {
       const endPoint = route[index + 1];
       if (distanceBetween(point, endPoint) < 0.001) return null;
       return <line key={`segment-${index}`} className="edge-segment-handle" data-segment-index={index} x1={point.x} y1={point.y} x2={endPoint.x} y2={endPoint.y} stroke="transparent" strokeWidth={Math.max(14, edge.style.strokeWidth + 8)} style={{ cursor: Math.abs(endPoint.x - point.x) > Math.abs(endPoint.y - point.y) ? 'ns-resize' : 'ew-resize' }} pointerEvents="stroke" onPointerDown={(event) => onSegmentPointerDown(event, edge, index, point, endPoint)} />;
     })}</g>
     : null;
  return <g className={`canvas-edge ${selected ? 'selected' : ''}`} data-edge-id={edge.id} onPointerEnter={() => onHover(edge.id)} onPointerLeave={() => onHover(null)} onPointerDown={(event) => onPointerDown(event, edge)} onDoubleClick={(event) => onDoubleClick(event, edge)}>
    <path className="edge-shadow" d={path} fill="none" stroke="#0a0c12" strokeWidth={edge.style.strokeWidth + 5} opacity="0.72" pointerEvents="none" />
    {selected && <path className="edge-selection" d={path} fill="none" stroke="#a28fff" strokeWidth={edge.style.strokeWidth + 5} opacity="0.22" pointerEvents="none" />}
    {masks.map((mask, index) => <path key={`jump-mask-${index}`} d={mask} fill="none" stroke={background} strokeWidth={edge.style.strokeWidth + 4} strokeLinecap="round" pointerEvents="none" />)}
     <path className="edge-visible" d={path} fill="none" stroke={edge.style.stroke} strokeWidth={edge.style.strokeWidth} opacity={edge.style.opacity ?? 1} strokeDasharray={edge.style.dash === 'dashed' ? '8 6' : edge.style.dash === 'dotted' ? '2 5' : undefined} pointerEvents="none" />
    <path className="edge-hit-area" d={path} fill="none" stroke="#ffffff" strokeOpacity="0" strokeWidth={Math.max(14, edge.style.strokeWidth + 8)} pointerEvents="stroke" />
     {segmentHandles}
     {waypointHandles}
      {label && <g className="edge-label-group" transform={`translate(${labelPoint.x} ${labelPoint.y})`} pointerEvents="all" onPointerDown={(event) => onLabelPointerDown(event, edge, labelPoint)}><rect x={-Math.max(28, label.length * 3.5 + 9)} y={-12} width={Math.max(56, label.length * 7 + 18)} height={22} rx={11} fill={typeof edge.data.labelBackground === 'string' ? edge.data.labelBackground : background} stroke={selected ? '#7968c5' : '#3a4258'} opacity={edge.style.opacity ?? 1} /><text className="edge-label" textAnchor="middle" y="4" style={{ fill: edge.style.labelColor, opacity: edge.style.opacity ?? 1 }}>{label}</text></g>}
  </g>;
}

function EdgeMarkersView({ edge, source, target, obstacles, route: providedRoute, markerFill }: { edge: DiagramEdge; source?: DiagramNode; target?: DiagramNode; obstacles: DiagramNode[]; route?: Point[]; markerFill: string }) {
  const route = providedRoute ?? edgeRoute(edge, source, target, obstacles);
  if (route.length < 2) return null;
  const start = route[0];
  const end = route[route.length - 1];
  const startDirection = markerDirection(start, route[1]);
  const endDirection = markerDirection(end, route.at(-2) ?? start);
  return <>{renderEndpointMarker(start, startDirection, edge.style.startMarker, edge.style.stroke, markerFill, 'start', edge.style.opacity ?? 1)}{renderEndpointMarker(end, endDirection, edge.style.endMarker, edge.style.stroke, markerFill, 'end', edge.style.opacity ?? 1)}</>;
}

function EdgeEndpointHandles({ edge, source, target, obstacles, selected, hovered, onPointerDown }: { edge: DiagramEdge; source?: DiagramNode; target?: DiagramNode; obstacles: DiagramNode[]; selected: boolean; hovered: boolean; onPointerDown: (event: ReactPointerEvent<SVGCircleElement>, edge: DiagramEdge, endpoint: 'source' | 'target', point: Point) => void }) {
  if (!selected && !hovered) return null;
  const route = edgeRoute(edge, source, target, obstacles);
  if (route.length < 2) return null;
  const start = route[0];
  const end = route.at(-1) ?? start;
  return <>
    <circle className={`edge-endpoint-handle source ${hovered && !selected ? 'hovered' : ''}`} data-edge-endpoint="source" cx={start.x} cy={start.y} r="7" onPointerDown={(event) => onPointerDown(event, edge, 'source', start)} />
    <circle className={`edge-endpoint-handle target ${hovered && !selected ? 'hovered' : ''}`} data-edge-endpoint="target" cx={end.x} cy={end.y} r="7" onPointerDown={(event) => onPointerDown(event, edge, 'target', end)} />
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

/** Every endpoint notation follows the same connector tangent as an arrowhead. */
function markerDirection(point: Point, neighbor: Point): Point {
  return directionBetween(point, neighbor);
}

function directionBetween(from: Point, to: Point): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length > 0.001 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : { x: 1, y: 0 };
}

function nearestRoutePoint(route: Point[], point: Point): { segmentIndex: number; point: Point; distance: number } | null {
  let nearest: { segmentIndex: number; point: Point; distance: number } | null = null;
  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared > 0 ? Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
    const candidate = { x: start.x + dx * ratio, y: start.y + dy * ratio };
    const distance = distanceBetween(candidate, point);
    if (!nearest || distance < nearest.distance) nearest = { segmentIndex: index, point: candidate, distance };
  }
  return nearest;
}

function labelPointForEdge(edge: DiagramEdge, route: Point[]): Point {
  const saved = edge.data.labelPosition;
  if (saved && typeof saved === 'object' && Number.isFinite((saved as { x?: unknown }).x) && Number.isFinite((saved as { y?: unknown }).y)) {
    return { x: Number((saved as { x: number }).x), y: Number((saved as { y: number }).y) };
  }
  const preset = edge.data.labelPositionPreset;
  const presetRatio = preset === 'start' ? 0.2 : preset === 'quarter' ? 0.25 : preset === 'three-quarter' ? 0.75 : preset === 'end' ? 0.8 : undefined;
  if (presetRatio !== undefined) return pointAlongRoute(route, presetRatio);
  const start = route[0] ?? { x: 0, y: 0 };
  const end = route.at(-1) ?? start;
  return route.length === 2
    ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    : route[Math.floor(route.length / 2)] ?? start;
}

function pointAlongRoute(route: Point[], ratio: number): Point {
  if (route.length < 2) return route[0] ?? { x: 0, y: 0 };
  const lengths = route.slice(1).map((point, index) => distanceBetween(route[index], point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = total * Math.min(1, Math.max(0, ratio));
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (remaining <= length) {
      const start = route[index];
      const end = route[index + 1];
      const factor = length > 0 ? remaining / length : 0;
      return { x: start.x + (end.x - start.x) * factor, y: start.y + (end.y - start.y) * factor };
    }
    remaining -= length;
  }
  return route.at(-1)!;
}


function directionAngle(direction: Point): number {
  const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
  return Math.abs(angle) === 180 ? 180 : angle;
}

function renderEndpointMarker(point: Point, direction: Point, marker: EdgeMarker, stroke: string, fill: string, key: string, opacity = 1) {
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
  return <g key={key} className="edge-marker" transform={`translate(${point.x} ${point.y}) rotate(${angle})`} opacity={opacity} pointerEvents="none">{glyph}</g>;
}

function sameEndpoint(left: Endpoint, right: Endpoint): boolean {
  return left.nodeId === right.nodeId
    && left.port === right.port
    && left.anchorId === right.anchorId
    && left.offset === right.offset
    && left.point?.x === right.point?.x
    && left.point?.y === right.point?.y;
}

function shapeIconForQuickCreate(icon: string) {
  return <span aria-hidden="true">{icon === 'diamond' ? '◇' : icon === 'circle' ? '○' : icon === 'line' ? '—' : icon === 'database' || icon === 'table' ? '▤' : '□'}</span>;
}

function NodeView({ node, position, selected, connectorStart, connectorTarget, showPorts, diagramType, onPointerDown, onResizePointerDown, onDoubleClick }: { node: DiagramNode; position: Point; selected: boolean; connectorStart: boolean; connectorTarget: boolean; showPorts: boolean; diagramType: string; onPointerDown: (event: ReactPointerEvent<SVGElement>, node: DiagramNode, port?: ConnectionPort, offset?: number, anchorId?: string) => void; onResizePointerDown: (event: ReactPointerEvent<SVGRectElement>, node: DiagramNode, handle: ResizeHandle) => void; onDoubleClick: (event: ReactMouseEvent<SVGGElement>, node: DiagramNode) => void }) {
  const width = node.size.width;
  const height = node.size.height;
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
  return <g className={`canvas-node ${node.container ? 'container-node' : ''} ${selected ? 'selected' : ''} ${connectorStart ? 'connector-start' : ''} ${connectorTarget ? 'connector-target' : ''}`} data-node-id={node.id} transform={`translate(${position.x} ${position.y}) rotate(${node.rotation} ${width / 2} ${height / 2})`} onPointerDown={(event) => onPointerDown(event, node)} onDoubleClick={(event) => onDoubleClick(event, node)}>
    <NodeGraphic node={node} diagramType={diagramType} />
      {showPorts && <g className="connection-ports">{ports.map((port) => <circle key={port.id} className={port.fieldPort ? 'connection-port field-port' : 'connection-port'} data-port={port.id} data-connection-port={port.port} data-connection-offset={port.offset} cx={port.x} cy={port.y} r={port.fieldPort ? 4 : 5} onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, node, port.port, port.offset, port.id); }} />)}</g>}
     {selected && <g className="node-handles" pointerEvents="all"><rect x={-5} y={-5} width={width + 10} height={height + 10} rx={node.style.radius + 3} fill="none" stroke="#a28fff" strokeWidth="1.5" strokeDasharray="4 3" pointerEvents="none" />{resizeHandles.map((handle) => <rect key={handle.id} className="handle" x={handle.x} y={handle.y} width="8" height="8" style={{ cursor: handle.cursor }} onPointerDown={(event) => onResizePointerDown(event, node, handle.id)} />)}</g>}
  </g>;
}
