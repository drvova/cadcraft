# Toggle

## Description
It switches one setting on or off in place, under a name that never changes, and says which it is through its pressed state.

`import { Toggle } from "../../../../src/ui/Toggle";`, source `src/ui/Toggle.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/button-div, trap/role-button, trap/native-control, trap/button-icon-name, trap/icon-optical-size, trap/icon-optical-align, trap/control-height, trap/focus-ring-shape, trap/hover-beats-focus, trap/disabled-still-hovers, trap/touch-hover-flash, trap/hover-unguarded, trap/touch-tap-highlight, trap/color-only-status, trap/toggle-switch-submit (n/a: `type="button"`, a toggle never submits), trap/toggle-indeterminate (n/a: a toggle is on or off; a value that can be mixed is a `Checkbox`), trap/weight-shift (n/a: on and off are one weight, so a word never changes width).

### Foundation
Not applicable: hand-rolled — a native `<button aria-pressed>` drawn from the layer's tokens; the two faces are the app's own measured ones (the layer list's state keys in `src/styles.css` and the status bar's drafting toggles in `src/chrome.css`, moved here value for value on 2026-11-11), and the glyphs are the app's own `src/icons.ts` paths.

## Examples
`<Toggle size="sm" tone="info" icon="layer.thawed" iconOn="layer.frozen" ariaLabel="Outline frozen" hint={frozen() ? "Thaw" : "Freeze"} pressed={frozen()} onChange={setFrozen} />` — a layer's freeze key: one name, the state in the glyph and `aria-pressed`, the action in the hint.

Real uses, 4 call sites (`rg -c "<Toggle" src/components` → `src/components/LayersPanel.tsx:3`, `src/components/StatusBar.tsx:1`):
- `src/components/LayersPanel.tsx:127` — a layer row's on key: `glyph`, `sm`, `tone="absent"` (off is the state that explains a missing layer).
- `src/components/LayersPanel.tsx:137` — the same row's frozen key: `tone="info"`.
- `src/components/LayersPanel.tsx:147` — the same row's locked key: `tone="caution"`.
- `src/components/StatusBar.tsx:171` — each of the status bar's 11 drafting settings: `text`, `sm`, the function key as `shortcut`, the hint above the bar, in a toolbar that is one Tab stop.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/toggle/default.tsx` | default | A glyph toggle that is off: the off glyph in the quiet ink. |
| `docs/system/examples/toggle/variant-glyph.tsx` | variant=glyph | The glyph face: an icon for each state, the state in the glyph and its ink. |
| `docs/system/examples/toggle/variant-text.tsx` | variant=text | The text face: a word in capitals, on as the full ink on the faintest chip. |
| `docs/system/examples/toggle/size-sm.tsx` | size=sm | The 20 by 22 cell of a list row, with the 12px glyph. |
| `docs/system/examples/toggle/size-md.tsx` | size=md | The 24px control, with the 14px glyph. |
| `docs/system/examples/toggle/tone-neutral.tsx` | tone=neutral | Neutral: on is the full ink over the quiet one. |
| `docs/system/examples/toggle/tone-absent.tsx` | tone=absent | Absent: on is the ordinary state and stays quiet; off takes the ink. |
| `docs/system/examples/toggle/tone-info.tsx` | tone=info | Info: on is a fact to notice, in the frozen ink. |
| `docs/system/examples/toggle/tone-caution.tsx` | tone=caution | Caution: on blocks something, in the locked ink. |
| `docs/system/examples/toggle/pressed.tsx` | state:pressed | The same toggle on: the on glyph in the full ink, no fill, announced pressed. |
| `docs/system/examples/toggle/disabled.tsx` | state:disabled | A blocked toggle at the disabled ink, still focusable, saying why. |
| `docs/system/examples/toggle/matrix-variant-size-tone.tsx` | matrix:variant,size,tone | Both faces at both sizes, and every tone off and on. |
| `docs/system/examples/toggle/in-layers-panel.tsx` | composition:LayersPanel | A layer row's three state keys: on, frozen, locked, each named for the layer and its flag. |
| `docs/system/examples/toggle/in-status-bar.tsx` | composition:StatusBar | The status bar's drafting settings: words in a toolbar that is one Tab stop. |

## Variants

### variant
- `glyph`: an icon that changes with the state (`icon` off, `iconOn` on), in the ink its `tone` picks; the default. Used at 3 call sites (a layer row's on, frozen and locked keys).
- `text`: a short word in capitals; on, the full ink on a chip (the `.08` fill at the control radius, 3px shorter than the line at each end and 3px clear of the word at each side); off, the quiet ink on nothing. The ink carries the state with the chip taken away (the on word measures 14.1 on its chip and the off word 6.5 on the bar, dark; 14.1 and 5.7, light; the two inks are 2.6 and 2.9 apart, where the secondary ink on the selected fill stood 1.6 and 1.5 from the off word), and a bar that holds a run of them keeps two chips 4px apart. Used at 1 call site (the status bar's drafting settings, 11 rendered).

### size
- `sm`: the cell of a dense surface. A glyph is 20px wide at the 22px row height with the 12px glyph; a word is 11px type as tall as the line that holds it (`--ui-toggle-line`, the row height when nothing sets it). Used at 4 call sites (all of them).
- `md`: the 24px control beside a field or an icon button, with the 14px glyph or 12px type; the default. Used at 0 call sites: the size for a toggle outside a list row or a bar, which no surface has yet.

### tone
- `neutral`: on is the full ink (`--text`) over the quiet one, on a glyph and on a word (the word on its chip); the default, and the only tone of a `text` face. Used at 1 call site (the status bar's settings).
- `absent`: on is the ordinary state and stays at the glyph ink; off is the one to notice and takes the ink. Used at 1 call site (a layer's on key).
- `info`: on is a fact to notice. Used at 1 call site (a layer's frozen key).
- `caution`: on blocks something. Used at 1 call site (a layer's locked key).

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest (off) | `pressed` is false. | Press it, or Tab to it and press Space or Enter, to ask for on. | The off glyph (`icon`), or the word with no chip under it; `aria-pressed="false"`. | test |
| Pressed (on) | The caller passes `pressed`. | Press it to ask for off. | The on glyph (`iconOn`) with no fill, or the chip under the word and its full ink; `aria-pressed="true"`. | test |
| Hover | The pointer is over the toggle, on a device with a hover pointer. | Press it. | The `.08` fill (on a word, drawn as its chip) and the pointer cursor; a quiet glyph steps to the full ink and a quiet word to the secondary ink, a step short of an on word's. An on word's chip steps from `.08` to `.14`. | by hand |
| Held | The pointer is held down. | Release to ask for the other state. | The `.14` fill; on an on word, whose chip is `.14` under the pointer, the `.20` one. | by hand |
| Focused | Keyboard focus arrives by Tab, or by an arrow key in a group that roves. | Space or Enter asks for the other state. | The 1px ring in the focus ink at offset -1, on the cell's edge. | by hand |
| Hinted | A mouse or a pen rests on the toggle for 0.4s (at once when another hint was up within the last 0.3s), or keyboard focus arrives. Never a finger. | Read what a press does, or the full name of a terse word, and the shortcut. A press, a click or Escape puts the box away. | The layer's hint box holding `hint`, the `shortcut` as a key cap and the `description` on a second line. | test |
| Disabled | The caller passes `disabled`. | Tab to it and read its hint and why it is blocked (`description`). No press by pointer, Enter or Space, and no fill under the pointer. | The face at the disabled ink; an on word keeps a chip at the `.08` fill; the default cursor; `aria-disabled="true"`. | test |

### State precedence
- Pressed and Hover: both show. An on glyph keeps its ink and gains the fill; an on word keeps its ink and its chip steps up to the `.14` fill.
- Rest and Hover: both show. The fill arrives, and the quiet ink steps up (a glyph to the full ink, a word to the secondary ink, so an off word under the pointer is never drawn as an on word at rest); an `absent` toggle that is off keeps its own ink, which is the state.
- Held and Hover: Held wins. The `.14` fill replaces the `.08` one while the pointer is down (`.20` replaces `.14` on an on word).
- Held and Pressed: both show. The on face stays while the fill is held.
- Focused and Hover: both show. The ring stays drawn while the fill steps.
- Focused and Pressed: both show. The ring is on the cell's edge and the state is in the face.
- Focused and Held: both show. The ring stays drawn while the toggle is held down.
- Hinted and Held: Held wins. The press puts the hint away.
- Hinted and Hover: both show. The hint follows the hover after its delay.
- Hinted and Focused: both show. The hint arrives with the ring, with no delay.
- Hinted and Pressed: both show. The hint says what a press does now, in either state.
- Hinted and Disabled: both show. A disabled toggle still says what it is for, and why it is blocked when it has a `description`.
- Disabled and Hover: Disabled wins. No fill and no ink change under the pointer.
- Disabled and Held: Disabled wins. No fill, and the press is refused.
- Disabled and Pressed: both show. The on glyph stays at the disabled ink, or the word keeps a chip at the `.08` fill, and `aria-pressed` still says the state.
- Disabled and Focused: both show. A disabled toggle takes focus and the ring, so a keyboard user can reach its hint; Enter and Space do nothing.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| The pointer enters, presses or leaves, or the state changes | input | hover / focus feedback (`--dur-fast` + `--ease-standard`) | background-color, color | The fill and the ink change at once: the shell's `:root[data-animations="off"] *` rule removes the transition (the chip's too). The glyph swaps at once in every setting. |

## Props
- `pressed`: whether the setting is on; the caller holds it. Sets `aria-pressed`.
- `onChange`: runs with the state a press asks for. The toggle then shows what `pressed` says, so a change the caller refuses does not stay drawn.
- `onClick`: runs on click, before `onChange`; a disabled toggle never fires either.
- `variant`: the face; defaults to `glyph`.
- `icon`: the glyph shown while off (and while on, when `iconOn` is not given): an id from `src/icons.ts`.
- `iconOn`: the glyph shown while on.
- `tone`: which state is the one to notice, and its ink; defaults to `neutral`. A `text` face is always `neutral`.
- `size`: the box; defaults to `md`.
- `ariaLabel`: the fixed accessible name: the setting, never the action. Required on a `glyph`; on a `text` face, the full name when the word is short for it.
- `hint`: the layer's hint, for the eye only: what a press does now, or the full name of a terse word. It is not exposed to assistive tech, which has the name and the state. No native `title` attribute is rendered.
- `shortcut`: the shortcut that flips the same setting, as the user reads it (`F9`): a key cap in the hint and `aria-keyshortcuts` on the button.
- `description`: a second line under the hint, tied to the toggle as its accessible description (`aria-describedby`): why it is disabled.
- `placement`: the side the hint prefers (`top`, `bottom`); it flips by itself when that side has no room.
- `disabled`: blocks the press and drops the face to the disabled ink. It sets `aria-disabled="true"`, never the native `disabled`, so the toggle stays in the Tab order and its hint still shows.
- `tabIndex`: the toggle's place in the Tab order, for a group that is one Tab stop. Unset writes no attribute, so a container that roves through the element (`rovingBand`) is not undone.
- `children`: the word of a `text` face.

## Usage

### When to use
- A setting of the thing in front of the person is on or off and takes effect the moment it is pressed: a layer is frozen, the grid is shown.
- Several such settings repeat down a list or along a bar: glyphs down a list, where a fill on each would be a column of fills, or short words along a bar, where the ones that are on are chips.

### When not to use
- The value is applied with a form, or can be mixed across several objects. Use `Checkbox` instead.
- The glyph runs an action, opens a menu or folds a region. Use `IconButton` instead.
- One switch on a tool bar should read as lit while on, with a fill. Use `IconButton` with `selected` instead.
- The control brings one view of several to the front. Use `Tab` instead.

### Rules
- `rule/toggle-name-fixed`: When a toggle is rendered, pass 1 `ariaLabel` that names the setting and is the same string in both states, and put the action in `hint`, because `aria-pressed` already says the state, and a name that flips between Freeze and Thaw is heard as 2 different buttons. Evidence: app 3/3 layer state keys, `src/components/LayersPanel.tsx`. Check: test `src/ui/Toggle.test.tsx`.
  - Don't: `<Toggle icon="layer.thawed" iconOn="layer.frozen" ariaLabel={frozen() ? "Thaw Outline" : "Freeze Outline"} pressed={frozen()} />`
  - Do: `<Toggle icon="layer.thawed" iconOn="layer.frozen" ariaLabel="Outline frozen" hint={frozen() ? "Thaw" : "Freeze"} pressed={frozen()} />`
- `rule/toggle-state-in-face`: When a glyph toggle is rendered, pass 2 icons (`icon` for off, `iconOn` for on), because a glyph toggle draws no fill at rest and the ink alone would carry the state by colour only. Evidence: app 3/3 layer state keys pass both, `src/components/LayersPanel.tsx`. Check: review `src/components/LayersPanel.tsx`.
  - Don't: `<Toggle icon="layer.locked" tone="caution" ariaLabel="Outline locked" pressed={locked()} />`
  - Do: `<Toggle icon="layer.unlocked" iconOn="layer.locked" tone="caution" ariaLabel="Outline locked" pressed={locked()} />`
- `rule/toggle-owns-nothing`: When `onChange` runs, set the caller's own value from its argument (or refuse it), because the toggle draws from `pressed` after every press and keeps 0 state of its own. Evidence: single use `src/ui/Toggle.tsx:97`, the `aria-pressed` the prop sets. Check: test `src/ui/Toggle.test.tsx`.
  - Don't: `<Toggle icon="eye-off" iconOn="eye" ariaLabel="Preview" pressed={false} onChange={() => save()} />`
  - Do: `<Toggle icon="eye-off" iconOn="eye" ariaLabel="Preview" pressed={preview()} onChange={setPreview} />`
- `rule/toggle-tone-meaning`: When a `tone` is passed, pick it by which state the person must notice (`absent` for off, `info` or `caution` for on) and pass 1 tone per setting across the whole list, because the tone is the only colour in the column and a tone picked for looks makes 2 rows of the same setting read as different things. Evidence: app 3/3 layer state keys, each with its own tone on every row, `src/components/LayersPanel.tsx`. Check: review `src/components/LayersPanel.tsx`.
  - Don't: `<Toggle tone="caution" icon="layer.off" iconOn="layer.on" ariaLabel="Outline on" pressed={on()} />` — on is the ordinary state, and it would be drawn as a warning on every row.
  - Do: `<Toggle tone="absent" icon="layer.off" iconOn="layer.on" ariaLabel="Outline on" pressed={on()} />`
- `rule/toggle-group-one-stop`: When more than 3 toggles stand in one bar, give the bar `role="toolbar"` with a name and make it 1 Tab stop (the container sets each `tabIndex`; the arrows, Home and End move), because 11 Tab stops in the status bar stand between the drawing and everything after it. Evidence: single use `src/components/StatusBar.tsx:168`, the toolbar that roves its 11 toggles. Check: review `src/components/StatusBar.tsx`.
  - Don't: `<div class="status-toggles"><Toggle variant="text" pressed={grid()}>Grid</Toggle>…</div>` with 11 Tab stops.
  - Do: `<div class="status-toggles" role="toolbar" aria-label="Drafting settings" ref={(el) => rovingBand(el, "button")}>…</div>`
- `rule/toggle-no-native-title`: When a toggle is styled or wrapped, add 0 hints of its own (no `title` attribute set from outside, no `Tooltip` around it), because the component already shows `hint` in the layer's hint box and a second hint stacks on the first. Evidence: app 38/38 toggles in the running shell render no `title` attribute, measured in the browser 2026-11-11. Check: test `src/ui/Toggle.test.tsx`.
  - Don't: `<Tooltip text="Thaw"><Toggle icon="layer.thawed" iconOn="layer.frozen" ariaLabel="Outline frozen" pressed /></Tooltip>`
  - Do: `<Toggle icon="layer.thawed" iconOn="layer.frozen" ariaLabel="Outline frozen" hint="Thaw" pressed />`
- `rule/toggle-disabled-reason`: When a toggle is disabled by something the person can change, pass the reason as `description` in 1 short sentence, because the disabled toggle stays focusable for exactly this, and `hint` is not exposed to a screen reader. Evidence: single use `src/ui/Toggle.tsx:91`, the description tied to the button. Check: test `src/ui/Toggle.test.tsx`.
  - Don't: `<Toggle disabled icon="layer.thawed" ariaLabel="Outline frozen" hint="The current layer cannot be frozen" pressed={false} />`
  - Do: `<Toggle disabled icon="layer.thawed" ariaLabel="Outline frozen" hint="Freeze" description="The current layer cannot be frozen" pressed={false} />`

### Content
- `rule/toggle-label-setting`: When `ariaLabel` is written, name the setting as a noun phrase of 1 to 4 words that is true while the toggle is pressed (Outline frozen, Snap mode), in sentence case, because it is read with "pressed" or "not pressed" after it, and a verb there reads as a command. Evidence: app 14/14 toggle names in the layer list and the status bar, `src/components/StatusBar.tsx`. Check: review `src/components/StatusBar.tsx`.
  - Don't: `ariaLabel="Freeze the layer"`
  - Do: `ariaLabel="Outline frozen"`
- `rule/toggle-text-short`: When a `text` face is written, pass 1 word of at most 6 letters and the full name as `ariaLabel` and `hint`, because the bar holds 11 of them on one line at 1280 wide and the capitals are tracked. Evidence: app 11/11 status toggles ("Grid" to "OTrack", 2 to 6 letters), `src/components/StatusBar.tsx`. Check: review `src/components/StatusBar.tsx`.
  - Don't: `<Toggle variant="text" pressed={on()}>Object snap tracking</Toggle>`
  - Do: `<Toggle variant="text" ariaLabel="Object snap tracking" hint="Object snap tracking" pressed={on()}>OTrack</Toggle>`

### Anti-slop
- `rule/toggle-canonical-element`: When a surface needs an on-off key, render `Toggle` rather than a raw `<button aria-pressed>` with its own class, because the 2 replaced families (`.toggle`, `.status-toggle`) each carried their own hover, ring and state inks and neither had a disabled state or a touch target. Evidence: app 4/4 raw `aria-pressed` buttons in `src/components/LayersPanel.tsx` and `src/components/StatusBar.tsx` before 2026-11-11. Check: lint `node scripts/check-system.mjs --root .`.
  - Don't: `<button class="toggle is-frozen" type="button" aria-pressed="true" aria-label="Outline frozen">…</button>`
  - Do: `<Toggle size="sm" tone="info" icon="layer.thawed" iconOn="layer.frozen" ariaLabel="Outline frozen" pressed />`
- `rule/toggle-no-fill`: When a toggle should look on, pass `pressed` and add 0 background rules of the surface's own, because the glyph and its ink, or the word's own chip, already says so, and 1 fill per pressed glyph turns a list where nearly every row is on into a column of fills (an on word's chip is the component's own `::before`, never the surface's). Evidence: measured 0 fills on the 38 toggle buttons of the running shell, in both states, 2026-11-11. Check: test `src/ui/recipe.test.ts`.
  - Don't: `.layer-toggles .ui-toggle[aria-pressed="true"] { background: var(--fill-active) }`
  - Do: `<Toggle tone="info" icon="layer.thawed" iconOn="layer.frozen" ariaLabel="Outline frozen" pressed />`

### Limits
- `rule/toggle-touch-target`: When 2 `sm` glyph toggles sit side by side, keep at least 4px between them under a coarse pointer, because each 20px by 22px cell keeps its drawn size there and takes a 24px by 24px target from an invisible `::after`, and cells closer than 4px overlap their targets. Evidence: measured 20px by 22px cell, `src/ui/ui.css:1567`. Check: review `src/styles.css`.
  - Don't: `.layer-toggles { gap: 0 }` on a touch screen.
  - Do: `@media (pointer: coarse) { .layer-toggles { gap: var(--gap-4) } }`
- `rule/toggle-line-height`: When `sm` text toggles stand in a bar whose line is not 22px, set `--ui-toggle-line` on their container to the bar's line, because the word's target is the whole line and a 22px toggle in a 21px line makes the bar 1px taller. Evidence: measured 21px toggles in the 22px status bar under its 1px rule, in the browser, 2026-11-11. Check: review `src/chrome.css`.
  - Don't: `.status-toggles .ui-toggle { height: 21px }`
  - Do: `.status-toggles { --ui-toggle-line: var(--status-line) }`

## Accessibility
Rests on the native `<button>` element with `aria-pressed`, the drawn glyph hidden from assistive tech. Disabled is the layer's own, shared with `Button` and `IconButton`: `aria-disabled="true"` with the click refused on the button itself (`docs/system/decisions.md`, "Disabled controls"). The state is never colour alone: the glyph changes, or the word's chip appears.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | The toggle, in document order; in a group that roves, the group's one stop. | Moves focus to it; the ring draws and the hint shows at once. | On the toggle. | by hand |
| Space | The focused toggle. | Asks for the other state on release; `onChange` runs once. | Stays on the toggle, which is the same element in both states. | by hand |
| Enter | The focused toggle. | Asks for the other state. | Stays on the toggle. | test |
| Left, Right, Home, End | A toggle in a toolbar whose container roves (`rovingBand`). | The container moves focus along the group; the toggle itself handles no arrow. | On the toggle moved to, which becomes the group's Tab stop. | by hand |
| Tab (disabled) | A disabled toggle, in document order. | Moves focus to it, as to any toggle; its hint shows. | On the toggle. | by hand |
| Enter or Space (disabled) | The focused disabled toggle. | Nothing: the click is refused before any handler hears it. | Stays on the toggle. | test |
| Escape | The focused or hovered toggle, its hint showing. | Puts the hint away; the key is not consumed. | Stays on the toggle. | by hand |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The toggle (`glyph`) | `button` (native) | `aria-label` (`ariaLabel`) | `aria-pressed` always, `"true"` or `"false"`; `aria-keyshortcuts` with `shortcut`; `aria-describedby` pointing at the `description`'s words; `aria-disabled="true"` when blocked | "Outline frozen, toggle button, pressed" / "Outline frozen, toggle button, not pressed" | test |
| The toggle (`text`) | `button` (native) | `aria-label` when passed, else the word | The same | "Snap mode, toggle button, not pressed, F9" | test |
| The hint | None: the box is `aria-hidden="true"` | Not exposed | It is for the eye: the action, or the name already on `aria-label` | Nothing | test |
| The glyph | `svg` with `aria-hidden="true"` | Not exposed | Hidden from the accessibility tree | Nothing: the name is the button's | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The cell (`glyph`, `sm`) | all | `--control-h-chip`, `--control-h-row`, `--radius-small` |
| The cell (`glyph`, `md`) | all | `--control-h-input`, `--radius-small` |
| The glyph | all | `--icon-size-sm` (`sm`), `--icon-size-md` (`md`) |
| The word (`sm`) | all | `--font-chip`, `--font-family`, `--leading-ui` (the text's line), `--gap-3` (the word's inset in its chip), `--control-h-row` (the box's height, when the container sets no `--ui-toggle-line`) |
| The word (`md`) | all | `--font-label`, `--gap-6`, `--control-h-input` |
| The face | off | `--text-faint` |
| The face | on (`neutral`: a glyph or a word), and a glyph under the pointer | `--text` |
| The word | off, under the pointer or held | `--text-dim` |
| The word's chip | on | `--hover`, `--radius-control`, `--gap-3` (its inset from the line's ends; `--gap-4` under a coarse pointer) |
| The word's chip | on, under the pointer | `--fill-active` |
| The word's chip | on, held | `--fill-pressed` |
| The word's chip | on, disabled | `--hover` |
| The glyph (`absent`) | on | `--icon` |
| The glyph (`absent`) | off | `--icon-layer-off` stepped toward `--text` (dark); `--text-dim` (light) |
| The glyph (`info`) | on | `--icon-layer-frozen` (dark); `--text-accent` (light) |
| The glyph (`caution`) | on | `--icon-locked` (dark); `--warn` stepped toward `--text` (light) |
| The fill | hover | `--hover` |
| The fill | held | `--fill-active` |
| The face | disabled | `--text-disabled` |
| The ring | focus-visible | `--focus-outline-w`, `--focus-ring`, `--focus-outline-offset` |
| The motion | hover, held, change | `--dur-fast`, `--ease-standard` |
| The target | coarse pointer | `--control-h-input`, `--gap-8`, `--gap-6` |

## Related
- `IconButton`: when the glyph runs an action, or one switch on a tool bar should read lit (`selected`).
- `Checkbox`: when the yes-or-no is a form's value, or can be mixed.
- `Tab`: when the control picks one view of several.
- `Tooltip`: the hint box this component shows by itself; wrap another control in it, never this one.
- `Kbd`: the key cap the hint draws for a shortcut.
- `Row`: the list row a column of small glyph toggles sits beside; a row never nests them.
- `Dialog`: where a setting's details are edited; the toggle only switches it.
