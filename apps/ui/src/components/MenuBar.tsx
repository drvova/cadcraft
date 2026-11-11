/**
 * The menu bar: the top-level titles of `menus.rs`'s `MENUS` order, each opening a dropdown built
 * from the engine's command registry plus the `ui.*` items in `commands.ts`.
 *
 * Behaviour mirrors the desktop chrome (`menus.rs::menu_bar` / `switch_on_hover`): clicking a
 * title opens it, hovering another title while one is open switches to it, Escape or a click
 * outside closes, a submenu opens on hover, items show their shortcut right-aligned and read
 * dimmed when disabled.
 *
 * The keyboard is the menubar pattern of the ARIA Authoring Practices. The bar is one Tab stop
 * (the title last used). On the bar, Left and Right move between titles, Down, Enter or Space
 * open the menu on its first row and Up on its last. In a menu the focus itself is on a row: Down
 * and Up move and wrap, Home and End jump, a letter jumps to the next row that starts with it,
 * Right opens a submenu and moves into it (or moves to the next title's menu), Left closes a
 * submenu back to its row (or moves to the previous title's menu), Escape closes one level and
 * returns the focus to what opened it, Enter or Space invoke and return the focus to the title.
 * A row that is not available keeps its place in the walk (`aria-disabled`) and does not invoke.
 * Tab leaves the bar and closes the menu. Focus is never trapped.
 *
 * A window too narrow for the bar (900px and under, where the title bar folds it away) shows one
 * menu key in its place. It opens the same tree as one vertical menu: the titles are its rows and
 * each title's menu is a submenu, drawn by the same rows and walked by the same keys. Enter, Space
 * or Down on the key open the menu on its first row and Up on its last, Escape closes one level
 * and, from the titles, returns the focus to the key. Left and Right only open and close
 * submenus: there is no bar to move along. Where a submenu has no room beside its parent (560px
 * and under) it opens in place, as an indented group under its row in a menu that scrolls: the
 * row that opened it stays in view above it, so nothing has to be added to get back, and the
 * roles and the keys are the ones of the menus that open beside.
 */

import { createEffect, createMemo, createSignal, createUniqueId, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { CommandInfo } from "../facade";
import { buildMenu, hoverPath, isMacPlatform, sameStrings, shortcutLabel, UI_ITEMS, type MenuNode } from "../commands";
import { ToolIcon } from "../icons";
import { isTypeaheadKey, rovingIndex, typeaheadIndex } from "../roving";
import { IconButton } from "../ui/IconButton";
import "../chrome.css";

/**
 * Keeps an opened menu inside the window. A submenu with no room on the right of its row (its
 * menu is near the window's edge, or it opens from the last column of a tall menu) opens on the
 * left of it (`is-flipped`, chrome.css). Whatever still overhangs, such as a submenu low in a
 * short window, is pulled back by the overhang, never past the top-left corner. The margin kept
 * from the window's edge is the menu's own inset. The status bar is an edge too: a menu ends above
 * it (`--menu-floor`, which chrome.css takes out of a menu's height). A submenu opened in place
 * (the compact menu in a narrow window) is in its parent's flow and is only scrolled into view,
 * with the row that opened it: a group longer than the box starts at the box's top, under its row.
 */
function keepOnScreen(drop: HTMLElement): void {
  if (!drop.isConnected) return;
  const style = getComputedStyle(drop);
  if (style.position === "static") {
    const item = drop.parentElement;
    const box = item?.closest<HTMLElement>(".is-stacked");
    if (item === null || box === null || box === undefined) return;
    item.scrollIntoView({ block: item.offsetHeight > box.clientHeight ? "start" : "nearest" });
    return;
  }
  const margin = Number.parseFloat(style.paddingLeft) || 0;
  const floor = document.querySelector(".statusbar")?.getBoundingClientRect().top ?? window.innerHeight;
  drop.style.setProperty("--menu-floor", `${Math.max(0, window.innerHeight - floor)}px`);
  const right = window.innerWidth - margin;
  const bottom = floor - margin;
  if (drop.classList.contains("menu-drop-sub") && drop.getBoundingClientRect().right > right) drop.classList.add("is-flipped");
  const box = drop.getBoundingClientRect();
  const shiftX = Math.max(Math.min(0, right - box.right), margin - box.left);
  const shiftY = Math.max(Math.min(0, bottom - box.bottom), margin - box.top);
  if (box.right > right || box.left < margin) drop.style.setProperty("--menu-shift-x", `${shiftX}px`);
  if (box.bottom > bottom || box.top < margin) drop.style.setProperty("--menu-shift-y", `${shiftY}px`);
}

/** A menu's `ref`: it is measured once it is in the document, before the frame is painted. */
const placeMenu = (drop: HTMLElement): void => queueMicrotask(() => keepOnScreen(drop));

/** Only a mouse hovers: a finger's tap also "enters" a row, and its click must be the one act. */
const hovers = (event: PointerEvent): boolean => event.pointerType === "mouse";

/** A click made by the keyboard (Enter, Space) or by assistive technology: no pointer pressed. */
const keyed = (event: MouseEvent): boolean => event.detail === 0;

/** The menu a title or a submenu's row opens: the `role="menu"` rendered beside it. */
const menuOf = (owner: HTMLElement): HTMLElement | null => owner.parentElement?.querySelector<HTMLElement>(':scope > [role="menu"]') ?? null;

/** A menu's own rows in reading order (down the first column, then the next), not its submenus'. */
const rowsOf = (menu: HTMLElement): HTMLElement[] => Array.from(menu.querySelectorAll<HTMLElement>(":scope > .menu-item > .menu-row"));

/** `openIndex` when the open menu is the compact one, opened by the menu key, not by a title. */
const COMPACT = -1;

/**
 * The widths under which the bar gives way to the menu key (the title bar folds the bar away
 * there) and under which the compact menu's submenus open in place. chrome.css shows and hides
 * the bar and the key at the first; the second is decided here alone (`is-stacked`).
 */
const COMPACT_QUERY = "(max-width: 900px)";
const STACKED_QUERY = "(max-width: 560px)";

export interface MenuBarProps {
  commands: CommandInfo[];
  onInvoke: (id: string) => void;
}

export function MenuBar(props: MenuBarProps): JSX.Element {
  let root: HTMLDivElement | undefined;
  let keyHost: HTMLDivElement | undefined;
  const compactId = createUniqueId();
  const titles: (HTMLButtonElement | undefined)[] = [];
  /** The open title's index, `COMPACT` for the menu key's menu, `null` when nothing is open. */
  const [openIndex, setOpenIndex] = createSignal<number | null>(null);
  /** The open submenu chain inside the open dropdown, from its top list. */
  const [openPath, setOpenPath] = createSignal<readonly string[]>([]);
  /** The title that is the bar's one Tab stop: the one last focused or opened. */
  const [tabStop, setTabStop] = createSignal(0);

  const tree = createMemo(() => buildMenu(props.commands, UI_ITEMS));

  const compactMedia = window.matchMedia(COMPACT_QUERY);
  const stackedMedia = window.matchMedia(STACKED_QUERY);
  /** Whether the compact menu's submenus open in place (no room beside their parent). */
  const [stacked, setStacked] = createSignal(stackedMedia.matches);

  /** The menu key itself: the system's icon button inside its host. */
  const menuKey = (): HTMLElement | null => keyHost?.querySelector<HTMLElement>(":scope > button") ?? null;
  /** What opened the open menu and takes the focus back when it closes: a title or the menu key. */
  const opener = (): HTMLElement | null => (openIndex() === COMPACT ? menuKey() : (titles[openIndex() ?? -1] ?? null));

  const close = (): void => {
    setOpenIndex(null);
    setOpenPath([]);
  };
  const open = (index: number): void => {
    setOpenIndex(index);
    setOpenPath([]);
    setTabStop(index);
  };

  /** Puts the focus on the first (or last) row of the menu `owner` opens; on `owner` if it is empty. */
  const enter = (owner: HTMLElement | undefined, last = false): void => {
    if (owner === undefined) return;
    const menu = menuOf(owner);
    const rows = menu === null ? [] : rowsOf(menu);
    (rows[last ? rows.length - 1 : 0] ?? owner).focus();
  };
  /** Opens a title's menu from the keyboard and moves into it. */
  const openInto = (index: number, last = false): void => {
    open(index);
    enter(titles[index], last);
  };
  /** Opens the compact menu; from the keyboard (`into`) the focus moves to its first or last row. */
  const openCompact = (into: boolean, last = false): void => {
    setOpenIndex(COMPACT);
    setOpenPath([]);
    if (into) enter(menuKey() ?? undefined, last);
  };

  // A window resized across either width swaps the bar for the key, or the submenus' placement:
  // a menu open at that moment was placed for the other arrangement, so it closes.
  const onCompactChange = (): void => close();
  const onStackedChange = (): void => {
    close();
    setStacked(stackedMedia.matches);
  };
  compactMedia.addEventListener("change", onCompactChange);
  stackedMedia.addEventListener("change", onStackedChange);
  onCleanup(() => {
    compactMedia.removeEventListener("change", onCompactChange);
    stackedMedia.removeEventListener("change", onStackedChange);
  });
  // The system's icon button says whether it is expanded; that what it opens is a menu is said
  // here.
  onMount(() => menuKey()?.setAttribute("aria-haspopup", "menu"));

  // A click anywhere outside closes the open menu, and so does Escape pressed outside the bar (a
  // menu opened by the pointer leaves the focus where it was). Inside the bar Escape belongs to
  // the title or the row that has the focus: it closes one level.
  createEffect(() => {
    if (openIndex() === null) return;
    // The event's own path, not `contains`: a row that handled the key may already be gone.
    const outside = (event: Event): boolean => root !== undefined && !event.composedPath().includes(root);
    const onPointerDown = (event: PointerEvent): void => {
      if (outside(event)) close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && outside(event)) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  /** Whether the submenu `label` under `path` is on the open chain. */
  const isOpen = (path: readonly string[], label: string): boolean => {
    const chain = openPath();
    return chain[path.length] === label && sameStrings(chain.slice(0, path.length), path);
  };

  const hover = (node: MenuNode, path: readonly string[]): void => {
    // A submenu that opens in place would push the rows away from under the pointer: there a
    // submenu opens on a click only.
    if (openIndex() === COMPACT && stacked()) return;
    // Only a real change: a signal that notified on every hover would redo the work under the
    // pointer for nothing.
    const next = hoverPath(openPath(), node, path);
    if (next !== openPath()) setOpenPath(next);
  };

  const clickRow = (event: MouseEvent, row: HTMLElement, node: MenuNode, path: readonly string[]): void => {
    if (node.id !== null) {
      if (!node.enabled) return;
      // From the keyboard the focus is on the row that is about to go: it returns to the title
      // (or to the menu key).
      if (keyed(event)) opener()?.focus();
      close();
      props.onInvoke(node.id);
      return;
    }
    if (keyed(event)) {
      setOpenPath([...path, node.label]);
      enter(row);
      return;
    }
    setOpenPath(isOpen(path, node.label) ? path : [...path, node.label]);
  };

  const onTitleKey = (event: KeyboardEvent, index: number): void => {
    if (event.key === "Escape") {
      if (openIndex() === null) return;
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openInto(index, event.key === "ArrowUp");
      return;
    }
    const labels = tree().map((title) => title.label);
    const next = isTypeaheadKey(event) ? typeaheadIndex(labels, index, event.key) : rovingIndex(event.key, index, labels.length, "horizontal");
    if (next === null) return;
    event.preventDefault();
    // A menu that is open follows the focus along the bar, as it follows the pointer.
    if (openIndex() !== null) open(next);
    titles[next]?.focus();
  };

  /** The menu key's own keys: Down and Up open the menu on its first and last row, Escape closes it. */
  const onMenuKey = (event: KeyboardEvent): void => {
    if (event.target !== menuKey()) return;
    if (event.key === "Escape" && openIndex() === COMPACT) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openCompact(true, event.key === "ArrowUp");
    }
  };

  const onRowKey = (event: KeyboardEvent, row: HTMLElement, node: MenuNode, path: readonly string[], siblings: readonly MenuNode[]): void => {
    const top = openIndex();
    const menu = row.closest<HTMLElement>('[role="menu"]');
    if (top === null || menu === null) return;
    const count = tree().length;
    const compact = top === COMPACT;
    if (event.key === "Tab") {
      // Tab leaves the whole bar: the menu closes and the browser's Tab goes on from the title
      // (or from the menu key).
      opener()?.focus();
      close();
      return;
    }
    if (event.key === "Escape" || (event.key === "ArrowLeft" && path.length > 0)) {
      event.preventDefault();
      if (path.length === 0) {
        opener()?.focus();
        close();
        return;
      }
      // The parent row is a sibling of this submenu; it takes the focus before the submenu goes.
      menu.parentElement?.querySelector<HTMLElement>(":scope > .menu-row")?.focus();
      setOpenPath(path.slice(0, -1));
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      // The compact menu has no bar to move along: Left on its titles stays where it is.
      if (!compact) openInto((top - 1 + count) % count);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (node.id === null) {
        setOpenPath([...path, node.label]);
        enter(row);
      } else if (!compact) {
        openInto((top + 1) % count);
      }
      return;
    }
    const at = siblings.indexOf(node);
    const next = isTypeaheadKey(event)
      ? typeaheadIndex(
          siblings.map((sibling) => sibling.label),
          at,
          event.key,
        )
      : rovingIndex(event.key, at, siblings.length, "vertical");
    if (next === null) return;
    event.preventDefault();
    // Leaving a row closes whatever submenu the pointer left open below this level.
    if (!sameStrings(openPath(), path)) setOpenPath(path);
    rowsOf(menu)[next]?.focus();
  };

  const renderList = (nodes: readonly MenuNode[], path: readonly string[]): JSX.Element => <For each={nodes}>{(node) => renderNode(node, path, nodes)}</For>;

  const renderNode = (node: MenuNode, path: readonly string[], siblings: readonly MenuNode[]): JSX.Element => {
    const submenu = node.id === null;
    const unavailable = !submenu && !node.enabled;
    return (
      <div class={submenu ? "menu-item menu-sub" : "menu-item menu-leaf"} role="none">
        <button
          class={unavailable ? "menu-row is-disabled" : "menu-row"}
          type="button"
          role="menuitem"
          tabIndex={-1}
          aria-disabled={unavailable ? "true" : undefined}
          aria-haspopup={submenu ? "menu" : undefined}
          aria-expanded={submenu ? isOpen(path, node.label) : undefined}
          onPointerEnter={(event) => {
            if (hovers(event)) hover(node, path);
          }}
          onKeyDown={(event) => onRowKey(event, event.currentTarget, node, path, siblings)}
          onClick={(event) => clickRow(event, event.currentTarget, node, path)}
        >
          <span class="menu-label">{node.label}</span>
          <Show when={node.shortcut !== ""}>
            <span class="menu-shortcut">{shortcutLabel(node.shortcut, isMacPlatform())}</span>
          </Show>
          <Show when={submenu}>
            <span class="menu-arrow" aria-hidden="true">
              <ToolIcon id="chevron-right" />
            </span>
          </Show>
        </button>
        <Show when={submenu && isOpen(path, node.label)}>
          <div class="menu-drop menu-drop-sub" role="menu" aria-label={node.label} ref={placeMenu}>
            {renderList(node.children, [...path, node.label])}
          </div>
        </Show>
      </div>
    );
  };

  return (
    <div
      class="menus"
      ref={root}
      onFocusOut={(event) => {
        // The focus going to something outside the menus (Tab, a click on another control) closes
        // the menu; the focus merely dropped (a row taken away, the window left) does not.
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <nav class="menubar" role="menubar" aria-label="Main menu">
        <For each={tree()}>
          {(title, index) => (
            <div class="menubar-item" role="none">
              <button
                class={openIndex() === index() ? "menubar-title is-open" : "menubar-title"}
                type="button"
                role="menuitem"
                tabIndex={tabStop() === index() ? 0 : -1}
                aria-haspopup="menu"
                aria-expanded={openIndex() === index()}
                ref={(element) => {
                  titles[index()] = element;
                }}
                onFocus={() => setTabStop(index())}
                onKeyDown={(event) => onTitleKey(event, index())}
                onPointerEnter={(event) => {
                  // While a menu is open, pointing at another title opens that one (switch_on_hover).
                  if (hovers(event) && openIndex() !== null && openIndex() !== index()) open(index());
                }}
                onClick={(event) => {
                  // Enter or Space: open it and move into it. A pointer's click opens or closes it.
                  if (keyed(event)) openInto(index());
                  else if (openIndex() === index()) close();
                  else open(index());
                }}
              >
                {title.label}
              </button>
              <Show when={openIndex() === index()}>
                <div class="menu-drop" role="menu" aria-label={title.label} ref={placeMenu}>
                  {renderList(title.children, [])}
                </div>
              </Show>
            </div>
          )}
        </For>
      </nav>
      <div class="menu-compact" role="none" ref={keyHost} onKeyDown={onMenuKey}>
        <IconButton
          icon="list"
          title="Main menu"
          expanded={openIndex() === COMPACT}
          controls={compactId}
          onClick={(event) => {
            // Enter or Space: open it and move into it. A pointer's click opens or closes it.
            if (keyed(event)) openCompact(true);
            else if (openIndex() === COMPACT) close();
            else openCompact(false);
          }}
        />
        <Show when={openIndex() === COMPACT}>
          <div id={compactId} class={stacked() ? "menu-drop is-stacked" : "menu-drop"} role="menu" aria-label="Main menu" ref={placeMenu}>
            {renderList(tree(), [])}
          </div>
        </Show>
      </div>
    </div>
  );
}
