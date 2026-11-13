/**
 * What `slab/topbar.slab` is handed, worked out from the title bar's props: the three parts'
 * widths (the SolidJS bar's grid, `styles.css`: `.titlebar`, done by hand, since the language has
 * no grid and no window-width condition), the titles' list, which stop of the Tab key a control
 * is, and which control a point of the surface is on. Pure: no DOM, no Solid.
 */

import { MAX_PARAM_TEXT, paramText } from "./bench-params";
import type { TextMeasure } from "./measure";

/** The measures the layout is worked out with: the document's own tokens (`topBarMetrics`). */
export interface TopBarMetrics {
  /** The band's inset at its start (wide, and where the menus are one key) and at its end. */
  padStart: number;
  padStartCompact: number;
  padEnd: number;
  /** The room between two parts. */
  gap: number;
  /** An icon key's side, and the room between two keys. */
  key: number;
  keyGap: number;
  /** A title's inset, each side. */
  titlePad: number;
  /** The command centre's inset each side, its magnifier, its dot, and the room between its parts. */
  centrePad: number;
  glyph: number;
  dot: number;
  centreGap: number;
}

export const TOPBAR_METRICS: TopBarMetrics = { padStart: 4, padStartCompact: 8, padEnd: 8, gap: 8, key: 24, keyGap: 2, titlePad: 8, centrePad: 6, glyph: 12, dot: 6, centreGap: 6 };

/** The same measures read from a surface's tokens (`getToken`); a token that is not a length keeps its default. */
export function topBarMetrics(token: (path: string) => unknown): TopBarMetrics {
  const read = (path: string, fallback: number): number => {
    const value = token(path);
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 4096 ? value : fallback;
  };
  const d = TOPBAR_METRICS;
  const g8 = read("space.g8", d.gap);
  const g6 = read("space.g6", d.centrePad);
  return { padStart: read("space.g4", d.padStart), padStartCompact: g8, padEnd: g8, gap: g8, key: read("size.control-h-input", d.key), keyGap: read("space.g2", d.keyGap), titlePad: g8, centrePad: g6, glyph: read("size.icon-size-sm", d.glyph), dot: read("topbar.dot", d.dot), centreGap: g6 };
}

/** The command centre's reading width: 44 characters, or this share of the window where that is less (styles.css: `.command-center`). */
export const CENTRE_CH = 44;
export const CENTRE_SHARE = 0.4;
export const CENTRE_SHARE_COMPACT = 0.56;

/** The most titles a bar draws (the menu tree has ten). */
export const MAX_TITLES = 32;

/** The layout keys at the bar's end: the sidebar's, the command line's, the assistant's. */
export const LAYOUT_KEY_COUNT = 3;

export interface TopBarView {
  /** The window is too narrow for the titles: one menu key stands for them. */
  compact: boolean;
  /** The in-window menus are shown at all. */
  menus: boolean;
  /** The titles' labels. */
  titles: readonly string[];
  /** The drawing's name, and whether it has unsaved changes. */
  name: string;
  dirty: boolean;
}

export interface TopBarLayout {
  /** The three parts' widths, in px. */
  start: number;
  centre: number;
  end: number;
  /** The width the drawing's name is given inside the command centre. */
  name: number;
}

const whole = (value: number): number => (Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 100_000) : 0);

/**
 * The titles' run: each title is its label on the title's inset. The labels are laid out at their
 * fractional widths, as the browser lays out the SolidJS titles, so the run is rounded up once,
 * not once per title (eleven titles rounded each would stand the centre several px off).
 */
export function titlesWidth(labels: readonly string[], measure: TextMeasure, m: TopBarMetrics): number {
  let width = 0;
  for (const label of labels.slice(0, MAX_TITLES)) {
    const text = measure("label", paramText(label));
    width += (Number.isFinite(text) && text > 0 ? Math.min(text, 4096) : 0) + 2 * m.titlePad;
  }
  // Less a hair: a run that is whole but for the sum's float error is not rounded up a px.
  return Math.ceil(width - 1e-6);
}

/**
 * The bar's three tracks, as the SolidJS bar's grid lays them
 * (`minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr)`): the command centre takes
 * its reading width, or what the menus and the keys leave; the two sides share the rest equally,
 * so the centre stands in the middle of the window whenever the menus leave it the room, and as
 * near the middle as they allow when they do not. `width` is the bar's and `viewport` the
 * window's; a width that is no width lays out nothing.
 */
export function titleBarLayout(width: number, viewport: number, view: TopBarView, measure: TextMeasure, m: TopBarMetrics): TopBarLayout {
  const room = whole(width) - (view.compact ? m.padStartCompact : m.padStart) - m.padEnd - 2 * m.gap;
  if (!(room > 0)) return { start: 0, centre: 0, end: 0, name: 0 };
  const startMin = !view.menus ? 0 : view.compact ? m.key : titlesWidth(view.titles, measure, m);
  const endMin = LAYOUT_KEY_COUNT * m.key + (LAYOUT_KEY_COUNT - 1) * m.keyGap;
  const reading = Math.min(CENTRE_CH * measure("label", "0"), (view.compact ? CENTRE_SHARE_COMPACT : CENTRE_SHARE) * whole(viewport));
  const centre = Math.max(0, Math.min(Math.floor(reading) + 2 * m.centrePad, room - startMin - endMin));
  const rest = room - centre;
  // Two equal shares, unless one side's least width is more than its share: the other gives it up.
  let start = rest / 2;
  let end = rest / 2;
  if (startMin > start) {
    start = Math.min(startMin, rest);
    end = rest - start;
  } else if (endMin > end) {
    end = Math.min(endMin, rest);
    start = rest - end;
  }
  // The name's box: its own width, or what the centre has left beside the magnifier and the dot.
  const inner = centre - 2 * m.centrePad - m.glyph - m.centreGap - (view.dirty ? m.dot + m.centreGap : 0);
  const name = Math.max(0, Math.min(Math.ceil(measure("label", paramText(view.name))), Math.floor(inner)));
  return { start: Math.floor(start), centre, end: Math.floor(end), name };
}

/** One title of the bar, as the document's `TitleBarMenu` takes it. */
export interface TitleParam {
  key: string;
  name: string;
  open: boolean;
}

const titleKey = (index: number): string => `menu-${index}`;

/** The bar's list: a title per menu, the open one marked. */
export function titleParams(labels: readonly string[], open: number | null): TitleParam[] {
  return labels.slice(0, MAX_TITLES).map((label, index) => ({ key: titleKey(index), name: paramText(label), open: index === open }));
}

/** The title an item key of a signal stands for, among `count` titles; null for a key that names none, so a stale or forged signal opens nothing. */
export function pressedTitle(itemKey: string, count: number): number | null {
  const m = /^menu-(\d{1,2})$/.exec(itemKey);
  if (m === null) return null;
  const index = Number(m[1]);
  return index < Math.min(count, MAX_TITLES) ? index : null;
}

/** The stops the Tab key makes in the bar, in order: the menus (the bar's one stop, or the menu key), the command centre, the three layout keys. */
export const TOPBAR_STOPS = ["menus", "centre", "sidebar", "panel", "assistant"] as const;
export type TopBarStop = (typeof TOPBAR_STOPS)[number];

/** The longest key read (a key is a path of a few short segments). */
const MAX_KEY = 512;

/** Which stop a node of the document belongs to, by its key; null for a node of none. */
export function stopOfKey(key: string): TopBarStop | null {
  if (key.length > MAX_KEY) return null;
  if (key.includes("/#menubar/") || key.endsWith("/#menukey")) return "menus";
  if (key.endsWith("/#centre")) return "centre";
  if (key.endsWith("/#side")) return "sidebar";
  if (key.endsWith("/#panel")) return "panel";
  if (key.endsWith("/#chat")) return "assistant";
  return null;
}

/** Whether a key is the Main menu key's, or one of the bar's titles'. */
export const isMenuKeyKey = (key: string | null): boolean => key !== null && key.length <= MAX_KEY && key.endsWith("/#menukey");
export const isTitleKey = (key: string | null): boolean => key !== null && key.length <= MAX_KEY && key.includes("/#menubar/");

/** Where Tab (or Shift+Tab, `back`) goes from a stop: the next stop that is there, or null when the bar is left. */
export function nextStop(from: TopBarStop, back: boolean, has: { menus: boolean }): TopBarStop | null {
  const stops = TOPBAR_STOPS.filter((stop) => stop !== "menus" || has.menus);
  const at = stops.indexOf(from);
  if (at < 0) return null;
  return stops[at + (back ? -1 : 1)] ?? null;
}

/** The first and the last stop of the bar: where Tab arrives from before it and from after it. */
export function endStop(last: boolean, has: { menus: boolean }): TopBarStop {
  return last ? "assistant" : has.menus ? "menus" : "centre";
}

/** A solved node, as far as the bar reads one. */
export interface TopBarBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  role?: unknown;
}

/**
 * The control of the bar under a point of the surface (in its own px): a title, the menu key, the
 * command centre or a layout key, by its key. Null over anything else, and for a point that is no
 * point. The host asks on a move of the pointer, where a `pointer-move` binder in the document
 * would have the kernel solve a frame for every move.
 */
export function controlAt(scene: readonly TopBarBox[], x: number, y: number): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const node of scene) {
    if ((node.role !== "button" && node.role !== "menuitem") || !(x >= node.x && x < node.x + node.w && y >= node.y && y < node.y + node.h)) continue;
    if (stopOfKey(node.key) !== null) return node.key;
  }
  return null;
}

/** Whether a point is on the unsaved dot (it has a hint of its own, as in the SolidJS bar). */
export function onDirtyDot(scene: readonly TopBarBox[], x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return scene.some((node) => node.key.length <= MAX_KEY && node.key.endsWith("/#dirty") && x >= node.x && x < node.x + node.w && y >= node.y && y < node.y + node.h);
}

/**
 * What the driver's accessible node of a control is given beyond what the language can say
 * (SPEC §15.2 has no `pressed`, no `haspopup` and no `keyshortcuts`): the attributes the SolidJS
 * bar's controls carry. `null` removes one.
 */
export type SaidExtras = Readonly<Record<"aria-pressed" | "aria-haspopup" | "aria-keyshortcuts", string | null>>;

export interface TopBarState {
  sidebar: boolean;
  panel: boolean;
  assistant: boolean;
  /** The shortcuts as `aria-keyshortcuts` writes them, by stop. */
  shortcuts: Readonly<Partial<Record<TopBarStop, string>>>;
}

export function saidExtras(key: string, state: TopBarState): SaidExtras | null {
  const stop = stopOfKey(key);
  if (stop === null) return null;
  const shortcut = paramText(state.shortcuts[stop] ?? "");
  const keys = shortcut === "" ? null : shortcut;
  if (stop === "menus") return { "aria-pressed": null, "aria-haspopup": "menu", "aria-keyshortcuts": null };
  if (stop === "centre") return { "aria-pressed": null, "aria-haspopup": null, "aria-keyshortcuts": keys };
  return { "aria-pressed": String(state[stop]), "aria-haspopup": null, "aria-keyshortcuts": keys };
}

export { MAX_PARAM_TEXT };
