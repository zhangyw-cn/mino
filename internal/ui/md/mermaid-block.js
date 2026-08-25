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
