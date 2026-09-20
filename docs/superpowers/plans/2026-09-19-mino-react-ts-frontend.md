# Mino React + TypeScript Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the embedded vanilla JS workbench and Markdown viewer with a Vite + React + TypeScript + Tailwind UI, shipped via `go:embed` of `internal/ui/dist`, with behavior parity and Vitest coverage (Playwright E2E out of scope; see Task 11).

**Architecture:** One `web/` package with two Vite HTML entries (`index` workbench, `md/viewer` iframe document). Pure logic ports to `web/src/lib/` first (TDD from existing `testdata/*.mjs`). Vite `outDir` is `internal/ui/dist` (go:embed cannot use `..`). Go serves hashed assets from that FS, keeps a thin `html/template` for MD `data-path` injection, and drops per-file `/app.js` routes. Existing shell↔viewer `postMessage` protocol (`source: "mino"`) is **preserved**, not redesigned.

**Tech Stack:** React 19, TypeScript 5.x, Vite 6.x, Tailwind CSS 4.x, Vitest, Testing Library, Go 1.24.4 embed. No UI component libraries. (Playwright was planned for Task 11 but is cancelled.)

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-19-mino-react-ts-frontend-design.md`
- Behavior-equivalent first: interactions, shortcuts, storage keys, watch/companion semantics must match current UI
- Storage keys verbatim: `mino-open-path` (sessionStorage), `mino-md-preview-width` (localStorage)
- MD width labels: 标宽 / 较宽 / 全宽 → modes `standard` / `wide` / `full` (default `wide`)
- Pure React + Tailwind only — no shadcn, Radix, MUI
- Do not change catalog / watch / companion allowlist / host-binding backend semantics
- Preserve preview-session postMessage types: `preview-navigate`, `preview-reload`, `preview-ready`, `preview-error`, and `md-preview-width`
- Prefer TDD; commit after each task
- CI / local `go test` that needs UI must run `npm ci && npm run build` in `web/` first so `internal/ui/dist` exists

---

## File Structure

```text
web/
  package.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
  vitest.config.ts
  playwright.config.ts
  index.html
  md/viewer.html
  src/
    main.tsx
    md/viewer-main.tsx
    styles/index.css
    lib/
      open-path.ts
      fuzzy.ts
      preview-session.ts
      asset-refs.ts
      preview-width.ts
      preprocess.ts
      toc.ts
      mermaid-block.ts          # port of mermaid-block.js (large)
    lib/*.test.ts
    app/WorkbenchApp.tsx
    features/
      explorer/ExplorerTree.tsx
      quick-open/QuickOpen.tsx
      preview/PreviewPane.tsx
      status-bar/StatusBar.tsx
      watch/WatchBridge.tsx
    components/                  # small presentational pieces (icons, buttons)
    md/
      MarkdownViewer.tsx
      Toc.tsx
      MermaidBlock.tsx
  e2e/*.spec.ts
internal/ui/
  embed.go                       # //go:embed all:dist
  dist/                          # build output (commit a .gitkeep + README note; CI builds)
  dist/.gitkeep
  viewer_template.html           # thin Go template shell referencing /assets/… (or generated)
internal/server/server.go        # static FS serve; drop old asset routes; MD template update
internal/server/server_test.go   # rewrite UI string probes
README.md                        # build step for contributors
```

Vanilla `app.js`, `style.css`, `fuzzy.js`, … and `md/*.js` / `md/vendor` are deleted only after Task 10 cutover when the React UI is embedded and green.

---

### Task 1: Scaffold `web/` (Vite + React + TS + Tailwind, dual entry)

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`, `web/tsconfig.app.json`, `web/tsconfig.node.json`
- Create: `web/vite.config.ts`
- Create: `web/vitest.config.ts`
- Create: `web/index.html`
- Create: `web/md/viewer.html`
- Create: `web/src/main.tsx`
- Create: `web/src/md/viewer-main.tsx`
- Create: `web/src/styles/index.css`
- Create: `web/src/app/WorkbenchApp.tsx`
- Create: `web/src/md/MarkdownViewer.tsx`
- Create: `internal/ui/dist/.gitkeep`
- Modify: `.gitignore` (ignore `web/node_modules`, optionally ignore hashed files under `internal/ui/dist/assets` if not committing builds)

**Interfaces:**
- Consumes: none
- Produces: `npm run build` writes workbench + viewer bundles into `internal/ui/dist/`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "mino-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "dompurify": "^3.2.6",
    "highlight.js": "^11.11.1",
    "katex": "^0.16.22",
    "marked": "^15.0.12",
    "mermaid": "^11.6.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0",
    "@tailwindcss/vite": "^4.1.8",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/dompurify": "^3.2.0",
    "@types/react": "^19.1.6",
    "@types/react-dom": "^19.1.5",
    "@vitejs/plugin-react": "^4.5.0",
    "jsdom": "^26.1.0",
    "tailwindcss": "^4.1.8",
    "typescript": "~5.8.3",
    "vite": "^6.3.5",
    "vitest": "^3.1.4"
  }
}
```

- [ ] **Step 2: Create Vite config with dual inputs and embed outDir**

`web/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "../internal/ui/dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        viewer: path.resolve(__dirname, "md/viewer.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:52341",
      "/apps": "http://127.0.0.1:52341",
    },
  },
});
```

Note: proxy port is illustrative; during Task 8+ prefer reading the printed mino URL or use a fixed `--port` in scripts.

- [ ] **Step 3: Create stub HTML entries and React mounts**

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>mino</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/md/viewer.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self';"
    />
    <title>Markdown preview</title>
  </head>
  <body>
    <div id="root" data-path=""></div>
    <script type="module" src="/src/md/viewer-main.tsx"></script>
  </body>
</html>
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import { WorkbenchApp } from "./app/WorkbenchApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkbenchApp />
  </StrictMode>
);
```

`web/src/app/WorkbenchApp.tsx`:

```tsx
export function WorkbenchApp() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <p className="p-4 font-sans text-sm">mino workbench scaffold</p>
    </div>
  );
}
```

`web/src/md/viewer-main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/index.css";
import { MarkdownViewer } from "./MarkdownViewer";

const rootEl = document.getElementById("root")!;
const initialPath = rootEl.getAttribute("data-path") || "";

createRoot(rootEl).render(
  <StrictMode>
    <MarkdownViewer initialPath={initialPath} />
  </StrictMode>
);
```

`web/src/md/MarkdownViewer.tsx`:

```tsx
export function MarkdownViewer({ initialPath }: { initialPath: string }) {
  return (
    <main className="p-4 font-sans text-sm text-neutral-900">
      Markdown viewer scaffold: {initialPath || "(no path)"}
    </main>
  );
}
```

`web/src/styles/index.css`:

```css
@import "tailwindcss";
```

Add minimal `tsconfig*.json` for Vite React (`strict: true`, `jsx: "react-jsx"`, project references as needed).

- [ ] **Step 4: Install and verify build**

Run:

```bash
cd web && npm install && npm run build
```

Expected: `internal/ui/dist/index.html`, `internal/ui/dist/md/viewer.html`, and `internal/ui/dist/assets/*` exist.

- [ ] **Step 5: Commit**

```bash
git add web .gitignore internal/ui/dist/.gitkeep
git commit -m "$(cat <<'EOF'
chore(web): scaffold Vite React TS Tailwind dual-entry app

Prepare outDir under internal/ui/dist for go:embed.
EOF
)"
```

---

### Task 2: Port `open-path` to TypeScript (TDD)

**Files:**
- Create: `web/src/lib/open-path.ts`
- Create: `web/src/lib/open-path.test.ts`
- Test source of truth: `internal/ui/testdata/open_path_test.mjs`

**Interfaces:**
- Consumes: none
- Produces:

```ts
export const STORAGE_KEY = "mino-open-path";
export function parseOpenPath(value: unknown): string;
export function readOpenPath(storage: StorageLike | null | undefined): string;
export function writeOpenPath(storage: StorageLike | null | undefined, path: unknown): string;
export function clearOpenPath(storage: StorageLike | null | undefined): void;
export function resolveOpenPath(stored: unknown, fileIndex: { includes(path: string): boolean } | null | undefined): string;
export function createOpenPathRestore(): (
  storage: StorageLike | null | undefined,
  fileIndex: { includes(path: string): boolean } | null | undefined
) => string;

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
```

- [ ] **Step 1: Write failing Vitest file**

Create `web/src/lib/open-path.test.ts` by migrating every assertion from `internal/ui/testdata/open_path_test.mjs`:

- Change imports to `import { … } from "./open-path"`
- Keep `memoryStorage` helper
- Use `import { describe, expect, it } from "vitest"` (or `test` from vitest)

Do **not** weaken any assertion. Example head:

```ts
import { describe, expect, it } from "vitest";
import {
  STORAGE_KEY,
  parseOpenPath,
  readOpenPath,
  writeOpenPath,
  clearOpenPath,
  resolveOpenPath,
  createOpenPathRestore,
} from "./open-path";

describe("open-path", () => {
  it("STORAGE_KEY", () => {
    expect(STORAGE_KEY).toBe("mino-open-path");
  });

  it("parseOpenPath trims and rejects empty", () => {
    expect(parseOpenPath("docs/sample.md")).toBe("docs/sample.md");
    expect(parseOpenPath("  docs/sample.md  ")).toBe("docs/sample.md");
    expect(parseOpenPath("")).toBe("");
    expect(parseOpenPath("   ")).toBe("");
    expect(parseOpenPath(null)).toBe("");
    expect(parseOpenPath(undefined)).toBe("");
    expect(parseOpenPath(0)).toBe("");
  });
});
```

Migrate the remaining cases from the `.mjs` file in the same commit task (all of them).

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd web && npm test -- src/lib/open-path.test.ts
```

Expected: FAIL (module not found or exports missing).

- [ ] **Step 3: Implement `web/src/lib/open-path.ts`**

Port logic from `internal/ui/open-path.js` verbatim (TypeScript types only; no behavior drift):

```ts
export const STORAGE_KEY = "mino-open-path";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function parseOpenPath(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function readOpenPath(storage: StorageLike | null | undefined): string {
  try {
    return parseOpenPath(storage?.getItem(STORAGE_KEY));
  } catch {
    return "";
  }
}

export function writeOpenPath(
  storage: StorageLike | null | undefined,
  path: unknown
): string {
  const value = parseOpenPath(path);
  try {
    if (!storage) return value;
    if (!value) {
      storage.removeItem(STORAGE_KEY);
      return "";
    }
    storage.setItem(STORAGE_KEY, value);
  } catch {
    /* ignore quota / private mode */
  }
  return value;
}

export function clearOpenPath(storage: StorageLike | null | undefined): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function resolveOpenPath(
  stored: unknown,
  fileIndex: { includes(path: string): boolean } | null | undefined
): string {
  const path = parseOpenPath(stored);
  if (!path) return "";
  if (!fileIndex || typeof fileIndex.includes !== "function") return "";
  return fileIndex.includes(path) ? path : "";
}

export function createOpenPathRestore() {
  let done = false;
  return function takeOpenPathRestore(
    storage: StorageLike | null | undefined,
    fileIndex: { includes(path: string): boolean } | null | undefined
  ): string {
    if (done) return "";
    done = true;
    const path = resolveOpenPath(readOpenPath(storage), fileIndex);
    if (!path) clearOpenPath(storage);
    return path;
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd web && npm test -- src/lib/open-path.test.ts
```

Expected: PASS (all cases from the migrated file).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/open-path.ts web/src/lib/open-path.test.ts
git commit -m "feat(web): port open-path helper to TypeScript"
```

---

### Task 3: Port `fuzzy`, `preview-session`, `asset-refs`, `preview-width`

**Files:**
- Create: `web/src/lib/fuzzy.ts`, `fuzzy.test.ts`
- Create: `web/src/lib/preview-session.ts`, `preview-session.test.ts`
- Create: `web/src/lib/asset-refs.ts`, `asset-refs.test.ts`
- Create: `web/src/lib/preview-width.ts`, `preview-width.test.ts`
- Sources: `internal/ui/fuzzy.js`, `preview-session.js`, `asset-refs.js`, `md/preview-width.js`
- Tests: matching `internal/ui/testdata/*_test.mjs`

**Interfaces:**
- Consumes: none
- Produces (exact names — keep parity with JS):

```ts
// fuzzy.ts
export function score(query: string, path: string): { score: number; matches: number[] } | null;
export function filter(
  query: string,
  paths: string[],
  recents?: string[]
): { path: string; score: number; matches: number[] }[];

// preview-session.ts
export function kindId(path: unknown): "markdown" | "html" | "document";
export function inPlace(path: unknown): boolean;
export function decidePreviewAction(input: {
  fromPath?: unknown;
  toPath?: unknown;
  force?: boolean;
  displayedPath?: unknown;
  navigatePending?: boolean;
}): "skip" | "navigate" | "in-place";
export function previewNavigateMessage(path: unknown): { source: "mino"; type: "preview-navigate"; path: string };
export function previewReloadMessage(path: unknown): { source: "mino"; type: "preview-reload"; path: string };
export function previewReadyMessage(path: unknown): { source: "mino"; type: "preview-ready"; path: string };
export function previewErrorMessage(path: unknown): { source: "mino"; type: "preview-error"; path: string };
export function parsePreviewMessage(
  data: unknown,
  origin: string,
  expectedOrigin: string
): { type: string; path: string } | null;

// asset-refs.ts
export function extractURLs(source: string): string[];
export function resolveRef(fromFile: string, url: string): string | null;
export function referencedPaths(fromFile: string, source: string): string[];
export function maskMarkdownFences(source: string): string;

// preview-width.ts
export const STORAGE_KEY = "mino-md-preview-width";
export const DEFAULT_WIDTH = "wide";
export const WIDTH_LABELS: Record<"standard" | "wide" | "full", string>;
export type PreviewWidth = "standard" | "wide" | "full";
export function parsePreviewWidth(value: unknown): PreviewWidth;
export function isMarkdownPath(path: unknown): boolean;
export function readPreviewWidth(storage: StorageLike | null | undefined): PreviewWidth;
export function writePreviewWidth(storage: StorageLike | null | undefined, mode: unknown): PreviewWidth;
export function applyPreviewWidth(root: { setAttribute(name: string, value: string): void } | null | undefined, mode: unknown): PreviewWidth;
export function previewWidthMessage(value: unknown): { source: "mino"; type: "md-preview-width"; value: PreviewWidth };
export function parsePreviewWidthMessage(data: unknown, origin: string, expectedOrigin: string): PreviewWidth | null;
```

- [ ] **Step 1: For each module — write Vitest by migrating the corresponding `.mjs` file**

Order: `fuzzy` → `preview-session` → `asset-refs` → `preview-width`. One module at a time.

- [ ] **Step 2: Run the new test file — expect FAIL**

```bash
cd web && npm test -- src/lib/fuzzy.test.ts
```

- [ ] **Step 3: Port the JS implementation to TS without behavior changes**

Copy algorithms from the UMD factories; export named functions (drop `root.Mino*` globals).

- [ ] **Step 4: Run until PASS, then commit that module**

```bash
cd web && npm test -- src/lib/fuzzy.test.ts
git add web/src/lib/fuzzy.ts web/src/lib/fuzzy.test.ts
git commit -m "feat(web): port fuzzy search helper to TypeScript"
```

Repeat Steps 1–4 for `preview-session`, `asset-refs`, `preview-width` with analogous commit messages.

---

### Task 4: Port `preprocess` and `toc`

**Files:**
- Create: `web/src/lib/preprocess.ts`, `preprocess.test.ts`
- Create: `web/src/lib/toc.ts`, `toc.test.ts`
- Sources: `internal/ui/md/preprocess.js`, `toc.js`
- Tests: `internal/ui/testdata/preprocess_test.mjs`, `toc_test.mjs`

**Interfaces:**
- Consumes: none
- Produces: same public functions as current UMD (`preprocess` / `MinoMDPreprocess` exports and `slugify`, `uniqueId`, `ensureHeadingIds`)

- [ ] **Step 1: Migrate preprocess tests → FAIL → port → PASS → commit**

```bash
git commit -m "feat(web): port markdown preprocess helper to TypeScript"
```

- [ ] **Step 2: Migrate toc tests → FAIL → port → PASS → commit**

```bash
git commit -m "feat(web): port markdown toc helper to TypeScript"
```

Read each JS file’s `return { … }` block and export those names from TS. Keep Unicode slugify (`\p{L}\p{N}`) behavior.

---

### Task 5: Port `mermaid-block` logic

**Files:**
- Create: `web/src/lib/mermaid-block.ts`
- Create: `web/src/lib/mermaid-block.test.ts`
- Source: `internal/ui/md/mermaid-block.js` (737 lines)
- Tests: `internal/ui/testdata/mermaid_block_test.mjs` (550 lines)

**Interfaces:**
- Consumes: DOM APIs in tests via jsdom
- Produces: export the same functions currently returned by `MinoMermaidBlock` (inspect `return { … }` at end of `mermaid-block.js` and list them in the TS module). At minimum preserve Code/Preview toggle, fullscreen overlay, viewBox camera zoom/pan/reset, Escape-to-close.

- [ ] **Step 1: Write Vitest migration of `mermaid_block_test.mjs` (all assertions)**

- [ ] **Step 2: Run — expect FAIL**

```bash
cd web && npm test -- src/lib/mermaid-block.test.ts
```

- [ ] **Step 3: Port `mermaid-block.js` → `mermaid-block.ts`**

Prefer a near-literal port. Split only if a single file blocks review; keep public API stable.

- [ ] **Step 4: Run — expect PASS, then commit**

```bash
git commit -m "feat(web): port mermaid block camera/modes to TypeScript"
```

---

### Task 6: Go embed + static serving of Vite dist (scaffold UI live)

**Files:**
- Modify: `internal/ui/embed.go`
- Create: `internal/ui/viewer_template.html` (thin MD shell)
- Modify: `internal/server/server.go` (serve dist; MD template; remove old per-file routes)
- Modify: `internal/server/server_test.go` (stop asserting `/app.js` / vendor paths; assert new assets)
- Modify: `README.md` (document `cd web && npm ci && npm run build`)

**Interfaces:**
- Consumes: `internal/ui/dist/**` after `npm run build`
- Produces: `GET /` serves workbench; `GET /assets/*` serves hashed files; `.md` under `/apps/` still returns HTML with `data-path`

- [ ] **Step 1: Ensure dist is built**

```bash
cd web && npm run build
```

- [ ] **Step 2: Replace embed.go**

```go
package ui

import "embed"

// FS contains the built browser interface (Vite output under dist/).
//
//go:embed all:dist
var FS embed.FS
```

- [ ] **Step 3: Add thin MD viewer template**

Create `internal/ui/viewer_template.html` that Go executes with `{{.Path}}`. It must:

1. Set CSP like today’s viewer
2. Set `<div id="root" data-path="{{.Path}}"></div>`
3. Load the **built** viewer JS/CSS. Because Vite hashes names, either:
   - **Preferred:** after `vite build`, a small `web/scripts/write-viewer-template.mjs` reads `dist/.vite/manifest.json` (enable `build.manifest: true` in vite config) and writes `internal/ui/viewer_template.html` with the correct `/assets/….js` and `.css` tags; run it at end of `npm run build`
   - Or parse `dist/md/viewer.html` and wrap it as a Go template by injecting `data-path`

Enable in `vite.config.ts`:

```ts
build: {
  manifest: true,
  // …existing
}
```

Update `package.json` build script:

```json
"build": "tsc -b && vite build && node scripts/write-viewer-template.mjs"
```

`write-viewer-template.mjs` must write HTML approximately:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self';">
  <title>Markdown preview</title>
  <link rel="stylesheet" href="/assets/VIEWER_CSS_HASHED.css">
  <script type="module" src="/assets/VIEWER_JS_HASHED.js"></script>
</head>
<body>
  <div id="root" data-path="{{.Path}}"></div>
</body>
</html>
```

Also `//go:embed viewer_template.html` in `embed.go` (or embed both `dist` and the template file).

- [ ] **Step 4: Rewrite server static handlers**

In `Handler()`:

- Remove `GET /app.js`, `/fuzzy.js`, `/open-path.js`, `/preview-session.js`, `/asset-refs.js`, `/style.css`
- Replace `GET /md/` vendor handler with serving from `dist` **or** drop it once viewer is bundled
- Keep `GET /{$}` but read `dist/index.html`
- Add a generic asset handler, e.g. `GET /assets/` reading `dist/assets/…` from `ui.FS` with correct content types
- Change `mdViewer` to `template.ParseFS(ui.FS, "viewer_template.html")` (path relative to embed root)

Sketch for asset serve:

```go
mux.HandleFunc("GET /assets/", s.distAssetHandler)

func (s *Server) distAssetHandler(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	cleaned := path.Clean("/" + name)
	cleaned = strings.TrimPrefix(cleaned, "/")
	if cleaned == "" || strings.Contains(cleaned, "..") {
		http.NotFound(w, r)
		return
	}
	data, err := ui.FS.ReadFile("dist/" + cleaned)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", distContentType(cleaned))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(data)
}
```

`indexHandler` reads `dist/index.html`. Ensure built `index.html` script tags use absolute `/assets/…` paths (`base: "/"`).

- [ ] **Step 5: Fix Go tests**

Update `internal/server/server_test.go`:

- Delete or rewrite tests that `http.Get` `/md/vendor/marked.min.js`, `/md/viewer.js`, etc.
- Assert `GET /` returns 200 and contains a `/assets/` script reference
- Assert opening a `.md` via `/apps/…` returns HTML containing `data-path="…"` and a module script under `/assets/`
- Keep API / companion / watch tests unchanged

Run:

```bash
cd web && npm run build
go test ./internal/server/ ./internal/ui/ -count=1
```

Expected: PASS (skip or delete obsolete `*_node_test.go` that shell out to old JS paths in a follow-up step of this task).

- [ ] **Step 6: Retire Node-via-Go UI tests**

Delete or skip:

- `internal/ui/*_node_test.go`
- `internal/ui/testdata/*.mjs` (optional keep until Task 10 for reference; prefer delete once Vitest ports are green)

Run full:

```bash
go test ./... -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/ui internal/server web README.md
git commit -m "$(cat <<'EOF'
feat(server): serve Vite dist via go:embed

Wire dual-entry React build into the binary and thin MD template.
EOF
)"
```

---

### Task 7: Workbench shell UI (layout + Explorer + Quick Open)

**Files:**
- Modify: `web/src/app/WorkbenchApp.tsx`
- Create: `web/src/features/explorer/ExplorerTree.tsx`
- Create: `web/src/features/quick-open/QuickOpen.tsx`
- Create: `web/src/features/explorer/ExplorerTree.test.tsx`
- Create: `web/src/features/quick-open/QuickOpen.test.tsx`
- Create: `web/src/components/Icon.tsx` (inline SVG icons; no icon library required)
- Create: `web/src/lib/api.ts` (`fetchTree`, `fetchMeta`)

**Interfaces:**
- Consumes: `filter` from `lib/fuzzy`, tree JSON from `GET /api/tree`, meta from `GET /api/meta`
- Produces: user can expand tree, open Quick Open via button / Ctrl|Cmd+E / Ctrl|Cmd+P, select a path callback `onOpenPath(path: string)`

Tree JSON shape (from server): nodes with `name`, `path`, `type` (`file`|`dir`), `children`.

- [ ] **Step 1: Write failing component tests for Quick Open**

Cover: empty query lists recents (max 10); typing filters via `filter`; Arrow/Enter/Escape; click row calls `onOpen`.

- [ ] **Step 2: Implement Quick Open + Tailwind panel (VS Code–like dark chrome)**

Reuse behavior from `internal/ui/app.js` Quick Open section (search the IIFE for `pickerOpen`, `recents`, keydown). Port keyboard handling carefully.

- [ ] **Step 3: Implement ExplorerTree**

- Expanded paths `Set<string>` including `""` root
- Click file → `onOpenPath`
- Collapse via activity bar / sidebar button toggles `sidebar-collapsed` body class equivalent (`className` on shell)

- [ ] **Step 4: Wire `WorkbenchApp` to load `/api/tree` + `/api/meta`**

Show workspace name on Command Center. Watch banner when `watchEnabled === false`.

- [ ] **Step 5: Run unit/component tests + manual smoke**

```bash
cd web && npm test
cd web && npm run build
# terminal A:
go run ./cmd/mino ./example --port 52341
# open http://127.0.0.1:52341/ — tree + quick open work (preview may still be stub)
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): implement explorer and quick open shell"
```

---

### Task 8: PreviewPane + WatchBridge + StatusBar + open-path restore

**Files:**
- Create: `web/src/features/preview/PreviewPane.tsx`
- Create: `web/src/features/watch/useWatchEvents.ts`
- Create: `web/src/features/status-bar/StatusBar.tsx`
- Create: `web/src/features/preview/PreviewPane.test.tsx`
- Modify: `web/src/app/WorkbenchApp.tsx`

**Interfaces:**
- Consumes: `decidePreviewAction`, preview message helpers, `referencedPaths`, open-path helpers, preview-width helpers
- Produces: iframe preview behavior matching `app.js`

Critical behaviors to port from `internal/ui/app.js`:

1. `previewURL(path)` → `/apps/${encodeURIComponent segments}?t=${Date.now()}` for navigate
2. Same-path click → `decidePreviewAction` → `skip`
3. MD → MD with displayed MD → `in-place` → `postMessage(previewNavigateMessage|previewReloadMessage)`
4. HTML change / force → set iframe `src`
5. `sessionStorage` write on open; restore once via `createOpenPathRestore` after first tree load
6. `EventSource("/api/events")` handlers for file add/remove/change and `asset-changed` / `asset-removed`
7. Companion scan: fetch open file source, `referencedPaths`, reload on match
8. Status bar width menu posts `previewWidthMessage` into iframe; listens for ready/error messages

- [ ] **Step 1: Unit-test pure wiring where possible** (decidePreviewAction already covered); component-test StatusBar width write + message shape

- [ ] **Step 2: Implement PreviewPane iframe + message listeners**

```tsx
// Essential listener shape
useEffect(() => {
  function onMessage(event: MessageEvent) {
    const parsed = parsePreviewMessage(event.data, event.origin, window.location.origin);
    if (parsed) {
      /* update displayedPath on preview-ready; handle preview-error */
      return;
    }
    const width = parsePreviewWidthMessage(event.data, event.origin, window.location.origin);
    if (width) {
      /* optional ack path — shell is source of truth for menu */
    }
  }
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}, []);
```

- [ ] **Step 3: Implement watch + asset reload**

Port generation counters (`listingRequestId`, `assetScanGen`) to avoid stale updates.

- [ ] **Step 4: Manual verify against example/**

- Open `hello.html`, `docs/sample.md`
- Edit a file on disk → tree/preview update
- Edit `example/tools/styled.css` while `styled.html` open → reload

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): wire preview iframe, watch, and status bar"
```

---

### Task 9: Markdown viewer React app (render pipeline + TOC + Mermaid)

**Files:**
- Modify: `web/src/md/MarkdownViewer.tsx`
- Create: `web/src/md/Toc.tsx`
- Create: `web/src/md/MermaidBlock.tsx` (React wrapper around `lib/mermaid-block`)
- Create: `web/src/md/MarkdownViewer.test.tsx`
- Port behavior from: `internal/ui/md/viewer.js`

**Interfaces:**
- Consumes: preprocess, marked, DOMPurify, highlight.js, katex, mermaid, toc, preview-session, preview-width
- Produces: viewer document that responds to `preview-navigate` / `preview-reload` and emits `preview-ready` / `preview-error`

- [ ] **Step 1: Implement fetch + paint with generation guard**

```ts
async function loadPath(rel: string, gen: number, currentGen: () => number) {
  const res = await fetch("/api/raw/" + encodePath(rel), { cache: "no-store" });
  if (gen !== currentGen()) return;
  if (!res.ok) {
    parent.postMessage(previewErrorMessage(rel), window.location.origin);
    /* show error UI */
    return;
  }
  const text = await res.text();
  if (gen !== currentGen()) return;
  /* preprocess → marked → purify → highlight/katex → mermaid blocks → toc */
  parent.postMessage(previewReadyMessage(rel), window.location.origin);
}
```

- [ ] **Step 2: Listen for parent messages** (`preview-navigate`, `preview-reload`, `md-preview-width`) exactly as `viewer.js` does

- [ ] **Step 3: Wire TOC (h1–h3), width attribute `data-md-width`, Mermaid Code/Preview/Fullscreen**

Use Tailwind for layout; keep interaction parity (narrow TOC collapsed, Escape closes fullscreen).

- [ ] **Step 4: Component tests for navigate generation drop + width message**

- [ ] **Step 5: Build + manual MD smoke in iframe via mino**

```bash
cd web && npm run build
go run ./cmd/mino ./example --port 52341
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): implement React markdown viewer pipeline"
```

---

### Task 10: Delete vanilla UI sources and finish server cleanup

**Files:**
- Delete: `internal/ui/app.js`, `style.css`, `index.html` (old), `fuzzy.js`, `open-path.js`, `preview-session.js`, `asset-refs.js`, entire `internal/ui/md/` vanilla tree including `vendor/`
- Keep: `embed.go`, `dist/**`, `viewer_template.html` (generated), any remaining Go tests under `internal/ui` that still apply
- Modify: any leftover references in docs/tests

- [ ] **Step 1: Search for stale paths**

```bash
rg -n "app\\.js|/fuzzy\\.js|md/vendor|MinoFuzzy" --glob '!web/**' --glob '!docs/**'
```

Expected: only historical docs or nothing in code.

- [ ] **Step 2: Delete vanilla files; ensure `npm run build` + `go test ./...` still pass**

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(ui): remove vanilla JS UI after React cutover"
```

---

### Task 11: Playwright E2E parity suite

**CANCELLED (2026-09-21):** user opted out of Playwright E2E; Vitest covers unit/component tests. Behavior parity remains manual / covered by existing Go integration tests where applicable.

**Files:**
- Create: `web/playwright.config.ts`
- Create: `web/e2e/workbench.spec.ts`
- Create: `web/e2e/markdown.spec.ts`
- Create: `web/e2e/helpers.ts` (start `go run ./cmd/mino ./example --port 0`, parse printed URL)

**Interfaces:**
- Consumes: built binary UI via real server
- Produces: automated coverage of the spec parity checklist

- [ ] **Step 1: Configure Playwright**

`web/playwright.config.ts`: `testDir: "./e2e"`, timeout generous enough for Go boot + Vite-less embedded UI.

- [ ] **Step 2: Helper to spawn mino**

```ts
import { spawn } from "node:child_process";
import path from "node:path";

export async function startMino(): Promise<{ baseURL: string; stop: () => void }> {
  const repo = path.resolve(__dirname, "../..");
  const child = spawn("go", ["run", "./cmd/mino", "./example", "--port", "0"], {
    cwd: repo,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseURL = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mino start timeout")), 30000);
    function onData(buf: Buffer) {
      const text = buf.toString();
      const m = text.match(/https?:\/\/[^\s]+/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0].replace(/\/$/, ""));
      }
    }
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", reject);
  });
  return {
    baseURL,
    stop: () => {
      child.kill("SIGTERM");
    },
  };
}
```

Ensure `npm run build` ran before e2e so embed has current UI.

- [ ] **Step 3: Write specs covering parity checklist**

Minimum cases:

1. Tree lists `hello.html`; click opens iframe with hello content
2. Quick Open: Ctrl+P, type `timer`, Enter opens tools/timer.html
3. Open MD `docs/sample.md`; TOC visible on wide viewport; width menu changes `data-md-width` inside iframe
4. Refresh restores last path from sessionStorage
5. Companion: open `tools/styled.html`, touch `tools/styled.css`, expect iframe reload (wait for load event / content marker)
6. Watch banner: optional test with watcher disabled if easy to force; otherwise document manual check

- [ ] **Step 4: Run E2E**

```bash
cd web && npm run build && npx playwright install && npm run test:e2e
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "test(web): add Playwright parity suite for React UI"
```

---

### Task 12: README + contributor workflow polish

**Files:**
- Modify: `README.md`
- Create: `web/README.md` (scripts: dev with proxy, build, Vitest)

- [ ] **Step 1: Document required build before `go run` / release**

```md
### UI build

The browser UI is a Vite app in `web/`. Before `go run` / `go install` from a clean tree:

```sh
cd web && npm ci && npm run build
```

`npm run build` writes into `internal/ui/dist` (embedded by Go).
```

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: document React UI build workflow"
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Vite + React + TS + Tailwind, no component lib | 1, 7–9 |
| Dual entry workbench + MD viewer | 1, 9 |
| `go:embed` via `internal/ui/dist` (no `..`) | 1, 6 |
| Thin MD template + `data-path` | 6, 9 |
| Port pure libs with tests | 2–5 |
| Explorer / Quick Open / preview / watch / status | 7–8 |
| Preserve storage keys + shortcuts | 7–8 |
| Preserve postMessage preview protocol | 8–9 |
| Drop vanilla + old routes | 6, 10 |
| Vitest | 2–5, 7–9 |
| Playwright E2E | cancelled / out of scope (Task 11) |
| README build step | 12 |
| Behavior parity checklist | manual in 8–9 (+ Go integration where applicable) |

**Clarification vs brainstorming prose:** the design said “do not introduce postMessage”; implementation **preserves the existing** `source: "mino"` protocol already used by `preview-session.js` / `viewer.js` / `preview-width.js`.

**Open choices locked by this plan:** Vite `outDir` = `internal/ui/dist`; MD path via `data-path` + generated `viewer_template.html` from Vite manifest; Tailwind v4 via `@tailwindcss/vite`.
