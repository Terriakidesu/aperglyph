import { useState } from 'react';
import { createDocument } from './core/document';
import type { DiagramDocument } from './core/types';
import { useEditorStore } from './store/editorStore';
import { EditorScreen } from './components/EditorScreen';
import { HomeScreen } from './components/HomeScreen';

export default function App() {
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const setDocument = useEditorStore((state) => state.setDocument);

  const openDocument = (document: DiagramDocument) => {
    setDocument(document);
    setScreen('editor');
  };

  const exitEditor = () => setScreen('home');

  return screen === 'editor'
    ? <EditorScreen onExit={exitEditor} />
    : <HomeScreen onOpen={openDocument} />;
}

export function createBlankDocument() {
  return createDocument('Untitled diagram');
}
