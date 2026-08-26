(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MinoMDMermaidBlock = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCALE_MAX = 4;
  const DEFAULT_MODE = "preview";
  const MODES = { code: true, preview: true };

  function normalizeMode(mode) {
    const m = String(mode || "").toLowerCase();
    return MODES[m] ? m : DEFAULT_MODE;
  }

  function modeClass(mode) {
    return "mode-" + normalizeMode(mode);
  }

  function parsePositiveLength(value) {
    if (value == null || value === "") return NaN;
    const s = String(value).trim();
    if (s.endsWith("%")) return NaN;
    const n = parseFloat(s);
    return n > 0 ? n : NaN;
  }

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

  function readSvgBaseSize(svg) {
    if (!svg || typeof svg.getAttribute !== "function") return null;
    const w = parsePositiveLength(svg.getAttribute("width"));
    const h = parsePositiveLength(svg.getAttribute("height"));
    if (w > 0 && h > 0) return { width: w, height: h };

    const parsed = parseViewBox(svg.getAttribute("viewBox"));
    if (parsed) return { width: parsed.w, height: parsed.h };

    if (typeof svg.getBBox === "function") {
      try {
        const box = svg.getBBox();
        if (box && box.width > 0 && box.height > 0) {
          return { width: box.width, height: box.height };
        }
      } catch (_) {}
    }
    return null;
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

  function planStartCamera(prevCamera, stage, base, userBox, hasSvg) {
    if (!stage) return { action: "keep" };
    if (!canStartCamera(base, userBox, stage) || !hasSvg) {
      return { action: "fallback" };
    }
    const next = openingCamera(userBox, base, stage);
    if (!next) return { action: prevCamera ? "keep" : "fallback" };
    return { action: "commit", camera: next, stage };
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
    if (next === scale) return camera;
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

  function applyFullscreenResize(cam, nextStage, prevStage, userBox, base) {
    if (!nextStage) return { action: "keep" };
    if (!cam) return { action: "start" };
    const next = resizeCamera(cam, userBox, base, prevStage || nextStage, nextStage);
    if (!next) return { action: "start" };
    return { action: "apply", camera: next, stage: nextStage };
  }

  function pointerToNorm(clientX, clientY, rect) {
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
      return { nx: 0.5, ny: 0.5 };
    }
    const nx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const ny = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return { nx, ny };
  }

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

  function previewActionsVisible(mode, failed) {
    return String(mode || "").toLowerCase() === "preview" && !failed;
  }

  function previewActionsHtml() {
    return (
      '<button type="button" data-action="fullscreen" aria-label="Fullscreen">Fullscreen</button>'
    );
  }

  function wheelZoomFactor(deltaY) {
    const d = Number(deltaY);
    if (!(d < 0) && !(d > 0)) return 1;
    return d < 0 ? 1.1 : 1 / 1.1;
  }

  function bindPreviewInteractions(inst) {
    const viewport = inst.getViewport();
    const root = inst.root;

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
      if (next === cam) return;
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

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    function endDrag(ev) {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove("is-panning");
      if (ev && ev.type !== "lostpointercapture" && ev.pointerId != null) {
        try {
          viewport.releasePointerCapture(ev.pointerId);
        } catch (_) {}
      }
    }

    viewport.addEventListener("pointerdown", (ev) => {
      if (!canUseCamera() || ev.button !== 0) return;
      ev.preventDefault();
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      viewport.classList.add("is-panning");
      viewport.setPointerCapture(ev.pointerId);
    });

    viewport.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      if (!canUseCamera()) {
        endDrag(ev);
        return;
      }
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      const stage = currentStage();
      const cam = inst.getCameraState();
      if (!stage || !cam) {
        endDrag(ev);
        return;
      }
      inst.applyCameraState(panCamera(cam, dx, dy), stage);
    });

    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);
    viewport.addEventListener("lostpointercapture", endDrag);

    root.querySelector(".mermaid-preview-actions").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (action === "fullscreen") {
        openMermaidFullscreen(inst);
      }
    });
  }

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

  let fsState = null; // { inst, unlock, onKey, placeholder, viewport, inertEl, stage, onResize }

  /** Restore viewport after fullscreen; used by close and unit-tested. */
  function restoreFullscreenViewport(placeholder, viewport, panesEl) {
    if (!viewport) return "lost";
    if (placeholder && placeholder.parentNode) {
      placeholder.replaceWith(viewport);
      return "replaced";
    }
    if (panesEl) {
      panesEl.appendChild(viewport);
      return "appended";
    }
    return "lost";
  }

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

  function ensureOverlay() {
    let el = document.querySelector(".mermaid-fs-overlay");
    if (el) return el;
    el = document.createElement("div");
    el.className = "mermaid-fs-overlay";
    el.hidden = true;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Mermaid fullscreen");
    el.innerHTML =
      '<div class="mermaid-fs-chrome">' +
      '<button type="button" data-action="fs-reset" aria-label="Reset zoom">Reset</button>' +
      '<button type="button" data-action="fs-close" aria-label="Close">Close</button>' +
      "</div>" +
      '<div class="mermaid-fs-stage"></div>';
    document.body.appendChild(el);
    el.addEventListener("click", (ev) => {
      if (ev.target === el) closeMermaidFullscreen();
    });
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
    return el;
  }

  function closeMermaidFullscreen() {
    if (!fsState) return;
    const { inst, unlock, onKey, placeholder, viewport, inertEl } = fsState;
    document.removeEventListener("keydown", onKey);
    unlock();
    if (inertEl) inertEl.inert = false;
    if (fsState.onResize) {
      window.removeEventListener("resize", fsState.onResize);
    }
    inst.stopCamera();
    const panes = inst.root.querySelector(".mermaid-panes");
    restoreFullscreenViewport(placeholder, viewport, panes);
    const overlay = ensureOverlay();
    overlay.hidden = true;
    fsState = null;
  }

  function openMermaidFullscreen(inst) {
    if (inst.isFailed() || inst.getMode() !== "preview") return;
    if (fsState) closeMermaidFullscreen();
    const viewport = inst.getViewport();
    if (!viewport) return;
    const overlay = ensureOverlay();
    const stageEl = overlay.querySelector(".mermaid-fs-stage");
    const placeholder = document.createElement("div");
    placeholder.className = "mermaid-fs-placeholder";
    viewport.replaceWith(placeholder);
    stageEl.replaceChildren(viewport);
    const unlock = withOverflowLocked(document.documentElement, document.body);
    const inertEl = document.querySelector("#content");
    if (inertEl) inertEl.inert = true;
    const onKey = (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeMermaidFullscreen();
      }
    };
    document.addEventListener("keydown", onKey);
    overlay.hidden = false;
    const closeBtn = overlay.querySelector('[data-action="fs-close"]');
    if (closeBtn && typeof closeBtn.focus === "function") closeBtn.focus();
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
      const nextStage = measureStage(viewport);
      const planned = applyFullscreenResize(
        inst.getCameraState(),
        nextStage,
        fsState.stage,
        inst.getUserBox(),
        inst.getBaseSize()
      );
      if (planned.action === "keep") return;
      if (planned.action === "start") {
        if (nextStage) fsState.stage = nextStage;
        inst.startCamera();
        return;
      }
      inst.applyCameraState(planned.camera, planned.stage);
    };
    window.addEventListener("resize", onResize);
    fsState.onResize = onResize;
  }

  function createMermaidBlock(sourceText, _escapeHtml) {
    const source = String(sourceText || "");

    const root = document.createElement("figure");
    root.className = "mermaid-block " + modeClass(DEFAULT_MODE);
    root.dataset.mode = DEFAULT_MODE;

    root.innerHTML =
      '<div class="mermaid-toolbar" role="toolbar" aria-label="Mermaid view">' +
      '<div class="mermaid-mode-group">' +
      '<button type="button" data-mode="code">Code</button>' +
      '<button type="button" data-mode="preview" aria-pressed="true">Preview</button>' +
      "</div>" +
      '<div class="mermaid-preview-actions" hidden>' +
      previewActionsHtml() +
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
    const viewportEl = root.querySelector(".mermaid-viewport");
    const panesEl = root.querySelector(".mermaid-panes");
    let mode = DEFAULT_MODE;
    let failed = false;
    let baseSize = null;
    let camera = null;
    let userBox = null;
    let originalPresentation = null;
    let inst = null;

    function getDiagramSvg() {
      return diagramEl.querySelector("svg");
    }

    function cacheBaseSize() {
      const svg = getDiagramSvg();
      baseSize = readSvgBaseSize(svg);
      userBox = userBoxFromSvgAttrs(svg && svg.getAttribute("viewBox"), baseSize);
      originalPresentation = captureSvgPresentation(svg);
    }

    function syncChrome() {
      root.dataset.mode = mode;
      root.classList.remove("mode-code", "mode-preview");
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
        if (fsState && fsState.inst === inst) closeMermaidFullscreen();
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
      const stage = measureStage(viewportEl);
      const planned = planStartCamera(
        camera,
        stage,
        baseSize,
        userBox,
        !!getSvg()
      );
      if (planned.action === "keep") return camera != null;
      if (planned.action === "fallback") {
        viewportEl.classList.remove("is-camera");
        viewportEl.classList.add("is-fs-fallback");
        camera = null;
        return false;
      }
      viewportEl.classList.remove("is-fs-fallback");
      viewportEl.classList.add("is-camera");
      applyCameraState(planned.camera, planned.stage);
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

    root.querySelector(".mermaid-mode-group").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-mode]");
      if (!btn || !root.contains(btn)) return;
      setMode(btn.getAttribute("data-mode"));
    });

    syncChrome();

    inst = {
      root,
      diagramEl,
      setMode,
      getMode: () => mode,
      setRenderFailed,
      getViewport: () => viewportEl,
      getZoomTarget: () => zoomTarget,
      getPanes: () => panesEl,
      isFailed: () => failed,
      cacheBaseSize,
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
    };
    bindPreviewInteractions(inst);
    return inst;
  }

  return {
    SCALE_MAX,
    DEFAULT_MODE,
    normalizeMode,
    modeClass,
    previewActionsVisible,
    previewActionsHtml,
    readSvgBaseSize,
    parseViewBox,
    userBoxFromSvgAttrs,
    naturalScale,
    fitScale,
    cameraScaleRange,
    canStartCamera,
    planStartCamera,
    cameraViewBox,
    viewBoxAttr,
    openingCamera,
    zoomCameraAtNorm,
    panCamera,
    resizeCamera,
    applyFullscreenResize,
    pointerToNorm,
    captureSvgPresentation,
    restoreSvgAttrs,
    applyCamera,
    measureStage,
    createMermaidBlock,
    wheelZoomFactor,
    bindPreviewInteractions,
    withOverflowLocked,
    restoreFullscreenViewport,
    handleFullscreenChromeAction,
    openMermaidFullscreen,
    closeMermaidFullscreen,
  };
});
