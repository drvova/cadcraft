# Button

## Description
It runs one action the moment its label says so: it never navigates and never holds a value.

`import { Button } from "../../../../src/ui/Button";`, source `src/ui/Button.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/button-div, trap/role-button, trap/native-control, trap/button-clone, trap/button-type, trap/control-height, trap/weight-shift, trap/button-label-wrap, trap/focus-ring-shape, trap/hover-beats-focus, trap/disabled-still-hovers, trap/touch-hover-flash, trap/hover-unguarded, trap/touch-tap-highlight.

### Foundation
Not applicable: hand-rolled — the recipe is the app's own `src/ui/ui.css`, measured from the running Cursor 3.27.22 (`docs/system/decisions.md`), and no registry item ships it.

## Examples
`<Button variant="primary">Save</Button>` — the one action of a dialog or a pane.

Real uses, 30 call sites (`rg -c "<Button" src` → `src/components/AssistantPane.tsx:9`, `src/components/DraftingSettings.tsx:4`, `src/components/InlineAsk.tsx:1`, `src/components/JewelryDialog.tsx:2`, `src/components/LayerManager.tsx:7`, `src/components/RecoveryBar.tsx:6`, `src/components/TopBar.tsx:1`):
- `src/components/JewelryDialog.tsx` — the Ring and Gem dialogs' footer: Cancel (the default) and OK (`variant="primary" type="submit"`). Added 2026-11-12.
- `src/components/InlineAsk.tsx` — the offer over a selection on the drawing ("Ask about 18 selected objects", `variant="quiet" size="sm"`, `shortcut` the key that opens the same line): it stands in a small box of the elevated surface that the surface draws, and opens the inline ask. Added 2026-11-12.
- `src/components/DraftingSettings.tsx:337` — the Drafting Settings dialog's footer: Cancel (the default) and OK (`variant="primary" type="submit"`, so Enter in a field presses it); and Select all and Clear all over the object snap boxes (`variant="ghost" size="sm"`, `src/components/DraftingSettings.tsx:302`).
- `src/components/AssistantPane.tsx` — the assistant's call sites: the empty state's Set up a model (`variant="primary"`, shown while no model is connected), the setup sheet's Change beside the chosen provider's name (`variant="quiet" size="sm"`), its Check connection and Cancel (`variant="ghost"`) and Save (`variant="primary"`), and the stack over the composer: Stop on the run row and Undo all on the changes row (`variant="ghost" size="sm"`), and Keep beside it (`size="sm"`).
- `src/components/TopBar.tsx:42` — the title bar's command centre (`size="sm"`): the drawing's name, opening the command palette.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/button/default.tsx` | default | The default secondary button beside a primary one. |
| `docs/system/examples/button/variant-primary.tsx` | variant=primary | The accent fill, the one action of a pane. |
| `docs/system/examples/button/variant-secondary.tsx` | variant=secondary | The default quiet fill. |
| `docs/system/examples/button/variant-ghost.tsx` | variant=ghost | A quiet action with no resting fill. |
| `docs/system/examples/button/variant-quiet.tsx` | variant=quiet | An action that stands back beside the title it changes. |
| `docs/system/examples/button/variant-danger.tsx` | variant=danger | The destructive action. |
| `docs/system/examples/button/size-sm.tsx` | size=sm | The 24px button that sits beside a field. |
| `docs/system/examples/button/size-md.tsx` | size=md | The 28px default control. |
| `docs/system/examples/button/disabled.tsx` | state:disabled | A blocked action at the disabled ink and fill. |
| `docs/system/examples/button/matrix-variant-size.tsx` | matrix:variant,size | Every variant at both sizes. |
| `docs/system/examples/button/in-topbar.tsx` | composition:TopBar | A small button in the top bar's action row. |

## Variants

### variant
- `primary`: the one action of the pane or dialog; the accent fill. Used at 1 call site in the assistant (the setup sheet's Save), and the dialog's OK.
- `secondary`: the default action; the `.08` fill that Cursor's own default button draws. Used at 3 call sites (the title bar's command centre, the setup sheet's Check connection and the changes row's Keep).
- `ghost`: a quiet action on a tool bar or in a list; no resting fill, the full ink. Used at 7 call sites (the transcript's Show earlier, the setup sheet's Cancel, the two Stop buttons of a running turn, the changes row's Undo all, and the dialog's Select all and Clear all).
- `quiet`: an action that must not compete with what it stands beside, a title it changes or a line it follows; no resting fill and the secondary ink (`--text-dim`), waking to the full ink on ghost's own fills under the pointer and the press, as the ghost `IconButton` does. Measured on the setup sheet, dark and light: the label 9.17 and 7.82 at rest, 13.35 and 15.24 on the `.08` hover fill, 11.12 and 13.37 on the `.14` pressed fill; the ring 6.43 and 6.60 against the sheet; the disabled label 3.08 and 2.30, the layer's one disabled ink, which no contrast rule binds. Until 2026-11-12 the sheet dimmed a `ghost` from its own stylesheet, a colour set on a layer component from outside. Used at 1 call site (the setup sheet's Change).
- `danger`: a destructive action; the error fill. Used at 0 call sites.

### size
- `sm`: the 24px control, for a button beside a field or inside a row. Only the box is smaller: the label is `--font-button` (13px) in both sizes. Until 2026-11-11 `sm` drew it at `--font-chip` (11px), and the setup sheet's Change provider was the smallest text in a sheet of 12px and 13px rows; 11px is the scale's step for section labels, counts and key caps, and `typography.md` gives a button one size wherever it sits (`src/ui/recipe.test.ts` holds it). Used at 6 call sites (the title bar's command centre, the transcript's Show earlier, the setup sheet's Change provider, and the stack's Stop, Undo all and Keep).
- `md`: the 28px default, for a dialog footer or a pane header. Used at 3 call sites in the assistant (the setup sheet's Check connection, Cancel and Save), and the dialog's footer.

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest | Nothing is over the button. | Click it, or Tab to it. | The variant's resting fill and the label. | by hand |
| Hover | The pointer is over the button, on a device with a hover pointer. | Click it. | The fill steps up one rung (`.08` to `.14`, `.14` to `.20`); the cursor is a pointer. | by hand |
| Pressed | The pointer is held down on the button. | Release to run the action. | The quiet fill stays on the hover rung (`.14`, measured); the accent variants take their measured press step. | by hand |
| Focused | Keyboard focus arrives by Tab. | Enter or Space runs the action. | The 1px ring in the focus ink at offset -1, following the 2px radius; on `primary` and `danger`, the ring is the label's ink drawn 3px inside the edge. | by hand |
| Hinted | The caller passes `title`, and a mouse or a pen rests on the button for 0.4s (at once when another hint was up within the last 0.3s), or a key moves focus onto it. Never a finger, and never a `title` that only repeats the label. | Read what the label leaves out; a press, a click or Escape puts the box away until the pointer or the focus moves to another control. | The layer's hint box holding the `title` (and the shortcut as a key cap), below the button, above it at the window's foot, inside the window's edges. | test |
| Disabled | The caller's condition is false. | Tab to it and read its hint, which says why when the caller passes `title`. No click by pointer, Enter or Space, and no hover fill. | The ink drops to the disabled step and the fill to the disabled step; `aria-disabled="true"`. | test |

### State precedence
- Hover and Focused: Focused wins. The ring stays drawn while the pointer is over the button; hover only steps the fill.
- Hover and Disabled: Disabled wins. A disabled button keeps its resting fill under the pointer and takes no click.
- Pressed and Focused: both show. The ring stays drawn while the button is held down; the quiet fill stays on the hover rung.
- Pressed and Disabled: Disabled wins. A disabled button never takes the pressed fill.
- Focused and Disabled: both show. A disabled button takes focus and the ring, so a keyboard user can reach its hint; Enter and Space do nothing.
- Hinted and Hover: both show. The hint follows the hover after its delay.
- Hinted and Focused: both show. The hint arrives with the ring, with no delay.
- Hinted and Pressed: Pressed wins. The press puts the hint away.
- Hinted and Disabled: both show. The hint is how a disabled button says why it is blocked.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| The pointer enters or leaves | input | hover / focus feedback (`--dur-fast` + `--ease-standard`) | background-color | The fill changes at once: the shell's `:root[data-animations="off"] *` rule removes the transition. |
| The pointer presses down | input | hover / focus feedback (`--dur-fast` + `--ease-standard`) | background-color | The fill changes at once, by the same rule. |
| The pointer enters, leaves or presses a `quiet` button | input | hover / focus feedback (`--dur-fast` + `--ease-standard`) | background-color, color | The fill and the ink change at once, by the same rule. |

## Props
- `variant`: the purpose of the action; the token layer picks the look. Defaults to `secondary`.
- `size`: the control height; `md` is 28px and `sm` is 24px. It never changes the label's size.
- `type`: defaults to `button` so a button inside a form never submits by accident.
- `disabled`: blocks the click and drops the ink to the disabled step. It sets `aria-disabled="true"`, never the native `disabled`, so the button stays in the Tab order and under the pointer and its hint can say why.
- `title`: the hint, shown in the layer's hint box and tied to the button as its accessible description (`aria-describedby`). It is what the label leaves out, or why the button is disabled; it is never the name, and no native `title` attribute is rendered. A `title` equal to the label draws no hint and adds no description.
- `shortcut`: the shortcut that runs the same action, as the user reads it (`Ctrl+Shift+P`): a key cap after the hint's text, and `aria-keyshortcuts` on the button. A `title` that ends in the shortcut in brackets still draws the cap, without the attribute.
- `ariaLabel`: the accessible name, only for a button whose visible label is a value rather than its action.
- `onClick`: runs on click; a disabled button never fires it.

## Usage

### When to use
- The user runs one action and expects it to happen now: saving, closing, deleting, opening a dialog.
- The action is the pane's or dialog's main one, and there is exactly one of it: the `primary` variant.

### When not to use
- The control is a glyph with no label. Use `IconButton` instead.
- The text is a status or a value rather than an action. Use `Chip` instead.
- The clickable band is a list item rather than an action. Use `Row` instead.

### Rules
- `rule/button-variant-purpose`: When a surface needs a button, pick `variant` by the action's purpose — 1 `primary` per view, `secondary` for the default, `ghost` for a quiet action, `quiet` for one that stands beside a title or a line and must read after it, `danger` for a destructive one — because two accent fills in one row leave no single action and Cursor's own default button is the quiet one. Evidence: app 5/5 variants, `docs/system/decisions.md`. Check: review `src/ui/ui.css`.
  - Don't: `<Button variant="primary">Cancel</Button>`
  - Do: `<Button>Cancel</Button>`
- `rule/button-quiet-not-dimmed`: When an action must read after the text beside it, pass `variant="quiet"` and leave every ink and fill of a `Button` to the layer, because an ink set from a surface's stylesheet reaches 1 state: the dimmed `ghost` kept the secondary ink on the `.14` pressed fill, and a disabled one would have kept it too. Evidence: single use `src/components/AssistantPane.tsx:1032`, the setup sheet's Change, dimmed until 2026-11-12 by `.assistant-setup-change .ui-button`. Check: test `src/ui/recipe.test.ts`.
  - Don't: `.assistant-setup-change .ui-button { color: var(--text-dim) }`
  - Do: `<Button variant="quiet" size="sm" title="Choose another provider">Change</Button>`
- `rule/button-state-ladder`: When a button is hovered, step the fill one rung — `.08` to `.14` — and hold that rung while pressed, because the measured glass button adds no third step and a fill step reads as feedback without moving the label or the box. Evidence: measured .08/.14/.14, `docs/system/decisions.md`. Check: review `src/ui/ui.css`.
  - Don't: `.my-button:hover { color: var(--accent) }` — a colour change instead of a fill step.
  - Do: `.ui-button--secondary:hover { background: var(--fill-active) }`

- `rule/button-disabled-reason`: When a button is disabled by something the user can fix, pass the reason as `title` in 1 short sentence, because a disabled button stays focusable and hoverable for exactly this and a dead button with 0 words leaves the user guessing what to fill in. Evidence: single use `src/components/AssistantPane.tsx:808`, the setup sheet's Save with `title={blocker() ?? undefined}`. Check: test `src/ui/Button.test.tsx`.
  - Don't: `<Button variant="primary" disabled={blocker() !== null}>Save</Button>`
  - Do: `<Button variant="primary" disabled={blocker() !== null} title={blocker() ?? undefined}>Save</Button>`
- `rule/button-title-adds`: When a button takes `title`, write what the label leaves out and 0 words that repeat it, because the label is the name and the hint is announced after it as the description: "Save, button, Save" says the same thing twice, and the layer draws no box for a repeat. Evidence: single use `src/components/TopBar.tsx:45`, the command centre's "Command palette" hint over a name that already says "Search commands". Check: test `src/ui/Button.test.tsx`.
  - Don't: `<Button title="Save">Save</Button>`
  - Do: `<Button title="Check the address and the key">Check connection</Button>`

### Content
- `rule/button-label-verb`: When the label is written, use a verb the user recognizes in sentence case — `Save`, `Delete`, `Undo all` — because the label is the action's name and the accessible name comes from it. Evidence: app 5/6 labels are verbs or verb phrases, `src/components/AssistantPane.tsx:1045`, the label "Undo all" (the sixth, the command centre, is labelled with the drawing's name and names its action in its `title`). Check: review `src/components/AssistantPane.tsx`.
  - Don't: `<Button>SAVE</Button>`
  - Do: `<Button>Save</Button>`
- `rule/button-aria-label-value`: When a button's visible label is a value rather than its action, pass `ariaLabel` starting with the action and holding the visible text, and pass it on 0 other buttons, because a drawing's name alone is announced as "Bracket, button" with no action in it, while an `aria-label` over a verb label hides the word a speech-input user says to press it. Evidence: single use `src/components/TopBar.tsx:40`, the command centre labelled with the drawing's name. Check: test `src/ui/Button.test.tsx`.
  - Don't: `<Button ariaLabel="Store the drawing">Save</Button>`
  - Do: `<Button size="sm" ariaLabel={"Search commands, " + title()}>{title()}</Button>`

### Anti-slop
- `rule/button-canonical-element`: When a surface needs a button, render `Button` rather than a raw `<button>` with its own class, because the replaced classes paint 6 different hover fills and 3 different radii by hand. Evidence: app 22/22 lines across `assistant.css` and `AssistantPane.tsx`, `rg -c "assistant-send|assistant-save|assistant-ghost|assistant-preset" src`. Check: review `src/ui/Button.tsx`.
  - Don't: `<button class="assistant-ghost" onClick={save}>Save</button>`
  - Do: `<Button variant="ghost" onClick={save}>Save</Button>`

### Limits
- `rule/button-row-limit`: When one row or dialog footer holds more than 3 buttons, move the rest into a menu, because the measured composer toolbar holds 3 actions at 24px each and a fourth starts competing with the input. Evidence: measured 3 actions at 24px, `docs/system/decisions.md`. Check: review `src/components/AssistantPane.tsx`.
  - Don't: 5 buttons side by side in the pane's toolbar row.
  - Do: 2 buttons in the row and the rest inside a menu.

## Accessibility
Rests on the native `<button>` element: role, Enter and Space, and form behaviour come from the platform. Disabled is the layer's own: `aria-disabled="true"` with the click refused on the button itself (`refuseWhenDisabled` in `src/ui/Button.tsx`), because the native `disabled` takes a button out of the Tab order and, in some of the system webviews the desktop app runs in, out of the pointer's reach, and a control nobody can reach cannot say why it is blocked (`docs/system/decisions.md`, "Disabled controls"). The hint is the description, never the name.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The button, in document order. | Moves focus to the button; the accent ring draws. | On the button. | by hand |
| Enter | The focused button. | Runs the action. | Stays on the button. | test |
| Space | The focused button. | Runs the action on release, exactly once. | Stays on the button. | by hand |
| Tab (disabled) | A disabled button, in document order. | Moves focus to it, as to any button; the ring draws and its hint shows at once. | On the button. | by hand |
| Enter or Space (disabled) | The focused disabled button. | Nothing: the click is refused before any handler hears it, and a submit button does not submit. | Stays on the button. | test |
| Escape | The focused or hovered button, its hint showing. | Puts the hint away; the key is not consumed. | Stays on the button. | test |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The button | `button` (native) | Its text content; `ariaLabel` when the label is a value | `aria-disabled="true"` when blocked; `aria-describedby` pointing at the `title`'s words when it adds to the name; `aria-keyshortcuts` with `shortcut`; `type="button"` by default | "Save, button" / "Search commands, Bracket, button" / "Save, button, dimmed, To save, choose a provider or type a base URL." | test |
| The description | None: a `<span>` in the hidden `.ui-hint-descriptions` element on `<body>` | — | Referenced by the button's `aria-describedby`; removed with the button | Read after the name and role | test |
| The hint | None: the box is `aria-hidden="true"` | — | It shows the description's words for the eye | Nothing | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The box | all | `--control-h-button`, `--radius-control`, `--button-pad-x`, `--button-pad-y`, `--gap-4`, `--font-button`, `--leading-ui` |
| The box (`sm`) | all | `--control-h-input`, `--gap-6`, `--gap-2`; the label stays `--font-button` |
| The fill (`secondary`) | rest | `--hover` |
| The fill (`secondary`) | hover | `--fill-active` |
| The fill (`secondary`) | pressed | `--fill-active` (measured: no third step) |
| The fill (`primary`) | rest | `--accent` |
| The fill (`primary`) | hover | `--accent-hover` |
| The fill (`primary`) | pressed | `--accent-pressed` |
| The fill (`danger`) | rest | `--error` |
| The fill (`danger`) | hover | `--error-hover` |
| The fill (`danger`) | pressed | `--error-pressed` |
| The fill (`ghost`, `quiet`) | rest | none: transparent |
| The fill (`ghost`, `quiet`) | hover | `--hover` |
| The fill (`ghost`, `quiet`) | pressed | `--fill-active` |
| The label | rest | `--text` |
| The label (`quiet`) | rest | `--text-dim` |
| The label (`quiet`) | hover, pressed | `--text` |
| The label (`primary`) | rest | `--on-accent` |
| The label (`danger`) | rest | `--on-error` |
| The label | disabled | `--text-disabled` |
| The fill | disabled | `--fill-disabled` |
| The ring | focus-visible | `--focus-outline-w`, `--focus-ring`, `--focus-outline-offset` |
| The ring (`primary`) | focus-visible | `--on-accent` |
| The ring (`danger`) | focus-visible | `--on-error` |
| The motion | hover, pressed | `--dur-fast`, `--ease-standard` (`quiet` eases its ink with its fill) |

## Related
- `IconButton`: when the action is one glyph with a tooltip and no label.
- `Row`: when the clickable band is a list item rather than an action.
- `Chip`: when the text is a fact or a value, not an action.
- `Field`: when the control holds an editable value rather than performing an action.
- `SectionLabel`: when the text names a group rather than performing an action.
- `Tab`: when the control brings one view of a strip to the front rather than running an action.
- `Kbd`: when the text is the key that runs an action beside the button, not the action itself.
- `Tooltip`: the hint box a button's `title` shows in; never wrap a button in one.
- `Checkbox`: when the control holds a yes or no rather than running an action.
