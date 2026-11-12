/**
 * The bench sheet as the sidebar shows it: the engine's `techsheet` reply (the stones of the
 * drawing by cut and size with their carats, and the bands `RING` drew with their weight) read
 * with checked narrowing into rows of a label and a value. Nothing is counted or weighed here:
 * every figure is the engine's, and a reply that is not a sheet is no sheet.
 */

import { isRecord } from "./json";

export interface BenchLine {
  /** What the line counts: a cut and size, or a band. */
  label: string;
  /** How many and how heavy. */
  value: string;
  /** A stone off the calibrated melee list (a bench cannot buy it from stock). */
  note: string | null;
}

export interface BenchSheet {
  stones: number;
  carat: number;
  grams: number;
  /** The stones, the heaviest cut first (the engine's order), then the bands. */
  lines: BenchLine[];
  /** What the engine found wrong with a stone's record. */
  warnings: string[];
}

/** The most lines and warnings a sheet shows; a drawing with more says how many it left out. */
export const MAX_BENCH_LINES = 40;

/** The most groups and bands of a reply that are read at all. */
const MAX_BENCH_READ = 5_000;

/** Diamond's specific gravity: the stone a sheet does not need to name. */
const DIAMOND_SG = 3.52;

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A number with at most `places` decimals and no trailing zeros ("6.5", "1.03", "3"). */
export function trim(value: number, places: number): string {
  const text = value.toFixed(places);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/** A carat weight as the trade writes it: two decimals, three under a tenth ("1.03 ct", "0.013 ct"). */
export function caratText(carat: number): string {
  return `${carat.toFixed(carat !== 0 && Math.abs(carat) < 0.1 ? 3 : 2)} ct`;
}

/** An alloy as the trade says it: `gold18` is 18k gold. */
export function metalText(metal: string): string {
  const gold = /^gold(\d{1,2})$/.exec(metal);
  if (gold !== null) return `${gold[1]}k gold`;
  return metal === "" || metal === "?" ? "metal" : metal;
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function stoneLine(group: unknown): BenchLine | null {
  if (!isRecord(group)) return null;
  const count = finite(group["count"]);
  const width = finite(group["width"]);
  const carat = finite(group["carat"]);
  if (count === null || width === null || carat === null || count < 1) return null;
  const length = finite(group["length"]) ?? width;
  const cut = typeof group["cut"] === "string" && group["cut"] !== "" ? group["cut"] : "stone";
  const size = Math.abs(length - width) < 1e-6 ? `${trim(width, 2)} mm` : `${trim(length, 2)}×${trim(width, 2)} mm`;
  const sg = finite(group["sg"]);
  const material = sg !== null && Math.abs(sg - DIAMOND_SG) > 1e-6 ? `, SG ${trim(sg, 2)}` : "";
  return {
    label: `${capital(cut.slice(0, 24))} ${size}${material}`,
    // "14 pc · 0.18 ct": the count and the group's whole weight, as the trade's sheet writes them.
    value: `${Math.round(count).toLocaleString("en-US")} pc · ${caratText(carat)}`,
    note: group["calibrated"] === false && width <= 3 ? "Not a calibrated melee size" : null,
  };
}

function bandLine(band: unknown): { line: BenchLine; grams: number } | null {
  if (!isRecord(band)) return null;
  const grams = finite(band["grams"]);
  if (grams === null || grams < 0) return null;
  const size = typeof band["size"] === "string" && band["size"] !== "?" ? `${band["size"].slice(0, 16)} · ` : "";
  const metal = metalText(typeof band["metal"] === "string" ? band["metal"].slice(0, 24) : "");
  return { line: { label: `${capital(metal)} band`, value: `${size}${trim(grams, 2)} g`, note: null }, grams };
}

/** Read a `techsheet` reply; null when it is not one. */
export function parseBench(result: unknown): BenchSheet | null {
  if (!isRecord(result) || !isRecord(result["stones"])) return null;
  const stones = result["stones"];
  const groups = Array.isArray(stones["groups"]) ? stones["groups"] : [];
  const bands = Array.isArray(result["bands"]) ? result["bands"] : [];
  const lines: BenchLine[] = [];
  /** Lines the sheet has and the panel does not show. */
  let left = 0;
  const put = (line: BenchLine): void => {
    if (lines.length < MAX_BENCH_LINES) lines.push(line);
    else left++;
  };
  for (const group of groups.slice(0, MAX_BENCH_READ)) {
    const line = stoneLine(group);
    if (line !== null) put(line);
  }
  let grams = 0;
  for (const band of bands.slice(0, MAX_BENCH_READ)) {
    const read = bandLine(band);
    if (read === null) continue;
    grams += read.grams;
    put(read.line);
  }
  const warnings = (Array.isArray(result["warnings"]) ? result["warnings"] : []).filter((w): w is string => typeof w === "string").slice(0, MAX_BENCH_LINES).map((w) => w.slice(0, 240));
  if (left > 0) warnings.push(`${left.toLocaleString("en-US")} more ${left === 1 ? "line is" : "lines are"} on the full sheet (TECHSHEET).`);
  return { stones: Math.max(0, Math.round(finite(stones["count"]) ?? 0)), carat: Math.max(0, finite(stones["carat"]) ?? 0), grams, lines, warnings };
}

/** The heading's summary: what the piece holds, in one line; empty when it holds no jewelry. */
export function benchSummary(sheet: BenchSheet | null): string {
  if (sheet === null) return "";
  const parts: string[] = [];
  if (sheet.stones > 0) parts.push(`${sheet.stones.toLocaleString("en-US")} ${sheet.stones === 1 ? "stone" : "stones"}, ${caratText(sheet.carat)}`);
  if (sheet.grams > 0) parts.push(`${trim(sheet.grams, 2)} g`);
  return parts.join(" · ");
}
