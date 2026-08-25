interface AccessEntry {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

// Committed directly to source — no env var, no CI secret, no build-time
// injection to go wrong. Same security trade-off as before (tokens are
// visible in the shipped JS bundle either way); this just removes every
// point where the value could fail to reach the deployed build.
export const ACCESS_MAP: Record<string, AccessEntry> = {
  'intern.it@printersmysore.co.in': {
    token: 'YOUR_NEW_GITHUB_TOKEN',
    owner: 'Shannuvenu',
    repo: 'CMS-inhouse-tpmlsite-test',
    branch: 'main',
  },
  // Add more people here, comma-separated:
  // 'someone.else@printersmysore.co.in': { token: '...', owner: '...', repo: '...', branch: 'main' },
};