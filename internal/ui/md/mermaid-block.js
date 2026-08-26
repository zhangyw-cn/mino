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
  const MODES = { code: true, preview: true };

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

  function previewActionsVisible(mode, failed) {
    return String(mode || "").toLowerCase() === "preview" && !failed;
  }

  function wheelZoomFactor(deltaY) {
    const d = Number(deltaY);
    if (!(d < 0) && !(d > 0)) return 1;
    return d < 0 ? 1.1 : 1 / 1.1;
  }

  function bindPreviewInteractions(inst) {
    const viewport = inst.getViewport();
    const root = inst.root;

    function canZoom() {
      return inst.getMode() === "preview" && !inst.isFailed();
    }

    function zoomBy(factor, clientX, clientY) {
      if (!canZoom() || factor === 1) return;
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
      if (!canZoom() || ev.button !== 0) return;
      ev.preventDefault();
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      viewport.classList.add("is-panning");
      viewport.setPointerCapture(ev.pointerId);
    });

    viewport.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      if (!canZoom()) {
        endDrag(ev);
        return;
      }
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      const z = inst.getZoomState();
      inst.applyZoomState({ scale: z.scale, tx: z.tx + dx, ty: z.ty + dy });
    });

    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);
    viewport.addEventListener("lostpointercapture", endDrag);

    root.querySelector(".mermaid-preview-actions").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (action === "zoom-reset") {
        inst.resetZoom();
        return;
      }
      if (action === "fullscreen") {
        openMermaidFullscreen(inst);
        return;
      }
      if (action === "zoom-in" || action === "zoom-out") {
        const rect = viewport.getBoundingClientRect();
        const factor = action === "zoom-in" ? 1.1 : 1 / 1.1;
        zoomBy(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
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

  let fsState = null; // { inst, unlock, onKey, placeholder, viewport, inertEl }

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
    const { inst, unlock, onKey, placeholder, viewport, inertEl } = fsState;
    document.removeEventListener("keydown", onKey);
    unlock();
    if (inertEl) inertEl.inert = false;
    const panes = inst.root.querySelector(".mermaid-panes");
    restoreFullscreenViewport(placeholder, viewport, panes);
    const overlay = ensureOverlay();
    overlay.hidden = true;
    inst.resetZoom();
    fsState = null;
  }

  function openMermaidFullscreen(inst) {
    if (inst.isFailed() || inst.getMode() !== "preview") return;
    if (fsState) closeMermaidFullscreen();
    const viewport = inst.getViewport();
    if (!viewport) return;
    const overlay = ensureOverlay();
    const stage = overlay.querySelector(".mermaid-fs-stage");
    const placeholder = document.createElement("div");
    placeholder.className = "mermaid-fs-placeholder";
    viewport.replaceWith(placeholder);
    stage.replaceChildren(viewport);
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
    fsState = { inst, unlock, onKey, placeholder, viewport, inertEl };
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
    const viewportEl = root.querySelector(".mermaid-viewport");
    const panesEl = root.querySelector(".mermaid-panes");
    let mode = DEFAULT_MODE;
    let failed = false;
    let zoom = { scale: 1, tx: 0, ty: 0 };
    let inst = null;

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
      const transforming =
        zoom.scale !== 1 || zoom.tx !== 0 || zoom.ty !== 0;
      zoomTarget.classList.toggle("is-transforming", transforming);
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

    inst = {
      root,
      diagramEl,
      setMode,
      getMode: () => mode,
      setRenderFailed,
      resetZoom,
      getViewport: () => viewportEl,
      getZoomTarget: () => zoomTarget,
      getPanes: () => panesEl,
      applyZoomState,
      getZoomState: () => ({ scale: zoom.scale, tx: zoom.tx, ty: zoom.ty }),
      isFailed: () => failed,
    };
    bindPreviewInteractions(inst);
    return inst;
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
    readSvgBaseSize,
    svgSizeForScale,
    applySvgZoomSize,
    createMermaidBlock,
    wheelZoomFactor,
    bindPreviewInteractions,
    withOverflowLocked,
    restoreFullscreenViewport,
    openMermaidFullscreen,
    closeMermaidFullscreen,
  };
});
