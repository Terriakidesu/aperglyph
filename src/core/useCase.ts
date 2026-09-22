import type { Diagnostic, DiagramDocument, DiagramEdge, DiagramNode } from './types';

export interface UseCaseDiagnostic extends Diagnostic {}

export function validateUseCase(document: DiagramDocument): UseCaseDiagnostic[] {
  const diagnostics: UseCaseDiagnostic[] = [];
  document.pages.forEach((page) => {
    const nodeMap = new Map(page.nodes.map((node) => [node.id, node]));
    const useCases = page.nodes.filter((node) => node.type === 'use-case');
    const connected = new Set<string>();
    useCases.forEach((node) => {
      if (!nodeLabel(node)) diagnostics.push({ severity: 'error', code: 'uml.missing-use-case-name', message: 'Use case is missing a name.', pageId: page.id, nodeId: node.id });
      if (node.containerId && !['boundary', 'package'].includes(nodeMap.get(node.containerId)?.type ?? '')) diagnostics.push({ severity: 'warning', code: 'uml.invalid-use-case-container', message: 'Use cases should be owned by a system boundary or package, or remain at the page root.', pageId: page.id, nodeId: node.id });
    });
    page.nodes.filter((node) => node.type === 'actor').forEach((actor) => {
      if (actor.containerId && ['boundary', 'package'].includes(nodeMap.get(actor.containerId)?.type ?? '')) diagnostics.push({ severity: 'warning', code: 'uml.actor-inside-boundary', message: 'Actors are normally placed outside a system boundary or package.', pageId: page.id, nodeId: actor.id });
    });
    page.edges.forEach((edge) => {
      const source = attachedNode(edge, nodeMap, 'source');
      const target = attachedNode(edge, nodeMap, 'target');
      if (!source || !target) {
        diagnostics.push({ severity: 'error', code: 'uml.missing-relationship-object', message: 'Use-case relationship references a missing object.', pageId: page.id, edgeId: edge.id });
        return;
      }
      connected.add(source.id);
      connected.add(target.id);
      if (edge.type === 'include' || edge.type === 'extend') {
        if (source.type !== 'use-case' || target.type !== 'use-case') diagnostics.push({ severity: 'error', code: `uml.invalid-${edge.type}-direction`, message: `«${edge.type}» relationships must connect two use cases.`, pageId: page.id, edgeId: edge.id });
      } else if (edge.type === 'generalization') {
        const valid = (source.type === 'actor' && target.type === 'actor') || (source.type === 'use-case' && target.type === 'use-case');
        if (!valid) diagnostics.push({ severity: 'error', code: 'uml.invalid-generalization', message: 'Generalization must connect two actors or two use cases.', pageId: page.id, edgeId: edge.id });
      } else if (edge.type === 'association' || edge.type === 'straight') {
        const valid = (source.type === 'actor' && target.type === 'use-case') || (source.type === 'use-case' && target.type === 'actor') || (source.type === 'use-case' && target.type === 'use-case');
        if (!valid) diagnostics.push({ severity: 'warning', code: 'uml.invalid-association', message: 'Associations should connect actors and use cases.', pageId: page.id, edgeId: edge.id });
      }
    });
    useCases.forEach((node) => {
      if (!connected.has(node.id)) diagnostics.push({ severity: 'warning', code: 'uml.disconnected-use-case', message: `Use case “${nodeLabel(node) || 'Unnamed'}” is not connected.`, pageId: page.id, nodeId: node.id });
    });
  });
  return diagnostics;
}

function attachedNode(edge: DiagramEdge, nodes: Map<string, DiagramNode>, side: 'source' | 'target'): DiagramNode | undefined {
  const id = edge[side].nodeId;
  return id ? nodes.get(id) : undefined;
}

function nodeLabel(node: DiagramNode): string {
  return typeof node.data.label === 'string' ? node.data.label.trim() : '';
}
