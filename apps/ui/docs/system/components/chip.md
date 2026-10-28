# Chip

## Description
It shows one compact fact, a keyword or a suggestion, and it only acts when the caller gives it a handler.

`import { Chip } from "../../../../src/ui/Chip";`, source `src/ui/Chip.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/button-div, trap/role-button, trap/native-control, trap/control-height, trap/focus-ring-shape, trap/hover-beats-focus, trap/touch-hover-flash, trap/hover-unguarded, trap/touch-tap-highlight.

### Foundation
Not applicable: hand-rolled — the pill radius, the 20px height and the accent tint are measured from the running Cursor 3.27.22 (`../../../../../.design-system/research/cursor-recipes-2026-10-28.md` §2 and §5), and no registry item ships it.

## Examples
`<Chip>26 objects</Chip>` — the selection count as a static fact.

Real uses, 0 call sites (`rg -c "keyword-chip" src` → `src/components/CommandLine.tsx:1`, `src/interaction.css:3`):
- (planned) `src/components/CommandLine.tsx:99` — `<button class="keyword-chip">` for each command keyword moves onto `<Chip tone="accent" onClick={...}>` when the surface migration reaches the command line.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/chip/default.tsx` | default | A static neutral fact. |
| `docs/system/examples/chip/tone-neutral.tsx` | tone=neutral | The quiet fact at the faint ink. |
| `docs/system/examples/chip/tone-accent.tsx` | tone=accent | The accent-tinted keyword. |
| `docs/system/examples/chip/in-command-line.tsx` | composition:CommandLine | The keyword row under the command input. |

## Variants

### tone
- `neutral`: a quiet fact or a value; transparent, at the faint ink. Used at 0 call sites.
- `accent`: a keyword or a suggestion the user can pick; the accent-tinted fill. Used at 0 call sites.

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Static | The caller passes no handler. | Read it. It is a `<span>`: no tab stop, no pointer. | The pill's text; no cursor change. | test |
| Rest | The caller passes `onClick`. | Click it, or Tab to it. | The pill is a `<button>`; the cursor is a pointer. | test |
| Hover | The pointer is over the interactive chip, on a device with a hover pointer. | Click it. | The `.08` fill. | by hand |
| Pressed | The pointer is held down. | Release to run the handler. | The `.14` fill. | by hand |
| Focused | Keyboard focus arrives by Tab. | Enter or Space runs the handler. | The 1px accent ring at offset -1, following the pill. | by hand |

### State precedence
- Static and Hover: Not applicable: a static chip is a `<span>` and takes no pointer or hover styles.
- Hover and Focused: Focused wins. The ring stays drawn while the pointer is over the chip; hover only adds the fill.
- Pressed and Focused: both show. The ring stays drawn while the chip is held down.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| The pointer enters or leaves an interactive chip | input | hover / focus feedback (`--dur-fast` + `--ease-out`) | background-color | The fill changes at once: the shell's `:root[data-animations="off"] *` rule removes the transition. |

## Props
- `tone`: `neutral` or `accent`; defaults to `neutral`.
- `onClick`: when present the chip renders as a `<button>`; without it, as a `<span>`.
- `title`: a tooltip; on the interactive form the text is the accessible name.
- `children`: the chip's text: a noun or a short value, never a sentence.

## Usage

### When to use
- A value or a status needs a compact, non-editable shape: the selection count, the current units, a keyword.
- A list of keywords or suggestions can be picked one at a time, and each pick runs an action.

### When not to use
- The user runs an action that needs a label. Use `Button` instead.
- The control is a glyph with a tooltip. Use `IconButton` instead.
- The value is editable. Use `Field` instead.

### Rules
- `rule/chip-interactive-only-with-handler`: When a chip runs an action, pass `onClick` so it renders as a `<button>`; when it is a fact, pass nothing so it stays a `<span>`, because a fact in the tab order adds a stop that does nothing. Evidence: app 2/2 chip surfaces — 1 interactive and 1 static — `src/components/CommandLine.tsx:99` and `src/components/TopBar.tsx:30`. Check: test `src/ui/Chip.test.tsx`.
  - Don't: `<Chip>26 objects</Chip>` inside an `onClick` wrapper `div`.
  - Do: `<Chip onClick={() => pick("line")}>line</Chip>`
- `rule/chip-tone-meaning`: When a chip's tone is picked, use `accent` only for a keyword the user can pick and `neutral` for a value, because the accent tint is the app's signal for the accent role and 2 tinted chips in one row read as 2 selections. Evidence: app 2/2 chips, `accent` only on the keyword row, `src/components/CommandLine.tsx:99`. Check: review `src/ui/ui.css`.
  - Don't: `<Chip tone="accent">26 objects</Chip>`
  - Do: `<Chip>26 objects</Chip>`

### Content
- `rule/chip-text-short`: When a chip's text is written, keep it to 1 word or a number plus its unit (26 objects, line, mm), because the pill is 20px tall and a third word starts wrapping the row. Evidence: single use `src/components/CommandLine.tsx:99`, the label "line". Check: review `src/components/CommandLine.tsx`.
  - Don't: `<Chip>The current drawing has 26 objects</Chip>`
  - Do: `<Chip>26 objects</Chip>`

### Anti-slop
- `rule/chip-canonical-element`: When a surface needs a chip, render `Chip` rather than a styled `<span>` or `<button>` with its own pill, because the replaced class hard-codes its own radius and hover and skips the static/interactive split. Evidence: app 4/4 lines in `src/interaction.css`, `rg -c "keyword-chip" src`. Check: review `src/ui/Chip.tsx`.
  - Don't: `<span class="keyword-chip">line</span>` with a click handler on the row.
  - Do: `<Chip tone="accent" onClick={() => pick("line")}>line</Chip>`

### Limits
- `rule/chip-row-limit`: When a chip row holds more than 6 chips, wrap the row or move the rest behind a "More" chip, because the measured chip is 20px tall with 8px side padding and a 608px composer row fits 6 of them before the row wraps. Evidence: measured 20px chip and 608px composer, `../../../../../.design-system/research/cursor-recipes-2026-10-28.md` §2. Check: review `src/components/CommandLine.tsx`.
  - Don't: 9 chips in one unwrapped row.
  - Do: 6 chips and a "More" chip that opens the rest.

## Accessibility
Rests on the native element each form renders: a `<span>` for the static chip, a `<button>` for the interactive one.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The interactive chip, in document order; a static chip is skipped. | Moves focus to the chip; the accent ring draws. | On the chip. | test |
| Enter | The focused chip. | Runs the handler. | Stays on the chip. | test |
| Space | The focused chip. | Runs the handler on release, exactly once. | Stays on the chip. | by hand |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The static chip | none (a `<span>`) | Its text content | — | "26 objects" as text | test |
| The interactive chip | `button` (native) | Its text content | `type="button"` | "line, button" | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The pill | all | `--control-h-chip`, `--radius-round`, `--gap-8`, `--font-chip`, `--gap-4` |
| The text (`neutral`) | all | `--text-faint` |
| The fill (`accent`) | all | `--accent-soft` |
| The text (`accent`) | all | `--accent` |
| The fill (interactive) | hover | `--hover` |
| The fill (interactive) | pressed | `--fill-active` |
| The ring | focus-visible | `--focus-outline-w`, `--accent`, `--focus-outline-offset` |
| The motion | hover | `--dur-fast`, `--ease-out` |

## Related
- `Button`: when the action needs a label and a full control height.
- `IconButton`: when the action is a glyph.
- `Field`: when the value is editable.
- `SectionLabel`: when the text names a group rather than a value.
