import type { RepoConfig } from '../types/config';

/**
 * Thin wrapper around localStorage.
 *
 * SECURITY NOTE: storing a PAT in localStorage is inherently readable by
 * any script running on this origin (i.e. any XSS is a full repo-write
 * compromise). That trade-off is what makes a backend-less app possible.
 * Mitigate it by:
 *   - using a fine-grained token scoped to only this one repository
 *   - giving it Contents: Read & Write only (no admin/workflow scopes)
 *   - setting a short expiry on the token and rotating it periodically
 */

const TOKEN_KEY = 'tpml_gh_token';
const CONFIG_KEY = 'tpml_gh_config';

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function saveRepoConfig(config: RepoConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function getRepoConfig(): RepoConfig | null {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RepoConfig;
  } catch {
    return null;
  }
}

export function clearRepoConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

export function clearAll(): void {
  clearToken();
  clearRepoConfig();
}
