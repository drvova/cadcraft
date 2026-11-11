/**
 * The properties palette's pure logic: the engine's `properties` reply into display rows, and
 * edited rows back into `properties.set` parameters.
 *
 * The reply shapes are the engine's own (`crates/engine/src/cmd/props.rs`, `run_get`):
 *   - no selection: `{"selection":"No selection", color, layer, linetype, linetypeScale,
 *     lineweight, textStyle, dimStyle, textHeight}`;
 *   - otherwise: `{"count": n, "objects": [entity_props…]}` where each object carries the common
 *     properties, its `geometry`, `handle`/`type`, and (for some kinds) the numbers the engine
 *     computed (`length`/`angle`, `diameter`/…). `parseProperties` accepts that result either
 *     flat (the raw command result) or with the facade's `{selection, defaults}` nesting, and
 *     never throws on hostile input.
 *
 * `buildPatch` converts the edited rows into the exact parameter names `properties.set` reads:
 * `layer`, `color`, `linetype`, `lineweight`, `ltscale`, `transparency`, `thickness`, `visible`.
 *
 * Numbers, both ways:
 *   - shown (`numberText`): plain digits with six decimals at most while the magnitude is from
 *     1e-6 up to (not including) 1e15; outside that, exponent form with seven significant digits
 *     at most (`1.5e+21`, `2.5e-9`); zero is `0`. A NaN or an infinity is never shown as a
 *     number: it reads `Not a number`, `Infinite` or `-Infinite`.
 *   - typed (`readNumber`): an optional sign, digits with at most one decimal mark, an optional
 *     exponent. Full-width forms are folded to ASCII first, and the typographic minus is a minus.
 *     The decimal mark is a dot, or a single comma followed by digits when the text has no dot
 *     (`2,5` is 2.5). Anything with more separators (`1,234,567`, `1.234,5`, `2,`) is refused,
 *     because a comma is also a thousands separator and CAD's coordinate separator. Hex, a
 *     trailing unit, inner spaces, `Infinity` and a value past the float range are refused.
 *   - `judgeDraft` is the one judgement of typed text against a row: it and `buildPatch` both
 *     read numbers through `readNumber`, so what is "unchanged" and what is sent cannot disagree.
 */

import { asNumber, isRecord } from "./json";

export interface PropRow {
  key: string;
  label: string;
  value: string;
  editable: boolean;
  kind: "text" | "number" | "bool" | "choice";
  choices?: readonly string[];
  /** A number row's lowest value; with `minExclusive` the value must be above it. */
  min?: number;
  minExclusive?: boolean;
  /** A number row's highest value (inclusive). Absent: the top is open. */
  max?: number;
}

export type PropertiesReply =
  | { kind: "defaults"; rows: PropRow[] }
  | { kind: "objects"; count: number; rows: PropRow[]; objects: Readonly<Record<string, unknown>>[] };

/** What a property reads when the selected objects disagree. */
export const VARIES = "*VARIES*";

/** The colour names `Color::name()` uses (`crates/color/src/lib.rs`), in ACI order. */
export const COLOR_CHOICES: readonly string[] = ["ByLayer", "ByBlock", "Red", "Yellow", "Green", "Cyan", "Blue", "Magenta", "White"];

/** The engine's lineweight ladder (`Lineweight::STANDARD`, mm × 100) as its own display names. */
export const LINEWEIGHT_CHOICES: readonly string[] = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211].map((mm100) => `${(mm100 / 100).toFixed(2)} mm`);

/** The common properties every object has, in the order the palette lists them. */
const COMMON_KEYS: readonly string[] = ["layer", "color", "linetype", "lineweight", "ltscale", "transparency", "thickness", "visible"];

/** The drawing's defaults, in the order the engine's no-selection reply carries them. */
const DEFAULT_KEYS: readonly string[] = ["color", "layer", "linetype", "linetypeScale", "lineweight", "textStyle", "dimStyle", "textHeight"];

/** The geometry numbers the engine computes per kind (`entity_props`), in display order. */
const GEOMETRY_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["length", "Length"],
  ["angle", "Angle"],
  ["radius", "Radius"],
  ["diameter", "Diameter"],
  ["circumference", "Circumference"],
  ["area", "Area"],
  ["arcLength", "Arc length"],
  ["totalAngle", "Total angle"],
];

const LABELS: Readonly<Record<string, string>> = {
  color: "Color",
  layer: "Layer",
  linetype: "Linetype",
  linetypeScale: "Linetype scale",
  ltscale: "Linetype scale",
  lineweight: "Lineweight",
  textStyle: "Text style",
  dimStyle: "Dim style",
  textHeight: "Text height",
  transparency: "Transparency",
  thickness: "Thickness",
  visible: "Visible",
  type: "Type",
  handle: "Handle",
};

/** The palette's label for a key: a known name, or the key spaced and capitalised. */
function humanize(key: string): string {
  const known = LABELS[key];
  if (known !== undefined) return known;
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  if (spaced === "") return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** What a number that is not one reads as: words, so it is never mistaken for a value. */
export const NOT_A_NUMBER = "Not a number";
export const INFINITE = "Infinite";

/** Plain digits below this magnitude (fifteen integer digits), exponent form from it up. */
const PLAIN_BELOW = 1e15;
/** Plain digits from this magnitude up: anything smaller would round to a false zero. */
const PLAIN_FROM = 1e-6;

/** A JSON scalar as the palette shows it; anything else is the empty string. */
function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return numberText(value);
  return "";
}

/** `1.500000e+21` as `1.5e+21`: the fraction's trailing zeros say nothing. */
function trimExponent(text: string): string {
  return text.replace(/\.?0+e/, "e");
}

/**
 * A number for display, by the rule in this file's header: plain digits with six decimals at
 * most for ordinary magnitudes, exponent form for the very large and the very small, and words
 * for a NaN or an infinity.
 */
export function numberText(value: number): string {
  if (Number.isNaN(value)) return NOT_A_NUMBER;
  if (!Number.isFinite(value)) return value > 0 ? INFINITE : `-${INFINITE}`;
  const size = Math.abs(value);
  if (size === 0) return "0";
  if (size >= PLAIN_BELOW || size < PLAIN_FROM) return trimExponent(value.toExponential(6));
  return String(Number(value.toFixed(6)));
}

/** Why typed text is not a number the palette takes. */
export type NumberFault = "empty" | "separators" | "unit" | "range" | "form";

export type NumberReading = { ok: true; value: number } | { ok: false; fault: NumberFault };

/** An optional sign, digits with at most one dot, an optional exponent. Nothing else. */
const NUMBER_FORM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
/** The same with one comma where the dot would be, and digits after it. */
const COMMA_DECIMAL_FORM = /^[+-]?\d*,\d+(?:e[+-]?\d+)?$/i;
/** Only what a number with separators is made of: the text is a number written ambiguously. */
const SEPARATED_FORM = /^[+-]?[\d.,]*\d[\d.,]*$/;
/** A number, then letters or a unit mark. */
const UNIT_FORM = /^[+-]?(?:\d+[.,]?\d*|[.,]\d+)\s*(?:[a-zµ]+|["'%°])$/i;

/**
 * Typed text as a number, by the rule in this file's header. Never throws; a non-string reads
 * as `form`.
 */
export function readNumber(raw: string): NumberReading {
  if (typeof raw !== "string") return { ok: false, fault: "form" };
  const text = raw.normalize("NFKC").replace(/−/g, "-").trim();
  if (text === "") return { ok: false, fault: "empty" };
  let plain: string;
  if (NUMBER_FORM.test(text)) plain = text;
  else if (COMMA_DECIMAL_FORM.test(text)) plain = text.replace(",", ".");
  else if (SEPARATED_FORM.test(text)) return { ok: false, fault: "separators" };
  else if (UNIT_FORM.test(text)) return { ok: false, fault: "unit" };
  else return { ok: false, fault: "form" };
  const value = Number(plain);
  if (!Number.isFinite(value)) return { ok: false, fault: "range" };
  return { ok: true, value: value === 0 ? 0 : value };
}

/** The bounds of the number rows the engine limits, by key. */
const NUMBER_BOUNDS: Readonly<Record<string, Pick<PropRow, "min" | "minExclusive" | "max">>> = {
  // `properties.set` leaves the scale as it was for anything not above zero and still answers
  // ok (`run_set`: `.filter(|x| *x > 0.0)`), and the LTSCALE command says "scale must be
  // positive". Neither states a top, so the top is open.
  ltscale: { min: 0, minExclusive: true },
  linetypeScale: { min: 0, minExclusive: true },
  // The THICKNESS command's range (`MAX_THICKNESS`, "thickness is out of range (-1e12 to 1e12)").
  thickness: { min: -1e12, max: 1e12 },
};

/** The control a row gets, its choice list where one applies, and a number row's bounds. */
function kindFor(key: string, layers: readonly string[]): Pick<PropRow, "kind" | "choices" | "min" | "minExclusive" | "max"> {
  switch (key) {
    case "color":
      return { kind: "choice", choices: COLOR_CHOICES };
    case "layer":
      return layers.length > 0 ? { kind: "choice", choices: layers } : { kind: "text" };
    case "lineweight":
      return { kind: "choice", choices: LINEWEIGHT_CHOICES };
    case "ltscale":
    case "linetypeScale":
    case "thickness":
    case "textHeight":
      return { kind: "number", ...NUMBER_BOUNDS[key] };
    case "visible":
      return { kind: "bool" };
    default:
      return { kind: "text" };
  }
}

function makeRow(key: string, value: string, editable: boolean, layers: readonly string[]): PropRow {
  return { key, label: humanize(key), value, editable, ...kindFor(key, layers) };
}

/** The no-selection rows: the drawing's current defaults, read-only (there is nothing to set). */
function defaultRows(source: Record<string, unknown>, layers: readonly string[]): PropRow[] {
  const rows: PropRow[] = [];
  for (const key of DEFAULT_KEYS) {
    if (!(key in source)) continue;
    rows.push(makeRow(key, scalarText(source[key]), false, layers));
  }
  return rows;
}

/** The common rows for a selection; a property the objects disagree on reads `*VARIES*`. */
function commonRows(objects: readonly Record<string, unknown>[], layers: readonly string[]): PropRow[] {
  const rows: PropRow[] = [];
  for (const key of COMMON_KEYS) {
    const values = objects.map((o) => scalarText(o[key]));
    const first = values[0] ?? "";
    const varies = values.some((value) => value !== first);
    rows.push(makeRow(key, varies ? VARIES : first, true, layers));
  }
  return rows;
}

/** One object's read-only summary: its type and handle, then the numbers the engine computed. */
function summaryRows(object: Record<string, unknown>): PropRow[] {
  const rows: PropRow[] = [];
  const type = scalarText(object["type"]);
  if (type !== "") rows.push({ key: "type", label: humanize("type"), value: type, editable: false, kind: "text" });
  const handle = scalarText(object["handle"]);
  if (handle !== "") rows.push({ key: "handle", label: humanize("handle"), value: handle, editable: false, kind: "text" });
  const geometry = isRecord(object["geometry"]) ? object["geometry"] : {};
  for (const [key, label] of GEOMETRY_KEYS) {
    const direct = scalarText(object[key]);
    const value = direct !== "" ? direct : scalarText(geometry[key]);
    if (value !== "") rows.push({ key, label, value, editable: false, kind: "number" });
  }
  return rows;
}

function objectRows(objects: readonly Record<string, unknown>[], layers: readonly string[]): PropRow[] {
  if (objects.length === 0) return [];
  const rows = commonRows(objects, layers);
  const only = objects.length === 1 ? objects[0] : undefined;
  if (only !== undefined) rows.push(...summaryRows(only));
  return rows;
}

/**
 * The engine's `properties` result into the palette's rows; null when the reply is not one of
 * the engine's shapes (hostile input never throws).
 */
export function parseProperties(reply: unknown, layers: readonly string[]): PropertiesReply | null {
  if (!isRecord(reply)) return null;
  const objects = reply["objects"];
  if (Array.isArray(objects)) {
    const kept: Record<string, unknown>[] = [];
    for (const item of objects) {
      if (isRecord(item)) kept.push(item);
    }
    const count = asNumber(reply["count"]);
    return {
      kind: "objects",
      count: count === null ? kept.length : Math.max(0, Math.round(count)),
      rows: objectRows(kept, layers),
      objects: kept,
    };
  }
  const source = isRecord(reply["defaults"]) ? reply["defaults"] : reply;
  const marked = reply["selection"] === "No selection";
  if (!marked && !DEFAULT_KEYS.some((key) => key in source)) return null;
  return { kind: "defaults", rows: defaultRows(source, layers) };
}

/**
 * Edited row values into `properties.set` parameters, by what each key is: a number row's text
 * becomes a number (`readNumber`), the tick's "true"/"false" a boolean, and every other row
 * stays a string with the space around it removed. A layer called "0" or "true" therefore stays
 * a name (the engine reads `layer` only as a string and refuses anything else). Number
 * text that is not a number stays a string, so nothing is invented for it. Only the keys the
 * caller edited are included; a non-string value is skipped rather than coerced.
 */
export function buildPatch(edits: Readonly<Record<string, string>>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(edits)) {
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    const { kind } = kindFor(key, []);
    if (kind === "number") {
      const reading = readNumber(text);
      patch[key] = reading.ok ? reading.value : text;
    } else if (kind === "bool" && (text === "true" || text === "false")) {
      patch[key] = text === "true";
    } else {
      patch[key] = text;
    }
  }
  return patch;
}

/** What becomes of text typed into a row: nothing to send, a refusal to say, or the patch. */
export type DraftVerdict = { kind: "keep" } | { kind: "refuse"; message: string } | { kind: "send"; patch: Record<string, unknown> };

/** A bound as a person reads it: `1e12` rather than thirteen digits. */
function boundText(value: number): string {
  return Math.abs(value) >= 1e6 ? trimExponent(value.toExponential()).replace("e+", "e") : numberText(value);
}

/** The range a number row takes, in words; empty when the row has no bounds. */
function rangeText(row: PropRow): string {
  const above = row.minExclusive === true;
  const low = row.min === undefined ? "" : `${above ? "above" : "from"} ${boundText(row.min)}`;
  if (row.max === undefined) return low === "" || above ? low : `${low} up`;
  if (low === "") return `up to ${boundText(row.max)}`;
  return above ? `${low}, up to ${boundText(row.max)}` : `${low} to ${boundText(row.max)}`;
}

function inRange(row: PropRow, n: number): boolean {
  if (row.min !== undefined && (row.minExclusive === true ? n <= row.min : n < row.min)) return false;
  return row.max === undefined || n <= row.max;
}

/** Why a number row refused its text, with what to type instead. */
function numberRefusal(row: PropRow, fault: NumberFault): string {
  if (fault === "separators") return `${row.label}: type it like 1234.5, with one decimal mark and no thousands separators`;
  if (fault === "unit") return `${row.label} takes a number without a unit`;
  if (fault === "range" && row.max === undefined) return `${row.label} is past the largest number a drawing holds`;
  const range = rangeText(row);
  return range === "" ? `${row.label} needs a number` : `${row.label} needs a number ${range}`;
}

/**
 * Judges `draft` against the row it was typed into. An unchanged value, an emptied number and
 * the same number written another way ("2.50" or "2,5" over "2.5") keep the engine's value; a
 * number row takes only what `readNumber` reads, inside the row's bounds; a text row's value is
 * compared and sent without the space around it; everything else is sent as `buildPatch` has it.
 */
export function judgeDraft(row: PropRow, draft: string): DraftVerdict {
  if (draft === row.value) return { kind: "keep" };
  if (row.kind === "number") {
    const reading = readNumber(draft);
    if (!reading.ok) return reading.fault === "empty" ? { kind: "keep" } : { kind: "refuse", message: numberRefusal(row, reading.fault) };
    if (!inRange(row, reading.value)) return { kind: "refuse", message: numberRefusal(row, "form") };
    const held = readNumber(row.value);
    if (held.ok && held.value === reading.value) return { kind: "keep" };
    return { kind: "send", patch: { [row.key]: reading.value } };
  }
  if (row.kind === "text" && draft.trim() === row.value.trim()) return { kind: "keep" };
  return { kind: "send", patch: buildPatch({ [row.key]: draft }) };
}
