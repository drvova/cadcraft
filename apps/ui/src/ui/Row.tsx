/**
 * Row — the full-width clickable band of a list (a menu item, a property row, a layer). A native
 * `<button>`: `selected` becomes `aria-current="true"` so the current row is marked for assistive
 * tech too (trap/current-unmarked), and `disabled` blocks the click with no hover
 * (trap/disabled-still-hovers). A row that must hold nested controls of its own stays bespoke —
 * a button cannot nest buttons. The recipe lives in `./ui.css`.
 */

import type { JSX } from "solid-js";

export interface RowProps {
  /** The current row: the .14 fill, the full ink, and `aria-current="true"`. */
  selected?: boolean;
  /** Blocks the click and drops the ink to the disabled step. */
  disabled?: boolean;
  /** A tooltip. */
  title?: string;
  /** Runs on click. A disabled row never fires it. */
  onClick?: (event: MouseEvent) => void;
  /** The row's content: a label, and quiet trailing text such as a shortcut or a value. */
  children?: JSX.Element;
}

export function Row(props: RowProps): JSX.Element {
  return (
    <button
      type="button"
      class="ui-row"
      aria-current={props.selected ? "true" : undefined}
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
