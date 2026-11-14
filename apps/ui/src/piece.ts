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
 * melee width, `melee`, `count` null or a number, `gap`, and `pave` false or the pavé on the band:
 * `layout`, `rows`, `melee`, `gap`, `span` or null for angles), `size` (the finger in every system),
 * `metal` (`name`, `density`, `grams`), `stones` (`count`, `carat`), `checks` and `handles`.
 */

import { caratText, trim } from "./bench";
import type { Envelope } from "./facade";
import { asBool, asNumber, asString, isRecord } from "./json";
import { RING_SYSTEMS, metalLabel, paramsOf, readGemChoices, ringChoices, ENGINE_DEFAULT, type Choice, type JewelryEngine } from "./jewelry-dialog";
import { numberText, readNumber, type DraftVerdict } from "./props";

export type PieceKind = "band" | "solitaire" | "threestone" | "eternity" | "halfeternity" | "dome" | "signet" | "pendant" | "stud" | "drop";

/** The kinds not worn on a finger: no ring size, no band (`findings.rs`). */
export const WORN_KINDS: readonly PieceKind[] = ["pendant", "stud", "drop"];

/** Whether a kind is worn off the finger (a pendant, earrings). */
export const isWorn = (kind: string): boolean => (WORN_KINDS as readonly string[]).includes(kind);

/** Whether a kind is made as a pair (earrings). */
export const isPair = (kind: string): boolean => kind === "stud" || kind === "drop";

/** The kinds the engine builds, in the order the section offers them. */
export const PIECE_KINDS: readonly Choice[] = [
  { value: "band", label: "Band" },
  { value: "solitaire", label: "Solitaire" },
  { value: "threestone", label: "Three-stone" },
  { value: "eternity", label: "Eternity" },
  { value: "halfeternity", label: "Half eternity" },
  { value: "dome", label: "Dome" },
  { value: "signet", label: "Signet" },
  { value: "pendant", label: "Pendant" },
  { value: "stud", label: "Stud earrings" },
  { value: "drop", label: "Drop earrings" },
];

/** A pendant's bail (`Bail` in `findings.rs`). */
export const PIECE_BAILS: readonly Choice[] = [
  { value: "loop", label: "Loop" },
  { value: "tube", label: "Tube" },
];

/** A drop earring's top (`Top` in `findings.rs`). */
export const PIECE_TOPS: readonly Choice[] = [
  { value: "hook", label: "French wire" },
  { value: "stud", label: "Stud" },
];

/** A stud's bought-in back (`Back` in `findings.rs`). */
export const PIECE_BACKS: readonly Choice[] = [
  { value: "butterfly", label: "Butterfly" },
  { value: "scroll", label: "Scroll" },
  { value: "none", label: "None" },
];

/** How a solitaire's or a three-stone's stones are held (`head` in `heads.rs`). */
export const PIECE_HEADS: readonly Choice[] = [
  { value: "prong", label: "Prongs" },
  { value: "bezel", label: "Bezel" },
];

/** How a prong head's prongs end over the stone (`prongStyle` in `prongs.rs`). */
export const PIECE_PRONG_STYLES: readonly Choice[] = [
  { value: "round", label: "Round" },
  { value: "claw", label: "Claw" },
  { value: "tab", label: "Tab" },
  { value: "v", label: "V (corners)" },
  { value: "double", label: "Double" },
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

/** How the section names a profile the jeweller drew (`profile: "custom"`). */
export const CUSTOM_PROFILE_LABEL = "Custom (from drawing)";
/** How pavé is laid on the band (`Layout` in `pave_band.rs`). */
export const PAVE_LAYOUTS: readonly Choice[] = [
  { value: "row", label: "Single row" },
  { value: "rows", label: "Rows" },
  { value: "honeycomb", label: "Honeycomb" },
  { value: "scallop", label: "Scalloped" },
  { value: "channel", label: "Channel" },
];

/** The spans pavé is fitted to (`Span` in `pave_band.rs`); angles given instead read "custom". */
export const PAVE_SPANS: readonly Choice[] = [
  { value: "shoulders", label: "Shoulders" },
  { value: "top-half", label: "Top half" },
  { value: "full", label: "All round" },
];

/** What the span row reads when the pavé was given angles rather than a named span. */
export const PAVE_CUSTOM = "custom";

/** Pavé on the band, as the section shows it. */
export interface PavePart {
  layout: string;
  rows: number | null;
  melee: number | null;
  gap: number | null;
  /** A named span, or `custom` when angles were given. */
  span: string;
}

/** What a count reads, and what is typed, when the engine fits as many stones as go around. */
export const AUTO = "auto";

/** Where text goes on the band, how it is made, and its letters (`engrave.rs`). */
export const ENGRAVE_PLACES: readonly Choice[] = [
  { value: "inside", label: "Inside" },
  { value: "outside", label: "Outside" },
];
export const ENGRAVE_STYLES: readonly Choice[] = [
  { value: "cut", label: "Cut in" },
  { value: "raised", label: "Raised" },
];
export const ENGRAVE_FONTS: readonly Choice[] = [
  { value: "block", label: "Block" },
  { value: "script", label: "Script" },
];

/** The engraving on the band; a null number is the engine's default. */
export interface EngravePart {
  text: string;
  at: string;
  style: string;
  font: string;
  depth: number | null;
  height: number | null;
}

/** The hallmark inside the shank: the maker's mark ("" for none). */
export interface HallmarkPart {
  maker: string;
}

/** The longest engraving the engine takes. */
export const MAX_ENGRAVE = 48;

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
  /** A drawn profile's source curve (its handle), when the profile is `custom` and the engine named one. */
  profileCurve: string | null;
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
  /** Pavé on the band: false for none, null when the engine does not offer it. */
  pave: PavePart | false | null;
  /** How the stones are held (prong or bezel), and a bezel's wall and height over the girdle (null: the engine's). */
  head: string;
  bezelWall: number | null;
  bezelHeight: number | null;
  /** A prong head's style (null when the engine does not offer it), and its height, tip and wire (null: the engine's). */
  prongStyle: string | null;
  prongHeight: number | null;
  prongTip: number | null;
  prongWire: number | null;
  /** A channel setting's rail wall and lip (null: the engine's). */
  channelWall: number | null;
  channelLip: number | null;
  /** A dome ring's or a signet's top (null: the engine's share of the bottom). */
  topWidth: number | null;
  topWall: number | null;
  /** A signet's face and its size. */
  face: string;
  faceLength: number | null;
  faceWidth: number | null;
  /** A pendant's bail and the chain it is sized for; a drop on a jump ring. */
  bail: string;
  bailOpening: number | null;
  bailWire: number | null;
  bailWidth: number | null;
  chain: number | null;
  drop: boolean;
  jumpRing: number | null;
  jumpRingWire: number | null;
  /** A stud's post and its bought-in back. */
  postDiameter: number | null;
  postLength: number | null;
  back: string;
  /** A drop earring's top: a French wire or a stud with a stone of `topStone`. */
  top: string;
  topStone: number | null;
  hookWire: number | null;
  /** Text on the band and the hallmark: false for none, null when the engine does not offer it. */
  engrave: EngravePart | false | null;
  hallmark: HallmarkPart | false | null;
  /** The shank's shape: a drawn rail, a split, cathedral arches, a twisted cable. */
  shank: ShankPart;
}

/** The shank shapes a piece holds (`rail`, `shank`, `pattern.twist` in the engine's JSON). */
export interface ShankPart {
  /** Whether the engine offers shank shapes at all (its JSON carries the keys). */
  offered: boolean;
  /** A drawn rail: null for none, its curve's handle, or "" when the engine named none. */
  rail: string | null;
  /** Arms under the head (1 = not split). */
  split: number;
  gap: number | null;
  from: number | null;
  cathedral: boolean;
  height: number | null;
  /** A twisted cable band: null for none. */
  twist: { strands: number | null; turns: number | null; wire: number | null } | null;
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
  /** How many are made: 2 for a pair of earrings, else 1. */
  pieces: number;
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

/** The handle of a custom profile's curve; null for a named profile or a handle that is not one. */
function curveOf(profile: unknown, stored: unknown): string | null {
  if (nameOf(profile) !== "custom" || !isRecord(stored)) return null;
  const handle = asString(stored["curve"]);
  return handle !== null && HANDLE_RE.test(handle) ? handle.toUpperCase() : null;
}

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
    profileCurve: curveOf(value["profile"], value["profileCurve"]),
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
    pave: paveOf(value["pave"]),
    head: nameOf(value["head"]) || "prong",
    bezelWall: sizeOf(value["bezelWall"]),
    bezelHeight: sizeOf(value["bezelHeight"]),
    prongStyle: nameOf(value["prongStyle"]) || null,
    prongHeight: sizeOf(value["prongHeight"]),
    prongTip: sizeOf(value["prongTip"]),
    prongWire: sizeOf(value["prongWire"]),
    channelWall: sizeOf(value["channelWall"]),
    channelLip: sizeOf(value["channelLip"]),
    topWidth: sizeOf(value["topWidth"]),
    topWall: sizeOf(value["topWall"]),
    face: nameOf(value["face"]) || "oval",
    faceLength: sizeOf(value["faceLength"]),
    faceWidth: sizeOf(value["faceWidth"]),
    shank: shankOf(value),
    engrave: engraveOf(value["engrave"]),
    hallmark: hallmarkOf(value["hallmark"]),
    bail: nameOf(value["bail"]) || "loop",
    bailOpening: sizeOf(value["bailOpening"]),
    bailWire: sizeOf(value["bailWire"]),
    bailWidth: sizeOf(value["bailWidth"]),
    chain: sizeOf(value["chain"]),
    drop: asBool(value["drop"]) === true,
    jumpRing: sizeOf(value["jumpRing"]),
    jumpRingWire: sizeOf(value["jumpRingWire"]),
    postDiameter: sizeOf(value["postDiameter"]),
    postLength: sizeOf(value["postLength"]),
    back: nameOf(value["back"]) || "butterfly",
    top: nameOf(value["top"]) || "hook",
    topStone: sizeOf(value["topStone"]),
    hookWire: sizeOf(value["hookWire"]),
  };
}

/** Text the engine stored, kept as it is but for line breaks, clipped to what it takes. */
const textOf = (value: unknown, max: number): string => {
  const text = asString(value);
  return text === null ? "" : [...text.replace(/[\r\n\t]+/g, " ")].slice(0, max).join("");
};

function engraveOf(value: unknown): EngravePart | false | null {
  if (value === false) return false;
  if (!isRecord(value)) return null;
  return {
    text: textOf(value["text"], MAX_ENGRAVE),
    at: nameOf(value["at"]) || "inside",
    style: nameOf(value["style"]) || "cut",
    font: nameOf(value["font"]) || "block",
    depth: sizeOf(value["depth"]),
    height: sizeOf(value["height"]),
  };
}

function hallmarkOf(value: unknown): HallmarkPart | false | null {
  if (value === false) return false;
  if (!isRecord(value)) return null;
  return { maker: textOf(value["maker"], 8) };
}

/** The engraving field each row edits. */
const ENGRAVE_FIELDS: Readonly<Record<string, string>> = {
  engraveText: "text",
  engraveAt: "at",
  engraveStyle: "style",
  engraveFont: "font",
  engraveDepth: "depth",
  engraveHeight: "height",
};

/** The text the engraving starts with when it is ticked on. */
export const ENGRAVE_START = "Forever";

/**
 * The engraving rows: a tick, and when it is on the text, where it goes, how it is made, the
 * letters, their height and depth; then the hallmark's tick and maker's mark.
 */
function engraveRows(p: PieceParams): PieceRow[] {
  const rows: PieceRow[] = [];
  if (p.engrave !== null) {
    rows.push({ key: "engrave", label: "Engraving", value: p.engrave === false ? "false" : "true", kind: "tick" });
    if (p.engrave !== false) {
      const e = p.engrave;
      rows.push({ key: "engraveText", label: "Text", value: e.text, kind: "words" });
      rows.push({ key: "engraveAt", label: "Placement", value: e.at, kind: "choice", choices: withHeld(ENGRAVE_PLACES, e.at, capital) });
      if (e.at === "outside") rows.push({ key: "engraveStyle", label: "Style", value: e.style, kind: "choice", choices: withHeld(ENGRAVE_STYLES, e.style, capital) });
      rows.push({ key: "engraveFont", label: "Letters", value: e.font, kind: "choice", choices: withHeld(ENGRAVE_FONTS, e.font, capital) });
      rows.push({ key: "engraveHeight", label: "Letter height, mm", value: num(e.height), kind: "number" });
      rows.push({ key: "engraveDepth", label: e.style === "raised" ? "Relief, mm" : "Depth, mm", value: num(e.depth), kind: "number" });
    }
  }
  if (p.hallmark !== null) {
    rows.push({ key: "hallmark", label: "Hallmark", value: p.hallmark === false ? "false" : "true", kind: "tick" });
    if (p.hallmark !== false) rows.push({ key: "hallmarkMaker", label: "Maker's mark", value: p.hallmark.maker, kind: "words" });
  }
  return rows;
}


function shankOf(value: Record<string, unknown>): ShankPart {
  const rail = value["rail"];
  const railCurve = isRecord(rail) ? asString(rail["curve"]) : null;
  const shank = isRecord(value["shank"]) ? value["shank"] : {};
  const pattern = isRecord(value["pattern"]) ? value["pattern"] : {};
  const twist = isRecord(pattern["twist"]) ? pattern["twist"] : null;
  const split = wholeOf(shank["split"]);
  return {
    offered: "shank" in value || "pattern" in value || "rail" in value,
    rail: isRecord(rail) ? (railCurve !== null && HANDLE_RE.test(railCurve) ? railCurve.toUpperCase() : "") : null,
    split: split === 2 || split === 3 ? split : 1,
    gap: sizeOf(shank["gap"]),
    from: sizeOf(shank["from"]),
    cathedral: asBool(shank["cathedral"]) === true,
    height: sizeOf(shank["height"]),
    twist: twist === null ? null : { strands: wholeOf(twist["strands"]), turns: wholeOf(twist["turns"]), wire: sizeOf(twist["wire"]) },
  };
}

/** The split choices: none, two arms, three arms. */
export const SHANK_SPLITS: readonly Choice[] = [
  { value: "1", label: "None" },
  { value: "2", label: "Two arms" },
  { value: "3", label: "Three arms" },
];

/** The shank's rows: a solitaire's split and cathedral arches; a band's rail and its twist. */
function shankRows(p: PieceParams): PieceRow[] {
  const sh = p.shank;
  const rows: PieceRow[] = [];
  if (!sh.offered) return rows;
  if (p.kind === "solitaire") {
    rows.push({ key: "split", label: "Split", value: String(sh.split), kind: "choice", choices: SHANK_SPLITS });
    if (sh.split > 1) rows.push({ key: "shankGap", label: "Arm gap, mm", value: num(sh.gap), kind: "number" });
    rows.push({ key: "cathedral", label: "Cathedral", value: sh.cathedral ? "true" : "false", kind: "tick" });
    if (sh.cathedral) rows.push({ key: "archHeight", label: "Arch height, mm", value: num(sh.height), kind: "number" });
    if (sh.split > 1 || sh.cathedral) rows.push({ key: "shankFrom", label: "From 12 o'clock, °", value: num(sh.from), kind: "number" });
  }
  if (p.kind === "band") {
    if (sh.rail !== null) {
      rows.push({ key: "rail", label: "Rail", value: "Drawn curve", kind: "readonly" });
    } else {
      rows.push({ key: "twist", label: "Twisted cable", value: sh.twist === null ? "false" : "true", kind: "tick" });
      if (sh.twist !== null) {
        rows.push({ key: "strands", label: "Strands", value: num(sh.twist.strands), kind: "whole" });
        rows.push({ key: "wire", label: "Wire, mm", value: num(sh.twist.wire), kind: "number" });
        rows.push({ key: "turns", label: "Twists", value: sh.twist.turns === null ? AUTO : numberText(sh.twist.turns), kind: "count" });
      }
    }
  }
  return rows;
}

/** The patch a shank row sends; null for a row that is not the shank's. */
function shankPatch(key: string, value: unknown): Record<string, unknown> | null {
  switch (key) {
    case "split":
      return { shank: { split: Number(value) } };
    case "shankGap":
      return { shank: { gap: value } };
    case "shankFrom":
      return { shank: { from: value } };
    case "cathedral":
      return { shank: { cathedral: value } };
    case "archHeight":
      return { shank: { height: value } };
    case "twist":
      return { pattern: value === true ? { twist: true } : null };
    case "strands":
    case "wire":
    case "turns":
      return { pattern: { twist: { [key]: value } } };
    default:
      return null;
  }
}

/**
 * "Update rail from curve": the patch that reads a rail's curve again (`piece {rail: {curve}}`),
 * or null when the piece has no rail or its curve is not known.
 */
export function railUpdate(piece: Piece): { rail: { curve: string } } | null {
  const rail = piece.params.shank.rail;
  return rail !== null && rail !== "" ? { rail: { curve: rail } } : null;
}

function paveOf(value: unknown): PavePart | false | null {
  if (value === false) return false;
  if (!isRecord(value)) return null;
  const layout = nameOf(value["layout"]);
  const span = nameOf(value["span"]);
  return {
    layout: layout === "" ? "row" : layout,
    rows: wholeOf(value["rows"]),
    melee: sizeOf(value["melee"]),
    gap: sizeOf(value["gap"]),
    span: span === "" ? PAVE_CUSTOM : span,
  };
}

/** The pavé field each row edits. */
const PAVE_FIELDS: Readonly<Record<string, string>> = {
  paveLayout: "layout",
  paveRows: "rows",
  paveMelee: "melee",
  paveGap: "gap",
  paveSpan: "span",
};

/** The pavé rows: a tick, and when it is on, the layout, rows, stone size, gap and span. */
function paveRows(p: PieceParams): PieceRow[] {
  if (p.pave === null || p.kind === "eternity") return [];
  const rows: PieceRow[] = [{ key: "pave", label: "Pavé", value: p.pave === false ? "false" : "true", kind: "tick" }];
  if (p.pave === false) return rows;
  const pave = p.pave;
  rows.push({ key: "paveLayout", label: "Layout", value: pave.layout, kind: "choice", choices: withHeld(PAVE_LAYOUTS, pave.layout, capital) });
  if (pave.layout === "rows" || pave.layout === "honeycomb") rows.push({ key: "paveRows", label: "Rows", value: num(pave.rows), kind: "whole" });
  rows.push({ key: "paveMelee", label: "Pavé stones, mm", value: num(pave.melee), kind: "number" });
  rows.push({ key: "paveGap", label: "Pavé gap, mm", value: num(pave.gap), kind: "number" });
  rows.push({ key: "paveSpan", label: "Span", value: pave.span, kind: "choice", choices: withHeld(PAVE_SPANS, pave.span, () => "Custom angles") });
  if (pave.layout === "channel") {
    // The channel's rails, in the Setting group: their wall beyond the girdles and the lip over them.
    rows.push({ key: "channelWall", label: "Channel wall, mm", value: num(p.channelWall), kind: "number" });
    rows.push({ key: "channelLip", label: "Channel lip, mm", value: num(p.channelLip), kind: "number" });
  }
  return rows;
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
  // A pendant or earrings have no ring size: nothing of the stored size is shown.
  if (isWorn(params.kind)) params.sizeText = null;
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
    pieces: wholeOf(value["pieces"]) === 2 ? 2 : 1,
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
export type PieceRowKind = "choice" | "number" | "whole" | "size" | "count" | "tick" | "readonly" | "words";

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

/** The profiles offered: the named ones, and the drawn one first while the piece has it. */
export function profileChoices(held: string): readonly Choice[] {
  if (held === "custom") return [{ value: "custom", label: CUSTOM_PROFILE_LABEL }, ...PIECE_PROFILES];
  return withHeld(PIECE_PROFILES, held, capital);
}

/**
 * "Update from curve": the patch that reads a custom profile's curve again (`piece {profile:
 * {curve}}`), or null when the piece has no drawn profile or its curve is not known.
 */
export function profileUpdate(piece: Piece): { profile: { curve: string } } | null {
  const p = piece.params;
  return p.profile === "custom" && p.profileCurve !== null ? { profile: { curve: p.profileCurve } } : null;
}

/**
 * The rows of a piece, in the order a bench reads them: what it is and the finger, the band, then
 * what its kind adds (a solitaire's stone, head and halo; an eternity's stones). `system` is the
 * size system the section shows.
 */
export function pieceRows(piece: Piece, choices: PieceChoices, system: string): PieceRow[] {
  return [...kindRows(piece, choices, system), ...engraveRows(piece.params)];
}

function kindRows(piece: Piece, choices: PieceChoices, system: string): PieceRow[] {
  const p = piece.params;
  if (isWorn(p.kind)) return wornRows(p, choices);
  const shown = systemOf(system);
  const rows: PieceRow[] = [
    { key: "kind", label: "Kind", value: p.kind, kind: "choice", choices: PIECE_KINDS },
    { key: "system", label: "Size system", value: shown, kind: "choice", choices: RING_SYSTEMS },
    { key: "size", label: "Size", value: sizeIn(piece, shown), kind: "size" },
    // A drawn profile's box is its wall and width: shown, not typed (scale the curve instead).
    { key: "wall", label: "Wall, mm", value: num(p.wall), kind: p.profile === "custom" ? "readonly" : "number" },
    { key: "width", label: "Width, mm", value: num(p.width), kind: p.profile === "custom" ? "readonly" : "number" },
    { key: "profile", label: "Profile", value: p.profile, kind: "choice", choices: profileChoices(p.profile) },
    { key: "metal", label: "Metal", value: p.metal, kind: "choice", choices: withHeld(choices.metals, p.metal, metalLabel) },
  ];
  rows.push(...shankRows(p));
  if (p.kind === "band") return p.shank.rail !== null || p.shank.twist !== null ? rows : [...rows, ...paveRows(p)];
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
      if (p.prongStyle !== null) {
        // The Setting group: the prongs' shape, height over the girdle, cover over the crown and wire.
        rows.push({ key: "prongStyle", label: "Prong style", value: p.prongStyle, kind: "choice", choices: withHeld(PIECE_PRONG_STYLES, p.prongStyle, capital) });
        rows.push({ key: "prongHeight", label: "Prong height, mm", value: num(p.prongHeight), kind: "number" });
        rows.push({ key: "prongTip", label: "Prong tip, mm", value: num(p.prongTip), kind: "number" });
        rows.push({ key: "prongWire", label: "Prong wire, mm", value: num(p.prongWire), kind: "number" });
      }
    }
    if (p.kind === "threestone") {
      // The side stones: empty reads as the engine's own share of the centre stone.
      rows.push({ key: "sideWidth", label: "Side stones, mm", value: num(p.sideWidth), kind: "number" });
      if (!bezel) rows.push({ key: "sideProngs", label: "Side prongs", value: num(p.sideProngs), kind: "whole" });
      rows.push(...paveRows(p));
      return rows;
    }
    rows.push({ key: "halo", label: "Halo", value: p.halo === null ? "false" : "true", kind: "tick" });
    if (p.halo !== null) {
      rows.push({ key: "haloWidth", label: "Halo stones, mm", value: num(p.halo), kind: "number" });
      rows.push({ key: "gap", label: "Gap, mm", value: num(p.gap), kind: "number" });
    }
    if (!p.shank.cathedral && p.shank.split === 1) rows.push(...paveRows(p));
    return rows;
  }
  rows.push({ key: "melee", label: "Stones, mm", value: num(p.melee), kind: "number" });
  rows.push({ key: "count", label: "Count", value: p.count === null ? AUTO : numberText(p.count), kind: "count" });
  rows.push({ key: "gap", label: "Gap, mm", value: num(p.gap), kind: "number" });
  return rows;
}

/**
 * The rows of a pendant or a pair of earrings: no ring size, no band. What it is and its metal,
 * the stone, the head that holds it, and its findings (the bail and chain, the post and back, the
 * jump ring, the ear wire or the stud top).
 */
function wornRows(p: PieceParams, choices: PieceChoices): PieceRow[] {
  const rows: PieceRow[] = [
    { key: "kind", label: "Kind", value: p.kind, kind: "choice", choices: PIECE_KINDS },
    { key: "metal", label: "Metal", value: p.metal, kind: "choice", choices: withHeld(choices.metals, p.metal, metalLabel) },
    { key: "cut", label: "Cut", value: p.cut, kind: "choice", choices: withHeld(choices.cuts, p.cut, capital) },
    { key: "stone", label: "Stone", value: p.stone, kind: "choice", choices: withHeld(choices.stones, p.stone, capital) },
  ];
  if (choices.round.includes(p.cut)) {
    rows.push({ key: "stoneWidth", label: "Stone, mm", value: num(p.stoneWidth), kind: "number", both: true });
  } else {
    rows.push({ key: "stoneLength", label: "Stone length, mm", value: num(p.stoneLength), kind: "number" });
    rows.push({ key: "stoneWidth", label: "Stone width, mm", value: num(p.stoneWidth), kind: "number" });
  }
  rows.push({ key: "head", label: "Head", value: p.head, kind: "choice", choices: withHeld(PIECE_HEADS, p.head, capital) });
  if (p.head === "bezel") {
    rows.push({ key: "bezelWall", label: "Bezel wall, mm", value: num(p.bezelWall), kind: "number" });
    rows.push({ key: "bezelHeight", label: "Bezel height, mm", value: num(p.bezelHeight), kind: "number" });
  } else {
    rows.push({ key: "prongs", label: "Prongs", value: num(p.prongs), kind: "whole" });
  }
  rows.push({ key: "halo", label: "Halo", value: p.halo === null ? "false" : "true", kind: "tick" });
  if (p.halo !== null) {
    rows.push({ key: "haloWidth", label: "Halo stones, mm", value: num(p.halo), kind: "number" });
    rows.push({ key: "gap", label: "Gap, mm", value: num(p.gap), kind: "number" });
  }
  const jump = (): void => {
    rows.push({ key: "jumpRing", label: "Jump ring inside, mm", value: num(p.jumpRing), kind: "number" });
    rows.push({ key: "jumpRingWire", label: "Jump ring wire, mm", value: num(p.jumpRingWire), kind: "number" });
  };
  const post = (): void => {
    rows.push({ key: "postDiameter", label: "Post diameter, mm", value: num(p.postDiameter), kind: "number" });
    rows.push({ key: "postLength", label: "Post length, mm", value: num(p.postLength), kind: "number" });
    rows.push({ key: "back", label: "Back (bought in)", value: p.back, kind: "choice", choices: withHeld(PIECE_BACKS, p.back, capital) });
  };
  if (p.kind === "pendant") {
    rows.push({ key: "bail", label: "Bail", value: p.bail, kind: "choice", choices: withHeld(PIECE_BAILS, p.bail, capital) });
    rows.push({ key: "bailOpening", label: "Bail opening, mm", value: num(p.bailOpening), kind: "number" });
    rows.push({ key: "bailWire", label: p.bail === "tube" ? "Tube wall, mm" : "Bail wire, mm", value: num(p.bailWire), kind: "number" });
    if (p.bail === "tube") rows.push({ key: "bailWidth", label: "Tube length, mm", value: num(p.bailWidth), kind: "number" });
    rows.push({ key: "chain", label: "Chain, mm", value: num(p.chain), kind: "number" });
    rows.push({ key: "drop", label: "Drop on a jump ring", value: p.drop ? "true" : "false", kind: "tick" });
    if (p.drop) jump();
  } else if (p.kind === "stud") {
    post();
  } else {
    rows.push({ key: "top", label: "Top", value: p.top, kind: "choice", choices: withHeld(PIECE_TOPS, p.top, capital) });
    if (p.top === "stud") {
      rows.push({ key: "topStone", label: "Top stone, mm", value: num(p.topStone), kind: "number" });
      post();
    } else {
      rows.push({ key: "hookWire", label: "Ear wire, mm", value: num(p.hookWire), kind: "number" });
    }
    jump();
  }
  return rows;
}

/** The heading's summary: what the piece is and its size ("Solitaire · US 6½"). */
export function pieceHeading(state: PieceState, system?: string): string {
  if (state.kind !== "piece") return "";
  const p = state.piece.params;
  const shown = systemOf(system ?? p.sizeSystem);
  const size = sizeIn(state.piece, shown);
  const kind = PIECE_KINDS.find((k) => k.value === p.kind)?.label ?? capital(p.kind);
  if (isWorn(p.kind)) return isPair(p.kind) ? `${kind} · pair` : kind;
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
  if (isPair(piece.params.kind)) facts.push({ label: "Made as", value: "a pair: two of everything, weights and carats for both" });
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
  if (isPair(p.kind)) tiles.push({ label: "Made as", value: "Pair", detail: "2 of everything" });
  if (piece.metal.grams !== null) tiles.push({ label: "Metal", value: `${trim(piece.metal.grams, 2)} g`, detail: piece.metal.name === "" ? "" : metalLabel(piece.metal.name) });
  if (piece.stones.count !== null && piece.stones.count > 0 && piece.stones.carat !== null) {
    tiles.push({ label: "Stones", value: caratText(piece.stones.carat), detail: `${piece.stones.count.toLocaleString("en-US")} pc` });
  }
  let centre: string | null = null;
  if ((p.kind === "solitaire" || p.kind === "threestone" || isWorn(p.kind)) && p.stoneWidth !== null) {
    const long = p.stoneLength !== null && Math.abs(p.stoneLength - p.stoneWidth) > 1e-6 ? `${trim(p.stoneLength, 2)}×` : "";
    const words = [`${long}${trim(p.stoneWidth, 2)} mm`, p.cut, p.stone].filter((w) => w !== "").join(" ");
    const style = p.prongStyle === null || p.prongStyle === "round" ? "" : `${p.prongStyle === "v" ? "V" : p.prongStyle} `;
    centre = p.head === "bezel" ? `${words}, bezel` : p.prongs === null ? words : `${words}, ${numberText(p.prongs)} ${style}prongs`;
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
  name: "Ring" | "Piece" | "Band" | "Shank" | "Stones" | "Head" | "Setting" | "Findings" | "Pavé" | "Engraving";
  rows: PieceRow[];
}

/** The group each parameter is read in; the gap is the stones' on an eternity and the head's
 *  (the halo's) otherwise. */
function groupOf(row: PieceRow, kind: string): PieceGroup["name"] {
  if (isWorn(kind) && (row.key === "kind" || row.key === "metal")) return "Piece";
  switch (row.key) {
    case "bail":
    case "bailOpening":
    case "bailWire":
    case "bailWidth":
    case "chain":
    case "drop":
    case "jumpRing":
    case "jumpRingWire":
    case "postDiameter":
    case "postLength":
    case "back":
    case "top":
    case "topStone":
    case "hookWire":
      return "Findings";
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
    case "prongStyle":
    case "prongHeight":
    case "prongTip":
    case "prongWire":
    case "channelWall":
    case "channelLip":
      return "Setting";
    case "gap":
      return kind === "eternity" || kind === "halfeternity" ? "Stones" : "Head";
    case "split":
    case "shankGap":
    case "shankFrom":
    case "cathedral":
    case "archHeight":
    case "rail":
    case "twist":
    case "strands":
    case "wire":
    case "turns":
      return "Shank";
    case "pave":
    case "paveLayout":
    case "paveRows":
    case "paveMelee":
    case "paveGap":
    case "paveSpan":
      return "Pavé";
    case "engrave":
    case "engraveText":
    case "engraveAt":
    case "engraveStyle":
    case "engraveFont":
    case "engraveHeight":
    case "engraveDepth":
    case "hallmark":
    case "hallmarkMaker":
      return "Engraving";
    default:
      return "Stones";
  }
}

const GROUP_ORDER: readonly PieceGroup["name"][] = ["Ring", "Piece", "Band", "Shank", "Stones", "Head", "Setting", "Findings", "Pavé", "Engraving"];

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
    case "readonly":
      return { kind: "keep" };
    case "size":
      return judgeSize(row, draft, system);
    case "tick":
      if (draft !== "true" && draft !== "false") return { kind: "keep" };
      if (row.key === "cathedral" || row.key === "twist") return { kind: "send", patch: shankPatch(row.key, draft === "true") ?? {} };
      if (row.key === "engrave") return { kind: "send", patch: { engrave: draft === "true" ? { text: ENGRAVE_START } : false } };
      if (row.key === "hallmark") return { kind: "send", patch: { hallmark: draft === "true" } };
      return { kind: "send", patch: { [row.key === "pave" || row.key === "drop" ? row.key : "halo"]: draft === "true" } };
    case "words": {
      const text = draft.normalize("NFC").replace(/\s+/g, " ").trim();
      if (text === row.value.trim()) return { kind: "keep" };
      if (row.key === "hallmarkMaker") {
        if ([...text].length > 8) return { kind: "refuse", message: "A maker's mark is at most 8 characters" };
        return { kind: "send", patch: { hallmark: { maker: text === "" ? null : text } } };
      }
      if (text === "") return { kind: "refuse", message: "Give the words to engrave, or untick the engraving" };
      if ([...text].length > MAX_ENGRAVE) return { kind: "refuse", message: `An engraving is at most ${MAX_ENGRAVE} characters` };
      return { kind: "send", patch: { engrave: { text } } };
    }
    case "choice": {
      if (row.key === "system" || draft.trim() === "") return { kind: "keep" };
      if (row.key === "split") return { kind: "send", patch: shankPatch("split", draft) ?? {} };
      const field = PAVE_FIELDS[row.key];
      if (field !== undefined) return draft === PAVE_CUSTOM ? { kind: "keep" } : { kind: "send", patch: { pave: { [field]: draft } } };
      const engraved = ENGRAVE_FIELDS[row.key];
      if (engraved !== undefined) return { kind: "send", patch: { engrave: { [engraved]: draft } } };
      return { kind: "send", patch: { [row.key]: draft } };
    }
    case "count": {
      const text = draft.trim().toLowerCase();
      const patch = (v: number | null): Record<string, unknown> => (row.key === "turns" ? (shankPatch("turns", v) ?? {}) : { count: v });
      if (text === "" || text === AUTO) return row.value === AUTO ? { kind: "keep" } : { kind: "send", patch: patch(null) };
      const read = readNumber(text);
      if (!read.ok || !Number.isInteger(read.value)) return { kind: "refuse", message: `${rowName(row)} takes a whole number, or ${AUTO}` };
      const held = readNumber(row.value);
      if (held.ok && held.value === read.value) return { kind: "keep" };
      return { kind: "send", patch: patch(read.value) };
    }
    case "whole":
    case "number": {
      const read = readNumber(draft);
      if (!read.ok) {
        if (read.fault === "empty") {
        // An emptied engraving number goes back to the engine's default.
        const engraved = ENGRAVE_FIELDS[row.key];
        return engraved !== undefined && row.value !== "" ? { kind: "send", patch: { engrave: { [engraved]: null } } } : { kind: "keep" };
      }
        if (read.fault === "unit") return { kind: "refuse", message: `${rowName(row)} takes a number without a unit` };
        return { kind: "refuse", message: `${rowName(row)} needs a number` };
      }
      if (row.kind === "whole" && !Number.isInteger(read.value)) return { kind: "refuse", message: `${rowName(row)} takes a whole number` };
      const held = readNumber(row.value);
      if (held.ok && held.value === read.value) return { kind: "keep" };
      if (row.key === "haloWidth") return { kind: "send", patch: { halo: read.value } };
      const shank = shankPatch(row.key, read.value);
      if (shank !== null) return { kind: "send", patch: shank };
      const field = PAVE_FIELDS[row.key];
      if (field !== undefined) return { kind: "send", patch: { pave: { [field]: read.value } } };
      const engraved = ENGRAVE_FIELDS[row.key];
      if (engraved !== undefined) return { kind: "send", patch: { engrave: { [engraved]: read.value } } };
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
  // The engraving's and the hallmark's own keys, and the words they refuse in.
  const engraved = /`engrave\.([a-z]{1,12})/.exec(text);
  if (engraved !== null) {
    const row = Object.entries(ENGRAVE_FIELDS).find(([, field]) => field === engraved[1])?.[0];
    return first(row ?? "engraveText", "engrave");
  }
  if (/`hallmark\.maker`/.test(text)) return first("hallmarkMaker", "hallmark");
  if (/engraving font|too long for the band|no room inside/i.test(text)) return first("engraveText", "engrave");
  if (/fineness|hallmark/i.test(text)) return first("hallmark");
  if (/^V prongs\b/.test(text)) return first("prongStyle", "cut");
  // Pavé's own keys: `pave.melee` is the pavé stones' row.
  const pave = /`pave\.([a-z]{1,12})/.exec(text);
  if (pave !== null) {
    const row = Object.entries(PAVE_FIELDS).find(([, field]) => field === pave[1])?.[0];
    return first(row ?? "pave", "pave");
  }
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
