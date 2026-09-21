import { describe, expect, it } from 'vitest';
import { connectionAnchorPoints } from './anchors';
import { createNode } from './document';
import { pluginManager } from '../plugins';

describe('shape connection anchors', () => {
  it('gives every built-in shape a consistent cardinal anchor contract', () => {
    pluginManager.list().forEach((plugin) => plugin.shapes.forEach((shape) => {
      const node = createNode(shape.type, { x: 0, y: 0 }, {
        library: plugin.id,
        size: shape.defaultSize,
        data: shape.defaultData ?? { label: shape.label },
      });
      const anchors = connectionAnchorPoints(node, shape.anchors);
      expect(anchors.length, `${plugin.id}/${shape.type}`).toBeGreaterThanOrEqual(shape.type === 'entity' ? 4 : 4);
      expect(anchors.every((anchor) => anchor.anchor.nodeId === node.id)).toBe(true);
      expect(anchors.every((anchor) => Number.isFinite(anchor.point.x) && Number.isFinite(anchor.point.y))).toBe(true);
    }));
  });

  it('resolves ERD field anchors without special-casing the canvas', () => {
    const shape = pluginManager.getShape('erd', 'entity');
    const node = createNode('entity', { x: 40, y: 20 }, {
      library: 'erd',
      size: { width: 220, height: 88 },
      data: { label: 'users', fields: ['id · uuid · PK', 'name · varchar'] },
    });
    const anchors = connectionAnchorPoints(node, shape?.anchors);
    expect(anchors.map((anchor) => anchor.anchor.id)).toEqual(['top', 'bottom', 'field-0-left', 'field-0-right', 'field-1-left', 'field-1-right']);
    expect(anchors.find((anchor) => anchor.anchor.id === 'field-1-right')?.point).toEqual({ x: 260, y: 94.5 });
  });
});
