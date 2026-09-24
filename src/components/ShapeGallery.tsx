import { createNode } from '../core/document';
import type { Size } from '../core/types';
import { pluginManager } from '../plugins';
import type { ShapeDefinition } from '../plugins';
import { NodeGraphic } from './NodeGraphic';

/** Development-only stencil fixture. Open the Vite app with ?shape-gallery=1. */
export function ShapeGallery() {
  return <main className="shape-gallery">
    <header className="shape-gallery-header">
      <span className="panel-kicker">Development fixture</span>
      <h1>Shape gallery</h1>
      <p>Every built-in silhouette at representative sizes. Palette, canvas, connector boundaries, and SVG export share this geometry.</p>
    </header>
    <div className="shape-gallery-libraries">
      {pluginManager.list().map((plugin) => <section className="shape-gallery-library" key={plugin.id}>
        <div className="shape-gallery-library-heading"><h2>{plugin.name}</h2><span>{plugin.shapes.length} shapes</span></div>
        <div className="shape-gallery-grid">
          {plugin.shapes.map((shape) => <ShapeGalleryCard key={`${plugin.id}:${shape.id}`} shape={shape} libraryId={plugin.id} />)}
        </div>
      </section>)}
    </div>
  </main>;
}

function ShapeGalleryCard({ shape, libraryId }: { shape: ShapeDefinition; libraryId: string }) {
  const gallerySizes: Array<{ label: string; size: Size }> = [
    { label: 'Default', size: shape.defaultSize ?? { width: 180, height: 88 } },
    { label: 'Small', size: { width: 64, height: 64 } },
    { label: 'Wide', size: { width: 240, height: 64 } },
    { label: 'Tall', size: { width: 100, height: 180 } },
  ];
  return <article className="shape-gallery-card">
    <div className="shape-gallery-card-heading"><strong>{shape.label}</strong><code>{shape.renderer ?? shape.type}</code></div>
    <div className="shape-gallery-variants">
      {gallerySizes.map((variant) => {
        const size = shape.aspectRatio === 1 ? { width: variant.size.height, height: variant.size.height } : variant.size;
        const node = createNode(shape.type, { x: 0, y: 0 }, {
          library: libraryId,
          size,
          boundary: shape.boundary,
          container: shape.container,
          style: shape.defaultStyle,
          data: { ...(shape.defaultData ?? {}), label: shape.label },
        });
        return <div className="shape-gallery-variant" key={variant.label}>
          <svg viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={`${shape.label}, ${variant.label.toLowerCase()}`}><NodeGraphic node={node} diagramType={libraryId} /></svg>
          <span>{variant.label}</span>
        </div>;
      })}
    </div>
  </article>;
}
