import { createPage } from './document';
import type { Diagnostic, DiagramDocument, DiagramEdge, DiagramNode } from './types';

export type DfdRole = 'process' | 'external' | 'store';

export interface DfdDiagnostic extends Diagnostic {}

export interface DfdDataDictionaryEntry {
  name: string;
  type?: string;
  description?: string;
}

export interface DfdDecompositionResult {
  document: DiagramDocument;
  childPageId: string;
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
    const processNumbers = new Map<string, string>();
    const storeNumbers = new Map<string, string>();
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    const dictionary = dataDictionary(page);
    const dictionaryNames = new Map<string, number>();
    dictionary.forEach((entry, index) => {
      const normalizedName = entry.name.toLowerCase();
      if (!normalizedName) {
        diagnostics.push({ severity: 'error', code: 'dfd.missing-data-dictionary-name', message: 'Data dictionary entries need a name.', pageId: page.id });
      } else if (dictionaryNames.has(normalizedName)) {
        diagnostics.push({ severity: 'error', code: 'dfd.duplicate-data-dictionary-entry', message: `Data dictionary entry “${entry.name}” is defined more than once.`, pageId: page.id });
      } else {
        dictionaryNames.set(normalizedName, index);
      }
    });
    const definedDictionaryNames = new Set(dictionaryNames.keys());

    dfdNodes.forEach((node) => {
      const label = nodeLabel(node);
      if (!label) diagnostics.push({ severity: 'error', code: 'dfd.missing-name', message: `${roleLabel(dfdRole(node))} is missing a name.`, pageId: page.id, nodeId: node.id });
      if (node.type === 'process') {
        const number = typeof node.data.number === 'string' ? node.data.number.trim() : '';
        if (number && !/^\d+(?:\.\d+)*$/.test(number)) diagnostics.push({ severity: 'warning', code: 'dfd.invalid-process-number', message: 'Process numbers should use a form such as 1.0 or 2.1.', pageId: page.id, nodeId: node.id });
        if (number && processNumbers.has(number)) diagnostics.push({ severity: 'error', code: 'dfd.duplicate-process-number', message: `Process number “${number}” is used more than once.`, pageId: page.id, nodeId: node.id });
        if (number) processNumbers.set(number, node.id);
      }
      if (node.type === 'store') {
        const number = typeof node.data.number === 'string' ? node.data.number.trim() : '';
        if (number && !/^D\d+(?:\.\d+)*$/i.test(number)) diagnostics.push({ severity: 'warning', code: 'dfd.invalid-store-number', message: 'Data-store numbers should use a form such as D1 or D1.1.', pageId: page.id, nodeId: node.id });
        const normalizedNumber = number.toUpperCase();
        if (number && storeNumbers.has(normalizedNumber)) diagnostics.push({ severity: 'error', code: 'dfd.duplicate-store-number', message: `Data-store number “${number}” is used more than once.`, pageId: page.id, nodeId: node.id });
        if (number) storeNumbers.set(normalizedNumber, node.id);
      }
      incoming.set(node.id, 0);
      outgoing.set(node.id, 0);
    });

    page.edges.forEach((edge) => {
      const source = edge.source.nodeId ? nodeMap.get(edge.source.nodeId) : undefined;
      const target = edge.target.nodeId ? nodeMap.get(edge.target.nodeId) : undefined;
      if (!source || !target) {
        diagnostics.push({ severity: 'error', code: 'dfd.missing-element', message: 'Data flow references a missing element.', pageId: page.id, edgeId: edge.id });
        return;
      }
      const sourceRole = dfdRole(source);
      const targetRole = dfdRole(target);
      if (!sourceRole || !targetRole) {
        diagnostics.push({ severity: 'warning', code: 'dfd.invalid-role', message: 'Data flows should connect DFD elements.', pageId: page.id, edgeId: edge.id });
        return;
      }
      connected.add(source.id);
      connected.add(target.id);
      outgoing.set(source.id, (outgoing.get(source.id) ?? 0) + 1);
      incoming.set(target.id, (incoming.get(target.id) ?? 0) + 1);
      if (source.id === target.id) diagnostics.push({ severity: 'error', code: 'dfd.self-flow', message: 'A data flow cannot connect an element to itself.', pageId: page.id, edgeId: edge.id });
      if ((sourceRole === 'external' && targetRole === 'store') || (sourceRole === 'store' && targetRole === 'external')) {
        diagnostics.push({ severity: 'warning', code: 'dfd.external-store-flow', message: 'An External Entity and Data Store should be connected through a Process.', pageId: page.id, edgeId: edge.id });
      }
      if (!flowLabel(edge)) diagnostics.push({ severity: 'warning', code: 'dfd.missing-flow-label', message: 'Data flows should have a name.', pageId: page.id, edgeId: edge.id });
      const label = flowLabel(edge);
      if (label && definedDictionaryNames.size > 0 && !definedDictionaryNames.has(label.toLowerCase())) diagnostics.push({ severity: 'info', code: 'dfd.unknown-data-dictionary-entry', message: `Flow “${label}” is not defined in the data dictionary.`, pageId: page.id, edgeId: edge.id });
    });

    dfdNodes.forEach((node) => {
      if (!connected.has(node.id)) diagnostics.push({ severity: 'warning', code: 'dfd.isolated-element', message: `${roleLabel(dfdRole(node))} is not connected to a data flow.`, pageId: page.id, nodeId: node.id });
      if (node.type === 'process' && (incoming.get(node.id) ?? 0) === 0) diagnostics.push({ severity: 'warning', code: 'dfd.process-without-input', message: `Process “${nodeLabel(node) || 'Unnamed'}” has no input flow.`, pageId: page.id, nodeId: node.id });
      if (node.type === 'process' && (outgoing.get(node.id) ?? 0) === 0) diagnostics.push({ severity: 'warning', code: 'dfd.process-without-output', message: `Process “${nodeLabel(node) || 'Unnamed'}” has no output flow.`, pageId: page.id, nodeId: node.id });
    });
  });
  diagnostics.push(...validateDecompositions(document));
  return diagnostics;
}

/** Create a levelled child page and retain the parent process link in the
 * document model. The caller can execute this result through a command. */
export function decomposeDfdProcess(document: DiagramDocument, parentPageId: string, processId: string): DfdDecompositionResult | null {
  const next = structuredClone(document);
  const parent = next.pages.find((page) => page.id === parentPageId);
  const process = parent?.nodes.find((node) => node.id === processId && node.type === 'process');
  if (!parent || !process) return null;
  if (typeof process.data.childPageId === 'string' && next.pages.some((page) => page.id === process.data.childPageId)) return null;
  const level = typeof parent.data?.dfdLevel === 'number' ? parent.data.dfdLevel + 1 : 1;
  const child = createPage(nodeLabel(process) || `Process ${processId}`);
  child.data = { dfdLevel: level, parentPageId: parent.id, parentProcessId: process.id, dataDictionary: [] };
  parent.nodes = parent.nodes.map((node) => node.id === process.id ? { ...node, data: { ...node.data, childPageId: child.id } } : node);
  next.pages.push(child);
  next.updatedAt = Date.now();
  return { document: next, childPageId: child.id };
}

export function dataDictionary(page: DiagramDocument['pages'][number]): DfdDataDictionaryEntry[] {
  const raw = page.data?.dataDictionary;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim()) return [{ name: entry.trim() }];
    if (!entry || typeof entry !== 'object' || typeof (entry as { name?: unknown }).name !== 'string') return [];
    const value = entry as { name: string; type?: unknown; description?: unknown };
    return [{ name: value.name.trim(), ...(typeof value.type === 'string' ? { type: value.type } : {}), ...(typeof value.description === 'string' ? { description: value.description } : {}) }];
  });
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

function validateDecompositions(document: DiagramDocument): DfdDiagnostic[] {
  const diagnostics: DfdDiagnostic[] = [];
  const pageIds = new Set(document.pages.map((page) => page.id));

  // Check the parent-side link as well as the child-side metadata. This
  // catches a deleted or renamed child page without requiring the child page
  // to be present in the validator's traversal.
  document.pages.forEach((page) => page.nodes.forEach((node) => {
    const childPageId = typeof node.data.childPageId === 'string' ? node.data.childPageId : undefined;
    if (!childPageId) return;
    const child = document.pages.find((candidate) => candidate.id === childPageId);
    if (!childPageId || !pageIds.has(childPageId)) {
      diagnostics.push({ severity: 'error', code: 'dfd.missing-child-page', message: 'Process links to a missing child DFD page.', pageId: page.id, nodeId: node.id });
    } else if (child?.data?.parentPageId !== page.id || child.data.parentProcessId !== node.id) {
      diagnostics.push({ severity: 'warning', code: 'dfd.child-link-mismatch', message: 'Child DFD page does not point back to its parent process.', pageId: page.id, nodeId: node.id });
    }
  }));

  document.pages.forEach((child) => {
    const parentPageId = typeof child.data?.parentPageId === 'string' ? child.data.parentPageId : undefined;
    const parentProcessId = typeof child.data?.parentProcessId === 'string' ? child.data.parentProcessId : undefined;
    if (!parentPageId || !parentProcessId) return;
    const parent = document.pages.find((page) => page.id === parentPageId);
    const process = parent?.nodes.find((node) => node.id === parentProcessId && node.type === 'process');
    if (!parent || !process) {
      diagnostics.push({ severity: 'error', code: 'dfd.invalid-decomposition-parent', message: 'DFD child page references a missing parent process.', pageId: child.id });
      return;
    }
    if (process.data.childPageId !== child.id) diagnostics.push({ severity: 'warning', code: 'dfd.unlinked-child-page', message: `Child page “${child.name}” is not linked from its parent process.`, pageId: child.id, nodeId: process.id });
    const parentInputs = new Set(parent.edges.filter((edge) => edge.target.nodeId === process.id).map(flowLabel).filter(Boolean).map((label) => label.toLowerCase()));
    const parentOutputs = new Set(parent.edges.filter((edge) => edge.source.nodeId === process.id).map(flowLabel).filter(Boolean).map((label) => label.toLowerCase()));
    const childInputs = new Set(child.edges.filter((edge) => edge.target.nodeId && child.nodes.find((node) => node.id === edge.target.nodeId)?.type === 'process').map(flowLabel).filter(Boolean).map((label) => label.toLowerCase()));
    const childOutputs = new Set(child.edges.filter((edge) => edge.source.nodeId && child.nodes.find((node) => node.id === edge.source.nodeId)?.type === 'process').map(flowLabel).filter(Boolean).map((label) => label.toLowerCase()));
    parentInputs.forEach((label) => { if (!childInputs.has(label)) diagnostics.push({ severity: 'warning', code: 'dfd.unbalanced-input', message: `Child page does not expose parent input “${label}”.`, pageId: child.id, nodeId: process.id }); });
    parentOutputs.forEach((label) => { if (!childOutputs.has(label)) diagnostics.push({ severity: 'warning', code: 'dfd.unbalanced-output', message: `Child page does not expose parent output “${label}”.`, pageId: child.id, nodeId: process.id }); });
  });
  return diagnostics;
}
