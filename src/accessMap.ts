interface AccessEntry {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

// The actual map (emails → GitHub token/repo) lives in the VITE_ACCESS_MAP
// env var — a GitHub Actions repo secret in CI, .env locally — never
// hardcoded here. That keeps tokens out of git history entirely.
function loadAccessMap(): Record<string, AccessEntry> {
  const raw = import.meta.env.VITE_ACCESS_MAP;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, AccessEntry>;
  } catch {
    console.error('VITE_ACCESS_MAP is not valid JSON');
    return {};
  }
}

export const ACCESS_MAP: Record<string, AccessEntry> = loadAccessMap();