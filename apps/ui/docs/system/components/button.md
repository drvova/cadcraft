# Button

## Description
It runs one action the moment its label says so: it never navigates and never holds a value.

`import { Button } from "../../../../src/ui/Button";`, source `src/ui/Button.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/button-div, trap/role-button, trap/native-control, trap/button-clone, trap/button-type, trap/control-height, trap/weight-shift, trap/button-label-wrap, trap/focus-ring-shape, trap/hover-beats-focus, trap/disabled-still-hovers, trap/touch-hover-flash, trap/hover-unguarded, trap/touch-tap-highlight.

### Foundation
Not applicable: hand-rolled — the recipe is the app's own `src/ui/ui.css`, measured from the running Cursor 3.27.22 (`../../../../../.design-system/research/cursor-recipes-2026-10-28.md` §5), and no registry item ships it.

## Examples
`<Button variant="primary">Save</Button>` — the one action of a dialog or a pane.

Real uses, 3 call sites (`rg -c "<Button" src/components` → `src/components/AssistantPane.tsx:2`, `src/components/TopBar.tsx:1`):
- `src/components/AssistantPane.tsx` — the composer pilot's call sites: the provider popover's Cancel (`variant="ghost"`) and Save (`variant="primary"`).
- `src/components/TopBar.tsx:48` — Zoom extents (`size="sm"`), the bar's one action.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/button/default.tsx` | default | The default secondary button beside a primary one. |
| `docs/system/examples/button/variant-primary.tsx` | variant=primary | The accent fill, the one action of a pane. |
| `docs/system/examples/button/variant-secondary.tsx` | variant=secondary | The default quiet fill. |
| `docs/system/examples/button/variant-ghost.tsx` | variant=ghost | A quiet action with no resting fill. |
| `docs/system/examples/button/variant-danger.tsx` | variant=danger | The destructive action. |
| `docs/system/examples/button/size-sm.tsx` | size=sm | The 24px button that sits beside a field. |
| `docs/system/examples/button/size-md.tsx` | size=md | The 28px default control. |
| `docs/system/examples/button/disabled.tsx` | state:disabled | A blocked action at the disabled ink and fill. |
| `docs/system/examples/button/matrix-variant-size.tsx` | matrix:variant,size | Every variant at both sizes. |
| `docs/system/examples/button/in-topbar.tsx` | composition:TopBar | A small button in the top bar's action row. |

## Variants

### variant
- `primary`: the one action of the pane or dialog; the accent fill. Used at 1 call site (the provider popover's Save).
- `secondary`: the default action; the `.08` fill that Cursor's own default button draws. Used at 0 call sites.
- `ghost`: a quiet action on a tool bar or in a list; no resting fill. Used at 1 call site (the provider popover's Cancel).
- `danger`: a destructive action; the error fill. Used at 0 call sites.

### size
- `sm`: the 24px control, for a button beside a field or inside a row. Used at 1 call site (the top bar's Zoom extents).
- `md`: the 28px default, for a dialog footer or a pane header. Used at 2 call sites (the provider popover's Cancel and Save).

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest | Nothing is over the button. | Click it, or Tab to it. | The variant's resting fill and the label. | by hand |
| Hover | The pointer is over the button, on a device with a hover pointer. | Click it. | The fill steps up one rung (`.08` to `.14`, `.14` to `.20`); the cursor is a pointer. | by hand |
| Pressed | The pointer is held down on the button. | Release to run the action. | The fill takes the next rung up (`.20`, or the 20% mix on `primary` and `danger`). | by hand |
| Focused | Keyboard focus arrives by Tab. | Enter or Space runs the action. | The 1px accent ring at offset -1, following the 2px radius. | by hand |
| Disabled | The caller's condition is false. | Nothing: no click, no hover, no focus ring. | The ink drops to the disabled step and the fill to the disabled step. | test |

### State precedence
- Hover and Focused: Focused wins. The ring stays drawn while the pointer is over the button; hover only steps the fill.
- Hover and Disabled: Disabled wins. A disabled button keeps its resting fill under the pointer and takes no click.
- Pressed and Focused: both show. The ring stays drawn while the button is held down; the fill steps up.
- Pressed and Disabled: Disabled wins. A disabled button never takes the pressed fill.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| The pointer enters or leaves | input | hover / focus feedback (`--dur-fast` + `--ease-out`) | background-color | The fill changes at once: the shell's `:root[data-animations="off"] *` rule removes the transition. |
| The pointer presses down | input | press (`--dur-instant` + `--ease-out`) | background-color | The fill changes at once. |

## Props
- `variant`: the purpose of the action; the token layer picks the look. Defaults to `secondary`.
- `size`: the control height; `md` is 28px and `sm` is 24px.
- `type`: defaults to `button` so a button inside a form never submits by accident.
- `disabled`: blocks the click and drops the ink to the disabled step.
- `title`: a tooltip; it is not a substitute for the label.
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
- `rule/button-variant-purpose`: When a surface needs a button, pick `variant` by the action's purpose — 1 `primary` per view, `secondary` for the default, `ghost` for a quiet action, `danger` for a destructive one — because two accent fills in one row leave no single action and Cursor's own default button is the quiet one. Evidence: app 4/4 variants, `../../../../../.design-system/research/cursor-recipes-2026-10-28.md` §5. Check: review `src/ui/ui.css`.
  - Don't: `<Button variant="primary">Cancel</Button>`
  - Do: `<Button>Cancel</Button>`
- `rule/button-state-ladder`: When a button is hovered or pressed, step the fill one rung per state — `.08` to `.14` on hover, `.14` to `.20` on press — because a fill step reads as feedback without moving the label or the box. Evidence: measured .08/.14/.20, `../../../../../.design-system/research/cursor-recipes-2026-10-28.md` §5. Check: review `src/ui/ui.css`.
  - Don't: `.my-button:hover { color: var(--accent) }` — a colour change instead of a fill step.
  - Do: `.ui-button--secondary:hover { background: var(--fill-active) }`

### Content
- `rule/button-label-verb`: When the label is written, use a verb the user recognizes in sentence case — `Save`, `Delete`, `Zoom extents` — because the label is the action's name and the accessible name comes from it. Evidence: single use `src/components/TopBar.tsx:48`, the label "Zoom extents". Check: review `src/components/TopBar.tsx`.
  - Don't: `<Button>SAVE</Button>`
  - Do: `<Button>Save</Button>`

### Anti-slop
- `rule/button-canonical-element`: When a surface needs a button, render `Button` rather than a raw `<button>` with its own class, because the replaced classes paint 6 different hover fills and 3 different radii by hand. Evidence: app 22/22 lines across `assistant.css` and `AssistantPane.tsx`, `rg -c "assistant-send|assistant-save|assistant-ghost|assistant-preset" src`. Check: review `src/ui/Button.tsx`.
  - Don't: `<button class="assistant-ghost" onClick={save}>Save</button>`
  - Do: `<Button variant="ghost" onClick={save}>Save</Button>`

### Limits
- `rule/button-row-limit`: When one row or dialog footer holds more than 3 buttons, move the rest into a menu, because the measured composer toolbar holds 3 actions at 24px each and a fourth starts competing with the input. Evidence: measured 3 actions at 24px, `../../../../../.design-system/research/cursor-recipes-2026-10-28.md` §2. Check: review `src/components/AssistantPane.tsx`.
  - Don't: 5 buttons side by side in the pane's toolbar row.
  - Do: 2 buttons in the row and the rest inside a menu.

## Accessibility
Rests on the native `<button>` element: role, Enter and Space, `disabled`, and form behaviour come from the platform.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The button, in document order. | Moves focus to the button; the accent ring draws. | On the button. | by hand |
| Enter | The focused button. | Runs the action. | Stays on the button. | test |
| Space | The focused button. | Runs the action on release, exactly once. | Stays on the button. | by hand |
| Tab (disabled) | A disabled button is skipped. | Focus moves past it. | On the next control. | by hand |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The button | `button` (native) | Its text content | `disabled` when blocked; `type="button"` by default | "Save, button" | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The box | all | `--control-h-button`, `--radius-control`, `--button-pad-x`, `--button-pad-y`, `--gap-4`, `--font-button` |
| The box (`sm`) | all | `--control-h-input`, `--gap-6`, `--gap-2`, `--font-chip` |
| The fill (`secondary`) | rest | `--hover` |
| The fill (`secondary`) | hover | `--fill-active` |
| The fill (`secondary`) | pressed | `--fill-pressed` |
| The fill (`primary`) | rest | `--accent` |
| The fill (`primary`) | hover | `--accent-hover` |
| The fill (`primary`) | pressed | `--accent-pressed` |
| The fill (`danger`) | rest | `--error` |
| The fill (`danger`) | hover | `--error-hover` |
| The fill (`danger`) | pressed | `--error-pressed` |
| The label | rest | `--text` |
| The label (`primary`, `danger`) | rest | `--on-accent` |
| The label | disabled | `--text-disabled` |
| The fill | disabled | `--fill-disabled` |
| The ring | focus-visible | `--focus-outline-w`, `--accent`, `--focus-outline-offset` |
| The motion | hover, pressed | `--dur-fast`, `--dur-instant`, `--ease-out` |

## Related
- `IconButton`: when the action is one glyph with a tooltip and no label.
- `Row`: when the clickable band is a list item rather than an action.
- `Chip`: when the text is a fact or a value, not an action.
- `Field`: when the control holds an editable value rather than performing an action.
- `SectionLabel`: when the text names a group rather than performing an action.
