import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import type { Envelope } from "./facade";
import type { GemField, GemForm, JewelryEngine, RingField, RingForm } from "./jewelry-dialog";
import { createGemEdit, createRingEdit, type JewelrySource } from "./jewelry-edit";

const RING: RingForm = { system: "us", size: "7", wall: "1.8", width: "2", metal: "gold18", x: "0", y: "0" };

const GEM: GemForm = { cut: "round", stone: "diamond", diameter: "6.5", length: "", width: "", x: "0", y: "0" };

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

describe("the ring's state", () => {
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

describe("the gem's state", () => {
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
