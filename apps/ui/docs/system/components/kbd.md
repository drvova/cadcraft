# Kbd

## Description
It shows the key or shortcut that runs the action beside it, as a fact to read and never as a control.

`import { Kbd } from "../../../../src/ui/Kbd";`, source `src/ui/Kbd.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/button-div (n/a: a cap takes no handler), trap/role-button (n/a: a cap has no role beyond the native `<kbd>`), trap/control-height (n/a: a cap is text on a hairline, not a control; its 18px box comes from the 16px line and the two hairlines).

### Foundation
Not applicable: hand-rolled — a native `<kbd>` on one recipe. It replaces two hand-built caps, and the recipe kept is the command palette's (`.palette-key`): the UI face, the quiet ink `--text-faint`, the chip type size and a 16px line. The assistant's (`.assistant-key`: the mono face at the disabled ink `--text-disabled`, no line height) lost, because the disabled ink marks a control that cannot be used and a shortcut can, and because the palette's shortcuts are combinations ("Ctrl+Shift+S") that read as words in the UI face.

## Examples
`<Kbd>esc</Kbd>` — the key that stops a running request, beside Stop.

Real uses, 2 call sites (`rg -c "<Kbd" src/components` → `src/components/AssistantPane.tsx:1`, `src/components/CommandPalette.tsx:1`):
- `src/components/AssistantPane.tsx:645` — the `esc` cap beside the Stop button on the run row over the composer, shown while a request runs.
- `src/components/CommandPalette.tsx:144` — each command's shortcut at the end of its palette row, written by `shortcutLabel` for the platform; a command with no shortcut draws no cap.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/kbd/default.tsx` | default | One key cap. |
| `docs/system/examples/kbd/in-command-palette.tsx` | composition:CommandPalette | A shortcut cap at the end of a palette row. |

## Variants

### Not applicable
Not applicable: no variant axes — a cap is one recipe; its text is the only thing that changes.

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest | The cap is rendered. | Read it, then press the key it names. It takes no focus and no click. | The key's text inside a hairline box with a 3px radius; a native `<kbd>`. | test |

### State precedence
Not applicable: a cap has one state, so no two states can hold at once.

### Motion
Not applicable: no motion.

## Props
- `children`: the key or shortcut as the user reads it: `esc`, `Ctrl+Shift+P`.

## Usage

### When to use
- An action on screen has a key or a shortcut, and the user is helped by seeing it beside the action: Stop and `esc`, a palette command and its shortcut.

### When not to use
- The key should itself be clickable. Use `Button` instead, and put the cap beside it.
- The text is a value or a keyword rather than a key (26 objects, a command's option). Use `Chip` instead.
- The shortcut is a hint that should show only on hover. Use `Tooltip` instead.

### Rules
- `rule/kbd-beside-action`: When a cap is rendered, place it directly after the 1 action its key runs (the button, or the row's label), because a cap on its own names a key without saying what the key does. Evidence: app 2/2 caps follow their action, `src/components/AssistantPane.tsx:645` and `src/components/CommandPalette.tsx:144`. Check: review `src/components/AssistantPane.tsx`.
  - Don't: `<Kbd>esc</Kbd>` alone on a status row.
  - Do: `<Button variant="ghost" size="sm" onClick={stop}>Stop</Button><Kbd>esc</Kbd>`
- `rule/kbd-not-a-control`: When the shortcut's action must be clickable, put the handler on the `Button` or `Row` beside the cap rather than on the cap, because a `<kbd>` has no role and no tab stop, so a click handler on it is unreachable by keyboard. Evidence: app 2/2 caps take no handler, `src/components/AssistantPane.tsx:645` and `src/components/CommandPalette.tsx:144`. Check: test `src/ui/Kbd.test.tsx`.
  - Don't: `<span onClick={stop}><Kbd>esc</Kbd></span>`
  - Do: `<Button variant="ghost" size="sm" onClick={stop}>Stop</Button><Kbd>esc</Kbd>`

### Content
- `rule/kbd-shortcut-label`: When a cap shows a combination of 2 or more keys, write it with `shortcutLabel(shortcut, mac)`, because the platform decides between "Ctrl+Shift+Z" and the macOS symbols and a literal string is wrong on one of them. Evidence: single use `src/components/CommandPalette.tsx:144`. Check: review `src/components/CommandPalette.tsx`.
  - Don't: `<Kbd>Ctrl+S</Kbd>`
  - Do: `<Kbd>{shortcutLabel("Cmd+S", mac)}</Kbd>`

### Anti-slop
- `rule/kbd-canonical-element`: When a surface shows a key, render `Kbd` rather than a raw `<kbd>` with its own class, because the 2 replaced classes drew the same cap in 2 faces and 2 inks. Evidence: app 2/2 hand-built caps replaced (`.assistant-key` and `.palette-key`), `src/components/AssistantPane.tsx:645` and `src/components/CommandPalette.tsx:144`. Check: review `src/ui/Kbd.tsx`.
  - Don't: `<kbd class="assistant-key">esc</kbd>`
  - Do: `<Kbd>esc</Kbd>`

### Limits
Not applicable: a cap holds the one string `shortcutLabel` produces or one key name, and the widest rendered so far, the 12-character "Ctrl+Shift+S", measures 69.8px and fits its palette row; no length or count has been seen to break.

## Accessibility
Rests on the native `<kbd>` element: it marks its text as keyboard input and is read in line with the text around it.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The control before the cap. | Skips the cap: it is not a tab stop. | On the next control. | test |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The cap | none (native `<kbd>`) | Not applicable: it is text, read as its content | none | "esc", in line after the action's name | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The box | all | `--hairline`, `--border-soft`, `--radius-small`, `--gap-4` |
| The text | all | `--text-faint`, `--font-family`, `--font-chip`, `--gap-16` |

## Related
- `Button`: the action a cap sits beside.
- `Row`: a list band whose trailing cap shows the command's shortcut.
- `Chip`: when the compact text is a value or a keyword rather than a key.
- `Tooltip`: when the shortcut belongs in a hover hint rather than on the surface.
