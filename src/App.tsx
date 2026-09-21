import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { createDocument } from './core/document';
import type { DiagramDocument } from './core/types';
import { AutosaveController, forgetActiveDocument, getRememberedDocumentId, getRecoverySnapshot, loadDocument, rememberActiveDocument, requestPersistentStorage } from './persistence';
import { useEditorStore } from './store/editorStore';
import { EditorScreen } from './components/EditorScreen';
import { HomeScreen } from './components/HomeScreen';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export default function App() {
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [resuming, setResuming] = useState(() => Boolean(getRememberedDocumentId()));
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
    const rememberedId = getRememberedDocumentId();
    if (!rememberedId) {
      setResuming(false);
      return;
    }
    let active = true;
    void Promise.all([loadDocument(rememberedId), getRecoverySnapshot()]).then(([saved, recovery]) => {
      if (!active) return;
      const recovered = recovery?.document.id === rememberedId && (!saved || recovery.savedAt > saved.updatedAt) ? recovery.document : saved;
      if (recovered) {
        setDocument(recovered);
        setScreen('editor');
      } else {
        forgetActiveDocument();
      }
      setResuming(false);
    }).catch(() => {
      if (active) setResuming(false);
    });
    return () => { active = false; };
  }, [setDocument]);

  useEffect(() => {
    const update = registerSW({ immediate: true, onNeedRefresh: () => setUpdateAvailable(true), onOfflineReady: () => setOfflineReady(true) });
    updateSWRef.current = update;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const flush = () => { void autosaveRef.current?.flush(useEditorStore.getState().document); };
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    void requestPersistentStorage().catch(() => undefined);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
      updateSWRef.current = null;
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

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
    rememberActiveDocument(document.id);
    setDocument(document);
    setScreen('editor');
  };

  const exitEditor = () => {
    void autosaveRef.current?.flush();
    forgetActiveDocument();
    setScreen('home');
  };

  if (resuming) return <div className="resume-screen" role="status">Restoring your local diagram…</div>;
  return <><div className="pwa-status" aria-live="polite">{!online && <span className="pwa-message offline">Offline mode</span>}{installPrompt && <span className="pwa-message"><span>Install AperGlyph</span><button onClick={() => void installApp()}>Install</button></span>}{offlineReady && online && <span className="pwa-message">Ready for offline use <button onClick={() => setOfflineReady(false)}>Dismiss</button></span>}{updateAvailable && <span className="pwa-message update">New version available <button onClick={() => { void autosaveRef.current?.flush(useEditorStore.getState().document).then(() => updateSWRef.current?.(true)); }}>Save &amp; reload</button></span>}</div>{screen === 'editor' ? <EditorScreen onExit={exitEditor} /> : <HomeScreen onOpen={openDocument} onInstall={installPrompt ? () => void installApp() : undefined} />}</>;
}

export function createBlankDocument() {
  return createDocument('Untitled diagram');
}
