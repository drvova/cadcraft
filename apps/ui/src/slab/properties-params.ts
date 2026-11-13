/**
 * The Properties section as the Slab panel takes it (`slab/properties.slab`): typed scalar params
 * and one list of rows, nothing else. The rows are the ones `../props` makes for the SolidJS
 * panel and the heading is `../props-edit`'s; this file only shapes them, caps them (a Slab list
 * is laid out whole), reads a signal's item key back to the row it names, and makes the values of
 * a choice for the popup (`./popup`). The behaviour stays where it was: `../props`,
 * `../props-edit` and the shell's handlers.
 */

import { VARIES, type PropRow, type PropertiesReply } from "../props";
import { propertiesTitle, rowMode } from "../props-edit";
import { paramText } from "./bench-params";
import { sentenceText, UNCAPPED } from "./piece-params";
import type { PopupOption } from "./popup";

/** One property: a `PropLine` of the document. Its key is the row's key, so a field keeps its text across a refresh. */
export interface PropLineParam {
  key: string;
  name: string;
  /** The value as it reads: the text a typed field starts from. */
  shown: string;
  /** The row as a screen reader is told a choice ("Layer: 0"). */
  said: string;
  /** A row that is only read, as a screen reader is told it ("Type: Line"); "" on a row with a control. */
  told: string;
  /** The refusal standing on the row, as a screen reader is told it. */
  hint: string;
  /** The tick's state in the kernel's words: "true", "false" or "mixed". */
  ticked: string;
  read: boolean;
  choice: boolean;
  tick: boolean;
  typed: boolean;
  /** The choice's popup is open. */
  open: boolean;
  /** The tick is set. */
  on: boolean;
  /** The tick stands for objects that disagree. */
  varies: boolean;
  /** The value is the one that says the objects disagree: it reads quieter. */
  quiet: boolean;
  /** The row is marked as refused. */
  bad: boolean;
}

export interface PropertiesPanelParams {
  summary: string;
  open: boolean;
  /** There are rows to list. */
  listed: boolean;
  /** Open, with no row: the one line that says so. */
  empty: boolean;
  /** The body hides rows above its box, below it, or at both ends (one of the three at most). */
  above: boolean;
  below: boolean;
  between: boolean;
  body_max: number;
  rows: PropLineParam[];
}

/** The document's scalar params, its list param and the signals the host answers (`slab/properties.slab`). */
export const PROPERTIES_SCALARS = ["summary", "open", "listed", "empty", "above", "below", "between", "body_max"] as const;
export const PROPERTIES_LISTS = ["rows"] as const;
export const PROPERTIES_SIGNALS = ["fold", "row_choose", "row_tick", "row_edit", "row_submit"] as const;

/** What the host holds beside the engine's reply: the view's own switches. */
export interface PropertiesView {
  /** The section is unfolded. */
  open: boolean;
  selectionCount: number;
  /** The key of the choice row whose popup is open; null when none is. */
  openChoice: string | null;
  /** The refusal standing on each marked row, by row key. */
  faults: ReadonlyMap<string, string>;
  /** The most the body may be tall before it scrolls, in px. */
  bodyMax: number;
  /** The ends of the body that hide rows, as the last solve painted it. */
  hidden: { above: boolean; below: boolean };
}

/** The most rows laid out (one object has eight common rows and ten of its own at most) and values of one choice. */
export const MAX_PROP_ROWS = 60;
export const MAX_PROP_OPTIONS = 500;

/** A row's key as an item key: the names `../props` gives (letters only). Anything else is not listed. */
const ROW_KEY = /^[a-zA-Z]{1,24}$/;

/** The rows the panel lists: capped, and only those whose key can name an item. */
export function listedRows(reply: PropertiesReply | null): PropRow[] {
  return (reply?.rows ?? []).filter((row) => ROW_KEY.test(row.key)).slice(0, MAX_PROP_ROWS);
}

/** One row as the document takes it. */
export function lineParam(row: PropRow, view: Pick<PropertiesView, "openChoice" | "faults">): PropLineParam {
  const mode = rowMode(row);
  // The engine's value: a pick or a tick is answered by a refresh at once, and typed text is the
  // field's own buffer, which the host keeps (`SlabProperties.tsx`).
  const value = row.value;
  const tick = mode === "bool";
  const choice = mode === "choice";
  const fault = view.faults.get(row.key) ?? null;
  const name = paramText(row.label);
  const shown = tick ? "" : mode === "readonly" ? sentenceText(value) : paramText(value);
  const said = shown === "" ? name : `${name}: ${shown}`;
  const on = tick && value === "true";
  const varies = tick && value !== "true" && value !== "false";
  return {
    key: row.key,
    name,
    shown,
    said,
    told: mode === "readonly" ? said : "",
    hint: fault === null ? "" : sentenceText(fault),
    ticked: !tick ? "false" : on ? "true" : varies ? "mixed" : "false",
    read: mode === "readonly",
    choice,
    tick,
    typed: mode === "text" || mode === "number",
    open: choice && view.openChoice === row.key,
    on,
    varies,
    quiet: !tick && mode !== "readonly" && value === VARIES,
    bad: fault !== null,
  };
}

/** The panel's params for the engine's reply and the view's switches. */
export function propertiesPanelParams(reply: PropertiesReply | null, view: PropertiesView): PropertiesPanelParams {
  const summary = paramText(propertiesTitle(reply, view.selectionCount));
  const body_max = Number.isFinite(view.bodyMax) && view.bodyMax > 0 ? Math.min(UNCAPPED, Math.floor(view.bodyMax)) : UNCAPPED;
  // A folded section is its heading alone: nothing under it is laid out, focusable or read out.
  if (!view.open) return { summary, open: false, listed: false, empty: false, above: false, below: false, between: false, body_max, rows: [] };
  const rows = listedRows(reply).map((row) => lineParam(row, view));
  return {
    summary,
    open: true,
    listed: rows.length > 0,
    empty: rows.length === 0,
    above: view.hidden.above && !view.hidden.below,
    below: view.hidden.below && !view.hidden.above,
    between: view.hidden.above && view.hidden.below,
    body_max,
    rows,
  };
}

/**
 * The row a signal's item key names, among the rows listed; null when it names none (a stale or
 * forged signal does nothing).
 */
export function signalLine(reply: PropertiesReply | null, itemKey: string): PropRow | null {
  if (!ROW_KEY.test(itemKey)) return null;
  return listedRows(reply).find((row) => row.key === itemKey) ?? null;
}

/**
 * A choice row's values for the popup, as the SolidJS panel's `Select` lists them: each value is
 * its own label, and a value the list lacks (a layer deleted while an object still names it) is
 * kept as one more at the top. `held` is the value the popup opens on: none while the objects
 * disagree.
 */
export function choicePopup(row: PropRow, value: string): { options: PopupOption[]; held: string | null } {
  const mixed = value === VARIES;
  const values = [...(row.choices ?? [])];
  if (!mixed && !values.includes(value)) values.unshift(value);
  return { options: values.slice(0, MAX_PROP_OPTIONS).map((v) => ({ value: v, label: v })), held: mixed ? null : value };
}

/** A node of the solved scene with its painted box. */
export interface PartBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The height the body's content takes with nothing capping it: the extent of what the scrolling
 * body holds (a scrolled child is painted where it was moved to, so the extent is the same
 * wherever it is scrolled) and the body's own insets (2 above, 2 below). 0 when the section is
 * folded; null when the scene has no body or nothing in it yet.
 */
export function bodyNatural(scene: readonly PartBox[], open: boolean): number | null {
  if (!open) return 0;
  const body = scene.find((node) => node.key.endsWith("/#body"));
  if (body === undefined) return null;
  let top = Infinity;
  let bottom = -Infinity;
  for (const node of scene) {
    if (!node.key.startsWith(`${body.key}/`) || node.key.indexOf("/", body.key.length + 1) >= 0) continue;
    if (!Number.isFinite(node.y) || !Number.isFinite(node.h)) continue;
    top = Math.min(top, node.y);
    bottom = Math.max(bottom, node.y + node.h);
  }
  return bottom > top ? Math.ceil(bottom - top) + 4 : null;
}

/** The part of a row a scene key names (`#name`, `#choice`, `#field`, `#tick`), with the row; null outside the rows. */
export function linePart(key: string): { row: string; part: "name" | "choice" | "field" | "tick" } | null {
  const m = /#rows\/each@\d+~([a-zA-Z]{1,24})\/.*#(name|choice|field|tick)$/.exec(key);
  const part = m?.[2];
  if (m === null || m[1] === undefined || (part !== "name" && part !== "choice" && part !== "field" && part !== "tick")) return null;
  return { row: m[1], part };
}

/**
 * The hint of a part of the surface: text an ellipsis cuts is shown whole (a label, a choice's
 * value, the heading's count), and a marked field says why it is. `width` measures text as the
 * body paints it; null where the page cannot measure, and then nothing is known to be cut.
 */
export function partHint(params: PropertiesPanelParams, box: PartBox, width: ((text: string, chip: boolean) => number) | null): string | null {
  if (box.key.endsWith("/#state")) return width !== null && width(params.summary, true) > box.w + 0.5 ? params.summary : null;
  const at = linePart(box.key);
  if (at === null) return null;
  const line = params.rows.find((row) => row.key === at.row);
  if (line === undefined) return null;
  if (at.part === "field") return line.hint === "" ? null : line.hint;
  if (width === null) return null;
  if (at.part === "name") return width(line.name, false) > box.w + 0.5 ? line.name : null;
  // A choice's text shares its box with the arrow (12) and the gaps each side of the text (4 + 4).
  if (at.part === "choice") return width(line.shown, false) > box.w - 20 + 0.5 ? line.shown : null;
  return null;
}
