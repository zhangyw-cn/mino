# Interactive States Unification

**Date:** 2026-09-25  
**Status:** Approved for planning  
**Scope:** Cursor, hover, active, focus-visible, and disabled feedback for all Mino-owned clickable UI  
**Approach:** Shared interaction tokens + explicit variants (`mino-icon-button`, `mino-list-row`, `mino-chrome-button`, `mino-status-chip`)

## Problem

Mino’s workbench and Markdown viewer already use a VS Code–like dark shell, but interactive feedback is uneven. Some controls declare `cursor-pointer` and `focus-visible` rings; many `<button>` rows and icon actions still show the default arrow cursor and inconsistent hover/focus/disabled styling. Disabled Explorer header actions partially define disabled look, but there is no shared system to keep the rest aligned.

## Goals

1. Make every Mino-owned clickable (or draggable) control advertise affordance via cursor and visual states.
2. Unify **idle / hover / active / focus-visible / disabled** behind a small set of named variants.
3. Align Workbench (Tailwind) and Markdown viewer (CSS) to the same token values without changing layout or color language.
4. Keep selected-row and Mermaid grab/grabbing behaviors as they are today.

## Non-Goals

- Styling content inside the preview iframe (user HTML apps)
- New features, shortcuts, animations libraries, or a component-library rewrite
- Theme switching or a broader color redesign
- Global forced styles on every bare `button` (variants are opt-in / explicit)
- Changing Explorer selection semantics, Quick Open behavior, or status-bar width logic

## Approach (chosen)

**Shared tokens + explicit variants** (not global element defaults alone, not ad-hoc per-control Tailwind forever).

Define CSS variables once per surface, then four semantic classes. Components keep layout and selection classes; interaction states come from the variant.

### Tokens

| Token | Value | Role |
|-------|-------|------|
| `--mino-focus` | `#0078d4` | Focus ring / chrome border accent |
| `--mino-hover-bg` | `#2a2d2e` | Default hover/active fill for icon buttons, list rows, menu items |
| `--mino-disabled-fg` | `#6e6e6e` | Disabled label/icon color |
| Focus ring | `ring-1` / equivalent outline at ~35% of `--mino-focus` | Only on `:focus-visible` |

### Variants

| Class | Use | Cursor | Hover | Active | Disabled |
|-------|-----|--------|-------|--------|----------|
| `mino-icon-button` | Explorer header actions, activity bar, TOC toggle, Mermaid toolbar buttons | `pointer` | `--mino-hover-bg` | same as hover | `not-allowed` + disabled fg + no hover fill |
| `mino-list-row` | Explorer tree rows, Quick Open rows, status width menu items, TOC links | `pointer` | `--mino-hover-bg` | same as hover | same disabled rules if applicable |
| `mino-chrome-button` | Command Center | `pointer` | border → `--mino-focus` | same as hover | same disabled rules |
| `mino-status-chip` | Status bar width trigger | `pointer` | `white/15` (keep current light chip feedback) | same as hover | same disabled rules |

### Special states (overlays, not separate variants)

- **Selected list rows** (Explorer open file, Quick Open active item): keep `#04395e` selection fill; hover must not replace selection.
- **Mermaid canvas pan**: keep `grab` / `grabbing`; do not attach the four variants to the canvas surface.
- **`disabled` and `aria-disabled="true"`**: both get disabled cursor and visuals; hover background suppressed.

## Control inventory

### Workbench

| Area | Control | Variant |
|------|---------|---------|
| Command Center | Search / workspace button | `mino-chrome-button` |
| Activity bar | Explorer toggle | `mino-icon-button` (keep left border selected chrome) |
| Explorer header | Expand all / Collapse all / Collapse sidebar | `mino-icon-button` |
| Explorer tree | File and folder rows | `mino-list-row` |
| Quick Open | Result rows | `mino-list-row` |
| Status bar | Width trigger | `mino-status-chip` |
| Status bar | Width menu items | `mino-list-row` |

### Markdown viewer

| Area | Control | Variant |
|------|---------|---------|
| TOC | Toggle button | `mino-icon-button` |
| TOC | Outline links | `mino-list-row` |
| Mermaid toolbar / fullscreen chrome | Mode and action buttons | `mino-icon-button` |
| Mermaid canvas | Drag surface | grab/grabbing only |

## Implementation shape

1. **`web/src/styles/index.css`** — declare tokens and Tailwind v4 `@utility` (or equivalent shared classes) for the four variants, including `:hover`, `:active`, `:focus-visible`, `:disabled`, and `[aria-disabled="true"]`.
2. **`web/src/md/viewer.css`** — same token values and same class names so Workbench and viewer stay parallel; replace duplicated `cursor: pointer` rules that the variants cover.
3. **Components** — attach variant classes and remove redundant scattered `cursor-*` / `hover:*` / `focus-visible:*` / `disabled:*` interaction utilities where the variant owns them. Leave layout, selection, and activity-bar border classes in place.
4. **Tests** — update class-name assertions (e.g. StatusBar hover checks) to assert variant class names; keep behavior tests unchanged.
5. **Embed** — rebuild `web` so `internal/ui/dist` picks up the CSS/JS change as in existing Mino UI workflow.

### Naming

Use the same class names on both surfaces: `mino-icon-button`, `mino-list-row`, `mino-chrome-button`, `mino-status-chip`.

## Error and edge handling

- Disabled controls: `cursor: not-allowed`, muted foreground, no hover background.
- Keyboard users always get a visible `:focus-visible` ring; mouse click should not force a persistent thick focus ring.
- Selection takes precedence over hover background on list rows.
- Preview iframe documents are untouched.

## Testing / acceptance

1. Every control in the inventory shows `pointer` on hover when enabled; disabled controls show `not-allowed` and no hover fill.
2. Tabbing to any interactive control shows a focus ring; mouse activation does not require showing that ring.
3. Explorer and Quick Open selected appearance matches current behavior.
4. Mermaid canvas still uses grab/grabbing.
5. User HTML inside the preview iframe is unaffected.
6. Existing related Vitest suites pass after assertion updates.

## YAGNI

- No theme engine, motion library, or shared React `Button` component mandatory for this change.
- No global `button { … }` stylesheet that auto-styles every button without an explicit variant.
