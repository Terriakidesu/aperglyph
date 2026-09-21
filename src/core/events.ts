import type { DiagramDocument, Point, Viewport } from './types';

export interface EditorEventMap {
  'document:changed': { document: DiagramDocument; action: string };
  'document:opened': { document: DiagramDocument };
  'selection:changed': { ids: string[] };
  'viewport:changed': Viewport;
  'viewport:fit': { scope: 'page' | 'selection' };
  'ui:shortcuts': undefined;
  'history:changed': { canUndo: boolean; canRedo: boolean; lastAction: string | null };
  'node:created': { nodeId: string };
  'node:moved': { nodeIds: string[]; positions: Record<string, Point> };
  'node:removed': { nodeIds: string[] };
  'edge:created': { edgeId: string };
  'edge:removed': { edgeIds: string[] };
  'edge:changed': { edgeId: string };
  'storage:saved': { documentId: string };
  'storage:error': { error: Error };
}

type Listener<T> = (payload: T) => void;

export class EventBus<Events> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<Key extends keyof Events>(event: Key, listener: Listener<Events[Key]>): () => void {
    const listeners = this.listeners.get(event) ?? new Set<Listener<never>>();
    listeners.add(listener as Listener<never>);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener as Listener<never>);
  }

  emit<Key extends keyof Events>(event: Key, payload: Events[Key]): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload as never));
  }

  clear(): void { this.listeners.clear(); }
}

export const editorEvents = new EventBus<EditorEventMap>();
