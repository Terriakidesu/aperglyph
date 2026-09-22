import { UpdateEdgeCommand, UpdateNodeCommand } from './commands';
import { validateDfd } from './dfd';
import { validateErd } from './erd';
import { validateFlowchart } from './flowchart';
import type { Diagnostic, DiagramDocument, DiagramEdge, DiagramNode } from './types';
import { validateUseCase } from './useCase';
import { pluginManager } from '../plugins';
import type { DocumentCommand } from './commands';

export const DIAGNOSTICS_ENABLED_KEY = 'aperglyph.diagnostics.enabled';

export interface CollectedDiagnostic extends Diagnostic {
  id: string;
  plugin: string;
  pageId: string;
}

export interface DiagnosticFix {
  label: string;
  command: DocumentCommand;
}

export function isDiagnosticsEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(DIAGNOSTICS_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Collect semantic diagnostics without making the editor depend on one plugin. */
export function collectDiagnostics(document: DiagramDocument, scope: 'page' | 'document' = 'document', pageId?: string): CollectedDiagnostic[] {
  const plugin = pluginManager.get(document.diagramType);
  const diagnostics: CollectedDiagnostic[] = [];

  // Validators receive the complete document. Some semantic checks (notably
  // DFD decomposition balance and page links) need to compare two pages, so
  // validating one page at a time would silently lose those diagnostics.
  plugin.validators.forEach((validator) => {
    let validatorDiagnostics: Diagnostic[] = [];
    try {
      validatorDiagnostics = validator.validate(document);
    } catch {
      // A third-party validator must not make the editor unusable. The
      // built-ins are total, but this guard keeps the plugin boundary safe.
      validatorDiagnostics = [{ severity: 'error', code: 'plugin.validator-failed', message: `${validator.label} could not validate this document.`, plugin: plugin.id }];
    }
    validatorDiagnostics.forEach((diagnostic, index) => {
      const located = locateDiagnostic(document, diagnostic);
      const normalized = {
        ...diagnostic,
        plugin: diagnostic.plugin ?? plugin.id,
        pageId: diagnostic.pageId ?? located.pageId ?? pageId ?? document.pages[0]?.id ?? '',
        ...(located.nodeId && !diagnostic.nodeId ? { nodeId: located.nodeId } : {}),
        ...(located.edgeId && !diagnostic.edgeId ? { edgeId: located.edgeId } : {}),
      };
      if (scope === 'page' && pageId && normalized.pageId !== pageId) return;
      diagnostics.push({
        ...normalized,
        id: diagnosticId(normalized, validator.id, index),
      });
    });
  });

  const pages = scope === 'page' && pageId ? document.pages.filter((page) => page.id === pageId) : document.pages;
  pages.forEach((page) => diagnostics.push(...genericPageDiagnostics(page, plugin.id)));
  return diagnostics;
}

/** Built-in validators are also exported for callers that need plugin-agnostic checks. */
export function validateDocument(document: DiagramDocument): Diagnostic[] {
  if (document.diagramType === 'erd') return validateErd(document);
  if (document.diagramType === 'dfd') return validateDfd(document);
  if (document.diagramType === 'flowchart') return validateFlowchart(document);
  if (document.diagramType === 'use-case') return validateUseCase(document);
  return [];
}

export function buildDiagnosticFix(document: DiagramDocument, diagnostic: CollectedDiagnostic | Diagnostic): DiagnosticFix | null {
  const page = document.pages.find((candidate) => candidate.id === diagnostic.pageId);
  if (!page) return null;

  const plugin = pluginManager.get(document.diagramType);
  for (const validator of plugin.validators) {
    if (!validator.quickFix) continue;
    try {
      const command = validator.quickFix(diagnostic, document);
      if (command) return { label: command.label, command };
    } catch {
      // Fall through to the built-in conservative fixes.
    }
  }

  if (diagnostic.nodeId) {
    const node = page.nodes.find((candidate) => candidate.id === diagnostic.nodeId);
    if (node && (diagnostic.code === 'erd.missing-table-name' || diagnostic.code === 'dfd.missing-name' || diagnostic.code === 'uml.missing-use-case-name')) {
      return { label: 'Use the shape type as its name', command: new UpdateNodeCommand(page.id, node.id, { data: { label: node.type } }, 'Fix missing name') };
    }
  }
  if (diagnostic.edgeId && diagnostic.code === 'dfd.missing-flow-label') {
    return { label: 'Name this data flow', command: new UpdateEdgeCommand(page.id, diagnostic.edgeId, { data: { label: 'Data flow' } }, 'Fix missing flow name') };
  }
  return null;
}

function genericPageDiagnostics(page: DiagramDocument['pages'][number], plugin: string): CollectedDiagnostic[] {
  const nodeIds = new Set(page.nodes.map((node) => node.id));
  const diagnostics: CollectedDiagnostic[] = [];
  page.edges.forEach((edge) => {
    (['source', 'target'] as const).forEach((side) => {
      const nodeId = edge[side].nodeId;
      if (!nodeId || nodeIds.has(nodeId)) return;
      const diagnostic = { severity: 'error' as const, code: 'core.missing-node-reference', message: `${side === 'source' ? 'Start' : 'End'} of connector references a missing object.`, plugin, pageId: page.id, edgeId: edge.id };
      diagnostics.push({ ...diagnostic, id: diagnosticId(diagnostic, diagnostic.code, diagnostics.length) });
    });
  });
  return diagnostics;
}

function locateDiagnostic(document: DiagramDocument, diagnostic: Diagnostic): { pageId?: string; nodeId?: string; edgeId?: string } {
  if (diagnostic.nodeId || diagnostic.edgeId) return { pageId: diagnostic.pageId };
  const nodeMatch = /“([^”]+)”/.exec(diagnostic.message);
  if (nodeMatch) {
    for (const page of document.pages) {
      const node = page.nodes.find((candidate) => candidate.data.label === nodeMatch[1]);
      if (node) return { pageId: page.id, nodeId: node.id };
    }
  }
  return {};
}

function diagnosticId(diagnostic: Diagnostic, validatorId: string, index: number): string {
  return [diagnostic.plugin ?? 'core', diagnostic.code ?? validatorId, diagnostic.pageId ?? 'document', diagnostic.nodeId ?? diagnostic.edgeId ?? index].join(':');
}

export function diagnosticObject(document: DiagramDocument, diagnostic: CollectedDiagnostic): DiagramNode | DiagramEdge | undefined {
  const page = document.pages.find((candidate) => candidate.id === diagnostic.pageId);
  return diagnostic.nodeId ? page?.nodes.find((node) => node.id === diagnostic.nodeId) : diagnostic.edgeId ? page?.edges.find((edge) => edge.id === diagnostic.edgeId) : undefined;
}
