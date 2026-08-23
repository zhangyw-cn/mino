# UI Icon Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Unicode glyphs and Quick Open color chips with inline SVG icons across Explorer, Quick Open, Command Center, activity bar, collapse, empty preview, and breadcrumb, and mention Markdown in empty copy.

**Architecture:** Path data and `icon(name, { size })` live in `internal/ui/app.js`. Static chrome uses `data-icon` slots filled once at boot by `fillIcons()`. Tree, Quick Open, and breadcrumb call `icon()` / `fileIconName()` while rendering. No icon font, no build step, no API changes.

**Tech Stack:** Vanilla HTML/CSS/JS embedded with `go:embed`; `go test` structural markers for HTML/JS/CSS. No npm icon packages. No Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-23-mino-ui-icons-design.md`
- No frontend build step; no npm libraries; no icon font; no Playwright.
- Do not change `GET /api/search`, catalog, watcher, config, `embed.go`, or `internal/ui/fuzzy.js`.
- Do not change brand mark (`M`), fuzzy ranking, recents, dismiss layer, or Command Center / overlay width `min(600px, 70vw)`.
- Icon names: `folder`, `folder-open`, `file-html`, `file-md`, `file`, `search`, `explorer`, `collapse`, `empty`.
- Fills: folder `#dcb67a`; `file-html` `#e36e6e`; `file-md` `#519aba`; `file` `#6e6e6e`; chrome icons `currentColor`.
- Tree rows: chevron `▶` plus folder icons; files use type SVG, not `◇`. Quick Open uses the same file SVGs, not color chips.
- Empty preview subtitle: `Choose an HTML or Markdown file from the sidebar.` Empty tree: `No HTML or Markdown files found.`
- `loadMeta` must write the workspace name to `.command-center-label`, never `commandCenter.textContent`.
- English UI strings only.

---

## File Structure

```text
internal/ui/index.html               # data-icon slots; Command Center label; overlay input wrap; empty copy
internal/ui/style.css                # Icon layout; folder open/closed; drop .quick-open-chip
internal/ui/app.js                   # ICON_PATHS, icon(), fillIcons(), fileIconName(); tree/picker/breadcrumb/meta
internal/server/server_test.go       # HTML/JS/CSS contract markers
```

Do not modify catalog, watcher, config, embed.go, server routes, `fuzzy.js`, `/api/search` handlers, or Node fuzzy tests. Do not split `app.js`.

---

### Task 1: Icon slots, empty copy, and chrome CSS

**Files:**
- Modify: `internal/server/server_test.go` (`TestIndexHTMLHasIframeAndAppJS`, CSS loop in `TestAppJSWorkbenchContracts`)
- Modify: `internal/ui/index.html`
- Modify: `internal/ui/style.css`

**Interfaces:**
- Consumes: nothing from later tasks
- Produces: `data-icon` slots (`search` ×2, `explorer`, `collapse`, `empty`); `.command-center-label`; `.quick-open-input-wrap`. CSS for those slots, `.tree-row` folder show/hide, breadcrumb flex. Chip CSS still present until Task 4.

- [ ] **Step 1: Write the failing HTML/CSS contract tests**

In `TestIndexHTMLHasIframeAndAppJS`, keep the existing required-marker loop and forbidden `#search` / footer checks. After the `recently opened` fatal, add:

```go
	for _, marker := range []string{
		`data-icon="search"`,
		`data-icon="explorer"`,
		`data-icon="collapse"`,
		`data-icon="empty"`,
		`class="command-center-label"`,
		`class="quick-open-input-wrap"`,
		"Choose an HTML or Markdown file from the sidebar.",
	} {
		if !strings.Contains(html, marker) {
			t.Fatalf("index missing %q", marker)
		}
	}
	if strings.Contains(html, "☰") {
		t.Fatal("index must not include hamburger glyph")
	}
	if strings.Contains(html, "◇") {
		t.Fatal("index must not include diamond glyph")
	}
	if strings.Contains(html, "Choose an HTML file from the sidebar.") {
		t.Fatal("index must not use HTML-only empty copy")
	}
```

In `TestAppJSWorkbenchContracts`, keep the JS marker loop unchanged. Replace the CSS marker list with:

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
		"#quick-open-backdrop",
		"inset: 0",
		"min(600px, 70vw)",
		"min-height: 22px",
		"z-index: 40",
		"height: 24px",
		"line-height: 22px",
		".quick-open-input-wrap",
		".command-center-label",
		".icon-folder-open",
		".breadcrumb",
	} {
		if !strings.Contains(css, marker) {
			t.Fatalf("style.css missing contract %q", marker)
		}
	}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
go test ./internal/server -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts' -count=1
```

Expected: FAIL with `index missing "data-icon=\"search\""` (or the first missing HTML marker).

- [ ] **Step 3: Update `index.html` slots and copy**

Replace the Command Center button inner text so it is not a single text node:

```html
      <button
        type="button"
        id="command-center"
        title="mino"
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-controls="quick-open"
      >
        <span data-icon="search" data-icon-size="14" aria-hidden="true"></span>
        <span class="command-center-label">mino</span>
      </button>
```

Wrap `#quick-open-input` (keep every input attribute unchanged):

```html
  <div id="quick-open" role="dialog" aria-label="Quick Open" hidden>
    <div class="quick-open-input-wrap">
      <span data-icon="search" data-icon-size="14" aria-hidden="true"></span>
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
    </div>
    <ul id="quick-open-list" role="listbox"></ul>
  </div>
```

Replace the activity-bar glyph span with:

```html
        <span data-icon="explorer" data-icon-size="24" aria-hidden="true"></span>
```

Replace the collapse glyph span with:

```html
          <span data-icon="collapse" data-icon-size="16" aria-hidden="true"></span>
```

Replace the empty-state icon and subtitle:

```html
        <div class="empty-icon" data-icon="empty" data-icon-size="34" aria-hidden="true"></div>
        <strong>No preview selected</strong>
        <span>Choose an HTML or Markdown file from the sidebar.</span>
```

- [ ] **Step 4: Update `style.css` for slots, tree folders, and breadcrumb**

On `#command-center`, add `position: relative`, change `padding: 0 10px` to `padding: 0 24px`, and remove `text-overflow: ellipsis` from the button (the label owns ellipsis). Immediately after `#command-center:focus-visible`, add:

```css
#command-center [data-icon] {
  position: absolute;
  left: 8px;
  top: 50%;
  display: grid;
  place-items: center;
  transform: translateY(-50%);
  color: var(--fg-muted);
  pointer-events: none;
}
.command-center-label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Replace the `#quick-open-input` / `:focus` / `::placeholder` block with wrap + input (focus ring moves to the wrap so the magnifier stays inside it):

```css
.quick-open-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  color: var(--fg-muted);
  border-bottom: 1px solid var(--border);
}
.quick-open-input-wrap:focus-within {
  border-bottom-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
#quick-open-input {
  width: 100%;
  padding: 4px 0;
  color: var(--fg);
  background: transparent;
  border: 0;
  outline: none;
  font: inherit;
}
#quick-open-input::placeholder { color: var(--fg-muted); }
```

After `.tree-row.expanded .chevron { transform: rotate(90deg); }`, replace `.tree-row .file-icon` with:

```css
.tree-row .icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.tree-row > .icon-folder-open { display: none; }
.tree-row.expanded > .icon-folder { display: none; }
.tree-row.expanded > .icon-folder-open { display: block; }
```

Change `.breadcrumb` to a flex row so a leading file icon can sit beside the path. Keep monospace, 12px, ellipsis:

```css
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-muted);
  font-family: ui-monospace, "Cascadia Code", monospace;
  font-size: 12px;
  white-space: nowrap;
}
.breadcrumb .icon { flex-shrink: 0; }
.breadcrumb span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

Keep `.breadcrumb[data-empty="false"] { color: var(--fg); }`.

Change `.empty-icon` so the SVG inherits muted color (drop the unicode font-size):

```css
.empty-icon { margin-bottom: 4px; color: #4e4e4e; }
.empty-icon .icon { display: block; }
```

Leave `.quick-open-chip` rules in place until Task 4.

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
go test ./internal/server -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts' -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/server/server_test.go internal/ui/index.html internal/ui/style.css
git commit -m "$(cat <<'EOF'
feat(ui): add icon slots and chrome icon CSS

EOF
)"
```

---

### Task 2: SVG helper, `fillIcons`, and Command Center label

**Files:**
- Modify: `internal/server/server_test.go` (JS loop in `TestAppJSWorkbenchContracts`)
- Modify: `internal/ui/app.js`

**Interfaces:**
- Consumes: `data-icon` / `data-icon-size` slots from Task 1; existing `basename(path)`
- Produces:
  - `icon(name, options)` → SVGElement (`viewBox="0 0 16 16"`, class `icon icon-{name}`, `aria-hidden="true"`)
  - `fileIconName(path)` → `"file-html"` | `"file-md"` | `"file"`
  - `fillIcons(root)` → replaces children of `[data-icon]` under `root || document`
  - `loadMeta` writes `.command-center-label` only

- [ ] **Step 1: Write the failing JS contract tests**

In `TestAppJSWorkbenchContracts`, add these strings to the JS required-marker slice (keep every existing marker):

```go
		"fileIconName",
		"fillIcons",
		"ICON_PATHS",
		"command-center-label",
		`createElementNS`,
```

After the `recently opened` fatal in the JS half of the test, add:

```go
	if strings.Contains(js, "commandCenter.textContent") {
		t.Fatal("app.js must not set commandCenter.textContent")
	}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
go test ./internal/server -run TestAppJSWorkbenchContracts -count=1
```

Expected: FAIL with `app.js missing contract "fileIconName"`.

- [ ] **Step 3: Add helper functions after `basename`**

Place this block immediately after `function basename(path) { ... }` and before `function parentDir(path)`:

```javascript
  const SVG_NS = "http://www.w3.org/2000/svg";
  const FILE_PATH = "M3.5 1.5h6.25L13 4.75V14.5H3.5z";
  const ICON_PATHS = {
    folder: "M1.5 3h5l1.25 1.5H14.5v8.5H1.5z",
    "folder-open": "M1.5 3.5h4.75l1 1.25H14v1.5H2.25zm.25 3.75L3.25 14h10.25l1.75-6.75z",
    file: FILE_PATH,
    "file-html": FILE_PATH,
    "file-md": FILE_PATH,
    search: "M7 2.25a4.75 4.75 0 1 1 0 9.5 4.75 4.75 0 0 1 0-9.5zm0 1.5a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5zM10.2 10.2l3.3 3.3-.95.95-3.3-3.3z",
    explorer: "M3 2h7.5v1.5H4.5v8.5H3zm2.5 2.5h7.5V15h-7.5z",
    collapse: "M2 2.5h1.75v11H2zm9.5.75L6 8l5.5 4.75z",
    empty: FILE_PATH,
  };
  const ICON_FILLS = {
    folder: "#dcb67a",
    "folder-open": "#dcb67a",
    file: "#6e6e6e",
    "file-html": "#e36e6e",
    "file-md": "#519aba",
  };

  function icon(name, options) {
    const size = options && options.size ? options.size : 16;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", `icon icon-${name}`);
    svg.setAttribute("fill", ICON_FILLS[name] || "currentColor");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICON_PATHS[name]);
    path.setAttribute("fill-rule", "evenodd");
    svg.append(path);
    return svg;
  }

  function fileIconName(path) {
    const base = basename(path).toLowerCase();
    if (base.endsWith(".md")) return "file-md";
    if (base.endsWith(".html") || base.endsWith(".htm")) return "file-html";
    return "file";
  }

  function fillIcons(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-icon]").forEach((slot) => {
      const size = Number(slot.dataset.iconSize) || 16;
      slot.replaceChildren(icon(slot.dataset.icon, { size }));
    });
  }
```

- [ ] **Step 4: Point `loadMeta` at the label and call `fillIcons` on boot**

Replace the three name assignments in `loadMeta` with:

```javascript
      const name = meta.name || "mino";
      title.textContent = name;
      const label = commandCenter.querySelector(".command-center-label");
      if (label) label.textContent = name;
      commandCenter.title = name;
      document.title = `${name} · mino`;
```

At the bottom of the IIFE, call `fillIcons()` before the existing boot sequence:

```javascript
  fillIcons();
  setSidebarCollapsed(false);
  loadMeta();
  loadTree();
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
go test ./internal/server -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts' -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/server/server_test.go internal/ui/app.js
git commit -m "$(cat <<'EOF'
feat(ui): add inline SVG icon helper

EOF
)"
```

---

### Task 3: Explorer tree, breadcrumb, and empty-tree copy

**Files:**
- Modify: `internal/server/server_test.go` (JS loop in `TestAppJSWorkbenchContracts`)
- Modify: `internal/ui/app.js`

**Interfaces:**
- Consumes: `icon(name, options)`, `fileIconName(path)` from Task 2
- Produces: directory rows `▶` + `folder` + `folder-open` + label; file rows type SVG + label; breadcrumb type SVG + path when a file is selected; empty catalog copy `No HTML or Markdown files found.`

- [ ] **Step 1: Write the failing JS contract tests**

Add these strings to the JS required-marker slice:

```go
		`icon("folder")`,
		`icon("folder-open")`,
		"No HTML or Markdown files found.",
```

After the `commandCenter.textContent` fatal, add:

```go
	if strings.Contains(js, `"◇"`) || strings.Contains(js, "'◇'") {
		t.Fatal("app.js must not use diamond file glyphs")
	}
	if strings.Contains(js, "No HTML files found.") {
		t.Fatal("app.js must not use HTML-only empty tree copy")
	}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
go test ./internal/server -run TestAppJSWorkbenchContracts -count=1
```

Expected: FAIL with `app.js missing contract "icon(\"folder\")"`.

- [ ] **Step 3: Render tree icons and update empty-tree copy**

Replace `makeRow`’s indicator + append logic. Keep chevron `▶` for directories. Files get `icon(fileIconName(node.path))`. Directories get both folder SVGs (CSS from Task 1 toggles visibility via `.expanded`).

Replace the block from `const indicator = ...` through `row.append(indicator, label);` with:

```javascript
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = node.name;

    if (node.type === "file") {
      row.append(icon(fileIconName(node.path)), label);
      row.classList.toggle("selected", node.path === currentPath);
      row.addEventListener("click", () => openFile(node.path));
      return row;
    }

    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▶";
    row.append(chevron, icon("folder"), icon("folder-open"), label);
```

Leave the rest of `makeRow` (children list, expand click, wrapper) unchanged. Delete the old `if (node.type === "file") { ... return row; }` that used to sit after `row.append(indicator, label)` — the file branch now returns earlier.

In `renderTreeFromCache`, change the empty message:

```javascript
    if (!list.children.length) showMessage("No HTML or Markdown files found.");
```

- [ ] **Step 4: Put a file icon on the breadcrumb**

Replace `setBreadcrumb` with:

```javascript
  function setBreadcrumb(path) {
    if (!path) {
      breadcrumb.textContent = "No file selected";
      breadcrumb.dataset.empty = "true";
      return;
    }
    const text = document.createElement("span");
    text.textContent = path.split("/").join(" / ");
    breadcrumb.replaceChildren(icon(fileIconName(path)), text);
    breadcrumb.dataset.empty = "false";
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
go test ./internal/server -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts' -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/server/server_test.go internal/ui/app.js
git commit -m "$(cat <<'EOF'
feat(ui): use file and folder icons in Explorer

EOF
)"
```

---

### Task 4: Quick Open file icons

**Files:**
- Modify: `internal/server/server_test.go` (`TestAppJSWorkbenchContracts` JS + CSS markers)
- Modify: `internal/ui/app.js`
- Modify: `internal/ui/style.css`

**Interfaces:**
- Consumes: `icon(name, options)`, `fileIconName(path)` from Task 2
- Produces: Quick Open rows start with class `quick-open-icon` SVG; no `fileChipClass`; no `.quick-open-chip` CSS

- [ ] **Step 1: Write the failing chip-removal tests**

In the JS required-marker slice, add:

```go
		"quick-open-icon",
```

After the HTML-only empty-tree fatal, add:

```go
	if strings.Contains(js, "fileChipClass") {
		t.Fatal("app.js must not use fileChipClass")
	}
	if strings.Contains(js, "quick-open-chip") {
		t.Fatal("app.js must not use quick-open-chip")
	}
```

In the CSS marker list, remove `".quick-open-chip"` and add `".quick-open-icon"`. After the CSS loop, add:

```go
	if strings.Contains(css, ".quick-open-chip") {
		t.Fatal("style.css must not include .quick-open-chip")
	}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
go test ./internal/server -run TestAppJSWorkbenchContracts -count=1
```

Expected: FAIL with `app.js missing contract "quick-open-icon"` (or `app.js must not use fileChipClass` if that fatal runs first after other new markers already exist — either failure is the red bar).

- [ ] **Step 3: Swap picker chips for `icon(fileIconName(...))`**

Delete `function fileChipClass(path) { ... }` entirely.

In `renderPicker`, replace the chip span with:

```javascript
      const typeIcon = icon(fileIconName(row.path));
      typeIcon.classList.add("quick-open-icon");

      const name = document.createElement("span");
      name.className = "quick-open-name";
      const base = basename(row.path);
      const baseOffset = row.path.length - base.length;
      appendHighlighted(name, base, row.matches, baseOffset);

      button.append(typeIcon, name);
```

Keep the parent-dir span, event listeners, and `item.append(button)` unchanged.

- [ ] **Step 4: Replace chip CSS with `.quick-open-icon`**

Delete:

```css
.quick-open-chip {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  background: #6e6e6e;
  border-radius: 2px;
}
.quick-open-chip.html { background: #e36e6e; }
.quick-open-chip.md { background: #519aba; }
```

Add in the same place:

```css
.quick-open-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
go test ./internal/server -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts' -count=1
go test ./... -count=1
```

Expected: both PASS.

- [ ] **Step 6: Manual check**

Run `go run ./cmd/mino ./example`, open the printed URL, and verify:

1. Activity bar shows the explorer SVG; collapse shows the left-panel SVG; both still change color on hover/active.
2. Command Center has a muted magnifier on the left; workspace name stays centered.
3. Quick Open (`Ctrl+P` / click Command Center) shows a magnifier in the input; HTML rows are red document icons; Markdown rows are blue; recents and matching still work.
4. Explorer: directories have `▶` plus gold folder; expanding swaps to open-folder; `hello.html` vs `docs/sample.md` use different colors.
5. Opening a file puts the matching icon in the breadcrumb.
6. Empty preview copy mentions HTML or Markdown.
7. Sidebar collapse, live reload, and iframe preview still work.

- [ ] **Step 7: Commit**

```bash
git add internal/server/server_test.go internal/ui/app.js internal/ui/style.css
git commit -m "$(cat <<'EOF'
feat(ui): use file icons in Quick Open

EOF
)"
```

---

## Self-review

| Spec requirement | Task |
|------------------|------|
| Inline SVG helper, `ICON_PATHS`, `icon()`, `fillIcons()`, `fileIconName()` | 2 |
| Tree chevron + folder / folder-open | 3 |
| Tree HTML vs Markdown vs generic file icons | 3 |
| Quick Open file icons, drop chips | 4 |
| Command Center search icon + label (no `textContent` wipe) | 1 + 2 |
| Overlay input magnifier | 1 + 2 |
| Activity bar explorer, collapse | 1 + 2 |
| Breadcrumb file icon | 3 |
| Empty preview icon + HTML/Markdown copy | 1 + 2 |
| Empty tree copy | 3 |
| Contract tests for slots, helper, chips, copy | 1–4 |
| No API / fuzzy / embed / icon-font changes | Global constraints |
