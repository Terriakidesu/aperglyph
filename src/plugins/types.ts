import type { Diagnostic, DiagramType, EdgeStyle, NodeStyle, ShapeBoundary, Size } from '../core/types';
import type { ConnectionPort } from '../core/geometry';
import type { DiagramNode } from '../core/types';
import type { DocumentCommand } from '../core/commands';

export type ShapeIconId = 'square' | 'rounded-rectangle' | 'circle' | 'diamond' | 'text' | 'line' | 'database' | 'table' | 'workflow';

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
  tags?: string[];
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
