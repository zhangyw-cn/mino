# Mino Mermaid Inline Fit & Fullscreen ViewBox Camera Design

**Date:** 2026-08-27  
**Status:** Approved for planning  
**Form:** Incremental change to Markdown viewer Mermaid block chrome (no server/catalog changes)  
**Supersedes (partially):** `2026-08-27-mino-mermaid-sharp-zoom-design.md` — Preview zoom/pan is fullscreen-only; replace SVG dimension + CSS-translate zoom with a viewBox camera; inline Preview is fit-to-column with no zoom

## Problem

Inline Preview currently shares wheel-zoom, drag-pan, and − / + / Reset with fullscreen. Large diagrams overflow the column instead of showing the whole figure. Zoom mutates SVG `width`/`height` and pans with CSS `translate`, while the diagram is CSS-centered (`text-align: center` + padding), so wheel zoom does not stay under the cursor. CSS `transform: scale()` is already disallowed because it rasterizes and blurs.

## Goals

1. **Non-fullscreen Preview** does not zoom or pan. It shows the whole diagram at column width: shrink if wider than the column; never upscale small diagrams. Scaling is vector (CSS `max-width: 100%; height: auto` with the original `viewBox`).
2. **Only fullscreen** supports zoom and pan.
3. Opening fullscreen **contains** the diagram in the stage, centered, **without upscaling** past natural 1×. Reset returns to this same state and leaves the overlay open.
4. Fullscreen zoom is a **viewBox camera** (world fixed, frustum moves). Zoom is **cursor-centered**. Pan follows the pointer.
5. Zoom range: **minimum = that contain scale**, **maximum = 4× natural size**.
6. All zoom is **vector**: the SVG is painted at stage resolution; zoom must not use CSS `scale()`, must not rasterize a bitmap and stretch it, and must stay sharp at 4×.
7. Remain offline with existing embedded Mermaid; no new vendor libraries.
8. Preserve GFM / highlight / KaTeX / TOC / HTML preview / SSE reload behavior.

## Non-Goals

- In-app editing of Mermaid or Markdown
- Persisting mode, camera, or zoom across iframe / SSE reloads
- Browser native Fullscreen API
- Zoom toolbar (− / +) in inline Preview or in fullscreen chrome (wheel/drag only; fullscreen chrome stays Reset + Close)
- New pan-zoom libraries
- Changes to catalog, watcher, `/apps/`, or `/api/raw/`
- Theme / Mermaid config UI beyond current dark `securityLevel: "strict"` setup
- Pinch-zoom, keyboard zoom, or minimap

## Approach (chosen)

**ViewBox camera in fullscreen; CSS column-fit inline; no shared pan-zoom.**

- Inline Preview: leave Mermaid’s `viewBox` / `width` / `height` alone after render. CSS fits to column width.
- Fullscreen: pin the SVG to the stage box; zoom/pan by replacing `viewBox`. Cache original SVG presentation attributes and restore them on exit.
- Do **not** change SVG layout size to zoom. Do **not** CSS-`translate`/`scale` the zoom target for zoom.

Alternatives considered:

1. **SVG dimension zoom + CSS translate (rejected for this change)** — already in tree; cursor-origin breaks once layout centering/padding is involved; inline and fullscreen fight over `max-width`.
2. **ViewBox camera (chosen)** — cursor mapping is in SVG user space; stage box size is stable; vector redraw at stage pixels.
3. **Vendor svg-pan-zoom** — conflicts with no-new-vendor constraint.

## Architecture

Changes stay in `internal/ui/md/` (`mermaid-block.js`, `viewer.css`, related tests).

```text
viewer.js render pipeline (unchanged entry)
  → mermaid-block shell
       ├─ toolbar: Code | Preview
       │            Preview (inline): Fullscreen only
       ├─ source: read-only fence text
       └─ viewport → zoom-target (identity transform; not used for pan/zoom)
            → diagram SVG
            inline: original viewBox; max-width 100%; height auto
            fullscreen: SVG fills stage; viewBox is the camera
  → overlay: Close + Reset; wheel/drag only while overlay holds the viewport
```

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| Mode chrome | Code / Preview layout + toolbar | DOM + CSS |
| Source pane | Read-only fence text | None |
| Inline fit | Column-width vector contain, no gestures | Original SVG + CSS |
| Fullscreen camera | Cache/restore attrs; viewBox frustum; cursor zoom; pan | SVG DOM |
| Fullscreen overlay | Fixed overlay; Close + Reset | Camera + same-document DOM |

SSE `changed` still reloads the iframe → default Preview, column-fit, no overlay.

## Rendering integration

1. Capture fence text; build shell; replace original `pre`; run Mermaid as today.
2. On success, cache **base display size** (`readSvgBaseSize`: `width`/`height` attrs, else viewBox, else `getBBox`) and **original presentation** used by the camera (`viewBox`, `width`, `height`, `preserveAspectRatio`, and any inline `width`/`height`/`maxWidth`/`maxHeight` the camera will overwrite). Do **not** rewrite SVG dimensions or set `max-width: none` at this point — that would break inline fit.
3. If render fails: diagram pane shows `Diagram render failed`; no Fullscreen control; no camera.

Mode switch does not re-parse Markdown or re-run Mermaid. Leaving Preview while fullscreen is open closes fullscreen first (restore attrs, dismiss overlay).

## Inline Preview (not fullscreen)

- No wheel zoom, no drag pan, no grab cursor. Wheel must **not** `preventDefault` (page scroll works).
- Toolbar Preview actions: **Fullscreen** only. Remove − / + / Reset from the inline toolbar.
- CSS: `.mermaid-diagram svg { max-width: 100%; height: auto; }`. Remove the current Preview override that sets `max-width: none` on inline SVGs.
- Small diagrams stay at natural size (do not stretch to column width). Wide diagrams shrink to 100% column width; height follows aspect ratio. This is browser vector scaling via `viewBox`.

## Fullscreen camera

### Presentation

- In-viewer fixed overlay (dimmed backdrop), unchanged.
- Chrome: **Reset** and **Close**. Reset reapplies the opening contain camera and does **not** close. Close, Esc, and backdrop click restore original SVG attributes, dismiss the overlay, unlock `html`/`body` overflow, and clear `#content` inert.
- While open: SVG fills the stage (`width`/`height` 100% of the viewport moved into `.mermaid-fs-stage`). `.mermaid-diagram` padding is **0** in fullscreen so the SVG box matches the viewport used for pointer math.
- `preserveAspectRatio="none"` while the camera is active, because the frustum already has the stage aspect ratio.

### State

User space is the **original** viewBox `{ ux, uy, uw, uh }` (if missing: `{ 0, 0, baseW, baseH }`).

- `naturalScale = baseW / uw` — CSS pixels per user unit at natural 1×. If `uw` is not > 0, treat as unmeasurable (fallback below).
- Camera: `{ scale, vx, vy }`
  - `scale`: CSS pixels per user unit
  - `vx, vy`: frustum top-left in user units
  - `vw = stageW / scale`, `vh = stageH / scale`
  - Applied as `viewBox = "vx vy vw vh"`

`stageW` / `stageH` are the fullscreen viewport’s content box (`clientWidth` / `clientHeight`) after the viewport is in the stage.

### Opening (and Reset)

After layout (one animation frame if the first measure is 0):

```text
fitScale = min(1, stageW / baseW, stageH / baseH)
scale    = fitScale * naturalScale
vw, vh   = stageW / scale, stageH / scale
vx, vy   = (ux + uw/2) - vw/2, (uy + uh/2) - vh/2
```

Small diagrams: `fitScale = 1`, centered, not enlarged. Large diagrams: the whole figure is visible.

If stage size remains 0, or base/viewBox cannot be measured: **do not** run the camera. Leave original viewBox; CSS-contain the SVG in the stage (`max-width: 100%; max-height: 100%; width: auto; height: auto`); no wheel zoom, no drag. Fullscreen can still open and Close.

### Zoom (cursor-centered, vector)

Wheel is bound only while this block’s viewport is in the overlay. `preventDefault` so the locked page does not scroll. Factor: `1.1` / `1/1.1` (same as today).

1. Map the pointer through the **SVG** `getBoundingClientRect()` to frustum-normalized `nx, ny` in `[0, 1]` (clamp to that range if the event is slightly outside).
2. `userX = vx + nx * vw`, `userY = vy + ny * vh`.
3. `scale' = clamp(scale * factor, fitScale * naturalScale, 4 * naturalScale)` using the **current** stage size for `fitScale`.
4. If `scale'` equals `scale`, no-op (no viewBox write).
5. New frustum keeps `userX, userY` at the same `nx, ny`:
   `vw' = stageW / scale'`, `vh' = stageH / scale'`,
   `vx' = userX - nx * vw'`, `vy' = userY - ny * vh'`.

The SVG element’s CSS size stays equal to the stage. Zoom only changes `viewBox`. The browser re-rasterizes vectors at stage (device) resolution — this is the sharpness requirement. **Forbidden:** `transform: scale()`, stretching a previously rasterized bitmap, or growing `width`/`height` attributes to fake zoom.

### Pan

While the primary button is down on the fullscreen viewport:

`vx -= dx / scale`, `vy -= dy / scale`

(content follows the pointer). Grab cursor only while the camera is active; grabbing while dragging. Inline Preview has neither.

### Window resize while fullscreen

Recompute `fitScale` from the new stage size. If current `scale` is below `fitScale * naturalScale`, set `scale` to that minimum and **re-center on the diagram** (same as open). Otherwise keep `scale` and the frustum center (`vx + vw/2`, `vy + vh/2`), then set `vw, vh` from the new stage size.

### Exit

Write back every cached original presentation attribute/style. Inline CSS then applies column-fit again. Camera state is discarded (not reused on the next open).

## Error handling

| Case | Behavior |
|------|----------|
| Mermaid render failure | Diagram pane shows `Diagram render failed`; Code still shows source; no Fullscreen; no camera |
| No mermaid fences | No shells |
| Base size or viewBox unmeasurable, or stage size stays 0 | Overlay may open; CSS contain only; no wheel/drag camera |
| SSE hot reload | Full iframe reload; Preview + column-fit |
| Fullscreen open + page scroll | Overlay covers viewport; background scroll locked |
| Switch to Code while fullscreen | Close fullscreen (restore + dismiss) then show source |

## Testing

Node tests under the existing `mermaid_block` harness:

- `naturalScale`, `fitScale` (never greater than 1; large vs small diagrams)
- Opening camera: diagram center sits at frustum center; small diagram `scale === naturalScale`
- Cursor zoom: the user-space point at `(nx, ny)` is unchanged after a scale change
- Clamp: at min (contain) or max (4× natural) a further wheel is a no-op
- Pan: `dx` CSS pixels shifts `vx` by `-dx/scale`
- `applyCamera` writes `viewBox` only (plus the fullscreen fill attributes); does not set CSS `transform` for scale
- `restoreSvgAttrs` round-trips `viewBox` / `width` / `height` / `preserveAspectRatio`
- Inline Preview actions: Fullscreen only (no zoom-in/out/reset buttons)
- Fullscreen Reset does not close the overlay; Close restores attrs and closes

Manual:

- Inline: wide diagram fully visible at column width and sharp; small diagram not enlarged; wheel scrolls the page; no drag zoom
- Fullscreen: opens contained and centered; wheel zoom stays under the cursor; 4× remains sharp (edges/text); Reset vs Close; failed diagram; SSE returns to column-fit Preview
- Resize the window while fullscreen: figure stays contained when shrinking the window

## Success criteria

1. Non-fullscreen Preview cannot zoom or pan and shows the whole diagram at column width (no upscale).
2. Only fullscreen zooms; zoom is cursor-centered with no drift from CSS layout centering.
3. Zoom is vector throughout; at 4× natural size, edges and text stay sharp (not CSS-scale blur).
4. Reset returns to contain-without-upscale; Close restores the original SVG and inline fit.
5. No new vendor deps; HTML apps, TOC, and other Markdown features unchanged.

## Documentation updates (implementation follow-up)

- Prior zoom rules in `2026-08-27-mino-mermaid-sharp-zoom-design.md` remain historical; this spec is the source of truth for Preview vs fullscreen zoom.
- Optional README note: Mermaid Preview fits the column; inspect via in-viewer fullscreen camera — nice-to-have.
