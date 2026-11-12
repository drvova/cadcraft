# Checkbox

## Description
It holds one yes-or-no value the caller owns, and can say that the things it stands for disagree.

`import { Checkbox } from "../../../../src/ui/Checkbox";`, source `src/ui/Checkbox.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/native-control, trap/field-label, trap/label-unbound, trap/field-error-link (n/a: a tick has no refused state, and a line of help is tied by `describedBy`), trap/toggle-switch-submit, trap/toggle-indeterminate, trap/touch-hover-flash, trap/hover-unguarded, trap/touch-tap-highlight, trap/focus-ring-shape, trap/hover-beats-focus, trap/disabled-still-hovers, trap/color-only-status.

### Foundation
Not applicable: hand-rolled — a native `<input type="checkbox">` drawn from the layer's tokens (the accent fill and its `--on-accent` ink are the primary Button's measured pair, `docs/system/decisions.md`), and no registry item ships it.

## Examples
`<Checkbox checked={snap()} onChange={setSnap}>Snap to grid</Checkbox>` — a setting with its label; the whole label is the target.

Real uses, 3 call sites (`rg -c "<Checkbox" src/components` → `src/components/DraftingSettings.tsx:2`, `src/components/PropertiesPanel.tsx:1`):
- `src/components/DraftingSettings.tsx:199` — the Drafting Settings dialog's switches (Snap on, Grid on, Polar tracking on, and the rest), each with its label as children and a refusal tied by `describedBy`.
- `src/components/DraftingSettings.tsx:313` — the dialog's box per object snap: the label is the snap's marker and its name.
- `src/components/PropertiesPanel.tsx:195` — the palette's yes-or-no rows: named by the row's label, `mixed` when the picked objects disagree.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/checkbox/default.tsx` | default | An empty box with its label. |
| `docs/system/examples/checkbox/checked.tsx` | state:checked | A ticked box: the accent fill and the tick. |
| `docs/system/examples/checkbox/mixed.tsx` | state:mixed | Objects that disagree: the dash. |
| `docs/system/examples/checkbox/disabled.tsx` | state:disabled | A locked box at the disabled ink. |
| `docs/system/examples/checkbox/in-properties-panel.tsx` | composition:PropertiesPanel | A yes-or-no row of the properties palette, named by `ariaLabel`. |

## Variants

### Not applicable
Not applicable: no variant axes — a checkbox is one 14px box with or without a label; ticked, mixed and disabled are states.

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest (empty) | `checked` is false or unset. | Press the box or its label, or Space on the box, to ask for ticked. | An empty box with a stroke in the glyph ink. | test |
| Checked | The caller passes `checked`. | Press to ask for empty. | The tick, drawn in code, on the filled box. | test |
| Mixed | The caller passes `mixed`. | Press to ask for ticked; the caller then clears `mixed`. | The dash in place of the tick; `indeterminate` on the element and `aria-checked="mixed"`. | test |
| Hover | The pointer is over the box or its label, on a device with a hover pointer. | Press. | The pointer cursor; the box takes the `.08` fill, or the accent's hover step when ticked or mixed. | by hand |
| Pressed | The pointer is held down on the box. | Release to change the value. | The `.14` fill, or the accent's pressed step when ticked or mixed. | by hand |
| Focused | Keyboard focus arrives by Tab. | Space changes the value. | The 1px ring in the focus ink, one hairline off the box. | by hand |
| Disabled | The caller passes `disabled`. | Nothing: no press, no focus. | The box, its mark and the label at the disabled ink; the cursor stays default. | test |

### State precedence
- Mixed and Checked: Mixed wins. The dash shows whatever `checked` says, and the element reports not checked.
- Hover and Focused: both show. The ring stays drawn while the box takes the hover fill.
- Hover and Checked: both show. The tick stays on the accent's hover step.
- Pressed and Hover: Pressed wins. The pressed fill replaces the hover fill while the pointer is down.
- Pressed and Focused: both show. The ring stays drawn while the box is held down.
- Focused and Checked: both show. The ring stands a hairline off the filled box, so it is never the accent on the accent.
- Focused and Mixed: both show. The ring stands off the filled box as it does when ticked.
- Disabled and Hover: Disabled wins. A disabled box takes no fill under the pointer.
- Disabled and Checked: both show. The tick stays, at the disabled ink on the disabled fill.
- Disabled and Mixed: both show. The dash stays, at the disabled ink on the disabled fill.
- Disabled and Focused: Not applicable: a natively disabled box takes no focus.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| The value changes, or the pointer enters, presses or leaves | input | hover / focus feedback (`--dur-fast` + `--ease-standard`) | background-color, border-color | The fill and the stroke change at once: the shell's `:root[data-animations="off"] *` rule removes the transition. The mark appears at once in every setting. |

## Props
- `checked`: whether the box is ticked; the caller holds it.
- `onChange`: runs with the state a press asks for. The box then shows what `checked` and `mixed` say, so a change the caller refuses does not stay drawn.
- `mixed`: the box stands for values that disagree; sets `indeterminate` and `aria-checked="mixed"`.
- `disabled`: the native attribute; blocks the press and drops the ink.
- `ariaLabel`: the accessible name when the box has no visible label.
- `describedBy`: the `id` of a line of help (several, space-separated); sets `aria-describedby`.
- `children`: the visible label. The whole of it is clickable.

## Usage

### When to use
- A setting is on or off and is read as a fact about the thing beside it: Closed, Annotative, Show the grid.
- One box stands for several objects, which may disagree.

### When not to use
- The control runs an action rather than holding a value. Use `Button` instead.
- The value is 1 of 3 or more choices. Use `Select` instead.
- The control is a glyph that switches a mode on a tool bar. Use `IconButton` with `selected` instead.

### Rules
- `rule/checkbox-name`: When a checkbox is rendered, give it a visible label as its children or, where the row already shows the name, an `ariaLabel`, because a box with neither is announced as 1 unnamed check box. Evidence: single use `src/ui/Checkbox.tsx:53`, the `aria-label` the prop sets beside the wrapping `<label>`. Check: test `src/ui/Checkbox.test.tsx`.
  - Don't: `<Checkbox checked={closed()} onChange={setClosed} />`
  - Do: `<Checkbox ariaLabel="Closed" checked={closed()} onChange={setClosed} />`
- `rule/checkbox-label-inside`: When a checkbox has a visible label, pass the words as the children of `Checkbox` rather than as a sibling element, because the component's `<label>` wraps the box and the words, which makes all of them 1 target, and a sibling `<span>` leaves a dead gap that reads as broken. Evidence: single use `src/ui/Checkbox.tsx:47`, the wrapping `<label>`. Check: test `src/ui/Checkbox.test.tsx`.
  - Don't: `<Checkbox checked={grid()} onChange={setGrid} /><span>Show the grid</span>`
  - Do: `<Checkbox checked={grid()} onChange={setGrid}>Show the grid</Checkbox>`
- `rule/checkbox-mixed-three-states`: When one box stands for several objects, pass `mixed` while they disagree and set it to `false` in `onChange`, because the first press on a mixed box asks for ticked and all 3 states must be reachable: mixed to ticked, ticked to empty, empty to ticked. Evidence: single use `src/ui/Checkbox.tsx:42`, the `indeterminate` property the prop sets. Check: test `src/ui/Checkbox.test.tsx`.
  - Don't: `<Checkbox checked={false} ariaLabel="Annotative" onChange={setAll} />` for objects that disagree.
  - Do: `<Checkbox mixed={disagree()} checked={all()} ariaLabel="Annotative" onChange={setAll} />`
- `rule/checkbox-owns-nothing`: When `onChange` runs, set the caller's own value from its argument (or refuse it), because the box redraws from `checked` and `mixed` after every press and keeps 0 state of its own. Evidence: single use `src/ui/Checkbox.tsx:59`, the redraw after the caller has heard the press. Check: test `src/ui/Checkbox.test.tsx`.
  - Don't: `<Checkbox onChange={() => save()}>Snap</Checkbox>` with no `checked`.
  - Do: `<Checkbox checked={snap()} onChange={setSnap}>Snap</Checkbox>`

### Content
- `rule/checkbox-label-positive`: When a checkbox's label is written, name what is true when the box is ticked, in 1 to 4 words in the positive form (Show the grid), because a ticked box beside a negative label has to be read twice. Evidence: single use `src/components/PropertiesPanel.tsx:225`, the palette's yes-or-no rows, labelled by the property's name. Check: review `src/components/PropertiesPanel.tsx`.
  - Don't: `<Checkbox checked={!grid()} onChange={(off) => setGrid(!off)}>Do not show the grid</Checkbox>`
  - Do: `<Checkbox checked={grid()} onChange={setGrid}>Show the grid</Checkbox>`

### Anti-slop
- `rule/checkbox-canonical-element`: When a surface needs a tick box, render `Checkbox` rather than a raw `<input type="checkbox">` with `accent-color`, because the platform draws that box in its own shape, size and tick in each of the 3 system webviews the desktop app runs in. Evidence: single use `src/components/PropertiesPanel.tsx:195`, which replaced `.prop-check` with `accent-color`. Check: review `src/ui/Checkbox.tsx`.
  - Don't: `<input class="prop-check" type="checkbox" checked={on} aria-label="Closed" />`
  - Do: `<Checkbox ariaLabel="Closed" checked={on} onChange={setOn} />`

### Limits
- `rule/checkbox-touch-target`: When checkboxes without labels stack in rows, keep the rows at least 24px apart centre to centre under a coarse pointer, because each 14px box takes a 24px target around its middle there and two targets in rows 22px apart overlap by 2px. Evidence: measured 14px box and a 24px by 24px target on its label under the coarse rules, in the browser, 2026-11-11. Check: review `src/ui/ui.css`.
  - Don't: `.my-row { height: var(--control-h-row) }` around a bare `<Checkbox ariaLabel="Closed" />` on a touch screen.
  - Do: `@media (pointer: coarse) { .my-row { min-height: var(--control-h-input) } }`

## Accessibility
Rests on the native `<input type="checkbox">` inside a `<label>`: role, Space, the label's click, form participation and `disabled` come from the platform. The drawn mark is `aria-hidden`.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The box, in document order. | Moves focus to it; the ring draws a hairline off the box. | On the box. | by hand |
| Tab (disabled) | A disabled box is skipped. | Focus moves past it. | On the next control. | by hand |
| Space | The focused box. | Asks for the other state (ticked, from mixed); `onChange` runs once. | Stays on the box. | by hand |
| Enter | The focused box. | Nothing: a checkbox is not a button. | Stays on the box. | by hand |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The box | `checkbox` (native) | The wrapping label's text, or `aria-label` | The native checked state; `indeterminate` and `aria-checked="mixed"` while mixed; `disabled` when blocked; `aria-describedby` naming the caller's line | "Show the grid, check box, checked" / "Annotative, check box, mixed" | test |
| The mark | none (`aria-hidden="true"`) | Not exposed | None | Nothing: the box says its state | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The box | all | `--icon-size-md`, `--radius-small`, `--hairline` |
| The stroke | empty | `--icon` |
| The fill | hover (empty) | `--hover` |
| The fill | pressed (empty) | `--fill-active` |
| The fill and the stroke | checked, mixed | `--accent`; `--accent-hover` under the pointer; `--accent-pressed` while pressed |
| The mark | checked, mixed | `--on-accent`, `--gap-3` |
| The box and the mark | disabled | `--text-disabled`, `--fill-disabled` |
| The label | rest | `--text`, `--font-body`, `--leading-ui`, `--gap-6` |
| The label | disabled | `--text-disabled` |
| The ring | focus-visible | `--focus-outline-w`, `--focus-ring`, `--hairline` (the offset) |
| The target | coarse pointer | `--control-h-input` |
| The motion | hover, press, change | `--dur-fast`, `--ease-standard` |

## Related
- `Select`: when the value is one of several rather than yes or no.
- `IconButton`: when the switch is a glyph on a tool bar (`selected`).
- `Toggle`: when the setting takes effect the moment it is pressed, as a glyph in a list row or a word in a bar.
- `Button`: when the control runs an action.
- `Field`: when the value is typed.
