/**
 * The band's Pattern group: the engine's `pattern` read with checked narrowing, its rows per
 * motif and finish, what a pick or a typed number sends (the motif's own object, which the engine
 * merges key by key), Shuffle's next seed, and a refusal onto its row.
 */

import { describe, expect, test } from "bun:test";
import { judgePieceDraft, nextSeed, parsePiece, pieceGroups, pieceRows, refusalRow, type Piece, type PieceChoices, type PieceRow } from "./piece";
import { TEMPLATES } from "./templates";

const CHOICES: PieceChoices = { metals: [{ value: "gold18", label: "18k gold" }], cuts: [{ value: "round", label: "Round" }], stones: [{ value: "diamond", label: "Diamond" }], round: ["round"] };

function band(pattern: unknown, pave: unknown = false): Piece {
  const read = parsePiece({
    params: { kind: "band", system: "us", size: 6, sizeText: "6", sizeSystem: "us", wall: 1.6, width: 6, profile: "flat", metal: "gold18", pave, pattern },
    handles: [],
    size: { mm: 16.5, diameter: 16.5, us: 6, usText: "6" },
    metal: { name: "gold18", grams: 4.2 },
    stones: { count: 0, carat: 0 },
    checks: [{ id: "pattern", ok: true, message: "24 cells pierced through" }],
  });
  if (read === null) throw new Error("the piece did not parse");
  return read;
}

const VORONOI = { voronoi: { cells: 24, seed: 7, jitter: 0.8, wall: 0.8, rim: null, depth: null, relief: null } };
const keys = (rows: readonly PieceRow[]): string[] => rows.map((r) => r.key);
const find = (rows: readonly PieceRow[], key: string): PieceRow => {
  const row = rows.find((r) => r.key === key);
  if (row === undefined) throw new Error(`no row ${key}`);
  return row;
};

describe("the pattern rows", () => {
  test("an engine without patterns shows none; one with them offers the motif", () => {
    expect(keys(pieceRows(band(undefined), CHOICES, "us"))).not.toContain("pattern");
    const none = pieceRows(band(false), CHOICES, "us");
    expect(find(none, "pattern").value).toBe("none");
    expect(keys(none)).not.toContain("patternShuffle");
  });

  test("a Voronoi band shows its cells, rib, finish and Shuffle, in the Pattern group", () => {
    const rows = pieceRows(band(VORONOI), CHOICES, "us");
    expect(keys(rows).filter((k) => k.startsWith("pattern"))).toEqual(["pattern", "patternAmount", "patternWall", "patternFinish", "patternShuffle"]);
    expect(find(rows, "patternAmount").label).toBe("Cells");
    expect(find(rows, "patternFinish").value).toBe("pierced");
    expect(keys(rows)).not.toContain("pave");
    const group = pieceGroups(rows, "band").find((g) => g.name === "Pattern");
    expect(group?.rows.length).toBe(5);
  });

  test("a honeycomb has no seed to shuffle; relief shows its depth", () => {
    const rows = pieceRows(band({ hex: { size: 2.4, wall: 0.7, depth: 0.3, relief: "recessed" } }), CHOICES, "us");
    expect(keys(rows)).not.toContain("patternShuffle");
    expect(find(rows, "patternFinish").value).toBe("recessed");
    expect(find(rows, "patternDepth").value).toBe("0.3");
  });

  test("hostile pattern values never reach the page as numbers", () => {
    for (const bad of [{ voronoi: 3 }, { zigzag: {} }, "voronoi", [1], { voronoi: { cells: -5, seed: "x" } }]) {
      const p = band(bad);
      const pat = p.params.pattern;
      if (pat !== null && pat !== false) {
        expect(pat.amount === null || pat.amount >= 0).toBe(true);
        expect(pat.seed).toBeNull();
      }
    }
  });
});

describe("what the pattern rows send", () => {
  const p = band(VORONOI);
  const rows = pieceRows(p, CHOICES, "us");
  const pat = p.params.pattern;

  test("a motif picked starts it; none takes it away", () => {
    const none = pieceRows(band(false), CHOICES, "us");
    expect(judgePieceDraft(find(none, "pattern"), "hex")).toEqual({ kind: "send", patch: { pattern: { hex: {} } } });
    expect(judgePieceDraft(find(none, "pattern"), "truchet")).toEqual({ kind: "send", patch: { pattern: { truchet: { depth: 0.3 } } } });
    expect(judgePieceDraft(find(rows, "pattern"), "none")).toEqual({ kind: "send", patch: { pattern: false } });
  });

  test("each number goes inside the motif's own object", () => {
    expect(judgePieceDraft(find(rows, "patternAmount"), "30", "us", pat)).toEqual({ kind: "send", patch: { pattern: { voronoi: { cells: 30 } } } });
    expect(judgePieceDraft(find(rows, "patternAmount"), "2.5", "us", pat).kind).toBe("refuse");
    expect(judgePieceDraft(find(rows, "patternWall"), "0,9", "us", pat)).toEqual({ kind: "send", patch: { pattern: { voronoi: { wall: 0.9 } } } });
    expect(judgePieceDraft(find(rows, "patternWall"), "0.8", "us", pat)).toEqual({ kind: "keep" });
  });

  test("the finish switches between pierced and relief", () => {
    expect(judgePieceDraft(find(rows, "patternFinish"), "raised", "us", pat)).toEqual({ kind: "send", patch: { pattern: { voronoi: { depth: 0.3, relief: "raised" } } } });
    const relief = band({ voronoi: { cells: 24, seed: 7, depth: 0.4, relief: "raised" } });
    const r = pieceRows(relief, CHOICES, "us");
    expect(judgePieceDraft(find(r, "patternFinish"), "pierced", "us", relief.params.pattern)).toEqual({ kind: "send", patch: { pattern: { voronoi: { depth: null, relief: null } } } });
  });

  test("Shuffle sends the next seed, and the next differs again", () => {
    const shuffle = find(rows, "patternShuffle");
    expect(judgePieceDraft(shuffle, shuffle.value, "us", pat)).toEqual({ kind: "send", patch: { pattern: { voronoi: { seed: nextSeed(7) } } } });
    const seen = new Set<number>();
    let s = 1;
    for (let i = 0; i < 50; i++) {
      s = nextSeed(s);
      expect(Number.isInteger(s) && s >= 0 && s < 4294967296).toBe(true);
      seen.add(s);
    }
    expect(seen.size).toBe(50);
  });

  test("a refusal naming a pattern key lands on its row", () => {
    expect(refusalRow("piece: `pattern.cells` must be a whole number of cells from 3 to 600", rows)).toBe("patternAmount");
    expect(refusalRow("piece: `pattern.wall` must be millimetres of rib from 0.3 to 3", rows)).toBe("patternWall");
  });
});

test("the gallery has a Voronoi band and a honeycomb band", () => {
  const ids = TEMPLATES.map((t) => t.id);
  expect(ids).toContain("voronoi-band");
  expect(ids).toContain("honeycomb-band");
});
