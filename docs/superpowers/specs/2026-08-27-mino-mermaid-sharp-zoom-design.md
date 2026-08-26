# Mino Mermaid Sharp Zoom & Drop Split Design

**Date:** 2026-08-27  
**Status:** Approved for planning  
**Form:** Incremental change to Markdown viewer Mermaid block chrome (no server/catalog changes)  
**Supersedes (partially):** `2026-08-25-mino-mermaid-block-modes-design.md` — removes Split mode; replaces CSS `transform: scale()` zoom with SVG dimension scaling

## Problem

Mermaid blocks currently offer Code / Split / Preview. Split is unused and adds chrome and CSS. Preview zoom uses `transform: scale()` on a wrapper, which rasterizes the SVG and looks blurry when enlarged. Fullscreen supports wheel/drag zoom but has no Reset control in the overlay chrome.

## Goals

1. Remove **Split** mode; keep **Code | Preview** only (default Preview).
2. Preview (including fullscreen) zoom must keep SVG **sharp** (true vector sizing, not CSS scale blur).
3. Keep existing Preview interactions: wheel zoom at cursor, drag pan, toolbar − / + / Reset, in-viewer fullscreen.
4. Fullscreen overlay chrome gains **Reset** (does not close the overlay).
5. Remain offline with existing embedded Mermaid; no new vendor libraries.
6. Preserve GFM / highlight / KaTeX / TOC / HTML preview / SSE reload behavior.

## Non-Goals

- In-app editing of Mermaid or Markdown
- Persisting mode or zoom across iframe / SSE reloads
- Browser native Fullscreen API
- Full zoom toolbar (− / +) inside the fullscreen chrome (Reset only; wheel/drag still work)
- New pan-zoom libraries
- Changes to catalog, watcher, `/apps/`, or `/api/raw/`
- Theme / Mermaid config UI beyond current dark `securityLevel: "strict"` setup

## Approach (chosen)

**A. SVG dimension zoom + translate pan; drop Split.**

- Modes: Code | Preview only.
- After `mermaid.run`, cache the SVG’s base `width`/`height`. Apply zoom by setting `width/height = base × scale` while leaving `viewBox` unchanged. Pan via `translate(tx, ty)` only on the zoom target — never `scale()` in CSS transform.
- Fullscreen overlay: add Reset next to Close.

Alternatives considered:

1. **SVG dimension zoom (chosen)** — crisp vectors; reuses existing clamp / cursor-origin math; zero new deps.
2. **Keep `transform: scale()` + inflate raster resolution** — smaller diff, still can blur; higher memory at large scales.
3. **Vendor svg-pan-zoom** — mature gestures; conflicts with no-new-vendor constraint.

## Architecture

Changes stay in `internal/ui/md/` (`mermaid-block.js`, `viewer.css`, related tests).

```text
viewer.js render pipeline (unchanged entry)
  → mermaid-block shell
       ├─ toolbar: Code | Preview
       │            (+ Preview-only: zoom − / + / Reset, Fullscreen)
       ├─ source: read-only fence text
       └─ viewport → zoom-target (translate only) → diagram SVG
            zoom = mutate SVG width/height from cached base × scale
  → fullscreen overlay: Close + Reset; wheel/drag on moved viewport
```

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| Mode chrome | Code / Preview layout + toolbar | DOM + CSS |
| Source pane | Read-only fence text | None |
| Diagram pane | Mermaid SVG | Vendored `mermaid` |
| Sharp zoom | Base size cache; dimension apply; translate pan | SVG DOM |
| Fullscreen | Fixed overlay; Close + Reset | Same-document DOM |

SSE `changed` still reloads the iframe → default Preview, zoom 1×.

## Rendering and zoom integration

1. Capture fence text; build shell (no Split button); replace original `pre`; run Mermaid as today.
2. On successful render, read base size from the SVG (`width`/`height` attributes preferred; else `getBBox` / computed style) and cache on the block instance.
3. `applyZoomState`: clamp scale to **0.25×–4×**; set SVG dimensions to `base × scale`; set zoom-target `transform` to `translate(tx, ty)` only (no `scale()`).
4. `resetZoom`: `scale=1, tx=0, ty=0` and restore base SVG size.
5. Mode switch does not re-parse Markdown or re-run Mermaid. Leaving Preview closes fullscreen if open and resets zoom.
6. Preview / fullscreen keep `max-width: none` on the diagram SVG so layout does not clamp away the zoomed size.

If base size cannot be measured, skip dimension updates (pan/reset of translate still work); do not invent a fake base.

## Interaction and layout

### Modes

| Mode | Visible | Extra toolbar |
|------|---------|---------------|
| Code | Source only | — |
| Preview | Diagram only | Zoom − / + / Reset, Fullscreen |

Default: **Preview**.

Remove Split-related classes, narrow-breakpoint split stacking, and `normalizeMode` acceptance of `"split"` (unknown → Preview).

### Zoom and pan (Preview only, including fullscreen)

- Wheel: scale around pointer (same cursor-origin math as today, but applied via dimensions + translate).
- Drag: pan.
- Inline toolbar: − / + / Reset / Fullscreen.
- Clamp: **0.25×–4×**.

### Fullscreen

- In-viewer fixed overlay (dimmed backdrop).
- Chrome: **Close** and **Reset**. Reset calls `resetZoom` and leaves the overlay open.
- Esc, Close, and backdrop click dismiss; on dismiss, **resetZoom** (same as today).
- While open: lock `html`/`body` overflow; set `#content` inert when present.
- Wheel and drag continue to work on the viewport moved into the stage.

## Error handling

| Case | Behavior |
|------|----------|
| Mermaid render failure | Diagram pane shows `Diagram render failed`; Code still shows source; no zoom/fullscreen controls |
| No mermaid fences | No shells |
| Base size unmeasurable | No SVG dimension zoom; translate pan/reset still apply |
| SSE hot reload | Full iframe reload; Preview + zoom 1× |
| Fullscreen open + page scroll | Overlay covers viewport; background scroll locked |

## Testing

- Update Node tests under existing `mermaid_block` harness: no Split in mode map; transform style is translate-only; helpers for base×scale dimensions; fullscreen Reset does not close overlay.
- Manual: Code ↔ Preview; enlarge stays sharp; wheel / drag / ± / Reset; fullscreen Reset vs Close; failed diagram; SSE returns to default Preview.

## Success criteria

1. Toolbar offers only Code | Preview; Split is gone from UI, CSS, and mode helpers.
2. Preview and fullscreen zoom keep SVG edges/text sharp at scales up to 4×.
3. Fullscreen chrome includes Reset; Close/Esc still reset and dismiss.
4. No new vendor deps; HTML apps, TOC, and other Markdown features unchanged.

## Documentation updates (implementation follow-up)

- Optional: note Code/Preview-only Mermaid chrome in README — nice-to-have.
- Prior Split mentions in `2026-08-25` design remain historical; this spec is the source of truth going forward.
