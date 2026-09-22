export type DiagramType = 'general' | 'flowchart' | 'erd' | 'dfd' | 'use-case';

export type ToolId = 'select' | 'pan' | 'connector' | 'text' | 'shape';

export interface Point {
  x: number;
  y: number;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/** A normalized, locatable semantic/editor diagnostic. */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  code?: string;
  plugin?: string;
  pageId?: string;
  nodeId?: string;
  edgeId?: string;
}

export interface Size {
  width: number;
  height: number;
}

/** Boundary model used for connector intersection math. */
export type ShapeBoundary = 'rectangle' | 'ellipse' | 'diamond';

export type CanvasTheme = 'dark' | 'light';
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type FontWeight = 400 | 500 | 600 | 700;

export interface Bounds extends Point, Size {}

export interface NodeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  opacity: number;
  textColor: string;
  fontSize: number;
  fontWeight: FontWeight;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  textWrap: boolean;
  autoHeight: boolean;
}

export interface StylePreset {
  id: string;
  name: string;
  style: Partial<NodeStyle>;
}

export interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  dash: 'solid' | 'dashed' | 'dotted';
  startMarker: EdgeMarker;
  endMarker: EdgeMarker;
  labelColor: string;
  opacity?: number;
  jumpStyle?: 'arc' | 'gap' | 'none';
}

export type EdgeMarker = 'none' | 'arrow' | 'bar' | 'circle' | 'crowfoot' | 'circle-bar' | 'bar-crowfoot' | 'circle-crowfoot';

export interface Endpoint {
  /** Attached node. Omit this for a free-standing canvas endpoint. */
  nodeId?: string;
  port?: string;
  /** Optional stable shape-anchor identity, such as an ERD field row. */
  anchorId?: string;
  /** Normalized position along a cardinal node port (0 = top/left, 1 = bottom/right). */
  offset?: number;
  /** World-space location used when the endpoint is not attached to a node. */
  point?: Point;
}

export interface DiagramNode {
  id: string;
  library: string;
  type: string;
  position: Point;
  size: Size;
  rotation: number;
  /** Optional persisted geometry for extensible shape definitions. */
  boundary?: ShapeBoundary;
  style: NodeStyle;
  data: Record<string, unknown>;
  locked?: boolean;
  hidden?: boolean;
  groupId?: string;
  /** Explicit container ownership. Children are never inferred from overlap. */
  containerId?: string;
  container?: boolean;
  zIndex?: number;
}

export type NodePatch = Partial<Omit<DiagramNode, 'style' | 'data'>> & {
  style?: Partial<NodeStyle>;
  data?: Record<string, unknown>;
};

export interface DiagramEdge {
  id: string;
  type: string;
  source: Endpoint;
  target: Endpoint;
  waypoints: Point[];
  style: EdgeStyle;
  data: Record<string, unknown>;
}

export type GuideOrientation = 'horizontal' | 'vertical';

export interface DiagramGuide {
  id: string;
  orientation: GuideOrientation;
  position: number;
  locked?: boolean;
}

/** Independent snapping targets. `snapToGrid` remains as a legacy mirror for
 * documents written before the individual controls existed. */
export interface SnapSettings {
  grid: boolean;
  objects: boolean;
  guides: boolean;
  ports: boolean;
}

export type EdgePatch = Partial<Pick<DiagramEdge, 'type' | 'source' | 'target' | 'waypoints'>> & {
  style?: Partial<EdgeStyle>;
  data?: Record<string, unknown>;
};

export interface PageSettings {
  width: number;
  height: number;
  background: string;
  canvasTheme: CanvasTheme;
  gridSize: number;
  gridVisible: boolean;
  snapToGrid: boolean;
  snapSettings: SnapSettings;
}

export interface DiagramPage {
  id: string;
  name: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  settings: PageSettings;
  guides?: DiagramGuide[];
  /** Optional semantic metadata owned by a diagram plugin. */
  data?: Record<string, unknown>;
}

export type PageSettingsPatch = Partial<Omit<PageSettings, 'snapSettings'>> & { snapSettings?: Partial<SnapSettings> };

export interface ClipboardPayload {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface DiagramDocument {
  schemaVersion: number;
  id: string;
  name: string;
  diagramType: DiagramType;
  pages: DiagramPage[];
  palette: string[];
  stylePresets: StylePreset[];
  createdAt: number;
  updatedAt: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface SelectionState {
  ids: string[];
  primaryId: string | null;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  lastAction: string | null;
}

export interface SerializedProject {
  format: 'aperglyph';
  formatVersion: 1;
  document: DiagramDocument;
}
