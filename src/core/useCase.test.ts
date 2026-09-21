import { describe, expect, it } from 'vitest';
import { createDocument, createEdge, createNode } from './document';
import { validateUseCase } from './useCase';

describe('UML use-case validation', () => {
  it('requires include relationships to connect use cases', () => {
    const document = createDocument('Checkout', 'use-case');
    const actor = createNode('actor', { x: 0, y: 0 }, { library: 'use-case', data: { label: 'Customer' } });
    const useCase = createNode('use-case', { x: 240, y: 0 }, { library: 'use-case', data: { label: 'Checkout' } });
    document.pages[0].nodes.push(actor, useCase);
    const edge = createEdge({ nodeId: actor.id }, { nodeId: useCase.id }, { type: 'include' });
    document.pages[0].edges.push(edge);
    expect(validateUseCase(document)).toContainEqual(expect.objectContaining({ edgeId: edge.id, severity: 'error' }));
  });

  it('warns about disconnected use cases', () => {
    const document = createDocument('Checkout', 'use-case');
    const useCase = createNode('use-case', { x: 0, y: 0 }, { library: 'use-case', data: { label: 'Checkout' } });
    document.pages[0].nodes.push(useCase);
    expect(validateUseCase(document)).toContainEqual(expect.objectContaining({ nodeId: useCase.id, severity: 'warning' }));
  });
});
