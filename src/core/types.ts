export type DiagramType = 'general' | 'flowchart' | 'erd' | 'dfd' | 'use-case';

export type ToolId = 'select' | 'pan' | 'connector' | 'text' | 'shape';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Boundary model used for connector intersection math. */
export type ShapeBoundary = 'rectangle' | 'ellipse' | 'diamond';

export interface Bounds extends Point, Size {}

export interface NodeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  opacity: number;
  textColor: string;
}

export interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  dash: 'solid' | 'dashed' | 'dotted';
  startMarker: EdgeMarker;
  endMarker: EdgeMarker;
  labelColor: string;
}

export type EdgeMarker = 'none' | 'arrow' | 'bar' | 'circle' | 'crowfoot' | 'circle-bar' | 'bar-crowfoot' | 'circle-crowfoot';

export interface Endpoint {
  /** Attached node. Omit this for a free-standing canvas endpoint. */
  nodeId?: string;
  port?: string;
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

export type EdgePatch = Partial<Pick<DiagramEdge, 'type' | 'source' | 'target' | 'waypoints'>> & {
  style?: Partial<EdgeStyle>;
  data?: Record<string, unknown>;
};

export interface PageSettings {
  width: number;
  height: number;
  background: string;
  gridSize: number;
  gridVisible: boolean;
  snapToGrid: boolean;
}

export interface DiagramPage {
  id: string;
  name: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  settings: PageSettings;
  guides?: DiagramGuide[];
}

export type PageSettingsPatch = Partial<PageSettings>;

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
