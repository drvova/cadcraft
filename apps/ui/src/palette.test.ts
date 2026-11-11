/**
 * The command palette's logic: what it lists, how a query matches, and the order of the rows.
 */

import { describe, expect, test } from "bun:test";
import type { CommandInfo } from "./facade";
import { fuzzy, highlight, paletteItems, rankCommands, rememberCommand, RECENT_LIMIT, slashQuery, type PaletteItem } from "./palette";

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
