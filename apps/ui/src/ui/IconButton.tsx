/**
 * IconButton — an action drawn as one glyph. A native `<button>` (trap/role-button) whose
 * accessible name is the `title` prop, so an icon-only control is never nameless
 * (trap/button-icon-name). The glyph is code-drawn (`../icons.ts`, no icon assets) and sized by
 * the control: 14px in the 24px box, 12px in the 20px one. The recipe lives in `./ui.css`.
 *
 * The same `title` is the hint a sighted person reads: the layer's own box (`./Tooltip.tsx`),
 * which shows under the pointer after a short delay and at once on keyboard focus. The button
 * carries no native `title` attribute, so the platform's box never doubles it.
 *
 * A key that folds and unfolds a region says so with `expanded` (and names the region with
 * `controls`); a key that switches a setting on and off says so with `selected`. One key is one
 * or the other: a disclosure is not a pressed toggle. A key that opens something floating over
 * the page says what kind with `popup`, beside `expanded` and `controls`.
 */

import type { JSX } from "solid-js";
import { ToolIcon } from "../icons";
import { installHints } from "./Tooltip";

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
  /** Blocks the click and drops the glyph to the disabled ink. */
  disabled?: boolean;
  /** A toggle-style icon button: sets `aria-pressed` and the .14 selected fill. */
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
  return (
    <button
      type="button"
      class={`ui-icon-button ui-icon-button--${props.variant ?? "ghost"} ui-icon-button--${props.size ?? "md"}`}
      aria-label={props.title}
      data-hint={props.title}
      aria-pressed={props.selected === undefined ? undefined : props.selected}
      aria-expanded={props.expanded === undefined ? undefined : props.expanded}
      aria-controls={props.controls}
      aria-haspopup={props.popup}
      disabled={props.disabled}
      onClick={(event) => {
        if (!props.disabled) props.onClick?.(event);
      }}
    >
      <ToolIcon id={props.icon} />
    </button>
  );
}
