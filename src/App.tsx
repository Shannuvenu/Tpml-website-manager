import { useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import MonacoEditor from './components/MonacoEditor';
import LivePreview, { loadPageDependencies, buildPreviewHtml, isHtmlFile } from './components/LivePreview';
import CommitDialog from './components/CommitDialog';
import UploadDialog from './components/UploadDialog';
import StatusPanel from './components/StatusPanel';
import ConnectScreen from './components/ConnectScreen';
import { getGitHubService, resetGitHubService } from './services/githubApi';
import type { GitHubService } from './services/githubApi';
import { getToken, saveToken, getRepoConfig, saveRepoConfig, clearAll } from './utils/tokenStorage';
import { getLanguageFromPath } from './utils/fileHelpers';
import { base64ToUtf8 } from './utils/base64';
import type { GitHubUser, RepoConfig, OpenFile, StatusMessage, GitHubApiError } from './types/config';

function makeStatus(kind: StatusMessage['kind'], text: string): StatusMessage {
  return { kind, text, timestamp: Date.now() };
}

const TEAM_PASSPHRASE = 'tpml-it-2026';

/* =========================================================
   VISUAL EDITOR
   ========================================================= */

// Block-list, not allow-list: anything NOT here is a candidate for editing
// as long as its content is still just text plus whitelisted inline
// formatting. This is what makes "edit anything with real text" actually
// true — adding tags one at a time to an allow-list never gets there.
const BLOCKED_TAGS = [
  'html', 'head', 'body',
  'div', 'section', 'main', 'header', 'footer', 'nav', 'article', 'aside',
  'ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'form', 'fieldset',
  'script', 'style', 'link', 'meta', 'base', 'noscript', 'template',
  'svg', 'path', 'iframe', 'video', 'audio', 'object', 'embed', 'canvas',
  'source', 'track', 'br', 'hr', 'img', 'input', 'select', 'option', 'textarea',
];

// 'br' included — real content on this site nests <br> inside names/addresses
// (e.g. "Ramachandra<br>Guha"). Without it, every element containing a line
// break gets rejected as "unrecognized nested tag."
const INLINE_ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 'a', 'br'];

interface EditableRange {
  tag: string;
  start: number;
  end: number;
  html: string;
}

function scanBalanced(html: string, pos: number, tagName: string): number | null {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  tagRe.lastIndex = pos;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    const name = match[1].toLowerCase();
    const isClose = match[0].startsWith('</');
    if (name === tagName) {
      if (isClose) {
        if (depth === 0) return match.index;
        depth--;
      } else {
        depth++;
      }
      continue;
    }
    if (name === 'br') continue; // self-closing, never wraps anything — always fine
    if (!INLINE_ALLOWED_TAGS.includes(name)) return null;
  }
  return null;
}

function extractEditableRanges(html: string): EditableRange[] {
  const openTagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  const ranges: EditableRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = openTagRe.exec(html))) {
    const tag = m[1].toLowerCase();
    if (BLOCKED_TAGS.includes(tag)) continue;
    const contentStart = m.index + m[0].length;
    const end = scanBalanced(html, contentStart, tag);
    if (end !== null) {
      const inner = html.slice(contentStart, end);
      if (inner.replace(/<[^>]*>/g, '').trim().length > 0) {
        ranges.push({ tag, start: contentStart, end, html: inner });
      }
    }
  }
  return ranges;
}

function normalizeHtml(html: string): string {
  const c = document.createElement('div');
  c.innerHTML = html;
  return c.innerHTML;
}

function sanitizeInlineHtml(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  const toUnwrap: Element[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    const tag = el.tagName.toLowerCase();
    if (!INLINE_ALLOWED_TAGS.includes(tag)) {
      toUnwrap.push(el);
      continue;
    }
    [...el.attributes].forEach((attr) => {
      if (!(tag === 'a' && attr.name === 'href')) el.removeAttribute(attr.name);
    });
  }
  toUnwrap.forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
  return container.innerHTML;
}

function isEligibleLiveElement(el: HTMLElement): boolean {
  if (BLOCKED_TAGS.includes(el.tagName.toLowerCase())) return false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const child = walker.currentNode as HTMLElement;
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') continue;
    if (!INLINE_ALLOWED_TAGS.includes(tag)) return false;
  }
  return (el.textContent ?? '').trim().length > 0;
}

interface VisualEditorProps {
  openFile: OpenFile;
  service: GitHubService;
  repoConfig: RepoConfig;
  onContentChange: (next: string) => void;
}

function VisualEditor({ openFile, service, repoConfig, onContentChange }: VisualEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const baselineRef = useRef(openFile.currentContent);
  const rangesRef = useRef<EditableRange[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadPageDependencies(openFile, service, repoConfig)
      .then(({ loaded }) => {
        if (!cancelled) setAssets(loaded);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFile.path, service, repoConfig]);

  useEffect(() => {
    baselineRef.current = openFile.currentContent;
    rangesRef.current = extractEditableRanges(openFile.currentContent);
    setWarning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFile.path]);

  const srcDoc = useMemo(
    () => buildPreviewHtml(openFile.currentContent, openFile.path, assets, openFile, repoConfig),
    [openFile, assets, repoConfig]
  );

  function handleSync(idx: number, el: HTMLElement) {
    const range = rangesRef.current[idx];
    if (!range) return;

    const currentContent = baselineRef.current;
    const rawSlice = currentContent.slice(range.start, range.end);

    if (normalizeHtml(rawSlice) !== normalizeHtml(range.html)) {
      setWarning('This section changed unexpectedly — switch to Code mode to check the file before continuing to edit visually.');
      return;
    }

    const sanitized = sanitizeInlineHtml(el.innerHTML);
    if (normalizeHtml(sanitized) === normalizeHtml(range.html)) return;

    const updated = currentContent.slice(0, range.start) + sanitized + currentContent.slice(range.end);

    const delta = sanitized.length - (range.end - range.start);
    rangesRef.current = rangesRef.current.map((r, i) =>
      i <= idx ? r : { ...r, start: r.start + delta, end: r.end + delta }
    );
    rangesRef.current[idx] = { ...range, end: range.start + sanitized.length, html: sanitized };

    baselineRef.current = updated;
    onContentChange(updated);

    if (el.innerHTML !== sanitized) el.innerHTML = sanitized;
  }

  /**
   * Matches live rendered elements to raw-string ranges by CONTENT, not
   * strict position — with a small lookahead to resync after a mismatch.
   * This is what stops one odd element from disabling editing for the
   * entire page: an element that can't be matched is simply left
   * read-only, and matching continues normally for everything after it.
   */
  function handleIframeLoad() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !doc.body) return;

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    const eligible: HTMLElement[] = [];
    while (walker.nextNode()) {
      const el = walker.currentNode as HTMLElement;
      if (isEligibleLiveElement(el)) eligible.push(el);
    }

    const ranges = rangesRef.current;
    const LOOKAHEAD = 6;
    let rangePtr = 0;
    let skippedCount = 0;
    const matched: Array<{ el: HTMLElement; rangeIdx: number }> = [];

    for (const el of eligible) {
      const liveKey = normalizeHtml(el.innerHTML).trim();
      let foundAt = -1;
      for (let look = 0; look < LOOKAHEAD && rangePtr + look < ranges.length; look++) {
        if (normalizeHtml(ranges[rangePtr + look].html).trim() === liveKey) {
          foundAt = rangePtr + look;
          break;
        }
      }
      if (foundAt !== -1) {
        matched.push({ el, rangeIdx: foundAt });
        rangePtr = foundAt + 1;
      } else {
        skippedCount++;
        el.title = 'This part can\'t be edited visually — use Code mode.';
        el.style.opacity = '0.55';
      }
    }

    setWarning(
      skippedCount > 0
        ? `${skippedCount} element(s) on this page couldn't be matched safely and are shown dimmed/read-only. Everything else is fully editable.`
        : null
    );

    matched.forEach(({ el, rangeIdx }) => {
      el.contentEditable = 'true';
      el.dataset.tpmlEditId = String(rangeIdx);
      el.addEventListener('mouseenter', () => {
        if (doc.activeElement !== el) el.style.outline = '1px dashed #5b8def';
      });
      el.addEventListener('mouseleave', () => {
        if (doc.activeElement !== el) el.style.outline = 'none';
      });
      el.addEventListener('focus', () => {
        el.style.outline = '1px solid #5b8def';
      });
      el.addEventListener('blur', () => handleSync(rangeIdx, el));
    });
  }

  function exec(command: string, value?: string) {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.execCommand(command, false, value);
  }

  function handleLink() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || doc.getSelection()?.isCollapsed !== false) {
      setWarning('Select some text first, then click Link.');
      return;
    }
    const url = window.prompt('Link URL:', 'https://');
    if (url) exec('createLink', url);
  }

  const toolbarButton = (label: string, onClick: () => void, title: string) => (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className="px-2.5 py-1 rounded text-xs font-medium text-text-secondary hover:bg-panel hover:text-text-primary transition-colors"
    >
      {label}
    </button>
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white">
      <div className="h-9 flex items-center gap-1 px-2 border-b border-border bg-panelAlt shrink-0">
        {toolbarButton('B', () => exec('bold'), 'Bold')}
        {toolbarButton('I', () => exec('italic'), 'Italic')}
        {toolbarButton('U', () => exec('underline'), 'Underline')}
        {toolbarButton('Link', handleLink, 'Add link to selected text')}
        <span className="w-px h-4 bg-border mx-1" />
        {toolbarButton('↶', () => exec('undo'), 'Undo')}
        {toolbarButton('↷', () => exec('redo'), 'Redo')}
      </div>

      {(loading || warning) && (
        <div className="px-3 py-1.5 border-b border-border bg-panelAlt shrink-0">
          {loading && <p className="text-[11px] text-text-muted">Loading page styles…</p>}
          {warning && <p className="text-[11px] text-warning">{warning}</p>}
        </div>
      )}

      <iframe
        ref={iframeRef}
        title="Visual editor"
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-same-origin allow-forms"
        className="flex-1 w-full border-0"
        onLoad={handleIframeLoad}
      />
    </div>
  );
}

/* =========================================================
   MAIN APP — unchanged
   ========================================================= */

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [repoConfig, setRepoConfig] = useState<RepoConfig | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [editMode, setEditMode] = useState<'visual' | 'code'>('visual');
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
      setEditMode(isHtmlFile(file.path) ? 'visual' : 'code');
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

  const showModeToggle = !!openFile && isHtmlFile(openFile.path);

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

        <div className="flex-1 flex flex-col min-w-0">
          {showModeToggle && (
            <div className="h-9 flex items-center gap-1 px-3 border-b border-border bg-panelAlt shrink-0">
              <button
                onClick={() => setEditMode('visual')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  editMode === 'visual' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-panel'
                }`}
              >
                Visual
              </button>
              <button
                onClick={() => setEditMode('code')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  editMode === 'code' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-panel'
                }`}
              >
                Code
              </button>
            </div>
          )}

          {openFile && editMode === 'visual' && isHtmlFile(openFile.path) ? (
            <VisualEditor
              openFile={openFile}
              service={getGitHubService(token)}
              repoConfig={repoConfig}
              onContentChange={handleEditorChange}
            />
          ) : (
            <MonacoEditor openFile={openFile} onChange={handleEditorChange} />
          )}
        </div>

        <LivePreview openFile={openFile} service={getGitHubService(token)} repoConfig={repoConfig} />
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