# Mino UI Icon Polish Design

**Date:** 2026-08-23  
**Status:** Approved for planning  
**Scope:** Replace Unicode/color-chip chrome with inline SVG icons (tree, Quick Open, Command Center, activity bar, collapse, empty state, breadcrumb) and fix HTML-only empty copy  
**Approach:** JS SVG helper + `data-icon` slots; VS Code–style tree rows (chevron + type icon); no icon font and no build step  
**Extends:** `2026-08-22-mino-vscode-ui-design.md`, `2026-08-23-mino-command-center-quick-open-design.md`, `2026-08-23-mino-quick-open-dismiss-recents-ui-design.md` — layout, Dark Modern tokens, Quick Open behavior, and dismiss layer stay as implemented

## Problem

The workbench already looks like VS Code Dark Modern, but glyphs are leftover Unicode and type chips:

- Explorer directories show only a rotating `▶`; files are all `◇`, so HTML and Markdown look the same.
- Quick Open uses 16×16 color squares (`.quick-open-chip`) instead of file icons.
- Activity bar is `☰`, collapse is `⟨`, empty preview is `◇`, and neither Command Center nor the overlay input shows a search affordance.
- Empty copy still says HTML only (`Choose an HTML file from the sidebar.`, `No HTML files found.`) even though Markdown is in the catalog.

Earlier specs allowed Unicode/CSS affordances and kept color chips to avoid an icon font. That tradeoff now reads as unfinished chrome.

## Goals

1. Directories and files use **recognizable inline SVG icons** in the Explorer tree, including open vs closed folders and HTML vs Markdown files.
2. Quick Open result rows use the **same file icons** (not color chips).
3. Command Center, Quick Open input, activity bar, collapse control, empty preview, and the selected-file breadcrumb use the **same icon language**.
4. Empty-state copy mentions **HTML and Markdown**.
5. No icon font, webfont, npm dependency, or frontend build step. No Go API / catalog / watcher changes except test contract strings.

## Non-Goals

- VS Code Codicons font or any other icon pack
- Light theme / theme switcher
- Clickable breadcrumb segments
- Extra file types beyond HTML/HTM, Markdown, and a generic fallback
- Folder icons in Quick Open (picker lists files only)
- Per-segment icons in the breadcrumb path
- Changing brand mark (`M`), fuzzy ranking, recents, dismiss behavior, or `/api/search`
- Command palette or new activity-bar views

## Approach (chosen)

**VS Code row structure + JS-inlined SVG helper.**

Tree rows stay `chevron + type icon + label`. Directories keep the existing rotating `▶` and add `folder` / `folder-open`. Files replace `◇` with type-colored document icons. Quick Open replaces chips with those same file SVGs.

Path data lives once in `internal/ui/app.js`. `icon(name)` builds SVG nodes via `document.createElementNS`. Static chrome uses empty `data-icon` slots in `index.html` filled on boot, so paths are not duplicated.

Alternatives considered:

1. **JS helper + chevron + type icon (chosen)** — Matches the existing VS Code shell; expand affordance stays; one source of path data.
2. **Folder glyph only, no chevron** — Cleaner rows, weaker expand cue, diverges from the current workbench.
3. **SVG sprite in `index.html` + `<use>`** — Same look, more `currentColor`/`href` pitfalls for a handful of icons.

## Architecture

```text
index.html data-icon slots          app.js icon() / fileIconName()
  activity explorer  ─┐               tree makeRow()
  collapse           ├─ fillIcons()   Quick Open rows
  command-center     │                breadcrumb (selected file)
  overlay input      │
  empty preview      ─┘
```

No change to `/api/tree`, `/api/meta`, SSE, preview URLs, or `MinoFuzzy`. Icons are render-only: whenever the tree or picker is rebuilt, new SVG nodes are inserted.

Shared type mapping (`fileIconName(path)`, basename, case-insensitive):

| Path | Icon name | Fill |
|------|-----------|------|
| `*.html`, `*.htm` | `file-html` | `#e36e6e` (existing HTML chip) |
| `*.md` | `file-md` | `#519aba` (existing Markdown chip) |
| anything else | `file` | `#6e6e6e` (existing default chip) |

Directory icons: `#dcb67a` (VS Code–like folder gold). Chrome icons (`search`, `explorer`, `collapse`, `empty`) use `currentColor` so hover/active/focus already defined on the parent keep working.

## Components

### Icon helper

In `app.js`:

- `ICON_PATHS`: compact original path `d` strings (simple file/folder/search/layout glyphs in the spirit of VS Code, not a vendored font file).
- `icon(name, { size })` → `<svg>` with `viewBox="0 0 16 16"`, `width`/`height` = `size` (default 16), class `icon icon-{name}`, `aria-hidden="true"`, `fill` from the table above or `currentColor`.
- Names: `folder`, `folder-open`, `file-html`, `file-md`, `file`, `search`, `explorer`, `collapse`, `empty`.
- `fillIcons(root)`: for each `[data-icon]` under `root` (default `document`), replace children with `icon(dataset.icon, { size: Number(dataset.iconSize) || 16 })`.

All decorative SVGs are `aria-hidden="true"`. Accessible names stay on the existing buttons, `aria-label`s, and visible labels.

### Explorer tree

`makeRow` keeps a chevron `span.chevron` with `▶` for directories (existing rotate on `.expanded`). After the chevron (dirs) or instead of `◇` (files):

- Dir: both `folder` and `folder-open` nodes. CSS shows `folder` by default and `folder-open` when `.tree-row.expanded`; the other is `display: none`. Click handling for expand/collapse is unchanged (`expandedPaths`, `aria-expanded`, `children.hidden`).
- File: one `file-html` / `file-md` / `file` from `fileIconName`.

Row height stays 22px; icon 16×16; `gap` 6px. Hover/selected styles unchanged. Drop the monospace `◇` `.file-icon` text styling; type icons use `.icon`.

### Quick Open

Remove `.quick-open-chip` (HTML/CSS/JS). Each result button starts with the same file SVG as the tree (`fileIconName(row.path)`), class `quick-open-icon`, still 16×16, `flex-shrink: 0`. Row remains: icon + basename + parent path (`margin-left: auto`). Marks, recents, keyboard, and dismiss behavior unchanged.

### Command Center

Do **not** set `commandCenter.textContent` (that would wipe child nodes). Structure:

```text
#command-center
  span[data-icon="search"][data-icon-size="14"]   (absolute, left 8px)
  span.command-center-label                        (workspace name)
```

`loadMeta` writes `meta.name` to `.command-center-label` and to `commandCenter.title` (unchanged). Label stays `text-align: center` on the full button width so the name does not shift right of the icon. Search icon is `currentColor`, muted (`--fg-muted`); the button’s existing focus/hover does not need new colors.

### Quick Open input

Wrap the overlay field:

```text
.quick-open-input-wrap
  span[data-icon="search"][data-icon-size="14"]
  #quick-open-input
```

Icon is `currentColor` / `--fg-muted`, 14px, left of the field. Input keeps placeholder `Search files by name`, combobox ARIA, and accent focus. Padding on the input (or wrap) leaves 22px for the glyph so the caret does not overlap it.

### Activity bar and collapse

Replace `☰` with `<span data-icon="explorer" data-icon-size="24">` inside `#activity-files`. Replace `⟨` with `<span data-icon="collapse" data-icon-size="16">` inside `#sidebar-collapse`. Both `currentColor`. Existing `.activity-item.active` (left accent bar) and `.icon-button` hover/focus stay.

### Breadcrumb

`setBreadcrumb(path)` no longer assigns `breadcrumb.textContent` when a file is open. It clears children and appends `fileIconName(path)` at 16px plus a span with `path.split("/").join(" / ")`. When `path` is empty: no icon, text `No file selected`, `data-empty="true"` as today. Flex align center, 6px gap. Path typography (monospace 12px) unchanged.

### Empty preview and empty tree

`index.html` empty icon slot: `<div class="empty-icon" data-icon="empty" data-icon-size="34" aria-hidden="true">` (no `◇`). Copy:

| Surface | New string |
|---------|------------|
| Empty preview subtitle | `Choose an HTML or Markdown file from the sidebar.` |
| Empty tree (`showMessage` when the catalog has no files) | `No HTML or Markdown files found.` |

`No preview selected`, `Loading files…`, `Could not load files.`, Quick Open empty strings, and `No file selected` stay as they are.

## Data flow

Unchanged except render:

```text
/api/tree → lastTree / fileIndex
  → renderTreeFromCache → makeRow → icon()
  → renderPicker → fileIconName + icon()
openFile → setBreadcrumb → file icon + path
boot → fillIcons(document)
```

Unknown extensions never throw: `fileIconName` always returns `file-html`, `file-md`, or `file`. Catalog still only lists HTML/HTM/Markdown; the generic icon is defensive.

## Error and edge cases

| Situation | Behavior |
|-----------|----------|
| Unknown extension | Generic `file` icon, fill `#6e6e6e` |
| Empty catalog | Muted `No HTML or Markdown files found.` |
| Tree load failure | Existing `Could not load files.` |
| No file selected | Breadcrumb text only; empty preview with `empty` icon |
| `loadMeta` | Updates `.command-center-label`, not the whole button |
| Screen readers | Icons hidden; names remain on controls and labels |

## File impact

| File | Change |
|------|--------|
| `internal/ui/app.js` | `ICON_PATHS`, `icon`, `fillIcons`, `fileIconName`; tree/picker/breadcrumb/meta rendering |
| `internal/ui/index.html` | `data-icon` slots; Command Center label span; overlay input wrap; empty copy |
| `internal/ui/style.css` | Icon sizing; folder open/closed; Command Center icon position; input wrap; drop `.quick-open-chip`; breadcrumb flex |
| `internal/server/server_test.go` | Replace `.quick-open-chip` with `.quick-open-icon`; assert `command-center-label`, `data-icon`, and `No HTML or Markdown files found.` |

No changes to `embed.go` (still the same static files), catalog, watcher, or config.

## Testing

- **Automated:** `TestAppJSWorkbenchContracts`: drop `.quick-open-chip`; require `.quick-open-icon`, `fileIconName`, `command-center-label`, and `No HTML or Markdown files found.` `TestIndexHTMLHasIframeAndAppJS`: require `data-icon` and `command-center-label`; forbid `☰` and `◇`. Keep existing Quick Open / workbench contracts.
- **Manual:** Expand/collapse folders (chevron + folder glyph swap); HTML vs Markdown in tree, Quick Open, and breadcrumb; Command Center and overlay magnifiers; activity bar / collapse color on hover and active; empty preview; empty workspace message; selected-row contrast on colored icons.

## Success criteria

1. Tree directories show chevron plus folder (open when expanded); files show HTML vs Markdown icons, not `◇`.
2. Quick Open rows use those file icons, not color squares.
3. Search, Explorer, collapse, empty, and selected breadcrumb use the same SVG set.
4. Empty copy mentions HTML and Markdown.
5. Quick Open, live reload, sidebar collapse, and preview behavior are unchanged.

## Implementation notes

- Prefer structural HTML + CSS; keep listing/SSE/preview URL logic intact.
- Original compact SVG paths; do not add `internal/ui/md/vendor`-style third-party icon assets.
- English UI strings only, matching the rest of the chrome.
- YAGNI: no per-folder tints, no breadcrumb segment icons, no light-theme fills.
