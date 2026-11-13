/**
 * What `slab/menu.slab` is handed, worked out from a menu's items: the rows of one surface (a
 * level of the menu, or, in a stacked menu, the whole open tree flattened into one column), the
 * columns they stand in, the widths of each column's tracks, and the box's own width and height,
 * all before the kernel lays anything out, so the host can place the menu in the window in the
 * same turn as it is asked for. The rules are the SolidJS menu's (`../menu`: `menuColumns`,
 * `showsName`, `isOnPath`), and the measures are chrome.css's (`.menu-drop` and its rows), which
 * a grid lays out there and this file does by hand: the language has no grid of shared tracks
 * across a list's items.
 *
 * Also the glyph declarations the document holds (generated from `../icons`, as the ribbon's
 * are), the keys the driver gives the rows, and the extra ARIA a row's accessible node is given
 * beyond what the language can say. Pure: no DOM, no Solid, no kernel.
 */

import { isMacPlatform, shortcutLabel } from "../commands";
import { isOnPath, menuColumns, showsName, type MenuItem, type MenuPath } from "../menu";
import { RIBBON_TOOLS } from "../ribbon";
import { ariaKeyShortcuts } from "../ui/Tooltip";
import { paramText } from "./bench-params";
import type { TextMeasure } from "./measure";
import { glyphBlock, glyphName, iconBlockOf, type RibbonGlyph } from "./ribbon-icons";

// ---------------------------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------------------------

/** The measures of a menu (chrome.css, ui.css; the document's own tokens restate them). */
export interface MenuMetrics {
  /** A row's height, and under a finger. */
  row: number;
  rowCoarse: number;
  /** A separator's: half a row. */
  sep: number;
  sepCoarse: number;
  /** The box's inset and hairline together: where the rows start. */
  frame: number;
  /** A row's inset at its start, and at its end; `rowEnd` is the part of the end's inset the document's row keeps (`menu.end-pad`): the chevron's box stands in the rest. */
  padStart: number;
  padEnd: number;
  rowEnd: number;
  /** The room between a row's parts (the row's gap). */
  gap: number;
  /** The room between two columns, and between a row's tracks where nothing stands in one. */
  columnGap: number;
  /** A row's glyph and the room after it (the overflow menu's rows). */
  glyphBox: number;
  /** The submenu's chevron, as wide as it stands in its track (its 12 less the 4 it is pulled out). */
  chevron: number;
  /** How far in a group opened in place stands: 12, a hairline, 4. */
  guide: number;
}

export const MENU_METRICS: MenuMetrics = { row: 24, rowCoarse: 28, sep: 12, sepCoarse: 14, frame: 5, padStart: 8, padEnd: 8, rowEnd: 4, gap: 16, columnGap: 4, glyphBox: 22, chevron: 8, guide: 17 };

/** The most rows one surface draws: a menu has a few dozen; a forged tree is cut here. */
export const MAX_MENU_ROWS = 400;

/** The deepest a stacked menu flattens (the menu tree is three levels deep). */
export const MAX_MENU_DEPTH = 8;

/** The widest and the tallest a box is laid out (px). */
const MAX_BOX = 8192;

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback);

/** A text's width as the kernel will lay it out: a run that is no number measures 0, and no run is wider than the box. */
function width(measure: TextMeasure, style: string, text: string): number {
  if (text === "") return 0;
  const w = measure(style, text);
  return Number.isFinite(w) && w > 0 ? Math.min(w, MAX_BOX) : 0;
}

// ---------------------------------------------------------------------------------------------
// The rows of one surface
// ---------------------------------------------------------------------------------------------

/** One row of a surface: what it is, where it stands in the tree, and how the keys walk it. */
export interface MenuEntry {
  /** The list item's key (`r<n>`), the row's place among the surface's rows. */
  key: string;
  item: MenuItem;
  /** The path of the list the row is in (its submenus' labels, from the menu's own rows). */
  path: MenuPath;
  /** Its place among its own list's rows, and that list. */
  at: number;
  siblings: readonly MenuItem[];
  /** How many groups opened in place it stands in (a stacked menu only). */
  depth: number;
  /** The column it stands in, and its top inside the box's content (px). */
  column: number;
  top: number;
  /** Its height (px). */
  height: number;
}

/** One item of a column's `rows` list: a `MenuRow`. */
export interface MenuRowParam {
  key: string;
  caption: string;
  name: string;
  short: string;
  said: string;
  glyph: string;
  iconed: boolean;
  sub: boolean;
  open: boolean;
  down: boolean;
  off: boolean;
  lit: boolean;
  sep: boolean;
  /** Its place among its own list's rows, and their count (a stacked menu holds several lists). */
  pos: number;
  count: number;
  lw: number;
  nw: number;
  sw: number;
  g1: number;
  g2: number;
  guides: { key: string; on: boolean }[];
}

/** One item of the document's `cols` list: a `MenuColumn`. */
export interface MenuColumnParam {
  key: string;
  cw: number;
  rows: MenuRowParam[];
}

/** One surface of a menu, worked out. */
export interface MenuSurface {
  cols: MenuColumnParam[];
  /** The rows the keys walk, in reading order (down the first column, then the next). */
  entries: MenuEntry[];
  /** The box's outer width and height, and its content's height (taller than the box: it scrolls). */
  width: number;
  height: number;
  content: number;
}

export interface MenuSurfaceInput {
  items: readonly MenuItem[];
  /** The path of the list this surface draws (its own rows are at this path). */
  path: MenuPath;
  /** The open submenu chain (a stacked menu draws the groups on it in place). */
  chain: MenuPath;
  stacked: boolean;
  coarse: boolean;
  /** The least the box is wide (chrome.css: 30ch a menu, 24ch a submenu), and a stacked one's width. */
  minWidth: number;
  stackedWidth: number;
  /** The most the box may be tall (the computed `max-height` of chrome.css's `.menu-drop`); not a number is no limit. */
  maxHeight: number;
  measure: TextMeasure;
  mac: boolean;
  metrics?: MenuMetrics;
}

/** The shortcut a row prints, in this platform's words (as `Menu.tsx` prints it). */
export function rowShortcut(item: MenuItem, mac: boolean): string {
  return item.id === null || item.shortcut === "" ? "" : paramText(shortcutLabel(item.shortcut, mac));
}

interface Flat {
  item: MenuItem;
  path: MenuPath;
  at: number;
  siblings: readonly MenuItem[];
  depth: number;
  /** A separator is drawn above it. */
  lead: boolean;
}

/** The rows of a surface: a level's own, or a stacked menu's open tree, depth first, each group under its row. */
function flatten(items: readonly MenuItem[], path: MenuPath, chain: MenuPath, stacked: boolean, depth: number, out: Flat[]): void {
  items.forEach((item, at) => {
    if (out.length >= MAX_MENU_ROWS) return;
    out.push({ item, path, at, siblings: items, depth, lead: at > 0 && item.group === true });
    if (stacked && item.id === null && depth < MAX_MENU_DEPTH && isOnPath(chain, path, item.label)) flatten(item.children, [...path, item.label], chain, stacked, depth + 1, out);
  });
}

/** What one row needs measured. */
interface Measured {
  label: number;
  name: number;
  shortcut: number;
  shortcutText: string;
  nameText: string;
}

function measureRow(flat: Flat, measure: TextMeasure, mac: boolean, m: MenuMetrics): Measured {
  const item = flat.item;
  const nameText = showsName(item.name ?? "") ? paramText((item.name ?? "").toLowerCase()) : "";
  const shortcutText = rowShortcut(item, mac);
  return {
    label: (item.icon === undefined ? 0 : m.glyphBox) + width(measure, "body", paramText(item.label)),
    name: width(measure, "mono", nameText),
    shortcut: item.id === null ? m.chevron : width(measure, "label", shortcutText),
    shortcutText,
    nameText,
  };
}

/**
 * The tracks of a column as chrome.css's grid lays them: the labels' track, the names' and the
 * shortcuts', each as wide as its widest; a track nothing stands in takes no room, and the room
 * between two tracks is the row's gap where both sides hold something (the grid's own, smaller
 * gap otherwise).
 */
interface Tracks {
  label: number;
  name: number;
  shortcut: number;
  g1: number;
  g2: number;
}

function tracksOf(rows: readonly Measured[], m: MenuMetrics): Tracks {
  let label = 0;
  let name = 0;
  let shortcut = 0;
  for (const row of rows) {
    label = Math.max(label, row.label);
    name = Math.max(name, row.name);
    shortcut = Math.max(shortcut, row.shortcut);
  }
  // The row is a subgrid of the menu's grid: a part stands its half of the row's gap past the
  // grid's gap on each side that meets another track; an empty track adds only the grid's gap.
  const half = (m.gap - m.columnGap) / 2;
  const g1 = name > 0 ? m.gap : shortcut > 0 ? m.columnGap * 2 + half * 2 : m.columnGap * 2 + half;
  const g2 = name > 0 ? (shortcut > 0 ? m.gap : m.columnGap + half) : 0;
  return { label, name, shortcut, g1, g2 };
}

/** A row's width from its tracks: its two insets and the three tracks with the room between them. */
function rowWidth(t: Tracks, m: MenuMetrics): number {
  return m.padStart + t.label + t.g1 + t.name + t.g2 + t.shortcut + m.padEnd;
}

/**
 * One surface of a menu. A level beside its row stands in as many columns as its greatest height
 * needs (`menuColumns`, with the separator that would lead or end a column left out); a stacked
 * menu is one column of the open tree, its box `stackedWidth` wide, that scrolls past
 * `maxHeight`, and in each row the typed name is the first thing to give way, whole, then the
 * label is cut.
 */
export function menuSurface(input: MenuSurfaceInput): MenuSurface {
  const m = input.metrics ?? MENU_METRICS;
  const rowH = input.coarse ? m.rowCoarse : m.row;
  const sepH = input.coarse ? m.sepCoarse : m.sep;
  const flats: Flat[] = [];
  flatten(input.items, input.path, input.chain, input.stacked, 0, flats);
  const measured = flats.map((flat) => measureRow(flat, input.measure, input.mac, m));
  const maxH = Number.isFinite(input.maxHeight) && input.maxHeight > 0 ? Math.min(input.maxHeight, MAX_BOX) : MAX_BOX;
  const frame = 2 * m.frame;

  // Which rows start a column, and above which a separator is drawn.
  let starts: boolean[];
  let seps: boolean[];
  if (input.stacked) {
    starts = flats.map(() => false);
    seps = flats.map((flat) => flat.lead);
  } else {
    // A track is half a row (chrome.css): the capacity is counted in tracks, with half a px of slack.
    const capacity = (maxH - frame + 0.5) / (rowH / 2);
    const plan = menuColumns(
      flats.map((flat) => flat.lead),
      capacity,
    );
    starts = plan.starts;
    seps = plan.separators;
  }

  // The columns: runs of rows from one start to the next.
  const runs: number[][] = [];
  flats.forEach((_, i) => {
    if (i === 0 || starts[i] === true) runs.push([]);
    runs[runs.length - 1]?.push(i);
  });

  const stackedW = Math.max(0, Math.min(finite(input.stackedWidth), MAX_BOX));
  const minW = Math.max(0, Math.min(finite(input.minWidth), MAX_BOX));
  const tracks = runs.map((run) => tracksOf(
    run.map((i) => measured[i]).filter((row): row is Measured => row !== undefined),
    m,
  ));
  // The labels' tracks are the grid's flexible ones (`minmax(0, 1fr)`): in a box as wide as its
  // content they come out equal, each as wide as the widest label of any column.
  if (!input.stacked) {
    const label = tracks.reduce((most, t) => Math.max(most, t.label), 0);
    tracks.forEach((t) => {
      t.label = label;
    });
  }
  let widths = tracks.map((t) => rowWidth(t, m));
  // A box narrower than its least width shares the rest out to the labels' tracks, equally.
  const natural = widths.reduce((sum, w) => sum + w, 0) + m.columnGap * Math.max(0, widths.length - 1);
  if (!input.stacked && natural + frame < minW && widths.length > 0) {
    const share = (minW - frame - natural) / widths.length;
    widths = widths.map((w) => w + share);
    tracks.forEach((t) => {
      t.label += share;
    });
  }
  const content = input.stacked ? Math.max(0, stackedW - frame) : widths.reduce((sum, w) => sum + w, 0) + m.columnGap * Math.max(0, widths.length - 1);

  const entries: MenuEntry[] = [];
  let tallest = 0;
  const cols: MenuColumnParam[] = runs.map((run, column) => {
    const t = tracks[column] ?? { label: 0, name: 0, shortcut: 0, g1: 0, g2: 0 };
    const colW = input.stacked ? content : (widths[column] ?? 0);
    let top = 0;
    const rows: MenuRowParam[] = [];
    for (const i of run) {
      const flat = flats[i];
      const one = measured[i];
      if (flat === undefined || one === undefined) continue;
      const guides = Array.from({ length: flat.depth }, (_, g) => ({ key: `g${g}`, on: true }));
      if (seps[i] === true) {
        rows.push({ ...blankRow(`s${i}`), sep: true, guides });
        top += sepH;
      }
      const item = flat.item;
      const sub = item.id === null;
      const open = sub && isOnPath(input.chain, flat.path, item.label);
      let lw: number;
      let nw: number;
      let g1: number;
      let g2: number;
      let sw: number;
      if (input.stacked) {
        // A flex row of a fixed width (chrome.css: `.menu-drop.is-stacked`): the label takes what
        // is left; the name is whole or gone, and goes first; the shortcut never gives way.
        const inner = Math.max(0, colW - flat.depth * m.guide - m.padStart - m.padEnd);
        const tail = one.shortcut > 0 ? m.gap + one.shortcut : 0;
        const withName = one.name > 0 && one.label + m.gap + one.name + tail <= inner;
        g1 = withName ? m.gap : 0;
        nw = withName ? one.name : 0;
        g2 = one.shortcut > 0 ? m.gap : 0;
        sw = one.shortcut;
        lw = Math.max(0, inner - g1 - nw - g2 - sw);
      } else {
        lw = t.label;
        nw = t.name;
        g1 = t.g1;
        g2 = t.g2;
        sw = t.shortcut;
      }
      const iconed = item.icon !== undefined;
      rows.push({
        key: `r${entries.length}`,
        caption: paramText(item.label),
        name: one.nameText,
        short: one.shortcutText,
        said: item.name === undefined || item.name === "" ? "" : paramText(`Type ${item.name}`),
        glyph: iconed ? glyphName(item.icon ?? "") : "",
        iconed,
        sub,
        open,
        down: open && input.stacked,
        off: !sub && !item.enabled,
        lit: false,
        sep: false,
        pos: Math.min(flat.at + 1, MAX_MENU_ROWS),
        count: Math.min(flat.siblings.length, MAX_MENU_ROWS),
        lw: whole(iconed ? lw - m.glyphBox : lw),
        nw: whole(nw),
        // The cell holds the shortcut and the inset left at the row's end (the chevron's box stands in it).
        sw: whole(sw + (m.padEnd - m.rowEnd)),
        g1: whole(g1),
        g2: whole(g2),
        guides,
      });
      entries.push({ key: `r${entries.length}`, item, path: flat.path, at: flat.at, siblings: flat.siblings, depth: flat.depth, column, top, height: rowH });
      top += rowH;
    }
    tallest = Math.max(tallest, top);
    return { key: `c${column}`, cw: whole(colW), rows };
  });

  // The labels are laid out at their fractional widths, as the browser lays out the SolidJS menu's.
  const outerW = whole(content + frame);
  const naturalH = tallest + frame;
  const height = input.stacked ? Math.min(naturalH, maxH) : naturalH;
  return { cols, entries, width: whole(Math.max(outerW, input.stacked ? 0 : minW)), height: Math.max(0, Math.min(Math.round(height), MAX_BOX)), content: tallest };
}

/** A length the kernel is handed: finite, at least 0, at most the box, to 1/1024 px. */
function whole(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(Math.min(value, MAX_BOX) * 1024) / 1024 : 0;
}

function blankRow(key: string): MenuRowParam {
  return { key, caption: "", name: "", short: "", said: "", glyph: "", iconed: false, sub: false, open: false, down: false, off: false, lit: false, sep: false, pos: 1, count: 1, lw: 0, nw: 0, sw: 0, g1: 0, g2: 0, guides: [] };
}

/** The columns with the rows in `lit` lit, and every other row not; the same objects where nothing changed. */
export function withLit(cols: readonly MenuColumnParam[], lit: ReadonlySet<string>): MenuColumnParam[] {
  return cols.map((col) => {
    let changed = false;
    const rows = col.rows.map((row) => {
      const on = !row.sep && lit.has(row.key);
      if (on === row.lit) return row;
      changed = true;
      return { ...row, lit: on };
    });
    return changed ? { ...col, rows } : col;
  });
}

// ---------------------------------------------------------------------------------------------
// Keys, rows and the pointer
// ---------------------------------------------------------------------------------------------

/** The longest key read (a key is a path of a few short segments). */
const MAX_KEY = 512;

/** The row a key of the scene is (`…~r12/…#row`): its item key, or null for any other node. */
export function rowOfKey(key: string): string | null {
  if (key.length > MAX_KEY || !key.endsWith("/#row")) return null;
  const at = key.lastIndexOf("~");
  if (at < 0) return null;
  const rest = key.slice(at + 1);
  const end = rest.indexOf("/");
  const item = end < 0 ? rest : rest.slice(0, end);
  return /^r\d{1,4}$/.test(item) ? item : null;
}

/** The index of a row item key (`r12` → 12); null for a key that names no row. */
export function rowIndex(itemKey: string, count: number): number | null {
  const m = /^r(\d{1,4})$/.exec(itemKey);
  if (m === null) return null;
  const index = Number(m[1]);
  return index < count ? index : null;
}

/** A solved node, as far as the menu reads one. */
export interface MenuBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The row under a point of the surface (its own px): its item key, or null over anything else or a point that is no point. */
export function rowAt(scene: readonly MenuBox[], x: number, y: number): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const node of scene) {
    if (!(x >= node.x && x < node.x + node.w && y >= node.y && y < node.y + node.h)) continue;
    const row = rowOfKey(node.key);
    if (row !== null) return row;
  }
  return null;
}

/**
 * What a row's accessible node is given beyond what the language says (SPEC §15.2 has no
 * `haspopup`, no `keyshortcuts`, and its `disabled` takes the node out of the focus ring, where a
 * row that is not available keeps its place): the attributes `Row menuitem` carries.
 */
export type RowExtras = Readonly<Record<"aria-haspopup" | "aria-disabled" | "aria-keyshortcuts", string | null>>;

export function rowExtras(item: MenuItem, mac: boolean): RowExtras {
  const sub = item.id === null;
  const keys = sub || item.shortcut === "" ? "" : ariaKeyShortcuts(shortcutLabel(item.shortcut, mac));
  return { "aria-haspopup": sub ? "menu" : null, "aria-disabled": !sub && !item.enabled ? "true" : null, "aria-keyshortcuts": keys === "" ? null : paramText(keys) };
}

/** Where a stacked menu's body is scrolled to show a group opened in place under its row (`stackedBlock`): the row's top, or the least that shows the group. */
export function groupScroll(rowTop: number, groupBottom: number, viewport: number, offset: number): number {
  const top = finite(rowTop);
  const bottom = Math.max(top, finite(groupBottom));
  const view = Math.max(0, finite(viewport));
  const now = Math.max(0, finite(offset));
  if (bottom - top > view) return top;
  if (top < now) return top;
  if (bottom > now + view) return bottom - view;
  return now;
}

export { isMacPlatform };

// ---------------------------------------------------------------------------------------------
// The glyphs
// ---------------------------------------------------------------------------------------------

/** The size a row's glyph is drawn at (`--icon-size-md`), and the submenu's chevron (`--icon-size-sm`). */
export const ROW_GLYPH_PX = 14;
export const CHEVRON_GLYPH_PX = 12;

/** Every declaration the menu needs: the chevron, then each glyph a row of the ribbon's overflow menu can carry. */
export function menuGlyphs(): RibbonGlyph[] {
  const tools = [...new Set(RIBBON_TOOLS.map((tool) => tool.icon))].map((id): RibbonGlyph => ({ name: glyphName(id), id, px: ROW_GLYPH_PX }));
  return [{ name: glyphName("chevron-right"), id: "chevron-right", px: CHEVRON_GLYPH_PX }, ...tools];
}

export function menuIconSource(): string {
  return glyphBlock(menuGlyphs());
}

/** The document with its generated block replaced by the current one; null when it has no block. */
export function withMenuIcons(source: string): string | null {
  const old = iconBlockOf(source);
  return old === null ? null : source.replace(old, () => menuIconSource());
}
