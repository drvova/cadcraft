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
 */

import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import type { CommandInfo } from "../facade";
import { buildMenu, hoverPath, isMacPlatform, sameStrings, shortcutLabel, UI_ITEMS, type MenuNode } from "../commands";
import { ToolIcon } from "../icons";
import { isTypeaheadKey, rovingIndex, typeaheadIndex } from "../roving";
import "../chrome.css";

/**
 * Keeps an opened menu inside the window. A submenu with no room on the right of its row (its
 * menu is near the window's edge, or it opens from the last column of a tall menu) opens on the
 * left of it (`is-flipped`, chrome.css). Whatever still overhangs, such as a submenu low in a
 * short window, is pulled back by the overhang, never past the top-left corner. The margin kept
 * from the window's edge is the menu's own inset.
 */
function keepOnScreen(drop: HTMLElement): void {
  if (!drop.isConnected) return;
  const margin = Number.parseFloat(getComputedStyle(drop).paddingLeft) || 0;
  const right = window.innerWidth - margin;
  const bottom = window.innerHeight - margin;
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

export interface MenuBarProps {
  commands: CommandInfo[];
  onInvoke: (id: string) => void;
}

export function MenuBar(props: MenuBarProps): JSX.Element {
  let root: HTMLElement | undefined;
  const titles: (HTMLButtonElement | undefined)[] = [];
  const [openIndex, setOpenIndex] = createSignal<number | null>(null);
  /** The open submenu chain inside the open dropdown, from its top list. */
  const [openPath, setOpenPath] = createSignal<readonly string[]>([]);
  /** The title that is the bar's one Tab stop: the one last focused or opened. */
  const [tabStop, setTabStop] = createSignal(0);

  const tree = createMemo(() => buildMenu(props.commands, UI_ITEMS));

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
    // Only a real change: a signal that notified on every hover would redo the work under the
    // pointer for nothing.
    const next = hoverPath(openPath(), node, path);
    if (next !== openPath()) setOpenPath(next);
  };

  const clickRow = (event: MouseEvent, row: HTMLElement, node: MenuNode, path: readonly string[]): void => {
    if (node.id !== null) {
      if (!node.enabled) return;
      // From the keyboard the focus is on the row that is about to go: it returns to the title.
      if (keyed(event)) titles[openIndex() ?? -1]?.focus();
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

  const onRowKey = (event: KeyboardEvent, row: HTMLElement, node: MenuNode, path: readonly string[], siblings: readonly MenuNode[]): void => {
    const top = openIndex();
    const menu = row.closest<HTMLElement>('[role="menu"]');
    if (top === null || menu === null) return;
    const count = tree().length;
    if (event.key === "Tab") {
      // Tab leaves the whole bar: the menu closes and the browser's Tab goes on from the title.
      titles[top]?.focus();
      close();
      return;
    }
    if (event.key === "Escape" || (event.key === "ArrowLeft" && path.length > 0)) {
      event.preventDefault();
      if (path.length === 0) {
        titles[top]?.focus();
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
      openInto((top - 1 + count) % count);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (node.id === null) {
        setOpenPath([...path, node.label]);
        enter(row);
      } else {
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
    <nav
      class="menubar"
      role="menubar"
      aria-label="Main menu"
      ref={root}
      onFocusOut={(event) => {
        // The focus going to something outside the bar (Tab, a click on another control) closes
        // the menu; the focus merely dropped (a row taken away, the window left) does not.
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
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
  );
}
