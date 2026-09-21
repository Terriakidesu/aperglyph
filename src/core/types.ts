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
  startMarker: 'none' | 'arrow' | 'circle';
  endMarker: 'none' | 'arrow' | 'circle';
  labelColor: string;
}

export interface Endpoint {
  nodeId: string;
  port?: string;
}

export interface DiagramNode {
  id: string;
  library: string;
  type: string;
  position: Point;
  size: Size;
  rotation: number;
  style: NodeStyle;
  data: Record<string, unknown>;
  locked?: boolean;
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
