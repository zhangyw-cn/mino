(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MinoFuzzy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function basenameStart(path) {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? 0 : slash + 1;
  }

  function isBoundary(path, index, baseStart) {
    if (index === baseStart) return true;
    if (index === 0) return false;
    const prev = path[index - 1];
    return prev === "/" || prev === "." || prev === "-" || prev === "_";
  }

  function score(query, path) {
    if (!query) return null;
    const q = String(query).toLowerCase();
    const full = String(path).toLowerCase();
    const baseStart = basenameStart(path);
    const matches = [];
    let qi = 0;
    let prev = -2;
    let total = 0;

    for (let i = 0; i < full.length && qi < q.length; i++) {
      if (full[i] !== q[qi]) continue;
      matches.push(i);
      total += 1;
      if (i === prev + 1) total += 4;
      if (isBoundary(path, i, baseStart)) total += 6;
      if (i >= baseStart) total += 8;
      prev = i;
      qi += 1;
    }

    if (qi < q.length) return null;
    return { score: total, matches };
  }

  function filter(query, paths) {
    if (!query) return [];
    const results = [];
    for (const path of paths) {
      const hit = score(query, path);
      if (!hit) continue;
      results.push({ path, score: hit.score, matches: hit.matches });
    }
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.path < b.path) return -1;
      if (a.path > b.path) return 1;
      return 0;
    });
    return results.slice(0, 50);
  }

  return { score, filter };
});
