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
  parseViewBox,
  userBoxFromSvgAttrs,
  naturalScale,
  fitScale,
  cameraScaleRange,
  openingCamera,
  cameraViewBox,
  viewBoxAttr,
  zoomCameraAtNorm,
  panCamera,
  resizeCamera,
  pointerToNorm,
  canStartCamera,
  captureSvgPresentation,
  restoreSvgAttrs,
  applyCamera,
  measureStage,
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

test("readSvgBaseSize accepts px-suffixed attributes", () => {
  const svg = {
    getAttribute(name) {
      if (name === "width") return "200px";
      if (name === "height") return "100px";
      return null;
    },
  };
  assert.deepEqual(readSvgBaseSize(svg), { width: 200, height: 100 });
});

test("readSvgBaseSize falls back to viewBox when width is percent", () => {
  const svg = {
    getAttribute(name) {
      if (name === "width") return "100%";
      if (name === "height") return null;
      if (name === "viewBox") return "0 0 320 180";
      return null;
    },
  };
  assert.deepEqual(readSvgBaseSize(svg), { width: 320, height: 180 });
});

test("readSvgBaseSize falls back to getBBox", () => {
  const svg = {
    getAttribute() {
      return null;
    },
    getBBox() {
      return { width: 240, height: 120, x: 0, y: 0 };
    },
  };
  assert.deepEqual(readSvgBaseSize(svg), { width: 240, height: 120 });
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

test("applySvgZoomSize sets attributes and clears max-width", () => {
  const attrs = {};
  const style = { maxWidth: "400px", maxHeight: "" };
  const svg = {
    style,
    setAttribute(name, value) {
      attrs[name] = value;
    },
  };
  applySvgZoomSize(svg, { width: 200, height: 100 }, 2);
  assert.equal(attrs.width, "400");
  assert.equal(attrs.height, "200");
  assert.equal(style.maxWidth, "none");
  assert.equal(style.maxHeight, "none");
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
