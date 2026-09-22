import { AlertTriangle, CheckCircle2, CircleAlert, Filter, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import './diagnostics.css';
import { buildDiagnosticFix, collectDiagnostics, DIAGNOSTICS_ENABLED_KEY, isDiagnosticsEnabled, type CollectedDiagnostic } from '../core/diagnostics';
import { editorEvents } from '../core/events';
import { useEditorStore } from '../store/editorStore';

interface DiagnosticsPanelProps {
  onClose: () => void;
}

const IGNORED_KEY = 'aperglyph.diagnostics.ignored';

export function DiagnosticsPanel({ onClose }: DiagnosticsPanelProps) {
  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const setActivePage = useEditorStore((state) => state.setActivePage);
  const setSelection = useEditorStore((state) => state.setSelection);
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const [scope, setScope] = useState<'page' | 'document'>('page');
  const [severity, setSeverity] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const [plugin, setPlugin] = useState('all');
  const [ignored, setIgnored] = useState(readIgnoredDiagnostics);
  const [validationEnabled, setValidationEnabled] = useState(isDiagnosticsEnabled);
  const allDiagnostics = useMemo(() => collectDiagnostics(document, scope, activePageId), [activePageId, document, scope]);
  const plugins = [...new Set(allDiagnostics.map((diagnostic) => diagnostic.plugin))].sort();
  const diagnostics = validationEnabled ? allDiagnostics.filter((diagnostic) => !ignored.has(diagnostic.id) && (severity === 'all' || diagnostic.severity === severity) && (plugin === 'all' || diagnostic.plugin === plugin)) : [];
  const errors = validationEnabled ? allDiagnostics.filter((diagnostic) => diagnostic.severity === 'error' && !ignored.has(diagnostic.id)).length : 0;
  const warnings = validationEnabled ? allDiagnostics.filter((diagnostic) => diagnostic.severity === 'warning' && !ignored.has(diagnostic.id)).length : 0;

  const focusDiagnostic = (diagnostic: CollectedDiagnostic) => {
    setActivePage(diagnostic.pageId);
    const id = diagnostic.nodeId ?? diagnostic.edgeId;
    setSelection(id ? [id] : [], id ?? null);
    if (id) editorEvents.emit('viewport:fit', { scope: 'selection' });
  };

  const ignoreDiagnostic = (diagnostic: CollectedDiagnostic) => {
    const next = new Set(ignored).add(diagnostic.id);
    setIgnored(next);
    writeIgnoredDiagnostics(next);
  };

  return <aside className="diagnostics-panel" aria-label="Diagnostics">
    <div className="diagnostics-heading"><div><span className="panel-kicker">Validation</span><h2>Diagnostics</h2></div><button className="icon-button" title="Close diagnostics" aria-label="Close diagnostics" onClick={onClose}><X size={15} /></button></div>
    <div className="diagnostics-summary"><span className="diagnostic-count error"><CircleAlert size={13} /> {errors} errors</span><span className="diagnostic-count warning"><AlertTriangle size={13} /> {warnings} warnings</span><label className="diagnostics-toggle"><input type="checkbox" checked={validationEnabled} onChange={(event) => { const enabled = event.target.checked; setValidationEnabled(enabled); try { globalThis.localStorage?.setItem(DIAGNOSTICS_ENABLED_KEY, String(enabled)); } catch { /* optional preference */ } editorEvents.emit('diagnostics:changed', { enabled }); }} /> Beginner validation</label></div>
    <div className="diagnostics-filters"><label><span>Scope</span><select aria-label="Diagnostic scope" value={scope} onChange={(event) => setScope(event.target.value as 'page' | 'document')}><option value="page">Current page</option><option value="document">Whole document</option></select></label><label><span>Severity</span><select aria-label="Diagnostic severity" value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}><option value="all">All severities</option><option value="error">Errors</option><option value="warning">Warnings</option><option value="info">Info</option></select></label>{plugins.length > 0 && <label><span>Module</span><select aria-label="Diagnostic module" value={plugin} onChange={(event) => setPlugin(event.target.value)}><option value="all">All modules</option>{plugins.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}</div>
    <div className="diagnostics-toolbar"><span><Filter size={12} /> {diagnostics.length} shown</span>{ignored.size > 0 && <button className="text-button" onClick={() => { setIgnored(new Set()); writeIgnoredDiagnostics(new Set()); }}>Restore ignored</button>}</div>
    <div className="diagnostics-list">{diagnostics.length === 0 ? <div className="diagnostics-empty"><CheckCircle2 size={23} /><strong>No active diagnostics</strong><span>The selected scope is valid or all findings are ignored.</span></div> : diagnostics.map((diagnostic) => {
      const fix = buildDiagnosticFix(document, diagnostic);
      return <div className={`diagnostic-row ${diagnostic.severity}`} key={diagnostic.id}>
        <button className="diagnostic-main" onClick={() => focusDiagnostic(diagnostic)} onDoubleClick={() => focusDiagnostic(diagnostic)}><span className="diagnostic-severity" aria-label={diagnostic.severity}>{diagnostic.severity === 'error' ? <CircleAlert size={14} /> : diagnostic.severity === 'warning' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}</span><span><strong>{diagnostic.message}</strong><small>{diagnostic.plugin}{diagnostic.nodeId ? ' · object' : diagnostic.edgeId ? ' · connector' : ''}</small></span></button>
        <div className="diagnostic-actions">{fix && <button className="diagnostic-fix" onClick={() => executeCommand(fix.command)}>{fix.label}</button>}<button className="diagnostic-ignore" title="Ignore this diagnostic" aria-label="Ignore this diagnostic" onClick={() => ignoreDiagnostic(diagnostic)}>×</button></div>
      </div>;
    })}</div>
  </aside>;
}

function readIgnoredDiagnostics(): Set<string> {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(IGNORED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeIgnoredDiagnostics(value: Set<string>): void {
  try {
    globalThis.localStorage?.setItem(IGNORED_KEY, JSON.stringify([...value]));
  } catch {
    // Diagnostic suppression is optional local UI state.
  }
}
