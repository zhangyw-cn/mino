(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MinoPreviewSession = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MESSAGE_SOURCE = "mino";
  const KIND_MARKDOWN = "markdown";
  const KIND_HTML = "html";
  const KIND_DOCUMENT = "document";
  const PREVIEW_TYPES = {
    "preview-navigate": true,
    "preview-reload": true,
    "preview-ready": true,
    "preview-error": true,
  };

  function asPath(value) {
    return typeof value === "string" ? value : "";
  }

  function parsePath(value) {
    return asPath(value).trim();
  }

  function kindId(path) {
    const p = asPath(path);
    if (/\.md$/i.test(p)) return KIND_MARKDOWN;
    if (/\.html?$/i.test(p)) return KIND_HTML;
    return KIND_DOCUMENT;
  }

  function inPlace(path) {
    return kindId(path) === KIND_MARKDOWN;
  }

  function decidePreviewAction(input) {
    const opts = input && typeof input === "object" ? input : {};
    const fromPath = asPath(opts.fromPath);
    const toPath = asPath(opts.toPath);
    const force = !!opts.force;
    const displayedPath = asPath(opts.displayedPath);
    const navigatePending = !!opts.navigatePending;
    if (toPath === fromPath && !force) return "skip";
    if (navigatePending) return "navigate";
    if (
      displayedPath &&
      kindId(toPath) === kindId(displayedPath) &&
      inPlace(toPath)
    ) {
      return "in-place";
    }
    return "navigate";
  }

  function previewMessage(type, path) {
    return {
      source: MESSAGE_SOURCE,
      type: type,
      path: parsePath(path),
    };
  }

  function previewNavigateMessage(path) {
    return previewMessage("preview-navigate", path);
  }

  function previewReloadMessage(path) {
    return previewMessage("preview-reload", path);
  }

  function previewReadyMessage(path) {
    return previewMessage("preview-ready", path);
  }

  function previewErrorMessage(path) {
    return previewMessage("preview-error", path);
  }

  function parsePreviewMessage(data, origin, expectedOrigin) {
    if (origin !== expectedOrigin) return null;
    if (!data || data.source !== MESSAGE_SOURCE) return null;
    if (!PREVIEW_TYPES[data.type]) return null;
    const path = parsePath(data.path);
    if (!path) return null;
    return { type: data.type, path: path };
  }

  return {
    kindId,
    inPlace,
    decidePreviewAction,
    previewNavigateMessage,
    previewReloadMessage,
    previewReadyMessage,
    previewErrorMessage,
    parsePreviewMessage,
  };
});
