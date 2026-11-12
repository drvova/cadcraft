/**
 * The ribbon's pure model: the tabs, what fits a band, the overflow menu's rows, and what the
 * browser remembers. The tools themselves (ids, labels, glyphs) are held to their contract in
 * `icons.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { foldedRows, loadRibbon, RIBBON, RIBBON_FOLDED_KEY, RIBBON_TAB_KEY, RIBBON_TOOLS, ribbonTab, saveRibbon, toolCaption, toolsFit, type RibbonStore } from "./ribbon";

/** A store in memory, or one that refuses every call (private browsing, a full disk). */
function store(refuses = false): RibbonStore & { kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return {
    kept,
    getItem: (key) => {
      if (refuses) throw new Error("refused");
      return kept.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (refuses) throw new Error("refused");
      kept.set(key, value);
    },
  };
}

describe("the ribbon's tabs", () => {
  test("Home leads and Jewelry is second: this is a jewelry tool", () => {
    expect(RIBBON.map((tab) => tab.id)).toEqual(["home", "jewelry", "draw", "modify", "annotate", "view"]);
    expect(RIBBON.map((tab) => tab.label)).toEqual(["Home", "Jewelry", "Draw", "Modify", "Annotate", "View"]);
  });

  test("a tab id is part of an element id, and no two tabs share one", () => {
    for (const tab of RIBBON) expect(tab.id).toMatch(/^[a-z][a-z-]*$/);
    expect(new Set(RIBBON.map((tab) => tab.id)).size).toBe(RIBBON.length);
  });

  test("a tool that stands in two tabs is one tool: the same glyph, label, shortcut and alias in both", () => {
    const byId = new Map(RIBBON_TOOLS.map((entry) => [entry.id, entry]));
    for (const tab of RIBBON) for (const group of tab.groups) for (const entry of group.tools) expect(entry).toBe(byId.get(entry.id) ?? entry);
    expect(byId.size).toBe(RIBBON_TOOLS.length);
  });

  test("an unknown or missing tab id answers the first tab", () => {
    expect(ribbonTab("jewelry").label).toBe("Jewelry");
    expect(ribbonTab("gone").id).toBe("home");
    expect(ribbonTab(null).id).toBe("home");
    expect(ribbonTab(undefined).id).toBe("home");
    expect(ribbonTab("toString").id).toBe("home");
  });

  test("the word under a glyph is the label, or the short word where the group says the rest", () => {
    const linear = RIBBON_TOOLS.find((entry) => entry.id === "dimlinear");
    const line = RIBBON_TOOLS.find((entry) => entry.id === "line");
    if (linear === undefined || line === undefined) throw new Error("the ribbon lost Line or Linear Dimension");
    expect(toolCaption(linear)).toBe("Linear");
    expect(linear.label).toBe("Linear Dimension");
    expect(toolCaption(line)).toBe("Line");
  });
});

describe("toolsFit", () => {
  const ends = [40, 80, 120, 160, 200];

  test("every tool is drawn when the last one ends inside the room, with no room kept for the overflow key", () => {
    expect(toolsFit(ends, 200, 28)).toBe(5);
    expect(toolsFit(ends, 1000, 28)).toBe(5);
  });

  test("otherwise the tools that end before the overflow key are drawn", () => {
    expect(toolsFit(ends, 199, 28)).toBe(4);
    expect(toolsFit(ends, 187, 28)).toBe(3);
    expect(toolsFit(ends, 148, 28)).toBe(3);
    expect(toolsFit(ends, 147, 28)).toBe(2);
    expect(toolsFit(ends, 60, 28)).toBe(0);
    expect(toolsFit(ends, 0, 28)).toBe(0);
    expect(toolsFit(ends, -50, 28)).toBe(0);
  });

  test("a band with no tools, or one that is not laid out, folds nothing", () => {
    expect(toolsFit([], 100, 28)).toBe(0);
    expect(toolsFit(ends, Number.NaN, 28)).toBe(5);
    expect(toolsFit(ends, 100, Number.NaN)).toBe(5);
    expect(toolsFit([40, Number.NaN], 100, 28)).toBe(2);
    expect(toolsFit(ends, Number.POSITIVE_INFINITY, 28)).toBe(5);
  });
});

describe("foldedRows", () => {
  const home = ribbonTab("home");
  const total = home.groups.reduce((sum, group) => sum + group.tools.length, 0);

  test("nothing is folded when every tool is drawn", () => {
    expect(foldedRows(home, total, () => true)).toEqual([]);
    expect(foldedRows(home, Number.POSITIVE_INFINITY, () => true)).toEqual([]);
  });

  test("the rows are the tools past the drawn ones, a separator where the band has a divider", () => {
    // File is four tools and History two: seven drawn leaves Line in the band and folds the rest of Draw.
    const rows = foldedRows(home, 7, () => true);
    expect(rows.map((row) => row.id)).toEqual(["pline", "circle", "arc", "rectang", "move", "copy", "rotate", "trim", "erase", "zoom.extents", "zoom.window", "pan"]);
    expect(rows.filter((row) => row.group === true).map((row) => row.id)).toEqual(["pline", "move", "zoom.extents"]);
    expect(rows.length).toBe(total - 7);
  });

  test("a row carries the tool's label, glyph, typed name and shortcut, and the engine's answer", () => {
    const rows = foldedRows(home, 0, (id) => id !== "u");
    const undo = rows.find((row) => row.id === "u");
    expect(undo).toEqual({ label: "Undo", id: "u", shortcut: "Cmd+Z", enabled: false, children: [], icon: "u", name: "", group: true });
    const line = rows.find((row) => row.id === "line");
    expect(line?.name).toBe("L");
    expect(line?.enabled).toBe(true);
    // The menu's label is the tool's whole name, not the short word of the band.
    expect(foldedRows(ribbonTab("annotate"), 0, () => true).find((row) => row.id === "dimlinear")?.label).toBe("Linear Dimension");
  });
});

describe("what the browser remembers", () => {
  test("nothing remembered is the first tab, unfolded", () => {
    expect(loadRibbon(store())).toEqual({ tab: "home", folded: false });
    expect(loadRibbon(null)).toEqual({ tab: "home", folded: false });
  });

  test("the tab in front and the fold come back", () => {
    const kept = store();
    saveRibbon({ tab: "jewelry", folded: true }, kept);
    expect(kept.kept.get(RIBBON_TAB_KEY)).toBe("jewelry");
    expect(kept.kept.get(RIBBON_FOLDED_KEY)).toBe("1");
    expect(loadRibbon(kept)).toEqual({ tab: "jewelry", folded: true });
    saveRibbon({ tab: "view", folded: false }, kept);
    expect(loadRibbon(kept)).toEqual({ tab: "view", folded: false });
  });

  test("a tab another version kept is the first tab, and anything but the fold's mark is unfolded", () => {
    const kept = store();
    kept.kept.set(RIBBON_TAB_KEY, "solids");
    kept.kept.set(RIBBON_FOLDED_KEY, "true");
    expect(loadRibbon(kept)).toEqual({ tab: "home", folded: false });
  });

  test("a store that refuses is left alone: the ribbon works without its memory", () => {
    expect(loadRibbon(store(true))).toEqual({ tab: "home", folded: false });
    expect(() => saveRibbon({ tab: "draw", folded: true }, store(true))).not.toThrow();
    expect(() => saveRibbon({ tab: "draw", folded: true }, null)).not.toThrow();
  });
});
