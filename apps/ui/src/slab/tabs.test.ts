import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PARAM_TEXT } from "./bench-params";
import { clippedEdges, MAX_VIEW_TABS, MODEL, pressedView, viewTabs } from "./tabs-params";
import { mapTokens } from "./tokens";

const ui = join(import.meta.dir, "..", "..");
const source = readFileSync(join(ui, "slab", "tabs.slab"), "utf8");

const layouts = ["Layout1", "Layout2"] as const;

describe("the tabs over the drawing", () => {
  test("Model, the drawing's layouts in order, then 3D when it is offered; the words the SolidJS strip says", () => {
    const tabs = viewTabs(layouts, MODEL, false, true, 168);
    expect(tabs.map((t) => t.name)).toEqual(["Model", "Layout1", "Layout2", "3D"]);
    expect(tabs.map((t) => t.hint)).toEqual(["Switch to model space", "Switch to Layout1", "Switch to Layout2", "Show the piece as a solid"]);
    expect(tabs.map((t) => t.front)).toEqual([true, false, false, false]);
    expect(tabs.every((t) => t.cap === 168)).toBe(true);
    expect(viewTabs(layouts, MODEL, false, false, 168).map((t) => t.name)).toEqual(["Model", "Layout1", "Layout2"]);
    expect(viewTabs([], MODEL, false, false, 168)).toHaveLength(1);
  });

  test("one tab is in front: the active layout's, or the 3D view's and then no layout's", () => {
    expect(viewTabs(layouts, "Layout2", false, true, 168).map((t) => t.front)).toEqual([false, false, true, false]);
    expect(viewTabs(layouts, "Layout2", true, true, 168).map((t) => t.front)).toEqual([false, false, false, true]);
    // A space that names no tab (a layout past the cap, or one just deleted): none in front.
    expect(viewTabs(layouts, "Gone", false, true, 168).some((t) => t.front)).toBe(false);
  });

  test("every key is the tab's place, so a layout made or deleted adds or removes the last key only", () => {
    const before = viewTabs(layouts, MODEL, false, true, 168).map((t) => t.key);
    const after = viewTabs([...layouts, "Layout3"], MODEL, false, true, 168).map((t) => t.key);
    expect(before).toEqual(["view-0", "view-1", "view-2", "view-3"]);
    expect(after).toEqual([...before, "view-4"]);
    expect(new Set(after).size).toBe(after.length);
  });

  test("a pressed tab is read back to the view by its place, never by its label", () => {
    expect(pressedView("view-0", layouts, true)).toEqual({ kind: "layout", name: "Model" });
    expect(pressedView("view-2", layouts, true)).toEqual({ kind: "layout", name: "Layout2" });
    expect(pressedView("view-3", layouts, true)).toEqual({ kind: "3d" });
    // With no 3D tab the place after the layouts is no tab.
    expect(pressedView("view-3", layouts, false)).toBeNull();
    // A layout named as another tab's label is still found by place.
    expect(pressedView("view-1", ["3D", "Model"], true)).toEqual({ kind: "layout", name: "3D" });
    expect(pressedView("view-2", ["3D", "Model"], true)).toEqual({ kind: "layout", name: "Model" });
  });

  test("a stale or forged key switches nothing", () => {
    for (const key of ["", "view-4", "view-99", "view--1", "view-1e3", "view-1 ", "view3d", "1", "__proto__", "view-99999999999", "view-0/row@0"]) expect(pressedView(key, layouts, true)).toBeNull();
  });

  test("the strip is capped, and its last key still reads back", () => {
    const many = Array.from({ length: 5000 }, (_, i) => `L${i}`);
    const tabs = viewTabs(many, "L3", false, true, 168);
    expect(tabs).toHaveLength(MAX_VIEW_TABS + 1);
    expect(tabs[tabs.length - 1]?.name).toBe("3D");
    expect(pressedView(tabs[tabs.length - 1]?.key ?? "", many, true)).toEqual({ kind: "3d" });
    expect(pressedView(`view-${MAX_VIEW_TABS - 1}`, many, true)).toEqual({ kind: "layout", name: `L${MAX_VIEW_TABS - 2}` });
    expect(pressedView(`view-${MAX_VIEW_TABS + 1}`, many, true)).toBeNull();
  });

  test("a name reaches the kernel as one capped line, and the layout is still found by its real name", () => {
    const hostile = `Plan\u0000\n${"x".repeat(5000)}`;
    const tabs = viewTabs([hostile], hostile, false, false, 168);
    expect(tabs[1]?.name.length).toBeLessThanOrEqual(MAX_PARAM_TEXT);
    expect(tabs[1]?.name).not.toMatch(/[\u0000-\u001f]/);
    expect(tabs[1]?.front).toBe(true);
    expect(pressedView("view-1", [hostile], false)).toEqual({ kind: "layout", name: hostile });
  });

  test("a cap that is no width is none", () => {
    for (const cap of [NaN, Infinity, -1, 0]) expect(viewTabs(layouts, MODEL, false, false, cap)[0]?.cap).toBe(0);
    expect(viewTabs(layouts, MODEL, false, false, 1e9)[0]?.cap).toBe(4096);
  });
});

describe("the strip's clipped edges", () => {
  test("an edge is marked when it hides something", () => {
    expect(clippedEdges(0, 600, 600)).toEqual({ start: false, end: false });
    expect(clippedEdges(0, 600, 900)).toEqual({ start: false, end: true });
    expect(clippedEdges(120, 600, 900)).toEqual({ start: true, end: true });
    expect(clippedEdges(300, 600, 900)).toEqual({ start: true, end: false });
    // Half a px of rounding is nothing hidden.
    expect(clippedEdges(0.4, 600, 600.4)).toEqual({ start: false, end: false });
  });

  test("numbers that are no lengths mark nothing", () => {
    for (const n of [NaN, Infinity, -Infinity]) {
      expect(clippedEdges(n, 600, 900)).toEqual({ start: false, end: false });
      expect(clippedEdges(0, n, 900)).toEqual({ start: false, end: false });
      expect(clippedEdges(0, 600, n)).toEqual({ start: false, end: false });
    }
  });
});

describe("the tabs' document", () => {
  test("takes its inks and measures from the tokens, and names no font, colour or image", () => {
    const tokens = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8"));
    const inks = new Set([...source.matchAll(/color\.([a-z0-9-]+)/g)].map((m) => m[1] ?? ""));
    expect(inks.size).toBeGreaterThan(4);
    for (const name of inks) expect(tokens.colors.has(name)).toBe(true);
    expect(tokens.lengths.get("size")?.has("control-h-tab")).toBe(true);
    expect(source).toContain('import "gen/tokens.slab"');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(rgb|hsl)a?\(/);
    expect(source).not.toMatch(/font-family|family=|Inter|JetBrains|system-ui|url\(|\.(png|svg|woff2?|ttf)\b/);
  });

  test("declares every prop the host sets on a tab, the params, and the signals the host handles", () => {
    for (const name of Object.keys(viewTabs(layouts, MODEL, false, true, 168)[0] ?? {})) if (name !== "key") expect(source).toMatch(new RegExp(`def ViewTab\\([^)]*\\b${name}=`));
    expect(source).toMatch(/^\s+tabs list\(ViewTab\) =/m);
    expect(source).toMatch(/^\s+clip_start bool =/m);
    expect(source).toMatch(/^\s+clip_end\s+bool =/m);
    for (const signal of ["act=tab_pressed", "context=tab_menu", "pointer-move=tab_hint", "pointer-move=tab_hint_off"]) expect(source).toContain(signal);
    expect(source).toContain("role=tab ");
    expect(source).toContain("selected=front");
    expect(source).toContain('role=tablist label="Views"');
    // The strip the host scrolls and reads, by its key.
    expect(source).toContain("stack #views");
    expect(source).toContain("row #strip");
  });

  test("the two bars are documents of their own, mounted by tag", () => {
    // The loader is Vite's (`import.meta.glob`), so its table is read as text here.
    const loader = readFileSync(join(ui, "src", "slab", "loader.ts"), "utf8");
    expect(loader).toContain('statusbar: "cadcraft-statusbar"');
    expect(loader).toContain('tabs: "cadcraft-tabs"');
    const shell = readFileSync(join(ui, "slab", "shell.slab"), "utf8");
    expect(shell).not.toContain("ViewTab");
    expect(shell).not.toContain("StatusToggle");
    expect(readFileSync(join(ui, "src", "slab", "SlabTabs.tsx"), "utf8")).toContain("<cadcraft-tabs");
    expect(readFileSync(join(ui, "src", "slab", "SlabStatusBar.tsx"), "utf8")).toContain("<cadcraft-statusbar");
  });
});
