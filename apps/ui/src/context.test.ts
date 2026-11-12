/**
 * What each right-click menu holds, for each state it is opened in: at rest, with a selection,
 * while a command runs, on a layer's row and on a layout's tab; with a registry that has every
 * command, one that lacks some, and one that has none. And what a right click on the drawing means.
 */

import { describe, expect, test } from "bun:test";
import { commandMenu, drawingMenu, layerMenu, layoutMenu, LONG_PRESS_MS, QUICK_CLICK_MS, ranCommands, RECENT_LIMIT, restMenu, rightClickAction, selectionMenu, type ContextMenuModel, type DrawingContext } from "./context";
import type { CommandInfo, LayerInfo } from "./facade";
import type { MenuItem } from "./menu";

const command = (id: string, label: string, extra: Partial<CommandInfo> = {}): CommandInfo => ({ id, label, menu: "", shortcut: "", aliases: [], params: "", enabled: true, ...extra });

/** The commands the menus name, as the engine's registry lists them (labels, shortcuts, aliases). */
const REGISTRY: CommandInfo[] = [
  command("u", "Undo", { shortcut: "Cmd+Z" }),
  command("redo", "Redo", { shortcut: "Cmd+Shift+Z" }),
  command("pan", "Pan", { aliases: ["p"] }),
  command("zoom", "Zoom", { aliases: ["z"] }),
  command("zoom.window", "Zoom Window"),
  command("zoom.extents", "Zoom Extents"),
  command("selectall", "Select All", { shortcut: "Cmd+A" }),
  command("qselect", "Quick Select...", { aliases: ["qs"] }),
  command("pasteclip", "Paste", { shortcut: "Cmd+V", enabled: false }),
  command("cutclip", "Cut", { shortcut: "Cmd+X" }),
  command("copyclip", "Copy", { shortcut: "Cmd+C" }),
  command("options", "Options...", { aliases: ["op"] }),
  command("erase", "Erase", { aliases: ["e"] }),
  command("move", "Move", { aliases: ["m"] }),
  command("copy", "Copy", { aliases: ["co"] }),
  command("rotate", "Rotate", { aliases: ["ro"] }),
  command("scale", "Scale", { aliases: ["sc"] }),
  command("mirror", "Mirror", { aliases: ["mi"] }),
  command("draworder.front", "Bring to Front"),
  command("draworder.back", "Send to Back"),
  command("draworder.above", "Bring Above Objects"),
  command("draworder.under", "Send Under Objects"),
  command("select", "Select"),
  command("line", "Line", { aliases: ["l"] }),
  command("circle", "Circle", { aliases: ["c"] }),
  command("layer.set", "Set Layer Properties"),
  command("layer.current", "Make Current", { aliases: ["clayer"] }),
  command("layer.delete", "Delete Layer"),
  command("layiso", "Isolate Layer"),
  command("rename", "Rename...", { aliases: ["ren"] }),
  command("layout", "Layout", { aliases: ["lo"] }),
  command("layout.new", "New Layout"),
  command("layout.delete", "Delete Layout"),
  command("pagesetup", "Page Setup Manager..."),
];

const without = (...ids: string[]): CommandInfo[] => REGISTRY.filter((c) => !ids.includes(c.id));

const context = (extra: Partial<DrawingContext> = {}): DrawingContext => ({ registry: REGISTRY, selected: 0, running: null, keywords: [], accept: null, output: [], remembered: [], ...extra });

/** A menu's rows as text: the label, a mark for a row that is off, and a rule where a group starts. */
const rows = (items: readonly MenuItem[]): string[] => items.map((item) => `${item.group === true ? "| " : ""}${item.label}${item.id === null ? " >" : ""}${item.enabled ? "" : " (off)"}`);

/** The action of the row with this label. */
const action = (model: ContextMenuModel, label: string) => {
  const item = model.items.flatMap((i) => [i, ...i.children]).find((i) => i.label === label);
  return item === undefined || item.id === null ? undefined : model.actions.get(item.id);
};

describe("a right click on the drawing", () => {
  test("at rest it always shows the menu", () => {
    expect(rightClickAction(false, "pointer", 80, false)).toBe("menu");
    expect(rightClickAction(false, "pointer", 900, true)).toBe("menu");
  });

  test("while a command runs a quick, still click is Enter, and a longer or a moved one shows the menu", () => {
    expect(rightClickAction(true, "pointer", 80, false)).toBe("enter");
    expect(rightClickAction(true, "pointer", QUICK_CLICK_MS - 1, false)).toBe("enter");
    expect(rightClickAction(true, "pointer", QUICK_CLICK_MS, false)).toBe("menu");
    expect(rightClickAction(true, "pointer", 80, true)).toBe("menu");
  });

  test("a finger's long press and the menu key show the menu, in a command too", () => {
    expect(rightClickAction(true, "touch", LONG_PRESS_MS, false)).toBe("menu");
    expect(rightClickAction(true, "keyboard", 0, false)).toBe("menu");
    expect(rightClickAction(false, "keyboard", 0, false)).toBe("menu");
  });

  test("a press whose length is not a time is not a quick click", () => {
    expect(rightClickAction(true, "pointer", Number.NaN, false)).toBe("menu");
    expect(rightClickAction(true, "pointer", -5, false)).toBe("menu");
  });
});

describe("the commands that ran", () => {
  test("are read from the history's Command: lines, newest first, each once, by id", () => {
    expect(ranCommands(["Command: LINE", "0,0", "5,5", "Command: ZOOM.EXTENTS", "l", "Command: LINE", "*Cancel*"])).toEqual(["line", "zoom.extents"]);
  });

  test("a transparent command, typed input and other lines are not commands that ran", () => {
    expect(ranCommands(["'ZOOM", ">>ZOOM", "Resuming LINE command.", "unknown command `foo`", "Command:", " Command: LINE"])).toEqual([]);
  });
});

describe("the menu at rest", () => {
  test("holds the view, the selection and the clipboard, each group under a separator", () => {
    expect(rows(restMenu(context()).items)).toEqual(["Undo", "Redo", "| Pan", "Zoom Window", "Zoom Extents", "| Select All", "Quick Select...", "| Paste (off)", "| Options..."]);
  });

  test("leads with Repeat and the recent commands once a command has run", () => {
    const menu = restMenu(context({ output: ["Command: LINE", "Command: CIRCLE"], remembered: ["zoom.extents", "line", "gone"] }));
    expect(rows(menu.items).slice(0, 3)).toEqual(["Repeat Circle", "Recent Commands >", "| Undo"]);
    expect(action(menu, "Repeat Circle")).toEqual({ kind: "submit", text: "" });
    // The session's own, then what the palette remembers, each once; one the registry lacks is left out.
    expect(menu.items[1]?.children.map((c) => c.label)).toEqual(["Circle", "Line", "Zoom Extents"]);
    expect(action(menu, "Zoom Extents")).toEqual({ kind: "invoke", id: "zoom.extents" });
  });

  test("lists no more recent commands than the limit", () => {
    const menu = restMenu(context({ remembered: REGISTRY.map((c) => c.id) }));
    expect(menu.items[0]?.label).toBe("Recent Commands");
    expect(menu.items[0]?.children.length).toBe(RECENT_LIMIT);
  });

  test("names a repeated command the registry does not list by its typed name", () => {
    expect(restMenu(context({ output: ["Command: MYLISP"] })).items[0]?.label).toBe("Repeat MYLISP");
    expect(restMenu(context({ output: ["Command: QSELECT"] })).items[0]?.label).toBe("Repeat Quick Select");
  });

  test("a row starts its command as the menu bar does, with its shortcut and typed name", () => {
    const menu = restMenu(context());
    expect(action(menu, "Zoom Window")).toEqual({ kind: "invoke", id: "zoom.window" });
    const undo = menu.items.find((i) => i.label === "Undo");
    expect(undo?.shortcut).toBe("Cmd+Z");
    expect(undo?.name).toBe("U");
    // A name that only repeats the label is not printed.
    expect(menu.items.find((i) => i.label === "Pan")?.name).toBe("P");
    expect(menu.items.find((i) => i.label === "Redo")?.name).toBe("");
  });

  test("Paste is on when the engine says the clipboard holds something", () => {
    const registry = REGISTRY.map((c) => (c.id === "pasteclip" ? { ...c, enabled: true } : c));
    expect(rows(restMenu(context({ registry })).items)).toContain("| Paste");
  });

  test("a command the registry lacks has no row, and a group left empty no separator", () => {
    const menu = restMenu(context({ registry: without("redo", "selectall", "qselect", "options", "zoom.window") }));
    expect(rows(menu.items)).toEqual(["Undo", "| Pan", "Zoom Extents", "| Paste (off)"]);
  });

  test("a registry with none of the commands gives a menu with no row", () => {
    expect(restMenu(context({ registry: [] })).items).toEqual([]);
    expect(drawingMenu(context({ registry: [command("line", "Line")] })).items).toEqual([]);
  });
});

describe("the menu with a selection", () => {
  test("holds the edits, the clipboard, the draw order, and the selection's own rows", () => {
    const menu = selectionMenu(context({ selected: 3, output: ["Command: MOVE"] }));
    expect(menu.label).toBe("3 selected objects");
    expect(rows(menu.items)).toEqual(["Repeat Move", "| Erase", "Move", "Copy", "Rotate", "Scale", "Mirror", "| Cut", "Copy to Clipboard", "Paste (off)", "| Draw Order >", "| Deselect All", "Properties"]);
    expect(menu.items.find((i) => i.label === "Draw Order")?.children.map((c) => c.label)).toEqual(["Bring to Front", "Send to Back", "Bring Above Objects", "Send Under Objects"]);
  });

  test("the two Copy rows run two commands", () => {
    const menu = selectionMenu(context({ selected: 1 }));
    expect(menu.label).toBe("1 selected object");
    expect(action(menu, "Copy")).toEqual({ kind: "invoke", id: "copy" });
    expect(action(menu, "Copy to Clipboard")).toEqual({ kind: "invoke", id: "copyclip" });
    expect(action(menu, "Send to Back")).toEqual({ kind: "invoke", id: "draworder.back" });
  });

  test("Deselect All clears the selection and Properties opens the panel", () => {
    const menu = selectionMenu(context({ selected: 2 }));
    expect(action(menu, "Deselect All")).toEqual({ kind: "execute", id: "select", params: { clear: true } });
    expect(action(menu, "Properties")).toEqual({ kind: "properties" });
  });

  test("a registry missing the draw order, the clipboard and some edits keeps the rest", () => {
    const menu = selectionMenu(context({ selected: 2, registry: without("draworder.front", "draworder.back", "draworder.above", "draworder.under", "cutclip", "copyclip", "pasteclip", "mirror", "scale", "select") }));
    expect(rows(menu.items)).toEqual(["Erase", "Move", "Copy", "Rotate", "| Properties"]);
  });

  test("a row is off while the registry says its command is", () => {
    const registry = REGISTRY.map((c) => (c.id === "erase" || c.id === "draworder.front" ? { ...c, enabled: false } : c));
    const menu = selectionMenu(context({ selected: 2, registry }));
    expect(rows(menu.items)[0]).toBe("Erase (off)");
    expect(menu.items.find((i) => i.label === "Draw Order")?.children[0]?.enabled).toBe(false);
  });
});

describe("the menu while a command runs", () => {
  const running = context({ running: "line", keywords: ["Close", "Undo"], accept: { point: true, number: false, text: false, select: false, enter: true }, selected: 4 });

  test("holds Enter and Cancel, the prompt's keywords, then Pan and Zoom", () => {
    const menu = commandMenu(running);
    expect(menu.label).toBe("LINE");
    expect(rows(menu.items)).toEqual(["Enter", "Cancel", "| Close", "Undo", "| Pan", "Zoom"]);
  });

  test("a keyword is sent as its chip sends it, and Enter is the empty line", () => {
    const menu = commandMenu(running);
    expect(action(menu, "Undo")).toEqual({ kind: "submit", text: "Undo" });
    expect(action(menu, "Close")).toEqual({ kind: "submit", text: "Close" });
    expect(action(menu, "Enter")).toEqual({ kind: "submit", text: "" });
    expect(action(menu, "Cancel")).toEqual({ kind: "cancel" });
  });

  test("Pan and Zoom are typed transparently, so the command resumes", () => {
    const menu = commandMenu(running);
    expect(action(menu, "Pan")).toEqual({ kind: "submit", text: "'PAN" });
    expect(action(menu, "Zoom")).toEqual({ kind: "submit", text: "'ZOOM" });
    expect(menu.items.find((i) => i.label === "Pan")?.name).toBeUndefined();
  });

  test("a prompt with no keywords has no empty group, and one Enter means nothing to turns Enter off", () => {
    const menu = commandMenu(context({ running: "pan", accept: { point: true, number: false, text: false, select: false, enter: false } }));
    expect(rows(menu.items)).toEqual(["Enter (off)", "Cancel", "| Pan", "Zoom"]);
  });

  test("a registry without pan and zoom still has Enter, Cancel and the keywords", () => {
    const menu = commandMenu({ ...running, registry: without("pan", "zoom") });
    expect(rows(menu.items)).toEqual(["Enter", "Cancel", "| Close", "Undo"]);
  });

  test("a keyword that reads like another row keeps its own action", () => {
    const menu = commandMenu(context({ running: "zoom", keywords: ["Enter", "Cancel"] }));
    expect(menu.items.map((i) => i.id)).toEqual(["enter", "cancel", "keyword:Enter", "keyword:Cancel", "transparent:pan", "transparent:zoom"]);
    expect(menu.actions.get("keyword:Cancel")).toEqual({ kind: "submit", text: "Cancel" });
  });
});

describe("the drawing's menu", () => {
  test("is the running command's, else the selection's, else the one at rest", () => {
    expect(drawingMenu(context({ running: "line", selected: 2 })).items[0]?.label).toBe("Enter");
    expect(drawingMenu(context({ selected: 2 })).label).toBe("2 selected objects");
    expect(drawingMenu(context()).label).toBe("Drawing");
  });
});

const layer = (extra: Partial<LayerInfo> = {}): LayerInfo => ({ name: "Walls", on: true, frozen: false, locked: false, plot: true, used: true, current: false, colorName: "7", colorRgb: [255, 255, 255], linetype: "Continuous", lineweight: "Default", description: "", ...extra });

describe("a layer row's menu", () => {
  test("holds the layer's state, its objects, and its name", () => {
    const menu = layerMenu(REGISTRY, layer());
    expect(menu.label).toBe("Layer Walls");
    expect(rows(menu.items)).toEqual(["Make Current", "| Turn Off", "Freeze", "Lock", "| Select Objects", "Isolate", "| Rename...", "Delete (off)"]);
  });

  test("the state rows say what a press does now, and set the flag to the other value", () => {
    const menu = layerMenu(REGISTRY, layer({ on: false, frozen: true, locked: true }));
    expect(rows(menu.items).slice(1, 4)).toEqual(["| Turn On", "Thaw", "Unlock"]);
    expect(action(menu, "Turn On")).toEqual({ kind: "execute", id: "layer.set", params: { name: "Walls", on: true } });
    expect(action(menu, "Thaw")).toEqual({ kind: "execute", id: "layer.set", params: { name: "Walls", frozen: false } });
    expect(action(menu, "Unlock")).toEqual({ kind: "execute", id: "layer.set", params: { name: "Walls", locked: false } });
    expect(action(layerMenu(REGISTRY, layer()), "Make Current")).toEqual({ kind: "execute", id: "layer.current", params: { name: "Walls" } });
  });

  test("the current layer is not made current again and is not frozen or deleted", () => {
    expect(rows(layerMenu(REGISTRY, layer({ current: true, used: false })).items)).toEqual(["Make Current (off)", "| Turn Off", "Freeze (off)", "Lock", "| Select Objects (off)", "Isolate (off)", "| Rename...", "Delete (off)"]);
  });

  test("a layer with no objects can be deleted, and has none to select or isolate", () => {
    const menu = layerMenu(REGISTRY, layer({ used: false }));
    expect(rows(menu.items).slice(4)).toEqual(["| Select Objects (off)", "Isolate (off)", "| Rename...", "Delete"]);
    expect(action(menu, "Delete")).toEqual({ kind: "execute", id: "layer.delete", params: { name: "Walls" } });
  });

  test("layer 0 and Defpoints are neither renamed nor deleted", () => {
    expect(rows(layerMenu(REGISTRY, layer({ name: "0", used: false })).items).slice(6)).toEqual(["| Rename... (off)", "Delete (off)"]);
    expect(rows(layerMenu(REGISTRY, layer({ name: "Defpoints", used: false })).items).slice(6)).toEqual(["| Rename... (off)", "Delete (off)"]);
  });

  test("the objects are selected by the layer's name, isolated through LAYISO, and Rename leaves its prompt on the command line", () => {
    const menu = layerMenu(REGISTRY, layer({ name: "A-WALL PHASE 1" }));
    expect(action(menu, "Select Objects")).toEqual({ kind: "execute", id: "qselect", params: { layer: "A-WALL PHASE 1" } });
    expect(action(menu, "Isolate")).toEqual({ kind: "isolate", layer: "A-WALL PHASE 1" });
    expect(action(menu, "Rename...")).toEqual({ kind: "type", lines: ["-RENAME", "LAyer", "A-WALL PHASE 1"] });
  });

  test("a registry that only reads and sets layers gives the state rows alone", () => {
    const registry = REGISTRY.filter((c) => c.id === "layer.set" || c.id === "layer.current");
    expect(rows(layerMenu(registry, layer()).items)).toEqual(["Make Current", "| Turn Off", "Freeze", "Lock"]);
  });

  test("Isolate needs both the command that finds the objects and the one that isolates", () => {
    expect(rows(layerMenu(without("qselect"), layer()).items)).toEqual(["Make Current", "| Turn Off", "Freeze", "Lock", "| Rename...", "Delete (off)"]);
    expect(rows(layerMenu(without("layiso"), layer()).items)).toContain("| Select Objects");
    expect(rows(layerMenu(without("layiso"), layer()).items)).not.toContain("Isolate");
  });
});

describe("a layout tab's menu", () => {
  test("a layout is made, renamed, deleted and set up", () => {
    const menu = layoutMenu(REGISTRY, "Layout1");
    expect(menu.label).toBe("Layout Layout1");
    expect(rows(menu.items)).toEqual(["New Layout", "| Rename...", "Delete", "| Page Setup Manager..."]);
    expect(action(menu, "New Layout")).toEqual({ kind: "invoke", id: "layout.new" });
    expect(action(menu, "Rename...")).toEqual({ kind: "type", lines: ["-LAYOUT", "Rename", "Layout1"] });
    expect(action(menu, "Delete")).toEqual({ kind: "execute", id: "layout.delete", params: { name: "Layout1" } });
    expect(action(menu, "Page Setup Manager...")).toEqual({ kind: "invoke", id: "pagesetup", layout: "Layout1" });
  });

  test("model space is not a layout: it is neither renamed nor deleted", () => {
    const menu = layoutMenu(REGISTRY, "Model");
    expect(menu.label).toBe("Model space");
    expect(rows(menu.items)).toEqual(["New Layout", "| Rename... (off)", "Delete (off)", "| Page Setup Manager..."]);
  });

  test("a registry with no layout commands gives a menu with no row", () => {
    expect(layoutMenu(without("layout", "layout.new", "layout.delete", "pagesetup"), "Layout1").items).toEqual([]);
    expect(rows(layoutMenu(without("layout", "pagesetup"), "Layout1").items)).toEqual(["New Layout", "| Delete"]);
  });
});
