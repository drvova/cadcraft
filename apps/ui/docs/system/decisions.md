# The web system's design decisions

The lock for the SolidJS UI (`apps/ui`), taken in the design-system run of 2026-10-28. The design
source is the running Cursor 3.27.22 desktop app, measured live
(`.design-system/research/cursor-recipes-2026-10-28.md`). The values live in `src/tokens.css`; this
file records the picks and the reasons, so the next surface does not re-litigate them.

## Canonical picks

The web UI grows nine canonical components under `src/ui/`, each a thin wrapper over the native
element. The per-surface hand-rolled classes they replace are named below; a class loses because it
is a one-off with no shared API and no states.

- **Button** — pick `ui/Button.tsx` (native `<button>`). Variants `primary | secondary | ghost | danger`, default `secondary` (Cursor's own default button). Loses: `.button` (TopBar — one call site), `.assistant-send` / `.assistant-save` / `.assistant-ghost` (assistant-only, their own colours), `.assistant-preset` (a suggestion chip wearing a button), `.tool-button` (ToolStrip — a grid cell, no variants), `.menu-row` (a menu item, not a general button).
- **IconButton** — pick `ui/IconButton.tsx` (native `<button>`, a drawn icon + label). Variants `ghost | soft | inverted`; sizes `md` (24px) and `sm` (20px). Loses: `.assistant-icon` (three uses, fixed 24px, no variant), `.assistant-attachment-x` (one-off), `.layer-toggles` buttons (LayersPanel — a toggle cluster with its own semantics), `.status-toggle` (StatusBar — a drafting toggle with its own short-label face, an `aria-pressed` switch).
- **Chip** — pick `ui/Chip.tsx` (native `<button>` when interactive, `<span>` when not). Loses: `.chip` (TopBar — a static fact, no interaction), `.keyword-chip` (CommandLine — interactive, no tone/size API), `.cmd-chips` (a container, not a chip).
- **Field** — pick `ui/Field.tsx` (native `<input>`, single-line). Loses: `.assistant-input`, `.cmd-input`, `.prop-input` (each one surface's own padding and border), `.assistant-field` (a label wrapper, not the control). The composer's auto-growing `<textarea>` and the properties palette's `<select>` stay bespoke for now (found-not-fixed).
- **Row** — pick `ui/Row.tsx` (native `<button>`, the full-width clickable band). Loses: `.prop-row`, `.menu-row`, `.assistant-row`, `.assistant-tool` (each repeats hover/selected padding by hand). A grid row carrying nested controls of its own (`.layer-row` with its toggle cluster) stays bespoke — a button cannot nest buttons. The pilot kept `.assistant-row` (the composer's toolbar is a container with nested buttons) and `.assistant-tool` (a transcript disclosure row, not a menu band) bespoke for the same reason; `row.md` records it.
- **SectionLabel** — pick `ui/SectionLabel.tsx` (native `<h2>` — a heading, so a screen reader can jump between panels). Loses: `.section-label` (already shared but untyped — the pick is its typed home), `.properties-head` / `.layers-head` (the surrounding bar, not the label), `.assistant-title` (a pane title, a different role).
- **Tooltip** — pick `ui/Tooltip.tsx`: the layer's one hint, a single box on `<body>` placed beside whichever control carries `data-hint`. `IconButton` carries it from its `title`; the `<Tooltip>` wrapper (a `<span>` host; the child keeps its own element and its own accessible name) gives it to any other control. Placements `bottom | top`, flipped and held inside the window by itself; it never takes the pointer. Loses: the native `title` attribute as an icon key's hint (it arrives on the platform's own delay, in the platform's own box, and never on keyboard focus), and any per-surface hover label a panel would draw for itself. The reasons are under "The hint" below.
- **Tab** — pick `ui/Tab.tsx` (native `<button>` with `role="tab"`, `aria-selected` on the one in front; an optional close key as a sibling button). Sizes `md` (the editor tab, selected at `--tab-active`) and `sm` (the compact tab of a pane header, selected at `--fill-active`). Loses: `.layout-tab` (StatusBar's layout strip — a raw button with its own class), the chat tabs' `Row` workaround (AssistantPane — a `Row` in a width cell beside a close `IconButton`).
- **Kbd** — pick `ui/Kbd.tsx` (native `<kbd>`, one recipe, no variants). Loses: `.assistant-key` (AssistantPane — the mono face at the disabled ink), `.palette-key` (CommandPalette — the recipe kept, now the pick's own).

## Prop vocabulary

- `variant`: `primary | secondary | ghost | danger` (default `secondary`) — purpose, not appearance.
- `size`: `sm | md` (default `md`).
- plus `disabled`, `selected`, `title`.
- IconButton `expanded` and `controls`: a fold key says whether the region it folds is showing (`aria-expanded`) and which region it is (`aria-controls`, the region's `id`). A key is a fold key or a `selected` toggle, never both.
- IconButton `popup`: `menu | dialog | listbox` (`aria-haspopup`), beside `expanded` and `controls`, on a key that opens something floating over the page. `menu` when what opens is a list of actions (`role="menu"`: the narrow window's Main menu), `listbox` when it is a list of values to pick one from (`role="listbox"`: a model picker), `dialog` when it holds fields or other controls (`role="dialog"`: the provider form). A fold key that shows a region in the page's own flow takes no `popup`.
- IconButton `title` is the name (`aria-label`) and the hint's text; the component renders no native `title` attribute. Button, Chip, Tab and Field keep `title` as the native attribute until they move onto the hint.
- Field `autocomplete` and `spellcheck`: the native attributes, passed through; unset leaves each to the platform, except that a `password` field is never spell-checked. A secret passes `autocomplete="off"` and `spellcheck={false}` whatever `type` it shows at the moment.
- Field `invalid` and `describedBy`: a refused value says so (`aria-invalid="true"`, the error stroke), and the help line or the error line under a field is tied to it by `id` (`aria-describedby`). `describedBy` is the layer's name for that tie on any component that grows one, as `ariaLabel` is for the name.
- Button `ariaLabel` (the name Field already uses for the same job): the accessible name, only where the visible label is a value rather than the action; it starts with the action and holds the visible text.
- Chip `tone`: `neutral | accent`.
- No boolean style props (`round`, `big`, `blue`): a prop names a purpose; the token layer picks the look.

## Motion presets

One job, one preset (durations and easings from `tokens.css`):

- **press** → `--dur-press` + `--ease-standard`: the transform channel only (the icon button's scale to .98). A fill that changes under a press takes the hover preset.
- **hover / focus feedback** → `--dur-fast` + `--ease-standard`: the measured state transition, `.1s ease` (research §8: 24 declarations in the glass UI, and the button families' `color, background-color` channels). This line read `--ease-out` until 2026-11-11; the measurement and `src/tokens.css` say `ease`, the layer (`src/ui/ui.css`) already drew it, and the page was the side that moved.
- **open** (menu, popover, composer focus) → `--dur-med` + `--ease-out-quint`.
- **close** → `--dur-fast` + `--ease-out`.
- **panel / larger change** → `--dur-slow` + `--ease-out`. Reserved: no panel moves yet, and `--dur-slow` is kept in `src/tokens.css` for this line alone, so the first panel that moves does not pick its own duration.
- **hint** → arrives on the hover / focus preset (`opacity`), leaves at once. The wait before it is script, not a token: 0.4s under a resting pointer, none on keyboard focus, none for 0.3s after another hint went away.
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
| accent `#81a1c1 → #599CE7` (dark), `#4a6e96 → #2678C1` (light); `--selection`, `--icon-accent`, `--cmd-keyword` follow, `--cmd-keyword-hover` becomes `rgba(89,156,231,.12)`, `--on-accent` `#191C22` (dark). History: `--cmd-keyword` and `--cmd-keyword-hover` left with the keyword chip's move onto Chip, and `--icon-accent` on 2026-11-11 ("Removed tokens" below) | G-01 (the person's answer, 12:37) | §1 accent |
| ink ladder: `--text #F0F0F0`, `--text-dim rgba(240,240,240,.74)`, `--text-faint rgba(240,240,240,.60)`, `--icon rgba(240,240,240,.66)` | G-02 | §1 text |
| strokes: `--border rgba(240,240,240,.12)`, `--border-soft .08`, `--scrollbar .14`, `--scrollbar-hover .22` | G-03 | §1 fills & strokes |
| hover fill: `--hover` repurposed to `rgba(240,240,240,.08)`, `--fill-active .14`, `--list-row → var(--fill-active)` | G-04 | §5 hover is a fill |
| composer: `--composer-border .08` / `--composer-border-active .12`, `--surface-elevated #212121` | G-05 | §1 / §2 |
| light mirrors: `--chrome #F8F8F8`, `--chrome-dark #F3F3F3`, `--panel`/`--tab-active`/`--surface-elevated #FCFCFC`, `--on-accent #FCFCFC`, and every alpha role restated over `#141414` (text/ink `.74/.66`, strokes `.12/.08`, fills `.08/.14`, `--snap`/`--toggle-on #007041` (history: `--snap` was removed on 2026-11-11), `--warn #A46701`, `--error #BE1744`) | G-06 | §1 |
| radii: `--radius-elevated 20px` (the only new radius). History: removed on 2026-11-11, unused since the composer docked | G-09 | §2 |
| the docked composer card: `--radius-elevated` to `--radius-block` (12px), with the stack over it | the person's composer reference board, 2026-11-11 (Cursor's docked composer and 20 of the 30 others draw a tight corner; 20px was to stay for floating surfaces, and no floating surface took it: the popover measured 14px) | `Composer reference board/`, `src/assistant.css` |
| motion: `--dur-instant .05s`, `--dur-fast .1s`, `--dur-slow .2s`, `--ease-out-quint cubic-bezier(0.16,1,0.3,1)`. History: `--dur-instant` was removed on 2026-11-11; `--dur-press` holds the same 50ms for the one channel that uses it | G-10 | §1 motion |
| `--text-accent` (new): the accent as a text ink, `#599CE7` dark (the accent itself), `#005DA4` light (the accent's hue and chroma at OKLCH L .47); Chip `tone="accent"` takes it | WCAG 1.4.3: the light accent chip measured 3.37:1 at 11px over the command line, 4.93 now; dark is unchanged at 5.01 | measured in the browser 2026-11-11, `colors.md` "The layer's pairs" |
| `--focus-ring` (new): `var(--accent)` dark, `#005DA4` light; every ring in `src/ui/ui.css` takes it | WCAG 1.4.11: the light accent ring measured 2.83:1 against the `.14` selected fill over `--control`, 4.14 now | the same table |
| `--on-error` (new): `#121418` dark, `#FCFCFC` light; the danger button's label | WCAG 1.4.3: `--on-accent` measured 4.37:1 on the dark `--error` fill, 4.72 now | the same table |
| light `--accent-hover #226CAE`, `--accent-pressed #1E609A`, `--error-hover #AB153D`, `--error-pressed #981236`: the action fills step 10% and 20% toward black on light surfaces (they stepped toward white, as dark does) | WCAG 1.4.3: the `--on-accent` label measured 3.77 and 3.20 on the old accent steps and 4.46 on the old error press; 5.35, 6.41 and 8.27 now | the same table |

## What follows the drawing

Tokens left untouched because they describe the document, not the chrome: `--canvas`,
`--grid-minor`, `--grid-major`, `--axis-x`, `--axis-y`, `--layer-current`, `--icon-layer-*`,
`--icon-locked`, `--swatch-border`, `--control`, `--control-hover`, `--cmd-bg`, `--cmd-border`,
and the dark `--warn` / `--error` / `--toggle-on` (already Cursor's, §1). Geometry that was not
re-measured also stays: `--dur-med`, `--ease-out`, the other radii, the gaps, control heights,
fonts. `src/canvas.ts` reads the model-space colours (`--canvas`, `--grid-*`, `--axis-*`,
`--selection`) from the CSS custom properties at runtime, so the drawing and the chrome cannot
drift.

## Removed tokens

Removed on 2026-11-11 from both themes of `src/tokens.css` and from every page that listed them.
Each was searched for by its bare name (with and without `var(`) over `src/` (CSS, TS, TSX, the
canvas renderer's `getPropertyValue` reads), `index.html`, `crates/wasm/src`, `crates/render/src`
and `apps/cadcraft/src`, and nothing drew it. A token with no reader is a value nobody checks: it
drifts (the light `--icon-point` had been corrected for contrast on a glyph no surface drew) and it
invites a second way to do a thing the layer already does.

| token | what it was for | what does the job |
|---|---|---|
| `--crosshair`, `--paper`, `--grip-hot`, `--snap` | the egui canvas's cursor, sheet, hot grip and snap marker | nothing yet: the web canvas draws none of them; the one that does adds its token with its reader in `src/canvas.ts` |
| `--icon-accent`, `--icon-point`, `--icon-current` | glyph inks carried over from the egui theme | `--text-accent` (an accent glyph), `--warn` (an attention glyph, the same value in both themes), `--layer-current` (the current layer) |
| `--cmd-history` | the egui command line's recalled row | `--cmd-bg`; the history is the panel's own text |
| `--shadow` | the flat shadow colour | `--shadow-popover` and `--tooltip-shadow`, the measured ladders |
| `--radius-elevated`, `--radius-pill` | the 20px glass corner, the 11px pill | `--radius-popover` and `--radius-block`; `--radius-round` |
| `--gap-5`, `--gap-default`, `--card-padding` | an odd step, an alias of `--gap-4`, an alias of `--gap-16` | `--gap-4`, `--gap-6`, `--gap-16` |
| `--dur-instant`, `--ease-collapse`, `--hover-opacity` | a 50ms state, the chevron's curve, a hover fade | `--dur-press` (the same 50ms); hover is a fill (`--hover`), never a fade, and no chevron rotates |

Kept, though nothing draws them yet:

- `--dur-slow`: the "panel / larger change" motion preset above names it. The preset is a decision
  about the next panel that moves, and the decision still stands, so its duration stays.
- `--list-bg`: no rule paints it, but `src/ui/recipe.test.ts` and `scripts/contrast-report.mjs`
  hold every ink to its threshold over it as the command list's surface. It goes when the command
  list is settled on `--surface-elevated`, with the two surface lists.

## The hint

Decided 2026-11-11. `Tooltip` had 0 call sites: its only two users had become `IconButton`s, which
showed a native `title`, and `rule/tooltip-one-hint` forbids both together. The choice was to
retire the component or to make it the hint `IconButton` shows. It is the hint, for these reasons:

- A native `title` never shows on keyboard focus, so a keyboard user of a tool strip of 25 glyphs
  had no way to read what a key does short of a screen reader. The layer's box shows at once on
  focus.
- The native box is the platform's: its own delay, its own face, in neither theme. One styled hint
  everywhere is the measured Cursor box the layer already carried and nothing drew.
- It costs the call sites nothing: `IconButton` already took the string as `title`.

How it is built, and why:

- **One box on `<body>`, in the viewport's coordinates**, not a child of each control: the tool
  strip, the sidebar and the assistant's panes clip their overflow, and a box inside them would be
  cut at the pane's edge. It also keeps `IconButton` a single `<button>`, so no surface's layout or
  selector changes.
- **Placed by script**: below the control (where the platform's hint fell, clear of the menu bar
  above the tool strip), above it when there is no room below, and slid along the window's edge
  rather than across it. `placement` on the wrapper only names the preferred side; the `align` prop
  is gone, because the hold inside the window does its job without the caller knowing where the
  control sits.
- **Timing**: 0.4s under a resting mouse or pen; at once when another hint went away within 0.3s,
  so sweeping the strip reads every key; at once on keyboard focus (`:focus-visible`, so a click's
  focus does not raise it); never under a finger, which has no hover.
- **Dismissal**: Escape, a press, a click, a scroll, a resize and the window losing focus put it
  away, and it stays away until the pointer or the focus moves to another control. Escape is not
  consumed: a menu that closes on Escape still closes.
- **Hidden from assistive tech** (`aria-hidden`): the box repeats the `aria-label`, and a second
  announcement of the same words is noise. It is not a `role="tooltip"` description.
- **The name stays on `aria-label`**, and no native `title` is rendered, so the two hints cannot
  stack.

Not done here: Button, Chip, Tab, Field and the raw buttons of the status bar still pass `title`
to the native attribute. They move onto the `<Tooltip>` wrapper or grow the same `data-hint` one
component at a time.
