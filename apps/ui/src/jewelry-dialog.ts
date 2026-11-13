/**
 * The Ring and Gem dialogs' logic: what the engine says a jeweler may choose, the form as it is
 * typed, the JSON the engine's `ring` and `gem` commands take, and where a refusal belongs. The
 * components in `components/JewelryDialog.tsx` draw it; nothing here touches the DOM.
 *
 * Every figure shown is the engine's. Nothing is worked out here: no diameter from a size, no
 * weight from a density, no carat from a factor.
 *
 *   - The choices come from the engine: the alloys and the defaults from the `ring` and `gem`
 *     commands' own parameter lines (`commands()`, the text `CommandSpec::params` holds), the
 *     cuts and the stones from `gemlist`.
 *   - A ring size is shown in every system by asking `ringsizes` for that one size
 *     (`previewRing`), which reads no drawing and changes none.
 *   - The engine has no call that weighs a ring or a stone without drawing it (`ring` and `gem`
 *     report the weight of what they placed). So the dialogs show no weight before OK; a cut's
 *     worked example (`gemlist`) is shown as the example it is, and the weight of what was placed
 *     is in the command's own reply (`placedMessage`), which the shell says.
 *
 * Numbers typed are read by the properties palette's `readNumber`, so a decimal comma means here
 * what it means there. A number the engine would refuse for its size (a wall of zero, a size off
 * the chart) is not judged here: the engine refuses it and the refusal is put beside its field
 * (`refusalField`).
 */

import type { Envelope } from "./facade";
import { asNumber, asString, isRecord } from "./json";
import { numberText, readNumber } from "./props";

/** What the dialogs need of the facade: `AppFacade` is one. */
export interface JewelryEngine {
  execute(command: string, params?: unknown): Envelope;
  commands(): readonly { id: string; params: string }[];
}

/** A choice in a list: the value the engine takes and the words shown for it. */
export interface Choice {
  value: string;
  label: string;
}

/** The choice that sends no value, so the engine uses its own default: shown when it listed none. */
export const ENGINE_DEFAULT = "default";
const DEFAULT_CHOICE: Choice = { value: ENGINE_DEFAULT, label: "Engine default" };

/** The most choices a list takes from the engine. */
export const MAX_CHOICES = 64;
/** The longest name of a choice, and the longest line of the engine's words shown. */
const MAX_NAME = 40;
const MAX_WORDS = 400;
/** The longest parameter line read for its choices. */
const MAX_DOC = 8192;

/** The systems a ring size is given in (`system_param` in `sizes.rs`); the names are the trade's. */
export const RING_SYSTEMS: readonly Choice[] = [
  { value: "us", label: "US" },
  { value: "uk", label: "UK" },
  { value: "eu", label: "EU" },
  { value: "jp", label: "JP" },
  { value: "cn", label: "CN" },
];

/** A size as it is written in each system: the shape of the value, not a claim that they are one finger. */
const SIZE_EXAMPLES: Readonly<Record<string, string>> = { us: "6.5", uk: "M", eu: "52", jp: "12", cn: "12" };

/** The placeholder of the size field for a system. */
export function sizeExample(system: string): string {
  return SIZE_EXAMPLES[system] ?? "";
}

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

// ---------------------------------------------------------------------------------------------
// The engine's parameter lines
// ---------------------------------------------------------------------------------------------

/** What a parameter line says of one parameter: its choices (`a|b|c`) and its default. */
export interface ParamDoc {
  choices: string[];
  fallback: string | null;
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Read one parameter out of a command's parameter line: `metal?: gold24|22|18|platinum (default
 * gold18)` gives the four alloys and `gold18`. A number alone in a list of names continues the
 * name before it (`gold24|22` is `gold24`, `gold22`). A line that does not name the parameter,
 * or is not text, gives no choices and no default.
 */
export function paramDoc(doc: unknown, key: string): ParamDoc {
  const none: ParamDoc = { choices: [], fallback: null };
  if (typeof doc !== "string" || doc.length > MAX_DOC || !/^[a-zA-Z]{1,24}$/.test(key)) return none;
  // The line up to its `→` is what the command takes; after it is what it replies.
  const takes = doc.split("→")[0] ?? "";
  const found = new RegExp(`(?:^|[{,\\s])${escapeRe(key)}\\??:\\s*([^,}(]*)(?:\\(([^)]*)\\))?`).exec(takes);
  if (found === null) return none;
  const choices: string[] = [];
  let stem = "";
  const listed = (found[1] ?? "").trim();
  if (listed.includes("|")) {
    for (const part of listed.split("|").slice(0, MAX_CHOICES * 2)) {
      const word = part.trim().replace(/…$/, "");
      let name: string | null = null;
      if (/^[a-z][a-z0-9]{0,23}$/.test(word)) {
        name = word;
        stem = /^[a-z]+/.exec(word)?.[0] ?? "";
      } else if (/^\d{1,3}$/.test(word) && stem !== "") {
        name = `${stem}${word}`;
      }
      if (name !== null && !choices.includes(name)) choices.push(name);
      if (choices.length >= MAX_CHOICES) break;
    }
  }
  const fallback = /default:?\s+([^,)\s:]+)/.exec(found[2] ?? "")?.[1] ?? null;
  return { choices, fallback: fallback !== null && fallback.length <= MAX_NAME ? fallback : null };
}

/** The parameter line of a command, or "" when the engine lists no such command. */
export function paramsOf(engine: Pick<JewelryEngine, "commands">, id: string): string {
  let rows: readonly { id: string; params: string }[];
  try {
    rows = engine.commands();
  } catch {
    return "";
  }
  if (!Array.isArray(rows)) return "";
  for (const row of rows) {
    if (isRecord(row) && row["id"] === id) return asString(row["params"]) ?? "";
  }
  return "";
}

/** A default the line states as a number, as the field shows it; "" when it states none. */
function numberDefault(doc: string, key: string): string {
  const text = paramDoc(doc, key).fallback;
  if (text === null) return "";
  const read = readNumber(text);
  return read.ok ? numberText(read.value) : "";
}

/** An alloy's name as a bench says it: `gold18` is 18k gold. The value sent stays the engine's. */
export function metalLabel(name: string): string {
  const karat = /^gold(\d{1,2})$/.exec(name);
  return karat === null ? capital(name) : `${karat[1]}k gold`;
}

function capital(name: string): string {
  return name === "" ? "" : `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

// ---------------------------------------------------------------------------------------------
// Typed values
// ---------------------------------------------------------------------------------------------

export const NOT_A_NUMBER = "Enter a number.";
export const EMPTY = "Enter a value.";

type Typed = { ok: true; value: number } | { ok: false; error: string };

/** A typed number, or the words for why it is not one. */
function typed(text: string): Typed {
  const read = readNumber(text);
  if (read.ok) return read;
  return { ok: false, error: read.fault === "empty" ? EMPTY : NOT_A_NUMBER };
}

/** A plan for OK: the JSON to send, or the fields that cannot be sent with the words for each. */
export type Plan<Field extends string> = { ok: true; params: Record<string, unknown> } | { ok: false; errors: Partial<Record<Field, string>> };

/** Read the numbers of a form by field, collecting what cannot be read. */
function readAll<Field extends string>(fields: readonly (readonly [Field, string])[]): { values: Partial<Record<Field, number>>; errors: Partial<Record<Field, string>> } {
  const values: Partial<Record<Field, number>> = {};
  const errors: Partial<Record<Field, string>> = {};
  for (const [field, text] of fields) {
    const read = typed(text);
    if (read.ok) values[field] = read.value;
    else errors[field] = read.error;
  }
  return { values, errors };
}

// ---------------------------------------------------------------------------------------------
// Ring
// ---------------------------------------------------------------------------------------------

export type RingField = "system" | "size" | "wall" | "width" | "metal" | "x" | "y";
export type RingErrors = Partial<Record<RingField, string>>;

export interface RingForm {
  system: string;
  size: string;
  wall: string;
  width: string;
  metal: string;
  x: string;
  y: string;
}

/** What the engine lists for a ring: the alloys, and the form its own defaults make. */
export interface RingChoices {
  metals: readonly Choice[];
  form: RingForm;
}

/** Read the `ring` command's parameter line into the dialog's choices and its opening form. */
export function ringChoices(doc: unknown): RingChoices {
  const line = typeof doc === "string" ? doc : "";
  const metal = paramDoc(line, "metal");
  const metals: Choice[] = metal.choices.map((name) => ({ value: name, label: metalLabel(name) }));
  if (metals.length === 0) metals.push(DEFAULT_CHOICE);
  const system = paramDoc(line, "system").fallback;
  const first = metals[0]?.value ?? ENGINE_DEFAULT;
  return {
    metals,
    form: {
      system: RING_SYSTEMS.some((s) => s.value === system) ? (system ?? "us") : "us",
      size: "",
      wall: numberDefault(line, "wall"),
      width: numberDefault(line, "width"),
      metal: metal.fallback !== null && metals.some((m) => m.value === metal.fallback) ? metal.fallback : first,
      x: "0",
      y: "0",
    },
  };
}

/** Ask the engine what a ring may be made of. */
export function readRingChoices(engine: Pick<JewelryEngine, "commands">): RingChoices {
  return ringChoices(paramsOf(engine, "ring"));
}

/** The size as the engine takes it: a UK letter as text, any other system's as a number. */
function readSize(system: string, text: string): { ok: true; value: number | string } | { ok: false; error: string } {
  if (system !== "uk") return typed(text);
  const letter = typeof text === "string" ? text.normalize("NFC").trim() : "";
  if (letter === "") return { ok: false, error: EMPTY };
  if (letter.length > 8) return { ok: false, error: "Enter a letter, such as M." };
  return { ok: true, value: letter };
}

const systemOf = (form: RingForm): string => (RING_SYSTEMS.some((s) => s.value === form.system) ? form.system : "us");

/** The `ringsizes` call that names the form's size in every system, or null while there is no size to ask about. */
export function ringSizeQuery(form: RingForm): { system: string; size: number | string } | null {
  const system = systemOf(form);
  const size = readSize(system, form.size);
  return size.ok ? { system, size: size.value } : null;
}

/** One finger size as `ringsizes` names it. A field the engine left out is null and is not shown. */
export interface RingSizeRow {
  diameter: number | null;
  circumference: number | null;
  us: string | null;
  uk: string | null;
  eu: number | null;
  jp: number | null;
  cn: number | null;
}

const nameOf = (value: unknown): string | null => {
  const text = asString(value);
  return text === null || text.trim() === "" || text.length > MAX_NAME ? null : text.trim();
};

/** The first size of a `ringsizes` reply, or null when the reply holds none that can be read. */
export function parseRingSize(result: unknown): RingSizeRow | null {
  if (!isRecord(result) || !Array.isArray(result["sizes"])) return null;
  const row: unknown = result["sizes"][0];
  if (!isRecord(row)) return null;
  const us = asNumber(row["us"]);
  const read: RingSizeRow = {
    diameter: asNumber(row["diameter"]) ?? asNumber(row["mm"]),
    circumference: asNumber(row["circumference"]),
    us: nameOf(row["usText"]) ?? (us === null ? null : numberText(us)),
    uk: nameOf(row["uk"]),
    eu: asNumber(row["eu"]),
    jp: asNumber(row["jp"]),
    cn: asNumber(row["cn"]),
  };
  return Object.values(read).some((value) => value !== null) ? read : null;
}

/** A named figure in a dialog's read-out. */
export interface Fact {
  label: string;
  value: string;
}

/** The read-out of a size: the finger in millimetres, then its name in each system. */
export function ringFacts(row: RingSizeRow): Fact[] {
  const facts: Fact[] = [];
  const put = (label: string, value: string | null): void => {
    if (value !== null) facts.push({ label, value });
  };
  const number = (value: number | null, unit = ""): string | null => (value === null ? null : `${numberText(value)}${unit}`);
  put("Inside diameter", number(row.diameter, " mm"));
  put("Inside circumference", number(row.circumference, " mm"));
  put("US", row.us);
  put("UK", row.uk);
  put("EU", number(row.eu));
  put("JP", number(row.jp));
  put("CN", number(row.cn));
  return facts;
}

/** What the engine says of the form's size: nothing asked, the size in every system, or its refusal. */
export type RingPreview = { kind: "none" } | { kind: "sizes"; facts: Fact[] } | { kind: "refused"; error: string };

/** Ask the engine to name the form's size in every system. Reads no drawing and changes none. */
export function previewRing(engine: Pick<JewelryEngine, "execute">, form: RingForm): RingPreview {
  const query = ringSizeQuery(form);
  if (query === null) return { kind: "none" };
  const reply = engine.execute("ringsizes", query);
  if (!reply.ok) return { kind: "refused", error: oneLine(reply.error, MAX_WORDS) };
  const row = parseRingSize(reply.result);
  return row === null ? { kind: "none" } : { kind: "sizes", facts: ringFacts(row) };
}

/** The `ring` command's JSON for the form, or the fields that cannot be sent. */
export function planRing(form: RingForm): Plan<RingField> {
  const system = systemOf(form);
  const size = readSize(system, form.size);
  const { values, errors } = readAll<RingField>([
    ["wall", form.wall],
    ["width", form.width],
    ["x", form.x],
    ["y", form.y],
  ]);
  const found: RingErrors = size.ok ? errors : { size: size.error, ...errors };
  if (!size.ok || Object.keys(found).length > 0) return { ok: false, errors: found };
  const params: Record<string, unknown> = { at: [values.x, values.y], system, size: size.value, wall: values.wall, width: values.width };
  if (form.metal !== ENGINE_DEFAULT && form.metal !== "") params["metal"] = form.metal;
  return { ok: true, params };
}

// ---------------------------------------------------------------------------------------------
// Gem
// ---------------------------------------------------------------------------------------------

export type GemField = "cut" | "stone" | "diameter" | "length" | "width" | "x" | "y";
export type GemErrors = Partial<Record<GemField, string>>;

export interface GemForm {
  cut: string;
  stone: string;
  diameter: string;
  length: string;
  width: string;
  x: string;
  y: string;
}

/** One cut from `gemlist`: whether it is sized by a length and a width, and its worked example. */
export interface GemCut {
  name: string;
  elongated: boolean;
  /** The example stone's size, in the engine's words ("6.5 mm", "8×6 mm"). */
  example: string | null;
  /** The depth the example is cut to, in the engine's words (millimetres). */
  exampleDepth: string | null;
  /** The example's weight in carats, in diamond. */
  exampleCarat: number | null;
}

/** One stone from `gemlist`: its name and its specific gravity. */
export interface GemStone {
  name: string;
  sg: number | null;
}

export interface GemList {
  cuts: GemCut[];
  stones: GemStone[];
}

const cutName = (value: unknown): string | null => {
  const name = asString(value);
  return name !== null && /^[a-z][a-z0-9 _-]{0,39}$/i.test(name) ? name : null;
};

/** A `gemlist` reply, narrowed and capped. Anything that cannot be read is left out. */
export function parseGemList(result: unknown): GemList {
  const list: GemList = { cuts: [], stones: [] };
  if (!isRecord(result)) return list;
  const cuts: unknown = result["cuts"];
  if (Array.isArray(cuts)) {
    for (const row of cuts.slice(0, MAX_CHOICES * 4)) {
      if (!isRecord(row)) continue;
      const name = cutName(row["name"]);
      if (name === null || list.cuts.some((c) => c.name === name)) continue;
      const depth = row["exampleDepth"];
      list.cuts.push({
        name,
        elongated: asString(row["measure"]) !== "diameter",
        example: nameOf(row["example"]),
        exampleDepth: typeof depth === "number" ? (Number.isFinite(depth) ? numberText(depth) : null) : nameOf(depth),
        exampleCarat: asNumber(row["exampleCarat"]),
      });
      if (list.cuts.length >= MAX_CHOICES) break;
    }
  }
  const stones: unknown = result["stones"];
  if (Array.isArray(stones)) {
    for (const row of stones.slice(0, MAX_CHOICES * 4)) {
      const pair: unknown[] = Array.isArray(row) ? row : isRecord(row) ? [row["name"], row["sg"]] : [];
      const name = cutName(pair[0]);
      if (name === null || list.stones.some((s) => s.name === name)) continue;
      list.stones.push({ name, sg: asNumber(pair[1]) });
      if (list.stones.length >= MAX_CHOICES) break;
    }
  }
  return list;
}

/** What the engine lists for a stone: the cuts, the stones, and the form its own defaults make. */
export interface GemChoices {
  list: GemList;
  cuts: readonly Choice[];
  stones: readonly Choice[];
  form: GemForm;
  /** Why the lists are short, when the engine did not give them. */
  note: string | null;
}

/** The dialog's choices and opening form from a `gemlist` reply and the `gem` command's parameter line. */
export function gemChoices(reply: Envelope, doc: unknown): GemChoices {
  const list = reply.ok ? parseGemList(reply.result) : { cuts: [], stones: [] };
  const cuts: Choice[] = list.cuts.map((c) => ({ value: c.name, label: capital(c.name) }));
  const stones: Choice[] = list.stones.map((s) => ({ value: s.name, label: capital(s.name) }));
  if (cuts.length === 0) cuts.push(DEFAULT_CHOICE);
  if (stones.length === 0) stones.push(DEFAULT_CHOICE);
  const pick = (choices: readonly Choice[], key: string): string => {
    const stated = paramDoc(doc, key).fallback;
    return stated !== null && choices.some((c) => c.value === stated) ? stated : (choices[0]?.value ?? ENGINE_DEFAULT);
  };
  let note: string | null = null;
  if (!reply.ok) note = `The engine did not list its cuts: ${oneLine(reply.error, MAX_WORDS)}`;
  else if (list.cuts.length === 0) note = "The engine listed no cuts, so it will use its own.";
  return { list, cuts, stones, note, form: { cut: pick(cuts, "cut"), stone: pick(stones, "stone"), diameter: "", length: "", width: "", x: "0", y: "0" } };
}

/** Ask the engine what a stone may be. */
export function readGemChoices(engine: JewelryEngine): GemChoices {
  return gemChoices(engine.execute("gemlist", {}), paramsOf(engine, "gem"));
}

/** The cut the form names, when the engine listed it. */
export function cutOf(list: GemList, form: GemForm): GemCut | null {
  return list.cuts.find((c) => c.name === form.cut) ?? null;
}

/** Whether the form's cut is sized by a length and a width rather than one diameter. */
export function isElongated(list: GemList, form: GemForm): boolean {
  return cutOf(list, form)?.elongated ?? false;
}

/**
 * What the engine says of the form's cut and stone without drawing anything: the cut's worked
 * example (a size, the depth it is cut to, and that example's weight in diamond) and the stone's
 * specific gravity. It is not the weight of the stone in the form.
 */
export function gemFacts(list: GemList, form: GemForm): Fact[] {
  const facts: Fact[] = [];
  const cut = cutOf(list, form);
  if (cut !== null) {
    if (cut.example !== null) facts.push({ label: "Example size", value: cut.example });
    if (cut.exampleDepth !== null) facts.push({ label: "Its depth", value: `${cut.exampleDepth} mm` });
    if (cut.exampleCarat !== null) facts.push({ label: "Its weight in diamond", value: `${numberText(cut.exampleCarat)} ct` });
  }
  const stone = list.stones.find((s) => s.name === form.stone);
  if (stone !== undefined && stone.sg !== null) facts.push({ label: `Specific gravity, ${stone.name}`, value: numberText(stone.sg) });
  return facts;
}

/** The `gem` command's JSON for the form, or the fields that cannot be sent. */
export function planGem(list: GemList, form: GemForm): Plan<GemField> {
  const long = isElongated(list, form);
  const sizes: (readonly [GemField, string])[] = long
    ? [
        ["length", form.length],
        ["width", form.width],
      ]
    : [["diameter", form.diameter]];
  const { values, errors } = readAll<GemField>([...sizes, ["x", form.x], ["y", form.y]]);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const params: Record<string, unknown> = { at: [values.x, values.y] };
  if (form.cut !== ENGINE_DEFAULT && form.cut !== "") params["cut"] = form.cut;
  if (long) {
    params["length"] = values.length;
    params["width"] = values.width;
  } else {
    params["diameter"] = values.diameter;
  }
  if (form.stone !== ENGINE_DEFAULT && form.stone !== "") params["stone"] = form.stone;
  return { ok: true, params };
}

// ---------------------------------------------------------------------------------------------
// The engine's answer
// ---------------------------------------------------------------------------------------------

/** The parameter a refusal names in backticks, to the field that holds it. */
const RING_KEYS: Readonly<Record<string, RingField>> = { system: "system", size: "size", diameter: "size", wall: "wall", width: "width", metal: "metal", at: "x" };

/**
 * The field a refusal of `ring` belongs beside, or null when it names none (it is then said over
 * the form). The engine names the parameter in backticks; a size off the chart is refused in
 * words that name the value instead.
 */
export function ringRefusalField(error: string): RingField | null {
  if (typeof error !== "string") return null;
  if (/ring sizes?\b/i.test(error)) return "size";
  if (/is not a metal\b/i.test(error)) return "metal";
  for (const found of error.slice(0, MAX_WORDS).matchAll(/`([a-zA-Z]{1,24})`/g)) {
    const field = RING_KEYS[found[1] ?? ""];
    if (field !== undefined) return field;
  }
  return null;
}

/** The field a refusal of `gem` belongs beside, given how the form's cut is sized; null when it names none. */
export function gemRefusalField(error: string, elongated: boolean): GemField | null {
  if (typeof error !== "string") return null;
  const keys: Readonly<Record<string, GemField>> = {
    cut: "cut",
    stone: "stone",
    sg: "stone",
    diameter: elongated ? "length" : "diameter",
    length: elongated ? "length" : "diameter",
    width: elongated ? "width" : "diameter",
    at: "x",
  };
  if (/is not a cut\b/i.test(error)) return "cut";
  if (/is not a stone\b/i.test(error)) return "stone";
  for (const found of error.slice(0, MAX_WORDS).matchAll(/`([a-zA-Z]{1,24})`/g)) {
    const field = keys[found[1] ?? ""];
    if (field !== undefined) return field;
  }
  return null;
}

/** What OK came to: placed, with the engine's own line about it (its weight), or refused. */
export type Placed = { ok: true; message: string | null } | { ok: false; error: string };

/**
 * The line said about what was placed, short enough to be read whole beside the command field
 * and led by the weight: the reply's own grams (`weight.grams`) or carats (`carat`), as the
 * engine gave them. A reply without the figure says its `message`; one without either says nothing.
 */
export function placedMessage(command: "ring" | "gem", result: unknown): string | null {
  if (!isRecord(result)) return null;
  if (command === "ring") {
    const weight = result["weight"];
    const grams = isRecord(weight) ? asNumber(weight["grams"]) : null;
    const metal = isRecord(weight) ? nameOf(weight["metal"]) : null;
    if (grams !== null) return `Ring placed: ${numberText(grams)} g${metal === null ? "" : ` of ${metalLabel(metal).toLowerCase()}`}`;
  } else {
    const carat = asNumber(result["carat"]);
    const cut = nameOf(result["cut"]);
    if (carat !== null) return `${cut === null ? "Stone" : capital(cut)} placed: ${numberText(carat)} ct`;
  }
  const message = asString(result["message"]);
  return message === null || message.trim() === "" ? null : oneLine(message, MAX_WORDS);
}

/** Run a planned command. The engine's refusal comes back in its own words. */
export function place(engine: Pick<JewelryEngine, "execute">, command: "ring" | "gem", params: Record<string, unknown>): Placed {
  const reply = engine.execute(command, params);
  return reply.ok ? { ok: true, message: placedMessage(command, reply.result) } : { ok: false, error: oneLine(reply.error, MAX_WORDS) };
}
