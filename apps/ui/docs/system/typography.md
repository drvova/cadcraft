# Typography

## Description

Two families (the system UI stack and the mono stack) and one scale of four sizes on screen: 11px for section labels, counts and key caps, 12px for secondary text, 13px for everything read or typed, and the 12px mono. Text never takes a size outside this scale, and sizes never scale with the viewport. The values live in `src/tokens.css`. They were measured from Cursor 3.27.22, which gave six sizes (its composer is 15px on a 24px line, its button 14px, its small text 11.5px); on 2026-11-11 the shell's 13px scale won and those three folded into it (`decisions.md`, "One type scale").

## Tokens

| Token | Value | Role |
| --- | --- | --- |
| `--font-family` | `system-ui, "Segoe UI", -apple-system, sans-serif` | The interface family: labels, values, prose. |
| `--font-family-mono` | `"Hack", ui-monospace, "Cascadia Mono", Consolas, monospace` | The monospace family: coordinates, command input, code in messages. |
| `--font-button` | `var(--font-body)` (13px) | A button's label (`src/ui/ui.css`). Measured 14px in Cursor; the body size since 2026-11-11. |
| `--font-chip` | `11px` | A chip, a section label, a count, a key cap, the status bar's toggles, the small button. |
| `--font-label` | `12px` | Secondary text: a field's label above its input, a menu title, the command centre, the status bar's facts, a hint, the compact tab. |
| `--font-small` | `var(--font-label)` (12px) | An alias of `--font-label`, kept for the sheets that name it. Measured 11.5px in Cursor; folded on 2026-11-11. New rules take `--font-label`. |
| `--font-body` | `13px` | Body copy: field values, list rows, the assistant's messages. |
| `--font-mono` | `12px` | The command line's input, history and prompt mark, coordinates. |
| `--composer-font` | `var(--font-body)` (13px) | The assistant's composer and transcript. Measured 15px in Cursor; the body size since 2026-11-11. |
| `--composer-leading` | `20px` | Their line. Measured 24px in Cursor, for 15px type. |

Composite styles (family, size, line height, weight, tracking), as the app sets them:

| Style | Family | Size | Line height | Weight | Tracking |
| --- | --- | --- | --- | --- | --- |
| Button label | `--font-family` | `--font-button` | 1 | 400 | normal |
| Chip | `--font-family` | `--font-chip` | 1 | 400 | normal |
| Section label | `--font-family` | `--font-chip` | normal | 700 | normal, uppercased |
| Field label | `--font-family` | `--font-label` | normal | 400 | normal |
| Body / row | `--font-family` | `--font-body` | normal | 400 | normal |
| Assistant message, composer | `--font-family` | `--composer-font` | `--composer-leading` | 400 | normal |
| Status bar fact | `--font-family` | `--font-label` | the bar's line (21px) | 400 | normal |
| Status bar toggle | `--font-family` | `--font-chip` | the bar's line | 400 | `0.04em`, uppercased |
| List row (layer, property) | `--font-family` | `--font-body` | `--control-h-row` | 400 | normal |
| Command input | `--font-family-mono` | `--font-mono` | `1.45` | 400 | normal |

## Specimens

- Button: <span style="font-family:var(--font-family);font-size:var(--font-button)">Save</span>
- Chip: <span style="font-family:var(--font-family);font-size:var(--font-chip)">Bodycam</span>
- Field label: <span style="font-family:var(--font-family);font-size:var(--font-label)">Layer</span>
- Body: <span style="font-family:var(--font-family);font-size:var(--font-body)">Paste a command or ask the assistant.</span>
- Mono: <span style="font-family:var(--font-family-mono);font-size:var(--font-mono)">(0,0) CIRCLE 20,20 5</span>

## Usage

- One size per role, never per surface: a button is `--font-button` wherever it sits, because a control that changes size between panels reads as a different control.
- Pick the size by what the text is for, from three: 13px if it is read or typed, 12px if it is secondary to something beside it, 11px if it is a label, a count or a key cap, because a fourth sans size is a second scale: the assistant at 15px beside a 13px shell read as another product.
- The mono family is for machine text only — coordinates, commands, code — because mixing the families inside one sentence makes both harder to scan.
- Uppercase belongs to the heading of a section (`SectionLabel`) and to the status bar's drafting toggles, never to a sentence, because capitals on a sentence read as shouting. A section label adds no `letter-spacing`: the measured header is 11px at weight 700 in capitals at the face's own spacing (research §2, the sidebar's section header), and the bold weight already separates the letters. This line asked for `0.05em`–`0.06em` until 2026-11-11; the measurement and `src/ui/ui.css` had none, and the page was the side that moved (`src/ui/recipe.test.ts` holds the recipe to it).
- The smallest size is `--font-chip` at `11px`; nothing in the chrome goes below it, because below 11px the stroke font's glyphs start to blur at 100%.
- Sizes do not scale with the viewport; the app's chrome keeps its density and the canvas handles scale, because a zoomed chrome wastes the drawing's space.

## Accessibility

- The smallest type in use is `11px` (`--font-chip`), measured from `src/tokens.css`; every other role is larger, up to `13px` (`--font-body`). Under a coarse pointer a field, a text area and the palette's input are at least 16px, so a phone does not zoom into them.
- Body copy sits at `13px`; the assistant's messages and composer are on a `20px` line (1.54), the command history on `1.45`.
- Zoom to 200% without clipping: not measured this run. The fixed-width chrome (a 260px rail) is the risk this review should cover first.

## Not tokens

- Font weight and `line-height` are set per component in `src/ui/ui.css` and `src/styles.css`, because they only matter for the roles named in the composite table above; a weight token would be a second scale for one value.
- The mono family names `Hack` first, but no font file ships with the app: the stack falls through to the platform's mono when it is absent, so nothing is embedded and nothing is licensed.
