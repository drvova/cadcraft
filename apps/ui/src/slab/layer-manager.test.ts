import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ICON_PATHS } from "../icons";
import { LAYER_COLOR_CHOICES, type GridCell, type LayerRow } from "../layer-manager";
import { COLUMNS, gridKeyAction, NAME_COLUMN, type GridAction, type GridKeyEvent, type Typed } from "../layer-manager-edit";
import { iconBlockOf } from "./ribbon-icons";
import {
  cellKey,
  cellOfKey,
  choicePatch,
  choicePopup,
  editCell,
  editPlace,
  editStyle,
  emptyText,
  findWidth,
  FIND_MIN,
  GRID_KEY,
  gridKeepsKey,
  gridPress,
  gridWidth,
  headParams,
  isBarKey,
  keyParams,
  layerManagerGlyphs,
  layerManagerIconSource,
  LM_GRID_MIN,
  LM_HEAD_H,
  LM_LISTS,
  LM_OVERSCAN,
  LM_ROW_H,
  LM_SCALARS,
  LM_SIGNALS,
  pageRows,
  refusalLine,
  revealOffset,
  rowParams,
  rowWindow,
  spokenRefusal,
  unisolated,
  viewHeight,
  withLayerManagerIcons,
  type RowView,
} from "./layer-manager-params";
import { NO_INKS, slabRgb } from "./layers-params";

const ui = join(import.meta.dir, "..", "..");
const documentPath = join(ui, "slab", "layer-manager.slab");
// `LM_ICONS=write bun test src/slab/layer-manager.test.ts` writes the generated glyphs into the
// document again (after `icons.ts` or the grid's glyphs changed); the tests below then hold.
if (process.env["LM_ICONS"] === "write") {
  const next = withLayerManagerIcons(readFileSync(documentPath, "utf8"));
  if (next !== null) writeFileSync(documentPath, next);
}
const source = readFileSync(documentPath, "utf8");

const layer = (name: string, over: Partial<LayerRow> = {}): LayerRow => ({
  name,
  on: true,
  frozen: false,
  locked: false,
  plot: true,
  used: false,
  current: false,
  colorName: "White",
  colorRgb: [255, 255, 255],
  linetype: "Continuous",
  lineweight: "Default",
  description: "",
  transparency: 0,
  ...over,
});

const view = (over: Partial<RowView> = {}): RowView => ({ selected: new Set(), active: { row: -1, column: NAME_COLUMN }, ring: false, refusals: new Map(), editing: null, inks: NO_INKS, ...over });

describe("the Layer Manager's glyphs", () => {
  test("the document's block is the generator's output, character for character", () => {
    expect(iconBlockOf(source)).toBe(layerManagerIconSource());
    expect(withLayerManagerIcons(source)).toBe(source);
  });

  test("every glyph is a path of icons.ts, declared once", () => {
    for (const glyph of layerManagerGlyphs()) {
      expect(ICON_PATHS[glyph.id]).toBeDefined();
      expect(source.split(`icon ${glyph.name} viewbox=`).length).toBe(2);
    }
  });
});

describe("the document", () => {
  test("declares every param the host hands over, and every signal it answers", () => {
    const params = source.slice(source.indexOf("params {"));
    for (const name of [...LM_SCALARS, ...LM_LISTS]) expect(params).toMatch(new RegExp(`\\n  ${name} +(text|num|bool|list)`));
    for (const name of LM_SIGNALS) expect(source).toContain(`=${name}`);
  });

  test("has a cell for every column, and the ids the host's keys name", () => {
    for (let column = 0; column < COLUMNS.length; column++) expect(source).toContain(`row #c${column} `);
    for (const id of ["#lm ", "#frame ", "#pane ", "#grid ", "#top ", "#heads ", "#actions "]) expect(source).toContain(id);
    expect(GRID_KEY).toBe("#lm/#frame/#pane/#grid");
  });

  test("binds no pointer move and no transition (each costs a solve per step)", () => {
    expect(source).not.toContain("pointer-move=");
    expect(source).not.toContain("transition=");
  });

  test("the grid is the one focusable node of the body besides the bar's keys and the clear key", () => {
    const code = source.split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
    expect(code.match(/\bfocusable\b/g)?.length).toBe(1);
    expect(code.match(/\bact=/g)?.length).toBe(3);
  });
});

describe("cells and their keys", () => {
  test("a cell's key and back", () => {
    for (const cell of [{ row: 0, column: 0 }, { row: 1999, column: 10 }, { row: -1, column: 3 }]) expect(cellOfKey(cellKey(cell))).toEqual(cell);
    expect(cellOfKey(`${cellKey({ row: 4, column: 6 })}/text@0`)).toEqual({ row: 4, column: 6 });
  });

  test("anything else names no cell", () => {
    for (const key of ["", GRID_KEY, `${GRID_KEY}/rows`, `${GRID_KEY}/rows~r-4/#row`, `${GRID_KEY}/rows~r-4/#row/#c${COLUMNS.length}`, `${GRID_KEY}/rows~r-x/#row/#c1`, `${GRID_KEY}/rows~r-123456/#row/#c1`, "x".repeat(5000), `${GRID_KEY}/#top/#heads/each@0~h-11/#head`]) expect(cellOfKey(key)).toBeNull();
  });

  test("a press's cell and modifier keys, read with checked narrowing", () => {
    const press = (meta: unknown): Event => new CustomEvent("grid_press", { detail: { item: "", meta } });
    expect(gridPress(press({ hit_key: cellKey({ row: 2, column: 1 }), mods: 1 }))).toEqual({ cell: { row: 2, column: 1 }, toggle: false, range: true });
    expect(gridPress(press({ hit_key: cellKey({ row: 2, column: 1 }), mods: 4 }))).toEqual({ cell: { row: 2, column: 1 }, toggle: true, range: false });
    expect(gridPress(press({ hit_key: cellKey({ row: 2, column: 1 }), mods: 8 })).toggle).toBe(true);
    expect(gridPress(press({ hit_key: 7, mods: "x" }))).toEqual({ cell: null, toggle: false, range: false });
    expect(gridPress(press(null)).cell).toBeNull();
    expect(gridPress(new Event("grid_press")).cell).toBeNull();
  });
});

describe("what the grid draws", () => {
  test("the headings: one a column, the order on the sorted one, the ring where the keyboard is", () => {
    const heads = headParams({ key: "name", descending: false }, { row: -1, column: 1 }, true);
    expect(heads.map((head) => head.key)).toEqual(COLUMNS.map((_, at) => `h-${at}`));
    expect(heads[1]).toMatchObject({ sorted: true, up: true, ring: true, wide: true, worded: true });
    expect(heads[2]).toMatchObject({ sorted: false, flag: true, worded: false, glyph: "glyph-layer-on" });
    expect(heads[0]).toMatchObject({ status: true, worded: false });
    expect(headParams({ key: "name", descending: true }, { row: 3, column: 1 }, true)[1]).toMatchObject({ up: false, ring: false });
    expect(heads.reduce((sum, head) => sum + head.cw, 0)).toBe(LM_GRID_MIN);
  });

  test("a row: its cells' words, its marks, and the ring on the active cell only while it shows", () => {
    const rows = [layer("0", { current: true, used: true }), layer("Walls", { frozen: true, colorName: "Red", colorRgb: [255, 0, 0], transparency: 40, description: "Outer" })];
    const [current, walls] = rowParams(rows, view({ selected: new Set(["Walls"]), active: { row: 1, column: 3 }, ring: true }));
    expect(current).toMatchObject({ key: "r-0", picked: false, current: true, used: true, status: "Current layer. Has objects", a3: false, hot: false });
    expect(walls).toMatchObject({ key: "r-1", picked: true, frozen: true, hue: "Red", tone: slabRgb([255, 0, 0]), clear: "40%", note: "Outer", a3: true, a1: false, hot: true, frozen_name: "Walls frozen" });
    expect(rowParams(rows, view({ active: { row: 1, column: 3 }, ring: false }))[1]?.a3).toBe(false);
  });

  test("a refused row says why; the row being typed in hides its words under the field", () => {
    const rows = [layer("A"), layer("B")];
    const [a, b] = rowParams(rows, view({ refusals: new Map([["A", "Cannot freeze the current layer"]]), editing: { name: "B", key: "description" } }));
    expect(a).toMatchObject({ refused: true, said: "Not changed: Cannot freeze the current layer", typing: false });
    expect(b).toMatchObject({ refused: false, noting: true, typing: false });
  });

  test("a hostile name is drawn as words, one line, capped", () => {
    const [row] = rowParams([layer(`a\u0000b\n${"x".repeat(5000)}`)], view());
    expect(row?.name.includes("\n")).toBe(false);
    expect(row?.name.length ?? 0).toBeLessThan(400);
    expect(rowParams([layer("")], view())[0]?.name).toBe("(no name)");
  });

  test("only the rows of the window are handed over, each under its place in the table", () => {
    const rows = Array.from({ length: 2000 }, (_, at) => layer(`L${at}`));
    const window = rowWindow(22 * 500, LM_HEAD_H + 22 * 20, rows.length);
    const drawn = rowParams(rows, view(), window);
    expect(drawn.length).toBe(window.last - window.first + 1);
    expect(drawn.length).toBeLessThanOrEqual(20 + 2 * LM_OVERSCAN + 2);
    expect(drawn[0]?.key).toBe(`r-${window.first}`);
    expect(window.above + drawn.length * LM_ROW_H + window.below).toBe(rows.length * LM_ROW_H);
  });

  test("the window of an empty table, and of hostile numbers", () => {
    expect(rowWindow(0, 400, 0)).toEqual({ first: 0, last: -1, above: 0, below: 0 });
    const odd = rowWindow(Number.NaN, Number.POSITIVE_INFINITY, 10);
    expect(odd.first).toBe(0);
    expect(odd.last).toBeLessThanOrEqual(9);
    expect(rowWindow(1e12, 400, 10).last).toBe(9);
  });

  test("a row comes into view with the least move, clear of the heading", () => {
    const viewH = LM_HEAD_H + 10 * LM_ROW_H;
    expect(revealOffset(3, 0, viewH)).toBe(0);
    expect(revealOffset(10, 0, viewH)).toBe(LM_ROW_H);
    expect(revealOffset(2, 5 * LM_ROW_H, viewH)).toBe(2 * LM_ROW_H);
    expect(revealOffset(-1, 40, viewH)).toBe(40);
    expect(revealOffset(Number.NaN, 40, viewH)).toBe(40);
  });

  test("the frame's sizes", () => {
    expect(viewHeight(2000)).toBe(20 * LM_ROW_H);
    expect(viewHeight(600)).toBe(300);
    expect(viewHeight(Number.NaN)).toBe(20 * LM_ROW_H);
    expect(gridWidth(390)).toBe(LM_GRID_MIN);
    expect(gridWidth(1002)).toBe(1000);
    expect(pageRows(LM_HEAD_H + 20 * LM_ROW_H)).toBe(19);
    expect(pageRows(0)).toBe(1);
  });

  test("the filter keeps the keys' line while it has room, else takes a line of its own", () => {
    expect(findWidth(820, 270, 12)).toBe(538);
    expect(findWidth(358, 270, 12)).toBe(358);
    expect(findWidth(100, 270, 12)).toBe(FIND_MIN);
    expect(findWidth(Number.NaN, Number.NaN, 12)).toBe(FIND_MIN);
  });
});

describe("the bar's keys", () => {
  test("what stops each, in the SolidJS buttons' words", () => {
    const keys = keyParams({ renamable: false, removable: { allowed: false, reason: "Layer 0 cannot be deleted" }, currentable: { allowed: true } });
    expect(keys.map((key) => key.key)).toEqual(["new", "rename", "delete", "current"]);
    expect(keys[1]).toMatchObject({ off: true, why: "Select one layer to rename" });
    expect(keys[2]).toMatchObject({ off: true, why: "Layer 0 cannot be deleted" });
    expect(keys[3]).toMatchObject({ off: false, why: "" });
    expect(isBarKey("delete")).toBe(true);
    expect(isBarKey("drop")).toBe(false);
  });
});

describe("the choices", () => {
  const row = layer("Walls", { colorName: "Red", lineweight: "0.25 mm", transparency: 30 });

  test("the popup holds the SolidJS selects' values and opens on the row's", () => {
    expect(choicePopup("color", row, []).held).toBe("Red");
    expect(choicePopup("transparency", row, []).held).toBe("30");
    expect(choicePopup("transparency", row, []).options.map((option) => option.label)).toContain("90%");
    expect(choicePopup("linetype", row, ["Continuous", "Dashed"]).options.map((option) => option.value)).toEqual(["Continuous", "Dashed"]);
    expect(choicePopup("lineweight", row, []).label).toBe("Walls lineweight");
  });

  test("a picked value becomes a change; a value the list does not hold changes nothing", () => {
    const named = LAYER_COLOR_CHOICES[0] ?? "";
    expect(choicePatch("color", named)).toEqual({ color: named });
    expect(choicePatch("color", "ByLayer")).toBeNull();
    expect(choicePatch("transparency", "40")).toEqual({ transparency: 40 });
    expect(choicePatch("transparency", "45")).toBeNull();
    expect(choicePatch("lineweight", "Default")).toEqual({ lineweight: "Default" });
    expect(choicePatch("linetype", "")).toBeNull();
  });
});

describe("the words under the grid", () => {
  test("a refusal in the engine's words; several, listed; the isolates taken out for the kernel", () => {
    expect(refusalLine(new Map())).toBe("");
    expect(refusalLine(new Map([["A", "Layer `B` already exists"]]))).toBe("“A” was not changed. Layer `B` already exists");
    expect(spokenRefusal(new Map([["A", "No"]]))).toContain("⁨A⁩");
    const many = refusalLine(new Map(["A", "B", "C", "D", "E"].map((name) => [name, "No"])));
    expect(many).toContain("5 layers were not changed.");
    expect(many).toContain("And 2 more.");
    expect(unisolated("⁦a⁧b⁨c⁩")).toBe("abc");
    expect(emptyText(3, " wall ")).toBe("No layer's name matches “wall”.");
    expect(emptyText(0, "")).toBe("The drawing has no layers to show.");
  });
});

describe("the field over a cell", () => {
  const grid = { x: 0, y: 40, w: 600, h: 300 };

  test("stands on the cell, cut to the grid's window under the heading", () => {
    expect(editPlace({ x: 32, y: 100, w: 200, h: 22 }, grid, LM_HEAD_H)).toEqual({ left: 32, top: 100, width: 200, height: 22, clip: [0, 0, 0, 0] });
    expect(editPlace({ x: 32, y: 55, w: 200, h: 22 }, grid, LM_HEAD_H)?.clip).toEqual([10, 0, 0, 0]);
    expect(editPlace({ x: 500, y: 330, w: 200, h: 22 }, grid, LM_HEAD_H)?.clip).toEqual([0, 100, 12, 0]);
    expect(editPlace({ x: 32, y: 500, w: 200, h: 22 }, grid, LM_HEAD_H)?.clip).toEqual([22, 0, 0, 0]);
    expect(editPlace({ x: Number.NaN, y: 0, w: 1, h: 1 }, grid, LM_HEAD_H)).toBeNull();
    expect(editStyle({ left: 1, top: 2, width: 3, height: 4, clip: [5, 6, 7, 8] })["clip-path"]).toBe("inset(5px 6px 7px 8px)");
  });

  test("the cell of a name or a description being typed in", () => {
    expect(editCell(["a", "b"], { name: "b", key: "name" })).toEqual({ row: 1, column: NAME_COLUMN });
    expect(editCell(["a", "b"], { name: "b", key: "description" })).toEqual({ row: 1, column: COLUMNS.length - 1 });
    expect(editCell(["a"], { name: "b", key: "name" })).toBeNull();
    expect(editCell(["a"], null)).toBeNull();
  });
});

describe("the grid's keys and the kernel", () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

  test("every key the kernel would act on from the grid is kept from it", () => {
    for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter", " ", "F2", "Delete", "q"]) expect(gridKeepsKey(key(k))).toBe(true);
  });

  test("Tab and Escape are the frame's; a function key or a chord the shell's", () => {
    for (const k of [key("Tab"), key("Escape"), key("F7"), key("s", { ctrlKey: true }), key("p", { metaKey: true })]) expect(gridKeepsKey(k)).toBe(false);
    expect(gridKeepsKey(key("ArrowDown", { ctrlKey: true }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The grid's keys, as both dialogs decide them (`gridKeyAction`, run by the shared state)
// ---------------------------------------------------------------------------------------------

describe("the grid's keys, shared by both dialogs", () => {
  const rows = ["0", "Walls", "Doors", "Windows", "Dims", "Notes"].map((name, at) => layer(name, { current: at === 0, frozen: name === "Doors" }));
  const fresh: Typed = { text: "", at: 0 };
  const decide = (k: string, cell: GridCell, mods: Partial<Omit<GridKeyEvent, "preventDefault">> = {}, typed: Typed = fresh, now = 10_000): { action: GridAction; typed: Typed } =>
    gridKeyAction({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...mods }, { cell, rows, page: 3, typed, now });
  const at = (row: number, column: number): GridCell => ({ row, column });

  test("the arrows move between cells and rows, and a row move takes the selection", () => {
    expect(decide("ArrowDown", at(0, 1)).action).toEqual({ kind: "move", to: at(1, 1), select: { name: "Walls", range: false } });
    expect(decide("ArrowRight", at(1, 1)).action).toEqual({ kind: "move", to: at(1, 2), select: null });
    expect(decide("ArrowUp", at(0, 3)).action).toEqual({ kind: "move", to: at(-1, 3), select: null });
    expect(decide("ArrowDown", at(1, 1), { shiftKey: true }).action).toMatchObject({ select: { name: "Doors", range: true } });
    expect(decide("ArrowDown", at(1, 1), { ctrlKey: true }).action).toEqual({ kind: "move", to: at(2, 1), select: null });
  });

  test("at an edge an arrow is still the grid's, and moves nothing", () => {
    expect(decide("ArrowUp", at(-1, 3)).action).toEqual({ kind: "used" });
    expect(decide("ArrowLeft", at(2, 0)).action).toEqual({ kind: "used" });
    expect(decide("ArrowDown", at(5, 1)).action).toEqual({ kind: "used" });
  });

  test("Home and End, with Ctrl the table's ends; the page keys go a page", () => {
    expect(decide("End", at(0, 1)).action).toMatchObject({ to: at(0, COLUMNS.length - 1) });
    expect(decide("Home", at(3, 5), { ctrlKey: true }).action).toMatchObject({ to: at(0, 0), select: null });
    expect(decide("End", at(0, 1), { metaKey: true }).action).toMatchObject({ to: at(5, COLUMNS.length - 1) });
    expect(decide("PageDown", at(0, 1)).action).toMatchObject({ to: at(3, 1) });
    expect(decide("PageUp", at(5, 1)).action).toMatchObject({ to: at(2, 1) });
  });

  test("Ctrl+A takes every row; another chord is the shell's", () => {
    expect(decide("a", at(2, 1), { ctrlKey: true }).action).toEqual({ kind: "all" });
    expect(decide("A", at(2, 1), { metaKey: true }).action).toEqual({ kind: "all" });
    expect(decide("s", at(2, 1), { ctrlKey: true }).action).toEqual({ kind: "pass" });
    expect(decide("ArrowDown", at(2, 1), { altKey: true }).action).toEqual({ kind: "pass" });
  });

  test("Ctrl+Space adds the keyboard's row to the selection or takes it out, on any of its cells", () => {
    // It was left to the shell (a chord returned before Space was read), so rows could not be picked apart.
    expect(decide(" ", at(2, 1), { ctrlKey: true }).action).toEqual({ kind: "select", name: "Doors", toggle: true, range: false });
    expect(decide(" ", at(2, 1), { metaKey: true }).action).toEqual({ kind: "select", name: "Doors", toggle: true, range: false });
    // On a flag the key is the row's with Ctrl, the flag's without.
    expect(decide(" ", at(2, 3), { ctrlKey: true }).action).toEqual({ kind: "select", name: "Doors", toggle: true, range: false });
    expect(decide(" ", at(2, 3)).action).toEqual({ kind: "flag", name: "Doors", patch: { frozen: false } });
    expect(decide(" ", at(3, 1), { ctrlKey: true, shiftKey: true }).action).toEqual({ kind: "select", name: "Windows", toggle: true, range: true });
    // A heading has no row to take, and a held key acts once; plain Space still selects the row alone.
    expect(decide(" ", at(-1, 1), { ctrlKey: true }).action).toEqual({ kind: "used" });
    expect(decide(" ", at(2, 1), { ctrlKey: true, repeat: true }).action).toEqual({ kind: "used" });
    expect(decide(" ", at(2, 1)).action).toEqual({ kind: "select", name: "Doors", toggle: false, range: false });
    expect(decide("Enter", at(2, 1), { ctrlKey: true }).action).toEqual({ kind: "pass" });
  });

  test("Enter or Space on a heading sorts by its column; F2 there does nothing", () => {
    expect(decide("Enter", at(-1, 1)).action).toEqual({ kind: "sort", key: "name" });
    expect(decide(" ", at(-1, 9)).action).toEqual({ kind: "sort", key: "transparency" });
    expect(decide("F2", at(-1, 1)).action).toEqual({ kind: "used" });
  });

  test("Enter or Space on a flag turns it; a held key does it once", () => {
    expect(decide(" ", at(2, 3)).action).toEqual({ kind: "flag", name: "Doors", patch: { frozen: false } });
    expect(decide("Enter", at(1, 2)).action).toEqual({ kind: "flag", name: "Walls", patch: { on: false } });
    expect(decide("Enter", at(1, 2), { repeat: true }).action).toEqual({ kind: "used" });
    expect(decide("F2", at(1, 2)).action).toEqual({ kind: "used" });
  });

  test("Enter, Space or F2 on a choice opens its values", () => {
    for (const k of ["Enter", " ", "F2"]) expect(decide(k, at(1, 7)).action).toEqual({ kind: "choice", cell: at(1, 7) });
  });

  test("Space selects the row; Enter and F2 type a name or a description; Enter on the status makes it current", () => {
    expect(decide(" ", at(1, 1), { shiftKey: true }).action).toEqual({ kind: "select", name: "Walls", toggle: false, range: true });
    expect(decide("Enter", at(1, 1)).action).toEqual({ kind: "edit", name: "Walls", key: "name" });
    expect(decide("F2", at(1, 10)).action).toEqual({ kind: "edit", name: "Walls", key: "description" });
    expect(decide("Enter", at(1, 0)).action).toEqual({ kind: "current", name: "Walls" });
    expect(decide("F2", at(1, 0)).action).toEqual({ kind: "used" });
  });

  test("Delete deletes the selection, once for a held key", () => {
    expect(decide("Delete", at(1, 4)).action).toEqual({ kind: "delete" });
    expect(decide("Delete", at(1, 4), { repeat: true }).action).toEqual({ kind: "used" });
  });

  test("letters typed on a name jump to the next layer that starts with them", () => {
    const first = decide("w", at(0, 1));
    expect(first.action).toEqual({ kind: "jump", to: at(1, 1), name: "Walls" });
    const second = decide("i", at(1, 1), {}, first.typed, 10_100);
    expect(second.typed.text).toBe("wi");
    expect(second.action).toEqual({ kind: "jump", to: at(3, 1), name: "Windows" });
    // After the pause the letters start a new word.
    expect(decide("d", at(3, 1), {}, second.typed, 20_000).action).toEqual({ kind: "jump", to: at(4, 1), name: "Dims" });
    // A letter no name starts with is not the grid's, and a letter off the name column neither.
    expect(decide("q", at(0, 1)).action).toEqual({ kind: "pass" });
    expect(decide("w", at(0, 4)).action).toEqual({ kind: "pass" });
  });

  test("a cell outside the columns does nothing", () => {
    expect(decide("ArrowDown", at(0, 42)).action).toEqual({ kind: "pass" });
  });
});
