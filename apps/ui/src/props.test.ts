/**
 * The properties palette's pure logic. The fixtures are copied from the real reply shapes in
 * `crates/engine/src/cmd/props.rs` (`run_get` and `entity_props`): the no-selection defaults and
 * the per-object rows with the engine's computed geometry numbers. The engine was not run for
 * them — the shapes are transcribed from that file, as the brief allows.
 */

import { describe, expect, test } from "bun:test";
import { buildPatch, COLOR_CHOICES, LINEWEIGHT_CHOICES, parseProperties, VARIES, type PropRow, type PropertiesReply } from "./props";

const LAYERS = ["0", "Walls"];

/** `run_get` with no selection: the drawing's header defaults, flat. */
const DEFAULTS = {
  selection: "No selection",
  color: "ByLayer",
  layer: "0",
  linetype: "ByLayer",
  linetypeScale: 1.0,
  lineweight: "ByLayer",
  textStyle: "Standard",
  dimStyle: "Standard",
  textHeight: 0.2,
};

/** `entity_props` for a circle: common props, geometry, and the computed numbers. */
const CIRCLE = {
  handle: "2f",
  type: "Circle",
  layer: "0",
  color: "Red",
  linetype: "ByLayer",
  lineweight: "0.25 mm",
  ltscale: 1.0,
  transparency: "ByLayer",
  thickness: 0,
  visible: true,
  geometry: { center: { x: 0, y: 0, z: 0 }, radius: 5 },
  bounds: [
    [-5, -5],
    [5, 5],
  ],
  diameter: 10,
  circumference: 31.41592653589793,
  area: 78.53981633974483,
};

/** `entity_props` for a line: the computed length/angle live at the top level. */
const LINE = {
  handle: "30",
  type: "Line",
  layer: "Walls",
  color: "ByLayer",
  linetype: "ByLayer",
  lineweight: "ByLayer",
  ltscale: 1.0,
  transparency: "ByLayer",
  thickness: 0,
  visible: true,
  geometry: { a: { x: 0, y: 0, z: 0 }, b: { x: 10, y: 0, z: 0 } },
  length: 10,
  angle: 0,
};

function row(reply: PropertiesReply | null, key: string): PropRow {
  if (reply === null) throw new Error("expected a reply");
  const found = reply.rows.find((r) => r.key === key);
  if (found === undefined) throw new Error(`no row ${key}`);
  return found;
}

describe("parseProperties — defaults", () => {
  test("no selection: the engine's flat reply becomes humanised read-only rows", () => {
    const reply = parseProperties(DEFAULTS, LAYERS);
    expect(reply).not.toBeNull();
    expect(reply?.kind).toBe("defaults");
    if (reply === null || reply.kind !== "defaults") return;
    expect(reply.rows.map((r) => r.key)).toEqual(["color", "layer", "linetype", "linetypeScale", "lineweight", "textStyle", "dimStyle", "textHeight"]);
    expect(row(reply, "linetypeScale").label).toBe("Linetype scale");
    expect(row(reply, "linetypeScale").value).toBe("1");
    expect(row(reply, "linetypeScale").kind).toBe("number");
    expect(row(reply, "textHeight").value).toBe("0.2");
    expect(row(reply, "dimStyle").label).toBe("Dim style");
    expect(reply.rows.every((r) => !r.editable)).toBe(true);
  });

  test("the facade's nested {selection, defaults} shape parses the same way", () => {
    const reply = parseProperties({ selection: "No selection", defaults: DEFAULTS }, LAYERS);
    expect(reply?.kind).toBe("defaults");
    if (reply === null || reply.kind !== "defaults") return;
    expect(row(reply, "layer").value).toBe("0");
  });

  test("choice rows carry the engine's own lists and the caller's layer names", () => {
    const reply = parseProperties(DEFAULTS, LAYERS);
    if (reply === null || reply.kind !== "defaults") throw new Error("expected defaults");
    expect(row(reply, "color").kind).toBe("choice");
    expect(row(reply, "color").choices).toEqual(COLOR_CHOICES);
    expect(row(reply, "layer").choices).toEqual(LAYERS);
    expect(row(reply, "lineweight").choices).toEqual(LINEWEIGHT_CHOICES);
    expect(row(reply, "linetype").kind).toBe("text");
  });

  test("a caller with no layer names gets a text row instead of an empty choice", () => {
    const reply = parseProperties(DEFAULTS, []);
    if (reply === null || reply.kind !== "defaults") throw new Error("expected defaults");
    expect(row(reply, "layer").kind).toBe("text");
  });
});

describe("parseProperties — objects", () => {
  test("one object: common rows are editable, type/handle/geometry rows are not", () => {
    const reply = parseProperties({ count: 1, objects: [CIRCLE] }, LAYERS);
    expect(reply?.kind).toBe("objects");
    if (reply === null || reply.kind !== "objects") return;
    expect(reply.count).toBe(1);
    expect(reply.objects).toHaveLength(1);
    for (const key of ["layer", "color", "linetype", "lineweight", "ltscale", "transparency", "thickness", "visible"]) {
      expect(row(reply, key).editable).toBe(true);
    }
    expect(row(reply, "visible").kind).toBe("bool");
    expect(row(reply, "visible").value).toBe("true");
    expect(row(reply, "type").value).toBe("Circle");
    expect(row(reply, "type").editable).toBe(false);
    expect(row(reply, "handle").value).toBe("2f");
    expect(row(reply, "radius").value).toBe("5");
    expect(row(reply, "diameter").value).toBe("10");
    expect(row(reply, "circumference").editable).toBe(false);
    expect(Number(row(reply, "circumference").value)).toBeCloseTo(31.4159265, 5);
    expect(Number(row(reply, "area").value)).toBeCloseTo(78.5398163, 5);
    expect(reply.rows.some((r) => r.key === "length")).toBe(false);
  });

  test("a line's computed length/angle come through", () => {
    const reply = parseProperties({ count: 1, objects: [LINE] }, LAYERS);
    if (reply === null || reply.kind !== "objects") throw new Error("expected objects");
    expect(row(reply, "length").value).toBe("10");
    expect(row(reply, "angle").value).toBe("0");
    expect(row(reply, "length").editable).toBe(false);
  });

  test("several objects: a property that differs reads *VARIES*", () => {
    const reply = parseProperties({ count: 2, objects: [CIRCLE, LINE] }, LAYERS);
    if (reply === null || reply.kind !== "objects") throw new Error("expected objects");
    expect(reply.count).toBe(2);
    expect(row(reply, "layer").value).toBe(VARIES);
    expect(row(reply, "color").value).toBe(VARIES);
    expect(row(reply, "linetype").value).toBe("ByLayer");
    expect(row(reply, "thickness").value).toBe("0");
    expect(reply.rows.some((r) => r.key === "type")).toBe(false);
    expect(reply.rows.some((r) => r.key === "handle")).toBe(false);
  });

  test("the count falls back to the objects actually kept", () => {
    const reply = parseProperties({ objects: [CIRCLE, LINE] }, LAYERS);
    if (reply === null || reply.kind !== "objects") throw new Error("expected objects");
    expect(reply.count).toBe(2);
  });

  test("G3: the editable rows are exactly properties.set's parameter names", () => {
    const reply = parseProperties({ count: 1, objects: [CIRCLE] }, LAYERS);
    if (reply === null || reply.kind !== "objects") throw new Error("expected objects");
    const editable = reply.rows.filter((r) => r.editable).map((r) => r.key).sort();
    // `run_set` reads exactly these keys off the params object (crates/engine/src/cmd/props.rs).
    expect(editable).toEqual(["color", "layer", "linetype", "lineweight", "ltscale", "thickness", "transparency", "visible"]);
  });
});

describe("buildPatch", () => {
  test("numbers stay numbers, booleans become booleans, the rest stays a string", () => {
    expect(buildPatch({ ltscale: "2.5" })).toEqual({ ltscale: 2.5 });
    expect(buildPatch({ thickness: "0" })).toEqual({ thickness: 0 });
    expect(buildPatch({ visible: "true" })).toEqual({ visible: true });
    expect(buildPatch({ visible: "false" })).toEqual({ visible: false });
    expect(buildPatch({ layer: "Walls" })).toEqual({ layer: "Walls" });
    expect(buildPatch({ lineweight: "0.25 mm" })).toEqual({ lineweight: "0.25 mm" });
  });

  test("only the edited keys are included", () => {
    expect(buildPatch({ layer: "Walls" })).toEqual({ layer: "Walls" });
    expect(buildPatch({})).toEqual({});
  });

  test("NaN/Infinity strings stay strings, so the engine refuses them loudly", () => {
    expect(buildPatch({ ltscale: "NaN" })).toEqual({ ltscale: "NaN" });
    expect(buildPatch({ ltscale: "Infinity" })).toEqual({ ltscale: "Infinity" });
  });

  test("hostile values never throw", () => {
    const hostile = { layer: null, color: 7, linetype: undefined } as unknown as Record<string, string>;
    expect(buildPatch(hostile)).toEqual({});
  });
});

describe("parseProperties — hostile input", () => {
  test("null, arrays, scalars and empty objects are null, never a throw", () => {
    expect(parseProperties(null, LAYERS)).toBeNull();
    expect(parseProperties(undefined, LAYERS)).toBeNull();
    expect(parseProperties([], LAYERS)).toBeNull();
    expect(parseProperties("No selection", LAYERS)).toBeNull();
    expect(parseProperties(42, LAYERS)).toBeNull();
    expect(parseProperties({}, LAYERS)).toBeNull();
    expect(parseProperties({ objects: "nope" }, LAYERS)).toBeNull();
  });

  test("non-object rows are dropped and non-finite numbers read empty", () => {
    const reply = parseProperties({ count: 3, objects: [null, 3, { layer: "0", color: "ByLayer", ltscale: NaN, visible: true }] }, LAYERS);
    if (reply === null || reply.kind !== "objects") throw new Error("expected objects");
    expect(reply.objects).toHaveLength(1);
    expect(reply.count).toBe(3);
    expect(row(reply, "ltscale").value).toBe("");
    expect(row(reply, "visible").value).toBe("true");
  });

  test("the no-selection marker alone still parses (with whatever rows are there)", () => {
    const reply = parseProperties({ selection: "No selection" }, LAYERS);
    expect(reply?.kind).toBe("defaults");
    if (reply === null || reply.kind !== "defaults") return;
    expect(reply.rows).toEqual([]);
  });
});
