import { describe, expect, it } from 'vitest';
import { pluginManager } from './registry';

describe('diagram plugin registry', () => {
  it('registers the built-in diagram languages', () => {
    expect(pluginManager.list().map((plugin) => plugin.id)).toEqual(['general', 'flowchart', 'erd', 'dfd', 'use-case']);
    expect(pluginManager.get('flowchart').shapes.map((shape) => shape.type)).toContain('decision');
  });

  it('exposes common-first shape metadata and notation presets', () => {
    const general = pluginManager.get('general');
    const flowchart = pluginManager.get('flowchart');
    const erd = pluginManager.get('erd');
    const dfd = pluginManager.get('dfd');
    const useCase = pluginManager.get('use-case');
    expect(general.shapes.find((shape) => shape.id === 'cloud')).toMatchObject({ category: 'Basic', aliases: expect.arrayContaining(['network']) });
    expect(general.shapes.find((shape) => shape.id === 'circle')).toMatchObject({ aspectRatio: 1 });
    expect(general.shapes.find((shape) => shape.id === 'ellipse')?.aliases).not.toContain('round rectangle');
    expect(flowchart.shapes.find((shape) => shape.id === 'multiple-document')).toMatchObject({ category: 'Data', renderer: 'multiple-document' });
    expect(erd.shapes.find((shape) => shape.id === 'associative-entity')).toMatchObject({ type: 'entity', semanticRole: 'associative-entity' });
    expect(dfd.shapes.find((shape) => shape.type === 'process')).toMatchObject({ semanticRole: 'process', notation: 'yourdon-demarco', notationOptions: expect.arrayContaining([{ value: 'gane-sarson', label: 'Gane / Sarson' }]) });
    expect(erd.connectors.find((connector) => connector.id === 'many-to-many')).toMatchObject({ routing: 'orthogonal', defaultStyle: { startMarker: 'crowfoot', endMarker: 'crowfoot' } });
    expect(useCase.connectors.map((connector) => connector.id)).toEqual(expect.arrayContaining(['include', 'extend', 'generalization', 'comment']));
  });

  it('keeps ERD cardinality presets mapped to independent endpoint markers', () => {
    const erd = pluginManager.get('erd');
    const markerPairs = new Map(erd.connectors.map((connector) => [connector.id, [connector.defaultStyle?.startMarker, connector.defaultStyle?.endMarker]]));
    expect(markerPairs.get('one-to-one')).toEqual(['bar', 'bar']);
    expect(markerPairs.get('one-to-many')).toEqual(['bar', 'crowfoot']);
    expect(markerPairs.get('zero-or-one')).toEqual(['circle-bar', 'bar']);
    expect(markerPairs.get('zero-or-many')).toEqual(['circle-bar', 'circle-crowfoot']);
    expect(markerPairs.get('many-to-many')).toEqual(['crowfoot', 'crowfoot']);
  });

  it('falls back to the general plugin for unknown types', () => {
    expect(pluginManager.get('future-standard').id).toBe('general');
  });
});
