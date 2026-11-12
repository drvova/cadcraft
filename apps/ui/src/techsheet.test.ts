/**
 * The Tech Sheet's pure logic: the sheet assembled from the three engine replies, and the tiles'
 * render state. Every figure the sheet shows is checked to be the engine's, never worked out here.
 */

import { describe, expect, test } from "bun:test";
import type { Envelope } from "./facade";
import {
  assembleSheet,
  BACKGROUND_OPTIONS,
  failedCount,
  freshTiles,
  meshRequest,
  nextPending,
  setTile,
  SHEET_VIEWS,
  tilesSettled,
  wantsInk,
} from "./techsheet";

const ok = (result: unknown): Envelope => ({ ok: true, result });
const bad = (error: string): Envelope => ({ ok: false, error });

/** A solitaire as the engine answers `piece {query:true}`. */
function pieceReply(over: Record<string, unknown> = {}): Envelope {
  return ok({
    piece: {
      params: {
        kind: "solitaire",
        sizeSystem: "us",
        sizeText: "6½",
        wall: 1.8,
        width: 2.2,
        profile: "flat",
        metal: "gold18",
        cut: "round",
        stoneWidth: 6.5,
        prongs: 6,
        halo: false,
      },
      size: {
        mm: 16.51,
        diameter: 16.51,
        circumference: 51.87,
        us: 6.5,
        usText: "6½",
        uk: "L½",
        eu: 52,
        jp: 12,
        cn: 12,
      },
      metal: { name: "gold18", density: 15.5, grams: 3.42 },
      stones: { count: 1, carat: 1.03 },
      checks: [
        { id: "wall", ok: true, message: "The wall is thick enough to cast" },
        {
          id: "head",
          ok: false,
          message: "The head does not clear the finger",
        },
      ],
      handles: ["A1"],
      ...over,
    },
  });
}

/** A one-triangle solid as `piecemesh` answers. */
function meshReply(): Envelope {
  return ok({
    meshes: [
      {
        part: "metal",
        name: "band",
        color: [214, 178, 92],
        positions: [0, 0, 0, 2, 0, 0, 0, 2, 0],
        indices: [0, 1, 2],
      },
    ],
    bounds: { min: [-1, -1, -0.5], max: [1, 1, 0.5] },
    triangles: 1,
    notes: [],
  });
}

/** A bench reply as `techsheet` answers, with a solitaire's centre stone, a halo melee and a band. */
function benchReply(): Envelope {
  return ok({
    stones: {
      count: 19,
      carat: 1.21,
      groups: [
        { count: 1, width: 6.5, carat: 1.03, cut: "round" },
        { count: 18, width: 1.3, carat: 0.18, cut: "round", calibrated: false },
      ],
    },
    bands: [{ metal: "gold18", grams: 3.42, size: "6½", handle: "A1" }],
    warnings: [],
  });
}

describe("assembleSheet", () => {
  test("the header names the kind, the finger and the alloy", () => {
    expect(assembleSheet(pieceReply(), meshReply(), benchReply()).title).toBe(
      "Solitaire · US 6½ · 18k gold",
    );
  });

  test("the overall size is the mesh's box and the inside diameter the finger's, formatted not measured", () => {
    const sheet = assembleSheet(pieceReply(), meshReply(), benchReply());
    expect(sheet.dimensions).toEqual([
      { label: "Overall size", value: "2.0 × 2.0 × 1.0 mm" },
      { label: "Inside diameter", value: "16.51 mm" },
    ]);
  });

  test("the ring size is given in every system the engine named", () => {
    expect(
      assembleSheet(pieceReply(), meshReply(), benchReply()).ringSizes,
    ).toEqual([
      { label: "US", value: "6½" },
      { label: "UK", value: "L½" },
      { label: "EU", value: "52" },
      { label: "JP", value: "12" },
      { label: "CN", value: "12" },
    ]);
  });

  test("the stones are the bench's stone lines, the melee size flagged, with a total", () => {
    const sheet = assembleSheet(pieceReply(), meshReply(), benchReply());
    expect(sheet.stones).toEqual([
      { name: "Round 6.5 mm", count: "1 pc", carat: "1.03 ct", note: null },
      {
        name: "Round 1.3 mm",
        count: "18 pc",
        carat: "0.18 ct",
        note: "Not a calibrated melee size",
      },
    ]);
    expect(sheet.stoneTotal).toEqual({
      label: "Total",
      value: "19 pc · 1.21 ct",
    });
  });

  test("the metal is the bench's bands and their total weight", () => {
    const sheet = assembleSheet(pieceReply(), meshReply(), benchReply());
    expect(sheet.bands).toEqual([
      { label: "18k gold band", value: "6½ · 3.42 g" },
    ]);
    expect(sheet.metalTotal).toEqual({ label: "Total", value: "3.42 g" });
  });

  test("the checks are the engine's, pass and fail kept", () => {
    const sheet = assembleSheet(pieceReply(), meshReply(), benchReply());
    expect(sheet.checks.map((c) => [c.id, c.ok])).toEqual([
      ["wall", true],
      ["head", false],
    ]);
    expect(failedCount(sheet)).toBe(1);
  });

  test("a drawing with no parametric piece still shows the bench, with a note that there is nothing to render", () => {
    const sheet = assembleSheet(
      ok({ piece: null }),
      bad("piecemesh: the drawing has no piece"),
      benchReply(),
    );
    expect(sheet.title).toBe("Tech Sheet");
    expect(sheet.piece).toBeNull();
    expect(sheet.mesh).toBeNull();
    expect(sheet.note).toContain("no parametric piece");
    // The bench still lands.
    expect(sheet.stones.length).toBe(2);
    expect(sheet.metalTotal).toEqual({ label: "Total", value: "3.42 g" });
  });

  test("a mesh that could not be read leaves the stills out and keeps the engine's reason", () => {
    const sheet = assembleSheet(
      pieceReply(),
      meshReply2("its bounds are inside out"),
      benchReply(),
    );
    expect(sheet.mesh).toBeNull();
    expect(sheet.note).toContain("inside out");
    // The rest of the sheet is unaffected.
    expect(sheet.dimensions).toEqual([
      { label: "Inside diameter", value: "16.51 mm" },
    ]);
    expect(sheet.checks.length).toBe(2);
  });

  test("refusals leave each part empty without throwing", () => {
    const sheet = assembleSheet(
      bad("piece: refused"),
      bad("piecemesh: refused"),
      bad("techsheet: refused"),
    );
    expect(sheet.piece).toBeNull();
    expect(sheet.mesh).toBeNull();
    expect(sheet.stones).toEqual([]);
    expect(sheet.bands).toEqual([]);
    expect(sheet.stoneTotal).toBeNull();
    expect(sheet.checks).toEqual([]);
  });

  test("hostile replies are narrowed, not trusted", () => {
    const sheet = assembleSheet(
      ok({ piece: { params: { kind: "boat" } } }),
      ok("not a mesh"),
      ok([1, 2, 3]),
    );
    expect(sheet.piece).toBeNull();
    expect(sheet.mesh).toBeNull();
    expect(sheet.stones).toEqual([]);
  });
});

/** A `piecemesh` reply whose bounds are inside out, so `parseMeshReply` refuses it. */
function meshReply2(_reason: string): Envelope {
  return ok({
    meshes: [
      {
        part: "metal",
        name: "band",
        color: [214, 178, 92],
        positions: [0, 0, 0, 2, 0, 0, 0, 2, 0],
        indices: [0, 1, 2],
      },
    ],
    bounds: { min: [1, 1, 1], max: [-1, -1, -1] },
    triangles: 1,
    notes: [],
  });
}

describe("meshRequest", () => {
  test("hands the piece's own params back for the solid", () => {
    expect(meshRequest(pieceReply())).toMatchObject({
      kind: "solitaire",
      metal: "gold18",
      wall: 1.8,
    });
  });

  test("a drawing with no piece, or a refusal, asks for no mesh", () => {
    expect(meshRequest(ok({ piece: null }))).toBeNull();
    expect(meshRequest(bad("piece: refused"))).toBeNull();
    expect(meshRequest(ok({ piece: { size: {} } }))).toBeNull();
  });
});

describe("the choices applied to every tile", () => {
  test("the background offers the sheet's surface or a cut-out", () => {
    expect(BACKGROUND_OPTIONS.map((o) => o.value)).toEqual([
      "surface",
      "transparent",
    ]);
  });

  test("only a wireframe or an X-ray over the surface wants a dark ink for its lines", () => {
    expect(wantsInk("wireframe", "surface")).toBe(true);
    expect(wantsInk("xray", "surface")).toBe(true);
    expect(wantsInk("shaded", "surface")).toBe(false);
    expect(wantsInk("ghosted", "surface")).toBe(false);
    expect(wantsInk("wireframe", "transparent")).toBe(false);
  });
});

describe("the tiles' render state", () => {
  test("a fresh run has the four views pending, the plan first and a perspective last", () => {
    const tiles = freshTiles();
    expect(tiles.map((t) => t.view)).toEqual([
      "top",
      "front",
      "side",
      "three-quarter",
    ]);
    expect(tiles.map((t) => t.label)).toEqual([
      "Top",
      "Front",
      "Side",
      "Perspective",
    ]);
    expect(tiles.every((t) => t.phase === "pending")).toBe(true);
    expect(SHEET_VIEWS.length).toBe(4);
  });

  test("the next pending view is drawn, one at a time, until every tile has settled", () => {
    let tiles = freshTiles();
    expect(nextPending(tiles)).toBe("top");
    tiles = setTile(tiles, "top", "rendering");
    // A tile in flight is not the next to start.
    expect(nextPending(tiles)).toBe("front");
    tiles = setTile(tiles, "top", "done");
    tiles = setTile(tiles, "front", "failed", "no WebGL");
    expect(tiles.find((t) => t.view === "front")?.message).toBe("no WebGL");
    expect(tilesSettled(tiles)).toBe(false);
    tiles = setTile(tiles, "side", "done");
    tiles = setTile(tiles, "three-quarter", "done");
    expect(nextPending(tiles)).toBeNull();
    expect(tilesSettled(tiles)).toBe(true);
  });

  test("setTile changes one tile and leaves the others", () => {
    const tiles = setTile(freshTiles(), "side", "rendering");
    expect(
      tiles.filter((t) => t.phase === "pending").map((t) => t.view),
    ).toEqual(["top", "front", "three-quarter"]);
  });
});
