# The CADCraft design system

One interface system for the whole app: one token source, one set of canonical widgets, one page
per control, and one check that keeps new surfaces on them. The drawing area keeps its
model-space colours — the system governs the chrome around the drawing.

## Description
One token source, one set of canonical widgets and one check for the interface around the drawing.

## What the system is

- **The token source** is `crates/ui-egui/src/theme.rs`. `Tokens` holds the colours of the dark and
  the light palette (`Tokens::get()` returns the one in use, with the user's drawing-area colours
  applied); the `pub const` recipe values below it — `RADIUS_CONTROL`, `RADIUS_SMALL`,
  `RADIUS_CARD`, `RADIUS_COMPOSER`, `RADIUS_PILL`, the `GAP_*` ladder, `CONTROL_H_BUTTON`,
  `CONTROL_H_INPUT`, `CONTROL_H_ROW`, `CONTROL_H_TAB`, `FONT_BUTTON`, `FONT_CHIP`, `FONT_LABEL`,
  `HAIRLINE`, `HOVER_OPACITY`, `DISABLED_OPACITY`, `FOCUS_OUTLINE_W`, `FOCUS_OUTLINE_OFFSET` —
  are the measured values behind the widgets. Every number quotes the Cursor selector it was
  measured from (`.design-system/cursor/recipes.md`).
- **The widgets** are `crates/ui-egui/src/widgets.rs`: `button`, `icon_button`, `field`, `chip`,
  `row`, `card`, `section_label`. Each reads `Tokens::get()` and the recipe constants, so a
  control's radius, fill, hover, disabled and focus treatment live in one place instead of in
  every surface that draws one.
- **The specs** are this folder: one page per canonical control, each with its states, props,
  keyboard path and tokens — [button](components/button.md), [card](components/card.md),
  [chip](components/chip.md), [field](components/field.md),
  [icon-button](components/icon-button.md), [row](components/row.md),
  [section-label](components/section-label.md). New pages follow
  [spec-template.md](spec-template.md). The rules those pages state are collected in
  [rules.md](rules.md).

## How a surface adopts it

1. Read the page for the control you need, and its rules, before writing the surface.
2. Call the widget (`widgets::button(ui, "Save", Kind::Primary)`) rather than painting a fill,
   border and radius by hand.
3. Take colours, radii, fonts and control heights from `theme::Tokens` and the recipe constants.
   A literal whose value a token or constant already holds is drift.
4. Name the control — a label or a `tooltip` — so accessibility reads what the drawing shows.
5. Run the check below before you finish; it fails on a new literal and holds the ones that
   already exist.

## Where the check lives

- `cargo xtask system-check` — the drift check (`xtask/src/system_check.rs`, beside `layers` and
  `assets`). It reads the token source, so it follows the theme rather than a copy of it.
  `--list-rules` prints the rules, `--explain <rule-id>` one rule with its fix, `--warn` reports
  without failing, and `--ratchet-update` lowers the ratchet after a fix.
- `scripts/check-system-ratchet.json` — the counts of the drift that exists today. A rule whose
  count rises fails the check; `--ratchet-update` lowers a count once the drift is gone and never
  raises one.
- `scripts/check-system.mjs` forwards to the same check for tools that look for it by name, and
  `scripts/gen-docs.mjs` regenerates this folder's twins, [rules.md](rules.md), the index and the
  `AGENTS.md` block; `node scripts/gen-docs.mjs --check` proves the output is current.
- `cargo xtask ci` runs the check with the rest of the gates (fmt, clippy, tests, i18n, assets,
  layers, wasm).
