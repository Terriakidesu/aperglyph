import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { createDocument, parseProject } from './core/document';
import { editorEvents } from './core/events';
import type { DiagramDocument } from './core/types';
import { AutosaveController, createWorkspaceBackup, forgetActiveDocument, getRememberedDocumentId, getRecoverySnapshot, loadDocument, rememberActiveDocument, requestPersistentStorage } from './persistence';
import { useEditorStore } from './store/editorStore';
import { EditorScreen } from './components/EditorScreen';
import { HomeScreen } from './components/HomeScreen';
import { startMcpBrowserBridge } from './mcp/browserBridge';
import { flushNativeStorage, initializeNativeStorage, isDesktopApp } from './persistence/nativeStorage';
import { openNativeWdiag, readNativeStartupWdiag, saveNativeWdiag, saveNativeWorkspaceBackup } from './persistence/nativeFiles';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';

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
  const [storageError, setStorageError] = useState<string | null>(null);
  const [nativeStorageFailed, setNativeStorageFailed] = useState(false);
  const [closeRecoveryPrompt, setCloseRecoveryPrompt] = useState(false);
  const [resuming, setResuming] = useState(true);
  const setDocument = useEditorStore((state) => state.setDocument);
  const markSaved = useEditorStore((state) => state.markSaved);
  const isDirty = useEditorStore((state) => state.isDirty);
  const autosaveRef = useRef<AutosaveController | null>(null);
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const closeInProgressRef = useRef(false);
  const allowCloseRef = useRef(false);
  const nativeStorageReadyRef = useRef(false);
  const nativeStorageFailedRef = useRef(false);
  const nativeStorageUnavailableRef = useRef(false);

  useEffect(() => isDesktopApp() ? undefined : startMcpBrowserBridge(), []);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof PerformanceObserver === 'undefined') return;
    let observer: PerformanceObserver;
    try {
      if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return;
      observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          console.warn(`[AperGlyph profile] main-thread long task: ${entry.duration.toFixed(1)} ms`, { startTime: entry.startTime });
        });
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      return;
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const unsubscribeOpened = editorEvents.on('document:opened', () => setScreen('editor'));
    const unsubscribeChanged = editorEvents.on('document:changed', () => setScreen('editor'));
    const unsubscribeFocus = editorEvents.on('editor:focus-requested', () => setScreen('editor'));
    return () => {
      unsubscribeOpened();
      unsubscribeChanged();
      unsubscribeFocus();
    };
  }, []);

  useEffect(() => {
    const unsubscribeStorageErrors = editorEvents.on('storage:error', ({ error }) => {
      if (isDesktopApp()) nativeStorageUnavailableRef.current = true;
      setStorageError(error.message);
    });
    const unsubscribeStorageSaved = editorEvents.on('storage:saved', () => {
      if (isDesktopApp()) nativeStorageUnavailableRef.current = false;
    });
    return () => {
      unsubscribeStorageErrors();
      unsubscribeStorageSaved();
    };
  }, []);

  useEffect(() => {
    const autosave = new AutosaveController({
      onSaved: (savedDocument) => {
        const current = useEditorStore.getState().document;
        if (current === savedDocument) markSaved(savedDocument.updatedAt);
      },
    });
    autosaveRef.current = autosave;
    const stop = autosave.start();
    return () => {
      stop();
      autosaveRef.current = null;
    };
  }, [markSaved]);

  useEffect(() => {
    let active = true;
    void initializeNativeStorage().then(async () => {
      nativeStorageReadyRef.current = true;
      const startupFile = await readNativeStartupWdiag();
      if (startupFile) {
        const opened = parseProject(startupFile);
        if (!active) return;
        await rememberActiveDocument(opened.id);
        setDocument(opened);
        setScreen('editor');
        return;
      }
      const rememberedId = await getRememberedDocumentId();
      if (!rememberedId) return;
      const [saved, recovery] = await Promise.all([loadDocument(rememberedId), getRecoverySnapshot(rememberedId)]);
      if (!active) return;
      const recovered = recovery?.document.id === rememberedId && (!saved || recovery.savedAt > saved.updatedAt) ? recovery.document : saved;
      if (recovered) {
        setDocument(recovered);
        setScreen('editor');
      } else {
        void forgetActiveDocument();
      }
    }).catch((error: unknown) => {
      if (!active) return;
      const detail = error instanceof Error ? error.message : String(error);
      if (isDesktopApp() && !nativeStorageReadyRef.current) {
        nativeStorageFailedRef.current = true;
        nativeStorageUnavailableRef.current = true;
        setNativeStorageFailed(true);
        setStorageError(`Unable to initialize native workspace storage: ${detail}. Your existing data was not replaced. Check that the workspace folder is writable and restart AperGlyph.`);
      } else {
        setStorageError(`Unable to restore the last-opened diagram: ${detail}`);
      }
    }).finally(() => {
      if (active) setResuming(false);
    });
    return () => { active = false; };
  }, [setDocument]);

  useEffect(() => {
    if (!isDesktopApp()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const openPendingFile = async () => {
      try {
        const raw = await readNativeStartupWdiag();
        if (!raw || !active) return;
        const opened = parseProject(raw);
        await rememberActiveDocument(opened.id);
        if (!active) return;
        setDocument(opened);
        setScreen('editor');
      } catch (error) {
        if (active) setStorageError(error instanceof Error ? error.message : 'Unable to open the selected .wdiag file.');
      }
    };
    void listen('wdiag-open-pending', () => { void openPendingFile(); }).then((stop) => {
      if (!active) { stop(); return; }
      unlisten = stop;
      void openPendingFile();
    }).catch((error: unknown) => {
      if (active) setStorageError(error instanceof Error ? error.message : 'Unable to register .wdiag file handling.');
    });
    return () => { active = false; unlisten?.(); };
  }, [setDocument]);

  useEffect(() => {
    if (!isDesktopApp()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const dispatchMenuAction = async (action: string) => {
      if (action !== 'quit' && (!nativeStorageReadyRef.current || nativeStorageFailedRef.current || nativeStorageUnavailableRef.current)) return;
      try {
        switch (action) {
          case 'new-document': {
            const current = useEditorStore.getState();
            if (current.isDirty && !globalThis.confirm('Create a new diagram? The current changes will be saved first.')) return;
            await autosaveRef.current?.flush();
            const next = createDocument('Untitled diagram');
            await rememberActiveDocument(next.id);
            if (!active) return;
            setDocument(next);
            setScreen('editor');
            break;
          }
          case 'open-diagram': {
            const raw = await openNativeWdiag();
            if (!raw) return;
            const next = parseProject(raw);
            await autosaveRef.current?.flush();
            await rememberActiveDocument(next.id);
            if (!active) return;
            setDocument(next);
            setScreen('editor');
            break;
          }
          case 'save-as':
            await autosaveRef.current?.flush();
            await saveNativeWdiag(useEditorStore.getState().document);
            break;
          case 'workspace-backup': {
            await autosaveRef.current?.flush();
            const backup = await createWorkspaceBackup();
            await saveNativeWorkspaceBackup(backup);
            break;
          }
          case 'undo':
            useEditorStore.getState().undo();
            break;
          case 'redo':
            useEditorStore.getState().redo();
            break;
          case 'quit':
            await getCurrentWindow().close();
            break;
        }
      } catch (error) {
        if (active) setStorageError(error instanceof Error ? error.message : 'The requested desktop action failed.');
      }
    };
    void listen<string>('native-menu-action', (event) => { void dispatchMenuAction(event.payload); }).then((stop) => {
      if (!active) { stop(); return; }
      unlisten = stop;
    }).catch((error: unknown) => {
      if (active) setStorageError(error instanceof Error ? error.message : 'Unable to register desktop menu actions.');
    });
    return () => { active = false; unlisten?.(); };
  }, [setDocument]);

  useEffect(() => {
    if (!isDesktopApp()) return;
    let unlisten: (() => void) | undefined;
    let active = true;
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (allowCloseRef.current) return;
      event.preventDefault();
      if (closeInProgressRef.current) return;
      closeInProgressRef.current = true;
      try {
        const current = useEditorStore.getState();
        if (!nativeStorageReadyRef.current && !current.isDirty) {
          allowCloseRef.current = true;
          await getCurrentWindow().close();
          return;
        }
        await withTimeout(autosaveRef.current?.flush(current.isDirty ? current.document : undefined) ?? Promise.resolve(), 15_000);
        await withTimeout(flushNativeStorage(), 5_000);
        allowCloseRef.current = true;
        await getCurrentWindow().close();
      } catch (error) {
        setStorageError(error instanceof Error ? error.message : 'Unable to save the native workspace before closing.');
        setCloseRecoveryPrompt(true);
      } finally {
        closeInProgressRef.current = false;
      }
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    }).catch((error: unknown) => {
      setStorageError(error instanceof Error ? error.message : 'Unable to register desktop close handling.');
    });
    return () => { active = false; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (isDesktopApp()) return;
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
    if (isDesktopApp()) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const openDocument = (document: DiagramDocument) => {
    void rememberActiveDocument(document.id);
    setDocument(document);
    setScreen('editor');
  };

  const exitEditor = () => {
    void (autosaveRef.current?.flush() ?? Promise.resolve()).then(() => forgetActiveDocument());
    setScreen('home');
  };

  const retryClose = async () => {
    try {
      const current = useEditorStore.getState();
      await withTimeout(autosaveRef.current?.flush(current.isDirty ? current.document : undefined) ?? Promise.resolve(), 15_000);
      await withTimeout(flushNativeStorage(), 5_000);
      setCloseRecoveryPrompt(false);
      allowCloseRef.current = true;
      await getCurrentWindow().close();
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Unable to save the native workspace before closing.');
    }
  };

  const exportAndClose = async () => {
    try {
      const exported = await saveNativeWdiag(useEditorStore.getState().document);
      if (!exported) return;
      setCloseRecoveryPrompt(false);
      allowCloseRef.current = true;
      await getCurrentWindow().close();
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Unable to export the current diagram.');
    }
  };

  if (resuming) return <div className="resume-screen" role="status">Restoring your local diagram…</div>;
  if (nativeStorageFailed) return <main className="storage-unavailable-screen"><section><h1>Workspace unavailable</h1><p>{storageError ?? 'AperGlyph could not open its local workspace database.'}</p><p>Your existing desktop workspace was not replaced. Close the app, check the workspace folder permissions and available disk space, then restart.</p><button className="primary-button" onClick={() => { allowCloseRef.current = true; void getCurrentWindow().close(); }}>Quit AperGlyph</button></section></main>;
  return <><div className="pwa-status" aria-live="polite">{storageError && <span className="pwa-message storage-error"><span>{storageError}</span><button onClick={() => setStorageError(null)}>Dismiss</button></span>}{!isDesktopApp() && !online && <span className="pwa-message offline">Offline mode</span>}{!isDesktopApp() && installPrompt && <span className="pwa-message"><span>Install AperGlyph</span><button onClick={() => void installApp()}>Install</button></span>}{!isDesktopApp() && offlineReady && online && <span className="pwa-message">Ready for offline use <button onClick={() => setOfflineReady(false)}>Dismiss</button></span>}{!isDesktopApp() && updateAvailable && <span className="pwa-message update">New version available <button onClick={() => { void autosaveRef.current?.flush(useEditorStore.getState().document).then(() => updateSWRef.current?.(true)); }}>Save &amp; reload</button></span>}</div>{screen === 'editor' ? <EditorScreen onExit={exitEditor} /> : <HomeScreen onOpen={openDocument} onInstall={installPrompt ? () => void installApp() : undefined} />}{closeRecoveryPrompt && <div className="modal-backdrop close-recovery-backdrop"><div className="close-recovery-modal" role="alertdialog" aria-modal="true" aria-labelledby="close-recovery-title"><h2 id="close-recovery-title">Workspace save failed</h2><p>AperGlyph could not confirm that the latest changes are safely stored. Retry the save, export the current diagram, or cancel closing.</p><div><button className="secondary-button" onClick={() => void exportAndClose()}>Export current diagram &amp; close</button><button className="primary-button" onClick={() => void retryClose()}>Retry save</button><button className="text-button" onClick={() => setCloseRecoveryPrompt(false)}>Cancel close</button></div></div></div>}</>;
}

export function createBlankDocument() {
  return createDocument('Untitled diagram');
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Saving is taking longer than expected. Retry or export the current diagram before closing.')), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
