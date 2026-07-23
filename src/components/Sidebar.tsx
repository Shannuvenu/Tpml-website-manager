import type { RepoConfig, GitHubApiError } from '../types/config';
import type { GitHubService } from '../services/githubApi';
import FileExplorer from './FileExplorer';

interface SidebarProps {
  service: GitHubService;
  repoConfig: RepoConfig;
  activePath: string | null;
  onOpenFile: (path: string, sha: string) => void;
  onError: (err: GitHubApiError) => void;
  refreshKey: number;
  onRefresh: () => void;
}

export default function Sidebar({
  service,
  repoConfig,
  activePath,
  onOpenFile,
  onError,
  refreshKey,
  onRefresh,
}: SidebarProps) {
  return (
    <aside className="w-64 shrink-0 bg-panel border-r border-border flex flex-col overflow-hidden">
      <div className="h-9 flex items-center justify-between px-3 border-b border-border">
        <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
          Repository Explorer
        </span>
        <button onClick={onRefresh} title="Refresh" className="text-text-muted hover:text-text-primary transition-colors">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.65 2.35a6.5 6.5 0 1 0 1.6 6.65 1 1 0 0 0-1.9-.6 4.5 4.5 0 1 1-1.1-4.65L10 5.9h4.5V1.4l-.85.95Z"/></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <FileExplorer
          key={refreshKey}
          service={service}
          repoConfig={repoConfig}
          activePath={activePath}
          onOpenFile={onOpenFile}
          onError={onError}
        />
      </div>
    </aside>
  );
}