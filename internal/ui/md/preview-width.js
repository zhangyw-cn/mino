(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MinoMDPreviewWidth = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "mino-md-preview-width";
  const DEFAULT_WIDTH = "wide";
  const WIDTHS = { standard: true, wide: true, full: true };
  const WIDTH_LABELS = { standard: "标宽", wide: "较宽", full: "全宽" };
  const MESSAGE_SOURCE = "mino";
  const MESSAGE_TYPE = "md-preview-width";

  function parsePreviewWidth(value) {
    const v = String(value || "");
    return Object.hasOwn(WIDTHS, v) ? v : DEFAULT_WIDTH;
  }

  function isMarkdownPath(path) {
    return /\.md$/i.test(String(path || ""));
  }

  function readPreviewWidth(storage) {
    try {
      return parsePreviewWidth(storage && storage.getItem(STORAGE_KEY));
    } catch (_err) {
      return DEFAULT_WIDTH;
    }
  }

  function writePreviewWidth(storage, mode) {
    const value = parsePreviewWidth(mode);
    try {
      if (storage) storage.setItem(STORAGE_KEY, value);
    } catch (_err) {}
    return value;
  }

  function applyPreviewWidth(root, mode) {
    const value = parsePreviewWidth(mode);
    if (root && typeof root.setAttribute === "function") {
      root.setAttribute("data-md-width", value);
    }
    return value;
  }

  function previewWidthMessage(value) {
    return {
      source: MESSAGE_SOURCE,
      type: MESSAGE_TYPE,
      value: parsePreviewWidth(value),
    };
  }

  function parsePreviewWidthMessage(data, origin, expectedOrigin) {
    if (origin !== expectedOrigin) return null;
    if (!data || data.source !== MESSAGE_SOURCE || data.type !== MESSAGE_TYPE) return null;
    if (!Object.hasOwn(WIDTHS, data.value)) return null;
    return data.value;
  }

  return {
    STORAGE_KEY,
    DEFAULT_WIDTH,
    WIDTH_LABELS,
    parsePreviewWidth,
    isMarkdownPath,
    readPreviewWidth,
    writePreviewWidth,
    applyPreviewWidth,
    previewWidthMessage,
    parsePreviewWidthMessage,
  };
});
