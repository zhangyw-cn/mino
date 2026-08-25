# Mino Mermaid Block Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each Markdown Mermaid fence independent Code / Split / Preview modes (default Preview), with Preview-only in-viewer fullscreen overlay and cursor-centered wheel zoom + drag pan.

**Architecture:** Extract pure mode/zoom helpers and a DOM shell builder into `internal/ui/md/mermaid-block.js` (UMD like `toc.js`). Replace the current “swap `pre` for `.mermaid` and run” step in `viewer.js` with the shell; Mermaid still renders into the diagram pane. CSS in `viewer.css` drives mode layout and overlay. No new vendor libraries; no catalog/server/API changes beyond embed + contract markers.

**Tech Stack:** Existing Markdown viewer (marked, DOMPurify, Mermaid); plain DOM + CSS `transform`; Node `node:test` for helpers; Go embed + `server_test` string contracts.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-25-mino-mermaid-block-modes-design.md`
- Modes: **code** | **split** | **preview**; default **preview**; per-block independent
- Code source: **read-only**; no write-back
- Zoom/fullscreen: **Preview only**; Split diagram is static
- Zoom: wheel with **cursor as origin**, drag pan, toolbar ± / reset; scale clamp **0.25–4**
- Fullscreen: **in-viewer fixed overlay** (not Fullscreen API); Esc + close; reset zoom on close; lock `html`/`body` overflow while open
- Narrow Split: stack at **`max-width: 959px`** (source above, diagram below)
- No mode/zoom persistence across iframe reload / SSE
- No new pan-zoom libraries; prefer TDD; commit after each task
- Do not change HTML app preview or SSE reload semantics

---

## File Structure

```text
internal/ui/md/mermaid-block.js           # NEW: helpers + createMermaidBlock + bind chrome
internal/ui/testdata/mermaid_block_test.mjs
internal/ui/mermaid_block_node_test.go    # Go wrapper: node --test
internal/ui/md/viewer.js                  # Use createMermaidBlock instead of bare .mermaid swap
internal/ui/md/viewer.html                # Script tag for mermaid-block.js
internal/ui/md/viewer.css                 # Block chrome, modes, overlay, narrow split
internal/ui/embed.go                      # Embed md/mermaid-block.js
internal/server/server_test.go            # Asset + pipeline contract markers
example/docs/sample.md                    # Optional note / slightly richer diagram (nice-to-have)
```

---

### Task 1: Mode + zoom pure helpers (`mermaid-block.js`)

**Files:**
- Create: `internal/ui/md/mermaid-block.js`
- Create: `internal/ui/testdata/mermaid_block_test.mjs`
- Create: `internal/ui/mermaid_block_node_test.go`
- Modify: `internal/ui/embed.go`

**Interfaces:**
- Consumes: none
- Produces (`globalThis.MinoMDMermaidBlock` / `module.exports`):
  - `SCALE_MIN = 0.25`, `SCALE_MAX = 4`, `DEFAULT_MODE = "preview"`
  - `function normalizeMode(mode: string): "code"|"split"|"preview"` — unknown → `"preview"`
  - `function modeClass(mode: string): string` — `"mode-" + normalizeMode(mode)`
  - `function clampScale(scale: number): number` — clamp to `[SCALE_MIN, SCALE_MAX]`
  - `function zoomAtPoint(state, point): { scale, tx, ty }` where `state = { scale, tx, ty }`, `point = { x, y, factor }` — cursor-centered scale; clamp new scale; if scale unchanged return state unchanged
  - `function applyTransformStyle(state): string` — `"translate(txpx, typx) scale(scale)"` with numeric values

- [ ] **Step 1: Write the failing Node tests**

Create `internal/ui/testdata/mermaid_block_test.mjs`:

```js
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const {
  SCALE_MIN,
  SCALE_MAX,
  DEFAULT_MODE,
  normalizeMode,
  modeClass,
  clampScale,
  zoomAtPoint,
  applyTransformStyle,
} = createRequire(import.meta.url)("../md/mermaid-block.js");

test("normalizeMode defaults unknown to preview", () => {
  assert.equal(normalizeMode("preview"), "preview");
  assert.equal(normalizeMode("code"), "code");
  assert.equal(normalizeMode("split"), "split");
  assert.equal(normalizeMode("nope"), "preview");
  assert.equal(normalizeMode(""), "preview");
  assert.equal(DEFAULT_MODE, "preview");
});

test("modeClass", () => {
  assert.equal(modeClass("code"), "mode-code");
  assert.equal(modeClass("split"), "mode-split");
  assert.equal(modeClass("garbage"), "mode-preview");
});

test("clampScale", () => {
  assert.equal(clampScale(1), 1);
  assert.equal(clampScale(0.01), SCALE_MIN);
  assert.equal(clampScale(99), SCALE_MAX);
});

test("zoomAtPoint scales around cursor", () => {
  const before = { scale: 1, tx: 0, ty: 0 };
  const after = zoomAtPoint(before, { x: 100, y: 50, factor: 2 });
  assert.equal(after.scale, 2);
  // content point (100,50) stays under cursor: tx = x - (x - tx0) * (new/old)
  assert.equal(after.tx, 100 - 100 * 2);
  assert.equal(after.ty, 50 - 50 * 2);
});

test("zoomAtPoint clamps and no-ops at limit", () => {
  const atMax = { scale: SCALE_MAX, tx: 10, ty: 20 };
  const after = zoomAtPoint(atMax, { x: 0, y: 0, factor: 2 });
  assert.deepEqual(after, atMax);
});

test("applyTransformStyle", () => {
  assert.equal(
    applyTransformStyle({ scale: 1.5, tx: 10, ty: -4 }),
    "translate(10px, -4px) scale(1.5)"
  );
});
```

Create `internal/ui/mermaid_block_node_test.go`:

```go
package ui_test

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestMermaidBlockHelpers(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	testFile := filepath.Join(filepath.Dir(file), "testdata", "mermaid_block_test.mjs")
	cmd := exec.Command("node", "--test", testFile)
	cmd.Dir = filepath.Dir(testFile)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("node --test: %v\n%s", err, out)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/ui -run TestMermaidBlockHelpers -count=1`

Expected: FAIL (module missing or exports missing)

- [ ] **Step 3: Minimal `mermaid-block.js` helpers**

Create `internal/ui/md/mermaid-block.js` with UMD wrapper and helpers only (DOM APIs can be stubs / omitted until Task 2):

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MinoMDMermaidBlock = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCALE_MIN = 0.25;
  const SCALE_MAX = 4;
  const DEFAULT_MODE = "preview";
  const MODES = { code: true, split: true, preview: true };

  function normalizeMode(mode) {
    const m = String(mode || "").toLowerCase();
    return MODES[m] ? m : DEFAULT_MODE;
  }

  function modeClass(mode) {
    return "mode-" + normalizeMode(mode);
  }

  function clampScale(scale) {
    const n = Number(scale);
    if (!(n > 0) || n < SCALE_MIN) return SCALE_MIN;
    if (n > SCALE_MAX) return SCALE_MAX;
    return n;
  }

  function zoomAtPoint(state, point) {
    const scale = state.scale;
    const next = clampScale(scale * point.factor);
    if (next === scale) {
      return { scale: state.scale, tx: state.tx, ty: state.ty };
    }
    const ratio = next / scale;
    return {
      scale: next,
      tx: point.x - (point.x - state.tx) * ratio,
      ty: point.y - (point.y - state.ty) * ratio,
    };
  }

  function applyTransformStyle(state) {
    return (
      "translate(" +
      state.tx +
      "px, " +
      state.ty +
      "px) scale(" +
      state.scale +
      ")"
    );
  }

  return {
    SCALE_MIN,
    SCALE_MAX,
    DEFAULT_MODE,
    normalizeMode,
    modeClass,
    clampScale,
    zoomAtPoint,
    applyTransformStyle,
  };
});
```

Update `internal/ui/embed.go` go:embed line to include `md/mermaid-block.js`:

```go
//go:embed index.html app.js style.css fuzzy.js
//go:embed md/viewer.html md/viewer.js md/viewer.css md/preprocess.js md/toc.js md/mermaid-block.js
//go:embed md/vendor
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/ui -run TestMermaidBlockHelpers -count=1`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md/mermaid-block.js internal/ui/testdata/mermaid_block_test.mjs internal/ui/mermaid_block_node_test.go internal/ui/embed.go
git commit -m "feat(ui): add Mermaid block mode and zoom helpers"
```

---

### Task 2: Block shell DOM + mode CSS + viewer integration

**Files:**
- Modify: `internal/ui/md/mermaid-block.js`
- Modify: `internal/ui/testdata/mermaid_block_test.mjs`
- Modify: `internal/ui/md/viewer.js`
- Modify: `internal/ui/md/viewer.html`
- Modify: `internal/ui/md/viewer.css`

**Interfaces:**
- Consumes: Task 1 helpers; `escapeHtml` from `MinoMDPreprocess` (viewer passes escaped text or block escapes itself via optional `escapeHtml` arg)
- Produces:
  - `function createMermaidBlock(sourceText: string, escapeHtml: (s: string) => string): { root: HTMLElement, diagramEl: HTMLElement, setMode(mode: string): void, getMode(): string, setRenderFailed(): void, resetZoom(): void, getViewport(): HTMLElement, applyZoomState(state): void, getZoomState(): {scale,tx,ty} }`
  - Root structure:
    ```html
    <figure class="mermaid-block mode-preview" data-mode="preview">
      <div class="mermaid-toolbar" role="toolbar" aria-label="Mermaid view">
        <div class="mermaid-mode-group">
          <button type="button" data-mode="code">Code</button>
          <button type="button" data-mode="split">Split</button>
          <button type="button" data-mode="preview" aria-pressed="true">Preview</button>
        </div>
        <div class="mermaid-preview-actions" hidden>
          <button type="button" data-action="zoom-out" aria-label="Zoom out">−</button>
          <button type="button" data-action="zoom-in" aria-label="Zoom in">+</button>
          <button type="button" data-action="zoom-reset" aria-label="Reset zoom">Reset</button>
          <button type="button" data-action="fullscreen" aria-label="Fullscreen">Fullscreen</button>
        </div>
      </div>
      <div class="mermaid-panes">
        <pre class="mermaid-source"><code>…escaped…</code></pre>
        <div class="mermaid-viewport">
          <div class="mermaid-diagram mermaid">…source for mermaid.run…</div>
        </div>
      </div>
    </figure>
    ```
  - `setMode`: sets `data-mode`, swaps `mode-*` class via `modeClass`, updates `aria-pressed` on mode buttons, shows `.mermaid-preview-actions` only when mode is `preview` **and** not failed
  - `setRenderFailed`: adds `is-failed` on root, puts `Diagram render failed` text in diagram pane (class `render-error`), hides preview actions permanently for this block
  - `resetZoom` / `applyZoomState`: write transform on `.mermaid-viewport` inner wrapper or the diagram host — use a dedicated `.mermaid-zoom-target` wrapping `.mermaid-diagram` so overflow clips on `.mermaid-viewport`

- [ ] **Step 1: Extend Node tests for createMermaidBlock (jsdom-free)**

Prefer testing without a browser: if `document` is unavailable, skip DOM tests. Add a tiny fake DOM is overkill — instead export a pure `previewActionsVisible(mode, failed)` helper and test that; keep DOM wiring verified manually + contract markers.

Add to `mermaid_block_test.mjs`:

```js
const { previewActionsVisible } = createRequire(import.meta.url)("../md/mermaid-block.js");

test("previewActionsVisible", () => {
  assert.equal(previewActionsVisible("preview", false), true);
  assert.equal(previewActionsVisible("code", false), false);
  assert.equal(previewActionsVisible("split", false), false);
  assert.equal(previewActionsVisible("preview", true), false);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `go test ./internal/ui -run TestMermaidBlockHelpers -count=1`

Expected: FAIL (`previewActionsVisible` missing)

- [ ] **Step 3: Implement `previewActionsVisible` + `createMermaidBlock`**

Add to the factory return:

```js
function previewActionsVisible(mode, failed) {
  return normalizeMode(mode) === "preview" && !failed;
}

function createMermaidBlock(sourceText, escapeHtml) {
  const source = String(sourceText || "");
  const esc = typeof escapeHtml === "function" ? escapeHtml : (t) => t;

  const root = document.createElement("figure");
  root.className = "mermaid-block " + modeClass(DEFAULT_MODE);
  root.dataset.mode = DEFAULT_MODE;

  root.innerHTML =
    '<div class="mermaid-toolbar" role="toolbar" aria-label="Mermaid view">' +
    '<div class="mermaid-mode-group">' +
    '<button type="button" data-mode="code">Code</button>' +
    '<button type="button" data-mode="split">Split</button>' +
    '<button type="button" data-mode="preview" aria-pressed="true">Preview</button>' +
    "</div>" +
    '<div class="mermaid-preview-actions" hidden>' +
    '<button type="button" data-action="zoom-out" aria-label="Zoom out">−</button>' +
    '<button type="button" data-action="zoom-in" aria-label="Zoom in">+</button>' +
    '<button type="button" data-action="zoom-reset" aria-label="Reset zoom">Reset</button>' +
    '<button type="button" data-action="fullscreen" aria-label="Fullscreen">Fullscreen</button>' +
    "</div></div>" +
    '<div class="mermaid-panes">' +
    '<pre class="mermaid-source"><code></code></pre>' +
    '<div class="mermaid-viewport"><div class="mermaid-zoom-target">' +
    '<div class="mermaid-diagram mermaid"></div>' +
    "</div></div></div>";

  root.querySelector(".mermaid-source code").textContent = source;
  const diagramEl = root.querySelector(".mermaid-diagram");
  diagramEl.textContent = source;

  const actions = root.querySelector(".mermaid-preview-actions");
  const zoomTarget = root.querySelector(".mermaid-zoom-target");
  let mode = DEFAULT_MODE;
  let failed = false;
  let zoom = { scale: 1, tx: 0, ty: 0 };

  function syncChrome() {
    root.dataset.mode = mode;
    root.classList.remove("mode-code", "mode-split", "mode-preview");
    root.classList.add(modeClass(mode));
    root.querySelectorAll(".mermaid-mode-group [data-mode]").forEach((btn) => {
      btn.setAttribute(
        "aria-pressed",
        btn.getAttribute("data-mode") === mode ? "true" : "false"
      );
    });
    actions.hidden = !previewActionsVisible(mode, failed);
  }

  function setMode(next) {
    mode = normalizeMode(next);
    if (mode !== "preview") {
      zoom = { scale: 1, tx: 0, ty: 0 };
      zoomTarget.style.transform = applyTransformStyle(zoom);
    }
    syncChrome();
  }

  function setRenderFailed() {
    failed = true;
    root.classList.add("is-failed");
    diagramEl.className = "mermaid-diagram render-error";
    diagramEl.textContent = "Diagram render failed";
    syncChrome();
  }

  function applyZoomState(state) {
    zoom = {
      scale: clampScale(state.scale),
      tx: state.tx,
      ty: state.ty,
    };
    zoomTarget.style.transform = applyTransformStyle(zoom);
  }

  function resetZoom() {
    applyZoomState({ scale: 1, tx: 0, ty: 0 });
  }

  root.querySelector(".mermaid-mode-group").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-mode]");
    if (!btn || !root.contains(btn)) return;
    setMode(btn.getAttribute("data-mode"));
  });

  syncChrome();

  return {
    root,
    diagramEl,
    setMode,
    getMode: () => mode,
    setRenderFailed,
    resetZoom,
    getViewport: () => root.querySelector(".mermaid-viewport"),
    getZoomTarget: () => zoomTarget,
    applyZoomState,
    getZoomState: () => ({ scale: zoom.scale, tx: zoom.tx, ty: zoom.ty }),
    isFailed: () => failed,
  };
}

return {
  SCALE_MIN,
  SCALE_MAX,
  DEFAULT_MODE,
  normalizeMode,
  modeClass,
  clampScale,
  zoomAtPoint,
  applyTransformStyle,
  previewActionsVisible,
  createMermaidBlock,
};
```

Note: do not put unescaped `source` into `innerHTML`; use `textContent` as above. The `esc` parameter is reserved if you later build HTML strings — keep the signature for viewer convenience even if unused.

- [ ] **Step 4: CSS for modes**

Append to `internal/ui/md/viewer.css`:

```css
.mermaid-block {
  margin: 1em 0;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  background: #252526;
  overflow: hidden;
}

.mermaid-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid #3c3c3c;
  background: #2d2d2d;
}

.mermaid-mode-group,
.mermaid-preview-actions {
  display: flex;
  gap: 4px;
}

.mermaid-toolbar button {
  background: transparent;
  border: 1px solid #3c3c3c;
  color: #cccccc;
  border-radius: 4px;
  font-size: 12px;
  padding: 2px 8px;
  cursor: pointer;
}

.mermaid-toolbar button[aria-pressed="true"] {
  border-color: #3794ff;
  color: #e8e8e8;
}

.mermaid-panes {
  display: grid;
  grid-template-columns: 1fr;
  min-height: 120px;
}

.mermaid-block.mode-code .mermaid-viewport {
  display: none;
}

.mermaid-block.mode-preview .mermaid-source {
  display: none;
}

.mermaid-block.mode-split .mermaid-panes {
  grid-template-columns: 1fr 1fr;
}

.mermaid-source {
  margin: 0;
  padding: 12px;
  overflow: auto;
  max-height: 480px;
  font-family: "Cascadia Code", ui-monospace, monospace;
  font-size: 13px;
  background: #1e1e1e;
}

.mermaid-viewport {
  overflow: hidden;
  position: relative;
  min-height: 160px;
  background: #1e1e1e;
}

.mermaid-zoom-target {
  transform-origin: 0 0;
  will-change: transform;
}

.mermaid-diagram {
  overflow: visible;
  margin: 0;
  padding: 12px;
  text-align: center;
}

.mermaid-block.mode-preview .mermaid-viewport {
  cursor: grab;
}

.mermaid-block.mode-preview .mermaid-viewport.is-panning {
  cursor: grabbing;
}

@media (max-width: 959px) {
  .mermaid-block.mode-split .mermaid-panes {
    grid-template-columns: 1fr;
  }
}
```

Remove or keep the old standalone `.mermaid { … }` rule — diagram nodes now live inside `.mermaid-diagram`; keep a minimal rule if Mermaid injects SVG margins oddly:

```css
.mermaid-diagram svg {
  max-width: 100%;
  height: auto;
}
```

(When zooming, `max-width: 100%` can fight transform; apply `max-width: none` under `.mode-preview .mermaid-diagram svg`.)

```css
.mermaid-block.mode-preview .mermaid-diagram svg {
  max-width: none;
}
```

- [ ] **Step 5: Wire `viewer.html` + `viewer.js`**

In `viewer.html`, add before `viewer.js`:

```html
<script src="/md/mermaid-block.js"></script>
```

In `viewer.js`, at top with other globals:

```js
const { createMermaidBlock } = globalThis.MinoMDMermaidBlock;
```

Replace the mermaid loop (current `pre.replaceWith(div)` block) with:

```js
const mermaidBlocks = content.querySelectorAll("pre code.language-mermaid");
if (mermaidBlocks.length) {
  mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
  const instances = [];
  for (const block of mermaidBlocks) {
    const pre = block.parentElement;
    const inst = createMermaidBlock(block.textContent, escapeHtml);
    pre.replaceWith(inst.root);
    instances.push(inst);
  }
  for (const inst of instances) {
    try {
      await mermaid.run({ nodes: [inst.diagramEl] });
    } catch (_) {
      inst.setRenderFailed();
    }
  }
}
```

Keep `buildToc(content)` after this.

- [ ] **Step 6: Run helper tests + server smoke**

Run:

```bash
go test ./internal/ui -run TestMermaidBlockHelpers -count=1
go test ./internal/server -run 'TestMarkdownAppsAndRaw|TestUIAssets' -count=1
```

Expected: helpers PASS. Asset test may fail until `/md/mermaid-block.js` is asserted — if `TestUIAssets` lists explicit paths, add `/md/mermaid-block.js` in Task 5; for now ensure embed serves it:

```bash
go run ./cmd/mino ./example
# open any .md with mermaid; confirm toolbar + three modes
```

- [ ] **Step 7: Commit**

```bash
git add internal/ui/md/mermaid-block.js internal/ui/testdata/mermaid_block_test.mjs internal/ui/md/viewer.js internal/ui/md/viewer.html internal/ui/md/viewer.css
git commit -m "feat(ui): wrap Mermaid fences in code/split/preview shell"
```

---

### Task 3: Preview pan / zoom interactions

**Files:**
- Modify: `internal/ui/md/mermaid-block.js`
- Modify: `internal/ui/testdata/mermaid_block_test.mjs` (optional: wheel factor helper)

**Interfaces:**
- Consumes: `createMermaidBlock` return value; `zoomAtPoint`, `clampScale`
- Produces:
  - `function bindPreviewInteractions(inst): void` — attach once to `inst.root`
  - Wheel on `.mermaid-viewport` when `getMode()==="preview"` && `!isFailed()`: `preventDefault`, `zoomAtPoint` with `factor = event.deltaY < 0 ? 1.1 : 1/1.1`, point = offset relative to viewport
  - Pointer drag: on `pointerdown` (primary button) start pan; `pointermove` adjusts `tx/ty` by movement; `pointerup`/`pointercancel` end; set `is-panning` class while dragging
  - Toolbar: `zoom-in` factor 1.1 about viewport center; `zoom-out` 1/1.1; `zoom-reset` → `resetZoom()`
  - Ignore wheel/drag when mode ≠ preview or failed
  - Call `bindPreviewInteractions(inst)` from `createMermaidBlock` at end (or from viewer after create — prefer inside `createMermaidBlock` so viewer stays thin)

- [ ] **Step 1: Add wheel-factor helper test**

```js
const { wheelZoomFactor } = createRequire(import.meta.url)("../md/mermaid-block.js");

test("wheelZoomFactor", () => {
  assert.equal(wheelZoomFactor(-100), 1.1);
  assert.equal(wheelZoomFactor(100), 1 / 1.1);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `go test ./internal/ui -run TestMermaidBlockHelpers -count=1`

- [ ] **Step 3: Implement `wheelZoomFactor` + `bindPreviewInteractions`**

```js
function wheelZoomFactor(deltaY) {
  return deltaY < 0 ? 1.1 : 1 / 1.1;
}

function bindPreviewInteractions(inst) {
  const viewport = inst.getViewport();
  const root = inst.root;

  function canZoom() {
    return inst.getMode() === "preview" && !inst.isFailed();
  }

  function zoomBy(factor, clientX, clientY) {
    if (!canZoom()) return;
    const rect = viewport.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const next = zoomAtPoint(inst.getZoomState(), { x, y, factor });
    inst.applyZoomState(next);
  }

  viewport.addEventListener(
    "wheel",
    (ev) => {
      if (!canZoom()) return;
      ev.preventDefault();
      zoomBy(wheelZoomFactor(ev.deltaY), ev.clientX, ev.clientY);
    },
    { passive: false }
  );

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  viewport.addEventListener("pointerdown", (ev) => {
    if (!canZoom() || ev.button !== 0) return;
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
    viewport.classList.add("is-panning");
    viewport.setPointerCapture(ev.pointerId);
  });

  viewport.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    const z = inst.getZoomState();
    inst.applyZoomState({ scale: z.scale, tx: z.tx + dx, ty: z.ty + dy });
  });

  function endDrag(ev) {
    if (!dragging) return;
    dragging = false;
    viewport.classList.remove("is-panning");
    try {
      viewport.releasePointerCapture(ev.pointerId);
    } catch (_) {}
  }

  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  root.querySelector(".mermaid-preview-actions").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "zoom-reset") {
      inst.resetZoom();
      return;
    }
    if (action === "zoom-in" || action === "zoom-out") {
      const rect = viewport.getBoundingClientRect();
      const factor = action === "zoom-in" ? 1.1 : 1 / 1.1;
      zoomBy(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  });
}
```

Call `bindPreviewInteractions` at end of `createMermaidBlock` before return. Export `wheelZoomFactor` and `bindPreviewInteractions`.

Leave `data-action="fullscreen"` unbound until Task 4 (click no-ops).

- [ ] **Step 4: Re-run tests**

Run: `go test ./internal/ui -run TestMermaidBlockHelpers -count=1`

Expected: PASS

Manual: Preview wheel zooms at cursor; drag pans; ±/Reset work; Code/Split ignore wheel for zoom (page may still scroll — wheel handler should only `preventDefault` when `canZoom()`).

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md/mermaid-block.js internal/ui/testdata/mermaid_block_test.mjs
git commit -m "feat(ui): add Mermaid preview pan and zoom"
```

---

### Task 4: In-viewer fullscreen overlay

**Files:**
- Modify: `internal/ui/md/mermaid-block.js`
- Modify: `internal/ui/md/viewer.css`
- Modify: `internal/ui/testdata/mermaid_block_test.mjs` (optional: document lock helpers)

**Interfaces:**
- Consumes: block instance; single shared overlay node in `document.body`
- Produces:
  - `function openMermaidFullscreen(inst): void`
  - `function closeMermaidFullscreen(): void`
  - Overlay markup:
    ```html
    <div class="mermaid-fs-overlay" hidden>
      <div class="mermaid-fs-chrome">
        <button type="button" data-action="fs-close" aria-label="Close">Close</button>
      </div>
      <div class="mermaid-fs-stage">
        <!-- moves/clones zoom target content: prefer move viewport's zoom-target into stage, restore on close -->
      </div>
    </div>
    ```
  - Preferred approach: **move** `.mermaid-zoom-target` into the overlay stage on open; on close move it back into the original viewport and `resetZoom()`
  - Lock: set `document.documentElement.style.overflow = "hidden"` and `document.body.style.overflow = "hidden"` on open; restore previous values on close
  - Esc: `keydown` listener (AbortController) closes overlay
  - Backdrop click on overlay (not stage) closes
  - While open, wheel/drag still work on the stage viewport wrapper — re-bind or keep the same viewport element moved into overlay. Simplest: move entire `.mermaid-viewport` into stage so existing listeners stay attached
  - Wire toolbar `data-action="fullscreen"` in `bindPreviewInteractions`
  - Only one overlay globally; opening another block closes the previous first

- [ ] **Step 1: Add lock-style helper tests**

```js
const { withOverflowLocked } = createRequire(import.meta.url)("../md/mermaid-block.js");

test("withOverflowLocked restores previous overflow", () => {
  const html = { style: { overflow: "" } };
  const body = { style: { overflow: "auto" } };
  const unlock = withOverflowLocked(html, body);
  assert.equal(html.style.overflow, "hidden");
  assert.equal(body.style.overflow, "hidden");
  unlock();
  assert.equal(html.style.overflow, "");
  assert.equal(body.style.overflow, "auto");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `go test ./internal/ui -run TestMermaidBlockHelpers -count=1`

- [ ] **Step 3: Implement overlay + lock helper**

```js
function withOverflowLocked(htmlEl, bodyEl) {
  const prevHtml = htmlEl.style.overflow;
  const prevBody = bodyEl.style.overflow;
  htmlEl.style.overflow = "hidden";
  bodyEl.style.overflow = "hidden";
  return function unlock() {
    htmlEl.style.overflow = prevHtml;
    bodyEl.style.overflow = prevBody;
  };
}

let fsState = null; // { inst, unlock, onKey, placeholder }

function ensureOverlay() {
  let el = document.querySelector(".mermaid-fs-overlay");
  if (el) return el;
  el = document.createElement("div");
  el.className = "mermaid-fs-overlay";
  el.hidden = true;
  el.innerHTML =
    '<div class="mermaid-fs-chrome">' +
    '<button type="button" data-action="fs-close" aria-label="Close">Close</button>' +
    "</div>" +
    '<div class="mermaid-fs-stage"></div>';
  document.body.appendChild(el);
  el.addEventListener("click", (ev) => {
    if (ev.target === el) closeMermaidFullscreen();
  });
  el.querySelector('[data-action="fs-close"]').addEventListener("click", () => {
    closeMermaidFullscreen();
  });
  return el;
}

function closeMermaidFullscreen() {
  if (!fsState) return;
  const { inst, unlock, onKey, placeholder } = fsState;
  document.removeEventListener("keydown", onKey);
  unlock();
  const overlay = ensureOverlay();
  const stage = overlay.querySelector(".mermaid-fs-stage");
  const viewport = stage.querySelector(".mermaid-viewport");
  if (viewport && placeholder && placeholder.parentNode) {
    placeholder.replaceWith(viewport);
  }
  overlay.hidden = true;
  inst.resetZoom();
  fsState = null;
}

function openMermaidFullscreen(inst) {
  if (inst.isFailed() || inst.getMode() !== "preview") return;
  if (fsState) closeMermaidFullscreen();
  const overlay = ensureOverlay();
  const stage = overlay.querySelector(".mermaid-fs-stage");
  const viewport = inst.getViewport();
  const placeholder = document.createElement("div");
  placeholder.className = "mermaid-fs-placeholder";
  viewport.replaceWith(placeholder);
  stage.replaceChildren(viewport);
  const unlock = withOverflowLocked(document.documentElement, document.body);
  const onKey = (ev) => {
    if (ev.key === "Escape") closeMermaidFullscreen();
  };
  document.addEventListener("keydown", onKey);
  overlay.hidden = false;
  fsState = { inst, unlock, onKey, placeholder };
}
```

In `bindPreviewInteractions` toolbar handler, add:

```js
if (action === "fullscreen") {
  openMermaidFullscreen(inst);
  return;
}
```

Export `withOverflowLocked`, `openMermaidFullscreen`, `closeMermaidFullscreen`.

- [ ] **Step 4: Overlay CSS**

```css
.mermaid-fs-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  flex-direction: column;
  padding: 12px;
  box-sizing: border-box;
}

.mermaid-fs-overlay[hidden] {
  display: none !important;
}

.mermaid-fs-chrome {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.mermaid-fs-chrome button {
  background: #2d2d2d;
  border: 1px solid #3c3c3c;
  color: #e8e8e8;
  border-radius: 4px;
  padding: 4px 12px;
  cursor: pointer;
}

.mermaid-fs-stage {
  flex: 1 1 auto;
  min-height: 0;
  background: #1e1e1e;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  overflow: hidden;
}

.mermaid-fs-stage .mermaid-viewport {
  width: 100%;
  height: 100%;
  min-height: 100%;
}

.mermaid-fs-placeholder {
  display: none;
}
```

- [ ] **Step 5: Verify**

Run: `go test ./internal/ui -run TestMermaidBlockHelpers -count=1`

Manual checklist:
- Fullscreen opens overlay; Esc / Close / backdrop dismiss
- Zoom/pan work inside overlay
- Close resets zoom
- Failed diagram has no Fullscreen button
- Background page does not scroll while open

- [ ] **Step 6: Commit**

```bash
git add internal/ui/md/mermaid-block.js internal/ui/md/viewer.css internal/ui/testdata/mermaid_block_test.mjs
git commit -m "feat(ui): add Mermaid in-viewer fullscreen overlay"
```

---

### Task 5: Contract markers + light docs

**Files:**
- Modify: `internal/server/server_test.go`
- Modify: `example/docs/sample.md` (optional short note under Mermaid)
- Modify: `README.md` only if it already documents Mermaid — one line on modes; skip if absent

**Interfaces:**
- Consumes: shipped `/md/mermaid-block.js` and viewer wiring
- Produces: CI/contract coverage for new asset + API markers

- [ ] **Step 1: Extend `TestUIAssets` path list**

Add `"/md/mermaid-block.js"` next to `"/md/toc.js"`.

- [ ] **Step 2: Extend `TestViewerPipelineMarkers`**

Add markers that must appear in `viewer.js` (and/or ensure mermaid-block is loaded — markers in viewer.js):

```go
"MinoMDMermaidBlock",
"createMermaidBlock",
```

Also assert viewer HTML includes the script in `TestMarkdownAppsAndRaw`:

```go
if !strings.Contains(html, "/md/mermaid-block.js") {
  t.Fatalf("missing mermaid-block.js: %s", body)
}
```

- [ ] **Step 3: Run contract tests**

Run:

```bash
go test ./internal/server -run 'TestUIAssets|TestViewerPipelineMarkers|TestMarkdownAppsAndRaw' -count=1
go test ./internal/ui -run 'TestMermaidBlockHelpers|TestTocHelpers|TestPreprocessMath' -count=1
```

Expected: PASS

- [ ] **Step 4: Optional sample note**

In `example/docs/sample.md` under `## Mermaid`, add:

```markdown
Each diagram has Code / Split / Preview controls (default Preview). In Preview, use the toolbar or wheel+drag to zoom, and Fullscreen for a larger overlay.
```

- [ ] **Step 5: Final manual smoke**

```bash
go run ./cmd/mino ./example
```

Open `docs/sample.md`:
1. Default Preview for Mermaid block  
2. Switch Code / Split / Preview independently  
3. Narrow width → Split stacks  
4. Preview: wheel zoom at cursor, drag pan, toolbar ±/Reset  
5. Fullscreen overlay + Esc; zoom resets on close  
6. Invalid mermaid still shows error; Code still readable  
7. Save file → SSE reload → back to Preview  

- [ ] **Step 6: Commit**

```bash
git add internal/server/server_test.go example/docs/sample.md
git commit -m "test(ui): contract markers for Mermaid block modes"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Per-block Code / Split / Preview, default Preview | Task 2 |
| Read-only source | Task 2 (`textContent`, no editor) |
| Preview-only zoom (cursor wheel + drag + toolbar), clamp 0.25–4 | Task 1 + 3 |
| Leave Preview resets transform | Task 2 `setMode` |
| In-viewer overlay fullscreen, Esc, scroll lock, reset zoom on close | Task 4 |
| Narrow Split @ 959px | Task 2 CSS |
| Render failure → placeholder; no zoom/fullscreen; Code works | Task 2 `setRenderFailed` + `previewActionsVisible` |
| No new vendors; no server/catalog changes | All tasks |
| Helper tests + manual checklist | Tasks 1–5 |
| No mode persistence | Implicit (iframe reload) |

No TBD placeholders. Names consistent: `createMermaidBlock`, `zoomAtPoint`, `openMermaidFullscreen`, `MinoMDMermaidBlock`.
