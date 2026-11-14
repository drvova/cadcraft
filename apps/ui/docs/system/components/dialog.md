# Dialog

## Description
It holds one task over the page until the task is finished or put away: a titled box of fields with its actions in a footer, while the page behind takes no input.

`import { Dialog } from "../../../../src/ui/Dialog";`, source `src/ui/Dialog.tsx`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/overlay-conditional-render, trap/native-control, trap/button-div, trap/role-button, trap/button-icon-name, trap/button-type, trap/field-form-enter, trap/touch-autofocus, trap/viewport-height, trap/focus-ring-shape, trap/overflow-scrollbar, trap/label-unbound (n/a: the dialog draws no label; a caller's fields bring their own), trap/motion-ease-in-enter (n/a: the dialog arrives and leaves without motion), trap/hover-unguarded (n/a: the box has no hover state; its close key is an `IconButton`).

### Foundation
Not applicable: hand-rolled — a native `<dialog>` opened with `showModal()` (`src/ui/Dialog.tsx:103`), so the focus trap, Escape, the inert page and the top layer are the platform's. The box is the command palette's recipe (`--surface-elevated`, `--border`, `--radius-block`, `--shadow-popover`, `src/palette.css:37`), and no registry item ships it. It replaces nothing: the web interface had no dialog before it (`docs/system/decisions.md`, "A task over the page").

### Parts
- The title bar: the title, an `<h2>` that is the dialog's accessible name, and the close key, an `IconButton`.
- The body: the caller's children, in a box that scrolls by itself.
- The footer: the caller's `Button`s, drawn only when `footer` is passed.
- `TabPanels` (`src/ui/Tab.tsx`, documented in `tab.md`) is the layer's composition for a dialog with pages.

## Examples
`<Dialog open={open()} title="Rename Layout" size="sm" onClose={() => setOpen(false)} footer={…}>…</Dialog>` — one field and its two actions (`docs/system/examples/dialog/default.tsx`).

Real uses, 7 call sites (`rg -c "<Dialog" src` → `src/components/DraftingSettings.tsx:1`, `src/components/JewelryDialog.tsx:2`, `src/components/LayerManager.tsx:1`):
- `src/components/JewelryDialog.tsx` — the Ring and Gem dialogs (Draw ▸ Ring, Draw ▸ Gem and the tool strip's keys): a form of the piece's numbers, a read-out of what the engine says about them, Cancel and OK in the footer; a refusal from the engine stays in the dialog beside the field it names. Added 2026-11-12.
- `src/components/DraftingSettings.tsx:237` — Drafting Settings (`size="md"`): three pages on `TabPanels`, Cancel and OK in the footer, `dismissOnBackdrop` true only while the form is untouched, `describedBy` naming the line that says what OK did when the engine refused a value. The component is exported and not mounted yet: the shell's lines are in the coordinator's hands.
- The command palette (`src/components/CommandPalette.tsx`) stays a native `<dialog>` of its own: it has no title bar, no dimmed page and no footer, it hangs from the title bar instead of standing in the middle, and it keeps the keyboard in one field (`docs/system/decisions.md`, "A task over the page").

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/dialog/default.tsx` | default | A dialog with one field and its two actions; the caller holds `open`. |
| `docs/system/examples/dialog/size-sm.tsx` | size=sm | The small box, 52ch wide: a question with its two answers and no field. |
| `docs/system/examples/dialog/size-md.tsx` | size=md | The default box, 76ch wide: one column of labelled fields. |
| `docs/system/examples/dialog/size-lg.tsx` | size=lg | The large box, 104ch wide: a body tall enough to scroll under a title bar and a footer that stay. |
| `docs/system/examples/dialog/open.tsx` | state:open | An open dialog: the page behind is dimmed and inert, and the first field has the focus. |
| `docs/system/examples/dialog/in-drafting-settings.tsx` | composition:DraftingSettings | Drafting Settings: pages on `TabPanels`, a refused value said beside its field, OK as the form's submit. |

## Variants

### size
- `sm`: a question or one field; 52ch, measured 364px at 13px type. Used at 0 call sites.
- `md`: a form in one column; the default; 76ch (the command palette's measure), measured 533px. Used at 1 call site (Drafting Settings).
- `lg`: a form with a table or two columns; 104ch, measured 729px. Used at 0 call sites.

Every size is capped to the window less 16px on each side, and to the dynamic viewport's height less the same; at 560px wide and under, every size is the bottom sheet (States).

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Closed | The caller passes `open` false. | Nothing: the element is in the page and not displayed. | Nothing is drawn; `open` is absent from the element. | test |
| Open | The caller passes `open` true. | Type in its fields, press its actions, Tab inside it; ask to close with Escape, the close key or a press outside. | The box in the middle of the window over the dimmed page; the page behind is inert; focus is on the first field showing. | test |
| Scrolling | The content is taller than the dynamic viewport less 32px. | Scroll the body by wheel, touch or keys. | The body's scrollbar; the title bar and the footer stay where they are. | by hand |
| Sheet | The window is 560px wide or less. | The same as Open. | The box is as wide as the window and stands on its bottom edge, the top corners rounded; the footer's actions share the width. | by hand |
| Focused (the box) | The dialog opens with no field in its body, or under a coarse pointer with no `initialFocus`. | Tab to the first control; a screen reader hears the title. | The 1px ring in the focus ink around the box. | test |
| Backdrop held | The caller passes `dismissOnBackdrop` false. | Everything but closing by a press outside. | Nothing: the press outside does nothing. | test |

### State precedence
- Open and Closed: Not applicable: the caller's `open` is one or the other.
- Open and Scrolling: both show. A dialog taller than the window is an open dialog whose body scrolls.
- Open and Sheet: both show. The sheet is the open dialog's shape in a narrow window.
- Sheet and Scrolling: both show. The sheet stops a tab strip's height (35px) under the window's top and its body scrolls.
- Focused (the box) and Open: both show. The ring is drawn on the open box until the focus moves into it.
- Backdrop held and Open: both show. Escape and the close key still ask to close.

### Motion
Not applicable: no motion — the dialog arrives and leaves at once (`docs/system/decisions.md`, "A task over the page"); its close key and the caller's controls carry their own.

## Props
- `open`: whether the dialog is showing; the caller holds it.
- `onClose`: the dialog asks to be closed, with the reason: `escape`, `backdrop`, `close` or `action`. The dialog never closes by itself.
- `title`: the title bar's text and the accessible name.
- `size`: `sm`, `md` or `lg`; defaults to `md`.
- `describedBy`: the `id` of a line inside the dialog that says what it is for (several, space-separated); sets `aria-describedby`. The layer's name for this tie on every component (`docs/system/decisions.md`, "Prop vocabulary").
- `initialFocus`: a selector inside the dialog, an element, or a function returning one. Defaults to the first field of the body that is showing; never the close key.
- `footer`: the actions, or a function handed `done`, which asks to close with the reason `action`.
- `dismissOnBackdrop`: whether a press outside asks to close; defaults to true.
- `children`: the body.

## Usage

### When to use
- A command needs several values before it can run, and the page must wait for them: drafting settings, drawing units, a rename.
- A question must be answered before work goes on: discard the changes, delete the layout.

### When not to use
- The list is of commands to run or values to pick, and it closes on the pick. Use `Row` in a menu or a listbox instead.
- One value is edited where it stands, in a panel beside the drawing. Use `Field` or `Select` with `variant="inline"` instead.
- A control needs one line of explanation. Use `Tooltip` instead.
- A setting is switched on or off in place. Use `Toggle` instead.

### Rules
- `rule/dialog-mounted-open`: When a surface has a dialog, render `Dialog` once and pass `open`, rather than mounting it by a condition, because the focus goes back to its opener only while the element outlives its 1 closing, and the caller's answer to `onClose` is read from the same instance. Evidence: single use `src/components/DraftingSettings.tsx:237`. Check: lint `trap/overlay-conditional-render`.
  - Don't: `{open() && <Dialog open title="Drawing Units" onClose={close} />}`
  - Do: `<Dialog open={open()} title="Drawing Units" onClose={close} />`
- `rule/dialog-close-answered`: When `onClose` runs, set the caller's `open` to false in it, or leave it true on purpose, because the dialog closes 0 times by itself: Escape, the close key and a press outside only ask, and an unanswered ask leaves it open. Evidence: single use `src/ui/Dialog.tsx:122`, the one function every way of closing goes through. Check: test `src/ui/Dialog.test.tsx`.
  - Don't: `<Dialog open={open()} title="Drawing Units" onClose={() => undefined} />`
  - Do: `<Dialog open={open()} title="Drawing Units" onClose={() => setOpen(false)} />`
- `rule/dialog-primary-submit`: When a footer has a primary action, make it 1 `Button` with `type="submit"` and run the action from its `onClick`, because Enter in a single-line field presses the form's first submit button and no other, and a second submit button is never reached by the key. Evidence: single use `src/components/DraftingSettings.tsx:247`. Check: test `src/ui/Dialog.test.tsx`.
  - Don't: `footer={<Button variant="primary" onClick={save}>Save</Button>}`
  - Do: `footer={<Button variant="primary" type="submit" onClick={save}>Save</Button>}`
- `rule/dialog-initial-focus`: When typing should start somewhere other than the body's first field, pass `initialFocus` with that control's selector, because the default is the first of the 3 field kinds (`input`, `select`, `textarea`) that is showing, and the close key is never a starting point: a dialog whose first Enter closes it has lost the task. Evidence: single use `src/ui/Dialog.tsx:95`. Check: test `src/ui/Dialog.test.tsx`.
  - Don't: `<Dialog open title="Find"><Checkbox>Match case</Checkbox><Field ariaLabel="Find what" /></Dialog>`
  - Do: `<Dialog open title="Find" initialFocus="[aria-label='Find what']"><Checkbox>Match case</Checkbox><Field ariaLabel="Find what" /></Dialog>`
- `rule/dialog-backdrop-work`: When closing would throw away what was typed, pass `dismissOnBackdrop` as false, or as a value that is false once the form is touched, because 1 press outside the box is a slip of the hand as often as a decision, and Escape and Cancel remain for the decision. Evidence: single use `src/components/DraftingSettings.tsx:242`. Check: test `src/ui/Dialog.test.tsx`.
  - Don't: `<Dialog open title="Drafting Settings" onClose={close}>` around a form with typed values.
  - Do: `<Dialog open title="Drafting Settings" dismissOnBackdrop={untouched()} onClose={close}>`
- `rule/dialog-refusal-beside-field`: When an action cannot take a value, keep the dialog open, mark the field `invalid`, tie 1 line of words to it with `describedBy` and move the focus to it, because a dialog that closes on a refused value reports nothing and one that only colours the field tells a screen reader nothing. Evidence: single use `src/drafting-edit.ts:89`. Check: review `src/drafting-edit.ts`.
  - Don't: `onClick={() => { facade.execute("setvar", { name: "POLARANG", value }); close(); }}`
  - Do: `onClick={() => { const refused = runCalls(facade, plan.calls); if (Object.keys(refused).length === 0) close(); else mark(refused); }}`

### Content
- `rule/dialog-title-names-task`: When a title is written, use the menu item that opens the dialog less its ellipsis, in 1 to 4 words, because the row "Drafting Settings..." promised a dialog of that name and the title is what a screen reader says on opening. Evidence: single use `src/components/DraftingSettings.tsx:239`. Check: review `src/components/DraftingSettings.tsx`.
  - Don't: `<Dialog title="Please configure your drafting options">`
  - Do: `<Dialog title="Drafting Settings">`
- `rule/dialog-action-labels`: When a footer's 2 actions are written, label the one that changes nothing "Cancel" and put the primary action last, named by its verb where the dialog does 1 thing (Rename, Delete) and "OK" where it applies a form of several settings, because one verb cannot name several settings and "OK" beside "Cancel" is the pair a drafter already reads without reading. Evidence: single use `src/components/DraftingSettings.tsx:246`. Check: review `src/components/DraftingSettings.tsx`.
  - Don't: `footer={<><Button variant="primary" type="submit">Yes</Button><Button>No</Button></>}`
  - Do: `footer={<><Button>Cancel</Button><Button variant="primary" type="submit">OK</Button></>}`

### Anti-slop
- `rule/dialog-canonical-element`: When a surface needs a modal, render `Dialog` rather than a `<div role="dialog">` with a hand-built focus trap, or a raw `<dialog>` with its own box, because `showModal()` gives the trap, Escape, the inert page and the top layer the same way in the 3 system webviews the desktop app runs in, and a hand-built one has to re-earn each. Evidence: single use `src/ui/Dialog.tsx:103`. Check: review `src/ui/Dialog.tsx`.
  - Don't: `<div class="modal" role="dialog" aria-modal="true" onKeyDown={trapFocus}>`
  - Do: `<Dialog open={open()} title="Drawing Units" onClose={close}>`
- `rule/dialog-no-page-landmarks`: When content is put in a dialog, use plain boxes rather than `<header>`, `<footer>` or `<main>`, because inside a dialog those 3 elements are announced as the page's own landmarks. Evidence: measured in the browser's accessibility tree, 2026-11-11: a `<header>` in the dialog read as `banner`, `src/ui/Dialog.tsx:176`. Check: test `src/ui/Dialog.test.tsx`.
  - Don't: `<Dialog open title="Units"><header>Length</header></Dialog>`
  - Do: `<Dialog open title="Units"><SectionLabel>Length</SectionLabel></Dialog>`

### Limits
- Follows `rule/button-row-limit`.
- `rule/dialog-size-by-content`: When a dialog holds 1 column of fields, use `md` (or `sm` for a question or a single field) and keep `lg` for 2 columns or a table, because a column of labels and values stretched to `lg` leaves each label 500px from its value. Evidence: measured 364px, 533px and 729px boxes for `sm`, `md` and `lg` at 1280px, `src/ui/ui.css:1309`. Check: review `src/ui/ui.css`.
  - Don't: `<Dialog size="lg" title="Rename Layout"><Field ariaLabel="Layout name" /></Dialog>`
  - Do: `<Dialog size="sm" title="Rename Layout"><Field ariaLabel="Layout name" /></Dialog>`
- `rule/dialog-narrow-one-column`: When a dialog's body is laid out, let it fall to 1 column at 358px, because at a window of 560px or less the dialog is a sheet as wide as the window and its body is the window less 16px on each side. Evidence: measured 390px sheet with a 358px body at 390 by 700, `src/ui/ui.css:1421`. Check: review `src/dialogs.css`.
  - Don't: `.my-form { display: grid; grid-template-columns: 240px 240px }`
  - Do: `.my-form { display: grid; grid-template-columns: repeat(auto-fill, minmax(24ch, 1fr)) }`

## Accessibility
Rests on the native `<dialog>` element shown with `showModal()`: the `dialog` role, the modal state, the focus trap, the inert page and Escape's close request come from the platform. The body and the footer are one `<form>`, so Enter's press of the primary action is the platform's implicit submission.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| (opening) | Whatever opened the dialog. | The dialog shows. | The first field of the body that is showing; `initialFocus` when passed; the box itself when the body has no field or the pointer is coarse. | test |
| Tab, Shift+Tab | Anywhere in the dialog. | Moves through the close key, the body's controls and the footer's actions, and never into the page behind. | The next control inside the dialog. | by hand |
| Escape | Anywhere in the dialog, on a key nothing inside used. | `onClose("escape")`. | The opener, once the caller sets `open` false. | test |
| Escape | A control that called `preventDefault` on the key. | Nothing from the dialog: the control used the key. | Stays where it is. | test |
| Enter | A single-line field of the body. | Presses the footer's `type="submit"` button: its `onClick` runs. An `aria-disabled` one refuses. | The caller decides: the dialog stays open until `open` is false. | by hand |
| Enter, Space | The close key. | `onClose("close")`. | The opener, once the caller sets `open` false. | test |
| (closing) | Anywhere in the dialog. | The dialog is put away. | The element that had the focus when it opened, if it is still in the page. | test |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The box | `dialog` (native, modal) | The title, through `aria-labelledby` | `aria-describedby` from `describedBy`; `tabindex="-1"` so it can take the focus itself | "Drafting Settings, dialog", then the focused field | snapshot |
| The title | `heading`, level 2 | Its text | None | Read as the dialog's name | test |
| The close key | `button` (an `IconButton`) | `aria-label="Close"` | None | "Close, button" | test |
| The body and the footer | `form` with no name (not a landmark), plain boxes inside it | Not exposed | None | Nothing of their own | snapshot |
| The page behind | Inert while the dialog is open | Not exposed | None | Nothing: the tree holds the dialog alone | snapshot |

## Tokens
| Part | State | Token |
|---|---|---|
| The box | all | `--surface-elevated`, `--border`, `--hairline`, `--radius-block`, `--shadow-popover` |
| The box's margin | all | `--gap-16` |
| The text | all | `--text`, `--font-family`, `--font-body`, `--leading-ui` |
| The page behind | open | `--scrim` |
| The ring | the box focused | `--focus-outline-w`, `--focus-ring`, `--focus-outline-offset` |
| The title bar | all | `--control-h-tab`, `--gap-16`, `--gap-8`, `--gap-6`, `--border-soft` |
| The body | all | `--gap-16` |
| The footer | all | `--gap-8`, `--gap-10`, `--gap-16`, `--border-soft`, `--control-h-button` (the least width of an action, two and a half of it) |
| The sheet | 560px wide or less | `--radius-block`, `--control-h-tab` (the page left showing above it), `--gap-10` |

## Related
- `Button`: the footer's actions; the primary one is `type="submit"`.
- `IconButton`: the close key; and, with `popup="dialog"`, a key that opens a small popover of fields beside itself, which is not this component.
- `Tab`: `TabPanels` gives a dialog its pages.
- `Field`, `Select`, `Checkbox`, `TextArea`: what a dialog's body is made of; each is tied to its visible label by `id`, or named by `ariaLabel`.
- `Row`: when the task is picking one command or value from a list.
- `Tooltip`: the hint a control inside a dialog shows is drawn inside the dialog, because the top layer covers the page.
