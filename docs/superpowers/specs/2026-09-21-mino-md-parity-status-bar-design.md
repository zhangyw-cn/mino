# Mino Markdown Parity Audit and Status Bar Color Fix

**Date:** 2026-09-21  
**Status:** Approved for planning  
**Scope:** Post–React+TS cutover parity check for Markdown preview + restore Dark Modern status bar colors  
**Approach:** Spec checklist → fix parity gaps in the same pass → strengthen Vitest → manual smoke on `example/docs/sample.md`

## Problem

The workbench and Markdown viewer were migrated to React + TypeScript (`web/`, embedded via `internal/ui/dist`). Behavior is largely ported, but:

1. The status bar uses Default Dark+ blue (`#007acc`) instead of the Dark Modern shell background (`#181818`) required by `2026-08-27-mino-status-bar-md-preview-width-design.md`.
2. Markdown feature parity after the cutover has not been systematically checked against the existing Markdown / status-bar specs and the sample document.

## Goals

1. Verify React Markdown preview covers existing-spec behavior (not new features).
2. Fix the status bar color regression: `#007acc` → `#181818` (Dark Modern `--bg-shell`), with matching foreground/border.
3. Strengthen Vitest on critical paths; smoke-test with `example/docs/sample.md`.

## Non-Goals

- New Markdown syntax, plugins, or viewer capabilities beyond existing specs
- New status bar items (language mode, Git, encoding, etc.)
- Theme switcher / light theme
- Backend, catalog, watch, or companion allowlist changes
- Playwright E2E (out of scope for the React migration as well)
- Pixel-perfect visual match to pre-React CSS (interaction and feature parity only)

## Approach (chosen)

**Spec checklist driven → fix gaps → Vitest → manual smoke.**

1. Derive a parity checklist from existing Markdown / status-bar specs and `example/docs/sample.md`.
2. Mark gaps against the React implementation; fix all in-scope gaps in the same pass (including status bar chrome).
3. Add or strengthen Vitest for critical contracts (status bar color, width menu, render pipeline gaps).
4. Manual smoke on sample.md.

Alternatives considered:

1. **Checklist → fix → Vitest (chosen)** — Clear coverage boundary; visual vs automated split is explicit.
2. **Test-first only** — Strong regression lock, but Mermaid fullscreen/camera and similar paths are hard to fully automate and may miss visual gaps.
3. **Fix known blue bar then opportunistic skim** — Fastest, weak parity assurance; rejected given the chosen depth (checklist + Vitest + fix all gaps).

## Architecture and component boundaries

No new runtime architecture. Keep current units; change only where parity fails.

| Unit | Responsibility | This work |
|------|----------------|-----------|
| `MarkdownViewer` | `/api/raw` → preprocess → marked (GFM) → DOMPurify → highlight / KaTeX → Mermaid / TOC; postMessage ready/error | Fix render / message / generation gaps if found |
| `MermaidBlock` / `Toc` | Block modes, camera, outline | Touch only on regression |
| `lib/preprocess`, `toc`, `preview-width`, `preview-session`, … | Pure logic | Fix + unit tests if gaps |
| `StatusBar` | Width menu + bottom chrome | **Required:** restore Dark Modern colors; keep menu semantics |
| `PreviewPane` / `WorkbenchApp` | iframe, width state, wiring | Touch only if wiring gaps |

### Status bar color contract

Align with `2026-08-27-mino-status-bar-md-preview-width-design.md`:

- Height **22px**, full window width
- Background **`#181818`**; **forbid** `#007acc` / `#007ACC`
- Top border **`#2b2b2b`**
- Foreground **`#cccccc`** (replace white-on-blue)
- Width button hover: light translucent overlay; menu stays `#252526` / `#2a2d2e`
- Primary edit: `web/src/features/status-bar/StatusBar.tsx` footer classes
- Clear any conflicting hard-coded blue on the status bar elsewhere; do not introduce a new token system

### Width data flow (unchanged semantics)

```text
user picks width → writePreviewWidth(localStorage)
                 → onPreviewWidthChange(state)
                 → postMessage(md-preview-width) → iframe
viewer boot / message → applyPreviewWidth(html[data-md-width])
```

Storage key `mino-md-preview-width`, labels 标宽 / 较宽 / 全宽, default `wide`, hide control when not `.md`: **unchanged**.

## Parity checklist

Audit sources (read-only; do not expand product scope):

- `docs/superpowers/specs/2026-08-22-mino-markdown-preview-design.md`
- `docs/superpowers/specs/2026-08-24-mino-markdown-toc-design.md`
- `docs/superpowers/specs/2026-08-25-mino-mermaid-block-modes-design.md`
- `docs/superpowers/specs/2026-08-27-mino-mermaid-fit-preview-viewbox-camera-design.md`
- `docs/superpowers/specs/2026-08-27-mino-status-bar-md-preview-width-design.md`
- `docs/superpowers/specs/2026-08-29-mino-single-iframe-preview-update-design.md`
- `docs/superpowers/specs/2026-08-30-mino-companion-assets-design.md`
- Sample: `example/docs/sample.md`

Checklist items (implementers tick; fix to behavior parity):

1. Open `.md` → viewer renders GFM (tables, task lists, fenced code)
2. Sanitize: raw `<script>` and similar do not execute
3. highlight.js, KaTeX (`$` / `$$` / multiline `\[ \]`), Mermaid (broken diagram isolated)
4. TOC: `h1`–`h3`, scroll spy; narrow stack still respects `data-md-width`
5. Width: standard / wide / full; default wide; `localStorage` + `postMessage`; refresh restores
6. MD↔MD in-place; HTML↔MD navigate; reload / watch / companion semantics as today
7. Status bar: 22px in all workbench states; width control hidden for non-MD; Dark Modern colors (no blue bar)

## Error handling

- Existing MD fetch/parse error UI and generation guards remain; strengthen only if audit finds regressions
- Status bar color fix must not break width menu open/close or outside-click dismiss
- Failed iframe `postMessage` continues to be ignored (same-origin best effort)

## Testing and acceptance

### Vitest

1. **Status bar color contract:** render `StatusBar`; assert footer classes include `#181818` (or equivalent) and do **not** include `#007acc` / `#007ACC`; non-MD path hides width control but keeps 22px bar.
2. **Width menu:** keep existing localStorage + `previewWidthMessage` shape test.
3. **Markdown pipeline:** extend existing `MarkdownViewer` / `preprocess` / `toc` / `preview-session` coverage for checklist gaps (e.g. sanitize drops script, math preprocess, stale generation drops outdated paint). Do not duplicate already-green cases.
4. **Out of Vitest:** Playwright; Mermaid fullscreen gesture pixel asserts (manual smoke).

### Manual smoke (`go run ./cmd/mino ./example`, open `docs/sample.md`)

- Table / task list / highlight / math / Mermaid / TOC
- Width three modes without full iframe reload feel; refresh keeps width
- HTML file: bar present, width control hidden, bar dark gray not blue
- XSS sample does not `alert`

### Done when

- `cd web && npm test` green
- Checklist fully ticked or fixed
- Manual smoke passed
- No new dependencies; no backend semantic changes

## Success criteria

1. Status bar matches Dark Modern color contract (no Default Dark+ blue).
2. Markdown behavior matches the parity checklist derived from existing specs.
3. Critical paths covered by Vitest; sample.md smoke green.
