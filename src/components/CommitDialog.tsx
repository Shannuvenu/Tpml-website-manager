import { useMemo, useState } from 'react';

interface CommitDialogProps {
  filePath: string;
  isSaving: boolean;
  originalContent: string;
  currentContent: string;
  onConfirm: (message: string) => void;
  onCancel: () => void;
}

const DEFAULT_MESSAGE = 'Updated via TPML Website Manager';

/** Very small line-level diff — no external dependency. Good enough for the
 *  "before/after" review a non-technical user needs; not meant to be a full
 *  Git-style diff. */
function diffLines(before: string, after: string): Array<{ before: string; after: string }> {
  const a = before.split('\n');
  const b = after.split('\n');
  const max = Math.max(a.length, b.length);
  const changes: Array<{ before: string; after: string }> = [];
  for (let i = 0; i < max; i++) {
    const lineA = a[i] ?? '';
    const lineB = b[i] ?? '';
    if (lineA !== lineB) changes.push({ before: lineA, after: lineB });
  }
  return changes;
}

export default function CommitDialog({
  filePath,
  isSaving,
  originalContent,
  currentContent,
  onConfirm,
  onCancel,
}: CommitDialogProps) {
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [reviewing, setReviewing] = useState(true);
  const changes = useMemo(() => diffLines(originalContent, currentContent), [originalContent, currentContent]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        className="w-[460px] bg-panel border border-border rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">
            {reviewing ? 'Review your changes' : 'Save changes'}
          </h2>
          <p className="text-xs text-text-secondary mt-1 font-mono truncate">{filePath}</p>
        </div>

        <div className="px-5 py-4">
          {reviewing ? (
            <div className="max-h-64 overflow-y-auto space-y-3">
              {changes.length === 0 ? (
                <p className="text-xs text-text-muted">No visible content changes detected.</p>
              ) : (
                changes.map((c, i) => (
                  <div key={i} className="text-xs">
                    <p className="text-text-muted mb-1">Before:</p>
                    <p className="bg-danger/10 text-text-primary rounded px-2 py-1 mb-1 whitespace-pre-wrap">
                      {c.before || '(empty)'}
                    </p>
                    <p className="text-text-muted mb-1">After:</p>
                    <p className="bg-success/10 text-text-primary rounded px-2 py-1 whitespace-pre-wrap">
                      {c.after || '(empty)'}
                    </p>
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                What did you change? (optional note)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                autoFocus
                className="w-full resize-none rounded-md bg-canvas border border-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="text-[11px] text-text-muted mt-2">Saving creates a new version in GitHub.</p>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          {reviewing ? (
            <>
              <button
                onClick={onCancel}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:bg-panelAlt transition-colors"
              >
                Back to Editing
              </button>
              <button
                onClick={() => setReviewing(false)}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
              >
                Looks good — continue
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setReviewing(true)}
                disabled={isSaving}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:bg-panelAlt transition-colors disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={() => onConfirm(message.trim() || DEFAULT_MESSAGE)}
                disabled={isSaving}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-60 flex items-center gap-1.5"
              >
                {isSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}