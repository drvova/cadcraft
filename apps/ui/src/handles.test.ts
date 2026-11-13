/**
 * The drag handles' pure parts: which handles a piece has and where, a screen drag as a value,
 * snapping and clamping to what `piece` takes, keyboard nudges, and the patch sent.
 */

import { describe, expect, test } from "bun:test";
import { fitOrthos, orthoFrame } from "./fourview";
import { dragValue, formatHandleValue, handlePatch, handleReadout, nudgeValue, pieceHandles, screenHandle, settleValue, STONE_SIZES, type Handle } from "./handles";
import { eyeFrame, sceneOf, standardCamera, type PartMesh, type PieceMesh, type Vec3 } from "./view3d";

/** A part that is just the given points (one triangle per three). */
const part = (name: string, kind: "metal" | "stone", points: Vec3[]): PartMesh => ({
  part: kind,
  name,
  color: [1, 1, 1],
  positions: new Float32Array(points.flat()),
  indices: new Uint32Array(points.map((_, i) => i)),
});

const ring = (extra: PartMesh[]): PieceMesh => ({
  parts: [part("band", "metal", [[-10, -10, -1], [10, 0, 1], [0, 10, 0]]), ...extra],
  bounds: { min: [-10, -10, -1], max: [10, 14, 1] },
  extent: { min: [-10, -10, -1], max: [10, 14, 1] },
  triangles: 1 + extra.length,
  notes: [],
});

const solitaire = ring([
  part("centre stone", "stone", [[-3, 12, 0], [3, 12.2, 0], [0, 14, 0]]),
  part("melee", "stone", [[-4.6, 12, 0], [4.6, 12, 0], [0, 12, 4.6]]),
]);
const params = { kind: "solitaire", wall: 1.8, width: 2.2, stoneWidth: 6, stoneLength: 6, halo: 1.3 };

const byId = (list: Handle[], id: string): Handle => {
  const h = list.find((x) => x.id === id);
  if (h === undefined) throw new Error(`no ${id}`);
  return h;
};

describe("which handles, and where", () => {
  test("a halo solitaire has stone, halo, wall and width", () => {
    const hs = pieceHandles(params, 16.5, solitaire);
    expect(hs.map((h) => h.id).sort()).toEqual(["halo", "stone", "wall", "width"]);
    const stone = byId(hs, "stone");
    expect(stone.anchor).toEqual([3, 12.199999809265137, 0]);
    expect(stone.rate).toBe(2);
    expect(byId(hs, "halo").anchor[0]).toBeCloseTo(-4.6);
    expect(byId(hs, "wall").anchor).toEqual([8.25 + 1.8, 0, 0]);
    expect(byId(hs, "width").anchor).toEqual([-(8.25 + 1.8), 0, 1.1]);
  });

  test("a band has wall and width; an eternity adds its stones", () => {
    expect(pieceHandles({ kind: "band", wall: 2, width: 3 }, 17, ring([])).map((h) => h.id)).toEqual(["wall", "width"]);
    const eternity = ring([part("melee", "stone", [[0, 11, -0.9], [0, 11.2, 0.9], [5, 9, 0.95]])]);
    const hs = pieceHandles({ kind: "eternity", wall: 2, width: 3, melee: 1.8 }, 17, eternity);
    const melee = byId(hs, "melee");
    // The stone at the top, not the one off to the side that reaches further along Z.
    expect(melee.anchor[0]).toBe(0);
    expect(melee.anchor[2]).toBeCloseTo(0.9);
  });

  test("what cannot be read is left out, never thrown", () => {
    expect(pieceHandles({}, null, null)).toEqual([]);
    expect(pieceHandles({ kind: "solitaire", wall: "x", stoneWidth: Number.NaN }, Number.NaN, solitaire)).toEqual([]);
    expect(pieceHandles({ kind: "solitaire", stoneWidth: 6 }, null, ring([])).length).toBe(0);
  });
});

describe("a drag as a value", () => {
  test("travel along the axis on the screen, times the rate", () => {
    const screen = { dx: 10, dy: 0 };
    expect(dragValue(6, 2, screen, 25, 40)).toBeCloseTo(11);
    expect(dragValue(6, 2, screen, -10, 0)).toBeCloseTo(4);
    expect(dragValue(6, 2, { dx: 0, dy: 0 }, 25, 0)).toBe(6);
    expect(dragValue(6, 2, screen, Number.NaN, 0)).toBe(6);
  });

  test("a handle whose axis points at the eye is not offered there", () => {
    const hs = pieceHandles(params, 16.5, solitaire);
    const scene = sceneOf(solitaire.extent);
    const views = fitOrthos(solitaire.extent, scene, {});
    const front = orthoFrame("front", views.front, scene, 1);
    const top = orthoFrame("top", views.top, scene, 1);
    expect(screenHandle(byId(hs, "width"), front.viewProj, 400, 400).shown).toBe(false);
    expect(screenHandle(byId(hs, "width"), top.viewProj, 400, 400).shown).toBe(true);
    expect(screenHandle(byId(hs, "stone"), front.viewProj, 400, 400).shown).toBe(true);
    const persp = eyeFrame(standardCamera("three-quarter", scene, 1.5), scene, 1.5);
    for (const h of hs) expect(screenHandle(h, persp.viewProj, 600, 400).shown).toBe(true);
    // On the front pane the stone's axis is the screen's right.
    const s = screenHandle(byId(hs, "stone"), front.viewProj, 400, 400);
    expect(s.dx).toBeGreaterThan(0);
    expect(Math.abs(s.dy)).toBeLessThan(1e-6);
  });
});

describe("snapping and range", () => {
  const stone = { id: "stone", min: 0.5, max: 30 } as const;
  const wall = { id: "wall", min: 0.3, max: 10 } as const;
  const halo = { id: "halo", min: 0.8, max: 3 } as const;

  test("stock stone sizes, 0.05 mm walls, tenth-millimetre melee", () => {
    expect(settleValue(stone, 6.4)).toBe(6.5);
    expect(settleValue(stone, 2.34)).toBe(2.3);
    expect(settleValue(stone, 12.2)).toBe(12);
    expect(settleValue(wall, 1.83)).toBe(1.85);
    expect(settleValue(wall, 1.83, true)).toBe(1.83);
    expect(settleValue(halo, 1.27)).toBe(1.3);
    expect(STONE_SIZES).toContain(6.5);
    expect(STONE_SIZES.every((s, i) => i === 0 || s > (STONE_SIZES[i - 1] ?? 0))).toBe(true);
  });

  test("held to what piece accepts", () => {
    expect(settleValue(wall, 0.01)).toBe(0.3);
    expect(settleValue(wall, 99)).toBe(10);
    expect(settleValue(halo, 3.2)).toBe(3);
    expect(settleValue(stone, Number.NaN)).toBe(0.5);
    expect(settleValue(stone, -Infinity)).toBe(0.5);
  });

  test("keyboard nudges step to the next stop", () => {
    expect(nudgeValue(stone, 6, 1)).toBe(6.25);
    expect(nudgeValue(stone, 6.1, -1)).toBe(6);
    expect(nudgeValue(wall, 1.8, 1)).toBe(1.85);
    expect(nudgeValue(wall, 1.83, -1)).toBe(1.8);
    expect(nudgeValue(wall, 0.3, -1)).toBe(0.3);
    expect(nudgeValue(wall, 1.8, 1, true)).toBe(1.81);
    expect(nudgeValue(stone, 30, 1)).toBe(30);
  });
});

describe("what is sent and said", () => {
  test("a stone keeps its proportion; others are one key", () => {
    expect(handlePatch({ id: "stone", key: "stoneWidth", value: 6 }, 7, { stoneWidth: 6, stoneLength: 9 })).toEqual({ stoneWidth: 7, stoneLength: 10.5 });
    expect(handlePatch({ id: "stone", key: "stoneWidth", value: 6 }, 7, {})).toEqual({ stoneWidth: 7, stoneLength: 7 });
    expect(handlePatch({ id: "wall", key: "wall", value: 1.8 }, 2, {})).toEqual({ wall: 2 });
    expect(handlePatch({ id: "halo", key: "halo", value: 1.3 }, 1.5, {})).toEqual({ halo: 1.5 });
  });

  test("the readout names the value and what it was", () => {
    expect(formatHandleValue(6.5)).toBe("6.50 mm");
    expect(handleReadout({ label: "Wall", value: 1.8 }, 2)).toBe("Wall 2.00 mm (was 1.80)");
    expect(handleReadout({ label: "Wall", value: 1.8 }, 1.8)).toBe("Wall 1.80 mm");
  });
});
