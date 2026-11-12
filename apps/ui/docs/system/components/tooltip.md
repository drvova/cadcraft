# Tooltip

## Description
It is the layer's one hint: a small box beside a control under the pointer or under keyboard focus, saying what the control does not already show. One box serves the whole window. Any element asks for it by carrying `data-hint`: the layer's components set it from their `title`, the `Tooltip` wrapper sets it on a host around another control, and a surface's own element may carry the attribute itself. It is a hint, not the control: the control keeps its own element, its own pointer, its own accessible name and its own description.

`import { Tooltip } from "../../../../src/ui/Tooltip";`, source `src/ui/Tooltip.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/button-div, trap/hover-unguarded, trap/touch-hover-flash.

### Foundation
Not applicable: hand-rolled — the hover box is measured from the running Cursor 3.27.22 (`docs/system/decisions.md`, measured 2026-10-28): the chrome fill `#141414`, radius 3, the `.15` hairline, the `0 2px 8px rgba(0,0,0,.4)` shadow, 12px type, and the arrival over 0.1s. The placement, the delay, the dismissal, the key cap and the description are the layer's own (`docs/system/decisions.md`, "The hint").

## Examples
`<Tooltip text="Outline, the current layer"><span class="layer-name">Outline</span></Tooltip>` — a hint over a control that is not a layer component.

Real uses, 1 call site (`rg -c "<Tooltip" src/components` → `src/components/LayersPanel.tsx:1`). The box itself is in use on every `IconButton`, `Button`, `Chip`, `Tab` and `Field` that has something to say, without the wrapper.
- `src/components/LayersPanel.tsx` — a layer row's hint.
- (planned) `src/components/StatusBar.tsx` — the drafting toggles carry a native `title` today; they move onto `data-hint` and `data-hint-keys` (see "Adopting the hint outside the layer").

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/tooltip/default.tsx` | default | The hint over a control of a surface's own. |
| `docs/system/examples/tooltip/in-assistant-head.tsx` | composition:AssistantPane | The full text of a clipped chat title. |
| `docs/system/examples/tooltip/in-status-bar.tsx` | composition:StatusBar | A status-bar fact whose hint opens above it, with a key as a cap. |

## Variants

One shape. The box prefers the side below the control and takes the side above with `placement="top"`; either way it flips to the other side when the preferred one has no room (a status-bar control's hint opens above it), and slides along the window's edge rather than cross it.

What the box holds comes from three attributes on the element that asks:

| Attribute | Holds | Drawn as |
|---|---|---|
| `data-hint` | The hint's text. | The first line. |
| `data-hint-keys` | The control's shortcut as the user reads it (`Ctrl+Z`, `F9`). | One `Kbd` key cap after the text. |
| `data-hint-note` | A second thought: why the control is disabled, what it will do. | A second line in the quieter ink. |
| `data-hint-placement` | `top` to prefer the side above. | — |

A control whose label is clipped by its own box (`scrollWidth` past `clientWidth`, on the element or the label directly inside it) gets its full label as the first line by itself, and what `data-hint` adds drops to the second line. A hint that only repeats the label the control shows (compared trimmed, white space collapsed), with no shortcut and no note, is not drawn.

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest | The pointer is away and keyboard focus is elsewhere, or the control's hint has nothing to add. | Use the control. | The box is `opacity: 0; visibility: hidden` and takes no pointer. | test |
| Shown | A mouse or a pen rests on the host for 0.4s (at once, and without the fade, when another hint was up within the last 0.3s), or a key moves focus onto the host (Tab, an arrow key, Home, End, Page Up, Page Down, F6). Never a finger, and never focus that arrived by a click or was handed back by a closing dialog. | Read the hint; the control keeps the pointer. | The box fades in over 0.1s beside the host, inside the window's edges. | test |
| Dismissed | Escape, a press, a click, typing, a scroll, a resize, or the window losing focus, while the box is shown or waiting to show. | Use the control; move the pointer or the focus to another control to see a hint again. | The box is gone at once and stays away while the pointer rests on the same host. | test |
| Held back | The host has its own menu or dialog open (`aria-haspopup` with `aria-expanded="true"`), or focus is inside a menu or a dialog the host is not part of. | Use the menu or the dialog. | No box. A control inside the open menu or dialog still hints. | test |

### State precedence
- Shown and Dismissed: Dismissed wins. A dismissed hint does not come back until the pointer or the focus moves to another control.
- Shown and Held back: Held back wins. No hint draws over, or behind, the popup the person is using.
- Dismissed and Held back: Not applicable: both draw nothing.
- Rest and Shown: Not applicable: the box is one or the other.
- Rest and Dismissed: Not applicable: both draw nothing.
- Rest and Held back: Not applicable: both draw nothing.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| The hint shows | input | hover / focus feedback (`--dur-fast` + `--ease-standard`) | opacity | The box appears at once: `@media (prefers-reduced-motion: reduce)` in `src/ui/ui.css` removes the transition, and so does the shell's `:root[data-animations="off"] *` rule. |
| The next hint along a row shows | input | none: the box arrives at once (`.ui-tooltip--instant`) | opacity | The same: nothing moves. |
| The hint goes away | input | none: the box leaves at once | opacity | The same: nothing moves. |

## Props
- `text`: the hint. A short fragment: "New chat", "Copy the code".
- `shortcut`: the control's shortcut as the user reads it (`Ctrl+Z`, `F9`); the box draws it as a key cap after the text. Sets `data-hint-keys` on the host.
- `placement`: the side the box prefers, `bottom` (the default) or `top`. It flips to the other side when the preferred one has no room.
- `children`: the control the hint describes. Give it its own `aria-label` or visible text — the hint is not the name. Not a layer component: those carry the hint themselves.

Beside the component, `src/ui/Tooltip.tsx` exports what a surface needs to adopt the hint without the wrapper: `installHints()` (wires the document once; every layer component calls it), `describeByHint(el, text)` (ties a hint to a control as its accessible description, from the control's `ref`), `splitHint(title)` and `ariaKeyShortcuts(keys)`.

### Adopting the hint outside the layer
A surface's own element (a status toggle, a layer key, a clipped value) moves off the native `title` in three steps, and needs no wrapper and no import unless it has a description to tie:

1. Rename `title` to `data-hint`, and take a shortcut out of the text into `data-hint-keys`: `title="Snap Mode (F9)"` becomes `data-hint="Snap Mode" data-hint-keys="F9"`. Leave no `title` behind. The attributes alone do not split a bracket: only `IconButton` and `Button` do that, for their existing call sites.
2. Settle the accessible name, which the native `title` may have been supplying. An element with no visible text (an icon key, a colour swatch) takes the same words as `aria-label`. An element whose visible text is terse (`SNAP`) takes the full words as `aria-label`. An element whose visible text is already its name takes nothing.
3. Settle the description. When the hint says more than the name and a screen-reader user needs it too (why a control is disabled, what a toggle does), tie it: `ref={(el) => describeByHint(el, () => hint())}`. When the hint is the element's own clipped text, tie nothing: the full text is already in the element, and the layer shows it by itself (`data-hint=""` is enough to opt a clipped value in). A shortcut goes on `aria-keyshortcuts={ariaKeyShortcuts("F9")}`.

A fact that is not a control (a `<span>`) takes no keyboard focus, so its hint is pointer-only: put nothing there that a keyboard user needs.

## Usage

### When to use
- A control that is not a layer component needs a short hint: a toggle with a terse face, a key with a shortcut to teach.
- A truncated value needs its full text on hover and on focus.
- A disabled control needs to say why.

### When not to use
- The control is an icon-only action. Use `IconButton` instead: its `title` already shows in this box.
- The control is already a layer component with a label. Use `Button` with its own `title` instead (and the same on `Chip`, `Tab` and `Field`): it already shows in this box.
- The text is the control's only name. Use `Button` with a visible label instead.
- The content is rich, interactive or long. Use `Row` rows inside a menu instead.

### Rules
- `rule/tooltip-not-a-name`: When a control carries a tooltip, give the control its own `aria-label` or visible text, because the box is `aria-hidden` and a control named only by its hint has 0 names for a screen reader. Evidence: single use `src/ui/Tooltip.tsx:206`, `aria-hidden="true"` on the box. Check: test `src/ui/Tooltip.test.tsx`.
  - Don't: `<Tooltip text="Close"><button>✕</button></Tooltip>`
  - Do: `<Tooltip text="Close the panel"><button aria-label="Close the panel">✕</button></Tooltip>`
- `rule/tooltip-never-blocks`: When the tooltip shows, the box keeps `pointer-events: none`, because it sits beside the control and a hint that takes the click is worse than 0 hints. Evidence: single use `src/ui/ui.css:545`, `pointer-events: none` on the box. Check: test `src/ui/recipe.test.ts`.
  - Don't: a tooltip box with a hover handler of its own.
  - Do: `pointer-events: none` on `.ui-tooltip`.
- `rule/tooltip-no-touch`: When the pointer is a finger, show 0 hints, because a finger has no hover and a tap would leave the box up over the control it just pressed. Evidence: single use `src/ui/Tooltip.tsx:290`, the `pointerType === "touch"` guard. Check: test `src/ui/Tooltip.test.tsx`.
  - Don't: a hint that carries an instruction a touch user needs ("Hold to record").
  - Do: the instruction in the control's label or beside it, and the hint only as a repeat.
- `rule/tooltip-adds`: When a hint is written for a control with a visible label, write what the label leaves out and 0 words that repeat it, because the layer draws no box for a hint equal to the label and a description equal to the name is read twice. Evidence: single use `src/ui/Tooltip.tsx:175`, the `hint === label` comparison. Check: test `src/ui/Tooltip.test.tsx`.
  - Don't: `<Tooltip text="Check connection"><button type="button">Check connection</button></Tooltip>`
  - Do: `<Tooltip text="Check the address and the key"><button type="button">Check connection</button></Tooltip>`
- `rule/tooltip-shortcut-cap`: When a hint teaches a shortcut, pass it by itself (`shortcut`, `data-hint-keys`) and keep it out of the text, because the box draws 1 key cap for it and text in brackets is read as part of the sentence. Evidence: app 9/31 icon buttons in the running shell end their title in a bracketed shortcut, which `IconButton` and `Button` still split off for them, measured in the browser 2026-11-11. Check: test `src/ui/Tooltip.test.tsx`.
  - Don't: `<button data-hint="Snap Mode (F9)" aria-label="Snap Mode">SNAP</button>`
  - Do: `<button data-hint="Snap Mode" data-hint-keys="F9" aria-label="Snap Mode" aria-keyshortcuts="F9">SNAP</button>`

### Content
- `rule/tooltip-text-fragment`: When the hint's text is written, keep it a fragment of 1 to 4 words in sentence case with no full stop ("Copy the code", not "Click here to copy."), because the box is one 24px line for a fragment and a sentence is read as a paragraph; a reason a control is disabled is the exception and is 1 sentence. Evidence: app 31/31 icon button hints in the running shell are 4 words or fewer before the bracket, measured in the browser 2026-11-11. Check: review `src/components/ToolStrip.tsx`.
  - Don't: `<Tooltip text="This button will close the assistant panel.">`
  - Do: `<Tooltip text="Close the panel">`

### Anti-slop
- `rule/tooltip-one-hint`: When a control shows this hint, keep it the control's 1 hint: move the text out of the native `title` into `text` or `data-hint`, and leave a layer component unwrapped, because two hints stack: the platform's box arrives on its own delay over the layer's, and a layer component already shows its own. Evidence: app 31/31 icon buttons in the running shell render no `title` attribute, measured in the browser 2026-11-11. Check: test `src/ui/Tooltip.test.tsx`.
  - Don't: `<Tooltip text="Snap Mode"><button title="Snap Mode (F9)">Snap</button></Tooltip>`
  - Do: `<Tooltip text="Snap Mode" shortcut="F9"><button aria-label="Snap Mode">Snap</button></Tooltip>`

### Limits
- `rule/tooltip-length-limit`: When a hint runs past 64 characters, move the explanation into the control's label or help text, because the box wraps at a 32ch measure (207px at 12px type) and a third line reads as a paragraph over the surface it covers. Evidence: measured 207px by 40px box, 2 lines, for the 46-character "To save, choose a provider or type a base URL." at 1280px and at 390px, `src/ui/ui.css:530`. Check: test `src/ui/recipe.test.ts`.
  - Don't: a 120-character hint over the composer.
  - Do: a 3-word hint and a visible line of help for the rest.

## Accessibility
The box is for the eye and is hidden from assistive tech; the same words reach a screen reader through the control. Where the hint is the control's name (an icon key), the name is on `aria-label`. Where the control has a visible label and the hint adds to it, the hint is the control's description: `describeByHint` keeps the words in a hidden line on `<body>` and points `aria-describedby` at it. `aria-describedby` rather than `aria-description`, because the second is an ARIA 1.3 draft attribute and the desktop app runs in whatever system webview the machine has (`docs/system/decisions.md`, "The hint"). The host of the wrapper is a plain `<span>`, so the child's semantics are unchanged. It meets WCAG 1.4.13 as dismissable (Escape) and persistent (it stays while the pointer or the focus does); it is not hoverable, which the criterion allows for a box that only repeats what the control's own name and description say and takes no pointer.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The control. | The box shows at once, and goes when focus leaves the host. | Stays on the control. | test |
| Escape | Anywhere, the box showing. | Puts the box away; the key is not consumed, so a surface that closes on Escape still closes. Focus the closing surface hands back raises no hint. | Unchanged. | test |
| Enter | The control, the box showing. | The control's click puts the box away. | Unchanged. | test |
| A character key | A field, the box showing. | Typing puts the box away. | Stays in the field. | test |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The box | None: `aria-hidden="true"` | — | — | Nothing | test |
| The host | None: a plain `<span>` carrying `data-hint` | — | — | Nothing | test |
| The control | Unchanged (its own role) | Its own `aria-label` or text | `aria-describedby` when `describeByHint` ties the hint; `aria-keyshortcuts` for a shortcut | Its name, then the description | test |
| The description | None: a `<span>` in the hidden `.ui-hint-descriptions` element on `<body>` | — | Referenced by `aria-describedby`; removed with its control | Read after the control's name and role | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The box | all | `--tooltip-bg`, `--tooltip-border`, `--tooltip-shadow`, `--radius-small`, `--font-label`, `--gap-8`, `--gap-3`, `--gap-16`, `--hairline` |
| The gap to the control and to the window's edges | all | `--gap-6` |
| The text | all | `--text` |
| The second line | all | `--text-dim` |
| The key cap | all | `--text-faint`, `--border-soft`, `--font-chip`, `--gap-4`, `--gap-6` |
| The motion | shown | `--dur-fast`, `--ease-standard` |

## Related
- `IconButton`: shows this box by itself from its `title`, `shortcut` and `description`; never wrap one.
- `Button`: shows this box from its `title`, which is its description; never wrap one.
- `Tab`: shows its clipped label in this box by itself.
- `Chip`: the pickable keyword form; its `title` shows here.
- `Field`: its `title` shows here and joins its description.
- `Kbd`: the key cap the box draws for a shortcut; and the pick when the key should stay on the surface rather than show on hover.
