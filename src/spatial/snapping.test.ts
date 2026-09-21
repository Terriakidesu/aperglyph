import { describe, expect, it } from 'vitest';
import { createNode } from '../core/document';
import { snapDraggedNodes, snapNodes } from './snapping';

describe('object snapping', () => {
  it('aligns a moving rectangle to a nearby edge and returns a guide', () => {
    const moving = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 100, height: 60 } });
    const target = createNode('rectangle', { x: 220, y: 4 }, { size: { width: 100, height: 60 } });
    const result = snapNodes([moving], { [moving.id]: { x: 116, y: 7 } }, [target], { gridSize: 16, snapToGrid: false, threshold: 10 });
    expect(result.positions[moving.id]).toEqual({ x: 120, y: 4 });
    expect(result.guides).toHaveLength(2);
  });

  it('preserves relative spacing when grid snapping a selection', () => {
    const first = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 40, height: 40 } });
    const second = createNode('rectangle', { x: 70, y: 0 }, { size: { width: 40, height: 40 } });
    const result = snapNodes([first, second], { [first.id]: { x: 13, y: 4 }, [second.id]: { x: 83, y: 4 } }, [], { gridSize: 16, snapToGrid: true, threshold: 8 });
    expect(result.positions[second.id].x - result.positions[first.id].x).toBe(70);
    expect(result.positions[first.id].x).toBe(16);
  });

  it('does not align to nearby objects when the master snap switch is off', () => {
    const moving = createNode('rectangle', { x: 0, y: 0 }, { size: { width: 100, height: 60 } });
    const target = createNode('rectangle', { x: 220, y: 4 }, { size: { width: 100, height: 60 } });
    const result = snapNodes([moving], { [moving.id]: { x: 116, y: 7 } }, [target], { gridSize: 16, snapToGrid: false, snapToObjects: false, threshold: 10 });
    expect(result.positions[moving.id]).toEqual({ x: 116, y: 7 });
    expect(result.guides).toHaveLength(0);
  });

  it('uses one drag calculation for the preview and final release', () => {
    const moving = createNode('rectangle', { x: 3, y: 7 });
    const result = snapDraggedNodes(
      [moving],
      { [moving.id]: { x: 3, y: 7 } },
      { x: 0, y: 0 },
      { x: 12.25, y: 9.5 },
      [],
      { gridSize: 16, snapToGrid: true, snapToObjects: true, threshold: 10 },
    );
    expect(result.positions[moving.id]).toEqual({ x: 16, y: 16 });
  });

  it('Alt disables both grid and object snapping for the whole drag', () => {
    const moving = createNode('rectangle', { x: 3, y: 7 });
    const target = createNode('rectangle', { x: 200, y: 100 });
    const result = snapDraggedNodes(
      [moving],
      { [moving.id]: { x: 3, y: 7 } },
      { x: 0, y: 0 },
      { x: 12.25, y: 9.5 },
      [target],
      { gridSize: 16, snapToGrid: true, snapToObjects: true, threshold: 10 },
      { disableSnapping: true },
    );
    expect(result.positions[moving.id]).toEqual({ x: 15.25, y: 16.5 });
    expect(result.guides).toEqual([]);
  });
});
