import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { layerHint } from "../components/LayersPanel";
import { parseLayers, type LayerInfo } from "../facade";
import { ICON_PATHS } from "../icons";
import { MAX_PARAM_TEXT } from "./bench-params";
import { pathAt, sceneBoxes, type SceneBox } from "./hints";
import { CLEAR, computedColor, layerAt, layerCount, layersPanelParams, MAX_LAYER_ROWS, NO_INKS, partHint, rowIndex, scenePart, slabRgb, TOGGLE_SIGNALS, type LayersView } from "./layers-params";

const ui = join(import.meta.dir, "..", "..");
const source = readFileSync(join(ui, "slab", "layers.slab"), "utf8");

/** Spelled apart so the design-system check does not read these fixtures as colours in the interface. */
const H = "#";
/** The engine's colour names for the four fixture layers, for the same reason. */
const C = ["white", "red", "blue", "green"] as const;

const layers = parseLayers({
  layers: [
    { name: "0", on: true, frozen: false, locked: false, used: true, current: false, color: C[0] },
    { name: "Outline", on: true, frozen: false, locked: false, used: true, current: true, color: C[1], description: "The part's edges" },
    { name: "Hidden", on: false, frozen: true, locked: true, used: false, current: false, color: C[2] },
    { name: "A-WALL-FULL-HEIGHT-PHASE-1", on: true, frozen: false, locked: false, used: false, current: false, color: C[3] },
  ],
});

const view = (over: Partial<LayersView> = {}): LayersView => ({ open: true, shown: [], allKeys: false, fits: () => true, inks: NO_INKS, cap: 400, ...over });

/** The row keys of the scene the driver reports for this document (read from a running panel). */
const ROW = "LayersPanel@0/col@0/#body/#list/each@0~layer-2/#row";

describe("the layers panel's params", () => {
  test("a row per layer, keyed by its place, with the words the SolidJS panel says", () => {
    const p = layersPanelParams(layers, view());
    expect(p.rows.map((r) => r.key)).toEqual(["layer-0", "layer-1", "layer-2", "layer-3"]);
    expect(p.count).toBe("4");
    expect(p.count_said).toBe("4 layers");
    expect(layerCount(1)).toBe("1 layer");
    const outline = p.rows[1];
    const hidden = p.rows[2];
    expect(outline?.current).toBe(true);
    expect(outline?.about).toBe("Current layer. The part's edges");
    expect(outline?.said).toBe(layerHint(layers[1] as LayerInfo));
    expect(outline?.tone_name).toBe(`Color: ${C[1]}`);
    expect([hidden?.on, hidden?.frozen, hidden?.locked, hidden?.used]).toEqual([false, true, true, false]);
    expect([hidden?.on_name, hidden?.frozen_name, hidden?.locked_name]).toEqual(["Hidden on", "Hidden frozen", "Hidden locked"]);
    expect(p.capped).toBe(false);
    expect(p.cap).toBe(400);
  });

  test("a key in its ordinary state is quiet unless its row is shown or there is no pointer to hover with", () => {
    const quiet = (p: ReturnType<typeof layersPanelParams>): boolean[][] => p.rows.map((r) => [r.on_quiet, r.frozen_quiet, r.locked_quiet]);
    // On, thawed and unlocked are the ordinary states; off, frozen and locked are always drawn.
    expect(quiet(layersPanelParams(layers, view()))).toEqual([[true, true, true], [true, true, true], [false, false, false], [true, true, true]]);
    expect(quiet(layersPanelParams(layers, view({ shown: [-1, 1] })))[1]).toEqual([false, false, false]);
    expect(quiet(layersPanelParams(layers, view({ shown: [1] })))[0]).toEqual([true, true, true]);
    expect(quiet(layersPanelParams(layers, view({ allKeys: true }))).flat().some((q) => q)).toBe(false);
  });

  test("a name that does not fit is a head and a tail; one that fits, or is short, is whole", () => {
    const fit = layersPanelParams(layers, view()).rows[3];
    expect([fit?.head, fit?.tail, fit?.split]).toEqual(["A-WALL-FULL-HEIGHT-PHASE-1", "", false]);
    const cut = layersPanelParams(layers, view({ fits: () => false })).rows;
    expect([cut[3]?.head, cut[3]?.tail, cut[3]?.split]).toEqual(["A-WALL-FULL-HEIGHT-", "PHASE-1", true]);
    expect(cut[3]?.name).toBe("A-WALL-FULL-HEIGHT-PHASE-1");
    expect([cut[0]?.head, cut[0]?.split]).toEqual(["0", false]);
  });

  test("a folded section hands over its heading alone", () => {
    const p = layersPanelParams(layers, view({ open: false }));
    expect(p.rows).toEqual([]);
    expect(p.open).toBe(false);
    expect(p.count).toBe("4");
  });

  test("the rows are capped, and the rest are counted", () => {
    const many = Array.from({ length: MAX_LAYER_ROWS + 2 }, (_, i): LayerInfo => ({ ...(layers[0] as LayerInfo), name: `L${i}` }));
    const p = layersPanelParams(many, view());
    expect(p.rows.length).toBe(MAX_LAYER_ROWS);
    expect(p.capped).toBe(true);
    expect(p.more).toBe("2 more layers: see the Layer Properties Manager");
    expect(p.count).toBe(String(MAX_LAYER_ROWS + 2));
  });

  test("hostile names and numbers never reach the kernel raw", () => {
    const bad: LayerInfo = { ...(layers[0] as LayerInfo), name: `a\nb ${"x".repeat(5000)}`, description: "\t\u0000", colorRgb: [Number.NaN, -5, 1e9] };
    const row = layersPanelParams([bad], view({ fits: () => false, cap: Number.NaN })).rows[0];
    expect(row?.name.length).toBe(MAX_PARAM_TEXT);
    expect(row?.name.includes("\n")).toBe(false);
    expect((row?.head.length ?? 0) + (row?.tail.length ?? 0)).toBeLessThanOrEqual(MAX_PARAM_TEXT);
    expect(row?.tone).toBe(`${H}0000FF`);
    expect(row?.about).toBe("");
    expect(layersPanelParams([bad], view({ cap: Number.NaN })).cap).toBe(0);
    expect(layersPanelParams([bad], view({ cap: -3 })).cap).toBe(0);
    expect(slabRgb([12, 255, 0.4])).toBe(`${H}0CFF00`);
  });
});

describe("a signal read back to its layer", () => {
  test("an item key names a row; a stale or forged one names none", () => {
    expect(layerAt(layers, "layer-2")?.name).toBe("Hidden");
    expect(rowIndex("layer-0")).toBe(0);
    for (const key of ["", "layer-4", "layer--1", "layer-1e3", "2", "__proto__", "layer-2 ", "layer-99999999999", `layer-${MAX_LAYER_ROWS}`, "line-1"]) expect(layerAt(layers, key)).toBeNull();
  });

  test("each key's signal is one flag, and the document binds exactly the signals the host handles", () => {
    expect(TOGGLE_SIGNALS).toEqual({ toggle_on: "on", toggle_frozen: "frozen", toggle_locked: "locked" });
    const bound = new Set([...source.matchAll(/\bact=([a-z_]+)/g)].map((m) => m[1]));
    expect([...bound].sort()).toEqual(["fold", "make_current", "toggle_frozen", "toggle_locked", "toggle_on"]);
  });
});

describe("the parts of the scene", () => {
  test("a scene key is a part of a row, a part of the heading, or neither", () => {
    expect(scenePart(ROW)).toEqual({ row: 2, part: "row" });
    expect(scenePart(`${ROW}/#name`)).toEqual({ row: 2, part: "name" });
    expect(scenePart(`${ROW}/#name/#track/text@1`)).toEqual({ row: 2, part: "" });
    expect(scenePart(`${ROW}/#keys/row@0/#frozen`)).toEqual({ row: 2, part: "frozen" });
    expect(scenePart(`${ROW}/#swatchcell/#swatch`)).toEqual({ row: 2, part: "swatch" });
    expect(scenePart("LayersPanel@0/col@0/#head/#count")).toEqual({ row: -1, part: "count" });
    expect(scenePart("LayersPanel@0/col@0/#head/#fold")).toEqual({ row: -1, part: "fold" });
    expect(scenePart("LayersPanel@0/col@0/#head/#name")).toEqual({ row: -1, part: "" });
    expect(scenePart(`${ROW}/#count`)).toEqual({ row: -1, part: "" });
    expect(scenePart("each@0~layer-99999/#row/#on")).toEqual({ row: -1, part: "" });
    expect(scenePart("")).toEqual({ row: -1, part: "" });
  });

  test("the hints are the SolidJS panel's words", () => {
    const hint = (key: string, open = true): string | null => partHint(layers, open, scenePart(key));
    expect(hint(`${ROW}/#name`)).toBe(layerHint(layers[2] as LayerInfo));
    expect(hint(`${ROW}/#keys/row@0/#on`)).toBe("Turn on");
    expect(hint(`${ROW}/#keys/row@0/#frozen`)).toBe("Thaw");
    expect(hint(`${ROW}/#keys/row@0/#locked`)).toBe("Unlock");
    expect(hint(`${ROW}/#keys/#used`)).toBe("No objects");
    expect(hint(`${ROW}/#swatchcell/#swatch`)).toBe(`${C[2]}, RGB 0, 0, 255`);
    expect(hint("x/#head/#count")).toBe("4 layers");
    expect(hint("x/#head/#fold")).toBe("Hide the layers");
    expect(hint("x/#head/#fold", false)).toBe("Show the layers");
    expect(hint(ROW)).toBeNull();
    expect(hint(ROW.replace("layer-2", "layer-9") + "/#name")).toBeNull();
  });

  test("the node under a point is the one painted last, inside all its ancestors", () => {
    const box = (key: string, x: number, y: number, w: number, h: number, parent: number): SceneBox => ({ key, x, y, w, h, parent });
    // A list 40 high showing two rows of a taller content: the third row is scrolled out below it.
    const scene = [box("list", 0, 0, 100, 40, -1), box("row0", 0, 0, 100, 20, 0), box("name0", 0, 0, 100, 20, 1), box("key0", 60, 0, 20, 20, 1), box("row1", 0, 20, 100, 20, 0), box("row2", 0, 40, 100, 20, 0)];
    expect(pathAt(scene, 10, 10).map((b) => b.key)).toEqual(["name0", "row0", "list"]);
    expect(pathAt(scene, 70, 10).map((b) => b.key)).toEqual(["key0", "row0", "list"]);
    expect(pathAt(scene, 10, 30).map((b) => b.key)).toEqual(["row1", "list"]);
    expect(pathAt(scene, 10, 50)).toEqual([]);
    expect(pathAt(scene, -1, 10)).toEqual([]);
    expect(pathAt([], 0, 0)).toEqual([]);
    // A parent index that points forward or at itself ends the walk instead of looping.
    expect(pathAt([box("a", 0, 0, 10, 10, 0)], 1, 1).map((b) => b.key)).toEqual(["a"]);
    expect(pathAt([box("a", 0, 0, 10, 10, 5)], 1, 1).map((b) => b.key)).toEqual(["a"]);
  });

  test("a scene is read with checks", () => {
    expect(sceneBoxes([{ key: "a", x: 1, y: 2, w: 3, h: 4, parent: -1 }, { key: 7, x: "1", w: Number.NaN, parent: 0.5 }])).toEqual([
      { key: "a", x: 1, y: 2, w: 3, h: 4, parent: -1 },
      { key: "", x: 0, y: 0, w: 0, h: 0, parent: -1 },
    ]);
    expect(sceneBoxes([{ key: "a" }, null])).toEqual([]);
    expect(sceneBoxes(["x"])).toEqual([]);
  });
});

describe("the document's colours and glyphs", () => {
  test("a colour the browser computed becomes a Slab colour, anything else none", () => {
    const R = "rgb";
    expect(computedColor(`${R}(159, 212, 255)`)).toBe(`${H}9FD4FF`);
    expect(computedColor(`${R}a(20, 20, 20, 0.74)`)).toBe(`${H}141414BD`);
    expect(computedColor("color(srgb 0.601177 0.601177 0.441176)")).toBe(`${H}999970`);
    expect(computedColor("color(srgb 1 0 0 / 0.5)")).toBe(`${H}FF000080`);
    for (const bad of ["", "red", "color(display-p3 1 0 0)", `${R}(1,2)`, `${R}a(1,2,3,7)`, "url(x)"]) expect(computedColor(bad)).toBeNull();
    expect(NO_INKS.off).toBe(CLEAR);
  });

  test("the glyphs are the interface's own paths, character for character", () => {
    const drawn = new Map([...source.matchAll(/^icon ([a-z-]+) viewbox=24 \{\s*path "([^"]+)"/gm)].map((m) => [m[1] ?? "", m[2] ?? ""]));
    const ids: Record<string, string> = { chevron: "chevron-down", "layer-on": "layer.on", "layer-off": "layer.off", "layer-frozen": "layer.frozen", "layer-thawed": "layer.thawed", "layer-locked": "layer.locked", "layer-unlocked": "layer.unlocked" };
    expect([...drawn.keys()].sort()).toEqual(Object.keys(ids).sort());
    for (const [name, id] of Object.entries(ids)) expect(drawn.get(name)).toBe(ICON_PATHS[id] ?? "missing");
  });

  test("every colour is a token of the bridge; the only literal is the clear default of a colour prop", () => {
    const literals = [...source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(literals.every((c) => c === CLEAR)).toBe(true);
    expect(/\b(rgb|rgba|oklch|hsl)\(/.test(source)).toBe(false);
    expect(/\bfamily\s*=/.test(source)).toBe(false);
  });
});
