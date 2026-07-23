/** Directories the explorer should never fetch/render, matched by exact name. */
const IGNORED_DIR_NAMES = new Set(['node_modules', '.next', '.git', 'dist', 'build']);

export function isIgnoredEntry(name: string): boolean {
  return IGNORED_DIR_NAMES.has(name);
}

/** Maps a file extension to the Monaco/Editor language id. */
export function getLanguageFromPath(path: string): string {
  const ext = getExtension(path);
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'typescript';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'xml':
      return 'xml';
    default:
      return 'plaintext';
  }
}

export function getExtension(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot === -1) return '';
  return base.slice(dot + 1).toLowerCase();
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);
export function isImageFile(path: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(path));
}

/** Which file kinds the Live Preview panel can actually render. */
export function isPreviewable(path: string): boolean {
  return ['html', 'htm', 'css', 'js', 'jsx'].includes(getExtension(path));
}

/**
 * Icon key used by FileExplorer to pick an SVG glyph. Kept separate from
 * `getLanguageFromPath` because a folder has no language but still needs
 * an icon, and some languages (tsx vs ts) share one icon.
 */
export type IconKind =
  | 'folder'
  | 'html'
  | 'css'
  | 'js'
  | 'ts'
  | 'tsx'
  | 'json'
  | 'image'
  | 'markdown'
  | 'generic';

export function getIconKind(name: string, type: 'file' | 'dir'): IconKind {
  if (type === 'dir') return 'folder';
  const ext = getExtension(name);
  if (isImageFile(name)) return 'image';
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
    case 'scss':
      return 'css';
    case 'js':
    case 'jsx':
      return 'js';
    case 'ts':
      return 'ts';
    case 'tsx':
      return 'tsx';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    default:
      return 'generic';
  }
}

/** Folders first, then files, both alphabetical — the standard IDE sort. */
export function sortEntries<T extends { name: string; type: 'file' | 'dir' }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
