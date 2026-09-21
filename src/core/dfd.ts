import type { DiagramDocument, DiagramEdge, DiagramNode } from './types';

export type DfdRole = 'process' | 'external' | 'store';

export interface DfdDiagnostic {
  severity: 'warning' | 'error';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export function dfdRole(node: DiagramNode | undefined): DfdRole | undefined {
  if (node?.type === 'process' || node?.type === 'external' || node?.type === 'store') return node.type;
  return undefined;
}

export function validateDfd(document: DiagramDocument): DfdDiagnostic[] {
  const diagnostics: DfdDiagnostic[] = [];
  document.pages.forEach((page) => {
    const nodeMap = new Map(page.nodes.map((node) => [node.id, node]));
    const dfdNodes = page.nodes.filter((node) => dfdRole(node));
    const connected = new Set<string>();

    dfdNodes.forEach((node) => {
      const label = nodeLabel(node);
      if (!label) diagnostics.push({ severity: 'error', message: `${roleLabel(dfdRole(node))} is missing a name.`, nodeId: node.id });
    });

    page.edges.forEach((edge) => {
      const source = edge.source.nodeId ? nodeMap.get(edge.source.nodeId) : undefined;
      const target = edge.target.nodeId ? nodeMap.get(edge.target.nodeId) : undefined;
      if (!source || !target) {
        diagnostics.push({ severity: 'error', message: 'Data flow references a missing element.', edgeId: edge.id });
        return;
      }
      const sourceRole = dfdRole(source);
      const targetRole = dfdRole(target);
      if (!sourceRole || !targetRole) {
        diagnostics.push({ severity: 'warning', message: 'Data flows should connect DFD elements.', edgeId: edge.id });
        return;
      }
      connected.add(source.id);
      connected.add(target.id);
      if (source.id === target.id) diagnostics.push({ severity: 'error', message: 'A data flow cannot connect an element to itself.', edgeId: edge.id });
      if ((sourceRole === 'external' && targetRole === 'store') || (sourceRole === 'store' && targetRole === 'external')) {
        diagnostics.push({ severity: 'warning', message: 'An External Entity and Data Store should be connected through a Process.', edgeId: edge.id });
      }
      if (!flowLabel(edge)) diagnostics.push({ severity: 'warning', message: 'Data flows should have a name.', edgeId: edge.id });
    });

    dfdNodes.forEach((node) => {
      if (!connected.has(node.id)) diagnostics.push({ severity: 'warning', message: `${roleLabel(dfdRole(node))} is not connected to a data flow.`, nodeId: node.id });
    });
  });
  return diagnostics;
}

export function flowLabel(edge: DiagramEdge): string {
  return typeof edge.data.label === 'string' ? edge.data.label.trim() : '';
}

function nodeLabel(node: DiagramNode): string {
  return typeof node.data.label === 'string' ? node.data.label.trim() : '';
}

function roleLabel(role: DfdRole | undefined): string {
  if (role === 'external') return 'External Entity';
  if (role === 'store') return 'Data Store';
  return 'Process';
}
