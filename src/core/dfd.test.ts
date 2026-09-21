import { describe, expect, it } from 'vitest';
import { createDocument, createEdge, createNode } from './document';
import { validateDfd } from './dfd';

describe('DFD semantic validation', () => {
  it('warns when an external entity connects directly to a data store', () => {
    const document = createDocument('Orders', 'dfd');
    const external = createNode('external', { x: 0, y: 0 }, { data: { label: 'Customer' } });
    const store = createNode('store', { x: 300, y: 0 }, { data: { label: 'Orders' } });
    document.pages[0].nodes.push(external, store);
    const edge = createEdge({ nodeId: external.id }, { nodeId: store.id }, { data: { label: 'raw data' } });
    document.pages[0].edges.push(edge);
    expect(validateDfd(document)).toContainEqual(expect.objectContaining({ edgeId: edge.id, severity: 'warning' }));
  });

  it('requires names for flows and warns about isolated elements', () => {
    const document = createDocument('DFD', 'dfd');
    document.pages[0].nodes.push(createNode('process', { x: 0, y: 0 }, { data: { label: '' } }));
    const diagnostics = validateDfd(document);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('missing a name'))).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('not connected'))).toBe(true);
  });
});
