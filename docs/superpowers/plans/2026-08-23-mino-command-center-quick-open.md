# Command Center Quick Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top-bar search input with a VS Code–like Command Center (workspace name) and a covering Quick Open overlay with compact, tokenized, recents-boosted ranking.

**Architecture:** Keep the cached `fileIndex` from `/api/tree`, session recents, iframe hotkeys, and reveal-in-tree. Extend `internal/ui/fuzzy.js` for compact matches, whitespace tokens, and recents boost. Replace `#search` with `#command-center`. Move typing into a `position: fixed` overlay (`#quick-open` + `#quick-open-input` + `#quick-open-list`) that covers the Command Center. Do not call `/api/search`.

**Tech Stack:** Vanilla HTML/CSS/JS embedded with `go:embed`; Node `--test` for the scorer; `go test` structural markers for HTML/JS/CSS.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-23-mino-command-center-quick-open-design.md`
- No frontend build step; no npm fuzzy libraries; no Playwright.
- Do not change `GET /api/search` or catalog substring semantics.
- No command palette, content search, recents persistence, go-to-line, or symbols.
- Empty-query copy: `Type to search files`. No-match copy: `No matching files.` Overlay placeholder: `Search files by name`. Recents footer: `recently opened`.
- Recents: in-memory, max 10, most recent first, unique by path.
- Result cap: 50. Arrow keys stop at ends (no wrap).
- Hotkeys: `Ctrl/Cmd+E` and `Ctrl/Cmd+P` only (not Alt/Shift). Do not intercept `Ctrl/Cmd+F`.
- Overlay: `position: fixed`, `top: 4px`, `left: 50%`, `transform: translateX(-50%)`, width `min(640px, 86vw)`, `z-index: 50`. Active row `#37373d`. Match marks `#4fc1ff`.
- Type chips: `.html`/`.htm` `#e36e6e`; `.md` `#519aba`; else `#6e6e6e`.
- English UI strings only, matching the existing chrome.

---

## File Structure

```text
internal/ui/fuzzy.js                 # Extend: tokens, compact pick, recents boost
internal/ui/testdata/fuzzy_test.mjs  # Extend Node tests
internal/ui/fuzzy_node_test.go       # Unchanged wrapper
internal/ui/index.html               # Command Center + covering overlay markup
internal/ui/style.css                # Overlay, chips, single-line rows, sr-only title
internal/ui/app.js                   # Wire Command Center, overlay input, new filter, rows
internal/server/server_test.go       # HTML/JS/CSS contract markers
```

Do not modify catalog, watcher, config, embed.go, server routes, or `/api/search` handlers. `GET /fuzzy.js` already exists.

---

### Task 1: Compact tokenized fuzzy scorer

**Files:**
- Modify: `internal/ui/testdata/fuzzy_test.mjs`
- Modify: `internal/ui/fuzzy.js`
- Test: `internal/ui/fuzzy_node_test.go` (existing wrapper; do not change)

**Interfaces:**
- Consumes: nothing from later tasks
- Produces: `MinoFuzzy.score(query, path)` → `{ score: number, matches: number[] } | null`; `MinoFuzzy.filter(query, paths, recents)` → `{ path, score, matches }[]`. `recents` optional (`[]` if omitted). Empty or whitespace-only query: `score` → `null`, `filter` → `[]`. Matches are sorted unique full-path indexes. Sort: score desc, then path asc. Cap 50.

- [ ] **Step 1: Add failing Node tests**

Replace `internal/ui/testdata/fuzzy_test.mjs` with:

```javascript
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const { score, filter } = createRequire(import.meta.url)("../fuzzy.js");

test("empty query returns no rows and does not score", () => {
  assert.deepEqual(filter("", ["tools/timer.html", "hello.html"]), []);
  assert.equal(score("", "hello.html"), null);
});

test("whitespace-only query returns no rows and does not score", () => {
  assert.deepEqual(filter("   ", ["tools/timer.html"]), []);
  assert.equal(score("  ", "hello.html"), null);
});

test("case-insensitive subsequence ttr matches tools/timer.html", () => {
  const hit = score("ttr", "tools/timer.html");
  assert.ok(hit);
  assert.deepEqual(hit.matches, [0, 6, 10]);
  const rows = filter("TTR", ["hello.html", "tools/timer.html"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, "tools/timer.html");
});

test("basename matches rank above directory-only matches", () => {
  const rows = filter("tools", ["tools/other.html", "src/tools.html"]);
  assert.equal(rows[0].path, "src/tools.html");
  assert.equal(rows[1].path, "tools/other.html");
  assert.ok(rows[0].score > rows[1].score);
});

test("compact consecutive match outranks leftmost scatter on the same path", () => {
  const hit = score("ab", "a_foo_ab.html");
  assert.ok(hit);
  assert.deepEqual(hit.matches, [6, 7]);
});

test("multi-token query matches tools/timer.html", () => {
  const hit = score("tools timer", "tools/timer.html");
  assert.ok(hit);
  const rows = filter("tools timer", ["hello.html", "tools/timer.html"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, "tools/timer.html");
});

test("a token that matches nothing excludes the path", () => {
  assert.equal(score("tools zzz", "tools/timer.html"), null);
  assert.deepEqual(filter("tools zzz", ["tools/timer.html"]), []);
});

test("recents boost reorders equal token scores", () => {
  const paths = ["hello.html", "world.html"];
  const plain = filter("html", paths);
  assert.equal(plain[0].path, "hello.html");
  const boosted = filter("html", paths, ["world.html"]);
  assert.equal(boosted[0].path, "world.html");
  assert.ok(boosted[0].score > boosted[1].score);
});

test("consecutive basename match outranks a recent scattered directory match", () => {
  const rows = filter("abc", ["a-b-c/other.html", "src/abc.html"], ["a-b-c/other.html"]);
  assert.equal(rows[0].path, "src/abc.html");
  assert.ok(rows[0].score > rows[1].score);
});

test("no subsequence match is excluded", () => {
  assert.equal(score("zzz", "hello.html"), null);
  assert.deepEqual(filter("zzz", ["hello.html", "tools/timer.html"]), []);
});

test("filter caps at 50 and breaks ties by path ascending", () => {
  const paths = [];
  for (let i = 0; i < 60; i++) {
    paths.push(`f${String(i).padStart(2, "0")}.html`);
  }
  const rows = filter("f", paths);
  assert.equal(rows.length, 50);
  assert.equal(rows[0].path, "f00.html");
  assert.equal(rows[49].path, "f49.html");
});
```

- [ ] **Step 2: Run tests to verify new cases fail**

Run: `go test ./internal/ui/ -run TestFuzzyScore -count=1`

Expected: FAIL. At least `compact consecutive match outranks leftmost scatter on the same path` fails because current `score("ab", "a_foo_ab.html")` returns leftmost `[0, 7]` instead of `[6, 7]`. `multi-token query matches tools/timer.html` fails because a space is treated as a literal character.

- [ ] **Step 3: Implement the scorer in `internal/ui/fuzzy.js`**

Replace the factory body (keep the UMD wrapper) with:

```javascript
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

  function tokens(query) {
    const trimmed = String(query).trim();
    if (!trimmed) return [];
    return trimmed.split(/\s+/);
  }

  function isSubsequence(q, s) {
    let qi = 0;
    for (let i = 0; i < s.length && qi < q.length; i++) {
      if (s[i] === q[qi]) qi += 1;
    }
    return qi === q.length;
  }

  function greedyFrom(q, s, start) {
    if (s[start] !== q[0]) return null;
    const matches = [start];
    let qi = 1;
    for (let i = start + 1; i < s.length && qi < q.length; i++) {
      if (s[i] === q[qi]) {
        matches.push(i);
        qi += 1;
      }
    }
    if (qi < q.length) return null;
    return matches;
  }

  function scoreMatches(path, matches) {
    const baseStart = basenameStart(path);
    let total = 0;
    let prev = -2;
    for (let i = 0; i < matches.length; i++) {
      const index = matches[i];
      total += 1;
      if (index === prev + 1) total += 4;
      if (isBoundary(path, index, baseStart)) total += 6;
      if (index >= baseStart) total += 8;
      prev = index;
    }
    return total;
  }

  function isBetter(a, b) {
    if (a.score !== b.score) return a.score > b.score;
    if (a.matches[0] !== b.matches[0]) return a.matches[0] > b.matches[0];
    const spanA = a.matches[a.matches.length - 1] - a.matches[0];
    const spanB = b.matches[b.matches.length - 1] - b.matches[0];
    if (spanA !== spanB) return spanA < spanB;
    const sa = a.matches.join(",");
    const sb = b.matches.join(",");
    return sa < sb;
  }

  function pickBest(q, haystack, path, offset) {
    let best = null;
    for (let i = 0; i < haystack.length; i++) {
      if (haystack[i] !== q[0]) continue;
      const local = greedyFrom(q, haystack, i);
      if (!local) continue;
      const matches = local.map((index) => index + offset);
      const candidate = { score: scoreMatches(path, matches), matches };
      if (!best || isBetter(candidate, best)) best = candidate;
    }
    return best;
  }

  function scoreToken(token, path) {
    const q = String(token).toLowerCase();
    const full = String(path).toLowerCase();
    const baseStart = basenameStart(path);
    const base = full.slice(baseStart);
    if (isSubsequence(q, base)) return pickBest(q, base, path, baseStart);
    if (isSubsequence(q, full)) return pickBest(q, full, path, 0);
    return null;
  }

  function score(query, path) {
    const parts = tokens(query);
    if (!parts.length) return null;
    let total = 0;
    const matches = [];
    for (let i = 0; i < parts.length; i++) {
      const hit = scoreToken(parts[i], path);
      if (!hit) return null;
      total += hit.score;
      for (let j = 0; j < hit.matches.length; j++) matches.push(hit.matches[j]);
    }
    matches.sort((a, b) => a - b);
    const unique = [];
    for (let i = 0; i < matches.length; i++) {
      if (i === 0 || matches[i] !== matches[i - 1]) unique.push(matches[i]);
    }
    return { score: total, matches: unique };
  }

  function filter(query, paths, recents) {
    if (!tokens(query).length) return [];
    const recentList = recents || [];
    const results = [];
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const hit = score(query, path);
      if (!hit) continue;
      const recentIndex = recentList.indexOf(path);
      const boost = recentIndex >= 0 ? 20 - recentIndex : 0;
      results.push({ path, score: hit.score + boost, matches: hit.matches });
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/ui/ -run TestFuzzyScore -count=1`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/ui/fuzzy.js internal/ui/testdata/fuzzy_test.mjs
git commit -m "$(cat <<'EOF'
feat(ui): rank Quick Open with compact tokens and recents

EOF
)"
```

---

### Task 2: Command Center markup, covering overlay CSS, contract tests

**Files:**
- Modify: `internal/ui/index.html`
- Modify: `internal/ui/style.css`
- Modify: `internal/server/server_test.go` (index HTML markers + CSS contracts)
- Test: `go test ./internal/server/ -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts' -count=1`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime (markup only)
- Produces: `#command-center` button; overlay `#quick-open` containing `#quick-open-input`, `#quick-open-list`, `#quick-open-footer`; `#title` is `sr-only`. No top-bar `#search`.

- [ ] **Step 1: Write failing HTML/CSS contract tests**

In `internal/server/server_test.go`, in `TestIndexHTMLHasIframeAndAppJS`, change the marker list so it no longer requires `>Search files</span>` and instead requires Command Center / overlay ids:

```go
	for _, marker := range []string{
		"<iframe",
		"/app.js",
		`<main class="workbench">`,
		`id="activity-files"`,
		`id="sidebar" class="sidebar"`,
		`id="sidebar-collapse"`,
		`id="breadcrumb"`,
		`class="activity-bar"`,
		`id="command-center"`,
		`id="quick-open"`,
		`id="quick-open-input"`,
		`id="quick-open-list"`,
		`id="quick-open-footer"`,
		`/fuzzy.js`,
		`class="search-wrap"`,
	} {
```

In `TestAppJSWorkbenchContracts`, add these CSS markers to the existing `css` loop:

```go
	for _, marker := range []string{
		".activity-item:focus-visible",
		".icon-button:focus-visible",
		"grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)",
		"#command-center",
		"position: fixed",
		"#37373d",
		"#4fc1ff",
		".quick-open-chip",
	} {
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/server/ -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts' -count=1`

Expected: FAIL with `index missing "id=\"command-center\""` (or the first missing marker).

- [ ] **Step 3: Rewrite the top-bar and overlay markup**

In `internal/ui/index.html`, replace the `<header class="topbar">…</header>` block and insert the overlay immediately after it (sibling of `header`, not inside `.search-wrap`):

```html
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">M</span>
      <h1 id="title" class="sr-only">mino</h1>
    </div>
    <div class="search-wrap">
      <button
        type="button"
        id="command-center"
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-controls="quick-open"
      >mino</button>
    </div>
  </header>

  <div id="quick-open" hidden>
    <input
      id="quick-open-input"
      type="search"
      placeholder="Search files by name"
      autocomplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded="false"
      aria-controls="quick-open-list"
    >
    <ul id="quick-open-list" role="listbox"></ul>
    <div id="quick-open-footer" hidden>recently opened</div>
  </div>
```

Leave the watch banner, workbench, and script tags unchanged. The page will not function until Task 3 rewires `app.js` off `#search`.

- [ ] **Step 4: Restyle Command Center, overlay, and rows**

In `internal/ui/style.css`:

1. Keep `.search-wrap` as the centered grid slot (`width: min(420px, 46vw)`). Remove `.search-box`, `.search-box:focus-within`, `.search-box input`, `.search-box input::placeholder`, and `.search-icon`.

2. Add Command Center + overlay + row rules (replace the existing `#quick-open` through `.quick-open-dir mark` block):

```css
#command-center {
  width: 100%;
  height: 26px;
  padding: 0 10px;
  overflow: hidden;
  color: var(--fg);
  background: var(--search-bg);
  border: 1px solid #3c3c3c;
  border-radius: 5px;
  cursor: pointer;
  font: inherit;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#command-center:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(0, 120, 212, 0.35);
  outline: none;
}

#quick-open {
  position: fixed;
  top: 4px;
  left: 50%;
  z-index: 50;
  display: flex;
  flex-direction: column;
  width: min(640px, 86vw);
  max-height: calc(100vh - 24px);
  overflow: hidden;
  transform: translateX(-50%);
  background: var(--search-bg);
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
#quick-open[hidden] { display: none !important; }
#quick-open-input {
  width: 100%;
  padding: 10px 14px;
  color: var(--fg);
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--border);
  outline: none;
  font: inherit;
}
#quick-open-input:focus {
  border-bottom-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
#quick-open-input::placeholder { color: var(--fg-muted); }
#quick-open-list {
  max-height: 360px;
  overflow: auto;
  margin: 0;
  padding: 4px 0;
  list-style: none;
}
.quick-open-empty {
  margin: 0;
  padding: 8px 14px;
  color: var(--fg-muted);
  font-size: 12px;
}
.quick-open-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 8px 14px;
  color: var(--fg);
  background: transparent;
  border: 0;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.quick-open-item.active {
  background: #37373d;
}
.quick-open-chip {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  background: #6e6e6e;
  border-radius: 2px;
}
.quick-open-chip.html { background: #e36e6e; }
.quick-open-chip.md { background: #519aba; }
.quick-open-name {
  overflow: hidden;
  color: var(--fg);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quick-open-name mark {
  color: #4fc1ff;
  background: transparent;
  font-weight: 600;
}
.quick-open-dir {
  overflow: hidden;
  color: var(--fg-muted);
  margin-left: auto;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quick-open-dir mark {
  color: #cccccc;
  background: transparent;
  font-weight: 600;
}
#quick-open-footer {
  padding: 8px 14px;
  color: var(--fg-muted);
  border-top: 1px solid var(--border);
  font-size: 12px;
  text-align: right;
}
#quick-open-footer[hidden] { display: none !important; }
```

`.brand h1` can stay; `#title` uses existing `.sr-only` so it is not visible next to the mark.

- [ ] **Step 5: Run tests**

Run: `go test ./internal/server/ -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts' -count=1`

Expected: both tests PASS. `TestAppJSWorkbenchContracts` still uses the old `app.js` markers (`Type to search files` remains until Task 3) plus the new CSS markers. If CSS assertions fail, keep the stylesheet strings `#command-center`, `position: fixed`, `#37373d`, `#4fc1ff`, and `.quick-open-chip`.

- [ ] **Step 6: Commit**

```bash
git add internal/ui/index.html internal/ui/style.css internal/server/server_test.go
git commit -m "$(cat <<'EOF'
feat(ui): add Command Center chrome and covering Quick Open overlay

EOF
)"
```

---

### Task 3: Wire Command Center, overlay input, rows, and recents footer

**Files:**
- Modify: `internal/ui/app.js`
- Modify: `internal/server/server_test.go` (app.js contract markers)
- Test: `go test ./internal/server/ -run TestAppJSWorkbenchContracts -count=1`

**Interfaces:**
- Consumes: `MinoFuzzy.filter(query, fileIndex, recents)` from Task 1; DOM ids from Task 2
- Produces: Click `#command-center` or `Ctrl/Cmd+E`/`P` opens overlay covering the entry; typing filters; accept opens file and focuses preview; Esc/outside closes. UI still does not call `/api/search`.

- [ ] **Step 1: Add failing app.js contract markers**

In `TestAppJSWorkbenchContracts`, extend the JS marker list:

```go
	for _, marker := range []string{
		"sidebar.inert",
		"setBreadcrumb",
		"sidebar-collapsed",
		"preventDefault",
		"event.altKey",
		"event.shiftKey",
		"MinoFuzzy",
		"contentDocument",
		"Type to search files",
		"No matching files.",
		"recently opened",
		"quick-open-input",
		"command-center",
		`key === "e"`,
		`key === "p"`,
	} {
```

Keep the existing `/api/search` and Ctrl+F forbidden checks.

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/server/ -run TestAppJSWorkbenchContracts -count=1`

Expected: FAIL with `app.js missing contract "recently opened"` (or `"quick-open-input"` / `"command-center"`).

- [ ] **Step 3: Rewire `internal/ui/app.js`**

At the top of the IIFE, replace the `search` / `searchWrap` / `quickOpen` queries with:

```javascript
  const title = document.querySelector("#title");
  const commandCenter = document.querySelector("#command-center");
  const quickOpen = document.querySelector("#quick-open");
  const quickOpenInput = document.querySelector("#quick-open-input");
  const quickOpenList = document.querySelector("#quick-open-list");
  const quickOpenFooter = document.querySelector("#quick-open-footer");
```

Keep the other `querySelector` calls unchanged.

In `loadMeta`, after setting `title` and `document.title`, set the visible name:

```javascript
      const name = meta.name || "mino";
      title.textContent = name;
      commandCenter.textContent = name;
      document.title = `${name} · mino`;
```

On `/api/meta` failure, leave Command Center text as the HTML default `mino` (already in markup).

Replace picker helpers from `setPickerOpen` through the document `focusin` listener with:

```javascript
  function fileChipClass(path) {
    const base = basename(path).toLowerCase();
    if (base.endsWith(".md")) return "quick-open-chip md";
    if (base.endsWith(".html") || base.endsWith(".htm")) return "quick-open-chip html";
    return "quick-open-chip";
  }

  function setPickerOpen(open) {
    if (open) {
      pickerOpen = true;
      quickOpen.hidden = false;
      commandCenter.setAttribute("aria-expanded", "true");
      quickOpenInput.setAttribute("aria-expanded", "true");
      return;
    }
    pickerOpen = false;
    quickOpen.hidden = true;
    commandCenter.setAttribute("aria-expanded", "false");
    quickOpenInput.setAttribute("aria-expanded", "false");
    quickOpenInput.value = "";
    quickOpenInput.removeAttribute("aria-activedescendant");
    quickOpenFooter.hidden = true;
    activeIndex = -1;
    pickerRows = [];
    quickOpenList.replaceChildren();
  }

  function showPickerMessage(message) {
    const status = document.createElement("li");
    status.className = "quick-open-empty";
    status.setAttribute("role", "presentation");
    status.textContent = message;
    quickOpenList.replaceChildren(status);
    quickOpenFooter.hidden = true;
    pickerRows = [];
    activeIndex = -1;
    quickOpenInput.removeAttribute("aria-activedescendant");
  }

  function markPickerActive() {
    const items = quickOpenList.querySelectorAll(".quick-open-item");
    items.forEach((item, index) => {
      const isActive = index === activeIndex;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-selected", String(isActive));
      if (isActive) {
        quickOpenInput.setAttribute("aria-activedescendant", item.id);
        item.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function renderPicker() {
    const query = quickOpenInput.value.trim();
    const previousPath = pickerRows[activeIndex]?.path;
    const showingRecents = !query;
    if (!query) {
      if (!recents.length) {
        showPickerMessage("Type to search files");
        return;
      }
      pickerRows = recents.map((path) => ({ path, score: 0, matches: [] }));
    } else {
      pickerRows = globalThis.MinoFuzzy.filter(query, fileIndex, recents);
      if (!pickerRows.length) {
        showPickerMessage("No matching files.");
        return;
      }
    }

    quickOpenList.replaceChildren();
    pickerRows.forEach((row, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.id = `quick-open-${index}`;
      button.className = "quick-open-item";
      button.setAttribute("role", "option");
      button.dataset.path = row.path;

      const chip = document.createElement("span");
      chip.className = fileChipClass(row.path);
      chip.setAttribute("aria-hidden", "true");

      const name = document.createElement("span");
      name.className = "quick-open-name";
      const base = basename(row.path);
      const baseOffset = row.path.length - base.length;
      appendHighlighted(name, base, row.matches, baseOffset);

      button.append(chip, name);
      const parent = parentDir(row.path);
      if (parent) {
        const dir = document.createElement("span");
        dir.className = "quick-open-dir";
        appendHighlighted(dir, parent, row.matches, 0);
        button.append(dir);
      }
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("pointerenter", () => {
        activeIndex = index;
        markPickerActive();
      });
      button.addEventListener("click", () => acceptPath(row.path));
      item.append(button);
      quickOpenList.append(item);
    });

    quickOpenFooter.hidden = !showingRecents;
    const restored = previousPath
      ? pickerRows.findIndex((row) => row.path === previousPath)
      : -1;
    activeIndex = restored >= 0 ? restored : 0;
    markPickerActive();
  }

  function moveActive(delta) {
    if (!pickerRows.length) return;
    const next = activeIndex + delta;
    if (next < 0 || next >= pickerRows.length) return;
    activeIndex = next;
    markPickerActive();
  }

  function acceptPath(path) {
    if (!fileIndex.includes(path)) {
      forgetPath(path);
      renderPicker();
      return;
    }
    for (const ancestor of ancestorPaths(path)) expandedPaths.add(ancestor);
    openFile(path);
    renderTreeFromCache();
    setPickerOpen(false);
    preview.focus();
  }

  function acceptActive() {
    if (activeIndex < 0 || activeIndex >= pickerRows.length) return;
    acceptPath(pickerRows[activeIndex].path);
  }

  function isQuickOpenHotkey(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
    const key = event.key;
    return key === "e" || key === "E" || key === "p" || key === "P";
  }

  function onQuickOpenHotkey(event) {
    if (!isQuickOpenHotkey(event)) return;
    event.preventDefault();
    setPickerOpen(true);
    renderPicker();
    quickOpenInput.focus();
    quickOpenInput.select();
  }

  function bindPreviewHotkeys() {
    try {
      const doc = preview.contentDocument;
      if (!doc) return;
      doc.addEventListener("keydown", onQuickOpenHotkey, true);
    } catch (_error) {
      // Same-origin read can fail; skip silently.
    }
  }

  activityFiles.addEventListener("click", toggleSidebar);
  sidebarCollapse.addEventListener("click", () => setSidebarCollapsed(true));

  commandCenter.addEventListener("click", () => {
    setPickerOpen(true);
    renderPicker();
    quickOpenInput.focus();
  });

  quickOpenInput.addEventListener("input", () => {
    if (!pickerOpen) setPickerOpen(true);
    pickerRows = [];
    activeIndex = 0;
    renderPicker();
  });
  quickOpenInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      if (!pickerRows.length) return;
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      if (!pickerRows.length) return;
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      acceptActive();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setPickerOpen(false);
    }
  });

  document.addEventListener("keydown", onQuickOpenHotkey, true);
  preview.addEventListener("load", bindPreviewHotkeys);

  document.addEventListener("pointerdown", (event) => {
    if (!pickerOpen) return;
    if (quickOpen.contains(event.target) || commandCenter.contains(event.target)) return;
    setPickerOpen(false);
  });
  document.addEventListener("focusin", (event) => {
    if (!pickerOpen) return;
    if (quickOpen.contains(event.target) || commandCenter.contains(event.target)) return;
    setPickerOpen(false);
  });
```

Keep SSE handling and `loadMeta(); loadTree();` at the bottom unchanged. `renderPicker()` is still called from `loadTree` when `pickerOpen` is true.

Delete every remaining reference to `search` and `searchWrap`.

- [ ] **Step 4: Run contract tests and the full relevant suite**

Run:

```bash
go test ./internal/ui/ -run TestFuzzyScore -count=1
go test ./internal/server/ -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts|TestFuzzyJSServed' -count=1
go test ./internal/integration/ -count=1
```

Expected: all PASS. `TestAppJSWorkbenchContracts` must still forbid `/api/search` and Ctrl/Cmd+F intercepts.

- [ ] **Step 5: Manual check (do not skip)**

Run: `go run ./cmd/mino ./example`

1. Top bar center shows the workspace name (not a search field); brand is only **M**.
2. Click the name: overlay covers it, input placeholder is `Search files by name`, empty recents shows `Type to search files`.
3. Open `tools/timer.html` from the tree, click Command Center: recents list + footer `recently opened`.
4. Type `ttr` and `tools timer`; arrows + Enter open the file; Explorer expands and selects it; overlay closes.
5. `Ctrl+E` / `Ctrl+P` (Cmd on macOS) open the overlay and select-all, including after clicking into the preview iframe.
6. Escape / click outside closes; Command Center again shows the workspace name.
7. `Ctrl+F` opens browser find.

- [ ] **Step 6: Commit**

```bash
git add internal/ui/app.js internal/server/server_test.go
git commit -m "$(cat <<'EOF'
feat(ui): open covering Quick Open from the Command Center

EOF
)"
```

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| Command Center shows workspace name; `#title` sr-only | 2, 3 (`loadMeta`) |
| Overlay covers Command Center with own input + list | 2, 3 |
| Single-line rows, type chips, `#4fc1ff` marks, `#37373d` active | 2, 3 |
| Compact match pick, whitespace tokens, recents `20 - i` | 1 |
| Session recents max 10, reveal-in-tree, iframe `E`/`P` | 3 (keep existing helpers) |
| No `/api/search`, no command palette, no Ctrl+F intercept | 3 tests |
| Empty / no-match / recents footer copy | 3 |
| Cap 50, arrows do not wrap, missing path dropped | 1 + existing acceptPath |
| `/api/meta` failure → Command Center stays `mino` | 3 (markup default; catch leaves it) |
| Whitespace-only query treated as empty | 1 + `trim()` in `renderPicker` |
