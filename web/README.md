# Mino web UI

Vite + React + TypeScript + Tailwind front end for the Mino workbench and Markdown viewer. Production bundles are embedded by Go from `internal/ui/dist`.

## Prerequisites

- Node.js 20+ (LTS recommended)
- npm (ships with Node)

## Install dependencies

From this directory:

```sh
npm ci
```

Use `npm install` only when intentionally updating `package-lock.json`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Typecheck, bundle, and write `internal/ui/dist` (+ generated MD viewer template) |
| `npm test` | Vitest unit/component tests (single run) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run preview` | Serve the last production build locally (Vite preview) |

### `npm run dev`

Starts Vite on its default port (5173). API and workspace asset routes are proxied to `http://127.0.0.1:52341`:

- `/api` → Mino backend
- `/apps` → served HTML/Markdown and companions

Run Mino on that port in another terminal so the proxy works, for example:

```sh
# repo root
go run ./cmd/mino ./example --port 52341
```

Then open the URL Vite prints (typically `http://127.0.0.1:5173/`). Adjust the proxy target in `vite.config.ts` if you use a different `--port`.

### `npm run build`

Runs, in order:

1. `tsc -b` — project references typecheck
2. `vite build` — dual HTML entries (`index.html`, `md/viewer.html`) into `../internal/ui/dist`
3. `node scripts/write-viewer-template.mjs` — generates `internal/ui/viewer_template.html` for Go `data-path` injection

**Contributors and CI:** run `npm ci && npm run build` in `web/` before `go test`, `go build`, or `go run` from a clean clone, because the Go binary embeds `internal/ui/dist` (and the generated viewer template).

### `npm test`

Vitest with jsdom and Testing Library. No running Mino server required for the current suite.

```sh
npm test
```

## Layout (high level)

- `index.html` / `src/main.tsx` — workbench shell
- `md/viewer.html` / `src/md/` — Markdown iframe viewer
- `src/lib/` — ported pure logic (with co-located `*.test.ts`)
- `src/features/` — Explorer, Quick Open, preview, watch bridge, status bar

See the repo root [README.md](../README.md) for end-user usage and security notes.
