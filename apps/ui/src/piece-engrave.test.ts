/**
 * The Piece section's Engraving group: the engraving and hallmark read from the `piece` reply
 * (hostile text clipped), their rows, typed text and picks into the patch `piece` takes, and the
 * engine's refusals onto their rows.
 */

import { describe, expect, test } from "bun:test";
import { ENGRAVE_START, MAX_ENGRAVE, NO_CHOICES, judgePieceDraft, parsePiece, pieceGroups, pieceRows, refusalRow, type Piece, type PieceRow } from "./piece";
import { TEMPLATES } from "./templates";

function piece(params: Record<string, unknown>): Piece {
  const p = parsePiece({
    params: { kind: "band", sizeText: "6", sizeSystem: "us", wall: 1.8, width: 2.2, profile: "flat", metal: "gold18", ...params },
    handles: [],
    size: { diameter: 16.51, us: 6, usText: "6" },
    metal: { name: "gold18", grams: 3.1 },
    stones: { count: 0, carat: 0 },
    checks: [],
  });
  if (p === null) throw new Error("no piece");
  return p;
}

const rowsOf = (p: Piece): PieceRow[] => pieceRows(p, NO_CHOICES, "us");
const row = (rows: readonly PieceRow[], key: string): PieceRow => {
  const r = rows.find((x) => x.key === key);
  if (r === undefined) throw new Error(`no row ${key}`);
  return r;
};

describe("the engraving group", () => {
  test("an engine without engraving shows no Engraving group", () => {
    const rows = rowsOf(piece({}));
    expect(rows.some((r) => r.key.startsWith("engrave") || r.key.startsWith("hallmark"))).toBe(false);
  });

  test("no engraving: the ticks, unticked", () => {
    const rows = rowsOf(piece({ engrave: false, hallmark: false }));
    expect(row(rows, "engrave").value).toBe("false");
    expect(row(rows, "hallmark").value).toBe("false");
    expect(rows.some((r) => r.key === "engraveText")).toBe(false);
    expect(pieceGroups(rows, "band").map((g) => g.name)).toContain("Engraving");
  });

  test("an engraving inside: text, placement, letters, height, depth; no style", () => {
    const rows = rowsOf(piece({ engrave: { text: "Forever 14.02.2026", at: "inside", style: "cut", font: "block", depth: null, height: 1.1 }, hallmark: { maker: "CC" } }));
    const keys = pieceGroups(rows, "band").find((g) => g.name === "Engraving")?.rows.map((r) => r.key);
    expect(keys).toEqual(["engrave", "engraveText", "engraveAt", "engraveFont", "engraveHeight", "engraveDepth", "hallmark", "hallmarkMaker"]);
    expect(row(rows, "engraveText").value).toBe("Forever 14.02.2026");
    expect(row(rows, "engraveDepth").value).toBe("");
    expect(row(rows, "hallmarkMaker").value).toBe("CC");
  });

  test("outside, raised: a style row and the depth is the relief", () => {
    const rows = rowsOf(piece({ engrave: { text: "ANNA", at: "outside", style: "raised", font: "script" } }));
    expect(row(rows, "engraveStyle").value).toBe("raised");
    expect(row(rows, "engraveDepth").label).toBe("Relief, mm");
  });

  test("hostile text is clipped and kept on one line", () => {
    const p = piece({ engrave: { text: `a\nb${"x".repeat(500)}`, at: 7, style: null, font: {} }, hallmark: { maker: "ABCDEFGHIJKL" } });
    const e = p.params.engrave;
    if (e === false || e === null) throw new Error("no engraving");
    expect([...e.text].length).toBe(MAX_ENGRAVE);
    expect(e.text.includes("\n")).toBe(false);
    expect(e.at).toBe("inside");
    const h = p.params.hallmark;
    expect(h !== false && h !== null && h.maker.length).toBe(8);
  });
});

describe("edits into patches", () => {
  const rows = rowsOf(piece({ engrave: { text: "Forever", at: "inside", style: "cut", font: "block", depth: 0.3, height: null }, hallmark: false }));

  test("ticking the engraving on starts it with words; off sends false", () => {
    const off = rowsOf(piece({ engrave: false, hallmark: false }));
    expect(judgePieceDraft(row(off, "engrave"), "true")).toEqual({ kind: "send", patch: { engrave: { text: ENGRAVE_START } } });
    expect(judgePieceDraft(row(rows, "engrave"), "false")).toEqual({ kind: "send", patch: { engrave: false } });
    expect(judgePieceDraft(row(off, "hallmark"), "true")).toEqual({ kind: "send", patch: { hallmark: true } });
  });

  test("text is sent as typed, spaces folded; empty and too long are refused", () => {
    expect(judgePieceDraft(row(rows, "engraveText"), "  For   ever  ")).toEqual({ kind: "send", patch: { engrave: { text: "For ever" } } });
    expect(judgePieceDraft(row(rows, "engraveText"), "Forever ")).toEqual({ kind: "keep" });
    expect(judgePieceDraft(row(rows, "engraveText"), "  ").kind).toBe("refuse");
    expect(judgePieceDraft(row(rows, "engraveText"), "x".repeat(MAX_ENGRAVE + 1)).kind).toBe("refuse");
  });

  test("placement, letters and numbers go into `engrave`; an emptied number is the default", () => {
    expect(judgePieceDraft(row(rows, "engraveAt"), "outside")).toEqual({ kind: "send", patch: { engrave: { at: "outside" } } });
    expect(judgePieceDraft(row(rows, "engraveFont"), "script")).toEqual({ kind: "send", patch: { engrave: { font: "script" } } });
    expect(judgePieceDraft(row(rows, "engraveDepth"), "0.2")).toEqual({ kind: "send", patch: { engrave: { depth: 0.2 } } });
    expect(judgePieceDraft(row(rows, "engraveDepth"), "")).toEqual({ kind: "send", patch: { engrave: { depth: null } } });
    expect(judgePieceDraft(row(rows, "engraveHeight"), "")).toEqual({ kind: "keep" });
  });

  test("the maker's mark", () => {
    const marked = rowsOf(piece({ hallmark: { maker: "" } }));
    expect(judgePieceDraft(row(marked, "hallmarkMaker"), "CC")).toEqual({ kind: "send", patch: { hallmark: { maker: "CC" } } });
    expect(judgePieceDraft(row(marked, "hallmarkMaker"), "ABCDEFGHI").kind).toBe("refuse");
  });
});

describe("refusals land on their rows", () => {
  const rows = rowsOf(piece({ engrave: { text: "Hi", at: "inside", style: "cut", font: "block" }, hallmark: { maker: "" } }));
  test.each([
    ["invalid parameters for `piece`: the engraving font cannot cut “♥”: use letters", "engraveText"],
    ["“Forever and ever” is too long for the band: at 1.1 mm high", "engraveText"],
    ["`engrave.depth` must be a number of millimetres from 0.05 to 2", "engraveDepth"],
    ["`hallmark.maker` is at most 8 characters", "hallmarkMaker"],
    ["steel has no fineness mark to hallmark", "hallmark"],
  ])("%s", (error, key) => {
    expect(refusalRow(error, rows)).toBe(key);
  });
});

test("the gallery has a name ring", () => {
  const t = TEMPLATES.find((x) => x.id === "name-ring");
  expect(t?.params["engrave"]).toEqual({ text: "ANNA", at: "outside", style: "raised" });
});
