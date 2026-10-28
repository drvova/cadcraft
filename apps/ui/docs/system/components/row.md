# Row

## Description
It is the full-width clickable band of a list: a menu item, a property row or a layer, marked current when it is the selected one.

`import { Row } from "../../../../src/ui/Row";`, source `src/ui/Row.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/button-div, trap/role-button, trap/native-control, trap/list-dead-gap, trap/current-unmarked, trap/menu-navigation, trap/control-height, trap/focus-ring-shape, trap/hover-beats-focus, trap/disabled-still-hovers, trap/touch-hover-flash, trap/hover-unguarded.

### Foundation
Not applicable: hand-rolled — the 22px row, the 4px inset and the .14 selected fill are measured from the running Cursor 3.27.22 (`../../../../../.design-system/research/cursor-recipes-2026-10-28.md` §3 and §5), and no registry item ships it.

## Examples
`<Row onClick={pick}>Layer 1</Row>` — one layer in the layers list.

Real uses, 1 call site (`rg -c "<Row" src/components` → `src/components/AssistantPane.tsx:1`, the provider popover's preset list):
- `src/components/AssistantPane.tsx` — the composer pilot: the provider popover's preset rows; the transcript's tool rows and the composer's toolbar row stay bespoke (the toolbar is a container, and the tool row carries a disclosure arrow and a note).
- (planned) `src/components/MenuBar.tsx` — `.menu-row` (1 use) moves onto `<Row>` when the surface migration reaches the menus.
- (planned) `src/components/PropertiesPanel.tsx:167` — `.prop-row` (1 use) moves onto `<Row>` when the properties palette is migrated.
- `.layer-row` (LayersPanel) stays bespoke because its row nests a toggle cluster, and a button cannot nest buttons.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/row/default.tsx` | default | A plain list row with a trailing value. |
| `docs/system/examples/row/selected.tsx` | state:selected | The current row at the .14 fill, announced as current. |
| `docs/system/examples/row/disabled.tsx` | state:disabled | A blocked row at the disabled ink. |
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
| Focused | Keyboard focus arrives by Tab. | Enter or Space runs the action. | The 1px accent ring at offset -1, following the 4px radius. | by hand |
| Selected | The caller passes `selected` (the current row). | Click it; move to another row. | The `.14` fill, the full ink, and `aria-current="true"`. | test |
| Disabled | The caller passes `disabled`. | Nothing: no click, no hover. | The label at the disabled ink; the cursor stays default. | test |

### State precedence
- Hover and Selected: Selected wins. The `.14` selected fill stays under the pointer; hover adds nothing to the fill.
- Hover and Focused: Focused wins. The ring stays drawn while the pointer is over the row.
- Hover and Disabled: Disabled wins. A disabled row keeps its resting look and takes no click.
- Selected and Disabled: Disabled wins. A disabled row drops the selected fill and shows the disabled ink.
- Pressed and Focused: both show. The ring stays drawn while the row is held down.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| The pointer enters or leaves | input | hover / focus feedback (`--dur-fast` + `--ease-out`) | background-color | The fill changes at once: the shell's `:root[data-animations="off"]` rule removes the transition. |

## Props
- `selected`: the current row; sets `aria-current="true"` and the `.14` fill.
- `disabled`: blocks the click and drops the ink to the disabled step.
- `title`: a tooltip, for a row whose label is clipped.
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
- `rule/row-current-marked`: When a list has a current item, pass `selected` on it, because the `.14` fill alone is colour and a screen reader needs `aria-current="true"` to hear it. Evidence: app 3/3 list surfaces draw a current row, `src/styles.css`. Check: test `src/ui/Row.test.tsx`.
  - Don't: a hand-painted background on the current row with no `aria-current`.
  - Do: `<Row selected>Current layer</Row>`

### Content
- `rule/row-trailing-quiet`: When a row carries a shortcut or a value, put it after the label in the dim ink (`--text-faint`), because the label is what the user scans and the trailing text is secondary. Evidence: single use `src/components/MenuBar.tsx:174`, the shortcut span. Check: review `src/components/MenuBar.tsx`.
  - Don't: a shortcut before the label.
  - Do: `<Row>Save<span class="row-shortcut">Ctrl+S</span></Row>`

### Anti-slop
- `rule/row-canonical-element`: When a surface needs a list band, render `Row` rather than a `div` with an `onClick`, because a `div` has no role, no focus and no disabled state, and the replaced classes repeat hover and selected by hand. Evidence: app 23/23 lines across 7 files, `rg -c "prop-row|menu-row|assistant-row|assistant-tool" src`. Check: review `src/ui/Row.tsx`.
  - Don't: `<div class="menu-row" onClick={pick}>Open</div>`
  - Do: `<Row onClick={pick}>Open</Row>`

### Limits
- `rule/row-label-limit`: When a row's label runs past 40 characters at the 260px sidebar, clip it with an ellipsis and keep the full text in `title`, because the measured row is 22px tall and the sidebar 260px wide. Evidence: measured 22px row and 260px sidebar, `../../../../../.design-system/research/cursor-recipes-2026-10-28.md` §3. Check: review `src/styles.css`.
  - Don't: a 60-character layer name that overflows the row.
  - Do: a clipped label with the full name in `title`.

## Accessibility
Rests on the native `<button>` element: role, Enter and Space, `disabled` and focus come from the platform.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The row, in document order. | Moves focus to it; the accent ring draws. | On the row. | test |
| Enter | The focused row. | Runs the action. | Stays on the row. | test |
| Space | The focused row. | Runs the action on release, exactly once. | Stays on the row. | by hand |
| ArrowDown | The focused row (in a menu, by the parent's key handler). | Moves to the next row. | On the next row. | by hand |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The row | `button` (native) | Its text content | `aria-current="true"` when selected; `disabled` when blocked | "Layer 1, button, current" | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The band | all | `--control-h-row`, `--radius-card`, `--gap-4`, `--font-body` |
| The label | rest | `--text-dim` |
| The fill | hover | `--hover` |
| The fill | selected | `--fill-active` |
| The label | selected | `--text` |
| The label | disabled | `--text-disabled` |
| The ring | focus-visible | `--focus-outline-w`, `--accent`, `--focus-outline-offset` |
| The motion | hover | `--dur-fast`, `--ease-out` |

## Related
- `Button`: when the control is an action rather than a list item.
- `SectionLabel`: when the band is the heading above a list rather than a row in it.
- `IconButton`: when the row's trailing control is a glyph action.
