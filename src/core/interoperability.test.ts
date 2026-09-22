import { describe, expect, it } from 'vitest';
import { createDocument, createEdge, createNode } from './document';
import { exportMermaid, exportPlantUml, parseDiagramText } from './interoperability';

describe('diagram interoperability', () => {
  it('round trips a basic Mermaid graph', () => {
    const document = createDocument('Flow');
    const source = createNode('rectangle', { x: 0, y: 0 }, { data: { label: 'Start' } });
    const target = createNode('diamond', { x: 200, y: 0 }, { data: { label: 'Decision' } });
    document.pages[0].nodes.push(source, target);
    document.pages[0].edges.push(createEdge({ nodeId: source.id }, { nodeId: target.id }, { data: { label: 'Yes' } }));

    const imported = parseDiagramText(exportMermaid(document.pages[0].nodes, document.pages[0].edges));

    expect(imported.pages[0].nodes.map((node) => node.data.label)).toEqual(['Start', 'Decision']);
    expect(imported.pages[0].nodes[1].type).toBe('diamond');
    expect(imported.pages[0].edges[0].data.label).toBe('Yes');
  });

  it('exports PlantUML declarations and relation labels', () => {
    const document = createDocument('Use cases');
    const actor = createNode('actor', { x: 0, y: 0 }, { library: 'use-case', data: { label: 'Customer' } });
    const useCase = createNode('use-case', { x: 220, y: 0 }, { library: 'use-case', data: { label: 'Checkout' } });
    document.pages[0].nodes.push(actor, useCase);
    document.pages[0].edges.push(createEdge({ nodeId: actor.id }, { nodeId: useCase.id }, { data: { label: 'uses' } }));

    const text = exportPlantUml(document.pages[0].nodes, document.pages[0].edges);

    expect(text).toContain('actor "Customer"');
    expect(text).toContain('usecase "Checkout"');
    expect(text).toContain(': uses');
  });
});
