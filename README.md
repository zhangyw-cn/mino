# Mino

Mino is a local browser for self-contained HTML apps and Markdown notes. Point it at a directory to browse, search, and preview its `.html` / `.htm` **and** `.md` files.

## Install

Requires Go 1.24.4 or later.

```sh
go install ./cmd/mino
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

On first use, Mino creates `<dir>/.mino/config.toml`:

```toml
name = "my-apps"
port = 0
host = "127.0.0.1"
ignore = ["archive/**"]
```

- `name`: workspace name shown in the UI
- `port`: listening port; `0` asks the OS for a free port
- `host`: listening address
- `ignore`: additional root-relative glob patterns to exclude

## Security

**Only use workspaces you trust.** Previewed HTML files are served from the same origin as the Mino UI and run inside an iframe without a `sandbox` attribute, so they keep access to `localStorage`, cookies, and the same origin's endpoints. That means a previewed page can call `/api/*` (including `/api/raw/*.md` for catalog Markdown source) and read any file exposed under `/apps/*`, and it can read or overwrite browser storage belonging to other apps in the same workspace. This is deliberate: sandboxing would break the self-contained apps Mino exists to run, which commonly persist state in `localStorage`.

Markdown is rendered through a sanitized viewer (not a raw executable document): source is fetched as `text/plain`, parsed as GFM, and passed through DOMPurify before highlight / KaTeX / Mermaid. The Markdown viewer also builds an on-page outline from `h1`–`h3` (right side on wide viewports) with click-to-scroll and scroll spy. That still is not a security boundary for untrusted files. Only preview Markdown from trusted workspaces.

Mino has no authentication and is intended for local use, binding to `127.0.0.1` by default. Do not change `host` to a public or LAN address unless you understand the exposure.

As a mitigation against DNS rebinding, requests are rejected with `403` unless the `Host` header names the configured `host`, `localhost`, or a loopback address. When you bind to a non-loopback `host`, reach the server through exactly that host value.

## Limitations

Only self-contained, single-file HTML apps are supported. Companion CSS, JavaScript, images, and other neighboring files are not served.

Markdown companion images and other assets are also not served, so relative images in `.md` files may break.
