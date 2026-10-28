/**
 * The chrome's menu logic: the tree rules (top-level order, nesting, dedup, the leaf rule),
 * `classify` for every action class, the `UI_ITEMS` subset, the shortcut labels, the keyboard
 * walk order, and the file-name helper.
 *
 * `UI_ITEMS` was transcribed by hand from `crates/ui-egui/src/menus.rs`'s `UI_COMMANDS` (the ids,
 * labels, menu paths and shortcuts there); this test pins the subset's shape and uniqueness, it
 * does not read the Rust source (that would not be portable).
 */

import { describe, expect, test } from "bun:test";
import type { CommandInfo } from "./facade";
import { buildMenu, classify, isMacPlatform, menuEntries, MENU_TITLES, shortcutLabel, submenuIsOpen, UI_ITEMS } from "./commands";
import { defaultFileName } from "./files";

/** One engine command row, with its menu path joined the way `facade.ts` does. */
function cmd(id: string, label: string, path: readonly string[], options: { shortcut?: string; enabled?: boolean } = {}): CommandInfo {
  return {
    id,
    label,
    menu: path.join(" \u203a "),
    shortcut: options.shortcut ?? "",
    aliases: [],
    params: "",
    enabled: options.enabled ?? true,
  };
}

const INSERT_LAYOUT = cmd("layout.new", "New Layout", ["Insert", "Layout", "New Layout"]);
const CIRCLE = cmd("circle", "Circle", ["Draw", "Circle", "Center, Radius"]);
const CIRCLE_AGAIN = cmd("circle", "Circle Again", ["Draw", "Circle Again"]);
const UNDO = cmd("u", "Undo", ["Edit", "Undo"], { shortcut: "Cmd+Z" });
const NO_MENU = cmd("layer.set", "Set Layer Properties", []);

/** The children of the tree's node with this label (a top-level menu). */
function menu(title: string, commands: readonly CommandInfo[], items = UI_ITEMS) {
  const tree = buildMenu(commands, items);
  const node = tree.find((n) => n.label === title);
  expect(node).toBeDefined();
  return node;
}

describe("buildMenu", () => {
  test("the top level is MENU_TITLES in order, even with no commands at all", () => {
    expect(buildMenu([], []).map((n) => n.label)).toEqual([...MENU_TITLES]);
    expect(MENU_TITLES[0]).toBe("File");
    expect(MENU_TITLES.at(-1)).toBe("Help");
    expect(buildMenu([CIRCLE, UNDO], UI_ITEMS).map((n) => n.label)).toEqual([...MENU_TITLES]);
  });

  test("nests a path's segments: Insert › Layout › New Layout, the submenu carrying no id", () => {
    const insert = menu("Insert", [INSERT_LAYOUT]);
    expect(insert?.id).toBeNull();
    const layout = insert?.children.find((n) => n.label === "Layout");
    expect(layout?.id).toBeNull();
    expect(layout?.children.map((n) => [n.label, n.id])).toEqual([["New Layout", "layout.new"]]);
    // A submenu is created once, in first-seen order.
    const second = cmd("layout.copy", "Copy Layout", ["Insert", "Layout", "Copy Layout"]);
    const again = menu("Insert", [INSERT_LAYOUT, second]);
    expect(again?.children.filter((n) => n.label === "Layout").length).toBe(1);
    expect(again?.children[0]?.children.map((n) => n.label)).toEqual(["New Layout", "Copy Layout"]);
  });

  test("the last path segment is the item's label; an empty one falls back to the command's label", () => {
    const draw = menu("Draw", [CIRCLE]);
    const circle = draw?.children.find((n) => n.label === "Circle");
    expect(circle?.children.map((n) => [n.label, n.id])).toEqual([["Center, Radius", "circle"]]);
    const unnamed = cmd("circle", "Circle", ["Draw", ""]);
    expect(menu("Draw", [unnamed])?.children.map((n) => [n.label, n.id])).toEqual([["Circle", "circle"]]);
  });

  test("an id appearing twice keeps the first, wherever it came from", () => {
    const draw = menu("Draw", [CIRCLE, CIRCLE_AGAIN]);
    const circle = draw?.children.find((n) => n.label === "Circle");
    expect(circle?.children.map((n) => [n.label, n.id])).toEqual([["Center, Radius", "circle"]]);
    // The second row's own leaf (id `circle` again) never landed: the id was already placed.
    expect(draw?.children.map((n) => n.label)).toEqual(["Circle"]);
    // The engine's rows are added before the UI items, so an engine row wins a collision even
    // though the UI items are always enabled.
    const engineSample = cmd("ui.sample", "Open Sample Drawing", ["Help", "Open Sample Drawing"], { enabled: false });
    const sample = menu("Help", [engineSample])?.children.find((n) => n.id === "ui.sample");
    expect(sample?.enabled).toBe(false);
    expect(menu("Help", [engineSample])?.children.filter((n) => n.id === "ui.sample").length).toBe(1);
  });

  test("a command with an empty path is not in the tree", () => {
    const tree = buildMenu([NO_MENU], []);
    const all = tree.flatMap(function flatten(node): (string | null)[] {
      return [node.id, ...node.children.flatMap(flatten)];
    });
    expect(all).not.toContain("layer.set");
  });

  test("a command whose path is a single segment is not in the tree either", () => {
    const tree = buildMenu([cmd("x", "X", ["Draw"])], []);
    expect(tree.flatMap((n) => n.children).length).toBe(0);
  });

  test("an unknown top-level menu is dropped", () => {
    const tree = buildMenu([cmd("x", "X", ["Nope", "X"])], []);
    expect(tree.flatMap((n) => n.children).length).toBe(0);
  });

  test("engine items carry enabled and shortcut; UI items are always enabled", () => {
    const disabled = cmd("saveas", "Save As", ["File", "Save As"], { enabled: false });
    const file = menu("File", [disabled, UNDO]);
    const row = file?.children.find((n) => n.id === "saveas");
    expect(row?.enabled).toBe(false);
    const undo = menu("Edit", [UNDO])?.children.find((n) => n.id === "u");
    expect(undo?.enabled).toBe(true);
    expect(undo?.shortcut).toBe("Cmd+Z");
    const theme = menu("View", []);
    const dark = theme?.children.find((n) => n.label === "Interface Theme")?.children.find((n) => n.id === "ui.theme.dark");
    expect(dark?.enabled).toBe(true);
    expect(dark?.shortcut).toBe("");
  });

  test("the UI items' paths nest under the top-level menus, parents implicit", () => {
    const window = menu("Window", []);
    const ids = window?.children.map((n) => n.id ?? n.label);
    expect(ids).toContain("ui.panel.layers");
    expect(ids).toContain("ui.toggle.cmdline");
    const animations = menu("View", [])?.children.find((n) => n.label === "Accessibility")?.children.find((n) => n.label === "Animation Effects");
    expect(animations?.id).toBeNull();
    expect(animations?.children.map((n) => n.id)).toEqual(["ui.animations.system", "ui.animations.on", "ui.animations.off"]);
  });
});

describe("classify", () => {
  test("each action class", () => {
    expect(classify("ui.open")).toBe("open");
    expect(classify("ui.saveas")).toBe("save");
    expect(classify("ui.sample")).toBe("sample");
    expect(classify("ui.panel.layers")).toBe("visibility");
    expect(classify("ui.panel.properties")).toBe("visibility");
    expect(classify("ui.toggle.cmdline")).toBe("visibility");
    expect(classify("ui.toggle.statusbar")).toBe("visibility");
    expect(classify("ui.toggle.toolbar")).toBe("visibility");
    expect(classify("ui.toggle.menubar")).toBe("visibility");
    expect(classify("ui.theme.light")).toBe("theme");
    expect(classify("ui.theme.dark")).toBe("theme");
    expect(classify("ui.theme.system")).toBe("theme");
    expect(classify("ui.animations.on")).toBe("animations");
    expect(classify("ui.animations.off")).toBe("animations");
    expect(classify("ui.animations.system")).toBe("animations");
    expect(classify("ui.dialog.commands")).toBe("none");
    expect(classify("circle")).toBe("engine");
    expect(classify("zoom.extents")).toBe("engine");
    expect(classify("ui.dialog.about")).toBe("engine");
  });

  test("the 'none' command is not in the tree", () => {
    expect(UI_ITEMS.some((item) => item.id === "ui.dialog.commands")).toBe(false);
  });
});

describe("UI_ITEMS", () => {
  test("every id is a unique `ui.` id with a label and non-empty menu segments", () => {
    const ids = UI_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of UI_ITEMS) {
      expect(item.id.startsWith("ui.")).toBe(true);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.id).not.toContain("..");
      for (const segment of item.menu) expect(segment.trim().length).toBeGreaterThan(0);
    }
  });

  test("the subset is exactly the commands the shell honours, transcribed from menus.rs", () => {
    expect([...UI_ITEMS.map((item) => item.id)].sort()).toEqual(
      [
        "ui.open",
        "ui.saveas",
        "ui.sample",
        "ui.panel.layers",
        "ui.panel.properties",
        "ui.toggle.cmdline",
        "ui.toggle.statusbar",
        "ui.toggle.toolbar",
        "ui.toggle.menubar",
        "ui.theme.light",
        "ui.theme.dark",
        "ui.theme.system",
        "ui.animations.on",
        "ui.animations.off",
        "ui.animations.system",
      ].sort(),
    );
  });

  test("labels and menu paths are the desktop's", () => {
    const byId = new Map(UI_ITEMS.map((item) => [item.id, item]));
    expect(byId.get("ui.open")?.label).toBe("Open...");
    expect(byId.get("ui.open")?.shortcut).toBe("Cmd+O");
    expect(byId.get("ui.saveas")?.label).toBe("Save As...");
    expect(byId.get("ui.sample")?.menu).toEqual(["Help", "Open Sample Drawing"]);
    expect(byId.get("ui.panel.layers")?.menu).toEqual(["Window", "Layers Palette"]);
    expect(byId.get("ui.toggle.cmdline")?.shortcut).toBe("Cmd+9");
    expect(byId.get("ui.toggle.menubar")?.label).toBe("In-window Menu Bar");
    expect(byId.get("ui.theme.dark")?.menu).toEqual(["View", "Interface Theme", "Dark"]);
    expect(byId.get("ui.animations.off")?.menu).toEqual(["View", "Accessibility", "Animation Effects", "Off"]);
  });

  test("every UI item with a path lands in the built tree exactly once", () => {
    const tree = buildMenu([], UI_ITEMS);
    const ids = tree.flatMap(function flatten(node): string[] {
      return [...(node.id === null ? [] : [node.id]), ...node.children.flatMap(flatten)];
    });
    for (const item of UI_ITEMS) {
      if (item.menu.length === 0) continue;
      expect(ids.filter((id) => id === item.id).length).toBe(1);
    }
    // ui.open and ui.saveas have no menu placement of their own (the tool strip and shortcuts
    // reach them); they must not appear in the tree.
    expect(ids).not.toContain("ui.open");
    expect(ids).not.toContain("ui.saveas");
  });
});

describe("shortcutLabel", () => {
  test("macOS symbols and the Windows/Linux form", () => {
    expect(shortcutLabel("Cmd+Z", true)).toBe("\u2318Z");
    expect(shortcutLabel("Cmd+Shift+Z", true)).toBe("\u21e7\u2318Z");
    expect(shortcutLabel("Cmd+O", true)).toBe("\u2318O");
    expect(shortcutLabel("Cmd+Z", false)).toBe("Ctrl+Z");
    expect(shortcutLabel("Cmd+Shift+Z", false)).toBe("Ctrl+Shift+Z");
    expect(shortcutLabel("F7", false)).toBe("F7");
  });

  test("isMacPlatform answers a boolean in any environment", () => {
    expect(typeof isMacPlatform()).toBe("boolean");
  });
});

describe("menuEntries and submenuIsOpen", () => {
  const nodes = [
    { label: "Theme", id: null, shortcut: "", enabled: true, children: [
      { label: "Dark", id: "ui.theme.dark", shortcut: "", enabled: true, children: [] },
      { label: "Light", id: "ui.theme.light", shortcut: "", enabled: true, children: [] },
    ] },
    { label: "Status Bar", id: "ui.toggle.statusbar", shortcut: "", enabled: true, children: [] },
  ];

  test("with nothing open, only the visible rows", () => {
    expect(menuEntries(nodes, []).map((e) => e.node.label)).toEqual(["Theme", "Status Bar"]);
    expect(menuEntries(nodes, []).map((e) => e.depth)).toEqual([0, 0]);
  });

  test("an open submenu's children join the walk in place, one level down", () => {
    const entries = menuEntries(nodes, ["Theme"]);
    expect(entries.map((e) => e.node.label)).toEqual(["Theme", "Dark", "Light", "Status Bar"]);
    expect(entries.map((e) => e.depth)).toEqual([0, 1, 1, 0]);
    expect(entries[1]?.path).toEqual(["Theme"]);
  });

  test("submenuIsOpen reads the first name of the chain", () => {
    expect(submenuIsOpen(["Theme", "Sub"], "Theme")).toBe(true);
    expect(submenuIsOpen(["Theme"], "Status Bar")).toBe(false);
    expect(submenuIsOpen([], "Theme")).toBe(false);
  });
});

describe("defaultFileName", () => {
  test("keeps an existing extension and adds .dxf when there is none", () => {
    expect(defaultFileName("Bracket")).toBe("Bracket.dxf");
    expect(defaultFileName("Bracket.dwg")).toBe("Bracket.dwg");
    expect(defaultFileName("plan.DWG")).toBe("plan.DWG");
    expect(defaultFileName("plan.")).toBe("plan.dxf");
  });

  test("strips path-hostile characters and names an empty title", () => {
    expect(defaultFileName("a/b:c*d?e\"f<g>h|i")).toBe("a_b_c_d_e_f_g_h_i.dxf");
    expect(defaultFileName("  ")).toBe("Drawing.dxf");
    expect(defaultFileName("")).toBe("Drawing.dxf");
  });
});
