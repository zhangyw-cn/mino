# Mino Markdown TOC (大纲) Design

**Date:** 2026-08-24  
**Status:** Approved for planning  
**Form:** Extend the existing Markdown iframe viewer only (`internal/ui/md/`)

## Problem

Long Markdown notes in Mino’s preview are hard to navigate: headings render, but there is no outline to jump between sections, no scroll-position indicator, and heading anchors are not guaranteed for in-document `#` links.

## Goals

1. Show a **right-side outline** built from `h1`–`h3` in the rendered Markdown preview.
2. On wide viewports, show the outline by default; on narrow viewports, allow collapse/expand.
3. Clicking an outline entry **smooth-scrolls** to that heading.
4. While scrolling, **highlight** the outline entry for the current section (scroll spy).
5. Assign **stable heading `id`s** so hand-written `[text](#slug)` links can jump when the slug matches.
6. Keep changes inside the Markdown viewer; do not change catalog, main workbench UI, or SSE.

## Non-Goals

- Inline TOC markers (`[[toc]]`, `<!-- toc -->`, etc.)
- Outline in the main Mino Explorer / activity bar
- Server-side TOC generation
- Third-party TOC libraries (tocbot, markdown-it-toc, …)
- Changing which heading levels are included beyond `h1`–`h3`
- Markdown editing
- Companion assets / relative image serving (unchanged from Markdown preview design)

## Approach (chosen)

**Post-DOM outline after the existing sanitize pipeline.**

Alternatives considered:

1. **Post-DOM collect (chosen)** — After `marked` → DOMPurify → `#content` inject and highlight/KaTeX/Mermaid, walk `h1`–`h3`, set ids, build `#toc`. Touches only `viewer.js` / `viewer.css` / possibly `viewer.html`; no new vendors; ids match what the user sees.
2. **Custom `marked` heading renderer** — Collect outline during parse; must stay consistent with DOMPurify and any later DOM mutations; more coupling for little gain.
3. **Vendored TOC library** — Faster polish, larger embed surface and another dependency to pin/update.

## Architecture

```text
Existing MD pipeline (unchanged through Mermaid):
  fetch /api/raw → preprocessMath → marked → DOMPurify → #content
  → highlight / KaTeX / Mermaid

New post-step (viewer only):
  → ensureHeadingIds(h1–h3)
  → buildTocNav() → #toc (hidden if empty)
  → bindTocClicks (smooth scroll)
  → bindScrollSpy (active class)
```

| Module | Change |
|--------|--------|
| `viewer.html` | Optional `#toc` / toggle control markup; layout wrapper if needed |
| `viewer.js` | Id slug + dedupe, TOC build, click + scroll spy; DOMPurify `ADD_ATTR` / allowed tags as needed for `id` and nav |
| `viewer.css` | Right sticky TOC, hierarchy indent, active state, responsive collapse |
| Catalog / server / `app.js` | **No change** |

On SSE `changed`, the main UI reloads the iframe as today; the outline is rebuilt on each full viewer render.

## UI

- Sticky panel on the **right** of the article (~220px), visually aligned with the existing dark Markdown reading theme.
- Panel title: **On this page** (English, consistent with current viewer chrome copy).
- Entries indented by level (`h1` / `h2` / `h3`).
- **Wide** (approx. `min-width: 960px`): outline expanded by default.
- **Narrow**: outline collapsed by default; a small control toggles visibility.
- **Active** entry uses a clear accent (compatible with workbench dark colors).
- If the document has **no** `h1`–`h3`, do not reserve outline space (hide the panel).

## Behavior

### Heading ids

1. Prefer an existing non-empty `id` on the heading.
2. Otherwise derive a slug from the heading’s visible text: trim, lowercase, whitespace → `-`; keep ASCII alphanumerics and Unicode letters (so Chinese headings stay meaningful); strip other punctuation/symbols unsafe for HTML ids / URL fragments.
3. On collision, append `-2`, `-3`, … until unique within the document.
4. If the slug is empty after stripping, use fallback `heading`, then apply the same dedupe suffix rules.

### Navigation

- Outline links use `href="#id"`. Click: `preventDefault` + `scrollIntoView({ behavior: "smooth", block: "start" })` on the target heading (within the iframe scroll container).
- Scroll spy: on scroll (throttled/rAF), find the last heading whose top is above a small offset from the viewport top; mark that outline entry `active` (and clear others).
- In-document Markdown links to `#slug` work when the slug matches a generated or preserved id (browser default hash navigation is acceptable; smooth scroll for those links is optional and not required).

### Sanitize

- DOMPurify must allow heading `id` attributes after sanitize (extend `ADD_ATTR` if needed).
- TOC markup is built with DOM APIs after sanitize (not from untrusted HTML strings), so outline structure does not need to round-trip through Markdown HTML.

## Error handling

| Case | Behavior |
|------|----------|
| No `h1`–`h3` | Hide TOC; document body unchanged |
| Duplicate heading text | Distinct ids via `-2`, `-3`, …; all entries listed |
| Missing target on click | No-op (ignore) |
| Render / fetch failure | Existing page-level error; no TOC |
| Iframe reload (SSE) | Full re-render rebuilds ids + TOC + listeners |

## Security

- No new network or server surfaces.
- Outline labels are taken from heading **textContent** (not raw HTML).
- Ids are constrained to a safe slug alphabet; do not inject unsanitized HTML into the TOC.
- Existing CSP and DOMPurify policy remain; only minimal allowlist widening for `id` (and any nav attributes the implementation needs).

## Testing

- **Automated:** Extract or cover slug/dedupe helpers (Node test alongside existing `preprocess` / fuzzy tests, or a small pure function test). Contract checks that viewer source mentions TOC / heading-id behavior if the project already uses string contracts for `viewer.js`.
- **Manual:** Sample doc with `h1`–`h3` and duplicates; click jumps; scroll spy updates; narrow viewport toggle; reload on file change; hand-written `[x](#slug)` when slug matches; doc with no headings hides TOC.

## Success criteria

1. Markdown with `h1`–`h3` shows a right-side outline on wide viewports.
2. Clicking an entry smooth-scrolls to the heading; scroll spy highlights the current section.
3. Narrow viewports can show/hide the outline; empty-heading docs hide it.
4. Heading ids are stable enough for matching `#` fragment links.
5. HTML app preview and the rest of the Markdown pipeline (GFM, highlight, KaTeX, Mermaid, SSE reload) behave as before.

## Documentation updates (implementation follow-up)

- README: one short note that Markdown preview includes an on-page outline for `h1`–`h3`.
- Optional: extend `example/docs/sample.md` with enough headings to demo the outline.
