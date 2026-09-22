import { describe, expect, it } from 'vitest';
import { createDocument, createEdge, createNode } from './document';
import { validateFlowchart } from './flowchart';

describe('flowchart semantic validation', () => {
  it('detects unreachable nodes and duplicate step numbers', () => {
    const document = createDocument('Process', 'flowchart');
    const start = createNode('start', { x: 0, y: 0 }, { library: 'flowchart', data: { label: 'Start' } });
    const first = createNode('process', { x: 200, y: 0 }, { library: 'flowchart', data: { label: 'One', number: '1' } });
    const unreachable = createNode('process', { x: 500, y: 0 }, { library: 'flowchart', data: { label: 'Never', number: '1' } });
    document.pages[0].nodes.push(start, first, unreachable);
    document.pages[0].edges.push(createEdge({ nodeId: start.id }, { nodeId: first.id }));
    const diagnostics = validateFlowchart(document);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'flowchart.unreachable-node' && diagnostic.nodeId === unreachable.id)).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'flowchart.duplicate-step-number')).toBe(true);
  });
});
