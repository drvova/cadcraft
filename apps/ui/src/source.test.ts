/**
 * The Source panel's rules (`source.ts`): edits are never replaced by a refresh, the panel never
 * claims the text is the drawing after a failed apply, an engine error's line is read with caps,
 * and what is drawn of a hostile text is bounded.
 */

import { describe, expect, test } from "bun:test";
import type { ScriptReport } from "./facade";
import {
  applied,
  clip,
  counted,
  countLines,
  edited,
  EMPTY_SOURCE,
  errorLine,
  fitsEditor,
  gutterText,
  isEdited,
  lineSpan,
  MAX_COUNTED_LINES,
  MAX_EDIT_CHARS,
  MAX_EDIT_LINES,
  MAX_GUTTER_LINES,
  MAX_MESSAGE_CHARS,
  PREVIEW_CHARS,
  PREVIEW_LINES,
  previewOf,
  read,
  reverted,
  statusOf,
  unreadable,
  type SourceState,
} from "./source";

const RING = "; CADCraft drawing script\nUNIT mm\nCIRCLE 0,0 8.5\nCIRCLE 0,0 10\n";
const ok = (ran: number | null = 2): ScriptReport => ({ ok: true, ran, output: [], error: null });
const fail = (error: string, ran: number | null = 0): ScriptReport => ({ ok: false, ran, output: [], error });
const inStep = (text: string = RING): SourceState => read(EMPTY_SOURCE, text);

describe("following the drawing", () => {
  test("with no edits the text follows every read", () => {
    const a = inStep();
    expect(a).toEqual({ base: RING, draft: RING, behind: false, outcome: { kind: "none" } });
    expect(isEdited(a)).toBe(false);
    const b = read(a, `${RING}LINE 0,0 1,1\n`);
    expect(b.draft).toBe(`${RING}LINE 0,0 1,1\n`);
    expect(isEdited(b)).toBe(false);
    // The same script read again is the same state (nothing is redrawn).
    expect(read(b, b.base)).toBe(b);
  });

  test("an edit is never replaced by a read: the text stays and is marked behind the drawing", () => {
    const mine = `${RING}POINT 1,1\n`;
    const a = edited(inStep(), mine);
    expect(isEdited(a)).toBe(true);
    expect(a.behind).toBe(false);
    const b = read(a, `${RING}LINE 0,0 1,1\n`);
    expect(b.draft).toBe(mine);
    expect(b.base).toBe(`${RING}LINE 0,0 1,1\n`);
    expect(b.behind).toBe(true);
    expect(isEdited(b)).toBe(true);
    expect(statusOf(b).text).toContain("the drawing has changed since");
    // And again, and with a read that fails.
    const c = unreadable(read(b, RING), "no drawing open");
    expect(c.draft).toBe(mine);
    expect(isEdited(c)).toBe(true);
  });

  test("a drawing that changes into the edited text ends the edit", () => {
    const mine = `${RING}POINT 1,1\n`;
    const a = read(edited(inStep(), mine), mine);
    expect(isEdited(a)).toBe(false);
    expect(a.behind).toBe(false);
  });

  test("typing the text back to the drawing's script is no edit, and no longer behind", () => {
    const a = read(edited(inStep(), "x"), "LINE 0,0 1,1\n");
    expect(a.behind).toBe(true);
    const b = edited(a, "LINE 0,0 1,1\n");
    expect(isEdited(b)).toBe(false);
    expect(b.behind).toBe(false);
    expect(statusOf(b).text).toBe("In step with the drawing.");
  });

  test("a failed read keeps the text and says so; the next good read clears it", () => {
    const a = unreadable(inStep(), "no drawing open");
    expect(a.draft).toBe(RING);
    expect(statusOf(a)).toEqual({ tone: "error", text: "The drawing's script could not be read: no drawing open" });
    expect(statusOf(read(a, RING)).tone).toBe("quiet");
    expect(unreadable(inStep(), "x".repeat(5000)).outcome).toEqual({ kind: "unreadable", error: `${"x".repeat(MAX_MESSAGE_CHARS - 1)}…` });
  });

  test("revert shows the drawing's script as read now", () => {
    const a = read(edited(inStep(), "junk"), "LINE 0,0 1,1\n");
    expect(reverted("LINE 0,0 1,1\n")).toEqual({ base: "LINE 0,0 1,1\n", draft: "LINE 0,0 1,1\n", behind: false, outcome: { kind: "none" } });
    expect(isEdited(reverted(a.base))).toBe(false);
  });
});

describe("applying", () => {
  test("a run that worked shows the drawing's script and how many statements ran", () => {
    const a = edited(inStep(), RING.replace("8.5", "6"));
    const b = applied(a, ok(3), RING.replace("8.5", "6"));
    expect(isEdited(b)).toBe(false);
    expect(b.outcome).toEqual({ kind: "applied", ran: 3, rewritten: false });
    expect(statusOf(b)).toEqual({ tone: "ok", text: "Applied: 3 statements ran." });
    expect(statusOf(applied(a, ok(1), a.draft)).text).toBe("Applied: 1 statement ran.");
    expect(statusOf(applied(a, ok(null), a.draft)).text).toBe("Applied.");
  });

  test("a run whose text the engine writes differently says the text was rewritten", () => {
    const a = edited(inStep(), "$r = 6\nCIRCLE 0,0 $r\n");
    const b = applied(a, ok(1), "; CADCraft drawing script\nCIRCLE 0,0 6\n");
    expect(b.draft).toBe("; CADCraft drawing script\nCIRCLE 0,0 6\n");
    expect(b.outcome).toEqual({ kind: "applied", ran: 1, rewritten: true });
    expect(statusOf(b).text).toContain("as the engine writes it");
    // Line ends and trailing space are not a rewrite.
    expect(applied(edited(inStep(), "LINE 0,0 1,1\r\n\r\n"), ok(1), "LINE 0,0 1,1\n").outcome).toEqual({ kind: "applied", ran: 1, rewritten: false });
  });

  test("a failed run keeps the edit, names the line and never claims to be in step", () => {
    const mine = RING.replace("CIRCLE 0,0 10", "CIRCLE 0,0");
    const a = edited(inStep(), mine);
    const b = applied(a, fail("line 4: CIRCLE 0,0: CIRCLE needs a radius", 2), RING);
    expect(b.draft).toBe(mine);
    expect(b.base).toBe(RING);
    expect(isEdited(b)).toBe(true);
    expect(b.outcome).toEqual({ kind: "failed", error: "line 4: CIRCLE 0,0: CIRCLE needs a radius", line: 4, ran: 2 });
    const status = statusOf(b);
    expect(status.tone).toBe("error");
    expect(status.text).toBe("Not applied: line 4: CIRCLE 0,0: CIRCLE needs a radius. 2 statements ran before it. The drawing is as it was.");
    // The error stays while the reader fixes the text; a read of the unchanged drawing keeps both.
    const c = read(edited(b, `${mine} `), RING);
    expect(c.outcome.kind).toBe("failed");
    expect(isEdited(c)).toBe(true);
    // The drawing moving on ends what the error said about it ("the drawing is as it was").
    const d = read(c, `${RING}LINE 0,0 1,1\n`);
    expect(d.outcome).toEqual({ kind: "none" });
    expect(d.draft).toBe(`${mine} `);
    expect(statusOf(d).text).toContain("the drawing has changed since");
  });

  test("a failed run with nothing readable afterwards still keeps the edit as an edit", () => {
    const a = edited(inStep(), "junk");
    const b = applied(a, { ok: false, ran: null, output: [], error: null }, null);
    expect(b.draft).toBe("junk");
    expect(b.base).toBe(RING);
    expect(isEdited(b)).toBe(true);
    expect(statusOf(b).text).toBe("Not applied: the script did not run. The drawing is as it was.");
  });

  test("a run that worked but could not be read back does not claim the text is the drawing", () => {
    const a = edited(inStep(), "LINE 0,0 1,1\n");
    const b = applied(a, ok(1), null);
    expect(b.draft).toBe("LINE 0,0 1,1\n");
    expect(isEdited(b)).toBe(true);
    expect(statusOf(b).tone).toBe("error");
  });

  test("a long engine message is clipped", () => {
    const b = applied(edited(inStep(), "x"), fail(`line 2: ${"y".repeat(10_000)}`), RING);
    expect(b.outcome.kind === "failed" ? b.outcome.error.length : 0).toBe(MAX_MESSAGE_CHARS);
    expect(b.outcome.kind === "failed" ? b.outcome.line : 0).toBe(2);
  });
});

describe("errorLine", () => {
  test("reads the line an engine error leads with", () => {
    expect(errorLine("line 3: CIRCLE 5,5: needs a radius")).toBe(3);
    expect(errorLine("line 100000: x: y")).toBe(100_000);
  });

  test("names no line for anything else", () => {
    for (const error of ["", "the script is too long: 9000000 bytes (the limit is 8388608)", "at line 3: x", "line 0: x", "line -1: x", "line 3 x", "line 99999999999999999999: x", "line 1e9: x", "Line 3: x", `line ${MAX_COUNTED_LINES + 1}: x`]) {
      expect(errorLine(error), error).toBeNull();
    }
  });
});

describe("what is drawn is capped", () => {
  test("countLines counts as an editor does and stops at its cap", () => {
    expect(countLines("")).toEqual({ lines: 1, capped: false });
    expect(countLines("a")).toEqual({ lines: 1, capped: false });
    expect(countLines("a\n")).toEqual({ lines: 2, capped: false });
    expect(countLines("a\nb\nc")).toEqual({ lines: 3, capped: false });
    expect(countLines("\n".repeat(50), 10)).toEqual({ lines: 10, capped: true });
    expect(countLines("\n".repeat(9), 10)).toEqual({ lines: 10, capped: false });
  });

  test("the editor holds a few thousand lines and refuses megabytes", () => {
    expect(fitsEditor(RING)).toBe(true);
    expect(fitsEditor("LINE 0,0 1,1\n".repeat(MAX_EDIT_LINES - 1))).toBe(true);
    expect(fitsEditor("\n".repeat(MAX_EDIT_LINES))).toBe(false);
    expect(fitsEditor("x".repeat(MAX_EDIT_CHARS))).toBe(true);
    expect(fitsEditor("x".repeat(MAX_EDIT_CHARS + 1))).toBe(false);
  });

  test("a long script's preview is whole lines from its start, with what was left out", () => {
    const text = Array.from({ length: 30_000 }, (_, i) => `LINE 0,${i} 10,${i}`).join("\n");
    const p = previewOf(text);
    expect(p.shownLines).toBe(PREVIEW_LINES);
    expect(p.totalLines).toBe(30_000);
    expect(p.more).toBe(false);
    expect(p.text.split("\n").length).toBe(PREVIEW_LINES);
    expect(p.text.endsWith(`LINE 0,${PREVIEW_LINES - 1} 10,${PREVIEW_LINES - 1}`)).toBe(true);
    expect(text.startsWith(p.text)).toBe(true);
  });

  test("a preview is bounded in characters too: long lines stop it early, one endless line is cut", () => {
    const wide = Array.from({ length: 500 }, () => "x".repeat(1000)).join("\n");
    const p = previewOf(wide);
    expect(p.text.length).toBeLessThanOrEqual(PREVIEW_CHARS);
    expect(p.shownLines).toBeLessThan(500);
    expect(p.shownLines).toBe(p.text.split("\n").length);
    const endless = previewOf("x".repeat(3_000_000));
    expect(endless.text.length).toBe(PREVIEW_CHARS);
    expect(endless.shownLines).toBe(1);
    expect(endless.totalLines).toBe(1);
    const many = previewOf("\n".repeat(MAX_COUNTED_LINES + 10));
    expect(many.more).toBe(true);
    expect(many.totalLines).toBe(MAX_COUNTED_LINES);
    expect(previewOf("")).toEqual({ text: "", shownLines: 1, totalLines: 1, more: false });
    expect(previewOf("a\nb")).toEqual({ text: "a\nb", shownLines: 2, totalLines: 2, more: false });
  });

  test("the gutter numbers every line up to its cap, whatever it is asked for", () => {
    expect(gutterText(1)).toBe("1");
    expect(gutterText(3)).toBe("1\n2\n3");
    expect(gutterText(0)).toBe("1");
    expect(gutterText(-5)).toBe("1");
    expect(gutterText(Number.NaN)).toBe("1");
    expect(gutterText(Number.POSITIVE_INFINITY)).toBe("1");
    expect(gutterText(2.9)).toBe("1\n2");
    const capped = gutterText(1e9).split("\n");
    expect(capped.length).toBe(MAX_GUTTER_LINES);
    expect(capped[capped.length - 1]).toBe(String(MAX_GUTTER_LINES));
  });

  test("clip and counted", () => {
    expect(clip("abc", 3)).toBe("abc");
    expect(clip("abcd", 3)).toBe("ab…");
    expect(clip("abcd", 0)).toBe("…");
    expect(counted(1, "line")).toBe("1 line");
    expect(counted(1240, "line")).toBe("1,240 lines");
    expect(counted(0, "statement")).toBe("0 statements");
  });
});

describe("lineSpan", () => {
  test("finds a line's offsets, for the caret", () => {
    expect(lineSpan("ab\ncde\n", 1)).toEqual({ start: 0, end: 2 });
    expect(lineSpan("ab\ncde\n", 2)).toEqual({ start: 3, end: 6 });
    expect(lineSpan("ab\ncde\n", 3)).toEqual({ start: 7, end: 7 });
    expect(lineSpan("ab\ncde", 2)).toEqual({ start: 3, end: 6 });
  });

  test("has none for a line the text does not have", () => {
    expect(lineSpan("ab\ncde", 3)).toBeNull();
    expect(lineSpan("ab", 0)).toBeNull();
    expect(lineSpan("ab", -1)).toBeNull();
    expect(lineSpan("ab", 1.5)).toBeNull();
    expect(lineSpan("ab", Number.NaN)).toBeNull();
    expect(lineSpan("", 1e9)).toBeNull();
  });
});
