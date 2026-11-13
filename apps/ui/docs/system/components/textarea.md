# TextArea

## Description
It takes several lines of text, grows to hold them up to a limit, and hands every edit back to the caller, who owns the text.

`import { TextArea } from "../../../../src/ui/TextArea";`, source `src/ui/TextArea.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/native-control, trap/control-height, trap/field-label, trap/label-unbound, trap/field-input-type, trap/field-affix-focus (n/a: no affix part), trap/field-form-enter, trap/field-error-link, trap/field-error-timing, trap/field-keeps-input, trap/touch-input-zoom, trap/touch-autofocus, trap/focus-ring-shape, trap/hover-beats-focus, trap/disabled-still-hovers, trap/overflow-scrollbar.

### Foundation
Not applicable: hand-rolled — a native `<textarea>` in Field's measured recipe (the hairline stroke, the focus edge, 13px type; `docs/system/decisions.md`), and no registry item ships it.

## Examples
`<TextArea value={notes()} onInput={setNotes} ariaLabel="Notes" />` — a notes field: two lines tall when empty, growing to eight.

Real uses, 2 call sites (`rg -c "<TextArea" src/components` → `src/components/AssistantPane.tsx:1`, `src/components/SourcePanel.tsx:1`):
- `src/components/SourcePanel.tsx` — the Source panel's editor: `variant="bare"` in the panel's body, `rows` and `maxRows` both the rows the body holds, so the script scrolls inside it beside a gutter of line numbers; Ctrl+Enter applies. Added 2026-11-12.
- `src/components/AssistantPane.tsx:1247` — the composer's editor: `variant="bare"` inside the card, two rows growing to nine, the combobox of the slash list while that list shows.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/textarea/default.tsx` | default | A notes field, two lines tall when empty. |
| `docs/system/examples/textarea/variant-field.tsx` | variant=field | The form control: stroked and filled. |
| `docs/system/examples/textarea/variant-bare.tsx` | variant=bare | The editor inside a card that draws the box and the focus. |
| `docs/system/examples/textarea/disabled.tsx` | state:disabled | Locked text at the disabled ink. |
| `docs/system/examples/textarea/invalid.tsx` | state:invalid | Refused text at the error stroke, with the line that says why. |
| `docs/system/examples/textarea/in-assistant-pane.tsx` | composition:AssistantPane | The composer's editor, sending on Enter. |

## Variants

### variant
- `field`: the form control, with Field's stroke, fill, padding and type; one line is exactly a Field's 24px. Its stroke is the field's own edge ink (`--ui-field-edge`): the hairline stroke on the dark surfaces and the default stroke on the light ones, where the hairline measured 1.18 against the fill; until 2026-11-12 it drew the hairline stroke in both themes. The default. Used at 0 call sites.
- `bare`: no stroke, no fill, no padding and no ring, with the type of the element around it; for an editor inside a card that draws those itself. Used at 0 call sites (the assistant's composer is planned).

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest | The control is empty or holds text. | Type, select, paste, Tab away. | The text at the full ink, or the placeholder at the faint ink; the box is `rows` lines tall or as tall as its text. | test |
| Hover | The pointer is over the control, on a device with a hover pointer. | Click to place the caret. | Nothing beyond the text cursor. | by hand |
| Focused | The control takes focus by click or Tab. | Type; Tab away. | `field`: the stroke takes the focus ink and the 1px ring draws at offset -1. `bare`: the caret alone; the card around it shows the focus. | by hand |
| Growing | The text needs more lines than are showing, up to `maxRows`. | Keep typing; nothing scrolls. | The box is taller by whole lines; what is below it moves down. | test |
| Scrolling | The text needs more than `maxRows` lines. | Scroll inside the control; the caret stays in view. | The box stops at `maxRows` lines and the platform's scrollbar shows. | test |
| Invalid | The caller passes `invalid`. | Correct the text; the caller clears `invalid` when it accepts it. | `aria-invalid="true"`, and the caller's line tied by `describedBy`; on `field` the stroke takes the error ink. | test |
| Disabled | The caller passes `disabled`. | Nothing: no typing, no focus. | The text at the disabled ink. | test |
| Composing | An input method is composing a character. | Finish or cancel the composition. | The platform's own composition underline; `onKeyDown` hears no key until it ends. | test |

### State precedence
- Focused and Hover: Focused wins. The focus stroke and the ring stay under the pointer.
- Growing and Scrolling: Not applicable: the text fits within `maxRows` lines or it does not.
- Growing and Focused: both show. The box grows under the caret with the focus stroke drawn.
- Scrolling and Focused: both show. The capped box keeps its focus stroke while its text scrolls.
- Invalid and Focused: both show. On `field` the stroke keeps the error ink and the ring draws one line inside it.
- Invalid and Hover: Invalid wins. The error stroke stays under the pointer.
- Invalid and Growing: both show. Text past a caller's limit keeps growing the box inside the error stroke; nothing is cut.
- Invalid and Disabled: Disabled wins. The caller clears `invalid` before it locks text nobody can correct.
- Disabled and Hover: Disabled wins. A disabled control takes no caret and no ring.
- Disabled and Scrolling: both show. Locked text past the cap can still be scrolled and read.
- Composing and Focused: both show. The focus stroke stays while the input method holds the keys.
- Composing and Growing: both show. The box grows as composed text is committed.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| Focus arrives or leaves (`field`) | input | hover / focus feedback (`--dur-fast` + `--ease-standard`) | border-color | The stroke changes at once: the shell's `:root[data-animations="off"] *` rule removes the transition. |
| The text gains or loses a line | input | none: the height is set at once, so the caret never waits for the box | height (not animated) | The same in every setting. |

## Props
- `value`: the current text; the caller holds it. It is written to the element only when it differs from what is typed, so a composition is never restarted.
- `onInput`: runs on every edit with the new text.
- `placeholder`: an example of the text; never the only name.
- `ariaLabel`: the accessible name when no visible label is tied to the control.
- `variant`: `field` (the default) or `bare`.
- `rows`: the fewest lines shown; defaults to 2.
- `maxRows`: the most lines it grows to before it scrolls; defaults to 8.
- `disabled`: the native attribute; blocks typing and drops the ink.
- `invalid`: the text is refused; sets `aria-invalid="true"` and, on `field`, the error stroke.
- `id`: the control's `id`, for a visible `<label for>` beside it or around it; the label is then the name and no `ariaLabel` is passed. Used at 0 call sites: the composer's card is a `<label for>` and still writes the `id` on the element through `ref`, which this prop replaces.
- `describedBy`: the `id` of the help line or the error line (several, space-separated); sets `aria-describedby`.
- `title`: the hint, in the layer's hint box and in the accessible description after `describedBy`. Never the name, and no native `title` is rendered.
- `autoFocus`: focuses the control when it mounts.
- `autocomplete`: the native autofill hint; unset leaves it to the platform.
- `spellcheck`: switches the platform's spelling checker; unset leaves it to the platform.
- `onKeyDown`: a key went down outside an input method's composition; the caller may `preventDefault` it.
- `onPaste`: something was pasted; the caller may take what is not text.
- `ref`: hands the element to the caller, to focus it or to place the caret.
- `role`: `combobox`, while the text drives a list of matches and keeps the keyboard (the composer's slash list).
- `expanded`: a combobox's list is showing (`aria-expanded`).
- `controls`: the `id` of a combobox's list (`aria-controls`).
- `activeDescendant`: the `id` of the option the arrow keys are on (`aria-activedescendant`); unset when none is.
- `autocompleteKind`: what the list does with the typed text (`aria-autocomplete`): `list`, `inline`, `both` or `none`.

## Usage

### When to use
- The user writes more than 1 line: a message to the assistant, a note on a layer, a block of script.
- The text's length is not known ahead, and the control should take the room the text needs before it scrolls.

### When not to use
- The text is 1 line: a name, a coordinate, a keyword. Use `Field` instead.
- The value is picked from a list. Use `Select` instead.
- The text is a fact to read rather than to edit. Use `Chip` instead.

### Rules
- `rule/textarea-label-bound`: When a text area is rendered without a visible `<label>`, pass `ariaLabel`, because a placeholder disappears at the first character and leaves 1 unnamed text box. Evidence: single use `src/components/AssistantPane.tsx:1227`, the composer's editor, named "Ask the assistant" with a placeholder beside it. Check: test `src/ui/TextArea.test.tsx`.
  - Don't: `<TextArea placeholder="Ask, or / for commands" value={draft()} onInput={setDraft} />`
  - Do: `<TextArea ariaLabel="Ask the assistant" placeholder="Ask, or / for commands" value={draft()} onInput={setDraft} />`
- `rule/textarea-rows-not-height`: When a text area needs a smallest or a largest size, pass `rows` and `maxRows` rather than a `height`, `min-height` or `max-height` in a stylesheet, because the component sets the height itself from the measured text on every edit and a second height fights it by 1 line or more. Evidence: single use `src/ui/TextArea.tsx:115`, the one place the height is set. Check: test `src/ui/TextArea.test.tsx`.
  - Don't: `.my-notes .ui-textarea { min-height: 64px; max-height: 240px }`
  - Do: `<TextArea rows={2} maxRows={9} ariaLabel="Notes" value={notes()} onInput={setNotes} />`
- `rule/textarea-enter-in-keydown`: When Enter sends the text, handle it in `onKeyDown` and call `preventDefault`, leaving Shift+Enter to break the line, because `onKeyDown` hears 0 keys while an input method is composing and a handler on a wrapper would send a half-composed word. Evidence: single use `src/ui/TextArea.tsx:194`, the composition guard. Check: test `src/ui/TextArea.test.tsx`.
  - Don't: `<div onKeyDown={(e) => e.key === "Enter" && send()}><TextArea ariaLabel="Ask" value={draft()} onInput={setDraft} /></div>`
  - Do: `<TextArea ariaLabel="Ask" value={draft()} onInput={setDraft} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />`
- `rule/textarea-bare-card-focus`: When `variant="bare"` is used, give the card around it the focus cue with `:focus-within`, because the bare editor draws 0 rings of its own and a keyboard user would otherwise see no focus at all. Evidence: single use `src/ui/ui.css:1094`, the bare recipe, which drops the ring. Check: review `src/assistant.css`.
  - Don't: `<div class="card"><TextArea variant="bare" ariaLabel="Ask" /></div>` with no `.card:focus-within` rule.
  - Do: `.card:focus-within { border-color: var(--composer-border-active) }` around `<TextArea variant="bare" ariaLabel="Ask" />`
- `rule/textarea-described-by`: When a line of help, a count or an error sits beside a text area, give the line an `id` and pass it as `describedBy`, and pass `invalid` while the text is refused, because a line that only sits near the control is read 0 times by a screen reader that lands on it by Tab. Evidence: single use `src/ui/TextArea.tsx:169`, the tie `Field` makes the same way (`rule/field-described-by`). Check: test `src/ui/TextArea.test.tsx`.
  - Don't: `<TextArea ariaLabel="Ask" invalid /><div>120 characters too long to send</div>`
  - Do: `<TextArea ariaLabel="Ask" invalid describedBy="ask-over" /><div id="ask-over">120 characters too long to send</div>`

- `rule/textarea-combobox-while-listed`: When a text area drives a list of matches for part of what is typed, pass `role="combobox"` with `expanded`, `controls` and `activeDescendant` only while the list shows, and drop all 4 when it goes, because a multi-line text box that always says it is a combobox is announced as 1 on every focus, and its arrow keys are then expected to walk a list that is not there. Evidence: app 5/5 combobox props defined together in `src/ui/TextArea.tsx`. Check: test `src/ui/TextArea.test.tsx`.
  - Don't: `<TextArea ariaLabel="Ask the assistant" role="combobox" expanded={false} value={draft()} onInput={setDraft} />` on a composer with no list open.
  - Do: `<TextArea ariaLabel="Ask the assistant" role={listed() ? "combobox" : undefined} expanded={listed() ? true : undefined} controls={listed() ? "slash-list" : undefined} activeDescendant={listed() ? activeId() : undefined} value={draft()} onInput={setDraft} />`

### Content
- `rule/textarea-placeholder-example`: When a placeholder is written, show in 2 to 6 words what goes here or what the control takes (Ask, or / for commands) and put a rule the user must keep in mind in a line tied by `describedBy`, because the placeholder is gone at the first character. Evidence: single use `src/components/AssistantPane.tsx:1097`, the composer's two placeholders. Check: review `src/components/AssistantPane.tsx`.
  - Don't: `<TextArea ariaLabel="Ask" placeholder="Messages must be under 8,000 characters and may not be empty" />`
  - Do: `<TextArea ariaLabel="Ask the assistant" placeholder="Ask, or / for commands" />`

### Anti-slop
- `rule/textarea-canonical-element`: When a surface needs multi-line text, render `TextArea` rather than a raw `<textarea>` with its own class and its own grow function, because the hand-built one fixes its limits in pixels (64 and 240) where the type size they were counted from can change, and every copy re-solves composition and growth. Evidence: single use `src/components/AssistantPane.tsx:157`, the composer's own `grow`. Check: review `src/ui/TextArea.tsx`.
  - Don't: `<textarea class="assistant-input" rows={1} onInput={(e) => grow(e.currentTarget)} />`
  - Do: `<TextArea variant="bare" rows={2} maxRows={9} ariaLabel="Ask the assistant" value={draft()} onInput={setDraft} />`

### Limits
- `rule/textarea-max-rows`: When text may run past 8 lines, leave `maxRows` at 8 or set it to the lines the surface can spare (9 in the composer), because past the cap the box stops and scrolls, and a cap the surface cannot hold pushes the send key off the screen. Evidence: measured 72px box, 230px `scrollHeight`, `overflow-y: auto`, in the browser at 1280 wide, 2026-11-11. Check: test `src/ui/TextArea.test.tsx`.
  - Don't: `<TextArea maxRows={200} ariaLabel="Ask" />` above a send key.
  - Do: `<TextArea maxRows={9} ariaLabel="Ask the assistant" />`
- `rule/textarea-one-row-field`: When a text area sits on a row with a `Field`, pass `rows={1}`, because 1 line of the `field` variant measures the Field's 24px and the default 2 lines measure 40px. Evidence: measured 24px at `rows={1}` beside a 24px Field and 40px at the default, in the browser, 2026-11-11. Check: review `src/ui/ui.css`.
  - Don't: `<div class="form-row"><Field ariaLabel="Name" /><TextArea ariaLabel="Note" /></div>`
  - Do: `<div class="form-row"><Field ariaLabel="Name" /><TextArea rows={1} ariaLabel="Note" /></div>`

## Accessibility
Rests on the native `<textarea>` element: typing, selection, IME, undo and `disabled` come from the platform. The height is paint: assistive tech reads the whole text whatever shows.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The control, in document order. | Moves focus in; on `field` the focus stroke and ring draw. Tab never types a tab character, so the keyboard is never trapped. | On the control. | by hand |
| Tab (disabled) | A disabled control is skipped. | Focus moves past it. | On the next control. | by hand |
| Enter | The focused control. | Breaks the line and the box grows by one, unless the caller's `onKeyDown` prevents it (to send). | Stays on the control. | test |
| Enter (composing) | The focused control, mid-composition. | Confirms the input method's candidate; `onKeyDown` is not called. | Stays on the control. | test |
| ArrowUp / ArrowDown, PageUp / PageDown | The focused control. | Move the caret; past the cap the text scrolls to keep it in view. | Stays on the control. | by hand |
| ArrowUp / ArrowDown, Enter (combobox) | The focused control, while its list shows. | The caller's `onKeyDown` moves `activeDescendant` through the list or runs the active option, and prevents the caret's move; the control moves no focus. | Stays on the control. | by hand |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The control | `textbox`, multi-line (native `<textarea>`) | `aria-label`, or the label tied to it | `disabled` when blocked; `aria-invalid="true"` while refused; `aria-describedby` naming the caller's line, then the `title`'s words | "Ask the assistant, edit text, multi-line" / "…, invalid entry, 120 characters too long to send" | test |
| The control as a combobox | `combobox` (`role`) | `aria-label` | `aria-expanded`, `aria-controls` naming the list, `aria-activedescendant` naming the active option, `aria-autocomplete` | "Ask the assistant, combo box, expanded" then each option as the keys reach it | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The box | field | `--field-pad-y`, `--field-pad-x`, `--hairline`, `--radius-control` |
| The type | field | `--font-body`, `--leading-ui` (the line; a quarter taller under a coarse pointer, for its 16px type) |
| The type | bare | inherited from the card: its size, its line, its family |
| The fill | field | `--control` |
| The stroke | rest | `--border-soft` (dark), `--border` (light): the field's own edge ink, `--ui-field-edge`, shared with `Field` and `Select` since 2026-11-12 |
| The stroke | focus | `--focus-ring` |
| The stroke | invalid | `--error` |
| The text | all | `--text` |
| The placeholder | all | `--text-faint` |
| The text | disabled | `--text-disabled` |
| The ring | focus (field) | `--focus-outline-w`, `--focus-ring`, `--focus-outline-offset` (twice the offset while invalid) |
| The motion | focus | `--dur-fast`, `--ease-standard` |

## Related
- `Field`: when the text is one line.
- `Select`: when the value is picked rather than written.
- `Button`: when the text is sent by a control beside it.
- `IconButton`: the send key beside a composer's editor.
- `Tooltip`: the hint box a `title` shows in; never wrap a text area in one.
