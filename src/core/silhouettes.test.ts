import { describe, expect, it } from 'vitest';
import { notationRenderer, shapeSilhouette, silhouetteBoundaryPoints } from './silhouettes';

describe('shared shape silhouettes', () => {
  it('covers the common built-in stencil renderers', () => {
    const renderers = [
      'rectangle', 'rounded-rectangle', 'ellipse', 'diamond', 'triangle',
      'hexagon', 'pentagon', 'parallelogram', 'trapezoid', 'cylinder', 'cloud',
      'document', 'multiple-document', 'stored-data', 'internal-storage',
      'manual-operation', 'predefined-process', 'delay', 'display', 'off-page-connector', 'package',
      'folded-note', 'system-boundary', 'line', 'arrow-line', 'dfd-gane-store', 'actor',
    ];
    renderers.forEach((renderer) => expect(shapeSilhouette(renderer, 180, 90), renderer).not.toBeNull());
  });

  it('provides polygonal hit-test approximations for non-rectangular symbols', () => {
    expect(silhouetteBoundaryPoints('parallelogram', 180, 90)?.[0]).toEqual({ x: 28, y: 0 });
    expect(silhouetteBoundaryPoints('off-page-connector', 120, 90)).toHaveLength(5);
    expect(silhouetteBoundaryPoints('document', 180, 90)?.length).toBeGreaterThan(10);
    expect(silhouetteBoundaryPoints('cloud', 180, 90)?.length).toBeGreaterThan(4);
  });

  it.each([
    [64, 64], [120, 80], [180, 90], [300, 100], [100, 300], [500, 500],
  ])('keeps specialized boundaries inside %ix%i node bounds', (width, height) => {
    const renderers = ['cloud', 'cylinder', 'database', 'stored-data', 'document', 'delay', 'display', 'package', 'manual-operation', 'preparation', 'off-page-connector'];
    renderers.forEach((renderer) => {
      silhouetteBoundaryPoints(renderer, width, height)?.forEach((point) => {
        expect(point.x, `${renderer} x`).toBeGreaterThanOrEqual(0);
        expect(point.x, `${renderer} x`).toBeLessThanOrEqual(width);
        expect(point.y, `${renderer} y`).toBeGreaterThanOrEqual(0);
        expect(point.y, `${renderer} y`).toBeLessThanOrEqual(height);
      });
    });
  });

  it('uses dedicated flowchart geometry for the corrected symbols', () => {
    const manual = shapeSilhouette('manual-operation', 180, 82)?.parts[0];
    expect(manual).toMatchObject({ kind: 'polygon' });
    if (manual?.kind === 'polygon') expect(manual.points).toEqual([{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 152, y: 82 }, { x: 28, y: 82 }]);

    const collate = shapeSilhouette('collate', 150, 90)?.parts[0];
    expect(collate).toMatchObject({ kind: 'polygon' });
    if (collate?.kind === 'polygon') expect(collate.points[2]).toEqual({ x: 75, y: 45 });

    const sort = shapeSilhouette('sort', 140, 90)?.parts[1];
    expect(sort).toEqual({ kind: 'line', x1: 0, y1: 45, x2: 140, y2: 45 });

    const internalStorage = shapeSilhouette('internal-storage', 180, 82)?.parts;
    expect(internalStorage?.[1]).toMatchObject({ kind: 'line', x1: 21.599999999999998, x2: 21.599999999999998 });
    expect(internalStorage?.[2]).toMatchObject({ kind: 'line', x1: 0, x2: 180, y1: 18.04, y2: 18.04 });
  });

  it('scales UML actor geometry with the node dimensions', () => {
    const small = shapeSilhouette('actor', 120, 140)?.parts;
    const large = shapeSilhouette('actor', 180, 210)?.parts;
    expect(small?.[0]).toMatchObject({ kind: 'ellipse', cx: 60, cy: 28, rx: 12, ry: 12 });
    expect(large?.[0]).toMatchObject({ kind: 'ellipse', cx: 90, cy: 42, rx: 18, ry: 18 });
    expect(small?.[1]).toMatchObject({ kind: 'line', y2: 91 });
    expect((small?.[1] as { y1: number }).y1).toBeCloseTo(44.8);
    expect(large?.[1]).toMatchObject({ kind: 'line', y2: 136.5 });
    expect((large?.[1] as { y1: number }).y1).toBeCloseTo(67.2);
  });

  it('keeps notation-specific boundaries aligned with notation-specific silhouettes', () => {
    const processBoundary = silhouetteBoundaryPoints('gane-process', 120, 84, 60);
    expect(processBoundary?.[0]).toEqual({ x: 10, y: 0 });
    expect(processBoundary?.[1]).toEqual({ x: 110, y: 0 });

    const foldedNote = silhouetteBoundaryPoints('folded-note', 40, 30);
    expect(foldedNote).toEqual([{ x: 0, y: 0 }, { x: 32.5, y: 0 }, { x: 40, y: 7.5 }, { x: 40, y: 30 }, { x: 0, y: 30 }]);
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
