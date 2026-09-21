import type { DiagramType, EdgeStyle, NodeStyle, Size } from '../core/types';

export type ShapeIconId = 'square' | 'rounded-rectangle' | 'circle' | 'diamond' | 'text' | 'line' | 'database' | 'table' | 'workflow';

export interface ShapeDefinition {
  id: string;
  type: string;
  label: string;
  icon: ShapeIconId;
  defaultSize?: Size;
  defaultStyle?: Partial<NodeStyle>;
  defaultData?: Record<string, unknown>;
  tags?: string[];
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
  validate: (document: unknown) => string[];
}

export interface DiagramPlugin {
  id: DiagramType;
  name: string;
  description: string;
  shapes: ShapeDefinition[];
  connectors: ConnectorDefinition[];
  validators: ValidatorDefinition[];
}
