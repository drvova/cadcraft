/**
 * The menu bar: the top-level titles of `menus.rs`'s `MENUS` order, each opening a dropdown built
 * from the engine's command registry plus the `ui.*` items in `commands.ts`.
 *
 * Behaviour mirrors the desktop chrome (`menus.rs::menu_bar` / `switch_on_hover`): clicking a
 * title opens it, hovering another title while one is open switches to it, Escape or a click
 * outside closes, a submenu opens on hover, items show their shortcut right-aligned and read
 * dimmed when disabled. Arrow keys walk the open menu; Enter invokes; ArrowRight/ArrowLeft switch
 * top-level menus. Focus is never trapped.
 */

import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import type { CommandInfo } from "../facade";
import { buildMenu, hoverPath, isMacPlatform, menuEntries, shortcutLabel, UI_ITEMS, type MenuEntry, type MenuNode } from "../commands";
import { ToolIcon } from "../icons";
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

export interface MenuBarProps {
  commands: CommandInfo[];
  onInvoke: (id: string) => void;
}

export function MenuBar(props: MenuBarProps): JSX.Element {
  let root: HTMLElement | undefined;
  const [openIndex, setOpenIndex] = createSignal<number | null>(null);
  /** The open submenu chain inside the open dropdown, relative to its list. */
  const [openPath, setOpenPath] = createSignal<readonly string[]>([]);
  const [active, setActive] = createSignal(0);

  const tree = createMemo(() => buildMenu(props.commands, UI_ITEMS));
  const entries = createMemo<MenuEntry[]>(() => {
    const index = openIndex();
    if (index === null) return [];
    const node = tree()[index];
    return node === undefined ? [] : menuEntries(node.children, openPath());
  });

  const close = (): void => {
    setOpenIndex(null);
    setOpenPath([]);
    setActive(0);
  };
  const open = (index: number): void => {
    setOpenIndex(index);
    setOpenPath([]);
    setActive(0);
  };

  // Escape and a click anywhere outside close the open menu.
  createEffect(() => {
    if (openIndex() === null) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (root !== undefined && event.target instanceof Node && !root.contains(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  const hover = (node: MenuNode, path: readonly string[]): void => {
    const index = entries().findIndex((entry) => entry.node === node);
    if (index >= 0) setActive(index);
    // Only a real change: a fresh array per hover would re-create the rows under the pointer
    // (each re-render fires pointerover again) and no mouse click could ever complete.
    const next = hoverPath(openPath(), node, path);
    if (next !== openPath()) setOpenPath(next);
  };

  const activate = (entry: MenuEntry): void => {
    const node = entry.node;
    if (node.id === null) {
      setOpenPath([...entry.path, node.label]);
      return;
    }
    if (!node.enabled) return;
    close();
    props.onInvoke(node.id);
  };

  const clickRow = (node: MenuNode, path: readonly string[]): void => {
    if (node.id !== null) {
      if (node.enabled) {
        close();
        props.onInvoke(node.id);
      }
      return;
    }
    setOpenPath(openPath()[0] === node.label ? path : [...path, node.label]);
  };

  const move = (delta: number): void => {
    const list = entries();
    if (list.length === 0) return;
    let index = active();
    for (let step = 0; step < list.length; step++) {
      index = (index + delta + list.length) % list.length;
      const entry = list[index];
      if (entry !== undefined && (entry.node.enabled || entry.node.id === null)) {
        setActive(index);
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const index = openIndex();
    if (event.key === "Escape") {
      if (index !== null) {
        event.preventDefault();
        close();
      }
      return;
    }
    if (index === null) {
      if ((event.key === "ArrowDown" || event.key === "Enter") && tree().length > 0) {
        event.preventDefault();
        open(0);
      }
      return;
    }
    const count = tree().length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "ArrowRight" && count > 0) {
      event.preventDefault();
      open((index + 1) % count);
    } else if (event.key === "ArrowLeft" && count > 0) {
      event.preventDefault();
      open((index - 1 + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = entries()[active()];
      if (entry !== undefined) activate(entry);
    }
  };

  const renderList = (nodes: readonly MenuNode[], path: readonly string[], openChain: readonly string[]): JSX.Element => (
    <For each={nodes}>{(node) => renderNode(node, path, openChain)}</For>
  );

  const renderNode = (node: MenuNode, path: readonly string[], openChain: readonly string[]): JSX.Element => {
    const submenu = node.id === null;
    const submenuOpen = submenu && openChain[0] === node.label;
    const classes = (): string => {
      const parts = ["menu-row"];
      const entry = entries()[active()];
      if (entry !== undefined && entry.node === node) parts.push("is-active");
      if (!submenu && !node.enabled) parts.push("is-disabled");
      return parts.join(" ");
    };
    return (
      <div class={submenu ? "menu-sub" : "menu-leaf"}>
        <button
          class={classes()}
          type="button"
          role="menuitem"
          disabled={!submenu && !node.enabled}
          aria-haspopup={submenu ? "true" : undefined}
          aria-expanded={submenu ? submenuOpen : undefined}
          onPointerEnter={(event) => {
            if (hovers(event)) hover(node, path);
          }}
          onClick={() => clickRow(node, path)}
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
        <Show when={submenuOpen}>
          <div class="menu-drop menu-drop-sub" role="menu" ref={placeMenu}>
            {renderList(node.children, [...path, node.label], openChain.slice(1))}
          </div>
        </Show>
      </div>
    );
  };

  return (
    <nav class="menubar" role="menubar" aria-label="Main menu" ref={root} onKeyDown={onKeyDown}>
      <For each={tree()}>
        {(title, index) => (
          <div class="menubar-item">
            <button
              class={openIndex() === index() ? "menubar-title is-open" : "menubar-title"}
              type="button"
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={openIndex() === index()}
              onPointerEnter={(event) => {
                // While a menu is open, pointing at another title opens that one (switch_on_hover).
                if (hovers(event) && openIndex() !== null && openIndex() !== index()) open(index());
              }}
              onClick={() => {
                if (openIndex() === index()) close();
                else open(index());
              }}
            >
              {title.label}
            </button>
            <Show when={openIndex() === index()}>
              <div class="menu-drop" role="menu" ref={placeMenu}>
                {renderList(title.children, [], openPath())}
              </div>
            </Show>
          </div>
        )}
      </For>
    </nav>
  );
}
