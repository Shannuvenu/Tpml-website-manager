import { useState } from 'react';

interface ConnectScreenProps {
  onConnect: (token: string, owner: string, repo: string, branch: string) => void;
  isConnecting: boolean;
  error: string | null;
}

export default function ConnectScreen({ onConnect, isConnecting, error }: ConnectScreenProps) {
  const [token, setToken] = useState('');
const [owner, setOwner] = useState('Shannuvenu');
const [repo, setRepo] = useState('CMS-inhouse-tpmlsite-test');
const [branch, setBranch] = useState('main');

  const canSubmit = token.trim() && owner.trim() && repo.trim() && branch.trim();

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="#5b8def" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M3 7l9 5 9-5M12 12v10" stroke="#5b8def" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-text-primary">TPML Website Manager</h1>
        </div>

        <div className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-sm font-semibold text-text-primary mb-1">Connect to GitHub</h2>
          <p className="text-xs text-text-secondary mb-5">
            Use a fine-grained personal access token scoped to a single repository with
            Contents: Read and write permission.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Personal Access Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="github_pat_..."
                className="w-full rounded-md bg-canvas border border-border px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Owner / Org
                </label>
                <input
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder="tpml"
                  className="w-full rounded-md bg-canvas border border-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Repository
                </label>
                <input
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="tpml-website"
                  className="w-full rounded-md bg-canvas border border-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Branch</label>
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                className="w-full rounded-md bg-canvas border border-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>

          {error && (
            <p className="mt-4 text-xs text-danger bg-danger/10 rounded-md px-3 py-2">{error}</p>
          )}

          <button
            onClick={() => canSubmit && onConnect(token.trim(), owner.trim(), repo.trim(), branch.trim())}
            disabled={!canSubmit || isConnecting}
            className="mt-5 w-full py-2 rounded-md text-sm font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isConnecting ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
