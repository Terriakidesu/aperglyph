import { deleteNativePreference, getNativePreference, isDesktopApp, setNativePreference } from './nativeStorage';

const ACTIVE_DOCUMENT_KEY = 'aperglyph-active-document';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export async function rememberActiveDocument(documentId: string): Promise<void> {
  if (isDesktopApp()) return setNativePreference(`aperglyph.${ACTIVE_DOCUMENT_KEY}`, documentId);
  try {
    storage()?.setItem(ACTIVE_DOCUMENT_KEY, documentId);
  } catch {
    // Session restoration is best-effort when browser storage is restricted.
  }
}

export async function getRememberedDocumentId(): Promise<string | null> {
  if (isDesktopApp()) return getNativePreference(`aperglyph.${ACTIVE_DOCUMENT_KEY}`);
  try {
    return storage()?.getItem(ACTIVE_DOCUMENT_KEY) ?? null;
  } catch {
    return null;
  }
}

export async function forgetActiveDocument(): Promise<void> {
  if (isDesktopApp()) return deleteNativePreference(`aperglyph.${ACTIVE_DOCUMENT_KEY}`);
  try {
    storage()?.removeItem(ACTIVE_DOCUMENT_KEY);
  } catch {
    // Session restoration is best-effort when browser storage is restricted.
  }
}
