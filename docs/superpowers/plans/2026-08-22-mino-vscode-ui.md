# Mino VS Code–Inspired UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle Mino’s embedded browser UI into a VS Code Dark Modern–like workbench (activity bar, collapsible Explorer, display-only breadcrumb) without changing backend APIs.

**Architecture:** Keep the existing `embed.FS` UI (`internal/ui/{index.html,style.css,app.js}`). Restructure markup for a workbench shell, replace light-theme CSS with Dark Modern tokens + grid layout, and add minimal JS for sidebar collapse, breadcrumb rendering, and `Ctrl/Cmd+F` search focus. Server routes and catalog/SSE behavior stay unchanged.

**Tech Stack:** Vanilla HTML/CSS/JS embedded in Go; verification via `go test` structural markers + manual browser checks.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-22-mino-vscode-ui-design.md`
- Touch only `internal/ui/index.html`, `internal/ui/style.css`, `internal/ui/app.js`, and extend `internal/server/server_test.go` markers if needed.
- No backend/API/config/watcher changes; no frontend build step; no webfonts/icon packs.
- Dark theme only; no status bar; no tabs; breadcrumb not clickable; sidebar collapse is session-only (in-memory).
- Empty breadcrumb copy: `No file selected` (replace previous `Select a file to preview` in the path chrome).
- Activity bar has a single Files control that toggles the sidebar; Explorer heading includes a collapse control.
- Search stays top-bar center; `Ctrl/Cmd+F` focuses `#search` and must `preventDefault` so the browser find UI does not steal focus from the shell.

---

## File Structure

```text
internal/ui/index.html          # Workbench markup (topbar, activity bar, sidebar, breadcrumb, preview)
internal/ui/style.css           # Dark Modern tokens + layout/component styles
internal/ui/app.js              # Existing tree/search/SSE + collapse + breadcrumb + hotkey
internal/server/server_test.go  # Extend TestUIIndexServed structural markers
```

No new files. Do not move assets out of `internal/ui/`.

---

### Task 1: Workbench markup + structural test

**Files:**
- Modify: `internal/ui/index.html`
- Modify: `internal/server/server_test.go` (`TestUIIndexServed`)
- Test: `internal/server/server_test.go`

**Interfaces:**
- Consumes: existing IDs `#title`, `#search`, `#tree`, `#preview`, `#empty-state`, `#watch-banner` (keep these IDs so Task 3 can attach with minimal churn)
- Produces: DOM structure with `#activity-files`, `#sidebar`, `#sidebar-collapse`, `#breadcrumb` (replace `#preview-path` usage), classes `workbench`, `activity-bar`, `sidebar`, `preview-pane`, `breadcrumb`

- [ ] **Step 1: Extend the failing structural test**

In `TestUIIndexServed`, require these markers in `GET /` body (keep existing `<iframe` and `/app.js`):

```go
for _, marker := range []string{
	"<iframe",
	"/app.js",
	`id="activity-files"`,
	`id="sidebar"`,
	`id="sidebar-collapse"`,
	`id="breadcrumb"`,
	`class="activity-bar"`,
} {
	if !strings.Contains(string(body), marker) {
		t.Fatalf("index missing %q", marker)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/server -run TestUIIndexServed -count=1`

Expected: FAIL with `index missing "id=\"activity-files\""` (or similar first missing marker).

- [ ] **Step 3: Rewrite `internal/ui/index.html` markup**

Replace the body content with this structure (keep `lang`, charset, viewport, `/style.css`, `/app.js defer`):

```html
<body>
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">M</span>
      <h1 id="title">mino</h1>
    </div>
    <label class="search-box">
      <span class="search-icon" aria-hidden="true">⌕</span>
      <span class="sr-only">Search applications</span>
      <input id="search" type="search" placeholder="Search files…" autocomplete="off">
    </label>
  </header>

  <div id="watch-banner" class="banner" hidden>
    Live reload unavailable — refresh manually
  </div>

  <div class="workbench">
    <nav class="activity-bar" aria-label="Activity">
      <button
        type="button"
        id="activity-files"
        class="activity-item active"
        aria-label="Explorer"
        aria-controls="sidebar"
        aria-expanded="true"
        title="Explorer"
      >
        <span aria-hidden="true">☰</span>
      </button>
    </nav>

    <aside id="sidebar" class="sidebar" aria-label="Explorer">
      <div class="sidebar-header">
        <span class="sidebar-title">Explorer</span>
        <button
          type="button"
          id="sidebar-collapse"
          class="icon-button"
          aria-label="Collapse explorer"
          title="Collapse explorer"
        >
          <span aria-hidden="true">⟨</span>
        </button>
      </div>
      <nav id="tree" class="tree">
        <p class="muted">Loading files…</p>
      </nav>
    </aside>

    <section class="preview-pane">
      <div class="breadcrumb-bar" aria-live="polite">
        <div id="breadcrumb" class="breadcrumb">No file selected</div>
      </div>
      <div id="empty-state" class="empty-state">
        <div class="empty-icon" aria-hidden="true">◇</div>
        <strong>No preview selected</strong>
        <span>Choose an HTML file from the sidebar.</span>
      </div>
      <iframe id="preview" title="Application preview" hidden></iframe>
    </section>
  </div>

  <script src="/app.js" defer></script>
</body>
```

Notes:
- Remove old `#preview-path` and `.workspace` / `.pane-heading` / `.preview-bar`.
- Do not change empty-state copy except breadcrumb default text.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/server -run TestUIIndexServed -count=1`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/ui/index.html internal/server/server_test.go
git commit -m "$(cat <<'EOF'
feat(ui): add VS Code–like workbench markup

Introduce activity bar, explorer chrome, and breadcrumb container; extend index structural tests.
EOF
)"
```

---

### Task 2: Dark Modern CSS

**Files:**
- Modify: `internal/ui/style.css` (full replace of theme/layout rules)

**Interfaces:**
- Consumes: Task 1 class/id names (`workbench`, `activity-bar`, `activity-item`, `sidebar`, `sidebar-header`, `breadcrumb`, `body.sidebar-collapsed`)
- Produces: CSS variables and rules so Task 3 only toggles `body.sidebar-collapsed` / `activity-item.active` / `aria-expanded`

- [ ] **Step 1: Replace `internal/ui/style.css` with Dark Modern workbench styles**

Use this as the full file content (adjust only if a selector name differs from Task 1):

```css
:root {
  color-scheme: dark;
  font-family: "Segoe UI", "PingFang SC", "Noto Sans", sans-serif;
  --bg-shell: #181818;
  --bg-sidebar: #1f1f1f;
  --border: #2b2b2b;
  --fg: #cccccc;
  --fg-muted: #6e6e6e;
  --fg-strong: #ffffff;
  --accent: #0078d4;
  --selection: #04395e;
  --hover: #2a2d2e;
  --search-bg: #252526;
  --banner-bg: #5c4b1f;
  --banner-fg: #f5e6a8;
  --banner-border: #8a7326;
}

* { box-sizing: border-box; }

html, body { height: 100%; }

body {
  margin: 0;
  display: flex;
  flex-direction: column;
  min-width: 680px;
  color: var(--fg);
  background: var(--bg-shell);
}

.topbar {
  height: 35px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: var(--bg-shell);
  border-bottom: 1px solid var(--border);
}

.brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.brand h1 {
  margin: 0;
  overflow: hidden;
  color: var(--fg);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.brand-mark {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  color: var(--fg);
  font: 700 11px/1 ui-monospace, monospace;
}

.search-box {
  width: min(420px, 46vw);
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

.banner {
  padding: 6px 12px;
  color: var(--banner-fg);
  background: var(--banner-bg);
  border-bottom: 1px solid var(--banner-border);
  font-size: 12px;
}

.workbench {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 48px minmax(200px, 260px) 1fr;
}

body.sidebar-collapsed .workbench {
  grid-template-columns: 48px 0 1fr;
}

body.sidebar-collapsed .sidebar {
  overflow: hidden;
  border-right-width: 0;
  visibility: hidden;
}

.activity-bar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: var(--bg-shell);
  border-right: 1px solid var(--border);
}

.activity-item {
  width: 100%;
  height: 48px;
  display: grid;
  place-items: center;
  color: #858585;
  background: transparent;
  border: 0;
  border-left: 2px solid transparent;
  cursor: pointer;
  font: inherit;
}
.activity-item:hover { color: var(--fg); }
.activity-item.active {
  color: var(--fg-strong);
  border-left-color: var(--accent);
  background: var(--hover);
}

.sidebar {
  min-width: 0;
  overflow: auto;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
}

.sidebar-header {
  height: 35px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}

.sidebar-title {
  color: #bbbbbb;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.icon-button {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  color: var(--fg-muted);
  background: transparent;
  border: 0;
  border-radius: 3px;
  cursor: pointer;
  font: inherit;
}
.icon-button:hover {
  color: var(--fg);
  background: var(--hover);
}

.tree { padding: 6px 8px; font-size: 13px; }
.tree-list { margin: 0; padding: 0; list-style: none; }
.tree-list .tree-list { padding-left: 16px; }

.tree-row {
  width: 100%;
  height: 22px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  color: var(--fg);
  background: transparent;
  border: 0;
  border-radius: 3px;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.tree-row:hover { background: var(--hover); }
.tree-row.selected {
  color: var(--fg-strong);
  background: var(--selection);
  font-weight: 600;
}
.tree-row .chevron {
  width: 10px;
  color: var(--fg-muted);
  font-size: 10px;
  transition: transform 0.12s ease;
}
.tree-row.expanded .chevron { transform: rotate(90deg); }
.tree-row .file-icon {
  width: 13px;
  color: #858585;
  font-family: ui-monospace, monospace;
}
.tree-row .label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-shell);
}

.breadcrumb-bar {
  height: 35px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border);
}

.breadcrumb {
  overflow: hidden;
  color: var(--fg-muted);
  font-family: ui-monospace, "Cascadia Code", monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.breadcrumb[data-empty="false"] { color: var(--fg); }

#preview {
  width: 100%;
  min-height: 0;
  flex: 1;
  background: #ffffff;
  border: 0;
}

.empty-state {
  flex: 1;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  color: var(--fg-muted);
}
.empty-state[hidden],
#preview[hidden] {
  display: none !important;
}
.empty-state strong { color: var(--fg); font-size: 14px; }
.empty-state span { font-size: 13px; }
.empty-icon { margin-bottom: 4px; color: #4e4e4e; font-size: 34px; }

.muted { margin: 8px; color: var(--fg-muted); font-size: 13px; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

@media (max-width: 800px) {
  .workbench { grid-template-columns: 48px 220px 1fr; }
  body.sidebar-collapsed .workbench { grid-template-columns: 48px 0 1fr; }
}
```

- [ ] **Step 2: Smoke-check CSS is served**

Run: `go test ./internal/server -run 'TestUIIndexServed|Test' -count=1`

Also quickly confirm asset route still works:

```bash
go test ./internal/server -run TestUIIndexServed -count=1
```

Expected: PASS (no Go assertions on CSS content required).

Manual quick check (optional in this task): `go run ./cmd/mino ./example`, open URL, confirm dark shell + activity bar + explorer layout even before JS collapse works.

- [ ] **Step 3: Commit**

```bash
git add internal/ui/style.css
git commit -m "$(cat <<'EOF'
feat(ui): apply VS Code Dark Modern workbench styles

Replace the light zinc chrome with dark tokens, activity-bar grid, and breadcrumb strip styling.
EOF
)"
```

---

### Task 3: Sidebar collapse, breadcrumb, search hotkey

**Files:**
- Modify: `internal/ui/app.js`

**Interfaces:**
- Consumes: `#activity-files`, `#sidebar`, `#sidebar-collapse`, `#breadcrumb`, `#search`, existing open/clear preview flow
- Produces:
  - `setSidebarCollapsed(collapsed: boolean)` — toggles `body.sidebar-collapsed`, syncs `aria-expanded` on `#activity-files`, toggles `.active` on the activity button when expanded
  - `setBreadcrumb(path: string)` — empty → text `No file selected` + `data-empty="true"`; otherwise join `path.split("/")` with ` / ` and `data-empty="false"`
  - `openFile` / `clearPreview` call `setBreadcrumb`
  - `keydown` on `document`: `(metaKey || ctrlKey) && key === 'f'` → `preventDefault()` + `search.focus()` + `search.select()`

- [ ] **Step 1: Wire DOM refs and sidebar collapse helpers**

Near the top of the IIFE (with other `querySelector`s), replace `#preview-path` with breadcrumb/sidebar controls:

```js
  const breadcrumb = document.querySelector("#breadcrumb");
  const activityFiles = document.querySelector("#activity-files");
  const sidebar = document.querySelector("#sidebar");
  const sidebarCollapse = document.querySelector("#sidebar-collapse");
  // keep: title, search, tree, preview, emptyState, watchBanner
```

Add:

```js
  function setSidebarCollapsed(collapsed) {
    // Do not set sidebar.hidden / display:none — that drops the aside from the
    // three-column workbench grid and traps the preview in the 0-width track.
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

  activityFiles.addEventListener("click", toggleSidebar);
  sidebarCollapse.addEventListener("click", () => setSidebarCollapsed(true));
```

Initial state: expanded (`setSidebarCollapsed(false)` once at startup, or rely on markup defaults and only set on toggle).

- [ ] **Step 2: Implement breadcrumb rendering and use it from open/clear**

```js
  function setBreadcrumb(path) {
    if (!path) {
      breadcrumb.textContent = "No file selected";
      breadcrumb.dataset.empty = "true";
      return;
    }
    breadcrumb.textContent = path.split("/").join(" / ");
    breadcrumb.dataset.empty = "false";
  }

  function openFile(path) {
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
```

Remove any remaining `previewPath` references.

- [ ] **Step 3: Add Ctrl/Cmd+F focus handler**

```js
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key !== "f" && event.key !== "F") return;
    event.preventDefault();
    search.focus();
    search.select();
  });
```

Place with the other listeners (near `search.addEventListener`).

- [ ] **Step 4: Verify automated + manual**

Run: `go test ./... -count=1`

Expected: all packages PASS (no API regressions).

Manual (required for this task):

```bash
go run ./cmd/mino ./example
```

Open the printed URL and check:

1. Dark workbench: activity bar + Explorer + preview.
2. Click a file → breadcrumb like `tools / timer.html`; iframe loads.
3. Click Explorer collapse (⟨) → sidebar hides; preview widens; breadcrumb still correct.
4. Click activity Files → sidebar returns; Files shows active accent.
5. Type in search → tree filters as before.
6. Press `Ctrl+F` (or `Cmd+F` on macOS) → search box focuses (browser find bar should not take over).
7. Clear selection path via removing open file on disk or navigate mentally: empty breadcrumb shows `No file selected`.

- [ ] **Step 5: Commit**

```bash
git add internal/ui/app.js
git commit -m "$(cat <<'EOF'
feat(ui): add sidebar collapse, breadcrumb, and search hotkey

Toggle explorer from the activity bar, render display-only path crumbs, and focus search with Ctrl/Cmd+F.
EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Dark Modern tokens / dark-only | Task 2 |
| Activity bar + collapsible Explorer | Tasks 1–3 |
| Display-only breadcrumb | Tasks 1, 3 |
| Top-bar centered search | Task 1 (markup) + existing JS |
| Ctrl/Cmd+F focuses search | Task 3 |
| No status bar / tabs / persistence / backend changes | All tasks (omitted by design) |
| Watch banner restyle | Task 2 |
| Empty states / collapsed preview usable | Tasks 2–3 |
| Structural automated check | Task 1 |
| Manual success criteria | Task 3 Step 4 |

No placeholders remaining; ID/class names are consistent across tasks (`activity-files`, `sidebar-collapse`, `breadcrumb`, `sidebar-collapsed`).
