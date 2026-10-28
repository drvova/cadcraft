# Motion

## Description

Four durations and two easings, plus the one fade endpoint for hover: motion is fast, short and never decorative — it confirms a state change and gets out of the way. The values live in `src/tokens.css`, measured from Cursor 3.27.22 (durations 50/100/150/200ms, `ease-out` and a strong out-quint).

## Tokens

| Token | Value | Role |
| --- | --- | --- |
| `--dur-instant` | `0.05s` | A state that must feel immediate: the hover fill. |
| `--dur-fast` | `0.1s` | The default: a control's fill, a border colour change. |
| `--dur-med` | `0.15s` | A panel or a popover appearing. |
| `--dur-slow` | `0.2s` | The largest move the chrome makes (a dialog, the assistant panel). |
| `--ease-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | The default easing: fast out, settled at the end. |
| `--ease-out-quint` | `cubic-bezier(0.16, 1, 0.3, 1)` | A stronger deceleration for the larger moves (a panel sliding in). |
| `--hover-opacity` | `0.8` | The hover fade's endpoint for quiet ink (a model chip's label). |

## Specimens

Each preset, drawn with its token (hover or focus the bars to replay):

- <span style="display:inline-block;padding:2px 10px;background:var(--control);border-radius:var(--radius-control);transition:background var(--dur-instant) var(--ease-out)" onmouseover="this.style.background='var(--fill-active)'" onmouseout="this.style.background='var(--control)'">`--dur-instant` 50ms</span>
- <span style="display:inline-block;padding:2px 10px;background:var(--control);border-radius:var(--radius-control);transition:background var(--dur-fast) var(--ease-out)" onmouseover="this.style.background='var(--fill-active)'" onmouseout="this.style.background='var(--control)'">`--dur-fast` 100ms</span>
- <span style="display:inline-block;padding:2px 10px;background:var(--control);border-radius:var(--radius-control);transition:background var(--dur-med) var(--ease-out)" onmouseover="this.style.background='var(--fill-active)'" onmouseout="this.style.background='var(--control)'">`--dur-med` 150ms</span>
- <span style="display:inline-block;padding:2px 10px;background:var(--control);border-radius:var(--radius-control);transition:background var(--dur-slow) var(--ease-out-quint)" onmouseover="this.style.background='var(--fill-active)'" onmouseout="this.style.background='var(--control)'">`--dur-slow` 200ms</span>
- Opacity fade: <span style="opacity:var(--hover-opacity);transition:opacity var(--dur-fast) var(--ease-out)" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='var(--hover-opacity)'">a quiet label at `--hover-opacity`, full on hover</span>

## Usage

- Hover is the fastest state (`--dur-instant`–`--dur-fast`) and a panel is the slowest (`--dur-med`–`--dur-slow`), because feedback under the pointer must beat the eye, while a panel's arrival can take a beat.
- Two easings only: `--ease-out` for nearly everything, `--ease-out-quint` for the largest moves, because a third curve is a preference, not a system.
- Only `background-color`, `border-color`, `color`, `opacity` and `transform` transition, because anything else animates layout and drops frames.
- Nothing loops, nothing bounces, nothing moves on its own: motion is only ever the consequence of an input, because ambient motion steals attention from the drawing.
- Exit may be faster than enter, never slower, because a dismissed surface should leave before the eye returns to the canvas.

## Accessibility

- `prefers-reduced-motion` is honoured: the shell's animation choice defaults to system (`src/app.tsx`), which reads the media query live and sets `:root[data-animations="off"]`; `src/styles.css` kills every transition and animation under that attribute, so states still change and nothing moves between them.
- The behaviour under the media query is part of the browser review; the check cannot see rendered motion, and this page does not claim more than the stylesheet shows.
- Motion here is state feedback only (a fill, a fade, a small slide); there is no parallax, no autoplay and no repeating animation to reduce.

## Not tokens

- The assistant's "turn running" dot pulse is component-local (`src/assistant.css`), because it is a progress indicator with its own cadence, not a chrome transition.
- The canvas's repaint cadence is the engine's, not the chrome's, and it does not use these tokens.
