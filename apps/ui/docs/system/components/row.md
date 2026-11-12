# Row

## Description
It is the full-width clickable band of a list: a menu item, a property row or a layer, marked current when it is the selected one.

`import { Row } from "../../../../src/ui/Row";`, source `src/ui/Row.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/button-div, trap/role-button, trap/native-control, trap/list-dead-gap, trap/current-unmarked, trap/menu-navigation, trap/control-height, trap/focus-ring-shape, trap/hover-beats-focus, trap/disabled-still-hovers, trap/touch-hover-flash, trap/hover-unguarded.

### Foundation
Not applicable: hand-rolled — the 22px row, the 4px inset and the .14 selected fill are measured from the running Cursor 3.27.22 (`docs/system/decisions.md` and §5), and no registry item ships it.

## Examples
`<Row onClick={pick}>Layer 1</Row>` — one layer in the layers list.

Real uses, 4 call sites (`rg -c "<Row" src/components` → `src/components/AssistantPane.tsx:2`, `src/components/CommandPalette.tsx:1`, `src/components/LayersPanel.tsx:1`):
- `src/components/AssistantPane.tsx` — the setup sheet's provider rows and the composer's slash list (the commands a `/word` draft matches; `selected` marks the one the arrow keys are on); the chat tabs in the header moved onto `Tab`; the transcript's tool rows and the composer's toolbar row stay bespoke (the toolbar is a container, and the tool row carries a disclosure arrow and a note).
- `src/components/CommandPalette.tsx:126` — each command in the palette's list; `selected` marks the one the arrow keys are on, `disabled` the ones that cannot run now.
- `src/components/LayersPanel.tsx:53` — each layer's name band (`is-current` marks the current one); the toggle cluster beside it stays native buttons.
- `src/components/CommandPalette.tsx` and the assistant's slash list in `src/components/AssistantPane.tsx` — their rows are `<Row option>` inside a `role="listbox"`: out of the Tab order, lit by the list's one highlight.
- (planned) `src/components/MenuBar.tsx` — `.menu-row` (1 use) moves onto `<Row>` once `Row` can carry the `menuitem` roles; the rows stay native buttons for now.
- (planned) `src/components/PropertiesPanel.tsx:202` — `.prop-row` (1 use) moves onto `<Row>` when the palette's rows become clickable; today they are display rows with an inline editor.
- `.layer-row` (LayersPanel) stays bespoke because its row nests a toggle cluster, and a button cannot nest buttons.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/row/default.tsx` | default | A plain list row with a trailing value. |
| `docs/system/examples/row/selected.tsx` | state:selected | The current row at the .14 fill, announced as current. |
| `docs/system/examples/row/disabled.tsx` | state:disabled | A blocked row at the disabled ink. |
| `docs/system/examples/row/disabled-selected.tsx` | state:disabled | A blocked current row with no fill, beside a blocked active option that keeps it. |
| `docs/system/examples/row/title.tsx` | default | A row whose hint says what its text leaves out. |
| `docs/system/examples/row/option.tsx` | state:option | Options of a listbox a search field drives: one lit, none a Tab stop. |
| `docs/system/examples/row/in-menu-bar.tsx` | composition:MenuBar | A menu item inside an open menu. |

## Variants

### Not applicable
Not applicable: no variant axes — a row is one band; the selected and disabled props are states, and its height, padding and ink come from the one recipe.

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest | Nothing is over the row. | Click it, or Tab to it. | The label at the dim ink; the full width is the hit area. | test |
| Hover | The pointer is over the row, on a device with a hover pointer. | Click it. | The `.08` fill; the cursor is a pointer. | by hand |
| Pressed | The pointer is held down. | Release to run the action. | Nothing beyond hover: a row's press runs on release. | by hand |
| Focused | Keyboard focus arrives by Tab. | Enter or Space runs the action. | The 1px ring in the focus ink at offset -1, following the 4px radius. | by hand |
| Selected | The caller passes `selected` (the current row). | Click it; move to another row. | The `.14` fill, the full ink, and `aria-current="true"`. | test |
| Disabled | The caller passes `disabled`. | Nothing: no click, no hover. | The label at the disabled ink; the cursor stays default. A button also drops the selected fill; an option keeps it. | test |
| Clipped | The row's label, or the row itself, is wider than its box. | Rest the pointer on the row, or move focus to it by key, to read the whole label in the hint. | The ellipsis the label draws; the hint's first line is the label in full, without the trailing text beside it. | test |
| Option | The caller passes `option`, inside a `role="listbox"` that keeps the keyboard in its own field. | Press it; move the pointer over it, which tells the listbox (`onPointerMove`). The keys are the listbox's. | A `role="option"` band, not a button: no Tab stop, no ring and no hover fill of its own. The active one (`selected`) carries `aria-selected="true"` and the `.14` fill; a blocked one carries `aria-disabled="true"`. | test |

### State precedence
- Hover and Selected: Selected wins. The `.14` selected fill stays under the pointer; hover adds nothing to the fill.
- Hover and Focused: Focused wins. The ring stays drawn while the pointer is over the row.
- Hover and Disabled: Disabled wins. A disabled row keeps its resting look and takes no click.
- Selected and Disabled: Disabled wins on a button. A disabled row is not the current one to the eye: it drops the `.14` fill and shows the disabled ink, and `aria-current="true"` stays for assistive tech. On an `option` both show ("Option and Disabled" below).
- Pressed and Focused: both show. The ring stays drawn while the row is held down.
- Option and Hover: Option wins. An option takes no fill from the pointer; the listbox moves the one highlight to it by setting `selected`.
- Option and Selected: both show. The active option takes the `.14` fill and the full ink, as the current row does.
- Option and Disabled: both show. A blocked option still takes the highlight when the keys reach it, at the disabled ink, and takes no click: in a listbox the fill is where the keys are, and a list with no fill has lost its cursor.
- Clipped and Disabled: both show. The hint still reads the full label under the pointer.
- Option and Focused: Not applicable: an option is never focused; the listbox's field keeps the focus and names the active option with `aria-activedescendant`.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| The pointer enters or leaves | input | hover / focus feedback (`--dur-fast` + `--ease-standard`) | background-color | The fill changes at once: the shell's `:root[data-animations="off"]` rule removes the transition. |

## Props
- `selected`: the current row; sets `aria-current="true"` and the `.14` fill. On an `option` it is the listbox's active option and sets `aria-selected`.
- `option`: the row is one option of a `role="listbox"` that owns the focus and the highlight; it renders a `role="option"` band with no Tab stop and no hover fill.
- `id`: the element's `id`, for the listbox's `aria-activedescendant`.
- `onPointerMove`: the pointer moved over the row; a listbox moves its highlight here.
- `disabled`: blocks the click and drops the ink to the disabled step.
- `title`: the hint: what the row's text leaves out. It shows in the layer's hint box (after 0.4s under a mouse or a pen, at once when a key moves focus in) and is the row's accessible description (`aria-describedby`), never its name, and no native `title` attribute is rendered. A title that repeats the row's text adds nothing and is dropped. A clipped label needs no `title`: it shows in full by itself, with the `title` under it.
- `onClick`: runs on click; a disabled row never fires it.
- `children`: the row's content: a label, and quiet trailing text such as a shortcut.

## Usage

### When to use
- One item of a list is clickable and runs one action: a menu item, a layer, a property.
- The current item of that list must be marked for a screen reader as well as the eye.

### When not to use
- The action is a single control with a label. Use `Button` instead.
- The row nests its own controls (a toggle cluster, a stepper). Use `Button` and `IconButton` in a bespoke band instead, because a button cannot nest buttons.
- The band is a heading above a list rather than a row in it. Use `SectionLabel` instead.

### Rules
- `rule/row-one-action`: When a row runs an action, wire it on `Row` itself rather than on a label inside it, because a label-only hit area leaves dead space that reads as broken. Evidence: app 8/8 lines across `src/chrome.css`, `src/components/MenuBar.tsx` and `src/styles.css`, `rg -c "menu-row" src`. Check: test `src/ui/Row.test.tsx`.
  - Don't: `<Row><span onClick={pick}>Layer 1</span></Row>`
  - Do: `<Row onClick={pick}>Layer 1</Row>`
- `rule/row-option-in-listbox`: When rows are the items of a `role="listbox"` whose field keeps the focus, pass `option` on each with an `id`, mark the active one with `selected` and move it from `onPointerMove`, because a `<button>` inside a `role="option"` adds 1 Tab stop per row and its own hover fill, so two rows are lit at once: the pointer's and the keyboard's. Evidence: single use `src/components/CommandPalette.tsx:244`, a `Row` button inside a `.palette-option` wrapper. Check: test `src/ui/Row.test.tsx`.
  - Don't: `<div role="option" aria-selected={lit}><Row selected={lit} onClick={run}>Line</Row></div>`
  - Do: `<Row option id="command-0" selected={lit} onPointerMove={light} onClick={run}>Line</Row>`
- `rule/row-current-marked`: When a list has a current item, pass `selected` on it, because the `.14` fill alone is colour and a screen reader needs `aria-current="true"` to hear it. Evidence: app 3/3 list surfaces draw a current row, `src/styles.css`. Check: test `src/ui/Row.test.tsx`.
  - Don't: a hand-painted background on the current row with no `aria-current`.
  - Do: `<Row selected>Current layer</Row>`

### Content
- `rule/row-trailing-quiet`: When a row carries a shortcut or a value, put it after the label in the dim ink (`--text-faint`), because the label is what the user scans and the trailing text is secondary. Evidence: single use `src/components/MenuBar.tsx:231`, the shortcut span. Check: review `src/components/MenuBar.tsx`.
  - Don't: a shortcut before the label.
  - Do: `<Row>Save<span class="row-shortcut">Ctrl+S</span></Row>`

### Anti-slop
- `rule/row-canonical-element`: When a surface needs a list band, render `Row` rather than a `div` with an `onClick`, because a `div` has no role, no focus and no disabled state, and the replaced classes repeat hover and selected by hand. Evidence: app 23/23 lines across 7 files, `rg -c "prop-row|menu-row|assistant-row|assistant-tool" src`. Check: review `src/ui/Row.tsx`.
  - Don't: `<div class="menu-row" onClick={pick}>Open</div>`
  - Do: `<Row onClick={pick}>Open</Row>`

### Limits
- `rule/row-label-limit`: When a row's label runs past 40 characters at the 260px sidebar, clip it with an ellipsis on the label's own element and leave `title` for what the hint adds, because the measured row is 22px tall and the sidebar 260px wide, and the hint already reads a clipped label in full on its first line. Evidence: measured 22px row and 260px sidebar, `docs/system/decisions.md`. Check: review `src/styles.css`.
  - Don't: a 60-character layer name that overflows the row.
  - Do: `<Row><span class="row-label">{name}</span></Row>` with `overflow: hidden; text-overflow: ellipsis` on the label, and no `title` that repeats it.
- `rule/row-touch-target`: When rows stack in a list, let the list's height follow its rows rather than fixing it to a multiple of 22px, because under a coarse pointer each row grows from 22px to the 24px control height (rows stack with 0 gap, so an overhanging target would only overlap the next row) and a fixed list would cut its last rows. Evidence: measured 22px row, 24px under a coarse pointer, `src/ui/ui.css:983`. Check: review `src/ui/ui.css`.
  - Don't: `.my-list { height: calc(var(--control-h-row) * 8); overflow: hidden }`
  - Do: `.my-list { max-height: calc(var(--control-h-input) * 8); overflow-y: auto }`

## Accessibility
Rests on the native `<button>` element: role, Enter and Space, `disabled` and focus come from the platform.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The row, in document order. | Moves focus to it; the accent ring draws. | On the row. | test |
| Enter | The focused row. | Runs the action. | Stays on the row. | test |
| Space | The focused row. | Runs the action on release, exactly once. | Stays on the row. | by hand |
| ArrowDown | The focused row (in a menu, by the parent's key handler). | Moves to the next row. | On the next row. | by hand |
| Tab (option) | Anywhere before a listbox of `option` rows. | Skips every option: none is a Tab stop. | On the next control after the list. | test |
| ArrowDown, Enter (option) | The listbox's own field. | The listbox moves `selected` to the next option, or runs the active one; the option handles no key. | Stays in the field. | by hand |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The row | `button` (native) | Its text content | `aria-current="true"` when selected; `disabled` when blocked; `aria-describedby` naming the `title`'s words when it has one that says more than the text | "Layer 1, button, current" / "Walls, button, Makes this the current layer" | test |
| The row as an option | `option` (`role="option"` on a `<div>`) | Its text content | `aria-selected` (`true` on the active one, `false` on the rest); `aria-disabled="true"` when blocked; the `id` the listbox's `aria-activedescendant` names; `aria-describedby` naming the `title`'s words | "Circle, 2 of 4" as the listbox's field moves to it | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The band | all | `--control-h-row`, `--radius-card`, `--gap-4`, `--font-body` |
| The label | rest | `--text-dim` |
| The fill | hover | `--hover` |
| The fill | selected, the active option | `--fill-active` |
| The label | selected | `--text` |
| The label | disabled | `--text-disabled` |
| The fill | disabled and selected, a button | none: transparent |
| The fill | disabled and selected, an option | `--fill-active` |
| The ring | focus-visible | `--focus-outline-w`, `--focus-ring`, `--focus-outline-offset` |
| The motion | hover | `--dur-fast`, `--ease-standard` |
| The band | coarse pointer | `--control-h-input` |

## Related
- `Button`: when the control is an action rather than a list item.
- `SectionLabel`: when the band is the heading above a list rather than a row in it.
- `IconButton`: when the row's trailing control is a glyph action.
- `Tooltip`: the hint box a row's `title` and its clipped label show in. A `Tooltip` wrapped around a row with no `title` still speaks; give the row its `title` instead of wrapping it.
- `Tab`: when the control brings one view of a strip to the front rather than being one band of a list.
- `Kbd`: when the text is the key that runs an action, shown at the end of the row.
- `Select`: when the list is a short set of values behind one closed control rather than rows on the page.
