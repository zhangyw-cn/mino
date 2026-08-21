# Mino VS Code–Inspired UI Design

**Date:** 2026-08-22  
**Status:** Approved for planning  
**Scope:** Embedded browser UI visual refresh + workbench-like shell layout  
**Approach:** Light VS Code shell redesign (Dark Modern tokens; no backend changes)

## Problem

Mino’s browser UI already supports search, file tree, and iframe preview, but the chrome looks generic (light zinc panels + dark top bar) and does not match the “local developer tool” expectation users associate with VS Code.

## Goals

1. Restyle the shell to feel close to **VS Code Dark Modern**.
2. Adopt a **VS Code–like layout**: activity bar + collapsible Explorer sidebar + preview area.
3. Replace the preview path strip with a **display-only breadcrumb**.
4. Keep search in the **top bar center**.
5. Preserve existing behavior: tree, search filter, iframe preview, SSE live reload, watch-failure banner.

## Non-Goals

- Light theme / theme switcher
- Status bar
- Tabbed preview / multi-file tabs
- Clickable breadcrumb navigation
- Resizable sidebar (drag)
- Persisting sidebar collapsed state to config or disk
- Command palette or new product features
- Backend, API, catalog, watcher, or config changes
- Pixel-perfect VS Code clone or extra activity-bar views

## Layout

```text
┌─────────────────────────────────────────────────────────────┐
│ Top bar: brand + workspace name     [ Search files… ]       │
├────┬──────────────┬─────────────────────────────────────────┤
│ AB │ Explorer     │ Breadcrumb: tools / timer.html          │
│    │ (tree)       ├─────────────────────────────────────────┤
│    │              │ iframe preview / empty state            │
│    │              │                                         │
└────┴──────────────┴─────────────────────────────────────────┘
```

| Region | Behavior |
|--------|----------|
| Top bar | Brand mark + `mino` / workspace `name`; centered search; no menu bar |
| Activity bar (~48px) | Single **Files** control; clicking toggles sidebar visibility |
| Sidebar | “Explorer” heading + collapse control; existing file tree below |
| Preview chrome | Display-only breadcrumb when a file is open; muted “No file selected” when empty |
| Preview body | Existing iframe + empty state |

Collapsed sidebar: activity bar remains; preview fills remaining width. No bottom status bar.

## Visual design (Dark Modern)

CSS custom properties on `:root` (names illustrative; implement consistently):

| Token | Role | Value |
|-------|------|-------|
| `--bg-shell` | Top bar, activity bar, preview backdrop | `#181818` |
| `--bg-sidebar` | Sidebar + breadcrumb strip | `#1f1f1f` |
| `--border` | Separators | `#2b2b2b` |
| `--fg` | Primary text | `#cccccc` |
| `--fg-muted` | Secondary / empty hints | `#6e6e6e` |
| `--fg-strong` | Emphasized text | `#ffffff` |
| `--accent` | Active activity indicator, search focus | `#0078d4` |
| `--selection` | Selected tree row | `#04395e` |

- Search: default blends with shell; focus uses accent border (VS Code–like blue focus).
- Fonts: system UI sans for chrome; monospace for breadcrumb paths. No bundled webfonts.
- Watch banner: keep existing copy/logic; restyle so it fits under the dark top bar.

## Interactions

1. **Collapse:** Activity bar Files **or** Explorer collapse control hides the sidebar for the current session only (in-memory). Re-click Files to expand.
2. **Tree:** Keep expand/collapse directories and file open behavior; restyle hover/selected states.
3. **Breadcrumb:** Render `segment / segment / file.html` from the selected relative path; not clickable.
4. **Search:** Unchanged filtering; `Ctrl/Cmd+F` focuses the search input (do not open the browser find dialog for the shell chrome).
5. **Empty preview:** Existing empty-state message with dark-theme colors; breadcrumb shows “No file selected”.

## Architecture / file impact

No change to Go server modules. UI remains `embed.FS` static assets.

| File | Change |
|------|--------|
| `internal/ui/index.html` | Activity bar, Explorer header/collapse, breadcrumb container |
| `internal/ui/style.css` | Dark tokens, workbench grid, component states |
| `internal/ui/app.js` | Sidebar toggle, breadcrumb rendering, optional search focus shortcut; leave listing/SSE/preview URL logic intact |

Data flow (unchanged):

```text
UI load → /api/tree → /api/events (SSE)
Search → /api/search?q=
Open file → iframe /apps/<path>
```

## Error and edge cases

| Situation | Behavior |
|-----------|----------|
| Sidebar collapsed | Preview usable; breadcrumb still updates |
| Empty tree / no search hits | Existing muted empty copy; dark styling |
| Watch unavailable | Existing banner; styling only |
| Clear preview (file removed) | Empty state + “No file selected” breadcrumb |

## Testing

- **Manual:** Collapse/expand; search; select file; breadcrumb text; empty state; watch banner appearance.
- **Automated:** No new backend tests expected. Update only if any test asserts on previous HTML/CSS structure or light-theme selectors.

## Success criteria

1. First viewport reads as a dark VS Code–like workbench (activity bar + Explorer + preview).
2. Search remains in the top bar and still filters the tree.
3. Open file shows a non-interactive breadcrumb path; iframe preview still works with live reload.
4. No API/config/watcher behavior regressions.

## Implementation notes

- Prefer structural HTML + CSS; keep JS changes minimal.
- Avoid introducing a frontend build step or icon font dependency; simple Unicode/CSS affordances are fine for activity/collapse icons.
- Align copy with existing English UI strings unless a string must change for the empty breadcrumb.
