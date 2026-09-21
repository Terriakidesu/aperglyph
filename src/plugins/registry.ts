import type { DiagramType } from '../core/types';
import { builtInPlugins } from './builtins';
import type { DiagramPlugin } from './types';

export class PluginManager {
  private readonly plugins = new Map<string, DiagramPlugin>();
  private readonly customPlugins = new Map<string, DiagramPlugin>();
  private readonly listeners = new Set<() => void>();
  private snapshot: DiagramPlugin[] = [];
  private builtInSnapshot = builtInPlugins;

  constructor(plugins: DiagramPlugin[] = []) {
    plugins.forEach((plugin) => this.register(plugin));
    this.refresh();
  }

  register(plugin: DiagramPlugin): void {
    this.customPlugins.set(plugin.id, plugin);
    this.refresh();
  }

  get(id: DiagramType | string): DiagramPlugin {
    this.refreshIfNeeded();
    return this.plugins.get(id) ?? this.plugins.get('general')!;
  }

  list(): DiagramPlugin[] {
    this.refreshIfNeeded();
    return this.snapshot;
  }

  getShape(libraryId: string, type: string) {
    this.refreshIfNeeded();
    return this.plugins.get(libraryId)?.shapes.find((shape) => shape.type === type)
      ?? [...this.plugins.values()].find((plugin) => plugin.shapes.some((shape) => shape.type === type))?.shapes.find((shape) => shape.type === type);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DiagramPlugin[] => {
    this.refreshIfNeeded();
    return this.snapshot;
  };

  /** Rebuilds the catalog after a Vite module update without a full reload. */
  refresh(): void {
    this.plugins.clear();
    builtInPlugins.forEach((plugin) => this.plugins.set(plugin.id, plugin));
    this.customPlugins.forEach((plugin) => this.plugins.set(plugin.id, plugin));
    this.builtInSnapshot = builtInPlugins;
    this.snapshot = [...this.plugins.values()];
    this.listeners.forEach((listener) => listener());
  }

  private refreshIfNeeded(): void {
    if (this.builtInSnapshot !== builtInPlugins) this.refresh();
  }
}

export const pluginManager = new PluginManager();

if (import.meta.hot) {
  import.meta.hot.accept('./builtins', () => pluginManager.refresh());
}
