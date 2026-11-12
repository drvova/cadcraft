/**
 * The Layer Properties Manager's rules: the engine's reply into rows, the order and the filter,
 * the selection (press, toggle, range, all), what may be done to a selection and why not, the
 * engine calls a change is made of and only those, the new layer's name, the grid's keys, and
 * hostile layer data (a thousand layers, a 300-character name, names that differ only in case,
 * control characters, an empty name) read and never thrown on.
 */

import { describe, expect, test } from "bun:test";
import type { Envelope } from "./facade";
import {
  ariaSort,
  countText,
  currentVerdict,
  deleteVerdict,
  filterRows,
  LAYER_COLOR_CHOICES,
  LAYER_LINEWEIGHT_CHOICES,
  matchesFilter,
  MAX_LAYERS,
  moveCell,
  newLayerName,
  nextSort,
  NO_NAME,
  NO_SELECTION,
  opensLayerManager,
  parseLinetypes,
  parseRows,
  plainRefusal,
  planChange,
  planCurrent,
  planDelete,
  planNew,
  planRename,
  pruneSelection,
  quoted,
  readLinetypes,
  readRows,
  renameInSelection,
  runCalls,
  selectAll,
  selectPress,
  shownName,
  sortRows,
  targetsOf,
  typeaheadRow,
  windowOf,
  type LayerCall,
  type LayerEngine,
  type LayerRow,
  type Selection,
} from "./layer-manager";

function layer(name: string, patch: Partial<LayerRow> = {}): LayerRow {
  return {
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
    ...patch,
  };
}

const names = (rows: readonly LayerRow[]): string[] => rows.map((row) => row.name);

/** The engine's names for three of a layer's colours: data the table passes on, not inks of the interface. */
const WHITE = "White";
const RED = "Red";
const BLUE = "Blue";

/** An engine that records what it is asked and refuses the commands named in `refuse`. */
function engine(result: unknown, refuse: Readonly<Record<string, string>> = {}): LayerEngine & { calls: LayerCall[] } {
  const calls: LayerCall[] = [];
  return {
    calls,
    execute(command: string, params?: unknown): Envelope {
      calls.push({ command, params: (params ?? {}) as Record<string, unknown> });
      const key = `${command}:${String((params as Record<string, unknown> | undefined)?.["name"] ?? "")}`;
      const error = refuse[key] ?? refuse[command];
      return error === undefined ? { ok: true, result } : { ok: false, error };
    },
  };
}

describe("reading the engine", () => {
  test("a row carries the facade's fields and the engine's transparency", () => {
    const rows = parseRows({
      layers: [
        { name: "0", on: true, frozen: false, locked: false, plot: true, color: WHITE, linetype: "Continuous", lineweight: "Default", transparency: 0, description: "", current: true, used: true },
        { name: "Walls", on: false, frozen: true, locked: true, plot: false, color: RED, linetype: "DASHED", lineweight: "0.25 mm", transparency: 40, description: "Outer walls", current: false, used: false },
      ],
    });
    expect(names(rows)).toEqual(["0", "Walls"]);
    expect(rows[1]).toMatchObject({ on: false, frozen: true, locked: true, plot: false, colorName: RED, linetype: "DASHED", lineweight: "0.25 mm", transparency: 40, description: "Outer walls" });
    expect(rows[0]).toMatchObject({ current: true, used: true, transparency: 0 });
  });

  test("a reply that is not the engine's shape has no rows, and nothing throws", () => {
    for (const hostile of [null, undefined, 3, "layers", [], {}, { layers: 7 }, { layers: [null, 4, "x", [], {}, { name: 5 }] }]) {
      expect(parseRows(hostile)).toEqual([]);
    }
  });

  test("a transparency outside the engine's range is brought inside it; one that is not a number is 0", () => {
    const rows = parseRows({ layers: [{ name: "a", transparency: 250 }, { name: "b", transparency: -4 }, { name: "c", transparency: "half" }, { name: "d", transparency: Number.NaN }, { name: "e", transparency: 33.6 }] });
    expect(rows.map((row) => row.transparency)).toEqual([90, 0, 0, 0, 34]);
  });

  test("records without a name are passed over, and the others keep their own transparency", () => {
    const rows = parseRows({ layers: [{ transparency: 80 }, { name: "a", transparency: 10 }, 7, { name: "b", transparency: 20 }] });
    expect(rows.map((row) => [row.name, row.transparency])).toEqual([
      ["a", 10],
      ["b", 20],
    ]);
  });

  test("an engine that refuses has no rows and no linetypes", () => {
    const down = engine(null, { layer: "no drawing", "drawing.inspect": "no drawing" });
    expect(readRows(down)).toEqual([]);
    expect(readLinetypes(down)).toEqual([]);
  });

  test("the loaded linetypes are read by name, once each", () => {
    expect(parseLinetypes({ linetypes: ["Continuous", { name: "DASHED" }, "HIDDEN", "DASHED", "", 4, null], layers: [] })).toEqual(["Continuous", "DASHED", "HIDDEN"]);
    expect(parseLinetypes({ linetypes: "all" })).toEqual([]);
    expect(parseLinetypes(null)).toEqual([]);
  });

  test("a layer's colour and lineweight lists leave out what a layer cannot be", () => {
    expect(LAYER_COLOR_CHOICES).not.toContain("ByLayer");
    expect(LAYER_COLOR_CHOICES).not.toContain("ByBlock");
    expect(LAYER_COLOR_CHOICES).toContain("Red");
    expect(LAYER_LINEWEIGHT_CHOICES[0]).toBe("Default");
    expect(LAYER_LINEWEIGHT_CHOICES).toContain("0.25 mm");
  });
});

describe("hostile layer data", () => {
  test("a thousand layers are read, sorted and filtered", () => {
    const rows = parseRows({ layers: Array.from({ length: 1000 }, (_, i) => ({ name: `L-${i}`, transparency: i % 100 })) });
    expect(rows).toHaveLength(1000);
    const sorted = sortRows(rows, { key: "name", descending: true });
    expect(sorted[0]?.name).toBe("L-999");
    expect(filterRows(rows, "l-99")).toHaveLength(11);
    expect(filterRows(rows, "L-9?")).toHaveLength(10);
  });

  test("more layers than the table takes are cut, not looped over", () => {
    const rows = parseRows({ layers: Array.from({ length: MAX_LAYERS + 50 }, (_, i) => ({ name: `n${i}` })) });
    expect(rows).toHaveLength(MAX_LAYERS);
  });

  test("a 300-character name is kept whole as the row's name and shortened inside a sentence", () => {
    const long = `A-${"X".repeat(290)}-PHASE-1`;
    const rows = parseRows({ layers: [{ name: long }] });
    expect(rows[0]?.name).toBe(long);
    expect(shownName(long)).toBe(long);
    expect(Array.from(quoted(long)).length).toBeLessThan(60);
    expect(quoted(long)).toContain("PHASE-1");
    expect(planChange(rows, [long], { on: false })).toEqual([{ command: "layer.set", params: { name: long, on: false }, layer: long }]);
  });

  test("names that differ only in case are two rows, selected apart", () => {
    const rows = parseRows({ layers: [{ name: "Walls" }, { name: "WALLS" }, { name: "walls" }] });
    expect(names(rows)).toEqual(["Walls", "WALLS", "walls"]);
    const picked = selectPress(NO_SELECTION, names(rows), "WALLS");
    expect([...picked.names]).toEqual(["WALLS"]);
    expect(names(sortRows(rows, { key: "name", descending: false }))).toEqual(["WALLS", "Walls", "walls"]);
    expect(filterRows(rows, "wAlLs")).toHaveLength(3);
  });

  test("control characters draw as their pictures and an empty name as words", () => {
    expect(shownName("A\u0000B\tC\u007f\u0085")).toBe("A␀B␉C␡�");
    expect(shownName("")).toBe(NO_NAME);
    const rows = parseRows({ layers: [{ name: "" }, { name: "\n" }] });
    expect(names(rows)).toEqual(["", "\n"]);
    expect(names(sortRows(rows, { key: "name", descending: false }))).toHaveLength(2);
    expect(matchesFilter("", "")).toBe(true);
    expect(matchesFilter("", "a")).toBe(false);
    expect(deleteVerdict(rows, new Set([""]))).toEqual({ allowed: true });
  });

  test("a filter built to backtrack is answered at once", () => {
    const name = "a".repeat(300);
    const started = Date.now();
    expect(matchesFilter(name, `${"*a".repeat(120)}*b`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe("sorting", () => {
  const rows = [layer("Walls", { used: true, frozen: true, lineweight: "0.50 mm", colorName: "Red" }), layer("A-10"), layer("0", { current: true, used: true }), layer("A-2", { locked: true, lineweight: "0.25 mm", colorName: "Color 34" }), layer("a-2", { on: false })];

  test("no sort is the engine's own order, in a new array", () => {
    const out = sortRows(rows, null);
    expect(names(out)).toEqual(names(rows));
    expect(out).not.toBe(rows);
  });

  test("names sort as a person reads them: numbers by value, case only to break a tie", () => {
    expect(names(sortRows(rows, { key: "name", descending: false }))).toEqual(["0", "A-2", "a-2", "A-10", "Walls"]);
    expect(names(sortRows(rows, { key: "name", descending: true }))).toEqual(["Walls", "A-10", "a-2", "A-2", "0"]);
  });

  test("a state sort is stable: rows it cannot tell apart keep the engine's order, both ways", () => {
    expect(names(sortRows(rows, { key: "frozen", descending: false }))).toEqual(["A-10", "0", "A-2", "a-2", "Walls"]);
    expect(names(sortRows(rows, { key: "frozen", descending: true }))).toEqual(["Walls", "A-10", "0", "A-2", "a-2"]);
    expect(names(sortRows(rows, { key: "on", descending: false }))[0]).toBe("a-2");
    expect(names(sortRows(rows, { key: "locked", descending: true }))[0]).toBe("A-2");
  });

  test("the current layer has no place of its own; the status column brings it to the top", () => {
    expect(names(sortRows(rows, { key: "name", descending: true })).at(-1)).toBe("0");
    expect(names(sortRows(rows, { key: "status", descending: false }))).toEqual(["0", "Walls", "A-10", "A-2", "a-2"]);
  });

  test("lineweights sort by width, the default first; colours by name with numbers by value", () => {
    expect(names(sortRows(rows, { key: "lineweight", descending: true })).slice(0, 2)).toEqual(["Walls", "A-2"]);
    expect(names(sortRows(rows, { key: "color", descending: false })).slice(0, 2)).toEqual(["A-2", "Walls"]);
  });

  test("a heading goes ascending, descending, then back to the engine's order", () => {
    const up = nextSort(null, "name");
    expect(up).toEqual({ key: "name", descending: false });
    const down = nextSort(up, "name");
    expect(down).toEqual({ key: "name", descending: true });
    expect(nextSort(down, "name")).toBeNull();
    expect(nextSort(down, "on")).toEqual({ key: "on", descending: false });
    expect(ariaSort(up, "name")).toBe("ascending");
    expect(ariaSort(down, "name")).toBe("descending");
    expect(ariaSort(down, "on")).toBe("none");
    expect(ariaSort(null, "name")).toBe("none");
  });
});

describe("filtering", () => {
  const rows = ["0", "A-WALL-EXT", "A-WALL-INT", "A-DOOR", "S-GRID", "Defpoints"].map((name) => layer(name));

  test("plain text matches anywhere, without regard to case or the space around it", () => {
    expect(names(filterRows(rows, "wall"))).toEqual(["A-WALL-EXT", "A-WALL-INT"]);
    expect(names(filterRows(rows, "  WALL  "))).toEqual(["A-WALL-EXT", "A-WALL-INT"]);
    expect(names(filterRows(rows, "int"))).toEqual(["A-WALL-INT", "Defpoints"]);
    expect(filterRows(rows, "")).toHaveLength(rows.length);
    expect(filterRows(rows, "   ")).toHaveLength(rows.length);
    expect(filterRows(rows, "zz")).toEqual([]);
  });

  test("with a star or a question mark the text is a pattern for the whole name", () => {
    expect(names(filterRows(rows, "A-*"))).toEqual(["A-WALL-EXT", "A-WALL-INT", "A-DOOR"]);
    expect(names(filterRows(rows, "*-ext"))).toEqual(["A-WALL-EXT"]);
    expect(names(filterRows(rows, "?-GRID"))).toEqual(["S-GRID"]);
    expect(names(filterRows(rows, "?"))).toEqual(["0"]);
    expect(names(filterRows(rows, "wall*"))).toEqual([]);
    expect(names(filterRows(rows, "*wall*"))).toEqual(["A-WALL-EXT", "A-WALL-INT"]);
    expect(filterRows(rows, "*")).toHaveLength(rows.length);
  });

  test("the count says how many of how many", () => {
    expect(countText(9, 9)).toBe("9 layers");
    expect(countText(4, 9)).toBe("4 of 9 layers");
    expect(countText(1, 1)).toBe("1 layer");
    expect(countText(0, 1)).toBe("0 of 1 layer");
    expect(countText(0, 0)).toBe("0 layers");
  });
});

describe("the selection", () => {
  const order = ["a", "b", "c", "d", "e"];
  const list = (selection: Selection): string[] => [...selection.names].sort();

  test("a press selects one row and sets the anchor", () => {
    const one = selectPress(NO_SELECTION, order, "c");
    expect(list(one)).toEqual(["c"]);
    expect(one.anchor).toBe("c");
    expect(list(selectPress(one, order, "a"))).toEqual(["a"]);
  });

  test("Ctrl+press flips one row and keeps the others", () => {
    let held = selectPress(NO_SELECTION, order, "b");
    held = selectPress(held, order, "d", { toggle: true });
    expect(list(held)).toEqual(["b", "d"]);
    expect(held.anchor).toBe("d");
    held = selectPress(held, order, "b", { toggle: true });
    expect(list(held)).toEqual(["d"]);
  });

  test("Shift+press takes the rows from the anchor, either way, and the anchor stays", () => {
    const from = selectPress(NO_SELECTION, order, "c");
    const down = selectPress(from, order, "e", { range: true });
    expect(list(down)).toEqual(["c", "d", "e"]);
    expect(down.anchor).toBe("c");
    expect(list(selectPress(down, order, "a", { range: true }))).toEqual(["a", "b", "c"]);
  });

  test("Ctrl+Shift+press adds the range to what is selected", () => {
    let held = selectPress(NO_SELECTION, order, "a");
    held = selectPress(held, order, "d", { toggle: true });
    held = selectPress(held, order, "e", { toggle: true, range: true });
    expect(list(held)).toEqual(["a", "d", "e"]);
  });

  test("a range with no anchor in the table is the pressed row alone", () => {
    expect(list(selectPress(NO_SELECTION, order, "d", { range: true }))).toEqual(["d"]);
    expect(list(selectPress({ names: new Set(["zz"]), anchor: "zz" }, order, "d", { range: true }))).toEqual(["d"]);
  });

  test("a range follows the order shown, not the engine's", () => {
    const from = selectPress(NO_SELECTION, ["e", "c", "a"], "e");
    expect(list(selectPress(from, ["e", "c", "a"], "a", { range: true }))).toEqual(["a", "c", "e"]);
  });

  test("select all takes every shown row", () => {
    const all = selectAll(selectPress(NO_SELECTION, order, "c"), ["b", "c"]);
    expect(list(all)).toEqual(["b", "c"]);
    expect(all.anchor).toBe("c");
    expect(selectAll(NO_SELECTION, []).names.size).toBe(0);
    expect(selectAll(NO_SELECTION, ["x"]).anchor).toBe("x");
  });

  test("layers the drawing no longer has leave the selection; a renamed one stays in it", () => {
    const held: Selection = { names: new Set(["a", "gone"]), anchor: "gone" };
    const pruned = pruneSelection(held, [layer("a"), layer("b")]);
    expect(list(pruned)).toEqual(["a"]);
    expect(pruned.anchor).toBeNull();
    const same: Selection = { names: new Set(["a"]), anchor: "a" };
    expect(pruneSelection(same, [layer("a")])).toBe(same);
    const renamed = renameInSelection({ names: new Set(["a", "b"]), anchor: "a" }, "a", "z");
    expect(list(renamed)).toEqual(["b", "z"]);
    expect(renamed.anchor).toBe("z");
  });

  test("a change on one of several selected rows is for all of them, in the table's order", () => {
    const several: Selection = { names: new Set(["d", "b"]), anchor: "b" };
    expect(targetsOf(several, order, "d")).toEqual(["b", "d"]);
    expect(targetsOf(several, order, "a")).toEqual(["a"]);
    expect(targetsOf({ names: new Set(["b"]), anchor: "b" }, order, "b")).toEqual(["b"]);
    expect(targetsOf(NO_SELECTION, order, "c")).toEqual(["c"]);
  });
});

describe("what may be done", () => {
  const rows = [layer("0", { used: true }), layer("Defpoints"), layer("Walls", { current: true }), layer("Doors", { used: true }), layer("Notes", { used: true }), layer("Empty"), layer("Spare")];
  const reason = (verdict: ReturnType<typeof deleteVerdict>): string => (verdict.allowed ? "" : verdict.reason);

  test("an unused layer that is not current, 0 or Defpoints may be deleted", () => {
    expect(deleteVerdict(rows, new Set(["Empty"]))).toEqual({ allowed: true });
    expect(deleteVerdict(rows, new Set(["Empty", "Spare"]))).toEqual({ allowed: true });
  });

  test("each thing in the way is said in words", () => {
    expect(reason(deleteVerdict(rows, new Set()))).toBe("Select a layer to delete");
    expect(reason(deleteVerdict(rows, new Set(["gone"])))).toBe("Select a layer to delete");
    expect(reason(deleteVerdict(rows, new Set(["0", "Empty"])))).toBe("Layer 0 cannot be deleted");
    expect(reason(deleteVerdict(rows, new Set(["Defpoints"])))).toBe("The Defpoints layer cannot be deleted");
    expect(reason(deleteVerdict([layer("DEFPOINTS")], new Set(["DEFPOINTS"])))).toBe("The Defpoints layer cannot be deleted");
    expect(reason(deleteVerdict(rows, new Set(["Walls", "Empty"])))).toContain("is the current layer");
    expect(reason(deleteVerdict(rows, new Set(["Doors"])))).toBe(`${quoted("Doors")} has objects on it`);
    expect(reason(deleteVerdict(rows, new Set(["Doors", "Notes", "Empty"])))).toBe("2 of the selected layers have objects on them");
  });

  test("one layer that is not current may be made current", () => {
    expect(currentVerdict(rows, new Set(["Doors"]))).toEqual({ allowed: true });
    expect(reason(currentVerdict(rows, new Set()))).toBe("Select a layer to make current");
    expect(reason(currentVerdict(rows, new Set(["Doors", "Notes"])))).toBe("Select one layer to make current");
    expect(reason(currentVerdict(rows, new Set(["Walls"])))).toContain("already the current layer");
  });
});

describe("the engine calls", () => {
  const rows = [layer("a"), layer("b", { frozen: true }), layer("c", { colorName: "Red", lineweight: "0.25 mm", transparency: 30, description: "old" })];

  test("one layer is one call and no undo group", () => {
    expect(planChange(rows, ["a"], { frozen: true })).toEqual([{ command: "layer.set", params: { name: "a", frozen: true }, layer: "a" }]);
  });

  test("several layers are a call each inside one undo group; a layer that already holds the value is left out", () => {
    expect(planChange(rows, ["a", "b", "c"], { frozen: true })).toEqual([
      { command: "undo", params: { mode: "begin" } },
      { command: "layer.set", params: { name: "a", frozen: true }, layer: "a" },
      { command: "layer.set", params: { name: "c", frozen: true }, layer: "c" },
      { command: "undo", params: { mode: "end" } },
    ]);
  });

  test("a change that changes nothing calls nothing", () => {
    expect(planChange(rows, ["b"], { frozen: true })).toEqual([]);
    expect(planChange(rows, ["c"], { color: RED, lineweight: "0.25 mm", transparency: 30, description: "old" })).toEqual([]);
    expect(planChange(rows, ["a"], {})).toEqual([]);
    expect(planChange(rows, [], { on: false })).toEqual([]);
    expect(planChange(rows, ["gone"], { on: false })).toEqual([]);
  });

  test("each property goes under the name layer.set reads; a name listed twice is called once", () => {
    expect(planChange(rows, ["a", "a"], { color: BLUE, linetype: "DASHED", lineweight: "0.50 mm", transparency: 50, description: "new", plot: false, on: false, locked: true })).toEqual([
      { command: "layer.set", params: { name: "a", on: false, locked: true, plot: false, color: BLUE, linetype: "DASHED", lineweight: "0.50 mm", transparency: 50, description: "new" }, layer: "a" },
    ]);
  });

  test("delete is a call each, grouped when several", () => {
    expect(planDelete(["a"])).toEqual([{ command: "layer.delete", params: { name: "a" }, layer: "a" }]);
    expect(planDelete(["a", "b", "a"]).map((call) => call.command)).toEqual(["undo", "layer.delete", "layer.delete", "undo"]);
    expect(planDelete([])).toEqual([]);
  });

  test("a rename is sent trimmed; the same name is kept and an empty one refused here", () => {
    expect(planRename("Walls", "  Outer walls ")).toEqual({ kind: "send", to: "Outer walls", call: { command: "layer.set", params: { name: "Walls", newName: "Outer walls" }, layer: "Walls" } });
    expect(planRename("Walls", "Walls")).toEqual({ kind: "keep" });
    expect(planRename("Walls", " Walls ")).toEqual({ kind: "keep" });
    expect(planRename("Walls", "   ")).toEqual({ kind: "refuse", message: "A layer needs a name" });
    expect(planRename("Walls", "")).toEqual({ kind: "refuse", message: "A layer needs a name" });
    // A change of case only is a rename the engine takes, and a name it would refuse is still asked of it.
    expect(planRename("Walls", "WALLS").kind).toBe("send");
    expect(planRename("Walls", "a/b").kind).toBe("send");
  });

  test("set current is the engine's own command", () => {
    expect(planCurrent("Walls")).toEqual({ command: "layer.current", params: { name: "Walls" }, layer: "Walls" });
  });

  test("a new layer takes the first LayerN no layer has, whatever the case", () => {
    expect(newLayerName([])).toBe("Layer1");
    expect(newLayerName([layer("Layer1"), layer("LAYER2"), layer("layer4")])).toBe("Layer3");
    expect(planNew([layer("0")])).toEqual({ name: "Layer1", call: { command: "layer.new", params: { name: "Layer1" }, layer: "Layer1" } });
    const thousand = Array.from({ length: 1000 }, (_, i) => layer(`Layer${i + 1}`));
    expect(newLayerName(thousand)).toBe("Layer1001");
  });

  test("every call is run, and each refusal comes back with its layer in plain words", () => {
    const calls = planChange(rows, ["a", "c"], { frozen: true });
    const stub = engine({}, { "layer.set:a": "layer.set: cannot freeze the current layer" });
    expect(runCalls(stub, calls)).toEqual([{ layer: "a", message: "Cannot freeze the current layer" }]);
    expect(stub.calls.map((call) => call.command)).toEqual(["undo", "layer.set", "layer.set", "undo"]);
  });

  test("an engine with undo turned off still makes the change, and its refusal of the group is not a layer's", () => {
    const stub = engine({}, { undo: "UNDO Begin needs UNDO Control All." });
    expect(runCalls(stub, planChange(rows, ["a", "c"], { on: false }))).toEqual([]);
    expect(stub.calls).toHaveLength(4);
  });

  test("a refusal loses the command's name and starts with a capital", () => {
    expect(plainRefusal("layer.set: invalid layer name")).toBe("Invalid layer name");
    expect(plainRefusal("Invalid parameters for `layer.set`: cannot freeze the current layer")).toBe("Cannot freeze the current layer");
    expect(plainRefusal("Invalid parameters for `layer.set`: linetype `X: Y` is not loaded (load it with LINETYPE)")).toBe("Linetype `X: Y` is not loaded (load it with LINETYPE)");
    expect(plainRefusal("`layer.delete`: layer has objects on it")).toBe("Layer has objects on it");
    expect(plainRefusal("Undo is turned off")).toBe("Undo is turned off");
    expect(plainRefusal("")).toBe("The engine refused the change");
  });
});

describe("the grid's keys", () => {
  const key = (name: string, mod = false): { key: string; ctrlKey: boolean; metaKey: boolean } => ({ key: name, ctrlKey: mod, metaKey: false });

  test("the arrows move one cell and stop at the edges", () => {
    expect(moveCell({ row: 2, column: 3 }, key("ArrowDown"), 5, 11, 10)).toEqual({ row: 3, column: 3 });
    expect(moveCell({ row: 2, column: 3 }, key("ArrowLeft"), 5, 11, 10)).toEqual({ row: 2, column: 2 });
    expect(moveCell({ row: 4, column: 3 }, key("ArrowDown"), 5, 11, 10)).toBeNull();
    expect(moveCell({ row: 2, column: 10 }, key("ArrowRight"), 5, 11, 10)).toBeNull();
    expect(moveCell({ row: 2, column: 0 }, key("ArrowLeft"), 5, 11, 10)).toBeNull();
  });

  test("Up from the first row reaches the heading, and no further", () => {
    expect(moveCell({ row: 0, column: 1 }, key("ArrowUp"), 5, 11, 10)).toEqual({ row: -1, column: 1 });
    expect(moveCell({ row: -1, column: 1 }, key("ArrowUp"), 5, 11, 10)).toBeNull();
    expect(moveCell({ row: -1, column: 1 }, key("ArrowDown"), 5, 11, 10)).toEqual({ row: 0, column: 1 });
    expect(moveCell({ row: -1, column: 1 }, key("ArrowDown"), 0, 11, 10)).toBeNull();
  });

  test("Home and End go to the row's ends; with Ctrl to the table's", () => {
    expect(moveCell({ row: 2, column: 3 }, key("Home"), 5, 11, 10)).toEqual({ row: 2, column: 0 });
    expect(moveCell({ row: 2, column: 3 }, key("End"), 5, 11, 10)).toEqual({ row: 2, column: 10 });
    expect(moveCell({ row: 2, column: 3 }, key("Home", true), 5, 11, 10)).toEqual({ row: 0, column: 0 });
    expect(moveCell({ row: 2, column: 3 }, key("End", true), 5, 11, 10)).toEqual({ row: 4, column: 10 });
  });

  test("the page keys move a page and stay in the rows", () => {
    expect(moveCell({ row: 2, column: 1 }, key("PageDown"), 100, 11, 10)).toEqual({ row: 12, column: 1 });
    expect(moveCell({ row: 95, column: 1 }, key("PageDown"), 100, 11, 10)).toEqual({ row: 99, column: 1 });
    expect(moveCell({ row: 4, column: 1 }, key("PageUp"), 100, 11, 10)).toEqual({ row: 0, column: 1 });
    expect(moveCell({ row: 0, column: 1 }, key("PageUp"), 100, 11, 10)).toBeNull();
  });

  test("another key does not move, and an empty table has nowhere to go", () => {
    expect(moveCell({ row: 2, column: 3 }, key("a"), 5, 11, 10)).toBeNull();
    expect(moveCell({ row: 0, column: 0 }, key("ArrowRight"), 5, 0, 10)).toBeNull();
  });

  test("a letter jumps to the next name that starts with it and steps through them when typed again", () => {
    const list = ["0", "Doors", "Defpoints", "Walls", "dims"];
    expect(typeaheadRow(list, 0, "d")).toBe(1);
    expect(typeaheadRow(list, 1, "d")).toBe(2);
    expect(typeaheadRow(list, 4, "d")).toBe(1);
    expect(typeaheadRow(list, 1, "dd")).toBe(2);
    expect(typeaheadRow(list, 0, "x")).toBeNull();
    expect(typeaheadRow([], 0, "d")).toBeNull();
    expect(typeaheadRow(list, 0, " ")).toBeNull();
  });

  test("letters typed together are one word, and the row stays while it still matches", () => {
    const list = ["Doors", "Defpoints", "Dims"];
    expect(typeaheadRow(list, 0, "de")).toBe(1);
    expect(typeaheadRow(list, 1, "def")).toBe(1);
    expect(typeaheadRow(list, 1, "di")).toBe(2);
  });
});

describe("the rows drawn", () => {
  test("the rows in view and a few past each edge", () => {
    expect(windowOf(0, 220, 22, 1000, 5)).toEqual({ first: 0, last: 15 });
    expect(windowOf(2200, 220, 22, 1000, 5)).toEqual({ first: 95, last: 115 });
    expect(windowOf(999999, 220, 22, 1000, 5)).toEqual({ first: 999, last: 999 });
  });

  test("nothing to draw, and numbers that are not sizes", () => {
    expect(windowOf(0, 220, 22, 0, 5)).toEqual({ first: 0, last: -1 });
    expect(windowOf(0, 220, 0, 10, 5)).toEqual({ first: 0, last: -1 });
    expect(windowOf(Number.NaN, Number.NaN, 22, 10, 2)).toEqual({ first: 0, last: 2 });
    expect(windowOf(-50, 44, 22, 10, 0)).toEqual({ first: 0, last: 2 });
  });
});

describe("what opens it", () => {
  test("the command's name and its aliases typed at the command line; the hyphen form keeps its prompts", () => {
    for (const text of ["layer", "LAYER", " la ", "Layers", "'layer", "_LAYER"]) expect(opensLayerManager(text)).toBe(true);
    for (const text of ["-layer", "-LA", "layer.set", "laymcur", "", "l", "layer 0"]) expect(opensLayerManager(text)).toBe(false);
  });
});
