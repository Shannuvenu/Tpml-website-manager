export interface RepoAccess {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

/**
 * ONE shared GitHub config for the whole team. Who's allowed in is already
 * decided by the domain check in EmployeeLogin.tsx (isAllowedEmail) — any
 * verified @printersmysore.co.in Google account. So there is nothing
 * per-employee to maintain here. Adding a new team member needs ZERO
 * changes to this file, .env, or GitHub Actions secrets — they just sign
 * in with their company Google account and it works.
 */
function loadRepoAccess(): RepoAccess | null {
  const raw = import.meta.env.VITE_REPO_ACCESS;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RepoAccess;
  } catch {
    console.error('VITE_REPO_ACCESS is not valid JSON');
    return null;
  }
}

export const REPO_ACCESS: RepoAccess | null = loadRepoAccess();