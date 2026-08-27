# Status Bar and Markdown Preview Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Dark Modern workbench status bar on every view, and a Markdown-only 标宽 / 较宽 / 全宽 control that persists in `localStorage` and resizes the iframe article without reload.

**Architecture:** Shared UMD helpers in `internal/ui/md/preview-width.js` parse storage, Markdown paths, and `postMessage`. The shell footer owns the menu and writes `mino-md-preview-width`; the Markdown viewer sets `document.documentElement` `data-md-width` on boot and on message. CSS in `viewer.css` maps `standard` / `wide` / `full` to 960px / 1400px / uncapped. Outline stays on the right.

**Tech Stack:** Vanilla HTML/CSS/JS via `go:embed`; Node `node:test` for helpers; Go `server_test` string contracts. No npm packages, no Playwright, no `config.toml`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-27-mino-status-bar-md-preview-width-design.md`
- Status bar: full window width, **22px**, `--bg-shell` (`#181818`), top border `--border` (`#2b2b2b`). Not `#007ACC`.
- Width labels (Chinese only for this control): **标宽** / **较宽** / **全宽**. Default **较宽**.
- Storage key: `mino-md-preview-width`. Values: `standard` | `wide` | `full`. Invalid/missing → `wide`.
- Article caps: 标宽 **960px**, 较宽 **1400px**, 全宽 none. Outline remains in all three modes.
- Message: `{ source: "mino", type: "md-preview-width", value }`. Accept only same `event.origin` as `window.location.origin`.
- Do not reload the Markdown iframe to apply width. Do not change catalog, watcher, config, or `/apps/` routing beyond embedding the new JS file.
- No language-mode items, per-file width, dedicated width shortcut, or width UI inside the iframe chrome.
- Prefer TDD; commit after each task.

---

## File Structure

```text
internal/ui/md/preview-width.js          # NEW: parse/read/write width, path check, message helpers (UMD)
internal/ui/testdata/preview_width_test.mjs
internal/ui/preview_width_node_test.go   # NEW: go test wrapper → node --test
internal/ui/embed.go                     # Add md/preview-width.js
internal/ui/index.html                   # footer.status-bar + script tag
internal/ui/style.css                    # status bar + menu
internal/ui/app.js                       # show/hide, menu, storage, postMessage, iframe load
internal/ui/md/viewer.html               # script /md/preview-width.js
internal/ui/md/viewer.js                 # boot apply + message listener
internal/ui/md/viewer.css                # data-md-width rules; drop 860/1120
internal/server/server_test.go           # HTML/JS/CSS/asset contracts
README.md                                # one paragraph on preview width
```

Do not modify catalog, watcher, config, fuzzy.js, Quick Open ranking, or Mermaid camera code.

---

### Task 1: Shared preview-width helpers

**Files:**
- Create: `internal/ui/testdata/preview_width_test.mjs`
- Create: `internal/ui/preview_width_node_test.go`
- Create: `internal/ui/md/preview-width.js`
- Modify: `internal/ui/embed.go`
- Modify: `internal/server/server_test.go` (`TestMDVendorAssetsServed`)

**Interfaces:**
- Consumes: nothing
- Produces: `globalThis.MinoMDPreviewWidth` / `module.exports` with:
  - `STORAGE_KEY` = `"mino-md-preview-width"`
  - `DEFAULT_WIDTH` = `"wide"`
  - `WIDTH_LABELS` = `{ standard: "标宽", wide: "较宽", full: "全宽" }`
  - `parsePreviewWidth(value) → "standard"|"wide"|"full"`
  - `isMarkdownPath(path) → boolean`
  - `readPreviewWidth(storage) → mode`
  - `writePreviewWidth(storage, mode) → mode`
  - `applyPreviewWidth(root, mode) → mode`
  - `previewWidthMessage(value) → { source, type, value }`
  - `parsePreviewWidthMessage(data, origin, expectedOrigin) → mode|null`

- [ ] **Step 1: Write the failing Node tests**

Create `internal/ui/testdata/preview_width_test.mjs`:

```js
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const {
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
} = createRequire(import.meta.url)("../md/preview-width.js");

test("constants", () => {
  assert.equal(STORAGE_KEY, "mino-md-preview-width");
  assert.equal(DEFAULT_WIDTH, "wide");
  assert.deepEqual(WIDTH_LABELS, { standard: "标宽", wide: "较宽", full: "全宽" });
});

test("parsePreviewWidth accepts three modes", () => {
  assert.equal(parsePreviewWidth("standard"), "standard");
  assert.equal(parsePreviewWidth("wide"), "wide");
  assert.equal(parsePreviewWidth("full"), "full");
});

test("parsePreviewWidth defaults invalid values to wide", () => {
  assert.equal(parsePreviewWidth(""), "wide");
  assert.equal(parsePreviewWidth(null), "wide");
  assert.equal(parsePreviewWidth("WIDE"), "wide");
  assert.equal(parsePreviewWidth("narrow"), "wide");
});

test("isMarkdownPath", () => {
  assert.equal(isMarkdownPath("docs/sample.md"), true);
  assert.equal(isMarkdownPath("README.MD"), true);
  assert.equal(isMarkdownPath("app.html"), false);
  assert.equal(isMarkdownPath("note.md.html"), false);
  assert.equal(isMarkdownPath(""), false);
});

function memoryStorage(initial) {
  const store = new Map(Object.entries(initial || {}));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

test("readPreviewWidth reads and parses", () => {
  const storage = memoryStorage({ "mino-md-preview-width": "full" });
  assert.equal(readPreviewWidth(storage), "full");
});

test("readPreviewWidth defaults when missing or storage throws", () => {
  assert.equal(readPreviewWidth(memoryStorage()), "wide");
  assert.equal(
    readPreviewWidth({
      getItem() {
        throw new Error("denied");
      },
    }),
    "wide"
  );
});

test("writePreviewWidth stores parsed mode", () => {
  const storage = memoryStorage();
  assert.equal(writePreviewWidth(storage, "standard"), "standard");
  assert.equal(storage.getItem("mino-md-preview-width"), "standard");
  assert.equal(writePreviewWidth(storage, "nope"), "wide");
  assert.equal(storage.getItem("mino-md-preview-width"), "wide");
});

test("writePreviewWidth swallows setItem throw", () => {
  assert.equal(
    writePreviewWidth(
      {
        setItem() {
          throw new Error("quota");
        },
      },
      "full"
    ),
    "full"
  );
});

test("applyPreviewWidth sets data-md-width", () => {
  const el = {
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  assert.equal(applyPreviewWidth(el, "standard"), "standard");
  assert.equal(el.attrs["data-md-width"], "standard");
  assert.equal(applyPreviewWidth(null, "full"), "full");
});

test("previewWidthMessage", () => {
  assert.deepEqual(previewWidthMessage("full"), {
    source: "mino",
    type: "md-preview-width",
    value: "full",
  });
  assert.equal(previewWidthMessage("x").value, "wide");
});

test("parsePreviewWidthMessage", () => {
  const origin = "http://127.0.0.1:9";
  assert.equal(
    parsePreviewWidthMessage(
      { source: "mino", type: "md-preview-width", value: "full" },
      origin,
      origin
    ),
    "full"
  );
  assert.equal(
    parsePreviewWidthMessage(
      { source: "mino", type: "md-preview-width", value: "full" },
      "http://evil.example",
      origin
    ),
    null
  );
  assert.equal(
    parsePreviewWidthMessage({ type: "md-preview-width", value: "full" }, origin, origin),
    null
  );
  assert.equal(
    parsePreviewWidthMessage(
      { source: "mino", type: "md-preview-width", value: "narrow" },
      origin,
      origin
    ),
    null
  );
});
```

Create `internal/ui/preview_width_node_test.go` (same pattern as `internal/ui/toc_node_test.go`):

```go
package ui_test

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestPreviewWidthHelpers(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	testFile := filepath.Join(filepath.Dir(file), "testdata", "preview_width_test.mjs")
	cmd := exec.Command("node", "--test", testFile)
	cmd.Dir = filepath.Dir(testFile)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("node --test: %v\n%s", err, out)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/ui/ -run TestPreviewWidthHelpers -count=1`

Expected: FAIL because `internal/ui/md/preview-width.js` does not exist (`Cannot find module`).

- [ ] **Step 3: Implement the UMD module**

Create `internal/ui/md/preview-width.js`:

```js
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
    return WIDTHS[v] ? v : DEFAULT_WIDTH;
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
    if (!WIDTHS[data.value]) return null;
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
```

In `internal/ui/embed.go`, add `md/preview-width.js` to the second `go:embed` line:

```go
//go:embed md/viewer.html md/viewer.js md/viewer.css md/preprocess.js md/toc.js md/mermaid-block.js md/preview-width.js
```

In `TestMDVendorAssetsServed`, add `"/md/preview-width.js"` to the path list (after `"/md/toc.js"`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/ui/ ./internal/server/ -count=1`

Expected: PASS (`TestPreviewWidthHelpers` and `TestMDVendorAssetsServed`).

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md/preview-width.js internal/ui/testdata/preview_width_test.mjs internal/ui/preview_width_node_test.go internal/ui/embed.go internal/server/server_test.go
git commit -m "$(cat <<'EOF'
feat(ui): add Markdown preview width helpers

EOF
)"
```

---

### Task 2: Status bar chrome

**Files:**
- Modify: `internal/server/server_test.go` (`TestIndexHTMLHasIframeAndAppJS`, CSS loop in `TestAppJSWorkbenchContracts`)
- Modify: `internal/ui/index.html`
- Modify: `internal/ui/style.css`

**Interfaces:**
- Consumes: `WIDTH_LABELS` copy only (hardcode the same Chinese strings in HTML; JS in Task 3 reads helpers)
- Produces: `footer.status-bar`, `#md-width-wrap` (starts `hidden`), `#md-width-button`, `#md-width-menu` with three `data-md-width` items. CSS for 22px Dark Modern bar and upward menu.

- [ ] **Step 1: Write the failing HTML/CSS contract tests**

In `TestIndexHTMLHasIframeAndAppJS`, after the existing icon-marker loop, add:

```go
	for _, marker := range []string{
		`<footer class="status-bar">`,
		`id="md-width-wrap"`,
		`id="md-width-button"`,
		`id="md-width-menu"`,
		`aria-haspopup="menu"`,
		`data-md-width="standard"`,
		`data-md-width="wide"`,
		`data-md-width="full"`,
		"/md/preview-width.js",
		"标宽",
		"较宽",
		"全宽",
	} {
		if !strings.Contains(html, marker) {
			t.Fatalf("index missing %q", marker)
		}
	}
	if strings.Contains(html, "#007ACC") || strings.Contains(html, "#007acc") {
		t.Fatal("index must not use Default Dark+ status blue")
	}
```

In `TestAppJSWorkbenchContracts`, append these CSS markers to the existing `for _, marker := range []string{` list (do not remove current markers):

```go
		".status-bar",
		"height: 22px",
		"#md-width-menu",
		"#md-width-wrap",
```

After the CSS loop, add:

```go
	if strings.Contains(css, ".status-bar") && strings.Contains(css, "#007ACC") {
		t.Fatal("status bar must not use Default Dark+ blue")
	}
```

(Do not forbid `#007ACC` globally — it is unused; the status bar uses `var(--bg-shell)`. Instead add:)

```go
	statusIdx := strings.Index(css, ".status-bar {")
	if statusIdx < 0 {
		t.Fatal("style.css missing .status-bar block")
	}
	block := css[statusIdx:]
	if end := strings.Index(block, "\n}"); end >= 0 {
		block = block[:end]
	}
	if strings.Contains(block, "#007ACC") || strings.Contains(block, "#007acc") {
		t.Fatal("status bar must not use Default Dark+ blue")
	}
	if !strings.Contains(block, "var(--bg-shell)") {
		t.Fatal("status bar must use --bg-shell")
	}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/server/ -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts' -count=1`

Expected: FAIL `index missing "<footer class=\"status-bar\">"` (or the first missing marker).

- [ ] **Step 3: Add footer markup and CSS**

In `internal/ui/index.html`, before `<script src="/fuzzy.js" defer></script>`, insert:

```html
  <footer class="status-bar">
    <div class="status-bar-left"></div>
    <div class="status-bar-right">
      <div id="md-width-wrap" hidden>
        <button
          type="button"
          id="md-width-button"
          aria-haspopup="menu"
          aria-expanded="false"
          aria-controls="md-width-menu"
        >较宽</button>
        <ul id="md-width-menu" role="menu" hidden>
          <li role="none">
            <button type="button" role="menuitem" data-md-width="standard">标宽</button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" data-md-width="wide">较宽</button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" data-md-width="full">全宽</button>
          </li>
        </ul>
      </div>
    </div>
  </footer>
```

Change the script tags to:

```html
  <script src="/fuzzy.js" defer></script>
  <script src="/md/preview-width.js" defer></script>
  <script src="/app.js" defer></script>
```

Append to `internal/ui/style.css` (after `.sr-only`, before the `@media (max-width: 800px)` block):

```css
.status-bar {
  position: relative;
  z-index: 20;
  flex-shrink: 0;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  background: var(--bg-shell);
  border-top: 1px solid var(--border);
  color: var(--fg);
  font-size: 12px;
}

.status-bar-right {
  display: flex;
  align-items: stretch;
  margin-left: auto;
}

#md-width-wrap {
  position: relative;
}

#md-width-button {
  height: 22px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

#md-width-button:hover,
#md-width-button[aria-expanded="true"] {
  background: var(--hover);
}

#md-width-menu {
  position: absolute;
  right: 0;
  bottom: 100%;
  margin: 0 0 4px;
  padding: 4px 0;
  min-width: 140px;
  list-style: none;
  background: var(--bg-sidebar);
  border: 1px solid var(--border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  z-index: 21;
}

#md-width-menu[hidden] {
  display: none;
}

#md-width-menu button {
  display: block;
  width: 100%;
  padding: 4px 12px 4px 28px;
  border: 0;
  background: transparent;
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

#md-width-menu button:hover,
#md-width-menu button:focus-visible {
  background: var(--selection);
  color: var(--fg-strong);
}

#md-width-menu button[aria-checked="true"] {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23cccccc' d='M10.1 2.5 4.6 8.6 1.9 5.9l-.9.9 3.6 3.7 6.4-7.1z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: 8px 50%;
}
```

Do not set `.status-bar` background to `#007ACC`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/server/ -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ui/index.html internal/ui/style.css internal/server/server_test.go
git commit -m "$(cat <<'EOF'
feat(ui): add workbench status bar chrome

EOF
)"
```

---

### Task 3: Shell wiring (show, menu, persist, postMessage)

**Files:**
- Modify: `internal/ui/app.js`
- Modify: `internal/server/server_test.go` (`TestAppJSWorkbenchContracts` JS marker loop)

**Interfaces:**
- Consumes: `globalThis.MinoMDPreviewWidth` from Task 1 (`isMarkdownPath`, `WIDTH_LABELS`, `readPreviewWidth`, `writePreviewWidth`, `previewWidthMessage`, `parsePreviewWidth`)
- Produces: `syncMdWidthControl()`, `setMdWidthMenuOpen(open)`, `postMdWidthToPreview()`, `setPreviewWidth(mode)` used from `openFile` / `clearPreview` / iframe `load`

- [ ] **Step 1: Write the failing JS contract tests**

In `TestAppJSWorkbenchContracts`, add these strings to the JS `marker` slice:

```go
		"MinoMDPreviewWidth",
		"syncMdWidthControl",
		"postMdWidthToPreview",
		"md-preview-width",
		"setMdWidthMenuOpen",
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/server/ -run TestAppJSWorkbenchContracts -count=1`

Expected: FAIL `app.js missing contract "MinoMDPreviewWidth"`.

- [ ] **Step 3: Wire app.js**

At the top of the IIFE, after the existing `querySelector` constants, add:

```js
  const mdWidth = globalThis.MinoMDPreviewWidth;
  const mdWidthWrap = document.querySelector("#md-width-wrap");
  const mdWidthButton = document.querySelector("#md-width-button");
  const mdWidthMenu = document.querySelector("#md-width-menu");
  let previewWidth = mdWidth.readPreviewWidth(localStorage);
  let mdWidthMenuOpen = false;
```

Add these functions after `clearPreview` (so they can call `currentPath`):

```js
  function postMdWidthToPreview() {
    if (!mdWidth.isMarkdownPath(currentPath)) return;
    const frame = preview.contentWindow;
    if (!frame) return;
    try {
      frame.postMessage(mdWidth.previewWidthMessage(previewWidth), window.location.origin);
    } catch (_err) {}
  }

  function setMdWidthMenuOpen(open) {
    mdWidthMenuOpen = !!open;
    mdWidthMenu.hidden = !mdWidthMenuOpen;
    mdWidthButton.setAttribute("aria-expanded", String(mdWidthMenuOpen));
  }

  function syncMdWidthControl() {
    const show = mdWidth.isMarkdownPath(currentPath);
    mdWidthWrap.hidden = !show;
    if (!show) {
      setMdWidthMenuOpen(false);
      return;
    }
    mdWidthButton.textContent = mdWidth.WIDTH_LABELS[previewWidth];
    mdWidthMenu.querySelectorAll("[data-md-width]").forEach((item) => {
      item.setAttribute("aria-checked", String(item.getAttribute("data-md-width") === previewWidth));
    });
  }

  function setPreviewWidth(mode) {
    previewWidth = mdWidth.writePreviewWidth(localStorage, mode);
    syncMdWidthControl();
    postMdWidthToPreview();
    setMdWidthMenuOpen(false);
  }
```

At the end of `openFile(path)`, call `syncMdWidthControl();`.  
At the end of `clearPreview()`, call `syncMdWidthControl();`.

Replace `preview.addEventListener("load", bindPreviewHotkeys);` with:

```js
  function onPreviewLoad() {
    bindPreviewHotkeys();
    postMdWidthToPreview();
  }
  preview.addEventListener("load", onPreviewLoad);
```

After the `commandCenter` click listener, add width-control listeners:

```js
  mdWidthButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setMdWidthMenuOpen(!mdWidthMenuOpen);
  });
  mdWidthMenu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-md-width]");
    if (!item) return;
    event.preventDefault();
    setPreviewWidth(item.getAttribute("data-md-width"));
  });
  document.addEventListener("pointerdown", (event) => {
    if (!mdWidthMenuOpen) return;
    if (mdWidthWrap.contains(event.target)) return;
    setMdWidthMenuOpen(false);
  });
```

In `onQuickOpenHotkey`, **before** `if (!pickerOpen) return;`, add:

```js
    if (event.key === "Escape" && mdWidthMenuOpen) {
      event.preventDefault();
      setMdWidthMenuOpen(false);
      return;
    }
```

When opening Quick Open (`setPickerOpen(true)` paths), close the width menu: at the start of `setPickerOpen`, if `open` is true, call `setMdWidthMenuOpen(false);`.

At the bottom of the IIFE (with `fillIcons();`), call `syncMdWidthControl();`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/server/ ./internal/ui/ -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ui/app.js internal/server/server_test.go
git commit -m "$(cat <<'EOF'
feat(ui): persist Markdown preview width from the status bar

EOF
)"
```

---

### Task 4: Viewer apply width, CSS, README

**Files:**
- Modify: `internal/ui/md/viewer.html`
- Modify: `internal/ui/md/viewer.js`
- Modify: `internal/ui/md/viewer.css`
- Modify: `internal/server/server_test.go` (`TestViewerPipelineMarkers`, `TestMarkdownAppsAndRaw`)
- Modify: `README.md`

**Interfaces:**
- Consumes: `MinoMDPreviewWidth.readPreviewWidth`, `applyPreviewWidth`, `parsePreviewWidthMessage`
- Produces: `html[data-md-width=standard|wide|full]` driving article 960 / 1400 / none; outline still `flex: 0 0 220px` on the right

- [ ] **Step 1: Write the failing viewer contract tests**

In `TestMarkdownAppsAndRaw`, after the `toc.js` check, add:

```go
	if !strings.Contains(html, "/md/preview-width.js") {
		t.Fatalf("missing preview-width.js: %s", body)
	}
```

In `TestViewerPipelineMarkers`, add to the JS marker list:

```go
		"MinoMDPreviewWidth",
		"data-md-width",
		"parsePreviewWidthMessage",
```

After that test function’s JS loop, fetch CSS and assert:

```go
	cssRes, err := http.Get(ts.URL + "/md/viewer.css")
	if err != nil {
		t.Fatal(err)
	}
	cssBody, _ := io.ReadAll(cssRes.Body)
	cssRes.Body.Close()
	if cssRes.StatusCode != http.StatusOK {
		t.Fatalf("viewer.css status %d", cssRes.StatusCode)
	}
	css := string(cssBody)
	for _, marker := range []string{
		`html[data-md-width="standard"]`,
		`html[data-md-width="wide"]`,
		`html[data-md-width="full"]`,
		"max-width: 960px",
		"max-width: 1400px",
	} {
		if !strings.Contains(css, marker) {
			t.Fatalf("viewer.css missing %q", marker)
		}
	}
	if strings.Contains(css, "max-width: 860px") {
		t.Fatal("viewer.css must not keep the 860px article cap")
	}
	if strings.Contains(css, "max-width: 1120px") {
		t.Fatal("viewer.css must not keep the 1120px layout cap")
	}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/server/ -run 'TestMarkdownAppsAndRaw|TestViewerPipelineMarkers' -count=1`

Expected: FAIL `missing preview-width.js` (or first missing marker).

- [ ] **Step 3: Viewer HTML, JS, CSS, README**

In `internal/ui/md/viewer.html`, add before `viewer.js`:

```html
  <script src="/md/preview-width.js"></script>
```

At the top of `internal/ui/md/viewer.js`, after the existing `globalThis.MinoMD*` destructures:

```js
  const {
    readPreviewWidth,
    applyPreviewWidth,
    parsePreviewWidthMessage,
  } = globalThis.MinoMDPreviewWidth;

  applyPreviewWidth(document.documentElement, readPreviewWidth(localStorage));

  window.addEventListener("message", (event) => {
    const mode = parsePreviewWidthMessage(
      event.data,
      event.origin,
      window.location.origin
    );
    if (!mode) return;
    applyPreviewWidth(document.documentElement, mode);
  });
```

Replace the layout width rules at the top of `internal/ui/md/viewer.css`. Keep `html { color-scheme: dark; }` and `body { ... }`. Replace `.md-layout`, `.md-layout:has(#toc[hidden])`, and `.markdown-body`’s `max-width` as follows (keep padding, flex, font-size on `.markdown-body`):

```css
.md-layout {
  display: flex;
  align-items: flex-start;
  gap: 24px;
  margin: 0 auto;
  padding: 0 16px;
  box-sizing: border-box;
}

.markdown-body {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 24px 32px 56px;
  font-size: 15px;
}

/* Default = 较宽 so first paint matches DEFAULT_WIDTH before JS. */
.md-layout {
  max-width: 1644px;
}
.md-layout:has(#toc[hidden]) {
  justify-content: center;
  max-width: 1400px;
}
.markdown-body {
  max-width: 1400px;
}

html[data-md-width="standard"] .md-layout {
  max-width: 1204px;
}
html[data-md-width="standard"] .md-layout:has(#toc[hidden]) {
  justify-content: center;
  max-width: 960px;
}
html[data-md-width="standard"] .markdown-body {
  max-width: 960px;
}

html[data-md-width="wide"] .md-layout {
  max-width: 1644px;
}
html[data-md-width="wide"] .md-layout:has(#toc[hidden]) {
  justify-content: center;
  max-width: 1400px;
}
html[data-md-width="wide"] .markdown-body {
  max-width: 1400px;
}

html[data-md-width="full"] .md-layout {
  max-width: none;
  width: 100%;
}
html[data-md-width="full"] .md-layout:has(#toc[hidden]) {
  max-width: none;
  width: 100%;
  justify-content: center;
}
html[data-md-width="full"] .markdown-body {
  max-width: none;
}
```

In `@media (max-width: 959px)`, **delete** `max-width: 860px` from `.md-layout`. Keep column stack / TOC `order: -1`. Add:

```css
@media (max-width: 959px) {
  .md-layout {
    flex-direction: column;
  }
  html[data-md-width="standard"] .md-layout,
  html[data-md-width="standard"] .md-layout:has(#toc[hidden]) {
    max-width: 960px;
  }
  html[data-md-width="wide"] .md-layout,
  html[data-md-width="wide"] .md-layout:has(#toc[hidden]) {
    max-width: 1400px;
  }
  html[data-md-width="full"] .md-layout,
  html[data-md-width="full"] .md-layout:has(#toc[hidden]) {
    max-width: none;
    width: 100%;
  }
  .toc {
    position: static;
    flex-basis: auto;
    width: 100%;
    max-height: none;
    order: -1;
  }
}
```

Merge with the existing `.toc` rules in that query (do not duplicate `.toc` if already present — replace the whole `@media (max-width: 959px)` block with the one above, keeping the existing `.toc` declarations).

In `README.md`, after the sentence about the Markdown outline (`h1`–`h3` … scroll spy), add:

```text
The workbench has a bottom status bar. For `.md` files it exposes 标宽 / 较宽 / 全宽 (960px / 1400px / fill); the default is 较宽. The choice is stored in this origin’s `localStorage` under `mino-md-preview-width` and applies to all Markdown files.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./... -count=1`

Expected: PASS.

Manual (same origin): open `example/docs/sample.md` — status bar shows **较宽**; switch 标宽 / 全宽 without iframe reload; HTML file hides the control but keeps the 22px bar; refresh keeps the last Markdown width.

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md/viewer.html internal/ui/md/viewer.js internal/ui/md/viewer.css internal/server/server_test.go README.md
git commit -m "$(cat <<'EOF'
feat(ui): apply Markdown preview width in the viewer

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Full-width 22px Dark Modern status bar, all file types | 2 |
| Markdown-only 标宽 / 较宽 / 全宽 menu on the right | 2 + 3 |
| Default 较宽; `mino-md-preview-width`; all `.md` share one value | 1 + 3 |
| 960 / 1400 / full; outline stays; no 860/1120; narrow MQ | 4 |
| `postMessage` + iframe `load` resend; no iframe reload on change | 3 + 4 |
| Storage throw → in-memory / default wide | 1 |
| Hide control on HTML / empty; Escape / outside click closes menu | 3 |
| README | 4 |
| No catalog/watcher/config; embed new JS only | 1 |

No placeholders. Helper names are identical across tasks (`parsePreviewWidth`, `previewWidthMessage`, `parsePreviewWidthMessage`, `syncMdWidthControl`, `postMdWidthToPreview`).
