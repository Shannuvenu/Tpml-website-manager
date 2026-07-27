import { useEffect, useState } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import MonacoEditor from './components/MonacoEditor';
import LivePreview from './components/LivePreview';
import CommitDialog from './components/CommitDialog';
import UploadDialog from './components/UploadDialog';
import StatusPanel from './components/StatusPanel';
import ConnectScreen from './components/ConnectScreen';
import { getGitHubService, resetGitHubService } from './services/githubApi';
import { getToken, saveToken, getRepoConfig, saveRepoConfig, clearAll } from './utils/tokenStorage';
import { getLanguageFromPath } from './utils/fileHelpers';
import { base64ToUtf8 } from './utils/base64';
import type { GitHubUser, RepoConfig, OpenFile, StatusMessage, GitHubApiError } from './types/config';

function makeStatus(kind: StatusMessage['kind'], text: string): StatusMessage {
  return { kind, text, timestamp: Date.now() };
}

const TEAM_PASSPHRASE = 'tpml-it-2026'; // change this — visible in the built JS, deters casual visitors only

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [repoConfig, setRepoConfig] = useState<RepoConfig | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);

  const [status, setStatus] = useState<StatusMessage>(makeStatus('idle', 'Not connected'));

  const [passphraseOk, setPassphraseOk] = useState(
    sessionStorage.getItem('tpml_gate') === TEAM_PASSPHRASE
  );

  // On mount, attempt to resume a previously saved session.
  useEffect(() => {
    const savedToken = getToken();
    const savedConfig = getRepoConfig();
    if (savedToken && savedConfig) {
      void reconnect(savedToken, savedConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reconnect(savedToken: string, config: RepoConfig) {
    setIsConnecting(true);
    setStatus(makeStatus('connecting', 'Reconnecting…'));
    try {
      const service = getGitHubService(savedToken);
      const [verifiedUser] = await Promise.all([
        service.verifyToken(),
        service.verifyRepoAccess(config),
      ]);
      setUser(verifiedUser);
      setToken(savedToken);
      setRepoConfig(config);
      setStatus(makeStatus('connected', `Connected as ${verifiedUser.login}`));
    } catch (err) {
      const apiErr = err as GitHubApiError;
      setConnectError(apiErr.message);
      setStatus(makeStatus(apiErr.kind, apiErr.message));
      clearAll();
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleConnect(newToken: string, owner: string, repo: string, branch: string) {
    setIsConnecting(true);
    setConnectError(null);
    setStatus(makeStatus('connecting', 'Connecting to GitHub…'));

    const config: RepoConfig = { owner, repo, branch };

    try {
      resetGitHubService();
      const service = getGitHubService(newToken);
      const verifiedUser = await service.verifyToken();
      await service.verifyRepoAccess(config);

      saveToken(newToken);
      saveRepoConfig(config);

      setUser(verifiedUser);
      setToken(newToken);
      setRepoConfig(config);
      setStatus(makeStatus('connected', `Connected as ${verifiedUser.login}`));
    } catch (err) {
      const apiErr = err as GitHubApiError;
      setConnectError(apiErr.message);
      setStatus(makeStatus(apiErr.kind, apiErr.message));
    } finally {
      setIsConnecting(false);
    }
  }

  function handleDisconnect() {
    clearAll();
    resetGitHubService();
    setToken(null);
    setRepoConfig(null);
    setUser(null);
    setOpenFile(null);
    setStatus(makeStatus('idle', 'Disconnected'));
  }

  async function handleOpenFile(path: string) {
    if (!token || !repoConfig) return;

    if (openFile && openFile.currentContent !== openFile.originalContent) {
      const confirmed = window.confirm(
        `You have unsaved changes in ${openFile.path}. Discard them and open ${path}?`
      );
      if (!confirmed) return;
    }

    setStatus(makeStatus('loading-file', `Loading ${path}…`));
    try {
      const service = getGitHubService(token);
      const file = await service.loadFile(repoConfig, path);
      const content = base64ToUtf8(file.content);

      setOpenFile({
        path: file.path,
        sha: file.sha,
        originalContent: content,
        currentContent: content,
        language: getLanguageFromPath(file.path),
      });
      setStatus(makeStatus('file-loaded', `Loaded ${path}`));
    } catch (err) {
      const apiErr = err as GitHubApiError;
      setStatus(makeStatus(apiErr.kind, apiErr.message));
    }
  }

  function handleEditorChange(value: string) {
    setOpenFile((prev) => (prev ? { ...prev, currentContent: value } : prev));
  }

  async function handleCommit(message: string) {
    if (!token || !repoConfig || !openFile) return;

    setIsSaving(true);
    setStatus(makeStatus('saving', `Committing ${openFile.path}…`));
    try {
      const service = getGitHubService(token);
      const { newSha } = await service.commitFile(
        repoConfig,
        openFile.path,
        openFile.currentContent,
        openFile.sha,
        message
      );

      setOpenFile((prev) =>
        prev
          ? { ...prev, sha: newSha, originalContent: prev.currentContent }
          : prev
      );
      setStatus(makeStatus('commit-created', `Commit created for ${openFile.path}`));
      setShowCommitDialog(false);
    } catch (err) {
      const apiErr = err as GitHubApiError;
      setStatus(makeStatus(apiErr.kind, apiErr.message));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpload(path: string, base64Content: string, message: string) {
    if (!token || !repoConfig) return;
    setIsUploading(true);
    setUploadError(null);
    setStatus(makeStatus('saving', `Uploading ${path}…`));
    try {
      const service = getGitHubService(token);
      await service.uploadBinaryFile(repoConfig, path, base64Content, message);
      setStatus(makeStatus('commit-created', `${path} uploaded and committed`));
      setShowUploadDialog(false);
      setExplorerRefreshKey((k) => k + 1);
    } catch (err) {
      const apiErr = err as GitHubApiError;
      setUploadError(apiErr.message);
      setStatus(makeStatus(apiErr.kind, apiErr.message));
    } finally {
      setIsUploading(false);
    }
  }

  function handleExplorerError(err: GitHubApiError) {
    setStatus(makeStatus(err.kind, err.message));
  }

  const hasUnsavedChanges = !!openFile && openFile.currentContent !== openFile.originalContent;

  if (!passphraseOk) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="bg-panel border border-border rounded-lg p-6 w-80">
          <p className="text-sm text-text-secondary mb-3">IT team access only</p>
          <input
            type="password"
            placeholder="Team passphrase"
            className="w-full rounded-md bg-canvas border border-border px-3 py-2 text-sm text-text-primary mb-3"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.target as HTMLInputElement).value === TEAM_PASSPHRASE) {
                sessionStorage.setItem('tpml_gate', TEAM_PASSPHRASE);
                setPassphraseOk(true);
              }
            }}
          />
        </div>
      </div>
    );
  }

  if (!token || !repoConfig || !user) {
    return (
      <ConnectScreen onConnect={handleConnect} isConnecting={isConnecting} error={connectError} />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-canvas">
      <Header
        user={user}
        repoConfig={repoConfig}
        hasUnsavedChanges={hasUnsavedChanges}
        onCommitClick={() => setShowCommitDialog(true)}
        onUploadClick={() => {
          setUploadError(null);
          setShowUploadDialog(true);
        }}
        onDisconnect={handleDisconnect}
      />

      <div className="flex-1 flex min-h-0">
        <Sidebar
          service={getGitHubService(token)}
          repoConfig={repoConfig}
          activePath={openFile?.path ?? null}
          onOpenFile={(path) => void handleOpenFile(path)}
          onError={handleExplorerError}
          refreshKey={explorerRefreshKey}
          onRefresh={() => setExplorerRefreshKey((k) => k + 1)}
        />

        <MonacoEditor openFile={openFile} onChange={handleEditorChange} />

        <LivePreview
  openFile={openFile}
  service={token ? getGitHubService(token) : null}
  repoConfig={repoConfig}
/>
      </div>

      <StatusPanel status={status} />

      {showCommitDialog && openFile && (
        <CommitDialog
          filePath={openFile.path}
          isSaving={isSaving}
          onConfirm={(message) => void handleCommit(message)}
          onCancel={() => setShowCommitDialog(false)}
        />
      )}

      {showUploadDialog && (
        <UploadDialog
          isUploading={isUploading}
          error={uploadError}
          onConfirm={(path, base64Content, message) => void handleUpload(path, base64Content, message)}
          onCancel={() => setShowUploadDialog(false)}
        />
      )}
    </div>
  );
}