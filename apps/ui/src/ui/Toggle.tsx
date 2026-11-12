/**
 * Toggle — one setting that is on or off, switched in place: a native `<button>` with
 * `aria-pressed`, so Enter, Space and the role come from the platform (trap/role-button). The
 * state is drawn by the face alone, never by a fill at rest: a row of these is mostly on, and a
 * fill on every one would be a row of fills. The recipe lives in `./ui.css`.
 *
 * Two faces share it. `glyph` is an icon that changes with the state (`icon` when off, `iconOn`
 * when on) in an ink the `tone` picks: the cell of a list row. `text` is a short word
 * (`children`) that takes the full ink and a rule in the on-colour under it when on: the status
 * bar's drafting settings.
 *
 * The name does not change with the state. `ariaLabel` is what the setting is ("Outline frozen",
 * "Snap mode") and `aria-pressed` says whether it holds, so a screen reader hears one key that is
 * pressed or not, never two names for one key. `hint` is for the eye: what a press does now
 * ("Thaw"), or the full name beside a terse face, in the layer's hint box (`./Tooltip.tsx`) and
 * never a native `title`. It is not exposed to assistive tech, which already has the name and the
 * state; `description` is, as on `IconButton`.
 *
 * A disabled toggle is `aria-disabled="true"`, not natively `disabled`: it stays focusable so its
 * hint can say why it is blocked, and the click is refused (`refuseWhenDisabled`).
 *
 * The caller owns the value: `onChange` hears the state a press asks for and the toggle then
 * shows whatever `pressed` says. A group that is one Tab stop sets each key's `tabIndex` itself,
 * through the prop or on the element (`rovingBand`): the component writes the attribute only when
 * the prop changes, so it never undoes what the container set.
 */

import { Show, type JSX } from "solid-js";
import { ToolIcon } from "../icons";
import { refuseWhenDisabled } from "./Button";
import { ariaKeyShortcuts, describeByHint, installHints, type TooltipPlacement } from "./Tooltip";

/** `glyph` is an icon that changes with the state; `text` a short word over a rule when on. */
export type ToggleVariant = "glyph" | "text";

/** `sm` is the cell of a 22px list row and the status bar's line; `md` the 24px control. */
export type ToggleSize = "sm" | "md";

/**
 * Which state is worth noticing, and in which ink. `neutral`: on is the full ink over the quiet
 * one. `absent`: on is the ordinary state and stays quiet, and off (a hidden layer) takes the
 * ink. `info`: on is a fact to notice (frozen). `caution`: on blocks something (locked).
 */
export type ToggleTone = "neutral" | "absent" | "info" | "caution";

export interface ToggleProps {
  /** Whether the setting is on. The caller holds it and passes the new one back through `onChange`. */
  pressed: boolean;
  /** Runs on a press, with the state the press asks for. A disabled toggle never fires it. */
  onChange?: (pressed: boolean) => void;
  /** Runs on click, before `onChange`. A disabled toggle never fires it. */
  onClick?: (event: MouseEvent) => void;
  /** The face. Defaults to `glyph`. */
  variant?: ToggleVariant;
  /** The glyph shown while off, and while on when `iconOn` is not given: an id from `../icons.ts`. */
  icon?: string;
  /** The glyph shown while on. */
  iconOn?: string;
  /** The ink of the state worth noticing. Defaults to `neutral`. A `text` face is always `neutral`. */
  tone?: ToggleTone;
  /** The box. Defaults to `md`. */
  size?: ToggleSize;
  /** The fixed accessible name: the setting, not the action ("Outline frozen"). Required on a
   *  `glyph`; on a `text` face, the full name when the word is an abbreviation ("Snap mode"). */
  ariaLabel?: string;
  /** The hint, for the eye: what a press does now ("Thaw"), or the full name of a terse face. */
  hint?: string;
  /** The shortcut that flips the same setting, as the user reads it ("F9"): a key cap in the hint
   *  and `aria-keyshortcuts` on the button. */
  shortcut?: string;
  /** A second line under the hint and the toggle's accessible description: why it is disabled. */
  description?: string;
  /** The side the hint prefers; it flips by itself when that side has no room. */
  placement?: TooltipPlacement;
  /** Blocks the press and drops the face to the disabled ink. The toggle stays focusable
   *  (`aria-disabled`), so its hint still shows. */
  disabled?: boolean;
  /** The toggle's place in the Tab order, for a group that is one Tab stop. Unset leaves the
   *  attribute alone, so a container that roves through the element is not undone. */
  tabIndex?: number;
  /** The word of a `text` face ("Grid"). */
  children?: JSX.Element;
}

export function Toggle(props: ToggleProps): JSX.Element {
  if (typeof document !== "undefined") installHints();
  const variant = (): ToggleVariant => props.variant ?? "glyph";
  return (
    <button
      ref={(el: HTMLButtonElement) => {
        describeByHint(el, () => props.description);
        refuseWhenDisabled(el);
      }}
      type="button"
      class={`ui-toggle ui-toggle--${variant()} ui-toggle--${props.size ?? "md"} ui-toggle--${variant() === "text" ? "neutral" : (props.tone ?? "neutral")}`}
      aria-label={props.ariaLabel}
      aria-pressed={props.pressed}
      aria-disabled={props.disabled ? "true" : undefined}
      aria-keyshortcuts={props.shortcut === undefined ? undefined : ariaKeyShortcuts(props.shortcut)}
      data-hint={props.hint}
      data-hint-keys={props.shortcut}
      data-hint-note={props.description}
      data-hint-placement={props.placement}
      tabIndex={props.tabIndex}
      onClick={(event) => {
        props.onClick?.(event);
        props.onChange?.(!props.pressed);
      }}
    >
      <Show when={variant() === "glyph"} fallback={props.children}>
        <Show when={props.pressed && props.iconOn !== undefined} fallback={<ToolIcon id={props.icon ?? ""} />}>
          <ToolIcon id={props.iconOn ?? ""} />
        </Show>
      </Show>
    </button>
  );
}
