import {
  ArrowRight, Boxes, Database, FilePlus2, FolderOpen, GitBranch, LayoutTemplate,
  MoreHorizontal, Network, Plus, Search, Sparkles, Workflow,
} from 'lucide-react';
import { useState } from 'react';
import { createTemplateDocument } from '../core/templates';
import type { DiagramDocument, DiagramType } from '../core/types';
import { useEditorStore } from '../store/editorStore';
import { LogoMark } from './LogoMark';

interface HomeScreenProps {
  onOpen: (document: DiagramDocument) => void;
}

const templates: Array<{ type: DiagramType; name: string; description: string; icon: typeof Workflow; color: string; nodes: string }> = [
  { type: 'general', name: 'Blank canvas', description: 'Start from an open canvas', icon: FilePlus2, color: 'violet', nodes: 'Start fresh' },
  { type: 'flowchart', name: 'Flowchart', description: 'Map a process with clarity', icon: Workflow, color: 'mint', nodes: '5 nodes · 5 connectors' },
  { type: 'erd', name: 'Entity relationship', description: 'Model your data system', icon: Database, color: 'blue', nodes: '3 entities · 2 relations' },
  { type: 'dfd', name: 'Data flow diagram', description: 'See information in motion', icon: Network, color: 'amber', nodes: '3 elements · 2 flows' },
  { type: 'use-case', name: 'UML use case', description: 'Frame actors and intent', icon: Boxes, color: 'pink', nodes: '4 elements · 2 links' },
];

const recent = [
  { name: 'AperGlyph product map', type: 'Flowchart', time: 'Just now', color: 'mint', icon: Workflow },
  { name: 'Workspace data model', type: 'ERD', time: 'Yesterday', color: 'blue', icon: Database },
  { name: 'Onboarding experience', type: 'Use case', time: 'Sep 18', color: 'pink', icon: Boxes },
];

export function HomeScreen({ onOpen }: HomeScreenProps) {
  const reset = useEditorStore((state) => state.reset);
  const [query, setQuery] = useState('');

  const openTemplate = (type: DiagramType, name: string) => {
    const document = type === 'general' ? createTemplateDocument(name, type) : createTemplateDocument(name, type);
    reset(name, type);
    // Keep template creation outside the store's command history for a clean first open.
    onOpen(document);
  };

  return (
    <main className="home-shell">
      <header className="home-header">
        <LogoMark />
        <nav className="home-nav">
          <button className="nav-link active">Workspace</button>
          <button className="nav-link">Templates</button>
          <button className="nav-link">Shortcuts</button>
        </nav>
        <div className="home-header-actions">
          <span className="local-pill"><span className="status-dot" /> Local only</span>
          <button className="avatar">AG</button>
        </div>
      </header>

      <div className="home-content">
        <section className="welcome-row">
          <div>
            <p className="eyebrow"><Sparkles size={14} /> Your local workspace</p>
            <h1>Make the invisible <em>visible.</em></h1>
            <p className="welcome-copy">A quiet place for complex ideas. Draw freely, think spatially, and keep every diagram on your device.</p>
          </div>
          <div className="welcome-actions">
            <button className="primary-button large" onClick={() => openTemplate('general', 'Untitled diagram')}><Plus size={17} /> New diagram</button>
            <button className="secondary-button large"><FolderOpen size={16} /> Open file</button>
          </div>
        </section>

        <section className="workspace-stats">
          <div className="workspace-stat"><span className="stat-label">Local diagrams</span><strong>12</strong><span className="stat-trend">No limits</span></div>
          <div className="workspace-stat"><span className="stat-label">Storage used</span><strong>18.4 <small>MB</small></strong><span className="stat-trend">of available space</span></div>
          <div className="workspace-stat"><span className="stat-label">Last saved</span><strong>just now</strong><span className="stat-trend saved-trend">● safely on device</span></div>
          <div className="workspace-stat stat-note"><div className="stat-note-icon"><Sparkles size={16} /></div><span><strong>Offline by design.</strong> Your work never needs a server.</span></div>
        </section>

        <section className="section-block">
          <div className="section-heading"><div><h2>Start with a canvas</h2><p>Pick a language for your thinking, or make your own.</p></div><button className="text-button">View all <ArrowRight size={14} /></button></div>
          <div className="template-grid">
            {templates.map((template) => {
              const Icon = template.icon;
              return <button key={template.type} className="template-card" onClick={() => openTemplate(template.type, template.name)}>
                <div className={`template-icon ${template.color}`}><Icon size={20} /></div>
                <div className="template-card-copy"><h3>{template.name}</h3><p>{template.description}</p><span>{template.nodes}</span></div>
                <ArrowRight className="template-arrow" size={16} />
              </button>;
            })}
          </div>
        </section>

        <section className="section-block recent-section">
          <div className="section-heading"><div><h2>Recent diagrams</h2><p>Continue where you left off.</p></div><div className="recent-tools"><div className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search diagrams" /></div><button className="icon-button subtle"><MoreHorizontal size={17} /></button></div></div>
          <div className="recent-grid">
            {recent.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).map((item) => {
              const Icon = item.icon;
              return <button key={item.name} className="recent-card" onClick={() => openTemplate(item.type === 'ERD' ? 'erd' : item.type === 'Use case' ? 'use-case' : 'flowchart', item.name)}>
                <div className={`recent-preview ${item.color}`}><div className="mini-grid" /><div className="mini-line line-a" /><div className="mini-line line-b" /><div className="mini-node node-a" /><div className="mini-node node-b" /><div className="mini-node node-c" /></div>
                <div className="recent-card-footer"><div className={`recent-type ${item.color}`}><Icon size={13} /></div><div className="recent-copy"><strong>{item.name}</strong><span>{item.type} · {item.time}</span></div><MoreHorizontal size={16} className="recent-more" /></div>
              </button>;
            })}
          </div>
        </section>
      </div>

      <footer className="home-footer"><span><LayoutTemplate size={14} /> AperGlyph 0.3.0</span><span>Local-first · Open format · No account required</span><span className="footer-links">Guide &nbsp;·&nbsp; Privacy &nbsp;·&nbsp; Keyboard shortcuts</span></footer>
    </main>
  );
}
