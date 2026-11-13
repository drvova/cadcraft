/**
 * The Layer Properties Manager with its body drawn by Slab (`slab/layer-manager.slab`): the same
 * props as `../components/LayerManager`, the same state, engine calls and keys
 * (`../layer-manager-edit`), the same frame (`../ui/Dialog`). Only what stands in the body is
 * Slab's (`./modal` says how a surface is made part of the frame).
 *
 * - **The grid** is one focusable node of the document, as the SolidJS grid is one Tab stop. The
 *   active cell is the shared state's; the rows draw its ring, and a screen reader is told it
 *   through `active-descendant`.
 * - **The rows** handed to the kernel are the ones near the viewport (`rowWindow`, the SolidJS
 *   grid's own `windowOf`), between two spacers that stand for the rest; the host follows the
 *   grid's scroll offset after each frame. A `virtual` list was tried first and measured: the web
 *   element has no write of one item (`setList` sends the list whole), so each key that moved the
 *   selection re-sent 2,000 rows (250 ms). All rows are one height, so a refusal is said at the
 *   foot of the grid's frame and the refused row's name takes the error ink, where the SolidJS
 *   grid opens a second line under the row.
 * - **A press** anywhere on the grid is one signal; its `hit_key` names the cell.
 * - **The filter** is the interface's own `Field`, in a hole, as the Objects search is: the
 *   kernel's field has no placeholder, no word selection and no search role.
 * - **The grid for a screen reader**: the driver gives the nodes roles and names, but no row or
 *   column index, no row count and no sort; those are added to its accessibility layer after each
 *   frame, and the rows' nodes are put back in reading order (the driver appends a new row's node
 *   at the end), for the rows laid out only.
 *
 * Mounted by the shell in the place of the SolidJS dialog, after `loadSlab("layer-manager")` has
 * defined the element.
 */

import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { LayerManagerProps } from "../components/LayerManager";
import { ToolIcon } from "../icons";
import { COLUMNS, createLayerManagerEdit, type FlagKey } from "../layer-manager-edit";
import { shownName } from "../layer-manager";
import type { GridCell, Sort } from "../layer-manager";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { isSlabFieldHost, type SlabFieldHost } from "./fields";
import {
  cellKey,
  cellOfKey,
  choiceOf,
  choicePatch,
  choicePopup,
  countLine,
  editCell,
  editPlace,
  editStyle,
  emptyText,
  FRAME_KEY,
  LM_HEAD_H,
  type EditPlace,
  findWidth,
  ACTIONS_KEY,
  GRID_KEY,
  gridPress,
  gridKeepsKey,
  gridWidth,
  headParams,
  isBarKey,
  keyParams,
  LM_LISTS,
  LM_SCALARS,
  LM_SIGNALS,
  pageRows,
  refusalLine,
  spokenRefusal,
  revealOffset,
  rowWindow,
  rowParams,
  viewHeight,
} from "./layer-manager-params";
import { computedColor, NO_INKS, type LayerInks } from "./layers-params";
import { applyParams, attachModalSurface } from "./modal";
import { isReopen, sceneBoxInWindow, SlabPopup, type OpenPopup, type PopupDismiss } from "./popup";
import { isSlabHost, signalDetail } from "./types";
import "../dialogs.css";
import "./slab-dialogs.css";
import "./slab-layers.css";
import "./slab-layer-manager.css";

/** The driver's calls this body makes beyond a field host's. */
interface GridHost extends SlabFieldHost {
  reveal(key: string, margin: number): boolean;
  getScroll(key: string, axis: number): number;
  setScroll(key: string, axis: number, off: number): boolean;
}

const isGridHost = (host: SlabFieldHost): host is GridHost => ["reveal", "getScroll", "setScroll"].every((name) => name in host && typeof Reflect.get(host, name) === "function");

/** How many solves the grid is waited for when the dialog opens (`./modal` waits as many). */
const FOCUS_TRIES = 12;

/** The gap between the keys and the filter on one line (`space.g12`). */
const BAR_GAP = 12;


export function SlabLayerManager(props: LayerManagerProps): JSX.Element {
  let element: HTMLElement | undefined;
  let mounted: GridHost | undefined;
  let inkOff: HTMLSpanElement | undefined;
  let inkFrozen: HTMLSpanElement | undefined;
  let inkLocked: HTMLSpanElement | undefined;
  /** The keyboard's ring is drawn: the last thing that moved the active cell was a key. */
  const [ring, setRing] = createSignal(false);
  /** The grid has the keyboard: the page's focus is in the surface and the kernel's on the grid. */
  const [holding, setHolding] = createSignal(false);
  const [frameWidth, setFrameWidth] = createSignal(0);
  /** The bar's keys' width, read from the solved scene: the filter's line is what they leave. */
  const [actionsWidth, setActionsWidth] = createSignal(0);
  const [frameHeight, setFrameHeight] = createSignal(viewHeight(typeof window === "undefined" ? 880 : window.innerHeight));
  /** The grid's scroll offset and its window's height, read after each frame (the window of rows follows them). */
  const [scrollTop, setScrollTop] = createSignal(0);
  const [gridHeight, setGridHeight] = createSignal(0);
  const gridView = (): number => (gridHeight() > 0 ? gridHeight() : frameHeight());
  const [inks, setInks] = createSignal<LayerInks>(NO_INKS);
  const [popup, setPopup] = createSignal<OpenPopup | null>(null);
  /** Where the field of the cell being typed in stands; null until the scene has the cell. */
  const [place, setPlace] = createSignal<EditPlace | null>(null);
  /** The choice the open popup changes. */
  let choosing: { name: string; column: number } | null = null;
  /** When a press outside the popup closed it: that press, on its cell, is not a new opening. */
  let closedAt: number | null = null;

  /** Put the page's focus and the kernel's on the grid. */
  const takeGrid = (visible: boolean): void => {
    const host = mounted;
    if (host === undefined) return;
    if (host.focusedKey() !== GRID_KEY) host.setFocus(GRID_KEY, visible);
    const node = host.shadowRoot?.querySelector<HTMLElement>(`.slab-a11y-node[data-slab-key="${GRID_KEY}"]`);
    if (node === null || node === undefined) return;
    if (!node.hasAttribute("tabindex")) node.tabIndex = -1;
    if (host.shadowRoot?.activeElement !== node) node.focus({ preventScroll: true });
  };

  /** Bring a cell into view: its row by the grid's offset (the window of rows follows at once), then the cell along the row. */
  const revealCell = (cell: GridCell): void => {
    const host = mounted;
    if (host === undefined) return;
    if (cell.row >= 0) {
      const next = revealOffset(cell.row, scrollTop(), gridView());
      if (next !== scrollTop()) {
        host.setScroll(GRID_KEY, 0, next);
        setScrollTop(next);
      }
    }
    // Along the row only when the grid is wider than its window.
    if (gridWidth(frameWidth()) > Math.floor(frameWidth()) - 2) void host.whenSettled().then(() => host.reveal(cellKey(cell), 0));
  };

  const focusActive = (): void => {
    takeGrid(true);
    revealCell(edit.active());
  };

  const openChoice = (cell: GridCell): void => {
    const host = mounted;
    const row = edit.shown()[cell.row];
    const choice = choiceOf(cell.column);
    if (host === undefined || row === undefined || choice === null) return;
    const spec = choicePopup(choice, row, edit.linetypeNames());
    choosing = { name: row.name, column: cell.column };
    const key = cellKey(cell);
    setPopup({
      ...spec,
      anchor: () => {
        const part = host.sceneSnapshot().find((node) => node.key === key);
        return part === undefined ? null : sceneBoxInWindow(host, part);
      },
    });
  };

  const edit = createLayerManagerEdit(props, { focusActive, openChoice, revealCell, pageRows: () => pageRows(gridView()) });
  const span = createMemo(() => rowWindow(scrollTop(), gridView(), edit.shown().length), undefined, { equals: (a, b) => a.first === b.first && a.last === b.last && a.above === b.above && a.below === b.below });

  const params = createMemo(() => {
    const shown = edit.shown();
    const total = edit.rows().length;
    return {
      keys: keyParams({ renamable: edit.renamable(), removable: edit.removable(), currentable: edit.currentable() }),
      count: countLine(shown.length, total),
      heads: headParams(edit.sort(), edit.active(), ring() && holding()),
      rows: rowParams(shown, { selected: edit.selection().names, active: edit.active(), ring: ring() && holding(), refusals: edit.refusals(), editing: edit.editing(), inks: inks() }, span()),
      above: span().above,
      below: span().below,
      grid_w: gridWidth(frameWidth()),
      find_w: findWidth(frameWidth(), actionsWidth(), BAR_GAP),
      view_h: frameHeight(),
      active: cellKey(edit.active()),
      grid_said: "Layers",
      empty: shown.length === 0,
      empty_said: emptyText(total, edit.filter()),
      filtered: total > 0,
      refused: edit.refusals().size > 0,
      refusal: refusalLine(edit.refusals()),
    };
  });

  const closePopup = (reason: PopupDismiss | "pick", byKey: boolean): void => {
    if (popup() === null) return;
    setPopup(null);
    closedAt = reason === "outside" ? performance.now() : null;
    if (reason === "outside" || reason === "away") return;
    if (byKey) focusActive();
    else takeGrid(false);
  };

  /** A press on the grid: a heading sorts; a flag's key turns it; a choice opens its values; anywhere else selects the row. */
  const onPress = (event: Event): void => {
    const press = gridPress(event);
    const cell = press.cell;
    if (cell === null) return;
    edit.setActive(cell);
    const column = COLUMNS[cell.column];
    if (column === undefined) return;
    if (cell.row < 0) {
      edit.sortBy(column.key);
      return;
    }
    const row = edit.shown()[cell.row];
    if (row === undefined) return;
    if (column.kind === "flag") {
      const flag = column.key as FlagKey;
      edit.change(row.name, { [flag]: !row[flag] });
    } else if (column.kind === "choice") {
      if (popup() !== null) closePopup("escape", false);
      else if (!isReopen(closedAt, performance.now())) openChoice(cell);
    } else {
      edit.pressRow(row.name, { toggle: press.toggle, range: press.range });
    }
  };

  /** Lay the field over the cell being typed in, as the scene has it now (after each frame). */
  const placeField = (host: GridHost): void => {
    const cell = editCell(edit.order(), edit.editing());
    if (cell === null) {
      if (place() !== null) setPlace(null);
      return;
    }
    const scene = host.sceneSnapshot();
    const key = cellKey(cell);
    const box = scene.find((node) => node.key === key);
    const frame = scene.find((node) => node.key === FRAME_KEY);
    // A row out of the list's window keeps its field where it was, cut away whole.
    const next = box === undefined || frame === undefined ? null : editPlace(box, frame, LM_HEAD_H);
    const held = place();
    if (next === null) {
      if (held !== null && held.clip[0] < held.height) setPlace({ ...held, clip: [held.height, 0, 0, 0] });
      return;
    }
    if (held === null || JSON.stringify(held) !== JSON.stringify(next)) setPlace(next);
  };

  // Opened, the keyboard goes to the active cell once the scene has the grid. Closed, an open popup goes with it.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) {
          setPopup(null);
          return;
        }
        setFrameHeight(viewHeight(window.innerHeight));
        const host = mounted;
        if (host === undefined) return;
        // The first solves may still be of the closed dialog (no size: the kernel will not focus
        // there), and the kernel keeps the focus it had at the last closing: tried until the grid has it.
        const arrive = (tries: number): void => {
          void host.whenSettled().then(() => {
            if (!props.open) return;
            focusActive();
            if (tries > 0 && (host.focusedKey() !== GRID_KEY || host.shadowRoot?.activeElement == null)) arrive(tries - 1);
          });
        };
        arrive(FOCUS_TRIES);
      },
      { defer: true },
    ),
  );

  onMount(() => {
    if (element === undefined || !isSlabHost(element) || !isSlabFieldHost(element) || !isGridHost(element)) return;
    const host = element;
    mounted = host;

    const sizes = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      const width = host.getBoundingClientRect().width;
      if (width > 0) setFrameWidth(width);
    });
    sizes?.observe(host);
    const onWindow = (): void => {
      setFrameHeight(viewHeight(window.innerHeight));
    };
    window.addEventListener("resize", onWindow);

    /** Whether the grid has the keyboard now (read after a focus change and after each frame). */
    const hold = (): void => {
      setHolding(host.focusedKey() === GRID_KEY && host.shadowRoot?.activeElement != null);
    };

    // The grid's keys, before the kernel and before `./modal` (which keeps Tab and Escape): the
    // SolidJS grid's own (`gridKey`), so the arrows move the active cell and never walk the
    // kernel's ring, Enter and Space never press the grid, and a page key never scrolls it.
    const onKey = (event: KeyboardEvent): void => {
      if (event.target !== host || event.isComposing) return;
      if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Escape on the surface closes the dialog, as it does from the SolidJS grid. It is closed
        // here, not left to the frame's `cancel`: `./modal` keeps the key from the kernel and so
        // from the dialog's own keydown too, which then still holds the last Escape a field used
        // (the filter's) and takes this one for used as well.
        event.preventDefault();
        event.stopImmediatePropagation();
        props.onClose();
        return;
      }
      if (host.focusedKey() !== GRID_KEY || event.key === "Tab") return;
      let used = false;
      edit.gridKey({
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        repeat: event.repeat,
        preventDefault: () => {
          used = true;
          event.preventDefault();
        },
      });
      if (!used && !gridKeepsKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    host.addEventListener("keydown", onKey, true);

    // The ring follows the keyboard, as `:focus-visible` does: a key shows it, a press hides it,
    // anywhere in the page (the dialog opened by a typed command shows it on its first cell).
    const page = host.ownerDocument;
    const onAnyKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) setRing(true);
    };
    const onAnyPress = (): void => {
      setRing(false);
    };
    page.addEventListener("keydown", onAnyKey, true);
    page.addEventListener("pointerdown", onAnyPress, true);

    // The keyboard came to the grid (Tab, a press): the active cell comes into view, as a focused
    // SolidJS cell is scrolled to.
    const onFocusIn = (): void => {
      const was = holding();
      hold();
      if (!was && holding()) revealCell(edit.active());
    };
    host.addEventListener("focusin", onFocusIn);
    host.addEventListener("focusout", hold);

    const modal = attachModalSurface(host, {
      signals: LM_SIGNALS,
      values: () => new Map(),
      fields: false,
      on: (name, event) => {
        const item = signalDetail(event)?.item ?? "";
        switch (name) {
          case "bar_press":
            // A key that cannot act now does nothing, as a SolidJS key marked `aria-disabled`.
            if (!isBarKey(item) || keyParams({ renamable: edit.renamable(), removable: edit.removable(), currentable: edit.currentable() }).find((key) => key.key === item)?.off !== false) return;
            if (item === "new") edit.addLayer();
            else if (item === "rename") edit.renameSelected();
            else if (item === "delete") edit.removeSelected();
            else edit.makeSelectedCurrent();
            return;
          case "grid_press":
            onPress(event);
            return;
          case "grid_double": {
            // The kernel drops the second press of a double one: a heading or a flag's key takes
            // it again, as the SolidJS grid's buttons take both clicks.
            const cell = gridPress(event).cell;
            const kind = cell === null ? undefined : COLUMNS[cell.column]?.kind;
            if (cell !== null && (cell.row < 0 || kind === "flag")) {
              onPress(event);
              return;
            }
            const row = cell === null ? undefined : edit.shown()[cell.row];
            if (cell !== null && row !== undefined) edit.doublePress(row.name, cell.column);
            return;
          }
          case "clear_filter":
            edit.clearFilter();
            takeGrid(false);
            return;
          default:
            return;
        }
      },
    });

    const root = document.documentElement;
    const readInks = (): void => {
      const ink = (el: HTMLElement | undefined): string | null => (el === undefined ? null : computedColor(getComputedStyle(el).color));
      const [off, frozen, locked] = [ink(inkOff), ink(inkFrozen), ink(inkLocked)];
      if (off !== null && frozen !== null && locked !== null) setInks({ off, frozen, locked });
    };
    readInks();
    const themes = new MutationObserver(readInks);
    themes.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

    const onFrame = (): void => {
      if (inks() === NO_INKS) readInks();
      hold();
      const top = host.getScroll(GRID_KEY, 0);
      if (Number.isFinite(top) && top !== scrollTop()) setScrollTop(top);
      const tall = host.sceneSnapshot().find((node) => node.key === GRID_KEY)?.h ?? 0;
      if (tall > 0 && tall !== gridHeight()) setGridHeight(tall);
      const actions = host.sceneSnapshot().find((node) => node.key === ACTIONS_KEY)?.w ?? 0;
      if (actions > 0 && Math.abs(actions - actionsWidth()) > 0.5) setActionsWidth(actions);
      tidyGrid(host, edit.shown().length, edit.sort());
      placeField(host);
    };
    host.addEventListener("slab-frame", onFrame);

    onCleanup(() => {
      mounted = undefined;
      modal.dispose();
      sizes?.disconnect();
      themes.disconnect();
      window.removeEventListener("resize", onWindow);
      host.removeEventListener("slab-frame", onFrame);
      host.removeEventListener("keydown", onKey, true);
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("focusout", hold);
      page.removeEventListener("keydown", onAnyKey, true);
      page.removeEventListener("pointerdown", onAnyPress, true);
    });

    const sent = new Map<string, string>();
    createEffect(() => applyParams(host, params(), LM_SCALARS, LM_LISTS, sent));
  });

  return (
    <Dialog
      open={props.open}
      title="Layer Properties Manager"
      size="lg"
      initialFocus={() => null}
      onClose={() => props.onClose()}
      footer={(done) => <Button onClick={done}>Close</Button>}
    >
      <div class="slab-lm">
        <cadcraft-layer-manager ref={element} class="slab-dialog-body">
          <div slot="filter" class="slab-dialog-hole">
            <Field
              inputMode="search"
              ariaLabel="Filter layers by name"
              placeholder="Filter by name"
              title="Text matches anywhere in a name. * stands for any characters, ? for one."
              value={edit.filter()}
              spellcheck={false}
              autocomplete="off"
              autocapitalize="off"
              maxLength={256}
              start={<ToolIcon id="search" />}
              onInput={edit.setFilterText}
              onKeyDown={(event) => {
                // Escape empties a filter before it closes the dialog.
                if (event.key === "Escape" && edit.clearFilterKey()) event.preventDefault();
              }}
            />
          </div>
        </cadcraft-layer-manager>
        <Show when={edit.editing() !== null && place()}>
          {(at) => {
            const held = edit.editing();
            const what = held?.key ?? "name";
            const name = shownName(held?.name ?? "");
            return (
              <div class="slab-lm-edit" style={editStyle(at())}>
                <Field
                  variant="inline"
                  size="sm"
                  ariaLabel={what === "name" ? `Name of ${name}` : `Description of ${name}`}
                  value={edit.draft()}
                  spellcheck={what === "description"}
                  autocomplete="off"
                  autocapitalize="off"
                  maxLength={what === "name" ? 255 : 1024}
                  invalid={edit.editing()?.invalid === true}
                  describedBy={edit.refusals().has(held?.name ?? "") ? "slab-lm-note" : undefined}
                  selectOnFocus
                  ref={(el) => queueMicrotask(() => el.focus())}
                  onInput={edit.input}
                  onKeyDown={edit.onEditKey}
                  onBlur={() => edit.commitEdit(false)}
                />
              </div>
            );
          }}
        </Show>
        <span id="slab-lm-note" hidden>
          {spokenRefusal(edit.refusals())}
        </span>
        <p class="lm-live" role="status">
          {edit.said()}
        </p>
        <span ref={inkOff} class="ui-toggle--absent slab-ink--off" hidden />
        <span ref={inkFrozen} class="ui-toggle--info slab-ink--on" hidden />
        <span ref={inkLocked} class="ui-toggle--caution slab-ink--on" hidden />
      </div>
      <SlabPopup
        popup={popup}
        mount={() => element?.closest("dialog") ?? undefined}
        onPick={(value, byKey) => {
          const held = choosing;
          closePopup("pick", byKey);
          const choice = held === null ? null : choiceOf(held.column);
          const patch = held === null || choice === null ? null : choicePatch(choice, value);
          if (held !== null && patch !== null) edit.change(held.name, patch);
        }}
        onClose={(reason) => closePopup(reason, reason === "escape" || reason === "tab")}
      />
    </Dialog>
  );
}

/** The most nodes of the accessibility layer touched in one frame (the list's window is a few dozen rows). */
const MAX_TIDY = 2048;

const setAttr = (el: Element, name: string, value: string): void => {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
};

/**
 * The grid as a screen reader meets it, after each frame: its size and that several rows can be
 * selected, each row's and cell's place, each heading's order, and the rows in reading order.
 */
function tidyGrid(host: HTMLElement, rows: number, sort: Sort): void {
  const root = host.shadowRoot;
  const grid = root?.querySelector<HTMLElement>(`.slab-a11y-node[data-slab-key="${GRID_KEY}"]`) ?? null;
  if (root === null || grid === null) return;
  setAttr(grid, "aria-rowcount", String(rows + 1));
  setAttr(grid, "aria-colcount", String(COLUMNS.length));
  setAttr(grid, "aria-multiselectable", "true");
  const nodes = grid.querySelectorAll<HTMLElement>("[role='row'], [role='gridcell'], [role='columnheader']");
  const lines: HTMLElement[] = [];
  let touched = 0;
  for (const node of nodes) {
    if (++touched > MAX_TIDY) break;
    const key = node.dataset["slabKey"] ?? "";
    const role = node.getAttribute("role");
    if (role === "row") {
      const cell = cellOfKey(`${key}/#c0`);
      if (cell !== null) {
        setAttr(node, "aria-rowindex", String(cell.row + 2));
        // The driver gives a list item its place in the list handed over (the window): a grid row
        // has no such attributes, and its place is the row index.
        if (node.hasAttribute("aria-posinset")) node.removeAttribute("aria-posinset");
        if (node.hasAttribute("aria-setsize")) node.removeAttribute("aria-setsize");
        lines.push(node);
      } else {
        setAttr(node, "aria-rowindex", "1");
      }
      continue;
    }
    const cell = cellOfKey(key);
    if (cell === null) continue;
    setAttr(node, "aria-colindex", String(cell.column + 1));
    if (role === "columnheader") {
      const column = COLUMNS[cell.column];
      setAttr(node, "aria-sort", column === undefined || sort === null || sort.key !== column.key ? "none" : sort.descending ? "descending" : "ascending");
    }
  }
  // The heading first: the driver orders the layer as it paints, and a sticky row is painted last.
  const top = root.querySelector<HTMLElement>(`.slab-a11y-node[data-slab-key="${GRID_KEY}/#top"]`);
  if (top !== null && top.parentElement === grid && grid.firstElementChild !== top) grid.insertBefore(top, grid.firstElementChild);
  // The rows in reading order, by their places: the driver appends a row that comes into view.
  const parent = lines[0]?.parentElement ?? null;
  if (parent === null) return;
  const place = (node: HTMLElement): number => Number(node.getAttribute("aria-rowindex"));
  const sorted = lines.filter((line) => line.parentElement === parent).sort((a, b) => place(a) - place(b));
  const children = [...parent.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.getAttribute("role") === "row" && sorted.includes(child));
  if (children.every((child, at) => child === sorted[at])) return;
  for (const line of sorted) parent.append(line);
}
