# Mino Top-Bar Quick Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top-bar path filter with a VS Code–like Quick Open overlay (fuzzy file jump, session recents, `Ctrl/Cmd+E`/`P` including iframe focus) without changing backend search.

**Architecture:** Cache a flat file list from `/api/tree` in the shell. Rank in `internal/ui/fuzzy.js`. Render results in `#quick-open` under the existing top-bar search box. Explorer stays a directory tree. Recents and keyboard handling live in `app.js`. `GET /api/search` is left unchanged and unused by the UI.

**Tech Stack:** Vanilla HTML/CSS/JS embedded with `go:embed`; Node `--test` for the scorer; `go test` structural markers for HTML/JS/routes.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-23-mino-quick-open-design.md`
- No frontend build step; no npm fuzzy libraries; no Playwright.
- Do not change `GET /api/search` or catalog substring semantics.
- No command palette, content search, or recents persistence (`localStorage`/disk).
- Empty-query copy: `Type to search files`. No-match copy: `No matching files.`
- Recents: in-memory, max 10, most recent first, unique by path.
- Result cap: 50. Arrow keys stop at ends (no wrap).
- Hotkeys: `Ctrl/Cmd+E` and `Ctrl/Cmd+P` only (not Alt/Shift). Do not intercept `Ctrl/Cmd+F`.
- Match highlight color: `--fg-strong`. Selected row: `--selection`. Overlay background: `--search-bg`.
- English UI strings only, matching the existing chrome.

---

## File Structure

```text
internal/ui/fuzzy.js                 # New. Pure scorer + filter (UMD like preprocess.js)
internal/ui/testdata/fuzzy_test.mjs  # New. Node tests for MinoFuzzy
internal/ui/fuzzy_node_test.go       # New. go test wrapper → node --test
internal/ui/index.html               # search-wrap + #quick-open + /fuzzy.js script
internal/ui/style.css                # overlay / row / mark styles
internal/ui/app.js                   # index, overlay, recents, hotkeys, reveal; drop tree filter
internal/ui/embed.go                 # embed fuzzy.js
internal/server/server.go            # GET /fuzzy.js
internal/server/server_test.go       # index + /fuzzy.js + app.js contract markers
```

Do not modify catalog, watcher, config, or `/api/search` handlers.

---

### Task 1: Fuzzy scorer

**Files:**
- Create: `internal/ui/fuzzy.js`
- Create: `internal/ui/testdata/fuzzy_test.mjs`
- Create: `internal/ui/fuzzy_node_test.go`
- Test: `internal/ui/fuzzy_node_test.go` (runs the Node file)

**Interfaces:**
- Consumes: nothing from later tasks
- Produces: `MinoFuzzy.score(query, path)` → `{ score: number, matches: number[] } | null`; `MinoFuzzy.filter(query, paths)` → `{ path, score, matches }[]` sorted score desc then path asc, capped at 50. Empty query returns `[]` without scoring.

Scoring (verbatim from spec):

- Case-insensitive subsequence; every query character must appear in order.
- `+1` per matched character
- `+4` if consecutive with the previous match
- `+6` if at start of basename, or immediately after `/`, `.`, `-`, or `_` (apply once per character; do not double-count)
- `+8` extra if the match index is in the basename
- Non-matches return `null` / are excluded

- [ ] **Step 1: Write the failing Node tests and Go wrapper**

Create `internal/ui/fuzzy_node_test.go` (same pattern as `preprocess_node_test.go`):

```go
package ui_test

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestFuzzyScore(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	testFile := filepath.Join(filepath.Dir(file), "testdata", "fuzzy_test.mjs")
	cmd := exec.Command("node", "--test", testFile)
	cmd.Dir = filepath.Dir(testFile)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("node --test: %v\n%s", err, out)
	}
}
```

Create `internal/ui/testdata/fuzzy_test.mjs`:

```js
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const { score, filter } = createRequire(import.meta.url)("../fuzzy.js");

test("empty query returns no rows and does not score", () => {
  assert.deepEqual(filter("", ["tools/timer.html", "hello.html"]), []);
  assert.equal(score("", "hello.html"), null);
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/ui -run TestFuzzyScore -count=1`

Expected: FAIL (missing `../fuzzy.js` or `Cannot find module`).

- [ ] **Step 3: Implement `internal/ui/fuzzy.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/ui -run TestFuzzyScore -count=1`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/ui/fuzzy.js internal/ui/testdata/fuzzy_test.mjs internal/ui/fuzzy_node_test.go
git commit -m "$(cat <<'EOF'
feat(ui): add basename-weighted fuzzy file scorer

EOF
)"
```

---

### Task 2: Overlay markup, CSS, and `/fuzzy.js` route

**Files:**
- Modify: `internal/ui/index.html`
- Modify: `internal/ui/style.css`
- Modify: `internal/ui/embed.go`
- Modify: `internal/server/server.go`
- Modify: `internal/server/server_test.go` (`TestUIIndexServed`; add `TestFuzzyJSServed`)
- Test: `internal/server/server_test.go`

**Interfaces:**
- Consumes: `internal/ui/fuzzy.js` from Task 1
- Produces: DOM `#quick-open` inside `.search-wrap`; `GET /fuzzy.js`; `#search` combobox attributes `aria-expanded`, `aria-controls="quick-open"`, `role="combobox"`, `aria-autocomplete="list"`

- [ ] **Step 1: Extend structural tests (they must fail)**

In `TestUIIndexServed`, add these markers to the existing slice (keep current ones):

```go
`id="quick-open"`,
`/fuzzy.js`,
`class="search-wrap"`,
```

Add this test next to `TestUIIndexServed`:

```go
func TestFuzzyJSServed(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/fuzzy.js")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	js := string(body)
	if !strings.Contains(js, "MinoFuzzy") {
		t.Fatal("fuzzy.js missing MinoFuzzy")
	}
	if !strings.Contains(js, "function filter") {
		t.Fatal("fuzzy.js missing filter")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/server -run 'TestUIIndexServed|TestFuzzyJSServed' -count=1`

Expected: FAIL with `index missing "id=\"quick-open\""` (or 404 on `/fuzzy.js`).

- [ ] **Step 3: Embed and serve `fuzzy.js`**

In `internal/ui/embed.go`, add `fuzzy.js` to the first embed line:

```go
//go:embed index.html app.js style.css fuzzy.js
```

In `internal/server/server.go` `Handler()`, next to the `/app.js` route:

```go
mux.HandleFunc("GET /fuzzy.js", embeddedAssetHandler("fuzzy.js", "text/javascript; charset=utf-8"))
```

- [ ] **Step 4: Rewrite the top-bar search markup**

Replace the current `<label class="search-box">…</label>` in `internal/ui/index.html` with:

```html
    <div class="search-wrap">
      <div class="search-box">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <span class="sr-only">Search files</span>
        <input
          id="search"
          type="search"
          placeholder="Search files…"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="false"
          aria-controls="quick-open"
        >
      </div>
      <ul id="quick-open" role="listbox" hidden></ul>
    </div>
```

Keep `>Search files</span>` so `TestUIIndexServed` still matches.

Before `/app.js`, add:

```html
  <script src="/fuzzy.js" defer></script>
  <script src="/app.js" defer></script>
```

(Remove the old single `/app.js` script tag so it is not duplicated.)

- [ ] **Step 5: Add overlay CSS**

In `internal/ui/style.css`, change `.search-box` so width lives on the wrapper (overlay must match the box):

Replace the `.search-box` / `.search-box:focus-within` / `.search-box input` / `.search-icon` block with:

```css
.search-wrap {
  grid-column: 2;
  justify-self: center;
  position: relative;
  width: min(420px, 46vw);
}
.search-box {
  height: 26px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  color: var(--fg-muted);
  background: var(--search-bg);
  border: 1px solid #3c3c3c;
  border-radius: 5px;
}
.search-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(0, 120, 212, 0.35);
}
.search-box input {
  width: 100%;
  color: var(--fg);
  background: transparent;
  border: 0;
  outline: 0;
  font: inherit;
}
.search-box input::placeholder { color: var(--fg-muted); }
.search-icon { font-size: 14px; line-height: 1; }

#quick-open {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 320px;
  overflow: auto;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background: var(--search-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
#quick-open[hidden] { display: none !important; }
.quick-open-empty {
  margin: 0;
  padding: 8px 12px;
  color: var(--fg-muted);
  font-size: 12px;
}
.quick-open-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 6px 12px;
  color: var(--fg);
  background: transparent;
  border: 0;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.quick-open-item:hover,
.quick-open-item.active {
  background: var(--selection);
}
.quick-open-name {
  overflow: hidden;
  color: var(--fg);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quick-open-name mark {
  color: var(--fg-strong);
  background: transparent;
  font-weight: 700;
}
.quick-open-dir {
  overflow: hidden;
  color: var(--fg-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quick-open-dir mark {
  color: var(--fg);
  background: transparent;
  font-weight: 600;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `go test ./internal/server -run 'TestUIIndexServed|TestFuzzyJSServed|TestAppJSWorkbenchContracts' -count=1`

Expected: PASS (`TestAppJSWorkbenchContracts` still passes; `app.js` is unchanged in this task).

- [ ] **Step 7: Commit**

```bash
git add internal/ui/index.html internal/ui/style.css internal/ui/embed.go internal/server/server.go internal/server/server_test.go
git commit -m "$(cat <<'EOF'
feat(ui): add Quick Open overlay shell and serve fuzzy.js

EOF
)"
```

---

### Task 3: Wire Quick Open in `app.js`

**Files:**
- Modify: `internal/ui/app.js`
- Modify: `internal/server/server_test.go` (`TestAppJSWorkbenchContracts`)
- Test: `internal/server/server_test.go`

**Interfaces:**
- Consumes: `globalThis.MinoFuzzy.filter(query, paths)` from Task 1; `#quick-open`, `.search-wrap`, combobox attributes from Task 2
- Produces: `fileIndex` rebuilt from `/api/tree`; session `recents` (max 10); `openQuickOpen` via `Ctrl/Cmd+E`/`P` on `document` capture and on `preview.contentDocument` after `load`; Explorer re-render from cached tree (no extra `/api/tree` on accept)

- [ ] **Step 1: Tighten `TestAppJSWorkbenchContracts` (must fail)**

Replace the `app.js` marker loop in `TestAppJSWorkbenchContracts` with:

```go
	js := string(body)
	if strings.Contains(js, "sidebar.hidden =") {
		t.Fatal("app.js must not set sidebar.hidden (breaks workbench grid)")
	}
	if strings.Contains(js, "/api/search") {
		t.Fatal("app.js must not call /api/search")
	}
	if strings.Contains(js, `key !== "f"`) || strings.Contains(js, `key !== 'f'`) {
		t.Fatal("app.js must not intercept Ctrl/Cmd+F")
	}
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
		`key === "e"`,
		`key === "p"`,
	} {
		if !strings.Contains(js, marker) {
			t.Fatalf("app.js missing contract %q", marker)
		}
	}
```

Keep the existing `style.css` contract assertions unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/server -run TestAppJSWorkbenchContracts -count=1`

Expected: FAIL with `app.js must not call /api/search` or `app.js missing contract "MinoFuzzy"`.

- [ ] **Step 3: Replace `internal/ui/app.js`**

Write the full file (do not leave `loadSearch` / `scheduleSearchListing` / `refreshListing` / `Ctrl+F`):

```js
(() => {
  "use strict";

  const title = document.querySelector("#title");
  const search = document.querySelector("#search");
  const searchWrap = document.querySelector(".search-wrap");
  const quickOpen = document.querySelector("#quick-open");
  const tree = document.querySelector("#tree");
  const preview = document.querySelector("#preview");
  const breadcrumb = document.querySelector("#breadcrumb");
  const activityFiles = document.querySelector("#activity-files");
  const sidebar = document.querySelector("#sidebar");
  const sidebarCollapse = document.querySelector("#sidebar-collapse");
  const emptyState = document.querySelector("#empty-state");
  const watchBanner = document.querySelector("#watch-banner");

  const expandedPaths = new Set([""]);
  let currentPath = "";
  let listingAbort = null;
  let listingRequestId = 0;
  let lastTree = null;
  let fileIndex = [];
  let recents = [];
  let pickerOpen = false;
  let activeIndex = -1;
  let pickerRows = [];

  function previewURL(path) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `/apps/${encoded}?t=${Date.now()}`;
  }

  function invalidateListingRequest() {
    if (listingAbort) {
      listingAbort.abort();
      listingAbort = null;
    }
    listingRequestId += 1;
  }

  function beginListingRequest() {
    invalidateListingRequest();
    listingAbort = new AbortController();
    return { signal: listingAbort.signal, requestId: listingRequestId };
  }

  function isStaleListingRequest(requestId) {
    return requestId !== listingRequestId;
  }

  function setSidebarCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    activityFiles.setAttribute("aria-expanded", String(!collapsed));
    activityFiles.classList.toggle("active", !collapsed);
    sidebar.inert = collapsed;
    if (collapsed && sidebar.contains(document.activeElement)) {
      activityFiles.focus();
    }
  }

  function toggleSidebar() {
    setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
  }

  function setBreadcrumb(path) {
    if (!path) {
      breadcrumb.textContent = "No file selected";
      breadcrumb.dataset.empty = "true";
      return;
    }
    breadcrumb.textContent = path.split("/").join(" / ");
    breadcrumb.dataset.empty = "false";
  }

  function rememberOpen(path) {
    recents = [path, ...recents.filter((item) => item !== path)].slice(0, 10);
  }

  function forgetPath(path) {
    recents = recents.filter((item) => item !== path);
  }

  function openFile(path) {
    rememberOpen(path);
    currentPath = path;
    setBreadcrumb(path);
    preview.src = previewURL(path);
    preview.hidden = false;
    emptyState.hidden = true;
    markSelection();
  }

  function clearPreview() {
    currentPath = "";
    preview.removeAttribute("src");
    preview.hidden = true;
    emptyState.hidden = false;
    setBreadcrumb("");
    markSelection();
  }

  function markSelection() {
    tree.querySelectorAll(".tree-row.file").forEach((row) => {
      row.classList.toggle("selected", row.dataset.path === currentPath);
    });
  }

  function flattenFiles(node, out) {
    if (!node) return out;
    if (node.type === "file" && node.path) out.push(node.path);
    for (const child of node.children || []) flattenFiles(child, out);
    return out;
  }

  function ancestorPaths(path) {
    const parts = path.split("/");
    const ancestors = [""];
    for (let i = 0; i < parts.length - 1; i += 1) {
      ancestors.push(parts.slice(0, i + 1).join("/"));
    }
    return ancestors;
  }

  function basename(path) {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? path : path.slice(slash + 1);
  }

  function parentDir(path) {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? "" : path.slice(0, slash);
  }

  function makeRow(node) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `tree-row ${node.type}`;
    row.dataset.path = node.path;
    row.title = node.path || node.name;

    const indicator = document.createElement("span");
    indicator.className = node.type === "dir" ? "chevron" : "file-icon";
    indicator.setAttribute("aria-hidden", "true");
    indicator.textContent = node.type === "dir" ? "▶" : "◇";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = node.name;
    row.append(indicator, label);

    if (node.type === "file") {
      row.classList.toggle("selected", node.path === currentPath);
      row.addEventListener("click", () => openFile(node.path));
      return row;
    }

    const children = document.createElement("ul");
    children.className = "tree-list";
    for (const child of node.children || []) {
      children.append(makeNode(child));
    }

    const expanded = expandedPaths.has(node.path);
    row.classList.toggle("expanded", expanded);
    row.setAttribute("aria-expanded", String(expanded));
    children.hidden = !expanded;
    row.addEventListener("click", () => {
      const willExpand = children.hidden;
      children.hidden = !willExpand;
      row.classList.toggle("expanded", willExpand);
      row.setAttribute("aria-expanded", String(willExpand));
      if (willExpand) expandedPaths.add(node.path);
      else expandedPaths.delete(node.path);
    });

    const wrapper = document.createElement("li");
    wrapper.append(row, children);
    return wrapper;
  }

  function makeNode(node) {
    if (node.type === "dir") return makeRow(node);
    const item = document.createElement("li");
    item.append(makeRow(node));
    return item;
  }

  function showMessage(message) {
    tree.replaceChildren();
    const status = document.createElement("p");
    status.className = "muted";
    status.textContent = message;
    tree.append(status);
  }

  function renderTreeFromCache() {
    if (!lastTree) {
      loadTree();
      return;
    }
    const list = document.createElement("ul");
    list.className = "tree-list";
    for (const node of lastTree.children || []) {
      list.append(makeNode(node));
    }
    tree.replaceChildren(list);
    if (!list.children.length) showMessage("No HTML files found.");
    markSelection();
  }

  async function loadTree() {
    const { signal, requestId } = beginListingRequest();
    try {
      const response = await fetch("/api/tree", { signal });
      if (isStaleListingRequest(requestId)) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const root = await response.json();
      if (isStaleListingRequest(requestId)) return;
      lastTree = root;
      fileIndex = flattenFiles(root, []);
      renderTreeFromCache();
      if (pickerOpen) renderPicker();
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Failed to load tree", error);
      showMessage("Could not load files.");
    }
  }

  async function loadMeta() {
    try {
      const response = await fetch("/api/meta");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const meta = await response.json();
      title.textContent = meta.name || "mino";
      document.title = `${meta.name || "mino"} · mino`;
      watchBanner.hidden = Boolean(meta.watchEnabled);
    } catch (error) {
      console.error("Failed to load metadata", error);
    }
  }

  function appendHighlighted(container, text, matches, offset) {
    const local = new Set();
    for (const index of matches) {
      if (index >= offset && index < offset + text.length) local.add(index - offset);
    }
    let i = 0;
    while (i < text.length) {
      if (local.has(i)) {
        let j = i + 1;
        while (j < text.length && local.has(j)) j += 1;
        const mark = document.createElement("mark");
        mark.textContent = text.slice(i, j);
        container.append(mark);
        i = j;
      } else {
        let j = i + 1;
        while (j < text.length && !local.has(j)) j += 1;
        container.append(text.slice(i, j));
        i = j;
      }
    }
  }

  function setPickerOpen(open) {
    if (open) {
      pickerOpen = true;
      quickOpen.hidden = false;
      search.setAttribute("aria-expanded", "true");
      return;
    }
    pickerOpen = false;
    quickOpen.hidden = true;
    search.setAttribute("aria-expanded", "false");
    search.value = "";
    search.removeAttribute("aria-activedescendant");
    activeIndex = -1;
    pickerRows = [];
    quickOpen.replaceChildren();
  }

  function showPickerMessage(message) {
    const status = document.createElement("p");
    status.className = "quick-open-empty";
    status.textContent = message;
    quickOpen.replaceChildren(status);
    pickerRows = [];
    activeIndex = -1;
    search.removeAttribute("aria-activedescendant");
  }

  function markPickerActive() {
    const items = quickOpen.querySelectorAll(".quick-open-item");
    items.forEach((item, index) => {
      const isActive = index === activeIndex;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-selected", String(isActive));
      if (isActive) {
        search.setAttribute("aria-activedescendant", item.id);
        item.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function renderPicker() {
    const query = search.value.trim();
    if (!query) {
      if (!recents.length) {
        showPickerMessage("Type to search files");
        return;
      }
      pickerRows = recents.map((path) => ({ path, score: 0, matches: [] }));
    } else {
      pickerRows = globalThis.MinoFuzzy.filter(query, fileIndex);
      if (!pickerRows.length) {
        showPickerMessage("No matching files.");
        return;
      }
    }

    quickOpen.replaceChildren();
    pickerRows.forEach((row, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.id = `quick-open-${index}`;
      button.className = "quick-open-item";
      button.setAttribute("role", "option");
      button.dataset.path = row.path;

      const name = document.createElement("span");
      name.className = "quick-open-name";
      const base = basename(row.path);
      const baseOffset = row.path.length - base.length;
      appendHighlighted(name, base, row.matches, baseOffset);

      const dir = document.createElement("span");
      dir.className = "quick-open-dir";
      const parent = parentDir(row.path);
      if (parent) appendHighlighted(dir, parent, row.matches, 0);

      button.append(name);
      if (parent) button.append(dir);
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => acceptPath(row.path));
      item.append(button);
      quickOpen.append(item);
    });

    if (activeIndex < 0 || activeIndex >= pickerRows.length) activeIndex = 0;
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
    search.focus();
    search.select();
    setPickerOpen(true);
    renderPicker();
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

  search.addEventListener("focus", () => {
    setPickerOpen(true);
    renderPicker();
  });
  search.addEventListener("input", () => {
    if (!pickerOpen) setPickerOpen(true);
    activeIndex = 0;
    renderPicker();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      acceptActive();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setPickerOpen(false);
      search.blur();
    }
  });

  document.addEventListener("keydown", onQuickOpenHotkey, true);
  preview.addEventListener("load", bindPreviewHotkeys);

  document.addEventListener("pointerdown", (event) => {
    if (!pickerOpen) return;
    if (searchWrap.contains(event.target)) return;
    setPickerOpen(false);
  });
  document.addEventListener("focusin", (event) => {
    if (!pickerOpen) return;
    if (searchWrap.contains(event.target)) return;
    setPickerOpen(false);
  });

  const events = new EventSource("/api/events");
  for (const kind of ["added", "removed", "changed"]) {
    events.addEventListener(kind, (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch (error) {
        console.error("Invalid live reload event", error);
        return;
      }
      if (kind === "removed") forgetPath(event.path);
      loadTree();
      if (event.path !== currentPath) return;
      if (kind === "changed") preview.src = previewURL(currentPath);
      if (kind === "removed") clearPreview();
    });
  }

  setSidebarCollapsed(false);
  loadMeta();
  loadTree();
})();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/server -run 'TestUIIndexServed|TestFuzzyJSServed|TestAppJSWorkbenchContracts' -count=1`

Expected: PASS

Run: `go test ./internal/ui -run TestFuzzyScore -count=1`

Expected: PASS

Run: `go test ./...`

Expected: PASS (including unchanged `/api/search` catalog, server, and e2e tests).

- [ ] **Step 5: Manual check**

Run: `go run ./cmd/mino ./example`

Open the printed URL and verify:

1. `Ctrl+E` / `Ctrl+P` (Cmd on macOS) opens the dropdown; Explorer stays a tree.
2. Click into the preview, then the same shortcuts still open Quick Open.
3. `ttr` ranks `tools/timer.html`; arrows + Enter open it; Explorer expands and selects it.
4. Escape / click outside closes and clears the query.
5. Empty query shows recents after opening a file; reload of the Mino page clears recents.
6. `Ctrl+F` opens browser find, not the top-bar box.
7. Editing/removing a file on disk updates the index; removing the open file still clears preview.

- [ ] **Step 6: Commit**

```bash
git add internal/ui/app.js internal/server/server_test.go
git commit -m "$(cat <<'EOF'
feat(ui): jump to files from a Quick Open overlay

EOF
)"
```

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| Overlay under top-bar search; tree unchanged | 2, 3 |
| Fuzzy subsequence, basename-weighted, cap 50, highlight indexes | 1, 3 |
| `Ctrl/Cmd+E` and `P`; iframe `contentDocument` capture; no `Ctrl/Cmd+F` | 3 |
| Session recents max 10; empty copy / no-match copy | 3 |
| Accept → open, expand ancestors, select, focus iframe, clear query | 3 |
| UI does not call `/api/search`; endpoint unchanged | 3 (do-not-touch catalog/server search) |
| `GET /fuzzy.js` + `#quick-open` tests | 2 |
| Node scorer tests | 1 |
| Cached tree re-render (no extra fetch on accept) | 3 |
| `mousedown.preventDefault` on rows; close on outside pointer/focus | 3 |
| Skip iframe bind when `contentDocument` unavailable | 3 |

## Placeholder / type check

- `MinoFuzzy.score` / `MinoFuzzy.filter` names are identical in Tasks 1 and 3.
- Overlay id is `#quick-open` in Tasks 2 and 3.
- Recents max 10, result cap 50, copy strings, and hotkeys match the spec.
