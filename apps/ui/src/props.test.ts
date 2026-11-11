/**
 * The properties palette's pure logic. The fixtures are copied from the real reply shapes in
 * `crates/engine/src/cmd/props.rs` (`run_get` and `entity_props`): the no-selection defaults and
 * the per-object rows with the engine's computed geometry numbers. The engine was not run for
 * them — the shapes are transcribed from that file, as the brief allows.
 */

import { describe, expect, test } from "bun:test";
import { buildPatch, COLOR_CHOICES, INFINITE, judgeDraft, LINEWEIGHT_CHOICES, NOT_A_NUMBER, numberText, parseProperties, readNumber, VARIES, type PropRow, type PropertiesReply } from "./props";

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
    expect(buildPatch({ thickness: "1e999" })).toEqual({ thickness: "1e999" });
    expect(buildPatch({ thickness: "0x10" })).toEqual({ thickness: "0x10" });
  });

  test("a number row reads a single decimal comma; anything ambiguous stays a string", () => {
    expect(buildPatch({ ltscale: "2,5" })).toEqual({ ltscale: 2.5 });
    expect(buildPatch({ thickness: " -0,25 " })).toEqual({ thickness: -0.25 });
    expect(buildPatch({ thickness: "1,234,567" })).toEqual({ thickness: "1,234,567" });
    expect(buildPatch({ thickness: "1.234,5" })).toEqual({ thickness: "1.234,5" });
  });

  test("a name row is never turned into a number or a boolean", () => {
    // `run_set` reads `layer` and `linetype` with `str_param`: a JSON number there is skipped in silence.
    expect(buildPatch({ layer: "0" })).toEqual({ layer: "0" });
    expect(buildPatch({ layer: "true" })).toEqual({ layer: "true" });
    expect(buildPatch({ linetype: "2" })).toEqual({ linetype: "2" });
    expect(buildPatch({ transparency: "50" })).toEqual({ transparency: "50" });
    expect(buildPatch({ transparency: "50%" })).toEqual({ transparency: "50%" });
    expect(buildPatch({ color: "ByLayer" })).toEqual({ color: "ByLayer" });
  });

  test("the space around a value is not part of it; the tick takes only true and false", () => {
    expect(buildPatch({ linetype: "  Hidden\n" })).toEqual({ linetype: "Hidden" });
    expect(buildPatch({ visible: " true " })).toEqual({ visible: true });
    expect(buildPatch({ visible: VARIES })).toEqual({ visible: VARIES });
  });

  test("hostile values never throw", () => {
    const hostile = { layer: null, color: 7, linetype: undefined } as unknown as Record<string, string>;
    expect(buildPatch(hostile)).toEqual({});
  });
});

describe("numberText", () => {
  test("ordinary magnitudes are plain digits with six decimals at most", () => {
    expect(numberText(0)).toBe("0");
    expect(numberText(-0)).toBe("0");
    expect(numberText(2.5)).toBe("2.5");
    expect(numberText(-31.41592653589793)).toBe("-31.415927");
    expect(numberText(0.1 + 0.2)).toBe("0.3");
    expect(numberText(0.000001)).toBe("0.000001");
    expect(numberText(123456789012345)).toBe("123456789012345");
    expect(numberText(1e12)).toBe("1000000000000");
  });

  test("a very large number is finite and readable, in exponent form from 1e15", () => {
    expect(numberText(1e15)).toBe("1e+15");
    expect(numberText(1.5e21)).toBe("1.5e+21");
    expect(numberText(-1.23456789e30)).toBe("-1.234568e+30");
    expect(numberText(1e305)).toBe("1e+305");
    expect(numberText(Number.MAX_VALUE)).toBe("1.797693e+308");
  });

  test("a very small number is not rounded to a false zero", () => {
    expect(numberText(2.5e-9)).toBe("2.5e-9");
    expect(numberText(-4e-7)).toBe("-4e-7");
    expect(numberText(Number.MIN_VALUE)).toBe("4.940656e-324");
  });

  test("NaN and the infinities are words, never a number", () => {
    expect(numberText(Number.NaN)).toBe(NOT_A_NUMBER);
    expect(numberText(Number.POSITIVE_INFINITY)).toBe(INFINITE);
    expect(numberText(Number.NEGATIVE_INFINITY)).toBe(`-${INFINITE}`);
    for (const words of [NOT_A_NUMBER, INFINITE, `-${INFINITE}`]) expect(readNumber(words).ok).toBe(false);
  });

  test("what is shown reads back as the number shown", () => {
    for (const value of [0, 2.5, -7, 1e-6, 2.5e-9, 123456789012345, 1e15, 1.5e21, 1e305, -1e12]) {
      expect(readNumber(numberText(value))).toEqual({ ok: true, value });
    }
  });
});

describe("readNumber", () => {
  const value = (text: string): number | string => {
    const reading = readNumber(text);
    return reading.ok ? reading.value : reading.fault;
  };

  test("a sign, digits, one dot and an exponent", () => {
    expect(value("5")).toBe(5);
    expect(value("+5")).toBe(5);
    expect(value("-5.25")).toBe(-5.25);
    expect(value(".5")).toBe(0.5);
    expect(value("5.")).toBe(5);
    expect(value("1e3")).toBe(1000);
    expect(value("2.5E-3")).toBe(0.0025);
    expect(Object.is(value("-0"), 0)).toBe(true);
  });

  test("empty text and white space are empty, not zero", () => {
    expect(value("")).toBe("empty");
    expect(value("  \t")).toBe("empty");
    expect(value("\r\n")).toBe("empty");
    expect(value("　")).toBe("empty");
  });

  test("space and a line break around the number are dropped; inside it they are not", () => {
    expect(value("  7 ")).toBe(7);
    expect(value("7\n")).toBe(7);
    expect(value("1 000")).toBe("form");
    expect(value("1\n2")).toBe("form");
    expect(value("- 5")).toBe("form");
  });

  test("a single comma followed by digits, with no dot, is the decimal mark", () => {
    expect(value("2,5")).toBe(2.5);
    expect(value("-2,5")).toBe(-2.5);
    expect(value(",5")).toBe(0.5);
    expect(value("2,5e2")).toBe(250);
    // By the rule, not by guessing the locale: one comma is a decimal mark, so this is 1.234.
    expect(value("1,234")).toBe(1.234);
  });

  test("ambiguous separators are refused", () => {
    for (const text of ["1,234,567", "1,2,3", "1.234,5", "1,234.5", "2,", "1..2", "1.2.3", "5,,5"]) {
      expect(value(text)).toBe("separators");
    }
  });

  test("a trailing unit is named as one", () => {
    for (const text of ["5mm", "5 mm", "2.5in", "2,5cm", '5"', "5'", "50%", "90°"]) {
      expect(value(text)).toBe("unit");
    }
  });

  test("hex, binary, words and expressions are not numbers", () => {
    for (const text of ["0x10", "0b11", "0o7", "abc", "Infinity", "-Infinity", "NaN", "1+1", "1/2", "--5", "e5", ".", ",", "+", "1e", "1_000"]) {
      expect(readNumber(text).ok).toBe(false);
    }
    expect(value("0x10")).toBe("form");
  });

  test("past the float range is its own fault", () => {
    expect(value("1e999")).toBe("range");
    expect(value("-1e999")).toBe("range");
    expect(value("1e-999")).toBe(0);
  });

  test("full-width digits and marks and the typographic minus are folded to ASCII", () => {
    expect(value("２．５")).toBe(2.5);
    expect(value("２，５")).toBe(2.5);
    expect(value("＋７")).toBe(7);
    expect(value("－７")).toBe(-7);
    expect(value("−7")).toBe(-7);
  });

  test("a non-string never throws", () => {
    expect(readNumber(null as unknown as string)).toEqual({ ok: false, fault: "form" });
    expect(readNumber(7 as unknown as string)).toEqual({ ok: false, fault: "form" });
  });
});

describe("number row bounds", () => {
  test("the linetype scale is above zero with an open top; thickness holds the THICKNESS command's range", () => {
    const reply = parseProperties({ count: 1, objects: [CIRCLE] }, LAYERS);
    expect(row(reply, "ltscale")).toMatchObject({ kind: "number", min: 0, minExclusive: true });
    expect(row(reply, "ltscale").max).toBeUndefined();
    expect(row(reply, "thickness")).toMatchObject({ kind: "number", min: -1e12, max: 1e12 });
    expect(row(reply, "thickness").minExclusive).toBeUndefined();
  });

  test("the drawing's default scale carries the same bound; rows that are not numbers carry none", () => {
    const reply = parseProperties(DEFAULTS, LAYERS);
    expect(row(reply, "linetypeScale")).toMatchObject({ min: 0, minExclusive: true });
    expect(row(reply, "textHeight").min).toBeUndefined();
    expect(row(reply, "layer").min).toBeUndefined();
    expect(row(reply, "layer").max).toBeUndefined();
  });

  test("a refusal names the bound the row carries", () => {
    const reply = parseProperties({ count: 1, objects: [CIRCLE] }, LAYERS);
    expect(judgeDraft(row(reply, "ltscale"), "0")).toEqual({ kind: "refuse", message: "Linetype scale needs a number above 0" });
    expect(judgeDraft(row(reply, "thickness"), "2e12")).toEqual({ kind: "refuse", message: "Thickness needs a number from -1e12 to 1e12" });
    expect(judgeDraft({ ...row(reply, "thickness"), min: 0, minExclusive: true, max: 10 }, "11")).toEqual({ kind: "refuse", message: "Thickness needs a number above 0, up to 10" });
    expect(judgeDraft({ ...row(reply, "thickness"), min: 1, max: undefined }, "0.5")).toEqual({ kind: "refuse", message: "Thickness needs a number from 1 up" });
    expect(judgeDraft({ ...row(reply, "thickness"), min: undefined, max: 5 }, "6")).toEqual({ kind: "refuse", message: "Thickness needs a number up to 5" });
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

  test("non-object rows are dropped; a number that is not one reads as words, a missing one empty", () => {
    const reply = parseProperties({ count: 3, objects: [null, 3, { layer: "0", color: "ByLayer", ltscale: NaN, thickness: null, visible: true }] }, LAYERS);
    if (reply === null || reply.kind !== "objects") throw new Error("expected objects");
    expect(reply.objects).toHaveLength(1);
    expect(reply.count).toBe(3);
    expect(row(reply, "ltscale").value).toBe(NOT_A_NUMBER);
    expect(row(reply, "thickness").value).toBe("");
    expect(row(reply, "transparency").value).toBe("");
    expect(row(reply, "visible").value).toBe("true");
  });

  test("an infinity from the engine reads as a word, with its sign", () => {
    const reply = parseProperties({ count: 1, objects: [{ ...CIRCLE, thickness: Infinity, area: -Infinity }] }, LAYERS);
    if (reply === null || reply.kind !== "objects") throw new Error("expected objects");
    expect(row(reply, "thickness").value).toBe(INFINITE);
    expect(row(reply, "area").value).toBe(`-${INFINITE}`);
  });

  test("the no-selection marker alone still parses (with whatever rows are there)", () => {
    const reply = parseProperties({ selection: "No selection" }, LAYERS);
    expect(reply?.kind).toBe("defaults");
    if (reply === null || reply.kind !== "defaults") return;
    expect(reply.rows).toEqual([]);
  });
});
