# Mino Companion Assets Design

**Date:** 2026-08-30  
**Status:** Approved for planning  
**Scope:** Serve allowlisted companion files next to HTML apps and Markdown notes; reload the open preview when a directly referenced asset changes  
**Approach:** Extend `GET /apps/` after catalog HTML/Markdown; scan the open document’s source for direct references; SSE `asset-changed` / `asset-removed`

## Problem

Mino only serves catalogued `.html` / `.htm` / `.md`. Relative CSS, JavaScript, images, and fonts next to those files 404. README documents this as a limitation. HTML apps that are not a single file do not run, and Markdown relative images stay broken.

The workspace is already trusted: previewed HTML is unsandboxed on the same origin. The gap is not a new trust model; it is that relative URLs under `/apps/` have nothing to fetch.

## Goals

1. Relative companion URLs from an open HTML app or Markdown viewer resolve under `/apps/` when the target is an allowlisted workspace file.
2. Explorer, Quick Open, and `GET /api/tree` still list only catalog HTML and Markdown.
3. Dot-segment paths, ignore rules, non-allowlisted extensions, and path escape remain unreadable (404).
4. When the currently open HTML or Markdown file **directly** references an asset, a change or removal of that file force-reloads the preview (existing `openFile(path, true)`).
5. Changing an unreferenced asset, or a file only mentioned inside a referenced CSS `url()`, does not reload.

## Non-Goals

- Listing assets in Explorer or Quick Open, or previewing an asset as its own catalog entry
- Mapping site-root URLs (`/images/x.png`) onto the workspace
- Parsing CSS (or other fetched files) for transitive `url()` / `@import`
- `srcset`, dynamically concatenated URLs, or excluding fenced-code false positives
- In-app create/rename/delete/edit, full-text search, tabs, command palette
- Changing `/api/raw/` (still Markdown-only)
- Browser automation tests

## Approach (chosen)

**Extend `/apps/` with an allowlist step. Scan the open file in the workbench. Watcher emits asset SSE without mutating the catalog.**

Relative URLs keep normal browser resolution: `/apps/tools/timer.html` plus `./style.css` is `GET /apps/tools/style.css`. The Markdown viewer document is `/apps/docs/sample.md`, so `![](photo.png)` is `GET /apps/docs/photo.png`. No HTML injection, no `<base>`, no Markdown `src` rewrite.

Alternatives considered:

1. **Extend `/apps/` + scan open source (chosen)** — Relative URLs work unchanged; reference set is testable; no reverse index on the server.
2. **New `/files/` prefix + rewrite or `<base>`** — Isolates routes, but HTML `<base>` and Markdown rewrite break existing documents and scripts.
3. **Track actual GETs (Referer / session)** — Covers CSS-internal URLs and dynamic paths; needs per-tab server state and mishandles cache hits. Too much for this round.

## Routing

`GET /apps/<rel>` (after Host check), first match wins:

1. `NormalizeRel` fails or `rel` is empty → 404 (unchanged traversal rules).
2. Catalog HTML → existing `serveAppFile`.
3. Catalog Markdown → existing viewer HTML (never the raw `.md` bytes).
4. Allowed companion asset → `OpenRoot` + `ServeContent` (same open/stat pattern as HTML apps).
5. Else → 404.

Catalog membership is unchanged: `IsEntry` remains `.html` / `.htm` / `.md` only. Assets are never inserted into `catalog.files`.

Direct navigation to `http://127.0.0.1:<port>/apps/tools/style.css` returns the file, the same way opening an HTML app URL skips the workbench shell.

## Allowed assets

A path is an allowed asset only if **all** of the following hold:

- Normalized relative path under the workspace root
- Regular file
- Not ignored (built-in `.mino` / `.git` / `.hg` / `.svn` / `node_modules`, including nested copies, plus `config.toml` `ignore`)
- **No path segment starts with `.`** (blocks `.env`, `.gitignore`, `dir/.secret.png`; `foo.bar/baz.png` is fine)
- Extension is the last suffix after the final `.`, compared case-insensitively, and is one of:

`png` `jpg` `jpeg` `gif` `webp` `svg` `ico` `css` `js` `mjs` `woff` `woff2` `ttf` `otf` `json` `wasm`

Not allowed as assets: `.html` / `.htm` / `.md` (stay on catalog steps), source maps, audio/video, and anything else.

Failed checks, missing files, and non-regular files all return **404**, not 403, so existence is not distinguished from policy.

Package `internal/asset` owns allowlist, dot-segment, and `Allowed(rel, ignore matcher)` so server and watcher share one implementation. It does not own catalog membership.

### Headers (asset responses only)

- `X-Content-Type-Options: nosniff` (same as existing `/apps/`)
- `Cache-Control: no-store` so a force-reload after CSS/image change does not keep a cached body
- `Content-Type` from `ServeContent` / extension, unchanged from HTML apps

Catalog HTML responses are not required to gain `no-store` in this spec.

## Watcher and SSE

Today `ApplyFSChange` ignores non-entry writes (and `removeLocked` is a no-op for paths never in the catalog), so CSS edits emit nothing.

After the catalog update:

- If the path is an allowed asset and the fs event is create or write → publish `catalog.Event{Kind: "asset-changed", Path: rel}` **without** adding to `catalog.files`.
- If the path is an allowed asset and the fs event is remove or rename → `asset-removed`.
- Ignored / dot-segment / non-allowlist paths still emit nothing.
- Catalog HTML/Markdown still emit `added` / `removed` / `changed` only.

Reuse `catalog.Event` and the existing Hub JSON `{ "path": "<rel>" }`. Add `catalog.EventAssetChanged` and `catalog.EventAssetRemoved` (`"asset-changed"` / `"asset-removed"`). The SSE event **name** is that kind.

Create and write are both `asset-changed`. The UI does not need added vs changed.

## Workbench: reference set and reload

The server does not build a reverse index. The shell keeps a `Set` of workspace-relative paths referenced by the **currently open** catalog file.

**Rescan** when `openFile` takes an action other than `skip` (navigate or in-place, including `force`). Use a generation counter so a stale fetch cannot overwrite a newer file’s set.

**Do not rescan** on `skip`.

**Clear** the set in `clearPreview`.

Source:

- Markdown: `GET /api/raw/<rel>` (existing)
- HTML: `GET /apps/<rel>` (the app source)

Fetch failure → empty set. Preview still opens. Only the open file’s own `changed` SSE reloads, as today.

### Extracting URLs from source

Scan the whole text (comments and fences included; false positives are accepted):

- Attributes `src`, `href`, `poster` (quoted or unquoted)
- `url(...)`
- `@import "..."` / `@import url(...)`
- Markdown `![](url)` and `[](url)`

Not extracted: `srcset`, CSS nested inside a file that is not the open document.

### Resolving to a workspace path

Relative to the open file’s directory (POSIX):

1. Strip `?query` and `#fragment`.
2. Skip empty; `http:` / `https:` / `data:` / `mailto:` / `javascript:`; protocol-relative `//`; hash-only.
3. If the path starts with `/apps/`, strip that prefix and URI-decode.
4. If it starts with `/` but not `/apps/` → skip (no site-root mapping).
5. Otherwise join with `path.dirname(openFile)` and normalize; drop if it escapes the workspace root.

Store the resolved relative path. Do **not** client-filter by allowlist: non-assets never receive `asset-*` events.

### SSE in the shell

Existing `added` / `removed` / `changed` handlers are unchanged (`loadTree`, recents, preview when `event.path === currentPath`).

New listeners for `asset-changed` and `asset-removed`:

- Do **not** `loadTree()`
- Do **not** change recents
- If there is an open catalog file and `event.path` is in the reference set → `openFile(currentPath, true)` (Markdown in-place reload; HTML navigates, still hide-until-ready)
- Otherwise ignore

`asset-removed` of a referenced image still force-reloads so the preview shows a broken image.

No open file → ignore `asset-*`.

### Helper

UMD module `internal/ui/asset-refs.js` (global `MinoAssetRefs`): extract + resolve. Node tests in `internal/ui/testdata/`. `app.js` owns fetch, generation, the live `Set`, and SSE.

## Security

Unchanged: loopback default, Host check, `OpenRoot`, normalize against `..`.

This spec **does** expose more same-origin bytes than before (allowlisted files under `/apps/`). That matches the existing HTML-app model: a previewed page can already call `/api/*` and `/apps/*` for catalog files. Assets remain limited by ignore, dot-segments, and the extension list. `/api/raw/` stays Markdown-only.

Markdown sanitization still forbids `script` / `iframe` in note bodies; companion JS is for HTML apps, not the Markdown viewer. Viewer CSP already allows `img-src 'self'`; relative images hit `/apps/` on the same origin. Do not change CSP in this spec.

README: trusted-workspace warning stays; document the allowlist and that companion files are same-origin.

## Error handling

| Situation | Behavior |
|-----------|----------|
| Missing / non-regular / policy miss | 404 |
| Catalog HTML/MD vs asset | Catalog steps always win |
| Source fetch for scan fails | Empty reference set; preview still opens |
| Watcher disabled | Banner as today; assets still `GET`; edits need a manual refresh |
| `asset-*` with empty preview | Ignore |
| Stale scan response | Discard |
| Broken `<img>` / CSS after 404 | Browser default; no workbench banner |
| Escape / ignored / dot-segment | 404, no extra log requirement |

## Architecture / file impact

| File | Change |
|------|--------|
| `internal/asset` (new) | Allowlist, dot-segment, `Allowed` |
| `internal/catalog` | `EventAssetChanged` / `EventAssetRemoved` constants only; no files-map changes |
| `internal/server/server.go` | `/apps/` step 4; asset headers; `GET /asset-refs.js` |
| `internal/watcher/watcher.go` | Emit `asset-changed` / `asset-removed` |
| `internal/ui/asset-refs.js` | Extract + resolve |
| `internal/ui/app.js` | Fetch/scan; `asset-*` SSE; no `loadTree` on those events |
| `internal/ui/index.html` | Script tag for `asset-refs.js` |
| `internal/ui/embed.go` | Embed the new script |
| Tests | See Testing |
| `example/` | Minimal HTML+CSS and Markdown+image |
| `README.md` | Replace “companion assets are not served” with allowlist + ignore/dot-file rules |

`GET /api/search` stays unused by the UI (out of scope). Preview-session `force` behavior is unchanged.

## Testing

**Go unit:** `Allowed` true/false for each allowlist extension, case-insensitive extensions (`foo.PNG`, `foo.CSS`), `dir/.hidden/x.png`, ignore, `../` escape, catalog HTML/MD not classified as assets.

**Watcher:** writing `tools/app.css` emits `asset-changed` and does not add it to the tree; writing `tools/timer.html` still emits `changed`; `.env` and `main.go` emit nothing.

**Server:** `GET /apps/tools/app.css` 200 + `Cache-Control: no-store`; `GET /apps/dir/.secret.png` 404; `GET /apps/notes/secret.go` 404; `GET /apps/docs/sample.md` still the viewer; traversal 404.

**Node:** resolver cases: `./a.png`, `../shared/a.css`, `/apps/docs/a.png`, skip `https://`, `data:`, `/foo.png`; extract `url()`, `@import`, Markdown image and link.

**Integration:** temp root HTML with `<link href="app.css">` and Markdown with `![](pic.png)`; those `/apps/` URLs return the files; SSE client sees `asset-changed` after rewriting the CSS.

**Manual:** `mino ./example` — tree still html/md only; HTML styles apply; Markdown image shows; edit the referenced CSS → preview reloads; edit an unreferenced image elsewhere → no reload.

## Success criteria

1. HTML relative `css` / `js` / images load; Markdown relative images display.
2. Tree and Quick Open contain only `.html` / `.md`.
3. Dot-segment paths, ignore matches, and non-allowlisted extensions 404.
4. Directly referenced asset change or removal force-reloads the open preview; unrelated assets do not.
5. README describes the allowlist and remaining limits (no site-root mapping, no CSS-internal URL reload).

## Spec notes (supersedes)

- `2026-08-20-mino-design.md` and `2026-08-22-mino-markdown-preview-design.md` listed companion assets as a non-goal. This spec replaces that for the allowlisted extensions only.
- Markdown preview spec: “relative images are not served; broken images are expected” is no longer true for allowlisted files reachable by relative or `/apps/` URLs.
- `2026-08-29-mino-single-iframe-preview-update-design.md`: `force` still means SSE `changed` on the open file **or** this spec’s referenced `asset-*` reload. No new preview kind.
