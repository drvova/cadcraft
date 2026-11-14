/**
 * Hoop earrings and basket heads in the Piece section: a hoop's rows (its wire, its closure, pavé
 * along the front, no stone or head), their groups and the patches they send, the heading and the
 * summary saying "pair", the hoop's drag handle, the bench line of a pair of hoops, and a basket
 * head's rails and under-gallery rows on a ring and on studs; the templates for both.
 */

import { describe, expect, test } from "bun:test";
import { parseBench } from "./bench";
import { pieceHandles } from "./handles";
import { isHeaded, isPair, isWorn, judgePieceDraft, parsePiece, pieceGroups, pieceHeading, pieceRows, pieceSummary, type PieceChoices } from "./piece";
import { BUILDABLE_KINDS, TEMPLATES, groupTemplates } from "./templates";

const CHOICES: PieceChoices = { metals: [], cuts: [], stones: [], round: ["round"] };

function hoop(extra: Record<string, unknown> = {}): unknown {
  return {
    params: {
      kind: "hoop",
      metal: "gold18",
      cut: "round",
      stone: "diamond",
      stoneWidth: 6.5,
      head: "prong",
      hoopDiameter: 20,
      hoopThickness: 2,
      hoopWidth: null,
      hoopSection: "round",
      hoopWall: null,
      hoopGap: 1,
      closure: "post",
      postDiameter: 0.8,
      pave: false,
      ...extra,
    },
    handles: [],
    size: null,
    pieces: 2,
    metal: { name: "gold18", grams: 4.6 },
    stones: { count: 0, carat: 0 },
    checks: [{ id: "hoop-wall", ok: true, message: "The round wire is 2 mm at its thinnest" }],
  };
}

function ring(extra: Record<string, unknown> = {}): unknown {
  return {
    params: { kind: "solitaire", cut: "round", stone: "diamond", stoneWidth: 6.5, stoneLength: 6.5, prongs: 4, halo: false, head: "basket", basketRails: null, gallery: "arches", prongStyle: "round", metal: "platinum", wall: 1.8, width: 2.2, profile: "flat", size: 6, sizeText: "6", pave: false, ...extra },
    handles: [],
    size: { diameter: 16.51, us: 6 },
    pieces: 1,
    metal: { name: "platinum", grams: 5.1, prongGrams: 0.4 },
    stones: { count: 1, carat: 1.0 },
    checks: [],
  };
}

describe("hoop earrings", () => {
  test("a hoop is a worn pair without a head", () => {
    expect(isWorn("hoop") && isPair("hoop")).toBe(true);
    expect(isHeaded("hoop")).toBe(false);
    expect(isHeaded("stud")).toBe(true);
  });

  test("its rows are the hoop's, the closure's and pavé, never a stone's or a ring's", () => {
    const piece = parsePiece(hoop());
    if (piece === null) throw new Error("no piece");
    const keys = pieceRows(piece, CHOICES, "us").map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["kind", "metal", "hoopDiameter", "hoopSection", "hoopThickness", "closure", "hoopGap", "postDiameter", "pave"]));
    for (const key of ["size", "system", "wall", "width", "stoneWidth", "cut", "head", "prongs", "halo", "hoopWidth", "hoopWall"]) expect(keys).not.toContain(key);
    const groups = pieceGroups(pieceRows(piece, CHOICES, "us"), "hoop").map((g) => g.name);
    expect(groups).toEqual(["Piece", "Hoop", "Findings", "Pavé"]);
    expect(pieceHeading({ kind: "piece", piece })).toBe("Hoop earrings · pair");
    const summary = pieceSummary(piece, "us");
    expect(summary.centre).toBeNull();
    expect(summary.tiles.some((t) => t.value === "Pair")).toBe(true);
  });

  test("a square or knife wire has a width, a tube its wall; a click-top no gap or post", () => {
    const square = parsePiece(hoop({ hoopSection: "knife", hoopWidth: 1.4 }));
    const tube = parsePiece(hoop({ hoopSection: "tube", hoopWall: 0.35, closure: "click" }));
    if (square === null || tube === null) throw new Error("no piece");
    expect(pieceRows(square, CHOICES, "us").map((r) => r.key)).toContain("hoopWidth");
    const keys = pieceRows(tube, CHOICES, "us").map((r) => r.key);
    expect(keys).toContain("hoopWall");
    expect(keys).not.toContain("hoopGap");
    expect(keys).not.toContain("postDiameter");
  });

  test("its rows send the engine's own keys", () => {
    const piece = parsePiece(hoop({ pave: { layout: "row", melee: 1.3, gap: 0.2, span: null } }));
    if (piece === null) throw new Error("no piece");
    const rows = pieceRows(piece, CHOICES, "us");
    const row = (key: string) => {
      const r = rows.find((x) => x.key === key);
      if (r === undefined) throw new Error(`no ${key}`);
      return r;
    };
    expect(judgePieceDraft(row("hoopDiameter"), "25")).toEqual({ kind: "send", patch: { hoopDiameter: 25 } });
    expect(judgePieceDraft(row("hoopSection"), "tube")).toEqual({ kind: "send", patch: { hoopSection: "tube" } });
    expect(judgePieceDraft(row("closure"), "click")).toEqual({ kind: "send", patch: { closure: "click" } });
    expect(judgePieceDraft(row("hoopGap"), "1,5")).toEqual({ kind: "send", patch: { hoopGap: 1.5 } });
    expect(judgePieceDraft(row("hoopThickness"), "thick").kind).toBe("refuse");
    expect(judgePieceDraft(row("paveMelee"), "1.5")).toEqual({ kind: "send", patch: { pave: { melee: 1.5 } } });
    // Pavé given as angles reads as custom.
    expect(row("paveSpan").value).toBe("custom");
  });

  test("the hoop's diameter is a handle on its outside; it has no stone or band handle", () => {
    const mesh = { parts: [{ name: "band", part: "metal", color: [1, 1, 1], positions: [23, 0, 0, -3, 0, 0], indices: [] }] };
    const handles = pieceHandles({ kind: "hoop", hoopDiameter: 20, stoneWidth: 6.5, wall: 1.8, width: 2.2 }, null, mesh as never);
    expect(handles.map((h) => h.id)).toEqual(["hoop"]);
    const [h] = handles;
    expect(h?.key).toBe("hoopDiameter");
    expect(h?.anchor).toEqual([23, 0, 0]);
    expect(h?.min).toBe(6);
    expect(h?.max).toBe(80);
  });

  test("the bench reads a pair of hoops", () => {
    const bench = parseBench({ bands: [{ piece: "hoop", metal: "gold18", grams: 4.6, pieces: 2 }], stones: { count: 0, carat: 0, groups: [] } });
    const text = JSON.stringify(bench);
    expect(text).toContain("hoop earrings");
    expect(text).toContain("pair");
  });
});

describe("basket heads", () => {
  test("a basket solitaire shows its rails and under-gallery in the Head group", () => {
    const piece = parsePiece(ring());
    if (piece === null) throw new Error("no piece");
    const rows = pieceRows(piece, CHOICES, "us");
    const rails = rows.find((r) => r.key === "basketRails");
    const gallery = rows.find((r) => r.key === "gallery");
    if (rails === undefined || gallery === undefined) throw new Error("no basket rows");
    expect(rails.value).toBe("2");
    expect(gallery.value).toBe("arches");
    const head = pieceGroups(rows, "solitaire").find((g) => g.name === "Head");
    expect(head?.rows.map((r) => r.key)).toEqual(expect.arrayContaining(["head", "prongs", "basketRails", "gallery"]));
    expect(judgePieceDraft(rails, "1")).toEqual({ kind: "send", patch: { basketRails: 1 } });
    expect(judgePieceDraft(rails, "1.5").kind).toBe("refuse");
    expect(judgePieceDraft(gallery, "scallop")).toEqual({ kind: "send", patch: { gallery: "scallop" } });
    expect(pieceSummary(piece, "us").centre).toBe("6.5 mm round diamond, 4 basket");
    expect(rows.find((r) => r.key === "head")?.choices?.map((c) => c.value)).toContain("basket");
  });

  test("a prong head has no basket rows; studs take a basket too", () => {
    const prong = parsePiece(ring({ head: "prong" }));
    if (prong === null) throw new Error("no piece");
    expect(pieceRows(prong, CHOICES, "us").map((r) => r.key)).not.toContain("basketRails");
    const stud = parsePiece({ ...(ring() as Record<string, unknown>), params: { ...(ring() as { params: Record<string, unknown> }).params, kind: "stud", postDiameter: 0.8, postLength: 10, back: "butterfly" }, size: null, pieces: 2 });
    if (stud === null) throw new Error("no piece");
    expect(pieceRows(stud, CHOICES, "us").map((r) => r.key)).toEqual(expect.arrayContaining(["basketRails", "gallery", "postDiameter"]));
  });
});

describe("the templates", () => {
  test("hoop earrings and a basket solitaire are offered, each a full piece", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["hoop-earrings", "pave-hoops", "basket-solitaire"]));
    const basket = TEMPLATES.find((t) => t.id === "basket-solitaire");
    expect(basket?.params["head"]).toBe("basket");
    expect(BUILDABLE_KINDS).toContain("hoop");
    const groups = groupTemplates(TEMPLATES);
    const hoops = groups.find((g) => g.kind === "hoop");
    expect(hoops?.label).toBe("Hoop earrings");
    expect(hoops?.templates.map((t) => t.id)).toEqual(["hoop-earrings", "pave-hoops"]);
  });
});
