/**
 * Tooltip — the hover label. The measured recipe is Cursor's hover box
 * (`.design-system/research/cursor-recipes-2026-10-28.md` §8: the chrome fill, radius 3, the .15
 * hairline, the 2px/8px shadow, 12px type) and its arrival: the `fadein` keyframes over 0.1s.
 *
 * It is a wrapper, not a control: the child keeps its own element (a button stays a button), the
 * label shows on the wrapper's hover and whenever anything inside it has focus, and it never takes
 * the pointer. Give the child its own accessible name (`aria-label`) — a tooltip is a hint, not a
 * name.
 */

import type { JSX } from "solid-js";

export interface TooltipProps {
  /** The hint. Keep it a short sentence fragment: "New chat", "Copy the code". */
  text: string;
  /** The control the hint describes. */
  children: JSX.Element;
}

export function Tooltip(props: TooltipProps): JSX.Element {
  return (
    <span class="ui-tooltip-host">
      {props.children}
      <span class="ui-tooltip" role="tooltip">
        {props.text}
      </span>
    </span>
  );
}
