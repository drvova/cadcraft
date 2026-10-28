# Typography

## Description

Two families (the system UI stack and the mono stack) and six fixed sizes, one per control and one per reading role: text never takes a size outside this scale, and sizes never scale with the viewport. The values live in `src/tokens.css`; the roles are fixed by the measured Cursor 3.27.22 recipes.

## Tokens

| Token | Value | Role |
| --- | --- | --- |
| `--font-family` | `system-ui, "Segoe UI", -apple-system, sans-serif` | The interface family: labels, values, prose. |
| `--font-family-mono` | `"Hack", ui-monospace, "Cascadia Mono", Consolas, monospace` | The monospace family: coordinates, command input, code in messages. |
| `--font-button` | `14px` | A button's label (`src/ui/ui.css`), the largest control type. |
| `--font-chip` | `11px` | A chip, a section label, a tool tooltip. |
| `--font-label` | `12px` | A field's label above its input. |
| `--font-small` | `11.5px` | Secondary values: status bar readouts, units. |
| `--font-body` | `13px` | Body copy: field values, list rows, the assistant's messages. |
| `--font-mono` | `12px` | The command line's input and history, coordinates. |

Composite styles (family, size, line height, weight, tracking), as the app sets them:

| Style | Family | Size | Line height | Weight | Tracking |
| --- | --- | --- | --- | --- | --- |
| Button label | `--font-family` | `--font-button` | 1 | 400 | normal |
| Chip / section label | `--font-family` | `--font-chip` | 1 | 400 | `0.05em`–`0.06em` on uppercased section labels |
| Field label | `--font-family` | `--font-label` | normal | 400 | normal |
| Body / row | `--font-family` | `--font-body` | normal | 400 | normal |
| Assistant message | `--font-family` | `--font-body` | `1.4` | 400 | normal |
| Command input | `--font-family-mono` | `--font-mono` | `1.45` | 400 | normal |

## Specimens

- Button: <span style="font-family:var(--font-family);font-size:var(--font-button)">Save</span>
- Chip: <span style="font-family:var(--font-family);font-size:var(--font-chip)">Bodycam</span>
- Field label: <span style="font-family:var(--font-family);font-size:var(--font-label)">Layer</span>
- Small: <span style="font-family:var(--font-family);font-size:var(--font-small)">0,0 · 120.5 × 80</span>
- Body: <span style="font-family:var(--font-family);font-size:var(--font-body)">Paste a command or ask the assistant.</span>
- Mono: <span style="font-family:var(--font-family-mono);font-size:var(--font-mono)">(0,0) CIRCLE 20,20 5</span>

## Usage

- One size per role, never per surface: a button is `--font-button` wherever it sits, because a control that changes size between panels reads as a different control.
- The mono family is for machine text only — coordinates, commands, code — because mixing the families inside one sentence makes both harder to scan.
- Uppercase belongs to section labels alone, with `letter-spacing` at `0.05em`–`0.06em`, because spaced caps on a normal sentence read as shouting.
- The smallest size is `--font-chip` at `11px`; nothing in the chrome goes below it, because below 11px the stroke font's glyphs start to blur at 100%.
- Sizes do not scale with the viewport; the app's chrome keeps its density and the canvas handles scale, because a zoomed chrome wastes the drawing's space.

## Accessibility

- The smallest type in use is `11px` (`--font-chip`), measured from `src/tokens.css`; every other role is larger, up to `14px` (`--font-button`).
- Body copy sits at `13px` with a `1.4`–`1.45` line height, which the assistant pane uses for multi-line messages.
- Zoom to 200% without clipping: not measured this run. The fixed-width chrome (a 260px rail) is the risk this review should cover first.

## Not tokens

- Font weight and `line-height` are set per component in `src/ui/ui.css` and `src/styles.css`, because they only matter for the roles named in the composite table above; a weight token would be a second scale for one value.
- The mono family names `Hack` first, but no font file ships with the app: the stack falls through to the platform's mono when it is absent, so nothing is embedded and nothing is licensed.
