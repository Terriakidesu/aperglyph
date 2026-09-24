import type { NodeStyle, Point, Size } from './types';

/** Source languages understood by the code importer. */
export type CodeLanguage = 'mermaid' | 'plantuml' | 'dot' | 'dbml' | 'sql' | 'json' | 'csv';

/** Diagram families are deliberately smaller than the shape catalog. */
export type DiagramIRType = 'graph' | 'flowchart' | 'erd' | 'dfd' | 'use-case';

export type IRDirection = 'TB' | 'BT' | 'LR' | 'RL';

export type IRRouting = 'straight' | 'orthogonal' | 'curved';

export interface IRDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
  endColumn?: number;
  code?: string;
}

/**
 * A source-neutral node. `shape` is a source notation hint, not a persisted
 * AperGlyph type. The compiler is responsible for mapping it to a native
 * library shape for the target diagram family.
 */
export interface IRNode {
  id: string;
  label: string;
  shape?: string;
  semanticType?: string;
  data?: Record<string, unknown>;
  style?: Partial<NodeStyle>;
  size?: Size;
  position?: Point;
  line?: number;
}

export interface IREdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  relationship?: string;
  startMarker?: string;
  endMarker?: string;
  routing?: IRRouting;
  dash?: 'solid' | 'dashed' | 'dotted';
  data?: Record<string, unknown>;
  line?: number;
}

export interface IRGroup {
  id: string;
  label: string;
  children: string[];
  direction?: IRDirection;
  line?: number;
}

export interface DiagramIR {
  type: DiagramIRType;
  direction: IRDirection;
  nodes: IRNode[];
  edges: IREdge[];
  groups: IRGroup[];
  title?: string;
  metadata?: Record<string, unknown>;
  diagnostics?: IRDiagnostic[];
}

export interface CodeParseResult {
  language: CodeLanguage;
  ir: DiagramIR | null;
  diagnostics: IRDiagnostic[];
  warnings: IRDiagnostic[];
}

export interface CodeImportResult extends CodeParseResult {
  document: import('./types').DiagramDocument | null;
}

export interface DetectedCode {
  language: CodeLanguage;
  confidence: 'high' | 'medium';
  reason: string;
}

export function emptyDiagramIR(type: DiagramIRType = 'graph', direction: IRDirection = 'TB'): DiagramIR {
  return { type, direction, nodes: [], edges: [], groups: [] };
}

export function diagnostic(
  message: string,
  line?: number,
  column?: number,
  severity: IRDiagnostic['severity'] = 'error',
  code?: string,
): IRDiagnostic {
  return { severity, message, ...(line === undefined ? {} : { line }), ...(column === undefined ? {} : { column }), ...(code ? { code } : {}) };
}
