# TPML Website Manager

A browser-only tool for editing and publishing the company website directly
from GitHub — no Git, no VS Code, no terminal. Browse the repo, edit files
in Monaco, preview HTML/CSS/JS live, and commit straight to GitHub.

There is **no backend**. The app is a static React/Vite bundle that talks
directly to the GitHub REST API from the browser.

---

## 1. Install and run

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`).

For a production build:

```bash
npm run build
npm run preview
```

`npm run build` outputs static files to `dist/` — host them on any static
file server (GitHub Pages, Netlify, S3, etc.). There is no server-side
piece to deploy.

## 2. Getting connected

On first load you'll see a Connect screen asking for:

1. **A GitHub Personal Access Token** — use a **fine-grained** token
   (Settings → Developer settings → Fine-grained tokens), scoped to:
   - **Only** the one repository this tool will manage
   - Repository permission: **Contents → Read and write**
   - A **short expiration** (30–90 days), rotated periodically
2. **Owner/org**, **repository name**, and **branch** (e.g. `main`).

The app verifies the token against `GET /user` and confirms repo access
against `GET /repos/{owner}/{repo}` before letting you in.

## 3. Read this before you rely on it

**Storing a token in `localStorage` is a real trade-off, not a footnote.**
Any XSS vulnerability on this page — in a dependency, in a future change,
in a browser extension — can read `localStorage` and get write access to
your repository. This is unavoidable in a backend-less design; the token
has to live somewhere the browser can use it directly. Mitigate it by:

- Scoping the token to exactly one repo with Contents read/write only —
  never a classic PAT with full repo/org access.
- Rotating the token regularly and revoking it immediately if a laptop
  is lost/compromised or the browser environment is shared.
- Not deploying this app anywhere the JS bundle could be tampered with
  (serve it over HTTPS from a source you control).

If this repo holds anything more sensitive than static marketing pages,
a backend-mediated auth flow (GitHub App + server-side token exchange)
removes this risk — that's a bigger project than what was asked for here,
but worth knowing the ceiling of this approach.

## 4. What's not covered

- **No merge conflict resolution UI.** If the file changed on GitHub
  since you opened it, committing returns a 409 and the status bar tells
  you to reload the file — it won't attempt to merge your changes with
  the newer version.
- **No multi-file preview.** Live Preview renders the *single open file*
  in isolation — an `.html` file previews as itself; a `.css` file
  previews against a generic sample page (there's no way to know which
  HTML file it belongs to without a build step); a `.js` file runs
  against a blank page with `console.log`/`console.error` captured.
  It cannot preview a real page assembled from separate HTML+CSS+JS files
  the way a bundler would.
- **No binary/image editing.** Image files show in the tree but aren't
  openable in Monaco (there's nothing meaningful to edit as text).
- **Single file open at a time** — no tabs. Switching files with unsaved
  changes prompts a discard confirmation.

## 5. Dependencies, and why each one is here

| Package | Why |
|---|---|
| `react`, `react-dom` | UI runtime. |
| `vite`, `@vitejs/plugin-react` | Dev server + build tool with fast HMR; no backend needed so a pure static-site bundler is all that's required. |
| `typescript` | Type safety across GitHub API responses, file tree state, and props — this app has enough moving state (open file, sha tracking, dirty flags) that untyped JS would risk silent bugs like committing a stale `sha`. |
| `tailwindcss`, `postcss`, `autoprefixer` | Utility CSS for the dashboard chrome without hand-writing a stylesheet per component. |
| `axios` | HTTP client for the GitHub REST API — used over raw `fetch` for interceptor-friendly error objects (`AxiosError` carries the parsed GitHub error body cleanly, which the error-normalizing layer in `githubApi.ts` depends on). |
| `@monaco-editor/react` | Wraps the same editor VS Code uses (Monaco) as a React component — syntax highlighting, line numbers, and the `onChange` diffing the spec asked for, without hand-rolling a code editor. |
| `eslint` + plugins | Lint rules for React hooks correctness and consistent code style. |

No state management library (Redux/Zustand) is included — the app's
state (token, repo config, open file, status) fits comfortably in a
handful of `useState` hooks in `App.tsx`, and adding one would be
unjustified complexity for this scope.

## 6. Project structure

```
src/
  components/
    Header.tsx        — top bar: title, connected user, Commit button
    Sidebar.tsx        — repo explorer panel wrapper
    FileExplorer.tsx   — lazy-loaded recursive GitHub directory tree
    MonacoEditor.tsx   — editor pane + unsaved-changes indicator
    LivePreview.tsx    — iframe-based preview for html/css/js
    CommitDialog.tsx   — commit-message modal
    StatusPanel.tsx    — bottom status bar
    ConnectScreen.tsx  — token + repo entry screen (see note below)
  services/
    githubApi.ts       — every GitHub REST call + error normalization
  utils/
    base64.ts          — UTF-8-safe base64 encode/decode
    tokenStorage.ts     — localStorage read/write for token + repo config
    fileHelpers.ts      — extension → language/icon mapping, ignore rules, sorting
  types/
    config.ts          — shared TypeScript interfaces
  App.tsx              — top-level state and data flow
  main.tsx             — React entry point
```

**One deviation from the original file list:** `ConnectScreen.tsx` was
added. The spec didn't include it, but with no backend there was no way
to determine *which* repository or token to use without an entry
screen — the header shown after connecting already displays
"Connected as `<username>`" per the spec once this initial step is done.

## 7. Error handling

`githubApi.ts` maps every GitHub response to one of: `401` (auth failed),
`403` (forbidden or rate-limited), `404` (not found), `409` (conflict —
stale `sha`), `422` (validation), `500/502/503` (GitHub outage), or a
network error — each with a specific message shown in the status bar. No
raw axios/GitHub error ever reaches the UI unformatted.
