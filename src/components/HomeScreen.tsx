import {
  ArrowRight, Boxes, Database, FilePlus2, LayoutTemplate, MoreHorizontal,
  Network, Plus, RotateCcw, Search, ShieldCheck, Sparkles, Trash2, Upload, Workflow,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createTemplateDocument } from '../core/templates';
import type { DiagramDocument, DiagramType } from '../core/types';
import { clearRecoverySnapshot, getRecoverySnapshot, getStorageEstimate, listDocuments, readProjectFile } from '../persistence';
import type { RecoverySnapshot, StorageEstimate, StoredDocument } from '../persistence';
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

interface RecentItem {
  name: string;
  type: string;
  time: string;
  color: string;
  icon: typeof Workflow;
  document?: DiagramDocument;
}

const fallbackRecent: RecentItem[] = [
  { name: 'AperGlyph product map', type: 'Flowchart', time: 'Just now', color: 'mint', icon: Workflow },
  { name: 'Workspace data model', type: 'ERD', time: 'Yesterday', color: 'blue', icon: Database },
  { name: 'Onboarding experience', type: 'Use case', time: 'Sep 18', color: 'pink', icon: Boxes },
];

export function HomeScreen({ onOpen }: HomeScreenProps) {
  const [query, setQuery] = useState('');
  const [savedDocuments, setSavedDocuments] = useState<StoredDocument[]>([]);
  const [recovery, setRecovery] = useState<RecoverySnapshot | null>(null);
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([listDocuments(), getRecoverySnapshot(), getStorageEstimate()]).then(([documents, snapshot, estimate]) => {
      if (!active) return;
      setSavedDocuments(documents);
      setRecovery(snapshot);
      setStorage(estimate);
    }).catch(() => {
      // The workspace remains usable when a browser blocks local storage.
    });
    return () => { active = false; };
  }, []);

  const openTemplate = (type: DiagramType, name: string) => {
    onOpen(createTemplateDocument(name, type));
  };

  const openFile = async (file: File) => {
    try {
      setFileError(null);
      onOpen(await readProjectFile(file));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Unable to open this file.');
    }
  };

  const recentItems: RecentItem[] = savedDocuments.length > 0
    ? savedDocuments.slice(0, 6).map(toRecentItem)
    : fallbackRecent;
  const visibleItems = recentItems.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
  const lastSaved = savedDocuments[0]?.updatedAt;

  const restoreRecovery = () => {
    if (!recovery) return;
    onOpen(recovery.document);
    setRecovery(null);
  };

  const discardRecovery = async () => {
    await clearRecoverySnapshot();
    setRecovery(null);
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
            <button className="secondary-button large" onClick={() => fileInput.current?.click()}><Upload size={16} /> Open file</button>
          </div>
        </section>

        {recovery && <section className="recovery-callout"><div className="recovery-icon"><RotateCcw size={18} /></div><div className="recovery-copy"><strong>Unsaved work found</strong><span>AperGlyph recovered a local snapshot from {formatRelativeTime(recovery.savedAt)}.</span></div><div className="recovery-actions"><button className="secondary-button" onClick={() => void discardRecovery()}><Trash2 size={14} /> Discard</button><button className="primary-button" onClick={restoreRecovery}><RotateCcw size={14} /> Restore</button></div></section>}

        <section className="workspace-stats">
          <div className="workspace-stat"><span className="stat-label">Local diagrams</span><strong>{savedDocuments.length || '—'}</strong><span className="stat-trend">No limits</span></div>
          <div className="workspace-stat"><span className="stat-label">Storage used</span><strong>{storage?.usage ? formatBytes(storage.usage) : '—'}</strong><span className="stat-trend">{storage?.persistent ? 'persistent on device' : 'browser-managed space'}</span></div>
          <div className="workspace-stat"><span className="stat-label">Last saved</span><strong>{lastSaved ? formatRelativeTime(lastSaved) : 'not yet'}</strong><span className="stat-trend saved-trend">● safely on device</span></div>
          <div className="workspace-stat stat-note"><div className="stat-note-icon"><ShieldCheck size={16} /></div><span><strong>Offline by design.</strong> Your work never needs a server.</span></div>
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
            {visibleItems.map((item, index) => {
              const Icon = item.icon;
              return <button key={item.document?.id ?? `${item.name}-${index}`} className="recent-card" onClick={() => ('document' in item && item.document) ? onOpen(item.document) : openTemplate(item.type === 'ERD' ? 'erd' : item.type === 'Use case' ? 'use-case' : 'flowchart', item.name)}>
                <div className={`recent-preview ${item.color}`}><div className="mini-grid" /><div className="mini-line line-a" /><div className="mini-line line-b" /><div className="mini-node node-a" /><div className="mini-node node-b" /><div className="mini-node node-c" /></div>
                <div className="recent-card-footer"><div className={`recent-type ${item.color}`}><Icon size={13} /></div><div className="recent-copy"><strong>{item.name}</strong><span>{item.type} · {item.time}</span></div><MoreHorizontal size={16} className="recent-more" /></div>
              </button>;
            })}
            {visibleItems.length === 0 && <div className="empty-recent"><Search size={17} /><span>No diagrams match “{query}”.</span></div>}
          </div>
        </section>
      </div>

      {fileError && <div className="file-error"><span>{fileError}</span><button onClick={() => setFileError(null)}>Dismiss</button></div>}
      <input ref={fileInput} className="visually-hidden" type="file" accept=".wdiag,.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openFile(file); event.target.value = ''; }} />
      <footer className="home-footer"><span><LayoutTemplate size={14} /> AperGlyph 0.9.0</span><span>Local-first · Open format · No account required</span><span className="footer-links">Guide &nbsp;·&nbsp; Privacy &nbsp;·&nbsp; Keyboard shortcuts</span></footer>
    </main>
  );
}

function toRecentItem(record: StoredDocument) {
  const type = record.diagramType === 'use-case' ? 'Use case' : record.diagramType === 'erd' ? 'ERD' : record.diagramType === 'dfd' ? 'DFD' : record.diagramType === 'flowchart' ? 'Flowchart' : 'General';
  const presentation = record.diagramType === 'erd' ? { color: 'blue', icon: Database } : record.diagramType === 'use-case' ? { color: 'pink', icon: Boxes } : record.diagramType === 'dfd' ? { color: 'amber', icon: Network } : { color: 'mint', icon: Workflow };
  return { name: record.name, type, time: formatRelativeTime(record.updatedAt), document: record.document, ...presentation };
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
