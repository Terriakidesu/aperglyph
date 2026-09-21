import { describe, expect, it } from 'vitest';
import { createNode } from '../core/document';
import { snapNodes } from './snapping';

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
});
