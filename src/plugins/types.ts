import type { Diagnostic, DiagramType, EdgeStyle, NodeStyle, ShapeBoundary, Size } from '../core/types';
import type { ConnectionPort } from '../core/geometry';
import type { DiagramNode } from '../core/types';
import type { DocumentCommand } from '../core/commands';

export type ShapeIconId = 'square' | 'rounded-rectangle' | 'circle' | 'diamond' | 'text' | 'line' | 'database' | 'table' | 'workflow' | 'cloud' | 'triangle' | 'hexagon' | 'pentagon' | 'package' | 'arrow' | 'data';

/** A stable connection point exposed by a shape definition. */
export interface ShapeAnchor {
  id: string;
  port: ConnectionPort;
  offset?: number;
}

/**
 * Shape-specific anchors are code, not document data. This keeps saved files
 * portable while allowing a new shape module to describe row, socket, or
 * perimeter anchors without changing the canvas interaction code.
 */
export type ShapeAnchorResolver = (node: DiagramNode) => ShapeAnchor[];

export interface ShapeDefinition {
  id: string;
  type: string;
  label: string;
  icon: ShapeIconId;
  defaultSize?: Size;
  defaultStyle?: Partial<NodeStyle>;
  defaultData?: Record<string, unknown>;
  /** Stable semantic role used by validators, notation variants, and search. */
  semanticRole?: string;
  /** Diagram notation or family represented by this shape. */
  notation?: string;
  /** Optional notation choices for semantic shapes that share one type. */
  notationOptions?: Array<{ value: string; label: string }>;
  /** Alternate terms users commonly use when searching for this shape. */
  aliases?: string[];
  tags?: string[];
  /** Sidebar subsection, such as Basic, Data, or Annotations. */
  category?: string;
  /** Reuses a renderer already supplied by the canvas/exporter. */
  renderer?: string;
  /** Controls connector intersection math for this shape. */
  boundary?: ShapeBoundary;
  /** Marks the shape as an explicit owner for separately assigned children. */
  container?: boolean;
  /** Omit for the standard four cardinal perimeter anchors. */
  anchors?: ShapeAnchorResolver;
}

export interface ConnectorDefinition {
  id: string;
  label: string;
  routing: 'straight' | 'orthogonal' | 'curved';
  defaultStyle?: Partial<EdgeStyle>;
}

export interface ValidatorDefinition {
  id: string;
  label: string;
  validate: (document: unknown) => Diagnostic[];
  quickFix?: (diagnostic: Diagnostic, document: unknown) => DocumentCommand | null;
}

export interface DiagramPlugin {
  id: DiagramType;
  name: string;
  description: string;
  shapes: ShapeDefinition[];
  connectors: ConnectorDefinition[];
  validators: ValidatorDefinition[];
}
