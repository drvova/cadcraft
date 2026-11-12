/**
 * The command line's text side: folding the facade's replies (the engine's command-line state)
 * into the visible prompt, keywords and capped output, including the two-step prompt cycle and
 * hostile replies.
 */

import { describe, expect, test } from "bun:test";
import {
  capLines,
  emptyPrompt,
  formatOrdinate,
  formatPoint,
  formatSelectBox,
  keywordHint,
  MAX_OUTPUT_LINES,
  parseAccept,
  parseCmdlineReply,
  pointerWants,
  promptText,
  reducePrompt,
  type PromptAccept,
} from "./prompt";

const idle = JSON.stringify({ prompt: "", running: null, keywords: [], accept: null, buffer: "", history: [] });
const circleCentre = JSON.stringify({
  prompt: "Specify center point for circle:",
  running: "circle",
  keywords: ["2Point", "3Point", "Ttr"],
  accept: "point",
  buffer: "",
  history: [],
});
const circleRadius = JSON.stringify({
  prompt: "Specify radius of circle:",
  running: "circle",
  keywords: ["Diameter"],
  accept: "number",
  buffer: "",
  history: [],
  output: ["Regenerating model."],
});
const refused = JSON.stringify({ prompt: "Specify radius of circle:", running: "circle", keywords: [], accept: "number", output: [], error: "Value must be positive and numeric." });

describe("parseCmdlineReply", () => {
  test("reads the engine's state shape and ignores its extra keys", () => {
    const reply = parseCmdlineReply(circleCentre);
    expect(reply).not.toBeNull();
    expect(reply?.prompt).toBe("Specify center point for circle:");
    expect(reply?.running).toBe("circle");
    expect(reply?.keywords).toEqual(["2Point", "3Point", "Ttr"]);
    expect(reply?.accept).toEqual({ point: true, number: false, text: false, select: false, enter: true });
    expect(reply?.error).toBeNull();
  });

  test("reads the engine's accept flags, and a canned facade's one word", () => {
    const engine = parseCmdlineReply(JSON.stringify({ prompt: "MOVE Select objects:", running: "move", keywords: [], accept: { point: true, number: false, text: false, select: true, enter: true } }));
    expect(engine?.accept).toEqual({ point: true, number: false, text: false, select: true, enter: true });
    expect(parseAccept("number")).toEqual({ point: false, number: true, text: false, select: false, enter: true });
    expect(parseAccept("select")?.point).toBe(true);
    // Flags that are not booleans are off, never truthy by accident.
    expect(parseAccept({ point: "yes", number: 1, select: null })).toEqual({ point: false, number: false, text: false, select: false, enter: false });
    for (const junk of [null, undefined, 3, "anything", [], ["point"]]) expect(parseAccept(junk)).toBeNull();
  });

  test("returns null for junk instead of throwing", () => {
    expect(parseCmdlineReply("nope")).toBeNull();
    expect(parseCmdlineReply("[]")).toBeNull();
    expect(parseCmdlineReply("")).toBeNull();
  });
});

describe("reducePrompt", () => {
  test("walks the two-step circle prompt: idle, centre, radius", () => {
    let state = reducePrompt(emptyPrompt(), idle);
    expect(promptText(state)).toBe("Command:");
    expect(keywordHint(state)).toBeNull();

    state = reducePrompt(state, circleCentre, "circle");
    expect(promptText(state)).toBe("Specify center point for circle:");
    expect(state.running).toBe("circle");
    expect(keywordHint(state)).toBe("2Point / 3Point / Ttr");
    expect(state.output).toEqual(["circle"]);

    state = reducePrompt(state, circleRadius, "0,0");
    expect(promptText(state)).toBe("Specify radius of circle:");
    expect(state.output).toEqual(["circle", "0,0", "Regenerating model."]);

    state = reducePrompt(state, idle, "5");
    expect(promptText(state)).toBe("Command:");
    expect(state.running).toBeNull();
    expect(state.output).toEqual(["circle", "0,0", "Regenerating model.", "5"]);
  });

  test("surfaces a refusal and clears it on the next good reply", () => {
    let state = reducePrompt(emptyPrompt(), circleCentre, "circle");
    state = reducePrompt(state, refused, "abc");
    expect(state.error).toBe("Value must be positive and numeric.");
    state = reducePrompt(state, circleRadius, "5");
    expect(state.error).toBeNull();
  });

  test("an unreadable reply keeps the previous state and reports it", () => {
    const before = reducePrompt(emptyPrompt(), circleCentre, "circle");
    const after = reducePrompt(before, "}{ not json", "x");
    expect(after.prompt).toBe(before.prompt);
    expect(after.error).toBe("the command line returned an unreadable reply");
  });

  test("does not echo an empty submit into the output", () => {
    const state = reducePrompt(emptyPrompt(), idle, "");
    expect(state.output).toEqual([]);
  });
});

describe("capLines", () => {
  test("keeps the tail", () => {
    expect(capLines(["a", "b", "c"], 2)).toEqual(["b", "c"]);
    expect(capLines(["a"], 5)).toEqual(["a"]);
    expect(capLines(["a"], 0)).toEqual([]);
  });

  test("the folded output never exceeds the cap", () => {
    let state = emptyPrompt();
    for (let i = 0; i < MAX_OUTPUT_LINES + 25; i++) {
      state = reducePrompt(state, JSON.stringify({ prompt: "p", running: null, keywords: [], accept: null, output: [`line ${i}`] }));
    }
    expect(state.output.length).toBe(MAX_OUTPUT_LINES);
    expect(state.output.at(-1)).toBe(`line ${MAX_OUTPUT_LINES + 24}`);
  });
});

describe("pointerWants", () => {
  const up = (accept: PromptAccept | null, running: string | null = "line") => ({ ...emptyPrompt(), running, accept });
  const flags = (on: Partial<PromptAccept>): PromptAccept => ({ point: false, number: false, text: false, select: false, enter: true, ...on });

  test("with nothing running the drawing selects", () => {
    expect(pointerWants(emptyPrompt())).toBe("idle");
  });

  test("a point prompt takes a click as its point, and so does a radius that takes either", () => {
    expect(pointerWants(up(flags({ point: true })))).toBe("point");
    expect(pointerWants(up(flags({ point: true, number: true }), "circle"))).toBe("point");
  });

  test("a Select objects prompt picks, although it also takes points", () => {
    expect(pointerWants(up(flags({ point: true, select: true }), "move"))).toBe("select");
  });

  test("a prompt for a keyword, a number or text leaves the click alone", () => {
    expect(pointerWants(up(flags({ number: true }), "offset"))).toBe("typed");
    expect(pointerWants(up(flags({ text: true }), "text"))).toBe("typed");
    expect(pointerWants(up(flags({})))).toBe("typed");
    // A command is running and the facade did not say what it takes: do nothing by guess.
    expect(pointerWants(up(null))).toBe("typed");
  });

  test("follows the facade's replies through a command", () => {
    let state = reducePrompt(emptyPrompt(), circleCentre, "circle");
    expect(pointerWants(state)).toBe("point");
    state = reducePrompt(state, circleRadius, "0,0");
    expect(pointerWants(state)).toBe("typed");
    state = reducePrompt(state, idle, "5");
    expect(pointerWants(state)).toBe("idle");
  });
});

describe("formatPoint", () => {
  test("writes x,y a thousand times finer than a pixel, without trailing zeros", () => {
    expect(formatPoint({ x: 12.3456789, y: -4.5 }, 0.02)).toBe("12.34568,-4.5");
    expect(formatPoint({ x: 1234.5678, y: 80 }, 3)).toBe("1234.568,80");
    expect(formatPoint({ x: 0.000123456789, y: 0 }, 1e-7)).toBe("0.0001234568,0");
  });

  test("the written point is within a thousandth of a pixel of the clicked one at any zoom", () => {
    for (const perPixel of [1e-7, 0.003, 0.02, 1, 47, 1e7]) {
      const point = { x: 1234.56789012345 * perPixel, y: -987.654321098765 * perPixel };
      const [x, y] = (formatPoint(point, perPixel) ?? "").split(",").map(Number);
      expect(Math.abs((x ?? NaN) - point.x)).toBeLessThanOrEqual(perPixel / 1000);
      expect(Math.abs((y ?? NaN) - point.y)).toBeLessThanOrEqual(perPixel / 1000);
    }
  });

  test("never writes an exponent, a negative zero or a blank", () => {
    expect(formatPoint({ x: 1e-9, y: -1e-12 }, 1)).toBe("0,0");
    expect(formatPoint({ x: 1e-9, y: -1e-12 }, 1e-7)).toBe("0.000000001,0");
    expect(formatPoint({ x: -0, y: 123456789012 }, 1e7)).toBe("0,123456789012");
    expect(formatOrdinate(1e-7, 15)).toBe("0.0000001");
    expect(formatPoint({ x: 5e-7, y: 2 }, NaN)).toBe("0.0000005,2");
  });

  test("a pixel size that is not usable writes the point in full", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(formatPoint({ x: 0.1 + 0.2, y: 1 }, bad)).toBe("0.3,1");
    }
    expect(formatPoint({ x: 1 / 3, y: 0 }, 0)).toBe("0.333333333333333,0");
  });

  test("a point that is not finite, or beyond what decimals can write, sends nothing", () => {
    expect(formatPoint({ x: NaN, y: 0 }, 1)).toBeNull();
    expect(formatPoint({ x: 0, y: Infinity }, 1)).toBeNull();
    expect(formatPoint({ x: 1e21, y: 0 }, 1)).toBeNull();
    expect(formatOrdinate(1.5, NaN)).toBe("1.5");
  });
});

describe("formatSelectBox", () => {
  const rect = { x0: 1, y0: 2, x1: 5, y1: 8 };

  test("a window goes left to right and a crossing right to left, as the engine's BOX reads them", () => {
    expect(formatSelectBox(rect, "window", 0.01)).toBe("BOX 1,2 5,8");
    expect(formatSelectBox(rect, "crossing", 0.01)).toBe("BOX 5,2 1,8");
  });

  test("a corner that is not finite sends nothing", () => {
    expect(formatSelectBox({ ...rect, x1: NaN }, "window", 0.01)).toBeNull();
  });
});
