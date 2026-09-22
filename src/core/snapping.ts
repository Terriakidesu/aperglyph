import type { PageSettings, SnapSettings } from './types';

export const defaultSnapSettings: SnapSettings = { grid: true, objects: true, guides: true, ports: true };

/** Resolve both current documents and legacy pages that only have snapToGrid. */
export function getSnapSettings(settings: Pick<PageSettings, 'snapToGrid'> & Partial<Pick<PageSettings, 'snapSettings'>>): SnapSettings {
  const legacy = settings.snapToGrid ?? true;
  return {
    grid: settings.snapSettings?.grid ?? legacy,
    objects: settings.snapSettings?.objects ?? legacy,
    guides: settings.snapSettings?.guides ?? legacy,
    ports: settings.snapSettings?.ports ?? legacy,
  };
}

export function mergeSnapSettings(settings: Pick<PageSettings, 'snapToGrid'> & Partial<Pick<PageSettings, 'snapSettings'>>, changes: Partial<SnapSettings>): SnapSettings {
  return { ...getSnapSettings(settings), ...changes };
}
