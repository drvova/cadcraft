/**
 * IconButton — an action drawn as one glyph. A native `<button>` (trap/role-button) whose
 * accessible name is the `title` prop, so an icon-only control is never nameless
 * (trap/button-icon-name). The glyph is code-drawn (`../icons.ts`, no icon assets) and sized by
 * the control: 14px in the 24px box, 12px in the 20px one. The recipe lives in `./ui.css`.
 *
 * The same `title` is the hint a sighted person reads: the layer's own box (`./Tooltip.tsx`),
 * which shows under the pointer after a short delay and at once on keyboard focus. The button
 * carries no native `title` attribute, so the platform's box never doubles it. A shortcut is a
 * key cap in the box (`shortcut`, or the old "(Ctrl+Z)" at the end of the title), and
 * `description` is a second line under the name: why the key is disabled, what it will do.
 *
 * A disabled key is `aria-disabled="true"`, not natively `disabled`: it stays in the Tab order
 * and under the pointer, so its hint still says what it is and why it is blocked, and the click
 * is refused here (`refuseWhenDisabled`, shared with `Button`).
 *
 * A key that folds and unfolds a region says so with `expanded` (and names the region with
 * `controls`); a key that switches a setting on and off says so with `selected`. One key is one
 * or the other: a disclosure is not a pressed toggle. A key that opens something floating over
 * the page says what kind with `popup`, beside `expanded` and `controls`.
 */

import type { JSX } from "solid-js";
import { ToolIcon } from "../icons";
import { refuseWhenDisabled } from "./Button";
import { ariaKeyShortcuts, describeByHint, installHints, splitHint } from "./Tooltip";

/** `ghost` for tool bars, `soft` for a resting fill, `inverted` for the one primary circle. */
export type IconButtonVariant = "ghost" | "soft" | "inverted";

/** `md` is the 24px box with a 14px glyph; `sm` the 20px box with a 12px glyph. */
export type IconButtonSize = "sm" | "md";

/**
 * What a key opens over the page: `menu` for a list of actions (`role="menu"`), `listbox` for a
 * list of values to pick one from (`role="listbox"`), `dialog` for a popover holding fields or
 * other controls (`role="dialog"`).
 */
export type IconButtonPopup = "menu" | "dialog" | "listbox";

export interface IconButtonProps {
  /** The id from `../icons.ts`; the glyph is drawn in code. */
  icon: string;
  /** The accessible name (`aria-label`) and the hint's text. Required: an icon alone has none. */
  title: string;
  /** The look. Defaults to `ghost`. */
  variant?: IconButtonVariant;
  /** The box size. Defaults to `md`. */
  size?: IconButtonSize;
  /** The shortcut that runs the same action, as the user reads it ("Ctrl+Z", "F9"): a key cap in
   *  the hint and `aria-keyshortcuts` on the button. A `title` ending "(Ctrl+Z)" still draws the
   *  cap; the name keeps the bracket and no `aria-keyshortcuts` repeats it. */
  shortcut?: string;
  /** A second line under the name in the hint, and the key's accessible description: why it is
   *  disabled ("Type a message first"), what it will do. Never the name. */
  description?: string;
  /** Blocks the click and drops the glyph to the disabled ink. The key stays focusable
   *  (`aria-disabled`), so its hint still shows. */
  disabled?: boolean;
  /** A toggle-style icon button: sets `aria-pressed`, and while on draws the full ink on the `.08`
   *  fill, squared to the control radius (not the round `.14` disc it was until 2026-11-11). */
  selected?: boolean;
  /** A fold key: sets `aria-expanded` to whether the region it folds is showing now. */
  expanded?: boolean;
  /** The `id` of the region a fold key shows and hides: sets `aria-controls`. Pass it with `expanded`. */
  controls?: string;
  /** The key opens a popup of this kind: sets `aria-haspopup`. Pass `expanded` with whether it is
   *  open now, and `controls` with its `id` while it is. */
  popup?: IconButtonPopup;
  /** Runs on click. A disabled button never fires it. */
  onClick?: (event: MouseEvent) => void;
}

export function IconButton(props: IconButtonProps): JSX.Element {
  if (typeof document !== "undefined") installHints();
  const hint = (): { text: string; keys: string | undefined } => splitHint(props.title);
  return (
    <button
      ref={(el: HTMLButtonElement) => {
        describeByHint(el, () => props.description);
        refuseWhenDisabled(el);
      }}
      type="button"
      class={`ui-icon-button ui-icon-button--${props.variant ?? "ghost"} ui-icon-button--${props.size ?? "md"}`}
      aria-label={props.title}
      data-hint={hint().text}
      data-hint-keys={props.shortcut ?? hint().keys}
      data-hint-note={props.description}
      aria-keyshortcuts={props.shortcut === undefined ? undefined : ariaKeyShortcuts(props.shortcut)}
      aria-pressed={props.selected === undefined ? undefined : props.selected}
      aria-expanded={props.expanded === undefined ? undefined : props.expanded}
      aria-controls={props.controls}
      aria-haspopup={props.popup}
      aria-disabled={props.disabled ? "true" : undefined}
      onClick={(event) => props.onClick?.(event)}
    >
      <ToolIcon id={props.icon} />
    </button>
  );
}
