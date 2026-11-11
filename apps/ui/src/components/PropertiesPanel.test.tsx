/**
 * The palette's judgement of typed text (`judgeDraft`): what is sent, what is refused and with
 * which words, and what leaves the engine's value alone. The rows' reactive behaviour (focus kept
 * across a refresh, Escape, the refused mark) needs Solid's compiled JSX, which the test preload
 * does not provide, so it is checked in the browser.
 */

import { describe, expect, test } from "bun:test";
import { judgeDraft } from "./PropertiesPanel";
import { VARIES, type PropRow } from "../props";

function row(key: string, label: string, value: string, kind: PropRow["kind"]): PropRow {
  return { key, label, value, editable: true, kind };
}

const scale = (value = "1"): PropRow => row("ltscale", "Linetype scale", value, "number");
const thickness = (value = "0"): PropRow => row("thickness", "Thickness", value, "number");

describe("judgeDraft", () => {
  test("an edited number is sent as a number", () => {
    expect(judgeDraft(scale(), "2.5")).toEqual({ kind: "send", patch: { ltscale: 2.5 } });
    expect(judgeDraft(scale(), " 4 ")).toEqual({ kind: "send", patch: { ltscale: 4 } });
  });

  test("an unchanged value sends nothing, however the same number is written", () => {
    expect(judgeDraft(scale("2.5"), "2.5")).toEqual({ kind: "keep" });
    expect(judgeDraft(scale("2.5"), "2.50")).toEqual({ kind: "keep" });
    expect(judgeDraft(scale("2.5"), " 2.5 ")).toEqual({ kind: "keep" });
    expect(judgeDraft(scale("2.5"), "25e-1")).toEqual({ kind: "keep" });
    expect(judgeDraft(row("linetype", "Linetype", "ByLayer", "text"), "ByLayer")).toEqual({ kind: "keep" });
  });

  test("an emptied number keeps the engine's value, silently", () => {
    expect(judgeDraft(scale("2"), "")).toEqual({ kind: "keep" });
    expect(judgeDraft(scale("2"), "   ")).toEqual({ kind: "keep" });
  });

  test("letters in a number row are refused by the row's name", () => {
    expect(judgeDraft(scale(), "abc")).toEqual({ kind: "refuse", message: "Linetype scale needs a number" });
    expect(judgeDraft(scale(), "2,5")).toEqual({ kind: "refuse", message: "Linetype scale needs a number" });
    expect(judgeDraft(thickness(), "1 2")).toEqual({ kind: "refuse", message: "Thickness needs a number" });
  });

  test("a number past the float range is refused, never sent as Infinity", () => {
    expect(judgeDraft(scale(), "1e999")).toEqual({ kind: "refuse", message: "Linetype scale needs a number" });
    expect(judgeDraft(thickness(), "-Infinity")).toEqual({ kind: "refuse", message: "Thickness needs a number" });
    expect(judgeDraft(thickness(), "NaN")).toEqual({ kind: "refuse", message: "Thickness needs a number" });
  });

  test("zero and a negative are refused where the engine needs a number above zero, and sent elsewhere", () => {
    expect(judgeDraft(scale(), "0")).toEqual({ kind: "refuse", message: "Linetype scale needs a number above 0" });
    expect(judgeDraft(scale(), "-3")).toEqual({ kind: "refuse", message: "Linetype scale needs a number above 0" });
    expect(judgeDraft(thickness(), "-3")).toEqual({ kind: "send", patch: { thickness: -3 } });
  });

  test("a row that reads *VARIES* sends nothing untouched and takes a typed value", () => {
    expect(judgeDraft(scale(VARIES), VARIES)).toEqual({ kind: "keep" });
    expect(judgeDraft(scale(VARIES), "2")).toEqual({ kind: "send", patch: { ltscale: 2 } });
    expect(judgeDraft(scale(VARIES), "*VARIES")).toEqual({ kind: "refuse", message: "Linetype scale needs a number" });
  });

  test("a number row with no value yet takes zero as a change", () => {
    expect(judgeDraft(thickness(""), "0")).toEqual({ kind: "send", patch: { thickness: 0 } });
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
