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
});
