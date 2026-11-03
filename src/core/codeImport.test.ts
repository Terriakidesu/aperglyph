import { describe, expect, it } from 'vitest';
import { compileDiagramIR, detectDiagramCode, importDiagramCode, parseDiagramCode } from './codeImport';
import { edgeRoute } from './routing';

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
    expect(page?.settings).toMatchObject({ background: '#ffffff', canvasTheme: 'light' });
    expect(page?.nodes[0].style).toMatchObject({ fill: '#ffffff', stroke: '#111111', textColor: '#111111' });
    expect(page?.nodes.every((node) => node.type === 'entity')).toBe(true);
    expect(page?.edges[0]?.data.relationship).toBe('foreign-key');
    expect(page?.edges[0]?.source.anchorId).toContain('field-');
    expect(page?.edges[0]?.source.port).toMatch(/left|right/);
    expect(page?.edges[0]?.target.port).toMatch(/left|right/);
    expect(page?.edges[0]?.style).toMatchObject({ stroke: '#222222', strokeWidth: 1.6, startMarker: 'crowfoot', endMarker: 'bar' });
    expect(page?.edges[0]?.data.cardinality).toEqual({ source: 'N', target: '1' });
    expect(page?.edges[0]?.data.label).toBeUndefined();
    const customer = page?.nodes.find((node) => node.data.label === 'customer');
    const booking = page?.nodes.find((node) => node.data.label === 'booking');
    expect(customer?.position.y).toBeLessThan(booking?.position.y ?? Number.POSITIVE_INFINITY);
    expect(customer?.size.width).toBeLessThanOrEqual(400);
    expect(booking?.data.compact).toBe(true);
    expect((page?.nodes.find((node) => node.data.label === 'booking')?.data.fields as Array<{ foreignKey: boolean }>)[1].foreignKey).toBe(true);
  });

  it('keeps a larger multi-FK schema compact and routes around every table', () => {
    const source = `
      CREATE TABLE customer (id BIGINT PRIMARY KEY);
      CREATE TABLE staff (id BIGINT PRIMARY KEY);
      CREATE TABLE service_package (id BIGINT PRIMARY KEY);
      CREATE TABLE booking (
        id BIGINT PRIMARY KEY,
        customer_id BIGINT NOT NULL,
        staff_id BIGINT NOT NULL,
        package_id BIGINT,
        FOREIGN KEY (customer_id) REFERENCES customer(id),
        FOREIGN KEY (staff_id) REFERENCES staff(id),
        FOREIGN KEY (package_id) REFERENCES service_package(id)
      );
      CREATE TABLE transaction_record (
        id BIGINT PRIMARY KEY,
        booking_id BIGINT NOT NULL,
        package_id BIGINT,
        FOREIGN KEY (booking_id) REFERENCES booking(id),
        FOREIGN KEY (package_id) REFERENCES service_package(id)
      );
      CREATE TABLE payment (
        id BIGINT PRIMARY KEY,
        transaction_id BIGINT NOT NULL,
        FOREIGN KEY (transaction_id) REFERENCES transaction_record(id)
      );
      CREATE TABLE employee (
        id BIGINT PRIMARY KEY,
        manager_id BIGINT,
        FOREIGN KEY (manager_id) REFERENCES employee(id)
      );
      CREATE TABLE tag (id BIGINT PRIMARY KEY);
      CREATE TABLE booking_tag (
        booking_id BIGINT NOT NULL,
        tag_id BIGINT NOT NULL,
        PRIMARY KEY (booking_id, tag_id),
        FOREIGN KEY (booking_id) REFERENCES booking(id),
        FOREIGN KEY (tag_id) REFERENCES tag(id)
      );
      CREATE TABLE organization (
        org_id BIGINT NOT NULL,
        region_id BIGINT NOT NULL,
        PRIMARY KEY (org_id, region_id)
      );
      CREATE TABLE branch (
        org_id BIGINT NOT NULL,
        region_id BIGINT NOT NULL,
        branch_id BIGINT NOT NULL,
        PRIMARY KEY (org_id, region_id, branch_id),
        FOREIGN KEY (org_id, region_id) REFERENCES organization(org_id, region_id)
      );
      CREATE TABLE warehouse (id BIGINT PRIMARY KEY);
      CREATE TABLE inventory (
        id BIGINT PRIMARY KEY,
        warehouse_id BIGINT NOT NULL,
        package_id BIGINT,
        FOREIGN KEY (warehouse_id) REFERENCES warehouse(id),
        FOREIGN KEY (package_id) REFERENCES service_package(id)
      );
    `;
    const result = importDiagramCode(source, 'sql');
    const page = result.document?.pages[0];
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    expect(page?.nodes).toHaveLength(13);
    expect(page?.edges).toHaveLength(12);

    const nodes = page?.nodes ?? [];
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const rootTables = ['customer', 'staff', 'service_package'].map((label) => nodes.find((node) => node.data.label === label));
    expect(rootTables.every((node) => node && node.position.y < (nodes.find((candidate) => candidate.data.label === 'booking')?.position.y ?? Number.POSITIVE_INFINITY))).toBe(true);
    const width = Math.max(...nodes.map((node) => node.position.x + node.size.width)) - Math.min(...nodes.map((node) => node.position.x));
    const height = Math.max(...nodes.map((node) => node.position.y + node.size.height)) - Math.min(...nodes.map((node) => node.position.y));
    expect(width).toBeGreaterThan(Math.max(...nodes.map((node) => node.size.width)) + 80);
    expect(width).toBeLessThan(2200);
    expect(height).toBeLessThan(800);

    const routeEntries: Array<{ points: Array<{ x: number; y: number }> }> = [];
    page?.edges.forEach((edge) => {
      const sourceNode = edge.source.nodeId ? nodeMap.get(edge.source.nodeId) : undefined;
      const targetNode = edge.target.nodeId ? nodeMap.get(edge.target.nodeId) : undefined;
      const route = edgeRoute(edge, sourceNode, targetNode, nodes, { otherRoutes: routeEntries.map((entry) => entry.points) });
      routeEntries.push({ points: route });
      expect(route.length).toBeGreaterThanOrEqual(2);
      expect(route.every((point, index) => index === 0 || point.x === route[index - 1].x || point.y === route[index - 1].y)).toBe(true);
      nodes.filter((node) => node.id !== sourceNode?.id && node.id !== targetNode?.id).forEach((node) => {
        expect(route.slice(0, -1).some((point, index) => segmentCrossesNode(point, route[index + 1], node)), `${sourceNode?.data.label}->${targetNode?.data.label} crosses ${node.data.label}: ${JSON.stringify(route)}`).toBe(false);
      });
    });

    const employee = nodes.find((node) => node.data.label === 'employee');
    const selfReference = page?.edges.find((edge) => edge.source.nodeId === employee?.id && edge.target.nodeId === employee?.id);
    expect(selfReference).toBeDefined();
    expect((employee?.data.fields as Array<{ name: string; reference?: unknown }>).find((field) => field.name === 'manager_id')?.reference).toBeDefined();
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

function segmentCrossesNode(start: { x: number; y: number }, end: { x: number; y: number }, node: { position: { x: number; y: number }; size: { width: number; height: number } }): boolean {
  if (start.y === end.y) return start.y > node.position.y && start.y < node.position.y + node.size.height && Math.max(start.x, end.x) > node.position.x && Math.min(start.x, end.x) < node.position.x + node.size.width;
  if (start.x === end.x) return start.x > node.position.x && start.x < node.position.x + node.size.width && Math.max(start.y, end.y) > node.position.y && Math.min(start.y, end.y) < node.position.y + node.size.height;
  return true;
}
