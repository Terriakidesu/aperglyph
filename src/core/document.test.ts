import { describe, expect, it } from 'vitest';
import { createDocument, createNode, parseProject, serializeProject } from './document';

describe('AperGlyph document model', () => {
  it('creates a versioned document with a page', () => {
    const document = createDocument('Architecture map', 'flowchart');
    expect(document.schemaVersion).toBe(1);
    expect(document.pages).toHaveLength(1);
    expect(document.diagramType).toBe('flowchart');
  });

  it('round trips a project through the native file format', () => {
    const document = createDocument('Round trip');
    document.pages[0].nodes.push(createNode('process', { x: 120, y: 80 }));
    const parsed = parseProject(serializeProject(document));
    expect(parsed.id).toBe(document.id);
    expect(parsed.pages[0].nodes[0].position).toEqual({ x: 120, y: 80 });
  });

  it('rejects unrelated JSON', () => {
    expect(() => parseProject('{"hello":"world"}')).toThrow();
  });
});
