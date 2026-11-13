/**
 * The four-view workspace's pure parts: the tiling, the remembered layout, and the orthographic
 * eyes (fit at one scale, pan and zoom that keep the point under the pointer, and nothing a pointer
 * can send making a view that is not a number).
 */

import { describe, expect, test } from "bun:test";
import {
  deviceRect,
  fitOrthos,
  FOUR_FROM,
  layoutText,
  loadLayout,
  mmPerPixel,
  orthoFrame,
  orthoPan,
  orthoRight,
  orthoZoom,
  paneAt,
  parseLayout,
  saveLayout,
  TILE_GAP,
  tileRects,
  toggleMax,
  type LayoutStore,
} from "./fourview";
import { projectToView, sceneOf, type Bounds } from "./view3d";

const box: Bounds = { min: [-10, -10, -1.1], max: [10, 14, 1.1] };
const scene = sceneOf(box);

const memoryStore = (): LayoutStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("tiling", () => {
  test("four views tile the stage 2×2 with a hairline and no overlap", () => {
    const t = tileRects(801, 601, { kind: "four", max: null });
    expect(t.top).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(t.perspective?.x).toBe(400 + TILE_GAP);
    expect((t.perspective?.x ?? 0) + (t.perspective?.w ?? 0)).toBe(801);
    expect((t.right?.y ?? 0) + (t.right?.h ?? 0)).toBe(601);
    expect(paneAt(t, 10, 10)).toBe("top");
    expect(paneAt(t, 700, 10)).toBe("perspective");
    expect(paneAt(t, 10, 500)).toBe("front");
    expect(paneAt(t, 700, 500)).toBe("right");
    expect(paneAt(t, 400.5, 10)).toBeNull();
  });

  test("single and maximised fill the stage", () => {
    expect(tileRects(500, 300, { kind: "single" })).toEqual({ perspective: { x: 0, y: 0, w: 500, h: 300 } });
    expect(tileRects(500, 300, { kind: "four", max: "front" })).toEqual({ front: { x: 0, y: 0, w: 500, h: 300 } });
    expect(tileRects(Number.NaN, -3, { kind: "single" }).perspective).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  test("device rectangles meet without a seam at a fractional ratio", () => {
    const t = tileRects(801, 601, { kind: "four", max: null });
    const ratio = 1.5;
    const storeH = Math.round(601 * ratio);
    const top = deviceRect(t.top ?? { x: 0, y: 0, w: 0, h: 0 }, ratio, storeH);
    const front = deviceRect(t.front ?? { x: 0, y: 0, w: 0, h: 0 }, ratio, storeH);
    expect(front.y).toBe(0);
    expect(top.y + top.h).toBe(storeH);
    expect(front.y + front.h).toBeLessThanOrEqual(top.y);
  });

  test("maximise and restore", () => {
    const four = { kind: "four", max: null } as const;
    expect(toggleMax(four, "right")).toEqual({ kind: "four", max: "right" });
    expect(toggleMax({ kind: "four", max: "right" }, "top")).toEqual(four);
    expect(toggleMax({ kind: "single" }, "top")).toEqual({ kind: "single" });
  });
});

describe("the layout remembered", () => {
  test("defaults: four views on a wide stage, one on a phone", () => {
    expect(loadLayout(1280, memoryStore())).toEqual({ kind: "four", max: null });
    expect(loadLayout(390, memoryStore())).toEqual({ kind: "single" });
    expect(loadLayout(FOUR_FROM - 1, null)).toEqual({ kind: "single" });
  });

  test("a saved layout comes back; junk is ignored", () => {
    const store = memoryStore();
    saveLayout({ kind: "four", max: "top" }, store);
    expect(loadLayout(390, store)).toEqual({ kind: "four", max: "top" });
    store.setItem("cadcraft.view3d.layout", "four:sideways");
    expect(loadLayout(1280, store)).toEqual({ kind: "four", max: null });
    for (const l of [{ kind: "single" }, { kind: "four", max: null }, { kind: "four", max: "perspective" }] as const) expect(parseLayout(layoutText(l))).toEqual(l);
    const broken: LayoutStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadLayout(1280, broken)).toEqual({ kind: "four", max: null });
    expect(() => saveLayout({ kind: "single" }, broken)).not.toThrow();
  });
});

describe("orthographic eyes", () => {
  test("fitted at one scale, the box inside every pane", () => {
    const views = fitOrthos(box, scene, { top: 1.5, front: 1.5, right: 1.5 });
    expect(views.top.span).toBe(views.front.span);
    expect(views.front.span).toBe(views.right.span);
    for (const pane of ["top", "front", "right"] as const) {
      const frame = orthoFrame(pane, views[pane], scene, 1.5);
      for (const x of [box.min[0], box.max[0]])
        for (const y of [box.min[1], box.max[1]])
          for (const z of [box.min[2], box.max[2]]) {
            const p = projectToView(frame.viewProj, [x, y, z], 600, 400);
            expect(p.shown).toBe(true);
          }
    }
  });

  test("the panes look where their names say", () => {
    expect(orthoRight("front")[0]).toBeCloseTo(1);
    expect(orthoRight("right")[2]).toBeCloseTo(-1);
    const views = fitOrthos(box, scene, {});
    // Front looks along the finger: +X is to the right, +Y up.
    const f = orthoFrame("front", views.front, scene, 1);
    const right = projectToView(f.viewProj, [5, 0, 0], 100, 100);
    const up = projectToView(f.viewProj, [0, 5, 0], 100, 100);
    const mid = projectToView(f.viewProj, [0, 0, 0], 100, 100);
    expect(right.x).toBeGreaterThan(mid.x);
    expect(up.y).toBeLessThan(mid.y);
  });

  test("pan carries the picture with the pointer", () => {
    const views = fitOrthos(box, scene, { front: 1 });
    const before = orthoFrame("front", views.front, scene, 1);
    const moved = orthoPan("front", views.front, scene, 20, 10, 400);
    const after = orthoFrame("front", moved, scene, 1);
    const a = projectToView(before.viewProj, [1, 2, 0], 400, 400);
    const b = projectToView(after.viewProj, [1, 2, 0], 400, 400);
    expect(b.x - a.x).toBeCloseTo(20, 4);
    expect(b.y - a.y).toBeCloseTo(10, 4);
  });

  test("zoom keeps the point under the pointer", () => {
    const views = fitOrthos(box, scene, { top: 1.6 });
    const z = orthoZoom("top", views.top, scene, 0.5, 0.4, -0.3, 1.6);
    expect(z.span).toBeCloseTo(views.top.span * 0.5);
    const before = orthoFrame("top", views.top, scene, 1.6);
    const after = orthoFrame("top", z, scene, 1.6);
    // The world point under ndc (0.4, -0.3) before is still there after.
    const w = 320;
    const h = 200;
    const px = ((0.4 + 1) / 2) * w;
    const py = ((1 + 0.3) / 2) * h;
    const k = mmPerPixel(views.top, h);
    const right = orthoRight("top");
    // Walk the screen point back to the world on the plane through the target.
    const t = views.top.target;
    const world: [number, number, number] = [t[0] + right[0] * (px - w / 2) * k, t[1], t[2] + (py - h / 2) * k];
    const a = projectToView(before.viewProj, world, w, h);
    const b = projectToView(after.viewProj, world, w, h);
    expect(a.x).toBeCloseTo(px, 3);
    expect(b.x).toBeCloseTo(px, 3);
    expect(b.y).toBeCloseTo(py, 3);
  });

  test("hostile input never makes a view that is not a number", () => {
    const views = fitOrthos({ min: [Number.NaN, 0, 0], max: [1, Infinity, 1] }, scene, { top: Number.NaN, front: -1, right: 0 });
    for (const v of Object.values(views)) {
      expect(Number.isFinite(v.span)).toBe(true);
      expect(v.target.every(Number.isFinite)).toBe(true);
    }
    for (const bad of [Number.NaN, Infinity, -1, 0]) {
      const p = orthoPan("top", views.top, scene, bad, bad, bad);
      const z = orthoZoom("right", views.right, scene, bad, bad, bad, bad);
      expect(Number.isFinite(p.span) && p.target.every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(z.span) && z.target.every(Number.isFinite)).toBe(true);
      expect(orthoFrame("front", z, scene, bad).viewProj.every(Number.isFinite)).toBe(true);
    }
    // Zoomed and panned without end, the view stays near the piece.
    let v = views.front;
    for (let i = 0; i < 200; i += 1) v = orthoZoom("front", orthoPan("front", v, scene, 1e6, -1e6, 100), scene, 1.5, 1, 1, 1);
    expect(v.span).toBeLessThanOrEqual(scene.radius * 20 + 1e-9);
  });
});
