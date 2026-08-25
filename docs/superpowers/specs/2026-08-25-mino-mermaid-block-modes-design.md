# Mino Mermaid Block Modes Design

**Date:** 2026-08-25  
**Status:** Approved for planning  
**Form:** Extend Markdown viewer iframe; per-diagram chrome only (no server/catalog changes)

## Problem

Markdown preview already renders ` ```mermaid ` fences to SVG, but users cannot inspect the diagram source alongside the result, nor enlarge a diagram for reading. There is only a single static preview with no code / split / preview modes, fullscreen overlay, or zoom.

## Goals

1. Each Mermaid fence gets an independent block chrome with three modes: **Code**, **Split**, and **Preview**.
2. Default mode is **Preview**.
3. Code mode shows the fence source as **read-only**.
4. Preview mode supports **in-viewer fullscreen overlay** and **zoom** (wheel with cursor as origin, drag to pan, optional toolbar ± / reset).
5. Remain fully offline via existing embedded Mermaid; no new vendor libraries.
6. Preserve existing GFM / highlight / KaTeX / TOC / HTML preview / SSE reload behavior.

## Non-Goals

- In-app editing or writing Mermaid (or Markdown) back to disk
- Persisting mode or zoom across iframe reloads / SSE hot reload
- Browser native Fullscreen API
- Zoom or fullscreen in Split mode’s diagram pane
- New pan-zoom libraries
- Changes to catalog, watcher, `/apps/`, or `/api/raw/`
- Theme picker or Mermaid config UI beyond current dark `securityLevel: "strict"` setup

## Approach (chosen)

**A. Self-built Mermaid block shell in the viewer** — wrap each fence in a `figure.mermaid-block` with toolbar + source pane + diagram pane; modes via CSS classes; pan/zoom via CSS `transform`; fullscreen via a fixed overlay inside the viewer document.

Alternatives considered:

1. **Self-built shell (chosen)** — matches existing `viewer.js` style; zero new deps; full control over mode-gated zoom/fullscreen.
2. **Vendor svg-pan-zoom (or similar)** — richer gestures; extra embed weight for preview-only zoom.
3. **Native Fullscreen API + self-built zoom** — true OS fullscreen; conflicts with the chosen in-viewer overlay requirement and complicates iframe permissions.

## Architecture

Changes stay inside the Markdown viewer iframe (`internal/ui/md/`).

```text
viewer.js render pipeline (existing)
  → mermaid fence
  → mermaid-block shell (new)
       ├─ toolbar: Code | Split | Preview
       │            (+ Preview-only: zoom in/out/reset, fullscreen)
       ├─ source: read-only pre/code (original fence text)
       └─ diagram: container for mermaid.run SVG
  → default mode = preview
```

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `mermaid-block` shell | Mode layout + toolbar state | DOM + CSS |
| Source pane | Read-only fence text | None (no editor) |
| Diagram pane | Existing Mermaid render | Vendored `mermaid` |
| Pan/zoom | Preview only: wheel (cursor origin), drag, toolbar | CSS `transform` |
| Fullscreen overlay | Preview only: fixed overlay in viewer | Same-document DOM |

Server, catalog, `/api/raw`, TOC, KaTeX, and highlight are unchanged. SSE `changed` still reloads the iframe → every block returns to default Preview with zoom reset.

## Rendering integration

Replace the current “swap `pre` for `.mermaid` div and run” step with:

1. Capture fence text from `pre code.language-mermaid`.
2. Build the shell: toolbar, source pane (escaped text), diagram pane (node Mermaid will run on).
3. Replace the original `pre` with the shell.
4. `mermaid.run` on diagram nodes as today; on failure, mark the diagram pane with the existing render-error placeholder.

Mode switching only toggles visibility/layout classes; it does not re-parse Markdown or re-run Mermaid unless the diagram node was never successfully rendered (failure stays a placeholder).

## Interaction and layout

### Modes (per block, independent)

| Mode | Visible | Extra toolbar |
|------|---------|---------------|
| Code | Source only | — |
| Split | Source + diagram: left/right; narrow: source above, diagram below | — |
| Preview | Diagram only | Zoom in / out / reset, fullscreen |

Default: **Preview**.

### Zoom and pan (Preview only)

- Wheel zoom uses the cursor position as the transform origin (scale around pointer).
- Drag pans the diagram.
- Toolbar: zoom in, zoom out, reset.
- Clamp scale to **0.25×–4×**.
- Leaving Preview resets the transform so Code/Split never inherit a skewed view.
- Split and Code diagram panes are static: no zoom, no fullscreen controls.

### Fullscreen (Preview only)

- In-viewer fixed overlay (dimmed backdrop + close control).
- Esc and close button dismiss the overlay.
- Overlay continues to support wheel zoom and drag pan.
- On close, return to inline Preview and **reset zoom** so the document flow does not keep an extreme scale.
- While overlay is open, lock background scrolling via `overflow: hidden` on the viewer document root (`html`/`body`).

### Narrow layout

Split uses a vertical stack (source above, diagram below) at the same narrow breakpoint as the TOC (`max-width: 959px`).

## Error handling

| Case | Behavior |
|------|----------|
| Mermaid render failure | Diagram pane shows the existing `Diagram render failed` placeholder; Code/Split still show source; Preview has no zoom/fullscreen |
| No mermaid fences | No shells created |
| SSE hot reload | Full iframe reload; modes and zoom back to default Preview |
| Fullscreen open + page scroll | Overlay covers viewport; background scroll locked |

## Testing

- Extract small helpers (mode class mapping, zoom matrix / clamp, Esc-to-close) and cover with Node-style JS tests alongside existing preprocess/toc tests where practical.
- Manual checklist: three-mode toggle per block; narrow Split; wheel zoom at cursor; drag pan; toolbar ±/reset; overlay fullscreen + Esc; failed diagram still readable in Code; SSE reload resets to Preview.

## Success criteria

1. Every Mermaid fence defaults to Preview and can switch to Code or Split independently.
2. Preview supports in-viewer fullscreen overlay and cursor-centered wheel zoom + drag pan (with toolbar).
3. Hot reload restores Preview; no new vendor deps; HTML apps, TOC, and other Markdown features unchanged.

## Documentation updates (implementation follow-up)

- Optional: note Mermaid block modes in README or sample Markdown comments — nice-to-have, not blocking.
- Example `sample.md` Mermaid section remains valid; no required content change beyond optional demo of a larger diagram for zoom/fullscreen.
