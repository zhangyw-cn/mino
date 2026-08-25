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

test("previewActionsVisible", () => {
  assert.equal(previewActionsVisible("preview", false), true);
  assert.equal(previewActionsVisible("code", false), false);
  assert.equal(previewActionsVisible("split", false), false);
  assert.equal(previewActionsVisible("preview", true), false);
});
