# Mino Mermaid Inline Fit & Fullscreen ViewBox Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mermaid inline Preview a no-zoom column-width vector fit, and restrict zoom/pan to fullscreen via a viewBox camera that zooms about the cursor and stays sharp.

**Architecture:** Keep the `mermaid-block` shell. Inline Preview leaves Mermaid’s SVG attributes alone and uses CSS `max-width: 100%; height: auto`. Fullscreen pins the SVG to the stage and pans/zooms by replacing `viewBox` (world fixed, frustum moves). Cache original SVG presentation on render; restore on fullscreen exit. Never CSS-`scale()`, never grow `width`/`height` to fake zoom.

**Tech Stack:** Existing Markdown viewer + vendored Mermaid; plain DOM/CSS; Node `node:test` via `internal/ui/mermaid_block_node_test.go`; no new vendor libraries.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-27-mino-mermaid-fit-preview-viewbox-camera-design.md`
- Modes: **code** | **preview** only; default **preview**
- Inline Preview: no wheel zoom, no drag pan, no − / + / Reset; column-width vector fit; no upscale
- Fullscreen only: viewBox camera; cursor-centered wheel; drag pan; chrome **Reset** + **Close**
- Opening/Reset contain: `fitScale = min(1, stageW/baseW, stageH/baseH)`; never upscale past natural 1×
- Zoom range: `[fitScale * naturalScale, 4 * naturalScale]`
- Vector only: SVG CSS size stays stage-sized; zoom writes `viewBox` only; **forbidden** `transform: scale()`, bitmap stretch, or dimension-zoom
- No mode/camera persistence across iframe / SSE reload
- No new pan-zoom libraries; TDD; commit after each task
- Do not change HTML app preview or SSE reload semantics

---

## File Structure

```text
internal/ui/md/mermaid-block.js              # MODIFY: camera helpers; inline chrome; fullscreen camera
internal/ui/testdata/mermaid_block_test.mjs  # MODIFY: tests for camera + restore; drop old zoom tests in Task 5
internal/ui/md/viewer.css                    # MODIFY: inline fit; fullscreen fill; no inline grab cursor
internal/ui/md/viewer.js                     # UNCHANGED (still calls cacheBaseSize after mermaid.run)
internal/ui/mermaid_block_node_test.go       # UNCHANGED (still runs node --test)
```

Types used everywhere below:

```js
// userBox: { x, y, w, h }     original viewBox (fallback { x:0, y:0, w:baseW, h:baseH })
// base:     { width, height } display size at natural 1× (from readSvgBaseSize)
// stage:    { width, height } fullscreen viewport clientWidth/clientHeight
// camera:   { scale, vx, vy } scale = CSS px per user unit; vx/vy = frustum top-left
```

---

### Task 1: ViewBox camera math helpers

**Files:**
- Modify: `internal/ui/testdata/mermaid_block_test.mjs`
- Modify: `internal/ui/md/mermaid-block.js`

**Interfaces:**
- Consumes: existing `readSvgBaseSize`; `SCALE_MAX` remains `4` (multiplier of natural size)
- Produces:
  - `parseViewBox(value) → { x, y, w, h } | null`
  - `userBoxFromSvgAttrs(viewBoxStr, base) → { x, y, w, h } | null`
  - `naturalScale(base, userBox) → number` (`base.width / userBox.w`; non-positive → `NaN`)
  - `fitScale(base, stage) → number` (`min(1, stage.width/base.width, stage.height/base.height)`; invalid → `NaN`)
  - `cameraScaleRange(base, userBox, stage) → { min, max } | null` (`min = fit*nat`, `max = 4*nat`)
  - `openingCamera(userBox, base, stage) → camera | null`
  - `cameraViewBox(camera, stage) → { x, y, w, h }` (`w = stage.width/scale`, `h = stage.height/scale`)
  - `viewBoxAttr(box) → string` (`"x y w h"`)
  - `zoomCameraAtNorm(camera, { nx, ny, factor }, stage, scaleMin, scaleMax) → camera`
  - `panCamera(camera, dx, dy) → camera` (`vx -= dx/scale`)
  - `resizeCamera(camera, userBox, base, prevStage, nextStage) → camera | null`
  - `pointerToNorm(clientX, clientY, rect) → { nx, ny }` clamped to `[0,1]`
  - `canStartCamera(base, userBox, stage) → boolean`

- [ ] **Step 1: Write the failing tests**

Append to `internal/ui/testdata/mermaid_block_test.mjs` (do **not** delete existing zoom tests yet). Add these names to the `createRequire` import list: `parseViewBox`, `userBoxFromSvgAttrs`, `naturalScale`, `fitScale`, `cameraScaleRange`, `openingCamera`, `cameraViewBox`, `viewBoxAttr`, `zoomCameraAtNorm`, `panCamera`, `resizeCamera`, `pointerToNorm`, `canStartCamera`.

```js
test("parseViewBox reads space or comma viewBox", () => {
  assert.deepEqual(parseViewBox("0 0 800 600"), { x: 0, y: 0, w: 800, h: 600 });
  assert.deepEqual(parseViewBox("10,20,100,50"), { x: 10, y: 20, w: 100, h: 50 });
  assert.equal(parseViewBox(""), null);
  assert.equal(parseViewBox("0 0 0 10"), null);
});

test("userBoxFromSvgAttrs prefers viewBox then base", () => {
  assert.deepEqual(userBoxFromSvgAttrs("5 6 40 20", { width: 1, height: 1 }), {
    x: 5,
    y: 6,
    w: 40,
    h: 20,
  });
  assert.deepEqual(userBoxFromSvgAttrs(null, { width: 80, height: 40 }), {
    x: 0,
    y: 0,
    w: 80,
    h: 40,
  });
  assert.equal(userBoxFromSvgAttrs(null, null), null);
});

test("naturalScale is base width over user width", () => {
  assert.equal(naturalScale({ width: 400, height: 200 }, { x: 0, y: 0, w: 800, h: 400 }), 0.5);
  assert.ok(Number.isNaN(naturalScale({ width: 400, height: 200 }, { x: 0, y: 0, w: 0, h: 10 })));
});

test("fitScale never exceeds 1", () => {
  assert.equal(
    fitScale({ width: 100, height: 50 }, { width: 400, height: 300 }),
    1
  );
  assert.equal(
    fitScale({ width: 800, height: 600 }, { width: 400, height: 300 }),
    0.5
  );
  assert.equal(
    fitScale({ width: 800, height: 200 }, { width: 400, height: 300 }),
    0.5
  );
});

test("openingCamera contains large diagram and does not upscale small", () => {
  const small = openingCamera(
    { x: 0, y: 0, w: 100, h: 50 },
    { width: 100, height: 50 },
    { width: 400, height: 300 }
  );
  assert.equal(small.scale, 1);
  const smallBox = cameraViewBox(small, { width: 400, height: 300 });
  assert.equal(small.vx + smallBox.w / 2, 50);
  assert.equal(small.vy + smallBox.h / 2, 25);

  const large = openingCamera(
    { x: 0, y: 0, w: 800, h: 600 },
    { width: 800, height: 600 },
    { width: 400, height: 300 }
  );
  assert.equal(large.scale, 0.5);
  assert.equal(large.vx, 0);
  assert.equal(large.vy, 0);
});

test("zoomCameraAtNorm keeps user point under nx,ny", () => {
  const stage = { width: 200, height: 100 };
  const camera = { scale: 1, vx: 0, vy: 0 };
  const nx = 0.25;
  const ny = 0.5;
  const userX = camera.vx + nx * (stage.width / camera.scale);
  const userY = camera.vy + ny * (stage.height / camera.scale);
  const after = zoomCameraAtNorm(camera, { nx, ny, factor: 2 }, stage, 0.25, 4);
  assert.equal(after.scale, 2);
  const box = cameraViewBox(after, stage);
  assert.equal(after.vx + nx * box.w, userX);
  assert.equal(after.vy + ny * box.h, userY);
});

test("zoomCameraAtNorm no-ops at clamp limits", () => {
  const stage = { width: 200, height: 100 };
  const atMax = { scale: 4, vx: 1, vy: 2 };
  assert.deepEqual(
    zoomCameraAtNorm(atMax, { nx: 0.5, ny: 0.5, factor: 2 }, stage, 0.5, 4),
    atMax
  );
  const atMin = { scale: 0.5, vx: 3, vy: 4 };
  assert.deepEqual(
    zoomCameraAtNorm(atMin, { nx: 0.5, ny: 0.5, factor: 0.5 }, stage, 0.5, 4),
    atMin
  );
});

test("panCamera shifts frustum by dx/scale", () => {
  const after = panCamera({ scale: 2, vx: 10, vy: 20 }, 8, -4);
  assert.equal(after.scale, 2);
  assert.equal(after.vx, 10 - 8 / 2);
  assert.equal(after.vy, 20 - -4 / 2);
});

test("resizeCamera follows contain when shrinking while contained", () => {
  const userBox = { x: 0, y: 0, w: 800, h: 600 };
  const base = { width: 800, height: 600 };
  const prev = { width: 800, height: 600 };
  const camera = openingCamera(userBox, base, prev);
  const next = { width: 400, height: 300 };
  const after = resizeCamera(camera, userBox, base, prev, next);
  assert.deepEqual(after, openingCamera(userBox, base, next));
  assert.equal(after.scale, 0.5);
});

test("resizeCamera keeps zoomed-in center when still above contain", () => {
  const userBox = { x: 0, y: 0, w: 800, h: 600 };
  const base = { width: 800, height: 600 };
  const prev = { width: 400, height: 300 };
  const camera = { scale: 2, vx: 100, vy: 50 };
  const next = { width: 360, height: 270 };
  const after = resizeCamera(camera, userBox, base, prev, next);
  assert.equal(after.scale, 2);
  const prevBox = cameraViewBox(camera, prev);
  const nextBox = cameraViewBox(after, next);
  assert.equal(after.vx + nextBox.w / 2, camera.vx + prevBox.w / 2);
  assert.equal(after.vy + nextBox.h / 2, camera.vy + prevBox.h / 2);
});

test("pointerToNorm clamps to 0..1", () => {
  const rect = { left: 10, top: 20, width: 100, height: 50 };
  assert.deepEqual(pointerToNorm(10, 20, rect), { nx: 0, ny: 0 });
  assert.deepEqual(pointerToNorm(60, 45, rect), { nx: 0.5, ny: 0.5 });
  assert.deepEqual(pointerToNorm(-8, 999, rect), { nx: 0, ny: 1 });
});

test("canStartCamera requires measurable sizes", () => {
  const base = { width: 100, height: 50 };
  const userBox = { x: 0, y: 0, w: 100, h: 50 };
  const stage = { width: 200, height: 100 };
  assert.equal(canStartCamera(base, userBox, stage), true);
  assert.equal(canStartCamera(null, userBox, stage), false);
  assert.equal(canStartCamera(base, userBox, { width: 0, height: 100 }), false);
});

test("viewBoxAttr joins numbers", () => {
  assert.equal(viewBoxAttr({ x: 1, y: 2, w: 3, h: 4 }), "1 2 3 4");
});

test("cameraScaleRange uses contain min and 4x natural max", () => {
  const range = cameraScaleRange(
    { width: 800, height: 600 },
    { x: 0, y: 0, w: 800, h: 600 },
    { width: 400, height: 300 }
  );
  assert.equal(range.min, 0.5);
  assert.equal(range.max, 4);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: FAIL — `createRequire` cannot import the new names (or tests throw `undefined is not a function`).

- [ ] **Step 3: Implement the helpers**

In `internal/ui/md/mermaid-block.js`, keep `const SCALE_MAX = 4`. Insert after `readSvgBaseSize` (before `svgSizeForScale`):

```js
  function parseViewBox(value) {
    if (value == null || value === "") return null;
    const parts = String(value)
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length !== 4) return null;
    const x = parts[0];
    const y = parts[1];
    const w = parts[2];
    const h = parts[3];
    if (![x, y, w, h].every((n) => Number.isFinite(n)) || !(w > 0) || !(h > 0)) {
      return null;
    }
    return { x, y, w, h };
  }

  function userBoxFromSvgAttrs(viewBoxStr, base) {
    const vb = parseViewBox(viewBoxStr);
    if (vb) return vb;
    if (base && base.width > 0 && base.height > 0) {
      return { x: 0, y: 0, w: base.width, h: base.height };
    }
    return null;
  }

  function naturalScale(base, userBox) {
    if (!base || !userBox || !(userBox.w > 0) || !(base.width > 0)) return NaN;
    return base.width / userBox.w;
  }

  function fitScale(base, stage) {
    if (
      !base ||
      !stage ||
      !(base.width > 0) ||
      !(base.height > 0) ||
      !(stage.width > 0) ||
      !(stage.height > 0)
    ) {
      return NaN;
    }
    return Math.min(1, stage.width / base.width, stage.height / base.height);
  }

  function cameraScaleRange(base, userBox, stage) {
    const nat = naturalScale(base, userBox);
    const fit = fitScale(base, stage);
    if (!(nat > 0) || !(fit > 0)) return null;
    return { min: fit * nat, max: SCALE_MAX * nat };
  }

  function canStartCamera(base, userBox, stage) {
    return cameraScaleRange(base, userBox, stage) != null;
  }

  function cameraViewBox(camera, stage) {
    return {
      x: camera.vx,
      y: camera.vy,
      w: stage.width / camera.scale,
      h: stage.height / camera.scale,
    };
  }

  function viewBoxAttr(box) {
    return box.x + " " + box.y + " " + box.w + " " + box.h;
  }

  function openingCamera(userBox, base, stage) {
    const range = cameraScaleRange(base, userBox, stage);
    if (!range) return null;
    const scale = range.min;
    const vw = stage.width / scale;
    const vh = stage.height / scale;
    return {
      scale,
      vx: userBox.x + userBox.w / 2 - vw / 2,
      vy: userBox.y + userBox.h / 2 - vh / 2,
    };
  }

  function zoomCameraAtNorm(camera, point, stage, scaleMin, scaleMax) {
    const scale = camera.scale;
    let next = scale * point.factor;
    if (next < scaleMin) next = scaleMin;
    if (next > scaleMax) next = scaleMax;
    if (next === scale) {
      return { scale: camera.scale, vx: camera.vx, vy: camera.vy };
    }
    const nx = Math.min(1, Math.max(0, point.nx));
    const ny = Math.min(1, Math.max(0, point.ny));
    const vw = stage.width / scale;
    const vh = stage.height / scale;
    const userX = camera.vx + nx * vw;
    const userY = camera.vy + ny * vh;
    const vw2 = stage.width / next;
    const vh2 = stage.height / next;
    return { scale: next, vx: userX - nx * vw2, vy: userY - ny * vh2 };
  }

  function panCamera(camera, dx, dy) {
    return {
      scale: camera.scale,
      vx: camera.vx - dx / camera.scale,
      vy: camera.vy - dy / camera.scale,
    };
  }

  function resizeCamera(camera, userBox, base, prevStage, nextStage) {
    const nextRange = cameraScaleRange(base, userBox, nextStage);
    if (!nextRange || !camera) return null;
    const prevRange = cameraScaleRange(base, userBox, prevStage);
    const atContain = prevRange && camera.scale <= prevRange.min;
    if (atContain || camera.scale < nextRange.min) {
      return openingCamera(userBox, base, nextStage);
    }
    let scale = camera.scale;
    if (scale > nextRange.max) scale = nextRange.max;
    const cx = camera.vx + prevStage.width / (2 * camera.scale);
    const cy = camera.vy + prevStage.height / (2 * camera.scale);
    const vw = nextStage.width / scale;
    const vh = nextStage.height / scale;
    return { scale, vx: cx - vw / 2, vy: cy - vh / 2 };
  }

  function pointerToNorm(clientX, clientY, rect) {
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
      return { nx: 0.5, ny: 0.5 };
    }
    const nx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const ny = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return { nx, ny };
  }
```

Export all of the new functions from the factory return object (alongside existing exports).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: PASS (old zoom tests still pass; new camera tests pass).

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md/mermaid-block.js internal/ui/testdata/mermaid_block_test.mjs
git commit -m "feat(ui): add Mermaid fullscreen viewBox camera math"
```

---

### Task 2: Capture, apply, and restore SVG presentation

**Files:**
- Modify: `internal/ui/testdata/mermaid_block_test.mjs`
- Modify: `internal/ui/md/mermaid-block.js`

**Interfaces:**
- Consumes: `cameraViewBox`, `viewBoxAttr` from Task 1
- Produces:
  - `captureSvgPresentation(svg) → { viewBox, width, height, preserveAspectRatio, styleWidth, styleHeight, styleMaxWidth, styleMaxHeight } | null`
  - `restoreSvgAttrs(svg, captured)` — `null` attribute values call `removeAttribute`; styles restore to captured strings (empty string clears)
  - `applyCamera(svg, camera, stage)` — writes `viewBox` from camera; sets `width`/`height` attributes and styles to `"100%"`; `preserveAspectRatio="none"`; `maxWidth`/`maxHeight` style `"none"`. Does **not** set CSS `transform`. No-ops if `svg`, `camera`, or `stage` is missing
  - `measureStage(viewport) → { width, height } | null` from `clientWidth`/`clientHeight` (both must be > 0)

- [ ] **Step 1: Write the failing tests**

Import `captureSvgPresentation`, `restoreSvgAttrs`, `applyCamera`, `measureStage`. Append:

```js
function fakeSvg(init) {
  const attrs = Object.assign(
    { viewBox: "0 0 80 40", width: "80", height: "40", preserveAspectRatio: "xMidYMid meet" },
    init.attrs || {}
  );
  const style = Object.assign(
    { width: "", height: "", maxWidth: "", maxHeight: "" },
    init.style || {}
  );
  return {
    style,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    setAttribute(name, value) {
      attrs[name] = value;
    },
    removeAttribute(name) {
      delete attrs[name];
    },
    _attrs: attrs,
  };
}

test("captureSvgPresentation snapshots attrs and style", () => {
  const svg = fakeSvg({
    style: { width: "10px", height: "", maxWidth: "100%", maxHeight: "" },
  });
  const cap = captureSvgPresentation(svg);
  assert.equal(cap.viewBox, "0 0 80 40");
  assert.equal(cap.width, "80");
  assert.equal(cap.height, "40");
  assert.equal(cap.preserveAspectRatio, "xMidYMid meet");
  assert.equal(cap.styleWidth, "10px");
  assert.equal(cap.styleMaxWidth, "100%");
  assert.equal(captureSvgPresentation(null), null);
});

test("restoreSvgAttrs round-trips and removes null attrs", () => {
  const svg = fakeSvg({ attrs: { viewBox: "1 2 3 4", width: "100%", height: "100%" } });
  restoreSvgAttrs(svg, {
    viewBox: "0 0 80 40",
    width: "80",
    height: "40",
    preserveAspectRatio: null,
    styleWidth: "",
    styleHeight: "",
    styleMaxWidth: "",
    styleMaxHeight: "",
  });
  assert.equal(svg.getAttribute("viewBox"), "0 0 80 40");
  assert.equal(svg.getAttribute("width"), "80");
  assert.equal(svg.getAttribute("preserveAspectRatio"), null);
  assert.equal(svg.style.width, "");
});

test("applyCamera writes viewBox fill attrs not transform", () => {
  const svg = fakeSvg({});
  svg.style.transform = "";
  applyCamera(svg, { scale: 1, vx: -10, vy: -20 }, { width: 200, height: 100 });
  assert.equal(svg.getAttribute("viewBox"), "-10 -20 200 100");
  assert.equal(svg.getAttribute("width"), "100%");
  assert.equal(svg.getAttribute("height"), "100%");
  assert.equal(svg.getAttribute("preserveAspectRatio"), "none");
  assert.equal(svg.style.width, "100%");
  assert.equal(svg.style.height, "100%");
  assert.equal(svg.style.maxWidth, "none");
  assert.equal(svg.style.maxHeight, "none");
  assert.equal(svg.style.transform, "");
});

test("applyCamera no-ops without svg or camera", () => {
  const svg = fakeSvg({});
  applyCamera(null, { scale: 1, vx: 0, vy: 0 }, { width: 1, height: 1 });
  applyCamera(svg, null, { width: 1, height: 1 });
  assert.equal(svg.getAttribute("viewBox"), "0 0 80 40");
});

test("measureStage requires positive client box", () => {
  assert.deepEqual(measureStage({ clientWidth: 120, clientHeight: 80 }), {
    width: 120,
    height: 80,
  });
  assert.equal(measureStage({ clientWidth: 0, clientHeight: 80 }), null);
  assert.equal(measureStage(null), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: FAIL — new names not exported.

- [ ] **Step 3: Implement capture / restore / apply / measure**

In `internal/ui/md/mermaid-block.js`, add after `pointerToNorm`:

```js
  function captureSvgPresentation(svg) {
    if (!svg || typeof svg.getAttribute !== "function") return null;
    const style = svg.style || {};
    return {
      viewBox: svg.getAttribute("viewBox"),
      width: svg.getAttribute("width"),
      height: svg.getAttribute("height"),
      preserveAspectRatio: svg.getAttribute("preserveAspectRatio"),
      styleWidth: style.width || "",
      styleHeight: style.height || "",
      styleMaxWidth: style.maxWidth || "",
      styleMaxHeight: style.maxHeight || "",
    };
  }

  function restoreAttr(el, name, value) {
    if (value == null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }

  function restoreSvgAttrs(svg, captured) {
    if (!svg || !captured) return;
    restoreAttr(svg, "viewBox", captured.viewBox);
    restoreAttr(svg, "width", captured.width);
    restoreAttr(svg, "height", captured.height);
    restoreAttr(svg, "preserveAspectRatio", captured.preserveAspectRatio);
    if (svg.style) {
      svg.style.width = captured.styleWidth || "";
      svg.style.height = captured.styleHeight || "";
      svg.style.maxWidth = captured.styleMaxWidth || "";
      svg.style.maxHeight = captured.styleMaxHeight || "";
    }
  }

  function applyCamera(svg, camera, stage) {
    if (!svg || !camera || !stage) return;
    const box = cameraViewBox(camera, stage);
    svg.setAttribute("viewBox", viewBoxAttr(box));
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "none");
    if (svg.style) {
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.maxWidth = "none";
      svg.style.maxHeight = "none";
    }
  }

  function measureStage(viewport) {
    if (!viewport) return null;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!(width > 0) || !(height > 0)) return null;
    return { width, height };
  }
```

Export `captureSvgPresentation`, `restoreSvgAttrs`, `applyCamera`, `measureStage`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md/mermaid-block.js internal/ui/testdata/mermaid_block_test.mjs
git commit -m "feat(ui): capture and restore Mermaid SVG camera presentation"
```

---

### Task 3: Inline column-fit and drop inline zoom chrome

**Files:**
- Modify: `internal/ui/testdata/mermaid_block_test.mjs`
- Modify: `internal/ui/md/mermaid-block.js`
- Modify: `internal/ui/md/viewer.css`

**Interfaces:**
- Consumes: `previewActionsVisible`; `fsState` already tracks the fullscreen instance
- Produces:
  - `previewActionsHtml()` — only the Fullscreen button (no − / + / Reset)
  - `cacheBaseSize` caches `baseSize`, `userBox`, `originalPresentation`; **does not** call `applySvgZoomSize` or set `max-width: none`
  - `inst.isFullscreen()` → `!!(fsState && fsState.inst === inst)`
  - `bindPreviewInteractions` uses `canUseCamera()` = preview && !failed && `inst.isFullscreen()`; inline wheel does not `preventDefault`
  - CSS: inline SVG `max-width: 100%; height: auto`; grab cursor only under `.mermaid-fs-stage`

- [ ] **Step 1: Write the failing toolbar test**

Import `previewActionsHtml`. Append:

```js
test("previewActionsHtml is fullscreen only", () => {
  const html = previewActionsHtml();
  assert.match(html, /data-action="fullscreen"/);
  assert.doesNotMatch(html, /data-action="zoom-in"/);
  assert.doesNotMatch(html, /data-action="zoom-out"/);
  assert.doesNotMatch(html, /data-action="zoom-reset"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: FAIL — `previewActionsHtml` is not exported.

- [ ] **Step 3: Toolbar helper + shell + cacheBaseSize + gestures**

Add:

```js
  function previewActionsHtml() {
    return (
      '<button type="button" data-action="fullscreen" aria-label="Fullscreen">Fullscreen</button>'
    );
  }
```

In `createMermaidBlock` innerHTML, replace the preview-actions buttons with `previewActionsHtml()`:

```js
      '<div class="mermaid-preview-actions" hidden>' +
      previewActionsHtml() +
      "</div></div>" +
```

Inside `createMermaidBlock`, add `let userBox = null;` and `let originalPresentation = null;` next to `baseSize`.

Replace `cacheBaseSize` with:

```js
    function cacheBaseSize() {
      const svg = getDiagramSvg();
      baseSize = readSvgBaseSize(svg);
      userBox = userBoxFromSvgAttrs(svg && svg.getAttribute("viewBox"), baseSize);
      originalPresentation = captureSvgPresentation(svg);
    }
```

In `bindPreviewInteractions`, replace `canZoom` with:

```js
    function canUseCamera() {
      return (
        inst.getMode() === "preview" &&
        !inst.isFailed() &&
        typeof inst.isFullscreen === "function" &&
        inst.isFullscreen()
      );
    }
```

Use `canUseCamera` everywhere `canZoom` was used. On `wheel`, if `!canUseCamera()` **return without** `preventDefault`. Remove the `zoom-reset` / `zoom-in` / `zoom-out` branches from the preview-actions click handler; keep only `fullscreen`.

On the `inst` object, add before `bindPreviewInteractions(inst)`:

```js
      isFullscreen: () => !!(fsState && fsState.inst === inst),
```

Export `previewActionsHtml`.

- [ ] **Step 4: CSS for inline fit and fullscreen-only grab**

In `internal/ui/md/viewer.css`, **delete** these rules:

```css
.mermaid-block.mode-preview .mermaid-diagram svg,
.mermaid-fs-stage .mermaid-diagram svg {
  max-width: none;
}

.mermaid-block.mode-preview:not(.is-failed) .mermaid-viewport {
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.mermaid-block.mode-preview:not(.is-failed) .mermaid-viewport.is-panning {
  cursor: grabbing;
}
```

Keep `.mermaid-diagram svg { max-width: 100%; height: auto; }`.

Replace `.mermaid-fs-stage .mermaid-viewport` / panning rules and add fill + fallback:

```css
.mermaid-fs-stage .mermaid-viewport {
  width: 100%;
  height: 100%;
  min-height: 100%;
}

.mermaid-fs-stage .mermaid-viewport.is-camera {
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.mermaid-fs-stage .mermaid-viewport.is-camera.is-panning {
  cursor: grabbing;
}

.mermaid-fs-stage .mermaid-zoom-target,
.mermaid-fs-stage .mermaid-diagram {
  width: 100%;
  height: 100%;
}

.mermaid-fs-stage .mermaid-diagram {
  padding: 0;
  text-align: left;
}

.mermaid-fs-stage .mermaid-diagram svg {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  display: block;
}

.mermaid-fs-stage .mermaid-viewport.is-fs-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
}

.mermaid-fs-stage .mermaid-viewport.is-fs-fallback .mermaid-zoom-target,
.mermaid-fs-stage .mermaid-viewport.is-fs-fallback .mermaid-diagram {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
}

.mermaid-fs-stage .mermaid-viewport.is-fs-fallback .mermaid-diagram svg {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/ui/md/mermaid-block.js internal/ui/testdata/mermaid_block_test.mjs internal/ui/md/viewer.css
git commit -m "feat(ui): fit Mermaid preview to column and drop inline zoom"
```

---

### Task 4: Wire fullscreen to the viewBox camera

**Files:**
- Modify: `internal/ui/md/mermaid-block.js`

Do Steps 1–3 before running the viewer; Step 1 removes `applyZoomState`, which bind still references until Step 2.

**Interfaces:**
- Consumes: Task 1–3 helpers; `handleFullscreenChromeAction`; `openMermaidFullscreen` / `closeMermaidFullscreen`
- Produces:
  - `inst` fields used by gestures: `getDiagramSvg`, `getUserBox`, `getBaseSize`, `getOriginalPresentation`, `getCameraState`, `applyCameraState`, `startCamera`, `stopCamera`, `resetZoom` (re-opens contain camera when fullscreen)
  - `fsState` also stores `{ stage, onResize }`
  - Fullscreen open: after overlay is shown, `startCamera()`; one `requestAnimationFrame` retry if `measureStage` is null
  - If `canStartCamera` is false: add class `is-fs-fallback` on viewport; do not apply camera; `canUseCamera` also requires `inst.getCameraState() != null`
  - If camera starts: add class `is-camera` on viewport
  - Wheel: `pointerToNorm` from **SVG** `getBoundingClientRect()`; `zoomCameraAtNorm` with `cameraScaleRange`; `applyCamera`
  - Drag: `panCamera` + `applyCamera`
  - Window `resize` while `fsState`: `resizeCamera` then `applyCamera`; update `fsState.stage`
  - Close / leave Preview: `stopCamera()` restores attrs, clears camera, removes `is-camera` / `is-fs-fallback`, removes resize listener
  - Reset chrome: `resetZoom()` → `openingCamera` + `applyCamera`; overlay stays open

- [ ] **Step 1: Extend the instance with camera methods**

Inside `createMermaidBlock`, add `let camera = null;` next to `baseSize`.

Replace `applyZoomState` / `resetZoom` / `getZoomState` with:

```js
    function getSvg() {
      return getDiagramSvg();
    }

    function applyCameraState(next, stage) {
      if (!next || !stage) return;
      camera = { scale: next.scale, vx: next.vx, vy: next.vy };
      applyCamera(getSvg(), camera, stage);
      if (fsState && fsState.inst === inst) {
        fsState.stage = stage;
      }
    }

    function startCamera() {
      viewportEl.classList.remove("is-camera", "is-fs-fallback");
      camera = null;
      const stage = measureStage(viewportEl);
      if (!stage) return false;
      const svg = getSvg();
      if (!canStartCamera(baseSize, userBox, stage) || !svg) {
        viewportEl.classList.add("is-fs-fallback");
        return false;
      }
      const next = openingCamera(userBox, baseSize, stage);
      viewportEl.classList.add("is-camera");
      applyCameraState(next, stage);
      return true;
    }

    function stopCamera() {
      viewportEl.classList.remove("is-camera", "is-fs-fallback");
      restoreSvgAttrs(getSvg(), originalPresentation);
      camera = null;
    }

    function resetZoom() {
      if (!(fsState && fsState.inst === inst)) return;
      startCamera();
    }
```

Keep existing `inst` fields `root`, `diagramEl`, `setMode`, `getMode`, `setRenderFailed`, `getViewport`, `getZoomTarget`, `getPanes`, `isFailed`, `cacheBaseSize`. Remove `applyZoomState` and `getZoomState`. Add:

```js
      getDiagramSvg: getSvg,
      getUserBox: () => userBox,
      getBaseSize: () => baseSize,
      getOriginalPresentation: () => originalPresentation,
      getCameraState: () =>
        camera ? { scale: camera.scale, vx: camera.vx, vy: camera.vy } : null,
      applyCameraState,
      startCamera,
      stopCamera,
      resetZoom,
      isFullscreen: () => !!(fsState && fsState.inst === inst),
```

Remove `applyZoomState` / `getZoomState` from `inst` (gestures in the next step no longer call them). Keep `zoomTarget.style.transform` untouched (identity).

In `setMode`, when leaving preview, still `closeMermaidFullscreen()` if this instance is fullscreen. Remove the `applyZoomState({ scale: 1, tx: 0, ty: 0 })` call.

- [ ] **Step 2: Bind wheel/drag to the camera**

Replace `zoomBy` and the pan `pointermove` body in `bindPreviewInteractions`:

```js
    function canUseCamera() {
      return (
        inst.getMode() === "preview" &&
        !inst.isFailed() &&
        typeof inst.isFullscreen === "function" &&
        inst.isFullscreen() &&
        inst.getCameraState() != null
      );
    }

    function currentStage() {
      return measureStage(viewport) || (fsState && fsState.inst === inst && fsState.stage) || null;
    }

    function zoomBy(factor, clientX, clientY) {
      if (!canUseCamera() || factor === 1) return;
      const svg = inst.getDiagramSvg();
      const stage = currentStage();
      const cam = inst.getCameraState();
      const range = cameraScaleRange(inst.getBaseSize(), inst.getUserBox(), stage);
      if (!svg || !stage || !cam || !range) return;
      const rect = svg.getBoundingClientRect();
      const { nx, ny } = pointerToNorm(clientX, clientY, rect);
      const next = zoomCameraAtNorm(cam, { nx, ny, factor }, stage, range.min, range.max);
      inst.applyCameraState(next, stage);
    }

    viewport.addEventListener(
      "wheel",
      (ev) => {
        if (!canUseCamera()) return;
        const factor = wheelZoomFactor(ev.deltaY);
        if (factor === 1) return;
        ev.preventDefault();
        zoomBy(factor, ev.clientX, ev.clientY);
      },
      { passive: false }
    );
```

In `pointermove` while dragging:

```js
      const stage = currentStage();
      const cam = inst.getCameraState();
      if (!stage || !cam) {
        endDrag(ev);
        return;
      }
      inst.applyCameraState(panCamera(cam, dx, dy), stage);
```

`pointerdown` still requires `canUseCamera()` and `ev.button === 0`.

- [ ] **Step 3: Start/stop camera from overlay open/close + resize**

Change `openMermaidFullscreen` so after `fsState` is assigned:

```js
    fsState = { inst, unlock, onKey, placeholder, viewport, inertEl, stage: null, onResize: null };

    function tryStart() {
      if (!fsState || fsState.inst !== inst) return;
      inst.startCamera();
      fsState.stage = measureStage(viewport);
    }

    tryStart();
    if (!inst.getCameraState() && !viewport.classList.contains("is-fs-fallback")) {
      requestAnimationFrame(() => {
        if (!fsState || fsState.inst !== inst) return;
        tryStart();
        if (!inst.getCameraState() && !viewport.classList.contains("is-fs-fallback")) {
          viewport.classList.add("is-fs-fallback");
        }
      });
    }

    const onResize = () => {
      if (!fsState || fsState.inst !== inst) return;
      const cam = inst.getCameraState();
      const nextStage = measureStage(viewport);
      if (!cam || !nextStage) return;
      const prevStage = fsState.stage || nextStage;
      const next = resizeCamera(
        cam,
        inst.getUserBox(),
        inst.getBaseSize(),
        prevStage,
        nextStage
      );
      inst.applyCameraState(next, nextStage);
    };
    window.addEventListener("resize", onResize);
    fsState.onResize = onResize;
```

In `closeMermaidFullscreen`, before restoring the viewport to panes:

```js
    if (fsState.onResize) {
      window.removeEventListener("resize", fsState.onResize);
    }
    inst.stopCamera();
```

Remove the existing `inst.resetZoom()` at the end of close (stopCamera already restores original attrs; calling startCamera would be wrong after the overlay is gone). Keep `handleFullscreenChromeAction("fs-reset")` → `api.resetZoom()` which now re-contains.

- [ ] **Step 4: Run unit tests**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: PASS. (`handleFullscreenChromeAction` still calls `resetZoom`; chrome tests unchanged.)

Also run: `go test ./internal/ui -run TestMermaidBlockHelpers`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md/mermaid-block.js
git commit -m "feat(ui): zoom Mermaid fullscreen with a viewBox camera"
```

---

### Task 5: Remove SVG-dimension zoom leftovers

**Files:**
- Modify: `internal/ui/testdata/mermaid_block_test.mjs`
- Modify: `internal/ui/md/mermaid-block.js`

**Interfaces:**
- Consumes: camera helpers from Tasks 1–4
- Produces: no `zoomAtPoint`, `applyTransformStyle`, `svgSizeForScale`, `applySvgZoomSize`, `SCALE_MIN`, or `clampScale`. Keep `SCALE_MAX`. `wheelZoomFactor` stays.

- [ ] **Step 1: Replace obsolete tests**

In `internal/ui/testdata/mermaid_block_test.mjs`:

- Remove imports: `SCALE_MIN`, `clampScale`, `zoomAtPoint`, `applyTransformStyle`, `svgSizeForScale`, `applySvgZoomSize`.
- Delete tests: `"clampScale"`, `"zoomAtPoint scales around cursor"`, `"zoomAtPoint with existing pan keeps cursor content point"`, `"zoomAtPoint clamps and no-ops at limit"`, `"applyTransformStyle is translate-only"`, `"svgSizeForScale multiplies base by clamped scale"`, `"applySvgZoomSize sets attributes and clears max-width"`, `"applySvgZoomSize no-ops without svg or base"`.
- Keep `SCALE_MAX` import; add:

```js
test("SCALE_MAX is 4x natural", () => {
  assert.equal(SCALE_MAX, 4);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: FAIL if the import list still requests deleted names, or PASS if you already dropped the imports in Step 1 — in that case proceed; the implementation step still must delete the dead functions so they are not exported.

- [ ] **Step 3: Delete dead helpers**

In `internal/ui/md/mermaid-block.js` remove:

- `const SCALE_MIN = 0.25;`
- `clampScale`
- `zoomAtPoint`
- `applyTransformStyle`
- `svgSizeForScale`
- `applySvgZoomSize`

Remove them from the export object. Do not export `SCALE_MIN`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: PASS.

Run: `go test ./internal/ui -run TestMermaidBlockHelpers`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md/mermaid-block.js internal/ui/testdata/mermaid_block_test.mjs
git commit -m "refactor(ui): remove Mermaid CSS-dimension zoom helpers"
```

---

## Manual verification (after Task 4 or 5)

Use a Markdown file with a small flowchart and a wide/large diagram.

1. Inline Preview: wide diagram fully visible at column width, sharp; small diagram not enlarged; wheel scrolls the page; dragging does not pan.
2. Toolbar has Fullscreen only (no − / + / Reset).
3. Fullscreen: diagram contained and centered; wheel zoom stays under the cursor; zoom in to ~4× — edges/text stay sharp (not blurry CSS-scale).
4. Reset returns to contain; Close restores inline fit; Esc same as Close.
5. Failed mermaid fence: no Fullscreen.
6. SSE reload: back to column-fit Preview, overlay closed.
7. Resize the window while fullscreen: shrinking the window keeps the whole figure visible when contain requires it.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Inline no zoom/pan; column-width vector fit; no upscale | 3 |
| Fullscreen-only zoom | 3 (gate) + 4 (camera) |
| Contain on open, no upscale past 1×; Reset = contain | 1 (`openingCamera`) + 4 |
| ViewBox camera; cursor-centered; pan follows pointer | 1 + 4 |
| Range `[contain, 4× natural]` | 1 (`cameraScaleRange`) + 4 |
| Vector; no CSS `scale()`; no dimension-zoom | 2 (`applyCamera`) + 4 + 5 |
| Restore original attrs on exit | 2 + 4 |
| Fallback when unmeasurable / stage 0 | 4 (`is-fs-fallback`) |
| Window resize while fullscreen | 1 (`resizeCamera`) + 4 |
| Toolbar Fullscreen only; chrome Reset + Close | 3 + existing overlay |
| Tests for math, restore, toolbar, Reset vs Close | 1, 2, 3, existing chrome tests |
| Remove old dimension zoom | 5 |
| `viewer.js` still `cacheBaseSize` after `mermaid.run` | 3 (behavior change inside cacheBaseSize) |
