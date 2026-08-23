# Mino Command Center Quick Open Design

**Date:** 2026-08-23  
**Status:** Approved for planning  
**Scope:** Evolve the existing top-bar Quick Open into a VS Code–like Command Center + covering Quick Open overlay, with better ranking  
**Approach:** Evolve current client-side Quick Open in place (no backend search changes)  
**Supersedes (UI chrome + ranking only):** `2026-08-23-mino-quick-open-design.md` — file index, recents, iframe hotkeys, and reveal-in-tree stay as implemented

## Problem

Quick Open already replaces the Explorer path filter: `Ctrl/Cmd+E`/`P` opens a dropdown, fuzzy-ranks a cached file list, and keeps the tree intact. It still does not feel like VS Code:

- The top bar is a search `<input>`, not a Command Center that shows the workspace name.
- Results hang under that input at the same narrow width, as two-line rows with white match marks.
- The scorer is leftmost-greedy subsequence, so scattered path letters can outrank a tight filename match, and spaces are literal characters rather than tokens.

## Goals

1. Replace the top-bar search input with a **Command Center** that displays the workspace name.
2. Click or `Ctrl/Cmd+E`/`P` opens a **standalone Quick Open overlay** that **covers** the Command Center (own input + result list).
3. Result rows are **single-line**: type color chip, basename, parent path on the right; match characters use accent blue.
4. Ranking: **compact consecutive** matches, **whitespace-separated tokens**, **recents boost**.
5. Keep session recents, iframe hotkey bridge, reveal-in-tree, and no `/api/search` from the UI.

## Non-Goals

- Command palette, Command Center mode menu (`Go to File`, `Show and Run Commands`, `%` text search, `@` symbols, `:` go to line)
- Full-text search of HTML or Markdown body content
- Persisting recents to `localStorage`, config, or disk
- Changing `GET /api/search` or catalog substring semantics
- New frontend build step or npm fuzzy libraries
- Nested/cross-origin iframe shortcut forwarding
- Pixel-perfect VS Code clone (no split-editor action, no file-type icon font, no “use fuzzy search” toggle)

## Approach (chosen)

**Evolve the existing client Quick Open.**

Keep `fileIndex` from `/api/tree`, in-memory recents, and the iframe capture hotkeys. Replace the title-bar `<input>` with a Command Center button. Move typing into a covering overlay. Extend `internal/ui/fuzzy.js` (no new dependency).

Alternatives considered:

1. **Evolve in place (chosen)** — Same data flow; chrome and scorer change in `index.html` / `style.css` / `app.js` / `fuzzy.js`.
2. **New overlay module + full VS Code matcher rewrite** — Cleaner files, much larger rewrite for a small catalog.
3. **CSS-only polish on the attached dropdown** — Does not cover the Command Center or replace the search input.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ [M]                    [ workspace name ]                   │
│                    ┌─────────────────────────────────────┐  │
│                    │ Search files by name                │  │  overlay covers entry
│                    │ timer.html                    tools/│  │
│                    │ counter.html                  tools/│  │
│                    └─────────────────────────────────────┘  │
├────┬──────────────┬─────────────────────────────────────────┤
│ AB │ Explorer     │ Breadcrumb                              │
│    │ (tree stays) │ iframe / empty state                    │
└────┴──────────────┴─────────────────────────────────────────┘
```

```text
Click Command Center / Ctrl+E or P (shell or iframe)
        ↓
  Overlay covers Command Center; focus overlay input
  Empty query → session recents
  Non-empty query → fuzzy-filter cached paths
        ↓
  Enter / click → open preview + expand/select tree row
                 + close overlay and clear query
```

UI still does not call `/api/search`. The endpoint remains substring search so existing catalog, server, and e2e tests stay valid.

## Components

### Command Center

Replace `#search` / `.search-box` with `#command-center`: a `button type="button"` in `.search-wrap`, width `min(420px, 46vw)`, height 26px, same Dark Modern chrome as today’s search box (background `--search-bg`, border `#3c3c3c`, radius 5px). Text is `meta.name` from `/api/meta`, color `--fg`, centered, ellipsis if overflow. No placeholder “Search files…”.

Left brand: keep `.brand-mark` (“M”). Move `#title` to `class="sr-only"` (not shown next to the mark). `loadMeta` still sets `#title` and `document.title` to `{name} · mino`. The visible workspace name is only the Command Center.

`aria-haspopup="dialog"`, `aria-expanded` true while the overlay is open, `aria-controls="quick-open"`.

### Quick Open overlay

`#quick-open` is a `position: fixed` panel, `left: 50%`, `transform: translateX(-50%)`, `top: 4px` so it **covers** the Command Center and the rest of the 35px top bar center. Width `min(640px, 86vw)`. `z-index` above the top bar (top bar is 10; overlay is 50). Background `--search-bg`, border `1px solid #3c3c3c`, radius 6px, shadow `0 8px 24px rgba(0,0,0,0.45)`. When open, the input uses accent focus: border `var(--accent)` (`#0078d4`).

Structure:

- `#quick-open-input` — `role="combobox"`, `aria-autocomplete="list"`, `aria-controls="quick-open-list"`, `aria-expanded="true"` while open, placeholder `Search files by name`
- `#quick-open-list` — `role="listbox"`

`#quick-open` is `hidden` when closed. Do not leave a second typing surface in the top bar.

Each file row is a single line (`display: flex; align-items: center`):

1. Type chip (16×16, radius 2px): `.html`/`.htm` `#e36e6e`; `.md` `#519aba`; anything else `#6e6e6e`. No icon font.
2. Basename, `--fg`, 13px; match spans are `<mark>` with color `#4fc1ff`, background transparent, font-weight 600.
3. Parent directory including the trailing slash (`tools/`, `docs/nested/`), `--fg-muted`, 12px, `margin-left: auto`. Empty for workspace-root files. Match marks on the path use `#cccccc`.

Show at most **50** rows. Overflow scrolls inside the list (`max-height: 360px`). Active row background `#37373d` (not `--selection` blue, so it matches VS Code quick-input selection).

Copy (English):

| State | List body |
|-------|-----------|
| Empty query, no recents | `Type to search files` |
| Empty query, has recents | Recents, most recent first; footer line `recently opened` |
| Query with no matches | `No matching files.` |
| Query with matches | Ranked file rows; no recents footer |

`Enter` does nothing when the list has no selectable file row.

File rows use `mousedown.preventDefault()` so choosing a row does not blur the overlay input before click handling.

### File index

Unchanged: on every successful `/api/tree` load, collect `type === "file"` paths into `fileIndex`. Directories are not indexed. SSE-driven reloads rebuild the index the same way.

### Fuzzy scorer

Pure functions in `internal/ui/fuzzy.js`, still `globalThis.MinoFuzzy` / `module.exports`. No new npm dependency.

**Empty / whitespace-only query:** `filter` returns `[]` without scoring. The overlay uses recents / empty hint instead.

**Tokens:** `query.trim().split(/\s+/)` — every token must match. A path is excluded if any token fails.

**Haystack choice per token:** If the token is a subsequence of the basename (case-insensitive), run match selection on the basename string, then add `path.lastIndexOf('/') + 1` (or `0` if no slash) to every match index so indexes refer to the full path. Otherwise run match selection on the full relative path. If it is not a subsequence of the full path, the token fails.

**Match selection (compact, not leftmost-only):** Lowercase the token `q` and haystack `s`. For every index `i` where `s[i] === q[0]`, run a leftmost-greedy subsequence match of `q` starting at `i`. Keep complete matches only. Convert those haystack indexes to full-path indexes (if the haystack was the basename, add the basename offset). Score each candidate with the weights below (weights always see the full path) and keep the maximum. Ties: prefer the candidate with the **larger first match index**; if still tied, prefer the **smaller span** (`last - first`); if still tied, prefer **lexicographically smaller match-index tuple**.

**Weights (per matched character, unchanged from the previous spec except for how the indexes are chosen):**

- `+1` per matched character
- `+4` if the match is consecutive with the previous match
- `+6` if the match is at the start of the basename, or immediately after `/`, `.`, `-`, or `_`
- `+8` extra if the match index falls in the basename (not the directory prefix)

**Path score:** sum of token scores, plus recents boost.

**Recents boost:** if `path` is in the recents array at index `i` (0 = most recent), add `20 - i`. Not in recents: `+0`. Recents longer than 10 cannot occur (array is capped at 10).

**`filter(query, paths, recents)`:** `recents` is an array of paths; omit it or pass `[]` for no boost. Returns `{ path, score, matches }[]` where `matches` is the sorted unique union of all token match indexes on the full path. Sort by score descending, then path ascending. Cap at 50 after sorting.

Example: query `ttr` still matches `tools/timer.html`. Query `tools timer` matches `tools/timer.html` as two tokens.

### Recents

Unchanged: in-memory, max **10**, most recent first, unique by path. Every `openFile` (tree click or Quick Open accept) inserts at the front. SSE `removed` deletes that path from recents. Not written to disk.

### Shortcut bridge

Unchanged keys: on `document` (capture), if `(ctrlKey || metaKey)` and not `altKey`/`shiftKey` and key is `e`/`E` or `p`/`P`, `preventDefault`, open overlay, focus `#quick-open-input`, select all.

On `#preview` `load`, attach the same handler to `iframe.contentDocument` in the capture phase. If `contentDocument` is unavailable, skip silently. Re-bind after every load. Nested iframes and cross-origin subframes stay out of scope.

Do not intercept `Ctrl/Cmd+F`.

If a previewed HTML app registers an earlier capture listener and calls `preventDefault` on these keys, forwarding is not guaranteed.

### Reveal in Explorer

Unchanged: on accept, record recents, `openFile`, expand ancestors, re-render Explorer from the last successful tree payload, close overlay, clear query, **focus the preview iframe**. If no cached tree payload exists, call `loadTree` instead. If the path is missing from `fileIndex`, do not open; drop it from recents.

## Data flow

**Startup:** `loadMeta` + `loadTree` as today. Successful `loadMeta` sets Command Center text to `meta.name` or `mino`. Successful `loadTree` rebuilds `fileIndex`.

**Open / close:**

| Trigger | Behavior |
|---------|----------|
| Click `#command-center` | Open overlay; focus `#quick-open-input` without select-all. The overlay covers the button, so a second click hits the overlay or outside it, not the button. |
| `Ctrl/Cmd+E` or `P` (shell or iframe) | `preventDefault`; open overlay; focus input; **select all** |
| Input | Filter `fileIndex` immediately; no `/api/search`; no debounce |
| `ArrowUp` / `ArrowDown` | Move the active option; do not change the query; **stop at the ends** (no wrap) |
| `Enter` | Accept the active file row |
| Click a file row | Accept that row |
| `Escape`, pointer down outside `#quick-open`, or focus moving outside `#quick-open` | Close; clear query; Explorer unchanged |

While the overlay is open and the list has file rows, the first result is active by default (restore previous path if it still exists after a re-filter, else first row).

**SSE:** `added` / `removed` / `changed` still refresh the tree (and `fileIndex`). If the overlay is open, re-run the current query (or recents). If the active row’s path disappears, highlight the first remaining row or show the empty copy. `removed` of the open preview still `clearPreview`. `changed` of the open preview still reloads the iframe.

**Removed:** top-bar `<input id="search">`; dropdown attached under `.search-wrap` at search-box width; two-line result rows.

## Error handling

| Situation | Behavior |
|-----------|----------|
| No matches | Overlay stays open with `No matching files.`; `Enter` is a no-op |
| Empty query and no recents | `Type to search files`; `Enter` is a no-op |
| `/api/tree` failure | Existing Explorer error copy; keep last successful `fileIndex` (empty if none) |
| `/api/meta` failure | Command Center text is `mino` |
| Iframe not loaded / cannot read `contentDocument` | Shell shortcuts still work; skip the frame bridge |
| Preview nested iframe / cross-origin child | Ignored |
| Accept a path missing from `fileIndex` | Do not open; drop it from recents |
| More than 50 matches | Render the top 50 only |
| Query is only whitespace | Treat as empty query (recents / hint); do not score |

## Testing

No Playwright. Follow existing UI test patterns.

**Automated**

- Node tests (`node --test`, existing `fuzzy_node_test.go` wrapper) for `MinoFuzzy`:
  - Case folding
  - Subsequence `ttr` → `tools/timer.html`
  - Basename-only match preferred over a weaker full-path scatter when the token fits in the basename
  - Compact / consecutive match outranks a leftmost scattered match on the same path
  - Multi-token `tools timer` matches `tools/timer.html`; a token that matches nothing excludes the path
  - Recents boost: two paths with the same token score rank so the one in recents (or the more recent of the two) comes first; a consecutive basename match still outranks a recent path that only hits scattered directory letters
  - Whitespace-only query returns `[]`
  - Cap 50 unchanged
- `GET /` body includes `#command-center`, `#quick-open`, `#quick-open-input`, `#quick-open-list`. Serve `GET /fuzzy.js` as today. Stop requiring a top-bar `#search` combobox.
- Catalog / server / e2e `/api/search` tests stay substring-based and unchanged.

**Manual**

1. Top bar center shows the workspace name; click opens a covering overlay with its own input.
2. `Ctrl+E` / `Ctrl+P` (Cmd on macOS) opens the same overlay, including when the preview iframe is focused.
3. Type to fuzzy-filter; spaces act as tokens; arrows + Enter open the file; Explorer expands and selects it.
4. Escape / click outside closes; Command Center again shows the workspace name.
5. Empty query shows recents after opening a file; reload of the Mino page clears recents.
6. `Ctrl+F` opens browser find.
7. SSE add/remove updates the index; removing the open file still clears preview.

## Success criteria

1. Top bar center is a Command Center (workspace name), not a search field.
2. Quick Open is a covering overlay with its own input; Explorer stays a tree.
3. Compact + tokenized fuzzy ranking and recents boost work; hotkeys (including iframe) and reveal-in-tree still work.
4. `GET /api/search` behavior is unchanged.
5. No command palette, content search, or recents persistence.

## File impact

| File | Change |
|------|--------|
| `internal/ui/index.html` | Command Center button; overlay markup with input + list; brand mark only |
| `internal/ui/style.css` | Overlay covering layout, single-line rows, type chips, blue marks, active `#37373d` |
| `internal/ui/fuzzy.js` | Token split, basename-first haystack, compact match pick, recents boost, `filter` third argument |
| `internal/ui/app.js` | Wire Command Center + overlay input; keep index/recents/hotkeys/reveal |
| `internal/ui/testdata/fuzzy_test.mjs` | New ranking / token / recents cases |
| `internal/server/server_test.go` | Assert `#command-center`, `#quick-open-input`, `#quick-open-list`; drop top-bar `#search` / `>Search files</span>` as required |

No catalog, watcher, config, or `/api/search` handler changes. `GET /fuzzy.js` already exists.
