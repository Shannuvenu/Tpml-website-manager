import { useEffect, useState } from 'react';
import type { FileNode, RepoConfig, GitHubApiError } from '../types/config';
import type { GitHubService } from '../services/githubApi';
import { isIgnoredEntry, getIconKind, sortEntries, type IconKind } from '../utils/fileHelpers';

interface FileExplorerProps {
  service: GitHubService;
  repoConfig: RepoConfig;
  activePath: string | null;
  onOpenFile: (path: string, sha: string) => void;
  onError: (err: GitHubApiError) => void;
}

const ICON_PATHS: Record<IconKind, { path: string; color: string }> = {
  folder: { path: 'M2 5a1 1 0 0 1 1-1h4l1.5 1.5H13a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5Z', color: '#5b8def' },
  html: { path: 'M2 2h12l-1 11-5 1.5L3 13 2 2Z', color: '#e67e5a' },
  css: { path: 'M2 2h12l-1 11-5 1.5L3 13 2 2Z', color: '#5b9dd9' },
  js: { path: 'M2 2h12v12H2V2Z', color: '#e8c547' },
  ts: { path: 'M2 2h12v12H2V2Z', color: '#5b8def' },
  tsx: { path: 'M2 2h12v12H2V2Z', color: '#5bc0de' },
  json: { path: 'M2 2h12v12H2V2Z', color: '#9d9d9d' },
  image: { path: 'M2 3h12v10H2V3Zm2 8 3-4 2 2 2-3 3 5H4Z', color: '#7fbf7f' },
  markdown: { path: 'M2 4h12v8H2V4Z', color: '#c0c0c0' },
  generic: { path: 'M3 2h6l4 4v8H3V2Z', color: '#8b949e' },
};

function Icon({ kind }: { kind: IconKind }) {
  const { path, color } = ICON_PATHS[kind];
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill={color} className="shrink-0">
      <path d={path} />
    </svg>
  );
}

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  service: GitHubService;
  repoConfig: RepoConfig;
  activePath: string | null;
  onOpenFile: (path: string, sha: string) => void;
  onError: (err: GitHubApiError) => void;
}

function TreeNode({ node, depth, service, repoConfig, activePath, onOpenFile, onError }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileNode[] | undefined>(node.children);
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (node.type === 'file') {
      onOpenFile(node.path, node.sha);
      return;
    }

    // Directory: expand/collapse, fetching children on first expand only.
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (children) {
      setExpanded(true);
      return;
    }

    setLoading(true);
    try {
      const items = await service.loadFolder(repoConfig, node.path);
      const nodes: FileNode[] = sortEntries(
        items
          .filter((item) => !isIgnoredEntry(item.name))
          .map((item) => ({
            name: item.name,
            path: item.path,
            type: item.type === 'dir' ? 'dir' : 'file',
            sha: item.sha,
          }))
      );
      setChildren(nodes);
      setExpanded(true);
    } catch (err) {
      onError(err as GitHubApiError);
    } finally {
      setLoading(false);
    }
  };

  const isActive = node.type === 'file' && node.path === activePath;

  return (
    <div>
      <button
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={`w-full flex items-center gap-1.5 py-1 pr-2 text-[13px] text-left rounded-sm transition-colors ${
          isActive ? 'bg-accent-muted text-text-primary' : 'text-text-secondary hover:bg-panel hover:text-text-primary'
        }`}
      >
        {node.type === 'dir' && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="currentColor"
            className={`shrink-0 transition-transform text-text-muted ${expanded ? 'rotate-90' : ''}`}
          >
            <path d="M5 3l6 5-6 5V3Z" />
          </svg>
        )}
        {node.type === 'file' && <span className="w-2.5 shrink-0" />}
        <Icon kind={getIconKind(node.name, node.type)} />
        <span className="truncate">{node.name}</span>
        {loading && <span className="ml-auto text-[10px] text-text-muted">…</span>}
      </button>

      {expanded && children && (
        <div>
          {children.length === 0 ? (
            <p
              style={{ paddingLeft: `${(depth + 1) * 14 + 10}px` }}
              className="text-[11px] text-text-muted py-1"
            >
              Empty folder
            </p>
          ) : (
            children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                service={service}
                repoConfig={repoConfig}
                activePath={activePath}
                onOpenFile={onOpenFile}
                onError={onError}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function FileExplorer({ service, repoConfig, activePath, onOpenFile, onError }: FileExplorerProps) {
  const [rootNodes, setRootNodes] = useState<FileNode[] | null>(null);
  const [loading, setLoading] = useState(true);

  const loadRoot = async () => {
    setLoading(true);
    try {
      const items = await service.loadFolder(repoConfig, '');
      const nodes: FileNode[] = sortEntries(
        items
          .filter((item) => !isIgnoredEntry(item.name))
          .map((item) => ({
            name: item.name,
            path: item.path,
            type: item.type === 'dir' ? 'dir' : 'file',
            sha: item.sha,
          }))
      );
      setRootNodes(nodes);
    } catch (err) {
      onError(err as GitHubApiError);
    } finally {
      setLoading(false);
    }
  };

  // Load the repository root once on mount.
  useEffect(() => {
    loadRoot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <p className="px-3 py-2 text-xs text-text-muted">Loading repository…</p>;
  }

  if (!rootNodes) {
    return (
      <button onClick={loadRoot} className="mx-3 mt-2 text-xs text-accent hover:underline">
        Retry loading repository
      </button>
    );
  }

  if (rootNodes.length === 0) {
    return <p className="px-3 py-2 text-xs text-text-muted">This repository is empty.</p>;
  }

  return (
    <div className="py-1">
      {rootNodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          service={service}
          repoConfig={repoConfig}
          activePath={activePath}
          onOpenFile={onOpenFile}
          onError={onError}
        />
      ))}
    </div>
  );
}
