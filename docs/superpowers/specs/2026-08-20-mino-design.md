# Mino Design Spec

**Date:** 2026-08-20  
**Status:** Approved for planning  
**Form:** Go CLI + local HTTP server + embedded browser UI

## Problem

People keep many single-file HTML apps (self-contained `.html` pages) scattered on disk. There is no lightweight way to start from a directory, get a local URL, and browse / filter / open those pages the way a filesystem browser works.

## Goals

1. Run `mino <dir>` (or current directory), print a local URL, open it in a browser.
2. Present registered `.html` files in a filesystem-like tree.
3. Filter by relative path / filename (case-insensitive substring).
4. Open a selected page in an in-page iframe preview.
5. When files under the root change, update the tree and reload the preview if the open file changed—without a full manual page refresh.
6. Keep configuration minimal under `.mino/`.

## Non-Goals (v1)

- Full-text search of HTML content
- Tags, favorites, or rich per-file metadata stores
- In-app create / rename / delete / edit
- Serving companion assets (`.css`, `.js`, images next to the HTML)
- Multi-workspace, auth, or LAN exposure by default
- Desktop app shell

## Approach

Single Go binary with:

- Embedded static UI (`embed`)
- In-process catalog of HTML files
- `fsnotify` (or equivalent) directory watcher
- SSE for live updates to the UI
- Strict path checks when serving `/apps/*`

## Architecture

```text
CLI → Config (.mino) → Catalog (scan) → HTTP Server
                           ↑                │
                        Watcher ────────────┤
                                            ▼
                              Browser UI (tree + search + iframe)
```

| Module | Responsibility |
|--------|----------------|
| CLI | Parse args (root path, `--port` override), start server, print URL, exit on fatal config/root errors |
| Config | Read/create `.mino/config.toml` |
| Catalog | Hold tree + flat list of HTML entries; apply ignore rules; support path/name filter |
| Watcher | Watch root; apply incremental catalog updates; emit events |
| Server | Serve UI, APIs, SSE, and HTML files |
| UI | Embedded HTML/CSS/JS; no separate frontend toolchain |

**Security**

- Bind to `127.0.0.1` by default.
- Serve only files that are under the root, match `.html`/`.htm`, and are present in the catalog.
- Reject path traversal and non-HTML targets under `/apps/`.

## Directory and configuration

Workspace layout:

```text
<root>/
  .mino/
    config.toml
  notes/
    doodle.html
  tools/
    timer.html
```

### `config.toml`

| Key | Meaning | Default |
|-----|---------|---------|
| `name` | Workspace display name (UI title) | Basename of root |
| `port` | Listen port; `0` = ephemeral free port | `0` |
| `host` | Bind address | `127.0.0.1` |
| `ignore` | Extra ignore globs (relative to root) | `[]` |

**Built-in ignores (fixed set in v1):** `.mino/`, `.git/`, `.hg/`, `.svn/`, `node_modules/`.

**Rules**

- Only `.html` and `.htm` files are app entries.
- Directories organize the tree; empty directories are shown so browsing feels like a filesystem.
- First start creates `.mino/config.toml` with defaults if missing.
- CLI `--port` overrides config for that run and does not write back.
- Corrupt `config.toml` → fail loudly with a clear error; do not silently overwrite.

## UI, API, and data flow

### UI

- Top: workspace `name` + search box (path/filename substring, case-insensitive).
- Left: expandable directory tree; HTML files as leaves.
- Right: iframe preview; empty state when nothing selected.
- Selection shows the current relative path near the preview or in the chrome.

### HTTP routes

| Method / path | Purpose |
|---------------|---------|
| `GET /` | Embedded browser UI |
| `GET /api/tree` | Current directory tree (or equivalent structure for the UI) |
| `GET /api/search?q=` | Server-side filter by path/filename |
| `GET /api/events` | SSE: `added` / `removed` / `changed` with relative paths |
| `GET /apps/*` | Serve catalogued HTML under root |

### Data flow

1. Start → load config → full scan → populate catalog.
2. UI loads → `GET /api/tree` → subscribe to `GET /api/events`.
3. User types in search → `GET /api/search?q=…`.
4. User clicks a file → iframe `src=/apps/<relpath>` (cache-bust query allowed on reload).
5. Watcher updates catalog → SSE → UI refreshes tree/results; if event path equals open file, reload iframe.

v1 does not require “open in new tab”; a later optional link is fine.

## Watcher behavior

- Prefer live updates for add/remove/change of HTML files and directory structure affecting the tree.
- If watching fails on a platform: degrade to manual browser refresh; surface a CLI and/or UI notice; browsing still works.
- Preview auto-reload only when the currently open file’s content or path is affected (change/remove). On remove, clear selection and show empty state.

## Error handling

| Situation | Behavior |
|-----------|----------|
| Root missing or not a directory | CLI error, non-zero exit |
| Invalid config | CLI error naming the file |
| Port in use with fixed port | Clear error and exit |
| Port `0` | OS assigns a free port; print the actual URL |
| Path traversal / non-catalog file | `403` or `404`; no arbitrary file read |
| External CDN/absolute URLs inside HTML | Browser loads them directly; mino does not proxy |

Relative path is the unique id for an entry (same basename in different folders is fine).

## Testing

- **Unit:** ignore matching, path normalization / anti-traversal, search filter, catalog add/remove/change.
- **Integration:** temp root + server; exercise tree, search, apps, SSE; mutate files and assert catalog + events.
- **Manual:** real browser tree + iframe; edit open file on disk and confirm preview reload.

## Success criteria

1. `mino <dir>` prints `http://127.0.0.1:<port>/` and the page loads.
2. User can expand folders and select any catalogued HTML file.
3. Search filters by filename/path.
4. Add/remove/change under the root updates the list; changing the open file refreshes the iframe without a full manual page reload.

## Implementation notes

- Language: Go.
- Distribution: single static binary preferred.
- UI assets: `embed.FS`.
- Config format: TOML.
- Event transport: Server-Sent Events (simpler than WebSocket for one-way push).
