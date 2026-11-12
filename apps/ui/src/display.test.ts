/**
 * The display-list parser against a canned reply carrying every primitive kind the facade can
 * emit, plus the hostile shapes it must survive.
 */

import { describe, expect, test } from "bun:test";
import { boundsOfPrim, displayListOf, parseDisplayList, parseSheet } from "./display";

const CANNED = JSON.stringify({
  revision: 7,
  bounds: [0, 0, 10, 5],
  verts: [
    [0, 0],
    [10, 0],
    [10, 5],
    [0, 5],
    [2, 2],
    [3, 2],
    [2, 3],
    [4, 4],
    [6, 4],
    [5, 5],
    [7, 7],
  ],
  prims: [
    { kind: "polyline", start: 0, len: 4, color: [255, 0, 0], lw: 0.25, alpha: 255, handle: 1 },
    { kind: "tris", start: 4, len: 3, color: [0, 255, 0], lw: 0, alpha: 128, handle: 2 },
    { kind: "point", start: 7, len: 1, color: [0, 0, 255], lw: 0, alpha: 255, handle: 3 },
    { kind: "image", start: 7, len: 4, color: [255, 255, 0], lw: 0, alpha: 200, handle: 4 },
  ],
});

describe("parseDisplayList", () => {
  test("reads the canned reply: revision, bounds, verts and all four prim kinds", () => {
    const list = parseDisplayList(CANNED);
    expect(list).not.toBeNull();
    if (list === null) return;
    expect(list.revision).toBe(7);
    expect(list.bounds).toEqual({ x0: 0, y0: 0, x1: 10, y1: 5 });
    expect(list.verts.length).toBe(11);
    expect(list.prims.map((p) => p.kind)).toEqual(["polyline", "tris", "point", "image"]);
    expect(list.prims[0]?.color).toEqual([255, 0, 0]);
    expect(list.prims[0]?.lw).toBe(0.25);
    // alpha arrives 0..255 and is kept 0..1 for canvas use.
    expect(list.prims[1]?.alpha).toBeCloseTo(128 / 255, 6);
    expect(list.prims[3]?.alpha).toBeCloseTo(200 / 255, 6);
    expect(list.prims[0]?.handle).toBe(1);
  });

  test("drops primitives whose vertex range falls outside verts, and unknown kinds", () => {
    const hostile = JSON.stringify({
      revision: 1,
      bounds: [0, 0, 1, 1],
      verts: [[0, 0], [1, 1]],
      prims: [
        { kind: "polyline", start: 1, len: 5, color: [1, 2, 3], lw: 1, alpha: 255, handle: 1 },
        { kind: "spline", start: 0, len: 2, color: [1, 2, 3], lw: 1, alpha: 255, handle: 2 },
        { kind: "point", start: -1, len: 1, color: [1, 2, 3], lw: 1, alpha: 255, handle: 3 },
        { kind: "point", start: 1, len: 1, color: [1, 2, 3], lw: 1, alpha: 255, handle: 4 },
      ],
    });
    const list = parseDisplayList(hostile);
    expect(list).not.toBeNull();
    if (list === null) return;
    expect(list.prims.length).toBe(1);
    expect(list.prims[0]?.start).toBe(1);
  });

  test("displayListOf reads a list that is part of a larger, already parsed reply", () => {
    const reply: unknown = JSON.parse('{"point":[1,2],"paths":{"verts":[[0,0],[5,5]],"prims":[{"kind":"polyline","start":0,"len":2,"color":[255,255,255],"lw":0,"alpha":255,"handle":0}]}}');
    const paths = displayListOf((reply as { paths: unknown }).paths);
    expect(paths?.verts).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
    expect(paths?.prims).toHaveLength(1);
    expect(paths?.prims[0]?.alpha).toBe(1);
    // It is the same reader `parseDisplayList` uses.
    const raw = '{"revision":3,"bounds":[0,0,5,5],"verts":[[0,0],[5,5]],"prims":[{"kind":"polyline","start":0,"len":2}]}';
    expect(displayListOf(JSON.parse(raw))).toEqual(parseDisplayList(raw));
    // What is not an object is no list; an object with junk in it is an empty one.
    for (const value of [null, undefined, 7, "verts", [], [[0, 0]]]) expect(displayListOf(value)).toBeNull();
    expect(displayListOf({ verts: "none", prims: 7 })?.prims).toEqual([]);
    expect(displayListOf({ verts: [[0, 0]], prims: [{ kind: "polyline", start: 0, len: 9 }] })?.prims).toEqual([]);
  });

  test("survives not-JSON, non-objects and junk vertices", () => {
    expect(parseDisplayList("not json")).toBeNull();
    expect(parseDisplayList("[1,2,3]")).toBeNull();
    expect(parseDisplayList("")).toBeNull();
    const junk = JSON.stringify({ verts: [[0, 0], "x", [1]], prims: [null, 3, { kind: "point", start: 1, len: 1 }] });
    const list = parseDisplayList(junk);
    expect(list).not.toBeNull();
    if (list === null) return;
    expect(list.verts.length).toBe(3);
    expect(Number.isNaN(list.verts[1]?.x ?? 0)).toBe(true);
    expect(list.prims.length).toBe(1);
    // bounds fell back to the finite vertices' box.
    expect(list.bounds).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
  });

  test("clamps a bad colour and a negative alpha to a drawable value", () => {
    const list = parseDisplayList(
      JSON.stringify({
        revision: 0,
        bounds: [0, 0, 1, 1],
        verts: [[0, 0]],
        prims: [{ kind: "point", start: 0, len: 1, color: [999, -5, 12.7], lw: -3, alpha: -1, handle: 0 }],
      }),
    );
    expect(list?.prims[0]?.color).toEqual([255, 0, 13]);
    expect(list?.prims[0]?.lw).toBe(0);
    expect(list?.prims[0]?.alpha).toBe(0);
  });

  test("boundsOfPrim ignores NaN vertices", () => {
    const list = parseDisplayList(
      JSON.stringify({
        revision: 0,
        bounds: [0, 0, 4, 4],
        verts: [[0, 0], [null, 2], [4, 4]],
        prims: [{ kind: "polyline", start: 0, len: 3, color: [1, 1, 1], lw: 1, alpha: 255, handle: 1 }],
      }),
    );
    expect(list).not.toBeNull();
    if (list === null) return;
    const prim = list.prims[0];
    expect(prim).toBeDefined();
    if (prim === undefined) return;
    expect(boundsOfPrim(prim, list.verts)).toEqual({ x0: 0, y0: 0, x1: 4, y1: 4 });
  });
});

describe("a layout's sheet, the list's space and the inks that follow the ground", () => {
  const reply = (more: Record<string, unknown>): string => JSON.stringify({ revision: 3, bounds: [0, 0, 1, 1], verts: [[0, 0], [1, 1]], prims: [], ...more });
  const PAPER = { x0: 0, y0: 0, x1: 297, y1: 210 };

  test("a layout's reply carries its sheet and its name", () => {
    const list = parseDisplayList(reply({ space: "Sheet A", sheet: { paper: [0, 0, 297, 210], printable: [6.35, 6.35, 290.65, 203.65] } }));
    expect(list?.space).toBe("Sheet A");
    expect(list?.sheet).toEqual({ paper: PAPER, printable: { x0: 6.35, y0: 6.35, x1: 290.65, y1: 203.65 } });
  });

  test("model space has no sheet, and neither has a reply from an engine built before layouts had paper", () => {
    const model = parseDisplayList(reply({ space: "Model", sheet: null }));
    expect(model?.sheet).toBeNull();
    expect(model?.space).toBe("Model");
    const stale = parseDisplayList(reply({}));
    expect(stale?.sheet).toBeNull();
    expect(stale?.space).toBeUndefined();
    expect(stale?.revision).toBe(3);
  });

  test("a printable area that is missing, unusable or outside the paper is held to the paper", () => {
    expect(parseSheet({ paper: [0, 0, 297, 210] })).toEqual({ paper: PAPER, printable: PAPER });
    expect(parseSheet({ paper: [0, 0, 297, 210], printable: [10, 10, 5, 5] })).toEqual({ paper: PAPER, printable: PAPER });
    expect(parseSheet({ paper: [0, 0, 297, 210], printable: "all of it" })).toEqual({ paper: PAPER, printable: PAPER });
    expect(parseSheet({ paper: [0, 0, 297, 210], printable: [-50, 20, 400, 190] })).toEqual({ paper: PAPER, printable: { x0: 0, y0: 20, x1: 297, y1: 190 } });
    expect(parseSheet({ paper: [0, 0, 297, 210], printable: [400, 400, 500, 500] })).toEqual({ paper: PAPER, printable: PAPER });
  });

  test("a sheet that is not a real rectangle is no sheet: hostile numbers never reach the canvas", () => {
    const hostile: unknown[] = [
      null,
      undefined,
      7,
      "sheet",
      [],
      {},
      { paper: null },
      { paper: [0, 0, 297] },
      { paper: [0, 0, "297", 210] },
      { paper: [0, 0, 0, 210] },
      { paper: [297, 210, 0, 0] },
      { paper: [0, 0, 1e300, 210] },
      { paper: [-1e16, 0, 1, 1] },
      { paper: { min: [0, 0], max: [0, 0] } },
    ];
    for (const sheet of hostile) expect(parseSheet(sheet)).toBeNull();
    // JSON cannot carry NaN or Infinity as numbers; as anything else they are not a rectangle.
    expect(parseDisplayList('{"revision":1,"bounds":[0,0,1,1],"verts":[],"prims":[],"sheet":{"paper":[0,0,null,210]}}')?.sheet).toBeNull();
    expect(parseDisplayList('{"revision":1,"bounds":[0,0,1,1],"verts":[],"prims":[],"sheet":{"paper":[0,0,1e999,210]}}')?.sheet).toBeNull();
    expect(parseSheet({ paper: [0, 0, Number.NaN, 210] })).toBeNull();
    expect(parseSheet({ paper: [0, 0, Number.POSITIVE_INFINITY, 210] })).toBeNull();
  });

  test("a space that is not a short string is not kept", () => {
    expect(parseDisplayList(reply({ space: 7 }))?.space).toBeUndefined();
    expect(parseDisplayList(reply({ space: "x".repeat(5000) }))?.space).toBeUndefined();
    expect(parseDisplayList(reply({ space: "" }))?.space).toBe("");
  });

  test("a primitive says when its colour follows the ground, and nothing else is read as that", () => {
    const prims = (ink: unknown): string =>
      reply({ prims: [{ kind: "polyline", start: 0, len: 2, color: [255, 255, 255], lw: 0.25, alpha: 255, handle: 9, ...(ink === undefined ? {} : { ink }) }] });
    expect(parseDisplayList(prims("fg"))?.prims[0]?.ink).toBe("fg");
    expect(parseDisplayList(prims("mask"))?.prims[0]?.ink).toBe("mask");
    for (const other of [undefined, null, "", "FG", "paper", 1, true, ["fg"]]) {
      const prim = parseDisplayList(prims(other))?.prims[0];
      expect(prim).toBeDefined();
      expect(prim !== undefined && "ink" in prim).toBe(false);
      expect(prim?.color).toEqual([255, 255, 255]);
    }
  });

  test("a part of a larger reply (a preview) reads the same way", () => {
    const part = displayListOf({ verts: [[0, 0], [1, 1]], prims: [{ kind: "polyline", start: 0, len: 2, color: [1, 2, 3], lw: 0, alpha: 255, handle: 0, ink: "fg" }] });
    expect(part?.sheet).toBeNull();
    expect(part?.prims[0]?.ink).toBe("fg");
  });
});
