# Mino Refresh Keeps Current Preview Design

**Date:** 2026-08-27  
**Status:** Approved for planning  
**Scope:** Restore the currently previewed file after a same-tab browser refresh  
**Approach:** `sessionStorage` key `mino-open-path` (relative catalog path only)

## Problem

The workbench keeps the open file in memory (`currentPath`). Reloading the page (`/` ) rebuilds the tree and returns to the empty preview (“No preview selected”). Recents are also in-memory and already specified to clear on reload. Users who refresh lose their place.

## Goals

1. Same-tab refresh (F5 / reload) reopens the file that was previewed, if it is still in the catalog.
2. The address bar stays `/` (no hash, no query). Copying the URL or opening a new tab on `/` does **not** carry the file.
3. If the stored path is missing or no longer in the catalog, show the empty preview, as if nothing was selected.
4. Preserve existing SSE behavior: `changed` reloads the iframe; `removed` of the open file clears the preview.

## Non-Goals

- Encoding the open file in the URL (hash or query)
- `localStorage`, cookies, `config.toml`, or disk persistence of the open file
- Persisting recents, Explorer expansion independent of the open file, sidebar collapsed state, iframe scroll, Markdown TOC position, or Mermaid zoom/mode
- Changing catalog, watcher, `/apps/*`, or Markdown viewer internals
- Restoring a file that is not in `fileIndex`

## Approach (chosen)

**`sessionStorage` of the relative catalog path.**

`sessionStorage` is per origin and per tab: refresh keeps the value; a new tab starts empty; the visible URL stays `/`.

Alternatives considered:

1. **`sessionStorage` path only (chosen)** — Matches tab-scoped refresh; no URL change; no Go catalog changes.
2. **`history.replaceState` with unchanged URL** — Also survives refresh without a visible URL change, but mixes preview state with history and future Back/Forward.
3. **`sessionStorage` blob (path + expanded folders + recents)** — More than requested; conflicts with “reload clears recents.”

## Persistence

- Key: `mino-open-path`
- Value: catalog relative path, same string as `currentPath` (for example `docs/sample.md`). Not URL-encoded.
- Scope: this tab’s `sessionStorage` on this origin
- Known limit: default `port = 0` can change origin between Mino runs; the key is then empty. Accepted. No fallback to `localStorage` or `.mino/`.

Parse rules for a stored value:

- `null` / missing / non-string → treat as empty
- After trim, empty → treat as empty
- Otherwise the trimmed string is the candidate path

Write only a non-empty candidate. Clearing preview deletes the key.

## Data flow

```text
openFile(path)
  → currentPath, breadcrumb, iframe, selection (unchanged)
  → sessionStorage['mino-open-path'] = path

clearPreview()
  → empty preview (unchanged)
  → remove sessionStorage['mino-open-path']

First successful GET /api/tree (fileIndex built)
  → read candidate
  → if candidate ∈ fileIndex:
        expand ancestors (same as Quick Open acceptPath)
        openFile(candidate)
        re-render tree so the selected row is visible
     else:
        remove key if present
        keep empty preview
  → never run this restore again in this page lifetime

Later loadTree (SSE, etc.)
  → do not restore from storage
  → if SSE path === currentPath:
        changed → reload iframe
        removed → clearPreview (and thus remove the key)
```

Restore is tied to the **first successful** tree load, not the first `loadTree` call. A failed or aborted first fetch leaves the key alone; the next successful tree load still restores. If the tree never loads, the preview stays empty and the key is left as-is.

`openFile` still calls `rememberOpen`. A successful restore therefore seeds recents with that one path. Other recents stay cleared on reload, as today.

Explorer folders that are ancestors of the restored file are expanded so the selected row is visible. Other expansion state is not persisted.

## Architecture / file impact

UI remains `embed.FS`. Extract a small UMD helper (same pattern as `preview-width.js`) so storage parse/read/write/clear and “is this path in the index” can be unit-tested without the full workbench.

| File | Change |
|------|--------|
| `internal/ui/open-path.js` | New: `STORAGE_KEY`, parse / read / write / clear / resolve against `fileIndex`; swallow storage exceptions |
| `internal/ui/index.html` | Script tag for `/open-path.js` before `app.js` |
| `internal/ui/app.js` | Write on `openFile`, clear on `clearPreview`, restore once after first successful `loadTree` |
| `internal/ui/embed.go` | Embed `open-path.js` |
| `internal/server/server.go` | `GET /open-path.js` |
| `internal/server/server_test.go` | Assert the asset is served (same style as other UI scripts) |
| `internal/ui/testdata/open_path_test.mjs` | Node unit tests |
| `internal/ui/open_path_node_test.go` | `node --test` wrapper |
| `README.md` | One line: same-tab refresh keeps the open preview |

Helper exports:

- `parseOpenPath(value)` → trimmed non-empty string or `""`
- `readOpenPath(storage)` → parsed value or `""`; catch throws
- `writeOpenPath(storage, path)` → write parsed path, or clear if empty; catch throws
- `clearOpenPath(storage)` → `removeItem`; catch throws
- `resolveOpenPath(stored, fileIndex)` → `stored` if it is a non-empty string in `fileIndex`, else `""`

`app.js` owns the one-shot restore flag and the call to expand ancestors + `openFile`.

## Error handling

| Situation | Behavior |
|-----------|----------|
| No key, empty, or whitespace-only | Empty preview; remove key if it existed |
| Candidate not in `fileIndex` (deleted, renamed, ignored) | Empty preview; remove key |
| `sessionStorage` throws (private mode, quota) | Do not throw; open/clear preview still work; refresh will not restore |
| First `/api/tree` fails or aborts | Do not restore; do not remove key; restore on the next successful load |
| Tree never succeeds | Empty preview; key unchanged |
| SSE `removed` of the open file | `clearPreview` (which removes the key) |
| SSE `changed` of the open file | Reload iframe only; key unchanged |
| New tab or copied `/` URL | Empty `sessionStorage` → empty preview |
| `port = 0` origin change | Key gone; empty preview |
| Stored `../` or other non-catalog string | Not in `fileIndex` → empty preview; remove key. Load still goes through existing `openFile` / `previewURL` |

## Testing

- **Automated:** Node tests for parse / read / write / clear / resolve; storage that throws; missing and invalid values; path not in `fileIndex`. Go test that `/open-path.js` is served. No browser automation.
- **Manual:** Open `example/docs/sample.md`, refresh, same preview and tree selection. Open `/` in a new tab → empty preview. Delete or rename the open file, refresh → empty preview. Edit the open file on disk → iframe reloads, still that file.

## Success criteria

1. Same-tab refresh of `/` reopens the last previewed catalog file and selects it in Explorer.
2. Address bar stays `/`. A new tab on `/` shows the empty preview.
3. A stored path that is gone from the catalog yields the empty preview and drops the key.
4. SSE `changed` / `removed` for the open file behave as they do today, and `removed` also clears the storage key.
5. Recents other than the restored file still do not survive reload.
