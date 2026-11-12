import { describe, expect, test } from "bun:test";
import { benchSummary, caratText, MAX_BENCH_LINES, metalText, parseBench, trim } from "./bench";

/** The solitaire sample's sheet, as the engine replies. */
const SOLITAIRE = {
  stones: {
    count: 33,
    carat: 1.356,
    groups: [
      { cut: "round", width: 6.5, length: 6.5, depth: 4, sg: 3.52, count: 1, caratEach: 1.031, carat: 1.031, calibrated: false },
      { cut: "round", width: 1.5, length: 1.5, depth: 0.92, sg: 3.52, count: 14, caratEach: 0.013, carat: 0.177, calibrated: true },
      { cut: "round", width: 1.3, length: 1.3, depth: 0.8, sg: 3.52, count: 18, caratEach: 0.008, carat: 0.149, calibrated: true },
    ],
  },
  bands: [{ block: "RING-16.51x2.4", size: "US 6", mm: 16.51, metal: "gold18", grams: 3.86, width: 2.4, wall: 1.8 }],
  warnings: [],
  metal: null,
  table: null,
  message: "",
};

describe("the bench sheet", () => {
  test("reads the stones by cut and size, then the bands", () => {
    const sheet = parseBench(SOLITAIRE);
    expect(sheet?.lines).toEqual([
      { label: "Round 6.5 mm", value: "1 pc · 1.03 ct", note: null },
      { label: "Round 1.5 mm", value: "14 pc · 0.18 ct", note: null },
      { label: "Round 1.3 mm", value: "18 pc · 0.15 ct", note: null },
      { label: "18k gold band", value: "US 6 · 3.86 g", note: null },
    ]);
    expect(benchSummary(sheet)).toBe("33 stones, 1.36 ct · 3.86 g");
  });

  test("names a fancy cut by both sides, a material by its gravity, and melee off the calibrated list", () => {
    const sheet = parseBench({
      stones: {
        count: 3,
        carat: 1.2,
        groups: [
          { cut: "emerald", width: 5, length: 7, sg: 2.72, count: 1, carat: 0.9, calibrated: false },
          { cut: "round", width: 1.25, length: 1.25, sg: 3.52, count: 2, carat: 0.015, calibrated: false },
        ],
      },
    });
    expect(sheet?.lines[0]).toEqual({ label: "Emerald 7×5 mm, SG 2.72", value: "1 pc · 0.90 ct", note: null });
    expect(sheet?.lines[1]).toEqual({ label: "Round 1.25 mm", value: "2 pc · 0.015 ct", note: "Not a calibrated melee size" });
  });

  test("a drawing with no jewelry is an empty sheet with nothing to say", () => {
    const sheet = parseBench({ stones: { count: 0, carat: 0, groups: [] }, bands: [], warnings: [] });
    expect(sheet).toEqual({ stones: 0, carat: 0, grams: 0, lines: [], warnings: [] });
    expect(benchSummary(sheet)).toBe("");
    expect(benchSummary(null)).toBe("");
  });

  test("a reply that is not a sheet is no sheet, and a hostile one makes no row", () => {
    expect(parseBench(null)).toBeNull();
    expect(parseBench("sheet")).toBeNull();
    expect(parseBench({ stones: 4 })).toBeNull();
    const sheet = parseBench({
      stones: { count: Number.NaN, carat: -4, groups: [null, 7, { cut: 9, width: "6", count: 1, carat: 1 }, { cut: "round", width: 1, count: 0, carat: 0 }, { cut: "x".repeat(900), width: 2, count: 1, carat: Number.POSITIVE_INFINITY }] },
      bands: [{ grams: -1 }, { grams: Number.NaN }, "band", { grams: 2, metal: 4, size: 6 }],
      warnings: [3, "the block GEM-X disagrees with its description"],
    });
    expect(sheet?.stones).toBe(0);
    expect(sheet?.carat).toBe(0);
    expect(sheet?.lines).toEqual([{ label: "Metal band", value: "2 g", note: null }]);
    expect(sheet?.warnings).toEqual(["the block GEM-X disagrees with its description"]);
  });

  test("a sheet longer than the panel shows says how much it left out", () => {
    const groups = Array.from({ length: MAX_BENCH_LINES + 5 }, (_, i) => ({ cut: "round", width: 1 + i / 100, count: 1, carat: 0.01 }));
    const sheet = parseBench({ stones: { count: groups.length, carat: 0.45, groups }, bands: [{ grams: 3, metal: "platinum", size: "US 7" }] });
    expect(sheet?.lines.length).toBe(MAX_BENCH_LINES);
    expect(sheet?.grams).toBe(3);
    expect(sheet?.warnings).toEqual(["6 more lines are on the full sheet (TECHSHEET)."]);
  });

  test("the trade's figures", () => {
    expect(trim(6.5, 2)).toBe("6.5");
    expect(trim(3, 2)).toBe("3");
    expect(trim(16.507, 2)).toBe("16.51");
    expect(caratText(1.031)).toBe("1.03 ct");
    expect(caratText(0.013)).toBe("0.013 ct");
    expect(caratText(0)).toBe("0.00 ct");
    expect(metalText("gold18")).toBe("18k gold");
    expect(metalText("platinum")).toBe("platinum");
    expect(metalText("?")).toBe("metal");
  });
});
