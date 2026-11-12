/**
 * The Tech Sheet's pure logic: the printable bench sheet assembled from three engine replies, with
 * no geometry and no arithmetic of its own. `components/TechSheet.tsx` draws it and owns the canvas
 * renders and the print; nothing here touches the DOM or a GPU.
 *
 * Every figure shown is the engine's. The piece (`piece {query:true}`) gives the finger sizes, the
 * checks and the metal; the solid (`piecemesh`) gives the box the sheet measures (`formatSize`) and
 * the mesh the stills are drawn from; the bench reply (`techsheet`) gives the stones and the bands,
 * read by `../bench` (`parseBench`), which already splits them, carries the calibrated-melee note
 * and caps a long list with an "N more" line. Nothing here is counted, weighed or converted.
 */

import {
  caratText,
  parseBench,
  trim,
  type BenchLine,
  type BenchSheet,
} from "./bench";
import type { Envelope } from "./facade";
import { isRecord } from "./json";
import { parsePiece, pieceHeading, type Piece, type PieceCheck } from "./piece";
import {
  formatSize,
  parseMeshReply,
  type DisplayMode,
  type PieceMesh,
  type StandardView,
} from "./view3d";

/** One rendered view of the sheet: the side the eye stands on, and its label. */
export interface SheetView {
  view: StandardView;
  label: string;
}

/** The four views, in the order a bench reads a drawing: the plan first, then the two elevations,
 *  then a perspective to show the whole. */
export const SHEET_VIEWS: readonly SheetView[] = [
  { view: "top", label: "Top" },
  { view: "front", label: "Front" },
  { view: "side", label: "Side" },
  { view: "three-quarter", label: "Perspective" },
];

/** A labelled figure: a dimension, a ring size, a total. The value is the engine's, formatted once. */
export interface SheetFact {
  label: string;
  value: string;
}

/** One row of the stone table: the cut and size, how many, and the carats, with the melee note. */
export interface SheetStone {
  /** The cut and size as the bench writes it ("Round 1.3 mm"). */
  name: string;
  /** How many ("14 pc"). */
  count: string;
  /** The group's weight ("0.18 ct"); "" when the bench gave none on its own line. */
  carat: string;
  /** A stone off the calibrated melee list; null when it is a stock size. */
  note: string | null;
}

/** The whole sheet, read from the three replies: what the component draws. */
export interface SheetModel {
  /** The header: the kind, the finger and the alloy ("Solitaire · US 6½ · 18k gold"). */
  title: string;
  /** The piece as the engine described it; null when the drawing has no parametric piece. */
  piece: Piece | null;
  /** The mesh for the stills; null when there is none to render (no piece, or an unreadable solid). */
  mesh: PieceMesh | null;
  /** Why there are no rendered views, in words, when one is expected; null when the stills can be drawn. */
  note: string | null;
  /** The overall size from the mesh's box and the finger's inside diameter. */
  dimensions: SheetFact[];
  /** The finger in every system the engine named. */
  ringSizes: SheetFact[];
  /** The stones by cut and size. */
  stones: SheetStone[];
  /** The stones' total count and carats; null when the drawing holds none. */
  stoneTotal: SheetFact | null;
  /** The bands by alloy and weight. */
  bands: SheetFact[];
  /** The metal's total weight; null when the drawing holds no band. */
  metalTotal: SheetFact | null;
  /** The piece's checks, pass or fail with the engine's words. */
  checks: PieceCheck[];
  /** What the bench found wanting, and the "N more lines" line when the list was capped. */
  warnings: string[];
}

/** Whether a bench line counts stones (its value is "14 pc · …"). */
function isStoneLine(line: BenchLine): boolean {
  return /\bpc\b/.test(line.value);
}

/** Whether a bench line weighs a band (its value ends in grams and is not a stone count). */
function isBandLine(line: BenchLine): boolean {
  return /\bg\b/.test(line.value) && !isStoneLine(line);
}

/** A stone row from a bench line: the count and the carats split from its value, the note kept. */
function stoneOf(line: BenchLine): SheetStone {
  const parts = line.value.split("·").map((part) => part.trim());
  return {
    name: line.label,
    count: parts[0] ?? line.value,
    carat: parts[1] ?? "",
    note: line.note,
  };
}

/** The finger's sizes, each system the engine named, in the trade's order. */
function ringSizesOf(piece: Piece | null): SheetFact[] {
  if (piece === null) return [];
  const out: SheetFact[] = [];
  const add = (label: string, value: string | null): void => {
    if (value !== null && value !== "") out.push({ label, value });
  };
  add("US", piece.size.us);
  add("UK", piece.size.uk);
  add("EU", piece.size.eu);
  add("JP", piece.size.jp);
  add("CN", piece.size.cn);
  return out;
}

/** The header line: the kind and finger (`pieceHeading`), then the alloy where the piece names one. */
export function sheetTitle(piece: Piece | null): string {
  if (piece === null) return "Tech Sheet";
  const head = pieceHeading({ kind: "piece", piece }, piece.params.sizeSystem);
  const metal = metalName(piece);
  return metal === "" ? head : `${head} · ${metal}`;
}

/** The alloy as the trade writes it ("18k gold"), from the piece; "" when it named none. */
function metalName(piece: Piece): string {
  const gold = /^gold(\d{1,2})$/.exec(piece.metal.name);
  if (gold !== null) return `${gold[1]}k gold`;
  return piece.metal.name === "" || piece.metal.name === "?"
    ? ""
    : piece.metal.name;
}

/** The dimensions from the mesh's box and the finger: nothing is measured, only formatted. */
function dimensionsOf(
  mesh: PieceMesh | null,
  piece: Piece | null,
): SheetFact[] {
  const out: SheetFact[] = [];
  if (mesh !== null)
    out.push({ label: "Overall size", value: formatSize(mesh.bounds) });
  if (piece !== null && piece.size.diameter !== null)
    out.push({
      label: "Inside diameter",
      value: `${trim(piece.size.diameter, 2)} mm`,
    });
  return out;
}

/** The piece out of a `piece {query:true}` reply; null when the reply is a refusal or holds none. */
function pieceOf(reply: Envelope): Piece | null {
  if (!reply.ok || !isRecord(reply.result)) return null;
  return parsePiece(reply.result["piece"]);
}

/**
 * The raw parameters to ask the solid for (`piecemesh`), taken straight from a `piece {query:true}`
 * reply (the engine takes the piece's own `params` back, plus a quality); null when the drawing has
 * no piece. The component merges a quality and fetches the mesh with it.
 */
export function meshRequest(
  pieceReply: Envelope,
): Record<string, unknown> | null {
  if (!pieceReply.ok || !isRecord(pieceReply.result)) return null;
  const piece = pieceReply.result["piece"];
  if (!isRecord(piece) || !isRecord(piece["params"])) return null;
  return { ...piece["params"] };
}

/**
 * Assemble the sheet from the three replies: the piece (query), the fine solid (`piecemesh`) and
 * the bench reply (`techsheet`). A reply that refused, or that is not what it should be, leaves its
 * part empty — the sheet still shows what the others gave.
 */
export function assembleSheet(
  pieceReply: Envelope,
  meshReply: Envelope,
  benchReply: Envelope,
): SheetModel {
  const piece = pieceOf(pieceReply);
  const parsed = meshReply.ok
    ? parseMeshReply(meshReply.result)
    : ({ ok: false, error: meshReply.error } as const);
  const mesh = parsed.ok ? parsed.mesh : null;
  const bench: BenchSheet | null = benchReply.ok
    ? parseBench(benchReply.result)
    : null;

  const note =
    mesh !== null
      ? null
      : piece === null
        ? "This drawing has no parametric piece, so there is no 3D model to render."
        : parsed.ok
          ? "The piece has no solid to render yet."
          : parsed.error;

  const lines = bench?.lines ?? [];
  const stones = lines.filter(isStoneLine).map(stoneOf);
  const bands = lines
    .filter(isBandLine)
    .map((line) => ({ label: line.label, value: line.value }));
  const stoneTotal =
    bench !== null && bench.stones > 0
      ? {
          label: "Total",
          value: `${bench.stones.toLocaleString("en-US")} pc · ${caratText(bench.carat)}`,
        }
      : null;
  const metalTotal =
    bench !== null && bench.grams > 0
      ? { label: "Total", value: `${trim(bench.grams, 2)} g` }
      : null;

  return {
    title: sheetTitle(piece),
    piece,
    mesh,
    note,
    dimensions: dimensionsOf(mesh, piece),
    ringSizes: ringSizesOf(piece),
    stones,
    stoneTotal,
    bands,
    metalTotal,
    checks: piece?.checks ?? [],
    warnings: bench?.warnings ?? [],
  };
}

/** How many checks failed: the checks heading says it in words. */
export function failedCount(model: SheetModel): number {
  return model.checks.filter((check) => !check.ok).length;
}

// ---------------------------------------------------------------------------------------------
// The display-mode and background choices, applied to every tile at once
// ---------------------------------------------------------------------------------------------

/** What is behind the piece in a still: the sheet's own surface, or nothing (a cut-out). */
export type SheetBackground = "surface" | "transparent";

export const BACKGROUND_OPTIONS: readonly {
  value: SheetBackground;
  label: string;
}[] = [
  { value: "surface", label: "On the sheet" },
  { value: "transparent", label: "Transparent" },
];

/** Whether a mode wants a dark ink over paper for its lines (a wireframe or an X-ray on a surface). */
export function wantsInk(
  mode: DisplayMode,
  background: SheetBackground,
): boolean {
  return background === "surface" && (mode === "wireframe" || mode === "xray");
}

// ---------------------------------------------------------------------------------------------
// The tiles' state: which view is rendering, done, or failed
// ---------------------------------------------------------------------------------------------

export type TilePhase = "pending" | "rendering" | "done" | "failed";

/** One tile's drawing state; the object URL of its PNG lives in the component, not here. */
export interface Tile {
  view: StandardView;
  label: string;
  phase: TilePhase;
  /** Why the tile could not be drawn, in words; null until it fails. */
  message: string | null;
}

/** The tiles for a fresh render: every view pending. */
export function freshTiles(): Tile[] {
  return SHEET_VIEWS.map((entry) => ({
    view: entry.view,
    label: entry.label,
    phase: "pending",
    message: null,
  }));
}

/** One tile moved to a phase (with its words on a failure); the rest unchanged. */
export function setTile(
  tiles: readonly Tile[],
  view: StandardView,
  phase: TilePhase,
  message: string | null = null,
): Tile[] {
  return tiles.map((tile) =>
    tile.view === view ? { ...tile, phase, message } : tile,
  );
}

/** The next view waiting to be drawn, so the stills go one at a time; null when none waits. */
export function nextPending(tiles: readonly Tile[]): StandardView | null {
  return tiles.find((tile) => tile.phase === "pending")?.view ?? null;
}

/** Whether every tile has settled (drawn or failed): the render run is over. */
export function tilesSettled(tiles: readonly Tile[]): boolean {
  return tiles.every(
    (tile) => tile.phase === "done" || tile.phase === "failed",
  );
}
