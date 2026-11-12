/**
 * Row — the full-width clickable band of a list (a menu item, a property row, a layer). A native
 * `<button>`: `selected` becomes `aria-current="true"` so the current row is marked for assistive
 * tech too (trap/current-unmarked), and `disabled` blocks the click with no hover
 * (trap/disabled-still-hovers). A row that must hold nested controls of its own stays bespoke —
 * a button cannot nest buttons. The recipe lives in `./ui.css`.
 *
 * `option` is the row inside a listbox that keeps the keyboard elsewhere (a search field with
 * `aria-activedescendant`): the band is then the `role="option"` element itself, not a button
 * inside one. It is no Tab stop, `selected` is the list's active option (`aria-selected`), a
 * blocked one is `aria-disabled`, and it paints no hover of its own, so the one highlight in the
 * list is the one the listbox moved, by key or by `onPointerMove`. A press still runs `onClick`.
 */

import { Show, type JSX } from "solid-js";

export interface RowProps {
  /** The current row: the .14 fill, the full ink, and `aria-current="true"` (`aria-selected` on an `option`). */
  selected?: boolean;
  /** Blocks the click and drops the ink to the disabled step. */
  disabled?: boolean;
  /** A tooltip. */
  title?: string;
  /** The row is one option of a `role="listbox"` that owns the focus and the highlight: a
   *  `role="option"` band, no Tab stop and no hover fill of its own. */
  option?: boolean;
  /** The element's `id`, for the listbox's `aria-activedescendant`. */
  id?: string;
  /** The pointer moved over the row: a listbox moves its highlight here. */
  onPointerMove?: (event: PointerEvent) => void;
  /** Runs on click. A disabled row never fires it. */
  onClick?: (event: MouseEvent) => void;
  /** The row's content: a label, and quiet trailing text such as a shortcut or a value. */
  children?: JSX.Element;
}

export function Row(props: RowProps): JSX.Element {
  const click = (event: MouseEvent): void => {
    if (!props.disabled) props.onClick?.(event);
  };
  return (
    <Show
      when={props.option}
      fallback={
        <button
          type="button"
          class="ui-row"
          id={props.id}
          aria-current={props.selected ? "true" : undefined}
          disabled={props.disabled}
          title={props.title}
          onClick={click}
          onPointerMove={(event) => props.onPointerMove?.(event)}
        >
          {props.children}
        </button>
      }
    >
      <div
        role="option"
        class="ui-row ui-row--option"
        id={props.id}
        aria-selected={props.selected ? "true" : "false"}
        aria-disabled={props.disabled ? "true" : undefined}
        title={props.title}
        onClick={click}
        onPointerMove={(event) => props.onPointerMove?.(event)}
      >
        {props.children}
      </div>
    </Show>
  );
}
