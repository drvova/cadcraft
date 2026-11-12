/**
 * Button — the one button: it runs the action its label names, on the measured control recipe
 * (`.design-system/research/cursor-recipes-2026-10-28.md` §5). A native `<button>` so Enter,
 * Space, `disabled` and form behaviour come from the platform, never rebuilt by hand
 * (trap/button-div, trap/role-button). `type` defaults to `button` so a button inside a form
 * never submits twice (trap/button-type). The recipe itself lives in `./ui.css`.
 *
 * `title` is the layer's hint (`./Tooltip.tsx`), never the native attribute: the label is the
 * button's name, so the hint is what the label leaves out, and it is tied to the button as its
 * accessible description. A hint that only repeats the label is not drawn.
 *
 * A disabled button is `aria-disabled="true"`, not natively `disabled`: it stays in the Tab order
 * and under the pointer, so its hint can say why it is blocked, and the click is refused here.
 */

import type { JSX } from "solid-js";
import { ariaKeyShortcuts, describeByHint, installHints, splitHint } from "./Tooltip";

/** The purpose of the action; the token layer picks the look (never a style prop). `quiet` is an
 *  action that must not compete with what it stands beside: a title's "Change", a line's "Undo". */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "quiet" | "danger";

/** `md` is the 28px control; `sm` the 24px one that sits beside a field. */
export type ButtonSize = "sm" | "md";

export interface ButtonProps {
  /** The purpose of the action. Defaults to `secondary`, Cursor's own default button. */
  variant?: ButtonVariant;
  /** The control size. Defaults to `md`. */
  size?: ButtonSize;
  /** Blocks the click, drops the label to the disabled ink and the fill to the disabled step.
   *  The button stays focusable (`aria-disabled`), so `title` can say why it is blocked. */
  disabled?: boolean;
  /** The hint: what the label leaves out, or why the button is disabled. It shows in the layer's
   *  hint box and is the button's accessible description; it is never the name. */
  title?: string;
  /** The shortcut that runs the same action, as the user reads it ("Ctrl+Shift+P"): a key cap in
   *  the hint and `aria-keyshortcuts` on the button. A `title` ending "(Ctrl+Shift+P)" still draws
   *  the cap, without the attribute. */
  shortcut?: string;
  /**
   * The accessible name, when the visible label is a value rather than the action (the command
   * centre shows the drawing's name and is the "Search commands" button). Start it with the
   * action and keep the visible text inside it, so speech input can still say what is on the
   * key. Never pass it over a label that already names the action.
   */
  ariaLabel?: string;
  /** The native type. Defaults to `button` so the button never submits a form implicitly. */
  type?: "button" | "submit" | "reset";
  /** Runs on click. A disabled button never fires it. */
  onClick?: (event: MouseEvent) => void;
  /** The label. Keep it a verb the user recognizes. */
  children?: JSX.Element;
}

export function Button(props: ButtonProps): JSX.Element {
  if (typeof document !== "undefined") installHints();
  const hint = (): { text: string; keys: string | undefined } => splitHint(props.title ?? "");
  return (
    <button
      ref={(el: HTMLButtonElement) => {
        describeByHint(el, () => props.title);
        refuseWhenDisabled(el);
      }}
      type={props.type ?? "button"}
      class={`ui-button ui-button--${props.variant ?? "secondary"} ui-button--${props.size ?? "md"}`}
      aria-disabled={props.disabled ? "true" : undefined}
      data-hint={hint().text}
      data-hint-keys={props.shortcut ?? hint().keys}
      aria-keyshortcuts={props.shortcut === undefined ? undefined : ariaKeyShortcuts(props.shortcut)}
      aria-label={props.ariaLabel}
      onClick={(event) => props.onClick?.(event)}
    >
      {props.children}
    </button>
  );
}

/**
 * The layer's disabled rule, shared with `IconButton`: a control marked `aria-disabled="true"`
 * refuses its click on the element itself, before any handler of the caller's or of an ancestor's
 * hears it, and before a form takes it as a submit. Enter and Space arrive as the same click.
 */
export function refuseWhenDisabled(el: HTMLElement): void {
  el.addEventListener("click", (event) => {
    if (el.getAttribute("aria-disabled") !== "true") return;
    event.preventDefault();
    event.stopImmediatePropagation();
  });
}
