import type { DiagramDocument, DiagramEdge, DiagramNode } from './types';

export interface UseCaseDiagnostic {
  severity: 'warning' | 'error';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export function validateUseCase(document: DiagramDocument): UseCaseDiagnostic[] {
  const diagnostics: UseCaseDiagnostic[] = [];
  document.pages.forEach((page) => {
    const nodeMap = new Map(page.nodes.map((node) => [node.id, node]));
    const useCases = page.nodes.filter((node) => node.type === 'use-case');
    const connected = new Set<string>();
    useCases.forEach((node) => {
      if (!nodeLabel(node)) diagnostics.push({ severity: 'error', message: 'Use case is missing a name.', nodeId: node.id });
      if (node.containerId && !['boundary', 'package'].includes(nodeMap.get(node.containerId)?.type ?? '')) diagnostics.push({ severity: 'warning', message: 'Use cases should be owned by a system boundary or package, or remain at the page root.', nodeId: node.id });
    });
    page.nodes.filter((node) => node.type === 'actor').forEach((actor) => {
      if (actor.containerId && ['boundary', 'package'].includes(nodeMap.get(actor.containerId)?.type ?? '')) diagnostics.push({ severity: 'warning', message: 'Actors are normally placed outside a system boundary or package.', nodeId: actor.id });
    });
    page.edges.forEach((edge) => {
      const source = attachedNode(edge, nodeMap, 'source');
      const target = attachedNode(edge, nodeMap, 'target');
      if (!source || !target) {
        diagnostics.push({ severity: 'error', message: 'Use-case relationship references a missing object.', edgeId: edge.id });
        return;
      }
      connected.add(source.id);
      connected.add(target.id);
      if (edge.type === 'include' || edge.type === 'extend') {
        if (source.type !== 'use-case' || target.type !== 'use-case') diagnostics.push({ severity: 'error', message: `«${edge.type}» relationships must connect two use cases.`, edgeId: edge.id });
      } else if (edge.type === 'association' || edge.type === 'straight') {
        const valid = (source.type === 'actor' && target.type === 'use-case') || (source.type === 'use-case' && target.type === 'actor') || (source.type === 'use-case' && target.type === 'use-case');
        if (!valid) diagnostics.push({ severity: 'warning', message: 'Associations should connect actors and use cases.', edgeId: edge.id });
      }
    });
    useCases.forEach((node) => {
      if (!connected.has(node.id)) diagnostics.push({ severity: 'warning', message: `Use case “${nodeLabel(node) || 'Unnamed'}” is not connected.`, nodeId: node.id });
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
