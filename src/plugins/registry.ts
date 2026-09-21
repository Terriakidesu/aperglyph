import type { DiagramType } from '../core/types';
import { builtInPlugins } from './builtins';
import type { DiagramPlugin } from './types';

export class PluginManager {
  private readonly plugins = new Map<string, DiagramPlugin>();

  constructor(plugins: DiagramPlugin[] = []) {
    [...builtInPlugins, ...plugins].forEach((plugin) => this.register(plugin));
  }

  register(plugin: DiagramPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  get(id: DiagramType | string): DiagramPlugin {
    return this.plugins.get(id) ?? this.plugins.get('general')!;
  }

  list(): DiagramPlugin[] {
    return [...this.plugins.values()];
  }
}

export const pluginManager = new PluginManager();
