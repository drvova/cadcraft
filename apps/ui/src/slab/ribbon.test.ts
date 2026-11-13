import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toolHint, toolNote } from "../components/ToolStrip";
import { ICON_PATHS, STROKE } from "../icons";
import { foldedRows, RIBBON, RIBBON_TOOLS, ribbonTab, toolsFit, type RibbonTab, type ToolbarEntry } from "../ribbon";
import { MAX_PARAM_TEXT } from "./bench-params";
import type { TextMeasure } from "./measure";
import { glyphName, gridStroke, ICON_GRID, iconBlockOf, ICONS_BEGIN, ICONS_END, KEY_GLYPH_PX, KEY_GLYPHS, ribbonGlyphs, ribbonIconSource, TOOL_GLYPH_PX, withIconBlock } from "./ribbon-icons";
import {
  controlAt,
  foldSaid,
  groupParams,
  keyGoes,
  MAX_TAB_TOOLS,
  nextStop,
  OPEN_CAP,
  pressedTab,
  pressedTool,
  pressTab,
  RIBBON_METRICS,
  ribbonMetrics,
  stopOfKey,
  tabParams,
  tabTools,
  toolEnds,
  toolHintFor,
  toolRoom,
  toolsShown,
  toolWidth,
  type RibbonArrangement,
  type RibbonBox,
  type RibbonHead,
  type RibbonView,
} from "./ribbon-params";
import { itemOfKey } from "./scene";
import { mapTokens } from "./tokens";

const ui = join(import.meta.dir, "..", "..");
const documentPath = join(ui, "slab", "ribbon.slab");
// `RIBBON_ICONS=write bun test src/slab/ribbon.test.ts` writes the generated glyphs into the
// document again (after `icons.ts` or the ribbon's table changed); the tests below then hold.
if (process.env["RIBBON_ICONS"] === "write") {
  const next = withIconBlock(readFileSync(documentPath, "utf8"));
  if (next !== null) writeFileSync(documentPath, next);
}
const source = readFileSync(documentPath, "utf8");

/** Every character 6 px wide, in every style: widths that can be counted by hand. */
const six: TextMeasure = (_style, text) => [...text].length * 6;
const m = RIBBON_METRICS;
const BAND: RibbonArrangement = { slim: false, coarse: false };
const SLIM: RibbonArrangement = { slim: true, coarse: false };
const HOME = ribbonTab("home");

const view = (over: Partial<RibbonView> = {}): RibbonView => ({ slim: false, coarse: false, shown: Number.POSITIVE_INFINITY, enabled: () => true, running: null, mac: false, ...over });

/** A tool's key in the scene the driver reports for this document (read from a running ribbon). */
const LINE_KEY = "#ribbon/#bandbox/#band/#bar/#tools/each@0~group-2/row@0/col@0/row@0/each@0~tool-6/row@0/col@0";
const MORE_KEY = "#ribbon/#bandbox/#band/#bar/#morebox/#more";
const FOLD_KEY = "#ribbon/#headbox/#head/#fold";
const TAB_KEY = "#ribbon/#headbox/#head/#tabs/each@0~draw/row@0/row@0";

describe("the ribbon's glyphs", () => {
  test("the document's block is the generator's output, character for character", () => {
    expect(iconBlockOf(source)).toBe(ribbonIconSource());
    expect(withIconBlock(source)).toBe(source);
    expect(iconBlockOf("no markers")).toBeNull();
    expect(iconBlockOf(`${ICONS_END}\n${ICONS_BEGIN}`)).toBeNull();
  });

  test("every declared path is the interface's own, character for character, and nothing else is declared", () => {
    const drawn = [...source.matchAll(/^icon ([a-z0-9-]+) viewbox=(\d+) \{\n {2}path "([^"]+)" bg=none stroke=current stroke-w=([\d.]+)\n\}$/gm)].map((d) => ({ name: d[1] ?? "", grid: d[2] ?? "", path: d[3] ?? "", stroke: d[4] ?? "" }));
    const glyphs = ribbonGlyphs();
    expect(drawn.map((d) => d.name)).toEqual(glyphs.map((g) => g.name));
    // No declaration outside the generated block, and none that the pattern above did not read.
    expect([...source.matchAll(/^icon /gm)].length).toBe(glyphs.length);
    for (const glyph of glyphs) {
      const one = drawn.find((d) => d.name === glyph.name);
      expect(Object.hasOwn(ICON_PATHS, glyph.id)).toBe(true);
      expect(one?.path).toBe(ICON_PATHS[glyph.id] ?? "missing");
      expect(one?.grid).toBe(String(ICON_GRID));
      expect(one?.stroke).toBe(gridStroke(glyph.px));
    }
  });

  test("every tool of the ribbon has its glyph, under a name of its own", () => {
    const names = ribbonGlyphs().map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of RIBBON_TOOLS) expect(names).toContain(glyphName(tool.icon));
    expect(glyphName("zoom.extents")).toBe("glyph-zoom-extents");
    expect(glyphName("ui.dialog.layers")).toBe("glyph-ui-dialog-layers");
    // No id is a bare word of the language: every name is under the prefix, and an identifier.
    for (const name of names) expect(name).toMatch(/^(glyph|key)-[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(KEY_GLYPHS.map((g) => g.id)).toEqual(["chevron-up", "chevron-down"]);
    for (const glyph of KEY_GLYPHS) expect(source).toContain(`icon ${glyph.name} size=size.icon-size-md`);
  });

  test("the stroke comes to the interface's one weight at the size a glyph is drawn at", () => {
    expect((Number(gridStroke(TOOL_GLYPH_PX)) * TOOL_GLYPH_PX) / ICON_GRID).toBeCloseTo(STROKE, 3);
    expect((Number(gridStroke(KEY_GLYPH_PX)) * KEY_GLYPH_PX) / ICON_GRID).toBeCloseTo(STROKE, 3);
    const sizes = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8")).lengths.get("size");
    expect(sizes?.get("icon-size-lg")).toBe(TOOL_GLYPH_PX);
    expect(sizes?.get("icon-size-md")).toBe(KEY_GLYPH_PX);
    expect(source).toContain("icon glyph size=size.icon-size-lg");
  });

  test("the paths use only what the path grammar of the language takes", () => {
    for (const glyph of ribbonGlyphs()) expect(ICON_PATHS[glyph.id] ?? "").toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/);
  });
});

describe("where the tools of a tab end", () => {
  test("a tool is its label on the band's inset, never narrower than the least; an icon key is a key", () => {
    const [NEW, , , , , , , POLYLINE] = tabTools(HOME);
    expect(toolWidth(NEW as ToolbarEntry, BAND, six, m)).toBe(41);
    expect(toolWidth(POLYLINE as ToolbarEntry, BAND, six, m)).toBe(12 + 8 * 6);
    expect(toolWidth(POLYLINE as ToolbarEntry, SLIM, six, m)).toBe(24);
  });

  test("the band: tools 2 apart, a hairline with 6 on each side before every group but the first", () => {
    expect(toolEnds(HOME, BAND, six, m)).toEqual([41, 84, 127, 171, 225, 268, 322, 384, 434, 477, 545, 599, 642, 692, 735, 779, 846, 896, 939]);
  });

  test("the one-row ribbon: keys 2 apart (6 under a finger), a hairline with 4 on each side", () => {
    expect(toolEnds(HOME, SLIM, six, m)).toEqual([24, 50, 76, 102, 135, 161, 194, 220, 246, 272, 298, 331, 357, 383, 409, 435, 468, 494, 520]);
    expect(toolEnds(HOME, { slim: true, coarse: true }, six, m).slice(0, 5)).toEqual([24, 54, 84, 114, 147]);
  });

  test("a group is as wide as its caption when that is wider than its tools", () => {
    const [LINE, ARC] = [RIBBON_TOOLS.find((t) => t.id === "line"), RIBBON_TOOLS.find((t) => t.id === "arc")] as [ToolbarEntry, ToolbarEntry];
    const tab: RibbonTab = { id: "t", label: "T", groups: [{ name: "A caption of 25 characters", tools: [LINE] }, { name: "B", tools: [ARC] }] };
    // The caption's 26 characters (156) outrun the tool's 41: the next group starts after them.
    expect(toolEnds(tab, BAND, six, m)).toEqual([41, 156 + 13 + 41]);
    // An icon key has no caption.
    expect(toolEnds(tab, SLIM, six, m)).toEqual([24, 24 + 9 + 24]);
  });

  test("the ends are capped, and an empty tab has none", () => {
    const many: RibbonTab = { id: "t", label: "T", groups: [{ name: "G", tools: Array.from({ length: MAX_TAB_TOOLS + 40 }, () => RIBBON_TOOLS[0] as ToolbarEntry) }] };
    expect(toolEnds(many, BAND, six, m).length).toBe(MAX_TAB_TOOLS);
    expect(tabTools(many).length).toBe(MAX_TAB_TOOLS);
    expect(toolEnds({ id: "t", label: "T", groups: [] }, BAND, six, m)).toEqual([]);
  });
});

describe("how many tools are drawn", () => {
  test("the room is the ribbon less the band's insets, and in the one row less the select and the room after it", () => {
    expect(toolRoom(1280, BAND, 0, m)).toBe(1268);
    expect(toolRoom(390, SLIM, 84, m)).toBe(390 - 12 - 84 - 6);
    expect(toolRoom(390, SLIM, Number.NaN, m)).toBe(390 - 12 - 6);
    expect(toolRoom(10, SLIM, 84, m)).toBe(0);
    expect(Number.isNaN(toolRoom(Number.NaN, BAND, 0, m))).toBe(true);
  });

  test("the fold at each width, from 1280 down to 320", () => {
    const band = (width: number): number => toolsShown(HOME, BAND, width, 0, six, m);
    const slim = (width: number): number => toolsShown(HOME, SLIM, width, 84, six, m);
    // Every tool while the last one ends inside the band (939 + the 12 of the insets).
    expect([1280, 1000, 951].map(band)).toEqual([19, 19, 19]);
    // One px short: the overflow key takes its 28, and the tools that end before it stay.
    expect(band(950)).toBe(18);
    expect(band(768)).toBe(14);
    expect(band(561)).toBe(10);
    // The one-row ribbon of a window as narrow as a phone, beside its 84 px select.
    expect(slim(560)).toBe(15);
    expect(slim(390)).toBe(9);
    expect(slim(320)).toBe(6);
  });

  test("it is the SolidJS strip's own rule over the ends, at every width and for every tab", () => {
    for (const tab of RIBBON) {
      for (const how of [BAND, SLIM, { slim: true, coarse: true }]) {
        const ends = toolEnds(tab, how, six, m);
        let last = -1;
        for (let width = 200; width <= 1400; width += 7) {
          const shown = toolsShown(tab, how, width, 84, six, m);
          expect(shown).toBe(toolsFit(ends, toolRoom(width, how, 84, m), 24 + (how.slim ? 2 : 4)));
          // A wider ribbon never draws fewer, and what folds is the band's end (the least used).
          expect(shown).toBeGreaterThanOrEqual(last);
          last = shown;
          // What is drawn never runs past the band: the tools, and the overflow key when some fold.
          const end = ends[shown - 1] ?? 0;
          const room = toolRoom(width, how, 84, m);
          if (shown < ends.length) expect(end + 24 + (how.slim ? 2 : 4)).toBeLessThanOrEqual(room + 1e-9);
          else expect(end).toBeLessThanOrEqual(room + 1e-9);
        }
        expect(last).toBe(ends.length);
      }
    }
  });

  test("a ribbon with no width yet, or a width that is no number, folds nothing", () => {
    for (const width of [0, -5, Number.NaN, Number.NEGATIVE_INFINITY]) expect(toolsShown(HOME, BAND, width, 0, six, m)).toBe(19);
    expect(toolsShown(HOME, BAND, Number.POSITIVE_INFINITY, 0, six, m)).toBe(19);
    const nan: TextMeasure = () => Number.NaN;
    expect(toolsShown(HOME, BAND, 600, 0, nan, m)).toBe(19);
  });

  test("the rows of the overflow menu are the tools that are not drawn", () => {
    const shown = toolsShown(HOME, SLIM, 390, 84, six, m);
    const drawn = groupParams(HOME, view({ slim: true, shown }), six, m).flatMap((g) => g.tools.map((t) => t.name));
    const rows = foldedRows(HOME, shown, () => true).map((row) => row.label);
    expect([...drawn, ...rows]).toEqual(tabTools(HOME).map((t) => t.label));
  });
});

describe("the band's groups", () => {
  test("every tool, keyed by its place among the tab's tools, with the words the SolidJS strip says", () => {
    const groups = groupParams(HOME, view(), six, m);
    expect(groups.map((g) => [g.key, g.name, g.lead, g.cap])).toEqual([
      ["group-0", "File", false, OPEN_CAP],
      ["group-1", "History", true, OPEN_CAP],
      ["group-2", "Draw", true, OPEN_CAP],
      ["group-3", "Modify", true, OPEN_CAP],
      ["group-4", "Zoom", true, OPEN_CAP],
    ]);
    expect(groups.flatMap((g) => g.tools.map((t) => t.key))).toEqual(Array.from({ length: 19 }, (_, i) => `tool-${i}`));
    expect(groups[0]?.tools[0]).toEqual({ key: "tool-0", name: "New Drawing", face: "New", said: "Ctrl+N", glyph: "glyph-new", slim: false, off: false, on: false, lead: false, wide: false });
    expect(groups[2]?.tools[0]).toEqual({ key: "tool-6", name: "Line", face: "Line", said: "Type L", glyph: "glyph-line", slim: false, off: false, on: false, lead: false, wide: false });
    expect(groups[2]?.tools[1]?.lead).toBe(true);
    // Print has no typed name and no shortcut: nothing to add.
    expect(groups[0]?.tools[3]?.said).toBe("");
    expect(groupParams(HOME, view({ mac: true }), six, m)[0]?.tools[0]?.said).toBe("⌘N");
  });

  test("a group drawn in part keeps its caption under the tools that show; one with none is absent", () => {
    const groups = groupParams(HOME, view({ shown: 8 }), six, m);
    expect(groups.map((g) => g.tools.length)).toEqual([4, 2, 2]);
    // Line (41) and Polyline (60), 2 apart.
    expect(groups[2]?.cap).toBe(103);
    expect(groups[1]?.cap).toBe(OPEN_CAP);
    expect(groupParams(HOME, view({ shown: 6 }), six, m).map((g) => g.name)).toEqual(["File", "History"]);
    expect(groupParams(HOME, view({ shown: 0 }), six, m)).toEqual([]);
    for (const shown of [Number.NaN, -3, 1e9]) expect(groupParams(HOME, view({ shown }), six, m).length).toBeGreaterThanOrEqual(0);
    expect(groupParams(HOME, view({ shown: -3 }), six, m)).toEqual([]);
  });

  test("the one-row ribbon's keys carry no word, and stand further apart under a finger", () => {
    const slim = groupParams(HOME, view({ slim: true, shown: 5 }), six, m);
    expect(slim.every((g) => g.slim && g.cap === OPEN_CAP)).toBe(true);
    expect(slim.flatMap((g) => g.tools).every((t) => t.slim && t.face === "" && !t.wide)).toBe(true);
    expect(slim[0]?.tools[0]?.name).toBe("New Drawing");
    expect(groupParams(HOME, view({ slim: true, coarse: true }), six, m)[0]?.tools[1]?.wide).toBe(true);
    // Under a finger the band's labelled tools stay as they are.
    expect(groupParams(HOME, view({ coarse: true }), six, m)[0]?.tools[1]?.wide).toBe(false);
  });

  test("a tool the engine will not run is off and says why; the running one is on", () => {
    const groups = groupParams(HOME, view({ enabled: (id) => id !== "u", running: "line" }), six, m);
    const undo = groups[1]?.tools[0];
    expect([undo?.off, undo?.on, undo?.said]).toEqual([true, false, "Not available now. Ctrl+Z"]);
    expect(groups[2]?.tools[0]?.on).toBe(true);
    expect(groups.flatMap((g) => g.tools).filter((t) => t.on).length).toBe(1);
    // A blocked tool is never shown as running.
    expect(groupParams(HOME, view({ enabled: () => false, running: "line" }), six, m).flatMap((g) => g.tools).some((t) => t.on)).toBe(false);
  });

  test("text for the kernel is one capped line", () => {
    const long: RibbonTab = { id: "t", label: "T", groups: [{ name: `G\n${"x".repeat(4000)}`, tools: [{ icon: "line", id: "line", label: `L\n${"y".repeat(4000)}`, shortcut: "", alias: "" }] }] };
    const group = groupParams(long, view(), six, m)[0];
    expect(group?.name.includes("\n")).toBe(false);
    expect([...(group?.name ?? "")].length).toBeLessThanOrEqual(MAX_PARAM_TEXT);
    expect([...(group?.tools[0]?.name ?? "")].length).toBeLessThanOrEqual(MAX_PARAM_TEXT);
  });
});

describe("the tab row", () => {
  test("a tab per kind of work, keyed by its id, one in front", () => {
    const tabs = tabParams("draw", 126);
    expect(tabs.map((t) => t.key)).toEqual(RIBBON.map((t) => t.id));
    expect(tabs.map((t) => t.name)).toEqual(["Home", "Jewelry", "Draw", "Modify", "Annotate", "View"]);
    expect(tabs.filter((t) => t.front).map((t) => t.key)).toEqual(["draw"]);
    expect(tabs.map((t) => t.lead)).toEqual([false, true, true, true, true, true]);
    expect(tabs.every((t) => t.cap === 126)).toBe(true);
    for (const cap of [Number.NaN, -1, Number.POSITIVE_INFINITY]) expect(tabParams("home", cap)[0]?.cap).toBe(0);
    expect(tabParams("home", 1e9)[0]?.cap).toBe(4096);
  });

  test("a press brings the band back; the second of a double press folds it, unless the first brought it back", () => {
    const open: RibbonHead = { tab: "home", folded: false, broughtBack: false };
    const once = pressTab(open, "draw", 1);
    expect(once).toEqual({ tab: "draw", folded: false, broughtBack: false });
    expect(pressTab(once, "draw", 2)).toEqual({ tab: "draw", folded: true, broughtBack: false });
    // On a folded band the first press unfolds it, and the double press it starts leaves it open.
    const back = pressTab({ tab: "draw", folded: true, broughtBack: false }, "draw", 1);
    expect(back).toEqual({ tab: "draw", folded: false, broughtBack: true });
    expect(pressTab(back, "draw", 2)).toEqual({ tab: "draw", folded: false, broughtBack: false });
    // A third press in the run is a press; the fourth is a double press again.
    expect(pressTab({ tab: "draw", folded: true, broughtBack: false }, "draw", 3).folded).toBe(false);
    expect(pressTab(open, "draw", 4).folded).toBe(true);
  });

  test("Enter on a tab is a press; an arrow brings the tab's tools to the front and unfolds nothing", () => {
    const folded: RibbonHead = { tab: "home", folded: true, broughtBack: false };
    expect(pressTab(folded, "view", 0)).toEqual({ tab: "view", folded: false, broughtBack: true });
    expect(pressTab(folded, "view", null)).toEqual({ tab: "view", folded: true, broughtBack: true });
    expect(pressTab({ tab: "home", folded: false, broughtBack: true }, "view", null)).toEqual({ tab: "view", folded: false, broughtBack: false });
    expect(pressTab(folded, "view", Number.NaN).folded).toBe(false);
  });

  test("the fold key says what it would do", () => {
    expect(foldSaid(false)).toBe("Hide the tools");
    expect(foldSaid(true)).toBe("Show the tools");
  });
});

describe("a press read back", () => {
  test("a pressed tool is read back by its place among the tools drawn", () => {
    expect(itemOfKey(LINE_KEY)).toBe("tool-6");
    expect(pressedTool(HOME, 19, itemOfKey(LINE_KEY))?.id).toBe("line");
    expect(pressedTool(ribbonTab("draw"), 9, "tool-3")?.id).toBe("polygon");
    expect(pressedTool(HOME, 19, "tool-18")?.id).toBe("pan");
  });

  test("a tool that is folded away, a stale key or a forged one starts nothing", () => {
    expect(pressedTool(HOME, 6, "tool-6")).toBeNull();
    expect(pressedTool(HOME, 19, "tool-19")).toBeNull();
    expect(pressedTool(HOME, Number.NaN, "tool-0")).toBeNull();
    for (const key of ["", "tool-", "tool--1", "tool-1.5", "tool-0 ", "TOOL-0", "line", "group-0", "__proto__", "constructor", `tool-${"9".repeat(400)}`, "9".repeat(4000)]) expect(pressedTool(HOME, 19, key)).toBeNull();
  });

  test("a control that is about to go is known: a tool that folds, the overflow key when all are drawn", () => {
    expect(keyGoes(LINE_KEY, 6, true)).toBe(true);
    expect(keyGoes(LINE_KEY, 7, true)).toBe(false);
    expect(keyGoes(LINE_KEY, 19, false)).toBe(false);
    expect(keyGoes(MORE_KEY, 19, false)).toBe(true);
    expect(keyGoes(MORE_KEY, 6, true)).toBe(false);
    expect(keyGoes(LINE_KEY, Number.NaN, true)).toBe(true);
    for (const key of ["", FOLD_KEY, TAB_KEY, "#ribbon/#bandbox/#band/#bar", "x".repeat(4000)]) expect(keyGoes(key, 0, true)).toBe(false);
  });

  test("a pressed tab is read back by its id", () => {
    expect(itemOfKey(TAB_KEY)).toBe("draw");
    expect(pressedTab(itemOfKey(TAB_KEY))?.label).toBe("Draw");
    for (const key of ["", "Draw", "draw ", "__proto__", "toString", "tool-0"]) expect(pressedTab(key)).toBeNull();
  });
});

describe("a tool's hint", () => {
  test("a labelled tool's is the SolidJS key's: its note, or its label again beside a key cap", () => {
    for (const entry of RIBBON_TOOLS) {
      for (const live of [true, false]) {
        const hint = toolHintFor(entry, live, false, false);
        const text = toolHint(entry, live);
        if (text === undefined) expect(hint).toBeNull();
        else {
          expect(hint?.text).toBe(text);
          expect(hint?.shows).toBe(entry.short ?? entry.label);
          expect(hint?.note).toBeUndefined();
        }
      }
    }
    expect(toolHintFor(RIBBON_TOOLS.find((t) => t.id === "line") as ToolbarEntry, true, false, false)).toEqual({ text: "Type L", shows: "Line" });
    expect(toolHintFor(RIBBON_TOOLS.find((t) => t.id === "qsave") as ToolbarEntry, true, false, false)).toEqual({ text: "Save", keys: "Ctrl+S", shows: "Save" });
    expect(toolHintFor(RIBBON_TOOLS.find((t) => t.id === "plot") as ToolbarEntry, true, false, false)).toBeNull();
    expect(toolHintFor(RIBBON_TOOLS.find((t) => t.id === "plot") as ToolbarEntry, false, false, false)).toEqual({ text: "Not available now", shows: "Print" });
  });

  test("an icon key's says its label, with the note under it", () => {
    for (const entry of RIBBON_TOOLS) {
      const hint = toolHintFor(entry, true, true, true);
      expect(hint?.text).toBe(entry.label);
      expect(hint?.note).toBe(toolNote(entry, true));
      expect(hint?.shows).toBeUndefined();
    }
    expect(toolHintFor(RIBBON_TOOLS.find((t) => t.id === "u") as ToolbarEntry, false, true, true)).toEqual({ text: "Undo", keys: "⌘Z", note: "Not available now" });
  });
});

describe("the control under the pointer", () => {
  const scene: RibbonBox[] = [
    { key: "#ribbon", x: 0, y: 0, w: 600, h: 87, role: "" },
    { key: TAB_KEY, x: 100, y: 3, w: 40, h: 22, role: "tab" },
    { key: FOLD_KEY, x: 570, y: 2, w: 24, h: 24, role: "button" },
    { key: "#ribbon/#bandbox/#band/#bar", x: 6, y: 29, w: 588, h: 57, role: "toolbar" },
    { key: LINE_KEY, x: 278, y: 31, w: 41, h: 38, role: "button" },
    { key: MORE_KEY, x: 570, y: 45, w: 24, h: 24, role: "button" },
  ];

  test("a tool, the overflow key and the fold key are found by their rectangles", () => {
    expect(controlAt(scene, 280, 40)).toBe(LINE_KEY);
    expect(controlAt(scene, 278, 31)).toBe(LINE_KEY);
    expect(controlAt(scene, 580, 50)).toBe(MORE_KEY);
    expect(controlAt(scene, 580, 10)).toBe(FOLD_KEY);
  });

  test("a tab, a caption, the band and a point past an edge have no hint", () => {
    expect(controlAt(scene, 110, 10)).toBeNull();
    expect(controlAt(scene, 290, 80)).toBeNull();
    expect(controlAt(scene, 319, 40)).toBeNull();
    expect(controlAt(scene, 280, 69)).toBeNull();
    expect(controlAt(scene, -1, -1)).toBeNull();
    expect(controlAt([], 10, 10)).toBeNull();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) expect(controlAt(scene, bad, 40)).toBeNull();
    // A button that is not one of the ribbon's controls is not answered for.
    expect(controlAt([{ key: "#elsewhere/#key", x: 0, y: 0, w: 50, h: 50, role: "button" }], 10, 10)).toBeNull();
  });
});

describe("the keyboard's stops", () => {
  test("a focused node is of the tab row, the fold key or the tools", () => {
    expect(stopOfKey(TAB_KEY)).toBe("tabs");
    expect(stopOfKey(FOLD_KEY)).toBe("fold");
    expect(stopOfKey(LINE_KEY)).toBe("tools");
    expect(stopOfKey(MORE_KEY)).toBe("tools");
    for (const key of ["", "#ribbon", "#ribbon/#bandbox/#band", "#ribbon/#headbox/#head/#tabs"]) expect(stopOfKey(key)).toBeNull();
  });

  test("Tab goes from the tab row to the fold key to the tools, and leaves at the ends", () => {
    const all = { head: true, tools: true };
    expect(nextStop("tabs", false, all)).toBe("fold");
    expect(nextStop("fold", false, all)).toBe("tools");
    expect(nextStop("tools", false, all)).toBeNull();
    expect(nextStop("tools", true, all)).toBe("fold");
    expect(nextStop("fold", true, all)).toBe("tabs");
    expect(nextStop("tabs", true, all)).toBeNull();
  });

  test("a folded band has no tools to stop at; the one-row ribbon has the tools alone", () => {
    const folded = { head: true, tools: false };
    expect(nextStop("fold", false, folded)).toBeNull();
    expect(nextStop("tabs", false, folded)).toBe("fold");
    const row = { head: false, tools: true };
    expect(nextStop("tools", false, row)).toBeNull();
    expect(nextStop("tools", true, row)).toBeNull();
    // A stop that is not there leads nowhere.
    expect(nextStop("tabs", false, row)).toBeNull();
  });
});

describe("the ribbon's measures", () => {
  const tokens = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8"));
  const length = (group: string, name: string): number => tokens.lengths.get(group)?.get(name) ?? Number.NaN;
  /** A number the document's own `ribbon` token group declares. */
  const own = (name: string): number => Number(new RegExp(`\\b${name} ([\\d.]+)`).exec(source.slice(source.indexOf("ribbon {"), source.indexOf("// ---- glyphs")))?.[1]);

  test("the defaults are what the interface's tokens come to", () => {
    expect(m).toEqual({
      toolMin: length("size", "control-h-tab") + length("space", "g6"),
      toolPad: length("space", "g6"),
      glyph: length("size", "icon-size-lg"),
      key: length("size", "control-h-input"),
      toolGap: length("space", "g2"),
      slimGap: length("space", "g2"),
      slimGapCoarse: length("space", "g6"),
      rule: length("size", "hairline"),
      ruleGap: length("space", "g6"),
      slimRuleGap: length("space", "g4"),
      moreGap: length("space", "g4"),
      slimMoreGap: length("space", "g2"),
      bandPad: length("space", "g6"),
      pickGap: length("space", "g6"),
    });
  });

  test("the document's own measures are the sums ribbon.css writes", () => {
    const label = length("font", "label");
    const tool = length("space", "g4") + length("size", "icon-size-lg") + length("space", "g3") + label + length("space", "g3");
    const band = length("space", "g2") + tool + length("space", "g2") + label + length("space", "g4");
    expect(own("tool")).toBe(tool);
    expect(own("tool-min")).toBe(m.toolMin);
    expect(own("band")).toBe(band - length("size", "hairline"));
    expect(own("rule")).toBe(band - 2 * length("space", "g8"));
    // The label's line is the 12 of the label step, on the chip step's type.
    expect(own("leading") * length("font", "chip")).toBeCloseTo(label, 2);
    expect(own("open")).toBe(OPEN_CAP);
  });

  test("the measures are read back from a surface's tokens, and one that is no length keeps its default", () => {
    const table: Record<string, unknown> = { "space.g2": 3, "space.g4": 5, "space.g6": 7, "size.hairline": 2, "size.control-h-input": 30, "size.icon-size-lg": 18, "ribbon.tool-min": 50 };
    expect(ribbonMetrics((path) => table[path])).toEqual({ toolMin: 50, toolPad: 7, glyph: 18, key: 30, toolGap: 3, slimGap: 3, slimGapCoarse: 7, rule: 2, ruleGap: 7, slimRuleGap: 5, moreGap: 5, slimMoreGap: 3, bandPad: 7, pickGap: 7 });
    for (const bad of [undefined, "24", Number.NaN, -1, 1e9, null]) expect(ribbonMetrics(() => bad)).toEqual(m);
  });
});

describe("the ribbon's document", () => {
  test("takes its inks and measures from the tokens, and names no font, colour or image", () => {
    const tokens = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8"));
    const inks = new Set([...source.matchAll(/color\.([a-z0-9-]+)/g)].map((d) => d[1] ?? ""));
    expect(inks.size).toBeGreaterThan(6);
    for (const name of inks) expect(tokens.colors.has(name)).toBe(true);
    for (const [, group, name] of source.matchAll(/\b(size|space|radius)\.([a-z0-9-]+)/g)) expect(tokens.lengths.get(group ?? "")?.has(name ?? "")).toBe(true);
    expect(source).toContain('import "gen/tokens.slab"');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(rgb|hsl|oklch)a?\(/);
    expect(source).not.toMatch(/font-family|family=|Inter|JetBrains|system-ui|url\(|\.(png|svg|woff2?|ttf)\b/);
  });

  test("declares every prop the host sets, the params, and the signals the host handles", () => {
    const groups = groupParams(HOME, view(), six, m);
    for (const name of Object.keys(tabParams("home", 100)[0] ?? {})) if (name !== "key") expect(source).toMatch(new RegExp(`def RibbonTabKey\\([^)]*\\b${name}=`));
    for (const name of Object.keys(groups[0]?.tools[0] ?? {})) if (name !== "key") expect(source).toMatch(new RegExp(`def RibbonTool\\([^)]*\\b${name}=`));
    for (const name of Object.keys(groups[0] ?? {})) if (name !== "key") expect(source).toMatch(new RegExp(`def RibbonGroup\\([^)]*\\b${name}=`));
    for (const param of ["compact bool", "open bool", "fold_said text", "band bool", "bar_name text", "panel text", "tabs list(RibbonTabKey)", "groups list(RibbonGroup)", "more bool", "more_open bool", "pick_w num"]) expect(source).toContain(`  ${param} =`);
    for (const signal of ["act=tab ", "act=tool ", "act=fold ", "act=more "]) expect(source).toContain(signal);
    // No binder on a move of the pointer: every signal asks the kernel for a frame.
    expect(source.slice(source.indexOf(ICONS_END))).not.toMatch(/^[^/\n]*\bpointer-move=/m);
    // No eased state either (a frame per step), and what a control draws is not hit on its own.
    expect(source.slice(source.indexOf(ICONS_END))).not.toMatch(/^[^/\n]*\btransition=/m);
    expect(source).toContain("icon glyph size=size.icon-size-lg inert");
    expect(source).toMatch(/text face [^\n]* inert/);
    // The host's own listing of the signals it handles.
    const host = readFileSync(join(ui, "src", "slab", "SlabRibbon.tsx"), "utf8");
    expect(host).toContain('["tab", "tool", "fold", "more"]');
  });

  test("names what a screen reader is told: the tab row, the tabs, the tool bar, its groups and keys", () => {
    expect(source).toContain('role=tablist label="Tools"');
    expect(source).toContain("role=tab label=name selected=front");
    expect(source).toContain("role=toolbar label=param.bar_name");
    expect(source).toContain("role=group label=name");
    expect(source).toContain("role=button label=name desc=said");
    expect(source).toContain('role=button label="Tool band" desc=param.fold_said expanded=param.open');
    expect(source).toContain('role=button label="More tools" expanded=param.more_open');
    // The keys the host finds its controls by.
    for (const id of ["#ribbon", "#tabs", "#fold", "#band", "#bar", "#tools", "#more"]) expect(source).toMatch(new RegExp(`${id}\\b`));
    // The select of the one-row ribbon is the interface's own, in a hole.
    expect(source).toContain("hole pick w=param.pick_w");
  });

  test("is a document of its own, mounted by tag, with the SolidJS strip in its place when it does not load", () => {
    // The loader is Vite's (`import.meta.glob`), so its table is read as text here.
    expect(readFileSync(join(ui, "src", "slab", "loader.ts"), "utf8")).toContain('ribbon: "cadcraft-ribbon"');
    const host = readFileSync(join(ui, "src", "slab", "SlabRibbon.tsx"), "utf8");
    expect(host).toContain("<cadcraft-ribbon");
    expect(host).toContain('slot="pick"');
    const main = readFileSync(join(ui, "src", "main.tsx"), "utf8");
    expect(main).toContain('loadSlab("ribbon")');
    expect(main).toContain('slabPartNotice("ribbon"');
    expect(main).toContain(".then(withRibbon)");
    const app = readFileSync(join(ui, "src", "app.tsx"), "utf8");
    expect(app).toContain("ribbon: () => ribbon(slab.Ribbon)");
    expect(app).toContain("Strip: Component<RibbonProps> = ToolStrip");
    expect(readFileSync(join(ui, "slab", "shell.slab"), "utf8")).not.toContain("RibbonTool");
  });

  test("the standard shell carries no code of the Slab ribbon, and the model is one", () => {
    const app = readFileSync(join(ui, "src", "app.tsx"), "utf8");
    // Everything app.tsx takes from the Slab side is a type.
    for (const line of app.split("\n").filter((l) => /from "\.\/slab\//.test(l))) expect(line.startsWith("import type ")).toBe(true);
    const strip = readFileSync(join(ui, "src", "components", "ToolStrip.tsx"), "utf8");
    expect(strip).not.toMatch(/slab/i);
    expect(readFileSync(join(ui, "src", "ribbon.ts"), "utf8")).not.toMatch(/slab/i);
    // The Slab side has no table of tools, tabs or fold rule of its own.
    const params = readFileSync(join(ui, "src", "slab", "ribbon-params.ts"), "utf8");
    expect(params).toContain('from "../ribbon"');
    expect(params).toContain("toolsFit(");
    expect(readFileSync(join(ui, "src", "slab", "SlabRibbon.tsx"), "utf8")).toContain("foldedRows(");
  });
});
