import RBush from 'rbush';
import type { SpatialNode, SpatialRequest, SpatialResponse } from '../spatial/types';

interface TreeItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

const tree = new RBush<TreeItem>();
const items = new Map<string, TreeItem>();
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<SpatialRequest>) => void) | null;
  postMessage: (message: SpatialResponse) => void;
};

workerScope.onmessage = (event) => {
  const request = event.data;
  try {
    switch (request.kind) {
      case 'initialize':
        tree.clear();
        items.clear();
        tree.load(request.nodes.map(toTreeItem));
        request.nodes.forEach((node) => items.set(node.id, toTreeItem(node)));
        respond({ kind: 'ready', requestId: request.requestId });
        break;
      case 'upsert':
        request.nodes.forEach(upsert);
        respond({ kind: 'ready', requestId: request.requestId });
        break;
      case 'remove':
        request.ids.forEach(remove);
        respond({ kind: 'ready', requestId: request.requestId });
        break;
      case 'queryViewport':
        respond({ kind: 'result', requestId: request.requestId, ids: tree.search(request.bounds).map((item) => item.id) });
        break;
      case 'queryNearby': {
        const bounds = { minX: request.x - request.radius, minY: request.y - request.radius, maxX: request.x + request.radius, maxY: request.y + request.radius };
        respond({ kind: 'result', requestId: request.requestId, ids: tree.search(bounds).map((item) => item.id) });
        break;
      }
    }
  } catch (error) {
    respond({ kind: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : 'Spatial query failed.' });
  }
};

function upsert(node: SpatialNode): void {
  remove(node.id);
  const item = toTreeItem(node);
  items.set(node.id, item);
  tree.insert(item);
}

function remove(id: string): void {
  const item = items.get(id);
  if (!item) return;
  tree.remove(item, (left, right) => left.id === right.id);
  items.delete(id);
}

function toTreeItem(node: SpatialNode): TreeItem {
  return { minX: node.minX, minY: node.minY, maxX: node.maxX, maxY: node.maxY, id: node.id };
}

function respond(message: SpatialResponse): void {
  workerScope.postMessage(message);
}
