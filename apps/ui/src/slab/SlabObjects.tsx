/**
 * The Objects section drawn by Slab (`slab/objects.slab`): the same props as
 * `../components/ObjectsPanel`, the same tree, the same selection both ways. Only the view is
 * Slab's. What is open, what is searched and how far a long group is shown are held here as they
 * are in the SolidJS panel, and every decision is `../objects`': the tree and its caps (`layout`),
 * the keyboard (`treeKey`), what a press selects (`pressSelection`), where a selection made on
 * the drawing shows (`revealTarget`).
 *
 * What the kernel does: lays out the rows in view (the list is `virtual`), paints, scrolls, and
 * reports a press (`row_pressed`, with the row's key and where the pointer was) and the fold key
 * (`fold`).
 *
 * **The search is the interface's own `Field`, in a hole** (`ObjectsSearch`, the one the SolidJS
 * panel shows). The kernel's text field was built and measured first, and it is not good enough
 * for a field people type in all day: a double click does not select a word; an input method's
 * text being composed is drawn over the example text, because the host hears nothing until it is
 * committed; there is no context menu (so no Paste by the pointer) and no clear key; it is a
 * `textbox` to a screen reader where this is a `searchbox`; it is not a Tab stop of its own; and
 * the shell's keys (a typed letter starts a command, Ctrl+Z undoes the drawing) had to be held
 * back by hand while it was edited. What did work: typing, the caret, a drag and Shift
 * selection, its own undo, the clipboard, an input method's committed text, a length cap.
 *
 * What this file does, because the driver at the pinned commit does not:
 * - **The tree's keys.** The kernel walks every focusable with any arrow and wraps. The keys of a
 *   tree (`treeKey`: Right and Left open and close, Home and End, a typed letter, Ctrl+Enter)
 *   are taken before the kernel sees them, and the kernel is told which row to focus.
 * - **The section's height.** A surface is as tall as its element. The natural height (heading,
 *   search, every row, the lines under) is worked out from the solved scene and set on the
 *   element; the rail's sheet caps it and the tree scrolls in what is left.
 * - **The keyboard's place.** A row that leaves the list's window takes its node of the driver's
 *   accessibility layer with it, and the page's focus with that: the browser puts the focus on
 *   the body and the driver does not take it back. After the host moves the keyboard to a row,
 *   the focus is put on that row's node once it is there.
 * - **Between the field and the tree.** Down in the search field puts the page's focus on the
 *   surface and tells the kernel the first row; Up on the first row focuses the field; and when
 *   the field takes the keyboard the kernel's focus is cleared, so no row keeps a ring. Tab goes
 *   fold key, field, tree, on, as in the SolidJS panel (the browser's own order would be surface,
 *   field); backwards from what follows the section it stops at the field and the fold key.
 * - **The ring after a press.** The driver moves the page's focus to the pressed node and tells
 *   the kernel it was focused from the keyboard, so a pressed row wears the keyboard's ring.
 *   After a pointer press the kernel's focus is said again, as the pointer's.
 * - **The tree for a screen reader.** The driver appends a new row's node to the end of its
 *   accessibility layer, so after a group opens its rows come after every row that was already
 *   there; and a tree has no way to say that several rows can be selected. Each frame the rows'
 *   nodes are put back in reading order (the node the keyboard is on is never moved: moving it
 *   would drop the focus) and the tree is marked `aria-multiselectable`.
 *
 * Mounted by the Slab shell in the rail, after `loadSlab("objects")` has defined the element.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack, type JSX } from "solid-js";
import type { ObjectsPanelProps } from "../components/ObjectsPanel";
import { ObjectsSearch } from "../components/ObjectsSearch";
import {
  buildTree,
  layout,
  moreId,
  panelListed,
  panelNotes,
  panelSummary,
  PIECE_ID,
  pressSelection,
  revealTarget,
  ROOMY_WINDOW,
  searchTokens,
  showMore,
  treeKey,
  withGroupOpen,
  withReveal,
  type VisibleNode,
} from "../objects";
import { isTypeaheadKey } from "../roving";
import { DEFAULT_STEP, itemOfKey, naturalHeight, objectRowParams, objectsPanelParams, onTwist, pressMeta, queryText, readingOrder, rowOfKey, type ObjectsPanelParams } from "./objects-params";
import { attachSurface } from "./surface";
import { isSlabHost, signalDetail, type SlabHost } from "./types";
import "./slab-objects.css";

/** The driver's methods this panel calls beyond the ones every surface does (`./types`). */
interface ObjectsHost extends SlabHost {
  focusedKey(): string | null;
  setFocus(key: string, visible?: boolean): boolean;
  focusItem(each: string, index: number): boolean;
  revealItem(each: string, index: number, align: number): boolean;
  setScroll(key: string, axis: number, off: number): boolean;
}

const OBJECTS_METHODS = ["focusedKey", "setFocus", "focusItem", "revealItem", "setScroll"] as const;

function isObjectsHost(element: Element): element is ObjectsHost {
  return isSlabHost(element) && OBJECTS_METHODS.every((name) => name in element && typeof Reflect.get(element, name) === "function");
}

/** The document's keys: the scrolling tree, its list, and the parts whose heights make the section's. */
const TREE = "#panel/#body/#tree";
const EACH = `${TREE}/rows`;
const EDGE = "#panel/#edge";
const HEAD = "#panel/#head";
const SEARCH = "#panel/#body/#search";
const NOTES = "#panel/#notes";

/** How many frames after a move of the keyboard the page's focus is watched (the list's window settles in two). */
const HOLD_FRAMES = 6;

/** How many frames after a pointer press the kernel's focus is said again as the pointer's (the driver says "keyboard" one frame after the press). */
const UNRING_FRAMES = 3;

/** `revealItem`'s alignment: move the least that brings the row into view. */
const NEAREST = 3;

/** The keys a tree owns whether or not they move anything: the kernel's own walk never sees them. */
const TREE_KEYS: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "]);

const SCALARS = ["summary", "open", "listed", "filled"] as const;
const LISTS = ["rows", "notes"] as const;

function apply(host: SlabHost, params: ObjectsPanelParams): void {
  for (const name of SCALARS) host.setParam(name, params[name]);
  for (const name of LISTS) host.setList(name, "", params[name]);
}

/** Run once the surface has been laid out again (the next frame; at once where there are no frames). */
function later(run: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else queueMicrotask(run);
}

export function SlabObjects(props: ObjectsPanelProps): JSX.Element {
  const [open, setOpen] = createSignal(typeof window === "undefined" || window.innerHeight >= ROOMY_WINDOW);
  const [query, setQuery] = createSignal("");
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set([PIECE_ID]));
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set());
  const [shown, setShown] = createSignal<ReadonlyMap<string, number>>(new Map());
  const [step, setStep] = createSignal(DEFAULT_STEP);

  const tree = createMemo(() => buildTree(props.list));
  const drawn = createMemo(() => layout(tree(), { query: query(), expanded: expanded(), collapsed: collapsed(), shown: shown() }));
  const selected = createMemo(() => new Set(props.selection));
  const searching = (): boolean => searchTokens(query()).length > 0;
  const listed = (): boolean => panelListed(props.list, props.available);
  const keyed = createMemo(() => objectRowParams(drawn().rows, selected(), step()));
  const params = createMemo(() =>
    objectsPanelParams({
      summary: panelSummary(props.list, props.available, query(), drawn().matches),
      open: open(),
      listed: listed(),
      notes: panelNotes(props.list, props.available, drawn(), query()),
      rows: keyed().params,
    }),
  );
  let element: HTMLElement | undefined;
  let searchEl: HTMLInputElement | undefined;
  /** The mounted surface; undefined until the element is one (and after it is gone). */
  let surface: ObjectsHost | undefined;
  /** Put the keyboard on the row at this place of the list, from wherever in the page it is. */
  let takeRow: (index: number) => void = () => undefined;

  const onQuery = (text: string): void => {
    const next = queryText(text);
    if (next !== text && searchEl !== undefined) searchEl.value = next;
    if (next === query()) return;
    setQuery(next);
    setCollapsed(new Set<string>());
    surface?.setScroll(TREE, 0, 0);
  };

  /** The search field's own keys: Escape empties it, Down and Tab go to the first row. */
  const onSearchKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && query() !== "") {
      event.preventDefault();
      event.stopPropagation();
      onQuery("");
      if (searchEl !== undefined) searchEl.value = "";
    } else if ((event.key === "ArrowDown" && !event.altKey) || (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey)) {
      // Down, and Tab: the tree is the next stop after the field, as in the SolidJS panel. (In
      // the page's own order the surface's one stop comes before the field.)
      if (surface === undefined || drawn().rows.length === 0) return;
      event.preventDefault();
      takeRow(0);
    }
  };

  onMount(() => {
    if (element === undefined || !isObjectsHost(element)) return;
    const host = element;
    surface = host;

    const setOpenGroup = (id: string, to: boolean): void => {
      const next = withGroupOpen({ expanded: expanded(), collapsed: collapsed() }, searching(), id, to);
      setExpanded(next.expanded);
      setCollapsed(next.collapsed);
    };

    /** A selection this panel asked for is not brought into view again: the row is under the hand. */
    let ownPress = false;
    const select = (node: VisibleNode, additive: boolean): void => {
      if (node.handles.length === 0) return;
      ownPress = true;
      props.onSelect(pressSelection(node.handles, props.selection, additive));
    };

    /** The row the kernel's focus is on; null when the keyboard is elsewhere in the surface, or out of it. */
    const focusedRow = (): string | null => {
      const key = host.focusedKey();
      return key === null ? null : itemOfKey(key, EACH);
    };

    /** Frames left in which the ring a pointer press left is taken off (see `dropRing`). */
    let unringing = 0;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target === host && event.button === 0) unringing = UNRING_FRAMES;
    };
    const dropRing = (): void => {
      if (unringing <= 0) return;
      unringing--;
      const key = host.focusedKey();
      if (key !== null) host.setFocus(key, false);
    };
    host.addEventListener("pointerdown", onPointerDown, true);

    /** Frames left in which the page's focus is put back on the kernel's focused node (see `holdKeyboard`). */
    let holding = 0;
    /**
     * The keyboard was in the surface and the host has just moved the kernel's focus: for the next
     * few frames, if the page's focus fell to the body (the node it was on left the list's
     * window), it is put on the node the kernel focused. Never taken from another control.
     */
    const holdKeyboard = (): void => {
      holding = HOLD_FRAMES;
    };
    const keepKeyboard = (): void => {
      if (holding <= 0) return;
      holding--;
      const root = host.shadowRoot;
      if (root === null || root.activeElement !== null || (document.activeElement !== document.body && document.activeElement !== null)) {
        holding = 0;
        return;
      }
      const stop = root.querySelector<HTMLElement>('.slab-a11y-node[tabindex="0"]');
      // Not there yet, or still the node the kernel left: the next frame has it.
      if (stop === null || stop.dataset["slabKey"] !== host.focusedKey()) return;
      stop.focus({ preventScroll: true });
      holding = 0;
    };

    const focusAt = (index: number): void => {
      if (host.focusItem(EACH, index)) holdKeyboard();
    };

    takeRow = (index: number): void => {
      // The page's focus goes into the surface at once (on its one Tab stop), so the next key is
      // the tree's; the kernel is then told the row, and the driver moves the focus on to it.
      const stop = host.shadowRoot?.querySelector<HTMLElement>('.slab-a11y-node[tabindex="0"]') ?? null;
      if (stop === null) return;
      stop.focus({ preventScroll: true });
      if (host.focusItem(EACH, index)) holdKeyboard();
    };

    const focusRow = (id: string): void => {
      const at = drawn().rows.findIndex((row) => row.id === id);
      if (at >= 0) focusAt(at);
    };

    const revealRow = (id: string): void => {
      const at = drawn().rows.findIndex((row) => row.id === id);
      if (at >= 0) host.revealItem(EACH, at, NEAREST);
    };

    const more = (parent: string): void => {
      const rows = drawn().rows;
      const at = rows.findIndex((row) => row.id === moreId(parent));
      const before = rows[at - 1]?.id;
      const held = focusedRow() !== null;
      setShown(showMore(shown(), parent));
      // The row that showed more is gone: the keyboard goes to the first row it brought.
      const next = drawn().rows;
      const from = before === undefined ? -1 : next.findIndex((row) => row.id === before);
      const first = next[from + 1];
      if (held && first !== undefined) focusAt(from + 1);
    };

    /**
     * Tab on a row, ahead of `attachSurface` (which hands every Tab to the browser): the field
     * stands before the tree for the eye and after the surface for the browser. Shift+Tab goes to
     * the field; Tab goes past it, to what follows the section.
     */
    const onTab = (event: KeyboardEvent): void => {
      if (event.key !== "Tab" || event.target !== host || event.altKey || event.ctrlKey || event.metaKey) return;
      const field = searchEl;
      if (field === undefined || !field.isConnected || focusedRow() === null) return;
      if (event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        field.focus();
        return;
      }
      // Out of the Tab order while the browser picks the next stop, then back.
      field.tabIndex = -1;
      setTimeout(() => field.removeAttribute("tabindex"), 0);
    };
    host.addEventListener("keydown", onTab, true);

    const detach = attachSurface(host, ["fold", "row_pressed"], (name, event) => {
      if (name === "fold") {
        setOpen(!open());
        return;
      }
      const detail = signalDetail(event);
      if (detail === null) return;
      const node = rowOfKey(drawn(), keyed(), detail.item);
      if (node === null) return;
      const meta = pressMeta(event);
      if (node.kind === "more") more(node.parent ?? "");
      else if (node.kind === "group" && onTwist(meta.hitKey, EACH)) setOpenGroup(node.id, !node.open);
      else select(node, meta.additive);
    });

    const swallow = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    /** Before the kernel: the keys of the tree. (A key from the search field is the field's: its target is not the surface.) */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target !== host || event.isComposing) return;
      unringing = 0;
      const active = focusedRow();
      if (active === null) return;
      const rows = drawn().rows;
      const at = rowOfKey(drawn(), keyed(), active);
      const action = treeKey(event, rows, at?.id ?? null);
      if (action === null) {
        // Up from the first row is the search field, where Down came from.
        if (event.key === "ArrowUp" && !event.altKey && rows[0]?.id === at?.id && searchEl !== undefined) {
          swallow(event);
          holding = 0;
          searchEl.focus();
        } else if (TREE_KEYS.has(event.key) || isTypeaheadKey(event)) {
          // A key of the tree that changes nothing is still the tree's: the kernel would walk on
          // to another control, and the shell would take a letter as the start of a command.
          swallow(event);
        }
        return;
      }
      swallow(event);
      switch (action.type) {
        case "focus":
          focusRow(action.id);
          return;
        case "open":
          setOpenGroup(action.id, true);
          return;
        case "close":
          setOpenGroup(action.id, false);
          return;
        case "more":
          more(action.parent);
          return;
        case "select": {
          const node = rows.find((row) => row.id === action.id);
          if (node !== undefined) select(node, action.additive);
          return;
        }
      }
    };
    // Capture, on the element itself: ahead of the driver's own listener.
    host.addEventListener("keydown", onKeyDown, true);

    /** The tree as a screen reader meets it: several rows can be selected, and the rows are in reading order. */
    const tidyTree = (): void => {
      const root = host.shadowRoot;
      const treeNode = root?.querySelector<HTMLElement>('.slab-a11y-node[role="tree"]') ?? null;
      if (root === null || treeNode === null) return;
      if (treeNode.getAttribute("aria-multiselectable") !== "true") treeNode.setAttribute("aria-multiselectable", "true");
      // The rows' nodes are the children of the list's own node, inside the tree's.
      const list = treeNode.querySelector('[role="treeitem"]')?.parentElement ?? null;
      if (list === null) return;
      const items = [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.getAttribute("role") === "treeitem");
      const order = readingOrder(items.map((item) => Number.parseFloat(item.style.top)));
      if (order === null) return;
      const sorted = order.flatMap((at) => items[at] ?? []);
      const held = root.activeElement;
      const pivot = sorted.findIndex((item) => item === held);
      // Around the node the keyboard is on: the rows before it go in front of it, the rest to the end.
      for (const [at, item] of sorted.entries()) {
        if (at === pivot) continue;
        if (at < pivot && held !== null) list.insertBefore(item, held);
        else list.append(item);
      }
    };

    let height = -1;
    let measured = false;
    const onFrame = (): void => {
      if (!measured) {
        // A solved frame in the page: the document's tokens can be read (before it they read 0).
        const stride = host.getToken("space.g12");
        if (typeof stride === "number" && stride > 0) {
          measured = true;
          setStep(stride);
        }
      }
      const scene = host.sceneSnapshot();
      const tall = (key: string): number => scene.find((node) => node.key === key)?.h ?? 0;
      const token = (path: string, fallback: number): number => {
        const value = host.getToken(path);
        return typeof value === "number" ? value : fallback;
      };
      const natural = naturalHeight({ head: tall(EDGE) + tall(HEAD), search: tall(SEARCH), notes: tall(NOTES), rows: untrack(() => params().rows.length), rowHeight: token("size.control-h-row", 22), pad: token("space.g2", 2) });
      if (natural !== height && natural > 0) {
        height = natural;
        host.style.height = `${natural}px`;
      }
      keepKeyboard();
      dropRing();
      tidyTree();
    };
    host.addEventListener("slab-frame", onFrame);
    /** The keyboard went to the search field: no row keeps the keyboard's ring behind it. */
    const onFocusIn = (event: FocusEvent): void => {
      if (event.target !== host) host.clearFocus();
    };
    host.addEventListener("focusin", onFocusIn);

    onCleanup(() => {
      detach();
      host.removeEventListener("keydown", onTab, true);
      host.removeEventListener("pointerdown", onPointerDown, true);
      host.removeEventListener("keydown", onKeyDown, true);
      host.removeEventListener("slab-frame", onFrame);
      host.removeEventListener("focusin", onFocusIn);
      surface = undefined;
      takeRow = () => undefined;
    });

    createEffect(() => apply(host, params()));

    // A selection made on the drawing: open the way to its first row and bring it into view,
    // without taking the keyboard. Only when the selection itself changed.
    let lastSelection = "";
    createEffect(() => {
      const key = props.selection.join(",");
      if (key === lastSelection) return;
      lastSelection = key;
      const own = ownPress;
      ownPress = false;
      if (!untrack(open)) return;
      // The palette under the tree grows with a selection and the tree gives way: the row that
      // was pressed stays in view once the rail has settled.
      const pressed = untrack(focusedRow);
      if (own && pressed !== null) later(() => revealRow(untrack(() => rowOfKey(drawn(), keyed(), pressed))?.id ?? ""));
      if (own || props.selection.length === 0) return;
      const reveal = untrack(() => revealTarget(tree(), selected()));
      if (reveal === null) return;
      if (!untrack(searching)) {
        const next = withReveal(reveal, untrack(expanded), untrack(shown));
        setExpanded(next.expanded);
        setShown(next.shown);
      }
      later(() => revealRow(reveal.id));
    });
  });

  const searchShown = (): boolean => open() && listed();
  return (
    <cadcraft-objects ref={element} class="slab-objects" classList={{ "is-listed": searchShown() }}>
      <div slot="search" class="slab-objects-search" hidden={!searchShown()}>
        <Show when={searchShown()}>
          <ObjectsSearch
            value={query()}
            ref={(el) => {
              searchEl = el;
            }}
            onInput={onQuery}
            onKeyDown={onSearchKey}
          />
        </Show>
      </div>
    </cadcraft-objects>
  );
}
