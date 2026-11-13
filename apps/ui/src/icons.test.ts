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
import { TOOLBAR, toolEnabled, toolHint, toolNote } from "./components/ToolStrip";
import { UI_ITEMS } from "./commands";
import type { CommandInfo } from "./facade";
import { RIBBON, RIBBON_TOOLS } from "./ribbon";

/** SVG path data: command letters, digits and the separators between numbers. */
const PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9 .,+-]+$/;

const entries = TOOLBAR.flat();

describe("the toolbar table", () => {
  test("is every tool of the ribbon once, and the ribbon's tabs hold these tools in these groups", () => {
    expect(entries).toEqual([...RIBBON_TOOLS]);
    expect(RIBBON.map((tab) => [tab.label, ...tab.groups.map((group) => `${group.name}: ${group.tools.map((e) => e.id).join(" ")}`)])).toEqual([
      ["Home", "File: new open qsave plot", "History: u redo", "Draw: line pline circle arc rectang", "Modify: move copy rotate trim erase", "Zoom: zoom.extents zoom.window pan"],
      ["Jewelry", "Build: ring gem setting pave", "Check: ringsizes gemfit", "Bench: techsheet ui.panel.bench"],
      ["Draw", "Lines: line pline rectang polygon", "Curves: circle arc ellipse spline", "Fill: hatch"],
      ["Modify", "Place: move copy rotate mirror scale", "Shape: offset trim extend fillet chamfer", "Remove: erase"],
      ["Annotate", "Notes: mtext mleader table", "Dimension: dimlinear dimaligned dimradius dimangular", "Measure: dist", "Fill: hatch"],
      ["View", "Zoom: zoom.extents zoom.window pan", "Drawing: layer dist", "Panels: ui.panel.properties ui.panel.bench"],
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
    expect(toolEnabled("ui.panel.properties", commands)).toBe(true);
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

  test("a labelled tool's hint is what its label leaves out: the note, or the label beside its shortcut's key cap", () => {
    const find = (id: string) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (entry === undefined) throw new Error(`the ribbon lost ${id}`);
      return entry;
    };
    expect(toolHint(find("line"), true)).toBe("Type L");
    expect(toolHint(find("u"), true)).toBe("Undo");
    expect(toolHint(find("u"), false)).toBe("Not available now");
    expect(toolHint(find("ring"), true)).toBeUndefined();
  });

  test("every command id is non-empty and unique, and every label is set and names one tool", () => {
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(entries.map((entry) => entry.label)).size).toBe(entries.length);
    expect(new Set(entries.map((entry) => entry.icon)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  test("a tab holds a tool once, and names each of its groups once", () => {
    for (const tab of RIBBON) {
      const ids = tab.groups.flatMap((group) => group.tools.map((entry) => entry.id));
      expect(new Set(ids).size, `${tab.label} repeats a tool`).toBe(ids.length);
      const names = tab.groups.map((group) => group.name);
      expect(new Set(names).size, `${tab.label} repeats a group`).toBe(names.length);
      for (const group of tab.groups) expect(group.tools.length, `${tab.label}'s ${group.name} is empty`).toBeGreaterThan(0);
    }
  });

  test("the word under a glyph is one or two words, and a shortened one is a word of the tool's own label", () => {
    for (const entry of entries) {
      const caption = entry.short ?? entry.label;
      expect(caption.split(" ").length, `${entry.label} is a long caption`).toBeLessThanOrEqual(2);
      if (entry.short === undefined) continue;
      // The name a screen reader hears and speech input says holds the word that is drawn.
      expect(entry.short.split(" ").length).toBe(1);
      expect(entry.label.toLowerCase()).toContain(entry.short.toLowerCase());
      expect(entry.short.length).toBeLessThan(entry.label.length);
    }
  });

  test("Save invokes qsave while drawing the save icon, as chrome.rs does", () => {
    const save = entries.find((entry) => entry.label === "Save");
    expect(save?.id).toBe("qsave");
    expect(save?.icon).toBe("save");
    expect(save?.shortcut).toBe("Cmd+S");
  });
});

/** One straight piece of a glyph. */
interface Stroke {
  from: readonly [number, number];
  to: readonly [number, number];
}

/** What a glyph's path draws: points along every stroke (an arc is walked, so its bulge counts),
 *  its straight pieces, and how many separate strokes it is made of. */
interface Drawing {
  points: [number, number][];
  strokes: Stroke[];
  subpaths: number;
}

/** Walks path data made of moves, lines, circular arcs and closes, the only commands a strip glyph uses. */
function drawing(d: string): Drawing {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const out: Drawing = { points: [], strokes: [], subpaths: 0 };
  let at = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = "";
  const number = (): number => {
    const value = Number(tokens[at++]);
    if (!Number.isFinite(value)) throw new Error(`a number is missing in ${d}`);
    return value;
  };
  const lineTo = (nx: number, ny: number): void => {
    out.strokes.push({ from: [x, y], to: [nx, ny] });
    out.points.push([nx, ny]);
    x = nx;
    y = ny;
  };
  while (at < tokens.length) {
    const token = tokens[at] ?? "";
    if (/[A-Za-z]/.test(token)) {
      command = token;
      at++;
      if (command === "Z" || command === "z") {
        lineTo(startX, startY);
        continue;
      }
    }
    const relative = command === command.toLowerCase();
    const baseX = relative ? x : 0;
    const baseY = relative ? y : 0;
    switch (command.toUpperCase()) {
      case "M":
        x = baseX + number();
        y = baseY + number();
        startX = x;
        startY = y;
        out.points.push([x, y]);
        out.subpaths++;
        command = relative ? "l" : "L";
        break;
      case "L":
        lineTo(baseX + number(), baseY + number());
        break;
      case "H":
        lineTo(baseX + number(), y);
        break;
      case "V":
        lineTo(x, baseY + number());
        break;
      case "A": {
        const rx = number();
        const ry = number();
        number();
        const large = number();
        const sweep = number();
        const endX = baseX + number();
        const endY = baseY + number();
        if (rx !== ry) throw new Error(`an arc that is not circular in ${d}`);
        // The centre from the chord, then points along the sweep.
        const halfX = (endX - x) / 2;
        const halfY = (endY - y) / 2;
        const half = Math.hypot(halfX, halfY);
        const radius = Math.max(rx, half);
        const rise = Math.sqrt(Math.max(0, radius * radius - half * half));
        const side = large === sweep ? -1 : 1;
        const centreX = x + halfX + (side * rise * -halfY) / (half || 1);
        const centreY = y + halfY + (side * rise * halfX) / (half || 1);
        const first = Math.atan2(y - centreY, x - centreX);
        let last = Math.atan2(endY - centreY, endX - centreX);
        if (sweep === 1 && last < first) last += 2 * Math.PI;
        if (sweep === 0 && last > first) last -= 2 * Math.PI;
        for (let step = 1; step <= 24; step++) {
          const angle = first + ((last - first) * step) / 24;
          out.points.push([centreX + radius * Math.cos(angle), centreY + radius * Math.sin(angle)]);
        }
        x = endX;
        y = endY;
        break;
      }
      default:
        throw new Error(`a strip glyph uses ${command}, which the family does not draw with: ${d}`);
    }
  }
  return out;
}

describe("the strip's glyphs are one family", () => {
  const glyphs = entries.map((entry) => ({ icon: entry.icon, ...drawing(ICON_PATHS[entry.icon] ?? "") }));
  /** One pixel of the strip's 16px glyph, on the 24 grid. */
  const PIXEL = 24 / 16;

  test("every glyph stays inside the box's margin and fills it to the same measure", () => {
    for (const glyph of glyphs) {
      const xs = glyph.points.map((point) => point[0]);
      const ys = glyph.points.map((point) => point[1]);
      // The margin: no stroke's middle nearer than 2 to the box's edge.
      expect(Math.min(...xs, ...ys), `${glyph.icon} leaves the box`).toBeGreaterThanOrEqual(2);
      expect(Math.max(...xs, ...ys), `${glyph.icon} leaves the box`).toBeLessThanOrEqual(22);
      // The measure: the longer side is 16 to 19 of the 24, so no key looks a size smaller than the next.
      const longer = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      expect(longer, `${glyph.icon} is small for the strip`).toBeGreaterThanOrEqual(16);
      expect(longer, `${glyph.icon} is large for the strip`).toBeLessThanOrEqual(19);
    }
  });

  test("a glyph is at most six strokes, so its idea survives at sixteen pixels", () => {
    for (const glyph of glyphs) expect(glyph.subpaths, `${glyph.icon} is drawn with too many strokes`).toBeLessThanOrEqual(6);
  });

  test("no long horizontal or vertical stroke lies between two pixels at the strip's size", () => {
    // A stroke on a multiple of 1.5 is half on each of two pixels at 16: a soft pair, not a line.
    const between = (value: number): boolean => Math.abs(value / PIXEL - Math.round(value / PIXEL)) * PIXEL < 0.3;
    const soft = glyphs
      .filter((glyph) =>
        glyph.strokes.some((stroke) => {
          const length = Math.hypot(stroke.to[0] - stroke.from[0], stroke.to[1] - stroke.from[1]);
          if (length < 2 * PIXEL) return false;
          if (stroke.from[0] === stroke.to[0]) return between(stroke.from[0]);
          return stroke.from[1] === stroke.to[1] && between(stroke.from[1]);
        }),
      )
      .map((glyph) => glyph.icon);
    // The two whose stem is the box's own centre line, which an even size has no pixel for.
    expect(soft).toEqual(["pan", "text"]);
  });

  test("the pairs a drafter must tell apart at a glance differ in how they are built", () => {
    const strokesOf = (icon: string): number => glyphs.find((glyph) => glyph.icon === icon)?.subpaths ?? 0;
    const has = (icon: string, piece: string): boolean => (ICON_PATHS[icon] ?? "").includes(piece);
    // The offset is a pair of curves with nothing else; the fillet one curve and the corner's dot.
    expect(strokesOf("offset")).toBe(2);
    expect(has("offset", "h0")).toBe(false);
    expect(has("fillet", "h0")).toBe(true);
    // The copy carries a plus and no circle; the window zoom a magnifier's lens.
    expect(has("copy-objects", "a")).toBe(false);
    expect(has("zoom.window", "a4.5 4.5 0 1 0 0 9")).toBe(true);
    // The line is one straight piece between its grips; the polyline bends twice between the same grips.
    expect(drawing(ICON_PATHS["line"] ?? "").strokes.length).toBe(1);
    expect(drawing(ICON_PATHS["polyline"] ?? "").strokes.length).toBe(3);
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
