import { MoreHorizontal, Plus } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';

export function PageTabs() {
  const document = useEditorStore((state) => state.document);
  const activePageId = useEditorStore((state) => state.activePageId);
  const setActivePage = useEditorStore((state) => state.setActivePage);
  return <div className="page-tabs"><div className="page-tabs-inner">{document.pages.map((page, index) => <button key={page.id} className={`page-tab ${page.id === activePageId ? 'active' : ''}`} onClick={() => setActivePage(page.id)}><span className="page-number">{String(index + 1).padStart(2, '0')}</span>{page.name}</button>)}<button className="add-page"><Plus size={15} /></button><button className="page-more"><MoreHorizontal size={16} /></button></div><div className="page-count">{document.pages.length} page{document.pages.length !== 1 ? 's' : ''}</div></div>;
}
