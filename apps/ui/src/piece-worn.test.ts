/**
 * Pendants and earrings in the Piece section and on the bench: no ring-only rows (size system,
 * size, wall, width, profile, pavé), their own findings rows, the heading and the summary saying
 * "pair", the drop tick sending `drop`, the handles leaving the band alone, and the bench line of a
 * pair.
 */

import { describe, expect, test } from "bun:test";
import { parseBench } from "./bench";
import { pieceHandles } from "./handles";
import { isPair, isWorn, judgePieceDraft, parsePiece, pieceGroups, pieceHeading, pieceRows, pieceSummary, type PieceChoices } from "./piece";
import { TEMPLATES, groupTemplates } from "./templates";

const CHOICES: PieceChoices = { metals: [], cuts: [], stones: [], round: ["round"] };

const RING_ONLY = ["system", "size", "wall", "width", "profile", "pave", "topWidth", "topWall", "count", "melee"];

function reply(kind: string, extra: Record<string, unknown> = {}): unknown {
  return {
    params: { kind, cut: "round", stone: "diamond", stoneWidth: 5, stoneLength: 5, prongs: 4, halo: false, head: "prong", metal: "gold18", bail: "loop", bailOpening: 3, bailWire: 1, bailWidth: 3, chain: 1.5, drop: false, jumpRing: 3, jumpRingWire: 0.8, postDiameter: 0.8, postLength: 10, back: "butterfly", top: "hook", topStone: 3, hookWire: 0.8, wall: 1.8, width: 2.2, profile: "flat", size: 6, sizeText: "6", ...extra },
    handles: [],
    size: null,
    pieces: kind === "pendant" ? 1 : 2,
    metal: { name: "gold18", grams: 1.2 },
    stones: { count: kind === "pendant" ? 1 : 2, carat: 0.9 },
    checks: [],
  };
}

describe("pieces not worn on a finger", () => {
  test("the kinds", () => {
    expect(isWorn("pendant") && isWorn("stud") && isWorn("drop")).toBe(true);
    expect(isWorn("solitaire")).toBe(false);
    expect(isPair("stud") && isPair("drop") && !isPair("pendant")).toBe(true);
  });

  for (const kind of ["pendant", "stud", "drop"]) {
    test(`a ${kind} shows no ring-only row`, () => {
      const piece = parsePiece(reply(kind));
      expect(piece).not.toBeNull();
      if (piece === null) return;
      const rows = pieceRows(piece, CHOICES, "us");
      const keys = rows.map((r) => r.key);
      for (const key of RING_ONLY) expect(keys).not.toContain(key);
      expect(keys).toContain("stoneWidth");
      const groups = pieceGroups(rows, kind).map((g) => g.name);
      expect(groups).not.toContain("Ring");
      expect(groups).not.toContain("Band");
      expect(groups).toContain("Findings");
    });
  }

  test("a pendant's bail and drop rows, and the drop tick sends `drop`", () => {
    const piece = parsePiece(reply("pendant", { drop: true, bail: "tube" }));
    if (piece === null) throw new Error("no piece");
    const rows = pieceRows(piece, CHOICES, "us");
    const keys = rows.map((r) => r.key);
    for (const key of ["bail", "bailOpening", "bailWire", "bailWidth", "chain", "drop", "jumpRing", "jumpRingWire"]) expect(keys).toContain(key);
    const drop = rows.find((r) => r.key === "drop");
    if (drop === undefined) throw new Error("no drop row");
    expect(judgePieceDraft(drop, "false")).toEqual({ kind: "send", patch: { drop: false } });
    expect(pieceHeading({ kind: "piece", piece })).toBe("Pendant");
  });

  test("studs and drops say pair", () => {
    const stud = parsePiece(reply("stud"));
    if (stud === null) throw new Error("no piece");
    expect(stud.pieces).toBe(2);
    expect(pieceHeading({ kind: "piece", piece: stud })).toBe("Stud earrings · pair");
    expect(pieceSummary(stud, "us").tiles.some((t) => t.value === "Pair")).toBe(true);
    expect(pieceSummary(stud, "us").tiles.some((t) => t.label === "Size")).toBe(false);
    const keys = pieceRows(stud, CHOICES, "us").map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["postDiameter", "postLength", "back"]));
    const drop = parsePiece(reply("drop", { top: "stud" }));
    if (drop === null) throw new Error("no piece");
    expect(pieceRows(drop, CHOICES, "us").map((r) => r.key)).toEqual(expect.arrayContaining(["top", "topStone", "postLength", "jumpRing"]));
  });

  test("the 3D handles of a worn piece are its stone's, never the band's", () => {
    const mesh = { parts: [{ name: "centre stone", part: "stone", color: [1, 1, 1], positions: [2.5, 1, 0, -2.5, 1, 0], indices: [] }] };
    const handles = pieceHandles({ kind: "pendant", stoneWidth: 5, wall: 1.8, width: 2.2 }, 16.5, mesh as never);
    expect(handles.map((h) => h.id)).toEqual(["stone"]);
  });

  test("the bench line of a pair says pair", () => {
    const sheet = parseBench({ stones: { count: 2, carat: 0.9, groups: [] }, bands: [{ grams: 1.1, metal: "gold18", size: "?", piece: "stud", pieces: 2, handle: "2A" }] });
    const line = sheet?.lines[0];
    expect(line?.label).toBe("18k gold stud earrings");
    expect(line?.value).toContain("pair");
    expect(sheet?.grams).toBeCloseTo(1.1, 6);
  });

  test("the gallery has pendants and earrings", () => {
    const kinds = groupTemplates(TEMPLATES).map((g) => g.kind);
    expect(kinds).toEqual(expect.arrayContaining(["pendant", "stud", "drop"]));
  });
});
