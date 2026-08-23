# Mino Top-Bar Quick Open Design

**Date:** 2026-08-23  
**Status:** Approved for planning  
**Scope:** Replace top-bar path filter with a VS Code–like Quick Open overlay  
**Approach:** Client-side Quick Open on a cached file index (no backend search changes)

## Problem

The top-bar search box filters the Explorer tree into a flat, case-insensitive substring list and is focused with `Ctrl/Cmd+F`. That is unlike VS Code’s title-bar / Quick Open flow: a dropdown on the search box, fuzzy ranking, keyboard-first file jumping, and an Explorer that stays a directory tree.

## Goals

1. Turn the top-bar search into a **Quick Open** dropdown; Explorer remains a directory tree while searching.
2. Match files with **fuzzy subsequence** scoring; basename weighs more than the directory path.
3. Open Quick Open with **`Ctrl/Cmd+E` and `Ctrl/Cmd+P`**, including when the preview iframe is focused.
4. Empty query shows **session recents** (in-memory, max 10).
5. Accepting a result **opens the preview, expands Explorer to the file, and selects it**.
6. Stop intercepting **`Ctrl/Cmd+F`** so the browser find UI works again.

## Non-Goals

- Command palette, `>` prefixes, or searching settings/commands
- Full-text search of HTML or Markdown body content
- Persisting recents to `localStorage`, config, or disk
- Changing `GET /api/search` or catalog substring semantics
- New frontend build step or npm fuzzy libraries
- Nested/cross-origin iframe shortcut forwarding
- Pixel-perfect VS Code clone (no command-center mode switcher, no “use fuzzy search” toggle)

## Approach (chosen)

**Client-side Quick Open on a cached file index.**

The shell already loads `/api/tree` and refreshes it on SSE. Flatten that tree into an in-memory path list and rank it in JavaScript. Recents, highlighting, and the overlay are UI state.

Alternatives considered:

1. **Client index + overlay (chosen)** — Instant ranking, recents stay local, no API change; typical Mino workspaces are small.
2. **Server-side fuzzy `/api/search`** — Single matching implementation in Go, but every keystroke is a round trip and highlight ranges need a new payload.
3. **New `/api/files` + client fuzzy** — Cleaner list endpoint, redundant with data already in `/api/tree`.

## Architecture

```text
Ctrl/Cmd+E or P (shell or iframe) / focus search
        ↓
  Open dropdown; empty query → session recents
  Non-empty query → fuzzy-filter cached paths (basename-weighted)
        ↓
  Enter / click → open preview + expand/select tree row
                 + close dropdown and clear query
```

```text
┌─────────────────────────────────────────────────────────────┐
│ Brand                         [ ⌕ Search files… ]           │
│                                 ┌─────────────────────────┐ │
│                                 │ timer.html              │ │
│                                 │   tools                 │ │
│                                 │ sample.md               │ │
│                                 │   docs                  │ │
│                                 └─────────────────────────┘ │
├────┬──────────────┬─────────────────────────────────────────┤
│ AB │ Explorer     │ Breadcrumb                              │
│    │ (tree stays) │ iframe / empty state                    │
└────┴──────────────┴─────────────────────────────────────────┘
```

UI stops calling `/api/search`. The endpoint remains substring search so existing catalog, server, and e2e tests stay valid.

## Components

### Quick Open overlay

Keep `#search` in the top bar. Add a sibling list `#quick-open` (combobox / listbox) absolutely positioned under the search box, width matching the search box (`min(420px, 46vw)`). Dark Modern tokens: panel background `--search-bg`, selected row `--selection`, muted directory `--fg-muted`, match characters `--fg-strong`.

Each row:

- Primary line: file basename, with matched characters highlighted
- Secondary line: parent directory including the slash before the basename (`tools/`, `docs/nested/`); empty for workspace-root files
- Highlight ranges are computed on the full relative path, then split: indexes in the basename go on the primary line; indexes in the directory prefix (including the separating `/`) go on the secondary line

Show at most **50** rows (highest score). Overflow scrolls inside the list.

Copy (English, matching the rest of the chrome):

| State | List body |
|-------|-----------|
| Empty query, no recents | `Type to search files` |
| Empty query, has recents | Recents, most recent first |
| Query with no matches | `No matching files.` |
| Query with matches | Ranked file rows |

`Enter` does nothing when the list has no selectable file row.

File rows use `mousedown.preventDefault()` so choosing a row does not blur `#search` before the click is handled.

### File index

On every successful `/api/tree` load, walk the JSON and collect `type === "file"` paths into `fileIndex` (array of relative paths). Directories are not indexed. SSE-driven tree reloads rebuild the index the same way.

### Fuzzy scorer

Pure functions in `internal/ui/fuzzy.js`, exported as `globalThis.MinoFuzzy` for the browser and `module.exports` for Node tests. No new npm dependency.

- Case-insensitive subsequence: every query character must appear in order in the relative path.
- Scoring (exact weights to implement, not merely illustrative):
  - `+1` per matched character
  - `+4` if the match is consecutive with the previous match
  - `+6` if the match is at the start of the basename, or immediately after `/`, `.`, `-`, or `_`
  - `+8` extra if the match index falls in the basename (not the directory prefix)
- Non-matches are excluded.
- `filter(query, paths)` returns `{ path, score, matches }` where `matches` is the list of matched character indexes in `path` (for highlighting). Sort by score descending, then by path ascending. Cap at 50 after sorting.
- Empty query must not call the scorer; the overlay uses recents / empty hint instead.

Example: query `ttr` matches `tools/timer.html`.

### Recents

In-memory array, max **10**, most recent first, unique by path. Every `openFile` (tree click or Quick Open accept) inserts at the front. SSE `removed` deletes that path from recents. Not written to disk.

### Shortcut bridge

On `document` (capture): if `(ctrlKey || metaKey)` and not `altKey`/`shiftKey` and key is `e`/`E` or `p`/`P`, `preventDefault`, open Quick Open, focus `#search`, select all.

On `#preview` `load`, attach the same handler to `iframe.contentDocument` in the capture phase. If `contentDocument` is unavailable, skip silently. Re-bind after every load (live reload included). Nested iframes and cross-origin subframes are out of scope.

Do not intercept `Ctrl/Cmd+F`.

If a previewed HTML app registers an earlier capture listener and calls `preventDefault` on these keys, forwarding is not guaranteed.

### Reveal in Explorer

On accept: record recents, `openFile` (preview + breadcrumb), add every ancestor directory of the path to `expandedPaths`, re-render Explorer from the last successful tree payload (do not fetch `/api/tree` again), so those folders are expanded and the file row is `.selected`, then close Quick Open and clear the query. If no cached tree payload exists, call `loadTree` instead.

After accept, **focus the preview iframe** so the opened file is interactive (Quick Open shortcuts still work via the iframe bridge). Do not leave focus in `#search`.

## Data flow

**Startup:** `loadMeta` + `loadTree` as today. Successful `loadTree` also rebuilds `fileIndex`.

**Open / close:**

| Trigger | Behavior |
|---------|----------|
| `Ctrl/Cmd+E` or `P` (shell or iframe) | `preventDefault`; focus search; select all; open dropdown |
| `#search` receives focus (click, Tab, or shortcut) | Open dropdown if closed |
| Input | Filter `fileIndex` immediately; no `/api/search`; no 150ms debounce |
| `ArrowUp` / `ArrowDown` | Move the active option; do not change the query |
| `Enter` | Accept the active file row |
| Click a file row | Accept that row |
| `Escape`, pointer down outside the search box and overlay, or focus moving outside both | Close; clear query; Explorer unchanged |

While the dropdown is open and the query is non-empty, the first result is active by default. Arrow keys **stop at the ends** (no wrap).

**SSE:** `added` / `removed` / `changed` still refresh the tree (and therefore `fileIndex`). If Quick Open is open, re-run the current query (or recents). If the active row’s path disappears, highlight the first remaining row or show the empty copy. `removed` of the open preview still `clearPreview`. `changed` of the open preview still reloads the iframe.

**Removed:** typing no longer replaces Explorer with a flat result list; the UI no longer fetches `/api/search`.

## Error handling

| Situation | Behavior |
|-----------|----------|
| No matches | Overlay stays open with `No matching files.`; `Enter` is a no-op |
| Empty query and no recents | `Type to search files`; `Enter` is a no-op |
| `/api/tree` failure | Existing Explorer error copy; keep last successful `fileIndex` (empty if none) |
| Iframe not loaded / cannot read `contentDocument` | Shell shortcuts still work; skip the frame bridge |
| Preview nested iframe / cross-origin child | Ignored |
| Accept a path missing from `fileIndex` | Do not open; drop it from recents |
| More than 50 matches | Render the top 50 only |

## Testing

No Playwright. Follow existing UI test patterns.

**Automated**

- Node tests (`node --test`, same skip-if-no-node wrapper as `preprocess_node_test.go`) for `MinoFuzzy`: case folding, subsequence `ttr` → `tools/timer.html`, basename preferred over directory-only matches, no match excluded, empty query not required to score.
- `GET /` body includes `#quick-open` (keep existing `#search` / iframe / `app.js` markers). Serve `GET /fuzzy.js` next to `app.js`.
- Catalog / server / e2e `/api/search` tests stay substring-based and unchanged.

**Manual**

1. `Ctrl+E` / `Ctrl+P` (Cmd on macOS) opens the dropdown; Explorer stays a tree.
2. Click into the preview, then the same shortcuts still open Quick Open.
3. Fuzzy input works; arrows + Enter open the file; Explorer expands and selects it.
4. Escape / click outside closes and clears the query.
5. Empty query shows recents after opening a file; reload of the Mino page clears recents.
6. `Ctrl+F` opens browser find, not the top-bar box.
7. SSE add/remove updates the index; removing the open file still clears preview.

## Success criteria

1. Top-bar search is Quick Open, not an Explorer filter.
2. Fuzzy matching, `Ctrl/Cmd+E`/`P` (including iframe focus), session recents, and reveal-in-tree all work.
3. `GET /api/search` behavior is unchanged.
4. No command palette, content search, or recents persistence.

## File impact

| File | Change |
|------|--------|
| `internal/ui/index.html` | `#quick-open` markup; script tag for `fuzzy.js` before `app.js` |
| `internal/ui/style.css` | Overlay, row, highlight, empty copy |
| `internal/ui/fuzzy.js` | **New.** Pure scorer + filter |
| `internal/ui/app.js` | Index, overlay, recents, shortcuts, reveal; remove search-as-tree-filter |
| `internal/server/server.go` | `GET /fuzzy.js` |
| `internal/server/server_test.go` | Assert `#quick-open` / `/fuzzy.js` as needed |
| `internal/ui/testdata/fuzzy_test.mjs` + Go wrapper | Node tests for the scorer |

No catalog, watcher, or config changes.
