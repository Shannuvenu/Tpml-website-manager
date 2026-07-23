import { useState } from 'react';

interface CommitDialogProps {
  filePath: string;
  isSaving: boolean;
  onConfirm: (message: string) => void;
  onCancel: () => void;
}

const DEFAULT_MESSAGE = 'Updated via TPML Website Manager';

export default function CommitDialog({ filePath, isSaving, onConfirm, onCancel }: CommitDialogProps) {
  const [message, setMessage] = useState(DEFAULT_MESSAGE);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        className="w-[420px] bg-panel border border-border rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Commit changes</h2>
          <p className="text-xs text-text-secondary mt-1 font-mono truncate">{filePath}</p>
        </div>

        <div className="px-5 py-4">
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Commit message
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            autoFocus
            className="w-full resize-none rounded-md bg-canvas border border-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:bg-panelAlt transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(message.trim() || DEFAULT_MESSAGE)}
            disabled={isSaving}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-60 flex items-center gap-1.5"
          >
            {isSaving ? 'Committing…' : 'Commit changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
