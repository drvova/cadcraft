/**
 * The menu: a tree of items drawn as a `role="menu"` of `menuitem` rows (the layer's `Row` in its
 * `menuitem` form, found here by its role), with submenus. It owns
 * what every menu in the shell shares: the rows, the chain of open submenus, the keyboard's walk,
 * the pointer's hover and click, the placement that keeps an opened menu inside the window, and
 * the ways it asks to be closed. What opened it owns the rest: whether it is open, and where the
 * focus goes when it closes. The menu bar's dropdowns, the compact Main menu and the tool strip's
 * overflow menu are this one component; the rules without a DOM are in `../menu.ts`.
 *
 * The keys are the menu pattern of the ARIA Authoring Practices, and the focus itself is on a
 * row: Down and Up move and wrap, Home and End jump, a letter jumps to the next row that starts
 * with it, Right opens a submenu and moves into it, Left or Escape closes a submenu back to its
 * row, Enter or Space invoke. A row that is not available keeps its place in the walk
 * (`aria-disabled`) and does not invoke. Escape on the menu's own rows and Tab ask the owner to
 * close it (`onDismiss`); Left there and Right on an item ask for the menu beside (`onStep`),
 * which only a menu bar has.
 *
 * A submenu opens on hover or a click, level with its row and outside its whole parent menu (a
 * menu that stands in columns keeps its other column in view), on the menu's other side where the
 * window ends. A row crossed on the way to an open submenu does not close it. A `stacked` menu has no room beside its rows: it is one column that scrolls, and a
 * submenu opens in place, as an indented group under its row, on a click only.
 *
 * A row may be the first of a group (`group`): a separator is drawn above it. A separator is not a
 * row: it takes no focus, and the keys, the typeahead and the rows' count pass it by. A row may
 * carry the name typed at the command line that runs it (`name`), drawn quiet before the
 * shortcut and read as the row's description, not as part of its name.
 *
 * `MenuKey` is the icon key that opens a menu of its own: the Main menu key and the tool strip's
 * overflow key.
 */

import { createSignal, createUniqueId, Index, onCleanup, Show, type Accessor, type JSX } from "solid-js";
import { isMacPlatform, shortcutLabel } from "../commands";
import { ToolIcon } from "../icons";
import { AIM_GRACE_MS, aimsAt, clickPath, hoverPath, isOnPath, menuBounds, menuColumns, menuShift, ROW_TRACKS, rowKeyAction, samePath, showsName, stackedBlock, submenuPlacement, walkIndex, type MenuItem, type MenuPath, type Point } from "../menu";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";

/**
 * Keeps an opened menu inside the window. A submenu opens on the right of its parent menu, and
 * with no room there (the menu is near the window's edge) on the left of it (`is-flipped`,
 * chrome.css), past the menu's edge either way (`--menu-reach`). Whatever still overhangs, such as a submenu low in a
 * short window, is pulled back by the overhang, never past the top-left corner. The margin kept
 * from the window's edge is the menu's own inset. The status bar is an edge too: a menu ends above
 * it (`--menu-floor`, which chrome.css takes out of a menu's height), and a menu taller than that
 * stands in columns (`layColumns`). A submenu opened in place
 * (a stacked menu) is in its parent's flow and is only scrolled into view, with the row that
 * opened it: a group longer than the box starts at the box's top, under its row.
 */
/**
 * Stands a menu's rows in columns (`menuColumns`): marks the rows that start a column
 * (`data-column-start`, chrome.css) and hides the separators that would lead or end one. The box
 * holds as many tracks as its greatest height has room for; a menu that is not a grid (one that
 * scrolls, a group opened in place) is one column with every separator drawn.
 */
function layColumns(drop: HTMLElement, style: CSSStyleDeclaration): void {
  const items = Array.from(drop.querySelectorAll<HTMLElement>(":scope > .menu-item"));
  const separatorOf = (item: HTMLElement): HTMLElement | null => {
    const before = item.previousElementSibling;
    return before instanceof HTMLElement && before.classList.contains("menu-separator") ? before : null;
  };
  const px = (value: string): number => Number.parseFloat(value) || 0;
  const track = (items[0]?.offsetHeight ?? 0) / ROW_TRACKS;
  const frame = style.boxSizing === "border-box" ? px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth) : 0;
  // Half a pixel of slack: the greatest height is a fraction where the window's is.
  const capacity = style.display === "grid" && track > 0 ? (Number.parseFloat(style.maxHeight) - frame + 0.5) / track : Number.POSITIVE_INFINITY;
  const plan = menuColumns(
    items.map((item) => separatorOf(item) !== null),
    capacity,
  );
  items.forEach((item, row) => {
    item.toggleAttribute("data-column-start", plan.starts[row] === true);
    const separator = separatorOf(item);
    if (separator !== null) separator.hidden = plan.separators[row] !== true;
  });
}

function keepOnScreen(drop: HTMLElement): void {
  if (!drop.isConnected) return;
  const style = getComputedStyle(drop);
  if (style.position === "static") {
    const item = drop.parentElement;
    const box = item?.closest<HTMLElement>(".is-stacked");
    if (item === null || box === null || box === undefined) return;
    item.scrollIntoView({ block: stackedBlock(item.offsetHeight, box.clientHeight) });
    return;
  }
  const margin = Number.parseFloat(style.paddingLeft) || 0;
  const floor = document.querySelector(".statusbar")?.getBoundingClientRect().top ?? window.innerHeight;
  drop.style.setProperty("--menu-floor", `${Math.max(0, window.innerHeight - floor)}px`);
  layColumns(drop, style);
  const bounds = menuBounds(window.innerWidth, floor, margin);
  // A submenu stands outside its whole parent menu, on the side with room (`submenuPlacement`):
  // chrome.css starts it `--menu-reach` past its row's edge on that side.
  const item = drop.parentElement;
  const parent = item?.parentElement;
  if (drop.classList.contains("menu-drop-sub") && item !== null && parent !== null && parent !== undefined) {
    const gap = Number.parseFloat(style.getPropertyValue("--menu-sub-gap")) || 0;
    const place = submenuPlacement(item.getBoundingClientRect(), parent.getBoundingClientRect(), drop.getBoundingClientRect().width, gap, bounds);
    drop.style.setProperty("--menu-reach", `${place.reach}px`);
    drop.classList.toggle("is-flipped", place.flipped);
  }
  const shift = menuShift(drop.getBoundingClientRect(), bounds);
  if (shift.x !== null) drop.style.setProperty("--menu-shift-x", `${shift.x}px`);
  if (shift.y !== null) drop.style.setProperty("--menu-shift-y", `${shift.y}px`);
  // The floor may have shortened a menu that scrolls after one of its rows took the focus (a menu
  // opened on its last row): the row is brought back into view.
  const active = document.activeElement;
  if (active instanceof HTMLElement && drop.contains(active) && drop.scrollHeight > drop.clientHeight) active.scrollIntoView({ block: "nearest" });
}

/** A menu's `ref`: it is measured once it is in the document, before the frame is painted. */
const placeMenu = (drop: HTMLElement): void => queueMicrotask(() => keepOnScreen(drop));

/** Only a mouse hovers: a finger's tap also "enters" a row, and its click must be the one act. */
export const hovers = (event: PointerEvent): boolean => event.pointerType === "mouse";

/** A click made by the keyboard (Enter, Space) or by assistive technology: no pointer pressed. */
export const keyed = (event: MouseEvent): boolean => event.detail === 0;

/** The submenu a row opens: the `role="menu"` rendered beside it. */
const menuOf = (row: HTMLElement): HTMLElement | null => row.parentElement?.querySelector<HTMLElement>(':scope > [role="menu"]') ?? null;

/** A row among the children of its `.menu-item`: the layer's `Row`, found by the role it carries. */
const ROW = ':scope > [role="menuitem"]';

/** A menu's own rows in reading order (down the first column, then the next), not its submenus'. */
const rowsOf = (menu: HTMLElement): HTMLElement[] => Array.from(menu.querySelectorAll<HTMLElement>(':scope > .menu-item > [role="menuitem"]'));

/** The row an event of a row's own was heard on. */
const rowOf = (event: Event): HTMLElement | null => (event.currentTarget instanceof HTMLElement ? event.currentTarget : null);

/** Puts the focus on the first (or last) row of `menu`; says whether there was a row to take it. */
function enterRows(menu: HTMLElement | null | undefined, last: boolean): boolean {
  const rows = menu === null || menu === undefined ? [] : rowsOf(menu);
  const row = rows[last ? rows.length - 1 : 0];
  row?.focus();
  return row !== undefined;
}

/**
 * Why a menu asks to be closed. `escape`: Escape on its own rows. `tab`: Tab on a row; the focus
 * goes back to what opened the menu and the browser's Tab goes on from there. `outside`: a press,
 * or Escape, outside its ground; the focus stays where it is.
 */
export type MenuDismiss = "escape" | "tab" | "outside";

/** What the owner of an open menu can ask of it. */
export interface MenuHandle {
  /** Closes the submenus and puts the focus on the first (or last) row; `false` when the menu has no row. */
  enter: (last?: boolean) => boolean;
  /** Closes the submenus. */
  collapse: () => void;
}

export interface MenuProps {
  /** The rows. They are kept by their place: a list built anew keeps the row that has the focus. */
  items: readonly MenuItem[];
  /** The menu's accessible name. */
  label: string;
  /** The menu's `id`, for the `aria-controls` of what opened it. */
  id?: string;
  /** No room beside the rows: one column that scrolls, submenus opened in place on a click. */
  stacked?: boolean;
  /** The menu's ground, which holds the menu and what opened it: a press or Escape outside it dismisses. */
  within: () => HTMLElement | undefined;
  /** An available item was chosen, by the keyboard (`byKey`) or by a pointer. */
  onInvoke: (id: string, byKey: boolean) => void;
  /** The menu asks to be closed. */
  onDismiss: (reason: MenuDismiss) => void;
  /** Left on the menu's own rows (-1) or Right on an item (1): a menu bar moves to the menu beside. */
  onStep?: (delta: 1 | -1) => void;
  /** Receives the menu's handle once, when the menu is made. */
  handle?: (handle: MenuHandle) => void;
}

export function Menu(props: MenuProps): JSX.Element {
  let root: HTMLDivElement | undefined;
  /** The open submenu chain, from the menu's own rows. */
  const [chain, setChain] = createSignal<MenuPath>([]);
  /**
   * The submenu the pointer's hover opened and no click has touched yet. A click that lands on
   * its row is the end of the gesture that opened it, not a wish to close it.
   */
  let hoverOpened: MenuPath | null = null;

  props.handle?.({
    enter: (last = false) => {
      setChain([]);
      return enterRows(root, last);
    },
    collapse: () => setChain([]),
  });

  // A press anywhere outside the ground dismisses the menu, and so does Escape pressed outside it
  // (a menu opened by the pointer leaves the focus where it was). Inside, Escape belongs to the
  // control that has the focus. The event's own path, not `contains`: a row that handled the key
  // may already be gone.
  const outside = (event: Event): boolean => {
    const ground = props.within();
    return ground !== undefined && !event.composedPath().includes(ground);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (outside(event)) props.onDismiss("outside");
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && outside(event)) props.onDismiss("outside");
  };
  // A window resized under an open menu moves the edges the menu was placed against (the
  // window's own, and the status bar, which grows by a line when its toggles wrap): the menus
  // that are placed (not the groups opened in place) are placed again.
  const onResize = (): void => {
    if (root === undefined) return;
    for (const drop of [root, ...root.querySelectorAll<HTMLElement>(".menu-drop")]) {
      if (getComputedStyle(drop).position === "static") continue;
      drop.classList.remove("is-flipped");
      drop.style.removeProperty("--menu-reach");
      drop.style.removeProperty("--menu-shift-x");
      drop.style.removeProperty("--menu-shift-y");
      keepOnScreen(drop);
    }
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onResize);
  onCleanup(() => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onResize);
  });

  const isOpen = (path: MenuPath, label: string): boolean => isOnPath(chain(), path, label);

  /**
   * The pointer's last two places over the menu, the older first, and when it last moved. A
   * submenu that stands past the other columns of its menu is reached across their rows: a row
   * the pointer crosses while it heads for the open submenu (`aimsAt`) waits before it answers,
   * and answers only if the pointer has come to rest on it.
   */
  let trail: Point[] = [];
  let movedAt = 0;
  let aim: number | undefined;
  const onPointerMove = (event: PointerEvent): void => {
    trail = [...trail.slice(-1), { x: event.clientX, y: event.clientY }];
    movedAt = event.timeStamp;
  };
  onCleanup(() => window.clearTimeout(aim));

  /** Whether a pointer on `row` that moved from `from` to `to` is on its way to the submenu open beside one of the row's siblings. */
  const aiming = (row: HTMLElement, from: Point | undefined, to: Point): boolean => {
    const open = row.closest('[role="menu"]')?.querySelector<HTMLElement>(":scope > .menu-item > .menu-drop-sub");
    return open !== null && open !== undefined && from !== undefined && open.parentElement !== row.parentElement && aimsAt(from, to, open.getBoundingClientRect());
  };

  const hover = (item: MenuItem, path: MenuPath, row: HTMLElement | null, at: Point): void => {
    // A submenu that opens in place would push the rows away from under the pointer: there a
    // submenu opens on a click only.
    if (props.stacked) return;
    window.clearTimeout(aim);
    // Only a real change: a signal that notified on every hover would redo the work under the
    // pointer for nothing.
    const next = hoverPath(chain(), item, path);
    if (next === chain()) return;
    // The pointer's place before it came onto the row is the last one the menu heard.
    if (row !== null && aiming(row, trail[trail.length - 1], at)) {
      const rest = (): void => {
        if (!row.matches(":hover")) return;
        // Still moving, and still toward the submenu: the row goes on waiting.
        const [from, to] = trail;
        if (performance.now() - movedAt < AIM_GRACE_MS && to !== undefined && aiming(row, from, to)) {
          aim = window.setTimeout(rest, AIM_GRACE_MS);
          return;
        }
        hover(item, path, null, at);
      };
      aim = window.setTimeout(rest, AIM_GRACE_MS);
      return;
    }
    hoverOpened = item.id === null ? next : null;
    setChain(next);
  };

  const clickRow = (event: MouseEvent, row: HTMLElement, item: MenuItem, path: MenuPath): void => {
    if (item.id !== null) {
      if (item.enabled) props.onInvoke(item.id, keyed(event));
      return;
    }
    if (keyed(event)) {
      setChain([...path, item.label]);
      enterRows(menuOf(row), false);
      return;
    }
    // A pointer's click opens or closes the submenu, except the click that follows the hover
    // which has just opened it: that one leaves it open, and the next closes it. A finger does
    // not hover, so its tap always opens or closes.
    const byHover = hoverOpened !== null && samePath(hoverOpened, [...path, item.label]);
    hoverOpened = null;
    setChain(clickPath(chain(), path, item.label, byHover));
  };

  const onRowKey = (event: KeyboardEvent, row: HTMLElement, item: MenuItem, path: MenuPath, siblings: readonly MenuItem[], at: number): void => {
    const menu = row.closest<HTMLElement>('[role="menu"]');
    if (menu === null) return;
    const action = rowKeyAction(event.key, path.length, item.id === null);
    if (action === "leave") {
      props.onDismiss("tab");
      return;
    }
    if (action === "walk") {
      const next = walkIndex(
        event,
        siblings.map((sibling) => sibling.label),
        at,
      );
      if (next === null) return;
      event.preventDefault();
      // Leaving a row closes whatever submenu the pointer left open below this level.
      if (!samePath(chain(), path)) setChain(path);
      rowsOf(menu)[next]?.focus();
      return;
    }
    event.preventDefault();
    if (action === "dismiss") {
      props.onDismiss("escape");
    } else if (action === "back") {
      // The parent row is a sibling of this submenu; it takes the focus before the submenu goes.
      menu.parentElement?.querySelector<HTMLElement>(ROW)?.focus();
      setChain(path.slice(0, -1));
    } else if (action === "into") {
      setChain([...path, item.label]);
      enterRows(menuOf(row), false);
    } else {
      props.onStep?.(action === "next" ? 1 : -1);
    }
  };

  // The rows are kept by their place, not by their item: the tree is built anew whenever the
  // command list is refreshed (after every command, and when a command changes what is
  // available), and a row made anew then would drop the focus it holds onto the page.
  const renderList = (items: Accessor<readonly MenuItem[]>, path: MenuPath): JSX.Element => (
    <Index each={items()}>{(item, at) => renderItem(item, at, path, items)}</Index>
  );

  const renderItem = (item: Accessor<MenuItem>, at: number, path: MenuPath, siblings: Accessor<readonly MenuItem[]>): JSX.Element => {
    const submenu = (): boolean => item().id === null;
    const unavailable = (): boolean => !submenu() && !item().enabled;
    const name = (): string => item().name ?? "";
    const nameId = createUniqueId();
    return (
      <>
        <Show when={at > 0 && item().group === true}>
          <div class="menu-separator" role="separator" />
        </Show>
        <div class={submenu() ? "menu-item menu-sub" : "menu-item menu-leaf"} role="none">
          <Row
            menuitem
            disabled={unavailable()}
            popup={submenu() ? "menu" : undefined}
            expanded={submenu() ? isOpen(path, item().label) : undefined}
            describedBy={name() === "" ? undefined : nameId}
            onPointerEnter={(event) => {
              if (hovers(event)) hover(item(), path, rowOf(event), { x: event.clientX, y: event.clientY });
            }}
            onKeyDown={(event) => {
              const row = rowOf(event);
              if (row !== null) onRowKey(event, row, item(), path, siblings(), at);
            }}
            onClick={(event) => {
              const row = rowOf(event);
              if (row !== null) clickRow(event, row, item(), path);
            }}
          >
            <Show when={item().icon} keyed>
              {(icon) => (
                <span class="menu-icon" aria-hidden="true">
                  <ToolIcon id={icon} />
                </span>
              )}
            </Show>
            <span class="menu-label">{item().label}</span>
            {/* The typed name is drawn for the eye and said as the row's description ("Type PL"),
                so the row's name stays its label. A long name is said and not drawn
                (`showsName`). In a row too narrow for all of it, it is the part that goes, whole
                (chrome.css: a one-line box around the name). */}
            <Show when={showsName(name())}>
              <span class="menu-name" aria-hidden="true">
                <span>{name()}</span>
              </span>
            </Show>
            <Show when={name() !== ""}>
              <span id={nameId} hidden>{`Type ${name()}`}</span>
            </Show>
            <Show when={item().shortcut !== ""}>
              <span class="menu-shortcut">{shortcutLabel(item().shortcut, isMacPlatform())}</span>
            </Show>
            <Show when={submenu()}>
              <span class="menu-arrow" aria-hidden="true">
                <ToolIcon id="chevron-right" />
              </span>
            </Show>
          </Row>
          <Show when={submenu() && isOpen(path, item().label) ? item().label : false} keyed>
            {(label) => (
              <div class="menu-drop menu-drop-sub" role="menu" aria-label={label} ref={placeMenu}>
                {renderList(() => item().children, [...path, label])}
              </div>
            )}
          </Show>
        </div>
      </>
    );
  };

  return (
    <div
      id={props.id}
      class={props.stacked ? "menu-drop is-stacked" : "menu-drop"}
      role="menu"
      aria-label={props.label}
      onPointerMove={onPointerMove}
      ref={(element) => {
        root = element;
        placeMenu(element);
      }}
    >
      {renderList(() => props.items, [])}
    </div>
  );
}

export interface MenuKeyProps {
  /** The class of the key's host: the box the menu opens from (chrome.css places it). */
  class: string;
  /** The key's glyph, an id of `icons.ts`. */
  icon: string;
  /** The key's name and hint, and the menu's name. */
  title: string;
  /** The menu's rows. */
  items: readonly MenuItem[];
  /** Whether the menu is open: the owner holds it. */
  open: boolean;
  /** The key asks for the menu to be opened. */
  onOpen: () => void;
  /** The key or its menu asks for the menu to be closed. */
  onClose: () => void;
  /** The menu's `stacked` arrangement. */
  stacked?: boolean;
  /** An item was chosen; the menu is already closed. */
  onInvoke: (id: string) => void;
  /** Receives the host element. */
  ref?: (host: HTMLDivElement) => void;
}

/**
 * An icon key that opens a menu of its own. Enter, Space or Down on the key open the menu on its
 * first row and Up on its last; a pointer's click opens or closes it and leaves the focus on the
 * key. Escape on the key closes it; Escape or Tab in the menu close it with the focus back on the
 * key, and so does an item chosen from the keyboard. The focus going elsewhere closes it.
 */
export function MenuKey(props: MenuKeyProps): JSX.Element {
  let host: HTMLDivElement | undefined;
  let menu: MenuHandle | undefined;
  const menuId = createUniqueId();
  /** The key itself: the system's icon button inside its host. */
  const key = (): HTMLElement | null => host?.querySelector<HTMLElement>(":scope > button") ?? null;

  /** Opens the menu from the keyboard and moves into it; onto the key when it has no row. */
  const openInto = (last = false): void => {
    props.onOpen();
    if (menu?.enter(last) !== true) key()?.focus();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.target !== key()) return;
    if (event.key === "Escape" && props.open) {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openInto(event.key === "ArrowUp");
    }
  };

  return (
    <div
      class={props.class}
      role="none"
      ref={(element) => {
        host = element;
        props.ref?.(element);
      }}
      onKeyDown={onKey}
      onFocusOut={(event) => {
        // The focus going to something outside (Tab, a click on another control) closes the menu;
        // the focus merely dropped (a row taken away, the window left) does not.
        if (props.open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) props.onClose();
      }}
    >
      <IconButton
        icon={props.icon}
        title={props.title}
        popup="menu"
        expanded={props.open}
        controls={menuId}
        onClick={(event) => {
          // Enter or Space: open it and move into it. A pointer's click opens or closes it.
          if (keyed(event)) openInto();
          else if (props.open) props.onClose();
          else props.onOpen();
        }}
      />
      <Show when={props.open}>
        <Menu
          id={menuId}
          label={props.title}
          items={props.items}
          stacked={props.stacked}
          within={() => host}
          handle={(handle) => {
            menu = handle;
          }}
          onInvoke={(id, byKey) => {
            // From the keyboard the focus is on the row that is about to go: it returns to the key.
            if (byKey) key()?.focus();
            props.onClose();
            props.onInvoke(id);
          }}
          onDismiss={(reason) => {
            if (reason !== "outside") key()?.focus();
            props.onClose();
          }}
        />
      </Show>
    </div>
  );
}
