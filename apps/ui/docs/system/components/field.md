# Field

## Description
It takes one line of text and hands every keystroke back to the caller, who owns the value.

`import { Field } from "../../../../src/ui/Field";`, source `src/ui/Field.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/native-control, trap/control-height, trap/field-label, trap/field-input-type, trap/touch-input-zoom, trap/focus-ring-shape, trap/hover-beats-focus, trap/disabled-still-hovers.

### Foundation
Not applicable: hand-rolled — the 24px height, the hairline stroke and the focus border are measured from the running Cursor 3.27.22 (`../../../../../.design-system/research/cursor-recipes-2026-10-28.md` §5), and no registry item ships it.

## Examples
`<Field value={name} ariaLabel="Layer name" onInput={setName} />` — the layer name, owned by the panel.

Real uses, 0 call sites (`rg -c "assistant-input|cmd-input|prop-input" src` → `src/components/AssistantPane.tsx:1`, `src/components/CommandLine.tsx:1`, `src/components/PropertiesPanel.tsx:1`):
- (planned) `src/components/PropertiesPanel.tsx:152` — `class="prop-input"` (1 use) moves onto `<Field>` when the surface migration reaches the properties palette.
- (planned) `src/components/CommandLine.tsx` — `class="cmd-input"` (1 use) moves onto `<Field type="search">` in the command line.
- (planned) `src/components/AssistantPane.tsx` — `class="assistant-input"` (1 use) is a multi-line textarea in the composer and stays bespoke; the single-line `Field` does not replace it (found-not-fixed).

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/field/default.tsx` | default | A text field with a placeholder and a name. |
| `docs/system/examples/field/type-text.tsx` | type=text | The plain text field. |
| `docs/system/examples/field/type-email.tsx` | type=email | The email field, for a phone keyboard and autofill. |
| `docs/system/examples/field/type-search.tsx` | type=search | The search field, for the command line. |
| `docs/system/examples/field/type-password.tsx` | type=password | The password field. |
| `docs/system/examples/field/disabled.tsx` | state:disabled | A locked field at the disabled ink. |
| `docs/system/examples/field/in-properties-panel.tsx` | composition:PropertiesPanel | The name row of the properties palette. |

## Variants

### type
- `text`: the default single-line field. Used at 0 call sites.
- `email`: adds the email keyboard and autofill on phones. Used at 0 call sites.
- `search`: adds the search keyboard and a clear affordance. Used at 0 call sites.
- `password`: masks the value. Used at 0 call sites.

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest | The field is empty or holds a value. | Type, select, paste, Tab away. | The value at the full ink; the placeholder at the faint ink. | test |
| Hover | The pointer is over the field, on a device with a hover pointer. | Click to place the caret. | Nothing beyond the text cursor: the stroke stays at the hairline. | by hand |
| Focused | The field takes focus by click or Tab. | Type; Tab away. | The stroke turns accent and the 1px accent ring draws at offset -1. | by hand |
| Filled | The value is not empty. | Edit it. | The value at the full ink; the placeholder is gone. | test |
| Disabled | The caller passes `disabled`. | Nothing: no typing, no focus. | The value at the disabled ink; no focus ring. | test |

### State precedence
- Focused and Hover: Focused wins. The accent stroke and the ring stay while the pointer is over the field.
- Filled and Focused: both show. The accent stroke and ring draw over the filled value.
- Disabled and Hover: Disabled wins. A disabled field takes no hover and no ring.
- Disabled and Filled: Disabled wins. The value stays visible at the disabled ink.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| Focus arrives or leaves | input | hover / focus feedback (`--dur-fast` + `--ease-out`) | border-color | The stroke changes at once: the shell's `:root[data-animations="off"] *` rule removes the transition. |

## Props
- `value`: the current value; the caller holds it and passes the new one back.
- `onInput`: runs on every keystroke with the new value.
- `placeholder`: the hint; never the only name.
- `ariaLabel`: the accessible name when no visible label is tied to the input.
- `type`: the native input type; defaults to `text`.
- `disabled`: blocks typing and drops the ink to the disabled step.
- `title`: a tooltip.
- `autoFocus`: focuses the field when it mounts.

## Usage

### When to use
- The user types or edits 1 line of text: a name, a coordinate, a keyword.
- The value is owned by a surface above the field, which needs every keystroke.

### When not to use
- The value is picked from a set rather than typed. Use `Chip` instead.
- The control is an action rather than a value. Use `Button` instead.
- The text is a fact to read. Use `Chip` instead.

### Rules
- `rule/field-label-bound`: When a field is rendered without a visible `<label>`, pass `ariaLabel`, because a placeholder disappears as soon as the user types and the field is left nameless. Evidence: app 3/3 single-line inputs are named by their row, `rg -c "assistant-input|cmd-input|prop-input" src`. Check: test `src/ui/Field.test.tsx`.
  - Don't: `<Field placeholder="Layer name" />` alone in a row.
  - Do: `<Field ariaLabel="Layer name" placeholder="Layer name" />`
- `rule/field-type-native`: When a field takes an email, a search term or a password, pass `type` so the native keyboard and autofill follow, because `type="text"` on an email field shows the wrong phone keyboard and blocks autofill. Evidence: app 4/4 types defined in `src/ui/Field.tsx`. Check: test `src/ui/Field.test.tsx`.
  - Don't: `<Field type="text" ariaLabel="Email" />`
  - Do: `<Field type="email" ariaLabel="Email" />`

### Content
- `rule/field-placeholder-example`: When a placeholder is written, show a real example value rather than an instruction (0,0 — not "Enter a point"), because the placeholder is read as the value's shape, and the instruction belongs in a label. Evidence: single use `src/components/PropertiesPanel.tsx:152`, the value-style placeholder. Check: review `src/components/PropertiesPanel.tsx`.
  - Don't: `<Field placeholder="Type your point here" />`
  - Do: `<Field ariaLabel="Base point" placeholder="0,0" />`

### Anti-slop
- `rule/field-canonical-element`: When a surface needs a single-line input, render `Field` rather than a raw `<input>` with its own class, because the replaced classes paint 3 different heights and borders by hand. Evidence: app 9/9 lines across `src/styles.css`, `src/interaction.css` and `src/assistant.css`, `rg -c "assistant-input|cmd-input|prop-input" src`. Check: review `src/ui/Field.tsx`.
  - Don't: `<input class="prop-input" value={x} onInput={...} />`
  - Do: `<Field value={x} onInput={setX} ariaLabel="Name" />`

### Limits
- `rule/field-width-limit`: When a field sits in a form row beside other controls, give it at least 96px or let it fill the row, because the measured palette input is 6px-padded inside a 260px sidebar and a narrower field clips a 4-character value like "0,0". Evidence: measured 6px padding and 260px sidebar, `../../../../../.design-system/research/cursor-recipes-2026-10-28.md` §3. Check: review `src/components/PropertiesPanel.tsx`.
  - Don't: a 40px-wide field in the properties row.
  - Do: a field that fills the row's remaining width.

## Accessibility
Rests on the native `<input>` element: typing, selection, IME and autofill come from the platform.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The input, in document order. | Moves focus in; the accent stroke and ring draw. | On the input. | by hand |
| Tab (disabled) | A disabled input is skipped. | Focus moves past it. | On the next control. | by hand |
| Enter | The focused input. | Nothing on its own: a single-line field only submits inside a `<form>` (none ships yet). | Stays on the input. | by hand |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The input | `textbox` (native) | `aria-label`, or the label tied to it | `disabled` when blocked; the native `type` | "Base point, edit text" | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The box | all | `--control-h-input`, `--radius-control`, `--field-pad-y`, `--field-pad-x`, `--font-body` |
| The fill | all | `--control` |
| The stroke | rest | `--border-soft`, `--hairline` |
| The stroke | focus | `--accent` |
| The text | all | `--text` |
| The placeholder | all | `--text-faint` |
| The text | disabled | `--text-disabled` |
| The ring | focus | `--focus-outline-w`, `--accent`, `--focus-outline-offset` |
| The motion | focus | `--dur-fast`, `--ease-out` |

## Related
- `Chip`: when the text is a fact rather than an editable value.
- `Row`: when the value is picked from a list rather than typed.
- `Button`: when the field's value is submitted.
