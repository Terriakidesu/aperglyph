import { invoke } from '@tauri-apps/api/core';
import { serializeProject } from '../core/document';
import type { DiagramDocument } from '../core/types';
import { isDesktopApp } from './nativeStorage';

export async function openNativeWdiag(): Promise<string | null> {
  if (!isDesktopApp()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({
    multiple: false,
    filters: [{ name: 'AperGlyph diagram', extensions: ['wdiag'] }],
  });
  if (typeof path !== 'string') return null;
  return invoke<string>('read_wdiag_file', { path });
}

export async function saveNativeWdiag(document: DiagramDocument): Promise<boolean> {
  if (!isDesktopApp()) return false;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    defaultPath: `${safeFilename(document.name)}.wdiag`,
    filters: [{ name: 'AperGlyph diagram', extensions: ['wdiag'] }],
  });
  if (!path) return false;
  await invoke('write_wdiag_file', { path, contents: serializeProject(document) });
  return true;
}

export async function openNativeWorkspaceBackup(): Promise<string | null> {
  if (!isDesktopApp()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({
    multiple: false,
    filters: [{ name: 'AperGlyph workspace backup', extensions: ['json', 'wbackup'] }],
  });
  if (typeof path !== 'string') return null;
  return invoke<string>('read_workspace_backup_file', { path });
}

export async function saveNativeWorkspaceBackup(contents: string, filename = 'aperglyph-workspace-backup.json'): Promise<boolean> {
  if (!isDesktopApp()) return false;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'AperGlyph workspace backup', extensions: ['json', 'wbackup'] }],
  });
  if (!path) return false;
  await invoke('write_workspace_backup_file', { path, contents });
  return true;
}

export async function readNativeStartupWdiag(): Promise<string | null> {
  if (!isDesktopApp()) return null;
  return invoke<string | null>('take_startup_wdiag');
}

export async function readNativeWdiagPath(path: string): Promise<string> {
  return invoke<string>('read_wdiag_file', { path });
}

function safeFilename(value: string): string {
  const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 120);
  return normalized || 'diagram';
}
