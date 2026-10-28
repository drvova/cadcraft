/**
 * IconButton — an action drawn as one glyph. A native `<button>` (trap/role-button) whose
 * accessible name is the `title` prop, so an icon-only control is never nameless
 * (trap/button-icon-name). The glyph is code-drawn (`../icons.ts`, no icon assets) and sized by
 * the control: 14px in the 24px box, 12px in the 20px one. The recipe lives in `./ui.css`.
 */

import type { JSX } from "solid-js";
import { ToolIcon } from "../icons";

/** `ghost` for tool bars, `soft` for a resting fill, `inverted` for the one primary circle. */
export type IconButtonVariant = "ghost" | "soft" | "inverted";

/** `md` is the 24px box with a 14px glyph; `sm` the 20px box with a 12px glyph. */
export type IconButtonSize = "sm" | "md";

export interface IconButtonProps {
  /** The id from `../icons.ts`; the glyph is drawn in code. */
  icon: string;
  /** The accessible name (also `aria-label`), and the tooltip. Required: an icon alone has none. */
  title: string;
  /** The look. Defaults to `ghost`. */
  variant?: IconButtonVariant;
  /** The box size. Defaults to `md`. */
  size?: IconButtonSize;
  /** Blocks the click and drops the glyph to the disabled ink. */
  disabled?: boolean;
  /** A toggle-style icon button: sets `aria-pressed` and the .14 selected fill. */
  selected?: boolean;
  /** Runs on click. A disabled button never fires it. */
  onClick?: (event: MouseEvent) => void;
}

export function IconButton(props: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      class={`ui-icon-button ui-icon-button--${props.variant ?? "ghost"} ui-icon-button--${props.size ?? "md"}`}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.selected === undefined ? undefined : props.selected}
      disabled={props.disabled}
      onClick={(event) => {
        if (!props.disabled) props.onClick?.(event);
      }}
    >
      <ToolIcon id={props.icon} />
    </button>
  );
}
