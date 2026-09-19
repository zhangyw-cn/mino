(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MinoAssetRefs = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function dirname(file) {
    if (typeof file !== "string") return "";
    const i = file.lastIndexOf("/");
    return i <= 0 ? "" : file.slice(0, i);
  }

  function posixNormalize(rel) {
    const parts = [];
    for (const part of String(rel).split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) return null;
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    return parts.join("/");
  }

  function resolveRef(fromFile, url) {
    if (typeof url !== "string") return null;
    let raw = url.trim();
    if (!raw) return null;
    const hash = raw.indexOf("#");
    if (hash === 0) return null;
    if (hash >= 0) raw = raw.slice(0, hash);
    const query = raw.indexOf("?");
    if (query >= 0) raw = raw.slice(0, query);
    if (!raw) return null;
    if (/^(https?|data|mailto|javascript):/i.test(raw)) return null;
    if (raw.startsWith("//")) return null;

    let target = raw;
    if (target.startsWith("/apps/")) {
      try {
        target = decodeURIComponent(target.slice("/apps/".length));
      } catch (_err) {
        return null;
      }
      return posixNormalize(target);
    }
    if (target.startsWith("/")) return null;
    const dir = dirname(fromFile);
    const joined = dir ? dir + "/" + target : target;
    return posixNormalize(joined);
  }

  // Mask Markdown fenced code so fence samples do not become reload refs.
  function maskMarkdownFences(source) {
    return String(source).replace(
      /(^|\n)([ \t]{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2\3[^\n]*(?=\n|$)|$)/g,
      (match) => match.replace(/[^\n]/g, " ")
    );
  }

  function pushURL(out, value) {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
  }

  function extractURLs(source) {
    if (typeof source !== "string" || !source) return [];
    const text = maskMarkdownFences(source);
    const out = [];
    const attr = /\b(?:src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let m;
    while ((m = attr.exec(text))) pushURL(out, m[1] || m[2] || m[3] || "");
    const urlFn = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+?))\s*\)/gi;
    while ((m = urlFn.exec(text))) pushURL(out, m[1] || m[2] || m[3] || "");
    const imp = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)')/gi;
    while ((m = imp.exec(text))) pushURL(out, m[1] || m[2] || "");
    const md = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)/g;
    while ((m = md.exec(text))) pushURL(out, m[1]);
    return out;
  }

  function referencedPaths(fromFile, source) {
    const seen = [];
    const have = new Set();
    for (const url of extractURLs(source)) {
      const rel = resolveRef(fromFile, url);
      if (!rel || have.has(rel)) continue;
      have.add(rel);
      seen.push(rel);
    }
    return seen;
  }

  return { extractURLs, resolveRef, referencedPaths, maskMarkdownFences };
});
