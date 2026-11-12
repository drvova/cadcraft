/**
 * The Layer Properties Manager's pure logic: the engine's layer list into the table's rows, the
 * order and the filter the table shows them in, the selection, what may be done to a selection
 * (and why not, in words), and the engine calls each change is made of. No JSX and no DOM here:
 * the tests drive all of it, and `components/LayerManager.tsx` only draws what this decides.
 *
 * The engine's commands (`crates/engine/src/cmd/layer.rs`):
 *   - `layer` `{}` lists every layer with its flags, colour, linetype, lineweight, transparency
 *     and description, whether it is current and whether anything is drawn on it;
 *   - `layer.set` `{name, on?, frozen?, locked?, plot?, color?, linetype?, lineweight?,
 *     transparency?, description?, newName?}` changes one layer, and a refused call changes
 *     nothing and records no undo step;
 *   - `layer.new` `{name}`, `layer.delete` `{name}`, `layer.current` `{name}`;
 *   - `drawing.inspect` `{entities: false}` answers with the names of the linetypes the drawing
 *     has loaded, and records nothing (`linetype` `{}` lists them too, but it is recorded as an
 *     undo step of its own, so a dialog that only looked would leave something to undo).
 * `layer.set` takes one layer, so a change to several is one call each. They are put between
 * `undo {mode: "begin"}` and `undo {mode: "end"}` so one Undo takes the whole change back.
 *
 * The engine is the judge of a name (`valid_name`), of a colour and of a linetype: nothing here
 * repeats its rules. The only name refused before it is asked is one with nothing in it.
 *
 * Names come from drawings, so they are hostile: a row's name may be empty, 300 characters long,
 * hold control characters, or differ from another's only in case. A row is known by its exact
 * name; `shownName` is what the table draws for one that would otherwise draw as nothing.
 */

import { parseLayers, type Envelope, type LayerInfo } from "./facade";
import { asNumber, asString, isRecord } from "./json";
import { COLOR_CHOICES, LINEWEIGHT_CHOICES } from "./props";

/** One row of the table: the facade's layer row and the transparency the engine reports with it. */
export interface LayerRow extends LayerInfo {
  /** Percent, 0 (opaque) to 90: the engine's range. */
  transparency: number;
}

/** What the manager needs of the engine: `AppFacade` is one. */
export interface LayerEngine {
  execute(command: string, params?: unknown): Envelope;
}

/** One call the manager makes. */
export interface LayerCall {
  command: string;
  params: Record<string, unknown>;
  /** The layer the call is about: a refusal is shown on its row. Absent on the undo group's two calls. */
  layer?: string;
}

/** A layer the engine refused to change, and its reason in the engine's words. */
export interface LayerRefusal {
  layer: string;
  message: string;
}

/** The most rows the table takes from one reply: a drawing with more is cut here, never looped over. */
export const MAX_LAYERS = 20000;

/** The engine's highest transparency. */
export const MAX_TRANSPARENCY = 90;

/**
 * The engine's `layer` result into rows. `parseLayers` is the one reading of a layer; this adds
 * the transparency the facade's row leaves out, read from the same record. Never throws.
 */
export function parseRows(result: unknown): LayerRow[] {
  const base = parseLayers(result);
  const raw = isRecord(result) && Array.isArray(result["layers"]) ? result["layers"] : [];
  // The same records `parseLayers` kept, in its order: one with a string name.
  const kept = raw.filter((row) => isRecord(row) && asString(row["name"]) !== null);
  const out: LayerRow[] = [];
  for (let i = 0; i < base.length && i < MAX_LAYERS; i++) {
    const layer = base[i];
    const record = kept[i];
    if (layer === undefined) continue;
    const percent = isRecord(record) ? asNumber(record["transparency"]) : null;
    out.push({ ...layer, transparency: percent === null ? 0 : Math.min(MAX_TRANSPARENCY, Math.max(0, Math.round(percent))) });
  }
  return out;
}

/** The drawing's layers, as the engine holds them now. An engine that will not answer has none. */
export function readRows(engine: LayerEngine): LayerRow[] {
  const reply = engine.execute("layer", {});
  return reply.ok ? parseRows(reply.result) : [];
}

/** The most linetypes the list offers. */
const MAX_LINETYPES = 2000;

/** The `drawing.inspect` result into the names of the linetypes the drawing has loaded, in the engine's order. */
export function parseLinetypes(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result["linetypes"])) return [];
  const names: string[] = [];
  for (const item of result["linetypes"]) {
    const name = isRecord(item) ? asString(item["name"]) : asString(item);
    if (name !== null && name !== "" && !names.includes(name)) names.push(name);
    if (names.length >= MAX_LINETYPES) break;
  }
  return names;
}

/** The linetypes a layer may take: the ones the drawing has loaded. */
export function readLinetypes(engine: LayerEngine): string[] {
  const reply = engine.execute("drawing.inspect", { entities: false });
  return reply.ok ? parseLinetypes(reply.result) : [];
}

/** The colours a layer may take from the list: the palette's named ones. A layer's colour is
 *  never ByLayer or ByBlock (the engine refuses both). */
export const LAYER_COLOR_CHOICES: readonly string[] = COLOR_CHOICES.filter((name) => name !== "ByLayer" && name !== "ByBlock");

/** The lineweights a layer may take: the drawing's default, then the engine's ladder. */
export const LAYER_LINEWEIGHT_CHOICES: readonly string[] = ["Default", ...LINEWEIGHT_CHOICES];

/** The transparencies the list offers, in percent. */
export const LAYER_TRANSPARENCY_CHOICES: readonly number[] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];

/* ---- What a name draws as ---- */

/** A control character as its picture (U+2400 and up), so it takes room and can be told apart. */
function pictureOf(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x20) return String.fromCodePoint(0x2400 + code);
  if (code === 0x7f) return "␡";
  return "�";
}

/** What stands in the name column for a layer whose name is empty. */
export const NO_NAME = "(no name)";

/** A name as the table draws it: control characters as their pictures, an empty one as words. */
export function shownName(name: string): string {
  if (name === "") return NO_NAME;
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f-\u009f]/g, pictureOf);
}

/** A name inside a sentence: in quotation marks, and isolated so a right-to-left name does not
 *  reorder the words around it. A very long one keeps its two ends. */
export function quoted(name: string): string {
  const shown = shownName(name);
  const chars = Array.from(shown);
  const short = chars.length > 48 ? `${chars.slice(0, 30).join("")}…${chars.slice(-12).join("")}` : shown;
  return `“⁨${short}⁩”`;
}

/* ---- Order ---- */

/** The columns the table sorts by. `status` is current, then with objects, then empty. */
export type SortKey = "status" | "name" | "on" | "frozen" | "locked" | "plot" | "color" | "linetype" | "lineweight" | "transparency" | "description";

/** The table's order: a column and a direction, or the engine's own order (`null`). */
export type Sort = { key: SortKey; descending: boolean } | null;

/** What a header says of itself (`aria-sort`). */
export type AriaSort = "ascending" | "descending" | "none";

export function ariaSort(sort: Sort, key: SortKey): AriaSort {
  if (sort === null || sort.key !== key) return "none";
  return sort.descending ? "descending" : "ascending";
}

/** A press on a header: ascending, then descending, then the engine's order again. */
export function nextSort(sort: Sort, key: SortKey): Sort {
  if (sort === null || sort.key !== key) return { key, descending: false };
  return sort.descending ? null : { key, descending: true };
}

/** Names as a person reads them: "A-2" before "A-10", case apart only to break a tie. */
const byText = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareText(a: string, b: string): number {
  const loose = byText.compare(a, b);
  if (loose !== 0) return loose;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A lineweight's width in millimetres; the drawing's default sorts before every width. */
function weightOf(name: string): number {
  const mm = Number.parseFloat(name);
  return Number.isFinite(mm) ? mm : -1;
}

function statusRank(row: LayerRow): number {
  return row.current ? 0 : row.used ? 1 : 2;
}

function compareBy(key: SortKey, a: LayerRow, b: LayerRow): number {
  switch (key) {
    case "status":
      return statusRank(a) - statusRank(b);
    case "name":
      return compareText(a.name, b.name);
    case "on":
    case "frozen":
    case "locked":
    case "plot":
      return Number(a[key]) - Number(b[key]);
    case "color":
      return compareText(a.colorName, b.colorName);
    case "linetype":
      return compareText(a.linetype, b.linetype);
    case "lineweight":
      return weightOf(a.lineweight) - weightOf(b.lineweight);
    case "transparency":
      return a.transparency - b.transparency;
    case "description":
      return compareText(a.description, b.description);
  }
}

/**
 * The rows in the table's order. Stable: rows the column cannot tell apart keep the engine's
 * order, in both directions. The current layer has no place of its own: it sorts as any other
 * (the status column is the one that brings it to the top). Returns a new array.
 */
export function sortRows(rows: readonly LayerRow[], sort: Sort): LayerRow[] {
  if (sort === null) return rows.slice();
  const sign = sort.descending ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => sign * compareBy(sort.key, a.row, b.row) || a.index - b.index)
    .map((entry) => entry.row);
}

/* ---- Filter ---- */

/** Whether `text` matches `pattern`, where `*` is any run of characters and `?` any one. Both are
 *  already folded to one case. Linear in the two lengths' product, whatever the pattern holds. */
function globMatch(pattern: readonly string[], text: readonly string[]): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === text[t])) {
      p += 1;
      t += 1;
    } else if (p < pattern.length && pattern[p] === "*") {
      star = p;
      mark = t;
      p += 1;
    } else if (star >= 0) {
      p = star + 1;
      mark += 1;
      t = mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p += 1;
  return p === pattern.length;
}

/** The longest filter read: more is cut, not matched. */
const MAX_FILTER = 256;

/**
 * Whether a layer's name passes the filter. The space around the text is dropped and case is
 * ignored. Plain text matches anywhere in the name ("wall" finds "A-WALL-EXT"). With a `*` or a
 * `?` in it the text is a pattern for the whole name, as a CAD layer filter is: `*` stands for
 * any run of characters and `?` for exactly one ("A-*" is every name that starts "A-"). An empty
 * filter passes every name.
 */
export function matchesFilter(name: string, filter: string): boolean {
  const wanted = (typeof filter === "string" ? filter : "").trim().slice(0, MAX_FILTER).toLocaleLowerCase();
  if (wanted === "") return true;
  const held = name.toLocaleLowerCase();
  if (!wanted.includes("*") && !wanted.includes("?")) return held.includes(wanted);
  return globMatch(Array.from(wanted), Array.from(held));
}

export function filterRows(rows: readonly LayerRow[], filter: string): LayerRow[] {
  return rows.filter((row) => matchesFilter(row.name, filter));
}

/** The count beside the filter: "9 layers", "1 layer", "4 of 9 layers". */
export function countText(shown: number, total: number): string {
  const noun = total === 1 ? "layer" : "layers";
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}

/* ---- Selection ---- */

/** The selected rows, by exact name, and the row a Shift+click ranges from. */
export interface Selection {
  names: ReadonlySet<string>;
  anchor: string | null;
}

export const NO_SELECTION: Selection = { names: new Set(), anchor: null };

/** How a press chooses: plain replaces, `toggle` (Ctrl or Cmd) flips one, `range` (Shift) takes
 *  every shown row from the anchor to the pressed one. */
export interface SelectHow {
  toggle?: boolean;
  range?: boolean;
}

/**
 * The selection after a press on `name`, among the rows as shown (`order`: sorted and filtered).
 * A range from an anchor that is no longer shown is the pressed row alone; a range with Ctrl
 * held adds to what is selected. The anchor moves on a plain press and on a toggle, never on a
 * range, so a second Shift+click ranges from the same row.
 */
export function selectPress(selection: Selection, order: readonly string[], name: string, how: SelectHow = {}): Selection {
  if (how.range === true) {
    const from = selection.anchor === null ? -1 : order.indexOf(selection.anchor);
    const to = order.indexOf(name);
    if (from < 0 || to < 0) return { names: new Set([name]), anchor: name };
    const span = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    return { names: new Set(how.toggle === true ? [...selection.names, ...span] : span), anchor: selection.anchor };
  }
  if (how.toggle === true) {
    const names = new Set(selection.names);
    if (!names.delete(name)) names.add(name);
    return { names, anchor: name };
  }
  return { names: new Set([name]), anchor: name };
}

/** Every shown row. The anchor stays where it was when it is one of them. */
export function selectAll(selection: Selection, order: readonly string[]): Selection {
  return { names: new Set(order), anchor: selection.anchor !== null && order.includes(selection.anchor) ? selection.anchor : (order[0] ?? null) };
}

/** The selection less the layers the drawing no longer has (deleted, renamed, another drawing). */
export function pruneSelection(selection: Selection, rows: readonly LayerRow[]): Selection {
  const held = new Set(rows.map((row) => row.name));
  const names = new Set([...selection.names].filter((name) => held.has(name)));
  const anchor = selection.anchor !== null && held.has(selection.anchor) ? selection.anchor : null;
  return names.size === selection.names.size && anchor === selection.anchor ? selection : { names, anchor };
}

/** The selection after `from` became `to` (a rename): the row keeps its place in it. */
export function renameInSelection(selection: Selection, from: string, to: string): Selection {
  const names = new Set([...selection.names].map((name) => (name === from ? to : name)));
  return { names, anchor: selection.anchor === from ? to : selection.anchor };
}

/**
 * The layers a change made on `name`'s row applies to: every selected row when that row is one
 * of several selected, as a CAD layer manager does, else that row alone. In the table's order.
 */
export function targetsOf(selection: Selection, order: readonly string[], name: string): string[] {
  if (!selection.names.has(name) || selection.names.size < 2) return [name];
  return order.filter((candidate) => selection.names.has(candidate));
}

/* ---- What may be done ---- */

/** Whether an action may run on the selection, and when it may not, why, in words. */
export type Verdict = { allowed: true } | { allowed: false; reason: string };

const isZero = (name: string): boolean => name === "0";
const isDefpoints = (name: string): boolean => name.toLowerCase() === "defpoints";

/**
 * Whether the named layers may be deleted. The engine keeps layer 0, Defpoints, the current
 * layer and any layer with objects on it (`layer.delete`); the reason names the first that
 * stands in the way, so the key can say it before it is pressed.
 */
export function deleteVerdict(rows: readonly LayerRow[], names: ReadonlySet<string>): Verdict {
  const picked = rows.filter((row) => names.has(row.name));
  if (picked.length === 0) return { allowed: false, reason: "Select a layer to delete" };
  if (picked.some((row) => isZero(row.name))) return { allowed: false, reason: "Layer 0 cannot be deleted" };
  if (picked.some((row) => isDefpoints(row.name))) return { allowed: false, reason: "The Defpoints layer cannot be deleted" };
  const current = picked.find((row) => row.current);
  if (current !== undefined) return { allowed: false, reason: `${quoted(current.name)} is the current layer: make another layer current first` };
  const used = picked.filter((row) => row.used);
  const first = used[0];
  if (first !== undefined) {
    return { allowed: false, reason: used.length === 1 ? `${quoted(first.name)} has objects on it` : `${used.length} of the selected layers have objects on them` };
  }
  return { allowed: true };
}

/** Whether the selection names one layer that can be made current. */
export function currentVerdict(rows: readonly LayerRow[], names: ReadonlySet<string>): Verdict {
  const picked = rows.filter((row) => names.has(row.name));
  const only = picked[0];
  if (only === undefined) return { allowed: false, reason: "Select a layer to make current" };
  if (picked.length > 1) return { allowed: false, reason: "Select one layer to make current" };
  if (only.current) return { allowed: false, reason: `${quoted(only.name)} is already the current layer` };
  return { allowed: true };
}

/* ---- The calls ---- */

/** The properties a row's cells change, as `layer.set` names them. */
export interface LayerPatch {
  on?: boolean;
  frozen?: boolean;
  locked?: boolean;
  plot?: boolean;
  color?: string;
  linetype?: string;
  lineweight?: string;
  transparency?: number;
  description?: string;
}

const UNDO_BEGIN: LayerCall = { command: "undo", params: { mode: "begin" } };
const UNDO_END: LayerCall = { command: "undo", params: { mode: "end" } };

/** Several calls as one undo step; one call is already one. */
function grouped(calls: LayerCall[]): LayerCall[] {
  return calls.length < 2 ? calls : [UNDO_BEGIN, ...calls, UNDO_END];
}

/**
 * The calls that make one change on every named layer: a `layer.set` each (the engine's command
 * takes one layer), inside one undo group when there are several. A layer already holding every
 * value of the patch is left out, so a change that changes nothing calls nothing.
 */
export function planChange(rows: readonly LayerRow[], names: readonly string[], patch: LayerPatch): LayerCall[] {
  const keys = (Object.keys(patch) as (keyof LayerPatch)[]).filter((key) => patch[key] !== undefined);
  if (keys.length === 0) return [];
  const calls: LayerCall[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const row = rows.find((candidate) => candidate.name === name);
    if (row === undefined) continue;
    const held: LayerPatch = { on: row.on, frozen: row.frozen, locked: row.locked, plot: row.plot, color: row.colorName, linetype: row.linetype, lineweight: row.lineweight, transparency: row.transparency, description: row.description };
    const changed = keys.filter((key) => held[key] !== patch[key]);
    if (changed.length === 0) continue;
    const params: Record<string, unknown> = { name };
    for (const key of changed) params[key] = patch[key];
    calls.push({ command: "layer.set", params, layer: name });
  }
  return grouped(calls);
}

/** The calls that delete the named layers: one each, as one undo step. */
export function planDelete(names: readonly string[]): LayerCall[] {
  return grouped([...new Set(names)].map((name) => ({ command: "layer.delete", params: { name }, layer: name })));
}

/** What typed text does to a layer's name. */
export type RenamePlan = { kind: "keep" } | { kind: "refuse"; message: string } | { kind: "send"; call: LayerCall; to: string };

/**
 * A rename as the engine is asked for it. The same name keeps the layer as it is; a name with
 * nothing in it is refused here (the one rule not left to the engine); anything else is sent as
 * typed, less the space around it, and the engine says whether it is a name.
 */
export function planRename(from: string, typed: string): RenamePlan {
  const to = typed.trim();
  if (to === "") return { kind: "refuse", message: "A layer needs a name" };
  if (to === from) return { kind: "keep" };
  return { kind: "send", to, call: { command: "layer.set", params: { name: from, newName: to }, layer: from } };
}

export function planCurrent(name: string): LayerCall {
  return { command: "layer.current", params: { name }, layer: name };
}

/** The most numbers tried for a new layer's name before a name is refused. */
const MAX_NEW_NAME_TRIES = MAX_LAYERS + 1;

/**
 * The name a new layer starts with: "Layer1", or the first "LayerN" no layer has. The engine
 * tells names apart without regard to case, so "LAYER1" takes "Layer1" too.
 */
export function newLayerName(rows: readonly Pick<LayerRow, "name">[]): string {
  const taken = new Set(rows.map((row) => row.name.toLowerCase()));
  for (let n = 1; n <= MAX_NEW_NAME_TRIES; n++) {
    const name = `Layer${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
  return `Layer${Date.now()}`;
}

export function planNew(rows: readonly Pick<LayerRow, "name">[]): { name: string; call: LayerCall } {
  const name = newLayerName(rows);
  return { name, call: { command: "layer.new", params: { name }, layer: name } };
}

/** An engine refusal in plain words: the command's own name in front of it says nothing to a
 *  drafter ("Invalid parameters for `layer.set`: cannot freeze the current layer"), and a
 *  sentence starts with a capital. What follows the command's name is the engine's own reason. */
export function plainRefusal(error: string): string {
  const words = (typeof error === "string" ? error : "").replace(/^\s*(?:invalid parameters for\s+)?`?[a-z][a-z0-9.-]*`?\s*:\s*/i, "").trim();
  if (words === "") return "The engine refused the change";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Runs the calls in order and answers with the layers the engine refused, each with its reason.
 * Every call is run: one layer's refusal does not stop the others. The undo group's two calls
 * are never a refusal (an engine with undo turned off refuses them and the change still stands,
 * as so many steps).
 */
export function runCalls(engine: LayerEngine, calls: readonly LayerCall[]): LayerRefusal[] {
  const refused: LayerRefusal[] = [];
  for (const call of calls) {
    const reply = engine.execute(call.command, call.params);
    if (!reply.ok && call.layer !== undefined) refused.push({ layer: call.layer, message: plainRefusal(reply.error) });
  }
  return refused;
}

/* ---- The grid's keyboard ---- */

/** Where the keyboard is in the grid: a row of the table as shown (-1 is the header) and a column. */
export interface GridCell {
  row: number;
  column: number;
}

/** The keys that move the active cell. */
export interface GridKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * The cell a key moves to, or `null` when the key does not move. The arrows stop at the edges
 * (a grid does not wrap); Home and End go to the row's two ends, with Ctrl or Cmd to the first
 * and the last cell of the table; Page Up and Page Down go a page of `page` rows. The header is
 * row -1: Up from the first row reaches it, and the keys that jump to the table's ends stay in
 * the rows when there are any.
 */
export function moveCell(cell: GridCell, key: GridKey, rows: number, columns: number, page: number): GridCell | null {
  if (columns <= 0) return null;
  const last = rows - 1;
  const top = rows > 0 ? 0 : -1;
  const mod = key.ctrlKey || key.metaKey;
  const clampRow = (row: number): number => Math.max(-1, Math.min(last, row));
  const clampColumn = (column: number): number => Math.max(0, Math.min(columns - 1, column));
  const step = Math.max(1, Math.floor(page));
  let next: GridCell;
  switch (key.key) {
    case "ArrowUp":
      next = { row: clampRow(cell.row - 1), column: cell.column };
      break;
    case "ArrowDown":
      next = { row: clampRow(cell.row + 1), column: cell.column };
      break;
    case "ArrowLeft":
      next = { row: cell.row, column: clampColumn(cell.column - 1) };
      break;
    case "ArrowRight":
      next = { row: cell.row, column: clampColumn(cell.column + 1) };
      break;
    case "Home":
      next = mod ? { row: top, column: 0 } : { row: cell.row, column: 0 };
      break;
    case "End":
      next = mod ? { row: Math.max(top, last), column: columns - 1 } : { row: cell.row, column: columns - 1 };
      break;
    case "PageUp":
      next = { row: Math.max(top, cell.row - step), column: cell.column };
      break;
    case "PageDown":
      next = { row: clampRow(Math.max(cell.row, -1) + step), column: cell.column };
      break;
    default:
      return null;
  }
  next = { row: clampRow(next.row), column: clampColumn(next.column) };
  return next.row === cell.row && next.column === cell.column ? null : next;
}

/** How long typed letters stay one word for the type-ahead, in milliseconds. */
export const TYPEAHEAD_MS = 700;

/**
 * The row the typed letters jump to: the next name after `current` that starts with them,
 * wrapping past the end, without regard to case. One letter typed again steps through the names
 * that share it; several letters typed together stay on the current row while it still matches.
 * `null` when no name starts with them.
 */
export function typeaheadRow(names: readonly string[], current: number, typed: string): number | null {
  const wanted = typed.toLocaleLowerCase();
  if (wanted.trim() === "" || names.length === 0) return null;
  const chars = Array.from(wanted);
  const repeated = chars.length > 1 && chars.every((char) => char === chars[0]);
  const prefix = repeated ? (chars[0] ?? "") : wanted;
  const from = Number.isInteger(current) && current >= 0 && current < names.length ? current : -1;
  // A word being typed keeps the row it is on while that row still matches; a single letter, or
  // the same letter again, moves on.
  const first = chars.length > 1 && !repeated ? 0 : 1;
  for (let step = first; step <= names.length; step++) {
    const index = (from + step + names.length) % names.length;
    if ((names[index] ?? "").toLocaleLowerCase().startsWith(prefix)) return index;
  }
  return null;
}

/* ---- What opens it ---- */

/** The engine command the manager is the dialog of (`layer.rs`: "Layers", Format > Layers). */
export const LAYER_MANAGER_COMMAND = "layer";

/** The names typed at the command line that open the dialog: the command's id and its aliases.
 *  `-LAYER` is not one: the hyphen asks for the command-line prompts, as it does in a CAD program. */
export const LAYER_MANAGER_NAMES: readonly string[] = ["layer", "la", "layers"];

/** Whether a line typed at an idle command line asks for the dialog ("LAYER", "la", "'layer"). */
export function opensLayerManager(text: string): boolean {
  if (typeof text !== "string") return false;
  const name = text.trim().replace(/^['_.]+/, "").toLowerCase();
  return LAYER_MANAGER_NAMES.includes(name);
}

/* ---- Windowing ---- */

/** The rows drawn for a scroll position: the ones in view and `overscan` more on each side. */
export function windowOf(scrollTop: number, viewHeight: number, rowHeight: number, count: number, overscan: number): { first: number; last: number } {
  if (count <= 0 || !(rowHeight > 0)) return { first: 0, last: -1 };
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const height = Number.isFinite(viewHeight) ? Math.max(0, viewHeight) : 0;
  const first = Math.max(0, Math.min(count - 1, Math.floor(top / rowHeight) - overscan));
  const last = Math.max(first, Math.min(count - 1, Math.ceil((top + height) / rowHeight) + overscan));
  return { first, last };
}
