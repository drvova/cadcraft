/**
 * The palette's judgement of typed text (`judgeDraft`, which lives with the patch it builds in
 * `../props`): what is sent, what is refused and with which words, and what leaves the engine's
 * value alone. The rows here are the ones `parseProperties` makes, so they carry the bounds the
 * palette acts on. The rows' reactive behaviour (focus kept across a refresh, Escape, the refused
 * mark) needs Solid's compiled JSX, which the test preload does not provide, so it is checked in
 * the browser.
 */

import { describe, expect, test } from "bun:test";
import { INFINITE, judgeDraft, NOT_A_NUMBER, parseProperties, VARIES, type PropRow } from "../props";

function row(key: string, label: string, value: string, kind: PropRow["kind"]): PropRow {
  return { key, label, value, editable: true, kind };
}

/** The row `parseProperties` makes for `key` of one selected object holding `value`. */
function parsed(key: string, value: unknown): PropRow {
  const reply = parseProperties({ count: 1, objects: [{ [key]: value }] }, []);
  const found = reply?.rows.find((r) => r.key === key);
  if (found === undefined) throw new Error(`no row ${key}`);
  return found;
}

const scale = (value: unknown = 1): PropRow => parsed("ltscale", value);
const thickness = (value: unknown = 0): PropRow => parsed("thickness", value);

const SCALE_NEEDS = "Linetype scale needs a number above 0";
const THICKNESS_NEEDS = "Thickness needs a number from -1e12 to 1e12";

describe("judgeDraft", () => {
  test("an edited number is sent as a number", () => {
    expect(judgeDraft(scale(), "2.5")).toEqual({ kind: "send", patch: { ltscale: 2.5 } });
    expect(judgeDraft(scale(), " 4 ")).toEqual({ kind: "send", patch: { ltscale: 4 } });
  });

  test("an unchanged value sends nothing, however the same number is written", () => {
    expect(judgeDraft(scale(2.5), "2.5")).toEqual({ kind: "keep" });
    expect(judgeDraft(scale(2.5), "2.50")).toEqual({ kind: "keep" });
    expect(judgeDraft(scale(2.5), " 2.5 ")).toEqual({ kind: "keep" });
    expect(judgeDraft(scale(2.5), "25e-1")).toEqual({ kind: "keep" });
    expect(judgeDraft(scale(2.5), "+2.5")).toEqual({ kind: "keep" });
    expect(judgeDraft(scale(2.5), "2,5")).toEqual({ kind: "keep" });
    expect(judgeDraft(thickness(0), "-0")).toEqual({ kind: "keep" });
    expect(judgeDraft(row("linetype", "Linetype", "ByLayer", "text"), "ByLayer")).toEqual({ kind: "keep" });
  });

  test("an emptied number keeps the engine's value, silently", () => {
    expect(judgeDraft(scale(2), "")).toEqual({ kind: "keep" });
    expect(judgeDraft(scale(2), "   ")).toEqual({ kind: "keep" });
    expect(judgeDraft(scale(2), "\n")).toEqual({ kind: "keep" });
  });

  test("letters in a number row are refused by the row's name, with what it takes", () => {
    expect(judgeDraft(scale(), "abc")).toEqual({ kind: "refuse", message: SCALE_NEEDS });
    expect(judgeDraft(thickness(), "1 2")).toEqual({ kind: "refuse", message: THICKNESS_NEEDS });
    expect(judgeDraft(row("textHeight", "Text height", "0.2", "number"), "abc")).toEqual({ kind: "refuse", message: "Text height needs a number" });
  });

  test("a single comma is the decimal mark; more separators are refused with what to type", () => {
    const separators = "Thickness: type it like 1234.5, with one decimal mark and no thousands separators";
    expect(judgeDraft(thickness(), "2,5")).toEqual({ kind: "send", patch: { thickness: 2.5 } });
    expect(judgeDraft(thickness(), "-,5")).toEqual({ kind: "send", patch: { thickness: -0.5 } });
    for (const text of ["1,234,567", "1,2,3", "1.234,5", "1,234.5", "2,", "1.2.3"]) {
      expect(judgeDraft(thickness(), text)).toEqual({ kind: "refuse", message: separators });
    }
  });

  test("a trailing unit, hex and an inner line break are refused, never guessed at", () => {
    expect(judgeDraft(thickness(), "5mm")).toEqual({ kind: "refuse", message: "Thickness takes a number without a unit" });
    expect(judgeDraft(thickness(), '5"')).toEqual({ kind: "refuse", message: "Thickness takes a number without a unit" });
    expect(judgeDraft(thickness(), "0x10")).toEqual({ kind: "refuse", message: THICKNESS_NEEDS });
    expect(judgeDraft(thickness(), "1\n2")).toEqual({ kind: "refuse", message: THICKNESS_NEEDS });
  });

  test("full-width digits, a typographic minus and a pasted line break around the number are read", () => {
    expect(judgeDraft(thickness(), "２．５")).toEqual({ kind: "send", patch: { thickness: 2.5 } });
    expect(judgeDraft(thickness(), "−3")).toEqual({ kind: "send", patch: { thickness: -3 } });
    expect(judgeDraft(thickness(), "7\r\n")).toEqual({ kind: "send", patch: { thickness: 7 } });
    expect(judgeDraft(thickness(), "+1e3")).toEqual({ kind: "send", patch: { thickness: 1000 } });
  });

  test("a number past the float range is refused, never sent as Infinity", () => {
    expect(judgeDraft(scale(), "1e999")).toEqual({ kind: "refuse", message: "Linetype scale is past the largest number a drawing holds" });
    expect(judgeDraft(thickness(), "1e999")).toEqual({ kind: "refuse", message: THICKNESS_NEEDS });
    expect(judgeDraft(thickness(), "-Infinity")).toEqual({ kind: "refuse", message: THICKNESS_NEEDS });
    expect(judgeDraft(thickness(), "NaN")).toEqual({ kind: "refuse", message: THICKNESS_NEEDS });
  });

  test("zero and a negative are refused where the engine needs a number above zero, and sent elsewhere", () => {
    expect(judgeDraft(scale(), "0")).toEqual({ kind: "refuse", message: SCALE_NEEDS });
    expect(judgeDraft(scale(), "-3")).toEqual({ kind: "refuse", message: SCALE_NEEDS });
    expect(judgeDraft(scale(), "1e-300")).toEqual({ kind: "send", patch: { ltscale: 1e-300 } });
    expect(judgeDraft(scale(), "1e300")).toEqual({ kind: "send", patch: { ltscale: 1e300 } });
    expect(judgeDraft(thickness(), "-3")).toEqual({ kind: "send", patch: { thickness: -3 } });
  });

  test("thickness holds the THICKNESS command's range, ends included", () => {
    expect(judgeDraft(thickness(), "1e12")).toEqual({ kind: "send", patch: { thickness: 1e12 } });
    expect(judgeDraft(thickness(), "-1e12")).toEqual({ kind: "send", patch: { thickness: -1e12 } });
    expect(judgeDraft(thickness(), "1.0001e12")).toEqual({ kind: "refuse", message: THICKNESS_NEEDS });
    expect(judgeDraft(thickness(), "-1e13")).toEqual({ kind: "refuse", message: THICKNESS_NEEDS });
  });

  test("a row holding a number that is not one takes a typed number and is never 'unchanged'", () => {
    expect(thickness(Number.NaN).value).toBe(NOT_A_NUMBER);
    expect(judgeDraft(thickness(Number.NaN), "0")).toEqual({ kind: "send", patch: { thickness: 0 } });
    expect(judgeDraft(thickness(Number.POSITIVE_INFINITY), INFINITE)).toEqual({ kind: "keep" });
    expect(judgeDraft(thickness(Number.POSITIVE_INFINITY), "Infinity")).toEqual({ kind: "refuse", message: THICKNESS_NEEDS });
  });

  test("a row that reads *VARIES* sends nothing untouched and takes a typed value", () => {
    expect(judgeDraft(scale(VARIES), VARIES)).toEqual({ kind: "keep" });
    expect(judgeDraft(scale(VARIES), "2")).toEqual({ kind: "send", patch: { ltscale: 2 } });
    expect(judgeDraft(scale(VARIES), "*VARIES")).toEqual({ kind: "refuse", message: SCALE_NEEDS });
  });

  test("a name that looks like a number or a tick stays a name", () => {
    expect(judgeDraft(row("layer", "Layer", VARIES, "choice"), "0")).toEqual({ kind: "send", patch: { layer: "0" } });
    expect(judgeDraft(row("layer", "Layer", "0", "choice"), "true")).toEqual({ kind: "send", patch: { layer: "true" } });
    expect(judgeDraft(row("transparency", "Transparency", "ByLayer", "text"), "50%")).toEqual({ kind: "send", patch: { transparency: "50%" } });
  });

  test("a text row is compared and sent without the space around it", () => {
    expect(judgeDraft(row("linetype", "Linetype", "ByLayer", "text"), " ByLayer ")).toEqual({ kind: "keep" });
    expect(judgeDraft(row("linetype", "Linetype", "ByLayer", "text"), " Hidden\n")).toEqual({ kind: "send", patch: { linetype: "Hidden" } });
  });

  test("a number row with no value yet takes zero as a change", () => {
    expect(thickness(null).value).toBe("");
    expect(judgeDraft(thickness(null), "0")).toEqual({ kind: "send", patch: { thickness: 0 } });
  });

  test("text, choices and ticks are sent as buildPatch reads them", () => {
    expect(judgeDraft(row("linetype", "Linetype", "ByLayer", "text"), "Hidden")).toEqual({ kind: "send", patch: { linetype: "Hidden" } });
    expect(judgeDraft(row("linetype", "Linetype", "ByLayer", "text"), "")).toEqual({ kind: "send", patch: { linetype: "" } });
    expect(judgeDraft(row("layer", "Layer", VARIES, "choice"), "Outline")).toEqual({ kind: "send", patch: { layer: "Outline" } });
    expect(judgeDraft(row("visible", "Visible", "true", "bool"), "false")).toEqual({ kind: "send", patch: { visible: false } });
    expect(judgeDraft(row("visible", "Visible", VARIES, "bool"), "true")).toEqual({ kind: "send", patch: { visible: true } });
  });

  test("a 60-character value is sent whole", () => {
    const long = "V".repeat(60);
    expect(judgeDraft(row("linetype", "Linetype", "ByLayer", "text"), long)).toEqual({ kind: "send", patch: { linetype: long } });
  });
});
