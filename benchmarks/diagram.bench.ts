import { describe, test } from 'vitest';
import { createEdge, createNode } from '../src/core/document';
import { layoutNodes } from '../src/core/layout';
import { edgeRoute } from '../src/core/routing';
import { nodeToSpatialNode, viewportBounds } from '../src/spatial';

function makeNodes(count: number) {
  return Array.from({ length: count }, (_, index) => createNode('rectangle', {
    x: (index % 100) * 220,
    y: Math.floor(index / 100) * 120,
  }));
}

function makeChain(nodes: ReturnType<typeof makeNodes>) {
  return nodes.slice(1).map((node, index) => createEdge({ nodeId: nodes[index].id }, { nodeId: node.id }));
}

describe('viewport broad-phase fallback', () => {
  for (const count of [100, 1_000, 10_000, 50_000]) {
    const nodes = makeNodes(count);
    const spatialNodes = nodes.map((node) => nodeToSpatialNode(node.id, node.position, node.size));
    const bounds = viewportBounds({ x: -2_000, y: -1_000, zoom: 1 }, { width: 1_200, height: 800 });
    test(`filters ${count.toLocaleString()} rectangles`, async ({ bench }) => {
      await bench('RBush-compatible rectangle filter', () => {
        spatialNodes.filter((node) => node.minX <= bounds.maxX && node.maxX >= bounds.minX && node.minY <= bounds.maxY && node.maxY >= bounds.minY);
      }).run();
    });
  }
});

describe('graph layout', () => {
  for (const count of [100, 1_000, 10_000]) {
    const nodes = makeNodes(count);
    const edges = makeChain(nodes);
    test(`hierarchical layout for ${count.toLocaleString()} nodes`, async ({ bench }) => {
      await bench('TypeScript hierarchical layout', () => {
        layoutNodes(nodes, edges, 'hierarchical');
      }).run();
    });
  }
});

describe('connector routing', () => {
  for (const count of [100, 1_000]) {
    const nodes = makeNodes(count);
    const edge = createEdge({ nodeId: nodes[0].id }, { nodeId: nodes[count - 1].id }, { type: 'orthogonal' });
    test(`routes through ${count.toLocaleString()} node obstacles`, async ({ bench }) => {
      await bench('orthogonal connector routing', () => {
        edgeRoute(edge, nodes[0], nodes[count - 1], nodes);
      }).run();
    });
  }
});
