# Mino React + TypeScript Frontend Redesign

**Date:** 2026-09-19  
**Status:** Approved for planning  
**Scope:** Replace the embedded vanilla JS workbench and Markdown viewer with React + TypeScript  
**Approach:** Single Vite package, dual entry points, Tailwind (no component library), build into `internal/ui/dist` for `go:embed`

## Problem

The browser UI lives under `internal/ui/` as hand-written JS (~2700 lines), global scripts, and hand-served asset routes. It works, but lacks types, component boundaries, and a modern build pipeline. Extending the VS Code–like shell and Markdown viewer is increasingly costly, and existing Go tests that string-match `viewer.js` couple the server to UI implementation details.

## Goals

1. **Behavior-equivalent migration** of the workbench shell and Markdown viewer to React + TypeScript.
2. Introduce **Vite + TypeScript** engineering (lint-ready structure, Vitest, Playwright E2E).
3. Keep the **single-binary** delivery model: build frontend → `go:embed` → serve from Go.
4. Restyle with **Tailwind** (visual fine-tuning allowed; interactions, shortcuts, and storage keys align with current behavior).
5. Use **pure React + Tailwind** only — no shadcn, Radix, or other UI component libraries.
6. Preserve backend catalog / watch / apps / raw API semantics.

## Non-Goals

- Backend feature changes (catalog rules, companion allowlist, host binding, auth)
- Component libraries (shadcn/ui, Radix, MUI, etc.)
- Pixel-perfect match to the current CSS
- Theme switcher / light theme
- Tabbed multi-file preview, resizable sidebar, plugin system
- Changing HTML app preview security model (same-origin iframe, no sandbox)
- Introducing a postMessage protocol between shell and viewer (unless already present — it is not)

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| Priority | Behavior-equivalent first; maintainability, extensibility, and tooling in the same pass |
| Scope | Workbench + Markdown viewer fully migrated |
| Build / ship | Vite → static `dist`; Go embeds dist; publish requires frontend build |
| Styling | Tailwind rewrite; interaction parity over pixel parity |
| Preview hosting | HTML and MD both in the preview iframe; MD viewer is a second Vite entry from the same package |
| Components | Pure React + Tailwind |
| Testing | Vitest (unit + components) + Playwright E2E; Go UI string probes rewritten |

## Architecture

### Layout on disk

```text
web/
  index.html                 # workbench entry
  md/viewer.html             # markdown viewer entry (iframe document)
  src/
    main.tsx                 # mount workbench
    md/viewer-main.tsx       # mount viewer
    app/                     # shell layout composition
    components/              # presentational React + Tailwind
    features/                # explorer, quick-open, preview, status-bar, watch
    lib/                     # pure, unit-tested helpers
    styles/                  # Tailwind entry / tokens
  dist/                      # vite outDir (may be gitignored locally)
internal/ui/
  embed.go                   # //go:embed dist/**
  dist/                      # build copies (or vite outDir) here — go:embed cannot use ..
  # vanilla JS/CSS/HTML removed after cutover
```

`go:embed` forbids `..` path segments, so the embeddable tree must live under `internal/ui/` (typically `internal/ui/dist`). The Vite `outDir` is set to that folder, or a short `npm run build` step syncs `web/dist` → `internal/ui/dist`.

### Runtime

- **Workbench SPA** owns Explorer, Command Center / Quick Open, activity bar, breadcrumbs, status bar, watch banner, and the preview iframe.
- **HTML apps** load in the iframe at `/apps/<path>` (unchanged).
- **Markdown** loads the viewer document in the same iframe. Go continues to treat `.md` under `/apps/` as a viewer HTML response (not raw markdown). Path injection uses a **thin HTML template** that sets `data-path="{{.Path}}"` on the content root and links Vite-hashed assets — preserving current `preview-session` same-document update semantics without a new postMessage protocol.
- Live reload, companion-asset reload, `sessionStorage` key `mino-open-path`, and `localStorage` key `mino-md-preview-width` keep current semantics.

### Build and serve

- Dev: Vite for the UI; Go still serves APIs and `/apps/`. Publish / `go run` of the embedded UI expects a prior `npm run build` that refreshes `internal/ui/dist` (CI builds before `go test` / release).
- Go drops per-file routes (`/app.js`, `/fuzzy.js`, …) and serves the embedded Vite output (`/`, `/assets/*`, viewer assets). `/md/vendor/*` retires as libraries move to npm and the viewer bundle.
- CSP for the viewer stays strict (`script-src 'self'` preferred); adjust only as needed for the hashed Vite bundles.

## Components and data flow

### Workbench units

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `WorkbenchShell` | Layout chrome | child features |
| `ExplorerTree` | Tree render, expand/collapse, open file | `/api/tree`, expand state |
| `QuickOpen` | Fuzzy filter, recents, keyboard nav | `lib/fuzzy`, file index, recents |
| `PreviewPane` | iframe, breadcrumb, empty state; HTML reload vs MD in-document update | `lib/preview-session`, `lib/open-path`, `lib/asset-refs` |
| `StatusBar` | MD width menu (标宽 / 较宽 / 全宽); hidden controls when not MD | `lib/preview-width` + `localStorage` |
| `WatchBridge` | `EventSource /api/events` → tree / preview / companion / banner | `/api/meta`, `/api/events` |

### State

- Local React state and small `useReducer`s for listing, picker, and preview path. No external client store library in v1.
- Pure logic stays in `lib/` so Vitest can own parity with today’s node / `*_node_test.go` coverage.

### Markdown viewer units

- `MarkdownViewer`: fetch `/api/raw/…` → preprocess → GFM → DOMPurify → highlight / KaTeX / Mermaid / TOC.
- Mermaid block modes, outline (TOC), and preview width remain dedicated components/hooks with current behavior (including fullscreen viewBox camera).
- Stale request generations continue to drop outdated paints.

### Data flow

```text
/api/tree ──► file index + tree ──► Explorer / Quick Open
/api/meta + /api/events ──► WatchBridge ──► tree / PreviewPane / banner
user opens path ──► PreviewPane sets iframe
  HTML ──► /apps/<path>
  MD   ──► viewer HTML (templated path) ──► /api/raw/<path> ──► render
```

## Error handling

- Listing/meta failures: keep last good tree; surface banner when watch is unavailable; no blank crash.
- Watch failure or `watchEnabled=false`: show the existing “refresh manually” banner pattern.
- MD fetch/render failure: in-viewer error region; clear on next successful path/update; honor generation guards.
- Unreadable iframe location: treat as empty path (no throw into shell UI).

## Testing

| Layer | Tool | Coverage |
|-------|------|----------|
| Pure logic | Vitest | fuzzy, open-path, asset-refs, preview-session, preprocess, toc, preview-width, … |
| Components | Vitest + Testing Library | Quick Open keyboard, explorer open, status width, TOC/Mermaid key states |
| E2E | Playwright | real `mino` + `example/`: open HTML/MD, live reload, companion CSS reload, refresh keeps path, Quick Open recents, width persistence |
| Go | existing + rewritten | API/catalog/watch retained; drop or rewrite UI string probes that assert old `viewer.js` / asset filenames |

## Migration notes

1. Scaffold `web/` (Vite React-TS, Tailwind, dual inputs).
2. Port `lib/` with tests first (behavior lock).
3. Rebuild shell features against real APIs; point `embed.go` at `dist`.
4. Port Markdown viewer entry; switch Go MD response to thin template + Vite assets.
5. Remove vanilla `internal/ui` sources and obsolete routes.
6. Expand Playwright until parity checklist below is green.

### Behavior parity checklist (must pass)

- Explorer list/open; sidebar collapse via activity bar
- Command Center / Ctrl|Cmd+E / Ctrl|Cmd+P Quick Open (including while iframe focused); Escape dismiss; empty query = recents (≤10)
- HTML preview in iframe; re-click same file does not reload; HTML file change reloads; companion CSS change reloads open HTML
- MD opens reuse viewer document when appropriate; MD file change refetches in place; removal clears preview
- Refresh restores `mino-open-path`; new tab on `/` starts empty
- MD width options + `mino-md-preview-width` persistence
- TOC, Mermaid code/preview/fullscreen camera, KaTeX, highlight
- Watch banner when live reload unavailable

## Open implementation choices (fixed in plan, not blockers)

- Exact Vite `base` / asset public paths so Go and iframe resolve hashed files cleanly
- Whether Vite `outDir` is `internal/ui/dist` directly or a copy step from `web/dist`
- How the MD viewer HTML template is produced (Go `html/template` over a built HTML shell vs a tiny Go-only wrapper that references hashed asset names from a manifest)
