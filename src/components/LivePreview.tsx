import { useMemo } from 'react';
import type { OpenFile } from '../types/config';
import { isPreviewable } from '../utils/fileHelpers';

interface LivePreviewProps {
  openFile: OpenFile | null;
}

/**
 * Builds the srcDoc for the preview iframe. A file is edited in isolation —
 * there's no bundler here — so only the file's own kind is rendered:
 *   - .html  → rendered as-is, the real thing
 *   - .css   → applied to a small set of sample elements so you can see
 *              typography/spacing/color changes without a linked page
 *   - .js/.jsx → executed against a blank page, console output is
 *              captured and shown, since there's nothing else to render
 */
function buildSrcDoc(openFile: OpenFile): string {
  const ext = openFile.path.split('.').pop()?.toLowerCase();

  if (ext === 'html' || ext === 'htm') {
    return openFile.currentContent;
  }

  if (ext === 'css') {
    return `<!doctype html>
<html>
  <head><style>${openFile.currentContent}</style></head>
  <body>
    <div class="preview-sample">
      <h1>Heading one</h1>
      <p>This is a paragraph of sample body text so you can see typography, color, and spacing changes from the stylesheet you're editing.</p>
      <button>Sample button</button>
      <a href="#">Sample link</a>
    </div>
  </body>
</html>`;
  }

  if (ext === 'js' || ext === 'jsx') {
    return `<!doctype html>
<html>
  <head>
    <style>
      body { font-family: ui-monospace, monospace; font-size: 12px; padding: 12px; background: #0d1117; color: #e6edf3; }
      .log { padding: 4px 0; border-bottom: 1px solid #232a34; white-space: pre-wrap; }
      .err { color: #f85149; }
    </style>
  </head>
  <body>
    <div id="out"></div>
    <script>
      const out = document.getElementById('out');
      function render(kind, args) {
        const line = document.createElement('div');
        line.className = 'log' + (kind === 'error' ? ' err' : '');
        line.textContent = Array.from(args).map(a => {
          try { return typeof a === 'string' ? a : JSON.stringify(a); }
          catch { return String(a); }
        }).join(' ');
        out.appendChild(line);
      }
      console.log = (...a) => render('log', a);
      console.error = (...a) => render('error', a);
      window.onerror = (msg) => render('error', [String(msg)]);
      try {
        ${openFile.currentContent}
      } catch (e) {
        render('error', [e && e.message ? e.message : String(e)]);
      }
    </script>
  </body>
</html>`;
  }

  return '';
}

export default function LivePreview({ openFile }: LivePreviewProps) {
  const srcDoc = useMemo(() => (openFile ? buildSrcDoc(openFile) : ''), [openFile]);

  return (
    <div className="w-[420px] shrink-0 border-l border-border flex flex-col bg-white">
      <div className="h-9 flex items-center px-3 border-b border-border bg-panelAlt shrink-0">
        <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
          Live Preview
        </span>
      </div>
      <div className="flex-1 min-h-0">
        {!openFile ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400 bg-canvas">
            No file open.
          </div>
        ) : !isPreviewable(openFile.path) ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400 bg-canvas px-6 text-center">
            Preview not available for this file type.
          </div>
        ) : (
          <iframe
            title="Live preview"
            srcDoc={srcDoc}
            sandbox="allow-scripts"
            className="w-full h-full border-0"
          />
        )}
      </div>
    </div>
  );
}
