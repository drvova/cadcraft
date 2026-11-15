/**
 * The Piece section's graduated stones and flowed motif: read from the `piece` reply (hostile
 * values held), their rows, picks and typed numbers into the patch `piece` takes, the engine's
 * refusals onto their rows, and the two templates.
 */

import { describe, expect, test } from "bun:test";
import { NO_CHOICES, judgePieceDraft, parsePiece, pieceGroups, pieceRows, refusalRow, type Piece, type PieceRow } from "./piece";
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

describe("graduated stones", () => {
  test("an engine without graduation shows no row", () => {
    expect(rowsOf(piece({ kind: "eternity", melee: 1.8 })).some((r) => r.key === "graduate")).toBe(false);
  });

  test("off: one tick; ticking it on sends graduate: true", () => {
    const rows = rowsOf(piece({ kind: "eternity", melee: 1.8, graduate: false }));
    expect(row(rows, "graduate").value).toBe("false");
    expect(rows.some((r) => r.key === "gradeEnd")).toBe(false);
    expect(judgePieceDraft(row(rows, "graduate"), "true")).toEqual({ kind: "send", patch: { graduate: true } });
  });

  test("on: the end size and the grading, in the Stones group", () => {
    const rows = rowsOf(piece({ kind: "halfeternity", melee: 2.4, graduate: { end: 1.4, curve: "smooth" } }));
    expect(row(rows, "gradeEnd").value).toBe("1.4");
    expect(row(rows, "gradeCurve").value).toBe("smooth");
    const stones = pieceGroups(rows, "halfeternity").find((g) => g.name === "Stones")?.rows.map((r) => r.key);
    expect(stones).toContain("gradeEnd");
    expect(judgePieceDraft(row(rows, "gradeEnd"), "1.2")).toEqual({ kind: "send", patch: { graduate: { end: 1.2 } } });
    expect(judgePieceDraft(row(rows, "gradeCurve"), "linear")).toEqual({ kind: "send", patch: { graduate: { curve: "linear" } } });
    expect(judgePieceDraft(row(rows, "graduate"), "false")).toEqual({ kind: "send", patch: { graduate: false } });
  });

  test("a band shows no graduation, whatever the engine holds", () => {
    expect(rowsOf(piece({ graduate: { end: 1 } })).some((r) => r.key === "graduate")).toBe(false);
  });

  test("hostile graduation is held as unknown", () => {
    const rows = rowsOf(piece({ kind: "eternity", graduate: { end: "x", curve: 7 } }));
    expect(row(rows, "gradeEnd").value).toBe("");
    expect(row(rows, "gradeCurve").value).toBe("linear");
  });

  test("a refusal of `graduate.end` lands on its row", () => {
    const rows = rowsOf(piece({ kind: "eternity", graduate: { end: 1.2, curve: "linear" } }));
    expect(refusalRow("`graduate.end` must be a stone size in millimetres from 0.8 to 6", rows)).toBe("gradeEnd");
  });
});

describe("the flowed motif", () => {
  const motif = { strokes: [[[0, 0], [1, 1]], [[2, 0], [3, 1]]], source: "layer Motif", at: "outside", style: "cut", fit: "rigid", scale: null, depth: 0.2 };

  test("off: a tick that flows the selection", () => {
    const rows = rowsOf(piece({ flow: false }));
    expect(row(rows, "flow").value).toBe("false");
    expect(judgePieceDraft(row(rows, "flow"), "true")).toEqual({ kind: "send", patch: { flow: { selection: true } } });
  });

  test("on: where it came from, the surface, how it is made and fitted, in the Engraving group", () => {
    const rows = rowsOf(piece({ flow: motif }));
    expect(row(rows, "flowSource").value).toBe("layer Motif (2 strokes)");
    expect(row(rows, "flowSource").kind).toBe("readonly");
    const keys = pieceGroups(rows, "band").find((g) => g.name === "Engraving")?.rows.map((r) => r.key);
    expect(keys).toEqual(["flow", "flowSource", "flowAt", "flowStyle", "flowFit", "flowScale", "flowDepth"]);
    expect(judgePieceDraft(row(rows, "flowFit"), "stretch")).toEqual({ kind: "send", patch: { flow: { fit: "stretch" } } });
    expect(judgePieceDraft(row(rows, "flowDepth"), "0.25")).toEqual({ kind: "send", patch: { flow: { depth: 0.25 } } });
    expect(judgePieceDraft(row(rows, "flow"), "false")).toEqual({ kind: "send", patch: { flow: false } });
  });

  test("inside: no Made row (a raised motif goes outside)", () => {
    const rows = rowsOf(piece({ flow: { ...motif, at: "inside" } }));
    expect(rows.some((r) => r.key === "flowStyle")).toBe(false);
  });

  test("hostile source text is clipped to one line", () => {
    const rows = rowsOf(piece({ flow: { ...motif, source: `a\n${"x".repeat(500)}`, strokes: "no" } }));
    expect(row(rows, "flowSource").value.length).toBeLessThan(90);
    expect(row(rows, "flowSource").value).not.toContain("\n");
  });

  test("a refusal of `flow.scale` lands on its row, and motif words on the tick", () => {
    const rows = rowsOf(piece({ flow: motif }));
    expect(refusalRow("`flow.scale` must be a number from 0.001 to 1000", rows)).toBe("flowScale");
    expect(refusalRow("the engraving is already on the band's outside: flow the motif onto the other surface", rows)).toBe("flow");
  });
});

describe("the templates", () => {
  test("a graduated eternity and a flowed motif band are in the gallery", () => {
    const grad = TEMPLATES.find((t) => t.id === "graduated-eternity");
    const flow = TEMPLATES.find((t) => t.id === "flowed-motif-band");
    expect(grad?.params["graduate"]).toEqual({ end: 1.4, curve: "smooth" });
    expect(Array.isArray((flow?.params["flow"] as { strokes: unknown }).strokes)).toBe(true);
  });
});
