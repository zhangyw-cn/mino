# Refresh Keeps Current Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Same-tab refresh of `/` reopens the catalog file that was previewed; a new tab and a missing file stay on the empty preview; the address bar stays `/`.

**Architecture:** A UMD helper `internal/ui/open-path.js` reads, writes, and clears `sessionStorage['mino-open-path']` and resolves the candidate against `fileIndex`. `app.js` writes on `openFile`, clears on `clearPreview`, and restores once after the first successful `/api/tree` load by expanding ancestors and calling `openFile` (same as Quick Open). No hash, query, `localStorage`, catalog, or watcher changes.

**Tech Stack:** Vanilla HTML/JS via `go:embed`; Node `node:test` for helpers; Go `server_test` string contracts. No npm packages, no Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-27-mino-refresh-keep-preview-design.md`
- Storage key: `mino-open-path`. Value: catalog relative path (same string as `currentPath`, not URL-encoded).
- Scope: this tab’s `sessionStorage` on this origin. Address bar stays `/`.
- Parse: non-string / missing → `""`; trim; empty after trim → `""`; otherwise the trimmed string.
- Restore only on the **first successful** `/api/tree` in this page lifetime. Failed/aborted fetches leave the key and do not set the one-shot flag.
- Candidate not in `fileIndex` → empty preview and remove the key.
- `sessionStorage` throws → swallow; open/clear preview still work.
- Do not persist recents, sidebar collapse, iframe scroll, TOC, or Mermaid state. `openFile` still `rememberOpen`, so a successful restore seeds recents with that one path.
- Do not change catalog, watcher, `/apps/*`, Markdown viewer internals, or URL routing beyond serving `/open-path.js`.
- Prefer TDD; commit after each task.

---

## File Structure

```text
internal/ui/open-path.js                 # NEW: parse/read/write/clear/resolve (UMD, MinoOpenPath)
internal/ui/testdata/open_path_test.mjs  # NEW: node:test
internal/ui/open_path_node_test.go       # NEW: go test wrapper → node --test
internal/ui/embed.go                     # embed open-path.js
internal/ui/index.html                   # script /open-path.js before app.js
internal/ui/app.js                       # write, clear, one-shot restore
internal/server/server.go                # GET /open-path.js
internal/server/server_test.go           # asset + index + app.js contracts
README.md                                # one line: same-tab refresh keeps preview
```

Do not modify catalog, watcher, config, fuzzy.js, preview-width.js, viewer.js, or Mermaid code.

---

### Task 1: Open-path helpers

**Files:**
- Create: `internal/ui/testdata/open_path_test.mjs`
- Create: `internal/ui/open_path_node_test.go`
- Create: `internal/ui/open-path.js`

**Interfaces:**
- Consumes: nothing
- Produces: `globalThis.MinoOpenPath` / `module.exports` with:
  - `STORAGE_KEY` = `"mino-open-path"`
  - `parseOpenPath(value) → string`
  - `readOpenPath(storage) → string`
  - `writeOpenPath(storage, path) → string` (parsed path; empty clears the key)
  - `clearOpenPath(storage) → void`
  - `resolveOpenPath(stored, fileIndex) → string`

- [ ] **Step 1: Write the failing Node tests**

Create `internal/ui/testdata/open_path_test.mjs`:

```js
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const {
  STORAGE_KEY,
  parseOpenPath,
  readOpenPath,
  writeOpenPath,
  clearOpenPath,
  resolveOpenPath,
} = createRequire(import.meta.url)("../open-path.js");

test("STORAGE_KEY", () => {
  assert.equal(STORAGE_KEY, "mino-open-path");
});

test("parseOpenPath trims and rejects empty", () => {
  assert.equal(parseOpenPath("docs/sample.md"), "docs/sample.md");
  assert.equal(parseOpenPath("  docs/sample.md  "), "docs/sample.md");
  assert.equal(parseOpenPath(""), "");
  assert.equal(parseOpenPath("   "), "");
  assert.equal(parseOpenPath(null), "");
  assert.equal(parseOpenPath(undefined), "");
  assert.equal(parseOpenPath(0), "");
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
    removeItem(key) {
      store.delete(key);
    },
  };
}

test("readOpenPath reads parsed path", () => {
  const storage = memoryStorage({ "mino-open-path": "  docs/sample.md  " });
  assert.equal(readOpenPath(storage), "docs/sample.md");
});

test("readOpenPath empty when missing or storage throws", () => {
  assert.equal(readOpenPath(memoryStorage()), "");
  assert.equal(
    readOpenPath({
      getItem() {
        throw new Error("denied");
      },
    }),
    ""
  );
  assert.equal(readOpenPath(null), "");
});

test("writeOpenPath stores trimmed path", () => {
  const storage = memoryStorage();
  assert.equal(writeOpenPath(storage, "docs/sample.md"), "docs/sample.md");
  assert.equal(storage.getItem("mino-open-path"), "docs/sample.md");
  assert.equal(writeOpenPath(storage, "  notes/a.html  "), "notes/a.html");
  assert.equal(storage.getItem("mino-open-path"), "notes/a.html");
});

test("writeOpenPath clears on empty candidate", () => {
  const storage = memoryStorage({ "mino-open-path": "docs/sample.md" });
  assert.equal(writeOpenPath(storage, "   "), "");
  assert.equal(storage.getItem("mino-open-path"), null);
});

test("writeOpenPath swallows setItem throw", () => {
  assert.equal(
    writeOpenPath(
      {
        setItem() {
          throw new Error("quota");
        },
      },
      "docs/sample.md"
    ),
    "docs/sample.md"
  );
});

test("clearOpenPath removes key and swallows throw", () => {
  const storage = memoryStorage({ "mino-open-path": "docs/sample.md" });
  clearOpenPath(storage);
  assert.equal(storage.getItem("mino-open-path"), null);
  clearOpenPath({
    removeItem() {
      throw new Error("denied");
    },
  });
  clearOpenPath(null);
});

test("resolveOpenPath requires membership in fileIndex", () => {
  const index = ["hello.html", "docs/sample.md"];
  assert.equal(resolveOpenPath("docs/sample.md", index), "docs/sample.md");
  assert.equal(resolveOpenPath("  docs/sample.md  ", index), "docs/sample.md");
  assert.equal(resolveOpenPath("gone.md", index), "");
  assert.equal(resolveOpenPath("", index), "");
  assert.equal(resolveOpenPath("docs/sample.md", []), "");
  assert.equal(resolveOpenPath("docs/sample.md", null), "");
  assert.equal(resolveOpenPath("../secret.md", index), "");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test internal/ui/testdata/open_path_test.mjs`

Expected: FAIL (module not found: `../open-path.js`)

- [ ] **Step 3: Write the helper**

Create `internal/ui/open-path.js`:

```js
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
```

- [ ] **Step 4: Run Node tests to verify they pass**

Run: `node --test internal/ui/testdata/open_path_test.mjs`

Expected: PASS (all tests ok)

- [ ] **Step 5: Add the Go wrapper**

Create `internal/ui/open_path_node_test.go`:

```go
package ui_test

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestOpenPathHelpers(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	testFile := filepath.Join(filepath.Dir(file), "testdata", "open_path_test.mjs")
	cmd := exec.Command("node", "--test", testFile)
	cmd.Dir = filepath.Dir(testFile)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("node --test: %v\n%s", err, out)
	}
}
```

- [ ] **Step 6: Run the Go wrapper**

Run: `go test ./internal/ui -run TestOpenPathHelpers -count=1`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add internal/ui/open-path.js internal/ui/testdata/open_path_test.mjs internal/ui/open_path_node_test.go
git commit -m "$(cat <<'EOF'
feat(ui): add session open-path helpers

Parse, persist, and resolve the current preview path in sessionStorage so refresh can restore it without changing the URL.
EOF
)"
```

---

### Task 2: Serve `/open-path.js`

**Files:**
- Modify: `internal/ui/embed.go`
- Modify: `internal/server/server.go`
- Modify: `internal/ui/index.html`
- Modify: `internal/server/server_test.go`

**Interfaces:**
- Consumes: `internal/ui/open-path.js` from Task 1 (`MinoOpenPath`)
- Produces: `GET /open-path.js` (`text/javascript; charset=utf-8`); index loads it before `/app.js`

- [ ] **Step 1: Write the failing server tests**

In `internal/server/server_test.go`, add `"/open-path.js"` to the marker list in `TestIndexHTMLHasIframeAndAppJS` that already includes `"/fuzzy.js"` (the loop around the iframe / command-center markers, **not** only the status-bar loop).

Add this new test immediately after `TestFuzzyJSServed`:

```go
func TestOpenPathJSServed(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/open-path.js")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	js := string(body)
	for _, marker := range []string{
		"MinoOpenPath",
		`"mino-open-path"`,
		"parseOpenPath",
		"readOpenPath",
		"writeOpenPath",
		"clearOpenPath",
		"resolveOpenPath",
	} {
		if !strings.Contains(js, marker) {
			t.Fatalf("open-path.js missing %q", marker)
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/server -run 'TestIndexHTMLHasIframeAndAppJS|TestOpenPathJSServed' -count=1`

Expected: FAIL (`index missing "/open-path.js"` and/or `/open-path.js` status 404)

- [ ] **Step 3: Embed, route, and load the script**

`internal/ui/embed.go` — add `open-path.js` to the first `go:embed` line:

```go
//go:embed index.html app.js style.css fuzzy.js open-path.js
```

`internal/server/server.go` — next to the `/fuzzy.js` route:

```go
mux.HandleFunc("GET /open-path.js", embeddedAssetHandler("open-path.js", "text/javascript; charset=utf-8"))
```

`internal/ui/index.html` — insert the script before `app.js`:

```html
  <script src="/fuzzy.js" defer></script>
  <script src="/md/preview-width.js" defer></script>
  <script src="/open-path.js" defer></script>
  <script src="/app.js" defer></script>
```

- [ ] **Step 4: Run server tests to verify they pass**

Run: `go test ./internal/server -run 'TestIndexHTMLHasIframeAndAppJS|TestOpenPathJSServed' -count=1`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/ui/embed.go internal/ui/index.html internal/server/server.go internal/server/server_test.go
git commit -m "$(cat <<'EOF'
feat(ui): serve open-path.js on the workbench

Embed and load the session path helper before app.js so the shell can restore the preview after refresh.
EOF
)"
```

---

### Task 3: Restore preview in `app.js`

**Files:**
- Modify: `internal/ui/app.js`
- Modify: `internal/server/server_test.go` (`TestAppJSWorkbenchContracts`)
- Modify: `README.md`

**Interfaces:**
- Consumes: `globalThis.MinoOpenPath` from Task 1 (`readOpenPath`, `writeOpenPath`, `clearOpenPath`, `resolveOpenPath`); existing `openFile`, `clearPreview`, `loadTree`, `ancestorPaths`, `renderTreeFromCache`, `fileIndex`
- Produces: `maybeRestoreOpenPath()` — one-shot; `openFile` writes storage; `clearPreview` clears storage

- [ ] **Step 1: Write the failing app.js contract tests**

In `TestAppJSWorkbenchContracts` in `internal/server/server_test.go`, add these strings to the required-marker slice (the one that already includes `"MinoMDPreviewWidth"`):

```go
		"MinoOpenPath",
		"maybeRestoreOpenPath",
		"writeOpenPath",
		"clearOpenPath",
		"sessionStorage",
```

Also add these negative checks in that same test function, after the existing `commandCenter.textContent` check:

```go
	if strings.Contains(js, "localStorage.setItem") && strings.Contains(js, "mino-open-path") {
		t.Fatal("app.js must not persist the open path in localStorage")
	}
	if strings.Contains(js, "pushState") || strings.Contains(js, "replaceState") {
		t.Fatal("app.js must not change history for the open path")
	}
```

Note: `app.js` must not gain `history.pushState` / `replaceState`. Markdown TOC `replaceState` lives in `viewer.js` (iframe), not here.

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `go test ./internal/server -run TestAppJSWorkbenchContracts -count=1`

Expected: FAIL (`app.js missing contract "MinoOpenPath"` or `maybeRestoreOpenPath`)

- [ ] **Step 3: Wire persist + one-shot restore**

In `internal/ui/app.js`, next to `const mdWidth = globalThis.MinoMDPreviewWidth;`:

```js
  const openPath = globalThis.MinoOpenPath;
```

Next to `let currentPath = "";`:

```js
  let didRestoreOpenPath = false;
```

At the end of `openFile`, after `syncMdWidthControl();`:

```js
    openPath.writeOpenPath(sessionStorage, path);
```

At the end of `clearPreview`, after `syncMdWidthControl();`:

```js
    openPath.clearOpenPath(sessionStorage);
```

Add this function next to `loadTree` (after `loadTree` is fine):

```js
  function maybeRestoreOpenPath() {
    if (didRestoreOpenPath) return;
    didRestoreOpenPath = true;
    const path = openPath.resolveOpenPath(openPath.readOpenPath(sessionStorage), fileIndex);
    if (!path) {
      openPath.clearOpenPath(sessionStorage);
      return;
    }
    for (const ancestor of ancestorPaths(path)) expandedPaths.add(ancestor);
    openFile(path);
    renderTreeFromCache();
  }
```

In `loadTree`, after a successful `fileIndex` rebuild and `renderTreeFromCache()`, still inside the `try` after the stale checks:

```js
      lastTree = root;
      fileIndex = flattenFiles(root, []);
      recents = recents.filter((path) => fileIndex.includes(path));
      renderTreeFromCache();
      maybeRestoreOpenPath();
      if (pickerOpen) renderPicker();
```

Do not call `maybeRestoreOpenPath` from the `catch` path. Do not call it from SSE listeners except via `loadTree`. Leave the SSE `changed` / `removed` branches as they are (`removed` already calls `clearPreview`, which now clears the key).

- [ ] **Step 4: Run contract tests**

Run: `go test ./internal/server -run TestAppJSWorkbenchContracts -count=1`

Expected: PASS

- [ ] **Step 5: Run helper + server tests**

Run: `go test ./internal/ui ./internal/server -count=1`

Expected: PASS

- [ ] **Step 6: README**

In `README.md`, immediately after the paragraph that starts with `The workbench has a bottom status bar.`, add:

```markdown
A same-tab refresh of the workbench URL reopens the file you were previewing. That path is stored in this tab’s `sessionStorage` under `mino-open-path`. A new tab on `/` starts with no file selected.
```

- [ ] **Step 7: Manual check**

Run: `go run ./cmd/mino ./example`

Open the printed URL. Then:

1. Open `docs/sample.md`. Refresh. Preview and Explorer selection stay on that file. Address bar is still `/`.
2. Open `/` in a new tab. Empty preview (“No preview selected”).
3. In the first tab, with `docs/sample.md` open, rename or delete that file on disk, wait for live reload (empty preview), then refresh. Still empty.
4. Open `docs/sample.md` again, edit it on disk. Iframe reloads; still that file.

- [ ] **Step 8: Commit**

```bash
git add internal/ui/app.js internal/server/server_test.go README.md
git commit -m "$(cat <<'EOF'
feat(ui): restore the open preview after same-tab refresh

Write the catalog path to sessionStorage on open, clear it on empty preview, and reopen it once after the first successful tree load.
EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| `sessionStorage` key `mino-open-path`, relative path | 1, 3 |
| Address bar stays `/`; new tab empty | 3 (no history API; sessionStorage) |
| Missing/invalid path → empty + remove key | 1 (`resolveOpenPath` / `clearOpenPath`), 3 (`maybeRestoreOpenPath`) |
| First successful `/api/tree` only | 3 (`didRestoreOpenPath`) |
| Failed/aborted first fetch does not consume restore | 3 (flag set only after successful try body) |
| `openFile` writes, `clearPreview` clears | 3 |
| SSE `changed` iframe reload; `removed` clears key | 3 (existing branches + `clearPreview`) |
| Expand ancestors like Quick Open | 3 (`maybeRestoreOpenPath`) |
| Recents: only restored file via `rememberOpen` | 3 (`openFile` unchanged aside from write) |
| Storage throws swallowed | 1 |
| Serve helper; embed | 2 |
| Node tests + `/open-path.js` served | 1, 2 |
| README one line | 3 |
| No catalog/watcher/viewer/`localStorage`/URL hash | all tasks |
