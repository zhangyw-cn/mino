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
  previewActionsVisible,
  wheelZoomFactor,
  withOverflowLocked,
  restoreFullscreenViewport,
  handleFullscreenChromeAction,
  readSvgBaseSize,
  svgSizeForScale,
  applySvgZoomSize,
} = createRequire(import.meta.url)("../md/mermaid-block.js");

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

test("clampScale", () => {
  assert.equal(SCALE_MIN, 0.25);
  assert.equal(SCALE_MAX, 4);
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

test("zoomAtPoint with existing pan keeps cursor content point", () => {
  const before = { scale: 2, tx: 10, ty: -5 };
  const after = zoomAtPoint(before, { x: 40, y: 20, factor: 2 });
  assert.equal(after.scale, 4);
  assert.equal(after.tx, 40 - (40 - 10) * 2);
  assert.equal(after.ty, 20 - (20 - -5) * 2);
});

test("zoomAtPoint clamps and no-ops at limit", () => {
  const atMax = { scale: SCALE_MAX, tx: 10, ty: 20 };
  const afterMax = zoomAtPoint(atMax, { x: 0, y: 0, factor: 2 });
  assert.deepEqual(afterMax, atMax);
  const atMin = { scale: SCALE_MIN, tx: 3, ty: 4 };
  const afterMin = zoomAtPoint(atMin, { x: 10, y: 10, factor: 0.5 });
  assert.deepEqual(afterMin, atMin);
});

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

test("previewActionsVisible", () => {
  assert.equal(previewActionsVisible("preview", false), true);
  assert.equal(previewActionsVisible("code", false), false);
  assert.equal(previewActionsVisible("split", false), false);
  assert.equal(previewActionsVisible("preview", true), false);
});

test("wheelZoomFactor", () => {
  assert.equal(wheelZoomFactor(-100), 1.1);
  assert.equal(wheelZoomFactor(100), 1 / 1.1);
  assert.equal(wheelZoomFactor(0), 1);
});

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

test("restoreFullscreenViewport replaces placeholder when attached", () => {
  const calls = [];
  const viewport = { id: "vp" };
  const placeholder = {
    parentNode: {},
    replaceWith(node) {
      calls.push(["replace", node]);
    },
  };
  assert.equal(restoreFullscreenViewport(placeholder, viewport, null), "replaced");
  assert.deepEqual(calls, [["replace", viewport]]);
});

test("restoreFullscreenViewport appends to panes when placeholder detached", () => {
  const appended = [];
  const viewport = { id: "vp" };
  const placeholder = { parentNode: null };
  const panes = {
    appendChild(node) {
      appended.push(node);
    },
  };
  assert.equal(restoreFullscreenViewport(placeholder, viewport, panes), "appended");
  assert.deepEqual(appended, [viewport]);
});

test("restoreFullscreenViewport lost without viewport or parent", () => {
  assert.equal(restoreFullscreenViewport(null, null, null), "lost");
  assert.equal(
    restoreFullscreenViewport({ parentNode: null }, { id: "vp" }, null),
    "lost"
  );
});

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
