import type { GitHubUser, RepoConfig } from '../types/config';

interface HeaderProps {
  user: GitHubUser | null;
  repoConfig: RepoConfig | null;
  hasUnsavedChanges: boolean;
  onCommitClick: () => void;
  onUploadClick: () => void;
  onHistoryClick: () => void;
  onDisconnect: () => void;
}

export default function Header({
  user,
  repoConfig,
  hasUnsavedChanges,
  onCommitClick,
  onUploadClick,
  onHistoryClick,
  onDisconnect,
}: HeaderProps) {
  return (
    <header className="h-14 flex items-center justify-between px-5 bg-panelAlt border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="#5b8def" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M3 7l9 5 9-5M12 12v10" stroke="#5b8def" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="leading-tight">
          <h1 className="text-sm font-semibold text-text-primary">TPML Website Manager</h1>
          {repoConfig && (
            <p className="text-[11px] text-text-secondary font-mono">
              {repoConfig.owner}/{repoConfig.repo}
              <span className="text-text-muted"> @ {repoConfig.branch}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {user && (
          <div className="flex items-center gap-2 pr-3 border-r border-border">
            <img src={user.avatar_url} alt={user.login} className="w-6 h-6 rounded-full" />
            <span className="text-xs text-text-secondary">
              Connected as <span className="text-text-primary font-medium">{user.login}</span>
            </span>
          </div>
        )}

        <button
          onClick={onHistoryClick}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary border border-border hover:bg-panel hover:text-text-primary transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 7 7 1 1 0 1 0-2 0 5 5 0 1 1-5-5v2l3-2.5L8 0.5V1Z"/></svg>
          History
        </button>

        <button
          onClick={onUploadClick}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary border border-border hover:bg-panel hover:text-text-primary transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a1 1 0 0 1 .7.3l3.5 3.5a1 1 0 1 1-1.4 1.4L9 4.9V10a1 1 0 1 1-2 0V4.9L5.2 6.7a1 1 0 0 1-1.4-1.4l3.5-3.5a1 1 0 0 1 .7-.3ZM2 12a1 1 0 0 1 1 1v.5A.5.5 0 0 0 3.5 14h9a.5.5 0 0 0 .5-.5V13a1 1 0 1 1 2 0v.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 13.5V13a1 1 0 0 1 1-1Z"/></svg>
          Upload
        </button>

        <button
          onClick={onCommitClick}
          disabled={!hasUnsavedChanges}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:bg-accent-hover disabled:bg-panel disabled:text-text-muted disabled:cursor-not-allowed transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a1 1 0 0 1 1 1v4h4a1 1 0 1 1 0 2H9v4a1 1 0 1 1-2 0V8H3a1 1 0 1 1 0-2h4V2a1 1 0 0 1 1-1Z" />
          </svg>
          Save Changes
        </button>

        {user && (
          <button onClick={onDisconnect} className="text-xs text-text-muted hover:text-text-secondary transition-colors">
            Disconnect
          </button>
        )}
      </div>
    </header>
  );
}