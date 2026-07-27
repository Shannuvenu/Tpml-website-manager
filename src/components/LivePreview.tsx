import { useEffect, useMemo, useState } from 'react';
import type { OpenFile, RepoConfig } from '../types/config';
import type { GitHubService } from '../services/githubApi';

interface LivePreviewProps {
  openFile: OpenFile | null;
  service: GitHubService | null;
  repoConfig: RepoConfig | null;
}

/* =========================================================
   PATH HELPERS
   ========================================================= */

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function isExternalPath(path: string): boolean {
  return /^(https?:|data:|blob:|mailto:|tel:|#)/i.test(path);
}

/**
 * Example:
 *
 * baseDir = ""
 * relative = "./Content/css/home.css"
 *
 * result:
 * Content/css/home.css
 *
 *
 * baseDir = "pages"
 * relative = "../Content/css/home.css"
 *
 * result:
 * Content/css/home.css
 */
function resolveRelativePath(
  baseDir: string,
  relativePath: string
): string {
  if (isExternalPath(relativePath)) {
    return relativePath;
  }

  const cleanPath = relativePath
    .split('?')[0]
    .split('#')[0];

  const parts = [
    ...(baseDir ? baseDir.split('/') : []),
    ...cleanPath.split('/'),
  ];

  const stack: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      stack.pop();
    } else {
      stack.push(part);
    }
  }

  return stack.join('/');
}

/* =========================================================
   FILE TYPE HELPERS
   ========================================================= */

function isHtmlFile(path: string): boolean {
  return /\.html?$/i.test(path);
}

function isCssFile(path: string): boolean {
  return /\.css$/i.test(path);
}

function isJsFile(path: string): boolean {
  return /\.(js|jsx)$/i.test(path);
}

/* =========================================================
   BASE64 DECODER
   ========================================================= */

function decodeBase64(base64: string): string {
  const cleaned = base64.replace(/\n/g, '');

  const binary = atob(cleaned);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
}

/* =========================================================
   EXTRACT CSS FILES FROM HTML

   Supports BOTH:

   <link rel="stylesheet" href="x.css">

   AND

   <link href="x.css" rel="stylesheet">

   ========================================================= */

function extractStylesheets(html: string): string[] {
  const results: string[] = [];

  const linkRegex = /<link\b[^>]*>/gi;

  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html))) {
    const tag = match[0];

    const relMatch = tag.match(
      /\brel\s*=\s*["']([^"']+)["']/i
    );

    const hrefMatch = tag.match(
      /\bhref\s*=\s*["']([^"']+)["']/i
    );

    if (
      relMatch &&
      hrefMatch &&
      relMatch[1]
        .toLowerCase()
        .includes('stylesheet')
    ) {
      results.push(hrefMatch[1]);
    }
  }

  return results;
}

/* =========================================================
   EXTRACT JS FILES FROM HTML
   ========================================================= */

function extractScripts(html: string): string[] {
  const results: string[] = [];

  const scriptRegex =
    /<script\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi;

  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html))) {
    results.push(match[1]);
  }

  return results;
}

/* =========================================================
   REPLACE CSS <link> WITH <style>

   Instead of:

   <link href="./Content/css/home.css">

   we fetch home.css using GitHub API and produce:

   <style>
      ...CSS...
   </style>

   ========================================================= */

function replaceStylesheets(
  html: string,
  pagePath: string,
  assets: Record<string, string>,
  openFile: OpenFile | null
): string {
  const pageDir = dirname(pagePath);

  return html.replace(
    /<link\b[^>]*>/gi,

    (whole) => {
      const relMatch = whole.match(
        /\brel\s*=\s*["']([^"']+)["']/i
      );

      const hrefMatch = whole.match(
        /\bhref\s*=\s*["']([^"']+)["']/i
      );

      /*
       * Not a stylesheet.
       *
       * Example:
       *
       * <link rel="icon" href="favicon.ico">
       */
      if (
        !relMatch ||
        !hrefMatch ||
        !relMatch[1]
          .toLowerCase()
          .includes('stylesheet')
      ) {
        return whole;
      }

      const href = hrefMatch[1];

      /*
       * External CSS such as:
       *
       * https://fonts.googleapis.com/...
       *
       * Leave it untouched.
       */
      if (isExternalPath(href)) {
        return whole;
      }

      const resolvedPath =
        resolveRelativePath(pageDir, href);

      /*
       * If this CSS file is currently open
       * in Monaco, use the edited content.
       *
       * This gives us LIVE preview before
       * committing to GitHub.
       */
      if (
        openFile &&
        openFile.path === resolvedPath &&
        isCssFile(openFile.path)
      ) {
        return `
<style data-preview-path="${resolvedPath}">
${openFile.currentContent}
</style>`;
      }

      /*
       * Otherwise use the version fetched
       * from GitHub.
       */
      const content = assets[resolvedPath];

      if (content !== undefined) {
        return `
<style data-preview-path="${resolvedPath}">
${content}
</style>`;
      }

      console.warn(
        'Preview CSS not found:',
        href,
        '→',
        resolvedPath
      );

      return whole;
    }
  );
}

/* =========================================================
   REPLACE LOCAL JS <script src=""> WITH INLINE JS
   ========================================================= */

function replaceScripts(
  html: string,
  pagePath: string,
  assets: Record<string, string>,
  openFile: OpenFile | null
): string {
  const pageDir = dirname(pagePath);

  return html.replace(
    /<script\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,

    (
      whole,
      src: string
    ) => {
      /*
       * CDN scripts remain untouched.
       *
       * Example:
       *
       * https://code.jquery.com/jquery...
       */
      if (isExternalPath(src)) {
        return whole;
      }

      const resolvedPath =
        resolveRelativePath(pageDir, src);

      /*
       * If user is editing this JS file,
       * use Monaco content.
       */
      if (
        openFile &&
        openFile.path === resolvedPath &&
        isJsFile(openFile.path)
      ) {
        return `
<script data-preview-path="${resolvedPath}">
${openFile.currentContent}
</script>`;
      }

      /*
       * Otherwise use GitHub version.
       */
      const content = assets[resolvedPath];

      if (content !== undefined) {
        return `
<script data-preview-path="${resolvedPath}">
${content}
</script>`;
      }

      console.warn(
        'Preview JS not found:',
        src,
        '→',
        resolvedPath
      );

      return whole;
    }
  );
}

/* =========================================================
   BASE TAG

   This helps paths such as:

   ./Content/images/logo.png

   resolve against the GitHub repository.
   ========================================================= */

function injectBaseTag(
  html: string,
  repoConfig: RepoConfig,
  pagePath: string
): string {
  const pageDir = dirname(pagePath);

  const rawBase =
    `https://raw.githubusercontent.com/` +
    `${repoConfig.owner}/` +
    `${repoConfig.repo}/` +
    `${repoConfig.branch}/` +
    `${pageDir ? `${pageDir}/` : ''}`;

  const baseTag =
    `<base href="${rawBase}">`;

  /*
   * Remove an existing base tag if the
   * original HTML already has one.
   */
  let result = html.replace(
    /<base\b[^>]*>/gi,
    ''
  );

  if (/<head[^>]*>/i.test(result)) {
    result = result.replace(
      /<head[^>]*>/i,
      (head) =>
        `${head}\n${baseTag}`
    );

    return result;
  }

  return baseTag + result;
}

/* =========================================================
   PREVENT NAVIGATION

   We don't want clicking:

   Careers
   Contact
   Brands

   to leave our preview iframe.

   ========================================================= */

function injectPreviewProtection(
  html: string
): string {
  const script = `
<script data-tpml-preview-protection>
document.addEventListener(
  'click',
  function(event) {
    var target = event.target;

    if (!target) {
      return;
    }

    var anchor = target.closest
      ? target.closest('a')
      : null;

    if (anchor) {
      event.preventDefault();
    }
  },
  true
);
</script>
`;

  if (/<\/body>/i.test(html)) {
    return html.replace(
      /<\/body>/i,
      `${script}\n</body>`
    );
  }

  return html + script;
}

/* =========================================================
   LIVE PREVIEW COMPONENT
   ========================================================= */

export default function LivePreview({
  openFile,
  service,
  repoConfig,
}: LivePreviewProps) {

  /*
   * IMPORTANT:
   *
   * previewPage and openFile are different.
   *
   * Example:
   *
   * previewPage = Home.html
   *
   * openFile =
   * Content/css/home.css
   *
   * Monaco edits home.css,
   * but preview remains Home.html.
   */
  const [
    previewPage,
    setPreviewPage,
  ] = useState<OpenFile | null>(null);

  /*
   * Contains CSS + JS loaded from GitHub.
   *
   * Example:
   *
   * {
   *   "Content/css/bootstrap.css": "...",
   *   "Content/css/home.css": "...",
   *   "Scripts/js/main.js": "..."
   * }
   */
  const [
    assets,
    setAssets,
  ] = useState<Record<string, string>>({});

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<string | null>(null);

  /* =======================================================
     WHEN HTML FILE IS OPENED
     ======================================================= */

  useEffect(() => {
    if (!openFile) {
      return;
    }

    /*
     * Opening HTML changes the page being
     * previewed.
     *
     * Opening CSS/JS does NOT.
     */
    if (isHtmlFile(openFile.path)) {
      setPreviewPage(openFile);
    }

  }, [openFile]);

  /* =======================================================
     LOAD PAGE DEPENDENCIES
     ======================================================= */

  useEffect(() => {

    if (
      !previewPage ||
      !service ||
      !repoConfig
    ) {
      setAssets({});
      return;
    }
    const githubService = service;
    const config = repoConfig;
    let cancelled = false;

    async function loadDependencies() {

      setLoading(true);
      setError(null);

      try {

        const page =
          previewPage as OpenFile;

        const pageDir =
          dirname(page.path);

        /*
         * Find:
         *
         * bootstrap.css
         * styles.css
         * home.css
         * jquery.js
         * main.js
         * etc.
         */
        const stylesheets =
          extractStylesheets(
            page.currentContent
          );

        const scripts =
          extractScripts(
            page.currentContent
          );

        console.log(
          'Preview stylesheets:',
          stylesheets
        );

        console.log(
          'Preview scripts:',
          scripts
        );

        /*
         * Combine CSS + JS.
         */
        const dependencies = [
          ...stylesheets,
          ...scripts,
        ];

        /*
         * Don't fetch CDN resources through
         * GitHub API.
         */
        const localDependencies =
          dependencies.filter(
            (path) =>
              !isExternalPath(path)
          );

        /*
         * Convert:
         *
         * ./Content/css/home.css
         *
         * into:
         *
         * Content/css/home.css
         */
        const resolvedPaths =
          localDependencies.map(
            (path) =>
              resolveRelativePath(
                pageDir,
                path
              )
          );

        /*
         * Remove duplicates.
         */
        const uniquePaths =
          Array.from(
            new Set(resolvedPaths)
          );

        console.log(
          'Preview resolved dependencies:',
          uniquePaths
        );

        const loaded:
          Record<string, string> = {};

        let failedCount = 0;

        /*
         * Fetch CSS + JS through the
         * existing GitHubService.
         */
        await Promise.all(
          uniquePaths.map(
            async (path) => {

              try {

                const file =
  await githubService.loadFile(
    config,
    path
  );

                loaded[path] =
                  decodeBase64(
                    file.content
                  );

                console.log(
                  'Preview loaded:',
                  path
                );

              } catch (loadError) {

                failedCount++;

                console.error(
                  'Preview failed to load:',
                  path,
                  loadError
                );

              }
            }
          )
        );

        if (cancelled) {
          return;
        }

        setAssets(loaded);

        if (failedCount > 0) {
          setError(
            `${failedCount} preview dependency file(s) could not be loaded. Check the browser console.`
          );
        }

      } catch (loadError) {

        console.error(
          'Preview dependency error:',
          loadError
        );

        if (!cancelled) {
          setError(
            'Could not load page dependencies.'
          );
        }

      } finally {

        if (!cancelled) {
          setLoading(false);
        }

      }
    }

    void loadDependencies();

    return () => {
      cancelled = true;
    };

  }, [
    previewPage?.path,
    service,
    repoConfig,
  ]);

  /* =======================================================
     BUILD FINAL PREVIEW HTML
     ======================================================= */

  const srcDoc = useMemo(() => {

    if (
      !previewPage ||
      !repoConfig
    ) {
      return '';
    }

    /*
     * If user is editing Home.html itself,
     * use Monaco's latest content.
     *
     * Otherwise use the remembered
     * Home.html.
     */
    let html =
      openFile?.path ===
      previewPage.path

        ? openFile.currentContent

        : previewPage.currentContent;

    /*
     * Replace local CSS files with
     * fetched/in-memory CSS.
     */
    html =
      replaceStylesheets(
        html,
        previewPage.path,
        assets,
        openFile
      );

    /*
     * Replace local JS files with
     * fetched/in-memory JS.
     */
    html =
      replaceScripts(
        html,
        previewPage.path,
        assets,
        openFile
      );

    /*
     * Helps remaining relative assets
     * such as:
     *
     * images
     * favicon
     * etc.
     */
    html =
      injectBaseTag(
        html,
        repoConfig,
        previewPage.path
      );

    /*
     * Stop navigation away from preview.
     */
    html =
      injectPreviewProtection(
        html
      );

    return html;

  }, [
    previewPage,
    assets,
    openFile,
    repoConfig,
  ]);

  /* =======================================================
     REFRESH
     ======================================================= */

  function refreshPreview() {

    if (!previewPage) {
      return;
    }

    /*
     * New object reference forces preview
     * state update.
     */
    setPreviewPage({
      ...previewPage,
    });
  }

  /* =======================================================
     OPEN PREVIEW IN NEW TAB
     ======================================================= */

  function openInNewTab() {

    if (!srcDoc) {
      return;
    }

    const blob =
      new Blob(
        [srcDoc],
        {
          type: 'text/html',
        }
      );

    const url =
      URL.createObjectURL(blob);

    window.open(
      url,
      '_blank',
      'noopener,noreferrer'
    );

    window.setTimeout(
      () => {
        URL.revokeObjectURL(url);
      },
      10000
    );
  }

  /* =======================================================
     UI
     ======================================================= */

  return (
    <div className="w-[420px] shrink-0 border-l border-border flex flex-col bg-white">

      {/* HEADER */}

      <div className="h-9 flex items-center justify-between px-3 border-b border-border bg-panelAlt shrink-0">

        <div className="min-w-0 flex items-center">

          <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
            Live Preview
          </span>

          {previewPage && (

            <span
              className="ml-2 text-[10px] text-text-secondary truncate"
              title={previewPage.path}
            >
              {previewPage.path}
            </span>

          )}

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
            disabled={
              !srcDoc ||
              loading
            }
            title={
              loading
                ? 'Waiting for dependencies…'
                : 'Open preview in new tab'
            }
            className="text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Open ↗
          </button>

        </div>

      </div>

      {/* LOADING */}

      {loading && (

        <div className="px-3 py-1.5 border-b border-border bg-panelAlt">

          <p className="text-[10px] text-text-muted">
            Loading page CSS and JavaScript…
          </p>

        </div>

      )}

      {/* ERROR */}

      {error && (

        <div className="px-3 py-1.5 border-b border-border bg-panelAlt">

          <p className="text-[10px] text-warning">
            {error}
          </p>

        </div>

      )}

      {/* PREVIEW AREA */}

      <div className="flex-1 min-h-0">

        {!previewPage ? (

          <div className="h-full flex items-center justify-center text-xs text-gray-400 bg-canvas px-6 text-center">

            Open an HTML file such as Home.html to start the live preview.

          </div>

        ) : (

          <iframe
            title="Website live preview"
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-same-origin allow-forms"
            className="w-full h-full border-0 bg-white"
          />

        )}

      </div>

    </div>
  );
}