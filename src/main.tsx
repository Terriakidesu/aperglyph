import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ShapeGallery } from './components/ShapeGallery';
import './styles.css';

const showShapeGallery = import.meta.env.DEV && new URLSearchParams(window.location.search).get('shape-gallery') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{showShapeGallery ? <ShapeGallery /> : <App />}</StrictMode>,
);
