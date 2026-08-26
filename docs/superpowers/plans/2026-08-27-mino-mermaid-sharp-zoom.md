# Mino Mermaid Sharp Zoom & Drop Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Mermaid Split mode (keep Code | Preview) and replace CSS `transform: scale()` zoom with SVG width/height scaling so Preview/fullscreen stay sharp; add Reset to the fullscreen chrome.

**Architecture:** Keep the existing `mermaid-block` shell. Drop Split from mode helpers, DOM, and CSS. After `mermaid.run`, cache SVG base size; `applyZoomState` sets SVG dimensions to `base × scale` and applies **translate-only** CSS transform for pan. Fullscreen overlay gains a Reset button that calls `resetZoom` without closing.

**Tech Stack:** Existing Markdown viewer + vendored Mermaid; plain DOM/CSS; Node `node:test` via `mermaid_block_node_test.go`; no new vendor libraries.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-27-mino-mermaid-sharp-zoom-design.md`
- Modes: **code** | **preview** only; default **preview**; `"split"` and unknown → `"preview"`
- Zoom: wheel cursor-origin, drag pan, toolbar − / + / Reset; clamp **0.25–4**
- Sharp zoom: mutate SVG `width`/`height` from cached base; **never** `scale()` in CSS transform
- Fullscreen: in-viewer overlay; chrome **Close** + **Reset**; Reset does not dismiss; Close/Esc/backdrop still reset zoom and dismiss
- No mode/zoom persistence across iframe / SSE reload
- No new pan-zoom libraries; TDD; commit after each task
- Do not change HTML app preview or SSE reload semantics

---

## File Structure

```text
internal/ui/md/mermaid-block.js              # MODIFY: modes, sharp zoom, fullscreen Reset
internal/ui/testdata/mermaid_block_test.mjs  # MODIFY: tests for above
internal/ui/md/viewer.css                    # MODIFY: remove Split; optional fs-chrome gap
internal/ui/md/viewer.js                     # MODIFY: call cacheBaseSize after mermaid.run
internal/ui/mermaid_block_node_test.go       # UNCHANGED (still runs node --test)
```

---

### Task 1: Drop Split from mode helpers

**Files:**
- Modify: `internal/ui/testdata/mermaid_block_test.mjs`
- Modify: `internal/ui/md/mermaid-block.js`

**Interfaces:**
- Consumes: existing `normalizeMode`, `modeClass`, `previewActionsVisible`
- Produces:
  - `MODES = { code: true, preview: true }` (no `split`)
  - `normalizeMode("split") === "preview"`
  - `modeClass("split") === "mode-preview"`
  - `previewActionsVisible("split", false) === false` (treat as non-preview)

- [ ] **Step 1: Update failing expectations in the Node tests**

In `internal/ui/testdata/mermaid_block_test.mjs`, change:

```js
test("normalizeMode defaults unknown to preview", () => {
  assert.equal(normalizeMode("preview"), "preview");
  assert.equal(normalizeMode("code"), "code");
  assert.equal(normalizeMode("split"), "preview");
  assert.equal(normalizeMode("nope"), "preview");
  assert.equal(normalizeMode(""), "preview");
  assert.equal(DEFAULT_MODE, "preview");
});

test("modeClass", () => {
  assert.equal(modeClass("code"), "mode-code");
  assert.equal(modeClass("split"), "mode-preview");
  assert.equal(modeClass("garbage"), "mode-preview");
});

test("previewActionsVisible", () => {
  assert.equal(previewActionsVisible("preview", false), true);
  assert.equal(previewActionsVisible("code", false), false);
  assert.equal(previewActionsVisible("split", false), false);
  assert.equal(previewActionsVisible("preview", true), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: FAIL — `normalizeMode("split")` still returns `"split"`; `modeClass("split")` still `"mode-split"`.

- [ ] **Step 3: Remove Split from mode map**

In `internal/ui/md/mermaid-block.js`, change:

```js
const MODES = { code: true, preview: true };
```

Leave `normalizeMode` / `modeClass` / `previewActionsVisible` logic otherwise unchanged (unknown keys already fall through to `DEFAULT_MODE`).

Also in `syncChrome` inside `createMermaidBlock`, stop toggling `mode-split`:

```js
root.classList.remove("mode-code", "mode-preview");
root.classList.add(modeClass(mode));
```

(Do not remove the Split toolbar button yet — that is Task 3.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: PASS for normalizeMode / modeClass / previewActionsVisible (other tests may still expect scale-in-transform until Task 2).

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md/mermaid-block.js internal/ui/testdata/mermaid_block_test.mjs
git commit -m "refactor(ui): drop Split from Mermaid mode helpers"
```

---

### Task 2: Sharp zoom helpers (translate-only + SVG size)

**Files:**
- Modify: `internal/ui/testdata/mermaid_block_test.mjs`
- Modify: `internal/ui/md/mermaid-block.js`

**Interfaces:**
- Consumes: `clampScale`, existing `zoomAtPoint` (unchanged math)
- Produces:
  - `function applyTransformStyle(state: { tx: number, ty: number }): string` — `"translate(txpx, typx)"` only (ignore `scale` if present)
  - `function readSvgBaseSize(svg): { width: number, height: number } | null` — prefer positive numeric `width`/`height` attributes; else `null` (do not invent sizes)
  - `function svgSizeForScale(base: { width: number, height: number }, scale: number): { width: number, height: number }` — `{ width: base.width * clampScale(scale), height: base.height * clampScale(scale) }`
  - `function applySvgZoomSize(svg, base, scale): void` — if `svg` and `base` are truthy, set `width`/`height` attributes to stringified `svgSizeForScale` values; otherwise no-op

- [ ] **Step 1: Write the failing tests**

Replace the existing `applyTransformStyle` test and add new tests in `mermaid_block_test.mjs`. Update the import list to include `readSvgBaseSize`, `svgSizeForScale`, `applySvgZoomSize`:

```js
const {
  SCALE_MIN,
  SCALE_MAX,
  DEFAULT_MODE,
  normalizeMode,
  modeClass,
  clampScale,
  zoomAtPoint,
  applyTransformStyle,
  previewActionsVisible,
  wheelZoomFactor,
  withOverflowLocked,
  restoreFullscreenViewport,
  readSvgBaseSize,
  svgSizeForScale,
  applySvgZoomSize,
} = createRequire(import.meta.url)("../md/mermaid-block.js");

test("applyTransformStyle is translate-only", () => {
  assert.equal(
    applyTransformStyle({ scale: 1.5, tx: 10, ty: -4 }),
    "translate(10px, -4px)"
  );
  assert.equal(
    applyTransformStyle({ scale: 1, tx: 0, ty: 0 }),
    "translate(0px, 0px)"
  );
});

test("readSvgBaseSize prefers positive attributes", () => {
  const svg = {
    getAttribute(name) {
      if (name === "width") return "200";
      if (name === "height") return "100";
      return null;
    },
  };
  assert.deepEqual(readSvgBaseSize(svg), { width: 200, height: 100 });
});

test("readSvgBaseSize returns null when attributes missing or invalid", () => {
  assert.equal(readSvgBaseSize(null), null);
  assert.equal(
    readSvgBaseSize({
      getAttribute() {
        return null;
      },
    }),
    null
  );
  assert.equal(
    readSvgBaseSize({
      getAttribute(name) {
        return name === "width" ? "0" : "10";
      },
    }),
    null
  );
});

test("svgSizeForScale multiplies base by clamped scale", () => {
  assert.deepEqual(svgSizeForScale({ width: 200, height: 100 }, 2), {
    width: 400,
    height: 200,
  });
  assert.deepEqual(svgSizeForScale({ width: 200, height: 100 }, 99), {
    width: 200 * SCALE_MAX,
    height: 100 * SCALE_MAX,
  });
});

test("applySvgZoomSize sets attributes when base present", () => {
  const attrs = {};
  const svg = {
    setAttribute(name, value) {
      attrs[name] = value;
    },
  };
  applySvgZoomSize(svg, { width: 200, height: 100 }, 2);
  assert.equal(attrs.width, "400");
  assert.equal(attrs.height, "200");
});

test("applySvgZoomSize no-ops without svg or base", () => {
  const attrs = {};
  const svg = {
    setAttribute(name, value) {
      attrs[name] = value;
    },
  };
  applySvgZoomSize(null, { width: 1, height: 1 }, 2);
  applySvgZoomSize(svg, null, 2);
  assert.deepEqual(attrs, {});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: FAIL — `applyTransformStyle` still includes `scale(...)`; new helpers undefined.

- [ ] **Step 3: Implement helpers and export them**

In `internal/ui/md/mermaid-block.js`:

```js
function applyTransformStyle(state) {
  return "translate(" + state.tx + "px, " + state.ty + "px)";
}

function readSvgBaseSize(svg) {
  if (!svg || typeof svg.getAttribute !== "function") return null;
  const w = Number(svg.getAttribute("width"));
  const h = Number(svg.getAttribute("height"));
  if (!(w > 0) || !(h > 0)) return null;
  return { width: w, height: h };
}

function svgSizeForScale(base, scale) {
  const s = clampScale(scale);
  return { width: base.width * s, height: base.height * s };
}

function applySvgZoomSize(svg, base, scale) {
  if (!svg || !base) return;
  const size = svgSizeForScale(base, scale);
  svg.setAttribute("width", String(size.width));
  svg.setAttribute("height", String(size.height));
}
```

Export `readSvgBaseSize`, `svgSizeForScale`, `applySvgZoomSize` on the returned API object alongside existing exports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md/mermaid-block.js internal/ui/testdata/mermaid_block_test.mjs
git commit -m "feat(ui): add SVG dimension zoom helpers for Mermaid"
```

---

### Task 3: Wire sharp zoom into the block instance + drop Split UI/CSS

**Files:**
- Modify: `internal/ui/md/mermaid-block.js`
- Modify: `internal/ui/md/viewer.css`
- Modify: `internal/ui/md/viewer.js`

**Interfaces:**
- Consumes: `readSvgBaseSize`, `applySvgZoomSize`, `applyTransformStyle` from Task 2
- Produces on each block instance:
  - `cacheBaseSize(): void` — query `diagramEl.querySelector("svg")`, set internal `baseSize` via `readSvgBaseSize` (or leave `null`)
  - `applyZoomState(state)` — update zoom state; set `zoomTarget.style.transform = applyTransformStyle(zoom)`; call `applySvgZoomSize(svg, baseSize, zoom.scale)` when an svg exists
  - `resetZoom()` — still `{ scale: 1, tx: 0, ty: 0 }` via `applyZoomState`
  - Toolbar HTML: **no** Split button

- [ ] **Step 1: Remove Split button from shell HTML**

In `createMermaidBlock` `innerHTML`, change the mode group to:

```js
'<div class="mermaid-mode-group">' +
'<button type="button" data-mode="code">Code</button>' +
'<button type="button" data-mode="preview" aria-pressed="true">Preview</button>' +
"</div>" +
```

- [ ] **Step 2: Add `baseSize` + `cacheBaseSize` and update `applyZoomState` / leave-preview reset**

Inside `createMermaidBlock`, after existing state vars:

```js
let baseSize = null;

function getDiagramSvg() {
  return diagramEl.querySelector("svg");
}

function cacheBaseSize() {
  baseSize = readSvgBaseSize(getDiagramSvg());
}
```

Update `applyZoomState`:

```js
function applyZoomState(state) {
  zoom = {
    scale: clampScale(state.scale),
    tx: state.tx,
    ty: state.ty,
  };
  zoomTarget.style.transform = applyTransformStyle(zoom);
  applySvgZoomSize(getDiagramSvg(), baseSize, zoom.scale);
  const transforming = zoom.scale !== 1 || zoom.tx !== 0 || zoom.ty !== 0;
  zoomTarget.classList.toggle("is-transforming", transforming);
}
```

When leaving Preview in `setMode`, keep resetting zoom via `applyZoomState` / the existing reset path so SVG size returns to base:

```js
if (mode !== "preview") {
  if (fsState && fsState.inst === inst) closeMermaidFullscreen();
  applyZoomState({ scale: 1, tx: 0, ty: 0 });
}
```

(Replace the previous manual `zoom = …; zoomTarget.style.transform = …` assignment so SVG dimensions reset too.)

Expose on `inst`:

```js
cacheBaseSize,
```

- [ ] **Step 3: Call `cacheBaseSize` after successful `mermaid.run`**

In `internal/ui/md/viewer.js`:

```js
for (const inst of instances) {
  try {
    await mermaid.run({ nodes: [inst.diagramEl] });
    inst.cacheBaseSize();
  } catch (_) {
    inst.setRenderFailed();
  }
}
```

- [ ] **Step 4: Remove Split CSS**

In `internal/ui/md/viewer.css`, delete these rules entirely:

```css
.mermaid-block.mode-split .mermaid-panes {
  grid-template-columns: 1fr 1fr;
}

.mermaid-block.mode-split .mermaid-viewport {
  overflow: auto;
}
```

And delete the narrow media-query Split block:

```css
@media (max-width: 959px) {
  .mermaid-block.mode-split .mermaid-panes {
    grid-template-columns: 1fr;
  }
}
```

If that `@media (max-width: 959px)` block becomes empty, remove the whole empty media query (keep any other rules that share it — currently only Split lives there for Mermaid; TOC media rules are separate further down).

Keep:

```css
.mermaid-block.mode-preview .mermaid-diagram svg,
.mermaid-fs-stage .mermaid-diagram svg {
  max-width: none;
}
```

- [ ] **Step 5: Run helper tests + Go wrapper**

Run:

```bash
node --test internal/ui/testdata/mermaid_block_test.mjs
go test ./internal/ui -run TestMermaidBlockHelpers -count=1
```

Expected: PASS.

- [ ] **Step 6: Manual smoke (local)**

Open a Markdown file with a Mermaid fence: confirm toolbar is Code | Preview only; enlarge with + / wheel and verify edges stay sharp; Reset returns to base size.

- [ ] **Step 7: Commit**

```bash
git add internal/ui/md/mermaid-block.js internal/ui/md/viewer.js internal/ui/md/viewer.css
git commit -m "feat(ui): sharp Mermaid zoom via SVG size; remove Split UI"
```

---

### Task 4: Fullscreen Reset control

**Files:**
- Modify: `internal/ui/md/mermaid-block.js`
- Modify: `internal/ui/md/viewer.css`
- Modify: `internal/ui/testdata/mermaid_block_test.mjs`

**Interfaces:**
- Consumes: `resetZoom` on the open instance; existing `closeMermaidFullscreen`
- Produces:
  - Overlay chrome HTML includes `<button type="button" data-action="fs-reset" aria-label="Reset zoom">Reset</button>` before Close
  - Click `fs-reset` → `fsState.inst.resetZoom()`; overlay stays open (`fsState` unchanged)
  - Pure helper for testability: `function handleFullscreenChromeAction(action, api): "reset" | "close" | null` where `api = { resetZoom, close }` — `"fs-reset"` calls `resetZoom` and returns `"reset"`; `"fs-close"` calls `close` and returns `"close"`; else `null`

- [ ] **Step 1: Write the failing test for chrome action routing**

Add to `mermaid_block_test.mjs` import + test:

```js
  handleFullscreenChromeAction,
```

```js
test("handleFullscreenChromeAction reset does not close", () => {
  const calls = [];
  const api = {
    resetZoom() {
      calls.push("reset");
    },
    close() {
      calls.push("close");
    },
  };
  assert.equal(handleFullscreenChromeAction("fs-reset", api), "reset");
  assert.deepEqual(calls, ["reset"]);
  assert.equal(handleFullscreenChromeAction("fs-close", api), "close");
  assert.deepEqual(calls, ["reset", "close"]);
  assert.equal(handleFullscreenChromeAction("other", api), null);
  assert.deepEqual(calls, ["reset", "close"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test internal/ui/testdata/mermaid_block_test.mjs`

Expected: FAIL — `handleFullscreenChromeAction` undefined.

- [ ] **Step 3: Implement helper, overlay button, and wiring**

```js
function handleFullscreenChromeAction(action, api) {
  if (action === "fs-reset") {
    api.resetZoom();
    return "reset";
  }
  if (action === "fs-close") {
    api.close();
    return "close";
  }
  return null;
}
```

In `ensureOverlay`, change chrome HTML to:

```js
el.innerHTML =
  '<div class="mermaid-fs-chrome">' +
  '<button type="button" data-action="fs-reset" aria-label="Reset zoom">Reset</button>' +
  '<button type="button" data-action="fs-close" aria-label="Close">Close</button>' +
  "</div>" +
  '<div class="mermaid-fs-stage"></div>';
```

Replace the close-only click listener with:

```js
el.querySelector(".mermaid-fs-chrome").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-action");
  if (!fsState) {
    if (action === "fs-close") closeMermaidFullscreen();
    return;
  }
  handleFullscreenChromeAction(action, {
    resetZoom: () => fsState.inst.resetZoom(),
    close: closeMermaidFullscreen,
  });
});
```

Remove the old dedicated `fs-close` listener that only called `closeMermaidFullscreen`.

Export `handleFullscreenChromeAction`.

In `viewer.css`, update:

```css
.mermaid-fs-chrome {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 8px;
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test internal/ui/testdata/mermaid_block_test.mjs
go test ./internal/ui -run TestMermaidBlockHelpers -count=1
```

Expected: PASS.

- [ ] **Step 5: Manual check**

Fullscreen → zoom in → Reset (overlay stays, zoom 1×) → Close (dismisses). Esc still closes.

- [ ] **Step 6: Commit**

```bash
git add internal/ui/md/mermaid-block.js internal/ui/md/viewer.css internal/ui/testdata/mermaid_block_test.mjs
git commit -m "feat(ui): add Reset control to Mermaid fullscreen chrome"
```

---

### Task 5: Regression pass

**Files:**
- None required unless a test failure forces a fix

- [ ] **Step 1: Run focused + nearby UI tests**

```bash
node --test internal/ui/testdata/mermaid_block_test.mjs
go test ./internal/ui -count=1
go test ./internal/server -run 'TestEmbedded|TestMarkdown|TestMermaid|TestServe' -count=1
```

Expected: PASS (skip only if `node` missing for the Go wrapper, same as today).

- [ ] **Step 2: Manual checklist against success criteria**

1. Toolbar: Code | Preview only (no Split).
2. Preview zoom (wheel / ±) stays sharp up to 4×.
3. Fullscreen has Reset; Close/Esc reset and dismiss.
4. Failed Mermaid still shows Code source; no zoom chrome.
5. Edit+SSE reload returns to Preview at 1×.

- [ ] **Step 3: Commit only if Step 1 required fixes; otherwise done**

If fixes were needed:

```bash
git add -u
git commit -m "test(ui): harden Mermaid sharp-zoom regression coverage"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Remove Split; Code \| Preview only | 1, 3 |
| Sharp SVG zoom via dimensions | 2, 3 |
| Keep wheel / drag / ± / Reset / fullscreen | 3 (existing bindings), 4 |
| Fullscreen Reset without close | 4 |
| Close/Esc still reset+dismiss | 4 (unchanged close path) |
| No new vendors / no API changes | all |
| Tests for helpers + manual sharp/fullscreen | 1–5 |

No TBD/placeholder steps. Names consistent: `cacheBaseSize`, `readSvgBaseSize`, `svgSizeForScale`, `applySvgZoomSize`, `handleFullscreenChromeAction`, `applyTransformStyle` (translate-only).
