# Mino Status Bar and Markdown Preview Width Design

**Date:** 2026-08-27  
**Status:** Approved for planning  
**Scope:** Workbench bottom status bar (all file types) + Markdown preview width control  
**Approach:** Parent status bar + `localStorage` + `postMessage`; viewer CSS `data-md-width`

## Problem

The VS Code–inspired shell has no bottom status bar (explicitly omitted in `2026-08-22-mino-vscode-ui-design.md`). Markdown preview article width is fixed (~860px / layout ~1120px with outline). Users cannot widen the reading column for tables and code, and there is no workbench chrome for that control.

## Goals

1. Add a **full-width bottom status bar** on every workbench view (no file, HTML, Markdown).
2. When the open file is **Markdown**, show a right-side control to set preview width: **标宽 / 较宽 / 全宽**.
3. Persist the choice in **`localStorage`** under a `mino-` key; **all `.md` files share one width**.
4. Changing width updates the Markdown viewer **without reloading** the iframe.
5. Default width is **较宽**. Outline stays on the right in all three modes.

## Non-Goals

- Language mode, encoding, Git, cursor position, or other VS Code status items
- Per-file width, `config.toml`, or disk persistence
- Bright blue Default Dark+ status bar (use Dark Modern tokens)
- Keyboard shortcut dedicated to width (menu click only)
- Width control inside the Markdown iframe chrome
- Backend, catalog, watcher, or `/apps/` routing changes
- Light theme

## Approach (chosen)

**Parent status bar + `localStorage` + `postMessage`.**

The shell owns the status bar and the menu. The Markdown viewer (same origin) applies width via a root `data-md-width` attribute. The parent writes `localStorage` and notifies the iframe; the viewer also reads storage on boot so SSE iframe reloads restore the choice.

Alternatives considered:

1. **Parent bar + storage + postMessage (chosen)** — One VS Code–like bar; no iframe reload; no Go changes.
2. **Iframe URL query** — Simpler handoff, but every change reloads the viewer (scroll and Mermaid state lost).
3. **Width UI inside the Markdown iframe** — Parent would still need an empty bar for HTML; two chromes would not align.

## Layout

```text
┌─────────────────────────────────────────────────────────────┐
│ Top bar                                                     │
├────┬──────────────┬─────────────────────────────────────────┤
│ AB │ Explorer     │ Breadcrumb                              │
│    │              ├─────────────────────────────────────────┤
│    │              │ iframe / empty state                    │
├────┴──────────────┴─────────────────────────────────────────┤
│ status bar                                      [较宽 ▾]    │
└─────────────────────────────────────────────────────────────┘
```

- Place a `footer` **below** `.workbench`, spanning the full window (under activity bar and sidebar).
- Height **22px**. Background `--bg-shell` (`#181818`), top border `--border` (`#2b2b2b`). Not `#007ACC`.
- Left side empty in this version. Right side: Markdown width item only.
- No file selected or HTML preview: the item is **hidden**; the bar still occupies 22px. HTML apps lose 22px of iframe height; that is intended.
- Copy for this control is **Chinese** (`标宽` / `较宽` / `全宽`). Other chrome stays English.

## Width modes

Set `data-md-width="standard|wide|full"` on the Markdown viewer’s `document.documentElement` (`<html>`).

| UI label | Stored value | Article `max-width` | Layout |
|----------|--------------|---------------------|--------|
| 标宽 | `standard` | 960px | Centered; with outline, layout max-width = article + existing gap (24px) + outline (220px) |
| 较宽 | `wide` | 1400px | Same rule with 1400px article |
| 全宽 | `full` | none (flex remaining) | `.md-layout` width 100% of the iframe; outline stays right |

- **Default:** `wide` (较宽). Missing key, unreadable storage, or any value other than `standard` / `wide` / `full` → `wide`.
- If the preview pane is narrower than the cap, the article shrinks with the pane. **No horizontal page scrollbar** from this feature (tables/code may still scroll inside their own overflow).
- Outline remains visible in all three modes when the document has `h1`–`h3` (existing hide-when-empty behavior unchanged).
- Existing `@media (max-width: 959px)` outline stack stays. Do **not** keep the hardcoded layout `max-width: 860px` in that query; stacked layout must still obey `data-md-width` (on a 959px-wide iframe, 960/1400 caps already fill the pane).
- Replace today’s fixed `.markdown-body { max-width: 860px }` and `.md-layout` 1120/860 rules with the `data-md-width` selectors.

## Persistence

- Key: `mino-md-preview-width`
- Values: `standard` | `wide` | `full`
- Scope: this browser origin; **one value for all Markdown files**
- Known limit: default `port = 0` can change origin between runs; the setting is then lost. Accepted. No fallback to `.mino/config.toml`.

## Interactions

1. Open a catalog Markdown file (same rule as today: `.md` only): show the control with the current label (default **较宽**).
2. Click the control: open a **menu above** the item (VS Code language-mode style). Three rows: 标宽, 较宽, 全宽. Current row has a check mark. `aria-haspopup="menu"` / `aria-expanded`.
3. Choose a row: write storage, update the button label, `postMessage` the iframe, close the menu.
4. Close the menu without changing: click outside, Escape, or click the control again.
5. Switch to HTML, clear preview, or change the open path: **close the menu** and hide the control.
6. No new keyboard shortcut. Do not intercept Quick Open (`Ctrl/Cmd+E`, `Ctrl/Cmd+P`).

## Data flow

```text
UI boot → read localStorage → in-memory width (default wide)
Open file
  · .md  → show control, label from in-memory width
  · else → hide control
Pick width
  → memory + localStorage['mino-md-preview-width']
  → postMessage to #preview iframe
  → button label
iframe load (including SSE reload)
  → parent postMessage current width (covers pick-before-load)
viewer boot
  → read localStorage (same key) → set data-md-width
  → listen for message
```

**Message** (parent → iframe only; not broadcast):

```js
{ source: "mino", type: "md-preview-width", value: "standard" | "wide" | "full" }
```

Viewer accepts only when `event.origin === window.location.origin` and `source === "mino"` and `type === "md-preview-width"` and `value` is one of the three strings. Otherwise ignore.

HTML documents have no listener; a stray message is a no-op. Parent sends only while the open path is `.md`.

## Architecture / file impact

No Go server, catalog, or config changes. UI remains `embed.FS`.

| File | Change |
|------|--------|
| `internal/ui/index.html` | `footer` status bar + width button + menu markup |
| `internal/ui/style.css` | Status bar, menu, Dark Modern tokens |
| `internal/ui/app.js` | Show/hide from open path; menu; storage; postMessage; re-send on iframe `load` |
| `internal/ui/md/viewer.js` | Read storage on boot; message listener; set `data-md-width` |
| `internal/ui/md/viewer.css` | Width rules keyed by `data-md-width`; drop fixed 860/1120 caps |
| `README.md` | Mention Markdown preview width (标宽 / 较宽 / 全宽) and `localStorage` |

Extract small pure helpers where it keeps tests cheap (parse stored value → mode; “is this path Markdown”).

## Error handling

| Situation | Behavior |
|-----------|----------|
| Missing or invalid storage value | `wide` |
| `localStorage` throws (private mode, quota) | Do not throw; keep in-memory mode for the session; next load may return to 较宽 |
| Width changed before iframe `load` | Parent keeps the value and postMessages on `load` |
| SSE `changed` reloads the iframe | Viewer reads storage on boot; parent also postMessages on `load` |
| Open HTML or empty preview | Hide control; close menu |
| Preview narrower than 960 / 1400 | Article shrinks; no page-level horizontal scroll from the cap |
| `port = 0` origin change | Setting lost; default 较宽 |

## Testing

- **Manual:** Status bar visible with no file, HTML, and Markdown. HTML right side empty. `.md` shows 较宽 by default. Menu check mark and labels. All three widths with and without outline. Refresh keeps the choice on the same origin. Switching files closes the menu. Narrow preview pane does not add a page scrollbar.
- **Automated:** Unit-test parse-storage and Markdown-path helpers if extracted. No new backend tests. No browser automation required.

## Success criteria

1. Every workbench state shows a 22px Dark Modern status bar.
2. Only Markdown shows **标宽 / 较宽 / 全宽**; default 较宽 is 1400px article; 标宽 is 960px; 全宽 fills the preview; outline stays.
3. Choice survives refresh on the same origin via `mino-md-preview-width`.
4. Changing width does not reload the iframe.
5. HTML preview and APIs are unchanged except for the 22px shorter pane.
