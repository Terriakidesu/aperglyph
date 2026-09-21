import { useEffect, useRef, useState } from 'react';
import { createDocument } from './core/document';
import type { DiagramDocument } from './core/types';
import { AutosaveController } from './persistence';
import { useEditorStore } from './store/editorStore';
import { EditorScreen } from './components/EditorScreen';
import { HomeScreen } from './components/HomeScreen';

export default function App() {
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const setDocument = useEditorStore((state) => state.setDocument);
  const markSaved = useEditorStore((state) => state.markSaved);
  const autosaveRef = useRef<AutosaveController | null>(null);

  useEffect(() => {
    const autosave = new AutosaveController({ onSaved: () => markSaved() });
    autosaveRef.current = autosave;
    const stop = autosave.start();
    return () => {
      stop();
      autosaveRef.current = null;
    };
  }, [markSaved]);

  const openDocument = (document: DiagramDocument) => {
    setDocument(document);
    setScreen('editor');
  };

  const exitEditor = () => {
    void autosaveRef.current?.flush();
    setScreen('home');
  };

  return screen === 'editor'
    ? <EditorScreen onExit={exitEditor} />
    : <HomeScreen onOpen={openDocument} />;
}

export function createBlankDocument() {
  return createDocument('Untitled diagram');
}
