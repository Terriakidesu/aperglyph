import type { Diagnostic, DiagramDocument, DiagramNode } from './types';

export type FlowDirection = 'TB' | 'LR' | 'BT' | 'RL';

export function validateFlowchart(document: DiagramDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  document.pages.forEach((page) => {
    const nodes = page.nodes.filter((node) => node.library === 'flowchart' || ['start', 'process', 'decision'].includes(node.type));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const incoming = new Map(nodes.map((node) => [node.id, 0]));
    const outgoing = new Map(nodes.map((node) => [node.id, 0]));
    const numbers = new Map<string, string>();
    page.edges.forEach((edge) => {
      if (!edge.source.nodeId || !edge.target.nodeId || !nodeIds.has(edge.source.nodeId) || !nodeIds.has(edge.target.nodeId)) return;
      incoming.set(edge.target.nodeId, (incoming.get(edge.target.nodeId) ?? 0) + 1);
      outgoing.set(edge.source.nodeId, (outgoing.get(edge.source.nodeId) ?? 0) + 1);
    });
    const starts = nodes.filter((node) => node.type === 'start' && (incoming.get(node.id) ?? 0) === 0);
    const terminals = nodes.filter((node) => node.type === 'start' && (outgoing.get(node.id) ?? 0) === 0);
    if (nodes.length > 0 && starts.length === 0) diagnostics.push({ severity: 'error', code: 'flowchart.missing-start', message: 'Flowchart has no reachable start node.', pageId: page.id });
    if (nodes.length > 0 && terminals.length === 0) diagnostics.push({ severity: 'warning', code: 'flowchart.missing-end', message: 'Flowchart has no end node.', pageId: page.id });

    nodes.forEach((node) => {
      const number = typeof node.data.number === 'string' ? node.data.number.trim() : '';
      if (number && numbers.has(number)) diagnostics.push({ severity: 'error', code: 'flowchart.duplicate-step-number', message: `Step number “${number}” is used more than once.`, pageId: page.id, nodeId: node.id });
      if (number) numbers.set(number, node.id);
      if (node.type === 'decision') {
        const branches = page.edges.filter((edge) => edge.source.nodeId === node.id);
        branches.forEach((edge, index) => {
          const label = typeof edge.data.label === 'string' ? edge.data.label.trim() : '';
          if (!label && index < 2) diagnostics.push({ severity: 'warning', code: 'flowchart.unlabeled-branch', message: `Decision branch ${index === 0 ? 'Yes' : 'No'} has no label.`, pageId: page.id, edgeId: edge.id, nodeId: node.id });
        });
      }
      if (node.type === 'off-page-connector' && node.data.pageId && !document.pages.some((candidate) => candidate.id === node.data.pageId)) diagnostics.push({ severity: 'error', code: 'flowchart.missing-page-link', message: 'Off-page connector references a missing page.', pageId: page.id, nodeId: node.id });
    });

    const sources = starts.length > 0 ? starts : nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
    const reachable = new Set(sources.map((node) => node.id));
    const queue = [...reachable];
    while (queue.length > 0) {
      const current = queue.shift()!;
      page.edges.filter((edge) => edge.source.nodeId === current).forEach((edge) => {
        if (edge.target.nodeId && nodeIds.has(edge.target.nodeId) && !reachable.has(edge.target.nodeId)) { reachable.add(edge.target.nodeId); queue.push(edge.target.nodeId); }
      });
    }
    nodes.forEach((node) => {
      if (!reachable.has(node.id)) diagnostics.push({ severity: 'warning', code: 'flowchart.unreachable-node', message: `“${nodeLabel(node)}” cannot be reached from a start node.`, pageId: page.id, nodeId: node.id });
      if (node.type === 'start' && (incoming.get(node.id) ?? 0) > 0 && (outgoing.get(node.id) ?? 0) > 0) diagnostics.push({ severity: 'warning', code: 'flowchart.start-in-middle', message: `Start/end node “${nodeLabel(node)}” has both incoming and outgoing flows.`, pageId: page.id, nodeId: node.id });
    });

    const direction = page.data?.flowDirection;
    if (direction === 'LR' || direction === 'RL' || direction === 'TB' || direction === 'BT') {
      page.edges.forEach((edge) => {
        const source = nodes.find((node) => node.id === edge.source.nodeId);
        const target = nodes.find((node) => node.id === edge.target.nodeId);
        if (!source || !target) return;
        const forward = direction === 'LR' ? target.position.x >= source.position.x : direction === 'RL' ? target.position.x <= source.position.x : direction === 'TB' ? target.position.y >= source.position.y : target.position.y <= source.position.y;
        if (!forward && source.id !== target.id) diagnostics.push({ severity: 'info', code: 'flowchart.flow-direction', message: 'Connector runs against the page flow direction.', pageId: page.id, edgeId: edge.id });
      });
    }
  });
  return diagnostics;
}

export function branchLabelForIndex(index: number, labels: string[] = ['Yes', 'No']): string | undefined {
  return labels[index]?.trim() || undefined;
}

function nodeLabel(node: DiagramNode): string {
  return typeof node.data.label === 'string' && node.data.label.trim() ? node.data.label.trim() : node.type;
}
