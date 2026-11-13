/**
 * The Layer Properties Manager as the Slab body takes it (`slab/layer-manager.slab`): typed scalar
 * and list params, the glyphs the document declares, and the kernel's answers read back with
 * checked narrowing. The rows, their order, the selection and the active cell are
 * `../layer-manager-edit`'s, as for the SolidJS dialog; this file only shapes them, caps every
 * string handed to the kernel, and reads a pressed cell or a key event back. A stale or forged
 * answer names no cell and does nothing.
 */

import { COLUMNS, NAME_COLUMN, type ChoiceKey, type FlagKey, type TextKey } from "../layer-manager-edit";
import {
  ariaSort,
  countText,
  LAYER_COLOR_CHOICES,
  LAYER_LINEWEIGHT_CHOICES,
  LAYER_TRANSPARENCY_CHOICES,
  quoted,
  shownName,
  windowOf,
  type GridCell,
  type LayerRow,
  type Sort,
  type Verdict,
} from "../layer-manager";
import { paramText } from "./bench-params";
import { slabRgb, type LayerInks } from "./layers-params";
import type { PopupOption } from "./popup";
import { glyphBlock, glyphName, iconBlockOf, type RibbonGlyph } from "./ribbon-icons";

// ---------------------------------------------------------------------------------------------
// The glyphs
// ---------------------------------------------------------------------------------------------

/** The size every glyph of the grid is drawn at (`--icon-size-sm`). */
export const LM_GLYPH_PX = 12;

/** The ids of `icons.ts` the document draws: the marks, the sort caret, and each flag's two faces. */
export const LM_ICON_IDS: readonly string[] = ["chevron-right", "chevron-down", "layer.on", "layer.off", "layer.frozen", "layer.thawed", "layer.locked", "layer.unlocked", "plot", "close"];

export function layerManagerGlyphs(): RibbonGlyph[] {
  return LM_ICON_IDS.map((id) => ({ name: glyphName(id), id, px: LM_GLYPH_PX }));
}

export function layerManagerIconSource(): string {
  return glyphBlock(layerManagerGlyphs());
}

/** The document with its generated block replaced by the current one; null when it has no block. */
export function withLayerManagerIcons(source: string): string | null {
  const old = iconBlockOf(source);
  return old === null ? null : source.replace(old, () => layerManagerIconSource());
}

// ---------------------------------------------------------------------------------------------
// The document's keys and signals
// ---------------------------------------------------------------------------------------------

/** The box the grid scrolls sideways in: its window. */
export const FRAME_KEY = "#lm/#frame/#pane";
/** The grid: the one node of the body the keyboard stands on. */
export const GRID_KEY = "#lm/#frame/#pane/#grid";
/** The rows' list. */
export const ROWS_EACH = `${GRID_KEY}/rows`;
/** The headings' list. */
export const HEADS_EACH = `${GRID_KEY}/#top/#heads/each@0`;

export const LM_SIGNALS = ["bar_press", "grid_press", "grid_double", "clear_filter"] as const;
export const LM_SCALARS = ["count", "grid_w", "find_w", "view_h", "above", "below", "active", "grid_said", "empty", "empty_said", "filtered", "refused", "refusal"] as const;
export const LM_LISTS = ["keys", "heads", "rows"] as const;

/** The columns' least widths, in the document's units (`lm.*` tokens): the grid is never narrower. */
export const LM_COLUMN_MIN: readonly number[] = [32, 130, 28, 28, 28, 28, 114, 114, 94, 71, 97];
export const LM_GRID_MIN = LM_COLUMN_MIN.reduce((sum, width) => sum + width, 0);

/** A row's height and the heading's (`size.control-h-row`, `size.control-h-input` and its hairline). */
export const LM_ROW_H = 22;
export const LM_HEAD_H = 25;
/** The frame at most twenty rows tall, and at most half the window (`.lm-scroll`). */
export const LM_ROWS_SHOWN = 20;

/** The frame's height for a window this tall. */
export function viewHeight(windowHeight: number): number {
  const half = Number.isFinite(windowHeight) && windowHeight > 0 ? Math.floor(windowHeight / 2) : LM_ROWS_SHOWN * LM_ROW_H;
  return Math.max(LM_HEAD_H + LM_ROW_H, Math.min(LM_ROWS_SHOWN * LM_ROW_H, half));
}

/** The grid's width in a frame this wide: the frame's, and never less than the columns' (2 for the frame's hairlines). */
export function gridWidth(frameWidth: number): number {
  return Math.max(LM_GRID_MIN, Number.isFinite(frameWidth) ? Math.floor(frameWidth) - 2 : 0);
}

/** The bar's keys, whose width the filter's line is worked out from. */
export const ACTIONS_KEY = "#lm/#bar/#actions";

/** The least width of the filter and its count on the keys' line (`.lm-find`: 24ch); less, and they take a line of their own. */
export const FIND_MIN = 195;

/**
 * The width of the filter's part of the bar: what the keys leave on their line (the gap between
 * them taken off), or the whole line when that is less than its least, so it wraps under them and
 * ends on the bar's end, as `.lm-find` does.
 */
export function findWidth(barWidth: number, actionsWidth: number, gap: number): number {
  const bar = Number.isFinite(barWidth) && barWidth > 0 ? Math.floor(barWidth) : 0;
  const left = bar - (Number.isFinite(actionsWidth) && actionsWidth > 0 ? Math.ceil(actionsWidth) : 0) - (Number.isFinite(gap) && gap > 0 ? gap : 0);
  return left >= FIND_MIN ? left : Math.max(FIND_MIN, bar);
}

/** How many rows a page key moves: the rows in view, less one to keep the place (as the SolidJS grid). */
export function pageRows(viewH: number): number {
  return Math.max(1, Math.floor((viewH - LM_HEAD_H) / LM_ROW_H) - 1);
}

/** The most rows handed to the kernel (the engine's own cap: `MAX_LAYERS`). */
export const MAX_LM_ROWS = 20000;

const rowKey = (index: number): string => `r-${index}`;
const headKey = (index: number): string => `h-${index}`;

/** The full key of a cell: a heading (row -1) or a row's. */
export function cellKey(cell: GridCell): string {
  if (cell.row < 0) return `${HEADS_EACH}~${headKey(cell.column)}/#head`;
  return `${ROWS_EACH}~${rowKey(cell.row)}/#row/#c${cell.column}`;
}

/**
 * The cell a node of the solved scene stands in, from its full key: a row's cell (`…/rows~r-4/#row/#c6/…`)
 * or a heading (`…/each@0~h-3/…`). Null for anything else (the grid's own box, its scrollbar, a
 * stale or forged key).
 */
export function cellOfKey(key: string): GridCell | null {
  if (typeof key !== "string" || key.length > 400) return null;
  if (key.startsWith(`${ROWS_EACH}~`)) {
    const m = /^~r-(\d{1,5})\/#row\/#c(\d{1,2})(?:\/|$)/.exec(key.slice(ROWS_EACH.length));
    if (m === null) return null;
    const row = Number(m[1]);
    const column = Number(m[2]);
    return row < MAX_LM_ROWS && column < COLUMNS.length ? { row, column } : null;
  }
  if (key.startsWith(`${HEADS_EACH}~`)) {
    const m = /^~h-(\d{1,2})(?:\/|$)/.exec(key.slice(HEADS_EACH.length));
    if (m === null) return null;
    const column = Number(m[1]);
    return column < COLUMNS.length ? { row: -1, column } : null;
  }
  return null;
}

/** What a pointer signal says beyond its item: where it landed and which modifier keys were held. */
export interface GridPress {
  cell: GridCell | null;
  toggle: boolean;
  range: boolean;
}

/** A signal event's pointer metadata, read with checked narrowing; a press from the keyboard has no hit key. */
export function gridPress(event: Event): GridPress {
  const none: GridPress = { cell: null, toggle: false, range: false };
  if (!(event instanceof CustomEvent)) return none;
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null || !("meta" in detail)) return none;
  const meta: unknown = detail.meta;
  if (typeof meta !== "object" || meta === null) return none;
  const hit: unknown = "hit_key" in meta ? meta.hit_key : "";
  const raw: unknown = "mods" in meta ? meta.mods : 0;
  // The kernel's modifier bits: 1 shift, 2 alt, 4 ctrl, 8 meta.
  const mods = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  return { cell: typeof hit === "string" ? cellOfKey(hit) : null, toggle: (mods & 12) !== 0, range: (mods & 1) !== 0 };
}

// ---------------------------------------------------------------------------------------------
// What the grid draws
// ---------------------------------------------------------------------------------------------

/** One heading: an `LmHead` of the document. */
export interface LmHeadParam {
  key: string;
  name: string;
  hint: string;
  word: string;
  glyph: string;
  cw: number;
  worded: boolean;
  wide: boolean;
  flag: boolean;
  status: boolean;
  sorted: boolean;
  up: boolean;
  ring: boolean;
}

/** One row: an `LmRow` of the document. */
export interface LmRowParam {
  key: string;
  name: string;
  said: string;
  picked: boolean;
  current: boolean;
  used: boolean;
  refused: boolean;
  typing: boolean;
  noting: boolean;
  hot: boolean;
  status: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  plot: boolean;
  on_name: string;
  frozen_name: string;
  locked_name: string;
  plot_name: string;
  off_ink: string;
  frozen_ink: string;
  locked_ink: string;
  tone: string;
  tone_name: string;
  hue: string;
  linetype: string;
  lineweight: string;
  clear: string;
  note: string;
  color_said: string;
  linetype_said: string;
  lineweight_said: string;
  clear_said: string;
  note_said: string;
  a0: boolean;
  a1: boolean;
  a2: boolean;
  a3: boolean;
  a4: boolean;
  a5: boolean;
  a6: boolean;
  a7: boolean;
  a8: boolean;
  a9: boolean;
  a10: boolean;
}

/** One key of the bar: an `LmKey` of the document. */
export interface LmKeyParam {
  key: string;
  name: string;
  why: string;
  off: boolean;
}

/** What the bar's keys run. */
export type BarKey = "new" | "rename" | "delete" | "current";
const BAR_KEYS: readonly BarKey[] = ["new", "rename", "delete", "current"];

export function isBarKey(value: string): value is BarKey {
  return (BAR_KEYS as readonly string[]).includes(value);
}

/** The bar's four keys, with what stops each (the SolidJS buttons' `disabled` and `title`). */
export function keyParams(view: { renamable: boolean; removable: Verdict; currentable: Verdict }): LmKeyParam[] {
  const why = (verdict: Verdict): string => (verdict.allowed ? "" : paramText(verdict.reason));
  return [
    { key: "new", name: "New layer", why: "", off: false },
    { key: "rename", name: "Rename", why: view.renamable ? "F2" : "Select one layer to rename", off: !view.renamable },
    { key: "delete", name: "Delete", why: why(view.removable), off: !view.removable.allowed },
    { key: "current", name: "Set current", why: why(view.currentable), off: !view.currentable.allowed },
  ];
}

/** The eleven headings for an order and the cell the keyboard is on (`ring`: it is shown). */
export function headParams(sort: Sort, active: GridCell, ring: boolean): LmHeadParam[] {
  return COLUMNS.map((column, index): LmHeadParam => {
    const said = ariaSort(sort, column.key);
    return {
      key: headKey(index),
      name: column.label,
      hint: column.kind === "status" ? "The current layer, then layers with objects. Press to sort" : `Sort by ${column.label}`,
      word: column.short ?? column.label,
      glyph: column.icon === undefined ? "" : glyphName(column.icon),
      cw: LM_COLUMN_MIN[index] ?? 0,
      worded: column.kind !== "flag" && column.kind !== "status",
      wide: column.kind === "name",
      flag: column.kind === "flag",
      status: column.kind === "status",
      sorted: said !== "none",
      up: said === "ascending",
      ring: ring && active.row === -1 && active.column === index,
    };
  });
}

/** What the host knows of a row beyond the layer itself. */
export interface RowView {
  selected: ReadonlySet<string>;
  active: GridCell;
  /** The keyboard's ring is shown (the grid has the keyboard, and a key moved it). */
  ring: boolean;
  refusals: ReadonlyMap<string, string>;
  editing: { name: string; key: TextKey } | null;
  inks: LayerInks;
}

const FLAG_WORDS: Readonly<Record<FlagKey, string>> = { on: "on", frozen: "frozen", locked: "locked", plot: "plotted" };

/** The rows handed to the kernel (places in the order shown, both ends in) and the room the others take. */
export interface RowSpan {
  first: number;
  last: number;
}

export interface RowWindow extends RowSpan {
  above: number;
  below: number;
}

/** The rows drawn past each edge of the viewport (the SolidJS grid draws 8: here every row drawn
 *  costs the driver a few dozen nodes to lay out, paint and mirror on each frame). */
export const LM_OVERSCAN = 4;

/**
 * The rows handed to the kernel for a scroll position of the grid (`scrollTop`, its window's
 * height `viewH` with the heading in it): the ones in view and `LM_OVERSCAN` more each side
 * (`windowOf`, the SolidJS grid's own), and the room the rows before and after them take.
 */
export function rowWindow(scrollTop: number, viewH: number, count: number): RowWindow {
  const rows = Math.max(0, Math.min(MAX_LM_ROWS, Number.isFinite(count) ? Math.floor(count) : 0));
  if (rows === 0) return { first: 0, last: -1, above: 0, below: 0 };
  const span = windowOf(scrollTop, Math.max(0, viewH - LM_HEAD_H), LM_ROW_H, rows, LM_OVERSCAN);
  return { first: span.first, last: span.last, above: span.first * LM_ROW_H, below: (rows - 1 - span.last) * LM_ROW_H };
}

/**
 * The grid's scroll offset that brings a row into view with the least move, clear of the sticky
 * heading; the offset it has when the row is already in view. `viewH` is the grid's window.
 */
export function revealOffset(row: number, scrollTop: number, viewH: number): number {
  const at = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  if (!Number.isInteger(row) || row < 0) return at;
  const top = LM_HEAD_H + row * LM_ROW_H;
  const bottom = top + LM_ROW_H;
  if (top - LM_HEAD_H < at) return top - LM_HEAD_H;
  const height = Number.isFinite(viewH) ? viewH : 0;
  if (bottom > at + height) return Math.max(0, bottom - height);
  return at;
}

/** The rows as the grid draws them, in the order shown. */
export function rowParams(rows: readonly LayerRow[], view: RowView, span: RowSpan = { first: 0, last: rows.length - 1 }): LmRowParam[] {
  const out: LmRowParam[] = [];
  const end = Math.min(rows.length - 1, MAX_LM_ROWS - 1, span.last);
  for (let index = Math.max(0, span.first); index <= end; index++) {
    const row = rows[index];
    if (row === undefined) continue;
    const shown = paramText(shownName(row.name));
    const refusal = view.refusals.size > 0 ? view.refusals.get(row.name) : undefined;
    const here = view.active.row === index;
    const ring = (column: number): boolean => view.ring && here && view.active.column === column;
    const flagName = (flag: FlagKey): string => paramText(`${shownName(row.name)} ${FLAG_WORDS[flag]}`);
    const clear = `${row.transparency}%`;
    out.push({
      key: rowKey(index),
      name: shown,
      said: paramText([row.current ? "Current layer" : "", refusal === undefined ? "" : `Not changed: ${refusal}`].filter((part) => part !== "").join(". ")),
      picked: view.selected.has(row.name),
      current: row.current,
      used: row.used,
      refused: refusal !== undefined,
      typing: view.editing !== null && view.editing.key === "name" && view.editing.name === row.name,
      noting: view.editing !== null && view.editing.key === "description" && view.editing.name === row.name,
      hot: here,
      status: `${row.current ? "Current layer. " : ""}${row.used ? "Has objects" : "No objects"}`,
      on: row.on,
      frozen: row.frozen,
      locked: row.locked,
      plot: row.plot,
      on_name: flagName("on"),
      frozen_name: flagName("frozen"),
      locked_name: flagName("locked"),
      plot_name: flagName("plot"),
      off_ink: view.inks.off,
      frozen_ink: view.inks.frozen,
      locked_ink: view.inks.locked,
      tone: slabRgb(row.colorRgb),
      tone_name: paramText(`${row.colorName}, RGB ${row.colorRgb.join(", ")}`),
      hue: paramText(row.colorName),
      linetype: paramText(row.linetype),
      lineweight: paramText(row.lineweight),
      clear,
      note: paramText(row.description),
      color_said: paramText(`Color ${row.colorName}`),
      linetype_said: paramText(`Linetype ${row.linetype}`),
      lineweight_said: paramText(`Lineweight ${row.lineweight}`),
      clear_said: `Transparency ${clear}`,
      note_said: paramText(row.description === "" ? "No description" : row.description),
      a0: ring(0),
      a1: ring(1),
      a2: ring(2),
      a3: ring(3),
      a4: ring(4),
      a5: ring(5),
      a6: ring(6),
      a7: ring(7),
      a8: ring(8),
      a9: ring(9),
      a10: ring(10),
    });
  }
  return out;
}

/** The line under the grid: what the engine refused in the last change, each in its own words. */
export function refusalLine(refusals: ReadonlyMap<string, string>): string {
  return unisolated(spokenRefusal(refusals));
}

/**
 * A sentence with the direction isolates `quoted` puts round a name taken out: the kernel draws a
 * character it has no advance for as a blank box, and a Slab surface lays its text out left to
 * right whatever it holds (the page's hidden copy of the words keeps them).
 */
export function unisolated(text: string): string {
  return text.replace(/[\u2066-\u2069]/g, "");
}

/** The refusals in the words the page reads out (the field's description). */
export function spokenRefusal(refusals: ReadonlyMap<string, string>): string {
  const all = [...refusals.entries()];
  const first = all[0];
  if (first === undefined) return "";
  if (all.length === 1) return paramText(`${quoted(first[0])} was not changed. ${first[1]}`);
  const listed = all.slice(0, 3).map(([name, message]) => `${quoted(name)}: ${message}`);
  const rest = all.length - listed.length;
  return paramText(`${all.length} layers were not changed. ${listed.join(" ")}${rest > 0 ? ` And ${rest} more.` : ""}`);
}

/** The words where the grid has no row to show. */
export function emptyText(total: number, filter: string): string {
  return total > 0 ? unisolated(paramText(`No layer's name matches ${quoted(filter.trim())}.`)) : "The drawing has no layers to show.";
}

/** The count beside the filter. */
export function countLine(shown: number, total: number): string {
  return countText(shown, total);
}

// ---------------------------------------------------------------------------------------------
// The choices
// ---------------------------------------------------------------------------------------------

/** The kind of choice a column holds; null for a column that holds none. */
export function choiceOf(column: number): ChoiceKey | null {
  const kind = COLUMNS[column];
  return kind !== undefined && kind.kind === "choice" ? (kind.key as ChoiceKey) : null;
}

/** The popup a choice cell opens: its name, its values and the one the row holds (the SolidJS `Select`s' options). */
export function choicePopup(choice: ChoiceKey, row: LayerRow, linetypes: readonly string[]): { label: string; options: PopupOption[]; held: string } {
  const name = shownName(row.name);
  switch (choice) {
    case "color":
      return { label: `${name} color`, options: LAYER_COLOR_CHOICES.map((value) => ({ value, label: value })), held: row.colorName };
    case "linetype":
      return { label: `${name} linetype`, options: linetypes.map((value) => ({ value, label: value })), held: row.linetype };
    case "lineweight":
      return { label: `${name} lineweight`, options: LAYER_LINEWEIGHT_CHOICES.map((value) => ({ value, label: value })), held: row.lineweight };
    case "transparency":
      return { label: `${name} transparency`, options: LAYER_TRANSPARENCY_CHOICES.map((percent) => ({ value: String(percent), label: `${percent}%` })), held: String(row.transparency) };
  }
}

/** The change a picked value makes; null for a value the list does not hold. */
export function choicePatch(choice: ChoiceKey, value: string): { color: string } | { linetype: string } | { lineweight: string } | { transparency: number } | null {
  switch (choice) {
    case "color":
      return LAYER_COLOR_CHOICES.includes(value) ? { color: value } : null;
    case "linetype":
      return value === "" || value.length > 255 ? null : { linetype: value };
    case "lineweight":
      return LAYER_LINEWEIGHT_CHOICES.includes(value) ? { lineweight: value } : null;
    case "transparency": {
      const percent = Number(value);
      return LAYER_TRANSPARENCY_CHOICES.includes(percent) ? { transparency: percent } : null;
    }
  }
}

/** The cell of a layer's name or description being typed in, in the order shown; null when it is not shown. */
export function editCell(order: readonly string[], editing: { name: string; key: TextKey } | null): GridCell | null {
  if (editing === null) return null;
  const row = order.indexOf(editing.name);
  return row < 0 ? null : { row, column: editing.key === "name" ? NAME_COLUMN : COLUMNS.length - 1 };
}

// ---------------------------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------------------------

/** What of a key event the rule reads. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** The keys the kernel would act on from the grid (walk its ring, activate, scroll): never let through. */
const KERNEL_KEYS: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter", " ", "Delete", "Backspace", "F2"]);

/**
 * Whether a key on the grid is kept from the kernel (and the window) even when the grid's own
 * handler did nothing with it: the kernel would walk its focus ring to the bar's keys by an arrow,
 * press the grid by Enter or Space, or scroll by a page key, none of which the SolidJS grid does.
 * Tab and Escape are the frame's (`./modal`); a function key or a chord is the shell's, as it is
 * from the SolidJS grid.
 */
export function gridKeepsKey(e: KeyLike): boolean {
  if (e.key === "Tab" || e.key === "Escape") return false;
  if (KERNEL_KEYS.has(e.key)) return true;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return [...e.key].length === 1;
}

// ---------------------------------------------------------------------------------------------
// The field laid over a cell
// ---------------------------------------------------------------------------------------------

/** A box of the solved scene, in the surface's coordinates. */
export interface SceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the field stands: the cell's box, and how much of it the grid's window cuts off each side. */
export interface EditPlace {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The insets of the part that shows (top, right, bottom, left); all of it is cut when the cell is out of view. */
  clip: [number, number, number, number];
}

/**
 * The field over the cell being typed in: the cell's box, cut to the grid's window under its
 * heading, so a row scrolled under the heading or out of the frame takes its field with it (the
 * field keeps the keyboard). Null when a box is not a box.
 */
export function editPlace(cell: SceneRect, grid: SceneRect, headHeight: number): EditPlace | null {
  const ok = (n: number): boolean => Number.isFinite(n);
  if (![cell.x, cell.y, cell.w, cell.h, grid.x, grid.y, grid.w, grid.h, headHeight].every(ok) || cell.w <= 0 || cell.h <= 0) return null;
  const top = Math.max(0, grid.y + headHeight - cell.y);
  const left = Math.max(0, grid.x - cell.x);
  const right = Math.max(0, cell.x + cell.w - (grid.x + grid.w));
  const bottom = Math.max(0, cell.y + cell.h - (grid.y + grid.h));
  const gone = top >= cell.h || bottom >= cell.h || left >= cell.w || right >= cell.w;
  const clip: [number, number, number, number] = gone ? [cell.h, 0, 0, 0] : [top, right, bottom, left];
  return { left: cell.x, top: cell.y, width: cell.w, height: cell.h, clip };
}

/** The field's place as CSS, in px. */
export function editStyle(place: EditPlace): Record<string, string> {
  const [t, r, b, l] = place.clip;
  return { left: `${place.left}px`, top: `${place.top}px`, width: `${place.width}px`, height: `${place.height}px`, "clip-path": `inset(${t}px ${r}px ${b}px ${l}px)` };
}
