import { useEffect, useMemo, useState } from 'react';
import type { OpenFile, RepoConfig } from '../types/config';
import type { GitHubService } from '../services/githubApi';

interface LivePreviewProps {
  openFile: OpenFile | null;
  service: GitHubService | null;
  repoConfig: RepoConfig | null;
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function isExternalPath(path: string): boolean {
  return /^(https?:|data:|blob:|mailto:|tel:|#)/i.test(path);
}

export function resolveRelativePath(baseDir: string, relativePath: string): string {
  if (isExternalPath(relativePath)) {
    return relativePath;
  }
  const cleanPath = relativePath.split('?')[0].split('#')[0];
  const parts = [...(baseDir ? baseDir.split('/') : []), ...cleanPath.split('/')];
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

export function isHtmlFile(path: string): boolean {
  return /\.html?$/i.test(path);
}

function isCssFile(path: string): boolean {
  return /\.css$/i.test(path);
}

function isJsFile(path: string): boolean {
  return /\.(js|jsx)$/i.test(path);
}

function decodeBase64(base64: string): string {
  const cleaned = base64.replace(/\n/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function extractStylesheets(html: string): string[] {
  const results: string[] = [];
  const linkRegex = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html))) {
    const tag = match[0];
    const relMatch = tag.match(/\brel\s*=\s*["']([^"']+)["']/i);
    const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (relMatch && hrefMatch && relMatch[1].toLowerCase().includes('stylesheet')) {
      results.push(hrefMatch[1]);
    }
  }
  return results;
}

function extractScripts(html: string): string[] {
  const results: string[] = [];
  const scriptRegex = /<script\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html))) {
    results.push(match[1]);
  }
  return results;
}

function replaceStylesheets(
  html: string,
  pagePath: string,
  assets: Record<string, string>,
  openFile: OpenFile | null
): string {
  const pageDir = dirname(pagePath);
  return html.replace(/<link\b[^>]*>/gi, (whole) => {
    const relMatch = whole.match(/\brel\s*=\s*["']([^"']+)["']/i);
    const hrefMatch = whole.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!relMatch || !hrefMatch || !relMatch[1].toLowerCase().includes('stylesheet')) return whole;
    const href = hrefMatch[1];
    if (isExternalPath(href)) return whole;
    const resolvedPath = resolveRelativePath(pageDir, href);
    if (openFile && openFile.path === resolvedPath && isCssFile(openFile.path)) {
      return `\n<style data-preview-path="${resolvedPath}">\n${openFile.currentContent}\n</style>`;
    }
    const content = assets[resolvedPath];
    if (content !== undefined) {
      return `\n<style data-preview-path="${resolvedPath}">\n${content}\n</style>`;
    }
    console.warn('Preview CSS not found:', href, '→', resolvedPath);
    return whole;
  });
}

function replaceScripts(
  html: string,
  pagePath: string,
  assets: Record<string, string>,
  openFile: OpenFile | null
): string {
  const pageDir = dirname(pagePath);
  return html.replace(/<script\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi, (whole, src: string) => {
    if (isExternalPath(src)) return whole;
    const resolvedPath = resolveRelativePath(pageDir, src);
    if (openFile && openFile.path === resolvedPath && isJsFile(openFile.path)) {
      return `\n<script data-preview-path="${resolvedPath}">\n${openFile.currentContent}\n</script>`;
    }
    const content = assets[resolvedPath];
    if (content !== undefined) {
      return `\n<script data-preview-path="${resolvedPath}">\n${content}\n</script>`;
    }
    console.warn('Preview JS not found:', src, '→', resolvedPath);
    return whole;
  });
}

function injectBaseTag(html: string, repoConfig: RepoConfig, pagePath: string): string {
  const pageDir = dirname(pagePath);
  const rawBase = `https://raw.githubusercontent.com/${repoConfig.owner}/${repoConfig.repo}/${repoConfig.branch}/${pageDir ? `${pageDir}/` : ''}`;
  const baseTag = `<base href="${rawBase}">`;
  let result = html.replace(/<base\b[^>]*>/gi, '');
  if (/<head[^>]*>/i.test(result)) {
    result = result.replace(/<head[^>]*>/i, (head) => `${head}\n${baseTag}`);
    return result;
  }
  return baseTag + result;
}

function injectPreviewProtection(html: string): string {
  const script = `
<script data-tpml-preview-protection>
document.addEventListener('click', function(event) {
  var target = event.target;
  if (!target) return;
  var anchor = target.closest ? target.closest('a') : null;
  if (anchor) event.preventDefault();
}, true);
</script>
`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${script}\n</body>`);
  }
  return html + script;
}

export async function loadPageDependencies(
  page: OpenFile,
  githubService: GitHubService,
  config: RepoConfig
): Promise<{ loaded: Record<string, string>; failedCount: number }> {
  const pageDir = dirname(page.path);
  const stylesheets = extractStylesheets(page.currentContent);
  const scripts = extractScripts(page.currentContent);
  const dependencies = [...stylesheets, ...scripts];
  const localDependencies = dependencies.filter((path) => !isExternalPath(path));
  const resolvedPaths = localDependencies.map((path) => resolveRelativePath(pageDir, path));
  const uniquePaths = Array.from(new Set(resolvedPaths));

  const loaded: Record<string, string> = {};
  let failedCount = 0;

  await Promise.all(
    uniquePaths.map(async (path) => {
      try {
        const file = await githubService.loadFile(config, path);
        loaded[path] = decodeBase64(file.content);
      } catch (loadError) {
        failedCount++;
        console.error('Preview failed to load:', path, loadError);
      }
    })
  );

  return { loaded, failedCount };
}
 function bustImageCache(html: string): string {
   const version = Date.now();

  return html.replace(
    /(<img\b[^>]*src=["'])([^"']+)(["'][^>]*>)/gi,
    (_, before, src, after) => {
      if (isExternalPath(src)) return before + src + after;

      const separator = src.includes("?") ? "&" : "?";
      return before + src + separator + "v=" + version + after;
    }
  );
}


export function buildPreviewHtml(
  html: string,
  pagePath: string,
  assets: Record<string, string>,
  openFile: OpenFile | null,
  repoConfig: RepoConfig
): string {
  let result = replaceStylesheets(
    html,
    pagePath,
    assets,
    openFile
  );

  result = replaceScripts(
    result,
    pagePath,
    assets,
    openFile
  );

  // Force browser to fetch a fresh image
  result = bustImageCache(result);

  result = injectBaseTag(
    result,
    repoConfig,
    pagePath
  );

  result = injectPreviewProtection(result);

  return result;
}

const VIEWPORT_WIDTHS = { desktop: null, tablet: 768, mobile: 390 } as const;
type ViewportMode = keyof typeof VIEWPORT_WIDTHS;

export default function LivePreview({ openFile, service, repoConfig }: LivePreviewProps) {
  const [previewPage, setPreviewPage] = useState<OpenFile | null>(null);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportMode>('desktop');

  useEffect(() => {
    if (!openFile) return;
    if (isHtmlFile(openFile.path)) {
      setPreviewPage(openFile);
    }
  }, [openFile]);

  useEffect(() => {
    if (!previewPage || !service || !repoConfig) {
      setAssets({});
      return;
    }
    const githubService = service;
    const config = repoConfig;
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const { loaded, failedCount } = await loadPageDependencies(previewPage as OpenFile, githubService, config);
        if (cancelled) return;
        setAssets(loaded);
        if (failedCount > 0) {
          setError(`${failedCount} preview dependency file(s) could not be loaded. Check the browser console.`);
        }
      } catch (loadError) {
        console.error('Preview dependency error:', loadError);
        if (!cancelled) setError('Could not load page dependencies.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [previewPage?.path, service, repoConfig]);

  const srcDoc = useMemo(() => {
    if (!previewPage || !repoConfig) return '';
    const html = openFile?.path === previewPage.path ? openFile.currentContent : previewPage.currentContent;
    return buildPreviewHtml(html, previewPage.path, assets, openFile, repoConfig);
  }, [previewPage, assets, openFile, repoConfig]);

  function refreshPreview() {
    if (!previewPage) return;
    setPreviewPage({ ...previewPage });
  }

  function openInNewTab() {
    if (!srcDoc) return;
    const blob = new Blob([srcDoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <div className="w-full h-full shrink-0 border-l border-border flex flex-col bg-white">
      <div className="h-9 flex items-center justify-between px-3 border-b border-border bg-panelAlt shrink-0">
        <div className="min-w-0 flex items-center">
          <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">Live Preview</span>
          {previewPage && (
            <span className="ml-2 text-[10px] text-text-secondary truncate" title={previewPage.path}>
              {previewPage.path}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {(Object.keys(VIEWPORT_WIDTHS) as ViewportMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewport(mode)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-colors ${
                viewport === mode ? 'bg-accent text-white' : 'text-text-secondary hover:bg-panel'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={refreshPreview}
            disabled={!previewPage}
            title="Refresh preview"
            className="text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={openInNewTab}
            disabled={!srcDoc || loading}
            title={loading ? 'Waiting for dependencies…' : 'Open preview in new tab'}
            className="text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Open ↗
          </button>
        </div>
      </div>

      {loading && (
        <div className="px-3 py-1.5 border-b border-border bg-panelAlt">
          <p className="text-[10px] text-text-muted">Loading page CSS and JavaScript…</p>
        </div>
      )}

      {error && (
        <div className="px-3 py-1.5 border-b border-border bg-panelAlt">
          <p className="text-[10px] text-warning">{error}</p>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto bg-gray-100 flex justify-center">
        {!previewPage ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400 bg-canvas px-6 text-center">
            Open an HTML file such as Home.html to start the live preview.
          </div>
        ) : (
          <div
            style={
              VIEWPORT_WIDTHS[viewport]
                ? { width: VIEWPORT_WIDTHS[viewport]!, minWidth: VIEWPORT_WIDTHS[viewport]!, height: '100%' }
                : { width: '100%', height: '100%' }
            }
            className="bg-white shadow-sm"
          >
            <iframe
              title="Website live preview"
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-same-origin allow-forms"
              className="w-full h-full border-0 bg-white"
            />
          </div>
        )}
      </div>
    </div>
  );
}