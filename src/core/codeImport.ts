import { createDocument, createEdge, createNode, defaultEdgeStyle } from './document';
import { entityAutoHeight, entityAutoWidth, entityFieldPortOffset, normalizeEntityFields, type EntityField } from './erd';
import { layoutErdNodes, layoutNodes } from './layout';
import { parseErdSql } from './erdSql';
import { nodeCenter } from './geometry';
import type { DiagramDocument, DiagramEdge, DiagramNode, DiagramType, NodeStyle, Point, Size } from './types';
import { pluginManager } from '../plugins';
import type { ShapeDefinition } from '../plugins';
import {
  diagnostic,
  emptyDiagramIR,
  type CodeImportResult,
  type CodeLanguage,
  type CodeParseResult,
  type DetectedCode,
  type DiagramIR,
  type DiagramIRType,
  type IREdge,
  type IRDiagnostic,
  type IRDirection,
  type IRGroup,
  type IRNode,
  type IRRouting,
} from './diagramIR';

const MAX_CODE_LENGTH = 10 * 1024 * 1024;
const MAX_CODE_NODES = 50000;
const MAX_CODE_EDGES = 100000;
const MAX_CODE_GROUPS = 5000;

const CODE_LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  mermaid: 'Mermaid',
  plantuml: 'PlantUML',
  dot: 'Graphviz DOT',
  dbml: 'DBML',
  sql: 'SQL schema',
  json: 'Diagram JSON',
  csv: 'CSV relationships',
};

export interface CompileOptions {
  name?: string;
  preserveLayout?: boolean;
  layout?: boolean;
}

export interface ImportOptions extends CompileOptions {
  language?: CodeLanguage;
}

/** Starter snippets used by the Code panel. They are intentionally small and editable. */
export const CODE_TEMPLATES: Record<CodeLanguage, Array<{ id: string; label: string; description: string; source: string }>> = {
  mermaid: [
    { id: 'flowchart', label: 'Flowchart', description: 'A decision flow with a labeled branch.', source: 'flowchart LR\n    A[Customer] --> B{Approved?}\n    B -->|Yes| C[Transaction]\n    B -->|No| D[Archive]' },
    { id: 'er', label: 'ER diagram', description: 'Tables and a one-to-many relationship.', source: 'erDiagram\n    CUSTOMER ||--o{ BOOKING : places\n    CUSTOMER {\n        int id PK\n        string name\n    }\n    BOOKING {\n        int id PK\n        int customer_id FK\n    }' },
    { id: 'blank', label: 'Blank', description: 'Start with a blank Mermaid graph.', source: 'flowchart TD\n    A[Start] --> B[Next step]' },
  ],
  plantuml: [
    { id: 'use-case', label: 'Use case', description: 'Actors and include relationships.', source: '@startuml\nleft to right direction\nactor Customer\nusecase "Submit booking" as Submit\nusecase "Authenticate" as Auth\nCustomer --> Submit\nSubmit ..> Auth : <<include>>\n@enduml' },
    { id: 'class', label: 'Class diagram', description: 'A compact class relationship.', source: '@startuml\nclass Customer\nclass Booking\nCustomer "1" --> "many" Booking\n@enduml' },
    { id: 'blank', label: 'Blank', description: 'Start with an empty PlantUML document.', source: '@startuml\n\n@enduml' },
  ],
  dot: [
    { id: 'directed', label: 'Directed graph', description: 'A small directed service graph.', source: 'digraph G {\n    rankdir=LR;\n    Customer [shape=box];\n    Booking [shape=diamond];\n    Customer -> Booking [label="requests"];\n    Booking -> Payment;\n}' },
    { id: 'blank', label: 'Blank', description: 'Start with an empty DOT graph.', source: 'digraph G {\n}' },
  ],
  dbml: [
    { id: 'schema', label: 'Schema', description: 'Two DBML tables linked by a reference.', source: 'Table customers {\n  id bigint [pk]\n  name varchar\n}\n\nTable bookings {\n  id bigint [pk]\n  customer_id bigint [not null]\n  event_date date\n}\n\nRef: bookings.customer_id > customers.id' },
    { id: 'blank', label: 'Blank', description: 'Start with an empty DBML schema.', source: 'Table users {\n  id bigint [pk]\n}' },
  ],
  sql: [
    { id: 'schema', label: 'SQL schema', description: 'A customer and booking schema.', source: 'CREATE TABLE customer (\n    id BIGINT PRIMARY KEY,\n    name VARCHAR(100) NOT NULL\n);\n\nCREATE TABLE booking (\n    id BIGINT PRIMARY KEY,\n    customer_id BIGINT NOT NULL,\n    FOREIGN KEY (customer_id) REFERENCES customer(id)\n);' },
    { id: 'blank', label: 'Blank', description: 'Start with a SQL table.', source: 'CREATE TABLE users (\n    id BIGINT PRIMARY KEY,\n    name VARCHAR(120)\n);' },
  ],
  json: [
    { id: 'graph', label: 'Diagram JSON', description: 'A source-neutral node and edge graph.', source: '{\n  "type": "flowchart",\n  "direction": "LR",\n  "nodes": [\n    { "id": "request", "label": "Request", "shape": "process" },\n    { "id": "approved", "label": "Approved?", "shape": "decision" }\n  ],\n  "edges": [\n    { "source": "request", "target": "approved" }\n  ]\n}' },
    { id: 'blank', label: 'Blank', description: 'Start with an empty IR graph.', source: '{\n  "type": "graph",\n  "direction": "TB",\n  "nodes": [],\n  "edges": []\n}' },
  ],
  csv: [
    { id: 'relationships', label: 'Relationships', description: 'One relationship per row.', source: 'source,target,label\nCustomer,Booking,places\nBooking,Transaction,creates\nTransaction,Database,writes' },
    { id: 'nodes', label: 'Nodes', description: 'A simple node list.', source: 'id,label\ncustomer,Customer\nbooking,Booking\ntransaction,Transaction' },
  ],
};

export function codeLanguageLabel(language: CodeLanguage): string {
  return CODE_LANGUAGE_LABELS[language];
}

export function parseDiagramCode(source: string, language: CodeLanguage): CodeParseResult {
  if (source.length > MAX_CODE_LENGTH) {
    const result = emptyResult(language);
    result.diagnostics.push(diagnostic('This source is too large to compile safely.', 1, 1, 'error', 'source-too-large'));
    return result;
  }
  switch (language) {
    case 'mermaid': return parseMermaidSource(source);
    case 'plantuml': return parsePlantUmlSource(source);
    case 'dot': return parseDotSource(source);
    case 'dbml': return parseDbmlSource(source);
    case 'sql': return parseSqlSource(source);
    case 'json': return parseJsonSource(source);
    case 'csv': return parseCsvSource(source);
  }
}

export function importDiagramCode(source: string, language: CodeLanguage, options: ImportOptions = {}): CodeImportResult {
  const parsed = parseDiagramCode(source, language);
  if (!parsed.ir || parsed.diagnostics.some((item) => item.severity === 'error')) return { ...parsed, document: null };
  return { ...parsed, document: compileDiagramIR(parsed.ir, { ...options, name: options.name ?? `Imported ${codeLanguageLabel(language)} diagram` }) };
}

/** Compile the shared IR into ordinary AperGlyph nodes and connectors. */
export function compileDiagramIR(ir: DiagramIR, options: CompileOptions = {}): DiagramDocument {
  const document = createDocument(options.name ?? ir.title ?? 'Imported diagram', diagramTypeForIR(ir.type));
  const page = document.pages[0];
  const sourceToNative = new Map<string, DiagramNode>();
  const normalNodes: DiagramNode[] = [];
  const importedEdgePairs: Array<{ source: IREdge; native: DiagramEdge }> = [];

  ir.nodes.slice(0, MAX_CODE_NODES).forEach((sourceNode) => {
    const mapping = nativeShapeForNode(ir.type, sourceNode);
    const shape = pluginManager.getShape(mapping.library, mapping.type) ?? pluginManager.getShape('general', 'rectangle');
    const fields = mapping.type === 'entity' ? normalizeEntityFields(sourceNode.data?.fields) : undefined;
    const compactEntity = Boolean(fields && !options.preserveLayout);
    const suppliedSize = sourceNode.size ?? shape?.defaultSize ?? defaultSizeForMapping(mapping);
    const size = fields && compactEntity
      ? { ...suppliedSize, width: entityAutoWidth(fields, sourceNode.data?.entityVariant, true) }
      : suppliedSize;
    const height = fields ? Math.max(size.height, entityAutoHeight(fields, sourceNode.data?.entityVariant, sourceNode.data?.columnHeaders === true)) : size.height;
    const data = {
      ...(shape?.defaultData ?? {}),
      ...(sourceNode.data ?? {}),
      label: sourceNode.label,
      ...(compactEntity ? { compact: true, columnHeaders: false } : {}),
      ...(fields ? { fields } : {}),
      codeImport: true,
      sourceId: sourceNode.id,
    };
    const node = createNode(mapping.type, sourceNode.position ?? { x: 0, y: 0 }, {
      library: mapping.library,
      size: { width: Math.max(40, size.width), height: Math.max(32, height) },
      boundary: shape?.boundary,
      container: shape?.container,
      style: { ...(shape?.defaultStyle ?? {}), ...(compactEntity ? { fontSize: 13, fontWeight: 500, radius: 8 } : {}), ...(sourceNode.style ?? {}) },
      data,
    });
    node.zIndex = 0;
    if (sourceNode.position) node.data.sourcePosition = structuredClone(sourceNode.position);
    page.nodes.push(node);
    normalNodes.push(node);
    sourceToNative.set(sourceNode.id, node);
  });

  const importedEdges: DiagramEdge[] = [];
  ir.edges.slice(0, MAX_CODE_EDGES).forEach((sourceEdge) => {
    const source = sourceToNative.get(sourceEdge.source);
    const target = sourceToNative.get(sourceEdge.target);
    if (!source || !target) return;
    const routing = sourceEdge.routing ?? routingForIR(ir.type, sourceEdge.relationship);
    const foreignKey = ir.type === 'erd' && sourceEdge.relationship === 'foreign-key';
    const sourceFields = source.type === 'entity' ? normalizeEntityFields(source.data.fields) : [];
    const sourceField = typeof sourceEdge.data?.sourceFieldId === 'string' ? sourceFields.find((field) => field.id === sourceEdge.data?.sourceFieldId) : undefined;
    const startMarker = foreignKey
      ? sourceField?.nullable ? 'circle-crowfoot' : 'crowfoot'
      : edgeMarker(sourceEdge.startMarker, markerDefaults(ir.type, sourceEdge.relationship).start);
    const endMarker = foreignKey
      ? 'bar'
      : edgeMarker(sourceEdge.endMarker, markerDefaults(ir.type, sourceEdge.relationship).end);
    const sourceEndpoint = entityEndpoint(source, sourceEdge.data?.sourceFieldId, target, ir.direction, 'source');
    const targetEndpoint = entityEndpoint(target, sourceEdge.data?.targetFieldId, source, ir.direction, 'target');
    const edge = createEdge(
      sourceEndpoint,
      targetEndpoint,
      {
        type: edgeTypeForIR(ir.type, sourceEdge.relationship, routing),
        routing: routing === 'orthogonal' ? { mode: 'auto' } : undefined,
        style: { ...defaultEdgeStyle, ...(ir.type === 'erd' ? { stroke: '#111111', strokeWidth: 1.4 } : {}), startMarker, endMarker, dash: sourceEdge.dash ?? dashForRelationship(sourceEdge.relationship) },
        data: {
          ...(sourceEdge.data ?? {}),
          ...(sourceEdge.label && !foreignKey ? { label: sourceEdge.label } : {}),
          ...(sourceEdge.relationship ? { relationship: sourceEdge.relationship } : {}),
          ...(foreignKey ? { cardinality: { source: sourceField?.nullable ? '0..N' : 'N', target: '1' } } : {}),
          codeImport: true,
          sourceId: sourceEdge.id,
        },
      },
    );
    importedEdgePairs.push({ source: sourceEdge, native: edge });
    importedEdges.push(edge);
    page.edges.push(edge);
  });

  const shouldLayout = options.layout !== false && !(options.preserveLayout || ir.metadata?.preserveLayout === true);
  if (shouldLayout && normalNodes.length > 0) {
    const positions = ir.type === 'erd'
      ? layoutErdNodes(normalNodes, importedEdges, ir.direction === 'LR' || ir.direction === 'RL' ? 'horizontal' : 'vertical')
      : layoutNodes(normalNodes, importedEdges, layoutModeForDirection(ir.direction));
    const reversed = reverseLayout(positions, normalNodes, ir.direction);
    const margin = 84;
    normalNodes.forEach((node) => {
      const position = reversed[node.id] ?? node.position;
      node.position = { x: position.x + margin, y: position.y + margin };
    });
  }

  // SQL/DBML edges retain child -> parent semantics so FK metadata and the
  // native row anchors remain stable. Resolve their perimeter side again after
  // the dependency-aware layout so the connector leaves the actual FK row and
  // reaches the referenced key row from the correct side.
  if (ir.type === 'erd') {
    importedEdgePairs.forEach(({ source: sourceEdge, native: edge }) => {
      const source = edge.source.nodeId ? sourceToNative.get(sourceEdge.source) : undefined;
      const target = edge.target.nodeId ? sourceToNative.get(sourceEdge.target) : undefined;
      if (!source || !target) return;
      edge.source = entityEndpoint(source, sourceEdge.data?.sourceFieldId, target, ir.direction, 'source');
      edge.target = entityEndpoint(target, sourceEdge.data?.targetFieldId, source, ir.direction, 'target');
    });
  }

  const groupNodes = compileGroups(ir.groups, ir.type, sourceToNative);
  page.nodes.push(...groupNodes);
  repairEntityReferences(page.nodes, sourceToNative);
  updatePageSize(page, page.nodes);
  document.updatedAt = Date.now();
  return document;
}

/** Detect only high-signal snippets so ordinary clipboard text remains text. */
export function detectDiagramCode(source: string): DetectedCode | null {
  const text = source.trim();
  if (!text) return null;
  if (/^(?:flowchart|graph|erDiagram|stateDiagram|classDiagram|sequenceDiagram)\b/im.test(text)) return { language: 'mermaid', confidence: 'high', reason: 'Mermaid diagram header detected' };
  if (/@startuml\b/i.test(text) || /@enduml\b/i.test(text)) return { language: 'plantuml', confidence: 'high', reason: 'PlantUML block detected' };
  if (/^(?:strict\s+)?(?:di)?graph\b/im.test(text) && /(?:->|--)/.test(text)) return { language: 'dot', confidence: 'high', reason: 'Graphviz graph header detected' };
  if (/^\s*(?:Table|TableGroup)\s+[\w.]+\s*\{/im.test(text)) return { language: 'dbml', confidence: 'high', reason: 'DBML table declaration detected' };
  if (/\bcreate\s+table\b/i.test(text) && /\(/.test(text)) return { language: 'sql', confidence: 'high', reason: 'SQL CREATE TABLE detected' };
  if ((text.startsWith('{') || text.startsWith('[')) && looksLikeDiagramJson(text)) return { language: 'json', confidence: 'medium', reason: 'Diagram JSON structure detected' };
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  if (/^(?:source\s*,\s*target|id\s*,\s*label)\b/i.test(firstLine) && text.includes(',')) return { language: 'csv', confidence: 'medium', reason: 'Relationship CSV header detected' };
  return null;
}

function emptyResult(language: CodeLanguage): CodeParseResult {
  return { language, ir: null, diagnostics: [], warnings: [] };
}

function success(language: CodeLanguage, ir: DiagramIR, diagnostics: IRDiagnostic[] = [], warnings: IRDiagnostic[] = []): CodeParseResult {
  ir.diagnostics = diagnostics;
  return { language, ir, diagnostics, warnings };
}

function fail(language: CodeLanguage, diagnostics: IRDiagnostic[], ir?: DiagramIR): CodeParseResult {
  return { language, ir: ir ?? null, diagnostics, warnings: [] };
}

function lineEntries(source: string): Array<{ text: string; line: number }> {
  return source.split(/\r?\n/).map((text, index) => ({ text, line: index + 1 }));
}

function addNode(ir: DiagramIR, nodes: Map<string, IRNode>, source: Partial<IRNode> & { id: string; label?: string }, groupStack: string[] = []): IRNode {
  const id = cleanIdentifier(source.id) || `node_${nodes.size + 1}`;
  const existing = nodes.get(id);
  if (existing) {
    if (source.label && (existing.label === existing.id || existing.label.trim() === '')) existing.label = source.label;
    if (source.shape) existing.shape = source.shape;
    if (source.semanticType) existing.semanticType = source.semanticType;
    if (source.data) existing.data = { ...(existing.data ?? {}), ...source.data };
    if (source.style) existing.style = { ...(existing.style ?? {}), ...source.style };
    return existing;
  }
  if (nodes.size >= MAX_CODE_NODES) return { id, label: source.label ?? id };
  const node: IRNode = { id, label: source.label?.trim() || id, ...(source.shape ? { shape: source.shape } : {}), ...(source.semanticType ? { semanticType: source.semanticType } : {}), ...(source.data ? { data: structuredClone(source.data) } : {}), ...(source.style ? { style: structuredClone(source.style) } : {}), ...(source.size ? { size: { ...source.size } } : {}), ...(source.position ? { position: { ...source.position } } : {}), ...(source.line ? { line: source.line } : {}) };
  nodes.set(id, node);
  ir.nodes.push(node);
  groupStack.forEach((groupId) => {
    const group = ir.groups.find((candidate) => candidate.id === groupId);
    if (group && !group.children.includes(id)) group.children.push(id);
  });
  return node;
}

function addEdge(ir: DiagramIR, source: string, target: string, options: Partial<IREdge> = {}): void {
  if (ir.edges.length >= MAX_CODE_EDGES) return;
  ir.edges.push({ id: options.id ?? `edge_${ir.edges.length + 1}`, source: cleanIdentifier(source), target: cleanIdentifier(target), ...options });
}

function addGroup(ir: DiagramIR, group: IRGroup): void {
  if (ir.groups.length < MAX_CODE_GROUPS && !ir.groups.some((candidate) => candidate.id === group.id)) ir.groups.push(group);
}

function parseMermaidSource(source: string): CodeParseResult {
  const firstMeaningful = lineEntries(source).find(({ text }) => text.trim() && !text.trim().startsWith('%%'));
  const header = firstMeaningful?.text.trim().match(/^(flowchart|graph|stateDiagram(?:-v2)?|classDiagram|sequenceDiagram)\s*(?:(TB|TD|BT|LR|RL))?/i);
  if (/^\s*erDiagram\b/i.test(source)) return parseMermaidEr(source);
  const syntax = header?.[1]?.toLowerCase() ?? '';
  const type: DiagramIRType = syntax === 'flowchart' ? 'flowchart' : 'graph';
  const direction = normalizeDirection(header?.[2] ?? (type === 'flowchart' ? 'TD' : 'TB'));
  const ir = emptyDiagramIR(type, direction);
  const diagnostics: IRDiagnostic[] = [];
  const warnings: IRDiagnostic[] = [];
  const nodes = new Map<string, IRNode>();
  const groupStack: string[] = [];
  const styleClasses = new Map<string, Partial<NodeStyle>>();
  let foundHeader = false;

  lineEntries(source).forEach(({ text: raw, line }) => {
    let text = raw.trim();
    if (!text || text.startsWith('%%')) return;
    if (/^(flowchart|graph|stateDiagram(?:-v2)?|classDiagram|sequenceDiagram)\b/i.test(text)) { foundHeader = true; return; }
    if (syntax === 'sequencediagram' && /^(?:participant|actor)\b/i.test(text)) {
      const participant = text.match(/^(?:participant|actor)\s+([\w.-]+)(?:\s+as\s+(.+))?$/i);
      if (participant) addNode(ir, nodes, { id: participant[1], label: cleanMarkup(participant[2] ?? participant[1]), shape: 'rounded' }, groupStack);
      return;
    }
    if (syntax === 'sequencediagram') {
      const message = text.match(/^([\w.-]+)\s*-+>?\s*([\w.-]+)(?:\s*:\s*(.*))?$/);
      if (message) {
        const sourceNode = addNode(ir, nodes, { id: message[1], label: message[1], shape: 'rounded' }, groupStack);
        const targetNode = addNode(ir, nodes, { id: message[2], label: message[2], shape: 'rounded' }, groupStack);
        addEdge(ir, sourceNode.id, targetNode.id, { label: message[3]?.trim() || undefined, routing: 'straight', line });
        return;
      }
    }
    if (/^(?:direction|accTitle|accDescr|linkStyle|click|subgraphDir)\b/i.test(text)) {
      if (/^direction\s+(LR|RL|TB|BT)\b/i.test(text)) ir.direction = normalizeDirection(text.match(/\b(LR|RL|TB|BT)\b/i)?.[1] ?? ir.direction);
      return;
    }
    if (/^subgraph\b/i.test(text)) {
      const match = text.match(/^subgraph\s+(.+?)(?:\s+\[([^\]]+)\])?$/i);
      const rawName = match?.[1]?.trim() ?? `group_${ir.groups.length + 1}`;
      const idMatch = rawName.match(/^([\w-]+)\s*(?:\[|$)/);
      const id = cleanIdentifier(idMatch?.[1] ?? `group_${ir.groups.length + 1}`);
      const label = stripQuotes(match?.[2] ?? rawName.replace(/^([\w-]+)\s*/, '').trim()) || id;
      addGroup(ir, { id, label, children: [], line });
      groupStack.push(id);
      return;
    }
    if (/^end\s*$/i.test(text)) { groupStack.pop(); return; }
    const style = text.match(/^style\s+([\w-]+)\s+(.+)$/i);
    if (style) {
      const node = addNode(ir, nodes, { id: style[1], label: style[1] }, groupStack);
      node.style = { ...(node.style ?? {}), ...parseStyleProperties(style[2]) };
      return;
    }
    const classDef = text.match(/^classDef\s+([\w-]+)\s+(.+)$/i);
    if (classDef) { styleClasses.set(classDef[1], parseStyleProperties(classDef[2])); return; }
    const classApply = text.match(/^class\s+([\w,& -]+)\s+([\w-]+)/i);
    if (classApply) {
      classApply[1].split(',').map((item) => item.trim()).filter(Boolean).forEach((id) => {
        const node = addNode(ir, nodes, { id, label: id }, groupStack);
        node.style = { ...(node.style ?? {}), ...(styleClasses.get(classApply[2]) ?? {}) };
      });
      return;
    }
    const linkStyle = text.match(/^linkStyle\s+([\d,]+)\s+(.+)$/i);
    if (linkStyle) return;
    if (/^(?:%%|click\b|callback\b)/i.test(text)) return;

    // Mermaid permits multiple statements on one line separated by semicolons.
    text.split(';').map((statement) => statement.trim()).filter(Boolean).forEach((statement) => {
      const edgeParts = parseMermaidEdgeChain(statement);
      if (edgeParts.length === 0) {
        const token = statement.replace(/^&\s*/, '').trim();
        if (!token || /^(?:classDef|style)\b/i.test(token)) return;
        const node = parseMermaidNodeToken(token, line);
        if (!node) {
          if (looksLikeMalformedMermaidNode(token)) diagnostics.push(diagnostic('Malformed Mermaid node syntax.', line, 1, 'error', 'mermaid-node'));
          else warnings.push(diagnostic(`Ignored Mermaid statement “${truncate(token)}”.`, line, 1, 'warning', 'mermaid-unsupported'));
          return;
        }
        addNode(ir, nodes, node, groupStack);
        return;
      }
      edgeParts.forEach((part) => {
        const leftNodes = part.sources.flatMap((token) => {
          const parsed = parseMermaidNodeToken(token, line);
          if (!parsed) {
            diagnostics.push(diagnostic('Malformed Mermaid node syntax.', line, 1, 'error', 'mermaid-node'));
            return [];
          }
          return [addNode(ir, nodes, parsed, groupStack)];
        });
        const parsedTarget = parseMermaidNodeToken(part.target, line);
        if (!parsedTarget) {
          diagnostics.push(diagnostic('Malformed Mermaid target node syntax.', line, 1, 'error', 'mermaid-node'));
          return;
        }
        const right = addNode(ir, nodes, parsedTarget, groupStack);
        leftNodes.forEach((left) => addEdge(ir, left.id, right.id, { label: part.label || undefined, routing: part.routing, dash: part.dash, endMarker: part.directed ? 'arrow' : 'none', line }));
      });
    });
  });
  if (!foundHeader && ir.nodes.length === 0) diagnostics.push(diagnostic('Add a Mermaid header such as “flowchart LR”.', firstMeaningful?.line ?? 1, 1, 'error', 'mermaid-header'));
  if (ir.nodes.length === 0 && diagnostics.length === 0) warnings.push(diagnostic('The source does not contain any diagram objects yet.', 1, 1, 'warning', 'empty-diagram'));
  return success('mermaid', ir, diagnostics, warnings);
}

function parseMermaidEr(source: string): CodeParseResult {
  const ir = emptyDiagramIR('erd', 'LR');
  const diagnostics: IRDiagnostic[] = [];
  const warnings: IRDiagnostic[] = [];
  const nodes = new Map<string, IRNode>();
  let current: IRNode | null = null;
  lineEntries(source).forEach(({ text: raw, line }) => {
    const text = raw.trim();
    if (!text || text.startsWith('%%') || /^erDiagram$/i.test(text)) return;
    if (text === '}') { current = null; return; }
    if (text.endsWith('{')) {
      const id = cleanIdentifier(text.slice(0, -1).trim());
      if (!id) { diagnostics.push(diagnostic('Expected an entity name before “{”.', line, 1, 'error', 'mermaid-er-entity')); return; }
      current = addNode(ir, nodes, { id, label: id, shape: 'entity', semanticType: 'entity', data: { fields: [] }, line });
      return;
    }
    if (current) {
      const field = parseMermaidEntityField(text, current.id, line);
      if (field) {
        const fields = Array.isArray(current.data?.fields) ? current.data!.fields as unknown[] : [];
        current.data = { ...(current.data ?? {}), fields: [...fields, field] };
      } else warnings.push(diagnostic(`Ignored entity member “${truncate(text)}”.`, line, 1, 'warning', 'mermaid-er-member'));
      return;
    }
    const relation = text.match(/^([\w.-]+)\s+([^\s]+)\s+([\w.-]+)(?:\s*:\s*(.+))?$/);
    if (relation && /[-.]/.test(relation[2])) {
      const sourceNode = addNode(ir, nodes, { id: relation[1], label: relation[1], shape: 'entity', semanticType: 'entity', data: { fields: [] }, line }, []);
      const targetNode = addNode(ir, nodes, { id: relation[3], label: relation[3], shape: 'entity', semanticType: 'entity', data: { fields: [] }, line }, []);
      const marker = relation[2];
      addEdge(ir, sourceNode.id, targetNode.id, {
        label: relation[4]?.trim(),
        relationship: 'relationship',
        startMarker: cardinalityMarker(marker.slice(0, Math.floor(marker.length / 2)), 'start'),
        endMarker: cardinalityMarker(marker.slice(Math.floor(marker.length / 2)), 'end'),
        routing: 'orthogonal',
        line,
      });
      return;
    }
    warnings.push(diagnostic(`Ignored Mermaid ER statement “${truncate(text)}”.`, line, 1, 'warning', 'mermaid-er-unsupported'));
  });
  if (ir.nodes.length === 0) diagnostics.push(diagnostic('No entities were found in the Mermaid ER diagram.', 1, 1, 'error', 'mermaid-er-empty'));
  return success('mermaid', ir, diagnostics, warnings);
}

function parseMermaidEntityField(text: string, nodeId: string, line: number): EntityField | null {
  const parts = text.split(/\s+/).map((part) => stripQuotes(part)).filter(Boolean);
  if (parts.length < 2) return null;
  const type = parts[0];
  const name = parts[1];
  const flags = new Set(parts.slice(2).map((part) => part.toUpperCase().replace(/[,:]/g, '')));
  return {
    id: `field_${slug(nodeId)}_${slug(name)}`,
    name,
    type,
    primaryKey: flags.has('PK') || flags.has('PRIMARYKEY'),
    foreignKey: flags.has('FK') || flags.has('FOREIGNKEY'),
    unique: flags.has('UK') || flags.has('UNIQUE'),
    nullable: !flags.has('NN') && !flags.has('NOTNULL'),
    ...(line ? { description: `Imported at line ${line}` } : {}),
  };
}

function parsePlantUmlSource(source: string): CodeParseResult {
  const ir = emptyDiagramIR('graph', 'TB');
  const diagnostics: IRDiagnostic[] = [];
  const warnings: IRDiagnostic[] = [];
  const nodes = new Map<string, IRNode>();
  const aliases = new Map<string, string>();
  const groupStack: string[] = [];
  let sawUseCase = false;
  let sawClass = false;
  let sawHeader = false;
  lineEntries(source).forEach(({ text: raw, line }) => {
    const text = raw.replace(/'[^]*$/, '').trim();
    if (!text) return;
    if (/^@startuml\b/i.test(text)) { sawHeader = true; return; }
    if (/^@enduml\b/i.test(text)) return;
    if (/^(?:left|right)\s+to\s+right\s+direction$/i.test(text)) { ir.direction = 'LR'; return; }
    if (/^top\s+to\s+bottom\s+direction$/i.test(text)) { ir.direction = 'TB'; return; }
    if (/^(?:package|rectangle|frame|node|folder|cloud)\b.*\{$/i.test(text)) {
      const match = text.match(/^(?:package|rectangle|frame|node|folder|cloud)\s+(?:"([^"]+)"|([\w.-]+))(?:\s+as\s+([\w.-]+))?/i);
      const id = cleanIdentifier(match?.[3] ?? match?.[1] ?? match?.[2] ?? `group_${ir.groups.length + 1}`);
      addGroup(ir, { id, label: match?.[1] ?? match?.[2] ?? id, children: [], line });
      groupStack.push(id);
      return;
    }
    if (text === '}') { groupStack.pop(); return; }
    const classBlock = text.match(/^(class|interface|enum)\s+(?:"([^"]+)"\s+as\s+)?([\w.-]+)?\s*\{$/i);
    if (classBlock) {
      sawClass = true;
      const id = cleanIdentifier(classBlock[3] ?? classBlock[2] ?? `class_${nodes.size + 1}`);
      addNode(ir, nodes, { id, label: classBlock[2] ?? id, shape: 'class', semanticType: classBlock[1].toLowerCase(), data: { fields: [] }, line }, groupStack);
      return;
    }
    if (/^actor\b/i.test(text) || /^usecase\b/i.test(text)) {
      const match = text.match(/^(actor|usecase)\s+(?:"([^"]+)"|\(([^)]+)\)|([\w.-]+))(?:\s+as\s+([\w.-]+))?/i);
      if (!match) { diagnostics.push(diagnostic('Expected an actor or use-case name.', line, 1, 'error', 'plantuml-declaration')); return; }
      sawUseCase = true;
      const label = match[2] ?? match[3] ?? match[4] ?? 'Unnamed';
      const id = cleanIdentifier(match[5] ?? label);
      aliases.set(id, id);
      addNode(ir, nodes, { id, label, shape: match[1].toLowerCase() === 'actor' ? 'actor' : 'use-case', semanticType: match[1].toLowerCase(), line }, groupStack);
      return;
    }
    const declaration = text.match(/^(database|component|rectangle|node|class|interface|enum|artifact|object)\s+(?:"([^"]+)"\s+as\s+)?([\w.-]+)(?:\s*\{)?$/i);
    if (declaration) {
      const keyword = declaration[1].toLowerCase();
      if (keyword === 'class' || keyword === 'interface' || keyword === 'enum') sawClass = true;
      const label = declaration[2] ?? declaration[3];
      const id = cleanIdentifier(declaration[3]);
      aliases.set(id, id);
      addNode(ir, nodes, { id, label, shape: keyword, semanticType: keyword, line }, groupStack);
      return;
    }
    const relationText = text
      .replace(/^(\S+)\s+"[^"]+"\s+(?=[-.]+>)/, '$1 ')
      .replace(/([-.]+>)\s+"[^"]+"\s+/, '$1 ');
    const relation = relationText.match(/^(.+?)\s+((?:[-.]+)(?:left|right|up|down)?(?:[-.]+>)?|(?:[-.]+>))\s+(.+?)(?:\s*:\s*(.*))?$/i);
    if (relation) {
      const sourceNode = plantumlEndpoint(relation[1], ir, nodes, aliases, groupStack, line);
      const targetNode = plantumlEndpoint(relation[3], ir, nodes, aliases, groupStack, line);
      const label = relation[4]?.trim().replace(/^<<|>>$/g, '');
      const relationship = /include/i.test(relation[4] ?? '') ? 'include' : /extend/i.test(relation[4] ?? '') ? 'extend' : undefined;
      addEdge(ir, sourceNode.id, targetNode.id, { label: label?.replace(/^include$|^extend$/i, '').trim() || undefined, relationship, routing: 'straight', dash: relation[2].includes('.') || relationship ? 'dashed' : 'solid', endMarker: relation[2].includes('>') && (!sawUseCase || Boolean(relationship)) ? 'arrow' : 'none', line });
      return;
    }
    if (/^(?:hide|show|skinparam|title|legend|note|end\s+note|@enduml)/i.test(text)) return;
    if (sawHeader) warnings.push(diagnostic(`PlantUML feature approximated or ignored: “${truncate(text)}”.`, line, 1, 'warning', 'plantuml-unsupported'));
  });
  if (sawUseCase) ir.type = 'use-case';
  else if (sawClass) ir.type = 'graph';
  if (!sawHeader && !source.trim().startsWith('@')) warnings.push(diagnostic('PlantUML @startuml/@enduml markers are recommended.', 1, 1, 'warning', 'plantuml-markers'));
  if (ir.nodes.length === 0) diagnostics.push(diagnostic('No PlantUML objects were found.', 1, 1, 'error', 'plantuml-empty'));
  return success('plantuml', ir, diagnostics, warnings);
}

function plantumlEndpoint(raw: string, ir: DiagramIR, nodes: Map<string, IRNode>, aliases: Map<string, string>, groupStack: string[], line: number): IRNode {
  const token = raw.trim();
  const parenthesized = token.match(/^\((.+)\)$/);
  const quoted = token.match(/^"([^"]+)"(?:\s+as\s+([\w.-]+))?$/);
  const label = parenthesized?.[1] ?? quoted?.[1] ?? token;
  const id = cleanIdentifier(quoted?.[2] ?? label);
  const existing = aliases.get(id);
  if (existing && nodes.get(existing)) return nodes.get(existing)!;
  return addNode(ir, nodes, { id, label, shape: parenthesized ? 'use-case' : undefined, semanticType: parenthesized ? 'use-case' : undefined, line }, groupStack);
}

function parseDotSource(source: string): CodeParseResult {
  const ir = emptyDiagramIR('graph', 'TB');
  const diagnostics: IRDiagnostic[] = [];
  const warnings: IRDiagnostic[] = [];
  const nodes = new Map<string, IRNode>();
  const groupStack: string[] = [];
  const defaultAttributes: Record<string, string> = {};
  const cleaned = expandDotStatements(source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''));
  let sawGraph = false;
  lineEntries(cleaned).forEach(({ text: raw, line }) => {
    let text = raw.trim();
    if (!text) return;
    text = text.replace(/;$/, '').trim();
    if (/^(?:strict\s+)?(?:di)?graph\b/i.test(text)) { sawGraph = true; const rank = text.match(/rankdir\s*=\s*([A-Za-z]+)/i); if (rank) ir.direction = normalizeDirection(rank[1]); return; }
    const rank = text.match(/^rankdir\s*=\s*([A-Za-z]+)/i);
    if (rank) { ir.direction = normalizeDirection(rank[1]); return; }
    if (/^subgraph\b/i.test(text)) {
      const match = text.match(/^subgraph\s+(?:"([^"]+)"|([\w.-]+))\s*\{?/i);
      const id = cleanIdentifier(match?.[2] ?? match?.[1] ?? `cluster_${ir.groups.length + 1}`);
      addGroup(ir, { id, label: match?.[1] ?? match?.[2] ?? id, children: [], line });
      groupStack.push(id);
      return;
    }
    if (text === '}' || text === '};') { groupStack.pop(); return; }
    const attributeDefaults = text.match(/^(node|edge|graph)\s*\[(.*)\]$/i);
    if (attributeDefaults) { Object.assign(defaultAttributes, parseDotAttributes(attributeDefaults[2])); return; }
    const edge = parseDotEdge(text);
    if (edge) {
      const sourceTokens = edge.source.split(/\s+(?:-->|->|--)\s+/).filter(Boolean);
      const source = addNode(ir, nodes, dotNodeFromToken(sourceTokens.at(-1) ?? edge.source, defaultAttributes, line), groupStack);
      const target = addNode(ir, nodes, dotNodeFromToken(edge.target, { ...defaultAttributes, ...edge.attributes }, line), groupStack);
      addEdge(ir, source.id, target.id, { label: edge.attributes.label, dash: edge.operator === '->' || edge.operator === '-->' ? 'solid' : 'solid', endMarker: edge.operator.includes('>') ? 'arrow' : 'none', routing: 'orthogonal', data: { dotAttributes: edge.attributes }, line });
      return;
    }
    const declaration = parseDotDeclaration(text);
    if (declaration) {
      const node = addNode(ir, nodes, dotNodeFromToken(declaration.id, { ...defaultAttributes, ...declaration.attributes }, line), groupStack);
      node.style = { ...(node.style ?? {}), ...dotStyle(declaration.attributes) };
      return;
    }
    if (!/^[{}]+$/.test(text)) warnings.push(diagnostic(`Ignored DOT statement “${truncate(text)}”.`, line, 1, 'warning', 'dot-unsupported'));
  });
  if (!sawGraph) diagnostics.push(diagnostic('Add a DOT graph header such as “digraph G {”.', 1, 1, 'error', 'dot-header'));
  if (ir.nodes.length === 0 && diagnostics.length === 0) warnings.push(diagnostic('The DOT graph does not contain any nodes.', 1, 1, 'warning', 'empty-diagram'));
  return success('dot', ir, diagnostics, warnings);
}

function parseDbmlSource(source: string): CodeParseResult {
  const ir = emptyDiagramIR('erd', 'LR');
  const diagnostics: IRDiagnostic[] = [];
  const warnings: IRDiagnostic[] = [];
  const tables = new Map<string, IRNode>();
  const refs: Array<{ leftTable: string; leftField: string; operator: '>' | '<' | '-'; rightTable: string; rightField: string; line: number }> = [];
  const tableGroups: Array<{ id: string; label: string; children: string[]; line: number }> = [];
  let current: IRNode | null = null;
  let currentGroup: { id: string; label: string; children: string[]; line: number } | null = null;
  lineEntries(source).forEach(({ text: raw, line }) => {
    const text = raw.replace(/\/\/.*$/, '').trim();
    if (!text) return;
    const tableMatch = text.match(/^Table\s+([\w.]+)(?:\s+"([^"]+)")?\s*\{/i);
    if (tableMatch) {
      const id = cleanIdentifier(tableMatch[1]);
      current = addNode(ir, tables, { id, label: tableMatch[2] ?? tableMatch[1], shape: 'entity', semanticType: 'entity', data: { fields: [] }, line });
      if (currentGroup) currentGroup.children.push(id);
      return;
    }
    const groupMatch = text.match(/^TableGroup\s+([\w.]+)(?:\s+"([^"]+)")?\s*\{/i);
    if (groupMatch) { currentGroup = { id: cleanIdentifier(groupMatch[1]), label: groupMatch[2] ?? groupMatch[1], children: [], line }; return; }
    if (text === '}') { if (current) current = null; else if (currentGroup) { addGroup(ir, currentGroup); currentGroup = null; } return; }
    const refMatch = text.match(/^(?:Ref(?:\s+[\w.-]+)?\s*:\s*)?([\w.]+)\s*([<>-])\s*([\w.]+)(?:\s*\[.*\])?$/i);
    if (refMatch) {
      const left = splitDbmlRef(refMatch[1]);
      const right = splitDbmlRef(refMatch[3]);
      if (left && right) refs.push({ leftTable: left.table, leftField: left.field, operator: refMatch[2] as '>' | '<' | '-', rightTable: right.table, rightField: right.field, line });
      else warnings.push(diagnostic('DBML references must use table.field notation.', line, 1, 'warning', 'dbml-reference'));
      return;
    }
    if (current) {
      const field = text.match(/^([\w.-]+)\s+([^\s\[]+)(?:\s+\[([^\]]+)\])?/);
      if (!field) { warnings.push(diagnostic(`Ignored DBML table member “${truncate(text)}”.`, line, 1, 'warning', 'dbml-member')); return; }
      const attributes = splitAttributes(field[3] ?? '');
      const entityFields = Array.isArray(current.data?.fields) ? current.data!.fields as EntityField[] : [];
      const fieldData: EntityField = {
        id: `field_${slug(current.id)}_${slug(field[1])}`,
        name: stripQuotes(field[1]),
        type: field[2],
        primaryKey: attributes.some((item) => /^pk$/i.test(item)),
        foreignKey: attributes.some((item) => /^fk$/i.test(item)),
        unique: attributes.some((item) => /^unique$/i.test(item)),
        nullable: !attributes.some((item) => /^(?:not\s+null|nn)$/i.test(item)),
        ...(line ? { description: `Imported at line ${line}` } : {}),
      };
      const ref = attributes.find((item) => /^ref\s*:/i.test(item));
      if (ref) {
        const value = ref.replace(/^ref\s*:\s*/i, '').trim();
        const operator = value[0] === '>' || value[0] === '<' ? value[0] : '>';
        const target = splitDbmlRef(value.slice(1).trim());
        if (target) {
          refs.push({ leftTable: current.id, leftField: fieldData.name, operator, rightTable: target.table, rightField: target.field, line });
          fieldData.foreignKey = true;
        }
      }
      entityFields.push(fieldData);
      current.data = { ...(current.data ?? {}), fields: entityFields };
      return;
    }
    if (/^(?:Project|Note|Enum)\b/i.test(text)) return;
    warnings.push(diagnostic(`Ignored DBML statement “${truncate(text)}”.`, line, 1, 'warning', 'dbml-unsupported'));
  });
  refs.forEach((ref) => {
    let sourceTable = ref.leftTable;
    let sourceField = ref.leftField;
    let targetTable = ref.rightTable;
    let targetField = ref.rightField;
    if (ref.operator === '<') {
      sourceTable = ref.rightTable; sourceField = ref.rightField; targetTable = ref.leftTable; targetField = ref.leftField;
    }
    const source = tables.get(cleanIdentifier(sourceTable));
    const target = tables.get(cleanIdentifier(targetTable));
    if (!source || !target) { diagnostics.push(diagnostic(`DBML reference points to an unknown table (${sourceTable} or ${targetTable}).`, ref.line, 1, 'error', 'dbml-missing-table')); return; }
    const sourceFields = (source.data?.fields as EntityField[] | undefined) ?? [];
    const targetFields = (target.data?.fields as EntityField[] | undefined) ?? [];
    const sourceColumn = sourceFields.find((field) => field.name.toLowerCase() === sourceField.toLowerCase());
    const targetColumn = targetFields.find((field) => field.name.toLowerCase() === targetField.toLowerCase());
    if (!sourceColumn || !targetColumn) { warnings.push(diagnostic(`DBML reference field could not be matched (${sourceTable}.${sourceField}).`, ref.line, 1, 'warning', 'dbml-missing-field')); return; }
    sourceColumn.foreignKey = true;
    sourceColumn.reference = { entityId: target.id, fieldId: targetColumn.id, constraintId: `ref_${slug(source.id)}_${slug(sourceColumn.name)}` };
     addEdge(ir, source.id, target.id, { relationship: 'foreign-key', startMarker: sourceColumn.nullable ? 'circle-crowfoot' : 'crowfoot', endMarker: 'bar', routing: 'orthogonal', data: { sourceFieldId: sourceColumn.id, targetFieldId: targetColumn.id, cardinality: { source: sourceColumn.nullable ? '0..N' : 'N', target: '1' } }, line: ref.line });
  });
  tableGroups.forEach((group) => addGroup(ir, group));
  if (ir.nodes.length === 0) diagnostics.push(diagnostic('No DBML tables were found.', 1, 1, 'error', 'dbml-empty'));
  return success('dbml', ir, diagnostics, warnings);
}

function parseSqlSource(source: string): CodeParseResult {
  try {
    const document = parseErdSql(source, 'Imported SQL schema');
    if (document.pages[0]?.nodes.length === 0) return fail('sql', [diagnostic('No CREATE TABLE statements were found.', 1, 1, 'error', 'sql-empty')]);
    const ir = documentToIR(document);
    ir.metadata = { ...(ir.metadata ?? {}), preserveLayout: false };
    return success('sql', ir, [], []);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to parse SQL schema.';
    const line = findErrorLine(source, message);
    return fail('sql', [diagnostic(message, line, 1, 'error', 'sql-parse')]);
  }
}

function parseJsonSource(source: string): CodeParseResult {
  try {
    const parsed: unknown = JSON.parse(source);
    if (isRecord(parsed) && parsed.format === 'aperglyph' && isRecord(parsed.document)) {
      const document = parsed.document as unknown as DiagramDocument;
      return success('json', documentToIR(document), [], []);
    }
    const value = isRecord(parsed) ? parsed : Array.isArray(parsed) ? { nodes: parsed, edges: [] } : null;
    if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return fail('json', [diagnostic('Diagram JSON must contain nodes and edges arrays.', 1, 1, 'error', 'json-shape')]);
    const ir = emptyDiagramIR(isDiagramIRType(value.type) ? value.type : 'graph', normalizeDirection(typeof value.direction === 'string' ? value.direction : 'TB'));
    const diagnostics: IRDiagnostic[] = [];
    const nodes = new Map<string, IRNode>();
    value.nodes.forEach((candidate, index) => {
      if (!isRecord(candidate) || typeof candidate.id !== 'string') { diagnostics.push(diagnostic(`Node ${index + 1} needs a string id.`, index + 1, 1, 'error', 'json-node')); return; }
      addNode(ir, nodes, { id: candidate.id, label: typeof candidate.label === 'string' ? candidate.label : candidate.id, shape: typeof candidate.shape === 'string' ? candidate.shape : typeof candidate.type === 'string' ? candidate.type : undefined, semanticType: typeof candidate.semanticType === 'string' ? candidate.semanticType : undefined, data: isRecord(candidate.data) ? candidate.data : undefined, style: isRecord(candidate.style) ? candidate.style as Partial<NodeStyle> : undefined, size: isSize(candidate.size) ? candidate.size : undefined, position: isPoint(candidate.position) ? candidate.position : undefined });
    });
    value.edges.forEach((candidate, index) => {
      if (!isRecord(candidate) || typeof candidate.source !== 'string' || typeof candidate.target !== 'string') { diagnostics.push(diagnostic(`Edge ${index + 1} needs source and target ids.`, index + 1, 1, 'error', 'json-edge')); return; }
      if (!nodes.has(candidate.source) || !nodes.has(candidate.target)) { diagnostics.push(diagnostic(`Edge ${index + 1} references an unknown node.`, index + 1, 1, 'error', 'json-edge-reference')); return; }
      addEdge(ir, candidate.source, candidate.target, { id: typeof candidate.id === 'string' ? candidate.id : undefined, label: typeof candidate.label === 'string' ? candidate.label : undefined, relationship: typeof candidate.relationship === 'string' ? candidate.relationship : undefined, startMarker: typeof candidate.startMarker === 'string' ? candidate.startMarker : undefined, endMarker: typeof candidate.endMarker === 'string' ? candidate.endMarker : undefined, routing: isRouting(candidate.routing) ? candidate.routing : undefined, dash: isDash(candidate.dash) ? candidate.dash : undefined, data: isRecord(candidate.data) ? candidate.data : undefined });
    });
    if (Array.isArray(value.groups)) value.groups.forEach((candidate) => { if (isRecord(candidate) && typeof candidate.id === 'string' && Array.isArray(candidate.children)) addGroup(ir, { id: candidate.id, label: typeof candidate.label === 'string' ? candidate.label : candidate.id, children: candidate.children.filter((id): id is string => typeof id === 'string') }); });
    return success('json', ir, diagnostics, []);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON.';
    return fail('json', [diagnostic(`Invalid JSON: ${message}`, 1, 1, 'error', 'json-parse')]);
  }
}

function parseCsvSource(source: string): CodeParseResult {
  const ir = emptyDiagramIR('graph', 'LR');
  const diagnostics: IRDiagnostic[] = [];
  const warnings: IRDiagnostic[] = [];
  const rows = parseCsvRows(source);
  if (rows.length < 2) return fail('csv', [diagnostic('CSV needs a header row and at least one data row.', 1, 1, 'error', 'csv-empty')]);
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const sourceIndex = findHeader(headers, ['source', 'from', 'parent']);
  const targetIndex = findHeader(headers, ['target', 'to', 'child']);
  const idIndex = findHeader(headers, ['id', 'key', 'node']);
  const labelIndex = findHeader(headers, ['label', 'name', 'title']);
  const typeIndex = findHeader(headers, ['type', 'shape']);
  const nodes = new Map<string, IRNode>();
  rows.slice(1).forEach((row, rowIndex) => {
    const line = rowIndex + 2;
    if (row.every((value) => !value.trim())) return;
    if (sourceIndex >= 0 && targetIndex >= 0) {
      const sourceValue = row[sourceIndex]?.trim();
      const targetValue = row[targetIndex]?.trim();
      if (!sourceValue || !targetValue) { warnings.push(diagnostic('Skipped a relationship with an empty endpoint.', line, 1, 'warning', 'csv-endpoint')); return; }
      addNode(ir, nodes, { id: sourceValue, label: sourceValue, line });
      addNode(ir, nodes, { id: targetValue, label: targetValue, line });
      const label = labelIndex >= 0 ? row[labelIndex]?.trim() : undefined;
      addEdge(ir, sourceValue, targetValue, { label: label || undefined, line });
    } else {
      const id = row[idIndex >= 0 ? idIndex : 0]?.trim();
      if (!id) { warnings.push(diagnostic('Skipped a node with an empty id.', line, 1, 'warning', 'csv-node')); return; }
      addNode(ir, nodes, { id, label: row[labelIndex >= 0 ? labelIndex : Math.min(1, row.length - 1)]?.trim() || id, shape: typeIndex >= 0 ? row[typeIndex]?.trim() : undefined, line });
    }
  });
  if (ir.nodes.length === 0) diagnostics.push(diagnostic('CSV did not contain any importable rows.', 2, 1, 'error', 'csv-empty'));
  return success('csv', ir, diagnostics, warnings);
}

function parseMermaidEdgeChain(line: string): Array<{ sources: string[]; target: string; label?: string; routing: IRRouting; dash: 'solid' | 'dashed' | 'dotted'; directed: boolean }> {
  const result: Array<{ sources: string[]; target: string; label?: string; routing: IRRouting; dash: 'solid' | 'dashed' | 'dotted'; directed: boolean }> = [];
  const labeled = line.match(/^(.+?)\s+--\s*([^>]+?)\s*-->\s*(.+)$/);
  if (labeled) {
    return [{ sources: splitMermaidSources(labeled[1]), target: labeled[3].trim(), label: stripQuotes(labeled[2].trim()), routing: 'straight', dash: 'solid', directed: true }];
  }
  let cursor = 0;
  let first = true;
  while (cursor < line.length) {
    const match = findMermaidOperator(line, cursor);
    if (!match) break;
    const left = line.slice(cursor, match.start).trim();
    if (!left) break;
    let after = match.end;
    let label = '';
    if (line[after] === '|') {
      const close = line.indexOf('|', after + 1);
      if (close >= 0) { label = stripQuotes(line.slice(after + 1, close).trim()); after = close + 1; }
    }
    const next = findMermaidOperator(line, after);
    const targetEnd = next?.start ?? line.length;
    const target = line.slice(after, targetEnd).trim();
    if (!target) break;
    result.push({ sources: splitMermaidSources(left), target, ...(label ? { label } : {}), routing: match.routing, dash: match.dash, directed: match.directed });
    cursor = targetEnd;
    first = false;
  }
  return first ? [] : result;
}

function findMermaidOperator(line: string, from: number): { start: number; end: number; routing: IRRouting; dash: 'solid' | 'dashed' | 'dotted'; directed: boolean } | null {
  const expression = /-\.-?>|==+>|--+>|---/g;
  expression.lastIndex = from;
  const match = expression.exec(line);
  if (!match) return null;
  const token = match[0];
  return { start: match.index, end: expression.lastIndex, routing: token.includes('.') ? 'curved' : 'straight', dash: token.includes('.') ? 'dashed' : 'solid', directed: token.includes('>') };
}

function splitMermaidSources(value: string): string[] {
  return value.split('&').map((item) => item.trim()).filter(Boolean);
}

function parseMermaidNodeToken(token: string, line?: number): Partial<IRNode> & { id: string; label?: string } | null {
  let value = token.trim().replace(/^[,;]/, '').replace(/[,;]$/, '').trim();
  if (!value || /^(?:subgraph|end|direction)\b/i.test(value)) return null;
  if (/^\[\s*\*\s*\]$/.test(value)) return { id: '__initial_state', label: '', shape: 'circle', line };
  // A Mermaid edge label accidentally left in a token should not become a node.
  value = value.replace(/^\|[^|]*\|\s*/, '').trim();
  const idMatch = value.match(/^(?:"([^"]+)"|([A-Za-z_][\w.-]*))/);
  if (!idMatch) return null;
  const id = idMatch[1] ?? idMatch[2];
  const rest = value.slice(idMatch[0].length).trim();
  if (!rest) return { id, label: id, line };
  const shape = mermaidShape(rest);
  if (!shape) return looksLikeMalformedMermaidNode(rest) ? null : { id, label: id, line };
  return { id, label: cleanMarkup(shape.label) || id, shape: shape.shape, line };
}

function mermaidShape(rest: string): { shape: string; label: string } | null {
  const forms: Array<[string, string, string]> = [
    ['[(', ')]', 'database'],
    ['(((', ')))', 'circle'],
    ['((', '))', 'circle'],
    ['([', '])', 'start'],
    ['[[', ']]', 'subprocess'],
    ['{{', '}}', 'hexagon'],
    ['{', '}', 'decision'],
    ['[/','/]', 'input'],
    ['[\\','\\]', 'input'],
    ['>', ']', 'flag'],
    ['(', ')', 'rounded'],
    ['[', ']', 'rectangle'],
  ];
  for (const [open, close, shape] of forms) {
    if (!rest.startsWith(open)) continue;
    const end = rest.lastIndexOf(close);
    if (end < open.length - 1) return null;
    return { shape, label: rest.slice(open.length, end) };
  }
  return null;
}

function looksLikeMalformedMermaidNode(value: string): boolean {
  return /[\[\]{}()]/.test(value) && !/[\[\]{}()]/.test(value.replace(/[\[\]{}()]/g, ''));
}

function parseStyleProperties(raw: string): Partial<NodeStyle> {
  const style: Partial<NodeStyle> = {};
  raw.split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => {
    const [rawKey, ...rawValue] = part.split(':');
    const key = rawKey.trim().toLowerCase().replace(/[-_]/g, '');
    const value = rawValue.join(':').trim();
    if (!value) return;
    if (key === 'fill' || key === 'background' || key === 'backgroundcolor') style.fill = value;
    else if (key === 'stroke' || key === 'border') style.stroke = value;
    else if (key === 'color' || key === 'textcolor') style.textColor = value;
    else if (key === 'strokewidth' && Number.isFinite(Number(value))) style.strokeWidth = Number(value);
    else if (key === 'opacity' && Number.isFinite(Number(value))) style.opacity = Math.max(0, Math.min(1, Number(value)));
    else if ((key === 'radius' || key === 'rx') && Number.isFinite(Number(value))) style.radius = Number(value);
  });
  return style;
}

function parseDotEdge(text: string): { source: string; target: string; operator: string; attributes: Record<string, string> } | null {
  const match = text.match(/^(.+?)\s+(-->|->|--)\s+(.+?)(?:\s*\[([^\]]*)\])?$/);
  if (!match) return null;
  const source = match[1].trim();
  const target = match[3].trim();
  if (!source || !target) return null;
  return { source, target, operator: match[2], attributes: parseDotAttributes(match[4] ?? '') };
}

function expandDotStatements(source: string): string {
  let output = '';
  let quote = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' && source[index - 1] !== '\\') quote = !quote;
    output += character;
    if (!quote && (character === '{' || character === ';' || character === '}')) output += '\n';
  }
  return output;
}

function parseDotDeclaration(text: string): { id: string; attributes: Record<string, string> } | null {
  const match = text.match(/^("(?:[^"\\]|\\.)*"|[A-Za-z_][\w.-]*)(?:\s*\[([^\]]*)\])?$/);
  if (!match) return null;
  return { id: stripQuotes(match[1]), attributes: parseDotAttributes(match[2] ?? '') };
}

function dotNodeFromToken(token: string, attributes: Record<string, string>, line: number): Partial<IRNode> & { id: string; label?: string } {
  const parsed = parseDotDeclaration(token.trim()) ?? { id: token.trim(), attributes: {} };
  const id = parsed.id.split(':')[0];
  const merged = { ...attributes, ...parsed.attributes };
  const label = merged.label ? stripQuotes(merged.label).replace(/\\n/g, '\n') : id;
  return { id, label, ...(merged.shape ? { shape: merged.shape } : {}), data: { dotAttributes: merged }, style: dotStyle(merged), line };
}

function parseDotAttributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const expression = /([A-Za-z_][\w-]*)\s*=\s*("(?:[^"\\]|\\.)*"|[^,\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(raw))) result[match[1].toLowerCase()] = stripQuotes(match[2]);
  return result;
}

function dotStyle(attributes: Record<string, string>): Partial<NodeStyle> {
  return { ...(attributes.color ? { stroke: attributes.color } : {}), ...(attributes.fillcolor ? { fill: attributes.fillcolor } : {}), ...(attributes.fontcolor ? { textColor: attributes.fontcolor } : {}), ...(attributes.penwidth && Number.isFinite(Number(attributes.penwidth)) ? { strokeWidth: Number(attributes.penwidth) } : {}) };
}

function splitDbmlRef(value: string): { table: string; field: string } | null {
  const match = value.trim().match(/^([\w.]+)\.([\w-]+)$/);
  return match ? { table: cleanIdentifier(match[1]), field: match[2] } : null;
}

function splitAttributes(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseCsvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function findHeader(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.includes(header));
}

function documentToIR(document: DiagramDocument): DiagramIR {
  const page = document.pages[0];
  const type: DiagramIRType = document.diagramType === 'general' ? 'graph' : document.diagramType;
  const ir = emptyDiagramIR(type, normalizeDirection(typeof page?.data?.codeDirection === 'string' ? page.data.codeDirection : 'TB'));
  if (!page) return ir;
  const nativeNodes = new Map(page.nodes.map((node) => [node.id, node]));
  page.nodes.forEach((node) => {
    const label = typeof node.data.label === 'string' && node.data.label.trim() ? node.data.label : node.type;
    ir.nodes.push({ id: node.id, label, shape: node.type, semanticType: node.data.semanticRole as string | undefined, data: structuredClone(node.data), style: structuredClone(node.style), size: { ...node.size }, position: { ...node.position } });
  });
  page.edges.forEach((edge) => {
    if (!edge.source.nodeId || !edge.target.nodeId || !nativeNodes.has(edge.source.nodeId) || !nativeNodes.has(edge.target.nodeId)) return;
    ir.edges.push({ id: edge.id, source: edge.source.nodeId, target: edge.target.nodeId, label: typeof edge.data.label === 'string' ? edge.data.label : undefined, relationship: typeof edge.data.relationship === 'string' ? edge.data.relationship : edge.type, startMarker: edge.style.startMarker, endMarker: edge.style.endMarker, routing: edge.type === 'orthogonal' ? 'orthogonal' : edge.type === 'curved' ? 'curved' : 'straight', dash: edge.style.dash, data: structuredClone(edge.data) });
  });
  const containers = page.nodes.filter((node) => node.container);
  containers.forEach((container) => {
    const children = page.nodes.filter((node) => node.containerId === container.id).map((node) => node.data.sourceId as string ?? node.id);
    if (children.length > 0) ir.groups.push({ id: container.id, label: typeof container.data.label === 'string' ? container.data.label : container.type, children });
  });
  ir.metadata = { preserveLayout: true, sourceDocumentId: document.id };
  return ir;
}

function diagramTypeForIR(type: DiagramIRType): DiagramType {
  return type === 'graph' ? 'general' : type;
}

function nativeShapeForNode(type: DiagramIRType, source: IRNode): { library: string; type: string } {
  const shape = (source.shape ?? source.semanticType ?? '').toLowerCase().replace(/[_\s-]/g, '');
  if (type === 'erd') {
    if (shape === 'view' || source.data?.view === true) return { library: 'erd', type: 'view' };
    if (shape === 'weakentity' || source.data?.weak === true) return { library: 'erd', type: 'weak-entity' };
    if (shape === 'associativeentity' || source.data?.associative === true) return { library: 'erd', type: 'entity' };
    return { library: 'erd', type: 'entity' };
  }
  if (type === 'dfd') {
    if (shape.includes('external') || shape === 'actor' || shape === 'source' || shape === 'sink') return { library: 'dfd', type: 'external' };
    if (shape.includes('store') || shape.includes('database') || shape.includes('repository')) return { library: 'dfd', type: 'store' };
    return { library: 'dfd', type: 'process' };
  }
  if (type === 'use-case') {
    if (shape === 'actor' || source.semanticType === 'actor') return { library: 'use-case', type: 'actor' };
    if (shape.includes('boundary') || shape === 'package' || shape === 'systemboundary') return { library: 'use-case', type: shape === 'package' ? 'package' : 'boundary' };
    if (shape === 'note' || source.semanticType === 'comment') return { library: 'use-case', type: 'note' };
    return { library: 'use-case', type: 'use-case' };
  }
  if (type === 'flowchart') {
    if (shape === 'start' || shape === 'end' || shape === 'terminator' || shape === 'stadium') return { library: 'flowchart', type: 'start' };
    if (shape === 'decision' || shape === 'diamond' || shape === 'rhombus') return { library: 'flowchart', type: 'decision' };
    if (shape === 'database' || shape === 'cylinder' || shape === 'storage') return { library: 'flowchart', type: 'database' };
    if (shape === 'input' || shape === 'io' || shape === 'parallelogram') return { library: 'flowchart', type: 'input' };
    if (shape === 'document') return { library: 'flowchart', type: 'document' };
    if (shape === 'subprocess' || shape === 'predefinedprocess') return { library: 'flowchart', type: 'predefined-process' };
    return { library: 'flowchart', type: 'process' };
  }
  // A generic graph keeps explicit primitive shapes as primitives. This is
  // important for backwards-compatible Mermaid exports such as graph TD.
  if (shape === 'diamond' || shape === 'decision') return { library: 'general', type: 'diamond' };
  if (shape === 'circle' || shape === 'connector') return { library: 'general', type: 'circle' };
  if (shape === 'rounded' || shape === 'roundedrectangle') return { library: 'general', type: 'rounded-rectangle' };
  if (shape === 'database' || shape === 'cylinder') return { library: 'general', type: 'cylinder' };
  if (shape === 'ellipse' || shape === 'oval') return { library: 'general', type: 'ellipse' };
  if (shape === 'class') return { library: 'general', type: 'rectangle' };
  return { library: 'general', type: 'rectangle' };
}

function defaultSizeForMapping(mapping: { library: string; type: string }): Size {
  return pluginManager.getShape(mapping.library, mapping.type)?.defaultSize ?? { width: 180, height: 88 };
}

function routingForIR(type: DiagramIRType, relationship?: string): IRRouting {
  if (type === 'erd' || type === 'dfd') return 'orthogonal';
  if (relationship === 'include' || relationship === 'extend' || relationship === 'comment') return 'straight';
  return 'straight';
}

function edgeTypeForIR(type: DiagramIRType, relationship: string | undefined, routing: IRRouting): string {
  if (type === 'erd') return 'relationship';
  if (type === 'dfd') return 'data-flow';
  if (type === 'use-case') return relationship === 'include' || relationship === 'extend' || relationship === 'comment' ? relationship : 'association';
  return routing;
}

function markerDefaults(type: DiagramIRType, relationship?: string): { start: string; end: string } {
  if (type === 'erd' || relationship === 'foreign-key') return { start: 'bar', end: 'crowfoot' };
  if (type === 'use-case' && (relationship === 'include' || relationship === 'extend')) return { start: 'none', end: 'arrow' };
  if (type === 'use-case') return { start: 'none', end: 'none' };
  return { start: 'none', end: 'arrow' };
}

function edgeMarker(value: string | undefined, fallback: string): DiagramEdge['style']['startMarker'] {
  const supported = new Set<DiagramEdge['style']['startMarker']>(['none', 'arrow', 'bar', 'circle', 'crowfoot', 'circle-bar', 'bar-crowfoot', 'circle-crowfoot']);
  return supported.has(value as DiagramEdge['style']['startMarker']) ? value as DiagramEdge['style']['startMarker'] : supported.has(fallback as DiagramEdge['style']['startMarker']) ? fallback as DiagramEdge['style']['startMarker'] : 'none';
}

function dashForRelationship(relationship?: string): 'solid' | 'dashed' | 'dotted' {
  return relationship === 'include' || relationship === 'extend' || relationship === 'comment' ? 'dashed' : 'solid';
}

function preferredPort(node: DiagramNode, other: DiagramNode, direction: IRDirection): string {
  const center = nodeCenter(node);
  const otherCenter = nodeCenter(other);
  // Use the actual relative position rather than assuming that an edge's
  // source is visually above/left of its target.  ERD foreign-key edges are
  // intentionally stored FK -> PK, while the layout places PK tables first.
  if (direction === 'LR' || direction === 'RL') return otherCenter.x >= center.x ? 'right' : 'left';
  return otherCenter.y >= center.y ? 'bottom' : 'top';
}

function entityEndpoint(node: DiagramNode, fieldId: unknown, other: DiagramNode, direction: IRDirection, side: 'source' | 'target'): DiagramEdge['source'] {
  const fields = node.type === 'entity' ? normalizeEntityFields(node.data.fields) : [];
  const index = typeof fieldId === 'string' ? fields.findIndex((field) => field.id === fieldId) : -1;
  const port = index >= 0 ? preferredEntityFieldPort(node, other, side) : preferredPort(node, other, direction);
  if (index < 0) return { nodeId: node.id, port };
  return { nodeId: node.id, port, anchorId: `field-${index}-${port}`, offset: entityFieldPortOffset(fields, index, node.data.columnHeaders === true, node.size.height) };
}

function preferredEntityFieldPort(node: DiagramNode, other: DiagramNode, _side: 'source' | 'target'): 'left' | 'right' {
  const center = nodeCenter(node);
  const otherCenter = nodeCenter(other);
  // For vertically stacked tables, keep both field anchors on one rail. This
  // produces a clean relationship beside the tables instead of a diagonal
  // loop that crosses the gap between their headers.
  if (Math.abs(otherCenter.x - center.x) < 0.001) return 'right';
  return otherCenter.x >= center.x ? 'right' : 'left';
}

function layoutModeForDirection(direction: IRDirection): 'vertical' | 'hierarchical' {
  return direction === 'TB' || direction === 'BT' ? 'vertical' : 'hierarchical';
}

function reverseLayout(positions: Record<string, Point>, nodes: DiagramNode[], direction: IRDirection): Record<string, Point> {
  if (direction !== 'RL' && direction !== 'BT') return positions;
  const horizontal = direction === 'RL';
  const max = Math.max(...nodes.map((node) => {
    const position = positions[node.id] ?? node.position;
    return horizontal ? position.x + node.size.width : position.y + node.size.height;
  }));
  return Object.fromEntries(nodes.map((node) => {
    const position = positions[node.id] ?? node.position;
    return [node.id, horizontal ? { x: max - position.x - node.size.width, y: position.y } : { x: position.x, y: max - position.y - node.size.height }];
  }));
}

function compileGroups(groups: IRGroup[], type: DiagramIRType, sourceToNative: Map<string, DiagramNode>): DiagramNode[] {
  const result: DiagramNode[] = [];
  groups.forEach((group) => {
    const children = group.children.map((id) => sourceToNative.get(id)).filter((node): node is DiagramNode => Boolean(node));
    if (children.length === 0) return;
    const minX = Math.min(...children.map((node) => node.position.x));
    const minY = Math.min(...children.map((node) => node.position.y));
    const maxX = Math.max(...children.map((node) => node.position.x + node.size.width));
    const maxY = Math.max(...children.map((node) => node.position.y + node.size.height));
    const mapping = type === 'erd' ? { library: 'erd', type: 'schema' } : type === 'use-case' ? { library: 'use-case', type: 'boundary' } : { library: 'general', type: 'frame' };
    const shape = pluginManager.getShape(mapping.library, mapping.type);
    const container = createNode(mapping.type, { x: minX - 32, y: minY - 48 }, { library: mapping.library, size: { width: Math.max(220, maxX - minX + 64), height: Math.max(150, maxY - minY + 80) }, container: true, boundary: shape?.boundary, style: shape?.defaultStyle, data: { ...(shape?.defaultData ?? {}), label: group.label, codeImport: true, sourceId: group.id } });
    container.zIndex = -100;
    children.forEach((child) => { child.containerId = container.id; });
    result.push(container);
  });
  return result;
}

function repairEntityReferences(nodes: DiagramNode[], sourceToNative: Map<string, DiagramNode>): void {
  const nativeById = new Map(nodes.map((node) => [node.id, node]));
  nodes.filter((node) => node.type === 'entity').forEach((node) => {
    const fields = normalizeEntityFields(node.data.fields).map((field) => {
      const reference = field.reference;
      if (!reference) return field;
      const target = sourceToNative.get(reference.entityId) ?? nativeById.get(reference.entityId);
      return target ? { ...field, reference: { ...reference, entityId: target.id } } : field;
    });
    node.data = { ...node.data, fields };
    node.size.height = Math.max(node.size.height, entityAutoHeight(fields, node.data.entityVariant, node.data.columnHeaders === true));
  });
}

function updatePageSize(page: DiagramDocument['pages'][number], nodes: DiagramNode[]): void {
  if (nodes.length === 0) return;
  const maxX = Math.max(...nodes.map((node) => node.position.x + node.size.width));
  const maxY = Math.max(...nodes.map((node) => node.position.y + node.size.height));
  page.settings.width = Math.max(page.settings.width, Math.ceil(maxX + 160));
  page.settings.height = Math.max(page.settings.height, Math.ceil(maxY + 160));
}

function cardinalityMarker(value: string, side: 'start' | 'end'): string {
  const normalized = value.replace(/-/g, '');
  if (normalized.includes('o') && normalized.includes('{')) return 'circle-crowfoot';
  if (normalized.includes('|') && normalized.includes('{')) return 'bar-crowfoot';
  if (normalized.includes('{')) return 'crowfoot';
  if (normalized.includes('o') && normalized.includes('|')) return 'circle-bar';
  if (normalized.includes('o')) return 'circle';
  if (normalized.includes('|')) return 'bar';
  return side === 'end' ? 'crowfoot' : 'bar';
}

function normalizeDirection(value: string): IRDirection {
  const normalized = value.toUpperCase();
  if (normalized === 'BT' || normalized === 'LR' || normalized === 'RL') return normalized;
  if (normalized === 'TD') return 'TB';
  return 'TB';
}

function isDiagramIRType(value: unknown): value is DiagramIRType {
  return value === 'graph' || value === 'flowchart' || value === 'erd' || value === 'dfd' || value === 'use-case';
}

function isRouting(value: unknown): value is IRRouting { return value === 'straight' || value === 'orthogonal' || value === 'curved'; }
function isDash(value: unknown): value is 'solid' | 'dashed' | 'dotted' { return value === 'solid' || value === 'dashed' || value === 'dotted'; }
function isPoint(value: unknown): value is Point { return isRecord(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y); }
function isSize(value: unknown): value is Size { return isRecord(value) && typeof value.width === 'number' && Number.isFinite(value.width) && typeof value.height === 'number' && Number.isFinite(value.height); }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function looksLikeDiagramJson(value: string): boolean { try { const parsed = JSON.parse(value) as unknown; return isRecord(parsed) && (Array.isArray(parsed.nodes) || isRecord(parsed.document)); } catch { return false; } }
function findErrorLine(source: string, message: string): number { const match = message.match(/line\s+(\d+)/i); return match ? Number(match[1]) : Math.max(1, source.split(/\r?\n/).findIndex((line) => /create\s+table/i.test(line)) + 1); }
function cleanIdentifier(value: string): string { return stripQuotes(value.trim()).replace(/^[^\w]+|[^\w.-]+$/g, '') || `node_${Math.random().toString(36).slice(2, 8)}`; }
function stripQuotes(value: string): string { const trimmed = value.trim(); return (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('`') && trimmed.endsWith('`')) ? trimmed.slice(1, -1) : trimmed; }
function cleanMarkup(value: string): string { return value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim(); }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field'; }
function truncate(value: string): string { return value.length > 44 ? `${value.slice(0, 41)}…` : value; }
