/**
 * The icon set and the strip that draws most of it: every toolbar entry has its own original path, the paths are well-formed SVG
 * path data, and there are no stubs (two ids sharing a drawing) and no orphans (a path no
 * toolbar entry uses).
 *
 * The toolbar table is read from `ToolStrip.tsx` — the same const the component renders — so a
 * new button cannot land without an icon.
 */

import { describe, expect, test } from "bun:test";
import { COMPOSER_ICONS, ICON_PATHS, iconPath, PANEL_ICONS, STROKE, ToolIcon } from "./icons";
import { TOOLBAR, toolEnabled, toolNote } from "./components/ToolStrip";
import { UI_ITEMS } from "./commands";
import type { CommandInfo } from "./facade";

/** SVG path data: command letters, digits and the separators between numbers. */
const PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9 .,+-]+$/;

const entries = TOOLBAR.flat();

describe("the toolbar table", () => {
  test("has eight groups, each non-empty, the drafting tools ahead of the ones the overflow may take", () => {
    expect(TOOLBAR.map((group) => group.map((e) => e.id))).toEqual([
      ["new", "open", "qsave"],
      ["u", "redo"],
      ["line", "pline", "circle", "arc", "rectang", "hatch", "mtext"],
      ["move", "copy", "rotate", "mirror", "offset", "trim", "fillet", "erase"],
      ["dimlinear"],
      ["zoom.extents", "zoom.window", "pan"],
      ["ui.panel.properties", "ui.panel.layers", "dist"],
      ["plot"],
    ]);
  });

  test("a shell id is one the shell honours, with that item's own shortcut", () => {
    for (const entry of entries.filter((e) => e.id.startsWith("ui."))) {
      const item = UI_ITEMS.find((ui) => ui.id === entry.id);
      expect(item, `${entry.id} is not a shell command`).toBeDefined();
      expect(entry.shortcut).toBe(item?.shortcut ?? "");
    }
  });

  test("an alias is the capitals typed at the command line, and no two tools share one", () => {
    const aliases = entries.map((entry) => entry.alias).filter((alias) => alias !== "");
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const alias of aliases) expect(alias).toMatch(/^[A-Z]{1,3}$/);
  });

  test("a tool is live unless the engine says its command is not available", () => {
    const command = (id: string, enabled: boolean): CommandInfo => ({ id, label: id, menu: "", shortcut: "", aliases: [], params: "", enabled });
    const commands = [command("u", false), command("line", true)];
    expect(toolEnabled("u", commands)).toBe(false);
    expect(toolEnabled("line", commands)).toBe(true);
    // The shell's own ids are not the engine's to refuse, and no list refuses nothing.
    expect(toolEnabled("ui.panel.layers", commands)).toBe(true);
    expect(toolEnabled("u", undefined)).toBe(true);
  });

  test("the hint's second line is the typed name, or why the tool is blocked", () => {
    const line = entries.find((entry) => entry.id === "line");
    const undo = entries.find((entry) => entry.id === "u");
    if (line === undefined || undo === undefined) throw new Error("the strip lost Line or Undo");
    expect(toolNote(line, true)).toBe("Type L");
    expect(toolNote(undo, true)).toBeUndefined();
    expect(toolNote(undo, false)).toBe("Not available now");
  });

  test("every command id is non-empty and unique, and every label is set", () => {
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of entries) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  test("Save invokes qsave while drawing the save icon, as chrome.rs does", () => {
    const save = entries.find((entry) => entry.label === "Save");
    expect(save?.id).toBe("qsave");
    expect(save?.icon).toBe("save");
    expect(save?.shortcut).toBe("Cmd+S");
  });
});

describe("ICON_PATHS", () => {
  test("every toolbar icon id has a path, and the only extra paths are the composer's and the palettes'", () => {
    const iconIds = entries.map((entry) => entry.icon);
    for (const id of iconIds) expect(iconPath(id)).not.toBeNull();
    // The composer's and the palettes' own glyphs are the only paths no toolbar entry draws.
    expect([...Object.keys(ICON_PATHS)].sort()).toEqual([...new Set([...iconIds, ...COMPOSER_ICONS, ...PANEL_ICONS])].sort());
  });

  test("every path is non-empty, well-formed SVG path data starting with a move", () => {
    for (const [id, path] of Object.entries(ICON_PATHS)) {
      expect(path.length).toBeGreaterThan(10);
      expect(PATH_RE.test(path), `path for ${id} is not plain path data: ${path}`).toBe(true);
      expect(/^[Mm]/.test(path), `path for ${id} must start with a move`).toBe(true);
      expect(/[LlHhVvCcSsQqTtAaZz]/.test(path), `path for ${id} has no drawing command`).toBe(true);
      expect(path.endsWith(" ")).toBe(false);
    }
  });

  test("no two ids share a drawing (catches copy-paste stubs)", () => {
    const seen = new Map<string, string>();
    for (const [id, path] of Object.entries(ICON_PATHS)) {
      const other = seen.get(path);
      expect(other, `${id} duplicates ${other ?? ""}`).toBeUndefined();
      seen.set(path, id);
    }
  });

  test("iconPath answers the map for a known id and null for anything else", () => {
    expect(iconPath("new")).toBe(ICON_PATHS["new"] ?? null);
    expect(iconPath("dimension-linear")).toBe(ICON_PATHS["dimension-linear"] ?? null);
    expect(iconPath("nope")).toBeNull();
    expect(iconPath("")).toBeNull();
    // An inherited name is not a path.
    expect(iconPath("toString")).toBeNull();
    expect(iconPath("constructor")).toBeNull();
  });

  test("a glyph is drawn with one stroke that does not thin with its size", () => {
    const svg = ToolIcon({ id: "line" });
    if (!(svg instanceof SVGElement)) throw new Error("ToolIcon did not draw an svg");
    expect(svg.getAttribute("stroke-width")).toBe(String(STROKE));
    const path = svg.querySelector("path");
    expect(path?.getAttribute("d")).toBe(ICON_PATHS["line"] ?? "");
    expect(path?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });
});
