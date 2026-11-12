/**
 * The display-list parser against a canned reply carrying every primitive kind the facade can
 * emit, plus the hostile shapes it must survive.
 */

import { describe, expect, test } from "bun:test";
import { boundsOfPrim, displayListOf, parseDisplayList } from "./display";

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
