import { describe, expect, it } from 'vitest';
import { buildDiagnosticFix, collectDiagnostics } from './diagnostics';
import { createDocument, createNode } from './document';

describe('central diagnostics', () => {
  it('collects plugin diagnostics with stable page and object locations', () => {
    const document = createDocument('DFD', 'dfd');
    const process = createNode('process', { x: 0, y: 0 }, { library: 'dfd', data: { label: '' } });
    document.pages[0].nodes.push(process);

    const diagnostics = collectDiagnostics(document);

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'dfd.missing-name' && diagnostic.pageId === document.pages[0].id && diagnostic.nodeId === process.id)).toBe(true);
    expect(diagnostics.every((diagnostic) => diagnostic.id.length > 0 && diagnostic.plugin === 'dfd')).toBe(true);
  });

  it('provides safe fixes for missing names', () => {
    const document = createDocument('DFD', 'dfd');
    const process = createNode('process', { x: 0, y: 0 }, { library: 'dfd', data: { label: '' } });
    document.pages[0].nodes.push(process);
    const diagnostic = collectDiagnostics(document).find((item) => item.code === 'dfd.missing-name');

    expect(diagnostic).toBeDefined();
    const fix = buildDiagnosticFix(document, diagnostic!);
    expect(fix?.label).toContain('name');
    expect(fix?.command.label).toBe('Fix missing name');
    expect(fix?.command.execute(document).pages[0].nodes[0].data.label).toBe('process');
  });
});
