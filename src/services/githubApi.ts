import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  GitHubContentItem,
  GitHubFileContent,
  GitHubUser,
  GitHubApiError,
  RepoConfig,
} from '../types/config';
import { utf8ToBase64 } from '../utils/base64';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * All GitHub REST calls are centralized here so components never talk to
 * axios directly. Every function throws a normalized GitHubApiError so the
 * UI can render one consistent message regardless of which call failed.
 */
class GitHubService {
  private client: AxiosInstance;

  constructor(token: string) {
    this.client = axios.create({
      baseURL: GITHUB_API_BASE,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  }

  /** GET /user — used purely to confirm the token is valid and to show "Connected as X". */
  async verifyToken(): Promise<GitHubUser> {
    try {
      const res = await this.client.get<GitHubUser>('/user');
      return res.data;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /**
   * Confirms the configured repo exists and the token can see it.
   * Distinct from verifyToken() because a valid token can still lack
   * access to a specific repo (404) or lack write scope (403).
   */
  async verifyRepoAccess(config: RepoConfig): Promise<void> {
    try {
      await this.client.get(`/repos/${config.owner}/${config.repo}`);
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /**
   * Loads one directory level. GitHub's contents endpoint returns an array
   * when `path` is a directory and a single object when it's a file, so the
   * caller is expected to only invoke this for directories.
   */
  async loadFolder(config: RepoConfig, path: string): Promise<GitHubContentItem[]> {
    try {
      const res = await this.client.get<GitHubContentItem[]>(
        `/repos/${config.owner}/${config.repo}/contents/${encodeGitHubPath(path)}`,
        { params: { ref: config.branch } }
      );
      return res.data;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /** Loads a single file's content + sha. */
  async loadFile(config: RepoConfig, path: string): Promise<GitHubFileContent> {
    try {
      const res = await this.client.get<GitHubFileContent>(
        `/repos/${config.owner}/${config.repo}/contents/${encodeGitHubPath(path)}`,
        { params: { ref: config.branch } }
      );
      if (Array.isArray(res.data)) {
        throw { status: 400, message: `${path} is a directory, not a file.` };
      }
      return res.data;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /**
   * Commits new content to an existing file. The `sha` MUST be the sha of
   * the version currently open in the editor — if the file changed on
   * GitHub since it was loaded, this call 409s (conflict) and the caller
   * should prompt the user to reload before retrying.
   */
  async commitFile(
    config: RepoConfig,
    path: string,
    content: string,
    sha: string,
    message: string
  ): Promise<{ newSha: string }> {
    return this.putContents(config, path, utf8ToBase64(content), message, sha);
  }

  /**
   * Creates a new binary file (e.g. an image) from content that is
   * ALREADY base64-encoded. No sha is passed — this path is for creating
   * a new file, not updating an existing one.
   */
  async uploadBinaryFile(
    config: RepoConfig,
    path: string,
    base64Content: string,
    message: string
  ): Promise<{ newSha: string }> {
    return this.putContents(config, path, base64Content, message);
  }

  /** Shared PUT logic behind both commitFile (update) and uploadBinaryFile (create). */
  private async putContents(
    config: RepoConfig,
    path: string,
    base64Content: string,
    message: string,
    sha?: string
  ): Promise<{ newSha: string }> {
    try {
      const res = await this.client.put(
        `/repos/${config.owner}/${config.repo}/contents/${encodeGitHubPath(path)}`,
        {
          message,
          content: base64Content,
          ...(sha ? { sha } : {}),
          branch: config.branch,
        }
      );
      return { newSha: res.data.content.sha as string };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /** Maps axios/GitHub errors to a single shape the StatusPanel understands. */
  private normalizeError(err: unknown): GitHubApiError {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      const status = axiosErr.response?.status ?? null;
      const githubMessage = axiosErr.response?.data?.message;

      switch (status) {
        case 401:
          return {
            status,
            kind: 'auth-failed',
            message: 'Authentication failed — the token is invalid, expired, or was revoked.',
          };
        case 403:
          return {
            status,
            kind: 'auth-failed',
            message:
              githubMessage?.toLowerCase().includes('rate limit')
                ? 'GitHub API rate limit exceeded. Wait a few minutes and try again.'
                : 'Access forbidden — the token lacks permission for this repository or action.',
          };
        case 404:
          return {
            status,
            kind: 'error',
            message: 'Not found — check the repository name, branch, or file path.',
          };
        case 409:
          return {
            status,
            kind: 'conflict',
            message:
              'Conflict — this file changed on GitHub since it was opened. Reload it before saving again.',
          };
        case 422:
          return {
            status,
            kind: 'error',
            message: githubMessage ?? 'Validation failed — the request was rejected by GitHub.',
          };
        case 500:
        case 502:
        case 503:
          return {
            status,
            kind: 'network-error',
            message: 'GitHub is having server issues. Try again shortly.',
          };
        default:
          if (axiosErr.code === 'ERR_NETWORK') {
            return {
              status: null,
              kind: 'network-error',
              message: 'Network error — check your internet connection.',
            };
          }
          return {
            status,
            kind: 'error',
            message: githubMessage ?? axiosErr.message ?? 'An unexpected error occurred.',
          };
      }
    }

    if (err && typeof err === 'object' && 'message' in err) {
      return {
        status: (err as { status?: number }).status ?? null,
        kind: 'error',
        message: String((err as { message: unknown }).message),
      };
    }

    return { status: null, kind: 'error', message: 'An unexpected error occurred.' };
  }
}

/** GitHub paths can contain spaces/special chars; each segment needs encoding, not the slashes. */
function encodeGitHubPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

let instance: GitHubService | null = null;
let instanceToken: string | null = null;

/** Lazily creates the singleton service, recreating it if the token changed. */
export function getGitHubService(token: string): GitHubService {
  if (!instance || instanceToken !== token) {
    instance = new GitHubService(token);
    instanceToken = token;
  }
  return instance;
}

export function resetGitHubService(): void {
  instance = null;
  instanceToken = null;
}

export type { GitHubService };