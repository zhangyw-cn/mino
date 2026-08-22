# Mino Markdown Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catalog `.md` files alongside HTML apps and preview them in the existing iframe via an embedded, sanitized, offline Markdown viewer (GFM + highlight + KaTeX + Mermaid).

**Architecture:** Extend catalog entry detection to `.md`. `GET /apps/<rel>` for Markdown returns an embedded viewer HTML shell with a server-injected `data-path`; the viewer fetches `GET /api/raw/<rel>` (`text/plain`), parses GFM, sanitizes with DOMPurify, then post-processes highlight/KaTeX/Mermaid. Vendor JS/CSS/fonts live under `internal/ui/md/` and are served from `/md/…`. Main UI `app.js` stays unchanged.

**Tech Stack:** Go 1.24+ (`embed`, `html/template`, `net/http`); browser libs vendored as min UMD builds: marked, DOMPurify, highlight.js, KaTeX (+ fonts), mermaid.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-22-mino-markdown-preview-design.md`
- Only `.md` (not `.markdown`); no companion asset serving for Markdown; no CDN at runtime
- HTML preview path unchanged (`ServeContent`); `/api/raw/` is `.md`-only
- Sanitize HTML in Markdown (DOMPurify); viewer shell is the iframe document
- Math: `$…$` / `$$…$$` required; also `\(` / `\[`
- Offline: all viewer deps via `go:embed`
- Do not change main workbench `app.js` open/reload flow unless a regression forces it
- Prefer TDD; commit after each task

---

## File Structure

```text
internal/catalog/path.go              # IsMarkdown, IsEntry; keep IsHTML
internal/catalog/path_test.go         # Tests for new helpers
internal/catalog/catalog.go           # Scan + ApplyFSChange use IsEntry
internal/catalog/catalog_test.go      # .md indexing cases
internal/server/server.go             # /api/raw/, MD branch in /apps/, /md/ static
internal/server/server_test.go        # Raw + viewer + regression tests
internal/ui/embed.go                  # Embed md/** assets
internal/ui/md/viewer.html            # Shell template ({{.Path}} / data-path)
internal/ui/md/viewer.js              # Fetch → parse → purify → enhance
internal/ui/md/viewer.css             # Dark reading styles
internal/ui/md/vendor/*               # Pinned minified libs + KaTeX fonts
internal/ui/md/VENDOR.md              # Exact versions + download commands
internal/integration/e2e_test.go      # Optional .md assertions
example/docs/sample.md                # Demo GFM / code / math / mermaid
README.md                             # Document .md preview + security note
```

---

### Task 1: Catalog entry helpers (`.md`)

**Files:**
- Modify: `internal/catalog/path.go`
- Modify: `internal/catalog/path_test.go`
- Modify: `internal/catalog/catalog.go` (Scan + `ApplyFSChange`)
- Modify: `internal/catalog/catalog_test.go`

**Interfaces:**
- Consumes: existing `IsHTML`, `NormalizeRel`, `Scan`, `ApplyFSChange`
- Produces:
  - `func IsMarkdown(name string) bool` — true for `.md` (case-insensitive via `filepath.Ext`)
  - `func IsEntry(name string) bool` — `IsHTML(name) || IsMarkdown(name)`
  - Catalog scan / apply use `IsEntry` instead of `IsHTML` for membership

- [ ] **Step 1: Write failing tests for helpers**

In `internal/catalog/path_test.go`, add:

```go
func TestIsMarkdown(t *testing.T) {
	if !catalog.IsMarkdown("a.MD") || !catalog.IsMarkdown("readme.md") || catalog.IsMarkdown("a.markdown") {
		t.Fatal("IsMarkdown mismatch")
	}
}

func TestIsEntry(t *testing.T) {
	if !catalog.IsEntry("a.html") || !catalog.IsEntry("b.htm") || !catalog.IsEntry("c.md") {
		t.Fatal("IsEntry should accept html/htm/md")
	}
	if catalog.IsEntry("c.markdown") || catalog.IsEntry("d.txt") {
		t.Fatal("IsEntry should reject non-entry types")
	}
}
```

Extend an existing catalog scan test (or add `TestScanIncludesMarkdown`) so a workspace with `notes/a.html` and `notes/readme.md` indexes both, and `notes/x.txt` / `notes/y.markdown` are absent.

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/catalog -run 'TestIsMarkdown|TestIsEntry|TestScan' -count=1`

Expected: FAIL (undefined `IsMarkdown` / `IsEntry`, or scan missing `.md`).

- [ ] **Step 3: Implement helpers and wire catalog**

In `internal/catalog/path.go`:

```go
func IsMarkdown(name string) bool {
	return strings.ToLower(filepath.Ext(name)) == ".md"
}

func IsEntry(name string) bool {
	return IsHTML(name) || IsMarkdown(name)
}
```

In `internal/catalog/catalog.go`, replace `IsHTML(...)` in scan and `ApplyFSChange` with `IsEntry(...)` (two call sites).

Keep `IsHTML` unchanged for server HTML serving checks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/catalog -count=1`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/catalog/path.go internal/catalog/path_test.go internal/catalog/catalog.go internal/catalog/catalog_test.go
git commit -m "feat(catalog): index .md files as catalog entries"
```

---

### Task 2: `/api/raw/` + Markdown `/apps/` shell (without vendor yet)

**Files:**
- Create: `internal/ui/md/viewer.html`
- Modify: `internal/ui/embed.go`
- Modify: `internal/server/server.go`
- Modify: `internal/server/server_test.go`

**Interfaces:**
- Consumes: `catalog.IsHTML`, `catalog.IsMarkdown`, `catalog.Has`, `NormalizeRel`, `ui.FS`
- Produces:
  - `GET /api/raw/<rel>` → `text/plain; charset=utf-8` for catalog `.md` only
  - `GET /apps/<rel>` for `.md` → `text/html` viewer shell with `data-path` set to normalized rel (HTML-escaped)
  - `GET /apps/<rel>` for HTML unchanged
  - Embed includes `md/viewer.html`

- [ ] **Step 1: Write failing server tests**

Create a helper workspace that also writes `notes/readme.md` with body `# Hello\n`.

Add assertions (new test `TestMarkdownAppsAndRaw` or extend existing):

```go
res, err := http.Get(ts.URL + "/apps/notes/readme.md")
// Status 200, Content-Type contains text/html
// Body contains `data-path="notes/readme.md"` and `/md/viewer.js`

res, err = http.Get(ts.URL + "/api/raw/notes/readme.md")
// Status 200, Content-Type contains text/plain
// Body == "# Hello\n" (or exact written bytes)

res, err = http.Get(ts.URL + "/api/raw/notes/a.html")
// Status 404

res, err = http.Get(ts.URL + "/api/raw/../notes/readme.md")
// Status 404 or 403

res, err = http.Get(ts.URL + "/apps/notes/a.html")
// Still contains raw HTML body "<h1>hi</h1>"
```

Also assert `GET /api/search?q=readme` includes `notes/readme.md`.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/server -run 'TestMarkdown|TestTree' -count=1`

Expected: FAIL (404 on raw / MD apps, or missing markers).

- [ ] **Step 3: Add minimal viewer shell + embed**

Create `internal/ui/md/viewer.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Markdown preview</title>
  <link rel="stylesheet" href="/md/viewer.css">
  <link rel="stylesheet" href="/md/vendor/highlight.min.css">
  <link rel="stylesheet" href="/md/vendor/katex.min.css">
</head>
<body>
  <main id="content" class="markdown-body" data-path="{{.Path}}"></main>
  <p id="error" class="error" hidden></p>
  <script src="/md/vendor/marked.min.js"></script>
  <script src="/md/vendor/purify.min.js"></script>
  <script src="/md/vendor/highlight.min.js"></script>
  <script src="/md/vendor/katex.min.js"></script>
  <script src="/md/vendor/mermaid.min.js"></script>
  <script src="/md/viewer.js"></script>
</body>
</html>
```

Update `internal/ui/embed.go`:

```go
package ui

import "embed"

//go:embed index.html app.js style.css md/*
var FS embed.FS
```

Until Task 3/4 add real vendor/js/css, create **placeholder** files so embed compiles:

- `internal/ui/md/viewer.js` — empty or `/* placeholder */`
- `internal/ui/md/viewer.css` — empty
- `internal/ui/md/vendor/.gitkeep` plus empty stubs named exactly as in the HTML (`marked.min.js`, `purify.min.js`, `highlight.min.js`, `highlight.min.css`, `katex.min.js`, `katex.min.css`, `mermaid.min.js`) so routes in Task 3 can replace contents without renaming

Note: `go:embed` cannot embed empty directories; stubs must be non-empty (single newline is enough).

- [ ] **Step 4: Implement server handlers**

In `internal/server/server.go`:

1. Register `GET /api/raw/` → `rawHandler`.
2. Register `GET /md/` → static files from `ui.FS` under `md/` (strip `/md/` prefix; set content types for `.js`, `.css`, `.woff2`, `.ttf`, etc.).
3. Change `appsHandler`:
   - Normalize + `Has` as today.
   - If `catalog.IsHTML(rel)` → existing `ServeContent` path.
   - If `catalog.IsMarkdown(rel)` → parse `md/viewer.html` with `html/template`, execute with `struct{ Path string }{Path: rel}`, write `text/html; charset=utf-8`.
   - Else → 404.

`rawHandler` sketch:

```go
func (s *Server) rawHandler(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.URL.Path, "/api/raw/")
	rel, err := catalog.NormalizeRel(raw)
	if err != nil || rel == "" || !catalog.IsMarkdown(rel) || !s.cat.Has(rel) {
		http.NotFound(w, r)
		return
	}
	// OpenRoot + Open + Stat regular file (same pattern as appsHandler)
	// w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	// io.Copy(w, file)
}
```

For `/md/` serving, reuse a small helper:

```go
func (s *Server) mdAssetHandler(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/md/")
	if name == "" || strings.Contains(name, "..") {
		http.NotFound(w, r)
		return
	}
	data, err := ui.FS.ReadFile("md/" + name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	// set Content-Type from ext; write data
}
```

Prefer `path.Clean` + reject `..` segments; do not use user path with `OpenRoot` here because assets are embed-only.

Cache the parsed `html/template` for viewer.html in `Server` (parse once in `New` or `sync.Once`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./internal/server -count=1`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/ui/embed.go internal/ui/md internal/server/server.go internal/server/server_test.go
git commit -m "feat(server): serve markdown viewer shell and /api/raw"
```

---

### Task 3: Vendor offline libraries (pinned)

**Files:**
- Create: `internal/ui/md/VENDOR.md`
- Replace: `internal/ui/md/vendor/*` with real min builds + KaTeX fonts
- Modify: `internal/ui/md/viewer.html` if font/CSS paths need adjusting
- Modify: KaTeX CSS `url(fonts/…)` → `url(/md/vendor/fonts/…)` **or** place fonts where the CSS expects and serve them

**Interfaces:**
- Consumes: `/md/` static handler from Task 2
- Produces: Working offline scripts/styles at the paths referenced by `viewer.html`

**Pinned versions (use these unless a critical CVE forces a bump; record actual resolved versions in VENDOR.md):**

| Package | Version | Artifact |
|---------|---------|----------|
| marked | 15.0.12 | UMD `marked.min.js` |
| DOMPurify | 3.2.6 | `purify.min.js` |
| highlight.js | 11.11.1 | `highlight.min.js` + a dark CSS (e.g. `github-dark.min.css` saved as `highlight.min.css`) |
| KaTeX | 0.16.22 | `katex.min.js`, `katex.min.css`, `fonts/*` |
| mermaid | 11.6.0 | `mermaid.min.js` (browser build) |

- [ ] **Step 1: Document download commands in `VENDOR.md`**

Write exact `curl -L -o …` (or `npm pack` + copy) commands and SHA256 checksums after download. Example shape:

```markdown
# Markdown viewer vendors

Downloaded on: YYYY-MM-DD

## marked@15.0.12
curl -L -o marked.min.js "https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js"
sha256: …

## DOMPurify@3.2.6
…

## KaTeX fonts
# copy woff2 from katex/dist/fonts into vendor/fonts/
# rewrite katex.min.css url(fonts/ → url(/md/vendor/fonts/
```

- [ ] **Step 2: Download and place files**

Replace Task 2 stubs with real bytes. Ensure `go:embed md/*` still picks up nested `vendor/fonts/*.woff2`.

Rewrite KaTeX CSS font URLs to absolute `/md/vendor/fonts/...` so nested CSS resolves under the Mino origin.

- [ ] **Step 3: Smoke-check assets via tests**

Add `TestMDVendorAssetsServed` in `server_test.go`:

```go
for _, path := range []string{
	"/md/vendor/marked.min.js",
	"/md/vendor/purify.min.js",
	"/md/vendor/highlight.min.js",
	"/md/vendor/katex.min.js",
	"/md/vendor/mermaid.min.js",
	"/md/vendor/katex.min.css",
	"/md/viewer.css",
} {
	res, err := http.Get(ts.URL + path)
	// 200, non-empty body, not the single-newline stub
}
```

- [ ] **Step 4: Run tests**

Run: `go test ./internal/server -run TestMDVendor -count=1`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md internal/server/server_test.go
git commit -m "chore(ui): vendor offline markdown viewer libraries"
```

---

### Task 4: Viewer render pipeline (`viewer.js` + `viewer.css`)

**Files:**
- Modify: `internal/ui/md/viewer.js`
- Modify: `internal/ui/md/viewer.css`
- Optional: `internal/server/server_test.go` marker check that `/md/viewer.js` contains key pipeline strings

**Interfaces:**
- Consumes: `data-path` on `#content`; globals from vendor UMD builds (`marked`, `DOMPurify`, `hljs`, `katex`, `mermaid`)
- Produces: Rendered sanitized preview; page-level `#error` on fetch failure; per-block placeholders on enhance failures

- [ ] **Step 1: Implement `viewer.css`**

Dark reading theme compatible with workbench (`#1e1e1e` / `#cccccc` range). Style `.markdown-body`, tables, code, blockquote, `.error`, `.render-error`. Set `a` for external links without forcing color accessibility regressions.

- [ ] **Step 2: Implement `viewer.js` pipeline**

```javascript
(async function () {
  const content = document.querySelector("#content");
  const errorEl = document.querySelector("#error");
  const rel = content.getAttribute("data-path");

  function showError(msg) {
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function encodePath(p) {
    return p.split("/").map(encodeURIComponent).join("/");
  }

  let source;
  try {
    const res = await fetch("/api/raw/" + encodePath(rel));
    if (!res.ok) throw new Error("HTTP " + res.status);
    source = await res.text();
  } catch (e) {
    showError("Failed to load markdown.");
    return;
  }

  // Configure marked for GFM (marked v15: marked.use({ gfm: true, breaks: false }))
  // Custom renderer or walk: protect mermaid fences as <pre><code class="language-mermaid">
  // Math: transform $...$ / $$...$$ and \(...\) / \[...\] into
  //   <span class="math-inline">...</span> / <div class="math-display">...</div>
  // BEFORE marked parse, OR via a marked extension that only emits those wrappers with text content.

  let html;
  try {
    html = marked.parse(preprocessMath(source));
  } catch (e) {
    showError("Failed to parse markdown.");
    return;
  }

  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // Allow class/span/div needed for math + code; forbid script/on*
  });
  content.innerHTML = clean;

  // External links
  content.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  });

  // Highlight non-mermaid code blocks
  content.querySelectorAll("pre code").forEach((block) => {
    if (block.classList.contains("language-mermaid")) return;
    try {
      hljs.highlightElement(block);
    } catch (_) {
      /* ignore */
    }
  });

  // KaTeX
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

  // Mermaid
  const mermaidBlocks = content.querySelectorAll("pre code.language-mermaid");
  if (mermaidBlocks.length) {
    mermaid.initialize({ startOnLoad: false, theme: "dark" });
    for (const block of mermaidBlocks) {
      const pre = block.parentElement;
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = block.textContent;
      pre.replaceWith(div);
    }
    try {
      await mermaid.run({ nodes: content.querySelectorAll(".mermaid") });
    } catch (_) {
      content.querySelectorAll(".mermaid").forEach((n) => {
        n.classList.add("render-error");
        n.textContent = "Diagram render failed";
      });
    }
  }
})();
```

Implement `preprocessMath` carefully:

- Prefer fenced/code-aware replacement so `$` inside code fences is not treated as math.
- Map `$$…$$` / `\[…\]` → `<div class="math-display">TEX</div>`
- Map `$…$` / `\(…\)` → `<span class="math-inline">TEX</span>`
- HTML-escape TEX text when inserting wrappers so raw `<` in formulas cannot break out before DOMPurify.

DOMPurify must allow `span`/`div` with classes `math-inline` / `math-display`.

- [ ] **Step 3: Structural test for pipeline presence**

```go
res, _ := http.Get(ts.URL + "/md/viewer.js")
body, _ := io.ReadAll(res.Body)
for _, marker := range []string{"DOMPurify", "mermaid", "katex", "/api/raw/"} {
  if !strings.Contains(string(body), marker) {
    t.Fatalf("viewer.js missing %q", marker)
  }
}
```

- [ ] **Step 4: Manual checklist (run locally)**

```sh
go run ./cmd/mino ./example
```

Open printed URL; click `docs/sample.md` (created in Task 5 if not yet — for this task, drop a temporary `example/tmp.md` or wait until Task 5). Verify:

1. Headings / table / task list render  
2. Code block highlighted  
3. Inline and display math render  
4. Mermaid flowchart renders  
5. `<script>alert(1)</script>` in the md source does not execute  
6. Edit file on disk → preview reloads via SSE  

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md/viewer.js internal/ui/md/viewer.css internal/server/server_test.go
git commit -m "feat(ui): render sanitized GFM markdown with highlight, KaTeX, Mermaid"
```

---

### Task 5: Example doc, README, integration coverage

**Files:**
- Create: `example/docs/sample.md`
- Modify: `README.md`
- Modify: `internal/integration/e2e_test.go` (add `.md` tree/raw/apps checks)

**Interfaces:**
- Consumes: finished server + catalog behavior
- Produces: documented UX; e2e proof that `.md` is listed and raw/viewer routes work

- [ ] **Step 1: Add `example/docs/sample.md`**

Include short demos of: GFM table, task list, fenced JS code, `$E=mc^2$`, `$$\\int_0^1 x\,dx$$`, and a small ` ```mermaid ` flowchart. Include a line `<script>alert("xss")</script>` labeled as a sanitizer demo (should not run).

- [ ] **Step 2: Extend e2e**

In `internal/integration/e2e_test.go`, after creating `a.html`, also write `doc.md` with `# doc`, wait for catalog if needed, assert:

- `/api/tree` contains `doc.md`
- `/api/raw/doc.md` body `# doc`
- `/apps/doc.md` is HTML containing `data-path="doc.md"`

Keep existing HTML assertions.

- [ ] **Step 3: Update README**

- Intro: browse/search/preview `.html`/`.htm` **and** `.md`
- Limitations: Markdown companion images/assets still not served; relative images may break
- Security: Markdown is rendered through a sanitized viewer (not a raw executable document); still only use trusted workspaces

- [ ] **Step 4: Run full tests**

Run: `go test ./... -count=1`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add example/docs/sample.md README.md internal/integration/e2e_test.go
git commit -m "docs: document markdown preview and add sample + e2e coverage"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Index `.md` in tree/search | Task 1 |
| Iframe preview via viewer shell | Task 2 |
| `/api/raw/` for source | Task 2 |
| Server-injected path | Task 2 |
| `/md/…` embedded assets | Task 2–3 |
| GFM + highlight + KaTeX + Mermaid | Task 4 |
| DOMPurify / no dangerous HTML | Task 4 |
| Offline vendors | Task 3 |
| No companion MD assets | Global / non-goal (no task adds them) |
| SSE reload unchanged | Relies on existing UI; verified Task 4 manual |
| README + sample | Task 5 |
| HTML regression | Tasks 2, 5 |

## Plan self-review notes

- No TBD placeholders; versions pinned in Task 3 (bump only with VENDOR.md update).
- `IsHTML` remains for HTML serving; membership uses `IsEntry` — consistent across tasks.
- Viewer discovers path only from server-rendered `data-path`, not from the iframe query string.
