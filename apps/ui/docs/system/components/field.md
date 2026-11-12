# Field

## Description
It takes one line of text and hands every keystroke back to the caller, who owns the value.

`import { Field } from "../../../../src/ui/Field";`, source `src/ui/Field.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/native-control, trap/control-height, trap/field-label, trap/field-input-type, trap/touch-input-zoom, trap/focus-ring-shape, trap/hover-beats-focus, trap/disabled-still-hovers.

### Foundation
Not applicable: hand-rolled — the 24px height, the hairline stroke and the focus border are measured from the running Cursor 3.27.22 (`docs/system/decisions.md`), and no registry item ships it.

## Examples
`<Field value={name} ariaLabel="Layer name" onInput={setName} />` — the layer name, owned by the panel.

Real uses, 15 call sites (`rg -c "<Field" src` → `src/components/AssistantPane.tsx:3`, `src/components/CommandLine.tsx:1`, `src/components/CommandPalette.tsx:1`, `src/components/DraftingSettings.tsx:2`, `src/components/DynamicInput.tsx:1`, `src/components/InlineAsk.tsx:1`, `src/components/JewelryDialog.tsx:3`, `src/components/LayerManager.tsx:2`, `src/components/PropertiesPanel.tsx:1`):
- `src/components/JewelryDialog.tsx` — the Ring dialog's size and both dialogs' millimetre and position fields (`align="end"`, `inputMode="decimal"`), each named by its row's `<label for>`, marked `invalid` with the engine's refusal tied by `describedBy`. Added 2026-11-12.
- `src/components/InlineAsk.tsx` — the line over the drawing that asks the assistant (Ctrl+K): `variant="bare"` in the box the surface draws (the palette's box), the assistant's mark as its `start` adornment, the chat's own draft as its value, Enter and Escape on `onKeyDown`. Added 2026-11-12.
- `src/components/DraftingSettings.tsx:178` — the dialog's typed numbers (`align="end"`, `inputMode="decimal"`, `selectOnFocus`), each named by a visible `<label for>` through `id`, marked `invalid` with its refusal tied by `describedBy`.
- `src/components/DraftingSettings.tsx:270` — the dialog's additional angles, a list typed in one field under its label, with a line of help tied by `describedBy`.
- `src/components/AssistantPane.tsx` — the setup sheet's Base URL, API key and Model. The API key carries the show and hide key as its `end` adornment (`<IconButton size="sm">`): until 2026-11-12 a wrapper of the sheet's own placed that key over the field on a patch of the field's fill, and the last characters of a long key, and the caret after them, lay under the patch.
- `src/components/PropertiesPanel.tsx` — the palette's typed values: `variant="inline" size="sm" align="end"`, `mixed` for `*VARIES*`, `invalid` while a value is refused, committing on Enter and on leaving the field.
- `src/components/CommandLine.tsx` — the typed line: `variant="bare"` inside the panel's own strip, which draws the edge and the focus and sets the mono face; the prompt mark is the `start` adornment. The field takes no `value`: the history writes the element's own through `ref`, so nothing is assigned back during an input method's composition. Moved on 2026-11-12 from a hand-drawn `<input class="cmd-input">`.
- `src/components/CommandPalette.tsx` — the search field: `variant="bare"` in the palette's header, `role="combobox"` with `expanded`, `controls`, `activeDescendant` and `autocompleteKind="list"`, `autocapitalize="off"`, the lens as its `start` adornment. Moved on 2026-11-12 from a hand-drawn `<input class="palette-input">`.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/field/default.tsx` | default | A text field with a placeholder and a name. |
| `docs/system/examples/field/type-text.tsx` | type=text | The plain text field. |
| `docs/system/examples/field/type-email.tsx` | type=email | The email field, for a phone keyboard and autofill. |
| `docs/system/examples/field/type-search.tsx` | type=search | The search field, for the command line. |
| `docs/system/examples/field/type-password.tsx` | type=password | The password field. |
| `docs/system/examples/field/disabled.tsx` | state:disabled | A locked field at the disabled ink. |
| `docs/system/examples/field/invalid.tsx` | state:invalid | A refused address at the error stroke, with the line that says why. |
| `docs/system/examples/field/variant-field.tsx` | variant=field | The form control, stroked and filled at rest. |
| `docs/system/examples/field/variant-inline.tsx` | variant=inline | A value that reads as text until it is touched. |
| `docs/system/examples/field/variant-bare.tsx` | variant=bare | The one line inside a box its surface draws. |
| `docs/system/examples/field/adornment-end.tsx` | state:adorned | A key field with its show and hide key inside the end. |
| `docs/system/examples/field/adornment-start.tsx` | state:adorned | A search field with its lens inside the start. |
| `docs/system/examples/field/matrix-type-variant.tsx` | matrix:type,variant | Every input type in each of the three looks. |
| `docs/system/examples/field/size-md.tsx` | size=md | The 24px box of a form. |
| `docs/system/examples/field/size-sm.tsx` | size=sm | The 20px box of a 22px list row. |
| `docs/system/examples/field/align-start.tsx` | align=start | A value on the near side, as a form reads. |
| `docs/system/examples/field/align-end.tsx` | align=end | A column of numbers ending on one edge. |
| `docs/system/examples/field/mixed.tsx` | state:mixed | A value several objects disagree on, in the quiet ink. |
| `docs/system/examples/field/read-only.tsx` | state:read-only | A value to select and copy, not to change. |
| `docs/system/examples/field/combobox.tsx` | composition:CommandPalette | A bare search field driving a list of options, its lens in the start. |
| `docs/system/examples/field/in-command-line.tsx` | composition:CommandLine | The typed line: a bare field in a strip, the prompt mark in the start. |
| `docs/system/examples/field/in-properties-panel.tsx` | composition:PropertiesPanel | A value row of the properties palette: commits on Enter and on leaving, Escape restores. |

## Variants

### type
- `text`: the default single-line field. Used at 7 call sites, and at the eighth while the API key is shown.
- `email`: adds the email keyboard and autofill on phones. Used at 0 call sites.
- `search`: adds the search keyboard and a clear affordance. Used at 0 call sites.
- `password`: masks the value. Used at 1 call site (the setup sheet's API key, until its show key is pressed).

### variant
- `field`: the default; the form control, stroked and filled at rest. The stroke is an ink of the field's own (`--ui-field-edge`): the hairline stroke (`--border-soft`) on the dark surfaces, where it measures 1.34 against the pane and 1.24 against the field's fill, and the default stroke (`--border`) on the light ones, 1.39 and 1.28. With the hairline stroke the light field measured 1.27 and 1.18 and read as a grey slab with no edge (`#F3F3F3` on `#FCFCFC`). The theme sets the ink, never `border-color`, so the inline, focused and refused strokes still win; `Select` reads the same ink. Used at 3 call sites (the provider form).
- `inline`: a value in a dense list row; no stroke and no fill until the pointer or the keyboard is on it, as `Select variant="inline"`. Used at 1 call site (the properties palette's value rows).
- `bare`: the one line inside a box a surface draws itself; no stroke, no fill, no inset and no ring, in the surface's own face and size, as `TextArea variant="bare"`. The surface shows the focus. It keeps the control's 24px height and the layer's 16px line, so the value is centred wherever the surface puts it. Used at 2 call sites (the command line's strip, the command palette's header).

### size
- `md`: the default 24px box. Used at 7 call sites.
- `sm`: the 20px box that fits a 22px list row, on the row's 4px inset; 24px under a coarse pointer, as `Select size="sm"`. Used at 1 call site (the properties palette).

### align
- `start`: the default; the value starts on the near side. Used at 6 call sites.
- `end`: the value ends on the far side, with lining tabular figures, for a column of values. Used at 2 call sites (the properties palette, the dialog's typed numbers).

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest | The field is empty or holds a value. | Type, select, paste, Tab away. | The value at the full ink; the placeholder at the faint ink. | test |
| Hover | The pointer is over the field, on a device with a hover pointer. | Click to place the caret. | Nothing beyond the text cursor: the stroke stays at the hairline. | by hand |
| Focused | The field takes focus by click or Tab. | Type; Tab away. | The stroke takes the focus ink and the 1px ring draws in it at offset -1. | by hand |
| Filled | The value is not empty. | Edit it. | The value at the full ink; the placeholder is gone. | test |
| Invalid | The caller passes `invalid`: it refuses the value. | Correct the value; the caller clears `invalid` when it accepts it. | `aria-invalid="true"`, and the caller's error line, tied to the input by `describedBy`; the stroke takes the error ink. | test |
| Disabled | The caller passes `disabled`. | Nothing: no typing, no focus. | The value at the disabled ink; no focus ring. | test |
| Mixed | The caller passes `mixed`: the field stands for several things whose values differ. | Type a value, which replaces them all. | The stand-in the caller passes as the value ("*VARIES*") in the quiet ink. | test |
| Read-only | The caller passes `readOnly`. | Focus it, select and copy; no typing. | The value at the full ink with no caret; it stays a Tab stop. | test |
| Adorned | The caller passes `start` or `end`. | Type as in any field; press a control in the adornment, or Tab to it after the input. A press on a glyph lands on the input. | The adornment inside the box's end, and the value ending before it: the input's padding on that side is the adornment's measured width. | test |

### State precedence
- Focused and Hover: Focused wins. The accent stroke and the ring stay while the pointer is over the field.
- Filled and Focused: both show. The accent stroke and ring draw over the filled value.
- Disabled and Hover: Disabled wins. A disabled field takes no hover and no ring.
- Disabled and Filled: Disabled wins. The value stays visible at the disabled ink.
- Invalid and Focused: both show. The stroke keeps the error ink and the ring draws in the focus ink one line inside it.
- Invalid and Filled: both show. The refused value stays at the full ink inside the error stroke.
- Invalid and Hover: Invalid wins. The stroke keeps the error ink under the pointer.
- Mixed and Focused: both show. The stand-in stays quiet until the first keystroke, when the caller clears `mixed`.
- Mixed and Invalid: Invalid wins. A typed value the caller refuses is no longer the stand-in, so the caller clears `mixed` with the first keystroke.
- Read-only and Focused: both show. The ring draws; the value does not change.
- Read-only and Disabled: Disabled wins. A disabled field takes no focus at all.
- Invalid and Disabled: Disabled wins. A disabled field cannot be corrected, so the caller clears `invalid` before it locks the field.
- Adorned and Focused: both show. The stroke and the ring are the input's, and the input is the whole box, so they go around the adornment; a control in the adornment draws its own ring while it has the focus, and the box draws none then.
- Adorned and Invalid: both show. The error stroke goes around the adornment.
- Adorned and Disabled: Disabled wins for a glyph, which takes the disabled ink. A control in the adornment is the caller's to disable.
- Adorned and Filled: both show. A value longer than the room between the adornments ends in an ellipsis at rest and scrolls under the caret while edited; it never runs under an adornment.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| Focus arrives or leaves; the pointer enters or leaves an `inline` field | input | hover / focus feedback (`--dur-fast` + `--ease-standard`) | border-color, background-color | The stroke changes at once: the shell's `:root[data-animations="off"] *` rule removes the transition. |

## Props
- `value`: the current value; the caller holds it and passes the new one back.
- `onInput`: runs on every keystroke with the new value.
- `placeholder`: the hint; never the only name.
- `ariaLabel`: the accessible name when no visible label is tied to the input.
- `id`: the input's `id`, for a visible `<label for>` beside it; the label is then the name and no `ariaLabel` is passed.
- `type`: the native input type; defaults to `text`.
- `disabled`: blocks typing and drops the ink to the disabled step.
- `title`: the hint (a value the box cuts short shows in full above it, whether or not there is a `title`, except a password's), shown in the layer's hint box (after 0.4s under a mouse or a pen, at once when a key moves focus in, away at the first keystroke) and added to the field's accessible description after `describedBy`. It is never the name (pass `ariaLabel`), and no native `title` attribute is rendered. Used at 0 call sites; a line of help under the field, tied by `describedBy`, is the usual pick because it stays on the page.
- `autoFocus`: focuses the field when it mounts.
- `autocomplete`: the native autofill hint; `off` for a value no form should remember, or a token the platform knows (`email`, `url`, `current-password`). Unset leaves it to the platform.
- `spellcheck`: switches the platform's spelling checker. Unset leaves it to the platform, except `type="password"`, which is never checked.
- `invalid`: the value is refused; sets `aria-invalid="true"` and the error stroke.
- `describedBy`: the `id` of the help line or the error line under the field (several, space-separated); sets `aria-describedby`.
- `variant`: `field`, `inline` or `bare`; defaults to `field`.
- `size`: `sm` or `md`; defaults to `md`.
- `align`: `start` or `end`; defaults to `start`.
- `mixed`: the value is a stand-in for several that differ; it reads in the quiet ink.
- `readOnly`: the value can be selected and copied, not changed; the field stays a Tab stop.
- `maxLength`: the most characters the field takes.
- `inputMode`: the keyboard a phone shows where `type` does not say: `decimal`, `numeric`, `tel`, `search`, `email`, `url`, `text` or `none`.
- `selectOnFocus`: selects the whole value when focus arrives, by key or by click, so typing replaces it; the second click places the caret.
- `onKeyDown`: a key went down, outside an input method's composition; the caller may `preventDefault` it.
- `onFocus`: focus arrived.
- `onBlur`: focus left.
- `ref`: hands the `<input>` to the caller.
- `role`: `combobox`, on a field that drives a list of matches and keeps the keyboard.
- `expanded`: a combobox's list is showing (`aria-expanded`).
- `controls`: the `id` of a combobox's list (`aria-controls`).
- `activeDescendant`: the `id` of the option the arrow keys are on (`aria-activedescendant`); unset when none is.
- `autocompleteKind`: what the list does with the typed text (`aria-autocomplete`): `list`, `inline`, `both` or `none`.
- `autocapitalize`: the native attribute, passed through; `off` for a command, a code or a name a phone's keyboard must not capitalise. Unset leaves it to the platform. Used at 1 call site (the command palette).
- `start`: an adornment inside the field's leading end, before the input in the box: a glyph that says what the value is. Used at 2 call sites (the command line's prompt mark, the palette's lens).
- `end`: an adornment inside the field's trailing end, after the input in the box and in the Tab order: a glyph, or one `<IconButton size="sm">` that acts on the value. Used at 1 call site (the API key's show and hide key).

## Usage

### When to use
- The user types or edits 1 line of text: a name, a coordinate, a keyword.
- The value is owned by a surface above the field, which needs every keystroke.

### When not to use
- The value is picked from a set rather than typed. Use `Select` instead.
- The text runs to more than 1 line. Use `TextArea` instead.
- The control is an action rather than a value. Use `Button` instead.
- The text is a fact to read. Use `Chip` instead.

### Rules
- `rule/field-label-bound`: When a field is rendered without a visible `<label>`, pass `ariaLabel`, because a placeholder disappears as soon as the user types and the field is left nameless. Evidence: app 3/3 single-line inputs are named by their row, `rg -c "assistant-input|cmd-input|prop-input" src`. Check: test `src/ui/Field.test.tsx`.
  - Don't: `<Field placeholder="Layer name" />` alone in a row.
  - Do: `<Field ariaLabel="Layer name" placeholder="Layer name" />`
- `rule/field-type-native`: When a field takes an email, a search term or a password, pass `type` so the native keyboard and autofill follow, because `type="text"` on an email field shows the wrong phone keyboard and blocks autofill. Evidence: app 4/4 types defined in `src/ui/Field.tsx`. Check: test `src/ui/Field.test.tsx`.
  - Don't: `<Field type="text" ariaLabel="Email" />`
  - Do: `<Field type="email" ariaLabel="Email" />`

- `rule/field-described-by`: When a line of help or an error sits under a field, give the line an `id` and pass it as `describedBy`, and pass `invalid` while the value is refused, because a line that only sits near the input is read 0 times by a screen reader that lands on the input by Tab. Evidence: single use `src/components/AssistantPane.tsx:866`, the API key's "Stored in this browser" line, untied today. Check: test `src/ui/Field.test.tsx`.
  - Don't: `<Field ariaLabel="API key" /><span class="hint">Stored in this browser, not encrypted.</span>`
  - Do: `<Field ariaLabel="API key" describedBy="key-help" /><span id="key-help">Stored in this browser, not encrypted.</span>`
- `rule/field-secret-not-remembered`: When a field holds a key, a token or a password, pass `autocomplete="off"` and `spellcheck={false}` for every `type` it takes, because a secret shown with `type="text"` is 1 ordinary text value to the platform, which offers it to autofill and sends it to the spelling checker. Evidence: single use `src/components/AssistantPane.tsx:775`, the API key field, which sets `autocomplete` from outside through a wrapper `ref`. Check: test `src/ui/Field.test.tsx`.
  - Don't: `<Field type={shown() ? "text" : "password"} ariaLabel="API key" />`
  - Do: `<Field type={shown() ? "text" : "password"} ariaLabel="API key" autocomplete="off" spellcheck={false} />`
- `rule/field-inline-in-row`: When a typed value sits in a dense list row beside its label, pass `variant="inline" size="sm"`, and `align="end"` when the rows form a column of values, because a stroked 24px field in each of 8 rows of 22px draws 8 boxes where the row should read as text, and pushes every row 2px taller. Evidence: measured 20px box at 1px from the top of a 22px row, the same box the palette's hand-drawn input measured, in the browser 2026-11-11, `docs/system/decisions.md`. Check: test `src/ui/Field.test.tsx`.
  - Don't: `<Field value={radius} ariaLabel="Radius" />` in a 22px property row.
  - Do: `<Field variant="inline" size="sm" align="end" value={radius} ariaLabel="Radius" />`
- `rule/field-commit-in-caller`: When a value is applied on Enter and on leaving the field rather than on every keystroke, keep the draft in the caller and commit from `onKeyDown` and `onBlur`, and restore the old value on Escape, because the field reports 1 event per keystroke and a value applied on each would move the drawing while "12.5" is still "1". Evidence: measured 2 `onInput` calls for the 2 keystrokes of "12", `src/ui/Field.test.tsx`. Check: test `src/ui/Field.test.tsx`.
  - Don't: `<Field value={radius} onInput={(value) => setRadius(Number(value))} />`
  - Do: `<Field value={draft} onInput={setDraft} onKeyDown={(e) => e.key === "Enter" && commit()} onBlur={commit} />`
- `rule/field-combobox-complete`: When a field drives a list of matches, pass `role="combobox"` with `expanded`, `controls` and `activeDescendant` together, and none of them on any other field, because a combobox with 0 of the three is announced as one and then leads nowhere, and `aria-activedescendant` on a plain text field is ignored. Evidence: app 5/5 combobox props defined together in `src/ui/Field.tsx`. Check: test `src/ui/Field.test.tsx`.
  - Don't: `<Field ariaLabel="Search commands" role="combobox" />`
  - Do: `<Field ariaLabel="Search commands" role="combobox" expanded={open} controls="palette-list" activeDescendant={activeId} autocompleteKind="list" />`
- `rule/field-adornment-slot`: When a glyph or a key belongs inside a field's end, pass it as `start` or `end`, so the field holds it, because the input makes room only for an adornment it holds: placed over the field from a wrapper, the show key covered the last 3 characters of a 203-character key and the caret after them. Evidence: measured 24px of end padding on the adopted key field against 6px under the wrapper's patch, the eye at the same 1237, 240 before and after, in the browser 2026-11-12 (the captures wE14-setup-longkey-before and wE14-setup-longkey-after), `docs/system/decisions.md`. Check: test `src/ui/Field.test.tsx`.
  - Don't: `<div class="key-box"><Field ariaLabel="API key" /><span class="key-end"><IconButton icon="eye" size="sm" title="Show the key" /></span></div>`
  - Do: `<Field ariaLabel="API key" end={<IconButton icon="eye" size="sm" title="Show the key" onClick={toggle} />} />`
- `rule/field-adornment-one-control`: When an adornment acts on the value, make it 1 `IconButton size="sm"` with a name of its own, and keep a glyph that only decorates hidden from assistive tech, because the box is a `<span>` with no role: a screen reader meets the text field and then whatever stands in the slot, and 2 controls in a 24px end leave no room for the value. Evidence: single use `src/components/AssistantPane.tsx:1070`, the API key's show and hide key, named "Show the key" and "Hide the key". Check: test `src/ui/Field.test.tsx`.
  - Don't: `<Field ariaLabel="API key" end={<span onClick={toggle}>show</span>} />`
  - Do: `<Field ariaLabel="API key" end={<IconButton icon="eye" size="sm" title="Show the key" onClick={toggle} />} />`
- `rule/field-bare-surface-focus`: When a field is `bare`, draw the focus on the surface around it and give that surface the edge and the fill, because the bare field draws 0 rings and 0 strokes: with nothing around it a keyboard user cannot see where the caret is. Evidence: app 2/2 bare fields sit in a surface that shows the focus (the command line's strip takes the ring through `is-focused`, and the palette's field never loses the focus while its dialog is open), `src/styles.css`, `src/palette.css`. Check: review `src/styles.css`.
  - Don't: `<Field variant="bare" ariaLabel="Command line" />` alone on a pane.
  - Do: `<div class="cmd-field" classList={{ "is-focused": focused() }}><Field variant="bare" ariaLabel="Command line" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} /></div>`

### Content
- `rule/field-placeholder-example`: When a placeholder is written, show a real example value rather than an instruction (0,0 — not "Enter a point"), because the placeholder is read as the value's shape, and the instruction belongs in a label. Evidence: single use `src/components/AssistantPane.tsx:735`, the provider popover's Base URL placeholder. Check: review `src/components/AssistantPane.tsx`.
  - Don't: `<Field placeholder="Type your point here" />`
  - Do: `<Field ariaLabel="Base point" placeholder="0,0" />`

### Anti-slop
- `rule/field-canonical-element`: When a surface needs a single-line input, render `Field` rather than a raw `<input>` with its own class, because the replaced classes paint 3 different heights and borders by hand. Evidence: app 9/9 lines across `src/styles.css`, `src/interaction.css` and `src/assistant.css`, `rg -c "assistant-input|cmd-input|prop-input" src`. Check: review `src/ui/Field.tsx`.
  - Don't: `<input class="prop-input" value={x} onInput={...} />`
  - Do: `<Field value={x} onInput={setX} ariaLabel="Name" />`

### Limits
- `rule/field-width-limit`: When a field sits in a form row beside other controls, give it at least 96px or let it fill the row, because the measured palette input is 6px-padded inside a 260px sidebar and a narrower field clips a 4-character value like "0,0". Evidence: measured 6px padding and 260px sidebar, `docs/system/decisions.md`. Check: review `src/components/PropertiesPanel.tsx`.
  - Don't: a 40px-wide field in the properties row.
  - Do: a field that fills the row's remaining width.

## Accessibility
Rests on the native `<input>` element: typing, selection, IME and autofill come from the platform.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The input, in document order. | Moves focus in; the accent stroke and ring draw. | On the input. | by hand |
| Tab (disabled) | A disabled input is skipped. | Focus moves past it. | On the next control. | by hand |
| Enter | The focused input. | Nothing on its own: a single-line field only submits inside a `<form>` (none ships yet). The caller's `onKeyDown` hears it and may commit. | Stays on the input. | test |
| Escape | The focused input. | Nothing on its own; the caller's `onKeyDown` hears it and may restore the old value. | Stays on the input. | test |
| Tab or a click, with `selectOnFocus` | Arriving on the input. | The whole value is selected, so typing replaces it. A second click places the caret. | On the input. | test |
| Any key during an input method's composition | The focused input. | The input method's own; `onKeyDown` is not called. | Stays on the input. | test |
| ArrowDown, ArrowUp, Enter (combobox) | The focused input. | The caller's `onKeyDown` moves `activeDescendant` through the list or runs the active option; the field moves no focus. | Stays on the input. | by hand |
| Tab (an `end` control) | The focused input. | Moves focus to the control in the end adornment, which draws its own ring. | On the adornment's control. | by hand |
| Enter or Space (an `end` control) | The adornment's control. | Runs the control's action (show or hide the key); the input keeps its value. | Stays on the adornment's control. | test |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The input | `textbox` (native) | `aria-label`, or the label tied to it | `disabled` when blocked; the native `type`; `aria-invalid="true"` while the value is refused; `aria-describedby` naming the help line or the error line, then the `title`'s words when it has one | "Base point, edit text" / "Base URL, invalid entry, edit text, Start the address with http:// or https://" | test |
| The input as a combobox | `combobox` (`role`) | `aria-label` | `aria-expanded`, `aria-controls` naming the list, `aria-activedescendant` naming the active option, `aria-autocomplete` | "Search commands, combo box, expanded" then each option as the keys reach it | test |
| The box around an adorned field | none (a `<span>`) | none | none: no role, no name, no `tabindex`, not hidden | Nothing: the input and the adornment are met as they are | test |
| A control in an adornment | `button` (the caller's `IconButton`) | Its own `title` | Its own | "Show the key, button" after the field | test |
| A glyph in an adornment | none | none | `aria-hidden="true"`, from `ToolIcon` or the caller | Nothing | by hand |

## Tokens
| Part | State | Token |
|---|---|---|
| The box | all | `--control-h-input`, `--radius-control`, `--field-pad-y`, `--field-pad-x`, `--font-body`, `--leading-ui` |
| The fill | all | `--control` |
| The stroke | rest | `--border-soft` (dark), `--border` (light), `--hairline` |
| The stroke | focus | `--focus-ring` |
| The stroke | invalid | `--error` |
| The text | all | `--text` |
| The placeholder | all | `--text-faint` |
| The text | disabled | `--text-disabled` |
| The ring | focus | `--focus-outline-w`, `--focus-ring`, `--focus-outline-offset` (twice the offset while invalid, so the ring clears the error stroke) |
| The motion | focus | `--dur-fast`, `--ease-standard` |
| The box | `sm` | `--control-h-chip`, `--gap-4`, `--hairline` |
| The box | `sm`, coarse pointer | `--control-h-input` |
| The stroke and the fill | `inline`, rest | none: both transparent |
| The stroke and the fill | `inline`, hover or focus | `--border-soft`, `--control` |
| The text | mixed | `--text-faint` |
| The stroke, the fill, the inset and the ring | `bare` | none: the surface draws them |
| The type | `bare` | inherited from the surface |
| An adornment's cell | `field` and `inline` | `--control-h-chip` wide, `--control-h-input` less `--control-h-chip`, halved, from the box's edge (none of it at `sm`) |
| The gap from an adornment to the value | `field` and `inline` | `--gap-2` |
| An adornment's cell | `bare` | none: the adornment's own width, on the edge |
| A glyph in an adornment | rest | `--icon`, `--icon-size-md` (`--icon-size-sm` at `sm`) |
| A glyph in an adornment | disabled | `--text-disabled` |

## Related
- `TextArea`: when the text runs to several lines.
- `Select`: when the value is picked from a list rather than typed.
- `Chip`: when the text is a fact rather than an editable value.
- `Row`: when the value is picked from a list rather than typed.
- `Button`: when the field's value is submitted.
- `Tooltip`: the hint box a field's `title` shows in; never wrap a field in one.
- `Dialog`: the surface that holds a form of several fields with its actions.
