import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { titleKeyAction } from "../components/MenuBar";
import { commandCentreName, LAYOUT_KEYS } from "../components/TopBar";
import { ICON_PATHS } from "../icons";
import type { TextMeasure } from "./measure";
import { glyphName, gridStroke, ICON_GRID, iconBlockOf, KEY_GLYPH_PX } from "./ribbon-icons";
import { CENTRE_GLYPH_PX, CENTRE_ICON, MENU_KEY_ICON, topBarGlyphs, topBarIconSource, withTopBarIcons } from "./topbar-icons";
import { controlAt, endStop, isMenuKeyKey, isTitleKey, MAX_TITLES, nextStop, onDirtyDot, pressedTitle, saidExtras, stopOfKey, titleBarLayout, titleParams, titlesWidth, TOPBAR_METRICS, TOPBAR_STOPS, topBarMetrics, type TopBarBox, type TopBarView } from "./topbar-params";
import { mapTokens } from "./tokens";

const ui = join(import.meta.dir, "..", "..");
const documentPath = join(ui, "slab", "topbar.slab");
// `TOPBAR_ICONS=write bun test src/slab/topbar.test.ts` writes the generated glyphs into the
// document again (after `icons.ts` or the keys' table changed); the tests below then hold.
if (process.env["TOPBAR_ICONS"] === "write") {
  const next = withTopBarIcons(readFileSync(documentPath, "utf8"));
  if (next !== null) writeFileSync(documentPath, next);
}
const source = readFileSync(documentPath, "utf8");

/** Every character 6 px wide, in every style: widths that can be counted by hand. */
const six: TextMeasure = (_style, text) => [...text].length * 6;
const m = TOPBAR_METRICS;
const TITLES = ["File", "Edit", "View", "Insert", "Format", "Tools", "Draw", "Dimension", "Modify", "Help"];
const view = (over: Partial<TopBarView> = {}): TopBarView => ({ compact: false, menus: true, titles: TITLES, name: "ring.dxf", dirty: false, ...over });

/** Keys as the driver reports them for this document (read from a running bar). */
const TITLE_KEY = "#titlebar/#band/#start/#menubar/each@0~menu-2/row@0/row@0";
const MENU_KEY = "#titlebar/#band/#start/#menukey";
const CENTRE_KEY = "#titlebar/#band/#centre";
const SIDE_KEY = "#titlebar/#band/#end/#side";
const PANEL_KEY = "#titlebar/#band/#end/#panel";
const CHAT_KEY = "#titlebar/#band/#end/#chat";

describe("the title bar's glyphs", () => {
  test("the document's block is the generator's output, character for character", () => {
    expect(iconBlockOf(source)).toBe(topBarIconSource());
    expect(withTopBarIcons(source)).toBe(source);
    expect(withTopBarIcons("no markers")).toBeNull();
  });

  test("every declared path is the interface's own, at the stroke of the size it is drawn at, and nothing else is declared", () => {
    const drawn = [...source.matchAll(/^icon ([a-z0-9-]+) viewbox=(\d+) \{\n {2}path "([^"]+)" bg=none stroke=current stroke-w=([\d.]+)\n\}$/gm)].map((d) => ({ name: d[1] ?? "", grid: d[2] ?? "", path: d[3] ?? "", stroke: d[4] ?? "" }));
    const glyphs = topBarGlyphs();
    expect(drawn.map((d) => d.name)).toEqual(glyphs.map((g) => g.name));
    expect([...source.matchAll(/^icon /gm)].length).toBe(glyphs.length);
    for (const glyph of glyphs) {
      const one = drawn.find((d) => d.name === glyph.name);
      expect(Object.hasOwn(ICON_PATHS, glyph.id)).toBe(true);
      expect(one?.path).toBe(ICON_PATHS[glyph.id] ?? "missing");
      expect(one?.grid).toBe(String(ICON_GRID));
      expect(one?.stroke).toBe(gridStroke(glyph.px));
    }
  });

  test("the glyphs are the SolidJS bar's: the magnifier, the menu key's list, and each layout key's own", () => {
    expect(topBarGlyphs().map((g) => g.id)).toEqual([CENTRE_ICON, MENU_KEY_ICON, ...LAYOUT_KEYS.map((key) => key.icon)]);
    expect(source).toContain(`icon ${glyphName(CENTRE_ICON)} size=size.icon-size-sm`);
    for (const id of [MENU_KEY_ICON, ...LAYOUT_KEYS.map((key) => key.icon)]) expect(source).toContain(`icon ${glyphName(id)} size=size.icon-size-md`);
    const sizes = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8")).lengths.get("size");
    expect(sizes?.get("icon-size-sm")).toBe(CENTRE_GLYPH_PX);
    expect(sizes?.get("icon-size-md")).toBe(KEY_GLYPH_PX);
  });

  test("each layout key of the document carries the SolidJS key's name", () => {
    for (const key of LAYOUT_KEYS) expect(source).toContain(`role=button label="${key.title}" act=`);
  });
});

describe("the document keeps the ribbon's rules", () => {
  test("no node binds pointer-move and none eases: each would solve the bar per step", () => {
    const code = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toContain("pointer-move=");
    expect(code).not.toContain("transition=");
  });

  test("the menu roles are the SolidJS bar's", () => {
    expect(source).toContain('role=menubar label="Main menu"');
    expect(source).toContain("role=menuitem label=name expanded=open act=title");
    expect(source).toContain('role=button label="Main menu" expanded=param.key_open act=menukey');
    expect(source).toContain("role=banner");
  });
});

describe("the three parts' widths", () => {
  const titles = titlesWidth(TITLES, six, m);

  test("a title is its label on the title's inset", () => {
    expect(titlesWidth(["File"], six, m)).toBe(4 * 6 + 16);
    expect(titles).toBe(TITLES.join("").length * 6 + TITLES.length * 16);
    expect(titlesWidth(new Array<string>(100).fill("A"), six, m)).toBe(MAX_TITLES * 22);
  });

  test("fractional labels are rounded up once for the run, not once per title", () => {
    const third: TextMeasure = (_style, text) => [...text].length * 6 + 0.3;
    expect(titlesWidth(TITLES, third, m)).toBe(Math.ceil(TITLES.join("").length * 6 + TITLES.length * 16.3));
    const hostile: TextMeasure = (_style, text) => (text === "File" ? Number.NaN : text === "Edit" ? -50 : 1e9);
    expect(titlesWidth(["File", "Edit", "View"], hostile, m)).toBe(3 * 16 + 4096);
  });

  test("with room, the centre takes its reading width and stands in the middle", () => {
    const at = titleBarLayout(1600, 1600, view(), six, m);
    expect(at.centre).toBe(44 * 6 + 12);
    expect(at.start).toBe(at.end);
    expect(at.start + at.centre + at.end).toBeLessThanOrEqual(1600 - 4 - 8 - 16);
    expect(at.start).toBeGreaterThanOrEqual(titles);
  });

  test("menus wider than their share keep their width; the keys give the room", () => {
    const at = titleBarLayout(1000, 1000, view(), six, m);
    expect(at.start).toBe(titles);
    expect(at.centre).toBe(44 * 6 + 12);
    expect(at.end).toBe(1000 - 28 - titles - at.centre);
    expect(at.end).toBeGreaterThanOrEqual(76);
  });

  test("the centre is two fifths of a window that is short of its reading width, and gives way before the menus and the keys do", () => {
    expect(titleBarLayout(600, 600, view({ menus: false }), six, m).centre).toBe(240 + 12);
    const tight = titleBarLayout(700, 1000, view(), six, m);
    expect(tight.start).toBe(titles);
    expect(tight.end).toBe(76);
    expect(tight.centre).toBe(700 - 28 - titles - 76);
  });

  test("a narrow window: the menu key's track balances the keys', and the centre takes 56% of the window", () => {
    const at = titleBarLayout(800, 800, view({ compact: true }), six, m);
    expect(at.centre).toBe(44 * 6 + 12);
    expect(at.start).toBe(at.end);
    // A phone's width: the keys' track is never narrower than the keys, and the start gives the room.
    const phone = titleBarLayout(390, 390, view({ compact: true }), six, m);
    expect(phone.centre).toBe(Math.floor(0.56 * 390) + 12);
    expect(phone.end).toBe(76);
    expect(phone.start).toBe(390 - 32 - phone.centre - 76);
    const tiny = titleBarLayout(150, 150, view({ compact: true }), six, m);
    expect(tiny.end).toBe(76);
    expect(tiny.start).toBe(24);
    expect(tiny.centre).toBe(150 - 32 - 76 - 24);
  });

  test("the name takes its own width, or what the centre has beside the magnifier and the dot", () => {
    const at = titleBarLayout(1600, 1600, view(), six, m);
    expect(at.name).toBe(8 * 6);
    const long = titleBarLayout(1600, 1600, view({ name: "x".repeat(80), dirty: true }), six, m);
    expect(long.name).toBe(long.centre - 12 - 12 - 6 - 6 - 6);
  });

  test("a width that is no width lays out nothing", () => {
    for (const width of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 20]) expect(titleBarLayout(width, 1000, view(), six, m)).toEqual({ start: 0, centre: 0, end: 0, name: 0 });
    const huge = titleBarLayout(1e12, 1e12, view(), six, m);
    expect(huge.start + huge.centre + huge.end).toBeLessThanOrEqual(100_000);
  });

  test("the measures are the document's tokens, and a token that is no length keeps its default", () => {
    expect(topBarMetrics(() => undefined)).toEqual(m);
    expect(topBarMetrics((path) => (path === "space.g8" ? 10 : path === "topbar.dot" ? "6" : Number.NaN))).toEqual({ ...m, padStartCompact: 10, padEnd: 10, gap: 10, titlePad: 10 });
    const sheet = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8"));
    expect(sheet.lengths.get("space")?.get("g4")).toBe(m.padStart);
    expect(sheet.lengths.get("space")?.get("g8")).toBe(m.gap);
    expect(sheet.lengths.get("size")?.get("control-h-input")).toBe(m.key);
    expect(sheet.lengths.get("size")?.get("control-h-tab")).toBe(35);
    expect(source).toContain("band 34");
    expect(source).toContain(`dot ${m.dot}`);
  });
});

describe("the titles", () => {
  test("a title per menu, the open one marked, each under a key of its place", () => {
    const list = titleParams(["File", "Edit\nmore"], 1);
    expect(list).toEqual([
      { key: "menu-0", name: "File", open: false },
      { key: "menu-1", name: "Edit more", open: true },
    ]);
    expect(titleParams(new Array<string>(100).fill("A"), null).length).toBe(MAX_TITLES);
  });

  test("a signal's item key names a title that is there, or nothing", () => {
    expect(pressedTitle("menu-2", 10)).toBe(2);
    expect(pressedTitle("menu-10", 10)).toBeNull();
    for (const forged of ["", "menu-", "menu--1", "menu-1e3", "menu-999", "tool-1", "menu-1/x"]) expect(pressedTitle(forged, 10)).toBeNull();
  });

  test("the bar's keys are the SolidJS bar's, by the one rule", () => {
    const key = (k: string): { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean } => ({ key: k, ctrlKey: false, metaKey: false, altKey: false });
    expect(titleKeyAction(key("ArrowRight"), 9, TITLES, false)).toEqual({ kind: "move", to: 0 });
    expect(titleKeyAction(key("ArrowLeft"), 0, TITLES, true)).toEqual({ kind: "move", to: 9 });
    expect(titleKeyAction(key("Home"), 4, TITLES, false)).toEqual({ kind: "move", to: 0 });
    expect(titleKeyAction(key("End"), 4, TITLES, false)).toEqual({ kind: "move", to: 9 });
    expect(titleKeyAction(key("ArrowDown"), 3, TITLES, false)).toEqual({ kind: "open", last: false });
    expect(titleKeyAction(key("ArrowUp"), 3, TITLES, false)).toEqual({ kind: "open", last: true });
    expect(titleKeyAction(key("d"), 0, TITLES, false)).toEqual({ kind: "move", to: 6 });
    expect(titleKeyAction(key("d"), 6, TITLES, false)).toEqual({ kind: "move", to: 7 });
    expect(titleKeyAction(key("Escape"), 3, TITLES, true)).toEqual({ kind: "close" });
    expect(titleKeyAction(key("Escape"), 3, TITLES, false)).toBeNull();
    expect(titleKeyAction(key("q"), 3, TITLES, false)).toBeNull();
    expect(titleKeyAction({ ...key("d"), ctrlKey: true }, 0, TITLES, false)).toBeNull();
  });
});

describe("the stops of the Tab key", () => {
  test("a control's stop is read from its key", () => {
    expect(stopOfKey(TITLE_KEY)).toBe("menus");
    expect(stopOfKey(MENU_KEY)).toBe("menus");
    expect(stopOfKey(CENTRE_KEY)).toBe("centre");
    expect(stopOfKey(SIDE_KEY)).toBe("sidebar");
    expect(stopOfKey(PANEL_KEY)).toBe("panel");
    expect(stopOfKey(CHAT_KEY)).toBe("assistant");
    expect(stopOfKey("#titlebar/#band")).toBeNull();
    expect(stopOfKey(`${"x".repeat(600)}/#centre`)).toBeNull();
    expect(isTitleKey(TITLE_KEY) && !isTitleKey(MENU_KEY) && isMenuKeyKey(MENU_KEY) && !isMenuKeyKey(null)).toBe(true);
  });

  test("Tab walks the SolidJS bar's order and leaves at the ends", () => {
    const has = { menus: true };
    expect(TOPBAR_STOPS.map((stop) => nextStop(stop, false, has))).toEqual(["centre", "sidebar", "panel", "assistant", null]);
    expect(TOPBAR_STOPS.map((stop) => nextStop(stop, true, has))).toEqual([null, "menus", "centre", "sidebar", "panel"]);
    expect(nextStop("centre", true, { menus: false })).toBeNull();
    expect(nextStop("menus", false, { menus: false })).toBeNull();
    expect(endStop(false, has)).toBe("menus");
    expect(endStop(false, { menus: false })).toBe("centre");
    expect(endStop(true, has)).toBe("assistant");
  });
});

describe("what the pointer is on", () => {
  const scene: TopBarBox[] = [
    { key: "#titlebar", x: 0, y: 0, w: 1000, h: 35, role: "banner" },
    { key: "#titlebar/#band/#start/#menubar", x: 4, y: 0, w: 400, h: 34, role: "menubar" },
    { key: TITLE_KEY, x: 80, y: 6, w: 40, h: 22, role: "menuitem" },
    { key: CENTRE_KEY, x: 420, y: 5, w: 276, h: 24, role: "button" },
    { key: `${CENTRE_KEY}/#dirty`, x: 600, y: 14, w: 6, h: 6 },
    { key: SIDE_KEY, x: 920, y: 5, w: 24, h: 24, role: "button" },
  ];

  test("a control is found by its rectangle, and nothing else is one", () => {
    expect(controlAt(scene, 90, 10)).toBe(TITLE_KEY);
    expect(controlAt(scene, 500, 10)).toBe(CENTRE_KEY);
    expect(controlAt(scene, 930, 10)).toBe(SIDE_KEY);
    expect(controlAt(scene, 300, 10)).toBeNull();
    expect(controlAt(scene, 90, 2)).toBeNull();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) expect(controlAt(scene, bad, 10)).toBeNull();
    expect(controlAt([], 1, 1)).toBeNull();
  });

  test("the unsaved dot is found for its own hint", () => {
    expect(onDirtyDot(scene, 602, 16)).toBe(true);
    expect(onDirtyDot(scene, 500, 16)).toBe(false);
    expect(onDirtyDot(scene, Number.NaN, 16)).toBe(false);
  });
});

describe("what a control says beyond the language's attributes", () => {
  const state = { sidebar: true, panel: false, assistant: false, shortcuts: { centre: "Control+Shift+P", sidebar: "Control+B" } };

  test("a layout key is a pressed button with its shortcut, as the SolidJS key is", () => {
    expect(saidExtras(SIDE_KEY, state)).toEqual({ "aria-pressed": "true", "aria-haspopup": null, "aria-keyshortcuts": "Control+B" });
    expect(saidExtras(PANEL_KEY, state)).toEqual({ "aria-pressed": "false", "aria-haspopup": null, "aria-keyshortcuts": null });
  });

  test("a title and the menu key open a menu; the command centre carries its shortcut", () => {
    expect(saidExtras(TITLE_KEY, state)).toEqual({ "aria-pressed": null, "aria-haspopup": "menu", "aria-keyshortcuts": null });
    expect(saidExtras(MENU_KEY, state)?.["aria-haspopup"]).toBe("menu");
    expect(saidExtras(CENTRE_KEY, state)).toEqual({ "aria-pressed": null, "aria-haspopup": null, "aria-keyshortcuts": "Control+Shift+P" });
    expect(saidExtras("#titlebar/#band", state)).toBeNull();
  });

  test("the command centre's name is the SolidJS one", () => {
    expect(commandCentreName("ring.dxf", false)).toBe("Search commands, ring.dxf");
    expect(commandCentreName("ring.dxf", true)).toBe("Search commands, ring.dxf, unsaved changes");
  });
});
