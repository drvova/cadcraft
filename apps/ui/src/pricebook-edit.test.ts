import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { CURRENCY_FIELD, LABOR_FIELD, metalFieldId } from "./bench";
import type { Envelope } from "./facade";
import type { JewelryEngine } from "./jewelry-dialog";
import { createPriceBookEdit, type PriceBookEdit, type PriceBookSource } from "./pricebook-edit";

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
 * The editor over a dialog's props, as the dialog makes it. Under `bun test` Solid's core is its
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

describe("the price book's editor", () => {
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
