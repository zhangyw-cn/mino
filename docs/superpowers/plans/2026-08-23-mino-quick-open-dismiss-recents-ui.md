# Quick Open Dismiss, Recents List, and Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Quick Open from the preview iframe, drop the recents footer, and match Command Center / overlay width and 22px row height to VS Code.

**Architecture:** Add a transparent full-viewport `#quick-open-backdrop` under the overlay (`z-index: 40`) so clicks on the preview, Explorer, and chrome dismiss the picker without reaching the iframe. Fold `Escape` into the existing capture hotkey handler so the iframe bridge closes the overlay. Remove `#quick-open-footer`. Give `.search-wrap` and `#quick-open` the same width `min(600px, 70vw)`.

**Tech Stack:** Vanilla HTML/CSS/JS embedded with `go:embed`; `go test` structural markers for HTML/JS/CSS. No Node fuzzy changes. No Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-23-mino-quick-open-dismiss-recents-ui-design.md`
- No frontend build step; no npm libraries; no Playwright.
- Do not change `GET /api/search`, catalog substring semantics, or `internal/ui/fuzzy.js`.
- No command palette, `file results` label, split action, Copilot chrome, Command Center `▾`, recents persistence, or visible dimming.
- Empty-query copy: `Type to search files`. No-match copy: `No matching files.` Overlay placeholder: `Search files by name`.
- Recents: in-memory, max 10, most recent first, unique by path. Empty query lists recents with the same file rows as search hits. No `recently opened` footer.
- Command Center and overlay width: `min(600px, 70vw)`. Command Center height: `24px`. Result row `min-height: 22px`.
- Overlay: `position: fixed`, `top: 4px`, `left: 50%`, `transform: translateX(-50%)`, `z-index: 50`. Backdrop: `position: fixed`, `inset: 0`, `z-index: 40`, `background: transparent`.
- Active row `#37373d`. Match marks `#4fc1ff`. Type chips unchanged.
- Hotkeys: `Ctrl/Cmd+E` and `Ctrl/Cmd+P` (not Alt/Shift). Do not intercept `Ctrl/Cmd+F`. `Escape` closes from shell and preview iframe.
- Backdrop pointerdown: close; do not focus Command Center; do not synthesize a click into the iframe or tree.
- Escape close: focus `#command-center`.
- English UI strings only.

---

## File Structure

```text
internal/ui/index.html               # Add #quick-open-backdrop; remove #quick-open-footer
internal/ui/style.css                # Backdrop; shared width; 24px Command Center; 22px rows
internal/ui/app.js                   # Show/hide backdrop; backdrop pointerdown; iframe Escape; drop footer
internal/server/server_test.go       # HTML/JS/CSS contract markers
```

Do not modify catalog, watcher, config, embed.go, server routes, `fuzzy.js`, `/api/search` handlers, or Node fuzzy tests.

---

### Task 1: Backdrop markup and VS Code density CSS

**Files:**
- Modify: `internal/server/server_test.go` (`TestIndexHTMLHasIframeAndAppJS`, CSS loop in `TestAppJSWorkbenchContracts`)
- Modify: `internal/ui/index.html`
- Modify: `internal/ui/style.css`

**Interfaces:**
- Consumes: nothing from later tasks
- Produces: `#quick-open-backdrop` in the index HTML (`hidden`, `aria-hidden="true"`), sibling of `#quick-open`. No `#quick-open-footer`. CSS: backdrop `position: fixed; inset: 0; z-index: 40; background: transparent`. `.search-wrap` and `#quick-open` width `min(600px, 70vw)`. `#command-center` height `24px`. `.quick-open-item` `min-height: 22px; padding: 1px 8px; gap: 6px`. Input padding `4px 8px`. Empty-row padding `4px 8px`.

- [x] **Step 1: Write the failing HTML/CSS contract tests**

In `TestIndexHTMLHasIframeAndAppJS`, replace the marker list and add forbidden-footer checks. The `for _, marker := range []string{` block that currently includes `id="quick-open-footer"` and `recently opened` becomes:

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
		`id="quick-open-backdrop"`,
		`role="dialog"`,
		`/fuzzy.js`,
		`class="search-wrap"`,
	} {
		if !strings.Contains(html, marker) {
			t.Fatalf("index missing %q", marker)
		}
	}
	if strings.Contains(html, `id="search"`) {
		t.Fatal("index must not include top-bar #search")
	}
	if strings.Contains(html, `id="quick-open-footer"`) {
		t.Fatal("index must not include #quick-open-footer")
	}
	if strings.Contains(html, "recently opened") {
		t.Fatal("index must not include recently opened footer")
	}
```

In `TestAppJSWorkbenchContracts`, extend the CSS marker list (keep existing entries) to:

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
	} {
		if !strings.Contains(css, marker) {
			t.Fatalf("style.css missing contract %q", marker)
		}
	}
```

Leave the `app.js` marker loop in this test unchanged until Task 2.

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
go test ./internal/server/ -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts' -count=1
```

Expected: FAIL. `TestIndexHTMLHasIframeAndAppJS` missing `id="quick-open-backdrop"` and/or still containing `#quick-open-footer` / `recently opened`. `TestAppJSWorkbenchContracts` missing CSS `#quick-open-backdrop`, `inset: 0`, `min(600px, 70vw)`, or `min-height: 22px`.

- [x] **Step 3: Add backdrop markup and remove the footer**

In `internal/ui/index.html`, insert the backdrop immediately before `#quick-open`, and delete the footer node. The block from the Command Center close through the overlay becomes:

```html
    </div>
  </header>

  <div id="quick-open-backdrop" hidden aria-hidden="true"></div>

  <div id="quick-open" role="dialog" aria-label="Quick Open" hidden>
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
  </div>
```

Do not leave `id="quick-open-footer"` or the text `recently opened` anywhere in this file.

- [x] **Step 4: Apply shared width, 24px Command Center, 22px rows, and backdrop CSS**

In `internal/ui/style.css`, replace the `.search-wrap` through `#quick-open-footer[hidden]` block with:

```css
.search-wrap {
  grid-column: 2;
  justify-self: center;
  position: relative;
  width: min(600px, 70vw);
}

#command-center {
  width: 100%;
  height: 24px;
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

#quick-open-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: transparent;
}
#quick-open-backdrop[hidden] { display: none !important; }

#quick-open {
  position: fixed;
  top: 4px;
  left: 50%;
  z-index: 50;
  display: flex;
  flex-direction: column;
  width: min(600px, 70vw);
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
  padding: 4px 8px;
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
  padding: 4px 8px;
  color: var(--fg-muted);
  font-size: 12px;
}
.quick-open-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding: 1px 8px;
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
  min-width: 0;
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
  min-width: 0;
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
```

Delete `#quick-open-footer` and `#quick-open-footer[hidden]` rules entirely. Keep `.banner {` immediately after the dir mark rules.

- [x] **Step 5: Run tests to verify they pass**

Run:

```bash
go test ./internal/server/ -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts' -count=1
```

Expected: PASS. (`TestAppJSWorkbenchContracts` still checks current `app.js` markers; footer JS is still present until Task 2, and that is OK because Task 2 has not yet forbidden `quickOpenFooter`.)

- [x] **Step 6: Commit**

```bash
git add internal/server/server_test.go internal/ui/index.html internal/ui/style.css
git commit -m "$(cat <<'EOF'
feat(ui): size Command Center to cover with a dismiss backdrop

EOF
)"
```

---

### Task 2: Backdrop dismiss, iframe Escape, and recents without footer

**Files:**
- Modify: `internal/server/server_test.go` (`TestAppJSWorkbenchContracts` JS loop)
- Modify: `internal/ui/app.js`

**Interfaces:**
- Consumes: `#quick-open-backdrop` from Task 1
- Produces: `setPickerOpen` shows/hides `quickOpenBackdrop` with the overlay. Backdrop `pointerdown` calls `setPickerOpen(false)` and does not focus `#command-center`. `onQuickOpenHotkey` handles `Ctrl/Cmd+E`/`P` and, when `pickerOpen`, `Escape` (`event.key === "Escape"`): close and focus `#command-center`. Same handler is bound on `document` and `preview.contentDocument` (capture). No `quickOpenFooter` / `recently opened`. Empty-query recents still render as `.quick-open-item` rows.

- [x] **Step 1: Write the failing app.js contract tests**

In `TestAppJSWorkbenchContracts`, replace the JS marker loop with:

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
		"quick-open-input",
		"command-center",
		"commandCenter.title",
		"tabIndex = -1",
		"quickOpenInput.blur()",
		`key === "e"`,
		`key === "p"`,
		"quickOpenBackdrop",
		`key === "Escape"`,
	} {
		if !strings.Contains(js, marker) {
			t.Fatalf("app.js missing contract %q", marker)
		}
	}
	if strings.Contains(js, "quickOpenFooter") {
		t.Fatal("app.js must not reference quickOpenFooter")
	}
	if strings.Contains(js, "recently opened") {
		t.Fatal("app.js must not include recently opened")
	}
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
go test ./internal/server/ -run TestAppJSWorkbenchContracts -count=1
```

Expected: FAIL, missing `quickOpenBackdrop` and/or `key === "Escape"`, and/or still containing `quickOpenFooter`.

- [x] **Step 3: Wire backdrop, Escape, and drop footer in app.js**

Replace the element queries at the top of the IIFE so `quickOpenFooter` is gone and the backdrop is selected:

```javascript
  const title = document.querySelector("#title");
  const commandCenter = document.querySelector("#command-center");
  const quickOpen = document.querySelector("#quick-open");
  const quickOpenInput = document.querySelector("#quick-open-input");
  const quickOpenList = document.querySelector("#quick-open-list");
  const quickOpenBackdrop = document.querySelector("#quick-open-backdrop");
  const tree = document.querySelector("#tree");
```

Replace `setPickerOpen` with:

```javascript
  function setPickerOpen(open) {
    if (open) {
      pickerOpen = true;
      quickOpen.hidden = false;
      quickOpenBackdrop.hidden = false;
      commandCenter.setAttribute("aria-expanded", "true");
      quickOpenInput.setAttribute("aria-expanded", "true");
      return;
    }
    pickerOpen = false;
    quickOpen.hidden = true;
    quickOpenBackdrop.hidden = true;
    commandCenter.setAttribute("aria-expanded", "false");
    quickOpenInput.setAttribute("aria-expanded", "false");
    quickOpenInput.value = "";
    quickOpenInput.removeAttribute("aria-activedescendant");
    activeIndex = -1;
    pickerRows = [];
    quickOpenList.replaceChildren();
    quickOpenInput.blur();
  }
```

In `showPickerMessage`, delete the line `quickOpenFooter.hidden = true;`. The function must be:

```javascript
  function showPickerMessage(message) {
    const status = document.createElement("li");
    status.className = "quick-open-empty";
    status.setAttribute("role", "presentation");
    status.textContent = message;
    quickOpenList.replaceChildren(status);
    pickerRows = [];
    activeIndex = -1;
    quickOpenInput.removeAttribute("aria-activedescendant");
  }
```

In `renderPicker`, delete `const showingRecents = !query;` and delete `quickOpenFooter.hidden = !showingRecents;`. Keep the rest of the function, including recents rows when `!query`. After the `forEach` that appends rows, the function continues:

```javascript
    const restored = previousPath
      ? pickerRows.findIndex((row) => row.path === previousPath)
      : -1;
    activeIndex = restored >= 0 ? restored : 0;
    markPickerActive();
  }
```

Replace `onQuickOpenHotkey` so it also handles Escape (this is what `bindPreviewHotkeys` already attaches to the iframe). The source must include the substring `key === "Escape"`:

```javascript
  function onQuickOpenHotkey(event) {
    if (isQuickOpenHotkey(event)) {
      event.preventDefault();
      setPickerOpen(true);
      renderPicker();
      quickOpenInput.focus();
      quickOpenInput.select();
      return;
    }
    if (!pickerOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setPickerOpen(false);
      commandCenter.focus();
    }
  }
```

Remove the extra document Escape listener. Keep a single capture listener:

```javascript
  document.addEventListener("keydown", onQuickOpenHotkey, true);
  preview.addEventListener("load", bindPreviewHotkeys);
```

Do not remove `bindPreviewHotkeys`; it already does `doc.addEventListener("keydown", onQuickOpenHotkey, true)`.

Add backdrop dismiss **before** the existing document `pointerdown` listener. Do not focus Command Center here:

```javascript
  quickOpenBackdrop.addEventListener("pointerdown", () => {
    if (!pickerOpen) return;
    setPickerOpen(false);
  });
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

Grep `internal/ui/app.js` for `quickOpenFooter` and `recently opened` — both must be gone.

- [x] **Step 4: Run tests to verify they pass**

Run:

```bash
go test ./internal/server/ -run 'TestIndexHTMLHasIframeAndAppJS|TestAppJSWorkbenchContracts|TestFuzzyJSServed' -count=1
go test ./internal/ui/ -count=1
go test ./internal/catalog/ ./internal/server/ -count=1
```

Expected: all PASS. Fuzzy Node tests unchanged and still passing. `/api/search` tests still substring-based.

- [x] **Step 5: Manual check**

Run `go run ./cmd/mino ./example`, open the printed URL, then:

1. `Ctrl+E` / `Ctrl+P`: overlay covers the Command Center at the same width.
2. Open a file, click the preview (HTML and `docs/sample.md`): overlay closes; nothing in the iframe is activated.
3. Open overlay, click Explorer: overlay closes; the file is not selected until a second click.
4. Click the overlay input or a result row: stays open; Enter / click opens the file.
5. Focus the preview, press `Escape`: overlay closes. `Ctrl+E` still opens it.
6. Empty query after opening a file lists recents with no `recently opened` footer. Reload clears recents.
7. Rows look ~22px; Command Center is 24px tall and matches overlay width.

- [x] **Step 6: Commit**

```bash
git add internal/server/server_test.go internal/ui/app.js
git commit -m "$(cat <<'EOF'
feat(ui): dismiss Quick Open from preview clicks and Escape

EOF
)"
```

---

## Self-review vs spec

| Spec requirement | Task |
|------------------|------|
| Transparent `#quick-open-backdrop`, `z-index: 40`, `inset: 0` | 1 |
| Click preview/Explorer/chrome dismisses; click not delivered to iframe/tree | 2 (backdrop `pointerdown` + `z-index`) |
| Backdrop close does not focus Command Center | 2 |
| `Escape` on shell and iframe closes and focuses Command Center | 2 (`onQuickOpenHotkey` + existing iframe bind) |
| Remove `#quick-open-footer` / `recently opened` | 1 HTML/CSS, 2 JS |
| Empty recents use the same file rows | 2 (`renderPicker` recents map unchanged except footer) |
| Shared width `min(600px, 70vw)` | 1 |
| Command Center height 24px | 1 |
| Rows `min-height: 22px`, padding `1px 8px`, gap 6px | 1 |
| Input padding `4px 8px`, empty padding `4px 8px` | 1 |
| No chevron / `file results` / split / Copilot / dimming | Global: do not add |
| Fuzzy / `/api/search` / recents persistence unchanged | Global: do not touch |
| Contract tests for backdrop, width, 22px, Escape, no footer | 1–2 |
