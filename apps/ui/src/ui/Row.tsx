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
 *
 * `title` is the layer's hint (`./Tooltip.tsx`), never the native attribute: it shows in the hint
 * box and is the row's accessible description; the name stays the row's text. A row whose label
 * is cut short shows it in full as the hint's first line, with or without a `title`.
 *
 * A disabled row that is also `selected` differs by form: a button is not the current row while
 * it is blocked to the eye (no fill; `aria-current` stays for assistive tech), and an option keeps
 * the fill, because in a listbox the fill is where the keys are.
 */

import { Show, type JSX } from "solid-js";
import { describeByHint, installHints } from "./Tooltip";

export interface RowProps {
  /** The current row: the .14 fill, the full ink, and `aria-current="true"` (`aria-selected` on an `option`). */
  selected?: boolean;
  /** Blocks the click and drops the ink to the disabled step. */
  disabled?: boolean;
  /** The hint: what the row's text leaves out. It shows in the layer's hint box and is the row's
   *  accessible description, never its name. A clipped label needs none: it shows in full by itself. */
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
  if (typeof document !== "undefined") installHints();
  const click = (event: MouseEvent): void => {
    if (!props.disabled) props.onClick?.(event);
  };
  return (
    <Show
      when={props.option}
      fallback={
        <button
          ref={(el: HTMLButtonElement) => describeByHint(el, () => props.title)}
          type="button"
          class="ui-row"
          id={props.id}
          aria-current={props.selected ? "true" : undefined}
          disabled={props.disabled}
          data-hint={props.title ?? ""}
          onClick={click}
          onPointerMove={(event) => props.onPointerMove?.(event)}
        >
          {props.children}
        </button>
      }
    >
      <div
        ref={(el: HTMLDivElement) => describeByHint(el, () => props.title)}
        role="option"
        class="ui-row ui-row--option"
        id={props.id}
        aria-selected={props.selected ? "true" : "false"}
        aria-disabled={props.disabled ? "true" : undefined}
        data-hint={props.title ?? ""}
        onClick={click}
        onPointerMove={(event) => props.onPointerMove?.(event)}
      >
        {props.children}
      </div>
    </Show>
  );
}
