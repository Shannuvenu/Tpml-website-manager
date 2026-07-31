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

  async verifyToken(): Promise<GitHubUser> {
    try {
      const res = await this.client.get<GitHubUser>('/user');
      return res.data;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  async verifyRepoAccess(config: RepoConfig): Promise<void> {
    try {
      await this.client.get(`/repos/${config.owner}/${config.repo}`);
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

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

  async commitFile(
    config: RepoConfig,
    path: string,
    content: string,
    sha: string,
    message: string
  ): Promise<{ newSha: string }> {
    return this.putContents(config, path, utf8ToBase64(content), message, sha);
  }

  async uploadBinaryFile(
    config: RepoConfig,
    path: string,
    base64Content: string,
    message: string
  ): Promise<{ newSha: string }> {
    return this.putContents(config, path, base64Content, message);
  }

  /**
   * Replaces an EXISTING binary file (e.g. swapping a photo at the same
   * path). Unlike uploadBinaryFile, this requires a sha — fetched fresh
   * right before the write so it reflects the file's true current state,
   * avoiding a stale-sha 409 if it changed since the page was opened.
   */
  async replaceBinaryFile(
    config: RepoConfig,
    path: string,
    base64Content: string,
    message: string
  ): Promise<{ newSha: string }> {
    const current = await this.loadFile(config, path);
    return this.putContents(config, path, base64Content, message, current.sha);
  }

  /**
   * Fetches recent commits for the repo, optionally filtered to one file's
   * path. Read-only — used for "View History", not for any rollback yet.
   */
  async getCommitHistory(
    config: RepoConfig,
    path?: string,
    perPage = 10
  ): Promise<Array<{ sha: string; message: string; author: string; date: string }>> {
    try {
      const res = await this.client.get(`/repos/${config.owner}/${config.repo}/commits`, {
        params: { sha: config.branch, path, per_page: perPage },
      });
      return (res.data as Array<Record<string, any>>).map((c) => ({
        sha: (c.sha as string).slice(0, 7),
        message: (c.commit?.message as string) ?? '(no message)',
        author: (c.commit?.author?.name as string) ?? 'Unknown',
        date: (c.commit?.author?.date as string) ?? '',
      }));
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

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
            message: 'Your GitHub session is no longer valid. Please reconnect.',
          };
        case 403:
          return {
            status,
            kind: 'auth-failed',
            message:
              githubMessage?.toLowerCase().includes('rate limit')
                ? 'GitHub is temporarily limiting requests. Wait a few minutes and try again.'
                : "You don't have permission to save changes to this repository. Ask the repository administrator for write access.",
          };
        case 404:
          return {
            status,
            kind: 'error',
            message: 'The requested file or repository could not be found.',
          };
        case 409:
          return {
            status,
            kind: 'conflict',
            message: 'This file was changed by someone else after you opened it. Reload the latest version before saving.',
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
              message: 'Unable to reach GitHub. Check your internet connection and try again.',
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

function encodeGitHubPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

let instance: GitHubService | null = null;
let instanceToken: string | null = null;

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