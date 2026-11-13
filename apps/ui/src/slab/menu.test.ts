import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ICON_PATHS } from "../icons";
import type { MenuItem } from "../menu";
import { RIBBON_TOOLS } from "../ribbon";
import type { TextMeasure } from "./measure";
import { CHEVRON_GLYPH_PX, groupScroll, MAX_MENU_ROWS, MENU_METRICS, menuGlyphs, menuIconSource, menuSurface, ROW_GLYPH_PX, rowAt, rowExtras, rowIndex, rowOfKey, rowShortcut, withLit, withMenuIcons, type MenuSurfaceInput } from "./menu-params";
import { glyphName, gridStroke, ICON_GRID, iconBlockOf } from "./ribbon-icons";

const ui = join(import.meta.dir, "..", "..");
const documentPath = join(ui, "slab", "menu.slab");
// `MENU_ICONS=write bun test src/slab/menu.test.ts` writes the generated glyphs into the document
// again (after `icons.ts` or the ribbon's tools changed); the tests below then hold.
if (process.env["MENU_ICONS"] === "write") {
  const next = withMenuIcons(readFileSync(documentPath, "utf8"));
  if (next !== null) writeFileSync(documentPath, next);
}
const source = readFileSync(documentPath, "utf8");

/** Every character 6 px wide, in every style: widths that can be counted by hand. */
const six: TextMeasure = (_style, text) => [...text].length * 6;
const m = MENU_METRICS;

const leaf = (label: string, over: Partial<MenuItem> = {}): MenuItem => ({ label, id: label.toLowerCase(), shortcut: "", enabled: true, children: [], ...over });
const sub = (label: string, children: MenuItem[], over: Partial<MenuItem> = {}): MenuItem => ({ label, id: null, shortcut: "", enabled: true, children, ...over });

const input = (items: MenuItem[], over: Partial<MenuSurfaceInput> = {}): MenuSurfaceInput => ({ items, path: [], chain: [], stacked: false, coarse: false, minWidth: 0, stackedWidth: 300, maxHeight: 1000, measure: six, mac: false, ...over });

describe("the menu's glyphs", () => {
  test("the document's block is the generator's output, character for character", () => {
    expect(iconBlockOf(source)).toBe(menuIconSource());
    expect(withMenuIcons(source)).toBe(source);
    expect(withMenuIcons("no markers")).toBeNull();
  });

  test("every declared path is the interface's own, at the stroke of the size it is drawn at", () => {
    const drawn = [...source.matchAll(/^icon ([a-z0-9-]+) viewbox=(\d+) \{\n {2}path "([^"]+)" bg=none stroke=current stroke-w=([\d.]+)\n\}$/gm)].map((d) => ({ name: d[1] ?? "", grid: d[2] ?? "", path: d[3] ?? "", stroke: d[4] ?? "" }));
    const glyphs = menuGlyphs();
    expect(drawn.map((d) => d.name)).toEqual(glyphs.map((g) => g.name));
    for (const glyph of glyphs) {
      const one = drawn.find((d) => d.name === glyph.name);
      expect(one?.path).toBe(ICON_PATHS[glyph.id] ?? "missing");
      expect(one?.grid).toBe(String(ICON_GRID));
      expect(one?.stroke).toBe(gridStroke(glyph.px));
    }
  });

  test("the chevron at the small size, and every glyph a row of the ribbon's overflow carries at the middle one", () => {
    expect(menuGlyphs()[0]).toEqual({ name: glyphName("chevron-right"), id: "chevron-right", px: CHEVRON_GLYPH_PX });
    for (const tool of RIBBON_TOOLS) expect(menuGlyphs().some((g) => g.id === tool.icon && g.px === ROW_GLYPH_PX)).toBe(true);
    expect(source).toContain(`icon ${glyphName("chevron-right")} size=size.icon-size-sm`);
  });
});

describe("the document", () => {
  test("binds no pointer move and eases nothing (each would solve a frame per step)", () => {
    const code = source.replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("pointer-move=");
    expect(code).not.toContain("transition=");
    expect(code).not.toMatch(/when hover/);
  });

  test("a row is a menuitem with its own label, description and place in its list, and the separator is a separator", () => {
    expect(source).toContain("role=menuitem label=caption desc=said pos-in-set=pos set-size=count act=row");
    expect(source).toContain("role=separator");
    expect(source).toContain("when sub { expanded=open }");
  });
});

describe("a menu's surface", () => {
  test("one column of rows a row high, in a box of the frame and the rows, keyed by their place", () => {
    const s = menuSurface(input([leaf("Line", { name: "L", shortcut: "Ctrl+L" }), leaf("Ray"), sub("Arc", [leaf("3 Points")])]));
    expect(s.cols.length).toBe(1);
    expect(s.entries.map((e) => e.key)).toEqual(["r0", "r1", "r2"]);
    expect(s.entries.map((e) => e.top)).toEqual([0, m.row, 2 * m.row]);
    expect(s.height).toBe(3 * m.row + 2 * m.frame);
    const rows = s.cols[0]?.rows ?? [];
    expect(rows.map((r) => r.caption)).toEqual(["Line", "Ray", "Arc"]);
    // The name is typed lower case; the shortcut in this platform's words; a submenu has a chevron, not a shortcut.
    expect(rows[0]?.name).toBe("l");
    expect(rows[0]?.short).toBe(rowShortcut(leaf("x", { shortcut: "Ctrl+L" }), false));
    expect(rows[0]?.said).toBe("Type L");
    expect(rows[2]?.sub).toBe(true);
    expect(rows[2]?.short).toBe("");
    expect(rows.map((r) => [r.pos, r.count])).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  test("the tracks are shared down a column: the labels' as wide as the longest, then the names', then the shortcuts'", () => {
    const s = menuSurface(input([leaf("Line", { name: "L", shortcut: "Ctrl+L" }), leaf("Construction", { name: "XL" })]));
    const [a, b] = s.cols[0]?.rows ?? [];
    expect(a?.lw).toBe(12 * 6);
    expect(b?.lw).toBe(12 * 6);
    expect(a?.nw).toBe(2 * 6);
    expect(a?.g1).toBe(m.gap);
    expect(a?.g2).toBe(m.gap);
    expect(a?.sw).toBe(rowShortcut(leaf("x", { shortcut: "Ctrl+L" }), false).length * 6 + m.padEnd - m.rowEnd);
    expect(s.width).toBe(2 * m.frame + m.padStart + 72 + m.gap + 12 + m.gap + (a?.sw ?? 0) - (m.padEnd - m.rowEnd) + m.padEnd);
  });

  test("a box narrower than its least width gives the rest to the labels", () => {
    const s = menuSurface(input([leaf("Ray")], { minWidth: 300 }));
    expect(s.width).toBe(300);
    const row = s.cols[0]?.rows[0];
    expect((row?.lw ?? 0) + m.padStart + (row?.g1 ?? 0) + (row?.nw ?? 0) + (row?.g2 ?? 0) + (row?.sw ?? 0) + m.rowEnd).toBeCloseTo(300 - 2 * m.frame, 3);
  });

  test("a menu taller than its room stands in columns, broken between groups, with the labels' tracks equal and no separator leading a column", () => {
    const items = [leaf("A"), leaf("B"), leaf("C"), leaf("Delta", { group: true }), leaf("E"), leaf("F")];
    const s = menuSurface(input(items, { maxHeight: 3 * m.row + 2 * m.frame }));
    expect(s.cols.length).toBe(2);
    expect(s.cols[0]?.rows.map((r) => r.caption)).toEqual(["A", "B", "C"]);
    expect(s.cols[1]?.rows.map((r) => r.caption)).toEqual(["Delta", "E", "F"]);
    expect(s.cols[1]?.rows.some((r) => r.sep)).toBe(false);
    expect(s.cols[0]?.rows[0]?.lw).toBe(s.cols[1]?.rows[0]?.lw);
    expect(s.entries.map((e) => e.column)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(s.height).toBe(3 * m.row + 2 * m.frame);
  });

  test("a separator is drawn above the first row of a group inside a column, half a row high", () => {
    const s = menuSurface(input([leaf("A"), leaf("B", { group: true })]));
    expect(s.cols[0]?.rows.map((r) => (r.sep ? "—" : r.caption))).toEqual(["A", "—", "B"]);
    expect(s.entries[1]?.top).toBe(m.row + m.sep);
    expect(s.height).toBe(2 * m.row + m.sep + 2 * m.frame);
  });

  test("a row that is not available is off; a submenu never is; the open one is open", () => {
    const s = menuSurface(input([leaf("A", { enabled: false }), sub("B", [leaf("C")], { enabled: false })], { chain: ["B"] }));
    expect(s.cols[0]?.rows.map((r) => [r.off, r.open, r.down])).toEqual([
      [true, false, false],
      [false, true, false],
    ]);
  });

  test("a stacked menu is one column of the open tree: a group under its row, its rows stepped in by a guide", () => {
    const items = [sub("Draw", [leaf("Line"), sub("Arc", [leaf("3 Points")])]), leaf("Help")];
    const s = menuSurface(input(items, { stacked: true, chain: ["Draw", "Arc"] }));
    expect(s.cols.length).toBe(1);
    expect(s.entries.map((e) => `${e.depth}:${e.item.label}`)).toEqual(["0:Draw", "1:Line", "1:Arc", "2:3 Points", "0:Help"]);
    const rows = s.cols[0]?.rows ?? [];
    expect(rows.map((r) => r.guides.length)).toEqual([0, 1, 1, 2, 0]);
    expect(rows[0]?.down).toBe(true);
    expect(rows.map((r) => [r.pos, r.count])).toEqual([[1, 2], [1, 2], [2, 2], [1, 1], [2, 2]]);
    expect(s.width).toBe(300);
  });

  test("in a stacked row the typed name gives way first, whole, then the label is cut", () => {
    const row = (width: number) => menuSurface(input([leaf("Rectangle", { name: "REC", shortcut: "Ctrl+R" })], { stacked: true, stackedWidth: width })).cols[0]?.rows[0];
    const wide = row(400);
    expect(wide?.nw).toBe(18);
    const narrow = row(110);
    expect(narrow?.nw).toBe(0);
    expect(narrow?.g1).toBe(0);
    expect(narrow?.lw).toBeLessThan(9 * 6);
    expect(narrow?.sw).toBeGreaterThan(0);
  });

  test("a stacked menu longer than its room scrolls: the box stops at the room, the content does not", () => {
    const items = Array.from({ length: 30 }, (_, i) => leaf(`Row ${i}`));
    const s = menuSurface(input(items, { stacked: true, maxHeight: 200 }));
    expect(s.height).toBe(200);
    expect(s.content).toBe(30 * m.row);
  });

  test("under a finger the rows take the button's height", () => {
    const s = menuSurface(input([leaf("A"), leaf("B", { group: true })], { coarse: true }));
    expect(s.height).toBe(2 * m.rowCoarse + m.sepCoarse + 2 * m.frame);
  });

  test("hostile input: widths that are no number, a tree too long, a room that is no room", () => {
    const nan: TextMeasure = () => Number.NaN;
    const s = menuSurface(input([leaf("A", { name: "AB", shortcut: "Ctrl+A" })], { measure: nan, minWidth: Number.NaN, maxHeight: Number.NaN, stackedWidth: Number.POSITIVE_INFINITY }));
    expect(Number.isFinite(s.width)).toBe(true);
    expect(Number.isFinite(s.height)).toBe(true);
    for (const row of s.cols[0]?.rows ?? []) for (const value of [row.lw, row.nw, row.sw, row.g1, row.g2]) expect(Number.isFinite(value) && value >= 0).toBe(true);
    const many = Array.from({ length: MAX_MENU_ROWS + 50 }, (_, i) => leaf(`R${i}`));
    expect(menuSurface(input(many)).entries.length).toBe(MAX_MENU_ROWS);
    const huge: TextMeasure = () => 1e12;
    expect(menuSurface(input([leaf("A")], { measure: huge })).width).toBeLessThanOrEqual(8192);
    // A cyclic-looking deep chain is cut at the depth limit.
    let deep: MenuItem = leaf("end");
    const chain: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      deep = sub(`L${i}`, [deep]);
      chain.unshift(`L${i}`);
    }
    expect(menuSurface(input([deep], { stacked: true, chain })).entries.length).toBeLessThanOrEqual(10);
  });
});

describe("the lit rows", () => {
  test("only the rows that change are new objects, and a separator is never lit", () => {
    const s = menuSurface(input([leaf("A"), leaf("B", { group: true })]));
    const lit = withLit(s.cols, new Set(["r1", "s1"]));
    expect(lit[0]?.rows.map((r) => r.lit)).toEqual([false, false, true]);
    expect(lit[0]?.rows[0]).toBe(s.cols[0]?.rows[0] as never);
    const same = withLit(lit, new Set(["r1"]));
    expect(same[0]).toBe(lit[0] as never);
  });
});

describe("keys, rows and the pointer", () => {
  const KEY = "#menu/#body/#cols/each@0~c0/col@0/each@0~r3/row@0/col@0/#row";

  test("a row's key names its item; any other node, or a forged key, names none", () => {
    expect(rowOfKey(KEY)).toBe("r3");
    expect(rowOfKey("#menu/#body")).toBeNull();
    expect(rowOfKey("#menu/#body/#cols/each@0~c0/col@0/each@0~s3/row@0/col@0/#row")).toBeNull();
    expect(rowOfKey(`${"x".repeat(600)}~r1/#row`)).toBeNull();
    expect(rowIndex("r3", 4)).toBe(3);
    expect(rowIndex("r4", 4)).toBeNull();
    expect(rowIndex("r-1", 4)).toBeNull();
    expect(rowIndex("r99999", 1e9)).toBeNull();
  });

  test("the row under a point, and none outside every row or for a point that is no point", () => {
    const scene = [
      { key: "#menu", x: 0, y: 0, w: 200, h: 100 },
      { key: KEY, x: 5, y: 5, w: 190, h: 24 },
    ];
    expect(rowAt(scene, 10, 10)).toBe("r3");
    expect(rowAt(scene, 10, 50)).toBeNull();
    expect(rowAt(scene, Number.NaN, 10)).toBeNull();
  });

  test("a row's accessible node says what Row menuitem says: the popup, the shortcut, unavailable", () => {
    expect(rowExtras(sub("Arc", []), false)).toEqual({ "aria-haspopup": "menu", "aria-disabled": null, "aria-keyshortcuts": null });
    expect(rowExtras(leaf("Undo", { shortcut: "Ctrl+Z", enabled: false }), false)).toEqual({ "aria-haspopup": null, "aria-disabled": "true", "aria-keyshortcuts": "Control+Z" });
  });

  test("a group opened in place is shown from its row: at its top when it is taller than the box, else the least", () => {
    expect(groupScroll(500, 1200, 300, 0)).toBe(500);
    expect(groupScroll(100, 200, 300, 0)).toBe(0);
    expect(groupScroll(250, 350, 300, 0)).toBe(50);
    expect(groupScroll(10, 40, 300, 100)).toBe(10);
    expect(groupScroll(Number.NaN, Number.NaN, Number.NaN, Number.NaN)).toBe(0);
  });
});
