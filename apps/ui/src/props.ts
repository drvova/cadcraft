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
 */

import { asNumber, isRecord } from "./json";

export interface PropRow {
  key: string;
  label: string;
  value: string;
  editable: boolean;
  kind: "text" | "number" | "bool" | "choice";
  choices?: readonly string[];
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

/** A JSON scalar as the palette shows it; anything else is the empty string. */
function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return numberText(value);
  return "";
}

/** A finite number for display: six decimals at most, so a computed float stays readable. */
function numberText(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

/** The control a row gets, and its choice list where one applies. */
function kindFor(key: string, layers: readonly string[]): Pick<PropRow, "kind" | "choices"> {
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
      return { kind: "number" };
    case "visible":
      return { kind: "bool" };
    default:
      return { kind: "text" };
  }
}

function makeRow(key: string, value: string, editable: boolean, layers: readonly string[]): PropRow {
  const { kind, choices } = kindFor(key, layers);
  const row: PropRow = { key, label: humanize(key), value, editable, kind };
  if (choices !== undefined) row.choices = choices;
  return row;
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
 * Edited row values into `properties.set` parameters: a finite number stays a number, the
 * exact strings "true"/"false" become booleans, everything else stays a string. Only the keys
 * the caller edited are included; a non-string value is skipped rather than coerced.
 */
export function buildPatch(edits: Readonly<Record<string, string>>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(edits)) {
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    if (text === "true") {
      patch[key] = true;
      continue;
    }
    if (text === "false") {
      patch[key] = false;
      continue;
    }
    if (text !== "") {
      const n = Number(text);
      if (Number.isFinite(n)) {
        patch[key] = n;
        continue;
      }
    }
    patch[key] = raw;
  }
  return patch;
}
