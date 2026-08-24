# Mino Markdown TOC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-side `h1`–`h3` outline to the Markdown iframe viewer with stable heading ids, smooth-scroll jumps, and scroll-spy highlighting.

**Architecture:** Extract pure slug/id helpers into `internal/ui/md/toc.js` (UMD like `preprocess.js`). After the existing sanitize + highlight/KaTeX/Mermaid pipeline in `viewer.js`, assign ids to `h1`–`h3`, build a `#toc` nav from heading text, and bind click + scroll-spy. Layout/CSS live in `viewer.html` / `viewer.css`. No catalog, server routing, or main `app.js` changes beyond embed + contract markers.

**Tech Stack:** Existing Markdown viewer (marked, DOMPurify, highlight.js, KaTeX, Mermaid); plain DOM APIs; Node `node:test` for slug helpers; Go embed + `server_test` string contracts.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-24-mino-markdown-toc-design.md`
- Outline levels: **h1–h3 only**
- Placement: **right** sticky panel; wide (~`min-width: 960px`) expanded by default; narrow collapsed with toggle
- Panel title copy: **On this page**
- No third-party TOC libraries; no inline `[[toc]]`; no main workbench outline
- TOC built with DOM APIs after sanitize (labels from `textContent`)
- Slug: keep ASCII alphanumerics + Unicode letters; whitespace → `-`; empty → `heading`; collisions → `-2`, `-3`, …
- Prefer TDD; commit after each task
- Do not change HTML app preview or SSE reload semantics

---

## File Structure

```text
internal/ui/md/toc.js                 # NEW: slugify, uniqueId, ensureHeadingIds helpers (UMD)
internal/ui/testdata/toc_test.mjs     # NEW: node:test for slug/id helpers
internal/ui/toc_node_test.go          # NEW: Go wrapper to run node --test
internal/ui/md/viewer.html            # Layout: article + aside#toc + toggle
internal/ui/md/viewer.js              # Wire TOC after Mermaid; DOMPurify id allow
internal/ui/md/viewer.css             # Right TOC, levels, active, responsive
internal/ui/embed.go                  # Embed md/toc.js
internal/server/server_test.go        # Contract markers for TOC in viewer.js / html
example/docs/sample.md                # Extra headings for manual TOC demo
README.md                             # One-line outline note
```

---

### Task 1: Slug / unique-id helpers (`toc.js`)

**Files:**
- Create: `internal/ui/md/toc.js`
- Create: `internal/ui/testdata/toc_test.mjs`
- Create: `internal/ui/toc_node_test.go`
- Modify: `internal/ui/embed.go`

**Interfaces:**
- Consumes: none
- Produces (`globalThis.MinoMDToc` / `module.exports`):
  - `function slugify(text: string): string` — trim, lowercase, whitespace→`-`, keep `[a-z0-9]` and Unicode letters (`\p{L}`), strip other chars, collapse `-`, trim `-`
  - `function uniqueId(base: string, used: Set<string>): string` — if `base` empty use `"heading"`; if unused return it and add to set; else append `-2`, `-3`, … until free
  - `function ensureHeadingIds(headings: Iterable<Element>, used?: Set<string>): Array<{ id: string, level: number, text: string }>` — for each element: reuse non-empty `id` if present (still register in `used`); else `el.id = uniqueId(slugify(el.textContent), used)`; push `{ id, level: headingLevel(el), text: textContent trimmed }` where level is 1/2/3 from tagName

- [ ] **Step 1: Write the failing Node tests**

Create `internal/ui/testdata/toc_test.mjs`:

```js
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const { slugify, uniqueId, ensureHeadingIds } = createRequire(import.meta.url)("../md/toc.js");

test("slugify ascii and spaces", () => {
  assert.equal(slugify("  Hello World  "), "hello-world");
});

test("slugify keeps unicode letters", () => {
  assert.equal(slugify("中文 标题"), "中文-标题");
});

test("slugify strips punctuation", () => {
  assert.equal(slugify("Foo: Bar!"), "foo-bar");
});

test("uniqueId dedupes", () => {
  const used = new Set();
  assert.equal(uniqueId("hello", used), "hello");
  assert.equal(uniqueId("hello", used), "hello-2");
  assert.equal(uniqueId("hello", used), "hello-3");
});

test("uniqueId empty falls back to heading", () => {
  const used = new Set();
  assert.equal(uniqueId("", used), "heading");
  assert.equal(uniqueId(slugify("---"), used), "heading-2");
});

test("ensureHeadingIds reuses existing id", () => {
  const used = new Set();
  const el = {
    id: "custom",
    tagName: "H2",
    textContent: "Ignored",
  };
  const items = ensureHeadingIds([el], used);
  assert.deepEqual(items, [{ id: "custom", level: 2, text: "Ignored" }]);
  assert.equal(el.id, "custom");
  assert.ok(used.has("custom"));
});

test("ensureHeadingIds assigns slug and dedupes", () => {
  const used = new Set();
  const a = { id: "", tagName: "H1", textContent: "Same" };
  const b = { id: "", tagName: "H2", textContent: "Same" };
  const items = ensureHeadingIds([a, b], used);
  assert.equal(a.id, "same");
  assert.equal(b.id, "same-2");
  assert.deepEqual(items.map((x) => x.id), ["same", "same-2"]);
});
```

Create `internal/ui/toc_node_test.go` mirroring `preprocess_node_test.go`:

```go
package ui_test

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestTocHelpers(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	testFile := filepath.Join(filepath.Dir(file), "testdata", "toc_test.mjs")
	cmd := exec.Command("node", "--test", testFile)
	cmd.Dir = filepath.Dir(testFile)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("node --test: %v\n%s", err, out)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/ui -run TestTocHelpers -count=1`

Expected: FAIL (cannot find `../md/toc.js` or missing exports).

- [ ] **Step 3: Implement `toc.js` and embed it**

Create `internal/ui/md/toc.js` using the same UMD shell as `preprocess.js`:

```js
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
```

Note: Step 1’s empty-fallback test must use `uniqueId("", used)` and `uniqueId(slugify("---"), used)` (not raw `"---"`), matching `slugify("---") === ""`.

Update `internal/ui/embed.go` go:embed line to include `md/toc.js`:

```go
//go:embed md/viewer.html md/viewer.js md/viewer.css md/preprocess.js md/toc.js
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/ui -run TestTocHelpers -count=1`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/ui/md/toc.js internal/ui/testdata/toc_test.mjs internal/ui/toc_node_test.go internal/ui/embed.go
git commit -m "feat(ui): add markdown heading slug helpers for TOC"
```

---

### Task 2: Viewer chrome — layout, TOC build, scroll spy

**Files:**
- Modify: `internal/ui/md/viewer.html`
- Modify: `internal/ui/md/viewer.js`
- Modify: `internal/ui/md/viewer.css`
- Modify: `internal/server/server_test.go` (`TestViewerPipelineMarkers`, and assert TOC shell in Markdown `/apps/` HTML if useful)

**Interfaces:**
- Consumes: `MinoMDToc.ensureHeadingIds` (and optionally `slugify` / `uniqueId`)
- Produces: visible `#toc` when ≥1 `h1`–`h3`; `.toc-link.active` for scroll spy; heading `id` attributes after render

- [ ] **Step 1: Extend failing contract tests**

In `TestViewerPipelineMarkers`, add markers that the finished `viewer.js` must contain:

```go
"MinoMDToc",
"ensureHeadingIds",
"scrollIntoView",
"On this page",
```

Also assert the Markdown apps HTML (in `TestMarkdownAppsAndRaw` or the same markers test via `/apps/notes/readme.md`) contains:

```go
`id="toc"`
`/md/toc.js`
```

Run: `go test ./internal/server -run 'TestViewerPipelineMarkers|TestMarkdownAppsAndRaw' -count=1`

Expected: FAIL (markers missing).

- [ ] **Step 2: Update `viewer.html` shell**

Replace the body structure with a layout wrapper (keep CSP and script order; insert `toc.js` before `viewer.js`):

```html
<body>
  <div class="md-layout">
    <main id="content" class="markdown-body" data-path="{{.Path}}"></main>
    <aside id="toc" class="toc" hidden>
      <div class="toc-header">
        <span class="toc-title">On this page</span>
        <button type="button" id="toc-toggle" class="toc-toggle" aria-expanded="true" aria-controls="toc-nav">Hide</button>
      </div>
      <nav id="toc-nav" class="toc-nav" aria-label="On this page"></nav>
    </aside>
  </div>
  <p id="error" class="error" hidden></p>
  <!-- existing vendor scripts … -->
  <script src="/md/preprocess.js"></script>
  <script src="/md/toc.js"></script>
  <script src="/md/viewer.js"></script>
</body>
```

- [ ] **Step 3: Implement TOC wiring in `viewer.js`**

After Mermaid post-processing (end of successful render path), call:

```js
const { ensureHeadingIds } = globalThis.MinoMDToc;

// Allow heading ids through sanitize — add before sanitize if ids come from MD HTML;
// we set ids after sanitize, so ADD_ATTR: ["class", "id"] is still needed if any
// pre-existing ids in source HTML should survive. Prefer:
const clean = DOMPurify.sanitize(html, {
  USE_PROFILES: { html: true },
  ADD_ATTR: ["class", "id"],
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
});
```

Then after enhancements:

```js
function buildToc(content) {
  const toc = document.querySelector("#toc");
  const nav = document.querySelector("#toc-nav");
  const toggle = document.querySelector("#toc-toggle");
  if (!toc || !nav) return;

  const headings = content.querySelectorAll("h1, h2, h3");
  const items = ensureHeadingIds(headings);
  nav.replaceChildren();

  if (!items.length) {
    toc.hidden = true;
    return;
  }

  toc.hidden = false;
  for (const item of items) {
    const a = document.createElement("a");
    a.href = "#" + item.id;
    a.className = "toc-link toc-level-" + item.level;
    a.textContent = item.text || item.id;
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      const target = document.getElementById(item.id);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", "#" + item.id);
      setActiveTocLink(item.id);
    });
    nav.appendChild(a);
  }

  if (toggle && !toggle.dataset.bound) {
    toggle.dataset.bound = "1";
    toggle.addEventListener("click", () => {
      const collapsed = toc.classList.toggle("toc-collapsed");
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.textContent = collapsed ? "Show" : "Hide";
    });
  }

  bindScrollSpy(content, items);
}

function setActiveTocLink(id) {
  document.querySelectorAll(".toc-link").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === "#" + id);
  });
}

function bindScrollSpy(content, items) {
  let ticking = false;
  const offset = 48;

  function update() {
    ticking = false;
    let current = items[0] && items[0].id;
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (!el) continue;
      const top = el.getBoundingClientRect().top;
      if (top <= offset) current = item.id;
    }
    if (current) setActiveTocLink(current);
  }

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true }
  );
  update();
}
```

Call `buildToc(content)` at the end of the successful render path (after Mermaid). On error paths, leave `#toc` hidden.

- [ ] **Step 4: Style TOC in `viewer.css`**

Add layout rules (keep `.markdown-body` readable; reduce max-width when TOC visible if needed):

```css
.md-layout {
  display: flex;
  align-items: flex-start;
  gap: 24px;
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 16px;
}

.markdown-body {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 860px;
  margin: 0;
  /* keep existing padding */
}

.toc {
  position: sticky;
  top: 16px;
  flex: 0 0 220px;
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 12px 0 24px;
  font-size: 12px;
  color: #9d9d9d;
}

.toc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.toc-title {
  font-weight: 600;
  color: #cccccc;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 11px;
}

.toc-toggle {
  background: transparent;
  border: 1px solid #3c3c3c;
  color: #cccccc;
  border-radius: 4px;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}

.toc-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toc-link {
  color: #9d9d9d;
  text-decoration: none;
  line-height: 1.35;
  border-left: 2px solid transparent;
  padding: 2px 0 2px 10px;
}

.toc-link:hover {
  color: #e8e8e8;
}

.toc-link.active {
  color: #e8e8e8;
  border-left-color: #3794ff;
}

.toc-level-1 { padding-left: 10px; }
.toc-level-2 { padding-left: 18px; }
.toc-level-3 { padding-left: 26px; }

.toc.toc-collapsed .toc-nav {
  display: none;
}

@media (max-width: 959px) {
  .md-layout {
    flex-direction: column;
    max-width: 860px;
  }
  .toc {
    position: static;
    flex-basis: auto;
    width: 100%;
    max-height: none;
    order: -1;
  }
  .toc:not(.toc-user-expanded) {
    /* On first paint for narrow, start collapsed — set class from JS on matchMedia */
  }
}
```

In `buildToc`, after showing the TOC, sync narrow default:

```js
const narrow = window.matchMedia("(max-width: 959px)").matches;
if (narrow && !toc.classList.contains("toc-user-toggled")) {
  toc.classList.add("toc-collapsed");
  if (toggle) {
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "Show";
  }
}
```

On toggle click, set `toc.classList.add("toc-user-toggled")` so resize does not fight the user (optional but recommended).

- [ ] **Step 5: Re-run contract tests**

Run: `go test ./internal/server -run 'TestViewerPipelineMarkers|TestMarkdownAppsAndRaw' -count=1`

Expected: PASS

Also: `go test ./internal/ui -run 'TestTocHelpers|TestPreprocessMath' -count=1`

Expected: PASS

- [ ] **Step 6: Manual smoke (required before claiming done)**

Run: `go run ./cmd/mino ./example` → open `docs/sample.md` (after Task 3 headings, or temporarily use any multi-heading md).

Check: wide outline visible; click jumps smoothly; scroll updates `.active`; resize/narrow toggle; no headings → TOC hidden; file save reloads outline.

- [ ] **Step 7: Commit**

```bash
git add internal/ui/md/viewer.html internal/ui/md/viewer.js internal/ui/md/viewer.css internal/server/server_test.go
git commit -m "feat(ui): show markdown on-page outline with scroll spy"
```

---

### Task 3: Sample doc + README

**Files:**
- Modify: `example/docs/sample.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 2 viewer behavior
- Produces: demo headings for manual TOC; README mentions outline

- [ ] **Step 1: Extend `example/docs/sample.md`**

Near the top (after the intro paragraph), ensure there is an `h1` (already `# Markdown preview sample`) and at least two `h2` / one `h3`. Add a short section if needed:

```markdown
## Outline demo

### Nested heading

This subsection exists so the right-side **On this page** outline can list `h1`–`h3` and exercise scroll spy.
```

Keep existing GFM / math / mermaid content.

- [ ] **Step 2: README note**

In the Markdown preview paragraph (near the sanitized-viewer sentence), add one sentence:

```markdown
The Markdown viewer also builds an on-page outline from `h1`–`h3` (right side on wide viewports) with click-to-scroll and scroll spy.
```

- [ ] **Step 3: Quick regression**

Run: `go test ./internal/ui ./internal/server -count=1`

Expected: PASS

Manual: open `docs/sample.md` and confirm outline lists the new headings.

- [ ] **Step 4: Commit**

```bash
git add example/docs/sample.md README.md
git commit -m "docs: note markdown outline and demo headings in sample"
```

---

## Spec coverage checklist (plan self-review)

| Spec requirement | Task |
|------------------|------|
| Right-side outline from h1–h3 | Task 2 |
| Wide default show / narrow collapse+toggle | Task 2 |
| Smooth scroll on click | Task 2 |
| Scroll spy active highlight | Task 2 |
| Stable ids + Unicode letters + dedupe | Task 1 |
| Hand-written `#` links when slug matches | Task 1+2 (`id` on headings) |
| Viewer-only; no catalog/app.js/SSE change | All tasks |
| No TOC libs / no `[[toc]]` | Non-goal honored |
| Hide TOC when no headings | Task 2 |
| DOMPurify / textContent safety | Task 2 |
| Tests for slug helpers | Task 1 |
| README + sample | Task 3 |

**Placeholder scan:** No TBD/TODO left in steps.  
**Type consistency:** `ensureHeadingIds` / `slugify` / `uniqueId` / `MinoMDToc` names match across Task 1–2.
