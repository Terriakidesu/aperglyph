import { describe, expect, it } from 'vitest';
import { pluginManager } from './registry';

describe('diagram plugin registry', () => {
  it('registers the built-in diagram languages', () => {
    expect(pluginManager.list().map((plugin) => plugin.id)).toEqual(['general', 'flowchart', 'erd', 'dfd', 'use-case']);
    expect(pluginManager.get('flowchart').shapes.map((shape) => shape.type)).toContain('decision');
  });

  it('falls back to the general plugin for unknown types', () => {
    expect(pluginManager.get('future-standard').id).toBe('general');
  });
});
