/**
 * A right-click menu: the shell's `Menu` (the same rows, roles, keyboard walk, typeahead and
 * placement the menu bar's menus have) opened at a point of the window instead of under a title.
 * What the menu holds is decided in `../context.ts`; this file only places and shows it.
 *
 * The menu hangs from a host of no size fixed at the point, so `Menu`'s own placement pulls it
 * back inside the window and above the status bar. In a window too narrow for a submenu beside
 * its row it is the stacked menu (one column, submenus opened in place). `Menu` places a menu
 * once, when it opens; one that grows afterwards (a group opened in place, a row added while it
 * is open) is lifted here by what then hangs below the status bar, never past the window's top.
 *
 * It opens with the keyboard on its first row: the arrows, a letter, Enter and Escape work at
 * once, and no row is lit for a pointer (the row's ring is the keyboard's alone). It closes on
 * Escape, Tab, a row chosen, a press elsewhere, a scroll or a wheel elsewhere, a resize, and the
 * window losing the keyboard. The focus then returns to where it was when the menu opened, unless
 * the press that closed it took the focus somewhere itself.
 */

import { createUniqueId, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js";
import type { ContextSource } from "../context";
import type { MenuItem } from "../menu";
import { Menu, type MenuHandle } from "./Menu";
import "../canvas.css";

/** Where a menu was asked for (the window's CSS px), and how. */
export interface MenuPoint {
  x: number;
  y: number;
  source: ContextSource;
}

/** An open menu: where it stands, its accessible name and its rows. */
export interface OpenContextMenu {
  at: MenuPoint;
  label: string;
  items: readonly MenuItem[];
}

/** The window in which a submenu has no room beside its row: the menu is the stacked one. */
const STACKED_QUERY = "(max-width: 700px)";

/**
 * Where the menu a `contextmenu` event asks for opens. A pointer's is at the pointer. The
 * keyboard's (the menu key, Shift+F10: an event no button made) is at `anchor`, the thing that
 * has the focus: under its leading edge.
 */
export function menuPoint(event: MouseEvent, anchor: Element): MenuPoint {
  const touch = event instanceof PointerEvent && event.pointerType === "touch";
  if (touch || event.button === 2) return { x: event.clientX, y: event.clientY, source: touch ? "touch" : "pointer" };
  const box = anchor.getBoundingClientRect();
  return { x: box.left, y: box.bottom, source: "keyboard" };
}

/** Whether a key asks for the menu of what has the focus: the menu key, or Shift+F10. */
export function isMenuKey(event: KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey);
}

export interface ContextMenuProps {
  /** The menu to show, or null for none. Its rows may change while it is open; a new `at` is a new opening. */
  menu: Accessor<OpenContextMenu | null>;
  /** A row was chosen and the focus is back where it was: the owner closes the menu and acts. */
  onInvoke: (id: string) => void;
  /** The menu asks to be closed. */
  onClose: () => void;
}

export function ContextMenu(props: ContextMenuProps): JSX.Element {
  return (
    // One instance per opening: a menu asked for while another is open takes its place.
    <Show when={props.menu()?.at} keyed>
      {(at) => <OpenMenu {...props} at={at} />}
    </Show>
  );
}

/** The menu while it is open: what it remembers (where the focus was, its place) is that opening's. */
function OpenMenu(props: ContextMenuProps & { at: MenuPoint }): JSX.Element {
  let host: HTMLDivElement | undefined;
  let handle: MenuHandle | undefined;
  const menuId = createUniqueId();
  /** What had the keyboard when the menu opened. */
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const stacked = window.matchMedia(STACKED_QUERY).matches;

  /** Hand the keyboard back, when nothing else has taken it. */
  const restore = (always: boolean): void => {
    const active = document.activeElement;
    const adrift = active === null || active === document.body || host?.contains(active) === true;
    if ((always || adrift) && before !== null && before.isConnected) before.focus({ preventScroll: true });
  };

  const close = (always: boolean): void => {
    restore(always);
    props.onClose();
  };

  /** Lift the host by what the menu overhangs the status bar (or the window's end), kept from the top by the menu's own inset. */
  const lift = (menu: HTMLElement): void => {
    if (host === undefined) return;
    const box = menu.getBoundingClientRect();
    const margin = Number.parseFloat(getComputedStyle(menu).paddingTop) || 0;
    const floor = document.querySelector(".statusbar")?.getBoundingClientRect().top ?? window.innerHeight;
    const over = Math.min(box.bottom - (floor - margin), box.top - margin);
    if (over > 0) host.style.setProperty("--context-y", `${Math.round(host.getBoundingClientRect().top - over)}px`);
  };

  onMount(() => {
    handle?.enter(false);
    const menu = host?.querySelector<HTMLElement>(':scope > [role="menu"]');
    if (menu !== null && menu !== undefined && typeof ResizeObserver !== "undefined") {
      const grown = new ResizeObserver(() => lift(menu));
      grown.observe(menu);
      onCleanup(() => grown.disconnect());
    }
    const inside = (event: Event): boolean => host !== undefined && event.composedPath().includes(host);
    const onAway = (event: Event): void => {
      if (!inside(event)) close(true);
    };
    const onResize = (): void => close(true);
    // The window losing the keyboard leaves the focus alone: the browser remembers it.
    const onBlur = (): void => props.onClose();
    document.addEventListener("scroll", onAway, true);
    document.addEventListener("wheel", onAway, { capture: true, passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onBlur);
    onCleanup(() => {
      document.removeEventListener("scroll", onAway, true);
      document.removeEventListener("wheel", onAway, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onBlur);
    });
  });

  return (
    <div
      class="context-menu"
      role="none"
      ref={(element) => {
        host = element;
        element.style.setProperty("--context-x", `${Math.round(props.at.x)}px`);
        element.style.setProperty("--context-y", `${Math.round(props.at.y)}px`);
      }}
      // The menu stands under the pointer that opened it: the browser's own menu stays away from it.
      onContextMenu={(event) => event.preventDefault()}
    >
      <Menu
        id={menuId}
        label={props.menu()?.label ?? ""}
        items={props.menu()?.items ?? []}
        stacked={stacked}
        within={() => host}
        handle={(made) => {
          handle = made;
        }}
        onInvoke={(id) => {
          restore(true);
          props.onInvoke(id);
        }}
        // A press outside moves the focus itself when it lands on something that takes it; the
        // focus left adrift by the row that went with the menu is handed back first.
        onDismiss={(reason) => close(reason !== "outside")}
      />
    </div>
  );
}
