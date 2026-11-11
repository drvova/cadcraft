/**
 * Kbd — a key cap: the key or shortcut that runs the action beside it. A native `<kbd>`, so the
 * text is marked as keyboard input for assistive tech; it is a fact to read, never a control.
 * The recipe lives in `./ui.css`.
 */

import type { JSX } from "solid-js";

export interface KbdProps {
  /** The key or shortcut as the user reads it: `esc`, `Ctrl+Shift+P`. */
  children?: JSX.Element;
}

export function Kbd(props: KbdProps): JSX.Element {
  return <kbd class="ui-kbd">{props.children}</kbd>;
}
