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
 * submenus: there is no bar to move along. Where a submenu has no room beside its parent (700px
 * and under, or a short window) it opens in place, as an indented group under its row in a menu that scrolls: the
 * row that opened it stays in view above it, so nothing has to be added to get back, and the
 * roles and the keys are the ones of the menus that open beside.
 *
 * The bar is this file: the titles, the walk between them, which menu is open and where the focus
 * goes when it closes. A menu itself (its rows, its submenus, its keys, its placement) is `Menu`
 * and the menu key is `MenuKey` (`./Menu.tsx`), which the tool strip's overflow key uses too.
 */

import { createMemo, createSignal, Index, onCleanup, Show, type JSX } from "solid-js";
import type { CommandInfo } from "../facade";
import { buildMenu, UI_ITEMS } from "../commands";
import { isTypeaheadKey, rovingIndex, typeaheadIndex, type TypedKey } from "../roving";
import { hovers, keyed, Menu, MenuKey, type MenuDismiss, type MenuHandle } from "./Menu";
import "../chrome.css";

/** `openIndex` when the open menu is the compact one, opened by the menu key, not by a title. */
const COMPACT = -1;

/**
 * The width under which the bar gives way to the menu key (the title bar folds the bar away
 * there), and the window in which the compact menu's submenus open in place. chrome.css shows and
 * hides the bar and the key at the first; the second is decided here alone (`is-stacked`). A
 * submenu opens in place wherever the longest menus (Draw and Modify, two columns wide) have no
 * room beside the titles: a window 700px wide or less, or one so short that they would need a
 * third column.
 */
export const COMPACT_QUERY = "(max-width: 900px)";
export const STACKED_QUERY = "(max-width: 700px), (max-width: 900px) and (max-height: 520px)";

/** What a key pressed on a title of the bar asks for. */
export type TitleKeyAction = { kind: "close" } | { kind: "open"; last: boolean } | { kind: "move"; to: number };

/**
 * The bar's own keys, on the title at `index` of `labels`: Escape closes the open menu, Down opens
 * the title's menu on its first row and Up on its last, Left, Right, Home, End and a letter move
 * along the titles. Null for a key the bar leaves alone.
 */
export function titleKeyAction(event: TypedKey & { key: string }, index: number, labels: readonly string[], open: boolean): TitleKeyAction | null {
  if (event.key === "Escape") return open ? { kind: "close" } : null;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") return { kind: "open", last: event.key === "ArrowUp" };
  const next = isTypeaheadKey(event) ? typeaheadIndex(labels, index, event.key) : rovingIndex(event.key, index, labels.length, "horizontal");
  return next === null ? null : { kind: "move", to: next };
}

export interface MenuBarProps {
  commands: CommandInfo[];
  onInvoke: (id: string) => void;
}

export function MenuBar(props: MenuBarProps): JSX.Element {
  let root: HTMLDivElement | undefined;
  let keyHost: HTMLDivElement | undefined;
  /** The open title's menu (the menu key holds its own). */
  let menu: MenuHandle | undefined;
  const titles: (HTMLButtonElement | undefined)[] = [];
  /** The open title's index, `COMPACT` for the menu key's menu, `null` when nothing is open. */
  const [openIndex, setOpenIndex] = createSignal<number | null>(null);
  /** The title that is the bar's one Tab stop: the one last focused or opened. */
  const [tabStop, setTabStop] = createSignal(0);

  const tree = createMemo(() => buildMenu(props.commands, UI_ITEMS));
  /** Whether the last focus event the menus saw left the focus inside them. */
  let focusInside = false;

  const compactMedia = window.matchMedia(COMPACT_QUERY);
  const stackedMedia = window.matchMedia(STACKED_QUERY);
  /** Whether the compact menu's submenus open in place (no room beside their parent). */
  const [stacked, setStacked] = createSignal(stackedMedia.matches);

  /** The menu key itself: the system's icon button inside its host. */
  const menuKey = (): HTMLElement | null => keyHost?.querySelector<HTMLElement>(":scope > button") ?? null;

  const close = (): void => {
    setOpenIndex(null);
    // A row that had the focus is gone with its menu, and no event said so.
    focusInside = root?.contains(document.activeElement) === true;
  };
  const open = (index: number): void => {
    // A title asked again while its menu is open starts from the menu's own rows.
    if (openIndex() === index) menu?.collapse();
    setOpenIndex(index);
    setTabStop(index);
  };
  /** Opens a title's menu from the keyboard and moves into it; onto the title when it has no row. */
  const openInto = (index: number, last = false): void => {
    open(index);
    if (menu?.enter(last) !== true) titles[index]?.focus();
  };
  /** A title's menu asks to be closed: but for a press outside, the focus returns to the title. */
  const dismiss = (index: number, reason: MenuDismiss): void => {
    if (reason !== "outside") titles[index]?.focus();
    close();
  };
  const invoke = (index: number, id: string, byKey: boolean): void => {
    // From the keyboard the focus is on the row that is about to go: it returns to the title.
    if (byKey) titles[index]?.focus();
    close();
    props.onInvoke(id);
  };

  // A window resized across either width swaps the bar for the key, or the submenus' placement:
  // a menu open at that moment was placed for the other arrangement, so it closes.
  // The focus, if it was in the menu or on the control that has just been folded away, goes to
  // the control that now stands for the menus: the menu key, or the bar's Tab stop. The browser
  // takes the focus from a control that stops being drawn before this runs, so what is asked is
  // where the focus last was (`focusInside`) and that nothing else has taken it since.
  const closeForResize = (): void => {
    const active = document.activeElement;
    const held = root?.contains(active) === true || (focusInside && (active === null || active === document.body));
    close();
    if (held) queueMicrotask(() => (compactMedia.matches ? menuKey() : titles[tabStop()])?.focus());
  };
  const onCompactChange = (): void => closeForResize();
  const onStackedChange = (): void => {
    closeForResize();
    setStacked(stackedMedia.matches);
  };
  compactMedia.addEventListener("change", onCompactChange);
  stackedMedia.addEventListener("change", onStackedChange);
  onCleanup(() => {
    compactMedia.removeEventListener("change", onCompactChange);
    stackedMedia.removeEventListener("change", onStackedChange);
  });

  const onTitleKey = (event: KeyboardEvent, index: number): void => {
    const action = titleKeyAction(
      event,
      index,
      tree().map((title) => title.label),
      openIndex() !== null,
    );
    if (action === null) return;
    event.preventDefault();
    if (action.kind === "close") close();
    else if (action.kind === "open") openInto(index, action.last);
    else {
      // A menu that is open follows the focus along the bar, as it follows the pointer.
      if (openIndex() !== null) open(action.to);
      titles[action.to]?.focus();
    }
  };

  // The titles are kept by their place, not by their node: the tree is built anew whenever the
  // command list is refreshed (after every command, and when a command changes what is
  // available), and a title made anew then would drop the focus it holds onto the page.
  return (
    <div
      class="menus"
      ref={root}
      onFocusIn={() => {
        focusInside = true;
      }}
      onFocusOut={(event) => {
        // The focus taken from a control because it is no longer drawn (the bar folded away by a
        // resize) has gone nowhere: it still counts as the menus' until they are asked.
        focusInside = event.relatedTarget === null && event.target instanceof HTMLElement && event.target.getClientRects().length === 0;
        // The focus going to something outside the menus (Tab, a click on another control) closes
        // the menu; the focus merely dropped (a row taken away, the window left) does not.
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <nav class="menubar" role="menubar" aria-label="Main menu">
        <Index each={tree()}>
          {(title, index) => (
            <div class="menubar-item" role="none">
              <button
                class={openIndex() === index ? "menubar-title is-open" : "menubar-title"}
                type="button"
                role="menuitem"
                tabIndex={tabStop() === index ? 0 : -1}
                aria-haspopup="menu"
                aria-expanded={openIndex() === index}
                ref={(element) => {
                  titles[index] = element;
                }}
                onFocus={() => setTabStop(index)}
                onKeyDown={(event) => onTitleKey(event, index)}
                onPointerEnter={(event) => {
                  // While a menu is open, pointing at another title opens that one (switch_on_hover).
                  if (hovers(event) && openIndex() !== null && openIndex() !== index) open(index);
                }}
                onClick={(event) => {
                  // Enter or Space: open it and move into it. A pointer's click opens or closes it.
                  if (keyed(event)) openInto(index);
                  else if (openIndex() === index) close();
                  else open(index);
                }}
              >
                {title().label}
              </button>
              <Show when={openIndex() === index}>
                <Menu
                  label={title().label}
                  items={title().children}
                  within={() => root}
                  handle={(handle) => {
                    menu = handle;
                  }}
                  onInvoke={(id, byKey) => invoke(index, id, byKey)}
                  onDismiss={(reason) => dismiss(index, reason)}
                  onStep={(delta) => openInto((index + delta + tree().length) % tree().length)}
                />
              </Show>
            </div>
          )}
        </Index>
      </nav>
      <MenuKey
        class="menu-compact"
        icon="list"
        title="Main menu"
        items={tree()}
        open={openIndex() === COMPACT}
        onOpen={() => setOpenIndex(COMPACT)}
        onClose={close}
        stacked={stacked()}
        onInvoke={(id) => props.onInvoke(id)}
        ref={(element) => {
          keyHost = element;
        }}
      />
    </div>
  );
}
