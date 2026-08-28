# Mino Single-Iframe Preview Update Design

**Date:** 2026-08-29  
**Status:** Approved for planning  
**Scope:** Stop preview flicker when opening or live-reloading a file, using one iframe  
**Approach:** Preview-kind table + skip / in-place / navigate; in-place viewers fetch then swap DOM; navigations hide the iframe on a dark pane until ready

## Problem

Clicking a catalog file always assigns `#preview.src` with a new `?t=` cache-buster, including a second click on the file already shown. The iframe document unloads immediately. The iframe element is painted `#ffffff`, so HTML and Markdown both flash white before the next document paints. Markdown then stays empty until `viewer.js` fetches and renders, which is a second flash.

The same assignment runs on SSE `changed` for the open file.

A single iframe cannot keep one live document on screen while loading another. Dual iframes and moving Markdown out of the iframe are out of scope. The workbench will still add more preview types later, so the open/reload path must not hard-code `.md` vs `.html`.

## Goals

1. Clicking the already-open file does not reload the iframe or flash.
2. Markdown → Markdown (click or live reload) reuses the viewer document: old body stays until the new body (or page-level error) is ready.
3. When `src` must change (HTML, kind change, first open): show the workbench dark background until the new preview is ready — no white flash.
4. Adding a preview type is a kind-table row (and a viewer that speaks the protocol if it supports in-place). `openFile` / SSE do not grow new `if (md)` branches.
5. Empty state, SSE `removed`, Markdown width, Quick Open hotkeys, and same-tab path restore stay as they are.

## Non-Goals

- Two iframes / screenshot overlay / keeping a previous HTML app alive while another loads
- Rendering Markdown (or other types) in the workbench shell instead of the iframe
- Persisting TOC position, Mermaid mode/zoom, or HTML app state across a path change
- Changing catalog, watcher, `/apps/*` routing, or `/api/raw/*`
- A plugin system beyond a static kind table
- Browser automation tests

## Approach (chosen)

**One iframe. Kind-driven skip, in-place update, or navigate.**

Kinds that own a reusable viewer document (`inPlace: true`) receive `postMessage` and refetch, then replace their content. Opaque documents (`inPlace: false`, HTML apps today) still navigate. The parent hides the iframe until a type-appropriate ready signal so the gap is the dark preview pane, not white.

Alternatives considered:

1. **Dual iframe swap (rejected)** — Keeps any previous page until the next `load`, including HTML, but runs two documents at once (timers, `localStorage`).
2. **Inline Markdown in the shell (rejected)** — Removes the iframe flash for `.md` only; splits preview into two hosts; HTML still flashes; original Markdown spec treated this as a non-goal.
3. **Kind table + single iframe (chosen)** — Same-file skip for every type; in-place where a viewer can reuse its document; dark hide-until-ready when navigation is required. Future types register a kind instead of forking `openFile`.

## Preview kinds

A UMD helper (`internal/ui/preview-session.js`, global `MinoPreviewSession`) owns matching, the action decision, and message parse/build. First matching kind wins. Paths are catalog relative strings (same as `currentPath`).

| `id` | Match | `inPlace` | Ready signal |
|------|--------|-----------|--------------|
| `markdown` | `/\.md$/i` | `true` | iframe → parent `preview-ready` after the body is swapped (success or page-level error) |
| `html` | `/\.html?$/i` | `false` | iframe `load` |

No match → `id: "document"`, `inPlace: false`, ready = `load` (unknown extensions navigate like HTML apps).

`kindId(path)` returns that `id`. Helper exports also include `inPlace(path)` (boolean) and the decide function below.

Do not infer kind from iframe URL path after a 404 or `about:blank`; kind for in-place is taken from **displayed** state (last successful ready), not from a pending `src`.

## Actions

`decidePreviewAction({ fromPath, toPath, force, displayedPath, navigatePending })` returns exactly one of `"skip" | "in-place" | "navigate"`.

Call it with the workbench’s **pre-update** open path as `fromPath`. Then set `currentPath` (and breadcrumb, selection, persist, width chrome) to `toPath`. If `fromPath` is mutated first, `toPath === fromPath` is always true and every click would skip.

Definitions:

- `fromPath`: `currentPath` before this open/reload.
- `toPath`: file being opened or live-reloaded.
- `displayedPath`: last path for which the iframe became ready, or `""`.
- `navigatePending`: a `src` assignment is in flight (hidden until ready).
- `force`: SSE `changed` for the open file, or any future explicit reload of the current path. Not set for a user click.

Rules, in order:

1. If `toPath === fromPath` and `force` is false → **skip**.
2. If `navigatePending` is true → **navigate** (replace `src` with `toPath`; drop the previous pending ready).
3. If `kindId(toPath)` equals `kindId(displayedPath)`, `displayedPath` is non-empty, and `inPlace(toPath)` → **in-place**.
4. Else → **navigate**.

Same-path live reload is rule 3 when the displayed kind supports in-place (`preview-reload`); otherwise rule 4 (`src` + cache-bust).

Skip does not change `src`, visibility, or viewer messages. `rememberOpen` / persist may still run; they are idempotent for the current path.

In-place is allowed only against a **ready** viewer document. A Markdown file whose first navigation has not yet `preview-ready` cannot receive `preview-navigate`; a second click on a different `.md` while that navigation is pending uses rule 2 (another navigate). After ready, `.md` → `.md` is in-place.

## Protocol

Envelope matches Markdown width: `{ source: "mino", type, ... }`. Parent and viewer ignore messages whose `origin` is not `window.location.origin`, whose `source` is not `"mino"`, or whose `type` is unknown.

Parent → iframe (only `inPlace` viewers handle these):

| `type` | Fields | Meaning |
|--------|--------|---------|
| `preview-navigate` | `path` (non-empty catalog relative string) | Show another file in this viewer |
| `preview-reload` | `path` (must equal the viewer’s current path) | Refetch this file |

Iframe → parent:

| `type` | Fields | Meaning |
|--------|--------|---------|
| `preview-ready` | `path` | This path is on screen (rendered body or page-level error) |
| `preview-error` | `path` | Same-path reload failed; DOM was **not** replaced |

`md-preview-width` is unchanged (parent → Markdown viewer only).

Opaque kinds never send `preview-ready` / `preview-error`. The parent must not wait for them.

`path` on every preview message is a trimmed non-empty string; otherwise the parse returns null.

## Host behavior

Keep a **single** `#preview` iframe. `hidden` remains “no file selected” (empty state visible), same as today.

When a file is open, the iframe is not `hidden`. Navigation adds class `preview-pending` on `#preview`: hide with `visibility` and/or `opacity`, **not** `display: none`, so the iframe keeps its flex size. The preview pane and the iframe element use the workbench dark background (`var(--bg-shell)`), not `#ffffff`.

Order for **navigate**: set pending (hide) → assign `src` (`/apps/<encoded>?t=<Date.now()>` as today) → on ready, clear pending, bind iframe hotkeys, `postMdWidthToPreview` if Markdown.

Order for **in-place**: do not pending-hide; `postMessage` the viewer. Hotkeys stay bound (same document). Width is already on the viewer root; no resend required.

First open from empty: hide empty state immediately; iframe becomes visible in layout but pending until ready; user sees the dark pane, then content.

`clearPreview`: remove `src`, clear pending and `displayedPath`, show empty state, forget `mino-open-path` (unchanged).

Ready handling:

- `inPlace` kinds: ignore iframe `load` for showing; show when `preview-ready.path === currentPath`. Still bind hotkeys and post width on `load` so the viewer can receive width before or with first paint.
- Other kinds: show on iframe `load` if the pending path is still `currentPath`.
- `preview-ready` / `load` for a path that is not `currentPath`: ignore (stale).
- Viewer script failure with no `preview-ready`: iframe stays pending. Accepted; the viewer must send `preview-ready` after initial `render()` success **and** after page-level `showError`.

## Viewer behavior (Markdown)

Initial load still reads `data-path` and runs `render()`, then posts `preview-ready` with that path (including fetch/parse failure via `showError`).

On `preview-navigate` / `preview-reload`: increment a request generation; fetch `/api/raw/<path>` (`cache: "no-store"`); if the generation is stale, return. Then:

- **Path change (`preview-navigate`)**: on fetch/parse failure, replace the body with the existing page-level error UI for that path (do not keep the previous file’s DOM under a new breadcrumb), update `data-path`, rebuild TOC/Mermaid as today, scroll to top, `preview-ready`.
- **Same path (`preview-reload`)**: on failure, do not replace the DOM; post `preview-error`. On success, replace the body, restore `window.scrollX` / `scrollY` captured before swap, `preview-ready`.
- Ignore `preview-reload` whose `path` is not the viewer’s current path. Ignore navigate/reload to a path that is not Markdown (parent should not send this).

Parent only sends in-place messages for paths that are in `fileIndex`. `/api/raw/` remains the authorization check.

## Data flow

```text
openFile(path) / SSE changed
  → action = decidePreviewAction({ fromPath: currentPath, toPath: path, force, displayedPath, navigatePending })
  → currentPath, breadcrumb, selection, persist, md-width chrome = path
  → skip      → return
     in-place  → postMessage navigate, or reload if force && path === fromPath
     navigate  → preview-pending, src = previewURL(path)

viewer fetch (in-place)
  → stale gen discarded
  → swap DOM (or error / keep-old on same-path fail)
  → preview-ready | preview-error

parent on ready/load for currentPath
  → displayedPath = path
  → clear pending
```

SSE:

- `changed` and `event.path === currentPath` → `force: true` (in-place reload or navigate). This **replaces** “always assign `preview.src`” from older specs for in-place kinds; HTML still cache-busts `src`.
- `removed` and open file → `clearPreview` (unchanged).
- Other paths → tree update only (unchanged).

Rapid clicks: chrome follows the latest path immediately. In-place uses viewer generation. Navigate-in-flight uses a new `src` (rule 2).

Same-tab restore still calls `openFile` after the first successful tree load (navigate from empty).

## Error handling

| Situation | Behavior |
|-----------|----------|
| Click current file | skip; no flash |
| In-place path change, fetch/parse fail | Viewer error page for the new path; `preview-ready`; parent shows iframe |
| In-place same-path reload fail | Keep old DOM; `preview-error`; iframe stays as it was |
| Navigate 404 | iframe `load`; parent shows iframe (same as today) |
| Stale `preview-ready` / `load` / in-place fetch | Ignore |
| Unknown extension | kind `document`; navigate; ready = `load` |
| Bad origin / malformed message | Ignore |
| `postMessage` into an HTML app | App ignores unknown messages; next open of Markdown navigates to the viewer |
| `sessionStorage` / width errors | Unchanged; swallow as today |

## Architecture / file impact

| File | Change |
|------|--------|
| `internal/ui/preview-session.js` | New: kinds, `decidePreviewAction`, message helpers; swallow nothing at this layer (pure) |
| `internal/ui/index.html` | Script `/preview-session.js` before `/app.js` |
| `internal/ui/app.js` | `openFile` / SSE use decide; pending hide; ready vs `load`; keep persist/restore |
| `internal/ui/style.css` | Dark iframe/pane background; `.preview-pending` (or equivalent) without `display: none` |
| `internal/ui/md/viewer.js` | Message listener; generation; fetch-then-swap; `preview-ready` / `preview-error`; scroll restore on same-path reload |
| `internal/ui/embed.go` | Embed `preview-session.js` |
| `internal/server/server.go` | `GET /preview-session.js` |
| `internal/server/server_test.go` | Asset served; index script order; `TestAppJSWorkbenchContracts` markers |
| `internal/ui/testdata/preview_session_test.mjs` | Node tests |
| `internal/ui/preview_session_node_test.go` | `node --test` wrapper |
| `README.md` | One or two sentences: same-file click does not reload; Markdown reuses the viewer document |

Helper exports:

- `kindId(path)` → `"markdown"` \| `"html"` \| `"document"`
- `inPlace(path)` → boolean
- `decidePreviewAction({ fromPath, toPath, force, displayedPath, navigatePending })` → `"skip"` \| `"in-place"` \| `"navigate"`
- `previewNavigateMessage(path)` / `previewReloadMessage(path)` / `previewReadyMessage(path)` / `previewErrorMessage(path)`
- `parsePreviewMessage(data, origin, expectedOrigin)` → `{ type, path }` or `null` (all four preview types)

`app.js` owns iframe DOM, pending class, `displayedPath`, and whether a navigate is in flight.

## Testing

Automated:

- Kind matching: `.md`, `.MD`, `.html`, `.htm`, `.HTML`, unknown → `document`
- Decision table: skip; force + markdown displayed → in-place; force + html displayed → navigate; md→md in-place; html→html, html↔md, empty `displayedPath` → navigate; `navigatePending` → navigate even for md→md
- Messages: good envelopes parse; wrong origin, missing `source`, empty `path`, unknown `type` → `null`
- Go: `/preview-session.js` served; index loads it before `app.js`; `app.js` contains decide/pending/ready wiring markers; `viewer.js` contains `preview-ready` after render/error

Manual:

- Click the open file (HTML and Markdown): no reload, no flash
- Switch `docs/sample.md` and another `.md`: old Markdown stays until the new body appears
- Switch two HTML apps: dark pane, then the new app, no white flash
- HTML ↔ Markdown: dark pane, then the new kind
- Edit the open Markdown on disk: body refreshes without iframe unload; scroll stays if the file is still long enough
- Edit the open HTML on disk: iframe navigates without white flash
- Delete the open file: empty preview
- Refresh: `mino-open-path` restore still opens the file

## Success criteria

1. Second click on the open file does not assign `src` and does not flash.
2. Markdown-to-Markdown open and Markdown live reload do not create a new iframe document; previous body remains until the new body or error page is ready.
3. Required navigations expose the workbench dark background until ready, not `#ffffff`.
4. A new type is added by a kind row (and viewer protocol if `inPlace`); not by a new branch in the SSE/`openFile` core.
5. Empty preview, `removed`, Markdown width, Quick Open (including iframe focus), and same-tab restore behave as they do today.

## Spec notes (supersedes)

- `2026-08-22-mino-markdown-preview-design.md` and `2026-08-27-mino-refresh-keep-preview-design.md` said SSE `changed` reloads the iframe. For `inPlace` kinds, live reload is `preview-reload` instead. HTML and `document` still assign `src`.
- Mermaid / TOC state still resets when Markdown content is replaced (same as a full viewer restart). Same-path reload only additionally restores window scroll.
