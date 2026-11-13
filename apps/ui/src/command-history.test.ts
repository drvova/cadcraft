import { describe, expect, test } from "bun:test";
import { commandHistory, MAX_HISTORY } from "./command-history";
import { emptyPrompt, freshError, type PromptState } from "./prompt";

const prompt = (over: Partial<PromptState>): PromptState => ({ ...emptyPrompt(), ...over });

describe("the submitted lines the arrows walk (shared with the SolidJS panel)", () => {
  test("Up is older, Down is newer, and beyond either end nothing changes", () => {
    const h = commandHistory();
    expect(h.recall(1)).toBeNull();
    for (const line of ["LINE", "0,0", "CIRCLE"]) h.remember(line);
    expect(h.recall(1)).toBe("CIRCLE");
    expect(h.recall(1)).toBe("0,0");
    expect(h.recall(1)).toBe("LINE");
    expect(h.recall(1)).toBeNull();
    expect(h.recall(-1)).toBe("0,0");
    expect(h.recall(-1)).toBe("CIRCLE");
    // Newer than the newest is the empty line; newer than that is nothing.
    expect(h.recall(-1)).toBe("");
    expect(h.recall(-1)).toBeNull();
  });

  test("an empty line and a repeat of the last one are not remembered; typing ends the walk", () => {
    const h = commandHistory();
    h.remember("LINE");
    h.remember("LINE");
    h.remember("   ");
    h.remember("");
    expect(h.recall(1)).toBe("LINE");
    expect(h.recall(1)).toBeNull();
    h.reset();
    expect(h.recall(1)).toBe("LINE");
    // A submitted line ends the walk too.
    h.remember("ARC");
    expect(h.recall(1)).toBe("ARC");
  });

  test("the walk is capped, and a step that is no step moves nothing", () => {
    const h = commandHistory();
    for (let i = 0; i < MAX_HISTORY + 50; i++) h.remember(`L${i}`);
    let count = 0;
    while (h.recall(1) !== null && count < MAX_HISTORY * 2) count += 1;
    expect(count).toBe(MAX_HISTORY);
    const small = commandHistory(Number.NaN);
    small.remember("A");
    for (const step of [0, 2, -7, Number.NaN, Number.POSITIVE_INFINITY, 0.5]) expect(small.recall(step)).toBeNull();
    expect(small.recall(1)).toBe("A");
    const none = commandHistory(-3);
    none.remember("A");
    expect(none.recall(1)).toBeNull();
  });
});

describe("the error beside the field (shared with the SolidJS panel)", () => {
  test("the prompt's own error first, then the shell's notice; none when there is nothing to say", () => {
    expect(freshError(prompt({ error: "bad point" }), "a notice")).toBe("bad point");
    expect(freshError(prompt({}), "a notice")).toBe("a notice");
    expect(freshError(prompt({}), null)).toBeNull();
    expect(freshError(prompt({}), undefined)).toBeNull();
    expect(freshError(prompt({ error: "" }), null)).toBeNull();
  });

  test("an error the history's last line already says is not said twice", () => {
    expect(freshError(prompt({ error: "unknown command `FOO`", output: ["FOO", "unknown command `FOO`"] }), null)).toBeNull();
    expect(freshError(prompt({ error: "must be positive", output: ["Value must be positive and nonzero."] }), null)).toBeNull();
    expect(freshError(prompt({ error: "unknown command `FOO`", output: ["unknown command `FOO`", "LINE"] }), null)).toBe("unknown command `FOO`");
  });
});
