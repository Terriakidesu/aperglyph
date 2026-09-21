export interface SpatialNode {
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type SpatialRequestPayload =
  | { kind: 'initialize'; nodes: SpatialNode[] }
  | { kind: 'upsert'; nodes: SpatialNode[] }
  | { kind: 'remove'; ids: string[] }
  | { kind: 'queryViewport'; bounds: SpatialBounds }
  | { kind: 'queryNearby'; x: number; y: number; radius: number };

export type SpatialRequest = SpatialRequestPayload & { requestId: number };

export type SpatialEngine = 'wasm' | 'typescript';

export type SpatialResponse =
  | { kind: 'ready'; requestId: number; engine?: SpatialEngine }
  | { kind: 'result'; requestId: number; ids: string[] }
  | { kind: 'error'; requestId: number; message: string };
