import { AlertTriangle, Check, Code2, Copy, ExternalLink, Info, Maximize2, MoreVertical, Play, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { codeLanguageLabel, CODE_TEMPLATES, compileDiagramIR, parseDiagramCode } from '../core/codeImport';
import type { CodeLanguage, IRDiagnostic } from '../core/diagramIR';
import type { ImportedPageMode } from '../core/commands';
import { editorEvents } from '../core/events';
import { useEditorStore } from '../store/editorStore';
import { edgeRoute, edgeRouting, pointsToPath } from '../core/routing';
import type { DiagramDocument, DiagramEdge, DiagramNode, Point } from '../core/types';
import { NodeGraphic } from './NodeGraphic';
import { LeftDockHeader, type LeftPanelId } from './DockHeader';

interface DetectedCode {
  source: string;
  language: CodeLanguage;
  reason: string;
}

interface CodePanelProps {
  expanded: boolean;
  activePanel: LeftPanelId;
  onPanelChange: (panel: LeftPanelId) => void;
  onExpandedChange: (expanded: boolean) => void;
  onCollapse: () => void;
  detectedCode?: DetectedCode | null;
  onDetectedCodeConsumed?: () => void;
  onPasteAsText?: (source: string) => void;
}

const LANGUAGE_OPTIONS: CodeLanguage[] = ['mermaid', 'plantuml', 'dot', 'dbml', 'sql', 'json', 'csv'];
const LANGUAGE_KEY = 'aperglyph.code.language';
const MODE_KEY = 'aperglyph.code.apply-mode';

export function CodePanel({ expanded, activePanel, onPanelChange, onExpandedChange, onCollapse, detectedCode, onDetectedCodeConsumed, onPasteAsText }: CodePanelProps) {
  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const applyImportedDocument = useEditorStore((state) => state.applyImportedDocument);
  const [language, setLanguage] = useState<CodeLanguage>(() => readLanguage());
  const [source, setSource] = useState(() => defaultSource(readLanguage()));
  const [mode, setMode] = useState<ImportedPageMode>(() => readMode());
  const [template, setTemplate] = useState('');
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [showReference, setShowReference] = useState(false);
  const [applied, setApplied] = useState(false);
  const [detectedNotice, setDetectedNotice] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(true);
  const [jumpRequest, setJumpRequest] = useState<{ line: number; column: number; request: number } | null>(null);

  useEffect(() => {
    if (!detectedCode) return;
    setLanguage(detectedCode.language);
    setSource(detectedCode.source);
    setTemplate('');
    setApplied(false);
    setDetectedNotice(detectedCode.reason);
    onDetectedCodeConsumed?.();
  }, [detectedCode, onDetectedCodeConsumed]);

  const parsed = useMemo(() => parseDiagramCode(source, language), [language, source]);
  const errors = parsed.diagnostics.filter((item) => item.severity === 'error');
  const warnings = [...parsed.warnings, ...parsed.diagnostics.filter((item) => item.severity !== 'error')];
  const previewDocument = useMemo(() => parsed.ir && errors.length === 0 ? compileDiagramIR(parsed.ir, { name: 'Code preview' }) : null, [errors.length, parsed.ir]);
  const templates = CODE_TEMPLATES[language];
  const changeLanguage = (next: CodeLanguage) => {
    setLanguage(next);
    writeLanguage(next);
    setTemplate('');
    setSource(defaultSource(next));
    setApplied(false);
  };

  const apply = () => {
    if (!parsed.ir || errors.length > 0) return;
    const activePage = document.pages.find((page) => page.id === activePageId) ?? document.pages[0];
    if (mode === 'replace' && (activePage?.nodes.length ?? 0) + (activePage?.edges.length ?? 0) > 0 && !globalThis.confirm('Replace the current page with this generated diagram? This can be undone.')) return;
    const imported = compileDiagramIR(parsed.ir, { name: `Imported ${codeLanguageLabel(language)} diagram` });
    applyImportedDocument(imported, mode);
    setApplied(true);
    window.setTimeout(() => editorEvents.emit('viewport:fit', { scope: 'content' }), 80);
    window.setTimeout(() => setApplied(false), 2400);
  };

  const copySource = async (value: string) => {
    try {
      await globalThis.navigator?.clipboard?.writeText(value);
    } catch {
      // Clipboard access is optional; the editor remains usable without it.
    }
  };

  const jumpToProblem = (item: IRDiagnostic, index: number) => {
    if (!item.line) return;
    setJumpRequest({ line: item.line, column: item.column ?? 1, request: index + 1 + Date.now() });
  };

  const detectedBanner = detectedNotice && <div className="code-detected"><Info size={13} /><span>{detectedNotice}. Review the source, then choose how to paste it.</span><div className="code-detected-actions"><button onClick={() => { setDetectedNotice(null); setApplied(false); }}>Generate</button><button onClick={() => { onPasteAsText?.(source); setDetectedNotice(null); }}>Paste as text</button></div><button className="code-detected-dismiss" onClick={() => setDetectedNotice(null)} aria-label="Dismiss detection notice"><X size={12} /></button></div>;
  const controls = <div className="code-controls-row"><label className="code-field-label">Language<select value={language} onChange={(event) => changeLanguage(event.target.value as CodeLanguage)} aria-label="Code language">{LANGUAGE_OPTIONS.map((value) => <option key={value} value={value}>{codeLanguageLabel(value)}</option>)}</select></label><label className="code-field-label">Template<select value={template} onChange={(event) => { const id = event.target.value; setTemplate(id); const selected = templates.find((item) => item.id === id); if (selected) { setSource(selected.source); setApplied(false); } }} aria-label="Code template"><option value="">Choose a starter…</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>;
  const templateControl = <label className="code-field-label">Template<select value={template} onChange={(event) => { const id = event.target.value; setTemplate(id); const selected = templates.find((item) => item.id === id); if (selected) { setSource(selected.source); setApplied(false); } }} aria-label="Code template"><option value="">Choose a starter…</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>;
  const editor = <CodeEditor source={source} language={language} diagnostics={[...parsed.diagnostics, ...parsed.warnings]} jumpRequest={jumpRequest} onChange={(value) => { setSource(value); setApplied(false); }} onCursor={setCursor} />;
  const status = <div className={`code-status ${errors.length > 0 ? 'has-errors' : 'valid'}`} role="status">{errors.length > 0 ? <><AlertTriangle size={13} /><span><b>{errors.length} problem{errors.length === 1 ? '' : 's'}</b><small> · fix the source before generating · {diagnosticLocations(errors)}</small></span></> : <><Check size={13} /><span>Valid · {sourceStatus(language, parsed.ir)}</span></>}</div>;
  const problems = errors.length > 0 && <details className="code-problems" aria-label="Code problems" open={problemsOpen} onToggle={(event) => setProblemsOpen(event.currentTarget.open)}><summary><AlertTriangle size={12} /> {errors.length} problem{errors.length === 1 ? '' : 's'} <span>{problemsOpen ? 'Hide details' : 'Show details'}</span></summary><div className="code-problem-list">{errors.map((item, index) => <button className="code-problem" key={`${item.code ?? 'error'}-${index}`} onClick={() => jumpToProblem(item, index)}><span className="problem-dot">●</span><span><b>{item.line ? `Line ${item.line}${item.column ? `, column ${item.column}` : ''}` : 'Source'}</b><span>{item.message}</span></span></button>)}</div></details>;
  const warningDetails = warnings.length > 0 && errors.length === 0 && <details className="code-warnings"><summary><AlertTriangle size={12} /> {warnings.length} approximation{warnings.length === 1 ? '' : 's'}</summary>{warnings.map((item, index) => <p key={`${item.code ?? 'warning'}-${index}`}>{item.line ? `Line ${item.line}: ` : ''}{item.message}</p>)}</details>;
  const destination = <label className="code-mode-label">Generate to<select title={modeDescription(mode)} value={mode} onChange={(event) => changeMode(event.target.value as ImportedPageMode)} aria-label="Generate destination"><option value="new-page">New page</option><option value="insert">Insert into current page</option><option value="replace">Replace current page</option></select></label>;
  const applyButton = <button className="code-apply-button" aria-label="Generate diagram" disabled={errors.length > 0 || !parsed.ir || parsed.ir.nodes.length === 0} onClick={apply}>{applied ? <><Check size={14} /> Applied as native objects</> : <><Play size={14} /> Apply diagram</>}</button>;
  const menu = showMenu && <div className="code-panel-menu"><button onClick={() => { setSource(source.split(/\r?\n/).map((line) => line.trimEnd()).join('\n')); setShowMenu(false); }}>Format source</button><button onClick={() => { void copySource(source); setShowMenu(false); }}><Copy size={12} /> Copy source</button><button onClick={() => { setSource(''); setTemplate(''); setApplied(false); setShowMenu(false); }}><Trash2 size={12} /> Clear source</button><div className="code-menu-divider" /><button onClick={() => { setShowReference((value) => !value); setShowMenu(false); }}><Info size={12} /> {showReference ? 'Hide quick reference' : 'Quick reference'}</button></div>;

  if (expanded) return <section className="code-panel code-panel-expanded">
    <header className="code-workspace-header"><div><span className="panel-kicker">CODE</span><strong>{codeLanguageLabel(language)}</strong></div><div className="code-workspace-actions"><select value={language} onChange={(event) => changeLanguage(event.target.value as CodeLanguage)} aria-label="Code workspace language">{LANGUAGE_OPTIONS.map((value) => <option key={value} value={value}>{codeLanguageLabel(value)}</option>)}</select><button className="code-menu-button" title="Code actions" aria-label="Code actions" onClick={() => setShowMenu((value) => !value)}><MoreVertical size={15} /></button><button className="code-workspace-close" title="Close Code workspace" aria-label="Close Code workspace" onClick={() => onExpandedChange(false)}><X size={16} /></button>{menu}</div></header>
    <div className="code-workspace-body"><div className="code-workspace-source">{detectedBanner}<div className="code-workspace-source-toolbar">{templateControl}</div>{editor}{problems}{warningDetails}{showReference && <QuickReference language={language} />}</div><div className="code-workspace-preview"><div className="code-preview-heading"><div><span className="panel-kicker">PREVIEW</span><strong>Generated diagram</strong></div><span title="Changes to source update this preview only."><Info size={14} /></span></div><CodePreview document={previewDocument} language={language} /></div></div>
    <footer className="code-workspace-footer"><div className="code-workspace-footer-status"><span className="code-preview-info" title="Changes to source update the preview only. Apply Diagram commits the generated objects as one undoable action."><Info size={13} /> Preview mode</span>{status}</div><div className="code-workspace-footer-actions">{destination}{applyButton}</div></footer>
  </section>;

  return <aside className="code-panel">
    <LeftDockHeader activePanel={activePanel} onChange={onPanelChange} onCollapse={onCollapse} badge={<><button className="code-expand-button" title="Open Code workspace" aria-label="Open Code workspace" onClick={() => onExpandedChange(true)}><Maximize2 size={12} /></button>{errors.length > 0 ? <span className="code-error-badge">{errors.length}</span> : parsed.ir ? <span className="code-valid-badge"><Check size={11} /></span> : undefined}</>} />
    <div className="code-panel-heading"><div><span className="panel-kicker">CODE</span><strong>{codeLanguageLabel(language)}</strong></div><div className="code-heading-actions"><Code2 size={16} /><button className="code-menu-button" title="Code actions" aria-label="Code actions" onClick={() => setShowMenu((value) => !value)}><MoreVertical size={14} /></button>{menu}</div></div>
    {detectedBanner}
    {controls}
    {editor}
    {status}
    {problems}
    {warningDetails}
    <div className="code-apply-box"><div className="code-generate-row">{destination}<span className="code-mode-hint" title={modeDescription(mode)}>{modeDescription(mode)}</span></div>{applyButton}</div>
    <button className="code-reference-toggle" onClick={() => setShowReference((value) => !value)}><Info size={13} /> {showReference ? 'Hide' : 'Show'} quick reference <ExternalLink size={11} /></button>
    {showReference && <QuickReference language={language} />}
  </aside>;

  function changeMode(next: ImportedPageMode) {
    setMode(next);
    try { globalThis.localStorage?.setItem(MODE_KEY, next); } catch { /* optional preference */ }
  }
}

function QuickReference({ language }: { language: CodeLanguage }) {
  const references: Record<CodeLanguage, Array<[string, string]>> = {
    mermaid: [['Node', 'A[Process]'], ['Decision', 'A{Approved?}'], ['Connection', 'A -->|Yes| B'], ['Database', 'A[(Database)]']],
    plantuml: [['Actor', 'actor Customer'], ['Use case', 'usecase "Submit" as Submit'], ['Connection', 'Customer --> Submit'], ['Include', 'Submit ..> Auth : <<include>>']],
    dot: [['Graph', 'digraph G { ... }'], ['Node', 'A [shape=box]'], ['Connection', 'A -> B [label="uses"]'], ['Direction', 'rankdir=LR']],
    dbml: [['Table', 'Table users { ... }'], ['Field', 'id bigint [pk]'], ['Reference', 'Ref: posts.user_id > users.id'], ['Index', 'indexes { (email) [unique] }']],
    sql: [['Table', 'CREATE TABLE users (...)'], ['Primary key', 'id BIGINT PRIMARY KEY'], ['Reference', 'REFERENCES users(id)'], ['Index', 'CREATE INDEX ...']],
    json: [['Node', '{ "id": "a", "label": "A" }'], ['Edge', '{ "source": "a", "target": "b" }'], ['Direction', '"direction": "LR"'], ['Shape', '"shape": "decision"']],
    csv: [['Relationships', 'source,target,label'], ['Nodes', 'id,label'], ['One row', 'Customer,Booking,places'], ['Plain labels', 'customer,Customer']],
  };
  return <div className="code-reference"><strong>{codeLanguageLabel(language)} quick reference</strong>{references[language].map(([label, example]) => <div key={label}><span>{label}</span><code>{example}</code></div>)}</div>;
}

function modeDescription(mode: ImportedPageMode): string {
  if (mode === 'insert') return 'Adds native objects to this page.';
  if (mode === 'replace') return 'Replaces this page in one undoable action.';
  return 'Keeps the active page untouched.';
}

function sourceStatus(language: CodeLanguage, ir: import('../core/diagramIR').DiagramIR | null): string {
  if (!ir) return 'No diagram yet';
  if (ir.type === 'erd' || language === 'sql' || language === 'dbml') return `${ir.nodes.length} table${ir.nodes.length === 1 ? '' : 's'} · ${ir.edges.length} relationship${ir.edges.length === 1 ? '' : 's'}`;
  if (ir.type === 'use-case') {
    const actors = ir.nodes.filter((node) => node.semanticType === 'actor').length;
    const useCases = ir.nodes.length - actors;
    return `${actors} actor${actors === 1 ? '' : 's'} · ${useCases} use case${useCases === 1 ? '' : 's'} · ${ir.edges.length} relationship${ir.edges.length === 1 ? '' : 's'}`;
  }
  if (ir.type === 'dfd') return `${ir.nodes.length} process${ir.nodes.length === 1 ? '' : 'es'} · ${ir.edges.length} data flow${ir.edges.length === 1 ? '' : 's'}`;
  return `${ir.nodes.length} shape${ir.nodes.length === 1 ? '' : 's'} · ${ir.edges.length} connection${ir.edges.length === 1 ? '' : 's'}`;
}

function CodePreview({ document, language }: { document: DiagramDocument | null; language: CodeLanguage }) {
  if (!document) return <div className="code-preview-empty"><Info size={18} /><span>Enter valid source to see the generated diagram.</span></div>;
  const page = document.pages[0];
  const nodes = page?.nodes.filter((node) => !node.hidden).sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0)) ?? [];
  const edges = page?.edges ?? [];
  if (!page || nodes.length === 0) return <div className="code-preview-empty"><Info size={18} /><span>The source is valid, but it does not contain drawable objects yet.</span></div>;
  const bounds = previewBounds(nodes);
  return <div className="code-preview-stage"><svg className="code-preview-svg" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} role="img" aria-label={`${codeLanguageLabel(language)} generated diagram preview`}><g className="code-preview-edge-layer">{edges.map((edge) => { const source = edge.source.nodeId ? nodes.find((node) => node.id === edge.source.nodeId) : undefined; const target = edge.target.nodeId ? nodes.find((node) => node.id === edge.target.nodeId) : undefined; const route = edgeRoute(edge, source, target, nodes); if (route.length < 2) return null; const path = pointsToPath(route, [], edgeRouting(edge) === 'orthogonal' ? edge.style.cornerRadius ?? 0 : 0); const middle = route[Math.floor(route.length / 2)] ?? route[0]; return <g key={edge.id}><path d={path} fill="none" stroke="#0a0c12" strokeWidth={edge.style.strokeWidth + 5} opacity=".65" /><path d={path} fill="none" stroke={edge.style.stroke} strokeWidth={edge.style.strokeWidth} strokeDasharray={edge.style.dash === 'dashed' ? '8 6' : edge.style.dash === 'dotted' ? '2 5' : undefined} opacity={edge.style.opacity ?? 1} />{typeof edge.data.label === 'string' && edge.data.relationship !== 'foreign-key' && <text x={middle.x} y={middle.y - 7} className="code-preview-edge-label" textAnchor="middle">{edge.data.label}</text>}</g>; })}</g><g className="code-preview-node-layer">{nodes.map((node) => <g key={node.id} transform={`translate(${node.position.x} ${node.position.y})`}><NodeGraphic node={node} diagramType={document.diagramType} /></g>)}</g></svg></div>;
}

function previewBounds(nodes: DiagramNode[]): { x: number; y: number; width: number; height: number } {
  const padding = 64;
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + node.size.width));
  const maxY = Math.max(...nodes.map((node) => node.position.y + node.size.height));
  return { x: minX - padding, y: minY - padding, width: Math.max(240, maxX - minX + padding * 2), height: Math.max(180, maxY - minY + padding * 2) };
}

function CodeEditor({ source, language, diagnostics, jumpRequest, onChange, onCursor }: { source: string; language: CodeLanguage; diagnostics: IRDiagnostic[]; jumpRequest: { line: number; column: number; request: number } | null; onChange: (source: string) => void; onCursor: (cursor: { line: number; column: number }) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const lines = source.split('\n');
  const lineStarts = lineStartOffsets(source);
  const errorLines = new Set(diagnostics.filter((item) => item.severity === 'error').flatMap((item) => item.line ? [item.line] : []));
  const warningLines = new Set(diagnostics.filter((item) => item.severity === 'warning').flatMap((item) => item.line ? [item.line] : []));
  const hasErrors = diagnostics.some((item) => item.severity === 'error');
  const cursorOffset = textareaRef.current?.selectionStart ?? 0;
  const cursorPosition = cursorFromOffset(source, cursorOffset);
  const bracketMatch = findMatchingBracket(source, cursorOffset);
  const searchMatches = findSearchMatches(source, search);

  useEffect(() => {
    if (!jumpRequest || !textareaRef.current) return;
    const line = Math.max(1, Math.min(lines.length, jumpRequest.line));
    const start = lineStarts[line - 1] ?? 0;
    const offset = Math.min(source.length, start + Math.max(0, jumpRequest.column - 1));
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(offset, offset);
    emitCursor(textareaRef.current);
  }, [jumpRequest?.request]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const emitCursor = (target: HTMLTextAreaElement) => {
    const before = target.value.slice(0, target.selectionStart ?? 0);
    const cursorLines = before.split('\n');
    onCursor({ line: cursorLines.length, column: (cursorLines.at(-1)?.length ?? 0) + 1 });
  };

  const handleScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    setScroll({ top: target.scrollTop, left: target.scrollLeft });
    if (highlightRef.current) highlightRef.current.style.transform = `translate(${-target.scrollLeft}px, ${-target.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-target.scrollTop}px)`;
  };

  const editAtSelection = (value: string, selectionStart: number, selectionEnd = selectionStart) => {
    onChange(value);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(selectionStart, selectionEnd);
      if (textareaRef.current) emitCursor(textareaRef.current);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setSearchOpen(true);
      return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    if (event.shiftKey) {
      const selected = source.slice(lineStart, end);
      const next = selected.replace(/^ {1,2}/gm, '');
      editAtSelection(`${source.slice(0, lineStart)}${next}${source.slice(end)}`, Math.max(lineStart, start - (selected.length - next.length)), Math.max(lineStart, end - (selected.length - next.length)));
      return;
    }
    editAtSelection(`${source.slice(0, start)}  ${source.slice(end)}`, start + 2);
  };

  const lineHeight = 15.5;
  return <div className="code-editor-wrap">
    <div className="code-editor-meta"><span>{language === 'sql' ? 'Schema source' : `${codeLanguageLabel(language)} source`}</span><span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span></div>
    {searchOpen && <div className="code-search-bar"><Search size={12} /><input ref={searchRef} value={search} onChange={(event) => { setSearch(event.target.value); setSearchIndex(0); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setSearchOpen(false); } else if (event.key === 'Enter' && searchMatches.length > 0) { event.preventDefault(); jumpToSearch(searchIndex + (event.shiftKey ? -1 : 1)); } }} placeholder="Find in source…" aria-label="Find in source" /><span>{search ? `${searchMatches.length ? searchIndex + 1 : 0}/${searchMatches.length}` : ''}</span><button onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={12} /></button></div>}
    <div className="code-editor-body">
      <div ref={gutterRef} className="code-editor-gutter" style={{ transform: `translateY(${-scroll.top}px)` }}>{lines.map((_, index) => <span key={index} className={`${errorLines.has(index + 1) ? 'has-error' : warningLines.has(index + 1) ? 'has-warning' : ''}`} title={errorLines.has(index + 1) ? 'Diagnostic on this line' : undefined}>{errorLines.has(index + 1) ? '●' : warningLines.has(index + 1) ? '•' : ''}<i>{index + 1}</i></span>)}</div>
      <div className="code-editor-code">
        <div className="code-current-line" style={{ top: `${(cursorPosition.line - 1) * lineHeight - scroll.top + 10}px` }} />
        <pre ref={highlightRef} className="code-editor-highlight" aria-hidden="true">{lines.map((line, index) => <span key={index} className={errorLines.has(index + 1) ? 'code-line-error' : warningLines.has(index + 1) ? 'code-line-warning' : ''} dangerouslySetInnerHTML={{ __html: highlightLine(line, language, bracketMatch?.line === index + 1 ? bracketMatch.column : undefined, bracketMatch?.otherLine === index + 1 ? bracketMatch.otherColumn : undefined) }} />).reduce((children, child, index) => index === 0 ? [child] : [...children, '\n', child], [] as React.ReactNode[])}</pre>
        <textarea ref={textareaRef} className="code-editor" value={source} onChange={(event) => { onChange(event.target.value); emitCursor(event.target); }} onClick={(event) => emitCursor(event.currentTarget)} onKeyUp={(event) => emitCursor(event.currentTarget)} onSelect={(event) => emitCursor(event.currentTarget)} onKeyDown={handleKeyDown} onScroll={handleScroll} spellCheck={false} aria-label={`${codeLanguageLabel(language)} source`} aria-invalid={hasErrors} />
      </div>
    </div>
  </div>;

  function jumpToSearch(nextIndex: number) {
    if (searchMatches.length === 0 || !textareaRef.current) return;
    const normalized = (nextIndex + searchMatches.length) % searchMatches.length;
    const match = searchMatches[normalized];
    setSearchIndex(normalized);
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(match, match + search.length);
    emitCursor(textareaRef.current);
  }
}

function diagnosticLocations(items: IRDiagnostic[]): string {
  const lines = [...new Set(items.flatMap((item) => item.line ? [item.line] : []))];
  return lines.length > 0 ? lines.slice(0, 3).map((line) => `Line ${line}`).join(', ') : 'review the source';
}

function lineStartOffsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) if (source[index] === '\n') offsets.push(index + 1);
  return offsets;
}

function cursorFromOffset(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function findSearchMatches(source: string, query: string): number[] {
  const value = query.toLowerCase();
  if (!value) return [];
  const matches: number[] = [];
  let index = 0;
  while ((index = source.toLowerCase().indexOf(value, index)) >= 0) { matches.push(index); index += Math.max(1, value.length); }
  return matches;
}

function findMatchingBracket(source: string, offset: number): { line: number; column: number; otherLine: number; otherColumn: number } | null {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const reverse: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const candidate = source[offset - 1] && pairs[source[offset - 1]] ? offset - 1 : source[offset] && reverse[source[offset]] ? offset : -1;
  if (candidate < 0) return null;
  const character = source[candidate];
  const closing = pairs[character];
  const step = closing ? 1 : -1;
  let depth = 0;
  for (let index = candidate; index >= 0 && index < source.length; index += step) {
    const current = source[index];
    if (current === character) depth += 1;
    if (current === (closing ?? reverse[character])) {
      depth -= 1;
      if (depth === 0) {
        const first = cursorFromOffset(source, candidate);
        const other = cursorFromOffset(source, index);
        return { line: first.line, column: first.column, otherLine: other.line, otherColumn: other.column };
      }
    }
  }
  return null;
}

function highlightLine(line: string, language: CodeLanguage, firstBracket?: number, secondBracket?: number): string {
  const tokenPattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|--.*$|\/\/.*$|#[^\s].*$|\b\d+(?:\.\d+)?\b|[A-Za-z_][\w-]*|[^\s])/g;
  let result = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(line))) {
    result += escapeHtml(line.slice(cursor, match.index));
    const token = match[0];
    const start = match.index;
    const className = tokenClass(token, language);
    if (firstBracket === start + 1 || secondBracket === start + 1) result += `<span class="${className} bracket-match">${escapeHtml(token)}</span>`;
    else result += className ? `<span class="${className}">${escapeHtml(token)}</span>` : escapeHtml(token);
    cursor = start + token.length;
  }
  return result + escapeHtml(line.slice(cursor));
}

function tokenClass(token: string, language: CodeLanguage): string {
  if (/^(?:--|\/\/|#)/.test(token)) return 'tok-comment';
  if (/^["'`]/.test(token)) return 'tok-string';
  if (/^\d/.test(token)) return 'tok-number';
  if (!/^[A-Za-z_]/.test(token)) return 'tok-punctuation';
  const common = ['as', 'class', 'extends', 'interface', 'node', 'package', 'rectangle', 'table', 'tablegroup', 'ref', 'references', 'source', 'target'];
  const keywords: Record<CodeLanguage, string[]> = {
    mermaid: ['flowchart', 'graph', 'erdiagram', 'statediagram', 'classdiagram', 'sequencediagram', 'subgraph', 'direction', 'end', 'style', 'classdef'],
    plantuml: ['startuml', 'enduml', 'actor', 'usecase', 'database', 'component', 'left', 'right', 'top', 'to', 'direction'],
    dot: ['digraph', 'graph', 'strict', 'subgraph', 'rankdir', 'node', 'edge'],
    dbml: ['table', 'tablegroup', 'ref', 'indexes', 'project', 'enum'],
    sql: ['create', 'table', 'primary', 'key', 'foreign', 'references', 'not', 'null', 'unique', 'constraint', 'index', 'on', 'delete', 'update', 'cascade', 'restrict', 'set', 'default', 'insert', 'select', 'from'],
    json: ['type', 'direction', 'nodes', 'edges', 'source', 'target', 'label', 'shape'],
    csv: ['source', 'target', 'label', 'id', 'name'],
  };
  if ([...common, ...keywords[language]].includes(token.toLowerCase())) return 'tok-keyword';
  return '';
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function readLanguage(): CodeLanguage {
  try {
    const value = globalThis.localStorage?.getItem(LANGUAGE_KEY);
    return LANGUAGE_OPTIONS.includes(value as CodeLanguage) ? value as CodeLanguage : 'mermaid';
  } catch { return 'mermaid'; }
}

function writeLanguage(value: CodeLanguage): void {
  try { globalThis.localStorage?.setItem(LANGUAGE_KEY, value); } catch { /* optional preference */ }
}

function readMode(): ImportedPageMode {
  try {
    const value = globalThis.localStorage?.getItem(MODE_KEY);
    return value === 'replace' || value === 'insert' ? value : 'new-page';
  } catch { return 'new-page'; }
}

function defaultSource(language: CodeLanguage): string {
  return CODE_TEMPLATES[language][0]?.source ?? '';
}
