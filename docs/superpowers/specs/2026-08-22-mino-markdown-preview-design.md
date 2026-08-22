# Mino Markdown Preview Design

**Date:** 2026-08-22  
**Status:** Approved for planning  
**Form:** Extend existing Go CLI + embedded UI; catalog + iframe preview for `.md`

## Problem

Mino only lists and iframe-previews `.html` / `.htm`. Workspaces often also contain Markdown notes and docs that users want to browse and read in the same tree, without leaving Mino or opening an external viewer.

## Goals

1. Include `.md` files in the catalog tree and path/filename search (same ignore rules as HTML).
2. Opening a `.md` file shows a readable rendered preview in the existing iframe slot.
3. Support GFM plus: code syntax highlighting, math (KaTeX), and Mermaid diagrams.
4. Sanitize raw HTML embedded in Markdown (strip dangerous tags/attributes); do not treat MD as a runnable app.
5. Ship all viewer libraries via `go:embed` (fully offline).
6. Preserve existing HTML app preview, SSE live reload, and security model.

## Non-Goals

- Serving companion assets for Markdown (relative images, linked CSS/JS, etc.) — broken relative images are acceptable in this version
- `.markdown` or other alternate extensions (only `.md`)
- Full-text search of Markdown body content
- In-app Markdown editing
- Server-side Markdown-to-HTML as the primary render path
- Separate non-iframe preview pane for MD vs HTML
- Theme picker / plugin marketplace
- CDN loading of viewer dependencies

## Approach (chosen)

**Catalog includes `.md`; preview uses an embedded Markdown viewer shell in the iframe.**

Alternatives considered:

1. **Viewer shell in iframe (chosen)** — UI keeps one open path (`/apps/<path>`); Mermaid/KaTeX/highlight stay in the browser; closest to current architecture.
2. **Server-side convert to HTML** — split pipeline (Go GFM + client Mermaid/math); more complexity for little gain given full client embed.
3. **Inline article in main UI for MD only** — two open paths; more SSE/UI branching; diverges from “preview = iframe”.

## Architecture

```text
CLI → Config → Catalog (.html/.htm + .md) → HTTP Server
                    ↑                            │
                 Watcher ────────────────────────┤
                                                 ▼
                      UI: tree + search unchanged
                      iframe:
                        · HTML → /apps/<path> (raw file)
                        · MD   → /apps/<path> (viewer HTML shell)
                                 → fetch /api/raw/<path> (text/plain)
```

| Module | Change |
|--------|--------|
| Catalog | Treat `.md` as a catalog entry (extend entry check beyond HTML-only) |
| Watcher / SSE | No protocol change; `.md` emits added/changed/removed like HTML |
| Server `/apps/` | HTML: `ServeContent` as today; `.md`: return embedded viewer HTML (`text/html`) |
| Server `/api/raw/` | New: serve Markdown source as `text/plain; charset=utf-8` for catalog `.md` only |
| UI (`app.js`) | Keep `/apps/<path>?t=…` and iframe reload on `changed`; no extension branching required |
| embed | Viewer page + vendored parser/sanitizer/highlight/KaTeX/Mermaid |

## Routing and data flow

1. Main UI sets `iframe.src = /apps/<rel>?t=<cachebust>` for both HTML and Markdown.
2. `GET /apps/<rel>` for a catalog `.md` returns the **viewer shell**, not raw Markdown (browsers do not render `text/markdown` as a document).
3. The shell HTML embeds the requested relative path (e.g. a `data-path` attribute or inline bootstrap constant derived from the same normalized `rel` used for catalog lookup). The viewer must not trust a client-supplied path that differs from what the server authenticated for this response.
4. Viewer loads embedded scripts/styles from fixed Mino UI routes (same pattern as `/app.js` / `/style.css`, e.g. `/md/viewer.js` and vendor assets under `/md/…`), then `fetch`es `GET /api/raw/<rel>` for the source using the server-provided path.
5. On SSE `changed` for the open path, main UI reloads the iframe; viewer restarts and re-fetches raw (same as HTML hot reload).

**HTML unchanged:** `.html` / `.htm` continue to be served as the file body via `ServeContent`. `/api/raw/` does **not** expose HTML.

**404 rules:** Missing from catalog, wrong extension, path escape, or non-regular file → 404 for both `/apps/` and `/api/raw/`.

## Rendering pipeline

Fixed order inside the viewer:

1. Fetch `/api/raw/<path>` → Markdown string.
2. Parse as **GFM** → HTML string (tables, task lists, strikethrough, autolinks, etc.).
3. **DOMPurify** sanitize → safe HTML.
4. Inject into the preview container.
5. Post-process on the sanitized DOM:
   - Fenced code blocks → syntax highlight
   - Math: require `$…$` and `$$…$$`; also support `\(` / `\[` via the KaTeX integration chosen in the implementation plan. Display `\[` / `\]` delimiters must appear on their own lines (so academic citations like `\[1\]` stay literal); inline `\(...\)` remains supported.
   - ` ```mermaid ` fences → Mermaid → SVG

Per-block failures (one Mermaid/KaTeX/highlight error) show a short placeholder for that block; the rest of the document still renders. Fetch/parse failures show a short page-level error state.

### Library choices (all vendored + embed)

| Capability | Library | Notes |
|------------|---------|--------|
| GFM | `marked` + GFM extensions (or equivalent) | Browser-side; easy plugin hookup |
| Sanitize | `DOMPurify` | Matches “sanitize HTML” policy |
| Highlight | `highlight.js` (common-language subset) | Keep bundle size bounded; dark reading theme |
| Math | `KaTeX` including fonts | Lighter than MathJax; fonts embedded |
| Diagrams | `mermaid` | Largest dependency; binary size increase accepted |

Pin versions under something like `internal/ui/vendor/` (or a build-generated embed tree). No runtime CDN.

### Viewer chrome

- Dedicated reading stylesheet, visually compatible with the dark workbench; independent of HTML app styles inside other iframes.
- External `http(s):` links open in a new tab (`target=_blank`, `rel=noopener noreferrer`).
- Workspace-relative links are not turned into in-app file navigation in this version.
- Relative images are not served; broken images are expected.

## Error handling

| Case | Behavior |
|------|----------|
| `.md` missing / unreadable | 404 from `/apps/` and `/api/raw/`; main UI clears preview if the open file was removed (existing behavior) |
| Raw fetch failure | Viewer error state |
| Oversized files | No new size limit (same as HTML); read failure → error state |
| Single block render failure | Placeholder for that block; document continues |
| Watcher `changed` | Iframe reload → full re-render |

## Security

- Keep: bind `127.0.0.1` by default, Host checks, catalog-only paths, `OpenRoot` / normalize against traversal.
- Markdown is **not** served as a same-origin executable app document: the iframe document is the Mino viewer; body HTML is sanitized.
- Dangerous schemes (e.g. `javascript:`) rejected by sanitize policy.
- `/api/raw/` is limited to `.md` so arbitrary workspace files are not exposed as plain text.
- README security note: Markdown preview still assumes a trusted workspace; sanitization reduces risk but is not multi-tenant isolation.

## Testing

- **Catalog:** `.md` indexed; built-in and config ignores apply; non-`.md` text files excluded.
- **Server:** `/apps/*.md` returns viewer HTML; `/api/raw/*.md` returns source; HTML regression; traversal and missing → 404.
- **Integration:** tree/search include `.md`; SSE added/changed for `.md`.
- **Viewer:** unit-test small helpers (extension branching / raw URL construction) where extracted; full GFM+Mermaid covered primarily by a manual checklist (optional light HTML marker checks in Go tests). No requirement for browser automation in v1.

## Success criteria

1. Workspace `.md` files appear in the tree and path search.
2. Clicking a `.md` file shows GFM + highlight + math + Mermaid in the iframe.
3. Dangerous HTML in Markdown is stripped; offline use works with no CDN.
4. Editing the open `.md` on disk refreshes the preview via existing SSE reload.
5. HTML app preview behavior is unchanged.

## Documentation updates (implementation follow-up)

- README: mention `.md` browsing/preview; note no companion assets for MD; update security blurb for sanitized Markdown preview.
- Example workspace: optional sample `.md` demonstrating GFM, code, math, and Mermaid (nice-to-have, not blocking).
