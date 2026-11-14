/**
 * The bench sheet as the sidebar shows it: the engine's `techsheet` reply (the stones of the
 * drawing by cut and size with their carats, and the bands `RING` drew with their weight) read
 * with checked narrowing into rows of a label and a value. Nothing is counted or weighed here:
 * every figure is the engine's, and a reply that is not a sheet is no sheet.
 */

import { isRecord } from "./json";
import type { GemStone } from "./jewelry-dialog";
import { numberText, readNumber } from "./props";

export interface BenchLine {
  /** What the line counts: a cut and size, or a band. */
  label: string;
  /** How many and how heavy. */
  value: string;
  /** Which part of the sheet the line is in: a stone group, or a band of metal. Optional so a
   *  stand-in sheet can leave it out; `parseBench` always sets it. */
  part?: "stone" | "metal";
  /** The value as the sheet's two numeric columns: "14 pc" and "0.18 ct", or the band's size and
   *  "3.86 g" (the size "" when the engine gave none). Set with `part`. */
  cells?: [string, string];
  /** A stone off the calibrated melee list (a bench cannot buy it from stock). */
  note: string | null;
  /** The objects the line counts, by handle: what a press on the line selects. Empty when the
   *  engine named none. */
  handles: string[];
}

export interface BenchSheet {
  stones: number;
  carat: number;
  grams: number;
  /** The stones, the heaviest cut first (the engine's order), then the bands. */
  lines: BenchLine[];
  /** What the engine found wrong with a stone's record. */
  warnings: string[];
  /** The estimated cost, when the engine priced one (a price book is set, or prices were passed).
   *  Optional so a stand-in sheet can leave it out; `parseBench` always sets it (null when none). */
  cost?: BenchCost | null;
  /** The alloys the drawing's bands are in (the engine's own names), for the Price Book editor. */
  alloys?: string[];
  /** The specific gravities of the drawing's stones, so the editor can name their materials. */
  stoneSgs?: number[];
}

/** One line of the cost: what it is, how much of it, and its amount (null when unpriced). */
export interface BenchCostLine {
  what: string;
  /** The quantity in the trade's words ("3.86 g", "18 pc · 0.15 ct"). */
  detail: string;
  /** The money, formatted; null when the engine could not price the line. */
  amount: string | null;
  /** Why a line is unpriced, in the engine's words; null on a priced line. */
  note: string | null;
}

/** The estimated cost of a piece, every figure the engine's and formatted in its currency. */
export interface BenchCost {
  currency: string;
  metal: string;
  stones: string;
  /** The labor figure, formatted; null when the book sets none. */
  labor: string | null;
  total: string;
  /** How many lines the engine could not price (shown but left out of the total). */
  unpriced: number;
  lines: BenchCostLine[];
}

/** The most lines and warnings a sheet shows; a drawing with more says how many it left out. */
export const MAX_BENCH_LINES = 40;

/** The most groups and bands of a reply that are read at all. */
const MAX_BENCH_READ = 5_000;

/** Diamond's specific gravity: the stone a sheet does not need to name. */
const DIAMOND_SG = 3.52;

/** The most handles one line keeps (the engine's own cap on the stones of one command). */
export const MAX_LINE_HANDLES = 5_000;

/** An object handle as the engine writes it: hexadecimal, at most sixteen digits. */
const HANDLE_RE = /^[0-9A-Fa-f]{1,16}$/;

/** The handles in a reply's list, each checked, capped. */
function handlesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value.slice(0, MAX_LINE_HANDLES)) {
    if (typeof item === "string" && HANDLE_RE.test(item)) out.push(item);
  }
  return out;
}

/** Whether every object of a line is in the selection (and the line has any). */
export function lineSelected(line: BenchLine, selection: ReadonlySet<string>): boolean {
  return line.handles.length > 0 && line.handles.every((handle) => selection.has(handle));
}

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

/** A currency code as the reply writes it: a short run of letters or digits. */
const CURRENCY_RE = /^[A-Za-z0-9]{1,8}$/;

/** The decimal places a currency's minor unit has, mirroring the engine; 2 for most. */
const CURRENCY_DIGITS: Readonly<Record<string, number>> = { JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, XOF: 0, XAF: 0, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3, IQD: 3 };

/** The currency's minor-unit places. */
function minorDigits(currency: string): number {
  return CURRENCY_DIGITS[currency.toUpperCase()] ?? 2;
}

/**
 * An amount in its currency, as money: the platform's own formatting for an ISO code ("$161.00",
 * "€40.00"), else the code and the number ("GOLD 1.00"). Never throws on an odd code.
 */
export function formatMoney(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return "";
  const code = (CURRENCY_RE.test(currency) ? currency : "USD").toUpperCase();
  const digits = minorDigits(code);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(digits)}`;
  }
}

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
    part: "stone",
    cells: [`${Math.round(count).toLocaleString("en-US")} pc`, caratText(carat)],
    note: group["calibrated"] === false && width <= 3 ? "Not a calibrated melee size" : null,
    handles: handlesOf(group["handles"]),
  };
}

function bandLine(band: unknown): { line: BenchLine; grams: number } | null {
  if (!isRecord(band)) return null;
  const grams = finite(band["grams"]);
  if (grams === null || grams < 0) return null;
  const named = typeof band["size"] === "string" && band["size"] !== "?" ? band["size"].slice(0, 16) : "";
  const size = named === "" ? "" : `${named} · `;
  const metal = metalText(typeof band["metal"] === "string" ? band["metal"].slice(0, 24) : "");
  const weight = `${trim(grams, 2)} g`;
  return { line: { label: `${capital(metal)} band`, value: `${size}${weight}`, part: "metal", cells: [named, weight], note: null, handles: handlesOf([band["handle"]]) }, grams };
}

/** A prong head's metal on its own line ("Claw prongs · 0.21 g"): the prongs and gallery rail the
 *  band's record weighs apart (`prongGrams`); null for a band without prongs. */
export function prongLine(band: unknown): { line: BenchLine; grams: number } | null {
  if (!isRecord(band)) return null;
  const grams = finite(band["prongGrams"]);
  if (grams === null || grams <= 0) return null;
  const style = typeof band["prongs"] === "string" ? band["prongs"].trim().toLowerCase().slice(0, 12) : "";
  const named = style === "v" ? "V prongs" : style === "" || style === "round" ? "Prongs" : `${capital(style)} prongs`;
  const weight = `${trim(grams, 2)} g`;
  return { line: { label: `${named} and rail`, value: weight, part: "metal", cells: ["", weight], note: null, handles: handlesOf([band["handle"]]) }, grams };
}

/** A channel setting's rails on their own line (`channelGrams`); null for a band without one. */
export function channelLine(band: unknown): { line: BenchLine; grams: number } | null {
  if (!isRecord(band)) return null;
  const grams = finite(band["channelGrams"]);
  if (grams === null || grams <= 0) return null;
  const weight = `${trim(grams, 2)} g`;
  return { line: { label: "Channel rails", value: weight, part: "metal", cells: ["", weight], note: null, handles: handlesOf([band["handle"]]) }, grams };
}

/** A line of the `cost` object, narrowed; null when it cannot be read. */
function costLine(value: unknown, currency: string): BenchCostLine | null {
  if (!isRecord(value)) return null;
  const what = typeof value["what"] === "string" && value["what"] !== "" ? value["what"].slice(0, 80) : "item";
  const unit = typeof value["unit"] === "string" ? value["unit"] : "";
  const qty = finite(value["qty"]);
  const carat = finite(value["carat"]);
  let detail = "";
  if (unit === "g" && qty !== null) detail = `${trim(qty, 2)} g`;
  else if (unit === "ct") detail = `${qty === null ? 0 : Math.round(qty)} pc${carat === null ? "" : ` · ${caratText(carat)}`}`;
  else if (unit === "pc" && qty !== null) detail = `${Math.round(qty)} pc`;
  const amountValue = finite(value["amount"]);
  const amount = amountValue === null ? null : formatMoney(amountValue, currency);
  const note = typeof value["note"] === "string" && value["note"] !== "" ? value["note"].slice(0, 160) : null;
  return { what: capital(what), detail, amount, note };
}

/** Read the `cost` object of a `techsheet` reply; null when the reply carries none. */
export function parseCost(value: unknown): BenchCost | null {
  if (!isRecord(value)) return null;
  const currency = typeof value["currency"] === "string" && CURRENCY_RE.test(value["currency"]) ? value["currency"] : "USD";
  const total = finite(value["total"]);
  if (total === null) return null;
  const money = (v: unknown): string => formatMoney(finite(v) ?? 0, currency);
  const lines: BenchCostLine[] = [];
  for (const raw of (Array.isArray(value["lines"]) ? value["lines"] : []).slice(0, MAX_BENCH_LINES)) {
    const line = costLine(raw, currency);
    if (line !== null) lines.push(line);
  }
  return {
    currency,
    metal: money(value["metal"]),
    stones: money(value["stones"]),
    labor: "labor" in value && finite(value["labor"]) !== null ? money(value["labor"]) : null,
    total: formatMoney(total, currency),
    unpriced: Math.max(0, Math.round(finite(value["unpriced"]) ?? 0)),
    lines,
  };
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
  const stoneSgs: number[] = [];
  for (const group of groups.slice(0, MAX_BENCH_READ)) {
    const line = stoneLine(group);
    if (line === null) continue;
    put(line);
    if (isRecord(group)) {
      const sg = finite(group["sg"]);
      if (sg !== null && sg > 0 && !stoneSgs.some((s) => Math.abs(s - sg) < 1e-3)) stoneSgs.push(sg);
    }
  }
  let grams = 0;
  const alloys: string[] = [];
  for (const band of bands.slice(0, MAX_BENCH_READ)) {
    const read = bandLine(band);
    if (read === null) continue;
    grams += read.grams;
    put(read.line);
    for (const head of [prongLine(band), channelLine(band)]) {
      if (head === null) continue;
      grams += head.grams;
      put(head.line);
    }
    if (isRecord(band) && typeof band["metal"] === "string") {
      const alloy = band["metal"].trim().toLowerCase().slice(0, 24);
      if (alloy !== "" && alloy !== "?" && !alloys.includes(alloy)) alloys.push(alloy);
    }
  }
  const warnings = (Array.isArray(result["warnings"]) ? result["warnings"] : []).filter((w): w is string => typeof w === "string").slice(0, MAX_BENCH_LINES).map((w) => w.slice(0, 240));
  if (left > 0) warnings.push(`${left.toLocaleString("en-US")} more ${left === 1 ? "line is" : "lines are"} on the full sheet (TECHSHEET).`);
  return { stones: Math.max(0, Math.round(finite(stones["count"]) ?? 0)), carat: Math.max(0, finite(stones["carat"]) ?? 0), grams, lines, warnings, cost: parseCost(result["cost"]), alloys, stoneSgs };
}

// ---------------------------------------------------------------------------------------------
// The Price Book editor
// ---------------------------------------------------------------------------------------------

/** One thing the editor asks a price for: the engine's own key, and the words shown for it. */
export interface PriceAsk {
  value: string;
  label: string;
}

/** The metals and stone materials the editor asks about, read from the drawing (never hardcoded). */
export interface PriceAsks {
  metals: PriceAsk[];
  materials: PriceAsk[];
}

/** How a labor figure is charged. */
export type LaborMode = "none" | "flat" | "perStone" | "perGram";

/** The Price Book editor's form: a price per metal and per material, a currency, and one labor figure. */
export interface PriceForm {
  currency: string;
  /** Alloy key → price-per-gram, as typed. */
  metals: Record<string, string>;
  /** Material key (and `default`) → price-per-carat, as typed. */
  stones: Record<string, string>;
  laborMode: LaborMode;
  laborAmount: string;
}

/** The id the editor gives a field, to tie a refusal to it. */
export const metalFieldId = (alloy: string): string => `metal:${alloy}`;
export const stoneFieldId = (material: string): string => `stone:${material}`;
export const LABOR_FIELD = "labor";
export const CURRENCY_FIELD = "currency";

/** The words for a value that is not a price. */
export const NOT_A_PRICE = "Enter a price: a number, 0 or more.";

/**
 * What the editor should ask about, from the bench sheet and the engine's stone list (`gemlist`):
 * the alloys the bands are in, priced per gram, and the materials the stones are, priced per
 * carat (named from their specific gravity), plus a `default` catch-all for any the names miss.
 * Nothing is hardcoded — an empty drawing asks for nothing but the catch-all.
 */
export function priceAsks(sheet: BenchSheet | null, stones: readonly GemStone[]): PriceAsks {
  const metals: PriceAsk[] = (sheet?.alloys ?? []).map((alloy) => ({ value: alloy, label: capital(metalText(alloy)) }));
  const materials: PriceAsk[] = [];
  const add = (value: string, label: string): void => {
    if (!materials.some((m) => m.value === value)) materials.push({ value, label });
  };
  for (const sg of sheet?.stoneSgs ?? []) {
    // A material is only askable by name when the engine would know it; a gravity it does not
    // name is left to the catch-all rather than offered as a key the engine would ignore.
    const match = stones.find((s) => s.sg !== null && Math.abs(s.sg - sg) < 1e-3);
    if (match !== undefined) add(match.name, capital(match.name));
  }
  add("default", "Other stones");
  return { metals, materials };
}

/** A stored price as the field shows it; "" when the book sets none. */
function priceString(value: unknown): string {
  const n = finite(value);
  return n === null ? "" : numberText(n);
}

/** The editor's opening form: the asks, prefilled from the stored book (a `pricebook` reply's `book`). */
export function priceForm(book: unknown, asks: PriceAsks): PriceForm {
  const b = isRecord(book) ? book : {};
  const currency = typeof b["currency"] === "string" && CURRENCY_RE.test(b["currency"]) ? b["currency"].toUpperCase() : "USD";
  const metalPrices = isRecord(b["metal"]) ? b["metal"] : {};
  const stonePrices = isRecord(b["stone"]) ? b["stone"] : {};
  const metals: Record<string, string> = {};
  for (const ask of asks.metals) metals[ask.value] = priceString(metalPrices[ask.value]);
  const stones: Record<string, string> = {};
  for (const ask of asks.materials) stones[ask.value] = priceString(stonePrices[ask.value]);
  const labor = isRecord(b["labor"]) ? b["labor"] : null;
  const mode = labor === null ? "" : String(labor["mode"]);
  const laborMode: LaborMode = mode === "flat" || mode === "perStone" || mode === "perGram" ? mode : "none";
  return { currency, metals, stones, laborMode, laborAmount: labor === null ? "" : priceString(labor["amount"]) };
}

/** A typed price: the number, or that the field is empty or not a price. */
function readPrice(text: string): number | "empty" | "bad" {
  if (typeof text !== "string" || text.trim() === "") return "empty";
  const read = readNumber(text);
  if (!read.ok || !Number.isFinite(read.value) || read.value < 0) return "bad";
  return read.value;
}

/** Whether the form has any price to save (so Save can be held back when it has none). */
export function hasAnyPrice(form: PriceForm): boolean {
  const some = (map: Record<string, string>): boolean => Object.values(map).some((t) => typeof readPrice(t) === "number");
  return some(form.metals) || some(form.stones) || (form.laborMode !== "none" && typeof readPrice(form.laborAmount) === "number");
}

/** The `pricebook {set}` the form makes, or the fields that cannot be sent with the words for each. */
export function planPriceBook(form: PriceForm): { ok: true; params: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const metal: Record<string, number> = {};
  for (const [alloy, text] of Object.entries(form.metals)) {
    const read = readPrice(text);
    if (read === "empty") continue;
    if (read === "bad") errors[metalFieldId(alloy)] = NOT_A_PRICE;
    else metal[alloy] = read;
  }
  const stone: Record<string, number> = {};
  for (const [material, text] of Object.entries(form.stones)) {
    const read = readPrice(text);
    if (read === "empty") continue;
    if (read === "bad") errors[stoneFieldId(material)] = NOT_A_PRICE;
    else stone[material] = read;
  }
  let labor: Record<string, number> | null = null;
  if (form.laborMode !== "none") {
    const read = readPrice(form.laborAmount);
    if (read === "empty") errors[LABOR_FIELD] = "Enter a labor amount.";
    else if (read === "bad") errors[LABOR_FIELD] = NOT_A_PRICE;
    else labor = { [form.laborMode]: read };
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const set: Record<string, unknown> = {};
  if (CURRENCY_RE.test(form.currency)) set["currency"] = form.currency.toUpperCase();
  if (Object.keys(metal).length > 0) set["metal"] = metal;
  if (Object.keys(stone).length > 0) set["stone"] = stone;
  if (labor !== null) set["labor"] = labor;
  return { ok: true, params: { set } };
}

/** The field a `pricebook` refusal belongs beside, or null when it names none. */
export function priceRefusalField(error: string): string | null {
  if (typeof error !== "string") return null;
  const named = /`(metal|stone|labor)\.([a-z0-9]+)`/i.exec(error);
  if (named !== null) return named[1]?.toLowerCase() === "labor" ? LABOR_FIELD : `${named[1]?.toLowerCase()}:${named[2]?.toLowerCase()}`;
  if (/`?currency`?/i.test(error) && /currency/i.test(error)) return CURRENCY_FIELD;
  if (/\blabor\b/i.test(error)) return LABOR_FIELD;
  return null;
}

/** The heading's summary: what the piece holds, in one line; empty when it holds no jewelry. */
export function benchSummary(sheet: BenchSheet | null): string {
  if (sheet === null) return "";
  const parts: string[] = [];
  if (sheet.stones > 0) parts.push(`${sheet.stones.toLocaleString("en-US")} ${sheet.stones === 1 ? "stone" : "stones"}, ${caratText(sheet.carat)}`);
  if (sheet.grams > 0) parts.push(`${trim(sheet.grams, 2)} g`);
  return parts.join(" · ");
}
