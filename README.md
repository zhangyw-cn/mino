# Mino

Mino is a local workbench for self-contained HTML apps and Markdown notes. Point it at a directory to browse, search, and preview its `.html` / `.htm` **and** `.md` files.

The UI is a VS Code–like shell: Explorer tree, Command Center, iframe preview, and a status bar. Files under the workspace are watched; the tree and the open preview update without a full page refresh.

## Install

Requires Go 1.24.4 or later.

```sh
go install github.com/zhangyw-cn/mino/cmd/mino@latest
```

## Usage

```sh
mino [dir] [--port N]
```

The directory defaults to the current working directory. `--port` overrides the configured port for the current run; use `0` to select an available port automatically. Mino prints the local URL and runs until interrupted with Ctrl+C.

Mino does not open a browser for you: copy the printed URL (for example `http://127.0.0.1:52341/`) and open it manually.

### Try the bundled examples

```sh
go run ./cmd/mino ./example
# or, if already installed: mino ./example
```

The `example/` tree has a few self-contained HTML apps (`hello.html`, `tools/`, `notes/`, `playground/`) plus `docs/sample.md` for browsing, search, and iframe preview. First run creates `example/.mino/` locally; that directory is gitignored.

### Configuration

On first use, Mino creates `<dir>/.mino/config.toml`:

```toml
name = "my-apps"
port = 0
host = "127.0.0.1"
ignore = ["archive/**"]
```

- `name`: workspace name shown in the Command Center
- `port`: listening port; `0` asks the OS for a free port
- `host`: listening address
- `ignore`: additional root-relative glob patterns to exclude

`.mino`, `.git`, `.hg`, `.svn`, and `node_modules` (including nested copies) are always ignored.

## Workbench

- **Explorer** lists catalogued HTML and Markdown files. Collapse it from the activity bar.
- **Command Center** (top bar) shows the workspace name. Click it, or press **Ctrl/Cmd+E** or **Ctrl/Cmd+P** (also works while the preview iframe is focused), to open **Quick Open**.
- **Quick Open** fuzzy-filters by filename. An empty query lists session recents (up to 10). Enter or click opens the file, expands its tree ancestors, and closes the overlay. Escape dismisses it.
- **Preview** loads the selected file in an iframe. Clicking the already-open file does not reload it. Markdown-to-Markdown opens reuse the viewer document (old body stays until the new render is ready). Breadcrumbs show the relative path.
- **Live reload** watches the workspace. Added / removed / changed files update the tree; a change to the open Markdown file refetches in the existing viewer; a change to the open HTML file reloads the iframe; a removal clears the preview. If the watcher cannot start, a banner asks you to refresh manually.
- **Same-tab refresh** reopens the file you were previewing. That path is stored in this tab’s `sessionStorage` under `mino-open-path`. A new tab on `/` starts with no file selected.

The status bar is visible at the bottom. For `.md` files it exposes 标宽 / 较宽 / 全宽 (960px / 1400px / fill); the default is 较宽. The choice is stored in this origin’s `localStorage` under `mino-md-preview-width` and applies to all Markdown files.

## Markdown preview

Markdown is rendered through a sanitized viewer (not a raw executable document): source is fetched as `text/plain`, parsed as GFM, and passed through DOMPurify before highlight / KaTeX / Mermaid.

- **Outline**: `h1`–`h3` on the right (wide viewports); click-to-scroll and scroll spy. Narrow viewports start collapsed.
- **Mermaid** (` ```mermaid ` fences): per-diagram **Code** / **Preview** (default Preview). Code is read-only fence source. Inline Preview fits the diagram to the column (no zoom). **Fullscreen** opens an in-viewer overlay where wheel-zoom (cursor-centered) and drag-pan use a viewBox camera (up to 4×); Reset restores the contained view, Close leaves fullscreen. Escape also closes fullscreen.

## Security

**Only use workspaces you trust.** Previewed HTML files are served from the same origin as the Mino UI and run inside an iframe without a `sandbox` attribute, so they keep access to `localStorage`, cookies, and the same origin's endpoints. That means a previewed page can call `/api/*` (including `/api/raw/*.md` for catalog Markdown source) and read any file exposed under `/apps/*`, and it can read or overwrite browser storage belonging to other apps in the same workspace. This is deliberate: sandboxing would break the self-contained apps Mino exists to run, which commonly persist state in `localStorage`.

Allowlisted companion files are served from the same origin under `/apps/` as well. That includes `json` and `wasm` on the allowlist, so treat config or build artifacts in the workspace as readable by any previewed HTML app.

Markdown sanitization is not a security boundary for untrusted files. Only preview Markdown from trusted workspaces.

Mino has no authentication and is intended for local use, binding to `127.0.0.1` by default. Do not change `host` to a public or LAN address unless you understand the exposure.

As a mitigation against DNS rebinding, requests are rejected with `403` unless the `Host` header names the configured `host`, `localhost`, or a loopback address. When you bind to a non-loopback `host`, reach the server through exactly that host value.

## Limitations

HTML apps may load companion files from the workspace through relative URLs (the browser requests `/apps/<dir>/…`). Mino serves a fixed allowlist: `png` `jpg` `jpeg` `gif` `webp` `svg` `ico` `css` `js` `mjs` `woff` `woff2` `ttf` `otf` `json` `wasm`. Paths with a `.`-prefixed segment, ignore matches (including `.git` / `.mino` / `node_modules`), and other extensions 404.

Companion files do not appear in Explorer or Quick Open. Site-root URLs like `/images/x.png` are not mapped onto the workspace. Changing a CSS file that the open HTML references reloads the preview; files only mentioned inside that CSS (for example `url(bg.png)`) do not.
