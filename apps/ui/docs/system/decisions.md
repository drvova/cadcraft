# The web system's design decisions

The lock for the SolidJS UI (`apps/ui`), taken in the design-system run of 2026-10-28. The design
source is the running Cursor 3.27.22 desktop app, measured live
(`.design-system/research/cursor-recipes-2026-10-28.md`). The values live in `src/tokens.css`; this
file records the picks and the reasons, so the next surface does not re-litigate them.

## Canonical picks

The web UI grows fourteen canonical components under `src/ui/`, each a thin wrapper over the native
element. The per-surface hand-rolled classes they replace are named below; a class loses because it
is a one-off with no shared API and no states.

- **Button** — pick `ui/Button.tsx` (native `<button>`). Variants `primary | secondary | ghost | danger`, default `secondary` (Cursor's own default button). Loses: `.button` (TopBar — one call site), `.assistant-send` / `.assistant-save` / `.assistant-ghost` (assistant-only, their own colours), `.assistant-preset` (a suggestion chip wearing a button), `.tool-button` (ToolStrip — a grid cell, no variants), `.menu-row` (a menu item, not a general button).
- **IconButton** — pick `ui/IconButton.tsx` (native `<button>`, a drawn icon + label). Variants `ghost | soft | inverted`; sizes `md` (24px) and `sm` (20px). Loses: `.assistant-icon` (three uses, fixed 24px, no variant), `.assistant-attachment-x` (one-off). The layer list's state keys and the status bar's drafting toggles were listed here as its losers until 2026-11-11 and never moved: they are `Toggle`'s (below).
- **Chip** — pick `ui/Chip.tsx` (native `<button>` when interactive, `<span>` when not). Loses: `.chip` (TopBar — a static fact, no interaction), `.keyword-chip` (CommandLine — interactive, no tone/size API), `.cmd-chips` (a container, not a chip).
- **Field** — pick `ui/Field.tsx` (native `<input>`, single-line). Variants `field | inline`, sizes `md` (24px) and `sm` (20px), `align` `start | end`, as Select ("A value in a dense row" below). Loses: `.assistant-input`, `.cmd-input`, `.prop-input` (each one surface's own padding and border), `.assistant-field` (a label wrapper, not the control). The composer's auto-growing `<textarea>` and the properties palette's `<select>` were found-not-fixed here until 2026-11-11; `TextArea` and `Select` below are their picks.
- **Select** — pick `ui/Select.tsx` (a native `<select>` under a drawn face: keyboard, type-ahead, a phone's picker and every system webview's own list are the platform's; no hand-built listbox). Variants `field | inline`, sizes `md` (24px) and `sm` (20px), `align` `start | end`. The value is drawn in a `<span>` over the control, which is what lets it end in an ellipsis before the arrow, end on the arrow's side and read quieter while `mixed` the same way in all three webviews. Loses: `.prop-select` (PropertiesPanel — `appearance: none` with no arrow drawn in its place, a long value cut with no ellipsis, the off-list option and the `*VARIES*` ink done by hand).
- **Checkbox** — pick `ui/Checkbox.tsx` (a native `<input type="checkbox">` inside its `<label>`, the box and the mark drawn from tokens). No variants; states `checked`, `mixed`, `disabled`. Loses: `.prop-check` (PropertiesPanel — the platform's own box tinted with `accent-color`, a different shape and tick in each webview, 13px with no touch target).
- **TextArea** — pick `ui/TextArea.tsx` (a native `<textarea>` that measures its own height between `rows` and `maxRows`). Variants `field | bare`. Loses: `.assistant-input` with its `grow` function (AssistantPane — the limits fixed at 64px and 240px beside a type size that can change).
- **Row** — pick `ui/Row.tsx` (native `<button>`, the full-width clickable band). Loses: `.prop-row`, `.menu-row` (moved on 2026-11-11: "A row in a menu" below), `.assistant-row`, `.assistant-tool` (each repeats hover/selected padding by hand). A grid row carrying nested controls of its own (`.layer-row` with its toggle cluster) stays bespoke — a button cannot nest buttons. The pilot kept `.assistant-row` (the composer's toolbar is a container with nested buttons) and `.assistant-tool` (a transcript disclosure row, not a menu band) bespoke for the same reason; `row.md` records it. Inside a `role="listbox"` that keeps the keyboard in its own field, the row is `<Row option>`: the `role="option"` element itself, with no Tab stop and no hover fill of its own ("A row in a listbox" below). Loses there: `.palette-option` (CommandPalette — a wrapper `div` carrying the option role around a `Row` button).
- **SectionLabel** — pick `ui/SectionLabel.tsx` (native `<h2>` — a heading, so a screen reader can jump between panels). Loses: `.section-label` (already shared but untyped — the pick is its typed home), `.properties-head` / `.layers-head` (the surrounding bar, not the label), `.assistant-title` (a pane title, a different role).
- **Tooltip** — pick `ui/Tooltip.tsx`: the layer's one hint, a single box on `<body>` placed beside whichever control carries `data-hint`. Every layer component that takes `title` carries it; the `<Tooltip>` wrapper (a `<span>` host; the child keeps its own element and its own accessible name) and the bare `data-hint` attribute give it to a surface's own element. Placements `bottom | top`, flipped and held inside the window by itself; it never takes the pointer. Loses: the native `title` attribute as an icon key's hint (it arrives on the platform's own delay, in the platform's own box, and never on keyboard focus), and any per-surface hover label a panel would draw for itself. The reasons are under "The hint" below.
- **Tab** — pick `ui/Tab.tsx` (native `<button>` with `role="tab"`, `aria-selected` on the one in front; an optional close key as a sibling button). Sizes `md` (the editor tab, selected at `--tab-active`) and `sm` (the compact tab of a pane header, selected at `--fill-active`). Loses: `.layout-tab` (StatusBar's layout strip — a raw button with its own class), the chat tabs' `Row` workaround (AssistantPane — a `Row` in a width cell beside a close `IconButton`).
- **Toggle** — pick `ui/Toggle.tsx` (native `<button aria-pressed>`, the state drawn by the face alone). Variants `glyph | text`; sizes `sm` (the cell of a 22px row, the status bar's line) and `md` (24px); tones `neutral | absent | info | caution`. Loses: `.toggle` with `.is-on` / `.is-frozen` / `.is-locked` (LayersPanel — three raw buttons per row, the tone picked by `:first-child` and a class), `.status-toggle` (StatusBar — a raw button with its own hover, ring and on rule). The reasons are under "A setting switched in place" below.
- **Dialog** — pick `ui/Dialog.tsx` (a native `<dialog>` opened with `showModal()`: the focus trap, Escape, the inert page and the top layer are the platform's). Sizes `sm | md | lg`; a title bar with a close key, a body that scrolls, a footer of actions. Loses: nothing drawn by hand, because the web interface had no dialog (the removed desktop interface's Options, Drafting Settings and Layer Properties Manager were never rebuilt); the command palette's own `<dialog>` and the assistant's setup sheet stay as they are. The reasons are under "A task over the page" below. With it, `ui/Tab.tsx` grows `TabPanels`, the tabs pattern with panels, for a dialog's pages.
- **Kbd** — pick `ui/Kbd.tsx` (native `<kbd>`, one recipe, no variants). Loses: `.assistant-key` (AssistantPane — the mono face at the disabled ink), `.palette-key` (CommandPalette — the recipe kept, now the pick's own).

## Prop vocabulary

- `variant`: `primary | secondary | ghost | danger` (default `secondary`) — purpose, not appearance.
- `size`: `sm | md` (default `md`).
- plus `disabled`, `selected`, `title`.
- IconButton `expanded` and `controls`: a fold key says whether the region it folds is showing (`aria-expanded`) and which region it is (`aria-controls`, the region's `id`). A key is a fold key or a `selected` toggle, never both.
- IconButton `popup`: `menu | dialog | listbox` (`aria-haspopup`), beside `expanded` and `controls`, on a key that opens something floating over the page. `menu` when what opens is a list of actions (`role="menu"`: the narrow window's Main menu), `listbox` when it is a list of values to pick one from (`role="listbox"`: a model picker), `dialog` when it holds fields or other controls (`role="dialog"`: the provider form). A fold key that shows a region in the page's own flow takes no `popup`.
- `title` is the layer's hint on every component that takes it, and no component renders a native `title` attribute. What it is to assistive tech depends on whether the control has a visible label: on IconButton (a glyph, no label) it is the name (`aria-label`); on Button, Chip, Tab, Row, Field, Select and TextArea (a label, or `ariaLabel`) it is the description (`aria-describedby`), never the name. "The hint" below has the reasons.
- Button and IconButton `shortcut`: the shortcut as the user reads it (`Ctrl+Z`), drawn as a key cap in the hint and said through `aria-keyshortcuts`. `data-hint-keys` is the same thing on an element outside the layer.
- IconButton `description`: the second line of the hint and the key's accessible description (`aria-describedby`): why it is disabled, what it will do. Button needs no such prop: its `title` already is its description.
- `disabled` on Button and IconButton is `aria-disabled="true"`, never the native attribute ("Disabled controls" below). Field, Select, Checkbox, TextArea and Row keep the native `disabled`; a `Row option` is not a native control and says `aria-disabled="true"`, and a `Row menuitem` says it too, because a menu's arrow keys must still reach a command that cannot run ("A row in a menu" below).
- Field `autocomplete` and `spellcheck`: the native attributes, passed through; unset leaves each to the platform, except that a `password` field is never spell-checked. A secret passes `autocomplete="off"` and `spellcheck={false}` whatever `type` it shows at the moment.
- Field `invalid` and `describedBy`: a refused value says so (`aria-invalid="true"`, the error stroke), and the help line or the error line under a field is tied to it by `id` (`aria-describedby`). `describedBy` is the layer's name for that tie on any component that grows one, as `ariaLabel` is for the name.
- Button `ariaLabel` (the name Field already uses for the same job): the accessible name, only where the visible label is a value rather than the action; it starts with the action and holds the visible text.
- `ariaLabel`, `describedBy`, `invalid` and `title` mean on Select and TextArea what they mean on Field; Checkbox takes `ariaLabel` (when it has no visible label) and `describedBy`.
- `variant` on the value controls names where the control sits, not how it looks: Select and Field `field | inline` (a form control; a value in a dense list row that reads as text until touched), TextArea `field | bare` (a form control; the editor inside a card that draws the box and shows the focus itself).
- Select and Field `align`: `start | end`, the side of the box the value sits on (`end` in a column of values; on Field it also sets lining tabular figures, so a column of numbers lines up).
- `mixed` (Select, Checkbox, Field): the control stands for several things whose values differ. Select shows its `placeholder`, which is never a choice; Checkbox sets `indeterminate` and `aria-checked="mixed"`; Field draws the stand-in the caller passes as its value in the quiet ink.
- Field `readOnly`, `maxLength`, `inputMode`: the native attributes, passed through. `readOnly` is not `disabled`: the value can be focused, selected and copied.
- Field `selectOnFocus`: the whole value is selected as focus arrives, by key or by click, so typing replaces it; a second click places the caret.
- Field `onKeyDown`, `onFocus`, `onBlur`, `ref`: the pass-throughs a value that commits on Enter and on leaving needs. `onKeyDown` never hears a key an input method is using, as on TextArea.
- `role`, `expanded`, `controls`, `activeDescendant`, `autocompleteKind` (Field, TextArea): a text control that drives a list of matches and keeps the keyboard is a combobox. `role` takes only `combobox`; `expanded` and `controls` mean what they mean on IconButton (`aria-expanded`, `aria-controls`); `activeDescendant` is the `id` of the option the arrow keys are on (`aria-activedescendant`); `autocompleteKind` is `aria-autocomplete` (`list | inline | both | none`), named apart from `autocomplete`, which is the platform's autofill. They are passed together or not at all: on Field for as long as the field exists (the palette's input), on TextArea only while its list shows (the composer's slash list), and `Row option` rows are the list.
- `onChange(value)` on a control whose value is picked (Select, Checkbox) and `onInput(value)` on one whose value is typed (Field, TextArea): each hands back the value, not the event. The caller owns the value on all four, and Select and Checkbox redraw from their props after every pick, so a change the caller refuses does not stay drawn.
- Select `options`: the choices as data (`{ value, label, disabled? }[]`), never children; a `value` that is not among them is listed first by the component.
- TextArea `rows` and `maxRows`: the fewest lines shown and the most before it scrolls; the height between is measured, and no stylesheet sets one.
- TextArea `onKeyDown`, `onPaste`, `ref`: the pass-throughs a composer needs. `onKeyDown` never hears a key an input method is using.
- Row `option`, with `id` and `onPointerMove`: the row is one option of a listbox that owns the focus and the highlight.
- Row `menuitem`, with `popup`, `expanded`, `describedBy`, `onKeyDown` and `onPointerEnter`: the row is one item of a menu that moves the focus itself. `popup` and `expanded` mean what they mean on IconButton (`popup` takes only `menu` here), and `describedBy` what it means on Field.
- Row `title`: the hint and the row's description in every form, as on Button; the name stays the row's text.
- Chip `tone`: `neutral | accent`.
- Toggle `pressed` and `onChange(pressed)`: the state and the state a press asks for, as `checked` and `onChange` on Checkbox; the caller owns it. `selected` stays IconButton's word for a key that is lit while on.
- Toggle `ariaLabel` and `hint`: the fixed name and the hint are two props because they are two strings ("Outline frozen", "Thaw"). `title` is not taken: on every other component it is the hint and also the name or the description, and a toggle's hint is neither. `description`, `shortcut` and `disabled` mean what they mean on IconButton, and `placement` what it means on Tooltip.
- Toggle `variant`: `glyph | text`, the face. Toggle `tone`: `neutral | absent | info | caution`, which state is the one to notice and its ink; it names the meaning, and the token layer picks the colour per theme.
- Toggle `icon` and `iconOn`: the glyph of each state. Toggle `tabIndex`: the one pass-through for a group that is one Tab stop; unset, the component writes no attribute.
- Dialog `open` and `onClose(reason)`: the caller owns whether the dialog shows, as it owns every value in the layer; the dialog only asks, and says why (`escape | backdrop | close | action`). `title` on Dialog is its visible title and its accessible name, not a hint: a dialog has no hint, and the one string is what the title bar shows and what `aria-labelledby` names.
- Dialog `describedBy`: what it means on Field (`aria-describedby`). The brief that asked for the component called it `ariaDescribedBy`; the layer already had a name for the tie, and a second name for it would be the first prop to break "one name per job".
- Dialog `initialFocus` (a selector, an element or a function), `footer` (the actions, or a function handed `done`) and `dismissOnBackdrop` (default true).
- Dialog `size`: `sm | md | lg`. The layer's other components stop at `sm | md`; a dialog's third step is a width, not a control height, and it is the only component that has one.
- Field and Select `id`: the control's `id`, for a visible `<label for>` beside it. A form in a dialog shows its labels, and `ariaLabel` beside a visible label would say the name twice in two places that can drift.
- Tab `id`, `controls`, `tabIndex`: what a tab with a panel needs (`aria-labelledby` back from the panel, `aria-controls`, one Tab stop per strip). `TabPanels` sets all three; a bare strip may.
- No boolean style props (`round`, `big`, `blue`): a prop names a purpose; the token layer picks the look.

## Motion presets

One job, one preset (durations and easings from `tokens.css`):

- **press** → `--dur-press` + `--ease-standard`: the transform channel only (the icon button's scale to .98). A fill that changes under a press takes the hover preset.
- **hover / focus feedback** → `--dur-fast` + `--ease-standard`: the measured state transition, `.1s ease` (research §8: 24 declarations in the glass UI, and the button families' `color, background-color` channels). This line read `--ease-out` until 2026-11-11; the measurement and `src/tokens.css` say `ease`, the layer (`src/ui/ui.css`) already drew it, and the page was the side that moved.
- **open** (menu, popover, composer focus) → `--dur-med` + `--ease-out-quint`.
- **close** → `--dur-fast` + `--ease-out`.
- **panel / larger change** → `--dur-slow` + `--ease-out`. Reserved: no panel moves yet, and `--dur-slow` is kept in `src/tokens.css` for this line alone, so the first panel that moves does not pick its own duration.
- **hint** → arrives on the hover / focus preset (`opacity`), leaves at once. The wait before it is script, not a token: 0.4s under a resting pointer, none on keyboard focus, none for 0.3s after another hint went away; and that next hint arrives without the fade too, because a fade restarting on every key of a row is a flicker.
- Reduced motion: the app's `data-animations` attribute already gates motion; the presets keep it — no preset plays when animations are off. The hint also answers the platform's own setting (`prefers-reduced-motion: reduce`): it is a box the layer hangs on `<body>` for every surface, so it does not wait for the shell to mirror the setting into the attribute.

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
| `--leading-ui` (new): `16px`, the line of every component in `src/ui/ui.css`; it replaces `1`, `var(--gap-16)` and the face's `normal` there | the coordinator's brief of 2026-11-11 ("leading is not one system"); no box height changed, measured before and after | `typography.md` "Leading", `src/ui/recipe.test.ts` |
| `--swatch-border`: `#191919` in both themes to `var(--text-faint)` | WCAG 1.4.11: the edge is what tells a swatch from its row, and it measured 1.05 on the dark sidebar, 1.39 on the current row; 6.4 and 5.1 now (light 5.9 and 5.2) | `colors.md` "Layers", `src/ui/recipe.test.ts` |
| `Button size="sm"`: the label from `--font-chip` (11px) to `--font-button` (13px); the 24px box is unchanged | `typography.md`: one size per role, and 11px is for labels, counts and key caps. The setup sheet's Change provider read as the smallest text in its sheet | `button.md`, `src/ui/recipe.test.ts` |
| `--on-error` (new): `#121418` dark, `#FCFCFC` light; the danger button's label | WCAG 1.4.3: `--on-accent` measured 4.37:1 on the dark `--error` fill, 4.72 now | the same table |
| light `--accent-hover #226CAE`, `--accent-pressed #1E609A`, `--error-hover #AB153D`, `--error-pressed #981236`: the action fills step 10% and 20% toward black on light surfaces (they stepped toward white, as dark does) | WCAG 1.4.3: the `--on-accent` label measured 3.77 and 3.20 on the old accent steps and 4.46 on the old error press; 5.35, 6.41 and 8.27 now | the same table |

## What follows the drawing

Tokens left untouched because they describe the document, not the chrome: `--canvas`,
`--grid-minor`, `--grid-major`, `--axis-x`, `--axis-y`, `--icon-layer-*`,
`--icon-locked`, `--control`, `--control-hover`, `--cmd-bg`, `--cmd-border`,
and the dark `--warn` / `--error` / `--toggle-on` (already Cursor's, §1). History: `--layer-current`
stood in this list until 2026-11-11 ("The quiet pass" below removed it), `--swatch-border` stood in
it until the same day (it frames a colour of the document but is itself chrome: "Token decisions"
above), and the light `--control`,
`--control-hover`, `--cmd-bg` and `--cmd-border` were retuned in the same pass. Geometry that was not
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
| `--icon-accent`, `--icon-point`, `--icon-current` | glyph inks carried over from the egui theme | `--text-accent` (an accent glyph), `--warn` (an attention glyph, the same value in both themes), `--layer-current` (the current layer; itself removed later that day, last row) |
| `--cmd-history` | the egui command line's recalled row | `--cmd-bg`; the history is the panel's own text |
| `--shadow` | the flat shadow colour | `--shadow-popover` and `--tooltip-shadow`, the measured ladders |
| `--radius-elevated`, `--radius-pill` | the 20px glass corner, the 11px pill | `--radius-popover` and `--radius-block`; `--radius-round` |
| `--gap-5`, `--gap-default`, `--card-padding` | an odd step, an alias of `--gap-4`, an alias of `--gap-16` | `--gap-4`, `--gap-6`, `--gap-16` |
| `--dur-instant`, `--ease-collapse`, `--hover-opacity` | a 50ms state, the chevron's curve, a hover fade | `--dur-press` (the same 50ms); hover is a fill (`--hover`), never a fade, and no chevron rotates |
| `--layer-current` | the current layer's name in green (dark `#4cc25a`; in light it held a pale fill no rule painted, and the name took `--toggle-on` mixed toward the ink) | `--text` on the selected fill beside the accent bar ("The quiet pass" below) |
| `--composer-min-height` | the composer editor's floor, 64px: two of Cursor's 24px lines and their padding | the text area's `rows` on `--composer-leading` (two 20px lines, 40px), measured by `TextArea`; removed later on 2026-11-11, when no rule read it |

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
  so sweeping the strip reads every key; at once on keyboard focus (focus a key moved, so a
  click's focus does not raise it; the second pass below replaced the first pass's
  `:focus-visible` test); never under a finger, which has no hover.
- **Dismissal**: Escape, a press, a click, typing, a scroll, a resize and the window losing focus put it
  away, and it stays away until the pointer or the focus moves to another control. Escape is not
  consumed: a menu that closes on Escape still closes.
- **Hidden from assistive tech** (`aria-hidden`): the box repeats the `aria-label`, and a second
  announcement of the same words is noise. It is not a `role="tooltip"` description.
- **The name stays on `aria-label`**, and no native `title` is rendered, so the two hints cannot
  stack.

### One hint in the whole layer (2026-11-11, second pass)

Button, Chip, Tab and Field moved onto the box with no call-site change: each still takes `title`,
and none renders the native attribute. What moved with them:

- **The name and the description, per component.** The hint is the name only where there is no
  other (IconButton: `aria-label`). A Button, a Chip or a Tab has a visible label and a Field has
  `ariaLabel`, so there the hint is supplementary and is exposed as the control's **description**.
  It must be exposed somehow: the box is `aria-hidden`, and with the native `title` gone a screen
  reader would otherwise lose the words (the reason Save is disabled, what a tab switches to). A
  static Chip is a `<span>` with no role, where a description is not announced; its hint is for the
  eye only and its spec says to put nothing essential there.
- **`aria-describedby`, not `aria-description`.** `aria-description` is one attribute and no
  machinery, but it is an ARIA 1.3 working-draft attribute, and the desktop app runs in whatever
  system webview the machine has (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux), which
  is not evergreen everywhere. `aria-describedby` pointing at text is supported by every engine and
  screen reader pairing. The text lives in one hidden element on `<body>`
  (`.ui-hint-descriptions`, one `<span>` per control, removed with it), not beside the control: a
  hidden child would enter `textContent` and a hidden sibling would change every surface's
  `:first-child`, `+` and flex-gap arithmetic. A hidden element referenced by `aria-describedby`
  is still read as the description. `describeByHint` in `src/ui/Tooltip.tsx` is the one place that
  does this, and a surface's own element can call it.
- **A repeat is nothing.** A hint equal to the label the control shows (trimmed, white space
  collapsed) with no shortcut and no second line draws no box and adds no description: the chat
  tabs pass their title as both, and "hello, tab, hello" helps nobody.
- **A clipped label is always reachable.** When a control's own box cuts its label (`scrollWidth`
  past `clientWidth`), the hint's first line is the full label, whether or not the caller passed
  `title`, and what `title` adds drops to a second line. Tab and Chip always carry `data-hint`
  (empty when there is no title) so this works without the caller thinking of it. Assistive tech
  never needed it: the full text is in the element, and the ellipsis is paint.
- **The shortcut is a key cap.** The explicit form is the one to write: `shortcut` on IconButton
  and Button, `data-hint-keys` on any other element; it also sets `aria-keyshortcuts`. The old form,
  a title ending "(Ctrl+Z)", is still split off by IconButton and Button so the 9 existing call
  sites draw the cap today; there the accessible name keeps the bracket (changing a name is a
  behaviour change the call site should make on purpose), and no `aria-keyshortcuts` is added,
  which would say the shortcut twice. Only a bracket that is a key combination is split
  ("Attach a picture (or paste, or drop one)" stays text), and the attribute form never parses: a
  chat titled "Option (B)" must not grow a key cap.
- **32ch, wrapped.** The box was one `nowrap` line clipped with an ellipsis at the window's width;
  a reason a control is disabled is a sentence and was cut. It now wraps at a 32ch measure, and is
  never wider or taller than the window less the gap on each side.
- **Focus a key moved, only.** `:focus-visible` is true for a field on any focus and for a button a
  closing dialog hands focus back to, and neither is a person asking what the control is. The hint
  shows on focus only when the last key pressed was one that moves focus (Tab, the arrows, Home,
  End, Page Up, Page Down, F6) and no press has followed it. Whichever of the pointer and the
  focus moved last names the control: a pointer left resting on one key no longer silences the hint
  of the key the keyboard moves to.
- **Not over a popup.** A control whose own menu or dialog is open (`aria-haspopup` with
  `aria-expanded="true"`) shows no hint, and while focus is inside a menu or a dialog only that
  popup's own controls do. A fold key is `aria-expanded` too and keeps its hint: its region is in
  the page's flow and covers nothing. A control inside a modal `<dialog>` gets the box as a child
  of that dialog, because the top layer covers `<body>`.
- **Row, the last native `title`** (2026-11-11, third pass). `Row` rendered the platform's
  `title` in both forms; it now carries `data-hint` and ties its `title` as the description, with
  no call-site change. Three things came with it. A component with no `title` carries `data-hint`
  empty so its clipped label can show, and the layers panel wraps such a `Row` in a `Tooltip`: an
  empty host now gives way to a host around it that has words. A row's label sits beside trailing
  text (a shortcut, a path), so the full label a clipped control shows is the part that is cut,
  not the whole row run together; and a part hidden from assistive tech is skipped, because the
  layer's name is drawn in two pieces for the eye beside its whole text. A field's label is its
  value (never a password's), which is what lets `Field` replace the palette's
  `hintWhenClipped`.
- **Not over a select's list.** A select's list opens where the box sits. A press already put the
  box away; so does every key in a `<select>` now, except Tab and a bare modifier (Space, Enter
  and the arrows open the list or change the value).
- **Outside the layer.** The delegation never looked at who rendered the element, so
  `data-hint`, `data-hint-keys`, `data-hint-note` and `data-hint-placement` work on any element.
  About ninety native `title`s remain in the surfaces' own markup (the status toggles, the layer
  keys, the properties' clipped values); `tooltip.md` ("Adopting the hint outside the layer") is
  the procedure, including what happens to the accessible name each of them was getting from
  `title`.

## Disabled controls

Decided 2026-11-11. A disabled Button or IconButton is `aria-disabled="true"` and never carries
the native `disabled` attribute; the component refuses the click.

- **Why.** A control that is blocked by something the user can fix should be able to say what
  (the setup sheet's Save: "To save, choose a provider or type a base URL."). The native attribute
  takes the button out of the Tab order, so a keyboard user can never reach the words, and in some
  engines it also swallows pointer events on the button, so a mouse user cannot either; the desktop
  app runs in three different system webviews and the layer cannot pick the well-behaved one.
- **How the click is refused.** `refuseWhenDisabled` (`src/ui/Button.tsx`, used by both) listens on
  the button itself and, while `aria-disabled="true"`, calls `preventDefault` and
  `stopImmediatePropagation`. That is before the caller's `onClick`, before any ancestor's handler
  (a native disabled button's click reaches nobody, and a row that selects on click must not start
  hearing its disabled key), and before a form takes a submit button's click. Enter and Space on a
  button arrive as the same `click`, so one guard covers the pointer and both keys.
- **What it costs.** A disabled button is now a Tab stop. That is the point where it has a reason
  to give, and one extra stop where it has none (the ARIA Authoring Practices guide allows keeping
  a disabled control focusable where a user must be able to find it). It takes the focus ring, no hover fill and
  no pressed fill. `:disabled` no longer matches these two components: a surface that styles one
  writes `[aria-disabled="true"]` (`src/ui/recipe.test.ts` holds the layer to it).
- **Scope.** Field keeps the native `disabled` (a field one cannot type in should not take the
  caret), and Row keeps it too (a disabled row in a menu or the palette is skipped by the list's
  own arrow-key handling, and nothing asks a row to explain itself yet).

## A setting switched in place

Decided 2026-11-11, with `Toggle`. The last hand-drawn controls in the shell were the layer
list's three state keys per row and the status bar's eleven drafting toggles: four raw
`<button aria-pressed>` call sites in two files, two recipes.

- **Why not `IconButton selected`.** It was tried and does not fit, for four reasons. Its `title`
  is both the name and the hint, and a state key needs a name that never changes ("Outline
  frozen", with `aria-pressed` carrying the state) and a different hint (the action, "Thaw").
  `selected` paints the `.14` fill, and "on" is pressed on nearly every row, so every row would
  gain a fill. The state inks (off, frozen, locked, each with a light-theme step) have no prop.
  And its box is a circle, where the key is a 20 by 22 cell as tall as the row.
- **The state is the face's alone.** No fill at rest, on or off. A glyph toggle swaps its glyph
  (`icon`, `iconOn`) and takes the tone's ink; a text toggle takes the full ink and a hairline
  rule in `--toggle-on` under the word (history: the word's rule became a chip later that day,
  "The quiet pass" below; the glyph face is as written here). Neither is colour alone. The fills are the layer's own:
  `.08` under the pointer and `.14` while held, which the layer keys did not have before.
- **`tone` is a closed set of four, mapped to tokens the app already had.** `neutral`: off
  `--text-faint`, on `--text`. `absent`: on `--icon`, off `--icon-layer-off` stepped 15% to the
  ink (light: `--text-dim`). `info`: on `--icon-layer-frozen` (light: `--text-accent`).
  `caution`: on `--icon-locked` (light: `--warn` stepped 20% to the ink). The light steps are in
  `src/ui/ui.css` under `:root[data-theme="light"]`, the layer's first theme selector: the two
  mixes are not single token values, and a token per tone and state would have been six new
  tokens for one component. No colour was added.
- **The hint is for the eye and is not the description.** Every other component exposes its hint
  to assistive tech, as the name or the description, because the hint box is `aria-hidden`. A
  toggle's hint is the action a press takes now, which the name and `aria-pressed` already say:
  "Outline frozen, pressed, Thaw" says the state twice. What a screen reader must also hear (why
  the toggle is blocked) goes in `description`, as on IconButton.
- **One Tab stop is the container's.** The status bar and the tool strip rove from the container
  through a ref (`rovingBand`, `src/components/ToolStrip.tsx`), which sets `tabIndex` on each
  element. Toggle takes `tabIndex` as a prop for a container that roves through props, and writes
  no attribute when the prop is unset, so the two never fight.
- **A small word is as tall as its line.** The status bar's line is its row less its top
  hairline, and it grows under a finger; a component cannot know either. The container sets
  `--ui-toggle-line`, and the word falls back to the row height. It is the one custom property a
  caller sets for a layer component, and it sets a size the component cannot measure, never a
  look.
- **Under a finger.** The small glyph keeps its 20 by 22 cell and takes the rest of 24 by 24 as an
  overhang; the layer list keeps its three keys 4px apart there so the targets do not overlap
  (they stood flush, with 20 by 22 targets). The word is at least 24 by 24.
- **Disabled.** As Button and IconButton: `aria-disabled`, focusable, the click refused, the face
  at the disabled ink in every tone. No call site disables a toggle yet.
- **The curve.** The hand-drawn keys eased on the shell's `button` rule (`--ease-out`); a Toggle
  eases on the layer's measured `--ease-standard`, as every other component. Same 0.1s.

### What stays local in a layer row

Looked at with `Toggle`, 2026-11-11: the row's colour swatch and its "has objects" mark, both
`role="img"` spans drawn by `src/styles.css`.

- **The swatch stays local.** A `Swatch` needs a second use, and the candidate was the properties
  palette's Color row, which shows a colour's name with no colour beside it. A swatch there would
  help: "ByLayer" says nothing about which colour the object is drawn in. But the row cannot draw
  one honestly today. The palette's rows carry the colour as a name (`COLOR_CHOICES` in
  `src/props.ts`: `ByLayer`, `ByBlock`, `Red` and the rest) and no RGB, and the layer list's rule
  is that no colour is invented in the interface: the swatch paints the engine's own `colorRgb`.
  A swatch beside "ByLayer" would mean resolving the layer's colour in TypeScript. The component
  follows the data: when the engine's property rows carry `colorRgb` beside the name, build
  `Swatch` (a `role="img"` box named by the colour, `--swatch-border`, 10px) and give it the layer
  row and the palette row together. Until then one call site is a local rule.
- **The used mark stays local.** One use, two states, no interaction, and its only rule is that
  the fill carries the state where the two inks are a step apart. If a second list grows a
  per-row status mark, it is a component then.

Their sizes moved onto the ladder in passing (10px is `--gap-10`; 7px is `--gap-4` plus
`--gap-3`), with no change to what is drawn.

## A row in a listbox

Decided 2026-11-11. The command palette and the assistant's slash list are `role="listbox"` lists
driven from a text field (`aria-activedescendant`); each drew a `Row`, a `<button>`, inside or as
its option.

- **What was wrong.** Every row was a Tab stop in a list whose keyboard lives in the field, so Tab
  from the palette's field walked the rows one by one. And a `Row` paints its own hover fill, so
  the row under a resting pointer and the row the arrow keys were on were both lit, in two fills.
- **The pick.** `Row` takes `option`: it renders the `role="option"` element itself (a `<div>`, no
  button inside it), with `aria-selected` from `selected`, `aria-disabled` from `disabled`, the
  `id` the field's `aria-activedescendant` names, and `onPointerMove` so the listbox can move its
  highlight under the pointer. It takes no focus and paints no hover: the one lit row is the one
  the listbox set.
- **Why a mode of Row, not a new component.** The band is the same band: height, inset, inks and
  the `.14` fill. A second component would copy the recipe to change one element and two
  attributes. `tabIndex` and a hover switch as separate props were the other offer; they would
  leave a button inside an option, which the option role flattens for assistive tech.
- **A disabled option still takes the highlight.** The palette lights a command that cannot run
  and says why under the list; the option keeps the fill at the disabled ink and refuses the click.
- **A disabled current button does not** (decided 2026-11-11, second pass). `row.md` said a
  disabled selected row drops its fill and the stylesheet kept it. Both were right, each for one
  form. In a listbox the fill is the cursor: the keys are on that option whether or not it can
  run, and a list with no fill has lost its place. A button row's fill says "this is the current
  one, and you can act on it"; blocked, it reads as an active item that ignores the press. So
  `.ui-row:disabled[aria-current="true"]` is transparent at the disabled ink, `aria-current`
  stays for assistive tech (the row is still the current one), and
  `.ui-row[aria-disabled="true"][aria-selected="true"]` keeps `--fill-active`.
  `src/ui/recipe.test.ts` holds both.

## A row in a menu

Decided 2026-11-11. The menus (the bar's dropdowns and submenus, the narrow window's Main menu,
the tool strip's overflow menu) are one component, `src/components/Menu.tsx`, and each of its rows
was the last raw `<button>` drawn by hand in the shell (`.menu-row`, with its hover, focus and
disabled rules in `src/chrome.css`).

- **The pick.** `Row` takes `menuitem`: a native button that is the `role="menuitem"` element
  itself, with `tabindex="-1"` (the menu moves the focus), `aria-disabled` from `disabled`,
  `aria-haspopup` and `aria-expanded` from `popup` and `expanded`, and the caller's description
  line from `describedBy`. `onKeyDown` and `onPointerEnter` hand the menu its walk and its hover.
- **Why `aria-disabled`.** A natively disabled button takes no focus: Down would skip Paste, and a
  screen reader would never hear that the command exists. The row stays in the walk, shows the
  ring without the fill, and refuses the click.
- **Why a mode of Row.** The band is the same band and so are its ring and its disabled ink. What
  a menu changes is stated in one rule (`.ui-row--menuitem`): the control height (24px, 28px under
  a finger) instead of the list row's 22px, the full ink (no row of a menu is the current one),
  a corner concentric with the popover's, and the hover fill held on the keyboard's row and on
  the row whose submenu is open.
- **No visual or behavioural change.** The recipe moved value for value. Measured before and
  after in both themes: every row's box, ink, fill, radius and ring in the resting, hovered,
  focused, expanded and disabled states, the accessibility tree with a submenu open at 1280, 800
  and 390, and the menus' behaviour table of real keys and pointer moves. One thing differs by
  design: the fill's transition is the layer's (`background-color`, `--ease-standard`), where the
  shell's blanket `button` rule also eased `color` and `border-color` on `--ease-out`.
- **The hook.** `Menu.tsx` finds its rows by `[role="menuitem"]` under a `.menu-item`, the role
  `Row` renders, not by a class: the layer's class names are the layer's to change. The slots
  inside a row (`.menu-label`, `.menu-icon`, `.menu-name`, `.menu-shortcut`, `.menu-arrow`) are
  the menu's own children and stay in `src/chrome.css`, with `--menu-row-h` restating the row's
  height for the grid's tracks and the separators.
- **A clipped label shows in the hint**, as on every row: the stacked Main menu at 390px cuts
  long labels, and the layer's hint reads them in full. A menu row has no other hint.

## A value in a dense row

Decided 2026-11-11 (the audit's open gate on the properties palette's typed values). The palette
drew its own `<input class="prop-input">` because `Field` was only the 24px form control. `Field`
now carries all of it, in Select's vocabulary, so a typed value and a picked value in the same
column are one recipe:

- `variant="inline"`: no stroke and no fill until the pointer or the keyboard is on it, then the
  field (`--border-soft`, `--control`). Focus, a refused value and `disabled` win over the hover.
- `size="sm"`: the 20px box of a 22px row on the row's 4px inset, 24px under a coarse pointer, with
  the hairline of bottom padding that puts a typed value on the label's baseline.
- `align="end"`: the value ends on the far edge, with lining tabular figures.
- `mixed`: the "*VARIES*" stand-in in the quiet ink.
- `invalid`: `aria-invalid="true"` and the error stroke, as before.
- `onKeyDown`, `onBlur`, `ref`: commit on Enter and on leaving, restore on Escape, from the caller.
- A value the box cuts short ends in an ellipsis and shows in full in the hint, with no
  `data-hint` bookkeeping in the caller.
- `selectOnFocus` is new behaviour, not a carry-over: a property editor wants typing to replace
  the value. Leave it out for a like-for-like move.

Two values differ from the hand-drawn input, both to match the inline Select beside it: the
corner is `--radius-control` (2px, was `--radius-small`, 3px) and the hover stroke is
`--border-soft` (was `--border`).

The replacement, in `src/components/PropertiesPanel.tsx` (the `text` / `number` match):

```tsx
<span class="prop-choice">
  <Field
    variant="inline"
    size="sm"
    align="end"
    ariaLabel={props.row().label}
    value={draft()}
    mixed={draft() === VARIES}
    invalid={invalid()}
    inputMode={mode() === "number" ? "decimal" : undefined}
    spellcheck={false}
    autocomplete="off"
    selectOnFocus
    onInput={(value) => {
      setDirty(true);
      setInvalid(false);
      setDraft(value);
    }}
    onKeyDown={onKeyDown}
    onBlur={() => commitText(true)}
  />
</span>
```

The wrapper is the one the palette's Select already sits in (a one-column grid with the overhang
to the column's edge: the field stretches to it). What can then be deleted: every `.prop-input`
rule in `src/interaction.css` (the base rule, its hover, `:focus-visible`,
`[aria-invalid="true"]` and `.is-varies`), `hintWhenClipped` and `cuts` in the panel if nothing
else uses them, and the `.prop-input` line of `src/ui/recipe.test.ts`, which already passes with
or without the rule.

## Controls that hold a value

Decided 2026-11-11, with `Select`, `Checkbox` and `TextArea`.

- **Native underneath, always.** Each is the platform's own control with the layer's face. The
  desktop app runs in three system webviews and on phones through the web build; a hand-built
  listbox or tick would have to re-earn type-ahead, the phone's picker, form participation and
  input-method handling in each.
- **Select draws its value in a span.** A `<select>` styled directly clips without an ellipsis in
  one engine, ignores `text-align-last` in another and takes its open list's colours from the
  closed control in a third. The native control lies under the face at no opacity and takes every
  press; the face is `aria-hidden`. The select stays in the flow, so the box is as wide as its
  longest choice asks and does not move as the value changes.
- **The mixed placeholder is not a choice.** It is a `hidden`, `disabled` first option that only
  exists while `mixed`, so it can be shown and can never be picked.
- **The checkbox's edge is the glyph ink.** A hairline stroke (`--border`, `--border-soft`) is
  drawn to separate surfaces that also differ in fill; an empty box differs from its surface by
  its edge alone, which needs 3:1 (WCAG 1.4.11). `--icon` holds 5.23 at the least.
- **The checkbox's ring stands off the box** by a hairline: at the layer's usual offset of -1 it
  would be the accent ring on the accent fill.
- **One line of a TextArea is a Field's height** (a 16px line, the field's padding less the
  hairline: 24px), so the two can share a row.
- **A bare TextArea draws no ring.** It is the only control in the layer without one, and only
  because its card shows the focus; `src/ui/recipe.test.ts` holds `ui.css` to that one exception.
- **16px under a finger.** Under `pointer: coarse` the field, the text area and the select's
  native control take `font-size: max(16px, 1em)`, the size below which a phone zooms the page
  into the control. `Field` joined them on 2026-11-11 (it was left open here until its one form
  was looked at). It keeps its 24px box: under a coarse pointer it gives up its 4px of block
  padding, and the 16px value sits centred in the box. Looked at on the assistant's setup sheet
  at 390 wide with the coarse rules applied: the three fields keep their width, height and
  position (24px each, the same tops), nothing below them moves, and the only change is the
  typed value and the placeholder at 16px (`.design-system/review/wE8-setup-390-coarse-*.png`).
- **Section labels are not tracked.** `typography.md` asked for `0.05em` to `0.06em` on uppercase
  section labels; the measured header (research §2: 11px, weight 700, capitals) has none and the
  layer never drew any. The page moved, as it did for the hover easing.

## The quiet pass

Decided 2026-11-11 (the tenth pass), after a review of the whole product against the Cursor
captures (`.design-system/review/wF9-*.png`). Its verdict: a real, restrained shell in which the
type was not one system, the chrome claimed attention the drawing should have, and the left insets
did not agree. Before and after captures are `.design-system/review/wE10-*.png`.

### One type scale

- **Four sizes on screen: 11, 12, 13 and the 12px mono.** 11 is `--font-chip` (section labels,
  counts, key caps, chips, the status bar's toggles; the small button stood here until later
  that day and is 13: "Token decisions" above). 12 is `--font-label`
  (secondary text: menu titles, the command centre, the status bar's facts, a hint, the palette's
  menu path). 13 is `--font-body` (everything read or typed). The mono is `--font-mono`.
- **The shell's scale won over Cursor's composer.** The tokens were measured from Cursor 3.27.22,
  whose composer and transcript are 15px on a 24px line, whose button is 14px and whose small
  text is 11.5px. That measurement is the history of `--composer-font`, `--composer-leading`,
  `--font-button` and `--font-small`. Beside a 13px shell the result was six sizes (11, 11.5, 12,
  13, 14, 15) in 19 size, weight and leading combinations, and the assistant read as a second
  product in the same window. Cursor's 15px sits in an editor whose code is 13 to 14px; ours sits
  beside a drawing whose chrome is 13px and should stay behind it. The owner has not chosen
  between the two; the default taken here is the shell's, and the choice is two lines of
  `src/tokens.css` to reverse.
- **How.** `--composer-font` is `var(--font-body)` and `--composer-leading` is `20px` (13px on
  20px is the 1.54 ratio of 15 on 24, on a whole pixel). `--font-button` is `var(--font-body)`.
  `--font-small` is `var(--font-label)`: an alias kept for the sheets that name it, holding no
  size of its own. The status bar's facts and the command line's error moved from 11.5 to 12; the
  compact tab from 11.5 to 12; the command line's prompt mark from 14 to the mono's 12.
- **Sizes that did not move.** Button 28 and 24, Field 24, rows 22, the bars 35, 28, 35 and 22:
  every height is a token of its own and none was derived from a type size (measured in the
  browser before and after).

### On is a fill and an ink, never a hue

- **A text toggle that is on is a chip.** The on word was the full ink over a 1px rule in
  `--toggle-on`: white text with a green underline, which read as a link and was the brightest
  text in the status bar. It is now `--text-dim` on a chip (`--fill-active`, `--radius-control`,
  3px shorter than the line at each end), and off is `--text-faint` on nothing. The two differ by
  the fill and by lightness. The chip is the word's `::before`, so the button still takes no
  state fill and the target is still the whole line; the word's hover and press are drawn on the
  same chip. Measured on the status bar: off 6.48 (dark) and 5.68 (light), on 7.23 and 6.37.
  The glyph face is unchanged: a glyph has a second glyph to change to, a word does not.
- **A selected icon button is the full ink on the `.08` fill, squared.** It was the `.14` fill
  at the button's round radius. Its three call sites are the title bar's layout keys, two of
  which are on at rest: two filled discs were the second most salient thing in the bar. Ink
  alone was considered (`--text` against `--icon`, 14.1 against 9.4 on the bar) and is too close
  to tell on from off without a second key to compare with, so the fill stays, one step fainter,
  and takes `--radius-control` so that on is a shape of its own and not a hover that stuck. It
  is the layer's one `selected` recipe, not a variant: no call site wants the louder one.
- **The current layer is the selected fill, the accent bar and `--text`.** Its name was green
  too (a third mark in dark; in light the green was mixed toward the ink to pass). Green was
  also "on" under every toggle. Neither is any more: `--layer-current` is removed, and
  `--toggle-on` is the engine badge's dot alone.
- **The prompt mark takes the accent only while a command runs.** At rest it is `--text-faint`
  (6.16 dark, 5.79 light on the band); with a command running, `--text-accent` (5.98, 6.37).
- **Two ink steps under the text, not three.** `.74`, `.66` and `.60` could not be told apart.
  `--icon` is `var(--text-dim)` in both themes. The dark `--text-faint` was to move to about
  `.52` and could not: it is text on the selected fill (a key cap in a lit row, a neutral chip
  while pressed), where it measures 4.54 at `.60` over the elevated surface, 4.45 at `.59` and
  3.83 at `.52`. `.60` is its floor, so the ladder is `.74` and `.60`.

### Light surfaces

- `--control` `#e8e8e8` to `#F3F3F3`: a resting field on the `#FCFCFC` pane (1.19:1) read as
  disabled, and the assistant's queue tray sat grey under a white composer. A placeholder on the
  new fill measures 5.68. `--control-hover` takes `#e8e8e8` (it was `#dedede`), which is the `.08`
  hover over the pane, so the properties palette's hovered row matches the layer list's.
- `--cmd-bg` is `var(--chrome)` and `--cmd-border` is `var(--border)`: as `#ebebeb` under
  `#c9c9c9` the command line was the darkest chrome on the page.

### The sidebar's columns

- **One text column.** A property's label started at 8px while the headings' labels and the
  layers' names started at 24px. The rail names the column once (`--rail-text` on `.sidebar`:
  the heading's inset, its fold key and the gap after it) and the property rows start on it.
- **One right edge for values.** A choice's value ended 16px before a read-only one (the arrow
  and its gap). Every value now ends one arrow's slot before the column's end, and only a
  choice's arrow stands in the slot. The arrow stays at rest: it was put there so a choice never
  reads as a fixed value, and hiding it until hover would have undone that.
- **A layer's keys show its unusual states.** Each row drew three keys, nearly all in their
  ordinary state: twenty-seven glyphs on a nine-layer list, in which the one layer that was off
  was hard to find. A key in its ordinary state (on, thawed, unlocked) is drawn only on the row
  under the pointer or holding the keyboard; off, frozen and locked are always drawn. The hidden
  keys are faded, not removed: they keep their cells, names and Tab stops, and a finger (no
  hover) gets all of them.

### The status bar stands still

The review saw the toggles shift about 59px when the pointer entered the drawing. Measured, the
coordinates were not the cause (their box already had a reserved width): the selection count
was. It stood after the coordinates and pushed the whole run 60px each time something was
selected. It is now the last of the facts at the start of the bar, so nothing that comes and
goes sits between the toggles and the bar's end. The order in which the bar gives up room is
unchanged, and the sweep was run again from 300 to 1300 wide with ordinary and long content: no
toggle is clipped at any width.

## A task over the page

Decided 2026-11-11, with `Dialog`. An audit found the web interface had no dialogs at all: the
removed desktop interface's Options, Drafting Settings and Layer Properties Manager were never
rebuilt, and the engine's rule ("programmatic calls never open dialogs") makes a dialog an
interface surface that reads the engine's state and acts through `execute`. Captures are
`.design-system/review/wE12-*.png`.

- **Native, shown modally.** `showModal()` gives the focus trap, Escape's close request, the inert
  page and the top layer in each of the three system webviews; none of them is rebuilt. The
  caller owns `open`, so the dialog cancels the platform's own close and asks through `onClose`.
  When the platform closes it without asking (a second Escape in a row), the caller is told, and
  a caller that keeps `open` true gets its dialog back.
- **The box is the palette's.** `--surface-elevated`, the `--border` hairline, `--radius-block`
  and `--shadow-popover`: the command palette's box, value for value, because the two are the
  same kind of thing (a box over the page) and a second recipe would be a second elevation.
- **`--scrim` is new**, the layer's first veil: `rgba(0,0,0,.4)` dark, `rgba(0,0,0,.16)` light.
  The palette leaves the page undimmed because it is a tool over the work; a modal dialog is the
  opposite, and the dimmed page is what says the page is not taking input. No existing token
  could be it: the fills are the ink at an alpha (they lighten in dark), and the surfaces are
  opaque. The colour is the one the shadows already cast with, at the tooltip shadow's alpha in
  each theme, so no hue and no new value entered the system. Nothing is read through it.
- **Widths are a measure, not pixels.** `52ch`, `76ch` and `104ch` of the dialog's own 13px type:
  364, 533 and 729px measured. `76ch` is the palette's width. The brief asked for about 360, 520
  and 720; a `ch` measure needed no size token and follows the type if the scale ever moves.
- **No motion.** The palette's reason holds: it is opened from a key or a menu, and anything that
  plays before the first field reads as lag. The "open" preset stays for menus and popovers. The
  box also carries no transform, which is what lets the layer's hint, a fixed child of the open
  dialog, be placed in the window's coordinates.
- **Focus.** On opening, the first field of the body that is showing (a page behind holds fields
  too), or `initialFocus`; never the close key. With no field, the dialog itself: a question with
  two buttons does not put the keyboard on either answer, least of all Delete. Under a coarse
  pointer the dialog itself as well, because focusing a text field there raises the keyboard over
  a sheet nobody has read yet. Opening waits a microtask, so the caller's own effects (a form
  read afresh, the page it opens on) have run before the field is chosen. On closing, the focus
  goes back to what had it.
- **Enter is the form's.** The body and the footer are one `<form>` that submits nothing, and the
  primary action is a `Button type="submit"`. Enter in a single-line field then presses it
  through the platform's implicit submission: no key handler, so a key an input method is using
  never does it, and an `aria-disabled` primary refuses it as it refuses any click.
- **A press outside** counts only when it began and ended outside the box (a selection dragged
  out of a field ends there and is not a decision), and a caller with work to lose turns it off.
- **Under 560px it is a sheet from the bottom, not a page.** The actions sit under the thumb and
  over an on-screen keyboard (the height follows `dvh`), the drawing stays in sight above a short
  dialog, and a question of two buttons is not a screen of empty space. A full-window page was
  the other offer; it suits a long form and hides what the dialog is about, and a sheet that is
  tall enough becomes that page anyway, less the tab strip's height it leaves showing so that it
  still reads as over the page.
- **No landmarks inside.** The title bar and the footer are plain boxes: a `<header>` or
  `<footer>` in a dialog is announced as the page's banner or footer.
- **The palette stays off it.** Moving `CommandPalette` onto `Dialog` was weighed against "no
  change in behaviour or look" and does not fit, in six ways: it has no title bar (its name is an
  `aria-label`) and no footer of actions; its page is not dimmed, on purpose; it hangs from the
  title bar instead of standing in the middle or on the bottom edge; its `<dialog>` is the whole
  window with the box inside it, which is how a click beside it is told from one in it; every
  click inside hands the focus back to its one field; and Escape keeps what was typed for the
  next opening. A `bare` variant that removes the title bar, the scrim, the placement, the form
  and the focus rule is not a variant of this component, it is the palette. What the two share
  is the box's four tokens and the lines that keep the caller's `open` true to the platform, and
  both already agree.
- **`TabPanels` is automatic.** A dialog's page is already built, so the arrow keys show it as
  they move; the layout strip over the drawing stays manual, because a switch there redraws the
  drawing.

### The first dialog: Drafting Settings

- **No transaction, so the dialog makes its own order.** The engine has no settings object and
  no undo-free transaction. `planCalls` (`src/drafting.ts`) refuses the whole form when one value
  would be refused, so nothing is half-applied because of a typing mistake; the calls then all
  run (they do not depend on one another), each refusal is shown beside its field with a count
  of what was applied, and the engine is read again and the form planned against it, which also
  catches a call answered `ok` and not honoured (`dsettings` drops a spacing it does not like
  without saying so).
- **One undo step for the spacings.** SNAPUNIT and GRIDUNIT are the drawing's header variables,
  so writing them is an undoable edit; both go in one `dsettings` call. Everything else is
  session state the engine records no undo for.
- **OK and Cancel.** `rule/button-label-verb` asks for a verb; a form of several settings has no
  one verb, "Apply" traditionally keeps a dialog open, and OK beside Cancel is the pair the
  dialog's users already read (`rule/dialog-action-labels`). A dialog that does one thing takes
  its verb.
- **The snap markers are the canvas's.** Each box shows `snapGlyph(bit)` from `src/canvas.ts` as
  SVG paths, at the canvas's 12px and 1.5px stroke: one table of figures, drawn in two places.
