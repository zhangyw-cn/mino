# Mino Quick Open Dismiss, Recents List, and Density Design

**Date:** 2026-08-23  
**Status:** Approved for planning  
**Scope:** Close Quick Open from the preview iframe, make empty-query recents look like VS Code’s file list, match Command Center / overlay size and row height to VS Code  
**Approach:** Transparent full-viewport dismiss layer + iframe `Escape` forwarding; remove recents footer; shared `min(600px, 70vw)` width; 22px rows  
**Extends:** `2026-08-23-mino-command-center-quick-open-design.md` — Command Center, covering overlay, fuzzy ranking, session recents, `Ctrl/Cmd+E`/`P`, and reveal-in-tree stay as implemented

## Problem

Command Center Quick Open is in place, but three gaps remain against VS Code:

1. **Dismiss:** “Click outside” is bound on the shell `document`. Clicks inside `#preview` never reach that listener, so the overlay stays open. `Escape` is also not forwarded into the iframe, so once focus leaks into the preview the overlay cannot be closed from the keyboard either.
2. **Recents:** Empty query shows session recents, but a trailing `recently opened` footer makes that list look like a special mode instead of the same file picker VS Code shows on an empty Quick Open.
3. **Size:** Command Center is `min(420px, 46vw)` while the overlay is `min(640px, 86vw)`, so the popup does not cover the entry the way VS Code’s Command Center does. Result rows are 36px tall; VS Code Quick Input list rows are 22px.

## Goals

1. Clicking the preview (HTML or Markdown iframe), Explorer, activity bar, or other chrome **outside the overlay** closes Quick Open. That first click must **not** be delivered to the previewed page (no accidental button press).
2. `Escape` closes Quick Open when focus is in the shell **or** in the preview iframe.
3. Empty-query recents use the **same file rows** as search results. No `recently opened` footer.
4. Command Center and overlay share width `min(600px, 70vw)` so the popup covers the entry. Result rows are 22px (VS Code list default). Do not add Command Center chevron, `file results` labels, split-editor actions, or Copilot chrome.
5. Recents stay **session-only** (in-memory, max 10). Fuzzy scoring is unchanged.

## Non-Goals

- Command palette, mode switcher, `%` text search, `@` symbols, `:` go to line
- Persisting recents to `localStorage`, config, or disk
- Changing `MinoFuzzy` weights, tokenization, or `/api/search`
- Visible dimming / blur of the workbench
- File-type icon fonts; color chips stay
- Nested/cross-origin iframe shortcut forwarding
- Native `<dialog showModal()>`

## Approach (chosen)

**Transparent dismiss layer behind the overlay, plus `Escape` on the existing iframe keydown bridge.**

A full-viewport, fully transparent hit target sits under `#quick-open` and above the rest of the UI. Pointer events that would have gone to the iframe, tree, or top bar hit this layer instead and only close the picker.

Alternatives considered:

1. **Transparent dismiss layer (chosen)** — Reliable over iframes; first click dismisses without activating the page underneath; no visual mask.
2. **Iframe `pointerdown` bridge only** — No extra DOM, but the click still reaches the previewed app, and it fails when `contentDocument` is missing.
3. **`<dialog showModal()>`** — Built-in backdrop and focus trap; fights the iframe hotkey bridge and Command Center focus.

## Architecture

```text
Ctrl/Cmd+E or P / click Command Center
        ↓
  Show #quick-open-backdrop + #quick-open
  Empty query → session recents (same file rows)
  Non-empty query → existing fuzzy filter
        ↓
  Pointer down on backdrop / Escape (shell or iframe)
        → close overlay + backdrop, clear query
  Enter / click a file row
        → open preview + reveal in tree + close
```

```text
z-index
  #quick-open            50
  #quick-open-backdrop   40   (fixed, inset 0, background transparent)
  .topbar                10
  workbench / iframe      auto
```

UI still does not call `/api/search`. Scoring, `fileIndex`, and Command Center copy stay as in the parent spec.

## Components

### Dismiss layer

Add `#quick-open-backdrop` as a sibling of `#quick-open` (direct child of `body`):

- `position: fixed; inset: 0; background: transparent; z-index: 40`
- `hidden` when Quick Open is closed; shown whenever the overlay is shown
- `aria-hidden="true"` (hit target only, not in the a11y tree)
- `pointerdown` → close picker (same `setPickerOpen(false)` as today). The backdrop is the event target, so the iframe and tree never receive that click. Overlay input and rows are a higher sibling (`z-index: 50`) and are not covered.

The backdrop covers the top bar, Explorer, preview iframe, and empty state. It does not cover `#quick-open` (`z-index: 50`).

### Command Center and overlay size

VS Code’s Command Center and the Quick Input that covers it are the **same width**. Apply one width to both `.search-wrap` and `#quick-open`: `min(600px, 70vw)`. Both stay horizontally centered (`#quick-open` keeps `left: 50%; transform: translateX(-50%)`). Overlay `top: 4px` still covers the 35px top bar center.

`#command-center` height: **24px** (from 26px), so it sits in the 35px top bar like VS Code’s command-center pill. No `▾`, no Copilot icon.

### Overlay chrome

Unchanged structure: `#quick-open` + `#quick-open-input` + `#quick-open-list`.

**Remove** `#quick-open-footer` from HTML, CSS, and JS. Do not render `recently opened`.

File rows stay: type chip, basename (match marks `#4fc1ff`), parent path on the right (`margin-left: auto`, match marks `#cccccc`). No `file results` text, no split icon.

**Density (exact values):**

| Element | From | To |
|---------|------|----|
| `.search-wrap` / `#quick-open` width | `min(420px, 46vw)` / `min(640px, 86vw)` | **both** `min(600px, 70vw)` |
| `#command-center` height | 26px | 24px |
| `.quick-open-item` `min-height` | 36px | **22px** |
| `.quick-open-item` padding | 8px 14px | 1px 8px |
| `#quick-open-input` padding | 10px 14px | 4px 8px |
| `.quick-open-empty` padding | 8px 14px | 4px 8px |
| `.quick-open-name` font-size | 13px | 13px (unchanged) |
| `.quick-open-dir` font-size | 12px | 12px (unchanged) |

Keep: list `max-height: 360px`, active row `#37373d`, chips 16×16 (vertically centered in the 22px row), type colors, placeholder `Search files by name`. Item `gap` 10px → 6px so the chip + name + path still fit the 600px row.

### Recents

Unchanged data: in-memory array, max **10**, most recent first, unique by path. Every `openFile` inserts at the front. SSE `removed` deletes that path. Not written to disk.

Empty query with recents: render those paths with the same row component as fuzzy hits (`matches: []`, so no marks). First row active by default. Empty query with no recents: `Type to search files`. Non-empty query: fuzzy results only; do not append unmatched recents.

### Shortcut bridge

Keep `Ctrl/Cmd+E`/`P` on `document` and on `iframe.contentDocument` (capture).

**Add:** if `pickerOpen` and the key is `Escape`, `preventDefault`, close the picker, focus `#command-center`. Register this on both `document` (already present) and `preview.contentDocument` (new, same `bindPreviewHotkeys` path). Re-bind after every iframe `load`.

Do not intercept `Ctrl/Cmd+F`. Nested / cross-origin child frames stay out of scope.

## Data flow

**Open / close:**

| Trigger | Behavior |
|---------|----------|
| Click `#command-center` | Show backdrop + overlay; focus input without select-all |
| `Ctrl/Cmd+E` or `P` (shell or iframe) | `preventDefault`; show backdrop + overlay; focus input; select all |
| Input | Filter immediately (empty → recents, else fuzzy) |
| `ArrowUp` / `ArrowDown` | Move active row; stop at ends |
| `Enter` / click a file row | Accept; close overlay and backdrop; focus preview |
| Pointer down on `#quick-open-backdrop` | Close overlay and backdrop; clear query; Explorer unchanged; **do not** focus Command Center; **do not** synthesize a click into the iframe or tree |
| `Escape` (shell or iframe) | Close overlay and backdrop; clear query; focus Command Center |
| Pointer down or `focusin` outside overlay on the shell document | Still close if it occurs (redundant with the backdrop for covered targets) |

Accepting a file still: recents → `openFile` → expand ancestors → re-render tree from cache → close → focus `#preview`.

**Behavior change vs today:** clicking an Explorer row while Quick Open is open currently both dismisses and can activate that row (the click reaches the tree). With the backdrop, the first click **only dismisses**. A second click is required to select a file. Same rule as the preview: first click does not activate the thing underneath.

**SSE:** unchanged from the parent spec. If the overlay is open, re-run the current query or recents list.

## Error handling

| Situation | Behavior |
|-----------|----------|
| No matches | Overlay stays open with `No matching files.`; `Enter` is a no-op |
| Empty query, no recents | `Type to search files`; `Enter` is a no-op |
| Iframe not loaded / no `contentDocument` | Backdrop still closes on preview click; shell `Escape` still works; skip iframe `Escape` bind |
| Preview page registers an earlier capture listener and `preventDefault`s `Escape` or `Ctrl+E`/`P` | Forwarding is not guaranteed |
| Nested iframe / cross-origin child | Ignored; clicks on the parent preview still hit the backdrop |
| Backdrop must not intercept overlay input or rows | Overlay `z-index` 50 > backdrop 40 |
| SSE removes the active recent | Highlight the first remaining row, or the empty copy |
| Accept a path missing from `fileIndex` | Do not open; drop it from recents |
| `/api/tree` or `/api/meta` failure | Unchanged from the parent spec |

## Testing

No Playwright. Follow existing UI contract tests. Do not change `MinoFuzzy` Node tests.

**Automated**

- `GET /` body includes `#quick-open-backdrop`. Stop requiring `#quick-open-footer` or the string `recently opened`.
- Served CSS includes `#quick-open-backdrop` with `position: fixed` and `inset: 0` (or equivalent `top/right/bottom/left: 0`); `.search-wrap` and `#quick-open` width `min(600px, 70vw)`; `.quick-open-item` `min-height: 22px`.
- Served `app.js` closes on backdrop `pointerdown` and handles `Escape` on the preview document in the capture phase.
- Catalog, server, and e2e `/api/search` tests stay substring-based and unchanged.

**Manual**

1. Open Quick Open, click the HTML preview and the Markdown preview: overlay closes; controls inside the iframe are not activated.
2. Click Explorer, activity bar, or top-bar chrome beside the overlay: overlay closes; the tree click does not select a file until a second click.
3. Click the overlay input or a result row: overlay stays open; Enter / click still opens the file.
4. With the preview focused, `Escape` closes the overlay; `Ctrl/Cmd+E`/`P` still opens it.
5. After opening a file, empty query lists recents with no footer; reload of the Mino page clears recents.
6. Command Center and overlay are the same width; overlay covers the entry. Rows are ~22px; active `#37373d` and match `#4fc1ff` unchanged.

## Success criteria

1. Clicking the preview while Quick Open is open closes it without delivering that click to the iframe.
2. `Escape` closes Quick Open from the shell and from the preview iframe.
3. Empty-query recents are the same file rows as search hits, with no `recently opened` footer.
4. Command Center and overlay share `min(600px, 70vw)`; rows are 22px; Command Center height is 24px.
5. Recents remain session-only; fuzzy ranking and `/api/search` are unchanged.
6. No chevron, `file results` label, split action, Copilot chrome, or visible dimming.

## File impact

| File | Change |
|------|--------|
| `internal/ui/index.html` | Add `#quick-open-backdrop`; remove `#quick-open-footer` |
| `internal/ui/style.css` | Backdrop; shared `min(600px, 70vw)` width; Command Center 24px; 22px rows; delete footer rules |
| `internal/ui/app.js` | Show/hide backdrop with picker; backdrop `pointerdown`; iframe `Escape`; delete footer wiring |
| `internal/server/server_test.go` | Assert backdrop; drop footer / `recently opened` markers as required |

No catalog, watcher, config, `fuzzy.js`, or `/api/search` changes.
