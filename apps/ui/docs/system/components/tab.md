# Tab

## Description
It brings one view of a strip to the front: a layout over the drawing or a chat in the assistant, marked selected when it is the one showing.

`import { Tab } from "../../../../src/ui/Tab";`, source `src/ui/Tab.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/button-div, trap/role-button, trap/native-control, trap/current-unmarked, trap/control-height, trap/focus-ring-shape, trap/hover-beats-focus, trap/touch-hover-flash, trap/hover-unguarded, trap/link-wraps-button (n/a: a tab is never a link; the close key is a sibling button, not a nested one), trap/disabled-still-hovers (n/a: a tab has no disabled state).

### Foundation
Not applicable: hand-rolled — the editor tab (13px type on a 12px inset in the 35px strip, the active one filled with `--tab-active`, the `.08` fill on hover, a hairline between tabs) is measured from the running Cursor 3.27.22 (`docs/system/decisions.md`), and no registry item ships it. It replaces two hand-built tabs: the raw `<button class="layout-tab" role="tab">` of the layout strip, and a `Row` in a width cell beside a close `IconButton` in the assistant's header.

### Parts
- `TabPanels` (the same file) is the whole tabs pattern for views that swap in place, a dialog's pages: a `role="tablist"` strip of `sm` tabs named by `ariaLabel`, and one `role="tabpanel"` per tab, tied both ways (`aria-controls`, `aria-labelledby`). The caller passes `panels` (`{ id, label, content }`), the `selected` id and `onChange(id)`. The strip is one Tab stop; Left, Right, Home and End move the focus and bring that page to the front at once (automatic activation: a page is already built, so showing it costs nothing, where the layout strip switches only on Enter because a switch redraws the drawing). A page behind is `hidden`, not removed, so a field keeps what was typed in it. Used at 1 call site, `src/components/DraftingSettings.tsx:259`.

## Examples
`<Tab selected onClick={show}>Model</Tab>` — the model-space tab over the drawing.

Real uses, 4 call sites (`rg -c "<Tab" src/components` → `src/components/AssistantPane.tsx:4`, `src/components/StatusBar.tsx:1`):
- `src/components/StatusBar.tsx:80` — `LayoutTabs`, the editor tabs over the drawing (`size="md"`): Model, then each layout; `selected` marks the space in front, `title` says what the tab switches to.
- `src/components/AssistantPane.tsx:630` — the chat tabs in the assistant's header when more than one chat is open (`size="sm"`): `selected` marks the chat in front, `onClose` closes that chat, `closeLabel` names it ("Close hello"), `title` carries the full chat title when the label clips.
- The menu titles in `src/components/MenuBar.tsx` stay native buttons: they open menus, a different role.
- The status bar's drafting toggles in `src/components/StatusBar.tsx` are `Toggle`: a drafting toggle is an `aria-pressed` switch, not a tab.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/tab/default.tsx` | default | One editor tab at rest. |
| `docs/system/examples/tab/size-md.tsx` | size=md | The editor tab of the 35px strip. |
| `docs/system/examples/tab/size-sm.tsx` | size=sm | The compact tab of a pane header, with its close key. |
| `docs/system/examples/tab/selected.tsx` | state:selected | The tab in front at the active fill, announced as selected. |
| `docs/system/examples/tab/in-layout-tabs.tsx` | composition:LayoutTabs | The layout strip over the drawing: Model in front, two layouts behind. |
| `docs/system/examples/tab/in-tab-panels.tsx` | composition:TabPanels | `TabPanels`: a strip of compact tabs over the panels they show, one Tab stop, walked with the arrow keys. |

## Variants

### size
- `sm`: the compact tab of a pane header: the 22px row height, 11.5px type, a 4px-radius fill, clipped at 18ch; selected, it takes the layer's selected fill `--fill-active` (the fill `Row` gives its current row), because the pane's own surface is `--tab-active`. Used at 1 call site (the assistant's chat tabs).
- `md`: the editor tab; the default: it fills its strip's height (the strip is the 35px band), 13px type on a 12px inset, a hairline on its right, clipped at 24ch; selected, it takes `--tab-active`. Used at 1 call site (the layout tabs over the drawing).

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest | Nothing is over the tab and it is not the one in front. | Click it, or Tab to it. | The label at the quiet ink on no fill; `aria-selected="false"`. | test |
| Hover | The pointer is over a tab that is not in front, on a device with a hover pointer. | Click it. | Pointer only, colour change: the `.08` fill and the full ink; the cursor is a pointer. | by hand |
| Pressed | The pointer is held down. | Release to bring the tab to the front. | Nothing beyond hover: a tab's press runs on release. | by hand |
| Focused | Keyboard focus arrives by Tab. | Enter or Space brings the tab to the front. | The 1px ring in the focus ink at offset -1. | by hand |
| Selected | The caller passes `selected` (the tab in front). | Read it; move to another tab; close it when it has a close key. | `aria-selected="true"`; the selected fill (`--tab-active` on `md`, `--fill-active` on `sm`) and the full ink. | test |
| Closable | The caller passes `onClose`. | Click the close key, or Tab to it and press Enter. | A trailing close glyph in its own 20px button, named by `closeLabel`. | test |
| Hinted | The label is clipped, or the caller passes a `title` that says more than the label; and a mouse or a pen rests on the tab for 0.4s (at once when another hint was up within the last 0.3s), or a key moves focus onto it. Never a finger. | Read the full label and what the tab switches to; a press, a click or Escape puts the box away. | The layer's hint box: the full label when it is clipped, the `title` under it or by itself, below the tab, inside the window's edges. | test |

### State precedence
- Hinted and Hover: both show. The hint follows the hover after its delay.
- Hinted and Focused: both show. The hint arrives with the ring, with no delay.
- Hinted and Pressed: Pressed wins. The press puts the hint away.
- Hinted and Selected: both show. The tab in front hints like any other.
- Hinted and Closable: both show. The close key shows its own hint (`closeLabel`) when the pointer or the focus is on it.
- Hover and Selected: Selected wins. The active fill stays under the pointer; hover adds nothing to the tab in front.
- Hover and Focused: both show. The ring stays drawn over the hover fill.
- Selected and Focused: both show. The ring draws around the active fill.
- Pressed and Focused: both show. The ring stays drawn while the tab is held down.
- Closable and Selected: both show. Every closable tab keeps its close key, in front or behind.

### Motion
| Trigger | Kind | Preset | Properties | Reduced motion |
|---|---|---|---|---|
| The pointer enters or leaves | input | hover / focus feedback (`--dur-fast` + `--ease-standard`) | background-color, color | The fill and ink change at once: the shell's `:root[data-animations="off"]` rule removes the transition. |
| The tab comes to the front or goes behind | input | hover / focus feedback (`--dur-fast` + `--ease-standard`) | background-color, color | The fill and ink change at once, by the same rule. |

## Props
- `selected`: the tab in front; sets `aria-selected="true"` (and `"false"` otherwise) and the selected fill of its size.
- `size`: `sm` or `md`; defaults to `md`.
- `title`: the hint, shown in the layer's hint box and tied to the tab as its accessible description (`aria-describedby`): what the tab switches to. It is never the name, and no native `title` attribute is rendered. A `title` equal to the label draws no hint and adds no description. A clipped label needs no `title`: the hint shows the full label by itself, with the `title` on a second line when it says more.
- `onClick`: runs on click; the caller brings this tab to the front.
- `onClose`: draws the trailing close key and runs when it is clicked; the tab's `onClick` does not run.
- `closeLabel`: the close key's accessible name and tooltip; defaults to "Close".
- `id`: the tab's own `id`, for the panel it shows to name it (`aria-labelledby`).
- `controls`: the `id` of the panel the tab shows; sets `aria-controls`.
- `tabIndex`: for a strip that is one Tab stop, `0` on the tab in front and `-1` on the others; unset, no attribute is written and every tab is a Tab stop.
- `children`: the tab's label.

## Usage

### When to use
- Several views share one area and one shows at a time: the model space and the layouts over the drawing, the open chats in the assistant.
- The view in front must be marked for a screen reader as well as the eye.

### When not to use
- The control runs an action rather than showing a view. Use `Button` instead.
- The item is one band of a full-width list (a layer, a menu item, a command). Use `Row` instead.
- The control flips a setting on and off (a drafting toggle). Use `IconButton` with `selected` instead.
- The label is a short fact with no view behind it. Use `Chip` instead.

### Rules
- `rule/tab-selected-marked`: When a strip has a tab in front, pass `selected` on it, because the fill alone is colour and a screen reader needs `aria-selected="true"` to hear which view shows. Evidence: app 2/2 strips mark the tab in front, `src/components/StatusBar.tsx:57` and `src/components/AssistantPane.tsx:605`. Check: test `src/ui/Tab.test.tsx`.
  - Don't: `<Tab onClick={show}>Model</Tab>` for the tab whose view is showing.
  - Do: `<Tab selected onClick={show}>Model</Tab>`
- `rule/tab-in-tablist`: When tabs are rendered, place them in 1 container carrying `role="tablist"` and an `aria-label`, because a `tab` role outside a `tablist` is announced without its strip and its position. Evidence: app 2/2 strips, `src/components/StatusBar.tsx:54` and `src/components/AssistantPane.tsx:687`. Check: review `src/components/StatusBar.tsx`.
  - Don't: `<div class="editor-tabs"><Tab selected>Model</Tab></div>`
  - Do: `<div class="editor-tabs" role="tablist" aria-label="Views"><Tab selected>Model</Tab></div>`
- `rule/tab-close-sibling`: When a tab can be closed, pass `onClose` rather than putting a button in the tab's children, because a `<button>` cannot nest a `<button>` and `Tab` renders the close key as a sibling. Evidence: single use `src/components/AssistantPane.tsx:560`, the one closable strip. Check: test `src/ui/Tab.test.tsx`.
  - Don't: `<Tab onClick={show}>hello<IconButton icon="close" title="Close hello" onClick={close} /></Tab>`
  - Do: `<Tab onClick={show} onClose={close} closeLabel="Close hello">hello</Tab>`

### Content
- `rule/tab-close-label-names`: When `onClose` is passed, pass `closeLabel` as "Close" plus the tab's label ("Close hello"), because 2 close keys both named "Close" in one strip cannot be told apart by a screen reader. Evidence: single use `src/components/AssistantPane.tsx:551`. Check: review `src/components/AssistantPane.tsx`.
  - Don't: `<Tab onClose={close}>hello</Tab>` in a strip of 2 closable tabs.
  - Do: `<Tab onClose={close} closeLabel="Close hello">hello</Tab>`

### Anti-slop
- `rule/tab-canonical-element`: When a surface needs a tab, render `Tab` rather than a raw `<button role="tab">` with its own class or a `Row` in a width cell, because the 2 replaced recipes painted 2 different selected fills and only 1 of them set `aria-selected`. Evidence: app 2/2 hand-built tabs replaced (`.layout-tab` and `.assistant-tab-row`), `src/components/StatusBar.tsx:57` and `src/components/AssistantPane.tsx:497`. Check: review `src/ui/Tab.tsx`.
  - Don't: `<button class="layout-tab is-active" role="tab">Model</button>`
  - Do: `<Tab selected>Model</Tab>`

### Limits
- `rule/tab-label-limit`: When an `sm` tab's label runs past 18 characters, pass the whole label as the children and leave the shortening to the tab, because the tab clips at `max-width: 18ch` with an ellipsis (the 20-character "Summarise the layers" shows as "Summarise the la…") and shows the full label in its hint by itself, while a label cut by the caller has no full text anywhere. Evidence: measured 111.6px clipped `sm` tab at 1280px, `src/ui/ui.css:1224`. Check: test `src/ui/Tab.test.tsx`.
  - Don't: `<Tab size="sm">{title.slice(0, 16) + "…"}</Tab>` — the cut label has no full text anywhere.
  - Do: `<Tab size="sm">Summarise the layers</Tab>`
- `rule/tab-md-label-limit`: When an `md` tab's label runs past 24 characters, pass the whole label as the children and leave the shortening to the tab, because the tab clips at `max-width: 24ch` with an ellipsis and shows the full label in its hint by itself, and uncapped the 56-character "A1 Ground floor general arrangement plan, sheet 12 of 40" draws a 357.8px tab that pushes the other layouts out of the strip. Evidence: measured 168.2px clipped `md` tab at 1280px, `src/ui/ui.css:1213`. Check: test `src/ui/Tab.test.tsx`.
  - Don't: `<Tab title="A1 Ground floor general arrangement plan, sheet 12 of 40">A1 Ground floor…</Tab>` — the label a screen reader hears is the cut one.
  - Do: `<Tab>A1 Ground floor general arrangement plan, sheet 12 of 40</Tab>`
- `rule/tab-touch-target`: When `sm` tabs are laid out in a pane header, leave the header room for a 24px tab, because under a coarse pointer the 22px tab grows to the 24px control height (it clips its own overflow for the ellipsis, so it cannot take an overhanging target) and a header fixed at 22px would cut it. Evidence: measured 22px `sm` tab, 24px under a coarse pointer, `src/ui/ui.css:1586`. Check: review `src/ui/ui.css`.
  - Don't: `.my-head { height: var(--control-h-row); overflow: hidden }`
  - Do: `.my-head { min-height: var(--control-h-button); align-items: center }`

## Accessibility
Rests on the native `<button>` element with `role="tab"`: Enter and Space and focus come from the platform. A bare `Tab` stays in the tab order and has no arrow-key handler of its own: the caller owns the `tablist` container and its walk (the layout strip roves from its container), and wires a `tabpanel` through `id` and `controls` when it has one. `TabPanels` does all of it: one Tab stop, the arrow keys, Home and End, and a `tabpanel` per tab.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | A tab, in document order. | Moves focus to the next tab, then to that tab's close key when it has one. | On the next stop. | by hand |
| Enter | The focused tab. | Brings the tab to the front. | Stays on the tab. | by hand |
| Space | The focused tab. | Brings the tab to the front on release. | Stays on the tab. | by hand |
| Enter | The focused close key. | Runs `onClose`; the tab's `onClick` does not run. | The caller decides: the closed tab leaves the strip. | by hand |
| ArrowRight | The focused tab, bare. | Nothing from the tab: a strip's walk is its container's. | Stays on the tab. | by hand |
| ArrowRight, ArrowLeft | A tab of a `TabPanels`. | Asks for the next or the previous page, wrapping at the ends, and shows it. | On that page's tab. | test |
| Home, End | A tab of a `TabPanels`. | Asks for the first or the last page and shows it. | On that page's tab. | test |
| Tab | A tab of a `TabPanels`. | Leaves the strip: the tabs behind are not Tab stops. | The first control of the page in front. | by hand |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The tab | `tab` (on a native `<button>`) | Its text content, in full even when the tab clips it for the eye | `aria-selected="true"` on the tab in front, `"false"` on the others; `aria-describedby` pointing at the `title`'s words when they add to the label | "Model, tab, selected, Switch to model space" | test |
| The hint | None: the box is `aria-hidden="true"` | — | It shows the full label and the description for the eye | Nothing | test |
| The close key | `button` (native, an `IconButton`) | `closeLabel` as `aria-label` | none | "Close hello, button" | test |
| The strip of a `TabPanels` | `tablist` | `ariaLabel` | none | "Drafting settings, tab list" | test |
| A panel of a `TabPanels` | `tabpanel` | Its tab, through `aria-labelledby` | `hidden` while its tab is behind; its tab names it back with `aria-controls` | "Polar Tracking, tab panel" on entering it | test |

## Tokens
| Part | State | Token |
|---|---|---|
| The label | rest | `--text-faint`, `--font-family`, `--leading-ui` |
| The tab | md | `--control-h-tab`, `--gap-12`, `--font-body`, `--hairline`, `--border-soft` |
| The tab | sm | `--control-h-row`, `--gap-6`, `--font-small`, `--radius-card` |
| The fill | hover | `--hover` |
| The label | hover | `--text` |
| The fill | selected, md | `--tab-active` |
| The fill | selected, sm | `--fill-active` |
| The label | selected | `--text` |
| The ring | focus-visible | `--focus-outline-w`, `--focus-ring`, `--focus-outline-offset` |
| The motion | hover, selected | `--dur-fast`, `--ease-standard` |
| The tab | sm, coarse pointer | `--control-h-input` |
| The strip of a `TabPanels` | all | `--gap-2`, `--gap-8`, `--gap-12`, `--hairline`, `--border-soft` |

## Related
- `Row`: when the item is one band of a full-width list rather than one view of a strip.
- `IconButton`: the close key a closable tab draws; and the pick for an on/off toggle.
- `Button`: when the control runs an action rather than showing a view.
- `Kbd`: when a tab's action has a shortcut to show beside it.
- `Tooltip`: the hint box a tab's `title` and its clipped label show in; never wrap a tab in one.
- `Select`: when the choice is one value of a field rather than one view of a strip.
