/**
 * The icon set: every toolbar entry has its own original path, the paths are well-formed SVG
 * path data, and there are no stubs (two ids sharing a drawing) and no orphans (a path no
 * toolbar entry uses).
 *
 * The toolbar table is read from `ToolStrip.tsx` — the same const the component renders — so a
 * new button cannot land without an icon.
 */

import { describe, expect, test } from "bun:test";
import { COMPOSER_ICONS, ICON_PATHS, iconPath } from "./icons";
import { TOOLBAR } from "./components/ToolStrip";

/** SVG path data: command letters, digits and the separators between numbers. */
const PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9 .,+-]+$/;

const entries = TOOLBAR.flat();

describe("the toolbar table", () => {
  test("has the desktop's eight groups, each non-empty", () => {
    expect(TOOLBAR.length).toBe(8);
    for (const group of TOOLBAR) expect(group.length).toBeGreaterThan(0);
    expect(TOOLBAR[0]?.map((e) => e.id)).toEqual(["new", "open", "qsave", "saveas"]);
    expect(TOOLBAR[1]?.map((e) => e.id)).toEqual(["u", "redo"]);
    expect(TOOLBAR.at(-1)?.map((e) => e.id)).toEqual(["ui.dialog.about"]);
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
  test("every toolbar icon id has a path, and the only extra paths are the composer's", () => {
    const iconIds = entries.map((entry) => entry.icon);
    for (const id of iconIds) expect(iconPath(id)).not.toBeNull();
    // The composer's own two glyphs are the only paths no toolbar entry draws.
    expect([...Object.keys(ICON_PATHS)].sort()).toEqual([...new Set([...iconIds, ...COMPOSER_ICONS])].sort());
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
    expect(iconPath("ui.dialog.about")).toBe(ICON_PATHS["ui.dialog.about"] ?? null);
    expect(iconPath("nope")).toBeNull();
    expect(iconPath("")).toBeNull();
    // An inherited name is not a path.
    expect(iconPath("toString")).toBeNull();
    expect(iconPath("constructor")).toBeNull();
  });
});
