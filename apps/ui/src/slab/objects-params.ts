/**
 * The objects tree as the Slab Objects panel takes it (`slab/objects.slab`): typed scalar and
 * list params, nothing else, and the kernel's answers read back. The tree is built, filtered,
 * capped and walked by `../objects`, as for the SolidJS panel; this file only shapes what
 * `layout` returns into rows, caps it again (every string and every list handed to the kernel is
 * bounded here), and reads a pressed row, a focused key and the search's text back with checked
 * narrowing. A stale or forged answer names no row and does nothing.
 */

import { MAX_QUERY_CHARS, MAX_VISIBLE_ROWS, rowName, rowTally, selectedCount, type TreeLayout, type VisibleNode } from "../objects";
import { highlight } from "../palette";
import { paramText } from "./bench-params";

/** One run of a row's name: an `ObjectRun` of the document. */
export interface ObjectRunParam {
  key: string;
  t: string;
  /** The run is what a search matched. */
  hit: boolean;
}

/** One item of the panel's `rows` list: an `ObjectRow` of the document. */
export interface ObjectRowParam {
  /** The item's identity in the kernel: the row's id in the tree, so the keyboard stays on a row the list still has. */
  key: string;
  /** What a screen reader is told: the name, and for a group how much it holds and how much of that is selected. */
  name: string;
  /** How far the row is stepped in, in the document's units. */
  indent: number;
  group: boolean;
  opened: boolean;
  more: boolean;
  /** Every object of the row is selected on the drawing. */
  current: boolean;
  /** A group's count ("18"), or how far it is selected ("3/18"). */
  tally: string;
  depth: number;
  place: number;
  total: number;
  runs: ObjectRunParam[];
}

export interface ObjectNoteParam {
  key: string;
  note: string;
}

export interface ObjectsPanelParams {
  summary: string;
  open: boolean;
  listed: boolean;
  /** The tree has rows to show. */
  filled: boolean;
  rows: ObjectRowParam[];
  notes: ObjectNoteParam[];
}

/** The most runs one name is cut into; past it the rest of the name is one plain run. */
export const MAX_RUNS = 24;
/** The longest row key handed to the kernel; a longer id is cut and told apart by its place. */
export const MAX_KEY_CHARS = 400;
/** The deepest level a row is stepped in for (the tree has four). */
const MAX_DEPTH = 16;
const MAX_NOTES = 8;

/** What each level of the tree steps in by when the document's token cannot be read: `--gap-12` (interaction.css: `.objects-row`). */
export const DEFAULT_STEP = 12;

/** A whole number from `low` to `high`; `low` for anything else (a level, a place or a set size is hostile until checked). */
function whole(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : low;
}

/** One run of a name for the kernel: a single line, no control characters. Its spaces are kept: the runs of a name are read end to end. */
function runText(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code < 0xa0) || code === 0x2028 || code === 0x2029 ? " " : char;
  }
  return out;
}

/** A row's name as runs, the matched characters apart; capped in length and in the number of runs. */
function nameRuns(label: string, hits: readonly number[]): ObjectRunParam[] {
  // The matched places count the label's own characters: a label the cap or the cleaning changed is drawn plain.
  const text = paramText(label);
  const parts = highlight(text, text === label ? hits : []);
  const out: ObjectRunParam[] = [];
  let rest = "";
  for (const part of parts) {
    if (part.text === "") continue;
    if (out.length < MAX_RUNS - 1) out.push({ key: String(out.length), t: runText(part.text), hit: part.hit });
    else rest += part.text;
  }
  if (rest !== "") out.push({ key: String(out.length), t: runText(rest), hit: false });
  return out;
}

/** A row's id as the kernel's item key: capped, never empty, and unique among `seen`. */
function rowKey(id: string, index: number, seen: Set<string>): string {
  let key = id.length > MAX_KEY_CHARS ? `${id.slice(0, MAX_KEY_CHARS)}#${index}` : id;
  if (key === "" || seen.has(key)) key = `${key}#${index}`;
  seen.add(key);
  return key;
}

/** The rows the keyboard walks, each under the key the kernel knows it by. */
export interface KeyedRows {
  params: ObjectRowParam[];
  /** Item key to the row's place in `params` (and in the layout's `rows`). */
  index: Map<string, number>;
}

/** The layout's rows as list items, in reading order, with the drawing's selection marked. */
export function objectRowParams(rows: readonly VisibleNode[], selection: ReadonlySet<string>, step: number = DEFAULT_STEP): KeyedRows {
  const params: ObjectRowParam[] = [];
  const index = new Map<string, number>();
  const seen = new Set<string>();
  const stride = whole(step, 0, 64);
  for (const node of rows.slice(0, MAX_VISIBLE_ROWS)) {
    const at = params.length;
    const selected = node.kind === "more" ? 0 : selectedCount(node.handles, selection);
    const depth = whole(node.level, 1, MAX_DEPTH);
    const total = whole(node.siblings, 1, Number.MAX_SAFE_INTEGER);
    const key = rowKey(node.id, at, seen);
    index.set(key, at);
    params.push({
      key,
      name: paramText(rowName(node, selected)),
      indent: (depth - 1) * stride,
      group: node.kind === "group",
      opened: node.kind === "group" && node.open,
      more: node.kind === "more",
      current: node.kind !== "more" && node.handles.length > 0 && selected === node.handles.length,
      tally: paramText(rowTally(node, selected)),
      depth,
      place: whole(node.position, 1, total),
      total,
      runs: nameRuns(node.label, node.hits),
    });
  }
  return { params, index };
}

/** The panel's params: the heading, whether the tree shows, its rows and the lines under it. A folded section is its heading alone. */
export function objectsPanelParams(view: { summary: string; open: boolean; listed: boolean; notes: readonly string[]; rows: ObjectRowParam[] }): ObjectsPanelParams {
  const summary = paramText(view.summary);
  if (!view.open) return { summary, open: false, listed: false, filled: false, rows: [], notes: [] };
  return {
    summary,
    open: true,
    listed: view.listed,
    filled: view.listed && view.rows.length > 0,
    rows: view.listed ? view.rows : [],
    notes: view.notes.slice(0, MAX_NOTES).map((note, index) => ({ key: `note-${index}`, note: paramText(note) })),
  };
}

/** What the search field holds as the panel keeps it: one line, capped (the field is the page's own, but its value is still read with care). */
export function queryText(text: string): string {
  return [...runText(text)].slice(0, MAX_QUERY_CHARS).join("");
}

/**
 * The item key in a node's full key under the list `each` (the key of the `each` itself:
 * `#panel/#tree/rows`). The kernel writes `<each>~<item>/<rest>` with `%`, `/` and `~` of the
 * item's own key escaped; null when the key is not under that list.
 */
export function itemOfKey(fullKey: string, each: string): string | null {
  const head = `${each}~`;
  if (fullKey.length > MAX_KEY_CHARS * 4 || !fullKey.startsWith(head)) return null;
  const rest = fullKey.slice(head.length);
  const end = rest.indexOf("/");
  const escaped = end < 0 ? rest : rest.slice(0, end);
  if (escaped === "") return null;
  return escaped.replace(/%(25|2F|7E)/g, (_, code: string) => (code === "25" ? "%" : code === "2F" ? "/" : "~"));
}

/** Whether a press landed on a row's twist (the cell `#twist` of the row, or the glyph in it), read from the signal's hit key. */
export function onTwist(hitKey: string, each: string): boolean {
  const head = `${each}~`;
  if (hitKey.length > MAX_KEY_CHARS * 4 || !hitKey.startsWith(head)) return false;
  const rest = hitKey.slice(head.length);
  const end = rest.indexOf("/");
  return end >= 0 && rest.slice(end + 1).split("/").includes("#twist");
}

/** What a row's signal says beyond its item: where the pointer was and which modifier keys were down. */
export interface PressMeta {
  hitKey: string;
  /** Ctrl or Cmd was down: the row is added to the selection, or taken out of it. */
  additive: boolean;
}

/** The meta of a signal event, read with checked narrowing; a press from the keyboard has no hit key. */
export function pressMeta(event: Event): PressMeta {
  const none: PressMeta = { hitKey: "", additive: false };
  if (!(event instanceof CustomEvent)) return none;
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null || !("meta" in detail)) return none;
  const meta: unknown = detail.meta;
  if (typeof meta !== "object" || meta === null) return none;
  const hit: unknown = "hit_key" in meta ? meta.hit_key : "";
  const mods: unknown = "mods" in meta ? meta.mods : 0;
  // The kernel's modifier bits: 1 shift, 2 alt, 4 ctrl, 8 meta.
  return { hitKey: typeof hit === "string" ? hit : "", additive: typeof mods === "number" && Number.isFinite(mods) && (mods & 12) !== 0 };
}

/**
 * The height the section asks the rail for: its heading, its search, every row of the tree and
 * the lines under it. The rail caps it (two fifths, as the SolidJS section) and the tree scrolls
 * in what it is given. Never negative, never more than a page's worth of the capped list.
 */
export function naturalHeight(parts: { head: number; search: number; notes: number; rows: number; rowHeight: number; pad: number }): number {
  const part = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
  const rows = whole(parts.rows, 0, MAX_VISIBLE_ROWS);
  // The tree's own inset (above and below its rows) is there only while the tree is.
  const tree = rows === 0 ? 0 : rows * Math.min(part(parts.rowHeight), 64) + 2 * Math.min(part(parts.pad), 64);
  return Math.ceil(part(parts.head) + part(parts.search) + part(parts.notes) + tree);
}

/** The most rows of the driver's accessibility layer put back in reading order in one frame (the list's window is a few dozen). */
export const MAX_ORDERED = 128;

/**
 * The places of `tops` (each row's distance from the top of the tree) in reading order, top
 * first; null when they already are, when there are too many to be the list's window, or when
 * one is not a number. Rows at one height keep the order they have.
 */
export function readingOrder(tops: readonly number[]): number[] | null {
  if (tops.length < 2 || tops.length > MAX_ORDERED || tops.some((top) => !Number.isFinite(top))) return null;
  if (tops.every((top, at) => at === 0 || (tops[at - 1] ?? top) <= top)) return null;
  return tops.map((_, at) => at).sort((a, b) => (tops[a] ?? 0) - (tops[b] ?? 0) || a - b);
}

/** The layout's row a key names; null when the list no longer has it. */
export function rowOfKey(drawn: TreeLayout, keyed: KeyedRows, key: string | null): VisibleNode | null {
  if (key === null) return null;
  const at = keyed.index.get(key);
  return at === undefined ? null : (drawn.rows[at] ?? null);
}
