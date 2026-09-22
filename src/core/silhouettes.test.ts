import { describe, expect, it } from 'vitest';
import { notationRenderer, shapeSilhouette, silhouetteBoundaryPoints } from './silhouettes';

describe('shared shape silhouettes', () => {
  it('covers the common built-in stencil renderers', () => {
    const renderers = [
      'rectangle', 'rounded-rectangle', 'ellipse', 'diamond', 'triangle',
      'hexagon', 'pentagon', 'parallelogram', 'trapezoid', 'cylinder', 'cloud',
      'document', 'multiple-document', 'stored-data', 'internal-storage',
      'predefined-process', 'delay', 'display', 'off-page-connector', 'package',
      'folded-note', 'system-boundary', 'line', 'arrow-line', 'dfd-gane-store',
    ];
    renderers.forEach((renderer) => expect(shapeSilhouette(renderer, 180, 90), renderer).not.toBeNull());
  });

  it('provides polygonal hit-test approximations for non-rectangular symbols', () => {
    expect(silhouetteBoundaryPoints('parallelogram', 180, 90)?.[0]).toEqual({ x: 28, y: 0 });
    expect(silhouetteBoundaryPoints('off-page-connector', 120, 90)).toHaveLength(5);
    expect(silhouetteBoundaryPoints('document', 180, 90)).toHaveLength(5);
    expect(silhouetteBoundaryPoints('cloud', 180, 90)?.length).toBeGreaterThan(4);
  });

  it('switches DFD notation by metadata while preserving semantic node types', () => {
    const process = { library: 'dfd', type: 'process', data: { notation: 'gane-sarson' } } as const;
    const external = { library: 'dfd', type: 'external', data: { notation: 'gane-sarson' } } as const;
    const store = { library: 'dfd', type: 'store', data: { notation: 'gane-sarson' } } as const;
    expect(notationRenderer('ellipse', process)).toBe('gane-process');
    expect(notationRenderer('rectangle', external)).toBe('gane-external');
    expect(notationRenderer('dfd-store', store)).toBe('dfd-gane-store');
    expect(shapeSilhouette('gane-process', 120, 84)?.parts[0]).toMatchObject({ kind: 'rect', radius: 10 });
    expect(notationRenderer('ellipse', { library: 'dfd', type: 'process', data: {} })).toBe('ellipse');
  });
});
