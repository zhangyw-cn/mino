# Explorer Tree Density and Expand/Collapse All

**Date:** 2026-09-22  
**Status:** Approved for planning  
**Scope:** Left Explorer file tree visual density + Expand All / Collapse All in the Explorer header  
**Approach:** Indent guides as the signature; header action cluster; expand state stays in-memory on `WorkbenchApp`

## Problem

The Explorer tree already opens files and toggles folders, but hierarchy is hard to scan: indent is only empty pixels, the twistie is a Unicode `▶`, and there is no way to expand or collapse the whole tree. The rest of the workbench already uses VS Code Dark Modern chrome; this change stays in that language.

## Goals

1. Make directory depth readable at a glance with **indent guides**.
2. Tighten row alignment: SVG twistie, 16px indent columns, existing 13px / 22px type.
3. Add **Expand All** and **Collapse All** as icon buttons in the Explorer title bar, next to the existing collapse-sidebar control.
4. Keep click-to-open, click-to-toggle-folder, Quick Open reveal-in-tree, and session restore behavior.

## Non-Goals

- Keyboard navigation in the tree
- Right-click / context menu
- Persisting expand state to disk or sessionStorage
- Resizable sidebar, virtualization, or a new Explorer container component
- Selecting folders (folder click still only expands/collapses)
- Backend / `/api/tree` changes
- Restyling activity bar, preview, or status bar

## Approach (chosen)

**Indent guides + header action cluster** (not density-only, not a new visual language).

The memorable element is vertical 1px guides at each ancestor depth. Header actions are a quiet cluster: Expand All, Collapse All, a divider, then Collapse Explorer.

## Visual

Tokens (existing shell, plus guide):

| Token | Hex | Role |
|-------|-----|------|
| sidebar | `#1f1f1f` | Explorer background |
| text | `#cccccc` | File/folder names |
| hover | `#2a2d2e` | Row hover |
| selection | `#04395e` | Currently open **file** row only |
| guide | `#373737` | Indent guide |
| muted | `#6e6e6e` | Twistie, empty copy, disabled icons |

Type: Explorer heading 11px uppercase; tree 13px / 22px line-height.

Row geometry:

- Left padding = `8 + depth * 16` pixels.
- Depth 0 has no guides. A row at depth `d` draws `d` vertical 1px lines, one per ancestor column, at `x = 8 + i * 16 + 8` for `i` in `0 .. d-1` (center of each 16px indent column). Guides continue through the selected row.
- Twistie is a 16px SVG chevron (collapsed: right; expanded: rotate 90° down), replacing `▶`. Folder/file icons stay 16px and keep current fills.

Header:

```text
Explorer                    [expand-all] [collapse-all] | [collapse sidebar]
```

Each action is a 24×24 icon button. Hover background `#2a2d2e`. Expand/Collapse All sit left of a 1px `#2b2b2b` divider; Collapse Explorer stays on the far right as today.

Copy: `aria-label` / `title` are English — `Expand all`, `Collapse all`, existing `Collapse explorer`.

## Expand / collapse semantics

`expandedPaths: Set<string>` stays in `WorkbenchApp` memory. Virtual root `""` is always treated as expanded and is never a visible row. The tree always paints `root.children`.

| Action | Result |
|--------|--------|
| Expand all | `expandedPaths = { "", ...collectDirPaths(treeRoot) }` |
| Collapse all | `expandedPaths = { "" }` — top-level files and collapsed folders remain visible |
| Click folder | Toggle that path only (unchanged) |
| Open file / Quick Open / restore | Still add `ancestorPaths(path)` (unchanged) |

Helpers in `web/src/lib/api.ts`:

- `collectDirPaths(root: TreeNode | null | undefined): string[]` — every node with `type === "dir"` and a non-empty `path`. Excludes `""` and files. Includes empty directories if the API returns them. `null`/`undefined` → `[]`.
- `pruneExpandedPaths(expanded: Iterable<string>, dirPaths: Iterable<string>): Set<string>` — `{ "" }` union (`expanded` ∩ `dirPaths`).

Button disabled state:

| Button | Disabled when |
|--------|----------------|
| Expand all | `treeStatus` is set, or there are no directory paths, or every collected directory path is already in `expandedPaths` |
| Collapse all | `treeStatus` is set, or there are no directory paths, or no collected directory path is in `expandedPaths` |

Disabled buttons do nothing.

On successful `loadTree`, compute `dirPaths = collectDirPaths(root)`, then set `expandedPaths` once: `pruneExpandedPaths(previous, dirPaths)`, then if a path is restored add `ancestorPaths(restored)`. Do not leave a frame where restore and prune race as two independent `setExpandedPaths` calls.

## Architecture

State owner remains `WorkbenchApp`. No global store. `ExplorerTree` stays presentational.

```text
/api/tree  →  WorkbenchApp
                treeRoot
                expandedPaths
                treeStatus
                    ├─ header action cluster (expand / collapse / collapse sidebar)
                    └─ ExplorerTree → TreeRow (guides + SVG chevron)
```

| File | Change |
|------|--------|
| `web/src/lib/api.ts` | Add `collectDirPaths` and `pruneExpandedPaths` |
| `web/src/app/WorkbenchApp.tsx` | `expandAll` / `collapseAll`; header buttons; prune on load |
| `web/src/features/explorer/ExplorerTree.tsx` | Indent 8+depth×16; guides; SVG chevron |
| `web/src/components/Icon.tsx` | Add `chevron`, `expand-all`, `collapse-all` |

`ExplorerTree` props stay: `root`, `expandedPaths`, `selectedPath`, `onToggleExpand`, `onOpenPath`, `statusMessage`. Expand-all does not pass through the tree.

Data flow: Expand all / Collapse all only call `setExpandedPaths`. They do not fetch. Tree click handlers unchanged.

## Error and edge cases

| Situation | Behavior |
|-----------|----------|
| Loading (`treeStatus` set) | Existing status copy; both new buttons disabled |
| Load failure | Existing `Could not load files.`; both new buttons disabled |
| Empty tree | Existing `No HTML or Markdown files found.`; both new buttons disabled |
| Tree refresh removes a folder | That path is pruned from `expandedPaths` |
| Open file after Collapse all | Ancestors expand so the file is visible |
| Sidebar collapsed | Header (including new buttons) is not interactive (`inert`); activity bar still toggles the sidebar |

## Testing

1. **`web/src/lib/api.test.ts` (new)**  
   - `collectDirPaths` returns nested dirs, excludes `""` and files.  
   - `pruneExpandedPaths` drops missing dirs and always keeps `""`.

2. **`web/src/features/explorer/ExplorerTree.test.tsx`**  
   - File click still calls `onOpenPath`.  
   - Folder click still calls `onToggleExpand`.  
   - Children are not rendered when the folder is collapsed.  
   - The open file row uses the selection background.

3. **Out of scope**  
   - Guide pixel positions and SVG path shapes.  
   - Full `WorkbenchApp` mount.  
   - Keyboard, context menu, persistence.  
   - New Go tests.

## Success criteria

1. Nested folders show a vertical guide per ancestor depth; selected file rows still use `#04395e`.
2. Explorer header has Expand all and Collapse all, disabled correctly for loading/empty/already-expanded/already-collapsed.
3. Expand all opens every directory; Collapse all leaves only top-level entries visible.
4. Opening a file after Collapse all still expands its ancestors and previews as today.

## Implementation notes

- English UI strings, matching the rest of the workbench.
- Derive colors from the table above; do not introduce a second palette.
- Prefer CSS (padding + background/box-shadow or absolutely positioned spans) for guides; do not add a canvas or extra layout library.
