import { useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import MonacoEditor from './components/MonacoEditor';
import {
  loadPageDependencies,
  buildPreviewHtml,
  isHtmlFile
} from './components/LivePreview';
import CommitDialog from './components/CommitDialog';
import UploadDialog from './components/UploadDialog';
import StatusPanel from './components/StatusPanel';
import EmployeeLogin, { decodeGoogleCredential, isAllowedEmail } from './components/EmployeeLogin';
import { REPO_ACCESS } from './accessMap';
import { googleLogout } from '@react-oauth/google';
import { getGitHubService, resetGitHubService } from './services/githubApi';
import type { GitHubService } from './services/githubApi';
import { getToken, saveToken, getRepoConfig, saveRepoConfig, clearAll } from './utils/tokenStorage';
import { getLanguageFromPath } from './utils/fileHelpers';
import { base64ToUtf8 } from './utils/base64';
import type { GitHubUser, RepoConfig, OpenFile, StatusMessage, GitHubApiError } from './types/config';

interface HistoryEntry {
  sha: string;
  message: string;
  author: string;
  date: string;
}

function makeStatus(kind: StatusMessage['kind'], text: string): StatusMessage {
  return { kind, text, timestamp: Date.now() };
}

/** Resolves an <img> src (relative, absolute, or protocol-relative) against
 *  the path of the HTML file that references it, into a repo-relative path
 *  suitable for GitHub's Contents API. */
function resolveRelativePath(htmlFile: string, imageSrc: string): string {
  let src = imageSrc
    .replace(/^https?:\/\/[^/]+\//, '')
    .split('?')[0]
    .split('#')[0];

  if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('//')) {
    return src;
  }

  const htmlDir = htmlFile.includes('/') ? htmlFile.substring(0, htmlFile.lastIndexOf('/')) : '';
  const stack = htmlDir ? htmlDir.split('/') : [];

  src.split('/').forEach((part) => {
    if (part === '.' || part === '') return;
    if (part === '..') stack.pop();
    else stack.push(part);
  });

  return decodeURIComponent(stack.join('/'));
}

/* =========================================================
   VISUAL EDITOR
   ========================================================= */

const BLOCKED_TAGS = [
  'html', 'head', 'body',
  'div', 'section', 'main', 'header', 'footer', 'nav', 'article', 'aside',
  'ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'form', 'fieldset',
  'script', 'style', 'link', 'meta', 'base', 'noscript', 'template',
  'svg', 'path', 'iframe', 'video', 'audio', 'object', 'embed', 'canvas',
  'source', 'track', 'br', 'hr', 'img', 'input', 'select', 'option', 'textarea',
];

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
    if (name === 'br') continue;
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
  onImageClick: (src: string, alt: string) => void;
}

function VisualEditor({ openFile, service, repoConfig, onContentChange, onImageClick }: VisualEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const baselineRef = useRef(openFile.currentContent);
  const rangesRef = useRef<EditableRange[]>([]);

  const [history, setHistory] = useState<{ past: string[]; present: string; future: string[] }>({
    past: [],
    present: openFile.currentContent,
    future: [],
  });

  useEffect(() => {
    setHistory({ past: [], present: openFile.currentContent, future: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFile.path]);

  function pushHistory(next: string) {
    setHistory((h) => {
      if (next === h.present) return h;
      return { past: [...h.past, h.present], present: next, future: [] };
    });
  }

  function undo() {
    setHistory((h) => {
      if (h.past.length === 0) return h;
      const previous = h.past[h.past.length - 1];
      onContentChange(previous);
      return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
    });
  }

  function redo() {
    setHistory((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0];
      onContentChange(next);
      return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
    });
  }

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
    pushHistory(updated);

    if (el.innerHTML !== sanitized) el.innerHTML = sanitized;
  }

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
        el.title = "This part can't be edited visually — use Code mode.";
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

    const images = Array.from(doc.querySelectorAll('img'));
    images.forEach((img) => {
      img.style.cursor = 'pointer';
      img.addEventListener('mouseenter', () => (img.style.outline = '2px dashed #5b8def'));
      img.addEventListener('mouseleave', () => (img.style.outline = 'none'));
      img.addEventListener('click', (e) => {
        e.preventDefault();
        const originalSrc = img.getAttribute('src') || img.getAttribute('data-src') || '';
        onImageClick(originalSrc, img.getAttribute('alt') ?? '');
      });
    });
  }

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    function handleKeyDown(e: KeyboardEvent) {
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      if (!ctrlOrCmd) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    }
    doc.addEventListener('keydown', handleKeyDown);
    return () => doc.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  function handleLink() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || doc.getSelection()?.isCollapsed !== false) {
      setWarning('Select some text first, then click Link.');
      return;
    }
    const url = window.prompt('Link URL:', 'https://');
    if (url) doc.execCommand('createLink', false, url);
  }

  function exec(command: string) {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.execCommand(command, false);
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
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={undo}
          disabled={history.past.length === 0}
          title="Undo (Ctrl+Z)"
          className="px-2.5 py-1 rounded text-xs font-medium text-text-secondary hover:bg-panel hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Undo
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={redo}
          disabled={history.future.length === 0}
          title="Redo (Ctrl+Y)"
          className="px-2.5 py-1 rounded text-xs font-medium text-text-secondary hover:bg-panel hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Redo
        </button>
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
   MAIN APP
   ========================================================= */

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [repoConfig, setRepoConfig] = useState<RepoConfig | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
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

  // Restores an existing Google session on refresh by re-checking the
  // stored credential's expiry AND re-running the domain check — never
  // trusting a plain boolean flag as proof of anything.
  const [authorizedEmail, setAuthorizedEmail] = useState<string | null>(() => {
    const stored = sessionStorage.getItem('tpml_google_credential');
    if (!stored) return null;
    const payload = decodeGoogleCredential(stored);
    if (!payload) return null;
    const notExpired = payload.exp * 1000 > Date.now();
    if (notExpired && payload.email_verified && isAllowedEmail(payload.email)) {
      return payload.email;
    }
    sessionStorage.removeItem('tpml_google_credential');
    return null;
  });

  // Guards against re-triggering auto-connect on every re-render — only
  // ever attempted once per signed-in email.
  const autoConnectAttemptedRef = useRef<string | null>(null);

  function handleGoogleSignOut() {
    googleLogout();
    sessionStorage.removeItem('tpml_google_credential');
    setAuthorizedEmail(null);
    autoConnectAttemptedRef.current = null;
    // GitHub's own token/repo config is deliberately left untouched here —
    // signing out of Google doesn't need to force re-entering a GitHub PAT.
  }

  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [showImagePanel, setShowImagePanel] = useState(false);
  const [imageEditTarget, setImageEditTarget] = useState<{ src: string; alt: string } | null>(null);
  const [isReplacingImage, setIsReplacingImage] = useState(false);

  useEffect(() => {
    const savedToken = getToken();
    const savedConfig = getRepoConfig();
    if (savedToken && savedConfig) {
      void reconnect(savedToken, savedConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reconnect(savedToken: string, config: RepoConfig) {
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
    }
  }

  async function handleConnect(newToken: string, owner: string, repo: string, branch: string) {
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
      throw err; // re-thrown so the auto-connect effect below can react to failure
    }
  }

  // Auto-connect: once an authorized Google account is known, connect
  // automatically using the one shared REPO_ACCESS config — runs exactly
  // once per sign-in, in an effect (not during render), so it can't loop
  // or fire repeatedly.
  useEffect(() => {
    if (!authorizedEmail || token || repoConfig || user) return;
    if (!REPO_ACCESS) return;
    if (autoConnectAttemptedRef.current === authorizedEmail) return;
    autoConnectAttemptedRef.current = authorizedEmail;
    void handleConnect(REPO_ACCESS.token, REPO_ACCESS.owner, REPO_ACCESS.repo, REPO_ACCESS.branch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizedEmail, token, repoConfig, user]);

  const hasUnsavedChanges = !!openFile && openFile.currentContent !== openFile.originalContent;

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  function handleDisconnect() {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(
        `You have unsaved changes in ${openFile?.path}. Disconnect anyway and lose them?`
      );
      if (!confirmed) return;
    }
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
    setStatus(makeStatus('saving', `Saving ${openFile.path}…`));
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
      setStatus(makeStatus('commit-created', 'Changes saved successfully.'));
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
      setStatus(makeStatus('commit-created', `${path} uploaded and saved.`));
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

  async function handleViewHistory() {
    if (!token || !repoConfig || !openFile) return;
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const service = getGitHubService(token);
      const entries = await service.getCommitHistory(repoConfig, openFile.path);
      setHistoryEntries(entries);
    } catch (err) {
      const apiErr = err as GitHubApiError;
      setStatus(makeStatus(apiErr.kind, apiErr.message));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handlePreviewClick() {
    if (!token || !repoConfig || !openFile) return;
    if (!isHtmlFile(openFile.path)) {
      setStatus(makeStatus('error', 'Preview is only available for HTML pages.'));
      return;
    }
    setIsPreviewLoading(true);
    setStatus(makeStatus('loading-file', 'Building preview…'));
    try {
      const service = getGitHubService(token);
      const { loaded } = await loadPageDependencies(openFile, service, repoConfig);
      const srcDoc = buildPreviewHtml(openFile.currentContent, openFile.path, loaded, openFile, repoConfig);
      const blob = new Blob([srcDoc], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      setStatus(makeStatus('idle', 'Preview opened in a new tab.'));
    } catch (err) {
      const apiErr = err as GitHubApiError;
      setStatus(makeStatus(apiErr.kind, apiErr.message));
    } finally {
      setIsPreviewLoading(false);
    }
  }

  function handleAltTextSave(newAlt: string) {
    if (!openFile || !imageEditTarget) return;
    const escapedSrc = imageEditTarget.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const imgTagRe = new RegExp(`(<img[^>]*src=["']${escapedSrc}["'][^>]*?)(\\s+alt=["'][^"']*["'])?([^>]*>)`, 'i');
    const updated = openFile.currentContent.replace(imgTagRe, (_whole, before, _oldAlt, after) => {
      const safeAlt = newAlt.replace(/"/g, '&quot;');
      return `${before} alt="${safeAlt}"${after}`;
    });
    handleEditorChange(updated);
    setImageEditTarget((t) => (t ? { ...t, alt: newAlt } : t));
  }

  async function handleReplaceImage(file: File) {
    if (!token || !repoConfig || !openFile || !imageEditTarget) return;
    const confirmed = window.confirm(
      `Replace the image at "${imageEditTarget.src}" with "${file.name}"? This immediately saves to GitHub — it does not wait for Save Changes.`
    );
    if (!confirmed) return;

    setIsReplacingImage(true);
    setStatus(makeStatus('saving', `Replacing ${imageEditTarget.src}…`));
    try {
      const reader = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          const comma = result.indexOf(',');
          resolve(comma === -1 ? result : result.slice(comma + 1));
        };
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsDataURL(file);
      });

      const service = getGitHubService(token);
      const resolvedPath = resolveRelativePath(openFile.path, imageEditTarget.src);
      await service.replaceBinaryFile(repoConfig, resolvedPath, base64, `Replace image ${resolvedPath}`);
      setStatus(makeStatus('commit-created', `${resolvedPath} replaced and saved.`));
      setShowImagePanel(false);
      setExplorerRefreshKey((k) => k + 1);
    } catch (err) {
      const apiErr = err as GitHubApiError;
      setStatus(makeStatus(apiErr.kind, apiErr.message));
    } finally {
      setIsReplacingImage(false);
    }
  }

  if (!authorizedEmail) {
    return (
      <EmployeeLogin
        onAuthorized={(email, credential) => {
          sessionStorage.setItem('tpml_google_credential', credential);
          setAuthorizedEmail(email);
        }}
      />
    );
  }

  // Auto-connect gate: an authorized Google account connects automatically
  // using the one shared REPO_ACCESS config. The actual connect attempt is
  // triggered from the useEffect above — this block only renders status.
  if (!token || !repoConfig || !user) {
    if (!REPO_ACCESS) {
      return (
        <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4 text-center">
          <p className="text-sm text-text-primary mb-2">GitHub access isn't configured for this app yet.</p>
          <p className="text-xs text-text-secondary mb-4">{authorizedEmail}</p>
          <p className="text-xs text-text-muted mb-4">Ask IT to set up VITE_REPO_ACCESS.</p>
          <button onClick={handleGoogleSignOut} className="text-xs text-accent underline">
            Sign out
          </button>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4 text-center">
        <p className="text-sm text-text-secondary mb-3">{connectError ?? 'Connecting…'}</p>
        {connectError && (
          <button onClick={handleGoogleSignOut} className="text-xs text-accent underline">
            Sign out
          </button>
        )}
      </div>
    );
  }

  const showModeToggle = !!openFile && isHtmlFile(openFile.path);

  return (
    <div className="h-screen flex flex-col bg-canvas">
      <div className="flex justify-between items-center px-4 py-1 text-[11px] text-text-secondary bg-panelAlt border-b border-border shrink-0">
        <span>Signed in as <span className="text-text-primary">{authorizedEmail}</span></span>
        <button onClick={handleGoogleSignOut} className="text-text-muted hover:text-text-primary underline">
          Sign out
        </button>
      </div>
      <Header
        user={user}
        repoConfig={repoConfig}
        hasUnsavedChanges={hasUnsavedChanges}
        onCommitClick={() => setShowCommitDialog(true)}
        onUploadClick={() => {
          setUploadError(null);
          setShowUploadDialog(true);
        }}
        onHistoryClick={() => void handleViewHistory()}
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
            <div className="h-9 flex items-center justify-between px-3 border-b border-border bg-panelAlt shrink-0">
              <div className="flex items-center gap-1">
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

              <button
                onClick={() => void handlePreviewClick()}
                disabled={isPreviewLoading}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium text-text-secondary hover:bg-panel disabled:opacity-50 transition-colors"
              >
                {isPreviewLoading ? 'Opening…' : 'Preview ↗'}
              </button>
            </div>
          )}

          {openFile && editMode === 'visual' && isHtmlFile(openFile.path) ? (
            <VisualEditor
              openFile={openFile}
              service={getGitHubService(token)}
              repoConfig={repoConfig}
              onContentChange={handleEditorChange}
              onImageClick={(src, alt) => {
                setImageEditTarget({ src, alt });
                setShowImagePanel(true);
              }}
            />
          ) : (
            <MonacoEditor openFile={openFile} onChange={handleEditorChange} />
          )}
        </div>
      </div>

      <StatusPanel status={status} />

      {showCommitDialog && openFile && (
        <CommitDialog
          filePath={openFile.path}
          isSaving={isSaving}
          originalContent={openFile.originalContent}
          currentContent={openFile.currentContent}
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

      {showHistory && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowHistory(false)}>
          <div className="w-[480px] max-h-[70vh] bg-panel border border-border rounded-lg shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">Version history</h2>
              <p className="text-xs text-text-secondary mt-1 font-mono truncate">{openFile?.path}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {historyLoading && <p className="text-xs text-text-muted">Loading…</p>}
              {!historyLoading && historyEntries.length === 0 && (
                <p className="text-xs text-text-muted">No history found for this file.</p>
              )}
              {historyEntries.map((entry) => (
                <div key={entry.sha} className="border border-border rounded-md p-3">
                  <p className="text-sm text-text-primary">{entry.message}</p>
                  <p className="text-[11px] text-text-muted mt-1">
                    {entry.author} · {new Date(entry.date).toLocaleString()} · <span className="font-mono">{entry.sha}</span>
                  </p>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end">
              <button
                onClick={() => setShowHistory(false)}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:bg-panelAlt transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showImagePanel && imageEditTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowImagePanel(false)}>
          <div className="w-[420px] bg-panel border border-border rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">Edit image</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <img
                src={imageEditTarget.src}
                alt={imageEditTarget.alt}
                className="max-h-40 rounded border border-border object-contain bg-canvas w-full"
              />
              <p className="text-[11px] text-text-muted font-mono break-all">{imageEditTarget.src}</p>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Alt text</label>
                <input
                  value={imageEditTarget.alt}
                  onChange={(e) => setImageEditTarget((t) => (t ? { ...t, alt: e.target.value } : t))}
                  onBlur={(e) => handleAltTextSave(e.target.value)}
                  className="w-full rounded-md bg-canvas border border-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Replace image</label>
                <input
                  type="file"
                  accept="image/*"
                  disabled={isReplacingImage}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleReplaceImage(file);
                  }}
                  className="w-full text-xs text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-accent file:text-white hover:file:bg-accent-hover file:cursor-pointer"
                />
                {isReplacingImage && <p className="text-[11px] text-text-muted mt-1">Replacing…</p>}
              </div>
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end">
              <button
                onClick={() => setShowImagePanel(false)}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:bg-panelAlt transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}