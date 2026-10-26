# Button

## Description
The one button: it runs the action its label names, on Cursor's measured `.cursor-button` recipe.

source `crates/ui-egui/src/widgets.rs`, status `ready`.
Foundation: hand-rolled. Traps checked: trap/button-clone, trap/control-height, trap/focus-ring-shape, trap/hover-beats-focus, trap/disabled-still-hovers.

### Foundation
Not applicable: hand-rolled — the recipe is measured from Cursor's CSS into `theme.rs` constants, and no registry item ships it.

## Examples
Default: a primary button in a dialog footer.

Real uses, 0 call sites (`rg 'widgets::button' crates/ui-egui/src`): the canonical entry lands first; the pilot and safe-moves steps move the surfaces onto it.

### Example files
| File | Covers | Caption |
|---|---|---|
| `docs/system/examples/button/default.rs` | default | A primary button in a dialog footer. |
| `docs/system/examples/button/kind-ghost.rs` | `Kind=Ghost` | The ghost kind, a quiet action on a tool bar. |
| `docs/system/examples/button/kind-primary.rs` | `Kind=Primary` | The primary kind, the dialog's action. |
| `docs/system/examples/button/kind-danger.rs` | `Kind=Danger` | The danger kind, a destructive action. |
| `docs/system/examples/button/in-toolbar.rs` | composition:Toolbar | A ghost button beside an icon button on the tool bar. |

## Variants

### Kind
- `Ghost`: the transparent fill with a hairline border, for tool bars and quiet actions. Used at 0 call sites.
- `Primary`: the action fill, for the dialog's main action. Used at 0 call sites.
- `Danger`: the error fill, for destructive actions. Used at 0 call sites.

## States
| State | Trigger | What the user can do | Shown by, besides color | Checked by |
|---|---|---|---|---|
| Rest | Nothing is over the button. | Click it. | `Ghost` shows its hairline border. | by hand |
| Hover | The pointer is over it. | Click it. | `Ghost` gains a fill and a brighter border; the filled kinds drop to 0.8 opacity. | by hand |
| Pressed | The pointer is held down on it. | Release to click. | The same fill as hover. | by hand |
| Focused | Keyboard focus arrives by Tab. | Enter or Space clicks it. | A 1px ring just inside the 2px radius. | by hand |
| Disabled | The caller's condition is false. | Nothing. | The fill, border and label at 0.5 opacity. | by hand |

### State precedence
- Hover and Focused: Focused wins. The ring stays drawn while the pointer is over the button; hover only changes the fill.
- Hover and Disabled: Disabled wins. A disabled button keeps its rest colours under the pointer and takes no click.

### Motion
Not applicable: no motion — the recipes paint each state directly, and the app's Animation preference governs egui's own widgets.

## Props
Signature: `pub fn button(ui: &mut egui::Ui, label: &str, kind: Kind) -> egui::Response`.
- `label`: the action's text; the widget translates it and draws it at 14px.
- `kind`: `Kind::Ghost`, `Kind::Primary` or `Kind::Danger`.

## Usage

### When to use
- The user runs one action and expects it to happen now.

### When not to use
- The control is an icon with no label. Use `icon_button` instead.
- The text is a status rather than an action. Use `chip` instead.

### Rules
- `rule/button-recipe`: When a button is drawn, use `RADIUS_CONTROL` (2px), `BUTTON_PAD_X` (8px), `BUTTON_PAD_Y` (4px) and `FONT_BUTTON` (14px), because `.cursor-button` measures `border-radius:2px; font-size:14px; gap:4px; padding:4px 8px` and the app's 6/8/10/12 scale came from a third-party clone. Evidence: measured 2px radius, 4px 8px padding and 14px type, `.design-system/cursor/recipes.md` §3. Check: review crates/ui-egui/src/widgets.rs.
  - Don't: `rect_filled(rect, 6.0, fill)` on a hand-painted button.
  - Do: `button(ui, "Save", Kind::Primary)` and let the recipe fill it.
- `rule/button-states`: When a button is hovered, pressed or disabled, use `HOVER_OPACITY` (0.8) and `DISABLED_OPACITY` (0.5), because `.cursor-button-primary-clickable:not(.disabled):hover` is `opacity:.8` and `.cursor-button-primary.disabled` is `opacity:.5`. Evidence: measured 0.8 and 0.5, `.design-system/cursor/recipes.md` §3. Check: review crates/ui-egui/src/widgets.rs.
  - Don't: paint the hover fill at `control_hover*0.6` by hand.
  - Do: call `button` and let the hover opacity come from `HOVER_OPACITY`.
- `rule/button-focus`: When a button has keyboard focus, paint the `FOCUS_OUTLINE_W` (1px) ring at `FOCUS_OUTLINE_OFFSET` (-1), because `.cursor-button.tab-focusable:focus` is `outline:1px solid var(--vscode-focusBorder); outline-offset:-1px`. Evidence: measured 1px and -1px, `.design-system/cursor/recipes.md` §3. Check: review crates/ui-egui/src/widgets.rs.
  - Don't: leave a focused button with no visible ring.
  - Do: paint the ring just inside the 2px radius so the corners stay followed.

### Content
- Not applicable: the label comes from the caller; the widget draws it verbatim.

### Anti-slop
- `rule/button-canonical`: When a surface needs a button, call `button` rather than painting a fill, because the inventory counted 3 hand-painted ghost buttons with 3 radii and 3 hover fills. Evidence: app 3/3 ghost buttons, `.design-system/boss/triage/inventory.md` §4. Check: review crates/ui-egui/src/widgets.rs.
  - Don't: `ui.add(egui::Button::new(text).fill(t.accent).min_size(vec2(84.0, 22.0)))` in a surface.
  - Do: `button(ui, "Save", Kind::Primary)`.

### Limits
- Not applicable: no count or length limit; the label sizes the button and the caller shortens it.

## Accessibility
Rests on the painted rect with `Sense::click()`, whose widget info gives egui a `button` node named by the label.

### Keyboard
| Key | Where focus is | Effect | Focus after | Checked by |
|---|---|---|---|---|
| Tab | Anywhere | Moves focus to the button. | The button. | by hand |
| Enter, Space | The button | Clicks it through egui's fake primary click. | The button. | by hand |

### ARIA
| Part | Role | Accessible name from | States and properties | Announced | Checked by |
|---|---|---|---|---|---|
| The button rect | `button` | the `label` argument | `disabled` when the UI is disabled | "Save, button" | by hand |

## Tokens
| Part | State | Token |
|---|---|---|
| Fill | `Kind::Primary` | `Tokens::accent` |
| Fill | `Kind::Danger` | `Tokens::error` |
| Label | `Kind::Primary`, `Kind::Danger` | `Tokens::on_accent` |
| Label | `Kind::Ghost` | `Tokens::text` |
| Border | `Kind::Ghost` | `Tokens::border`, hover `Tokens::cmd_border` |
| Fill | `Kind::Ghost`, hover or press | `Tokens::control_hover` |
| Radius, height | all | `theme::RADIUS_CONTROL`, `theme::CONTROL_H_BUTTON` |
| Padding, type | all | `theme::BUTTON_PAD_X`, `theme::BUTTON_PAD_Y`, `theme::FONT_BUTTON` |
| Focus ring | focused | `theme::FOCUS_OUTLINE_W`, `theme::FOCUS_OUTLINE_OFFSET`, `Tokens::accent` |

## Related
- `icon_button`: when the control is an icon with no label.
- `chip`: when the text is a status rather than an action.
