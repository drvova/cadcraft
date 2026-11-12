import { describe, expect, test } from "bun:test";
import type { Envelope } from "./facade";
import {
  ENGINE_DEFAULT,
  gemChoices,
  gemFacts,
  gemRefusalField,
  isElongated,
  MAX_CHOICES,
  metalLabel,
  paramDoc,
  paramsOf,
  parseGemList,
  parseRingSize,
  place,
  placedMessage,
  planGem,
  planRing,
  previewRing,
  readGemChoices,
  readRingChoices,
  ringChoices,
  ringFacts,
  ringRefusalField,
  ringSizeQuery,
  sizeExample,
  type GemForm,
  type JewelryEngine,
  type RingForm,
} from "./jewelry-dialog";

/** The parameter lines as the engine states them (`sizes.rs`, `gem.rs`). */
const RING_DOC =
  "{at: [x,y], system?: us|uk|eu|jp|cn (default us), size?, diameter?: mm, wall?: mm (default 1.8, the band's radial thickness), width?: mm (default 2.0, along the finger), gap?: mm (default 0.02 sizing allowance), metal?: gold24|22|18|14|10|9|platinum|palladium|silver|steel|titanium|wax (default gold18), layer?, view?: bool (default true; draws the side view when `width` is given)} → {handle, block, size, innerDiameter, outerDiameter, wall, width, weight: {metal, density, volumeMm3, grams}}";
const GEM_DOC =
  "{at: [x,y], cut?: round|oval|cushion|princess|square|radiant|emerald|baguette|rect|marquise|pear|heart|trillion|cabochon (default round), length?, width?, diameter?: mm (sets both), depth?: mm (default: the cut's usual proportion), stone?: diamond|cz|sapphire|ruby|emerald|… (default diamond), sg?: specific gravity (instead of `stone`), rotate?: degrees, table?: bool (default true; also draws the table facet), layer?} → {handle, block, cut, length, width, depth, carat, sg, calibrated}";

const GEMLIST = {
  cuts: [
    { name: "round", factor: 0.0061, depthRatio: 0.6, measure: "diameter", example: "6.5 mm", exampleDepth: "3.9", exampleCarat: 1.005 },
    { name: "oval", factor: 0.0062, depthRatio: 0.6, measure: "length×width", example: "8×6 mm", exampleDepth: "3.6", exampleCarat: 1.071 },
  ],
  stones: [
    ["diamond", 3.52],
    ["sapphire", 4.0],
  ],
};

interface Call {
  command: string;
  params: unknown;
}

/** An engine that records what it is asked and answers from a table. */
function engine(answers: Record<string, Envelope>, docs: Record<string, string> = { ring: RING_DOC, gem: GEM_DOC }): JewelryEngine & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    execute(command: string, params?: unknown): Envelope {
      calls.push({ command, params });
      return answers[command] ?? { ok: false, error: `unknown command ${command}` };
    },
    commands: () => Object.entries(docs).map(([id, params]) => ({ id, params })),
  };
}

const ring = (patch: Partial<RingForm> = {}): RingForm => ({ ...ringChoices(RING_DOC).form, ...patch });

describe("paramDoc", () => {
  test("reads the alloys, continuing a name through the bare numbers after it", () => {
    const metal = paramDoc(RING_DOC, "metal");
    expect(metal.choices).toEqual(["gold24", "gold22", "gold18", "gold14", "gold10", "gold9", "platinum", "palladium", "silver", "steel", "titanium", "wax"]);
    expect(metal.fallback).toBe("gold18");
  });

  test("reads a default that is a number, and one after a colon", () => {
    expect(paramDoc(RING_DOC, "wall")).toEqual({ choices: [], fallback: "1.8" });
    expect(paramDoc(RING_DOC, "width").fallback).toBe("2.0");
    expect(paramDoc(RING_DOC, "system")).toEqual({ choices: ["us", "uk", "eu", "jp", "cn"], fallback: "us" });
    expect(paramDoc(GEM_DOC, "stone").fallback).toBe("diamond");
    expect(paramDoc(GEM_DOC, "cut").choices).toContain("cabochon");
  });

  test("reads only what the command takes, not what it replies", () => {
    expect(paramDoc("{a?: x|y} → {metal: p|q (default p)}", "metal")).toEqual({ choices: [], fallback: null });
  });

  test("hostile lines give nothing", () => {
    for (const doc of [null, undefined, 7, {}, "", "metal", "x".repeat(100_000), "metal?: |||| (default )"]) {
      expect(paramDoc(doc, "metal")).toEqual({ choices: [], fallback: null });
    }
    expect(paramDoc(RING_DOC, "me.*")).toEqual({ choices: [], fallback: null });
    expect(paramDoc("metal?: <b>|a|B|a|12", "metal").choices).toEqual(["a", "a12"]);
  });

  test("caps the list", () => {
    const many = Array.from({ length: 500 }, (_, i) => `m${i}`).join("|");
    expect(paramDoc(`{metal?: ${many}}`, "metal").choices.length).toBe(MAX_CHOICES);
  });
});

describe("the ring's choices", () => {
  test("the form opens on the engine's own defaults, with no size", () => {
    const held = readRingChoices(engine({}));
    expect(held.form).toEqual({ system: "us", size: "", wall: "1.8", width: "2", metal: "gold18", x: "0", y: "0" });
    expect(held.metals[0]).toEqual({ value: "gold24", label: "24k gold" });
    expect(held.metals.map((m) => m.value)).toContain("platinum");
  });

  test("an engine that lists nothing leaves the alloy to the engine", () => {
    const held = readRingChoices(engine({}, {}));
    expect(held.metals).toEqual([{ value: ENGINE_DEFAULT, label: "Engine default" }]);
    expect(held.form.metal).toBe(ENGINE_DEFAULT);
    expect(held.form.wall).toBe("");
    const plan = planRing({ ...held.form, size: "7", wall: "1.5", width: "3" });
    expect(plan.ok && "metal" in plan.params).toBe(false);
  });

  test("a facade that throws or answers nonsense lists nothing", () => {
    expect(
      paramsOf(
        {
          commands: () => {
            throw new Error("trap");
          },
        },
        "ring",
      ),
    ).toBe("");
    expect(paramsOf({ commands: () => null as never }, "ring")).toBe("");
    expect(paramsOf({ commands: () => [null, 3, { id: "ring", params: 9 }] as never }, "ring")).toBe("");
  });

  test("labels", () => {
    expect(metalLabel("gold9")).toBe("9k gold");
    expect(metalLabel("platinum")).toBe("Platinum");
    expect(metalLabel("")).toBe("");
    expect(sizeExample("uk")).toBe("M");
    expect(sizeExample("nowhere")).toBe("");
  });
});

describe("planRing", () => {
  test("sends the engine's JSON form", () => {
    expect(planRing(ring({ size: "7", wall: "1,5", width: "3", metal: "platinum", x: "10", y: "-2.5" }))).toEqual({
      ok: true,
      params: { at: [10, -2.5], system: "us", size: 7, wall: 1.5, width: 3, metal: "platinum" },
    });
  });

  test("a UK size goes as its letter", () => {
    const plan = planRing(ring({ system: "uk", size: " M½ " }));
    expect(plan.ok && plan.params["size"]).toBe("M½");
  });

  test("an unknown system is the engine's default", () => {
    const plan = planRing(ring({ system: "mars", size: "7" }));
    expect(plan.ok && plan.params["system"]).toBe("us");
  });

  test("what cannot be read is marked and nothing is planned", () => {
    expect(planRing(ring({ size: "", wall: "thick", x: "" }))).toEqual({ ok: false, errors: { size: "Enter a value.", wall: "Enter a number.", x: "Enter a value." } });
    expect(planRing(ring({ system: "uk", size: "" }))).toEqual({ ok: false, errors: { size: "Enter a value." } });
    expect(planRing(ring({ system: "uk", size: "MMMMMMMMMMMM" })).ok).toBe(false);
    expect(planRing(ring({ size: "1e999" })).ok).toBe(false);
    expect(planRing(ring({ size: "NaN" })).ok).toBe(false);
  });
});

describe("the ring's size in every system", () => {
  const SIZES: Envelope = {
    ok: true,
    result: { system: "us", count: 1, sizes: [{ mm: 17.32, diameter: 17.32, circumference: 54.412, us: 7, usText: "7", uk: "N½", eu: 54, jp: 14, cn: 14 }], message: "…" },
  };

  test("asks the engine for the one size and shows its figures unchanged", () => {
    const held = engine({ ringsizes: SIZES });
    const preview = previewRing(held, ring({ size: "7" }));
    expect(held.calls).toEqual([{ command: "ringsizes", params: { system: "us", size: 7 } }]);
    expect(preview).toEqual({
      kind: "sizes",
      facts: [
        { label: "Inside diameter", value: "17.32 mm" },
        { label: "Inside circumference", value: "54.412 mm" },
        { label: "US", value: "7" },
        { label: "UK", value: "N½" },
        { label: "EU", value: "54" },
        { label: "JP", value: "14" },
        { label: "CN", value: "14" },
      ],
    });
  });

  test("asks nothing while there is no size to ask about", () => {
    const held = engine({ ringsizes: SIZES });
    expect(previewRing(held, ring({ size: "" }))).toEqual({ kind: "none" });
    expect(previewRing(held, ring({ size: "seven" }))).toEqual({ kind: "none" });
    expect(held.calls).toEqual([]);
    expect(ringSizeQuery(ring({ system: "uk", size: "m" }))).toEqual({ system: "uk", size: "m" });
  });

  test("a refusal is the engine's words", () => {
    expect(previewRing(engine({ ringsizes: { ok: false, error: "ringsizes: 99 is not a US ring size" } }), ring({ size: "99" }))).toEqual({ kind: "refused", error: "ringsizes: 99 is not a US ring size" });
  });

  test("hostile replies show nothing, or only what can be read", () => {
    for (const result of [null, 3, "x", [], {}, { sizes: 4 }, { sizes: [] }, { sizes: [null] }, { sizes: [{}] }, { sizes: [{ diameter: Number.NaN, uk: 7, eu: "54" }] }]) {
      expect(parseRingSize(result)).toBeNull();
      expect(previewRing(engine({ ringsizes: { ok: true, result } }), ring({ size: "7" }))).toEqual({ kind: "none" });
    }
    const part = parseRingSize({ sizes: [{ diameter: 17.3, uk: "x".repeat(500), us: 7.5, eu: Number.POSITIVE_INFINITY }] });
    expect(part === null ? [] : ringFacts(part)).toEqual([
      { label: "Inside diameter", value: "17.3 mm" },
      { label: "US", value: "7.5" },
    ]);
  });
});

describe("the gem's choices", () => {
  test("the cuts and the stones are the engine's, the form opens on its defaults", () => {
    const held = engine({ gemlist: { ok: true, result: GEMLIST } });
    const choices = readGemChoices(held);
    expect(held.calls).toEqual([{ command: "gemlist", params: {} }]);
    expect(choices.cuts).toEqual([
      { value: "round", label: "Round" },
      { value: "oval", label: "Oval" },
    ]);
    expect(choices.stones.map((s) => s.value)).toEqual(["diamond", "sapphire"]);
    expect(choices.form).toEqual({ cut: "round", stone: "diamond", diameter: "", length: "", width: "", x: "0", y: "0" });
    expect(choices.note).toBeNull();
  });

  test("a refused or empty list leaves the choice to the engine and says so", () => {
    const refused = gemChoices({ ok: false, error: "gemlist: no" }, GEM_DOC);
    expect(refused.cuts).toEqual([{ value: ENGINE_DEFAULT, label: "Engine default" }]);
    expect(refused.form.cut).toBe(ENGINE_DEFAULT);
    expect(refused.note).toContain("gemlist: no");
    expect(gemChoices({ ok: true, result: {} }, GEM_DOC).note).not.toBeNull();
    const plan = planGem(refused.list, { ...refused.form, diameter: "2" });
    expect(plan).toEqual({ ok: true, params: { at: [0, 0], diameter: 2 } });
  });

  test("hostile lists are narrowed and capped", () => {
    for (const result of [null, 1, "x", [], { cuts: 3, stones: "y" }, { cuts: [null, 4, {}, { name: 9 }, { name: "<img>" }], stones: [null, [], [3, 4], {}] }]) {
      expect(parseGemList(result)).toEqual({ cuts: [], stones: [] });
    }
    const many = { cuts: Array.from({ length: 5000 }, (_, i) => ({ name: `c${i}` })), stones: Array.from({ length: 5000 }, (_, i) => [`s${i}`, i]) };
    const list = parseGemList(many);
    expect(list.cuts.length).toBe(MAX_CHOICES);
    expect(list.stones.length).toBe(MAX_CHOICES);
    expect(parseGemList({ cuts: [{ name: "round" }, { name: "round" }], stones: [["ruby", "heavy"]] })).toEqual({
      cuts: [{ name: "round", elongated: true, example: null, exampleDepth: null, exampleCarat: null }],
      stones: [{ name: "ruby", sg: null }],
    });
  });
});

describe("planGem", () => {
  const list = parseGemList(GEMLIST);
  const gem = (patch: Partial<GemForm> = {}): GemForm => ({ cut: "round", stone: "diamond", diameter: "", length: "", width: "", x: "0", y: "0", ...patch });

  test("a round stone goes by its diameter", () => {
    expect(isElongated(list, gem())).toBe(false);
    expect(planGem(list, gem({ diameter: "6,5", stone: "sapphire", x: "3", y: "4", length: "ignored" }))).toEqual({
      ok: true,
      params: { at: [3, 4], cut: "round", diameter: 6.5, stone: "sapphire" },
    });
  });

  test("an elongated cut goes by its length and width", () => {
    expect(isElongated(list, gem({ cut: "oval" }))).toBe(true);
    expect(planGem(list, gem({ cut: "oval", length: "8", width: "6", diameter: "ignored" }))).toEqual({
      ok: true,
      params: { at: [0, 0], cut: "oval", length: 8, width: 6, stone: "diamond" },
    });
  });

  test("what cannot be read is marked, for the fields the cut shows only", () => {
    expect(planGem(list, gem())).toEqual({ ok: false, errors: { diameter: "Enter a value." } });
    expect(planGem(list, gem({ cut: "oval", length: "long", y: "" }))).toEqual({ ok: false, errors: { length: "Enter a number.", width: "Enter a value.", y: "Enter a value." } });
  });

  test("the read-out is the engine's example and the stone's gravity, unchanged", () => {
    expect(gemFacts(list, gem({ cut: "oval", stone: "sapphire" }))).toEqual([
      { label: "Example size", value: "8×6 mm" },
      { label: "Its depth", value: "3.6 mm" },
      { label: "Its weight in diamond", value: "1.071 ct" },
      { label: "Specific gravity, sapphire", value: "4" },
    ]);
    expect(gemFacts(list, gem({ cut: "nothing", stone: "nothing" }))).toEqual([]);
  });
});

describe("the engine's answer", () => {
  test("a refusal goes beside the field it names", () => {
    expect(ringRefusalField("ring: `wall` must be a positive number of mm")).toBe("wall");
    expect(ringRefusalField("ring: `at` ([x, y]) is required")).toBe("x");
    expect(ringRefusalField("ring: `99` is not a US ring size")).toBe("size");
    expect(ringRefusalField("ring: 30 mm is outside the ring sizes (11.6–25 mm)")).toBe("size");
    expect(ringRefusalField("ring: `tin` is not a metal (gold24|22|18)")).toBe("metal");
    expect(ringRefusalField("no drawing is open")).toBeNull();
    expect(ringRefusalField(null as never)).toBeNull();
    expect(gemRefusalField("gem: `width` must be positive", true)).toBe("width");
    expect(gemRefusalField("gem: `width` must be positive", false)).toBe("diameter");
    expect(gemRefusalField("gem: `diameter` must be positive", true)).toBe("length");
    expect(gemRefusalField("gem: `at` is not a cut (round, oval)", false)).toBe("cut");
    expect(gemRefusalField("gem: `jet` is not a stone (GEMLIST lists them); give `sg` instead", false)).toBe("stone");
    expect(gemRefusalField("the drawing is read-only", false)).toBeNull();
    expect(gemRefusalField(undefined as never, false)).toBeNull();
  });

  test("OK runs the command and hands back the engine's own weight", () => {
    const held = engine({ ring: { ok: true, result: { handle: "2A", weight: { metal: "gold18", grams: 3.51 }, message: "Ring size 7: about 3.51 g" } } });
    expect(place(held, "ring", { at: [0, 0], size: 7 })).toEqual({ ok: true, message: "Ring placed: 3.51 g of 18k gold" });
    expect(held.calls).toEqual([{ command: "ring", params: { at: [0, 0], size: 7 } }]);
    expect(place(engine({ gem: { ok: true, result: { cut: "oval", carat: 1.217, message: "oval 8×6 mm: 1.217 ct" } } }), "gem", {})).toEqual({ ok: true, message: "Oval placed: 1.217 ct" });
    expect(place(engine({ gem: { ok: false, error: "gem: `diameter` must be positive" } }), "gem", {})).toEqual({ ok: false, error: "gem: `diameter` must be positive" });
  });

  test("a reply without the figure says its line; a hostile one says nothing", () => {
    for (const result of [null, 4, [], {}, { message: 7 }, { message: "   " }, { weight: { grams: "heavy" } }, { weight: 3, carat: Number.NaN }]) {
      expect(placedMessage("ring", result)).toBeNull();
      expect(placedMessage("gem", result)).toBeNull();
    }
    expect(placedMessage("ring", { weight: { grams: 2 } })).toBe("Ring placed: 2 g");
    expect(placedMessage("gem", { carat: 0.5 })).toBe("Stone placed: 0.5 ct");
    expect(placedMessage("ring", { carat: 1, message: "a\nb" })).toBe("a b");
    expect(placedMessage("gem", { message: "x".repeat(5000) })?.length).toBe(400);
  });
});
