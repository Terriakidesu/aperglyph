import {
  ArrowRight, Boxes, Copy, Database, FilePlus2, LayoutTemplate, MoreHorizontal,
  Network, Plus, RotateCcw, Search, ShieldCheck, Sparkles, Trash2, Upload, Workflow,
} from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createId, migrateDocument } from '../core/document';
import { createTemplateDocument } from '../core/templates';
import type { DiagramDocument, DiagramType } from '../core/types';
import { clearRecoverySnapshot, deleteDocument, deleteLocalTemplate, duplicateDocument, getRecoverySnapshot, getStorageEstimate, listDocuments, listLocalTemplates, listTrashedDocuments, readProjectFile, renameDocument, restoreDocument, trashDocument, updateDocumentMetadata } from '../persistence';
import type { LocalTemplate, RecoverySnapshot, StorageEstimate, StoredDocument } from '../persistence';
import { LogoMark } from './LogoMark';

interface HomeScreenProps {
  onOpen: (document: DiagramDocument) => void;
  onInstall?: () => void;
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
  record?: StoredDocument;
  thumbnail?: string;
  favorite?: boolean;
}

const fallbackRecent: RecentItem[] = [
  { name: 'AperGlyph product map', type: 'Flowchart', time: 'Just now', color: 'mint', icon: Workflow },
  { name: 'Workspace data model', type: 'ERD', time: 'Yesterday', color: 'blue', icon: Database },
  { name: 'Onboarding experience', type: 'Use case', time: 'Sep 18', color: 'pink', icon: Boxes },
];

export function HomeScreen({ onOpen, onInstall }: HomeScreenProps) {
  const [query, setQuery] = useState('');
  const [savedDocuments, setSavedDocuments] = useState<StoredDocument[]>([]);
  const [trashedDocuments, setTrashedDocuments] = useState<StoredDocument[]>([]);
  const [localTemplates, setLocalTemplates] = useState<LocalTemplate[]>(() => listLocalTemplates());
  const [recovery, setRecovery] = useState<RecoverySnapshot | null>(null);
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | DiagramType>('all');
  const [sortMode, setSortMode] = useState<'updated' | 'name' | 'type'>('updated');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([listDocuments(), listTrashedDocuments(), getRecoverySnapshot(), getStorageEstimate()]).then(([documents, trash, snapshot, estimate]) => {
      if (!active) return;
      setSavedDocuments(documents);
      setTrashedDocuments(trash);
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

  const openLocalTemplate = (template: LocalTemplate) => {
    const now = Date.now();
    onOpen(migrateDocument({ ...structuredClone(template.document), id: createId('doc'), name: template.name, createdAt: now, updatedAt: now }));
  };

  const sortedDocuments = [...savedDocuments].filter((record) => typeFilter === 'all' || record.diagramType === typeFilter).sort((left, right) => sortMode === 'name' ? left.name.localeCompare(right.name) : sortMode === 'type' ? left.diagramType.localeCompare(right.diagramType) || right.updatedAt - left.updatedAt : right.updatedAt - left.updatedAt);
  const recentItems: RecentItem[] = savedDocuments.length > 0
    ? sortedDocuments.slice(0, 12).map(toRecentItem)
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

  const removeDocument = async (event: ReactMouseEvent<HTMLButtonElement>, id: string, name: string) => {
    event.stopPropagation();
    if (deletingId || !window.confirm(`Move “${name}” to the trash?`)) return;
    try {
      setDeletingId(id);
      await trashDocument(id);
      setSavedDocuments((documents) => documents.filter((document) => document.id !== id));
      const trashed = await listTrashedDocuments();
      setTrashedDocuments(trashed);
      if (recovery?.document.id === id) {
        await clearRecoverySnapshot();
        setRecovery(null);
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Unable to delete this project.');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleFavorite = async (event: ReactMouseEvent<HTMLButtonElement>, record: StoredDocument) => {
    event.stopPropagation();
    await updateDocumentMetadata(record.id, { favorite: !record.favorite });
    setSavedDocuments((documents) => documents.map((document) => document.id === record.id ? { ...document, favorite: !record.favorite } : document));
  };

  const renameSavedDocument = async (event: ReactMouseEvent<HTMLButtonElement>, record: StoredDocument) => {
    event.stopPropagation();
    const name = window.prompt('Diagram name', record.name);
    if (!name?.trim()) return;
    const renamed = await renameDocument(record.id, name);
    if (renamed) setSavedDocuments((documents) => documents.map((document) => document.id === record.id ? { ...document, name: renamed.name, document: renamed, updatedAt: renamed.updatedAt } : document));
  };

  const duplicateSavedDocument = async (event: ReactMouseEvent<HTMLButtonElement>, record: StoredDocument) => {
    event.stopPropagation();
    const duplicate = await duplicateDocument(record.id);
    if (duplicate) setSavedDocuments(await listDocuments());
  };

  const restoreTrashedDocument = async (id: string) => {
    await restoreDocument(id);
    setTrashedDocuments(await listTrashedDocuments());
    setSavedDocuments(await listDocuments());
  };

  const permanentlyDeleteDocument = async (id: string) => {
    await deleteDocument(id);
    setTrashedDocuments(await listTrashedDocuments());
  };

  return (
    <main className="home-shell" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) void openFile(file); }}>
      <header className="home-header">
        <LogoMark />
        <nav className="home-nav">
          <button className="nav-link active">Workspace</button>
          <button className="nav-link" onClick={() => document.getElementById('templates')?.scrollIntoView({ behavior: 'smooth' })}>Templates</button>
          <button className="nav-link" onClick={() => setShowShortcuts(true)}>Shortcuts</button>
        </nav>
          <div className="home-header-actions">
           <span className="local-pill"><span className="status-dot" /> Local only</span>
           {onInstall && <button className="secondary-button install-button" onClick={onInstall}>Install app</button>}
           <span className="avatar" aria-label="Local workspace">AG</span>
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

          <section className="section-block" id="templates">
          <div className="section-heading"><div><h2>Start with a canvas</h2><p>Pick a language for your thinking, or make your own.</p></div><button className="text-button" onClick={() => document.getElementById('templates')?.scrollIntoView({ behavior: 'smooth' })}>View all <ArrowRight size={14} /></button></div>
          <div className="template-grid">
            {templates.map((template) => {
              const Icon = template.icon;
              return <button key={template.type} className="template-card" onClick={() => openTemplate(template.type, template.name)}>
                <div className={`template-icon ${template.color}`}><Icon size={20} /></div>
                <div className="template-card-copy"><h3>{template.name}</h3><p>{template.description}</p><span>{template.nodes}</span></div>
                <ArrowRight className="template-arrow" size={16} />
              </button>;
            })}
            {localTemplates.map((template) => <article className="template-card local-template-card" key={template.id}><button className="local-template-open" onClick={() => openLocalTemplate(template)}><div className="template-icon violet"><LayoutTemplate size={20} /></div><div className="template-card-copy"><h3>{template.name}</h3><p>Saved local template</p><span>Custom template</span></div><ArrowRight className="template-arrow" size={16} /></button><button className="local-template-delete" title={`Delete template ${template.name}`} aria-label={`Delete template ${template.name}`} onClick={() => { deleteLocalTemplate(template.id); setLocalTemplates(listLocalTemplates()); }}><Trash2 size={12} /></button></article>)}
          </div>
        </section>

        <section className="section-block recent-section">
           <div className="section-heading"><div><h2>Recent diagrams</h2><p>Continue where you left off.</p></div><div className="recent-tools"><div className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search diagrams" /></div><select className="workspace-select" aria-label="Filter diagrams" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | DiagramType)}><option value="all">All types</option><option value="general">General</option><option value="flowchart">Flowchart</option><option value="erd">ERD</option><option value="dfd">DFD</option><option value="use-case">Use case</option></select><select className="workspace-select" aria-label="Sort diagrams" value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)}><option value="updated">Recent</option><option value="name">Name</option><option value="type">Type</option></select><button className={showTrash ? 'icon-button subtle active' : 'icon-button subtle'} title="Show trash" aria-label="Show trash" onClick={() => setShowTrash((visible) => !visible)}><Trash2 size={15} /></button><button className="icon-button subtle" title="Clear search" aria-label="Clear search" onClick={() => setQuery('')}><MoreHorizontal size={17} /></button></div></div>
           <div className="recent-grid">
              {visibleItems.map((item, index) => {
                const Icon = item.icon;
                const document = item.document;
                return <article key={document?.id ?? `${item.name}-${index}`} className="recent-card">
                  <button className="recent-card-open" onClick={() => document ? onOpen(document) : openTemplate(item.type === 'ERD' ? 'erd' : item.type === 'Use case' ? 'use-case' : 'flowchart', item.name)}>
                    <div className={`recent-preview ${item.color}`}>{item.thumbnail ? <img src={item.thumbnail} alt="" /> : <><div className="mini-grid" /><div className="mini-line line-a" /><div className="mini-line line-b" /><div className="mini-node node-a" /><div className="mini-node node-b" /><div className="mini-node node-c" /></>}</div>
                    <div className="recent-card-footer"><div className={`recent-type ${item.color}`}><Icon size={13} /></div><div className="recent-copy"><strong>{item.name}</strong><span>{item.type} · {item.time}</span></div></div>
                  </button>
                  {item.record && <div className="recent-card-actions"><button className={item.favorite ? 'recent-action favorite' : 'recent-action'} title={item.favorite ? 'Remove favorite' : 'Favorite'} aria-label={item.favorite ? 'Remove favorite' : 'Favorite'} onClick={(event) => void toggleFavorite(event, item.record!)}>★</button><button className="recent-action" title="Rename" aria-label={`Rename ${item.name}`} onClick={(event) => void renameSavedDocument(event, item.record!)}>✎</button><button className="recent-action" title="Duplicate" aria-label={`Duplicate ${item.name}`} onClick={(event) => void duplicateSavedDocument(event, item.record!)}><Copy size={13} /></button><button className="recent-action" title={`Move ${item.name} to trash`} aria-label={`Delete ${item.name}`} disabled={deletingId === item.record.id} onClick={(event) => void removeDocument(event, item.record!.id, item.record!.name)}><Trash2 size={13} /></button></div>}
                </article>;
              })}
            {visibleItems.length === 0 && <div className="empty-recent"><Search size={17} /><span>No diagrams match “{query}”.</span></div>}
           </div>
           {showTrash && <div className="trash-panel"><div className="trash-heading"><strong>Trash</strong><span>{trashedDocuments.length} removed {trashedDocuments.length === 1 ? 'diagram' : 'diagrams'}</span></div>{trashedDocuments.length === 0 ? <span className="trash-empty">Trash is empty.</span> : trashedDocuments.map((record) => <div className="trash-row" key={record.id}><span><strong>{record.name}</strong><small>{record.diagramType} · moved {formatRelativeTime(record.trashedAt ?? record.updatedAt)}</small></span><div><button className="secondary-button" onClick={() => void restoreTrashedDocument(record.id)}><RotateCcw size={12} /> Restore</button><button className="icon-button subtle" title="Delete permanently" aria-label={`Delete ${record.name} permanently`} onClick={() => void permanentlyDeleteDocument(record.id)}><Trash2 size={13} /></button></div></div>)}</div>}
         </section>
      </div>

       {fileError && <div className="file-error"><span>{fileError}</span><button onClick={() => setFileError(null)}>Dismiss</button></div>}
       {showShortcuts && <div className="modal-backdrop" onClick={() => setShowShortcuts(false)}><div className="shortcuts-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="panel-kicker">AperGlyph</span><h2>Keyboard shortcuts</h2></div><button className="icon-button" onClick={() => setShowShortcuts(false)} aria-label="Close shortcuts">×</button></div><div className="shortcut-list"><div className="shortcut-row"><span>Select tool</span><kbd>V</kbd></div><div className="shortcut-row"><span>Pan canvas</span><kbd>H</kbd></div><div className="shortcut-row"><span>Undo / redo</span><kbd>Ctrl Z / Ctrl Shift Z</kbd></div><div className="shortcut-row"><span>Copy / paste</span><kbd>Ctrl C / Ctrl V</kbd></div><div className="shortcut-row"><span>Duplicate</span><kbd>Ctrl D</kbd></div></div></div></div>}
      <input ref={fileInput} className="visually-hidden" type="file" accept=".wdiag,.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openFile(file); event.target.value = ''; }} />
      <footer className="home-footer"><span><LayoutTemplate size={14} /> AperGlyph 0.12.0</span><span>Local-first · Open format · No account required</span><span className="footer-links">Guide &nbsp;·&nbsp; Privacy &nbsp;·&nbsp; Keyboard shortcuts</span></footer>
    </main>
  );
}

function toRecentItem(record: StoredDocument) {
  const type = record.diagramType === 'use-case' ? 'Use case' : record.diagramType === 'erd' ? 'ERD' : record.diagramType === 'dfd' ? 'DFD' : record.diagramType === 'flowchart' ? 'Flowchart' : 'General';
  const presentation = record.diagramType === 'erd' ? { color: 'blue', icon: Database } : record.diagramType === 'use-case' ? { color: 'pink', icon: Boxes } : record.diagramType === 'dfd' ? { color: 'amber', icon: Network } : { color: 'mint', icon: Workflow };
  return { name: record.name, type, time: formatRelativeTime(record.updatedAt), document: record.document, record, thumbnail: record.thumbnail, favorite: record.favorite, ...presentation };
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
