import type { StatusMessage } from '../types/config';

interface StatusPanelProps {
  status: StatusMessage;
}

const KIND_STYLES: Record<StatusMessage['kind'], string> = {
  idle: 'bg-panelAlt text-text-secondary',
  connecting: 'bg-accent-muted text-accent',
  connected: 'bg-success/10 text-success',
  'loading-file': 'bg-accent-muted text-accent',
  'file-loaded': 'bg-success/10 text-success',
  saving: 'bg-warning/10 text-warning',
  'commit-created': 'bg-success/10 text-success',
  conflict: 'bg-warning/10 text-warning',
  'auth-failed': 'bg-danger/10 text-danger',
  'network-error': 'bg-danger/10 text-danger',
  error: 'bg-danger/10 text-danger',
};

const KIND_DOT: Record<StatusMessage['kind'], string> = {
  idle: 'bg-text-muted',
  connecting: 'bg-accent animate-pulse',
  connected: 'bg-success',
  'loading-file': 'bg-accent animate-pulse',
  'file-loaded': 'bg-success',
  saving: 'bg-warning animate-pulse',
  'commit-created': 'bg-success',
  conflict: 'bg-warning',
  'auth-failed': 'bg-danger',
  'network-error': 'bg-danger',
  error: 'bg-danger',
};

export default function StatusPanel({ status }: StatusPanelProps) {
  const time = new Date(status.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <footer
      className={`h-8 flex items-center justify-between px-4 text-xs font-mono border-t border-border ${KIND_STYLES[status.kind]}`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${KIND_DOT[status.kind]}`} />
        <span>{status.text}</span>
      </div>
      <span className="text-text-muted">{time}</span>
    </footer>
  );
}
