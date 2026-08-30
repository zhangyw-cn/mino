# Companion Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve allowlisted companion files under `/apps/` for HTML and Markdown previews, and force-reload the open preview when a directly referenced asset changes.

**Architecture:** `internal/asset` classifies paths (allowlist, dot-segment, ignore). `GET /apps/` serves catalog HTML/Markdown first, then allowlisted files via `OpenRoot` + `ServeContent` with `Cache-Control: no-store`. The watcher emits `asset-changed` / `asset-removed` without mutating the catalog. The shell scans the open file’s source with `MinoAssetRefs` and force-reloads on matching SSE.

**Tech Stack:** Go 1.24.4, `go:embed` UI, Node `node:test` for the UMD helper. No npm packages, no Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-30-mino-companion-assets-design.md`
- Catalog `IsEntry` stays `.html` / `.htm` / `.md` only. Assets never enter `catalog.files` or Explorer / Quick Open / `/api/tree`.
- `/apps/` order: normalize → catalog HTML → catalog Markdown viewer → allowed asset → 404. Never 403 for policy misses.
- Allowlist (case-insensitive last suffix): `png jpg jpeg gif webp svg ico css js mjs woff woff2 ttf otf json wasm`
- Any path segment starting with `.` is denied. Ignore rules (built-in + config) apply. `/api/raw/` stays Markdown-only.
- Direct references only: scan the open HTML/MD source, not CSS internals. No site-root `/images/x.png` mapping.
- `force` reload uses existing `openFile(currentPath, true)` (Markdown in-place, HTML navigate). `asset-*` SSE must not call `loadTree()`.
- Prefer TDD; commit after each task.

---

## File Structure

```text
internal/asset/asset.go                         # NEW: Allowed(rel, ignored)
internal/asset/asset_test.go                    # NEW
internal/catalog/catalog.go                     # EventAssetChanged / EventAssetRemoved
internal/server/server.go                      # /apps/ step 4; GET /asset-refs.js
internal/server/server_test.go                 # asset GETs, headers, 404s, JS contracts
internal/watcher/watcher.go                    # emit asset events when catalog is silent
internal/watcher/watcher_test.go               # css changed/removed; html unchanged
internal/ui/asset-refs.js                       # NEW: MinoAssetRefs
internal/ui/testdata/asset_refs_test.mjs        # NEW
internal/ui/asset_refs_node_test.go            # NEW
internal/ui/embed.go                            # embed asset-refs.js
internal/ui/index.html                         # script /asset-refs.js before /app.js
internal/ui/app.js                             # scan + asset-* SSE
internal/integration/e2e_test.go               # serve css/png; SSE asset-changed
example/tools/styled.html                      # NEW
example/tools/styled.css                        # NEW
example/docs/photo.svg                         # NEW
example/docs/sample.md                         # relative image
README.md                                      # allowlist instead of “not served”
```

Do not change `/api/raw/`, Quick Open ranking, Markdown CSP, or preview-session kind rules.

---

### Task 1: `internal/asset` allowlist

**Files:**
- Create: `internal/asset/asset.go`
- Create: `internal/asset/asset_test.go`

**Interfaces:**
- Consumes: `catalog.NormalizeRel`
- Produces: `asset.Allowed(rel string, ignored func(string) bool) bool`

- [ ] **Step 1: Write the failing tests**

Create `internal/asset/asset_test.go`:

```go
package asset_test

import (
	"testing"

	"github.com/zhangyw-cn/mino/internal/asset"
	"github.com/zhangyw-cn/mino/internal/ignore"
)

func TestAllowedExtensions(t *testing.T) {
	exts := []string{
		"png", "jpg", "jpeg", "gif", "webp", "svg", "ico",
		"css", "js", "mjs", "woff", "woff2", "ttf", "otf", "json", "wasm",
	}
	for _, ext := range exts {
		rel := "notes/file." + ext
		if !asset.Allowed(rel, nil) {
			t.Fatalf("Allowed(%q) = false, want true", rel)
		}
	}
	if !asset.Allowed("notes/file.PNG", nil) {
		t.Fatal("extension must be case-insensitive")
	}
	if !asset.Allowed("notes/file.CSS", nil) {
		t.Fatal("extension must be case-insensitive")
	}
}

func TestAllowedRejects(t *testing.T) {
	ignored := func(rel string) bool { return rel == "skip/app.css" }
	cases := []struct {
		rel  string
		fn   func(string) bool
		name string
	}{
		{"notes/a.html", nil, "html"},
		{"notes/a.htm", nil, "htm"},
		{"notes/a.md", nil, "md"},
		{"notes/secret.go", nil, "go"},
		{"notes/app.css.map", nil, "map"},
		{".env", nil, "dotfile"},
		{"dir/.secret.png", nil, "dot segment"},
		{"notes/../outside.css", nil, "escape"},
		{"/abs.png", nil, "absolute"},
		{"skip/app.css", ignored, "ignored"},
	}
	for _, tc := range cases {
		if asset.Allowed(tc.rel, tc.fn) {
			t.Fatalf("%s: Allowed(%q) = true, want false", tc.name, tc.rel)
		}
	}
}

func TestAllowedUsesIgnoreMatcher(t *testing.T) {
	m, err := ignore.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	if asset.Allowed("node_modules/pkg.css", m.Match) {
		t.Fatal("node_modules css must be denied")
	}
	if !asset.Allowed("tools/app.css", m.Match) {
		t.Fatal("tools/app.css must be allowed")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/asset/`

Expected: FAIL with `package internal/asset is not in std` or `no required module provides package`

- [ ] **Step 3: Implement `Allowed`**

Create `internal/asset/asset.go`:

```go
package asset

import (
	"path"
	"strings"

	"github.com/zhangyw-cn/mino/internal/catalog"
)

var allowExt = map[string]struct{}{
	".png": {}, ".jpg": {}, ".jpeg": {}, ".gif": {}, ".webp": {}, ".svg": {},
	".ico": {}, ".css": {}, ".js": {}, ".mjs": {}, ".woff": {}, ".woff2": {},
	".ttf": {}, ".otf": {}, ".json": {}, ".wasm": {},
}

// Allowed reports whether rel may be served as a companion asset.
// Existence is not checked. ignored, if non-nil, is called with the normalized rel.
func Allowed(rel string, ignored func(string) bool) bool {
	rel, err := catalog.NormalizeRel(rel)
	if err != nil || rel == "" {
		return false
	}
	if hasDotSegment(rel) {
		return false
	}
	ext := strings.ToLower(path.Ext(rel))
	if _, ok := allowExt[ext]; !ok {
		return false
	}
	if ignored != nil && ignored(rel) {
		return false
	}
	return true
}

func hasDotSegment(rel string) bool {
	for _, part := range strings.Split(rel, "/") {
		if strings.HasPrefix(part, ".") {
			return true
		}
	}
	return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/asset/`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/asset/asset.go internal/asset/asset_test.go
git commit -m "feat(asset): add companion file allowlist"
```

---

### Task 2: Serve allowlisted files on `/apps/`

**Files:**
- Modify: `internal/server/server.go` (`appsHandler`, add `serveAssetFile`; `Handler` later tasks add the JS route)
- Modify: `internal/server/server_test.go` (new `TestCompanionAssets`)

**Interfaces:**
- Consumes: `asset.Allowed(rel, s.cat.Ignored)`
- Produces: `GET /apps/<rel>` 200 for allowlisted regular files with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`

- [ ] **Step 1: Write the failing server tests**

Add to `internal/server/server_test.go` (after `TestTreeSearchAndApps`):

```go
func TestCompanionAssets(t *testing.T) {
	_, ts, root := newTestServer(t)
	defer ts.Close()

	if err := os.WriteFile(filepath.Join(root, "notes", "app.css"), []byte("body{color:red}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes", "secret.go"), []byte("package n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "notes", ".hidden"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes", ".hidden", "x.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}

	res, err := http.Get(ts.URL + "/apps/notes/app.css")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("app.css status %d", res.StatusCode)
	}
	if string(body) != "body{color:red}" {
		t.Fatalf("app.css body = %q", body)
	}
	if res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", res.Header.Get("Cache-Control"))
	}
	if res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}

	res, err = http.Get(ts.URL + "/apps/notes/a.html")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), "<h1>hi</h1>") {
		t.Fatal("catalog HTML must still be served")
	}
	if res.Header.Get("Cache-Control") == "no-store" {
		t.Fatal("catalog HTML must not gain asset no-store")
	}

	res, err = http.Get(ts.URL + "/apps/notes/readme.md")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), `data-path="notes/readme.md"`) {
		t.Fatal("markdown must remain the viewer")
	}

	for _, url := range []string{
		"/apps/notes/secret.go",
		"/apps/notes/.hidden/x.png",
		"/apps/missing.css",
	} {
		res, err = http.Get(ts.URL + url)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("%s status %d, want 404", url, res.StatusCode)
		}
	}

	res, err = http.Get(ts.URL + "/api/tree")
	if err != nil {
		t.Fatal(err)
	}
	treeBody, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if strings.Contains(string(treeBody), "app.css") {
		t.Fatal("tree must not list companion css")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/server/ -run TestCompanionAssets`

Expected: FAIL `app.css status 404`

- [ ] **Step 3: Implement serving**

In `internal/server/server.go`, add the import:

```go
"github.com/zhangyw-cn/mino/internal/asset"
```

Replace `appsHandler` with:

```go
func (s *Server) appsHandler(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.URL.Path, "/apps/")
	rel, err := catalog.NormalizeRel(raw)
	if err != nil || rel == "" {
		http.NotFound(w, r)
		return
	}
	if s.cat.Has(rel) {
		switch {
		case catalog.IsHTML(rel):
			s.serveAppFile(w, r, rel)
		case catalog.IsMarkdown(rel):
			s.serveMarkdownViewer(w, r, rel)
		default:
			http.NotFound(w, r)
		}
		return
	}
	if asset.Allowed(rel, s.cat.Ignored) {
		s.serveAssetFile(w, r, rel)
		return
	}
	http.NotFound(w, r)
}
```

Add `serveAssetFile` next to `serveAppFile`:

```go
func (s *Server) serveAssetFile(w http.ResponseWriter, r *http.Request, rel string) {
	root, err := os.OpenRoot(s.root)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer root.Close()

	file, err := root.Open(rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, rel, info.ModTime(), file)
}
```

- [ ] **Step 4: Run tests**

Run: `go test ./internal/server/ -run 'TestCompanionAssets|TestTreeSearchAndApps|TestMarkdownAppsAndRaw'`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/server/server.go internal/server/server_test.go
git commit -m "feat(server): serve allowlisted companion files under /apps"
```

---

### Task 3: Watcher `asset-changed` / `asset-removed`

**Files:**
- Modify: `internal/catalog/catalog.go` (add two `EventKind` constants)
- Modify: `internal/watcher/watcher.go`
- Modify: `internal/watcher/watcher_test.go`

**Interfaces:**
- Consumes: `asset.Allowed`, `catalog.Ignored`
- Produces: `catalog.EventAssetChanged` (`"asset-changed"`), `catalog.EventAssetRemoved` (`"asset-removed"`); published when `ApplyFSChange` returns no events

- [ ] **Step 1: Write the failing watcher tests**

Append to `internal/watcher/watcher_test.go`:

```go
func TestWatcherEmitsAssetChangedWithoutCataloging(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "tools"), 0o755); err != nil {
		t.Fatal(err)
	}
	cat := newCatalog(t, root)
	events := make(chan catalog.Event, 16)

	w, err := watcher.Start(root, cat, func(batch []catalog.Event) {
		for _, event := range batch {
			events <- event
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	css := filepath.Join(root, "tools", "app.css")
	if err := os.WriteFile(css, []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventAssetChanged, Path: "tools/app.css"})
	if cat.Has("tools/app.css") {
		t.Fatal("css must not be a catalog entry")
	}

	if err := os.WriteFile(css, []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventAssetChanged, Path: "tools/app.css"})

	if err := os.Remove(css); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventAssetRemoved, Path: "tools/app.css"})
}

func TestWatcherStillEmitsHTMLChanged(t *testing.T) {
	root := t.TempDir()
	html := filepath.Join(root, "a.html")
	if err := os.WriteFile(html, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	cat := newCatalog(t, root)
	events := make(chan catalog.Event, 8)

	w, err := watcher.Start(root, cat, func(batch []catalog.Event) {
		for _, event := range batch {
			events <- event
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	if err := os.WriteFile(html, []byte("v2"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventChanged, Path: "a.html"})
}

func TestWatcherIgnoresNonAssets(t *testing.T) {
	root := t.TempDir()
	cat := newCatalog(t, root)
	events := make(chan catalog.Event, 8)

	w, err := watcher.Start(root, cat, func(batch []catalog.Event) {
		for _, event := range batch {
			events <- event
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package m"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("x=1"), 0o644); err != nil {
		t.Fatal(err)
	}

	timeout := time.NewTimer(300 * time.Millisecond)
	defer timeout.Stop()
	select {
	case got := <-events:
		t.Fatalf("unexpected event %+v", got)
	case <-timeout.C:
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/watcher/ -run 'TestWatcherEmitsAsset|TestWatcherIgnoresNonAssets'`

Expected: FAIL (undefined `EventAssetChanged` and/or timeout waiting for css)

- [ ] **Step 3: Add event kinds and watcher publish**

In `internal/catalog/catalog.go` constants:

```go
const (
	EventAdded         EventKind = "added"
	EventRemoved       EventKind = "removed"
	EventChanged       EventKind = "changed"
	EventAssetChanged  EventKind = "asset-changed"
	EventAssetRemoved  EventKind = "asset-removed"
)
```

In `internal/watcher/watcher.go` add import `github.com/zhangyw-cn/mino/internal/asset`.

Replace `handle`’s catalog publish and the two `ApplyFSChange` call sites in `addTree` with `w.publish`:

```go
func (w *Watcher) handle(event fsnotify.Event) {
	removed := event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename)
	changed := event.Has(fsnotify.Create) || event.Has(fsnotify.Write)
	if !removed && !changed {
		return
	}

	if event.Has(fsnotify.Create) {
		info, err := os.Lstat(event.Name)
		if err == nil && info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
			_ = w.addTree(event.Name, true)
		}
	}

	w.publish(event.Name, removed)
}

func (w *Watcher) publish(absPath string, removed bool) {
	events := w.cat.ApplyFSChange(absPath, removed)
	if len(events) == 0 {
		if ev, ok := w.assetEvent(absPath, removed); ok {
			events = []catalog.Event{ev}
		}
	}
	if len(events) > 0 && w.onEvents != nil {
		w.onEvents(events)
	}
}

func (w *Watcher) assetEvent(absPath string, removed bool) (catalog.Event, bool) {
	rel, err := filepath.Rel(w.root, absPath)
	if err != nil {
		return catalog.Event{}, false
	}
	rel, err = catalog.NormalizeRel(rel)
	if err != nil || rel == "" {
		return catalog.Event{}, false
	}
	if !asset.Allowed(rel, w.cat.Ignored) {
		return catalog.Event{}, false
	}
	kind := catalog.EventAssetChanged
	if removed {
		kind = catalog.EventAssetRemoved
	}
	return catalog.Event{Kind: kind, Path: rel}, true
}
```

In `addTree`, replace both:

```go
events := w.cat.ApplyFSChange(path, false)
if len(events) > 0 && w.onEvents != nil {
	w.onEvents(events)
}
```

with `w.publish(path, false)`.

- [ ] **Step 4: Run watcher tests**

Run: `go test ./internal/watcher/`

Expected: PASS (including existing HTML tests)

- [ ] **Step 5: Commit**

```bash
git add internal/catalog/catalog.go internal/watcher/watcher.go internal/watcher/watcher_test.go
git commit -m "feat(watcher): emit asset-changed SSE without cataloging"
```

---

### Task 4: `MinoAssetRefs` helper

**Files:**
- Create: `internal/ui/testdata/asset_refs_test.mjs`
- Create: `internal/ui/asset_refs_node_test.go`
- Create: `internal/ui/asset-refs.js`

**Interfaces:**
- Consumes: nothing
- Produces: `globalThis.MinoAssetRefs` / `module.exports`:
  - `extractURLs(source) → string[]`
  - `resolveRef(fromFile, url) → string | null`
  - `referencedPaths(fromFile, source) → string[]` (unique, insertion order)

- [ ] **Step 1: Write the failing Node tests**

Create `internal/ui/testdata/asset_refs_test.mjs`:

```js
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const { extractURLs, resolveRef, referencedPaths } = createRequire(import.meta.url)(
  "../asset-refs.js"
);

test("resolveRef relative and parent", () => {
  assert.equal(resolveRef("tools/timer.html", "./style.css"), "tools/style.css");
  assert.equal(resolveRef("tools/timer.html", "style.css"), "tools/style.css");
  assert.equal(resolveRef("docs/sample.md", "../shared/a.css"), "shared/a.css");
  assert.equal(resolveRef("docs/sample.md", "/apps/docs/a.png"), "docs/a.png");
  assert.equal(resolveRef("docs/sample.md", "/apps/docs/my%20pic.png"), "docs/my pic.png");
});

test("resolveRef skips non-workspace", () => {
  assert.equal(resolveRef("docs/a.md", "https://example.com/a.png"), null);
  assert.equal(resolveRef("docs/a.md", "data:image/png;base64,xx"), null);
  assert.equal(resolveRef("docs/a.md", "//cdn/x.png"), null);
  assert.equal(resolveRef("docs/a.md", "#heading"), null);
  assert.equal(resolveRef("docs/a.md", "/foo.png"), null);
  assert.equal(resolveRef("docs/a.md", "../../../etc/passwd"), null);
  assert.equal(resolveRef("docs/a.md", "mailto:a@b.c"), null);
});

test("resolveRef strips query and hash", () => {
  assert.equal(resolveRef("tools/a.html", "style.css?v=1#x"), "tools/style.css");
});

test("extractURLs finds attrs, url, import, markdown", () => {
  const src = `
<link href="a.css">
<img src='b.png' poster="c.jpg">
style="background:url(d.webp)"
@import "e.css";
@import url("f.css");
![x](g.png)
[label](h.js)
`;
  const urls = extractURLs(src);
  for (const want of ["a.css", "b.png", "c.jpg", "d.webp", "e.css", "f.css", "g.png", "h.js"]) {
    assert.ok(urls.includes(want), `missing ${want} in ${JSON.stringify(urls)}`);
  }
});

test("referencedPaths unique", () => {
  const paths = referencedPaths("docs/a.md", "![x](pic.svg)\n<img src=\"./pic.svg\">");
  assert.deepEqual(paths, ["docs/pic.svg"]);
});
```

Create `internal/ui/asset_refs_node_test.go`:

```go
package ui_test

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestAssetRefs(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	testFile := filepath.Join(filepath.Dir(file), "testdata", "asset_refs_test.mjs")
	cmd := exec.Command("node", "--test", testFile)
	cmd.Dir = filepath.Dir(testFile)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("node --test: %v\n%s", err, out)
	}
}
```

- [ ] **Step 2: Run Node tests to verify they fail**

Run: `go test ./internal/ui/ -run TestAssetRefs`

Expected: FAIL (`Cannot find module` or node cannot load `asset-refs.js`)

- [ ] **Step 3: Implement the helper**

Create `internal/ui/asset-refs.js`:

```js
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

  function extractURLs(source) {
    if (typeof source !== "string" || !source) return [];
    const out = [];
    const attr = /\b(?:src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let m;
    while ((m = attr.exec(source))) out.push(m[1] || m[2] || m[3] || "");
    const urlFn = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+?))\s*\)/gi;
    while ((m = urlFn.exec(source))) out.push((m[1] || m[2] || m[3] || "").trim());
    const imp = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)')/gi;
    while ((m = imp.exec(source))) out.push(m[1] || m[2] || "");
    const md = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)/g;
    while ((m = md.exec(source))) out.push(m[1]);
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

  return { extractURLs, resolveRef, referencedPaths };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/ui/ -run TestAssetRefs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/ui/asset-refs.js internal/ui/testdata/asset_refs_test.mjs internal/ui/asset_refs_node_test.go
git commit -m "feat(ui): add companion URL extract and resolve helper"
```

---

### Task 5: Embed helper and wire workbench scan + SSE

**Files:**
- Modify: `internal/ui/embed.go`
- Modify: `internal/ui/index.html`
- Modify: `internal/server/server.go` (`Handler`)
- Modify: `internal/ui/app.js`
- Modify: `internal/server/server_test.go` (`TestIndexHTMLHasIframeAndAppJS`, `TestAppJSWorkbenchContracts`, new `TestAssetRefsJSServed`)

**Interfaces:**
- Consumes: `MinoAssetRefs.referencedPaths`, SSE `asset-changed` / `asset-removed`
- Produces: `refreshAssetRefs(path)` in `app.js`; `referencedAssets` Set; `GET /asset-refs.js`

- [ ] **Step 1: Write failing contracts**

In `TestIndexHTMLHasIframeAndAppJS` marker list, add `"/asset-refs.js"`. After the `preview-session.js` order check, add:

```go
	refsSrc := strings.Index(html, `src="/asset-refs.js"`)
	if refsSrc < 0 || refsSrc > appSrc {
		t.Fatal("index must load /asset-refs.js before /app.js")
	}
```

Copy `TestPreviewSessionJSServed` as `TestAssetRefsJSServed` hitting `/asset-refs.js` with markers `MinoAssetRefs`, `extractURLs`, `resolveRef`, `referencedPaths`.

In `TestAppJSWorkbenchContracts` marker list add:

```go
		"MinoAssetRefs",
		"referencedPaths",
		"refreshAssetRefs",
		"referencedAssets",
		`["asset-changed", "asset-removed"]`,
		"referencedAssets.has(event.path)",
```

After the marker loop, add:

```go
	assetLoop := strings.Index(js, `["asset-changed", "asset-removed"]`)
	if assetLoop < 0 {
		t.Fatal("app.js must listen for asset SSE kinds")
	}
	assetSlice := js[assetLoop:]
	if end := strings.Index(assetSlice, "fillIcons();"); end >= 0 {
		assetSlice = assetSlice[:end]
	}
	if strings.Contains(assetSlice, "loadTree()") {
		t.Fatal("asset SSE must not call loadTree()")
	}
```

- [ ] **Step 2: Run contracts to verify they fail**

Run: `go test ./internal/server/ -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts|TestAssetRefsJSServed'`

Expected: FAIL missing `/asset-refs.js` and/or `MinoAssetRefs`

- [ ] **Step 3: Embed, route, and implement app.js**

`internal/ui/embed.go` first `go:embed` line:

```go
//go:embed index.html app.js style.css fuzzy.js open-path.js preview-session.js asset-refs.js
```

`internal/server/server.go` `Handler()`, next to the other JS routes:

```go
	mux.HandleFunc("GET /asset-refs.js", embeddedAssetHandler("asset-refs.js", "text/javascript; charset=utf-8"))
```

`internal/ui/index.html` before `/app.js`:

```html
  <script src="/asset-refs.js" defer></script>
  <script src="/app.js" defer></script>
```

In `internal/ui/app.js`, after the `previewSession` missing log:

```js
  const assetRefs = globalThis.MinoAssetRefs;
  if (!assetRefs) {
    console.error("MinoAssetRefs is missing; companion reload is disabled");
  }
```

After `let pickerRows = [];` add:

```js
  let referencedAssets = new Set();
  let assetScanGen = 0;
```

Replace `openFile` so skip returns before scan, and every other action scans:

```js
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
    refreshAssetRefs(path);
    if (action === "in-place" && previewSession) {
      const message =
        force && path === fromPath && displayedPath === path
          ? previewSession.previewReloadMessage(path)
          : previewSession.previewNavigateMessage(path);
      postPreviewToFrame(message);
      return;
    }
    setPreviewPending(true);
    preview.src = previewURL(path);
  }
```

Add helpers (near `previewURL`):

```js
  function catalogSourceURL(path) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    if (mdWidth && mdWidth.isMarkdownPath(path)) {
      return `/api/raw/${encoded}`;
    }
    return `/apps/${encoded}`;
  }

  function refreshAssetRefs(path) {
    const gen = ++assetScanGen;
    if (!assetRefs || !path) {
      referencedAssets = new Set();
      return;
    }
    fetch(catalogSourceURL(path), { cache: "no-store" })
      .then((res) => (res.ok ? res.text() : Promise.reject()))
      .then((source) => {
        if (gen !== assetScanGen) return;
        referencedAssets = new Set(assetRefs.referencedPaths(path, source));
      })
      .catch(() => {
        if (gen !== assetScanGen) return;
        referencedAssets = new Set();
      });
  }
```

In `clearPreview`, after clearing `currentPath`:

```js
    assetScanGen += 1;
    referencedAssets = new Set();
```

After the existing `added`/`removed`/`changed` SSE loop, add:

```js
  for (const kind of ["asset-changed", "asset-removed"]) {
    events.addEventListener(kind, (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch (error) {
        console.error("Invalid asset event", error);
        return;
      }
      if (!currentPath) return;
      if (!referencedAssets.has(event.path)) return;
      openFile(currentPath, true);
    });
  }
```

- [ ] **Step 4: Run tests**

Run: `go test ./internal/server/ -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts|TestAssetRefsJSServed|TestCompanionAssets'`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/ui/embed.go internal/ui/index.html internal/ui/app.js internal/server/server.go internal/server/server_test.go
git commit -m "feat(ui): reload preview when a referenced companion file changes"
```

---

### Task 6: Integration test

**Files:**
- Modify: `internal/integration/e2e_test.go`

**Interfaces:**
- Consumes: `/apps/` asset serving, watcher `asset-changed`
- Produces: e2e coverage that CSS/PNG are served and CSS writes emit `asset-changed` without appearing in the tree

- [ ] **Step 1: Write the failing e2e test**

Append to `internal/integration/e2e_test.go`:

```go
func TestE2ECompanionAssetsAndSSE(t *testing.T) {
	root, cat, ts := startStack(t)

	if err := os.MkdirAll(filepath.Join(root, "tools"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "tools", "app.css"), []byte("body{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pic.svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 0o644); err != nil {
		t.Fatal(err)
	}

	assertBody(t, ts.URL+"/apps/tools/app.css", "body{}")
	assertBodyContains(t, ts.URL+"/apps/pic.svg", "<svg")
	if cat.Has("tools/app.css") || cat.Has("pic.svg") {
		t.Fatal("assets must not enter the catalog")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept", "text/event-stream")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	lines := make(chan string)
	go func() {
		defer close(lines)
		scanner := bufio.NewScanner(res.Body)
		for scanner.Scan() {
			select {
			case lines <- scanner.Text():
			case <-ctx.Done():
				return
			}
		}
	}()

	if err := os.WriteFile(filepath.Join(root, "tools", "app.css"), []byte("body{color:red}"), 0o644); err != nil {
		t.Fatal(err)
	}

	timeout := time.After(10 * time.Second)
	var saw bool
	var payload string
	for !saw || payload == "" {
		select {
		case line, ok := <-lines:
			if !ok {
				t.Fatal("event stream closed before asset-changed")
			}
			switch {
			case line == "event: asset-changed":
				saw = true
			case saw && strings.HasPrefix(line, "data: "):
				payload = strings.TrimPrefix(line, "data: ")
			}
		case <-timeout:
			t.Fatal("timed out waiting for asset-changed")
		}
	}
	var event struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		t.Fatal(err)
	}
	if event.Path != "tools/app.css" {
		t.Fatalf("path = %q, want tools/app.css", event.Path)
	}
}
```

- [ ] **Step 2: Run to verify it fails** (if Task 3 is done it may already pass; if Task 3 is not done, FAIL)

Run: `go test ./internal/integration/ -run TestE2ECompanionAssetsAndSSE -count=1`

Expected: FAIL until Task 3 is merged; after Task 3+2: PASS

If it PASSes on first run because earlier tasks landed, keep the test.

- [ ] **Step 3: No extra implementation unless the test failed for a real bug; fix only if needed**

- [ ] **Step 4: Run full related suite**

Run: `go test ./internal/asset/ ./internal/watcher/ ./internal/server/ ./internal/integration/ ./internal/ui/`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/integration/e2e_test.go
git commit -m "test: cover companion asset serving and asset-changed SSE"
```

---

### Task 7: Example workspace and README

**Files:**
- Create: `example/tools/styled.html`
- Create: `example/tools/styled.css`
- Create: `example/docs/photo.svg`
- Modify: `example/docs/sample.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `/apps/` relative resolution
- Produces: `mino ./example` demo for HTML+CSS and Markdown image

- [ ] **Step 1: Add example files**

`example/tools/styled.css`:

```css
:root { color-scheme: dark; --bg: #1e1e1e; --fg: #cccccc; --accent: #0078d4; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center;
  font-family: ui-sans-serif, system-ui, sans-serif;
  background: var(--bg); color: var(--fg);
}
.card {
  padding: 1.5rem 1.75rem; border: 1px solid #2b2b2b; border-radius: 8px;
}
h1 { margin: 0 0 .5rem; font-size: 1.1rem; }
p { margin: 0; color: #6e6e6e; }
```

`example/tools/styled.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Styled · Mino Example</title>
  <link rel="stylesheet" href="./styled.css" />
</head>
<body>
  <div class="card">
    <h1>Companion CSS</h1>
    <p>This page loads <code>styled.css</code> from the same directory.</p>
  </div>
</body>
</html>
```

`example/docs/photo.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="8" fill="#0078d4"/>
  <circle cx="32" cy="32" r="14" fill="#ffffff"/>
</svg>
```

In `example/docs/sample.md`, replace the GFM table companion row and add an image after the outline section:

Table cell: `| Companion images | Relative SVG via /apps/ |`

After `## Outline demo` / nested heading, add:

```markdown
## Companion image

![sample mark](./photo.svg)
```

- [ ] **Step 2: Update README**

Replace the `## Limitations` section with:

```markdown
## Limitations

HTML apps may load companion files from the workspace through relative URLs (the browser requests `/apps/<dir>/…`). Mino serves a fixed allowlist: `png` `jpg` `jpeg` `gif` `webp` `svg` `ico` `css` `js` `mjs` `woff` `woff2` `ttf` `otf` `json` `wasm`. Paths with a `.`-prefixed segment, ignore matches (including `.git` / `.mino` / `node_modules`), and other extensions 404.

Companion files do not appear in Explorer or Quick Open. Site-root URLs like `/images/x.png` are not mapped onto the workspace. Changing a CSS file that the open HTML references reloads the preview; files only mentioned inside that CSS (for example `url(bg.png)`) do not.
```

Also in `## Markdown preview`, keep sanitization; the older “relative images may break” sentence in Limitations is removed by the replacement above.

In `## Security`, after the paragraph about `/apps/*`, add one sentence:

```markdown
Allowlisted companion files are served from the same origin under `/apps/` as well.
```

- [ ] **Step 3: Run tests that parse README/example? none required. Run `go test ./...`**

Run: `go test ./...`

Expected: PASS

- [ ] **Step 4: Manual check**

Run: `go run ./cmd/mino ./example`

Open the printed URL. Confirm Explorer has `styled.html` and `sample.md` but not `styled.css` / `photo.svg`. Open `tools/styled.html` and see styled card. Open `docs/sample.md` and see the blue SVG. Edit `example/tools/styled.css` on disk and confirm the HTML preview reloads.

- [ ] **Step 5: Commit**

```bash
git add example/tools/styled.html example/tools/styled.css example/docs/photo.svg example/docs/sample.md README.md
git commit -m "docs: demonstrate companion CSS and Markdown images"
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
|------------------|------|
| `/apps/` catalog then allowlist | 2 |
| Allowlist + dot-segment + ignore + 404 | 1, 2 |
| `Cache-Control: no-store` on assets only | 2 |
| Not in tree / Quick Open / catalog | 1–3, 6, 7 |
| Watcher `asset-changed` / `asset-removed` | 3 |
| Scan open source; skip on `skip` | 4, 5 |
| `asset-*` does not `loadTree` | 5 |
| Direct refs only; no `/foo.png` mapping | 4 |
| README + example | 7 |
| `/api/raw/` unchanged | (no task touches it) |
