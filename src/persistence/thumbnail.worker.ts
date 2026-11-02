import { documentToSvg } from './files';
import type { DiagramDocument } from '../core/types';

interface ThumbnailRequest {
  requestId: number;
  document: DiagramDocument;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ThumbnailRequest>) => void) | null;
  postMessage: (message: { requestId: number; thumbnail?: string; error?: string }) => void;
};

scope.onmessage = ({ data }) => {
  try {
    const page = data.document.pages[0];
    if (!page) {
      scope.postMessage({ requestId: data.requestId });
      return;
    }
    const svg = documentToSvg(
      page.nodes.filter((node) => !node.hidden),
      page.edges,
      page.settings.background,
      page.settings.width,
      page.settings.height,
    );
    const thumbnail = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    scope.postMessage({ requestId: data.requestId, ...(thumbnail.length <= 600_000 ? { thumbnail } : {}) });
  } catch (error) {
    scope.postMessage({ requestId: data.requestId, error: error instanceof Error ? error.message : 'Thumbnail generation failed.' });
  }
};
