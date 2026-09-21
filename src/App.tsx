import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { createDocument } from './core/document';
import type { DiagramDocument } from './core/types';
import { AutosaveController } from './persistence';
import { useEditorStore } from './store/editorStore';
import { EditorScreen } from './components/EditorScreen';
import { HomeScreen } from './components/HomeScreen';

export default function App() {
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const setDocument = useEditorStore((state) => state.setDocument);
  const markSaved = useEditorStore((state) => state.markSaved);
  const isDirty = useEditorStore((state) => state.isDirty);
  const autosaveRef = useRef<AutosaveController | null>(null);
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    const autosave = new AutosaveController({ onSaved: () => markSaved() });
    autosaveRef.current = autosave;
    const stop = autosave.start();
    return () => {
      stop();
      autosaveRef.current = null;
    };
  }, [markSaved]);

  useEffect(() => {
    const update = registerSW({ immediate: true, onNeedRefresh: () => setUpdateAvailable(true), onOfflineReady: () => setOfflineReady(true) });
    updateSWRef.current = update;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const flush = () => { void autosaveRef.current?.flush(useEditorStore.getState().document); };
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
      updateSWRef.current = null;
    };
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const openDocument = (document: DiagramDocument) => {
    setDocument(document);
    setScreen('editor');
  };

  const exitEditor = () => {
    void autosaveRef.current?.flush();
    setScreen('home');
  };

  return <><div className="pwa-status" aria-live="polite">{!online && <span className="pwa-message offline">Offline mode</span>}{offlineReady && online && <span className="pwa-message">Ready for offline use <button onClick={() => setOfflineReady(false)}>Dismiss</button></span>}{updateAvailable && <span className="pwa-message update">New version available <button onClick={() => { void autosaveRef.current?.flush(useEditorStore.getState().document).then(() => updateSWRef.current?.(true)); }}>Save &amp; reload</button></span>}</div>{screen === 'editor' ? <EditorScreen onExit={exitEditor} /> : <HomeScreen onOpen={openDocument} />}</>;
}

export function createBlankDocument() {
  return createDocument('Untitled diagram');
}
