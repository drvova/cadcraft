/**
 * The command palette as the Slab palette takes it (`slab/palette.slab`): typed scalar and list
 * params, nothing else, and the arithmetic of a list whose rows are all one height. What matches
 * and in what order is `../palette`'s and which row is lit `../palette-model`'s, as for the
 * SolidJS palette; this file only shapes the matches into rows (every string handed to the
 * kernel is one line and capped, every key unique and bounded), and works out the list's room,
 * where a key moves it, and which row a point of the surface is over. Hostile numbers (not
 * finite, negative) read as 0 or as nothing.
 */

import { highlight, rowName, type PaletteMatch } from "../palette";
import { paramText } from "./bench-params";

/** One run of a label: a `PaletteRun` of the document. */
export interface PaletteRunParam {
  key: string;
  t: string;
  hit: boolean;
  /** The command cannot run: the disabled ink. */
  off: boolean;
}

/** One item of the `rows` list: a `PaletteRow` of the document. */
export interface PaletteRowParam {
  /** The command's id (capped, unique): the row keeps its key, and so its state, while the list changes under it. */
  key: string;
  path: string;
  placed: boolean;
  /** "recently used" or "other commands", where the two groups of an empty query start. */
  tag: string;
  tagged: boolean;
  /** "not available". */
  tag2: string;
  tagged2: boolean;
  /** The name typed at the command line, or the alias that matched. */
  name: string;
  named: boolean;
  /** The shortcut as the platform writes it. */
  shortcut: string;
  keyed: boolean;
  off: boolean;
  runs: PaletteRunParam[];
}

export interface PaletteParams {
  rows: PaletteRowParam[];
  filled: boolean;
  query: string;
  status: string;
  narrow: boolean;
  list_max: number;
}

export const PALETTE_SCALARS = ["filled", "query", "status", "narrow", "list_max"] as const;

/** The row's height and the list's inset, in px (`--control-h-row`, `--gap-4`; the document's `item-extent`). */
export const ROW_H = 22;
export const LIST_PAD = 4;
/** The most runs one label is cut into; past it the rest is one plain run. */
export const MAX_RUNS = 24;
/** The longest row key handed to the kernel; a longer id is cut and told apart by its place. */
export const MAX_KEY_CHARS = 200;
/** The most rows handed to the kernel (the registry has about five hundred). */
export const MAX_ROWS = 4000;
/** The window under which the foot names no keys (palette.css: `max-width: 560px`). */
export const NARROW_MAX = 560;

const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

/** One run for the kernel: a single line, its spaces kept (the runs of a label are read end to end). */
function runText(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code < 0xa0) || code === 0x2028 || code === 0x2029 ? " " : char;
  }
  return out;
}

/** A label as runs, the matched letters apart; a label the cap or the cleaning changed is drawn plain. */
export function labelRuns(label: string, hits: readonly number[], off: boolean): PaletteRunParam[] {
  const text = paramText(label);
  const parts = highlight(text, text === label ? hits : []);
  const out: PaletteRunParam[] = [];
  let rest = "";
  for (const part of parts) {
    if (part.text === "") continue;
    if (out.length < MAX_RUNS - 1) out.push({ key: String(out.length), t: runText(part.text), hit: part.hit, off });
    else rest += part.text;
  }
  if (rest !== "") out.push({ key: String(out.length), t: runText(rest), hit: false, off });
  return out;
}

/** A command's id as the kernel's item key: capped, never empty, unique among `seen`. */
function rowKey(id: string, index: number, seen: Set<string>): string {
  let key = id.length > MAX_KEY_CHARS ? `${id.slice(0, MAX_KEY_CHARS)}#${index}` : id;
  if (key === "" || seen.has(key)) key = `${key}#${index}`;
  seen.add(key);
  return key;
}

/**
 * The matches as rows, in order. `recentCount` is how many of the first rows are the recently
 * used ones (0 once something is typed), as the SolidJS list tags them; `label` writes a
 * shortcut for the platform.
 */
export function paletteRows(matches: readonly PaletteMatch[], recentCount: number, label: (shortcut: string) => string): PaletteRowParam[] {
  const recent = Math.max(0, Math.floor(finite(recentCount)));
  const seen = new Set<string>();
  const rows: PaletteRowParam[] = [];
  for (const [index, match] of matches.slice(0, MAX_ROWS).entries()) {
    const { item } = match;
    const off = !item.enabled;
    const tag = recent > 0 && index === 0 ? "recently used" : recent > 0 && index === recent ? "other commands" : "";
    const name = paramText(rowName(match));
    const shortcut = item.shortcut === "" ? "" : paramText(label(item.shortcut));
    const path = paramText(item.path);
    rows.push({
      key: rowKey(item.id, index, seen),
      path,
      placed: path !== "",
      tag,
      tagged: tag !== "",
      tag2: off ? "not available" : "",
      tagged2: off,
      name,
      named: name !== "",
      shortcut,
      keyed: shortcut !== "",
      off,
      runs: labelRuns(item.label, match.indices, off),
    });
  }
  return rows;
}

/**
 * The most the list may be tall in a window `height` high: the box's cap (three fifths of the
 * window, and never past the dialog's padded area) less the field, the foot, their hairlines and
 * the list's inset, rounded down to whole rows, with the inset back (palette.css: `.palette-list`).
 */
export function listMax(height: number, row: number = ROW_H): number {
  const h = Math.max(0, finite(height));
  const r = Math.max(1, finite(row));
  const room = Math.min(h * 0.6, h - 6 - 8) - 35 - 28 - 2 - 2 * LIST_PAD;
  return Math.max(0, Math.floor(room / r) * r) + 2 * LIST_PAD;
}

/** How tall the list is with `count` rows: its rows and inset, no more than `max`; 0 with none. */
export function listHeight(count: number, max: number): number {
  const n = Math.max(0, Math.floor(finite(count)));
  return n === 0 ? 0 : Math.min(Math.max(0, finite(max)), n * ROW_H + 2 * LIST_PAD);
}

/** How many rows a page key moves in a list `viewport` tall: the rows it shows, less one kept for context. */
export function pageRows(viewport: number): number {
  const rows = Math.floor(Math.max(0, finite(viewport)) / ROW_H);
  return rows > 0 ? Math.max(1, rows - 1) : 10;
}

/**
 * The list's offset that brings row `index` into view from `offset`, with one row of context past
 * it (palette.css: `scroll-padding-block`); the first row takes the list to its top, the last to
 * its end. The offset is clamped to what the list can scroll.
 */
export function followOffset(offset: number, index: number, count: number, viewport: number): number {
  const n = Math.max(0, Math.floor(finite(count)));
  const vp = Math.max(0, finite(viewport));
  const most = Math.max(0, n * ROW_H + 2 * LIST_PAD - vp);
  const at = Math.floor(finite(index));
  if (n === 0 || at <= 0) return 0;
  if (at >= n - 1) return most;
  const context = ROW_H + LIST_PAD;
  const top = LIST_PAD + at * ROW_H;
  let next = Math.min(most, Math.max(0, finite(offset)));
  if (top - context < next) next = top - context;
  else if (top + ROW_H + context > next + vp) next = top + ROW_H + context - vp;
  return Math.min(most, Math.max(0, next));
}

/**
 * The row under a point of the list (`x`, `y` from its top-left corner, in px), with the list
 * scrolled by `offset` and `width` wide; -1 over the inset, past the last row or outside.
 */
export function rowAt(x: number, y: number, offset: number, width: number, viewport: number, count: number): number {
  if (![x, y, offset, width, viewport].every(Number.isFinite)) return -1;
  if (x < LIST_PAD || x >= width - LIST_PAD || y < 0 || y >= viewport) return -1;
  const inside = y + Math.max(0, offset) - LIST_PAD;
  if (inside < 0) return -1;
  const index = Math.floor(inside / ROW_H);
  return index < Math.max(0, Math.floor(finite(count))) ? index : -1;
}

/** The window of rows the field's listbox holds for a screen reader: the lit one and `reach` each side. */
export function mirrorWindow(active: number, count: number, reach: number): { from: number; to: number } {
  const n = Math.max(0, Math.floor(finite(count)));
  const r = Math.max(0, Math.floor(finite(reach)));
  const at = Math.min(Math.max(0, Math.floor(finite(active))), Math.max(0, n - 1));
  const from = Math.max(0, Math.min(at - r, n - 2 * r - 1));
  return { from, to: Math.min(n, from + 2 * r + 1) };
}
