# The web system's design decisions

The lock for the SolidJS UI (`apps/ui`), taken in the design-system run of 2026-10-28. The design
source is the running Cursor 3.27.22 desktop app, measured live
(`.design-system/research/cursor-recipes-2026-10-28.md`). The values live in `src/tokens.css`; this
file records the picks and the reasons, so the next surface does not re-litigate them.

## Canonical picks

The web UI grows six canonical components under `src/ui/`, each a thin wrapper over the native
element. The per-surface hand-rolled classes they replace are named below; a class loses because it
is a one-off with no shared API and no states.

- **Button** — pick `ui/Button.tsx` (native `<button>`). Variants `primary | secondary | ghost | danger`, default `secondary` (Cursor's own default button). Loses: `.button` (TopBar — one call site), `.assistant-send` / `.assistant-save` / `.assistant-ghost` (assistant-only, their own colours), `.assistant-preset` (a suggestion chip wearing a button), `.tool-button` (ToolStrip — a grid cell, no variants), `.menu-row` (a menu item, not a general button).
- **IconButton** — pick `ui/IconButton.tsx` (native `<button>`, a drawn icon + label). Variants `ghost | soft | inverted`; sizes `md` (24px) and `sm` (20px). Loses: `.assistant-icon` (three uses, fixed 24px, no variant), `.assistant-attachment-x` (one-off), `.layer-toggles` buttons (LayersPanel — a toggle cluster with its own semantics), `.status-toggle` (StatusBar — tab-ish, keeps `role="tab"`).
- **Chip** — pick `ui/Chip.tsx` (native `<button>` when interactive, `<span>` when not). Loses: `.chip` (TopBar — a static fact, no interaction), `.keyword-chip` (CommandLine — interactive, no tone/size API), `.cmd-chips` (a container, not a chip).
- **Field** — pick `ui/Field.tsx` (native `<input>`, single-line). Loses: `.assistant-input`, `.cmd-input`, `.prop-input` (each one surface's own padding and border), `.assistant-field` (a label wrapper, not the control). The composer's auto-growing `<textarea>` and the properties palette's `<select>` stay bespoke for now (found-not-fixed).
- **Row** — pick `ui/Row.tsx` (native `<button>`, the full-width clickable band). Loses: `.prop-row`, `.menu-row`, `.assistant-row`, `.assistant-tool` (each repeats hover/selected padding by hand). A grid row carrying nested controls of its own (`.layer-row` with its toggle cluster) stays bespoke — a button cannot nest buttons. The pilot kept `.assistant-row` (the composer's toolbar is a container with nested buttons) and `.assistant-tool` (a transcript disclosure row, not a menu band) bespoke for the same reason; `row.md` records it.
- **SectionLabel** — pick `ui/SectionLabel.tsx` (native `<h2>` — a heading, so a screen reader can jump between panels). Loses: `.section-label` (already shared but untyped — the pick is its typed home), `.properties-head` / `.layers-head` (the surrounding bar, not the label), `.assistant-title` (a pane title, a different role).

## Prop vocabulary

- `variant`: `primary | secondary | ghost | danger` (default `secondary`) — purpose, not appearance.
- `size`: `sm | md` (default `md`).
- plus `disabled`, `selected`, `title`.
- Chip `tone`: `neutral | accent`.
- No boolean style props (`round`, `big`, `blue`): a prop names a purpose; the token layer picks the look.

## Motion presets

One job, one preset (durations and easings from `tokens.css`):

- **press** → `--dur-instant` + `--ease-out`.
- **hover / focus feedback** → `--dur-fast` + `--ease-out`.
- **open** (menu, popover, composer focus) → `--dur-med` + `--ease-out-quint`.
- **close** → `--dur-fast` + `--ease-out`.
- **panel / larger change** → `--dur-slow` + `--ease-out`.
- Reduced motion: the app's `data-animations` attribute already gates motion; the presets keep it — no preset plays when animations are off.

## Icon sizes

- 14px glyph in a 24px control — icon buttons.
- 16px glyph in a 28px control — tool strip / buttons.
- 12px glyph in a 20px control — chips.
- Icons stay code-drawn (`src/icons.ts`); no new icon assets (project rule: no third-party iconography).

## Token decisions

Each change and the gate that decided it (cursor-recipes §1 / §5):

| change | gate | evidence |
|---|---|---|
| accent `#81a1c1 → #599CE7` (dark), `#4a6e96 → #2678C1` (light); `--selection`, `--icon-accent`, `--cmd-keyword` follow, `--cmd-keyword-hover` becomes `rgba(89,156,231,.12)`, `--on-accent` `#191C22` (dark) | G-01 (the person's answer, 12:37) | §1 accent |
| ink ladder: `--text #F0F0F0`, `--text-dim rgba(240,240,240,.74)`, `--text-faint rgba(240,240,240,.60)`, `--icon rgba(240,240,240,.66)` | G-02 | §1 text |
| strokes: `--border rgba(240,240,240,.12)`, `--border-soft .08`, `--scrollbar .14`, `--scrollbar-hover .22` | G-03 | §1 fills & strokes |
| hover fill: `--hover` repurposed to `rgba(240,240,240,.08)`, `--fill-active .14`, `--list-row → var(--fill-active)` | G-04 | §5 hover is a fill |
| composer: `--composer-border .08` / `--composer-border-active .12`, `--surface-elevated #212121` | G-05 | §1 / §2 |
| light mirrors: `--chrome #F8F8F8`, `--chrome-dark #F3F3F3`, `--panel`/`--tab-active`/`--surface-elevated #FCFCFC`, `--on-accent #FCFCFC`, and every alpha role restated over `#141414` (text/ink `.74/.66`, strokes `.12/.08`, fills `.08/.14`, `--snap`/`--toggle-on #007041`, `--warn #A46701`, `--error #BE1744`) | G-06 | §1 |
| radii: `--radius-elevated 20px` (the only new radius) | G-09 | §2 |
| motion: `--dur-instant .05s`, `--dur-fast .1s`, `--dur-slow .2s`, `--ease-out-quint cubic-bezier(0.16,1,0.3,1)` | G-10 | §1 motion |

## What follows the drawing

Tokens left untouched because they describe the document, not the chrome: `--canvas`,
`--grid-minor`, `--grid-major`, `--axis-x`, `--axis-y`, `--crosshair`, `--paper`, `--grip-hot`,
`--layer-current`, `--icon-layer-*`, `--icon-locked`, `--icon-current`, `--icon-point`,
`--swatch-border`, `--control`, `--control-hover`, `--cmd-bg`, `--cmd-border`, `--cmd-history`,
`--shadow`, and the dark `--snap` / `--warn` / `--error` / `--toggle-on` (already Cursor's, §1).
Geometry that was not re-measured also stays: `--dur-med`, `--ease-out`, all other radii, all
gaps, control heights, fonts. `src/canvas.ts` reads the model-space colours from the CSS custom
properties at runtime, so the drawing and the chrome cannot drift.
