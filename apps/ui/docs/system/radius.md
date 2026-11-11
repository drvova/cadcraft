# Radius

## Description

The corner ladder (2–5px for controls, 12 and 14px for the assistant's blocks and popovers, full round for pills), the one hairline width, and the focus ring's stroke: every box in the chrome takes its corner and stroke from these tokens. The values live in `src/tokens.css`; the roles are the measured Cursor 3.27.22 recipes.

## Tokens

### Radius

| Token | Value | Role |
| --- | --- | --- |
| `--radius-control` | `2px` | Buttons and inputs: the measured control corner. |
| `--radius-small` | `3px` | Chips and small wells: one step off the control. |
| `--radius-card` | `4px` | Cards and list rows. |
| `--radius-composer` | `5px` | The composer's box. |
| `--radius-block` | `12px` | The transcript's message bubble and code block, and the docked composer card (measured). |
| `--radius-popover` | `14px` | The measured popover: the model menu (Cursor §8). |
| `--radius-round` | `9999px` | The pill/circle radius (Chip, IconButton; Cursor §2). |

### Strokes and elevation

| Token | Value | Role |
| --- | --- | --- |
| `--hairline` | `1px` | The one border width: every stroke in the chrome. |
| `--focus-outline-w` | `1px` | The focus ring's stroke. |
| `--focus-outline-offset` | `-1px` | The ring sits inside the control's box, so it never shifts the layout. |
| `--shadow-popover` | `0 3px 8px`, `0 2px 5px`, `0 1px 1px`, each `rgba(0,0,0,.12)` | The measured three-layer shadow under a menu or a popover (Cursor §8). |
| `--tooltip-shadow` | `0 2px 8px rgba(0,0,0,.4)` dark / `rgba(0,0,0,.16)` light | The measured single layer under the hint (Cursor §8). |

Surface levels (which surface a floating thing sits on) are the colour tokens `--chrome`, `--control`, `--panel` and `--surface-elevated`; their ladder is on the Colors page.

## Specimens

- Radius ladder: <span style="display:inline-block;width:64px;height:24px;background:var(--control);border:1px solid var(--border);border-radius:var(--radius-control);vertical-align:middle"></span> control 2 <span style="display:inline-block;width:64px;height:24px;background:var(--control);border:1px solid var(--border);border-radius:var(--radius-small);vertical-align:middle"></span> small 3 <span style="display:inline-block;width:64px;height:24px;background:var(--control);border:1px solid var(--border);border-radius:var(--radius-card);vertical-align:middle"></span> card 4 <span style="display:inline-block;width:64px;height:24px;background:var(--control);border:1px solid var(--border);border-radius:var(--radius-composer);vertical-align:middle"></span> composer 5
- Round: <span style="display:inline-block;width:48px;height:20px;background:var(--control);border-radius:var(--radius-round);vertical-align:middle"></span> round
- Focus ring: <span style="display:inline-block;padding:2px 10px;background:var(--control);border-radius:var(--radius-control);outline:var(--focus-outline-w) solid var(--accent);outline-offset:var(--focus-outline-offset)">focused</span>
- The popover's shadow, on `--surface-elevated`: <span style="display:inline-block;padding:4px 12px;background:var(--surface-elevated);border-radius:var(--radius-card);box-shadow:var(--shadow-popover)">floating</span>

## Usage

- Corners are ladder steps, never eyeballed: a control is `--radius-control`, a chip `--radius-small` or `--radius-round`, a card `--radius-card`, because mixed corners read as mixed components.
- The largest corner is the popover's 14px (`--radius-popover`), because the large radius is what marks a surface that floats. The assistant's composer is docked in its panel, so its card takes `--radius-block`, the corner of the prompt bubble and of the stack that sits on it. The 20px `--radius-elevated` was removed on 2026-11-11: nothing had drawn it since the composer docked.
- One stroke width: every border is `--hairline`; a heavier stroke is a different control, not a different border, because a 2px border reads as focus.
- The focus ring is 1px, inset (`--focus-outline-offset: -1px`), in `--accent`, because an outset ring shifts a row and an inset ring never does.
- One shadow per floating kind, one direction: a menu or a popover casts `--shadow-popover` and the hint `--tooltip-shadow`; nothing else casts one, because a shadow on a docked surface invents an elevation it does not have.
- A pill shape takes `--radius-round`, because at the chip's 20px height any radius past 10px draws the same pill, and one token for it leaves no second pill to drift.

## Accessibility

- The focus ring is `1px` in `--accent`, offset `-1px` (inset). Its contrast against every surface level is covered by the Colors page's measured grid: `--accent` measures 6.0:1 over `--control` in dark, 3.8:1 in light (above the 3:1 non-text threshold).
- The ring is never removed without a replacement: the components' `:focus-visible` styles in `src/ui/ui.css` carry it, and the check cannot see focus behavior, so the browser review covers it.

## Not tokens

- SVG stroke widths inside icon paths are drawing values (`1.5` on the 24×24 grid in `src/icons.ts`), not box strokes, because an icon's stroke must stay proportional to its viewBox.
- The canvas's selection stroke width is an engine constant, not chrome, for the same reason.
