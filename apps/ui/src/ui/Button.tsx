/**
 * Button — the one button: it runs the action its label names, on the measured control recipe
 * (`.design-system/research/cursor-recipes-2026-10-28.md` §5). A native `<button>` so Enter,
 * Space, `disabled` and form behaviour come from the platform, never rebuilt by hand
 * (trap/button-div, trap/role-button). `type` defaults to `button` so a button inside a form
 * never submits twice (trap/button-type). The recipe itself lives in `./ui.css`.
 */

import type { JSX } from "solid-js";

/** The purpose of the action; the token layer picks the look (never a style prop). */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/** `md` is the 28px control; `sm` the 24px one that sits beside a field. */
export type ButtonSize = "sm" | "md";

export interface ButtonProps {
  /** The purpose of the action. Defaults to `secondary`, Cursor's own default button. */
  variant?: ButtonVariant;
  /** The control size. Defaults to `md`. */
  size?: ButtonSize;
  /** Blocks the click, drops the label to the disabled ink and the fill to the disabled step. */
  disabled?: boolean;
  /** A tooltip. Also the accessible name when the children are an icon. */
  title?: string;
  /** The native type. Defaults to `button` so the button never submits a form implicitly. */
  type?: "button" | "submit" | "reset";
  /** Runs on click. A disabled button never fires it. */
  onClick?: (event: MouseEvent) => void;
  /** The label. Keep it a verb the user recognizes. */
  children?: JSX.Element;
}

export function Button(props: ButtonProps): JSX.Element {
  return (
    <button
      type={props.type ?? "button"}
      class={`ui-button ui-button--${props.variant ?? "secondary"} ui-button--${props.size ?? "md"}`}
      disabled={props.disabled}
      title={props.title}
      onClick={(event) => {
        if (!props.disabled) props.onClick?.(event);
      }}
    >
      {props.children}
    </button>
  );
}
