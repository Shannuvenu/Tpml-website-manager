/**
 * Shared types for the TPML Website Manager.
 *
 * There is no backend, so every one of these types describes either
 * a shape returned directly by the GitHub REST API, or local UI state.
 */

/** Connection settings the user supplies once (persisted to localStorage). */
export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string; // e.g. "main"
}

/** A single entry returned by GET /repos/{owner}/{repo}/contents/{path} */
export interface GitHubContentItem {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  download_url: string | null;
}

/** Full file payload (contents endpoint on a single file includes base64 content) */
export interface GitHubFileContent extends GitHubContentItem {
  content: string; // base64, may contain newlines
  encoding: 'base64';
}

/** Authenticated user, from GET /user */
export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

/** A node in the file tree the Sidebar renders. Folders are lazy-loaded. */
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha: string;
  children?: FileNode[]; // populated only after the folder has been expanded
  loaded?: boolean; // whether children have been fetched yet
}

/** The file currently open in the editor. */
export interface OpenFile {
  path: string;
  sha: string; // needed to commit an update without a 409 conflict
  originalContent: string;
  currentContent: string;
  language: string; // Monaco language id
}

export type StatusKind =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'loading-file'
  | 'file-loaded'
  | 'saving'
  | 'commit-created'
  | 'conflict'
  | 'auth-failed'
  | 'network-error'
  | 'error';

export interface StatusMessage {
  kind: StatusKind;
  text: string;
  timestamp: number;
}

/** Normalized error shape produced by the GitHub service for the UI to render. */
export interface GitHubApiError {
  status: number | null;
  message: string;
  kind: StatusKind;
}
