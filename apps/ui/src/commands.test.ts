/**
 * The chrome's menu logic: the tree rules (top-level order, nesting, dedup, the leaf rule),
 * `classify` for every action class, the `UI_ITEMS` subset, the shortcut labels, the menus'
 * groups and typed names, and the file-name helper.
 *
 * `UI_ITEMS` was transcribed by hand from `crates/ui-egui/src/menus.rs`'s `UI_COMMANDS` (the ids,
 * labels, menu paths and shortcuts there); this test pins the subset's shape and uniqueness.
 * The menus' groups (`MENU_GROUPS`) name the engine's own commands, so that table is checked
 * against the registry as the engine's sources write it (`crates/engine/src/cmd`).
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandInfo } from "./facade";
import { chordCommand, pressShortcut, buildMenu, classify, groupRows, isMacPlatform, MENU_GROUPS, MENU_TITLES, shortcutLabel, typedName, UI_ITEMS, type MenuNode } from "./commands";
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
    expect(classify("dsettings")).toBe("drafting");
    expect(classify("layer")).toBe("layers");
    expect(classify("ring")).toBe("jewelry");
    expect(classify("gem")).toBe("jewelry");
    expect(classify("pave")).toBe("engine");
    expect(classify("ui.saveas")).toBe("save");
    expect(classify("ui.sample")).toBe("sample");
    expect(classify("ui.sample.bracket")).toBe("sample");
    expect(classify("ui.assistant.ask")).toBe("ask");
    expect(classify("ui.panel.bench")).toBe("visibility");
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
    expect(classify("ui.dialog.commands")).toBe("palette");
    expect(classify("ui.focus.cmdline")).toBe("focus");
    expect(classify("ui.focus.next")).toBe("focus");
    expect(classify("ui.focus.previous")).toBe("focus");
    expect(classify("circle")).toBe("engine");
    expect(classify("zoom.extents")).toBe("engine");
    expect(classify("ui.dialog.about")).toBe("engine");
  });

  test("the command palette is a command of its own, in the Help menu", () => {
    const palette = UI_ITEMS.find((item) => item.id === "ui.dialog.commands");
    expect(palette?.menu[0]).toBe("Help");
    expect(palette?.shortcut).toBe("Cmd+Shift+P");
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
        "ui.dialog.commands",
        "ui.toggle.sidebar",
        "ui.open",
        "ui.saveas",
        "ui.sample",
        "ui.sample.bracket",
        "ui.assistant.ask",
        "ui.panel.bench",
        "ui.panel.layers",
        "ui.panel.properties",
        "ui.toggle.assistant",
        "ui.toggle.cmdline",
        "ui.toggle.statusbar",
        "ui.toggle.toolbar",
        "ui.toggle.menubar",
        "ui.focus.cmdline",
        "ui.focus.next",
        "ui.focus.previous",
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

  test("the shell's focus keys sit in the Window menu with the keys the shell answers", () => {
    const byId = new Map(UI_ITEMS.map((item) => [item.id, item]));
    expect(byId.get("ui.focus.cmdline")?.shortcut).toBe("Cmd+J");
    expect(byId.get("ui.focus.next")?.shortcut).toBe("F6");
    expect(byId.get("ui.focus.previous")?.shortcut).toBe("Shift+F6");
    const rows = menu("Window", [])?.children ?? [];
    for (const id of ["ui.focus.cmdline", "ui.focus.next", "ui.focus.previous"]) {
      expect(byId.get(id)?.menu[0]).toBe("Window");
      expect(rows.find((n) => n.id === id)?.label).toBe(byId.get(id)?.label);
    }
    expect(rows.find((n) => n.id === "ui.focus.previous")?.shortcut).toBe("Shift+F6");
    expect(shortcutLabel("Shift+F6", false)).toBe("Shift+F6");
    expect(shortcutLabel("Shift+F6", true)).toBe("⇧F6");
    expect(shortcutLabel("Cmd+J", false)).toBe("Ctrl+J");
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

/**
 * The engine's registry as its sources write it: every `CommandSpec::new("id", "Label", ..)` under
 * `crates/engine/src/cmd`, with the path of the `.menu(&[..])` that follows it. The built wasm is
 * not in the checkout, the sources always are.
 */
function engineRegistry(): CommandInfo[] {
  const root = join(import.meta.dir, "..", "..", "..", "crates", "engine", "src", "cmd");
  const text = (dir: string): string =>
    readdirSync(dir, { withFileTypes: true })
      .map((entry) => (entry.isDirectory() ? text(join(dir, entry.name)) : entry.name.endsWith(".rs") ? readFileSync(join(dir, entry.name), "utf8") : ""))
      .join("\n");
  const specs = text(root).split("CommandSpec::new(").slice(1);
  const out: CommandInfo[] = [];
  for (const spec of specs) {
    const head = /^\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/.exec(spec);
    if (head === null) continue;
    const path = /\.menu\(&\[([^\]]*)\]\)/.exec(spec)?.[1] ?? "";
    const segments = Array.from(path.matchAll(/"((?:[^"\\]|\\.)*)"/g), (match) => match[1] ?? "");
    out.push(cmd(head[1] ?? "", head[2] ?? "", segments));
  }
  return out;
}

describe("the menus' groups", () => {
  const row = (label: string, id: string | null, children: MenuNode[] = []): MenuNode => ({ label, id, shortcut: "", enabled: true, children, name: "", group: false });

  test("rows stand in the groups' order, the first of each marked; a key may name a submenu by a command in it", () => {
    const rows = [row("Text", null, [row("Single Line", "text"), row("Multiline", "mtext")]), row("Line", "line"), row("Arc", null, [row("3 Points", "arc")]), row("Ray", "ray")];
    const out = groupRows(rows, [["line", "ray"], ["arc"], ["mtext"]]);
    expect(out.map((r) => [r.label, r.group])).toEqual([
      ["Line", true],
      ["Ray", false],
      ["Arc", true],
      ["Text", true],
    ]);
  });

  test("rows no key names follow as one more group, in the order they came; a key with no row is passed over", () => {
    const out = groupRows([row("Gem", "gem"), row("Line", "line"), row("Ring", "ring")], [["gone", "line"]]);
    expect(out.map((r) => [r.label, r.group])).toEqual([
      ["Line", true],
      ["Gem", true],
      ["Ring", false],
    ]);
    // Two keys of one submenu place it once.
    const text = row("Text", null, [row("Single Line", "text"), row("Multiline", "mtext")]);
    expect(groupRows([text], [["text"], ["mtext"]]).map((r) => r.label)).toEqual(["Text"]);
  });

  test("a menu without groups keeps its registered order, and no row leads a group", () => {
    const help = menu("Help", [], UI_ITEMS);
    expect(help?.children.map((n) => n.label)).toEqual(["Open Sample Drawing", "Open Sample Bracket", "Command Palette..."]);
    expect(help?.children.some((n) => n.group)).toBe(false);
  });

  test("the engine's sources are read: the registry holds the commands the table is checked against", () => {
    const ids = engineRegistry().map((c) => c.id);
    expect(ids.length).toBeGreaterThan(400);
    for (const id of ["line", "circle", "hatch", "u", "qsave", "dimlinear"]) expect(ids).toContain(id);
  });

  test("every key of MENU_GROUPS names a row of its menu in the engine's registry, and no row twice", () => {
    const tree = buildMenu(engineRegistry(), UI_ITEMS);
    const holds = (node: MenuNode, id: string): boolean => node.id === id || node.children.some((child) => holds(child, id));
    const problems: string[] = [];
    for (const [title, groups] of Object.entries(MENU_GROUPS)) {
      const rows = tree.find((n) => n.label === title)?.children;
      if (rows === undefined) {
        problems.push(`${title}: not a menu`);
        continue;
      }
      const named = new Set<MenuNode>();
      for (const key of groups.flat()) {
        const found = rows.find((candidate) => holds(candidate, key));
        if (found === undefined) problems.push(`${title}: no row for "${key}" (was the command renamed or moved?)`);
        else if (named.has(found)) problems.push(`${title}: "${key}" names the row "${found.label}" a second time`);
        else named.add(found);
      }
    }
    expect(problems).toEqual([]);
  });

  test("in the engine's registry, the Draw menu reads lines, curves, points, hatches, blocks and text, jewellery", () => {
    const draw = buildMenu(engineRegistry(), UI_ITEMS).find((n) => n.label === "Draw");
    const groups: string[][] = [];
    for (const node of draw?.children ?? []) {
      if (node.group) groups.push([]);
      groups.at(-1)?.push(node.label);
    }
    expect(groups[0]).toEqual(["Line", "Construction Line", "Ray", "Multiline", "Polyline", "3D Polyline", "Rectangle", "Polygon"]);
    expect(groups[1]).toEqual(["Arc", "Circle", "Donut", "Ellipse", "Spline", "Helix", "Revision Cloud"]);
    expect(groups.map((g) => g.length)).toEqual([8, 7, 3, 5, 3, 4]);
  });
});

describe("typedName", () => {
  test("the shortest of the id and the aliases, in capitals; the id on a tie", () => {
    expect(typedName({ id: "pline", aliases: ["pl"] }, "Polyline")).toBe("PL");
    expect(typedName({ id: "rectang", aliases: ["rec", "rectangle"] }, "Rectangle")).toBe("REC");
    expect(typedName({ id: "qsave", aliases: ["save"] }, "Save")).toBe("");
    expect(typedName({ id: "plot", aliases: ["print"] }, "Print...")).toBe("PLOT");
    expect(typedName({ id: "arc.sce", aliases: [] }, "Start, Center, End")).toBe("ARC.SCE");
    expect(typedName({ id: "-attedit", aliases: ["-ate", "atte"] }, "Global")).toBe("-ATE");
  });

  test("empty where it would only repeat the label, whatever the case and with the dialog's dots", () => {
    expect(typedName({ id: "erase", aliases: ["delete"] }, "Erase")).toBe("");
    expect(typedName({ id: "find", aliases: [] }, "Find...")).toBe("");
    expect(typedName({ id: "erase", aliases: ["e", "delete"] }, "Erase")).toBe("E");
  });

  test("an engine command's row carries it; a submenu and a shell item carry none", () => {
    const line = { ...cmd("line", "Line", ["Draw", "Line"]), aliases: ["l"] };
    const tree = buildMenu([line, CIRCLE], UI_ITEMS);
    const draw = tree.find((n) => n.label === "Draw");
    expect(draw?.children.map((n) => [n.label, n.name])).toEqual([
      ["Line", "L"],
      ["Circle", ""],
    ]);
    expect(draw?.children[1]?.children[0]?.name).toBe("CIRCLE");
    const windowMenu = tree.find((n) => n.label === "Window");
    expect(windowMenu?.children.every((n) => n.name === "")).toBe(true);
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

describe("command chords", () => {
  const press = (key: string, more: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...more,
  });

  test("a press with Ctrl or Cmd reads in the registry's form", () => {
    expect(pressShortcut(press("n", { ctrlKey: true }))).toBe("Cmd+N");
    expect(pressShortcut(press("z", { metaKey: true, shiftKey: true }))).toBe("Cmd+Shift+Z");
    expect(pressShortcut(press("Z", { ctrlKey: true, shiftKey: true }))).toBe("Cmd+Shift+Z");
  });

  test("a plain key, an Alt chord, a named key and Space are not command chords", () => {
    expect(pressShortcut(press("n"))).toBeNull();
    expect(pressShortcut(press("n", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(pressShortcut(press("Enter", { ctrlKey: true }))).toBeNull();
    expect(pressShortcut(press(" ", { ctrlKey: true }))).toBeNull();
  });

  const commands = [
    { id: "new", shortcut: "Cmd+N", enabled: true },
    { id: "u", shortcut: "Cmd+Z", enabled: true },
    { id: "pasteclip", shortcut: "Cmd+V", enabled: false },
  ];

  test("a chord runs the enabled command that carries it, and a shell item before an engine one", () => {
    expect(chordCommand("Cmd+N", commands, [], false)).toBe("new");
    expect(chordCommand("cmd+n", commands, [], false)).toBe("new");
    expect(chordCommand("Cmd+V", commands, [], false)).toBeNull();
    expect(chordCommand("Cmd+Q", commands, [], false)).toBeNull();
    expect(chordCommand("Cmd+N", commands, [{ id: "ui.new", label: "New", menu: [], shortcut: "Cmd+N" }], false)).toBe("ui.new");
  });

  test("a text field keeps its own undo, select all and clipboard chords", () => {
    expect(chordCommand("Cmd+Z", commands, [], true)).toBeNull();
    expect(chordCommand("Cmd+N", commands, [], true)).toBe("new");
  });
});
