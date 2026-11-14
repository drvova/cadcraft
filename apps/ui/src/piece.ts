/**
 * The Piece section's logic: the engine's `piece` reply read with checked narrowing, the rows a
 * kind of ring shows, what typed text becomes (a patch for `piece`, a refusal, or nothing), and
 * the row an engine refusal belongs on. `components/PiecePanel.tsx` draws it; nothing here
 * touches the DOM.
 *
 * Every jewelry figure shown is the engine's: the size in each system, the grams, the carats, the
 * stone count and the checks come from the reply, and nothing here works one out from another. A
 * typed number is only read (`readNumber`, the properties palette's reader, so a decimal comma
 * means here what it means there); whether it is in range is the engine's to say, and its refusal
 * names the parameter in backticks (`refusalRow` finds the row).
 *
 * The contract (`crates/engine/src/cmd/jewelry/piece_params.rs`): `piece {query: true}` changes
 * nothing and answers `{piece: null | P}`; `{remove: true}` answers `{piece: null}`; any other
 * call builds or rebuilds with the given keys merged over the stored parameters. `P` carries
 * `params` (`kind`, `size` as a US number with `sizeText`, `sizeSystem`, `wall`, `width`,
 * `profile`, `metal`, `cut`, `stoneLength`, `stoneWidth`, `stone`, `prongs`, `halo` false or a
 * melee width, `melee`, `count` null or a number, `gap`), `size` (the finger in every system),
 * `metal` (`name`, `density`, `grams`), `stones` (`count`, `carat`), `checks` and `handles`.
 */

import { caratText, trim } from "./bench";
import type { Envelope } from "./facade";
import { asBool, asNumber, asString, isRecord } from "./json";
import { RING_SYSTEMS, metalLabel, paramsOf, readGemChoices, ringChoices, ENGINE_DEFAULT, type Choice, type JewelryEngine } from "./jewelry-dialog";
import { numberText, readNumber, type DraftVerdict } from "./props";

export type PieceKind = "band" | "solitaire" | "threestone" | "eternity" | "halfeternity" | "dome" | "signet";

/** The kinds the engine builds, in the order the section offers them. */
export const PIECE_KINDS: readonly Choice[] = [
  { value: "band", label: "Band" },
  { value: "solitaire", label: "Solitaire" },
  { value: "threestone", label: "Three-stone" },
  { value: "eternity", label: "Eternity" },
  { value: "halfeternity", label: "Half eternity" },
  { value: "dome", label: "Dome" },
  { value: "signet", label: "Signet" },
];

/** How a solitaire's or a three-stone's stones are held (`head` in `heads.rs`). */
export const PIECE_HEADS: readonly Choice[] = [
  { value: "prong", label: "Prongs" },
  { value: "bezel", label: "Bezel" },
];

/** A signet's face (`face` in `kinds.rs`). */
export const PIECE_FACES: readonly Choice[] = [
  { value: "oval", label: "Oval" },
  { value: "round", label: "Round" },
  { value: "cushion", label: "Cushion" },
  { value: "rectangle", label: "Rectangle" },
];

/** The band's outside shapes (`Profile` in `piece_params.rs`). */
export const PIECE_PROFILES: readonly Choice[] = [
  { value: "flat", label: "Flat" },
  { value: "dome", label: "Dome" },
  { value: "comfort", label: "Comfort fit" },
  { value: "court", label: "Court" },
  { value: "knife", label: "Knife edge" },
  { value: "bevel", label: "Bevel" },
  { value: "concave", label: "Concave" },
];

/** What a count reads, and what is typed, when the engine fits as many stones as go around. */
export const AUTO = "auto";

/** The longest name read (an alloy, a cut, a size's letter) and the longest sentence (a check, a refusal). */
const MAX_NAME = 40;
const MAX_WORDS = 400;
/** The most checks shown, and the most handles kept. */
export const MAX_CHECKS = 32;
export const MAX_PIECE_HANDLES = 5_000;

const HANDLE_RE = /^[0-9A-Fa-f]{1,16}$/;

export interface PieceParams {
  kind: PieceKind;
  /** The size as the engine writes it in US ("6½"); null when it gave none. */
  sizeText: string | null;
  /** The system the size was last given in. */
  sizeSystem: string;
  wall: number | null;
  width: number | null;
  profile: string;
  metal: string;
  cut: string;
  stoneLength: number | null;
  stoneWidth: number | null;
  stone: string;
  prongs: number | null;
  /** The halo's melee width; null when the piece has no halo. */
  halo: number | null;
  melee: number | null;
  /** How many stones were asked for; null when the engine fits them. */
  count: number | null;
  gap: number | null;
  /** A three-stone ring's side stones: their width (null: the engine's share of the centre's) and prongs. */
  sideWidth: number | null;
  sideProngs: number | null;
  /** How the stones are held (prong or bezel), and a bezel's wall and height over the girdle (null: the engine's). */
  head: string;
  bezelWall: number | null;
  bezelHeight: number | null;
  /** A dome ring's or a signet's top (null: the engine's share of the bottom). */
  topWidth: number | null;
  topWall: number | null;
  /** A signet's face and its size. */
  face: string;
  faceLength: number | null;
  faceWidth: number | null;
}

/** The finger in every system, each as it is shown; null where the engine gave none. */
export interface PieceSize {
  diameter: number | null;
  us: string | null;
  uk: string | null;
  eu: string | null;
  jp: string | null;
  cn: string | null;
}

export interface PieceCheck {
  id: string;
  ok: boolean;
  message: string;
}

export interface Piece {
  params: PieceParams;
  handles: string[];
  size: PieceSize;
  metal: { name: string; grams: number | null };
  stones: { count: number | null; carat: number | null };
  checks: PieceCheck[];
}

/**
 * What the section shows: the engine has no `piece` command (`unavailable`), the drawing has no
 * piece (`none`), or the piece.
 */
export type PieceState = { kind: "unavailable" } | { kind: "none" } | { kind: "piece"; piece: Piece };

export const NO_PIECE: PieceState = { kind: "none" };

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** A short name (letters first, as the engine's own names are), lower case; "" when it is not one. */
const nameOf = (value: unknown): string => {
  const text = asString(value);
  return text !== null && /^[a-z][a-z0-9 _-]{0,39}$/i.test(text.trim()) ? text.trim().toLowerCase() : "";
};

/** Words the engine wrote, on one line and clipped; null when there are none. */
const wordsOf = (value: unknown, max: number): string | null => {
  const text = asString(value);
  if (text === null) return null;
  const flat = clip(text.slice(0, max * 4), max);
  return flat === "" ? null : flat;
};

/** A length or a count that can be one: finite and not below zero. */
const sizeOf = (value: unknown): number | null => {
  const n = asNumber(value);
  return n !== null && n >= 0 && n <= 1e9 ? n : null;
};

const wholeOf = (value: unknown): number | null => {
  const n = sizeOf(value);
  return n === null ? null : Math.round(n);
};

function kindOf(value: unknown): PieceKind | null {
  const name = nameOf(value);
  return PIECE_KINDS.some((k) => k.value === name) ? (name as PieceKind) : null;
}

/** A size in a system that numbers its sizes, as it is shown. */
const sizeNumber = (value: unknown): string | null => {
  const n = sizeOf(value);
  return n === null ? null : numberText(n);
};

function parseParams(value: unknown): PieceParams | null {
  if (!isRecord(value)) return null;
  const kind = kindOf(value["kind"]);
  if (kind === null) return null;
  const system = nameOf(value["sizeSystem"]);
  const halo = value["halo"];
  return {
    kind,
    sizeText: wordsOf(value["sizeText"], MAX_NAME),
    sizeSystem: RING_SYSTEMS.some((s) => s.value === system) ? system : "us",
    wall: sizeOf(value["wall"]),
    width: sizeOf(value["width"]),
    profile: nameOf(value["profile"]),
    metal: nameOf(value["metal"]),
    cut: nameOf(value["cut"]),
    stoneLength: sizeOf(value["stoneLength"]),
    stoneWidth: sizeOf(value["stoneWidth"]),
    stone: nameOf(value["stone"]),
    prongs: wholeOf(value["prongs"]),
    halo: asBool(halo) === true ? null : sizeOf(halo),
    melee: sizeOf(value["melee"]),
    count: wholeOf(value["count"]),
    gap: sizeOf(value["gap"]),
    sideWidth: sizeOf(value["sideWidth"]),
    sideProngs: wholeOf(value["sideProngs"]),
    head: nameOf(value["head"]) || "prong",
    bezelWall: sizeOf(value["bezelWall"]),
    bezelHeight: sizeOf(value["bezelHeight"]),
    topWidth: sizeOf(value["topWidth"]),
    topWall: sizeOf(value["topWall"]),
    face: nameOf(value["face"]) || "oval",
    faceLength: sizeOf(value["faceLength"]),
    faceWidth: sizeOf(value["faceWidth"]),
  };
}

function parseChecks(value: unknown): PieceCheck[] {
  if (!Array.isArray(value)) return [];
  const out: PieceCheck[] = [];
  for (const item of value.slice(0, MAX_CHECKS * 4)) {
    if (!isRecord(item)) continue;
    const ok = asBool(item["ok"]);
    const id = wordsOf(item["id"], MAX_NAME);
    const message = wordsOf(item["message"], MAX_WORDS) ?? id;
    // A check that does not say whether it passed is not shown as either.
    if (ok === null || message === null) continue;
    out.push({ id: id ?? "", ok, message });
    if (out.length >= MAX_CHECKS) break;
  }
  return out;
}

function parseHandles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value.slice(0, MAX_PIECE_HANDLES)) {
    if (typeof item === "string" && HANDLE_RE.test(item)) out.push(item);
  }
  return out;
}

/** One piece as the engine describes it; null when the record is not one. Never throws. */
export function parsePiece(value: unknown): Piece | null {
  if (!isRecord(value)) return null;
  const params = parseParams(value["params"]);
  if (params === null) return null;
  const size = isRecord(value["size"]) ? value["size"] : {};
  const metal = isRecord(value["metal"]) ? value["metal"] : {};
  const stones = isRecord(value["stones"]) ? value["stones"] : {};
  return {
    params,
    handles: parseHandles(value["handles"]),
    size: {
      diameter: sizeOf(size["diameter"]) ?? sizeOf(size["mm"]),
      us: wordsOf(size["usText"], MAX_NAME) ?? params.sizeText ?? sizeNumber(size["us"]),
      uk: wordsOf(size["uk"], MAX_NAME),
      eu: sizeNumber(size["eu"]),
      jp: sizeNumber(size["jp"]),
      cn: sizeNumber(size["cn"]),
    },
    metal: { name: nameOf(metal["name"]) || params.metal, grams: sizeOf(metal["grams"]) },
    stones: { count: wholeOf(stones["count"]), carat: sizeOf(stones["carat"]) },
    checks: parseChecks(value["checks"]),
  };
}

/** Whether a refusal says the engine has no such command (`unknown command \`piece\``). */
export function isUnknownCommand(error: unknown): boolean {
  return typeof error === "string" && /^\s*unknown command\b/i.test(error);
}

/**
 * The section's state from a `piece` reply (a query, a build or a removal). A refusal that is
 * not "no such command" leaves `held` as it was: the engine changed nothing.
 */
export function parsePieceReply(reply: Envelope, held: PieceState = NO_PIECE): PieceState {
  if (!reply.ok) return isUnknownCommand(reply.error) ? { kind: "unavailable" } : held;
  if (!isRecord(reply.result)) return NO_PIECE;
  const piece = parsePiece(reply.result["piece"]);
  return piece === null ? NO_PIECE : { kind: "piece", piece };
}

// ---------------------------------------------------------------------------------------------
// What the engine lets a jeweler choose
// ---------------------------------------------------------------------------------------------

export interface PieceChoices {
  metals: readonly Choice[];
  cuts: readonly Choice[];
  stones: readonly Choice[];
  /** The cuts sized by one diameter (a round): their stone is one row, not a length and a width. */
  round: readonly string[];
}

export const NO_CHOICES: PieceChoices = { metals: [], cuts: [], stones: [], round: [] };

const listed = (choices: readonly Choice[]): Choice[] => choices.filter((c) => c.value !== ENGINE_DEFAULT && c.value !== "");

/**
 * Ask the engine what a piece may be made of, the way the Ring and Gem dialogs do: the alloys
 * from the command's own parameter line (`piece`'s, or `ring`'s when `piece`'s names none), the
 * cuts and the stones from `gemlist`. A list the engine did not give is empty, and the row then
 * shows only the value the piece holds.
 */
export function readPieceChoices(engine: JewelryEngine): PieceChoices {
  let metals = listed(ringChoices(paramsOf(engine, "piece")).metals);
  if (metals.length === 0) metals = listed(ringChoices(paramsOf(engine, "ring")).metals);
  const gems = readGemChoices(engine);
  return {
    metals,
    cuts: listed(gems.cuts),
    stones: listed(gems.stones),
    round: gems.list.cuts.filter((c) => !c.elongated).map((c) => c.name),
  };
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

/**
 * How a row is edited: a pick from a list, a typed length, a typed whole number, the ring size,
 * the stone count (a whole number or "auto"), or a tick.
 */
export type PieceRowKind = "choice" | "number" | "whole" | "size" | "count" | "tick";

export interface PieceRow {
  /** The row's id: the parameter it edits (`haloWidth` is `halo` given as a width). */
  key: string;
  /** The label, with the unit said once ("Wall, mm"). */
  label: string;
  /** The value as shown: a number's digits, a choice's value, "true"/"false" for a tick. */
  value: string;
  kind: PieceRowKind;
  choices?: readonly Choice[];
  /** The stone of a round cut: its one diameter is sent as both the length and the width. */
  both?: boolean;
}

const systemOf = (value: string): string => (RING_SYSTEMS.some((s) => s.value === value) ? value : "us");

const systemLabel = (system: string): string => RING_SYSTEMS.find((s) => s.value === system)?.label ?? system.toUpperCase();

/** The piece's size as the engine names it in `system`; "" when it gave none. */
export function sizeIn(piece: Piece, system: string): string {
  switch (systemOf(system)) {
    case "uk":
      return piece.size.uk ?? "";
    case "eu":
      return piece.size.eu ?? "";
    case "jp":
      return piece.size.jp ?? "";
    case "cn":
      return piece.size.cn ?? "";
    default:
      return piece.size.us ?? "";
  }
}

const num = (value: number | null): string => (value === null ? "" : numberText(value));

const capital = (name: string): string => (name === "" ? "" : `${name.charAt(0).toUpperCase()}${name.slice(1)}`);

/** A choice list that names the held value as the bench does, when the engine's list lacks it. */
function withHeld(choices: readonly Choice[], held: string, label: (name: string) => string): readonly Choice[] {
  if (held === "" || choices.some((c) => c.value === held)) return choices;
  return [{ value: held, label: label(held) }, ...choices];
}

/**
 * The rows of a piece, in the order a bench reads them: what it is and the finger, the band, then
 * what its kind adds (a solitaire's stone, head and halo; an eternity's stones). `system` is the
 * size system the section shows.
 */
export function pieceRows(piece: Piece, choices: PieceChoices, system: string): PieceRow[] {
  const p = piece.params;
  const shown = systemOf(system);
  const rows: PieceRow[] = [
    { key: "kind", label: "Kind", value: p.kind, kind: "choice", choices: PIECE_KINDS },
    { key: "system", label: "Size system", value: shown, kind: "choice", choices: RING_SYSTEMS },
    { key: "size", label: "Size", value: sizeIn(piece, shown), kind: "size" },
    { key: "wall", label: "Wall, mm", value: num(p.wall), kind: "number" },
    { key: "width", label: "Width, mm", value: num(p.width), kind: "number" },
    { key: "profile", label: "Profile", value: p.profile, kind: "choice", choices: withHeld(PIECE_PROFILES, p.profile, capital) },
    { key: "metal", label: "Metal", value: p.metal, kind: "choice", choices: withHeld(choices.metals, p.metal, metalLabel) },
  ];
  if (p.kind === "band") return rows;
  if (p.kind === "dome" || p.kind === "signet") {
    // The top of a tapered shank: empty reads as the engine's own share of the bottom.
    rows.push({ key: "topWidth", label: "Top width, mm", value: num(p.topWidth), kind: "number" });
    if (p.kind === "dome") {
      rows.push({ key: "topWall", label: "Top wall, mm", value: num(p.topWall), kind: "number" });
      return rows;
    }
    rows.push({ key: "face", label: "Face", value: p.face, kind: "choice", choices: withHeld(PIECE_FACES, p.face, capital) });
    rows.push({ key: "faceLength", label: "Face length, mm", value: num(p.faceLength), kind: "number" });
    rows.push({ key: "faceWidth", label: "Face width, mm", value: num(p.faceWidth), kind: "number" });
    rows.push({ key: "topWall", label: "Face height, mm", value: num(p.topWall), kind: "number" });
    return rows;
  }
  rows.push({ key: "cut", label: "Cut", value: p.cut, kind: "choice", choices: withHeld(choices.cuts, p.cut, capital) });
  rows.push({ key: "stone", label: "Stone", value: p.stone, kind: "choice", choices: withHeld(choices.stones, p.stone, capital) });
  if (p.kind === "solitaire" || p.kind === "threestone") {
    if (choices.round.includes(p.cut)) {
      rows.push({ key: "stoneWidth", label: "Stone, mm", value: num(p.stoneWidth), kind: "number", both: true });
    } else {
      rows.push({ key: "stoneLength", label: "Stone length, mm", value: num(p.stoneLength), kind: "number" });
      rows.push({ key: "stoneWidth", label: "Stone width, mm", value: num(p.stoneWidth), kind: "number" });
    }
    rows.push({ key: "head", label: "Head", value: p.head, kind: "choice", choices: withHeld(PIECE_HEADS, p.head, capital) });
    const bezel = p.head === "bezel";
    if (bezel) {
      rows.push({ key: "bezelWall", label: "Bezel wall, mm", value: num(p.bezelWall), kind: "number" });
      rows.push({ key: "bezelHeight", label: "Bezel height, mm", value: num(p.bezelHeight), kind: "number" });
    } else {
      rows.push({ key: "prongs", label: "Prongs", value: num(p.prongs), kind: "whole" });
    }
    if (p.kind === "threestone") {
      // The side stones: empty reads as the engine's own share of the centre stone.
      rows.push({ key: "sideWidth", label: "Side stones, mm", value: num(p.sideWidth), kind: "number" });
      if (!bezel) rows.push({ key: "sideProngs", label: "Side prongs", value: num(p.sideProngs), kind: "whole" });
      return rows;
    }
    rows.push({ key: "halo", label: "Halo", value: p.halo === null ? "false" : "true", kind: "tick" });
    if (p.halo !== null) {
      rows.push({ key: "haloWidth", label: "Halo stones, mm", value: num(p.halo), kind: "number" });
      rows.push({ key: "gap", label: "Gap, mm", value: num(p.gap), kind: "number" });
    }
    return rows;
  }
  rows.push({ key: "melee", label: "Stones, mm", value: num(p.melee), kind: "number" });
  rows.push({ key: "count", label: "Count", value: p.count === null ? AUTO : numberText(p.count), kind: "count" });
  rows.push({ key: "gap", label: "Gap, mm", value: num(p.gap), kind: "number" });
  return rows;
}

/** The heading's summary: what the piece is and its size ("Solitaire · US 6½"). */
export function pieceHeading(state: PieceState, system?: string): string {
  if (state.kind !== "piece") return "";
  const p = state.piece.params;
  const shown = systemOf(system ?? p.sizeSystem);
  const size = sizeIn(state.piece, shown);
  const kind = PIECE_KINDS.find((k) => k.value === p.kind)?.label ?? capital(p.kind);
  return size === "" ? kind : `${kind} · ${systemLabel(shown)} ${size}`;
}

// ---------------------------------------------------------------------------------------------
// The engine's results
// ---------------------------------------------------------------------------------------------

export interface PieceFact {
  label: string;
  value: string;
}

/**
 * What the engine worked out for the piece, read-only: the metal's weight, the stones and their
 * carats, the finger's inside diameter, and the size in the systems the section is not showing.
 * A figure the engine left out is not shown.
 */
export function pieceFacts(piece: Piece, system: string): PieceFact[] {
  const facts: PieceFact[] = [];
  const shown = systemOf(system);
  if (piece.metal.grams !== null) {
    const alloy = piece.metal.name === "" ? "" : ` ${metalLabel(piece.metal.name).toLowerCase()}`;
    facts.push({ label: "Metal weight", value: `${trim(piece.metal.grams, 2)} g${alloy}` });
  }
  if (piece.stones.count !== null && piece.stones.count > 0) {
    const carat = piece.stones.carat === null ? "" : ` · ${caratText(piece.stones.carat)}`;
    facts.push({ label: "Stones", value: `${piece.stones.count.toLocaleString("en-US")} pc${carat}` });
  }
  if (piece.size.diameter !== null) facts.push({ label: "Inside diameter", value: `${trim(piece.size.diameter, 2)} mm` });
  const others: string[] = [];
  for (const s of RING_SYSTEMS) {
    const size = sizeIn(piece, s.value);
    // A no-break space keeps a system with its size when the line wraps.
    if (s.value !== shown && size !== "") others.push(`${s.label} ${size}`);
  }
  if (others.length > 0) facts.push({ label: "Also", value: others.join(" · ") });
  return facts;
}

// ---------------------------------------------------------------------------------------------
// The section's layout: the summary a jeweller scans, the parameters in groups
// ---------------------------------------------------------------------------------------------

/** One figure of the summary: the number large, what it is small under it. */
export interface PieceTile {
  /** What the figure is ("Size", "Metal", "Stones"), said first to a screen reader. */
  label: string;
  /** The figure ("US 6", "3.53 g", "2.54 ct"). */
  value: string;
  /** What qualifies it ("16.51 mm", "18k gold", "52 pc"); "" when nothing does. */
  detail: string;
}

export interface PieceSummary {
  tiles: PieceTile[];
  /** The centre stone in words ("6.5 mm round diamond, 6 prongs"); null for a band or an eternity. */
  centre: string | null;
}

/**
 * The facts a jeweller scans first, each the engine's figure: the size (with the finger's inside
 * diameter), the metal's weight (with the alloy), the stones' weight (with how many), and the
 * centre stone of a solitaire or a three-stone. A figure the engine left out is not a tile.
 */
export function pieceSummary(piece: Piece, system: string): PieceSummary {
  const shown = systemOf(system);
  const p = piece.params;
  const tiles: PieceTile[] = [];
  const size = sizeIn(piece, shown);
  if (size !== "") tiles.push({ label: "Size", value: `${systemLabel(shown)} ${size}`, detail: piece.size.diameter === null ? "" : `${trim(piece.size.diameter, 2)} mm` });
  if (piece.metal.grams !== null) tiles.push({ label: "Metal", value: `${trim(piece.metal.grams, 2)} g`, detail: piece.metal.name === "" ? "" : metalLabel(piece.metal.name) });
  if (piece.stones.count !== null && piece.stones.count > 0 && piece.stones.carat !== null) {
    tiles.push({ label: "Stones", value: caratText(piece.stones.carat), detail: `${piece.stones.count.toLocaleString("en-US")} pc` });
  }
  let centre: string | null = null;
  if ((p.kind === "solitaire" || p.kind === "threestone") && p.stoneWidth !== null) {
    const long = p.stoneLength !== null && Math.abs(p.stoneLength - p.stoneWidth) > 1e-6 ? `${trim(p.stoneLength, 2)}×` : "";
    const words = [`${long}${trim(p.stoneWidth, 2)} mm`, p.cut, p.stone].filter((w) => w !== "").join(" ");
    centre = p.head === "bezel" ? `${words}, bezel` : p.prongs === null ? words : `${words}, ${numberText(p.prongs)} prongs`;
  }
  return { tiles, centre };
}

/** The folded line of the passing checks: "All 6 checks pass" when none fails, else "5 checks
 *  pass" (the failing ones stand above, under the summary). */
export function passingLine(passing: number, failing: number): string {
  const noun = passing === 1 ? "check passes" : "checks pass";
  if (failing === 0) return passing === 1 ? "The check passes" : `All ${passing.toLocaleString("en-US")} ${noun}`;
  return `${passing.toLocaleString("en-US")} ${noun}`;
}

/** A group of the parameters, under its name. */
export interface PieceGroup {
  name: "Ring" | "Band" | "Stones" | "Head";
  rows: PieceRow[];
}

/** The group each parameter is read in; the gap is the stones' on an eternity and the head's
 *  (the halo's) otherwise. */
function groupOf(row: PieceRow, kind: string): PieceGroup["name"] {
  switch (row.key) {
    case "kind":
    case "system":
    case "size":
      return "Ring";
    case "wall":
    case "width":
    case "profile":
    case "metal":
      return "Band";
    case "topWidth":
    case "topWall":
    case "face":
    case "faceLength":
    case "faceWidth":
      return "Band";
    case "head":
    case "bezelWall":
    case "bezelHeight":
    case "prongs":
    case "sideProngs":
    case "halo":
    case "haloWidth":
      return "Head";
    case "gap":
      return kind === "eternity" || kind === "halfeternity" ? "Stones" : "Head";
    default:
      return "Stones";
  }
}

const GROUP_ORDER: readonly PieceGroup["name"][] = ["Ring", "Band", "Stones", "Head"];

/**
 * The rows in the groups a bench reads them in: the ring (what it is and the finger), the band,
 * the stones, the head that holds them. A group with no rows is left out; inside a group the
 * rows keep `pieceRows`'s order.
 */
export function pieceGroups(rows: readonly PieceRow[], kind: string): PieceGroup[] {
  return GROUP_ORDER.map((name) => ({ name, rows: rows.filter((row) => groupOf(row, kind) === name) })).filter((g) => g.rows.length > 0);
}

/**
 * A row's name as the section draws it, the unit moved beside the value: "Wall, mm" is "Wall".
 * A round stone's one diameter ("Stone, mm") would then read as a second "Stone" under the
 * stone's material, so it is "Stone size". The control keeps the full label as its name.
 */
export function rowShownName(row: PieceRow): string {
  return row.both === true ? "Stone size" : rowName(row);
}

/** A row's unit as the label says it ("Wall, mm" is "mm"); "" when it has none. */
export function rowUnit(row: PieceRow): string {
  return /,\s*mm$/.test(row.label) ? "mm" : "";
}

/** How many checks failed: the heading of the checks says it in words. */
export function failedChecks(piece: Piece): number {
  return piece.checks.filter((c) => !c.ok).length;
}

// ---------------------------------------------------------------------------------------------
// Typed values
// ---------------------------------------------------------------------------------------------

/** A row's name without its unit ("Wall, mm" is "Wall"), for a sentence about it. */
export function rowName(row: PieceRow): string {
  return row.label.replace(/,\s*mm$/, "");
}

/** A US size written with a fraction ("6½", "6 1/2") as the number the engine takes ("6.5"). */
function plainFraction(text: string): string {
  const found = /^(\d{1,2})\s*(¼|½|¾|1\/4|1\/2|3\/4)$/.exec(text.normalize("NFC").trim());
  if (found === null) return text;
  const part = found[2] ?? "";
  const decimals = part === "¼" || part === "1/4" ? "25" : part === "½" || part === "1/2" ? "5" : "75";
  return `${found[1]}.${decimals}`;
}

function judgeSize(row: PieceRow, draft: string, system: string): DraftVerdict {
  const shown = systemOf(system);
  const text = draft.normalize("NFC").trim();
  if (text === "" || text === row.value.trim()) return { kind: "keep" };
  if (shown === "uk") {
    if (text.length > 8 || !/^[a-z]/i.test(text)) return { kind: "refuse", message: "A UK size is a letter, such as M or M½" };
    if (text.toUpperCase() === row.value.trim().toUpperCase()) return { kind: "keep" };
    return { kind: "send", patch: { system: shown, size: text } };
  }
  const read = readNumber(shown === "us" ? plainFraction(text) : text);
  if (!read.ok) return { kind: "refuse", message: `A ${systemLabel(shown)} size is a number, such as ${shown === "us" ? "6.5" : shown === "eu" ? "52" : "12"}` };
  return { kind: "send", patch: { system: shown, size: read.value } };
}

/**
 * Judges `draft` against the row it was typed into or picked in. An unchanged value, an emptied
 * number and the same number written another way keep the engine's value; text that cannot be
 * the row's kind of value is refused in words; everything else is the patch `piece` takes. A
 * number's range is the engine's to refuse. `system` is the size system the section shows (the
 * size is sent in it); the size-system row itself changes only what is shown and sends nothing.
 */
export function judgePieceDraft(row: PieceRow, draft: string, system = "us"): DraftVerdict {
  if (typeof draft !== "string") return { kind: "keep" };
  if (draft === row.value) return { kind: "keep" };
  switch (row.kind) {
    case "size":
      return judgeSize(row, draft, system);
    case "tick":
      return draft === "true" || draft === "false" ? { kind: "send", patch: { halo: draft === "true" } } : { kind: "keep" };
    case "choice":
      if (row.key === "system" || draft.trim() === "") return { kind: "keep" };
      return { kind: "send", patch: { [row.key]: draft } };
    case "count": {
      const text = draft.trim().toLowerCase();
      if (text === "" || text === AUTO) return row.value === AUTO ? { kind: "keep" } : { kind: "send", patch: { count: null } };
      const read = readNumber(text);
      if (!read.ok || !Number.isInteger(read.value)) return { kind: "refuse", message: `${rowName(row)} takes a whole number, or ${AUTO}` };
      const held = readNumber(row.value);
      if (held.ok && held.value === read.value) return { kind: "keep" };
      return { kind: "send", patch: { count: read.value } };
    }
    case "whole":
    case "number": {
      const read = readNumber(draft);
      if (!read.ok) {
        if (read.fault === "empty") return { kind: "keep" };
        if (read.fault === "unit") return { kind: "refuse", message: `${rowName(row)} takes a number without a unit` };
        return { kind: "refuse", message: `${rowName(row)} needs a number` };
      }
      if (row.kind === "whole" && !Number.isInteger(read.value)) return { kind: "refuse", message: `${rowName(row)} takes a whole number` };
      const held = readNumber(row.value);
      if (held.ok && held.value === read.value) return { kind: "keep" };
      if (row.key === "haloWidth") return { kind: "send", patch: { halo: read.value } };
      if (row.both === true) return { kind: "send", patch: { stoneWidth: read.value, stoneLength: read.value } };
      return { kind: "send", patch: { [row.key]: read.value } };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The engine's refusal
// ---------------------------------------------------------------------------------------------

/** The engine's refusal on one line, clipped, as it is said. */
export function refusalWords(error: unknown): string {
  return typeof error === "string" ? clip(error.slice(0, MAX_WORDS * 4), MAX_WORDS) : "";
}

/**
 * The row an engine refusal belongs on, among the rows shown; null when it names none of them
 * (it is then said through the shell's notice only). The engine names the parameter in backticks
 * (`wall` must be…); a size off the chart, an alloy, a cut and a stone it does not know are
 * refused in words that put the value in the backticks instead.
 */
export function refusalRow(error: unknown, rows: readonly PieceRow[]): string | null {
  if (typeof error !== "string") return null;
  const has = (key: string): boolean => rows.some((r) => r.key === key);
  const first = (...keys: string[]): string | null => keys.find(has) ?? null;
  const text = error.slice(0, MAX_WORDS);
  if (/ring sizes?\b/i.test(text)) return first("size");
  if (/is not a metal\b/i.test(text)) return first("metal");
  if (/is not a cut\b/i.test(text)) return first("cut");
  if (/is not a stone\b/i.test(text)) return first("stone");
  for (const found of text.matchAll(/`([a-zA-Z]{1,24})`/g)) {
    const key = found[1] ?? "";
    let row: string | null;
    if (key === "halo") row = first("haloWidth", "halo");
    else if (key === "stoneLength") row = first("stoneLength", "stoneWidth");
    else if (key === "system") row = first("size");
    else row = first(key);
    if (row !== null) return row;
  }
  return null;
}
