# Tooltip

## Description
It is the layer's one hint: a small box that names a control under the pointer or under keyboard focus. One box serves the whole window; `IconButton` shows it by itself from its `title`, and the `Tooltip` wrapper gives it to any other control. It is a hint, not the control: the child keeps its own element, its own pointer and its own accessible name.

`import { Tooltip } from "../../../../src/ui/Tooltip";`, source `src/ui/Tooltip.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/button-div, trap/hover-unguarded, trap/touch-hover-flash.

### Foundation
Not applicable: hand-rolled — the hover box is measured from the running Cursor 3.27.22 (`docs/system/decisions.md`, measured 2026-10-28): the chrome fill `#141414`, radius 3, the `.15` hairline, the `0 2px 8px rgba(0,0,0,.4)` shadow, 12px type, and the arrival over 0.1s. The placement, the delay and the dismissal are the layer's own (`docs/system/decisions.md`, "The hint").

## Examples
`<Tooltip text="Outline, the current layer"><span class="layer-name">Outline</span></Tooltip>` — a hint over a control that is not an `IconButton`.

Real uses, 0 call sites: no surface wraps a control in `<Tooltip>` yet. The box itself is in use on every `IconButton` (31 in the running shell at 1280px, measured in the browser 2026-11-11), which carries the hint without the wrapper.
- (planned) `src/components/StatusBar.tsx` — the drafting toggles carry a native `title` today; they move onto the wrapper in a later arc.
- (planned) `src/components/AssistantPane.tsx` — the chat title's native `title` (the full text of a clipped title) moves onto the wrapper in a later arc.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/tooltip/default.tsx` | default | The hint over a text button. |
| `docs/system/examples/tooltip/in-assistant-head.tsx` | composition:AssistantPane | The full text of a clipped chat title. |

## Variants

One shape. The box prefers the side below the control and takes the side above with `placement="top"`; either way it flips to the other side when the preferred one has no room, and slides along the window's edge rather than cross it.

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest | The pointer is away and keyboard focus is elsewhere. | Use the child. | The box is `opacity: 0; visibility: hidden` and takes no pointer. | test |
| Shown | A mouse or a pen rests on the host for 0.4s (at once when another hint was up within the last 0.3s), or keyboard focus arrives inside the host. Never a finger. | Read the hint; the child keeps the pointer. | The box fades in over 0.1s beside the host, inside the window's edges. | test |
| Dismissed | Escape, a press, a click, a scroll, a resize, or the window losing focus, while the box is shown or waiting to show. | Use the child; move the pointer or the focus to another control to see a hint again. | The box is gone at once and stays away while the pointer rests on the same host. | test |

### State precedence
- Shown and Dismissed: Dismissed wins. A dismissed hint does not come back until the pointer or the focus moves to another control.
- Rest and Shown: Not applicable: the box is one or the other.
- Rest and Dismissed: Not applicable: both draw nothing.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| The hint shows | input | hover / focus feedback (`--dur-fast` + `--ease-standard`) | opacity | The box appears at once: the shell's `:root[data-animations="off"] *` rule removes the transition. |
| The hint goes away | input | none: the box leaves at once | opacity | The same: nothing moves. |

## Props
- `text`: the hint. A short fragment: "New chat", "Copy the code".
- `placement`: the side the box prefers, `bottom` (the default) or `top`. It flips to the other side when the preferred one has no room.
- `children`: the control the hint describes. Give it its own `aria-label` or visible text — the hint is not the name. Not an `IconButton`: that one carries the hint itself.

## Usage

### When to use
- A control that is not an `IconButton` needs a short hint: a toggle with a terse face, a key with a shortcut to teach.
- A truncated value needs its full text on hover and on focus.

### When not to use
- The control is an icon-only action. Use `IconButton` instead: its `title` already shows in this box.
- The text is the control's only name. Use `Button` with a visible label instead.
- The content is rich, interactive or long. Use `Row` rows inside a menu instead.

### Rules
- `rule/tooltip-not-a-name`: When a control carries a tooltip, give the control its own `aria-label` or visible text, because the box is `aria-hidden` and a control named only by its hint has 0 names for a screen reader. Evidence: single use `src/ui/Tooltip.tsx:97`, `aria-hidden="true"` on the box. Check: test `src/ui/Tooltip.test.tsx`.
  - Don't: `<Tooltip text="Close"><button>✕</button></Tooltip>`
  - Do: `<Tooltip text="Close the panel"><button aria-label="Close the panel">✕</button></Tooltip>`
- `rule/tooltip-never-blocks`: When the tooltip shows, the box keeps `pointer-events: none`, because it sits beside the control and a hint that takes the click is worse than 0 hints. Evidence: single use `src/ui/ui.css:540`, `pointer-events: none` on the box. Check: review `src/ui/ui.css`.
  - Don't: a tooltip box with a hover handler of its own.
  - Do: `pointer-events: none` on `.ui-tooltip`.
- `rule/tooltip-no-touch`: When the pointer is a finger, show 0 hints, because a finger has no hover and a tap would leave the box up over the control it just pressed. Evidence: single use `src/ui/Tooltip.tsx:150`, the `pointerType === "touch"` guard. Check: test `src/ui/Tooltip.test.tsx`.
  - Don't: a hint that carries an instruction a touch user needs ("Hold to record").
  - Do: the instruction in the control's label or beside it, and the hint only as a repeat.

### Content
- `rule/tooltip-text-fragment`: When the hint's text is written, keep it a fragment of 1 to 4 words in sentence case with no full stop ("Copy the code", not "Click here to copy."), a shortcut in brackets after it, because the box is 24px tall and a sentence is read as a paragraph. Evidence: app 31/31 icon button hints in the running shell are 4 words or fewer before the bracket, measured in the browser 2026-11-11. Check: review `src/components/ToolStrip.tsx`.
  - Don't: `<Tooltip text="This button will close the assistant panel.">`
  - Do: `<Tooltip text="Close the panel">`

### Anti-slop
- `rule/tooltip-one-hint`: When a control shows this hint, keep it the control's 1 hint: move the text out of the native `title` into `text`, and leave an `IconButton` unwrapped, because two hints stack: the platform's box arrives on its own delay over the layer's, and an `IconButton` already shows its own. Evidence: app 31/31 icon buttons in the running shell render no `title` attribute, measured in the browser 2026-11-11. Check: test `src/ui/Tooltip.test.tsx`.
  - Don't: `<Tooltip text="Snap Mode (F9)"><button title="Snap Mode (F9)">Snap</button></Tooltip>`
  - Do: `<Tooltip text="Snap Mode (F9)"><button aria-label="Snap Mode">Snap</button></Tooltip>`

### Limits
- `rule/tooltip-length-limit`: When a hint runs past 40 characters, move the explanation into the control's label or help text, because the box is `white-space: nowrap` on 1 line and clips with an ellipsis at the window's width less 6px a side. Evidence: measured 225px box for the 40-character "Attach a picture (or paste, or drop one)" at 12px type, `src/ui/ui.css:525`. Check: review `src/ui/ui.css`.
  - Don't: a 60-character hint over the composer.
  - Do: a 3-word hint and a visible label for the rest.

## Accessibility
The box repeats, for the eye, a name the control already has; it is hidden from assistive tech. The host is a plain `<span>`, so the child's semantics are unchanged. It meets WCAG 1.4.13 as dismissable (Escape) and persistent (it stays while the pointer or the focus does); it is not hoverable, which the criterion allows for a box that only repeats the control's own name and covers nothing else the pointer needs.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The child control. | The box shows at once, and goes when focus leaves the host. | Stays on the child. | by hand |
| Escape | Anywhere, the box showing. | Puts the box away; the key is not consumed, so a surface that closes on Escape still closes. | Unchanged. | test |
| Enter | The child control, the box showing. | The child's click puts the box away. | Unchanged. | test |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The box | None: `aria-hidden="true"` | — | — | Nothing | test |
| The host | None: a plain `<span>` carrying `data-hint` | — | — | Nothing | test |
| The child | Unchanged (the child's own role) | The child's own `aria-label` or text | — | Its own name | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The box | all | `--tooltip-bg`, `--tooltip-border`, `--tooltip-shadow`, `--radius-small`, `--font-label`, `--gap-8`, `--gap-3`, `--gap-16`, `--hairline` |
| The gap to the control and to the window's edges | all | `--gap-6` |
| The text | all | `--text` |
| The motion | shown | `--dur-fast`, `--ease-standard` |

## Related
- `IconButton`: shows this box by itself from its `title`; never wrap one.
- `Chip`: the pickable keyword form.
- `Kbd`: when the text is the key that runs an action and should stay on the surface rather than show on hover.
