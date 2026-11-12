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
 * `menuitem` is the row of a `role="menu"` whose owner moves the focus from row to row: the band
 * is a native button that is the `role="menuitem"` element itself, out of the Tab order
 * (`tabindex="-1"`), in the menu's own recipe (a taller band at the full ink, a corner concentric
 * with the popover's, the hover fill held while the keyboard is on it and while its submenu is
 * open). A row that is not available is `aria-disabled`, never natively `disabled`: it keeps its
 * place in the keyboard's walk, shows the ring without the fill, and takes no click. A row that
 * opens a submenu says so with `popup="menu"` and `expanded`, as `IconButton` does. The keys and
 * the pointer's arrival are the menu's to act on (`onKeyDown`, `onPointerEnter`), on a blocked row
 * too. It is never the current row (`selected` is not read), and what it is described by is the
 * caller's own line (`describedBy`) before the hint's.
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
  /** The row is one item of a `role="menu"` that moves the focus itself: a `role="menuitem"`
   *  button out of the Tab order, in the menu's recipe; `disabled` becomes `aria-disabled`. */
  menuitem?: boolean;
  /** A menu row that opens a submenu: sets `aria-haspopup`. Pass `expanded` with it. */
  popup?: "menu";
  /** Whether the submenu the row opens is showing: sets `aria-expanded`, and holds the hover fill while it is. */
  expanded?: boolean;
  /** The `id` of a line of the caller's that describes the row: `aria-describedby`, before the hint's own. */
  describedBy?: string;
  /** A key pressed on a menu row: the menu's walk. A disabled row hears it too. */
  onKeyDown?: (event: KeyboardEvent) => void;
  /** The pointer arrived on a menu row: the menu opens or closes a submenu. A disabled row hears it too. */
  onPointerEnter?: (event: PointerEvent) => void;
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
  if (props.menuitem) {
    return (
      <button
        ref={(el: HTMLButtonElement) => describeByHint(el, () => props.title, () => props.describedBy)}
        type="button"
        role="menuitem"
        class="ui-row ui-row--menuitem"
        id={props.id}
        tabIndex={-1}
        aria-disabled={props.disabled ? "true" : undefined}
        aria-haspopup={props.popup}
        aria-expanded={props.expanded === undefined ? undefined : props.expanded}
        data-hint={props.title ?? ""}
        onClick={click}
        onKeyDown={(event) => props.onKeyDown?.(event)}
        onPointerEnter={(event) => props.onPointerEnter?.(event)}
        onPointerMove={(event) => props.onPointerMove?.(event)}
      >
        {props.children}
      </button>
    );
  }
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
