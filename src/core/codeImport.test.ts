import { describe, expect, it } from 'vitest';
import { compileDiagramIR, detectDiagramCode, importDiagramCode, parseDiagramCode } from './codeImport';

describe('code to diagram compiler', () => {
  it('parses Mermaid into native flowchart shapes and labeled connectors', () => {
    const result = importDiagramCode(`flowchart LR
      A[Booking Request] --> B{Valid?}
      B -->|Yes| C[Create Transaction]
      B -->|No| D[(Archive)]`, 'mermaid');

    expect(result.document).not.toBeNull();
    expect(result.document?.diagramType).toBe('flowchart');
    expect(result.document?.pages[0].nodes.map((node) => node.type)).toEqual(['process', 'decision', 'process', 'database']);
    expect(result.document?.pages[0].edges.map((edge) => edge.data.label)).toEqual([undefined, 'Yes', 'No']);
    expect(result.document?.pages[0].edges.every((edge) => edge.source.nodeId && edge.target.nodeId)).toBe(true);
  });

  it('keeps SQL fields and foreign-key semantics when compiling', () => {
    const result = importDiagramCode(`CREATE TABLE customer (id BIGINT PRIMARY KEY);
      CREATE TABLE booking (id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL, FOREIGN KEY (customer_id) REFERENCES customer(id));`, 'sql');
    const page = result.document?.pages[0];
    expect(page?.nodes).toHaveLength(2);
    expect(page?.nodes.every((node) => node.type === 'entity')).toBe(true);
    expect(page?.edges[0]?.data.relationship).toBe('foreign-key');
    expect(page?.edges[0]?.source.anchorId).toContain('field-');
    expect(page?.edges[0]?.source.port).toMatch(/left|right/);
    expect(page?.edges[0]?.target.port).toMatch(/left|right/);
    expect(page?.edges[0]?.style).toMatchObject({ startMarker: 'crowfoot', endMarker: 'bar' });
    expect(page?.edges[0]?.data.cardinality).toEqual({ source: 'N', target: '1' });
    expect(page?.edges[0]?.data.label).toBeUndefined();
    const customer = page?.nodes.find((node) => node.data.label === 'customer');
    const booking = page?.nodes.find((node) => node.data.label === 'booking');
    expect(customer?.position.y).toBeLessThan(booking?.position.y ?? Number.POSITIVE_INFINITY);
    expect(customer?.size.width).toBeLessThanOrEqual(400);
    expect(booking?.data.compact).toBe(true);
    expect((page?.nodes.find((node) => node.data.label === 'booking')?.data.fields as Array<{ foreignKey: boolean }>)[1].foreignKey).toBe(true);
  });

  it('supports DBML, DOT, PlantUML, JSON, and CSV adapters', () => {
    const samples = [
      ['dbml', 'Table users {\n id int [pk]\n}\nTable posts {\n user_id int [ref: > users.id]\n}'] as const,
      ['dot', 'digraph G { A [shape=diamond]; A -> B [label="next"]; }'] as const,
      ['plantuml', '@startuml\nactor User\nusecase "Login" as Login\nUser --> Login\n@enduml'] as const,
      ['json', '{"type":"flowchart","direction":"TB","nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"edges":[{"source":"a","target":"b"}]}'] as const,
      ['csv', 'source,target,label\nA,B,next'] as const,
    ];
    samples.forEach(([language, source]) => {
      const result = importDiagramCode(source, language);
      expect(result.document, language).not.toBeNull();
      expect(result.document?.pages[0].nodes.length, language).toBeGreaterThan(0);
      expect(result.diagnostics.filter((item) => item.severity === 'error'), language).toHaveLength(0);
    });
  });

  it('reports locatable syntax errors without throwing', () => {
    const result = parseDiagramCode('flowchart LR\n A[Unclosed --> B', 'mermaid');
    expect(result.diagnostics.some((item) => item.severity === 'error')).toBe(true);
    expect(result.diagnostics[0]?.line).toBe(2);
  });

  it('detects high-signal pasted snippets only', () => {
    expect(detectDiagramCode('flowchart TD\nA --> B')?.language).toBe('mermaid');
    expect(detectDiagramCode('CREATE TABLE users (id INT);')?.language).toBe('sql');
    expect(detectDiagramCode('this is ordinary prose')).toBeNull();
  });

  it('can preserve explicit JSON layout while other sources auto-layout', () => {
    const parsed = parseDiagramCode('{"type":"graph","nodes":[{"id":"a","label":"A","position":{"x":40,"y":50}}],"edges":[]}', 'json');
    const document = compileDiagramIR(parsed.ir!, { preserveLayout: true });
    expect(document.pages[0].nodes[0].position).toEqual({ x: 40, y: 50 });
  });
});
