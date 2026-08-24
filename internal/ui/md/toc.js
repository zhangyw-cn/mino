(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MinoMDToc = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function slugify(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}-]+/gu, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function uniqueId(base, used) {
    const id = base || "heading";
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
    let n = 2;
    for (;;) {
      const candidate = id + "-" + n;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
      n++;
    }
  }

  function headingLevel(el) {
    const m = /^H([1-6])$/i.exec(el.tagName || "");
    return m ? Number(m[1]) : 0;
  }

  function ensureHeadingIds(headings, used) {
    const set = used || new Set();
    const items = [];
    for (const el of headings) {
      const text = String(el.textContent || "").trim();
      let id = String(el.id || "").trim();
      if (id) {
        set.add(id);
      } else {
        id = uniqueId(slugify(text), set);
        el.id = id;
      }
      const level = headingLevel(el);
      if (level >= 1 && level <= 3) {
        items.push({ id, level, text });
      }
    }
    return items;
  }

  return { slugify, uniqueId, ensureHeadingIds };
});
