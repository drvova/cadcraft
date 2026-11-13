import { describe, expect, test } from "bun:test";
import type { GridCell, LayerRow } from "./layer-manager";
import { COLUMNS, gridKeyAction, type GridAction, type GridKeyEvent, type Typed } from "./layer-manager-edit";

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

describe("the grid's keys", () => {
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
