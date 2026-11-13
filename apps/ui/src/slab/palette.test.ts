import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rankCommands, type PaletteItem } from "../palette";
import { paletteKey, paletteStatus } from "../palette-model";
import { followOffset, LIST_PAD, listHeight, listMax, MAX_KEY_CHARS, MAX_RUNS, mirrorWindow, pageRows, paletteRows, ROW_H, rowAt } from "./palette-params";

const item = (id: string, label: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({ id, label, path: "", shortcut: "", aliases: [], enabled: true, ...extra });
const ITEMS: PaletteItem[] = [item("line", "Line", { path: "Draw", shortcut: "L" }), item("pasteclip", "Paste", { path: "Edit", enabled: false, shortcut: "Ctrl+V" }), item("circle", "Circle", { path: "Draw > Circle" }), item("ui.open", "Open...")];
const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe("palette keys (shared by both views)", () => {
  test("the arrows wrap, the page keys stop at the ends", () => {
    expect(paletteKey(key("ArrowUp"), 0, 5, "", () => 3)).toEqual({ kind: "light", index: 4 });
    expect(paletteKey(key("ArrowDown"), 4, 5, "", () => 3)).toEqual({ kind: "light", index: 0 });
    expect(paletteKey(key("PageDown"), 3, 5, "", () => 3)).toEqual({ kind: "light", index: 4 });
    expect(paletteKey(key("PageUp"), 1, 5, "", () => 3)).toEqual({ kind: "light", index: 0 });
  });
  test("Home and End are the text's while there is text, the list's with Ctrl or an empty field", () => {
    expect(paletteKey(key("End"), 0, 5, "li", () => 3)).toBeNull();
    expect(paletteKey(key("End", { ctrlKey: true }), 0, 5, "li", () => 3)).toEqual({ kind: "light", index: 4 });
    expect(paletteKey(key("Home"), 3, 5, "", () => 3)).toEqual({ kind: "light", index: 0 });
    expect(paletteKey(key("Home", { shiftKey: true }), 3, 5, "", () => 3)).toBeNull();
  });
  test("Enter runs, Tab completes, Shift+Tab and letters are the field's", () => {
    expect(paletteKey(key("Enter"), 0, 5, "", () => 3)).toEqual({ kind: "run" });
    expect(paletteKey(key("Tab"), 0, 5, "", () => 3)).toEqual({ kind: "complete" });
    expect(paletteKey(key("Tab", { shiftKey: true }), 0, 5, "", () => 3)).toBeNull();
    expect(paletteKey(key("a"), 0, 5, "", () => 3)).toBeNull();
  });
  test("the status line", () => {
    expect(paletteStatus(4, ITEMS[0], false)).toBe("4 commands");
    expect(paletteStatus(1, ITEMS[0], true)).toBe("1 match");
    expect(paletteStatus(0, undefined, true)).toBe("No matches");
    expect(paletteStatus(3, ITEMS[1], true)).toBe("Paste is not available right now");
  });
});

describe("palette rows", () => {
  test("a row carries the label's runs, the path, the name, the shortcut and the tags", () => {
    const rows = paletteRows(rankCommands("lin", ITEMS, [], 10), 0, (s) => s);
    const line = rows[0];
    expect(line?.key).toBe("line");
    expect(line?.runs.map((r) => [r.t, r.hit])).toEqual([["Lin", true], ["e", false]]);
    expect(line?.path).toBe("Draw");
    expect(line?.keyed).toBe(true);
    expect(line?.shortcut).toBe("L");
    expect(line?.named).toBe(false);
  });
  test("an empty query tags the recently used and the rest; a disabled row says so", () => {
    const rows = paletteRows(rankCommands("", ITEMS, ["circle"], 10), 1, (s) => s);
    expect(rows[0]?.tag).toBe("recently used");
    expect(rows[1]?.tag).toBe("other commands");
    const paste = rows.find((r) => r.key === "pasteclip");
    expect(paste?.off).toBe(true);
    expect(paste?.tag2).toBe("not available");
    expect(paste?.runs.every((r) => r.off)).toBe(true);
  });
  test("hostile labels and ids are capped and kept unique", () => {
    const long = "x".repeat(MAX_KEY_CHARS + 50);
    const many = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? "a" : "b")).join("");
    const rows = paletteRows(
      [
        { item: item(long, "A\u0000B\nC"), score: 0, indices: [] },
        { item: item(long, "dup"), score: 0, indices: [] },
        { item: item("", many), score: 0, indices: Array.from({ length: 60 }, (_, i) => i).filter((i) => i % 2 === 0) },
      ],
      Number.NaN,
      (s) => s,
    );
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
    expect(rows.every((r) => r.key.length > 0 && r.key.length <= MAX_KEY_CHARS + 10)).toBe(true);
    expect(rows[0]?.runs.map((r) => r.t).join("")).not.toMatch(/[\u0000\n]/);
    expect(rows[2]?.runs.length).toBeLessThanOrEqual(MAX_RUNS);
  });
});

describe("the list's arithmetic", () => {
  test("the list's cap is whole rows, as palette.css works it out", () => {
    const max = listMax(800);
    expect((max - 2 * LIST_PAD) % ROW_H).toBe(0);
    expect(max).toBe(Math.floor((480 - 35 - 28 - 2 - 8) / ROW_H) * ROW_H + 8);
    expect(listMax(Number.NaN)).toBe(2 * LIST_PAD);
  });
  test("the height follows the rows up to the cap", () => {
    expect(listHeight(0, 400)).toBe(0);
    expect(listHeight(3, 400)).toBe(3 * ROW_H + 8);
    expect(listHeight(100, 400)).toBe(400);
  });
  test("a page is the rows in view less one", () => {
    expect(pageRows(404)).toBe(17);
    expect(pageRows(0)).toBe(10);
  });
  test("the lit row is followed with a row of context; the ends go to the ends", () => {
    expect(followOffset(100, 0, 60, 404)).toBe(0);
    expect(followOffset(0, 59, 60, 404)).toBe(60 * ROW_H + 8 - 404);
    expect(followOffset(0, 18, 60, 404)).toBe(4 + 18 * ROW_H + ROW_H + ROW_H + 4 - 404);
    expect(followOffset(200, 5, 60, 404)).toBe(4 + 5 * ROW_H - ROW_H - 4);
    expect(followOffset(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, -5)).toBe(0);
  });
  test("a point is placed on a row, not on the inset", () => {
    expect(rowAt(10, 4 + 11, 0, 600, 404, 60)).toBe(0);
    expect(rowAt(10, 4 + 22 * 3 + 1, 22, 600, 404, 60)).toBe(4);
    expect(rowAt(2, 20, 0, 600, 404, 60)).toBe(-1);
    expect(rowAt(10, 2, 0, 600, 404, 60)).toBe(-1);
    expect(rowAt(10, 400, 0, 600, 404, 3)).toBe(-1);
    expect(rowAt(Number.NaN, 20, 0, 600, 404, 60)).toBe(-1);
  });
  test("the listbox window holds the lit option and its neighbours", () => {
    expect(mirrorWindow(0, 100, 10)).toEqual({ from: 0, to: 21 });
    expect(mirrorWindow(50, 100, 10)).toEqual({ from: 40, to: 61 });
    expect(mirrorWindow(99, 100, 10)).toEqual({ from: 79, to: 100 });
    expect(mirrorWindow(3, 5, 10)).toEqual({ from: 0, to: 5 });
    expect(mirrorWindow(Number.NaN, 0, 10)).toEqual({ from: 0, to: 0 });
  });
});

describe("palette.slab", () => {
  const source = readFileSync(join(import.meta.dir, "../../slab/palette.slab"), "utf8");
  test("no binder that solves per step, nothing focusable, no signal", () => {
    const code = source.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/transition=|pointer-move=|act=|focusable|keys=/);
  });
  test("the list is virtual with the row's extent", () => {
    expect(source).toContain(`virtual item-extent=${ROW_H}`);
  });
  test("colours are tokens only", () => {
    expect(source.replace(/\/\/.*$/gm, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
