/**
 * The command line's text side: folding the facade's replies (the engine's command-line state)
 * into the visible prompt, keywords and capped output, including the two-step prompt cycle and
 * hostile replies.
 */

import { describe, expect, test } from "bun:test";
import { capLines, emptyPrompt, keywordHint, MAX_OUTPUT_LINES, parseCmdlineReply, promptText, reducePrompt } from "./prompt";

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
    expect(reply?.accept).toBe("point");
    expect(reply?.error).toBeNull();
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
