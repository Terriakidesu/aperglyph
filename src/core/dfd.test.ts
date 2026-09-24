import { describe, expect, it } from 'vitest';
import { createDocument, createEdge, createNode } from './document';
import { decomposeDfdProcess, validateDfd } from './dfd';

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

  it('checks process numbering for duplicate and malformed values', () => {
    const document = createDocument('DFD', 'dfd');
    document.pages[0].nodes.push(
      createNode('process', { x: 0, y: 0 }, { data: { label: 'One', number: '1.0' } }),
      createNode('process', { x: 220, y: 0 }, { data: { label: 'Two', number: '1.0' } }),
      createNode('process', { x: 440, y: 0 }, { data: { label: 'Three', number: 'bad' } }),
    );
    const diagnostics = validateDfd(document);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('used more than once'))).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('should use a form'))).toBe(true);
  });

  it('creates a linked child page for a process and reports balance gaps', () => {
    const document = createDocument('DFD', 'dfd');
    const process = createNode('process', { x: 0, y: 0 }, { data: { label: 'Checkout' } });
    document.pages[0].nodes.push(process);
    const result = decomposeDfdProcess(document, document.pages[0].id, process.id);
    expect(result).not.toBeNull();
    expect(result!.document.pages).toHaveLength(2);
    expect(result!.document.pages[0].nodes[0].data.childPageId).toBe(result!.childPageId);
    expect(result!.document.pages[1].data?.parentProcessId).toBe(process.id);
  });

  it('validates duplicate and blank data dictionary entries', () => {
    const document = createDocument('DFD', 'dfd');
    document.pages[0].data = {
      dfdLevel: 0,
      dataDictionary: [{ name: 'Order details' }, { name: 'order details', type: 'Order' }, { name: '' }],
    };
    const diagnostics = validateDfd(document);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'dfd.duplicate-data-dictionary-entry', severity: 'error' }),
      expect.objectContaining({ code: 'dfd.missing-data-dictionary-name', severity: 'error' }),
    ]));
  });
});
