# Single-Iframe Preview Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening or live-reloading a catalog file does not flash the preview white; a second click on the open file does not reload; Markdown reuses the viewer document.

**Architecture:** A UMD helper `internal/ui/preview-session.js` (`MinoPreviewSession`) owns kind matching, `decidePreviewAction` (`skip` | `in-place` | `navigate`), and preview `postMessage` parse/build. `app.js` decides before mutating `currentPath`, skips same-file clicks, navigates with class `preview-pending` (dark pane, no `display: none`) until ready, and in-place `postMessage`s a live Markdown viewer. `viewer.js` fetches then swaps DOM and posts `preview-ready` / `preview-error`. One iframe. No catalog, watcher, or `/apps/*` routing changes.

**Tech Stack:** Vanilla HTML/JS via `go:embed`; Node `node:test` for helpers; Go `server_test` string contracts. No npm packages, no Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-29-mino-single-iframe-preview-update-design.md`
- Single `#preview` iframe. No dual iframe, no shell-inline Markdown, no screenshot overlay.
- Kinds: `markdown` = `/\.md$/i`, `inPlace: true`, ready = `preview-ready`; `html` = `/\.html?$/i`, `inPlace: false`, ready = `load`; else `document`, `inPlace: false`, ready = `load`.
- `decidePreviewAction({ fromPath, toPath, force, displayedPath, navigatePending })` → `"skip"` | `"in-place"` | `"navigate"`. Call with **pre-update** `currentPath` as `fromPath`.
- Rules in order: (1) `toPath === fromPath` && !`force` → skip; (2) `navigatePending` → navigate; (3) same `kindId` as non-empty `displayedPath` && `inPlace(toPath)` → in-place; (4) else navigate.
- Messages: `{ source: "mino", type, path }` with types `preview-navigate` | `preview-reload` | `preview-ready` | `preview-error`. Wrong origin / missing source / unknown type / empty path → parse `null`.
- `#preview` background is `var(--bg-shell)`, not `#ffffff`. Pending hide uses class `preview-pending` with `visibility` (not `display: none`). `hidden` still means no file selected.
- Do not change catalog, watcher, `/apps/*`, `/api/raw/*`. Do not persist TOC / Mermaid across path changes. Same-path Markdown reload restores `window` scroll.
- Prefer TDD; commit after each task.

---

## File Structure

```text
internal/ui/preview-session.js                    # NEW: kinds, decide, messages (UMD, MinoPreviewSession)
internal/ui/testdata/preview_session_test.mjs     # NEW: node:test
internal/ui/preview_session_node_test.go          # NEW: go test wrapper → node --test
internal/ui/embed.go                              # embed preview-session.js
internal/ui/index.html                            # script /preview-session.js before /app.js
internal/ui/md/viewer.html                        # script /preview-session.js before /md/viewer.js
internal/ui/app.js                                # skip / in-place / navigate; pending; ready vs load
internal/ui/style.css                             # dark iframe bg; .preview-pending
internal/ui/md/viewer.js                          # fetch-then-swap; generation; ready/error
internal/server/server.go                         # GET /preview-session.js
internal/server/server_test.go                    # asset, index order, app.js / viewer.js / css contracts
README.md                                         # same-file click; Markdown reuses viewer document
```

Do not modify catalog, watcher, config, fuzzy.js, mermaid-block.js, or `/apps/` serving.

---

### Task 1: Preview-session helpers

**Files:**
- Create: `internal/ui/testdata/preview_session_test.mjs`
- Create: `internal/ui/preview_session_node_test.go`
- Create: `internal/ui/preview-session.js`

**Interfaces:**
- Consumes: nothing
- Produces: `globalThis.MinoPreviewSession` / `module.exports` with:
  - `kindId(path) → "markdown" | "html" | "document"`
  - `inPlace(path) → boolean`
  - `decidePreviewAction({ fromPath, toPath, force, displayedPath, navigatePending }) → "skip" | "in-place" | "navigate"`
  - `previewNavigateMessage(path)` / `previewReloadMessage(path)` / `previewReadyMessage(path)` / `previewErrorMessage(path)` → `{ source: "mino", type, path }` (`path` trimmed)
  - `parsePreviewMessage(data, origin, expectedOrigin) → { type, path } | null`

- [ ] **Step 1: Write the failing Node tests**

Create `internal/ui/testdata/preview_session_test.mjs`:

```js
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const {
  kindId,
  inPlace,
  decidePreviewAction,
  previewNavigateMessage,
  previewReloadMessage,
  previewReadyMessage,
  previewErrorMessage,
  parsePreviewMessage,
} = createRequire(import.meta.url)("../preview-session.js");

test("kindId matches extensions", () => {
  assert.equal(kindId("docs/sample.md"), "markdown");
  assert.equal(kindId("docs/SAMPLE.MD"), "markdown");
  assert.equal(kindId("hello.html"), "html");
  assert.equal(kindId("notes/a.htm"), "html");
  assert.equal(kindId("App.HTML"), "html");
  assert.equal(kindId("notes/a.txt"), "document");
  assert.equal(kindId(""), "document");
  assert.equal(kindId(null), "document");
});

test("inPlace is markdown only", () => {
  assert.equal(inPlace("docs/sample.md"), true);
  assert.equal(inPlace("hello.html"), false);
  assert.equal(inPlace("notes/a.txt"), false);
});

function decide(partial) {
  return decidePreviewAction(
    Object.assign(
      {
        fromPath: "",
        toPath: "",
        force: false,
        displayedPath: "",
        navigatePending: false,
      },
      partial
    )
  );
}

test("decide skip when same path and not force", () => {
  assert.equal(
    decide({ fromPath: "docs/a.md", toPath: "docs/a.md" }),
    "skip"
  );
  assert.equal(
    decide({ fromPath: "hello.html", toPath: "hello.html" }),
    "skip"
  );
});

test("decide force same markdown displayed is in-place", () => {
  assert.equal(
    decide({
      fromPath: "docs/a.md",
      toPath: "docs/a.md",
      force: true,
      displayedPath: "docs/a.md",
    }),
    "in-place"
  );
});

test("decide force same html displayed is navigate", () => {
  assert.equal(
    decide({
      fromPath: "hello.html",
      toPath: "hello.html",
      force: true,
      displayedPath: "hello.html",
    }),
    "navigate"
  );
});

test("decide markdown to markdown is in-place", () => {
  assert.equal(
    decide({
      fromPath: "docs/a.md",
      toPath: "docs/b.md",
      displayedPath: "docs/a.md",
    }),
    "in-place"
  );
});

test("decide html to html, html to md, empty displayed navigate", () => {
  assert.equal(
    decide({
      fromPath: "a.html",
      toPath: "b.html",
      displayedPath: "a.html",
    }),
    "navigate"
  );
  assert.equal(
    decide({
      fromPath: "a.html",
      toPath: "docs/a.md",
      displayedPath: "a.html",
    }),
    "navigate"
  );
  assert.equal(
    decide({ fromPath: "", toPath: "docs/a.md" }),
    "navigate"
  );
});

test("decide navigatePending forces navigate even for md to md", () => {
  assert.equal(
    decide({
      fromPath: "docs/a.md",
      toPath: "docs/b.md",
      displayedPath: "docs/a.md",
      navigatePending: true,
    }),
    "navigate"
  );
});

const ORIGIN = "http://127.0.0.1:1";

test("message builders trim path", () => {
  assert.deepEqual(previewNavigateMessage("  docs/a.md  "), {
    source: "mino",
    type: "preview-navigate",
    path: "docs/a.md",
  });
  assert.deepEqual(previewReloadMessage("docs/a.md"), {
    source: "mino",
    type: "preview-reload",
    path: "docs/a.md",
  });
  assert.deepEqual(previewReadyMessage("docs/a.md"), {
    source: "mino",
    type: "preview-ready",
    path: "docs/a.md",
  });
  assert.deepEqual(previewErrorMessage("docs/a.md"), {
    source: "mino",
    type: "preview-error",
    path: "docs/a.md",
  });
});

test("parsePreviewMessage accepts four types", () => {
  for (const type of [
    "preview-navigate",
    "preview-reload",
    "preview-ready",
    "preview-error",
  ]) {
    assert.deepEqual(
      parsePreviewMessage(
        { source: "mino", type, path: "docs/a.md" },
        ORIGIN,
        ORIGIN
      ),
      { type, path: "docs/a.md" }
    );
  }
});

test("parsePreviewMessage rejects bad envelopes", () => {
  const good = { source: "mino", type: "preview-ready", path: "docs/a.md" };
  assert.equal(parsePreviewMessage(good, "http://evil", ORIGIN), null);
  assert.equal(
    parsePreviewMessage({ type: "preview-ready", path: "docs/a.md" }, ORIGIN, ORIGIN),
    null
  );
  assert.equal(
    parsePreviewMessage({ source: "mino", type: "nope", path: "docs/a.md" }, ORIGIN, ORIGIN),
    null
  );
  assert.equal(
    parsePreviewMessage({ source: "mino", type: "preview-ready", path: "  " }, ORIGIN, ORIGIN),
    null
  );
  assert.equal(
    parsePreviewMessage({ source: "mino", type: "preview-ready" }, ORIGIN, ORIGIN),
    null
  );
  assert.equal(parsePreviewMessage(null, ORIGIN, ORIGIN), null);
});
```

- [ ] **Step 2: Add the Go `node --test` wrapper**

Create `internal/ui/preview_session_node_test.go` (same pattern as `open_path_node_test.go`):

```go
package ui_test

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestPreviewSessionHelpers(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	testFile := filepath.Join(filepath.Dir(file), "testdata", "preview_session_test.mjs")
	cmd := exec.Command("node", "--test", testFile)
	cmd.Dir = filepath.Dir(testFile)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("node --test: %v\n%s", err, out)
	}
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```sh
go test ./internal/ui/ -run TestPreviewSessionHelpers -count=1
```

Expected: FAIL (`Cannot find module` / `preview-session.js` missing).

- [ ] **Step 4: Implement `internal/ui/preview-session.js`**

```js
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```sh
go test ./internal/ui/ -run TestPreviewSessionHelpers -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/ui/preview-session.js internal/ui/testdata/preview_session_test.mjs internal/ui/preview_session_node_test.go
git commit -m "feat(ui): add preview-session kind and action helpers"
```

---

### Task 2: Serve `preview-session.js`

**Files:**
- Modify: `internal/ui/embed.go`
- Modify: `internal/ui/index.html`
- Modify: `internal/ui/md/viewer.html`
- Modify: `internal/server/server.go`
- Modify: `internal/server/server_test.go`

**Interfaces:**
- Consumes: `internal/ui/preview-session.js` from Task 1
- Produces: `GET /preview-session.js`; index loads it before `/app.js`; Markdown viewer shell loads it before `/md/viewer.js`

- [ ] **Step 1: Write the failing server tests**

In `TestUIIndexServed` (the loop that already requires `"/open-path.js"`), add `"/preview-session.js"` to the marker list.

After the existing `open-path.js` before `app.js` check, add:

```go
	sessionSrc := strings.Index(html, `src="/preview-session.js"`)
	if sessionSrc < 0 || sessionSrc > appSrc {
		t.Fatal("index must load /preview-session.js before /app.js")
	}
```

In the Markdown viewer HTML assertion that already requires `"/md/viewer.js"` (the `data-path="notes/readme.md"` test), add:

```go
	if !strings.Contains(html, "/preview-session.js") {
		t.Fatalf("missing preview-session.js: %s", body)
	}
```

Add `TestPreviewSessionJSServed` next to `TestOpenPathJSServed`:

```go
func TestPreviewSessionJSServed(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/preview-session.js")
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
		"MinoPreviewSession",
		"kindId",
		"inPlace",
		"decidePreviewAction",
		"preview-navigate",
		"preview-reload",
		"preview-ready",
		"preview-error",
		"parsePreviewMessage",
	} {
		if !strings.Contains(js, marker) {
			t.Fatalf("preview-session.js missing %q", marker)
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
go test ./internal/server/ -run 'TestUIIndexServed|TestPreviewSessionJSServed|TestMarkdownAppsAndRaw' -count=1
```

Expected: FAIL (404 and/or missing script tags).

- [ ] **Step 3: Embed, route, and load the script**

`internal/ui/embed.go` — add `preview-session.js` to the first `go:embed` line:

```go
//go:embed index.html app.js style.css fuzzy.js open-path.js preview-session.js
```

`internal/server/server.go` — next to `/open-path.js`:

```go
	mux.HandleFunc("GET /preview-session.js", embeddedAssetHandler("preview-session.js", "text/javascript; charset=utf-8"))
```

`internal/ui/index.html` — insert before `/app.js`:

```html
  <script src="/open-path.js" defer></script>
  <script src="/preview-session.js" defer></script>
  <script src="/app.js" defer></script>
```

`internal/ui/md/viewer.html` — insert immediately before `viewer.js`:

```html
  <script src="/md/preview-width.js"></script>
  <script src="/preview-session.js"></script>
  <script src="/md/viewer.js"></script>
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```sh
go test ./internal/server/ -count=1
go test ./internal/ui/ -run TestPreviewSessionHelpers -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ui/embed.go internal/ui/index.html internal/ui/md/viewer.html internal/server/server.go internal/server/server_test.go
git commit -m "feat(ui): serve preview-session.js on the workbench"
```

---

### Task 3: Skip same-file clicks; dark navigate-until-load

This task does **not** yet send in-place messages. `decidePreviewAction` returning `"in-place"` still navigates (dark pending + new `src`). Task 4 adds the in-place branch.

**Files:**
- Modify: `internal/ui/style.css`
- Modify: `internal/ui/app.js`
- Modify: `internal/server/server_test.go`

**Interfaces:**
- Consumes: `MinoPreviewSession.decidePreviewAction`, `kindId` / `inPlace` unused for showing until Task 4
- Produces: `openFile(path, force)`; `displayedPath`; `navigatePending` via class `preview-pending`; SSE `changed` calls `openFile(currentPath, true)`

- [ ] **Step 1: Write the failing contracts**

In `TestAppJSWorkbenchContracts` marker list, add:

```go
		"MinoPreviewSession",
		"decidePreviewAction",
		"displayedPath",
		"preview-pending",
		"setPreviewPending",
		"openFile(currentPath, true)",
```

Add negatives in that same test (near the other `strings.Contains` fatals):

```go
	if strings.Contains(js, `if (kind === "changed") preview.src`) {
		t.Fatal("SSE changed must not assign preview.src directly")
	}
```

In the `style.css` marker loop in that test, add:

```go
		"#preview.preview-pending",
		"visibility: hidden",
```

After the css marker loop, add:

```go
	if strings.Contains(css, "background: #ffffff") {
		t.Fatal("style.css must not paint the iframe white")
	}
```

`--fg-strong: #ffffff` stays; only `background: #ffffff` is forbidden.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
go test ./internal/server/ -run TestAppJSWorkbenchContracts -count=1
```

Expected: FAIL on missing markers.

- [ ] **Step 3: CSS**

Replace the `#preview` rule in `internal/ui/style.css` with:

```css
#preview {
  width: 100%;
  min-height: 0;
  flex: 1;
  background: var(--bg-shell);
  border: 0;
}
#preview.preview-pending {
  visibility: hidden;
  pointer-events: none;
}
```

Do not add `display: none` on `.preview-pending`. Keep `#preview[hidden] { display: none !important; }`.

- [ ] **Step 4: Wire `app.js`**

After the `openPath` missing log, add:

```js
  const previewSession = globalThis.MinoPreviewSession;
  if (!previewSession) {
    console.error("MinoPreviewSession is missing; preview updates always navigate");
  }
```

After `let currentPath = "";` add:

```js
  let displayedPath = "";
```

Replace `openFile` / `clearPreview` and the preview `load` / SSE `changed` handling with:

```js
  function setPreviewPending(pending) {
    preview.classList.toggle("preview-pending", !!pending);
  }

  function revealPreviewIfCurrent(path) {
    if (path !== currentPath) return;
    displayedPath = path;
    setPreviewPending(false);
  }

  function decideOpenAction(fromPath, toPath, force) {
    if (!previewSession) {
      if (toPath === fromPath && !force) return "skip";
      return "navigate";
    }
    return previewSession.decidePreviewAction({
      fromPath: fromPath,
      toPath: toPath,
      force: !!force,
      displayedPath: displayedPath,
      navigatePending: preview.classList.contains("preview-pending"),
    });
  }

  function openFile(path, force) {
    const fromPath = currentPath;
    const action = decideOpenAction(fromPath, path, force);
    rememberOpen(path);
    currentPath = path;
    setBreadcrumb(path);
    preview.hidden = false;
    emptyState.hidden = true;
    markSelection();
    syncMdWidthControl();
    persistOpenPath(path);
    if (action === "skip") return;
    setPreviewPending(true);
    preview.src = previewURL(path);
  }

  function clearPreview() {
    currentPath = "";
    displayedPath = "";
    setPreviewPending(false);
    preview.removeAttribute("src");
    preview.hidden = true;
    emptyState.hidden = false;
    setBreadcrumb("");
    markSelection();
    syncMdWidthControl();
    forgetOpenPath();
  }
```

Keep `onPreviewLoad` binding hotkeys and posting Markdown width. Then reveal for **every** kind (Task 4 will gate this):

```js
  function onPreviewLoad() {
    bindPreviewHotkeys();
    postMdWidthToPreview();
    revealPreviewIfCurrent(currentPath);
  }
```

Replace SSE `changed` iframe assignment:

```js
      if (kind === "changed") openFile(currentPath, true);
```

`openFile` callers stay `openFile(path)` except SSE. Tree / Quick Open / restore do not pass `force`.

- [ ] **Step 5: Run tests to verify they pass**

Run:

```sh
go test ./internal/server/ -count=1
go test ./internal/ui/ -run TestPreviewSessionHelpers -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/ui/style.css internal/ui/app.js internal/server/server_test.go
git commit -m "feat(ui): skip same-file preview reload and hide iframe until load"
```

---

### Task 4: In-place Markdown updates

**Files:**
- Modify: `internal/ui/app.js`
- Modify: `internal/ui/md/viewer.js`
- Modify: `internal/server/server_test.go`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 messages; Task 3 `openFile` / `displayedPath` / `setPreviewPending` / `revealPreviewIfCurrent`
- Produces: `openFile` in-place branch (`preview-navigate` vs `preview-reload`); parent shows in-place kinds on `preview-ready` not `load`; viewer fetch-then-swap + generation + scroll restore on same-path reload

- [ ] **Step 1: Write the failing contracts**

`TestAppJSWorkbenchContracts` markers, add:

```go
		"previewNavigateMessage",
		"previewReloadMessage",
		"parsePreviewMessage",
		"preview-ready",
```

Add negative:

```go
	if !strings.Contains(js, `parsed.type === "preview-ready"`) &&
		!strings.Contains(js, `parsed.type === 'preview-ready'`) {
		t.Fatal("app.js must reveal in-place kinds on preview-ready")
	}
```

`TestViewerPipelineMarkers` markers, add:

```go
		"MinoPreviewSession",
		"previewReadyMessage",
		"previewErrorMessage",
		"preview-navigate",
		"preview-reload",
		"requestGen",
		"scrollTo",
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
go test ./internal/server/ -run 'TestAppJSWorkbenchContracts|TestViewerPipelineMarkers' -count=1
```

Expected: FAIL on missing markers.

- [ ] **Step 3: In-place branch and ready gating in `app.js`**

Add:

```js
  function postPreviewToFrame(message) {
    const frame = preview.contentWindow;
    if (!frame || !message) return;
    try {
      frame.postMessage(message, window.location.origin);
    } catch (_err) {}
  }
```

In `openFile`, after `if (action === "skip") return;`, before assigning `src`:

```js
    if (action === "in-place" && previewSession) {
      const message =
        force && path === fromPath
          ? previewSession.previewReloadMessage(path)
          : previewSession.previewNavigateMessage(path);
      postPreviewToFrame(message);
      return;
    }
```

Change `onPreviewLoad` so in-place kinds do **not** reveal on `load`:

```js
  function onPreviewLoad() {
    bindPreviewHotkeys();
    postMdWidthToPreview();
    if (previewSession && previewSession.inPlace(currentPath)) return;
    revealPreviewIfCurrent(currentPath);
  }
```

Add a window message listener (next to `preview.addEventListener("load", onPreviewLoad)`):

```js
  window.addEventListener("message", (event) => {
    if (!previewSession) return;
    const parsed = previewSession.parsePreviewMessage(
      event.data,
      event.origin,
      window.location.origin
    );
    if (!parsed) return;
    if (parsed.type === "preview-ready") {
      revealPreviewIfCurrent(parsed.path);
    }
  });
```

Do not pending-hide on in-place. Leave `preview-error` unhandled in the parent (viewer keeps old DOM).

- [ ] **Step 4: Viewer fetch-then-swap**

In `internal/ui/md/viewer.js`, next to the other `globalThis` helpers:

```js
  const session = globalThis.MinoPreviewSession;
```

Replace `async function render() { ... } render();` with the following. Keep `showError` hiding `#content` on path-change failure. Post `preview-ready` after initial success **and** after page-level error. Keep the existing parse / purify / highlight / KaTeX / Mermaid / `buildToc` body.

```js
  const content = document.querySelector("#content");
  const errorEl = document.querySelector("#error");
  let requestGen = 0;
  let currentRel = content.getAttribute("data-path") || "";

  function showError(msg) {
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function hideError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function encodePath(p) {
    return p.split("/").map(encodeURIComponent).join("/");
  }

  function postPreview(message) {
    if (!session || !message) return;
    try {
      parent.postMessage(message, window.location.origin);
    } catch (_err) {}
  }

  function isMarkdownPath(path) {
    return session ? session.kindId(path) === "markdown" : /\.md$/i.test(path);
  }

  async function paintMarkdown(source) {
    const html = marked.parse(preprocessMath(source));
    const clean = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["class", "id"],
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
    });
    content.innerHTML = clean;

    content.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href)) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      }
    });

    content.querySelectorAll("pre code").forEach((block) => {
      if (block.classList.contains("language-mermaid")) return;
      try {
        hljs.highlightElement(block);
      } catch (_) {
        block.classList.add("render-error");
        block.textContent = "Highlight failed";
      }
    });

    content.querySelectorAll(".math-inline, .math-display").forEach((el) => {
      try {
        katex.render(el.textContent, el, {
          throwOnError: false,
          displayMode: el.classList.contains("math-display"),
        });
      } catch (_) {
        el.classList.add("render-error");
        el.textContent = "Math render failed";
      }
    });

    const mermaidBlocks = content.querySelectorAll("pre code.language-mermaid");
    if (mermaidBlocks.length) {
      mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
      const instances = [];
      for (const block of mermaidBlocks) {
        const pre = block.parentElement;
        const inst = createMermaidBlock(block.textContent, escapeHtml);
        pre.replaceWith(inst.root);
        instances.push(inst);
      }
      for (const inst of instances) {
        try {
          await mermaid.run({ nodes: [inst.diagramEl] });
          inst.cacheBaseSize();
        } catch (_) {
          inst.setRenderFailed();
        }
      }
    }

    buildToc(content);
  }

  async function loadAndPaint(rel, mode) {
    const gen = ++requestGen;
    let source;
    try {
      const res = await fetch("/api/raw/" + encodePath(rel), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      source = await res.text();
    } catch (_e) {
      if (gen !== requestGen) return;
      if (mode === "reload") {
        postPreview(session && session.previewErrorMessage(rel));
        return;
      }
      content.innerHTML = "";
      content.setAttribute("data-path", rel);
      currentRel = rel;
      showError("Failed to load markdown.");
      postPreview(session && session.previewReadyMessage(rel));
      return;
    }

    const scrollX = mode === "reload" ? window.scrollX : 0;
    const scrollY = mode === "reload" ? window.scrollY : 0;
    try {
      await paintMarkdown(source);
    } catch (_e) {
      if (gen !== requestGen) return;
      if (mode === "reload") {
        postPreview(session && session.previewErrorMessage(rel));
        return;
      }
      content.innerHTML = "";
      content.setAttribute("data-path", rel);
      currentRel = rel;
      showError("Failed to parse markdown.");
      postPreview(session && session.previewReadyMessage(rel));
      return;
    }
    if (gen !== requestGen) return;
    hideError();
    content.setAttribute("data-path", rel);
    currentRel = rel;
    if (mode === "reload") window.scrollTo(scrollX, scrollY);
    else window.scrollTo(0, 0);
    postPreview(session && session.previewReadyMessage(rel));
  }

  window.addEventListener("message", (event) => {
    if (!session) return;
    const parsed = session.parsePreviewMessage(
      event.data,
      event.origin,
      window.location.origin
    );
    if (!parsed) return;
    if (parsed.type === "preview-navigate") {
      if (!isMarkdownPath(parsed.path)) return;
      loadAndPaint(parsed.path, "navigate");
      return;
    }
    if (parsed.type === "preview-reload") {
      if (parsed.path !== currentRel) return;
      loadAndPaint(parsed.path, "reload");
    }
  });

  loadAndPaint(currentRel, "initial");
```

Keep `buildToc` and the rest of the file above this block unchanged.

- [ ] **Step 5: README**

Replace the Preview and Live reload bullets in `README.md` with:

```markdown
- **Preview** loads the selected file in an iframe. Clicking the already-open file does not reload it. Markdown-to-Markdown opens reuse the viewer document (old body stays until the new render is ready). Breadcrumbs show the relative path.
- **Live reload** watches the workspace. Added / removed / changed files update the tree; a change to the open Markdown file refetches in the existing viewer; a change to the open HTML file reloads the iframe; a removal clears the preview. If the watcher cannot start, a banner asks you to refresh manually.
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```sh
go test ./internal/server/ -count=1
go test ./internal/ui/ -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/ui/app.js internal/ui/md/viewer.js internal/server/server_test.go README.md
git commit -m "feat(ui): update Markdown preview in place without reloading the iframe"
```

---

## Manual verification (after Task 4)

From repo root:

```sh
go run ./cmd/mino ./example
```

Open the printed URL.

1. Open `example/hello.html`, click it again: iframe does not reload, no white flash.
2. Open `docs/sample.md`, click it again: no reload.
3. With `sample.md` shown, open another `.md` if present, or add a short second file: old Markdown stays until the new body appears (no white, no empty viewer chrome flash).
4. Switch HTML ↔ Markdown and between two HTML apps: dark pane, then content; no `#ffffff` flash.
5. Edit the open `.md` on disk: body updates without a full iframe unload; scroll stays if the document is still long.
6. Edit the open HTML on disk: iframe navigates, dark until load, no white flash.
7. Delete the open file: empty preview.
8. Refresh: `mino-open-path` still restores the file.
9. Quick Open still opens from the iframe via Ctrl/Cmd+E or P; Markdown width still applies without reload.

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Kind table, decide rules, message parse/build | 1 |
| `/preview-session.js` served; index + viewer load it | 2 |
| skip same-file; dark `preview-pending`; SSE uses `openFile(..., true)` | 3 |
| in-place navigate/reload; ready vs load; viewer generation; scroll restore; README | 4 |
| `clearPreview` clears pending + `displayedPath` | 3 |
| Unknown extension → `document` navigate | 1 + 3 |
| No dual iframe / no `/apps/*` change | all |
