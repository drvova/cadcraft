# SectionLabel

## Description
It names a panel's section as a real heading, so a screen reader can jump between the sections by heading.

`import { SectionLabel } from "../../../../src/ui/SectionLabel";`, source `src/ui/SectionLabel.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/native-control.

### Foundation
Not applicable: hand-rolled — the 11px uppercase header is measured from the running Cursor 3.27.22 (`../../../../../.design-system/research/cursor-recipes-2026-10-28.md` §3), and no registry item ships it.

## Examples
`<SectionLabel>Layers</SectionLabel>` — the heading above the layers list.

Real uses, 0 call sites (`rg -c "section-label" src/components src/styles.css` → `src/components/LayersPanel.tsx:1`, `src/components/PropertiesPanel.tsx:1`, `src/styles.css:1`):
- (planned) `src/components/LayersPanel.tsx` and `src/components/PropertiesPanel.tsx` — `.section-label` (2 uses) move onto `<SectionLabel>` when the surface migration reaches the panels.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/section-label/default.tsx` | default | The heading above a panel's list. |
| `docs/system/examples/section-label/in-layers-panel.tsx` | composition:LayersPanel | The heading in the layers panel's header bar. |

## Variants

### Not applicable
Not applicable: no variant axes — a section label is one heading; its size, weight and ink come from the one recipe, and anything that looks different is a different role (a pane title, a tab).

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest | The heading is rendered. | Read it; jump to it by heading navigation. | The uppercase label at the faint ink. | test |
| Long label | The section's name is wider than its panel. | Read it; the label does not wrap. | The label runs to the panel's edge; a longer name is the caller's problem to shorten. | by hand |

### State precedence
- Rest and Long label: Not applicable: the heading has no other state; a long label is the same resting state with more text.

### Motion
Not applicable: no motion — the heading never changes state, and its ink comes from the tokens.

## Props
- `children`: the section's name: one or two words, the same noun the panel uses elsewhere.

## Usage

### When to use
- A panel or a popover holds more than one group, and each group needs a name a screen reader can jump to.
- The name sits above a list, a table or a group of controls as their heading.

### When not to use
- The text is an action rather than a name. Use `Button` instead.
- The text is a value or a status. Use `Chip` instead.
- The text is a list item the user can pick. Use `Row` instead.

### Rules
- `rule/section-label-heading-element`: When a section label is rendered, keep it an `<h2>`, because the element is what lets a screen reader jump between panels and a styled `<div>` reads as plain text. Evidence: app 3/3 panels draw a section header, `src/components/LayersPanel.tsx`. Check: test `src/ui/SectionLabel.test.tsx`.
  - Don't: `<div class="section-label">Layers</div>`
  - Do: `<SectionLabel>Layers</SectionLabel>`
- `rule/section-label-not-action`: When a heading needs a control beside it, put the control outside `SectionLabel` rather than inside it, because a button inside a heading joins the heading's name and garbles heading navigation. Evidence: app 2/2 panel heads keep their controls in the bar, `src/components/PropertiesPanel.tsx`. Check: review `src/components/PropertiesPanel.tsx`.
  - Don't: `<SectionLabel>Layers <IconButton icon="plus" title="New layer" /></SectionLabel>`
  - Do: `<div class="head"><SectionLabel>Layers</SectionLabel><IconButton icon="plus" title="New layer" /></div>`

### Content
- `rule/section-label-one-noun`: When the label's text is written, use 1 noun in title case (Layers, Properties, Selection), because the label is uppercased by CSS and a sentence reads as shouting. Evidence: single use `src/components/LayersPanel.tsx:25`, the label "Layers". Check: review `src/components/LayersPanel.tsx`.
  - Don't: `<SectionLabel>Here are your layers</SectionLabel>`
  - Do: `<SectionLabel>Layers</SectionLabel>`

### Anti-slop
- `rule/section-label-canonical-element`: When a surface needs a section header, render `SectionLabel` rather than a styled `<div>` or a bespoke class, because the replaced class is a bare rule with no role and drifts per panel. Evidence: app 3/3 lines across 2 panels and `src/styles.css`, `rg -c "section-label" src/components src/styles.css`. Check: review `src/ui/SectionLabel.tsx`.
  - Don't: `<div class="section-label">Properties</div>`
  - Do: `<SectionLabel>Properties</SectionLabel>`

### Limits
- `rule/section-label-word-limit`: When a section's name runs past 2 words, shorten it to 1 or 2 words, because the measured header row is 22px at 11px type and a third word starts clipping in a 260px sidebar. Evidence: measured 22px header at 11px type, `../../../../../.design-system/research/cursor-recipes-2026-10-28.md` §3. Check: review `src/components/LayersPanel.tsx`.
  - Don't: `<SectionLabel>Layer visibility and lock state</SectionLabel>`
  - Do: `<SectionLabel>Layers</SectionLabel>`

## Accessibility
Rests on the native `<h2>` element: heading role and level come from the platform, and heading navigation works without ARIA.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| H (screen reader) | The page, with heading navigation on. | Jumps to the next heading, including this one. | On the next heading. | by hand |
| Tab | A heading is not focusable. | Focus skips the heading. | On the next control. | by hand |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The heading | `heading` level 2 (native `<h2>`) | Its text content | None: the level comes from the element | "Layers, heading level 2" | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The text | all | `--font-chip`, `--text-faint` |
| The weight | all | `700` (the one weight the system draws headings at) |

## Related
- `Row`: when the text is a clickable list item rather than a heading.
- `Chip`: when the text is a compact value.
- `Button`: when the text is an action.
