import { describe, expect, test } from "bun:test";
import { benchSummary, caratText, formatMoney, hasAnyPrice, lineSelected, MAX_BENCH_LINES, MAX_LINE_HANDLES, metalText, parseBench, parseCost, planPriceBook, priceAsks, priceForm, priceRefusalField, trim } from "./bench";
import type { GemStone } from "./jewelry-dialog";

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
    expect(sheet?.lines).toMatchObject([
      { label: "Round 6.5 mm", value: "1 pc · 1.03 ct", note: null, handles: [] },
      { label: "Round 1.5 mm", value: "14 pc · 0.18 ct", note: null, handles: [] },
      { label: "Round 1.3 mm", value: "18 pc · 0.15 ct", note: null, handles: [] },
      { label: "18k gold band", value: "US 6 · 3.86 g", note: null, handles: [] },
    ]);
    expect(benchSummary(sheet)).toBe("33 stones, 1.36 ct · 3.86 g");
  });

  test("splits each line into its part and the sheet's two numeric columns", () => {
    const lines = parseBench(SOLITAIRE)?.lines ?? [];
    expect(lines.map((l) => l.part)).toEqual(["stone", "stone", "stone", "metal"]);
    expect(lines[1]?.cells).toEqual(["14 pc", "0.18 ct"]);
    expect(lines[3]?.cells).toEqual(["US 6", "3.86 g"]);
    const sizeless = parseBench({ stones: { count: 0, carat: 0, groups: [] }, bands: [{ grams: 2, metal: "gold18", size: "?" }] });
    expect(sizeless?.lines[0]?.cells).toEqual(["", "2 g"]);
  });

  test("weighs a prong head's prongs and rail on a line of their own, into the metal", () => {
    const sheet = parseBench({ stones: { count: 0, carat: 0, groups: [] }, bands: [{ grams: 2, metal: "gold18", size: "US 6", prongs: "claw", prongGrams: 0.25 }] });
    expect(sheet?.lines.map((l) => l.label)).toEqual(["18k gold band", "Claw prongs and rail"]);
    expect(sheet?.lines[1]?.cells).toEqual(["", "0.25 g"]);
    expect(sheet?.grams).toBeCloseTo(2.25, 9);
    const hostile = parseBench({ stones: { count: 0, carat: 0, groups: [] }, bands: [{ grams: 2, metal: "gold18", prongs: { x: 1 }, prongGrams: -3 }] });
    expect(hostile?.lines.length).toBe(1);
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
    expect(sheet?.lines[0]).toMatchObject({ label: "Emerald 7×5 mm, SG 2.72", value: "1 pc · 0.90 ct", note: null, handles: [] });
    expect(sheet?.lines[1]).toMatchObject({ label: "Round 1.25 mm", value: "2 pc · 0.015 ct", note: "Not a calibrated melee size", handles: [] });
  });

  test("a drawing with no jewelry is an empty sheet with nothing to say", () => {
    const sheet = parseBench({ stones: { count: 0, carat: 0, groups: [] }, bands: [], warnings: [] });
    expect(sheet).toEqual({ stones: 0, carat: 0, grams: 0, lines: [], warnings: [], cost: null, alloys: [], stoneSgs: [] });
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
    expect(sheet?.lines).toMatchObject([{ label: "Metal band", value: "2 g", note: null, handles: [] }]);
    expect(sheet?.warnings).toEqual(["the block GEM-X disagrees with its description"]);
  });

  test("a sheet longer than the panel shows says how much it left out", () => {
    const groups = Array.from({ length: MAX_BENCH_LINES + 5 }, (_, i) => ({ cut: "round", width: 1 + i / 100, count: 1, carat: 0.01 }));
    const sheet = parseBench({ stones: { count: groups.length, carat: 0.45, groups }, bands: [{ grams: 3, metal: "platinum", size: "US 7" }] });
    expect(sheet?.lines.length).toBe(MAX_BENCH_LINES);
    expect(sheet?.grams).toBe(3);
    expect(sheet?.warnings).toEqual(["6 more lines are on the full sheet (TECHSHEET)."]);
  });

  test("a line carries the handles of what it counts, checked and capped", () => {
    const sheet = parseBench({
      stones: { count: 3, carat: 0.03, groups: [{ cut: "round", width: 1.3, count: 3, carat: 0.03, handles: ["1A", "2b", 7, "not hex", "", "1".repeat(40), "3C"] }] },
      bands: [{ grams: 3, metal: "gold14", size: "US 5", handle: "9F" }, { grams: 1, handle: { toString: 1 } }],
    });
    expect(sheet?.lines.map((line) => line.handles)).toEqual([["1A", "2b", "3C"], ["9F"], []]);
    const flood = parseBench({ stones: { count: 1, carat: 1, groups: [{ cut: "round", width: 1, count: 9000, carat: 1, handles: Array.from({ length: 9000 }, (_, i) => i.toString(16)) }] } });
    expect(flood?.lines[0]?.handles.length).toBe(MAX_LINE_HANDLES);
  });

  test("a line is selected when all it counts is selected, and a line that names nothing never is", () => {
    const line = { label: "Round 1.3 mm", value: "2 pc · 0.02 ct", note: null, handles: ["1A", "2B"] };
    expect(lineSelected(line, new Set(["1A", "2B", "3C"]))).toBe(true);
    expect(lineSelected(line, new Set(["1A"]))).toBe(false);
    expect(lineSelected({ ...line, handles: [] }, new Set(["1A"]))).toBe(false);
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

/** A techsheet reply that carries a cost, as the engine replies when a price book is set. */
const PRICED = {
  stones: { count: 2, carat: 1.62, groups: [{ cut: "emerald", width: 5, length: 7, sg: 3.52, count: 2, carat: 1.62, calibrated: false }] },
  bands: [{ block: "RING-16.51x2", size: "US 6", mm: 16.51, metal: "gold18", grams: 3.22, width: 2, wall: 1.8 }],
  warnings: [],
  metal: null,
  table: null,
  message: "",
  cost: {
    currency: "USD",
    metal: 161,
    stones: 810,
    labor: 100,
    total: 1071,
    unpriced: 0,
    lines: [
      { what: "gold18 band (US 6)", metal: "gold18", qty: 3.22, unit: "g", rate: 50, amount: 161 },
      { what: "diamond emerald 7×5 mm", material: "diamond", qty: 2, carat: 1.62, unit: "ct", rate: 500, amount: 810 },
      { what: "labor (flat)", qty: 1, unit: "flat", rate: 100, amount: 100 },
    ],
  },
};

describe("the cost on the bench sheet", () => {
  test("a reply with no cost has none", () => {
    expect(parseBench(SOLITAIRE)?.cost).toBeNull();
  });

  test("reads the cost, formatted in its currency", () => {
    const cost = parseBench(PRICED)?.cost;
    expect(cost?.currency).toBe("USD");
    expect(cost?.metal).toBe("$161.00");
    expect(cost?.stones).toBe("$810.00");
    expect(cost?.labor).toBe("$100.00");
    expect(cost?.total).toBe("$1,071.00");
    expect(cost?.unpriced).toBe(0);
    expect(cost?.lines).toEqual([
      { what: "Gold18 band (US 6)", detail: "3.22 g", amount: "$161.00", note: null },
      { what: "Diamond emerald 7×5 mm", detail: "2 pc · 1.62 ct", amount: "$810.00", note: null },
      { what: "Labor (flat)", detail: "", amount: "$100.00", note: null },
    ]);
  });

  test("an unpriced line keeps its quantity and its note, but has no amount", () => {
    const cost = parseCost({
      currency: "USD",
      metal: 0,
      stones: 0,
      total: 0,
      unpriced: 1,
      lines: [{ what: "sapphire round 3 mm", material: "sapphire", qty: 1, carat: 0.2, unit: "ct", note: "no stone price for sapphire" }],
    });
    expect(cost?.lines[0]).toEqual({ what: "Sapphire round 3 mm", detail: "1 pc · 0.20 ct", amount: null, note: "no stone price for sapphire" });
    expect(cost?.total).toBe("$0.00");
  });

  test("no labor figure, no labor line in the cost", () => {
    const cost = parseCost({ currency: "USD", metal: 10, stones: 0, total: 10, unpriced: 0, lines: [] });
    expect(cost?.labor).toBeNull();
  });

  test("a reply that is not a cost is none", () => {
    expect(parseCost(null)).toBeNull();
    expect(parseCost({ currency: "USD" })).toBeNull(); // no total
    expect(parseCost("cost")).toBeNull();
  });

  test("money honours the currency and never throws on an odd code", () => {
    expect(formatMoney(1071, "USD")).toBe("$1,071.00");
    expect(formatMoney(40, "EUR")).toBe("€40.00");
    expect(formatMoney(1200, "JPY")).toBe("¥1,200"); // no minor unit
    expect(formatMoney(1, "GOLD")).toBe("GOLD 1.00"); // not an ISO code: the code and the number
    expect(formatMoney(Number.NaN, "USD")).toBe("");
  });
});

describe("the Price Book editor", () => {
  const stones: GemStone[] = [
    { name: "diamond", sg: 3.52 },
    { name: "sapphire", sg: 4.0 },
    { name: "ruby", sg: 4.0 },
  ];

  test("asks about the alloys and materials the drawing uses, plus a catch-all, never a hardcoded list", () => {
    const sheet = parseBench({
      stones: { count: 3, carat: 1, groups: [{ cut: "round", width: 3, sg: 3.52, count: 1, carat: 0.5 }, { cut: "oval", width: 4, length: 5, sg: 4.0, count: 2, carat: 0.5 }] },
      bands: [{ grams: 3, metal: "gold18", size: "US 6" }, { grams: 2, metal: "platinum", size: "US 6" }],
    });
    const asks = priceAsks(sheet, stones);
    expect(asks.metals).toEqual([
      { value: "gold18", label: "18k gold" },
      { value: "platinum", label: "Platinum" },
    ]);
    // sg 3.52 → diamond, sg 4.0 → the first stone of that gravity (sapphire), then the catch-all.
    expect(asks.materials).toEqual([
      { value: "diamond", label: "Diamond" },
      { value: "sapphire", label: "Sapphire" },
      { value: "default", label: "Other stones" },
    ]);
    // An empty drawing asks for nothing but the catch-all.
    expect(priceAsks(parseBench({ stones: { count: 0, carat: 0, groups: [] }, bands: [] }), stones).materials).toEqual([{ value: "default", label: "Other stones" }]);
    expect(priceAsks(null, stones).metals).toEqual([]);
  });

  test("prefills the form from the stored book", () => {
    const asks = priceAsks(parseBench(PRICED), stones);
    const form = priceForm({ currency: "EUR", metal: { gold18: 50 }, stone: { diamond: 500 }, labor: { mode: "perStone", amount: 5 } }, asks);
    expect(form.currency).toBe("EUR");
    expect(form.metals["gold18"]).toBe("50");
    expect(form.stones["diamond"]).toBe("500");
    expect(form.laborMode).toBe("perStone");
    expect(form.laborAmount).toBe("5");
    // No stored book: empty fields, USD, no labor.
    const empty = priceForm(null, asks);
    expect(empty.currency).toBe("USD");
    expect(empty.metals["gold18"]).toBe("");
    expect(empty.laborMode).toBe("none");
  });

  test("builds the set payload, and refuses a field that is not a price", () => {
    const base = { currency: "USD", metals: { gold18: "50" }, stones: { diamond: "500", default: "" }, laborMode: "flat" as const, laborAmount: "100" };
    const plan = planPriceBook(base);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.params).toEqual({ set: { currency: "USD", metal: { gold18: 50 }, stone: { diamond: 500 }, labor: { flat: 100 } } });
    // An empty field is simply left out; a bad one is a field error.
    const bad = planPriceBook({ ...base, metals: { gold18: "lots" } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors["metal:gold18"]).toBeDefined();
    // Labor on, amount missing: a labor error.
    const noAmount = planPriceBook({ ...base, laborAmount: "" });
    expect(noAmount.ok).toBe(false);
    if (!noAmount.ok) expect(noAmount.errors["labor"]).toBeDefined();
    // Negative is not a price.
    const negative = planPriceBook({ ...base, stones: { diamond: "-5" } });
    expect(negative.ok).toBe(false);
  });

  test("knows when there is a price to save", () => {
    expect(hasAnyPrice({ currency: "USD", metals: {}, stones: {}, laborMode: "none", laborAmount: "" })).toBe(false);
    expect(hasAnyPrice({ currency: "USD", metals: { gold18: "50" }, stones: {}, laborMode: "none", laborAmount: "" })).toBe(true);
    expect(hasAnyPrice({ currency: "USD", metals: {}, stones: {}, laborMode: "flat", laborAmount: "100" })).toBe(true);
    expect(hasAnyPrice({ currency: "USD", metals: { gold18: "" }, stones: {}, laborMode: "none", laborAmount: "" })).toBe(false);
  });

  test("maps a refusal to its field", () => {
    expect(priceRefusalField("pricebook: `metal.gold18` must be a price from 0 to a sane maximum")).toBe("metal:gold18");
    expect(priceRefusalField("pricebook: `stone.diamond` must be a price from 0 to a sane maximum")).toBe("stone:diamond");
    expect(priceRefusalField("pricebook: `labor.perStone` must be a number from 0 to a sane maximum")).toBe("labor");
    expect(priceRefusalField("pricebook: `currency` must be a short code such as \"USD\"")).toBe("currency");
    expect(priceRefusalField("pricebook: something else entirely")).toBeNull();
  });
});
