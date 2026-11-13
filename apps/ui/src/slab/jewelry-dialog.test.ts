/**
 * The Ring and Gem dialogs whose body Slab draws: the params the one document is handed for each
 * (`./jewelry-params`), the state both views share (`../jewelry-edit`), and the document itself
 * (`slab/jewelry-dialog.slab`), read as text: the vendored compiler is not loaded under `bun test`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot } from "solid-js";
import type { Envelope } from "../facade";
import type { GemField, GemForm, JewelryEngine, RingField, RingForm } from "../jewelry-dialog";
import { createGemEdit, createRingEdit, type JewelrySource } from "../jewelry-edit";
import { MAX_PARAM_TEXT } from "./bench-params";
import { gemParams, gemTyped, jewelryValues, ringParams, ringTyped, GEM_TYPED, JEWELRY_LISTS, JEWELRY_SCALARS, JEWELRY_SIGNALS, MAX_JEWELRY_FACTS, RING_TYPED } from "./jewelry-params";
import { isItemKey } from "./modal";

const ui = join(import.meta.dir, "..", "..");
/** Spelled apart so the design-system check does not read the fixture as a colour in the interface. */
const H = "#";
/** The line separator, by its number: a literal one in this file would end the line it is on. */
const LS = String.fromCharCode(0x2028);

const RING: RingForm = { system: "us", size: "7", wall: "1.8", width: "2", metal: "gold18", x: "0", y: "0" };
const GEM: GemForm = { cut: "round", stone: "diamond", diameter: "6.5", length: "", width: "", x: "0", y: "0" };
const NO_RING_VIEW = { errors: {}, sizeError: undefined, summary: "", facts: [] };
const NO_GEM_VIEW = { errors: {}, summary: "", note: null, elongated: false, facts: [] };

describe("the ring's params", () => {
  test("the size under its system, then the wall and the width, then the position", () => {
    const p = ringParams(RING, NO_RING_VIEW);
    expect(p.gem).toBe(false);
    expect(p.first_name).toBe("Size system");
    expect(p.top.map((row) => [row.key, row.name, row.shown])).toEqual([["size", "Size", "7"]]);
    expect(p.mid.map((row) => [row.key, row.name, row.shown])).toEqual([
      ["wall", "Wall, in mm", "1.8"],
      ["width", "Width, in mm", "2"],
    ]);
    expect(p.place.map((row) => [row.key, row.shown])).toEqual([
      ["x", "0"],
      ["y", "0"],
    ]);
    expect(p.notes).toEqual([]);
  });

  test("an empty size shows the example of its system, in the place a placeholder would", () => {
    const blank = ringParams({ ...RING, size: "", system: "uk" }, NO_RING_VIEW).top[0];
    expect(blank).toMatchObject({ blank: true, eg: "For example M" });
    expect(ringParams(RING, NO_RING_VIEW).top[0]?.blank).toBe(false);
    // A refusal takes the example's place.
    expect(ringParams({ ...RING, size: "" }, { ...NO_RING_VIEW, sizeError: "Enter a value." }).top[0]).toMatchObject({ blank: false, bad: true, hint: "Enter a value." });
  });

  test("the engine's sizes are lines that say themselves; with none, the line that stands for them", () => {
    const none = ringParams(RING, NO_RING_VIEW);
    expect(none.facts).toEqual([]);
    expect(none.facts_empty.map((line) => line.note)).toEqual(["Type a size to see it in every system."]);
    const some = ringParams(RING, { ...NO_RING_VIEW, facts: [{ label: "Inside diameter", value: "17.32 mm" }, { label: "UK", value: "N" }] });
    expect(some.facts_empty).toEqual([]);
    expect(some.facts.map((fact) => fact.said)).toEqual(["Inside diameter: 17.32 mm", "UK: N"]);
    expect(some.facts_head).toBe("SIZES");
    expect(some.facts_title).toBe("Sizes");
  });

  test("a refusal marks its field: a typed row, or the words under a list's hole", () => {
    const p = ringParams(RING, { ...NO_RING_VIEW, errors: { wall: "`wall` must be a positive number", metal: "unknown metal", system: "unknown system" }, summary: "The engine is busy." });
    expect(p.mid[0]).toMatchObject({ bad: true, hint: "`wall` must be a positive number" });
    expect(p.mid[1]).toMatchObject({ bad: false, hint: "" });
    expect([p.metal_bad, p.metal_hint]).toEqual([true, "unknown metal"]);
    expect([p.first_bad, p.first_hint]).toEqual([true, "unknown system"]);
    expect(p.alerts).toEqual([{ key: "alert", note: "The engine is busy." }]);
  });
});

describe("the gem's params", () => {
  test("a round cut asks for a diameter; an elongated one for a length and a width", () => {
    const round = gemParams(GEM, NO_GEM_VIEW);
    expect(round.gem).toBe(true);
    expect(round.first_name).toBe("Cut");
    expect(round.top.map((row) => row.key)).toEqual(["diameter"]);
    expect(round.mid).toEqual([]);
    const oval = gemParams({ ...GEM, length: "8", width: "6" }, { ...NO_GEM_VIEW, elongated: true });
    expect(oval.top.map((row) => [row.key, row.shown])).toEqual([
      ["length", "8"],
      ["width", "6"],
    ]);
  });

  test("the engine's note stands over the form, and the cut's example under it", () => {
    const p = gemParams(GEM, { ...NO_GEM_VIEW, note: "The engine listed no cuts.", facts: [{ label: "Its depth", value: "4 mm" }] });
    expect(p.notes).toEqual([{ key: "note", note: "The engine listed no cuts." }]);
    expect(p.facts_head).toBe("CUT");
    expect(p.facts.map((fact) => fact.said)).toEqual(["Its depth: 4 mm"]);
    expect(gemParams(GEM, NO_GEM_VIEW).facts_empty.map((line) => line.note)).toEqual(["The engine gave no example for this cut."]);
  });

  test("a refusal on the cut or the stone stands under its hole", () => {
    const p = gemParams(GEM, { ...NO_GEM_VIEW, errors: { cut: "unknown cut", stone: "unknown stone", diameter: "must be positive" } });
    expect([p.first_bad, p.first_hint, p.stone_bad, p.stone_hint]).toEqual([true, "unknown cut", true, "unknown stone"]);
    expect(p.top[0]).toMatchObject({ bad: true, hint: "must be positive" });
  });
});

describe("what is handed to the kernel", () => {
  test("hostile text is one capped line, and the figures are capped", () => {
    const long = `a\nb${LS}${"x".repeat(5_000)}`;
    const facts = Array.from({ length: 200 }, (_, i) => ({ label: `${long}${i}`, value: long }));
    const p = ringParams({ ...RING, size: long, wall: "1\t2" }, { errors: { wall: long }, sizeError: long, summary: long, facts });
    expect(p.facts.length).toBe(MAX_JEWELRY_FACTS);
    for (const text of [p.top[0]?.shown ?? "", p.top[0]?.hint ?? "", p.alerts[0]?.note ?? "", p.facts[0]?.name ?? "", p.facts[0]?.amount ?? "", p.mid[0]?.hint ?? ""]) {
      expect(text.length).toBeLessThanOrEqual(Math.max(MAX_PARAM_TEXT, 400));
      expect(text.includes("\n") || text.includes(LS)).toBe(false);
    }
    expect(p.mid[0]?.shown).toBe("1 2");
  });

  test("every row's key is one a signal can carry, and the buffers are held to the rows", () => {
    const p = ringParams(RING, NO_RING_VIEW);
    const g = gemParams({ ...GEM, length: "8", width: "6" }, { ...NO_GEM_VIEW, elongated: true });
    for (const row of [...p.top, ...p.mid, ...p.place, ...g.top, ...g.place]) expect(isItemKey(row.key)).toBe(true);
    expect([...jewelryValues(p)]).toEqual([
      ["size", "7"],
      ["wall", "1.8"],
      ["width", "2"],
      ["x", "0"],
      ["y", "0"],
    ]);
  });

  test("the scalars and the lists named for the host are the params' own, all of them", () => {
    const names = Object.keys(ringParams(RING, NO_RING_VIEW)).sort();
    const named: string[] = [...JEWELRY_SCALARS, ...JEWELRY_LISTS];
    expect(named.sort()).toEqual(names);
    expect(Object.keys(gemParams(GEM, NO_GEM_VIEW)).sort()).toEqual(names);
  });
});

describe("a signal's item key", () => {
  test("names a typed field of the form, and nothing else", () => {
    for (const field of RING_TYPED) expect(ringTyped(field)).toBe(field);
    for (const key of ["system", "metal", "diameter", "", "Size", "__proto__", "x/y", "constructor"]) expect(ringTyped(key)).toBeNull();
  });

  test("for a gem, only the measures its cut shows", () => {
    expect(GEM_TYPED.filter((field) => gemTyped(field, false) !== null)).toEqual(["diameter", "x", "y"]);
    expect(GEM_TYPED.filter((field) => gemTyped(field, true) !== null)).toEqual(["length", "width", "x", "y"]);
    for (const key of ["cut", "stone", "wall", "", "toString"]) expect(gemTyped(key, true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The state both views run on
// ---------------------------------------------------------------------------------------------

/** An engine that places what it is sent, or refuses in the words given. */
function engine(refuse: () => string | null): { facade: JewelryEngine; sent: { command: string; params: unknown }[] } {
  const sent: { command: string; params: unknown }[] = [];
  const facade: JewelryEngine = {
    commands: () => [],
    execute: (command: string, params?: unknown): Envelope => {
      if (command !== "ring" && command !== "gem") return { ok: false, error: `no ${command} here` };
      const said = refuse();
      if (said !== null) return { ok: false, error: said };
      sent.push({ command, params });
      return { ok: true, result: { message: `${command} placed` } };
    },
  };
  return { facade, sent };
}

/**
 * Under `bun test` Solid's core is its server build (`../test-preload`): signals hold, effects
 * never run. So what a dialog reads on opening is not exercised here (it is in the browser run);
 * what is typed, what OK sends and where a refusal lands are.
 */
function source(refuse: () => string | null = () => null): { props: JewelrySource; sent: { command: string; params: unknown }[]; placed: (string | null)[]; closed: () => number } {
  const { facade, sent } = engine(refuse);
  const placed: (string | null)[] = [];
  let closed = 0;
  return { props: { facade, open: true, onClose: () => (closed += 1), onPlaced: (message) => placed.push(message) }, sent, placed, closed: () => closed };
}

const tick = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

describe("the ring's state, as both dialogs run it", () => {
  test("a field left empty is refused before the engine is asked, and the keyboard is sent to it", async () => {
    const s = source();
    const focused: RingField[] = [];
    const edit = createRoot(() => createRingEdit(s.props, (field) => focused.push(field)));
    edit.apply();
    await tick();
    expect(s.sent).toEqual([]);
    expect(focused.length).toBe(1);
    expect(edit.errors()[focused[0] ?? "size"]).toBeDefined();
    expect(s.closed()).toBe(0);
  });

  test("typing answers the refusal on that field only", async () => {
    const s = source();
    const edit = createRoot(() => createRingEdit(s.props, () => undefined));
    edit.apply();
    const marked = Object.keys(edit.errors());
    expect(marked).toContain("size");
    edit.edit({ size: "7" }, "size");
    expect(edit.errors().size).toBeUndefined();
    expect(Object.keys(edit.errors()).length).toBe(marked.length - 1);
  });

  test("a whole form is placed, the shell is told the engine's line, and the dialog closes", () => {
    const s = source();
    const edit = createRoot(() => createRingEdit(s.props, () => undefined));
    edit.edit(RING);
    edit.apply();
    expect(s.sent.map((call) => call.command)).toEqual(["ring"]);
    expect(JSON.stringify(s.sent[0]?.params)).toContain("1.8");
    expect(s.placed.length).toBe(1);
    expect(s.closed()).toBe(1);
  });

  test("the engine's refusal stays in the dialog: on the field it names, else over the form", async () => {
    let said: string | null = "invalid parameters for `ring`: `wall` must be a positive number of millimetres";
    const s = source(() => said);
    const focused: RingField[] = [];
    const edit = createRoot(() => createRingEdit(s.props, (field) => focused.push(field)));
    edit.edit(RING);
    edit.apply();
    await tick();
    expect(edit.errors().wall).toContain("positive");
    expect(focused).toEqual(["wall"]);
    said = "the drawing is read-only";
    edit.apply();
    expect(edit.summary()).toBe("the drawing is read-only");
    expect(edit.errors()).toEqual({});
    expect(s.closed()).toBe(0);
  });
});

describe("the gem's state, as both dialogs run it", () => {
  test("a refusal lands on the field the engine names", async () => {
    const s = source(() => "invalid parameters for `gem`: `diameter` must be a positive number of millimetres");
    const focused: GemField[] = [];
    const edit = createRoot(() => createGemEdit(s.props, (field) => focused.push(field)));
    edit.edit(GEM);
    edit.apply();
    await tick();
    if (focused.length > 0) expect(edit.errors()[focused[0] ?? "diameter"]).toBeDefined();
    else expect(edit.summary()).not.toBe("");
    expect(s.sent).toEqual([]);
    expect(s.closed()).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

describe("the document", () => {
  const text = readFileSync(join(ui, "slab", "jewelry-dialog.slab"), "utf8");
  const code = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  test("declares every param the host sets, and no other", () => {
    const declared = [...code.slice(code.indexOf("params {"), code.indexOf("col #body")).matchAll(/^\s+([a-z_]+)\s+(text|bool|num|list\()/gm)].map((m) => m[1] ?? "");
    expect(declared.sort()).toEqual([...JEWELRY_SCALARS, ...JEWELRY_LISTS].sort());
  });

  test("fires the signals the host answers, and no other", () => {
    const fired = new Set([...code.matchAll(/\b(?:act|field|submit)=([a-z_]+)/g)].map((m) => m[1] ?? ""));
    expect([...fired].sort()).toEqual([...JEWELRY_SIGNALS].sort());
  });

  test("the list items carry the fields the params give them", () => {
    const p = ringParams(RING, { ...NO_RING_VIEW, facts: [{ label: "US", value: "7" }] });
    const fields = (def: string): string[] => (new RegExp(`def ${def}\\(([^)]*)\\)`).exec(code)?.[1] ?? "").split(",").map((part) => part.trim().split("=")[0] ?? "").sort();
    const keys = (item: object | undefined): string[] => Object.keys(item ?? {}).filter((name) => name !== "key").sort();
    expect(keys(p.top[0])).toEqual(fields("FormField"));
    expect(keys(p.facts[0])).toEqual(fields("FormFact"));
    expect(keys(p.facts_empty[0] ?? { note: "" })).toEqual(fields("FormEmpty"));
    expect(fields("FormAlert")).toEqual(["note"]);
    expect(fields("FormNote")).toEqual(["note"]);
  });

  test("the holes are the lists the hosts mount, and none stands in a list item", () => {
    expect([...code.matchAll(/\bhole ([a-z]+)/g)].map((m) => m[1])).toEqual(["first", "stone", "metal"]);
    for (const def of code.split(/\ndef /).slice(1)) expect(def.slice(0, def.indexOf("\n}\n"))).not.toMatch(/\bhole\b/);
    const host = readFileSync(join(ui, "src", "slab", "SlabJewelry.tsx"), "utf8");
    // The ring mounts the size system and the metal; the gem the cut and the stone.
    expect([...host.matchAll(/<ModalHole name="([a-z]+)"/g)].map((m) => m[1])).toEqual(["first", "metal", "first", "stone"]);
    // A list is the interface's own Select: no popup is built in the document or the host.
    expect(host.includes("./popup")).toBe(false);
    expect(code).not.toMatch(/role=(listbox|option|menu)/);
  });

  test("takes its colours from the token sheet, names no font and draws no glyph of its own", () => {
    expect(code).not.toMatch(new RegExp(`${H}[0-9a-fA-F]{3,8}\\b`));
    expect(code).toContain('import "gen/tokens.slab"');
    expect(code).not.toMatch(/\bfamily\b|\.(ttf|otf|woff2?|shx|png|svg)\b/i);
    expect(code).not.toMatch(/^\s*icon\b/m);
    for (const m of code.matchAll(/\bstyle=([a-z.-]+)/g)) expect(m[1]).toMatch(/^text\.(body|label|chip)$/);
  });

  test("every field says what it is and the refusal on it; the figures are a list that speaks up", () => {
    const fields = code.split("\n").filter((line) => /\bfield=/.test(line));
    expect(fields.length).toBe(1);
    for (const line of fields) expect(line).toMatch(/\blabel=name\b.*\bdesc=hint\b/);
    expect(code).toMatch(/role=alert/);
    expect(code).toMatch(/role=list label=param\.facts_title live=polite/);
    expect(code).toMatch(/role=listitem label=said/);
  });
});
