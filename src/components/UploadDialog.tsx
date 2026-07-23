import { useState } from 'react';

interface UploadDialogProps {
  isUploading: boolean;
  error: string | null;
  onConfirm: (path: string, base64Content: string, message: string) => void;
  onCancel: () => void;
}

const MAX_SIZE_BYTES = 1024 * 1024;

function stripDataUrlPrefix(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
}

export default function UploadDialog({ isUploading, error, onConfirm, onCancel }: UploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState('images');
  const [fileName, setFileName] = useState('');
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  function handleFileSelect(selected: File | null) {
    setLocalError(null);
    if (!selected) { setFile(null); return; }
    if (selected.size > MAX_SIZE_BYTES) {
      setLocalError(`${selected.name} is ${(selected.size / 1024).toFixed(0)}KB — GitHub's API rejects files over ~1MB. Compress it first.`);
      setFile(null);
      return;
    }
    setFile(selected);
    setFileName(selected.name);
    setMessage((prev) => prev || `Add ${selected.name}`);
  }

  function handleSubmit() {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = stripDataUrlPrefix(reader.result as string);
      const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, '');
      const path = cleanFolder ? `${cleanFolder}/${fileName.trim()}` : fileName.trim();
      onConfirm(path, base64, message.trim() || `Add ${fileName.trim()}`);
    };
    reader.onerror = () => setLocalError('Could not read the file — try again.');
    reader.readAsDataURL(file);
  }

  const canSubmit = !!file && fileName.trim().length > 0;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="w-[440px] bg-panel border border-border rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Upload file</h2>
          <p className="text-xs text-text-secondary mt-1">Creates a new file in the repo — images, fonts, or any binary asset.</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">File</label>
            <input type="file" onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-accent file:text-white hover:file:bg-accent-hover file:cursor-pointer" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Folder</label>
              <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="images"
                className="w-full rounded-md bg-canvas border border-border px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">File name</label>
              <input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="logo.png"
                className="w-full rounded-md bg-canvas border border-border px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
          </div>
          {file && (
            <p className="text-[11px] text-text-muted font-mono">
              Will be committed as <span className="text-text-secondary">{folder.trim().replace(/^\/+|\/+$/g, '')}/{fileName.trim() || '(name required)'}</span>
            </p>
          )}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Commit message</label>
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add logo.png"
              className="w-full rounded-md bg-canvas border border-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>
          {(localError || error) && (
            <p className="text-xs text-danger bg-danger/10 rounded-md px-3 py-2">{localError ?? error}</p>
          )}
        </div>
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button onClick={onCancel} disabled={isUploading} className="px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:bg-panelAlt transition-colors disabled:opacity-50">Cancel</button>
          <button onClick={handleSubmit} disabled={!canSubmit || isUploading} className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-60">
            {isUploading ? 'Uploading…' : 'Upload and commit'}
          </button>
        </div>
      </div>
    </div>
  );
}