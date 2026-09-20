import { describe, expect, it } from "vitest";
import {
  SCALE_MAX,
  DEFAULT_MODE,
  normalizeMode,
  modeClass,
  previewActionsVisible,
  previewActionsHtml,
  cameraGesturesAllowed,
  wheelZoomFactor,
  withOverflowLocked,
  restoreFullscreenViewport,
  handleFullscreenChromeAction,
  readSvgBaseSize,
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
  applyFullscreenResize,
  pointerToNorm,
  canStartCamera,
  captureSvgPresentation,
  restoreSvgAttrs,
  applyCamera,
  measureStage,
  planStartCamera,
} from "./mermaid-block";

describe("normalizeMode", () => {
  it("defaults unknown to preview", () => {
    expect(normalizeMode("preview")).toBe("preview");
    expect(normalizeMode("code")).toBe("code");
    expect(normalizeMode("split")).toBe("preview");
    expect(normalizeMode("nope")).toBe("preview");
    expect(normalizeMode("")).toBe("preview");
    expect(DEFAULT_MODE).toBe("preview");
  });
});

describe("modeClass", () => {
  it("maps mode to CSS class", () => {
    expect(modeClass("code")).toBe("mode-code");
    expect(modeClass("split")).toBe("mode-preview");
    expect(modeClass("garbage")).toBe("mode-preview");
  });
});

describe("SCALE_MAX", () => {
  it("is 4x natural", () => {
    expect(SCALE_MAX).toBe(4);
  });
});

describe("readSvgBaseSize", () => {
  it("prefers positive attributes", () => {
    const svg = {
      getAttribute(name: string) {
        if (name === "width") return "200";
        if (name === "height") return "100";
        return null;
      },
    };
    expect(readSvgBaseSize(svg)).toEqual({ width: 200, height: 100 });
  });

  it("accepts px-suffixed attributes", () => {
    const svg = {
      getAttribute(name: string) {
        if (name === "width") return "200px";
        if (name === "height") return "100px";
        return null;
      },
    };
    expect(readSvgBaseSize(svg)).toEqual({ width: 200, height: 100 });
  });

  it("falls back to viewBox when width is percent", () => {
    const svg = {
      getAttribute(name: string) {
        if (name === "width") return "100%";
        if (name === "height") return null;
        if (name === "viewBox") return "0 0 320 180";
        return null;
      },
    };
    expect(readSvgBaseSize(svg)).toEqual({ width: 320, height: 180 });
  });

  it("falls back to getBBox", () => {
    const svg = {
      getAttribute() {
        return null;
      },
      getBBox() {
        return { width: 240, height: 120, x: 0, y: 0 };
      },
    };
    expect(readSvgBaseSize(svg)).toEqual({ width: 240, height: 120 });
  });

  it("returns null when attributes missing or invalid", () => {
    expect(readSvgBaseSize(null)).toBe(null);
    expect(
      readSvgBaseSize({
        getAttribute() {
          return null;
        },
      })
    ).toBe(null);
    expect(
      readSvgBaseSize({
        getAttribute(name: string) {
          return name === "width" ? "0" : "10";
        },
      })
    ).toBe(null);
    expect(
      readSvgBaseSize({
        getAttribute(name: string) {
          return name === "viewBox" ? "0 0 0 10" : null;
        },
      })
    ).toBe(null);
  });
});

describe("previewActionsVisible", () => {
  it("shows actions only in successful preview mode", () => {
    expect(previewActionsVisible("preview", false)).toBe(true);
    expect(previewActionsVisible("code", false)).toBe(false);
    expect(previewActionsVisible("split", false)).toBe(false);
    expect(previewActionsVisible("preview", true)).toBe(false);
  });
});

describe("previewActionsHtml", () => {
  it("is fullscreen only", () => {
    const html = previewActionsHtml();
    expect(html).toMatch(/data-action="fullscreen"/);
    expect(html).not.toMatch(/data-action="zoom-in"/);
    expect(html).not.toMatch(/data-action="zoom-out"/);
    expect(html).not.toMatch(/data-action="zoom-reset"/);
  });
});

describe("cameraGesturesAllowed", () => {
  it("only in fullscreen preview with a camera", () => {
    expect(cameraGesturesAllowed("preview", false, true, true)).toBe(true);
    expect(cameraGesturesAllowed("preview", false, false, true)).toBe(false);
    expect(cameraGesturesAllowed("preview", false, true, false)).toBe(false);
    expect(cameraGesturesAllowed("code", false, true, true)).toBe(false);
    expect(cameraGesturesAllowed("preview", true, true, true)).toBe(false);
  });
});

describe("wheelZoomFactor", () => {
  it("maps wheel delta to zoom factor", () => {
    expect(wheelZoomFactor(-100)).toBe(1.1);
    expect(wheelZoomFactor(100)).toBe(1 / 1.1);
    expect(wheelZoomFactor(0)).toBe(1);
  });
});

describe("withOverflowLocked", () => {
  it("restores previous overflow", () => {
    const html = { style: { overflow: "" } };
    const body = { style: { overflow: "auto" } };
    const unlock = withOverflowLocked(html, body);
    expect(html.style.overflow).toBe("hidden");
    expect(body.style.overflow).toBe("hidden");
    unlock();
    expect(html.style.overflow).toBe("");
    expect(body.style.overflow).toBe("auto");
  });
});

describe("restoreFullscreenViewport", () => {
  it("replaces placeholder when attached", () => {
    const calls: unknown[] = [];
    const viewport = { id: "vp" };
    const placeholder = {
      parentNode: {} as ParentNode,
      replaceWith(node: Node) {
        calls.push(["replace", node]);
      },
    };
    expect(restoreFullscreenViewport(placeholder, viewport as unknown as Node, null)).toBe(
      "replaced"
    );
    expect(calls).toEqual([["replace", viewport]]);
  });

  it("appends to panes when placeholder detached", () => {
    const appended: unknown[] = [];
    const viewport = { id: "vp" };
    const placeholder = { parentNode: null, replaceWith() {} };
    const panes = {
      appendChild(node: Node) {
        appended.push(node);
      },
    };
    expect(restoreFullscreenViewport(placeholder, viewport as unknown as Node, panes)).toBe(
      "appended"
    );
    expect(appended).toEqual([viewport]);
  });

  it("lost without viewport or parent", () => {
    expect(restoreFullscreenViewport(null, null, null)).toBe("lost");
    expect(
      restoreFullscreenViewport(
        { parentNode: null, replaceWith() {} },
        { id: "vp" } as unknown as Node,
        null
      )
    ).toBe("lost");
  });
});

describe("handleFullscreenChromeAction", () => {
  it("reset does not close", () => {
    const calls: string[] = [];
    const api = {
      resetZoom() {
        calls.push("reset");
      },
      close() {
        calls.push("close");
      },
    };
    expect(handleFullscreenChromeAction("fs-reset", api)).toBe("reset");
    expect(calls).toEqual(["reset"]);
    expect(handleFullscreenChromeAction("fs-close", api)).toBe("close");
    expect(calls).toEqual(["reset", "close"]);
    expect(handleFullscreenChromeAction("other", api)).toBe(null);
    expect(calls).toEqual(["reset", "close"]);
  });
});

describe("parseViewBox", () => {
  it("reads space or comma viewBox", () => {
    expect(parseViewBox("0 0 800 600")).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(parseViewBox("10,20,100,50")).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(parseViewBox("")).toBe(null);
    expect(parseViewBox("0 0 0 10")).toBe(null);
  });
});

describe("userBoxFromSvgAttrs", () => {
  it("prefers viewBox then base", () => {
    expect(userBoxFromSvgAttrs("5 6 40 20", { width: 1, height: 1 })).toEqual({
      x: 5,
      y: 6,
      w: 40,
      h: 20,
    });
    expect(userBoxFromSvgAttrs(null, { width: 80, height: 40 })).toEqual({
      x: 0,
      y: 0,
      w: 80,
      h: 40,
    });
    expect(userBoxFromSvgAttrs(null, null)).toBe(null);
  });
});

describe("naturalScale", () => {
  it("is base width over user width", () => {
    expect(naturalScale({ width: 400, height: 200 }, { x: 0, y: 0, w: 800, h: 400 })).toBe(0.5);
    expect(
      Number.isNaN(naturalScale({ width: 400, height: 200 }, { x: 0, y: 0, w: 0, h: 10 }))
    ).toBe(true);
  });
});

describe("fitScale", () => {
  it("never exceeds 1", () => {
    expect(fitScale({ width: 100, height: 50 }, { width: 400, height: 300 })).toBe(1);
    expect(fitScale({ width: 800, height: 600 }, { width: 400, height: 300 })).toBe(0.5);
    expect(fitScale({ width: 800, height: 200 }, { width: 400, height: 300 })).toBe(0.5);
  });
});

describe("openingCamera", () => {
  it("contains large diagram and does not upscale small", () => {
    const small = openingCamera(
      { x: 0, y: 0, w: 100, h: 50 },
      { width: 100, height: 50 },
      { width: 400, height: 300 }
    );
    expect(small!.scale).toBe(1);
    const smallBox = cameraViewBox(small!, { width: 400, height: 300 });
    expect(small!.vx + smallBox.w / 2).toBe(50);
    expect(small!.vy + smallBox.h / 2).toBe(25);

    const large = openingCamera(
      { x: 0, y: 0, w: 800, h: 600 },
      { width: 800, height: 600 },
      { width: 400, height: 300 }
    );
    expect(large!.scale).toBe(0.5);
    expect(large!.vx).toBe(0);
    expect(large!.vy).toBe(0);
  });
});

describe("zoomCameraAtNorm", () => {
  it("keeps user point under nx,ny", () => {
    const stage = { width: 200, height: 100 };
    const camera = { scale: 1, vx: 0, vy: 0 };
    const nx = 0.25;
    const ny = 0.5;
    const userX = camera.vx + nx * (stage.width / camera.scale);
    const userY = camera.vy + ny * (stage.height / camera.scale);
    const after = zoomCameraAtNorm(camera, { nx, ny, factor: 2 }, stage, 0.25, 4);
    expect(after.scale).toBe(2);
    const box = cameraViewBox(after, stage);
    expect(after.vx + nx * box.w).toBe(userX);
    expect(after.vy + ny * box.h).toBe(userY);
  });

  it("no-ops at clamp limits", () => {
    const stage = { width: 200, height: 100 };
    const atMax = { scale: 4, vx: 1, vy: 2 };
    const afterMax = zoomCameraAtNorm(atMax, { nx: 0.5, ny: 0.5, factor: 2 }, stage, 0.5, 4);
    expect(afterMax).toBe(atMax);
    const atMin = { scale: 0.5, vx: 3, vy: 4 };
    const afterMin = zoomCameraAtNorm(atMin, { nx: 0.5, ny: 0.5, factor: 0.5 }, stage, 0.5, 4);
    expect(afterMin).toBe(atMin);
  });
});

describe("panCamera", () => {
  it("shifts frustum by dx/scale", () => {
    const after = panCamera({ scale: 2, vx: 10, vy: 20 }, 8, -4);
    expect(after.scale).toBe(2);
    expect(after.vx).toBe(10 - 8 / 2);
    expect(after.vy).toBe(20 - -4 / 2);
  });
});

describe("resizeCamera", () => {
  it("follows contain when shrinking while contained", () => {
    const userBox = { x: 0, y: 0, w: 800, h: 600 };
    const base = { width: 800, height: 600 };
    const prev = { width: 800, height: 600 };
    const camera = openingCamera(userBox, base, prev)!;
    const next = { width: 400, height: 300 };
    const after = resizeCamera(camera, userBox, base, prev, next)!;
    expect(after).toEqual(openingCamera(userBox, base, next));
    expect(after.scale).toBe(0.5);
  });

  it("keeps zoomed-in center when still above contain", () => {
    const userBox = { x: 0, y: 0, w: 800, h: 600 };
    const base = { width: 800, height: 600 };
    const prev = { width: 400, height: 300 };
    const camera = { scale: 2, vx: 100, vy: 50 };
    const next = { width: 360, height: 270 };
    const after = resizeCamera(camera, userBox, base, prev, next)!;
    expect(after.scale).toBe(2);
    const prevBox = cameraViewBox(camera, prev);
    const nextBox = cameraViewBox(after, next);
    expect(after.vx + nextBox.w / 2).toBe(camera.vx + prevBox.w / 2);
    expect(after.vy + nextBox.h / 2).toBe(camera.vy + prevBox.h / 2);
  });
});

describe("applyFullscreenResize", () => {
  it("starts camera when missing or unusable", () => {
    const stage = { width: 400, height: 300 };
    expect(applyFullscreenResize(null, null, null, null, null)).toEqual({
      action: "keep",
    });
    expect(
      applyFullscreenResize(null, stage, null, { x: 0, y: 0, w: 80, h: 40 }, { width: 80, height: 40 })
    ).toEqual({ action: "start" });
    expect(
      applyFullscreenResize({ scale: 1, vx: 0, vy: 0 }, stage, stage, null, null)
    ).toEqual({ action: "start" });
  });

  it("applies resized camera", () => {
    const userBox = { x: 0, y: 0, w: 800, h: 600 };
    const base = { width: 800, height: 600 };
    const prev = { width: 400, height: 300 };
    const camera = { scale: 2, vx: 100, vy: 50 };
    const nextStage = { width: 360, height: 270 };
    const planned = applyFullscreenResize(camera, nextStage, prev, userBox, base);
    expect(planned.action).toBe("apply");
    if (planned.action === "apply") {
      expect(planned.stage).toEqual(nextStage);
      expect(planned.camera).toEqual(resizeCamera(camera, userBox, base, prev, nextStage));
    }
  });
});

describe("pointerToNorm", () => {
  it("clamps to 0..1", () => {
    const rect = { left: 10, top: 20, width: 100, height: 50 };
    expect(pointerToNorm(10, 20, rect)).toEqual({ nx: 0, ny: 0 });
    expect(pointerToNorm(60, 45, rect)).toEqual({ nx: 0.5, ny: 0.5 });
    expect(pointerToNorm(-8, 999, rect)).toEqual({ nx: 0, ny: 1 });
  });
});

describe("canStartCamera", () => {
  it("requires measurable sizes", () => {
    const base = { width: 100, height: 50 };
    const userBox = { x: 0, y: 0, w: 100, h: 50 };
    const stage = { width: 200, height: 100 };
    expect(canStartCamera(base, userBox, stage)).toBe(true);
    expect(canStartCamera(null, userBox, stage)).toBe(false);
    expect(canStartCamera(base, userBox, { width: 0, height: 100 })).toBe(false);
  });
});

describe("viewBoxAttr", () => {
  it("joins numbers", () => {
    expect(viewBoxAttr({ x: 1, y: 2, w: 3, h: 4 })).toBe("1 2 3 4");
  });
});

describe("cameraScaleRange", () => {
  it("uses contain min and 4x natural max", () => {
    const range = cameraScaleRange(
      { width: 800, height: 600 },
      { x: 0, y: 0, w: 800, h: 600 },
      { width: 400, height: 300 }
    );
    expect(range!.min).toBe(0.5);
    expect(range!.max).toBe(4);
  });
});

function fakeSvg(init: {
  attrs?: Record<string, string | null>;
  style?: Record<string, string>;
}) {
  const attrs: Record<string, string | null> = Object.assign(
    { viewBox: "0 0 80 40", width: "80", height: "40", preserveAspectRatio: "xMidYMid meet" },
    init.attrs || {}
  );
  const style: Record<string, string> & { transform?: string } = Object.assign(
    { width: "", height: "", maxWidth: "", maxHeight: "" },
    init.style || {}
  );
  return {
    style,
    getAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    setAttribute(name: string, value: string) {
      attrs[name] = value;
    },
    removeAttribute(name: string) {
      delete attrs[name];
    },
    _attrs: attrs,
  };
}

describe("captureSvgPresentation", () => {
  it("snapshots attrs and style", () => {
    const svg = fakeSvg({
      style: { width: "10px", height: "", maxWidth: "100%", maxHeight: "" },
    });
    const cap = captureSvgPresentation(svg)!;
    expect(cap.viewBox).toBe("0 0 80 40");
    expect(cap.width).toBe("80");
    expect(cap.height).toBe("40");
    expect(cap.preserveAspectRatio).toBe("xMidYMid meet");
    expect(cap.styleWidth).toBe("10px");
    expect(cap.styleMaxWidth).toBe("100%");
    expect(captureSvgPresentation(null)).toBe(null);
  });
});

describe("restoreSvgAttrs", () => {
  it("round-trips and removes null attrs", () => {
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
    expect(svg.getAttribute("viewBox")).toBe("0 0 80 40");
    expect(svg.getAttribute("width")).toBe("80");
    expect(svg.getAttribute("preserveAspectRatio")).toBe(null);
    expect(svg.style.width).toBe("");
  });
});

describe("applyCamera", () => {
  it("writes viewBox fill attrs not transform", () => {
    const svg = fakeSvg({});
    svg.style.transform = "";
    applyCamera(svg, { scale: 1, vx: -10, vy: -20 }, { width: 200, height: 100 });
    expect(svg.getAttribute("viewBox")).toBe("-10 -20 200 100");
    expect(svg.getAttribute("width")).toBe("100%");
    expect(svg.getAttribute("height")).toBe("100%");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    expect(svg.style.width).toBe("100%");
    expect(svg.style.height).toBe("100%");
    expect(svg.style.maxWidth).toBe("none");
    expect(svg.style.maxHeight).toBe("none");
    expect(svg.style.transform).toBe("");
  });

  it("no-ops without svg or camera", () => {
    const svg = fakeSvg({});
    applyCamera(null, { scale: 1, vx: 0, vy: 0 }, { width: 1, height: 1 });
    applyCamera(svg, null, { width: 1, height: 1 });
    expect(svg.getAttribute("viewBox")).toBe("0 0 80 40");
  });
});

describe("measureStage", () => {
  it("requires positive client box", () => {
    expect(measureStage({ clientWidth: 120, clientHeight: 80 })).toEqual({
      width: 120,
      height: 80,
    });
    expect(measureStage({ clientWidth: 0, clientHeight: 80 })).toBe(null);
    expect(measureStage(null)).toBe(null);
  });
});

describe("applyCamera then restoreSvgAttrs", () => {
  it("returns original presentation", () => {
    const svg = fakeSvg({
      attrs: {
        viewBox: "0 0 80 40",
        width: "80",
        height: "40",
        preserveAspectRatio: "xMidYMid meet",
      },
      style: { width: "", height: "", maxWidth: "100%", maxHeight: "" },
    });
    svg.style.transform = "";
    const captured = captureSvgPresentation(svg)!;
    applyCamera(svg, { scale: 2, vx: -5, vy: -8 }, { width: 200, height: 100 });
    expect(svg.getAttribute("viewBox")).toBe("-5 -8 100 50");
    restoreSvgAttrs(svg, captured);
    expect(svg.getAttribute("viewBox")).toBe("0 0 80 40");
    expect(svg.getAttribute("width")).toBe("80");
    expect(svg.getAttribute("height")).toBe("40");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(svg.style.width).toBe("");
    expect(svg.style.maxWidth).toBe("100%");
    expect(svg.style.transform).toBe("");
  });
});

describe("planStartCamera", () => {
  it("keeps existing camera when stage is unmeasurable", () => {
    const prev = { scale: 2, vx: 1, vy: 2 };
    const base = { width: 800, height: 600 };
    const userBox = { x: 0, y: 0, w: 800, h: 600 };
    expect(planStartCamera(prev, null, base, userBox, true)).toEqual({
      action: "keep",
    });
    expect(planStartCamera(null, null, base, userBox, true)).toEqual({
      action: "keep",
    });
  });

  it("falls back when metrics cannot start a camera", () => {
    const prev = { scale: 1, vx: 0, vy: 0 };
    expect(planStartCamera(prev, { width: 200, height: 100 }, null, null, true)).toEqual({
      action: "fallback",
    });
    expect(
      planStartCamera(
        null,
        { width: 200, height: 100 },
        { width: 80, height: 40 },
        { x: 0, y: 0, w: 80, h: 40 },
        false
      )
    ).toEqual({ action: "fallback" });
  });

  it("commits opening camera when measurable", () => {
    const base = { width: 800, height: 600 };
    const userBox = { x: 0, y: 0, w: 800, h: 600 };
    const stage = { width: 400, height: 300 };
    const planned = planStartCamera(null, stage, base, userBox, true);
    expect(planned.action).toBe("commit");
    if (planned.action === "commit") {
      expect(planned.stage).toEqual(stage);
      expect(planned.camera).toEqual(openingCamera(userBox, base, stage));
    }
  });
});
