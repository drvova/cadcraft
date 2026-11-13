import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { OSNAP_ALL, type DraftingEngine, type DraftingField } from "./drafting";
import { createDraftingEdit, type DraftingEdit } from "./drafting-edit";
import type { Envelope } from "./facade";

/**
 * An engine that keeps the switches and refuses what the test tells it to. It reports no
 * variable and no switch until one is set: what the editor holds before its first opening (the
 * opening's reading is an effect, which does not run here), so that what OK reads back after its
 * calls differs from that only by what the calls changed.
 */
function engine(refuse: readonly string[] = []): { facade: DraftingEngine; log: [string, unknown][] } {
  const toggles: Record<string, boolean | number> = {};
  const vars: Record<string, unknown> = {};
  const log: [string, unknown][] = [];
  const facade: DraftingEngine = {
    settings: () => toggles as unknown as ReturnType<DraftingEngine["settings"]>,
    execute(command: string, params: unknown = {}): Envelope {
      const p = params as Record<string, unknown>;
      if (command === "getvar") return typeof p["name"] === "string" && p["name"] in vars ? { ok: true, result: { name: p["name"], value: vars[p["name"]] } } : { ok: false, error: "unknown" };
      log.push([command, params]);
      if (refuse.includes(command)) return { ok: false, error: `${command}: refused` };
      if (command === "osnap") toggles["osmode"] = p["osmode"] as number;
      else if (command !== "setvar" && command !== "dsettings") toggles[command] = p["on"] as boolean;
      return { ok: true, result: {} };
    },
  };
  return { facade, log };
}

interface Opened {
  edit: DraftingEdit;
  focused: DraftingField[];
  closed: () => number;
  applied: () => number;
  log: [string, unknown][];
  dispose: () => void;
}

/**
 * The editor over a dialog's props, as the dialog makes it. Under `bun test` Solid's core is its
 * server build (`../test-preload` says why): signals hold and effects never run, so the reading
 * of the engine on opening is not exercised here (it is in the browser run): the editor starts
 * from an engine that reported nothing. What is ticked, what OK sends and where a refusal lands are.
 */
function opened(refuse: readonly string[] = []): Opened {
  const { facade, log } = engine(refuse);
  const focused: DraftingField[] = [];
  let closed = 0;
  let applied = 0;
  return createRoot((dispose) => {
    const edit = createDraftingEdit({ facade, open: true, onClose: () => (closed += 1), onApplied: () => (applied += 1) }, (field) => focused.push(field));
    return { edit, focused, closed: () => closed, applied: () => applied, log, dispose };
  });
}

const tick = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

describe("the drafting editor", () => {
  test("OK with nothing changed sends nothing and closes", () => {
    const o = opened();
    o.edit.apply();
    expect(o.log).toEqual([]);
    expect(o.closed()).toBe(1);
    expect(o.applied()).toBe(0);
    o.dispose();
  });

  test("a switch ticked is sent, the shell is told, and the dialog closes", () => {
    const o = opened();
    o.edit.edit({ snapOn: !o.edit.form().snapOn }, "snapOn");
    o.edit.apply();
    expect(o.log.map(([command]) => command)).toEqual(["snap"]);
    expect(o.applied()).toBe(1);
    expect(o.closed()).toBe(1);
    o.dispose();
  });

  test("a refused switch is marked, its page brought to the front and the keyboard sent there", async () => {
    const o = opened(["osnap"]);
    o.edit.setTab("snap-grid");
    o.edit.edit({ modes: OSNAP_ALL }, "modes");
    o.edit.apply();
    await tick();
    expect(o.closed()).toBe(0);
    expect(o.edit.errors().modes).toBeDefined();
    expect(o.edit.tab()).toBe("osnap");
    expect(o.focused).toEqual(["modes"]);
    expect(o.edit.summary()).toContain("The engine refused the rest");
    // Changing it again answers the refusal.
    o.edit.edit({ modes: 0 }, "modes");
    expect(o.edit.errors().modes).toBeUndefined();
    o.dispose();
  });
});
