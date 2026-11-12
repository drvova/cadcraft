/**
 * The command palette's logic: what it lists, how a query matches, and the order of the rows.
 */

import { describe, expect, test } from "bun:test";
import type { CommandInfo } from "./facade";
import { fuzzy, highlight, paletteItems, rankCommands, rememberCommand, RECENT_LIMIT, rowName, slashQuery, stepActive, type PaletteItem } from "./palette";

const command = (id: string, label: string, menu = "", extra: Partial<CommandInfo> = {}): CommandInfo => ({ id, label, menu, shortcut: "", aliases: [], params: "", enabled: true, ...extra });

const COMMANDS: CommandInfo[] = [
  command("circle", "Circle", "Draw > Circle", { aliases: ["c"] }),
  command("line", "Line", "Draw > Line", { aliases: ["l"] }),
  command("zoom.extents", "Zoom Extents", "View > Zoom > Zoom Extents"),
  command("layer", "Layer Properties", "Format > Layer Properties", { aliases: ["la"] }),
  command("plot", "Plot", "File > Plot", { enabled: false }),
  command("hidden", ""),
];

const ITEMS: PaletteItem[] = paletteItems(COMMANDS, [{ id: "ui.toggle.assistant", label: "Assistant", menu: ["Window", "Assistant"], shortcut: "Cmd+7" }]);

const ids = (query: string, recent: string[] = []): string[] => rankCommands(query, ITEMS, recent).map((m) => m.item.id);

describe("paletteItems", () => {
  test("lists labelled commands and the shell's items, by label, with their menu's parent path", () => {
    expect(ITEMS.map((i) => i.id)).toEqual(["ui.toggle.assistant", "circle", "layer", "line", "plot", "zoom.extents"]);
    expect(ITEMS.find((i) => i.id === "zoom.extents")?.path).toBe("View > Zoom");
    expect(ITEMS.find((i) => i.id === "ui.toggle.assistant")?.path).toBe("Window");
    expect(ITEMS.find((i) => i.id === "ui.toggle.assistant")?.shortcut).toBe("Cmd+7");
  });
});

describe("fuzzy", () => {
  test("a run of letters matches, best at the start, then at a word's start", () => {
    const start = fuzzy("zoo", "Zoom Extents");
    const word = fuzzy("ext", "Zoom Extents");
    const middle = fuzzy("oom", "Zoom Extents");
    expect(start?.indices).toEqual([0, 1, 2]);
    expect(word?.indices).toEqual([5, 6, 7]);
    expect((start?.score ?? 0) > (word?.score ?? 0)).toBe(true);
    expect((word?.score ?? 0) > (middle?.score ?? 0)).toBe(true);
  });
  test("letters in order match across gaps; a missing letter does not", () => {
    expect(fuzzy("ze", "Zoom Extents")?.indices).toEqual([0, 5]);
    expect(fuzzy("zx", "Zoom Extents")?.indices).toEqual([0, 6]);
    expect(fuzzy("zq", "Zoom Extents")).toBeNull();
    expect(fuzzy("longer than the text", "Line")).toBeNull();
  });
  test("an empty query matches everything with nothing to light", () => {
    expect(fuzzy("", "Line")).toEqual({ score: 0, indices: [] });
  });
});

describe("rankCommands", () => {
  test("with nothing typed: the recently used first, in their order, then the rest by label", () => {
    expect(ids("", ["line", "zoom.extents", "gone"])).toEqual(["line", "zoom.extents", "ui.toggle.assistant", "circle", "layer", "plot"]);
  });
  test("what a person types at the command line wins: an alias, then an id", () => {
    expect(ids("c")[0]).toBe("circle");
    expect(ids("la")[0]).toBe("layer");
    expect(ids("line")[0]).toBe("line");
  });
  test("a label matches by its letters, and a better match comes first", () => {
    expect(ids("ze")).toEqual(["zoom.extents"]);
    expect(ids("lay")[0]).toBe("layer");
  });
  test("a command that cannot run sinks below the ones that can", () => {
    const order = ids("l");
    expect(order.indexOf("plot")).toBe(order.length - 1);
  });
  test("nothing matches nothing, and the list is bounded", () => {
    expect(ids("qqq")).toEqual([]);
    expect(rankCommands("", ITEMS, [], 2).length).toBe(2);
  });
});

/** A slice of the real registry: short labels that repeat, told apart by their menu and their names. */
const CAD: PaletteItem[] = paletteItems(
  [
    command("line", "Line", "Draw > Line", { aliases: ["l"] }),
    command("list", "List", "Tools > Inquiry > List", { aliases: ["li"] }),
    command("dimlinear", "Linear", "Dimension > Linear", { aliases: ["dli", "dimlin"] }),
    command("dimjogline", "Jogged Linear", "Dimension > Jogged Linear"),
    command("pline", "Polyline", "Draw > Polyline", { aliases: ["pl"] }),
    command("circle", "Circle", "Draw > Circle > Circle", { aliases: ["c"] }),
    command("circle.2p", "2 Points", "Draw > Circle > 2 Points"),
    command("copy", "Copy", "Modify > Copy", { aliases: ["co"] }),
    command("mirror", "Mirror", "Modify > Mirror", { aliases: ["mi"] }),
    command("move", "Move", "Modify > Move", { aliases: ["m"] }),
    command("zoom", "Zoom", "", { aliases: ["z"] }),
    command("zoom.extents", "Zoom Extents", "View > Zoom > Zoom Extents"),
    command("zoom.realtime", "Zoom Realtime", "View > Zoom > Zoom Realtime"),
    command("layfrz", "Freeze Layer", "Format > Layer Tools > Freeze Layer"),
    command("layer", "Layers", "Format > Layers", { aliases: ["la"] }),
    command("u", "Undo", "Edit > Undo", { shortcut: "Cmd+Z" }),
    command("undo", "Undo", ""),
    command("qsave", "Save", "File > Save", { shortcut: "Cmd+S" }),
    command("saveas", "Save As...", "File > Save As...", { aliases: ["save"] }),
    command("hatch.patterns", "Hatch Patterns", ""),
    command("pasteclip", "Paste", "Edit > Paste", { enabled: false }),
    command("burst", "Explode Attributes to Text", "Modify > Explode Attributes to Text"),
  ],
  [],
);

const cad = (query: string, recent: string[] = []): string[] => rankCommands(query, CAD, recent).map((m) => m.item.id);

describe("rankCommands, the queries a CAD hand types", () => {
  test("l: the alias typed whole, then the labels that start with it, then the rest", () => {
    expect(cad("l").slice(0, 4)).toEqual(["line", "list", "layer", "dimlinear"]);
    expect(cad("l").indexOf("pline")).toBeGreaterThan(cad("l").indexOf("layer"));
  });
  test("li: the alias of List outranks the label Line starts with", () => {
    expect(cad("li").slice(0, 3)).toEqual(["list", "line", "dimlinear"]);
  });
  test("line: the exact name, then a label that starts with it, then a word that does, then inside a word", () => {
    expect(cad("line")).toEqual(["line", "dimlinear", "dimjogline", "pline"]);
  });
  test("ln: the letters in order from a word's start, and never from the middle of one", () => {
    expect(cad("ln")).toEqual(["line", "dimlinear", "dimjogline"]);
  });
  test("circ: the label first, then the commands its menu holds", () => {
    expect(cad("circ")).toEqual(["circle", "circle.2p"]);
  });
  test("zoom e: the words as typed start Zoom Extents; a row with the letter inside a word follows", () => {
    expect(cad("zoom e")).toEqual(["zoom.extents", "zoom.realtime"]);
  });
  test("ze: the initials of Zoom Extents outrank the letters inside Freeze", () => {
    expect(cad("ze")).toEqual(["zoom.extents", "layfrz"]);
  });
  test("lay: a label's start, then a word's start", () => {
    expect(cad("lay")).toEqual(["layer", "layfrz"]);
  });
  test("undo: the id typed whole leads the two commands that share the label", () => {
    expect(cad("undo")).toEqual(["undo", "u"]);
    expect(cad("u")[0]).toBe("u");
  });
  test("sav: by label, the shorter first; the alias typed whole wins", () => {
    expect(cad("sav")).toEqual(["qsave", "saveas"]);
    expect(cad("save")[0]).toBe("saveas");
    expect(rankCommands("save", CAD, [])[0]?.via).toBe("save");
  });
  test("dim lin: every word must match something of the row: its menu, its label, its name", () => {
    expect(cad("dim lin")).toEqual(["dimlinear", "dimjogline"]);
    expect(cad("circle 2p")).toEqual(["circle.2p"]);
    expect(cad("dim circle")).toEqual([]);
  });
  test("dimlin: an alias's start", () => {
    expect(cad("dimlin")).toEqual(["dimlinear"]);
  });
  test("modify: a word of the menu path lists what the menu holds", () => {
    expect(cad("modify")).toEqual(["copy", "move", "mirror", "burst"]);
  });
  test("cirlce: a slipped key still finds the command, and only when nothing else matched", () => {
    expect(cad("cirlce")).toEqual(["circle", "circle.2p"]);
    expect(cad("cirlc")).toEqual(["circle", "circle.2p"]);
    expect(cad("mirorr")).toEqual(["mirror"]);
    // Four letters are too few to guess from: "mive" is not Move.
    expect(cad("mive")).toEqual([]);
  });
  test("paste: a command that cannot run is listed, never replaced by a look-alike that can", () => {
    expect(cad("paste")).toEqual(["pasteclip"]);
    expect(cad("pa").indexOf("pasteclip")).toBe(cad("pa").length - 1);
  });
  test("upper case and spaces around the query change nothing", () => {
    expect(cad("LINE")).toEqual(cad("line"));
    expect(cad("  line  ")).toEqual(cad("line"));
    expect(cad("Zoom   E")).toEqual(cad("zoom e"));
    expect(cad("   ")).toEqual(cad(""));
  });
  test("no hits, a paragraph, and letters far apart", () => {
    expect(cad("qqqzzz")).toEqual([]);
    expect(cad("line ".repeat(100))).toEqual(["line", "dimlinear", "dimjogline", "pline"]);
    expect(cad("x".repeat(500))).toEqual([]);
    // e-x-t is a word's start in Zoom Extents and inside a word of "Explode Attributes to Text";
    // e-x-i-t is in that label too, but fifteen letters apart: noise, not a match.
    expect(cad("ext")).toEqual(["zoom.extents", "burst"]);
    expect(cad("exit")).toEqual([]);
  });
  test("the recently used come first inside a tier and never jump one", () => {
    expect(cad("modify", ["mirror"])[0]).toBe("mirror");
    expect(cad("l", ["dimlinear"]).slice(0, 2)).toEqual(["line", "dimlinear"]);
    expect(cad("zoom", ["zoom.realtime"]).slice(0, 2)).toEqual(["zoom", "zoom.realtime"]);
    expect(cad("", ["move", "line"]).slice(0, 2)).toEqual(["move", "line"]);
  });
  test("a row that ranks by its name still lights what its label shares with the query", () => {
    const line = rankCommands("line", CAD, []).find((m) => m.item.id === "pline");
    expect(line?.indices).toEqual([4, 5, 6, 7]);
    expect(rankCommands("zoom e", CAD, [])[0]?.indices).toEqual([0, 1, 2, 3, 4, 5]);
  });
  test("two thousand commands rank inside a frame", () => {
    const many = paletteItems(
      Array.from({ length: 2000 }, (_, i) => command(`cmd${i}.part`, `Command ${i} ${["Line", "Circle", "Layer", "Zoom"][i % 4]}`, `Menu ${i % 20} > Sub > Command`, { aliases: [`c${i}`] })),
      [],
    );
    rankCommands("warm", many, []);
    const start = performance.now();
    for (const q of ["c", "ci", "cir", "circ", "cirlce", "command 19 zoom", "x".repeat(500)]) rankCommands(q, many, [], Number.POSITIVE_INFINITY);
    expect((performance.now() - start) / 7).toBeLessThan(50);
  });
});

describe("rowName", () => {
  const row = (id: string, label: string, via?: string): string => rowName({ item: { id, label, path: "", shortcut: "", aliases: [], enabled: true }, score: 0, indices: [], ...(via === undefined ? {} : { via }) });
  test("the id where it says more than the label, the alias that matched, nothing for the shell's own", () => {
    expect(row("zoom.extents", "Zoom Extents")).toBe("zoom.extents");
    expect(row("line", "Line")).toBe("");
    expect(row("line", "Line", "l")).toBe("l");
    expect(row("ui.toggle.assistant", "Assistant")).toBe("");
  });
});

describe("stepActive", () => {
  test("the arrows wrap, a page stops at the ends, an empty list stays at its top", () => {
    expect(stepActive(4, 1, 5, true)).toBe(0);
    expect(stepActive(0, -1, 5, true)).toBe(4);
    expect(stepActive(1, 10, 5, false)).toBe(4);
    expect(stepActive(3, -10, 5, false)).toBe(0);
    expect(stepActive(2, 1, 0, true)).toBe(0);
  });
});

describe("highlight", () => {
  test("the matched letters come back as marked runs", () => {
    expect(highlight("Zoom Extents", [0, 5])).toEqual([
      { text: "Z", hit: true },
      { text: "oom ", hit: false },
      { text: "E", hit: true },
      { text: "xtents", hit: false },
    ]);
    expect(highlight("Line", [])).toEqual([{ text: "Line", hit: false }]);
  });
});

describe("slashQuery", () => {
  test("a draft that is one slash word asks for commands", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/zo")).toBe("zo");
    expect(slashQuery("/zoom.extents")).toBe("zoom.extents");
  });
  test("a message is not a command search", () => {
    expect(slashQuery("")).toBeNull();
    expect(slashQuery("draw / a line")).toBeNull();
    expect(slashQuery("/ is the root")).toBeNull();
    expect(slashQuery("/zoom now")).toBeNull();
    expect(slashQuery("//comment")).toBeNull();
    expect(slashQuery(["/zoom", "more"].join(String.fromCharCode(10)))).toBeNull();
  });
});

describe("rememberCommand", () => {
  test("newest first, no repeats, bounded", () => {
    expect(rememberCommand(["line", "circle"], "circle")).toEqual(["circle", "line"]);
    const many = Array.from({ length: 20 }, (_, i) => `c${i}`);
    expect(rememberCommand(many, "new").length).toBe(RECENT_LIMIT);
    expect(rememberCommand(many, "new")[0]).toBe("new");
  });
});
