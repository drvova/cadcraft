/**
 * The Price Book dialog whose body Slab draws: the params it is handed (`./pricebook-params`),
 * the editor both dialogs share (`../pricebook-edit`), and the document itself
 * (`slab/pricebook.slab`), read as text: the vendored compiler is not loaded under `bun test`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot } from "solid-js";
import { CURRENCY_FIELD, LABOR_FIELD, metalFieldId, stoneFieldId, type PriceAsks, type PriceForm } from "../bench";
import type { Envelope } from "../facade";
import type { JewelryEngine } from "../jewelry-dialog";
import { createPriceBookEdit, type PriceBookEdit, type PriceBookSource } from "../pricebook-edit";
import { MAX_PARAM_TEXT } from "./bench-params";
import { LABOR_ITEM, MAX_PRICE_ROWS, priceBookParams, priceItem, priceTarget, priceValues, PRICE_LISTS, PRICE_SCALARS, PRICE_SIGNALS } from "./pricebook-params";

const ui = join(import.meta.dir, "..", "..");
/** Spelled apart so the design-system check does not read the fixture as a colour in the interface. */
const H = "#";
/** The line separator, by its number: a literal one in this file would end the line it is on. */
const LS = String.fromCharCode(0x2028);

const ASKS: PriceAsks = {
  metals: [
    { value: "gold18", label: "18k gold" },
    { value: "platinum", label: "Platinum" },
  ],
  materials: [
    { value: "diamond", label: "Diamond" },
    { value: "default", label: "Other stones" },
  ],
};
const FORM: PriceForm = { currency: "USD", metals: { gold18: "62.5" }, stones: { diamond: "" }, laborMode: "none", laborAmount: "" };

describe("the price book body's params", () => {
  test("a row per alloy and per material, in the editor's order, each with what was typed", () => {
    const p = priceBookParams(ASKS, FORM, {}, "");
    expect(p.metals.map((row) => [row.key, row.name, row.shown])).toEqual([
      ["m-0", "18k gold", "62.5"],
      ["m-1", "Platinum", ""],
    ]);
    expect(p.stones.map((row) => [row.key, row.name])).toEqual([
      ["s-0", "Diamond"],
      ["s-1", "Other stones"],
    ]);
    expect(p.alerts).toEqual([]);
    expect(p.bandless).toEqual([]);
    expect(p.labor).toEqual([]);
  });

  test("a drawing with no band says so in the rows' place", () => {
    const p = priceBookParams({ metals: [], materials: ASKS.materials }, FORM, {}, "");
    expect(p.metals).toEqual([]);
    expect(p.bandless.map((line) => line.note)).toEqual(["The drawing has no band to price."]);
  });

  test("the labor amount shows only under a mode that takes one", () => {
    expect(priceBookParams(ASKS, { ...FORM, laborMode: "flat", laborAmount: "40" }, {}, "").labor).toEqual([{ key: LABOR_ITEM, name: "Labor amount", shown: "40", hint: "", bad: false }]);
    expect(priceBookParams(ASKS, { ...FORM, laborMode: "none", laborAmount: "40" }, {}, "").labor).toEqual([]);
  });

  test("a refusal marks its row in words; the currency's stands under its hole", () => {
    const p = priceBookParams(ASKS, FORM, { [metalFieldId("platinum")]: "Enter a price: a number, 0 or more.", [CURRENCY_FIELD]: "Not a currency code." }, "");
    expect(p.metals[1]).toMatchObject({ bad: true, hint: "Enter a price: a number, 0 or more." });
    expect(p.metals[0]).toMatchObject({ bad: false, hint: "" });
    expect(p.currency_bad).toBe(true);
    expect(p.currency_hint).toBe("Not a currency code.");
  });

  test("what happened to the whole form is one line of the alerts, or none", () => {
    expect(priceBookParams(ASKS, FORM, {}, "Enter at least one price to estimate a cost.").alerts).toEqual([{ key: "alert", note: "Enter at least one price to estimate a cost." }]);
  });

  test("hostile text is one capped line, and the rows are capped", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ value: `a${i}`, label: `Alloy\n${i}${LS}${"x".repeat(2_000)}` }));
    const p = priceBookParams({ metals: many, materials: many }, { ...FORM, metals: { a0: "1\n2\t3" } }, { [metalFieldId("a0")]: "no\nway ".repeat(400) }, "bad\u0000news ".repeat(400));
    expect(p.metals.length).toBe(MAX_PRICE_ROWS);
    expect(p.stones.length).toBe(MAX_PRICE_ROWS);
    for (const row of p.metals) {
      expect(row.name.length).toBeLessThanOrEqual(MAX_PARAM_TEXT);
      expect(row.name.includes("\n") || row.name.includes(LS)).toBe(false);
    }
    expect(p.metals[0]?.shown).toBe("1 2 3");
    expect(p.metals[0]?.hint.length).toBeLessThanOrEqual(400);
    expect(p.alerts[0]?.note.length).toBeLessThanOrEqual(400);
    expect(p.alerts[0]?.note).not.toContain("\u0000");
  });

  test("the fields' buffers are held to the rows' values", () => {
    const values = priceValues(priceBookParams(ASKS, { ...FORM, laborMode: "perGram", laborAmount: "3" }, {}, ""));
    expect([...values]).toEqual([
      ["m-0", "62.5"],
      ["m-1", ""],
      ["s-0", ""],
      ["s-1", ""],
      [LABOR_ITEM, "3"],
    ]);
  });
});

describe("a signal's item key and a form's field", () => {
  test("a row's key names its part of the form", () => {
    expect(priceTarget(ASKS, FORM, "m-1")).toEqual({ kind: "metal", value: "platinum" });
    expect(priceTarget(ASKS, FORM, "s-0")).toEqual({ kind: "stone", value: "diamond" });
    expect(priceTarget(ASKS, { ...FORM, laborMode: "flat" }, LABOR_ITEM)).toEqual({ kind: "labor" });
  });

  test("a stale or forged key names nothing", () => {
    expect(priceTarget(ASKS, FORM, LABOR_ITEM)).toBeNull();
    for (const key of ["m-2", "s-9", "m-64", "m-999", "m--1", "x-0", "m-0/../s-0", "", "__proto__", "m-1e1"]) expect(priceTarget(ASKS, FORM, key)).toBeNull();
  });

  test("a refusal's field is the row it is drawn as; the currency is the host's own", () => {
    expect(priceItem(ASKS, metalFieldId("platinum"))).toBe("m-1");
    expect(priceItem(ASKS, stoneFieldId("default"))).toBe("s-1");
    expect(priceItem(ASKS, LABOR_FIELD)).toBe(LABOR_ITEM);
    expect(priceItem(ASKS, CURRENCY_FIELD)).toBeNull();
    expect(priceItem(ASKS, metalFieldId("unobtainium"))).toBeNull();
  });

  test("every row's key goes round: key to target to field to key", () => {
    const p = priceBookParams(ASKS, FORM, {}, "");
    for (const row of [...p.metals, ...p.stones]) {
      const target = priceTarget(ASKS, FORM, row.key);
      if (target === null || target.kind === "labor") throw new Error(`no target for ${row.key}`);
      expect(priceItem(ASKS, target.kind === "metal" ? metalFieldId(target.value) : stoneFieldId(target.value))).toBe(row.key);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The editor both dialogs run on
// ---------------------------------------------------------------------------------------------

/** An engine that lists one stone, stores a book, and refuses what the test tells it to. */
function engine(refuse: () => string | null): { facade: JewelryEngine; sent: unknown[] } {
  const sent: unknown[] = [];
  let book: unknown = null;
  const facade: JewelryEngine = {
    commands: () => [],
    execute: (command: string, params?: unknown): Envelope => {
      if (command === "gemlist") return { ok: true, result: { cuts: [], stones: [{ name: "diamond", sg: 3.52 }] } };
      if (command !== "pricebook") return { ok: false, error: "unknown command" };
      if (params !== undefined && typeof params === "object" && params !== null && "set" in params) {
        const said = refuse();
        if (said !== null) return { ok: false, error: said };
        sent.push(params.set);
        book = params.set;
      }
      return { ok: true, result: { book } };
    },
  };
  return { facade, sent };
}

interface Opened {
  edit: PriceBookEdit;
  focused: string[];
  closed: () => number;
  saved: () => number;
  sent: unknown[];
  dispose: () => void;
}

/**
 * The editor over a dialog's props, as either view makes it. Under `bun test` Solid's core is its
 * server build (`../test-preload` says why): signals hold, effects never run and a memo is worked
 * out once. So what the editor reads on opening (the alloys asked about, the stored book) and
 * `untouched` are not exercised here; they are in the browser run. What is typed, what Save
 * sends and where a refusal lands are.
 */
function opened(refuse: () => string | null = () => null): Opened {
  const { facade, sent } = engine(refuse);
  const focused: string[] = [];
  let closed = 0;
  let saved = 0;
  const source: PriceBookSource = { facade, open: true, sheet: { stones: 1, carat: 1, grams: 3, lines: [], warnings: [], alloys: ["gold18"], stoneSgs: [3.52] }, onClose: () => (closed += 1), onSaved: () => (saved += 1) };
  return createRoot((dispose) => {
    const edit = createPriceBookEdit(source, (field) => focused.push(field));
    return { edit, focused, closed: () => closed, saved: () => saved, sent, dispose };
  });
}

const tick = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

describe("the price book's editor, as both dialogs run it", () => {
  test("with nothing asked about, the keyboard starts on the currency", () => {
    const o = opened();
    expect(o.edit.firstField()).toBe(CURRENCY_FIELD);
    o.dispose();
  });

  test("Save with no price says so and sends nothing", async () => {
    const o = opened();
    await tick();
    o.edit.save();
    expect(o.edit.summary()).toBe("Enter at least one price to estimate a cost.");
    expect(o.sent).toEqual([]);
    expect(o.closed()).toBe(0);
    o.dispose();
  });

  test("a value that is not a price is refused beside its field, and the keyboard is sent there", async () => {
    const o = opened();
    await tick();
    o.edit.setMetal("gold18", "62.5");
    o.edit.setLaborMode("flat");
    o.edit.setLaborAmount("lots");
    o.edit.save();
    await tick();
    expect(o.edit.errors()[LABOR_FIELD]).toBeDefined();
    expect(o.focused).toEqual([LABOR_FIELD]);
    expect(o.sent).toEqual([]);
    // Typing in it again answers the refusal.
    o.edit.setLaborAmount("40");
    expect(o.edit.errors()[LABOR_FIELD]).toBeUndefined();
    o.dispose();
  });

  test("a good book is stored, the shell is told, and the dialog closes", async () => {
    const o = opened();
    await tick();
    o.edit.setMetal("gold18", "62.5");
    o.edit.save();
    expect(o.sent.length).toBe(1);
    expect(JSON.stringify(o.sent[0])).toContain("62.5");
    expect(o.saved()).toBe(1);
    expect(o.closed()).toBe(1);
    o.dispose();
  });

  test("the engine's refusal stays in the dialog: on the field it names, else over the form", async () => {
    let said: string | null = "invalid parameters for `pricebook`: `metal.gold18` must be 0 or more";
    const o = opened(() => said);
    await tick();
    o.edit.setMetal("gold18", "62.5");
    o.edit.save();
    await tick();
    expect(o.edit.errors()[metalFieldId("gold18")]).toContain("gold18");
    expect(o.focused).toEqual([metalFieldId("gold18")]);
    said = "the book is locked";
    o.edit.save();
    expect(o.edit.summary()).toBe("the book is locked");
    expect(o.closed()).toBe(0);
    o.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

describe("the document", () => {
  const source = readFileSync(join(ui, "slab", "pricebook.slab"), "utf8");
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  test("declares every param the host sets, and no other", () => {
    const declared = [...code.slice(code.indexOf("params {"), code.indexOf("col #body")).matchAll(/^\s+([a-z_]+)\s+(text|bool|num|list\()/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...PRICE_SCALARS, ...PRICE_LISTS].sort());
  });

  test("fires the signals the host answers, and no other", () => {
    const fired = new Set([...code.matchAll(/\b(?:act|field|submit)=([a-z_]+)/g)].map((m) => m[1]));
    expect([...fired].sort()).toEqual([...PRICE_SIGNALS].sort());
  });

  test("a row carries the fields the params give it", () => {
    const row = priceBookParams(ASKS, FORM, {}, "").metals[0] ?? {};
    const def = /def FormField\(([^)]*)\)/.exec(code)?.[1] ?? "";
    const props = def.split(",").map((part) => part.trim().split("=")[0] ?? "");
    expect(Object.keys(row).filter((name) => name !== "key").sort()).toEqual(props.sort());
  });

  test("the holes are the two controls the host mounts, and none stands in a list item", () => {
    expect([...code.matchAll(/\bhole ([a-z]+)/g)].map((m) => m[1])).toEqual(["currency", "labor"]);
    for (const def of code.split(/\ndef /).slice(1)) expect(def.slice(0, def.indexOf("\n}\n"))).not.toMatch(/\bhole\b/);
    const host = readFileSync(join(ui, "src", "slab", "SlabPriceBook.tsx"), "utf8");
    expect([...host.matchAll(/<ModalHole name="([a-z]+)"/g)].map((m) => m[1])).toEqual(["currency", "labor"]);
  });

  test("takes its colours from the token sheet, names no font and draws no glyph of its own", () => {
    expect(code).not.toMatch(new RegExp(`${H}[0-9a-fA-F]{3,8}\\b`));
    expect(code).toContain('import "gen/tokens.slab"');
    expect(code).not.toMatch(/\bfamily\b|\.(ttf|otf|woff2?|shx|png|svg)\b/i);
    expect(code).not.toMatch(/^\s*icon\b/m);
    for (const m of code.matchAll(/\bstyle=([a-z.-]+)/g)) expect(m[1]).toMatch(/^text\.(body|label|chip)$/);
  });

  test("every field says what it is, and the refusal standing on it", () => {
    const fields = code.split("\n").filter((line) => /\bfield=/.test(line));
    expect(fields.length).toBe(1);
    for (const line of fields) expect(line).toMatch(/\blabel=name\b.*\bdesc=hint\b/);
    expect(code).toMatch(/role=alert/);
    expect([...code.matchAll(/role=heading level=2 label="([^"]+)"/g)].map((m) => m[1])).toEqual(["Metal, per gram", "Stones, per carat"]);
  });
});
