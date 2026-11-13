/**
 * The menu drawn by Slab (`slab/menu.slab`): the same props, the same handle and the same rules as
 * `../components/Menu`, which the standard shell always draws and the Slab shell draws when this
 * document does not load. What is open, what a key on a row means, which row a key moves to, how a
 * tall menu stands in columns, where a menu and its submenus are placed and when a pointer is
 * heading for an open submenu are `../menu`'s, shared; the rows' tracks are `./menu-params`'s.
 *
 * **Each level is a surface of its own.** A Slab surface's overlays cannot leave its box, and the
 * driver clips holes, so a submenu cannot be drawn by the menu it opens from. The menu's own rows
 * are one surface, in a box that hangs where the SolidJS menu's does (`.menu-drop` in the box the
 * owner gives: under a title, the overflow key or the pointer, pulled back inside the window by
 * `menuShift`); each open submenu is another surface beside it, in a box fixed in the window by
 * `submenuPlacement`, a sibling of the first in the owner's box. A stacked menu (no room beside a
 * row) is one surface of the whole open tree, which scrolls, and opens a group in place.
 *
 * **The host places, dismisses and owns the keyboard.** The box's width and height are worked out
 * before the kernel lays anything out, so a menu is placed and painted in the frame after the
 * press that opened it, as the SolidJS one is. The keys are taken on the surface before the kernel
 * sees them and are `Menu.tsx`'s exactly (`rowKeyAction`, `walkIndex`); only Enter and Space are
 * left to the kernel, whose activation comes back as the `row` signal (with no point when a key or
 * assistive technology made it). A press outside, Escape outside, Tab, a resize are handled as
 * there.
 *
 * **Opening costs no kernel.** A surface's element mounts its document a turn after it is
 * connected and builds a kernel instance; a menu opened that way would paint a frame late. The
 * elements are made once (`prepareMenus`, at boot) and kept on a hidden shelf, and an opening moves
 * one into its box: the driver keeps its instance across the move, so the opening is a list write
 * and a solve.
 *
 * **The pointer costs no solve per move.** No node binds `pointer-move` and the kernel lights
 * nothing on its own hover: the row under the pointer is found in the solved scene on the page's
 * own pointer events, and lit with a list write when it changes, so a pointer drawn down the rows
 * solves once per row it enters.
 *
 * **What the language cannot say** is written onto the driver's accessible nodes after every
 * frame (`rowExtras`): a submenu row's `aria-haspopup`, a row's `aria-keyshortcuts`, and the
 * `aria-disabled` of a row that is not available (the kernel's `disabled` would take it out of
 * the focus ring, where the SolidJS row keeps its place). The box of each level is the page's own
 * `role="menu"`, with its name, around the surface: the driver's tree has no node for a
 * document's root.
 */

import { createEffect, createSignal, on, onCleanup, onMount, untrack, type JSX } from "solid-js";
import { isMacPlatform } from "../commands";
import type { MenuHandle, MenuProps } from "../components/Menu";
import { AIM_GRACE_MS, aimsAt, clickPath, hoverPath, isOnPath, menuBounds, menuShift, rowKeyAction, samePath, stackedBlock, submenuPlacement, walkIndex, type Box, type MenuItem, type MenuPath, type Point } from "../menu";
import { groupScroll, menuSurface, rowAt, rowExtras, rowIndex, rowOfKey, withLit, MENU_METRICS, type MenuColumnParam, type MenuEntry, type MenuSurface } from "./menu-params";
import { pageMeasure, type TextMeasure } from "./measure";
import { isSlabControlHost, ringForKeysOnly, signalPoint, type SlabControlHost } from "./scene";
import { roundStrokes } from "./strokes";
import { attachSurface } from "./surface";
import { signalDetail } from "./types";
import "./slab-chrome.css";
import "./slab-menu.css";

/** The element the document defines (`./loader`: SLAB_TAGS). */
const TAG = "cadcraft-menu";

/** The document's scrolling body (a stacked menu scrolls it). */
const BODY = "#menu/#body";

/** A coarse pointer: the rows take the button's height (ui.css). */
const COARSE_QUERY = "(pointer: coarse)";

/** What a page with no canvas measures text as: a guess, so the menu still opens. */
const roughMeasure: TextMeasure = (_style, text) => [...text].length * 7;

// ---------------------------------------------------------------------------------------------
// The shelf: surfaces made once and lent to each opening
// ---------------------------------------------------------------------------------------------

/** What an opening does with the surface it is lent. */
interface Lender {
  key: (event: KeyboardEvent) => void;
  signal: (event: Event) => void;
  move: (event: PointerEvent) => void;
  down: () => void;
  leave: () => void;
  frame: () => void;
}

interface Kept {
  host: SlabControlHost;
  lender: Lender | null;
}

let shelf: HTMLDivElement | null = null;
let lastByKey = false;
const free: Kept[] = [];

/**
 * One surface: made and wired once for good, and put on the shelf, where it mounts its document
 * and paints a first frame; then it is taken off the page. A surface out of the page keeps its
 * kernel and paints nothing; the opening that borrows it puts it in its box.
 */
function makeKept(): Kept | null {
  if (typeof document === "undefined" || shelf === null) return null;
  const element = document.createElement(TAG);
  element.className = "slab-surface";
  if (!isSlabControlHost(element)) return null;
  const host: SlabControlHost = element;
  const kept: Kept = { host, lender: null };
  // Ahead of `attachSurface` (which hands Tab to the browser alone) and of the kernel.
  host.addEventListener("keydown", (event) => kept.lender?.key(event), true);
  attachSurface(host, ["row"], (_name, event) => kept.lender?.signal(event));
  ringForKeysOnly(host);
  host.addEventListener("pointermove", (event) => kept.lender?.move(event));
  host.addEventListener("pointerleave", () => kept.lender?.leave());
  host.addEventListener("pointerdown", () => kept.lender?.down(), true);
  host.addEventListener("slab-frame", () => kept.lender?.frame());
  // The surface stands over the drawing's own surfaces: the browser's menu stays away from it.
  host.addEventListener("contextmenu", (event) => event.preventDefault());
  // A first row, so the kernel has a scene with the keys an opening focuses before its first frame.
  host.setParam("w", 240);
  host.setParam("h", 40);
  host.setList("cols", "", [{ key: "c0", cw: 230, rows: [{ key: "r0", caption: " " }] }]);
  const settle = (): void => {
    host.removeEventListener("slab-frame", settle);
    if (kept.lender === null) host.remove();
  };
  host.addEventListener("slab-frame", settle);
  shelf.appendChild(host);
  roundStrokes(host);
  return kept;
}

/**
 * Make the shelf and the surfaces on it, so the first menu opened paints at once. Called once the
 * document's element is defined (`main.tsx`); calling it again does nothing.
 */
export function prepareMenus(count = 3): void {
  if (shelf !== null || typeof document === "undefined") return;
  // What moved last, the keys or a pointer: a menu opened with the keyboard on its first row shows
  // the ring only after a key, as the browser's `:focus-visible` does for the SolidJS rows.
  document.addEventListener("keydown", () => (lastByKey = true), true);
  document.addEventListener("pointerdown", () => (lastByKey = false), true);
  shelf = document.createElement("div");
  shelf.className = "slab-menu-shelf";
  shelf.setAttribute("aria-hidden", "true");
  document.body.appendChild(shelf);
  for (let i = 0; i < count; i += 1) {
    const kept = makeKept();
    if (kept !== null) free.push(kept);
  }
}

function borrow(lender: Lender): Kept | null {
  prepareMenus();
  const kept = free.pop() ?? makeKept();
  if (kept !== null) kept.lender = lender;
  return kept;
}

function giveBack(kept: Kept): void {
  kept.lender = null;
  kept.host.clearFocus();
  kept.host.remove();
  free.push(kept);
}

// ---------------------------------------------------------------------------------------------
// One level of an open menu
// ---------------------------------------------------------------------------------------------

/** The accessible node the driver keeps for a control: what holds the page's focus while the control has the kernel's. */
function nodeOf(host: SlabControlHost, key: string): HTMLElement | null {
  for (const node of host.shadowRoot?.querySelectorAll<HTMLElement>(".slab-a11y-node") ?? []) if (node.dataset["slabKey"] === key) return node;
  return null;
}

/** The full key of a row in a surface's scene; undefined before the frame that lays it out. */
function sceneKeyOf(host: SlabControlHost, itemKey: string): string | undefined {
  return host.sceneSnapshot().find((node) => rowOfKey(node.key) === itemKey)?.key;
}

class Level {
  readonly box: HTMLDivElement;
  readonly kept: Kept | null;
  surface: MenuSurface | null = null;
  /** The list as the kernel holds it (with the lit rows). */
  private cols: MenuColumnParam[] = [];
  /** The rows lit by the pointer and by the keys. */
  hovered: string | null = null;
  keyed: string | null = null;
  /** The list was written and its frame has not been painted: the scene still shows the old one. */
  private stale = true;
  /** A row to hand the keyboard to once the frame that lays it out is painted. */
  private pending: { key: string; visible: boolean } | null = null;
  /** What the kernel was last handed, so an equal layout is not written (an equal write paints no frame). */
  private signature = "";
  constructor(
    box: HTMLDivElement,
    lender: Lender,
    private readonly mac: boolean,
  ) {
    this.box = box;
    this.kept = borrow(lender);
  }

  get host(): SlabControlHost | null {
    return this.kept?.host ?? null;
  }

  /** Lays the surface out: its size first (the box is placed by it), then its list. */
  show(surface: MenuSurface): void {
    const signature = JSON.stringify([surface.width, surface.height, surface.cols]);
    this.surface = surface;
    if (signature === this.signature) return;
    this.signature = signature;
    const host = this.host;
    this.box.style.width = `${surface.width}px`;
    this.box.style.height = `${surface.height}px`;
    if (host === null) return;
    host.style.width = `${surface.width}px`;
    host.style.height = `${surface.height}px`;
    host.setParam("w", surface.width);
    host.setParam("h", surface.height);
    // Rows that went keep no light.
    const keys = new Set(surface.entries.map((entry) => entry.key));
    if (this.hovered !== null && !keys.has(this.hovered)) this.hovered = null;
    if (this.keyed !== null && !keys.has(this.keyed)) this.keyed = null;
    this.cols = withLit(surface.cols, this.litKeys());
    host.setList("cols", "", this.cols);
    this.stale = true;
    // Into the page last, at its size: the driver measures it as it arrives, once.
    if (host.parentElement !== this.box) this.box.appendChild(host);
  }

  /** The rows lit: the one under the pointer, the one the keys are on, and the open submenus' rows. */
  private litKeys(): Set<string> {
    const lit = new Set<string>();
    if (this.hovered !== null) lit.add(this.hovered);
    if (this.keyed !== null) lit.add(this.keyed);
    for (const col of this.surface?.cols ?? []) for (const row of col.rows) if (row.open) lit.add(row.key);
    return lit;
  }

  /** Writes the lit rows again; nothing when no row changed. */
  relight(): void {
    const host = this.host;
    if (host === null || this.surface === null) return;
    const next = withLit(this.cols, this.litKeys());
    if (next.every((col, i) => col === this.cols[i])) return;
    this.cols = next;
    host.setList("cols", "", next);
  }

  entry(itemKey: string | null): MenuEntry | undefined {
    if (itemKey === null) return undefined;
    const index = rowIndex(itemKey, this.surface?.entries.length ?? 0);
    return index === null ? undefined : this.surface?.entries[index];
  }

  /** The row the kernel's focus is on. */
  focused(): MenuEntry | undefined {
    const key = this.host?.focusedKey() ?? null;
    return this.entry(key === null ? null : rowOfKey(key));
  }

  /** Puts the keyboard on a row: the kernel's focus at once, the page's once the row is laid out. */
  focus(entry: MenuEntry, visible: boolean): void {
    this.keyed = visible ? entry.key : null;
    this.relight();
    this.pending = { key: entry.key, visible };
    if (!this.stale) this.flush();
    else {
      // The scene of the last frame has a row at this key (the rows are keyed by place): the ring
      // is drawn in the first frame; the page's focus follows once the row's node says what it is.
      const key = this.host === null ? undefined : sceneKeyOf(this.host, entry.key);
      if (key !== undefined) this.host?.setFocus(key, visible);
    }
    this.reveal(entry);
  }

  private flush(): void {
    const host = this.host;
    const want = this.pending;
    if (host === null || want === null) return;
    const key = sceneKeyOf(host, want.key);
    if (key === undefined) return;
    this.pending = null;
    host.setFocus(key, want.visible);
    const node = nodeOf(host, key);
    if (node !== null && !node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
    (node ?? host.shadowRoot?.querySelector<HTMLElement>('.slab-a11y-node[tabindex="0"]'))?.focus({ preventScroll: true });
  }

  /** Brings a row into view in a box that scrolls (a stacked menu), with the group opened under it when it has one. */
  reveal(entry: MenuEntry, group?: MenuEntry): void {
    const host = this.host;
    const surface = this.surface;
    if (host === null || surface === null || surface.content <= surface.height - 2 * MENU_METRICS.frame) return;
    const view = surface.height - 2 * MENU_METRICS.frame;
    const end = group === undefined ? entry.top + entry.height : group.top + group.height;
    const now = host.getScroll(BODY, 0);
    const to = group === undefined ? groupScroll(entry.top, entry.top + entry.height, view, now) : stackedBlock(end - entry.top, view) === "start" ? entry.top : groupScroll(entry.top, end, view, now);
    if (Math.abs(to - now) > 0.5) host.setScroll(BODY, 0, to);
    // The kernel clamps an offset to the content it last laid out: a group just opened is not in
    // it yet, so the offset is asked for again once the frame that lays the group out is painted.
    this.scrollTo = this.stale ? to : null;
  }

  private scrollTo: number | null = null;

  /**
   * The frames after a press in which the kernel's ring is put away again (`SlabTopBar.tsx`):
   * the driver moves the page's focus onto the pressed row's accessible node in the frame after
   * the press, and takes that for the keyboard's.
   */
  calm = 0;

  /** The frame was painted: the scene is this list's. */
  painted(): void {
    this.stale = false;
    const host = this.host;
    if (this.scrollTo !== null && host !== null) {
      const to = this.scrollTo;
      this.scrollTo = null;
      if (Math.abs(host.getScroll(BODY, 0) - to) > 0.5) host.setScroll(BODY, 0, to);
    }
    if (this.calm > 0 && host !== null) {
      this.calm -= 1;
      const held = host.focusedKey();
      if (held !== null && this.pending === null) host.setFocus(held, false);
    }
    this.flush();
    this.say();
  }

  /** The ARIA the language has no attribute for, on each row's accessible node. */
  private say(): void {
    const host = this.host;
    if (host === null) return;
    for (const node of host.shadowRoot?.querySelectorAll<HTMLElement>(".slab-a11y-node[role]") ?? []) {
      const row = rowOfKey(node.dataset["slabKey"] ?? "");
      const entry = this.entry(row);
      if (entry === undefined) continue;
      for (const [name, value] of Object.entries(rowExtras(entry.item, this.mac))) {
        if (value === null) {
          if (node.hasAttribute(name)) node.removeAttribute(name);
        } else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
      }
      // Every row takes the focus, as a `Row menuitem` does (the driver gives a tab index to its one stop only).
      if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
    }
  }

  /** A row's box in the window, from the layout (the scene may still be the last list's). */
  rowBox(entry: MenuEntry): Box {
    const rect = this.box.getBoundingClientRect();
    const surface = this.surface;
    let x = MENU_METRICS.frame;
    for (let c = 0; c < entry.column; c += 1) x += (surface?.cols[c]?.cw ?? 0) + MENU_METRICS.columnGap;
    const w = surface?.cols[entry.column]?.cw ?? 0;
    const scroll = this.host?.getScroll(BODY, 0) ?? 0;
    const top = rect.top + MENU_METRICS.frame + entry.top - (Number.isFinite(scroll) ? scroll : 0);
    return { left: rect.left + x, top, right: rect.left + x + w, bottom: top + entry.height };
  }

  /** The row under a point of the window; null over anything else. */
  rowAtPoint(x: number, y: number): MenuEntry | undefined {
    const host = this.host;
    if (host === null || this.stale) return undefined;
    const rect = host.getBoundingClientRect();
    return this.entry(rowAt(host.sceneSnapshot(), x - rect.left, y - rect.top));
  }

  close(): void {
    if (this.kept !== null) giveBack(this.kept);
    this.box.remove();
  }
}

// ---------------------------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------------------------

/** The paths of the submenus open beside their rows, outermost first; each names a submenu of the tree. */
function openLevels(items: readonly MenuItem[], chain: MenuPath): { path: MenuPath; items: readonly MenuItem[] }[] {
  const out: { path: MenuPath; items: readonly MenuItem[] }[] = [{ path: [], items }];
  let list = items;
  for (let depth = 0; depth < chain.length && depth < 8; depth += 1) {
    const label = chain[depth];
    const sub = list.find((item) => item.id === null && item.label === label);
    if (sub === undefined) break;
    list = sub.children;
    out.push({ path: chain.slice(0, depth + 1), items: list });
  }
  return out;
}

const px = (value: string): number => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : Number.NaN;
};

export function SlabMenu(props: MenuProps): JSX.Element {
  let root: HTMLDivElement | undefined;
  const mac = isMacPlatform();
  const measure = pageMeasure() ?? roughMeasure;
  const coarseQuery = typeof window.matchMedia === "function" ? window.matchMedia(COARSE_QUERY) : null;
  const [chain, setChain] = createSignal<MenuPath>([]);
  /** The submenu the pointer's hover opened and no click has touched yet (`Menu.tsx`). */
  let hoverOpened: MenuPath | null = null;
  const levels: Level[] = [];
  const stacked = (): boolean => props.stacked === true;

  props.handle?.({
    enter: (last = false) => {
      setChain([]);
      // An owner may ask before this menu's own mount has laid it out (its `onMount` runs first).
      if (levels.length === 0) render();
      const first = levels[0];
      const rows = first?.surface?.entries.filter((entry) => entry.depth === 0) ?? [];
      const row = rows[last ? rows.length - 1 : 0];
      if (first === undefined || row === undefined) return false;
      first.focus(row, lastByKey);
      return true;
    },
    collapse: () => setChain([]),
  } satisfies MenuHandle);

  // ---- placement ----

  const floorOf = (): number => document.querySelector(".statusbar")?.getBoundingClientRect().top ?? window.innerHeight;
  /** The window less the menu's own inset (`Menu.tsx` reads it as the box's padding: 4). */
  const bounds = (): Box => menuBounds(window.innerWidth, floorOf(), MENU_METRICS.frame - 1);

  /**
   * What the menu's own box's sheet says (chrome.css: `.menu-drop`), read once per layout: the
   * least it is wide (30ch; a submenu's is 24ch), the most it is tall above the status bar, the
   * width of a stacked one (40ch, or the window less its gutters), and the room between a menu and
   * its submenu.
   */
  interface Sheet {
    min: number;
    subMin: number;
    max: number;
    stackedW: number;
    gap: number;
  }
  const sheet = (box: HTMLElement): Sheet => {
    box.style.setProperty("--menu-floor", `${Math.max(0, window.innerHeight - floorOf())}px`);
    const style = getComputedStyle(box);
    const read = px(style.minWidth);
    const min = Number.isFinite(read) ? read : 0;
    const ch = min / 30;
    const gap = px(style.getPropertyValue("--menu-sub-gap"));
    const gutter = 8;
    return { min, subMin: 24 * ch, max: px(style.maxHeight), stackedW: Math.min(40 * ch, window.innerWidth - 2 * gutter), gap: Number.isFinite(gap) ? gap : 2 };
  };

  const surfaceFor = (path: MenuPath, items: readonly MenuItem[], s: Sheet, sub: boolean): MenuSurface =>
    menuSurface({ items, path, chain: chain(), stacked: stacked(), coarse: coarseQuery?.matches ?? false, minWidth: sub ? s.subMin : s.min, stackedWidth: s.stackedW, maxHeight: s.max, measure, mac });

  /** Pulls the menu's own box back inside the window (`menuShift`), from where its sheet hangs it. */
  const placeRoot = (): void => {
    if (root === undefined) return;
    root.style.setProperty("--menu-shift-x", "0px");
    root.style.setProperty("--menu-shift-y", "0px");
    const shift = menuShift(root.getBoundingClientRect(), bounds());
    if (shift.x !== null) root.style.setProperty("--menu-shift-x", `${shift.x}px`);
    if (shift.y !== null) root.style.setProperty("--menu-shift-y", `${shift.y}px`);
  };

  /** Stands a submenu beside its row, outside its whole parent menu, on the side with room. */
  const placeSub = (level: Level, parent: Level, row: MenuEntry, g: number): void => {
    const surface = level.surface;
    if (surface === null) return;
    const parentBox = parent.box.getBoundingClientRect();
    const rowBox = parent.rowBox(row);
    const b = bounds();
    const place = submenuPlacement(rowBox, parentBox, surface.width, g, b);
    const left = place.flipped ? parentBox.left - g - surface.width : parentBox.right + g;
    const top = rowBox.top - MENU_METRICS.frame;
    const shift = menuShift({ left, top, right: left + surface.width, bottom: top + surface.height }, b);
    const frame = root?.getBoundingClientRect() ?? { left: 0, top: 0 };
    level.box.style.setProperty("--slab-sub-x", `${Math.round(left + (shift.x ?? 0) - frame.left)}px`);
    level.box.style.setProperty("--slab-sub-y", `${Math.round(top + (shift.y ?? 0) - frame.top)}px`);
    level.box.classList.toggle("is-flipped", place.flipped);
  };

  // ---- the pointer ----

  /** The pointer's last two places over the menu, and when it last moved (`Menu.tsx`). */
  let trail: Point[] = [];
  let movedAt = 0;
  let aim: number | undefined;

  /** Whether a pointer on `entry` (of `level`) that moved from `from` to `to` is heading for the submenu open beside one of the row's siblings. */
  const aiming = (level: Level, entry: MenuEntry, from: Point | undefined, to: Point): boolean => {
    const index = levels.indexOf(level);
    const open = levels[index + 1];
    if (open === undefined || from === undefined) return false;
    // The submenu that is open is this row's own: the pointer is on its way to it already.
    if (isOnPath(chain(), entry.path, entry.item.label) && entry.item.id === null) return false;
    const r = open.box.getBoundingClientRect();
    return aimsAt(from, to, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  };

  const hover = (level: Level, entry: MenuEntry, at: Point, waited: boolean): void => {
    if (stacked()) return;
    window.clearTimeout(aim);
    const next = hoverPath(chain(), entry.item, entry.path);
    if (next === chain()) return;
    if (!waited && aiming(level, entry, trail[trail.length - 2], at)) {
      const rest = (): void => {
        if (level.hovered !== entry.key) return;
        const [from, to] = trail;
        if (performance.now() - movedAt < AIM_GRACE_MS && to !== undefined && aiming(level, entry, from, to)) {
          aim = window.setTimeout(rest, AIM_GRACE_MS);
          return;
        }
        hover(level, entry, at, true);
      };
      aim = window.setTimeout(rest, AIM_GRACE_MS);
      return;
    }
    hoverOpened = entry.item.id === null ? next : null;
    setChain(next);
  };

  const onMove = (level: Level, event: PointerEvent): void => {
    const at = { x: event.clientX, y: event.clientY };
    trail = [...trail.slice(-1), at];
    movedAt = event.timeStamp;
    // Only a mouse hovers: a finger's tap also "enters" a row, and its click must be the one act.
    if (event.pointerType !== "mouse") return;
    const entry = level.rowAtPoint(event.clientX, event.clientY);
    const key = entry?.key ?? null;
    if (key === level.hovered) return;
    level.hovered = key;
    level.relight();
    if (entry !== undefined) hover(level, entry, at, false);
  };

  // ---- a row chosen ----

  const click = (level: Level, entry: MenuEntry, byKey: boolean): void => {
    const item = entry.item;
    if (item.id !== null) {
      if (item.enabled) props.onInvoke(item.id, byKey);
      return;
    }
    const into = [...entry.path, item.label];
    if (byKey) {
      setChain(into);
      enterSub(level, entry);
      return;
    }
    const byHover = hoverOpened !== null && samePath(hoverOpened, into);
    hoverOpened = null;
    setChain(clickPath(chain(), entry.path, item.label, byHover));
  };

  /** The keyboard into a submenu just opened: its first row (in place, under its row, in a stacked menu). */
  const enterSub = (level: Level, entry: MenuEntry): void => {
    if (stacked()) {
      const first = level.surface?.entries.find((other) => other.depth === entry.depth + 1 && samePath(other.path, [...entry.path, entry.item.label]));
      if (first !== undefined) level.focus(first, true);
      return;
    }
    const next = levels[levels.indexOf(level) + 1];
    const first = next?.surface?.entries[0];
    if (next !== undefined && first !== undefined) next.focus(first, true);
  };

  // ---- the keys ----

  const onKey = (level: Level, event: KeyboardEvent): void => {
    // A key shows the ring again.
    for (const one of levels) one.calm = 0;
    const entry = level.focused();
    if (entry === undefined) return;
    const action = rowKeyAction(event.key, entry.path.length, entry.item.id === null);
    const take = (): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    if (action === "leave") {
      props.onDismiss("tab");
      return;
    }
    if (action === "walk") {
      // Enter and Space are the kernel's: its activation is the `row` signal.
      if ((event.key === "Enter" || event.key === " ") && !event.ctrlKey && !event.metaKey && !event.altKey) return;
      const next = walkIndex(
        event,
        entry.siblings.map((sibling) => sibling.label),
        entry.at,
      );
      if (next === null) {
        // The kernel would walk its one ring with an arrow it was not given here.
        if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) take();
        return;
      }
      take();
      if (!samePath(chain(), entry.path)) setChain(entry.path);
      const to = level.surface?.entries.find((other) => samePath(other.path, entry.path) && other.at === next);
      if (to !== undefined) level.focus(to, true);
      return;
    }
    take();
    if (action === "dismiss") props.onDismiss("escape");
    else if (action === "back") {
      const parentPath = entry.path.slice(0, -1);
      const label = entry.path[entry.path.length - 1];
      const owner = stacked() ? level : levels[levels.indexOf(level) - 1];
      const row = owner?.surface?.entries.find((other) => samePath(other.path, parentPath) && other.item.label === label && other.item.id === null);
      if (owner !== undefined && row !== undefined) owner.focus(row, true);
      setChain(parentPath);
    } else if (action === "into") {
      setChain([...entry.path, entry.item.label]);
      enterSub(level, entry);
    } else props.onStep?.(action === "next" ? 1 : -1);
  };

  // ---- the levels ----

  const lender = (get: () => Level | undefined): Lender => ({
    key: (event) => {
      const level = get();
      if (level !== undefined) onKey(level, event);
    },
    signal: (event) => {
      const level = get();
      const entry = level?.entry(signalDetail(event)?.item ?? null);
      if (level !== undefined && entry !== undefined) click(level, entry, signalPoint(event) === null);
    },
    move: (event) => {
      const level = get();
      if (level !== undefined) onMove(level, event);
    },
    down: () => {
      const level = get();
      if (level === undefined) return;
      level.calm = 3;
      level.keyed = null;
      level.relight();
    },
    leave: () => {
      const level = get();
      if (level === undefined || level.hovered === null) return;
      level.hovered = null;
      level.relight();
    },
    frame: () => get()?.painted(),
  });

  /** A stacked menu opens a group in place: the row that opened it, and the group, are brought into view. */
  let revealed: MenuPath = [];
  const revealOpened = (): void => {
    const open = chain();
    if (!stacked() || samePath(open, revealed)) return;
    revealed = open;
    const level = levels[0];
    const label = open[open.length - 1];
    const parentPath = open.slice(0, -1);
    const entries = level?.surface?.entries ?? [];
    const row = entries.find((entry) => entry.item.id === null && entry.item.label === label && samePath(entry.path, parentPath));
    if (level === undefined || row === undefined) return;
    const inGroup = entries.filter((entry) => entry.path.length >= open.length && samePath(entry.path.slice(0, open.length), open));
    level.reveal(row, inGroup[inGroup.length - 1]);
  };

  /** The surfaces for the items and the open chain: made, laid out and placed, the ones no longer open given back. */
  const render = (): void => {
    const own = root;
    if (own === undefined) return;
    const wanted = stacked() ? [{ path: [] as MenuPath, items: props.items }] : openLevels(props.items, chain());
    while (levels.length > wanted.length) levels.pop()?.close();
    const s = sheet(own);
    wanted.forEach((want, index) => {
      let level = levels[index];
      if (level === undefined) {
        let box: HTMLDivElement;
        if (index === 0) box = own;
        else {
          box = document.createElement("div");
          box.className = "menu-drop slab-menu slab-menu-sub";
          box.setAttribute("role", "menu");
          // In the menu's own box, after its surface: fixed in the window, and inside its menu for a screen reader.
          own.appendChild(box);
        }
        const made: Level = new Level(box, lender(() => made), mac);
        level = made;
        levels.push(made);
      }
      if (index > 0) level.box.setAttribute("aria-label", want.path[want.path.length - 1] ?? "");
      level.show(surfaceFor(want.path, want.items, s, index > 0));
    });
    placeRoot();
    revealOpened();
    for (let i = 1; i < levels.length; i += 1) {
      const parent = levels[i - 1];
      const level = levels[i];
      const label = wanted[i]?.path[i - 1];
      const row = parent?.surface?.entries.find((entry) => entry.item.id === null && entry.item.label === label);
      if (parent !== undefined && level !== undefined && row !== undefined) placeSub(level, parent, row, s.gap);
    }
  };

  onMount(() => {
    render();
    // The rows are worked out again whenever the items, the open chain or the arrangement change.
    createEffect(on(() => [props.items, chain(), stacked()], () => untrack(render), { defer: true }));

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
    const onResize = (): void => render();
    const onCoarse = (): void => render();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    coarseQuery?.addEventListener("change", onCoarse);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      coarseQuery?.removeEventListener("change", onCoarse);
      window.clearTimeout(aim);
      while (levels.length > 0) {
        const level = levels.pop();
        // The menu's own box is Solid's to take away.
        if (level === undefined) continue;
        if (level.box === root) {
          if (level.kept !== null) giveBack(level.kept);
        } else level.close();
      }
    });
  });

  return <div id={props.id} class="menu-drop slab-menu" role="menu" aria-label={props.label} ref={(element) => (root = element)} />;
}
