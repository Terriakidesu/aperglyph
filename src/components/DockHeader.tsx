import { ListTree, PanelLeftClose, PanelRightClose, Shapes } from 'lucide-react';
import type { ReactNode } from 'react';

export type LeftPanelId = 'shapes' | 'outline';

export function LeftDockHeader({ activePanel, badge, onChange, onCollapse }: { activePanel: LeftPanelId; badge?: ReactNode; onChange: (panel: LeftPanelId) => void; onCollapse: () => void }) {
  return <div className="dock-header left-dock-header">
    <div className="dock-tab-list" role="tablist" aria-label="Workspace panel">
      <button className={`dock-tab ${activePanel === 'shapes' ? 'active' : ''}`} role="tab" aria-selected={activePanel === 'shapes'} title="Show shapes" onClick={() => onChange('shapes')}><Shapes size={13} /><span>Shapes</span></button>
      <button className={`dock-tab ${activePanel === 'outline' ? 'active' : ''}`} role="tab" aria-selected={activePanel === 'outline'} title="Show outline" onClick={() => onChange('outline')}><ListTree size={13} /><span>Outline</span></button>
    </div>
    {badge}
    <button className="dock-collapse" title="Collapse left panel" aria-label="Collapse left panel" onClick={onCollapse}><PanelLeftClose size={15} /></button>
  </div>;
}

export function InspectorDockHeader({ onCollapse }: { onCollapse: () => void }) {
  return <div className="dock-header inspector-dock-header">
    <div className="dock-heading"><span className="panel-kicker">Inspector</span><strong>Properties</strong></div>
    <button className="dock-collapse" title="Collapse properties panel" aria-label="Collapse properties panel" onClick={onCollapse}><PanelRightClose size={15} /></button>
  </div>;
}
