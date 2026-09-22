import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PageSettings, PageSettingsPatch, SnapSettings } from '../core/types';
import { getSnapSettings } from '../core/snapping';
import type { ViewPreferences } from './EditorTopBar';

interface PreferencesDialogProps {
  view: ViewPreferences;
  onViewChange: (changes: Partial<ViewPreferences>) => void;
  pageSettings?: PageSettings;
  onPageSettingsChange: (changes: PageSettingsPatch) => void;
  leftWidth: number;
  rightWidth: number;
  onWidthChange: (side: 'left' | 'right', value: number) => void;
  snapshotLimit: number;
  onSnapshotLimitChange: (value: number) => void;
  onRestoreDefaults: () => void;
  onClose: () => void;
}

export function PreferencesDialog({ view, onViewChange, pageSettings, onPageSettingsChange, leftWidth, rightWidth, onWidthChange, snapshotLimit, onSnapshotLimitChange, onRestoreDefaults, onClose }: PreferencesDialogProps) {
  const snap = pageSettings ? getSnapSettings(pageSettings) : { grid: true, objects: true, guides: true, ports: true };
  const toggleSnap = (key: keyof SnapSettings) => onPageSettingsChange({ snapSettings: { [key]: !snap[key] } });
  return <div className="modal-backdrop preferences-backdrop" onClick={onClose}><section className="preferences-dialog" role="dialog" aria-modal="true" aria-labelledby="preferences-title" onClick={(event) => event.stopPropagation()}>
    <div className="preferences-heading"><div><span className="panel-kicker">AperGlyph</span><h2 id="preferences-title">Preferences</h2><p>Editor preferences are stored locally on this device.</p></div><button className="icon-button" aria-label="Close preferences" onClick={onClose}><X size={15} /></button></div>
    <div className="preferences-scroll">
      <PreferenceSection title="Editor"><div className="preference-toggle-grid"><PreferenceToggle label="Show rulers" value={view.rulers} onChange={() => onViewChange({ rulers: !view.rulers })} /><PreferenceToggle label="Show guides" value={view.guides} onChange={() => onViewChange({ guides: !view.guides })} /><PreferenceToggle label="Show minimap" value={view.minimap} onChange={() => onViewChange({ minimap: !view.minimap })} /><PreferenceToggle label="Canvas hints" value={view.connectionHints} onChange={() => onViewChange({ connectionHints: !view.connectionHints })} /></div><div className="preference-grid"><label>Left dock width<input type="number" min="180" max="360" value={leftWidth} onChange={(event) => onWidthChange('left', Number(event.target.value))} /> px</label><label>Inspector width<input type="number" min="220" max="400" value={rightWidth} onChange={(event) => onWidthChange('right', Number(event.target.value))} /> px</label></div></PreferenceSection>
      <PreferenceSection title="Snapping"><div className="preference-toggle-grid"><PreferenceToggle label="Grid" value={snap.grid} onChange={() => toggleSnap('grid')} /><PreferenceToggle label="Objects" value={snap.objects} onChange={() => toggleSnap('objects')} /><PreferenceToggle label="Guides" value={snap.guides} onChange={() => toggleSnap('guides')} /><PreferenceToggle label="Connection ports" value={snap.ports} onChange={() => toggleSnap('ports')} /></div>{pageSettings && <label className="preference-field">Grid size<input type="number" min="1" max="512" value={pageSettings.gridSize} onChange={(event) => onPageSettingsChange({ gridSize: Math.min(512, Math.max(1, Number(event.target.value) || pageSettings.gridSize)) })} /> px</label>}<small className="preference-note">Hold Alt while dragging to temporarily disable all snapping.</small></PreferenceSection>
      <PreferenceSection title="History"><label className="preference-field">Snapshot retention<select value={snapshotLimit} onChange={(event) => onSnapshotLimitChange(Number(event.target.value))}><option value="12">12 snapshots</option><option value="31">31 snapshots</option><option value="90">90 snapshots</option><option value="180">180 snapshots</option><option value="365">365 snapshots</option></select></label></PreferenceSection>
    </div>
    <div className="preferences-footer"><button className="secondary-button" onClick={onRestoreDefaults}>Restore defaults</button><button className="primary-button" onClick={onClose}>Done</button></div>
  </section></div>;
}

function PreferenceSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="preference-section"><h3>{title}</h3>{children}</section>;
}

function PreferenceToggle({ label, value, onChange }: { label: string; value: boolean; onChange: () => void }) {
  return <label className="preference-toggle"><input type="checkbox" checked={value} onChange={onChange} /><span>{label}</span></label>;
}
