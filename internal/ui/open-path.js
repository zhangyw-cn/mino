(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MinoOpenPath = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "mino-open-path";

  function parseOpenPath(value) {
    if (typeof value !== "string") return "";
    return value.trim();
  }

  function readOpenPath(storage) {
    try {
      return parseOpenPath(storage && storage.getItem(STORAGE_KEY));
    } catch (_err) {
      return "";
    }
  }

  function writeOpenPath(storage, path) {
    const value = parseOpenPath(path);
    try {
      if (!storage) return value;
      if (!value) {
        storage.removeItem(STORAGE_KEY);
        return "";
      }
      storage.setItem(STORAGE_KEY, value);
    } catch (_err) {}
    return value;
  }

  function clearOpenPath(storage) {
    try {
      if (storage) storage.removeItem(STORAGE_KEY);
    } catch (_err) {}
  }

  function resolveOpenPath(stored, fileIndex) {
    const path = parseOpenPath(stored);
    if (!path) return "";
    if (!fileIndex || typeof fileIndex.includes !== "function") return "";
    return fileIndex.includes(path) ? path : "";
  }

  return {
    STORAGE_KEY,
    parseOpenPath,
    readOpenPath,
    writeOpenPath,
    clearOpenPath,
    resolveOpenPath,
  };
});
