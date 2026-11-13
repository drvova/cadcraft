import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commandHistory, MAX_HISTORY } from "../command-history";
import { emptyPrompt, freshError, IDLE_PROMPT, MAX_KEYWORDS, type PromptState } from "../prompt";
import {
  CMD_MEASURES,
  cmdlineParams,
  columnsFor,
  droppedLines,
  errorText,
  historyLines,
  keyRows,
  lineText,
  MAX_COLUMNS,
  MAX_ERROR_CHARS,
  MAX_KEYWORD_CHARS,
  MAX_LINE_CHARS,
  MAX_LINE_PARTS,
  MAX_PAINTED_LINES,
  MAX_SHOWN_LINES,
  MIN_COLUMNS,
  pagedScroll,
  panelHeight,
  pressedKeyword,
  tailScroll,
  wrapLine,
  wrappedLines,
  type CmdPage,
} from "./cmdline-params";
import { mapTokens } from "./tokens";

const ui = join(import.meta.dir, "..", "..");
const source = readFileSync(join(ui, "slab", "cmdline.slab"), "utf8");
const host = readFileSync(join(ui, "src", "slab", "SlabCommandLine.tsx"), "utf8");

/** A page 688 wide (the editor pane at 1280) whose faces are 7.2 (mono), 6 (label) and 6 (chip) a character. */
const page: CmdPage = { width: 688, monoAdvance: 7.2, labelAdvance: 6, keyWidth: (word) => word.length * 6, errorWidth: (text) => text.length * 6 };

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

describe("a line of the history for the kernel", () => {
  test("one line, its spaces kept (the lines are columns), control characters and tabs as spaces", () => {
    expect(lineText("  X = 1.5   Y = 2")).toBe("  X = 1.5   Y = 2");
    expect(lineText("a\tb\nc d\u0007e\u009bf")).toBe("a b c d e f");
    expect(lineText("")).toBe("");
  });

  test("a line too long to read ends in an ellipsis", () => {
    const long = lineText("x".repeat(MAX_LINE_CHARS + 500));
    expect([...long]).toHaveLength(MAX_LINE_CHARS + 1);
    expect(long.endsWith("…")).toBe(true);
  });

  test("the columns are the panel less the column and the end, over the face's advance", () => {
    // 688 - 12 - 8 = 668; 668 / 7.2 = 92.7.
    expect(columnsFor(688, 7.2)).toBe(92);
    expect(columnsFor(390, 7.2)).toBe(51);
    // Exactly a whole number of characters: the last one fits.
    expect(columnsFor(12 + 8 + 72, 7.2)).toBe(10);
  });

  test("a width or an advance that is no length cuts nothing, and a sliver still has columns", () => {
    for (const [w, a] of [[0, 7.2], [-5, 7.2], [Number.NaN, 7.2], [688, 0], [688, -1], [688, Number.NaN], [Number.POSITIVE_INFINITY, 7.2], [688, Number.POSITIVE_INFINITY]] as const) expect(columnsFor(w, a)).toBe(MAX_COLUMNS);
    expect(columnsFor(30, 7.2)).toBe(MIN_COLUMNS);
    expect(columnsFor(1e9, 0.001)).toBe(MAX_COLUMNS);
  });

  test("a long line breaks at the last space that fits, which stays at the end of its line", () => {
    expect(wrapLine("LINE Specify next point or [Undo]:", 20)).toEqual(["LINE Specify next ", "point or [Undo]:"]);
    expect(wrapLine("short", 20)).toEqual(["short"]);
    expect(wrapLine("", 20)).toEqual([""]);
    // Exactly the width: one line. The parts are the line, nothing lost.
    expect(wrapLine("x".repeat(20), 20)).toEqual(["x".repeat(20)]);
    const text = "unknown command `FROBNICATE_THE_WHOLE_DRAWING_WITH_A_VERY_LONG_NAME` and more";
    expect(wrapLine(text, 24).join("")).toBe(text);
    for (const part of wrapLine(text, 24)) expect([...part].length).toBeLessThanOrEqual(24);
  });

  test("a word longer than the line breaks where it must; a break never splits a character", () => {
    expect(wrapLine("a".repeat(25), 10)).toEqual(["a".repeat(10), "a".repeat(10), "a".repeat(5)]);
    const wide = "\u{1F48E}".repeat(12);
    const parts = wrapLine(wide, 8);
    expect(parts).toEqual(["\u{1F48E}".repeat(8), "\u{1F48E}".repeat(4)]);
  });

  test("hostile widths: never fewer than the least columns, never an endless line of parts", () => {
    for (const columns of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY, 0.2]) expect(wrapLine("x".repeat(20), columns).every((p) => [...p].length <= Math.max(MIN_COLUMNS, 20))).toBe(true);
    expect(wrapLine("x".repeat(20), Number.POSITIVE_INFINITY)).toEqual(["x".repeat(20)]);
    const parts = wrapLine("x".repeat(MAX_LINE_CHARS), MIN_COLUMNS);
    expect(parts).toHaveLength(MAX_LINE_PARTS);
    expect(parts[parts.length - 1]?.endsWith("…")).toBe(true);
  });
});

describe("the history's lines", () => {
  test("each line is numbered from the first, and the last is the one being answered", () => {
    const lines = historyLines(["LINE", "Command: LINE", "*Cancel*"], 0, 92);
    expect(lines).toEqual([
      { key: "0", t: "LINE", newest: false },
      { key: "1", t: "Command: LINE", newest: false },
      { key: "2", t: "*Cancel*", newest: true },
    ]);
  });

  test("a wrapped line is several painted lines under one number, all of them the newest when it is", () => {
    const lines = historyLines(["ok", "a".repeat(25)], 7, 10);
    expect(lines.map((l) => l.key)).toEqual(["7", "8.0", "8.1", "8.2"]);
    expect(lines.map((l) => l.newest)).toEqual([false, true, true, true]);
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });

  test("the capped tail lets its oldest lines go, and the lines kept keep their numbers", () => {
    const before = ["a", "b", "c", "d"];
    expect(droppedLines(before, ["a", "b", "c", "d", "e"])).toBe(0);
    expect(droppedLines(before, ["c", "d", "e", "f"])).toBe(2);
    expect(droppedLines(before, ["d", "x"])).toBe(3);
    // Nothing of it is kept: another history.
    expect(droppedLines(before, ["x", "y"])).toBe(4);
    expect(droppedLines(before, [])).toBe(4);
    expect(droppedLines([], ["a"])).toBe(0);
    // The same line many times over: the fewest dropped that fits.
    expect(droppedLines(["a", "a", "a"], ["a", "a", "a"])).toBe(0);
    expect(droppedLines(["a", "a", "a"], ["a", "a"])).toBe(1);

    // A script of 1,000 lines through a tail of 200: every line that stays on keeps its key.
    let output: string[] = [];
    let first = 0;
    let keys = new Map<string, string>();
    for (let i = 0; i < 1000; i++) {
      const next = [...output, `line ${i}`].slice(-200);
      first += droppedLines(output, next);
      output = next;
      const now = new Map(historyLines(output, first, 92).map((l) => [l.key, l.t]));
      for (const [key, t] of now) if (keys.has(key)) expect(keys.get(key)).toBe(t);
      keys = now;
    }
    expect(first).toBe(800);
    expect(historyLines(output, first, 92)[0]).toEqual({ key: "800", t: "line 800", newest: false });
  });

  test("thousands of lines are capped to the newest, and a first number that is none is 0", () => {
    const many = Array.from({ length: MAX_PAINTED_LINES + 3000 }, (_, i) => `l${i}`);
    const lines = historyLines(many, 0, 92);
    expect(lines).toHaveLength(MAX_PAINTED_LINES);
    expect(lines[lines.length - 1]).toEqual({ key: String(many.length - 1), t: `l${many.length - 1}`, newest: true });
    for (const first of [-1, Number.NaN, 1.5, Number.POSITIVE_INFINITY]) expect(historyLines(["a"], first, 92)[0]?.key).toBe("0");
  });
});

describe("the keywords", () => {
  const circle = ["3P", "2P", "Ttr (tan tan radius)"];

  test("one row while they fit, keyed by their place in the prompt's list", () => {
    const rows = keyRows(circle, 688, page.keyWidth);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.words).toEqual([
      { key: "k0", word: "3P", lead: false },
      { key: "k1", word: "2P", lead: true },
      { key: "k2", word: "Ttr (tan tan radius)", lead: true },
    ]);
  });

  test("a row ends where the next keyword would pass the panel's end", () => {
    // Each is 5 characters: 30 + 16 = 46 wide, 4 apart, in 120 - 4 - 8 = 108: two to a row.
    const rows = keyRows(["Alpha", "Bravo", "Delta", "Gamma", "Omega"], 120, page.keyWidth);
    expect(rows.map((r) => r.words.map((w) => w.word))).toEqual([["Alpha", "Bravo"], ["Delta", "Gamma"], ["Omega"]]);
    expect(rows.map((r) => r.key)).toEqual(["r0", "r1", "r2"]);
    // The gap is before every keyword but a row's first.
    expect(rows.map((r) => r.words.map((w) => w.lead))).toEqual([[false, true], [false, true], [false]]);
    // A keyword wider than the panel has a row to itself; a panel with no width yet is one row.
    expect(keyRows(["A", "A very long keyword indeed", "B"], 60, page.keyWidth).map((r) => r.words.length)).toEqual([1, 1, 1]);
    expect(keyRows(circle, 0, page.keyWidth)).toHaveLength(1);
    expect(keyRows(circle, Number.NaN, () => Number.NaN)).toHaveLength(1);
  });

  test("capped in number and in length; an empty one is not drawn but keeps its place", () => {
    const many = Array.from({ length: 80 }, (_, i) => `K${i}`);
    expect(keyRows(many, 1e6, page.keyWidth).flatMap((r) => r.words)).toHaveLength(MAX_KEYWORDS);
    const long = keyRows(["x".repeat(200)], 688, page.keyWidth)[0]?.words[0]?.word ?? "";
    expect([...long]).toHaveLength(MAX_KEYWORD_CHARS);
    expect(keyRows(["A", " ", "B"], 688, page.keyWidth)[0]?.words.map((w) => w.key)).toEqual(["k0", "k2"]);
  });

  test("a pressed keyword is read back by its place; a stale or forged key answers nothing", () => {
    expect(pressedKeyword(circle, "k0")).toBe("3P");
    expect(pressedKeyword(circle, "k2")).toBe("Ttr (tan tan radius)");
    for (const key of ["", "k3", "k99", "k-1", "k1e1", "k 1", "1", "r0", "k0/row@0", "__proto__", "k9999999999", `k${MAX_KEYWORDS}`]) expect(pressedKeyword(circle, key)).toBeNull();
    // What is submitted is the prompt's own word, never the drawn (capped) one.
    const long = "x".repeat(200);
    expect(pressedKeyword([long], "k0")).toBe(long);
  });
});

describe("the panel's params and its height", () => {
  test("idle: no history, no keywords, the prompt said; as tall as the SolidJS panel (37)", () => {
    const params = cmdlineParams(prompt({}), null, 0, page);
    expect(params.lines).toEqual([]);
    expect(params.key_rows).toEqual([]);
    expect([params.out_h, params.out_gap, params.keys_gap, params.pad_t, params.pad_b, params.entry_h]).toEqual([0, 0, 0, 6, 6, 24]);
    expect(params.said).toBe(IDLE_PROMPT);
    expect(params.failed).toBe(false);
    expect(panelHeight(params)).toBe(37);
  });

  test("the heights measured on the SolidJS panel: two lines and keywords 101, five and keywords 149, five alone 121", () => {
    const two = cmdlineParams(prompt({ output: ["CIRCLE", "Command: CIRCLE"], keywords: ["3P", "2P"], prompt: "CIRCLE Specify center point:", running: "circle" }), null, 0, page);
    expect(panelHeight(two)).toBe(101);
    expect(two.said).toBe("CIRCLE Specify center point:");
    const output = ["a", "b", "c", "d", "e", "f", "g"];
    expect(panelHeight(cmdlineParams(prompt({ output, keywords: ["Undo"] }), null, 0, page))).toBe(149);
    const five = cmdlineParams(prompt({ output }), null, 0, page);
    expect(panelHeight(five)).toBe(121);
    // The history shows five lines and scrolls the rest.
    expect(five.out_h).toBe(MAX_SHOWN_LINES * CMD_MEASURES.line);
    expect(five.lines).toHaveLength(7);
    expect(tailScroll(five)).toBe(2 * CMD_MEASURES.line);
  });

  test("an error on one line is as wide as its words; a longer one takes the cap and a second line", () => {
    const short = cmdlineParams(prompt({}), "bad point", 0, page);
    expect(short.failed).toBe(true);
    expect(short.error).toBe("bad point");
    expect(short.err_w).toBe(55);
    expect(short.entry_h).toBe(24);
    expect(short.errCut).toBe(false);
    const long = cmdlineParams(prompt({}), "invalid parameters for `properties.set`: linetype `abc` is not loaded", 0, page);
    // 40 characters of the face, under half the panel.
    expect(long.err_w).toBe(240);
    expect(long.entry_h).toBe(28);
    expect(long.errCut).toBe(false);
    // Half the panel when that is the lesser.
    expect(cmdlineParams(prompt({}), "x".repeat(100), 0, { ...page, width: 300 }).err_w).toBe(150);
  });

  test("two lines of error stand over the row by 2 above and below, and the panel is no taller", () => {
    const error = "invalid parameters for `properties.set`: linetype `abc` is not loaded";
    const alone = cmdlineParams(prompt({}), error, 0, page);
    expect([alone.pad_t, alone.entry_h, alone.pad_b]).toEqual([4, 28, 4]);
    expect(panelHeight(alone)).toBe(37);
    const history = cmdlineParams(prompt({ output: ["a", "b"] }), error, 0, page);
    expect([history.pad_t, history.out_gap, history.entry_h, history.pad_b]).toEqual([6, 2, 28, 4]);
    expect(panelHeight(history)).toBe(panelHeight(cmdlineParams(prompt({ output: ["a", "b"] }), null, 0, page)));
    const keys = cmdlineParams(prompt({ output: ["a", "b"], keywords: ["Undo"] }), error, 0, page);
    expect([keys.pad_t, keys.out_gap, keys.keys_gap, keys.entry_h, keys.pad_b]).toEqual([6, 4, 2, 28, 4]);
    expect(panelHeight(keys)).toBe(101);
  });

  test("an error longer than its two lines is cut, and says so for the hint", () => {
    const words = Array.from({ length: 40 }, () => "word").join(" ");
    const params = cmdlineParams(prompt({}), words, 0, page);
    expect(params.errCut).toBe(true);
    expect(wrappedLines("aa bb cc", 30, (run) => run.length * 6)).toBe(2);
    expect(wrappedLines("aa bb", 30, (run) => run.length * 6)).toBe(1);
    expect(wrappedLines("", 30, (run) => run.length * 6)).toBe(0);
    // A word wider than the line runs over the lines it needs.
    expect(wrappedLines("x".repeat(11), 30, (run) => run.length * 6)).toBe(3);
    // Counted to one past the cap and no further, whatever the measure says.
    expect(wrappedLines("x".repeat(4000), 30, (run) => run.length * 6)).toBe(3);
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(wrappedLines("a b", width, () => 6)).toBe(3);
    expect(wrappedLines("a b c d", 30, () => Number.NaN)).toBe(3);
  });

  test("an error for the kernel is one capped line; no error is none", () => {
    expect(errorText(null)).toBe("");
    expect(errorText("  two\nlines\tof   it ")).toBe("two lines of it");
    expect([...errorText("e".repeat(5000))]).toHaveLength(MAX_ERROR_CHARS);
    const params = cmdlineParams(prompt({}), "e ".repeat(5000), 0, page);
    expect([...params.error].length).toBeLessThanOrEqual(MAX_ERROR_CHARS);
  });

  test("hostile numbers from the page leave a panel that can be laid out", () => {
    const state = prompt({ output: ["a".repeat(500), "b"], keywords: ["Undo", "Close"] });
    for (const width of [0, -100, Number.NaN, Number.POSITIVE_INFINITY, 1e12]) {
      for (const advance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const hostile: CmdPage = { width, monoAdvance: advance, labelAdvance: advance, keyWidth: () => advance, errorWidth: () => advance };
        const params = cmdlineParams(state, "an error", 0, hostile);
        for (const n of [params.out_h, params.pad_t, params.pad_b, params.out_gap, params.keys_gap, params.entry_h, params.err_w]) {
          expect(Number.isFinite(n)).toBe(true);
          expect(n).toBeGreaterThanOrEqual(0);
        }
        expect(params.err_w).toBeGreaterThanOrEqual(1);
        expect(Number.isFinite(panelHeight(params))).toBe(true);
        expect(params.lines.length).toBeLessThanOrEqual(MAX_PAINTED_LINES);
      }
    }
  });

  test("Page Up and Page Down move the history a view less a line, and stop at its ends", () => {
    const params = cmdlineParams(prompt({ output: Array.from({ length: 20 }, (_, i) => `l${i}`) }), null, 0, page);
    expect(tailScroll(params)).toBe(15 * 16);
    expect(pagedScroll(240, -1, params)).toBe(240 - 64);
    expect(pagedScroll(30, -1, params)).toBe(0);
    expect(pagedScroll(200, 1, params)).toBe(240);
    for (const offset of [Number.NaN, Number.NEGATIVE_INFINITY]) expect(pagedScroll(offset, 1, params)).toBe(64);
    // A history that does not scroll has nowhere to go.
    const short = cmdlineParams(prompt({ output: ["a"] }), null, 0, page);
    expect(pagedScroll(0, 1, short)).toBe(0);
  });
});

describe("the command line's document", () => {
  const tokens = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8"));

  test("takes its inks and measures from the tokens, and names no font, colour or image", () => {
    const inks = new Set([...source.matchAll(/color\.([a-z0-9-]+)/g)].map((m) => m[1] ?? ""));
    expect(inks.size).toBeGreaterThan(6);
    for (const name of inks) expect(tokens.colors.has(name)).toBe(true);
    expect(source).toContain('import "gen/tokens.slab"');
    // The one colour written is the clear default of the ink the page hands over.
    expect([...source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])).toEqual([`#${"0".repeat(8)}`]);
    expect(source).not.toMatch(/\b(rgb|hsl)a?\(/);
    expect(source).not.toMatch(/font-family|family=|Inter|JetBrains|system-ui|url\(|\.(png|svg|woff2?|ttf)\b/);
    // The history is set in the mono style, whose face the page measures and registers.
    expect(source).toContain("text t style=text.mono nowrap");
    expect(tokens.textSizes.get("mono")).toBe(12);
  });

  test("the host's measures are the sheet's", () => {
    const size = tokens.lengths.get("size");
    const space = tokens.lengths.get("space");
    expect(CMD_MEASURES.edge).toBe(size?.get("hairline") ?? -1);
    expect(CMD_MEASURES.row).toBe(size?.get("control-h-input") ?? -1);
    expect(CMD_MEASURES.line).toBe(tokens.leading);
    expect(CMD_MEASURES.pad).toBe(space?.get("g6") ?? -1);
    expect(CMD_MEASURES.gap).toBe(space?.get("g4") ?? -1);
    expect(CMD_MEASURES.column).toBe(space?.get("g12") ?? -1);
    expect(CMD_MEASURES.end).toBe(space?.get("g8") ?? -1);
    expect(CMD_MEASURES.keyPad).toBe(space?.get("g8") ?? -1);
    expect(CMD_MEASURES.keyGap).toBe(space?.get("g4") ?? -1);
    expect(CMD_MEASURES.keyStart).toBe(space?.get("g4") ?? -1);
    // The list's item extent is a constant of the document: it is the line the host counts with.
    expect(source).toContain(`virtual item-extent=${CMD_MEASURES.line} `);
    expect(source).toContain("row w=fill h=size.leading-ui pad=0,space.g8,0,space.g12");
    expect(source).toContain("pad_t    num = 6");
    expect(source).toContain("entry_h  num = 24");
  });

  test("the history is a virtual list that is a log, selectable, and holds nothing that takes the focus", () => {
    expect(source).toMatch(/col #out [^{]*scroll[^{]*\\\n[^{]*select [^{]*role=log label="Command history" \{\n\s+each param\.lines key=lines virtual /);
    const line = source.slice(source.indexOf("def CmdLine("), source.indexOf("def CmdKey("));
    expect(line).not.toMatch(/\b(act|press|field|drag)=|\bfocusable\b/);
  });

  test("declares every param the host sets, every prop of its lists, and the signal the host handles", () => {
    const scalars = /const SCALARS = \[([^\]]+)\]/.exec(host)?.[1] ?? "";
    const names = [...scalars.matchAll(/"([a-z_]+)"/g)].map((m) => m[1] ?? "");
    expect(names.length).toBeGreaterThan(8);
    for (const name of [...names, "err_ink"]) expect(source).toMatch(new RegExp(`^  ${name}\\s+(num|text|bool|color) =`, "m"));
    const params = cmdlineParams(prompt({ output: ["a"], keywords: ["Undo"] }), "e", 0, page);
    for (const name of names) expect(name in params).toBe(true);
    expect(source).toMatch(/^  lines\s+list\(CmdLine\) = \[\]/m);
    expect(source).toMatch(/^  key_rows list\(CmdKeyRow\) = \[\]/m);
    for (const name of Object.keys(params.lines[0] ?? {})) if (name !== "key") expect(source).toMatch(new RegExp(`def CmdLine\\([^)]*\\b${name}=`));
    expect(source).toMatch(/def CmdKeyRow\(words=list\(CmdKey\)\)/);
    expect(source).toMatch(/def CmdKey\(word="", lead=false\)/);
    expect(source).toContain("act=keyword role=button label=word");
    expect(host).toContain('attachSurface(host, ["keyword"]');
    expect(source).toContain("role=alert label=param.error focusable");
    expect(source).toContain("role=status");
    expect(source).toContain("hole field w=fill h=size.control-h-input");
  });

  test("nothing in it solves per step of the pointer or of a tween", () => {
    const code = source.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toContain("transition=");
    expect(code).not.toContain("pointer-move=");
    expect(code).not.toContain("animate");
  });

  test("it is a document of its own, an optional part, and the standard interface takes none of it", () => {
    // The loader is Vite's (`import.meta.glob`), so its table is read as text here.
    expect(readFileSync(join(ui, "src", "slab", "loader.ts"), "utf8")).toContain('cmdline: "cadcraft-cmdline"');
    expect(host).toContain("<cadcraft-cmdline");
    expect(host).toContain('const TAG = "cadcraft-cmdline"');
    expect(readFileSync(join(ui, "slab", "shell.slab"), "utf8")).not.toContain("CmdLine");
    const main = readFileSync(join(ui, "src", "main.tsx"), "utf8");
    expect(main).toContain('slabPartNotice("command line", cmdline.reason)');
    expect(main).toContain('await import("./slab/SlabCommandLine")');
    const app = readFileSync(join(ui, "src", "app.tsx"), "utf8");
    expect(app).not.toMatch(/from "\.\/slab\/(SlabCommandLine|cmdline-params)"/);
    // The field and its keys are the SolidJS panel's own, not a copy.
    expect(host).toContain('from "../components/CommandField"');
    expect(readFileSync(join(ui, "src", "components", "CommandLine.tsx"), "utf8")).toContain('from "./CommandField"');
    const field = readFileSync(join(ui, "src", "components", "CommandField.tsx"), "utf8");
    expect(field).not.toMatch(/from "\.\.\/slab\//);
  });
});
