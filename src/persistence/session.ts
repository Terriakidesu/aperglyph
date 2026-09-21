const ACTIVE_DOCUMENT_KEY = 'aperglyph-active-document';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function rememberActiveDocument(documentId: string): void {
  try {
    storage()?.setItem(ACTIVE_DOCUMENT_KEY, documentId);
  } catch {
    // Session restoration is best-effort when browser storage is restricted.
  }
}

export function getRememberedDocumentId(): string | null {
  try {
    return storage()?.getItem(ACTIVE_DOCUMENT_KEY) ?? null;
  } catch {
    return null;
  }
}

export function forgetActiveDocument(): void {
  try {
    storage()?.removeItem(ACTIVE_DOCUMENT_KEY);
  } catch {
    // Session restoration is best-effort when browser storage is restricted.
  }
}
