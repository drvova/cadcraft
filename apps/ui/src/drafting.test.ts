/**
 * The Drafting Settings mapping: the engine's values into the form and back (the OSMODE mask to
 * its boxes, POLARMODE's bit to its tick, the spacings and angles to text), the engine's own
 * rules applied to what is typed, the calls a changed form makes and only those, every refusal
 * under its field, and hostile values read from the engine (NaN, a negative spacing, bits nobody
 * knows, the wrong type) shown as defaults and never thrown on.
 */

import { describe, expect, test } from "bun:test";
import { snapGlyph } from "./canvas";
import {
  cleanOsmode,
  draftingTabFor,
  DRAFTING_VARS,
  formOf,
  judgeAngle,
  judgeAngleList,
  judgeSpacing,
  opensDraftingSettings,
  osmodeOf,
  OSNAP_ALL,
  OSNAP_MODES,
  OSNAP_OFF,
  planCalls,
  POLAR_ANGLES,
  POLAR_CUSTOM,
  readEngine,
  readState,
  runCalls,
  snapShapePath,
  tabOf,
  unapplied,
  type DraftingCall,
  type DraftingEngine,
  type DraftingState,
  type DraftingVar,
} from "./drafting";
import type { Envelope } from "./facade";

/** What a fresh engine holds (`Settings::default`, the header's 0.5 spacing): OSMODE 4133 is end, cen, int, ext. */
const SETTINGS = { grid: true, snap: false, polar: true, otrack: true, osmode: 4133 };
const VARS: Record<DraftingVar, unknown> = { SNAPUNIT: [0.5, 0.5], GRIDUNIT: [0.5, 0.5], POLARANG: 90, POLARADDANG: "", POLARMODE: 0 };

const fresh = (settings: Record<string, unknown> = {}, vars: Partial<Record<DraftingVar, unknown>> = {}): DraftingState => readState({ ...SETTINGS, ...settings }, { ...VARS, ...vars });

/** The calls a form makes against a state; fails the test when the form is refused instead. */
function calls(state: DraftingState, patch: Partial<ReturnType<typeof formOf>>): DraftingCall[] {
  const plan = planCalls(state, { ...formOf(state), ...patch });
  if (!plan.ok) throw new Error(`the form was refused: ${JSON.stringify(plan.errors)}`);
  return plan.calls;
}

/**
 * An engine that behaves as `settings.rs` and `sysvars.rs` do for the calls the dialog makes,
 * and keeps a log of them. `refuse` names commands (or `setvar:NAME`) it answers with an error.
 */
function engine(refuse: readonly string[] = [], dropGrid = false): DraftingEngine & { log: [string, unknown][]; vars: Record<string, unknown>; toggles: Record<string, boolean | number> } {
  const vars: Record<string, unknown> = { ...VARS };
  const toggles: Record<string, boolean | number> = { ...SETTINGS };
  const log: [string, unknown][] = [];
  const ok = (result: unknown): Envelope => ({ ok: true, result });
  return {
    log,
    vars,
    toggles,
    settings: () => toggles as unknown as ReturnType<DraftingEngine["settings"]>,
    execute(command: string, params: unknown = {}): Envelope {
      const p = params as Record<string, unknown>;
      if (command === "getvar") return typeof p["name"] === "string" && p["name"] in vars ? ok({ name: p["name"], value: vars[p["name"]] }) : { ok: false, error: `getvar: unknown variable \`${String(p["name"])}\`` };
      log.push([command, params]);
      const key = command === "setvar" ? `setvar:${String(p["name"])}` : command;
      if (refuse.includes(key)) return { ok: false, error: `${command}: refused` };
      if (command === "setvar") vars[String(p["name"])] = p["value"];
      else if (command === "dsettings") {
        if (p["snapunit"] !== undefined) vars["SNAPUNIT"] = p["snapunit"];
        if (p["gridunit"] !== undefined && !dropGrid) vars["GRIDUNIT"] = p["gridunit"];
      } else if (command === "osnap") toggles["osmode"] = p["osmode"] as number;
      else toggles[command] = p["on"] as boolean;
      return ok({});
    },
  };
}

describe("the object snap table", () => {
  test("is the engine's fourteen modes, each a single OSMODE bit, none of them the off switch", () => {
    expect(OSNAP_MODES.map((mode) => mode.bit)).toEqual([1, 2, 4, 1024, 8, 16, 32, 4096, 64, 128, 256, 512, 2048, 8192]);
    expect(OSNAP_ALL).toBe(16383);
    expect(OSNAP_ALL & OSNAP_OFF).toBe(0);
    expect(new Set(OSNAP_MODES.map((mode) => mode.label)).size).toBe(14);
  });

  test("every mode has the marker the drawing shows for it, not the unknown-snap cross", () => {
    const cross = snapGlyph(-1);
    for (const mode of OSNAP_MODES) expect(`${mode.label}: ${snapGlyph(mode.bit) === cross}`).toBe(`${mode.label}: false`);
  });

  test("a marker's strokes become SVG paths: an open path, a closed one, a circle as two arcs", () => {
    expect(snapShapePath({ kind: "path", points: [[-1, 0], [1, 0]], closed: false })).toBe("M -1 0 L 1 0");
    expect(snapShapePath({ kind: "path", points: [[0, -1], [1, 0.8], [-1, 0.8]], closed: true })).toBe("M 0 -1 L 1 0.8 L -1 0.8 Z");
    expect(snapShapePath({ kind: "circle", cx: 0, cy: 0.25, r: 0.75 })).toBe("M -0.75 0.25 A 0.75 0.75 0 1 0 0.75 0.25 A 0.75 0.75 0 1 0 -0.75 0.25 Z");
    for (const mode of OSNAP_MODES) for (const shape of snapGlyph(mode.bit)) expect(snapShapePath(shape)).toMatch(/^M [-\d.]+ [-\d.]+ /);
  });
});

describe("reading the engine", () => {
  test("a fresh engine's values become the form a drafter expects", () => {
    const state = fresh();
    expect(state.missing).toEqual([]);
    expect(state.unusable).toEqual([]);
    expect(formOf(state)).toEqual({
      snapOn: false,
      snapX: "0.5",
      snapY: "0.5",
      gridOn: true,
      gridX: "0.5",
      gridY: "0.5",
      polarOn: true,
      polarChoice: "90",
      polarCustom: "90",
      additionalOn: false,
      additionalAngles: "",
      osnapOn: true,
      otrackOn: true,
      modes: 4133,
    });
  });

  test("OSMODE's off bit is the switch, and the boxes keep their ticks while it is off", () => {
    const form = formOf(fresh({ osmode: 4133 | OSNAP_OFF }));
    expect(form.osnapOn).toBe(false);
    expect(form.modes).toBe(4133);
  });

  test("an increment angle off the usual list is the typed one", () => {
    expect(POLAR_ANGLES).toEqual(["90", "45", "30", "22.5", "18", "15", "10", "5"]);
    const listed = formOf(fresh({}, { POLARANG: 22.5 }));
    expect([listed.polarChoice, listed.polarCustom]).toEqual(["22.5", "22.5"]);
    const typed = formOf(fresh({}, { POLARANG: 12.5 }));
    expect([typed.polarChoice, typed.polarCustom]).toEqual([POLAR_CUSTOM, "12.5"]);
  });

  test("POLARMODE's additional bit is the tick, and POLARADDANG the list", () => {
    const form = formOf(fresh({}, { POLARMODE: 5, POLARADDANG: "15;75.5" }));
    expect(form.additionalOn).toBe(true);
    expect(form.additionalAngles).toBe("15; 75.5");
    expect(formOf(fresh({}, { POLARMODE: 11 })).additionalOn).toBe(false);
    expect(fresh({}, { POLARADDANG: 30 }).additional).toEqual([30]);
  });

  test("a spacing may come as a pair or as x and y", () => {
    expect(fresh({}, { SNAPUNIT: { x: 0.25, y: 0.125 } }).snap).toEqual({ x: 0.25, y: 0.125 });
    expect(fresh({}, { GRIDUNIT: [0, 2] }).grid).toEqual({ x: 0, y: 2 });
  });

  test("readEngine asks for each variable once and leaves out the ones the engine has no answer for", () => {
    const e = engine();
    delete e.vars["POLARADDANG"];
    const state = readEngine(e);
    expect(state.missing).toEqual(["POLARADDANG"]);
    expect(state.snap).toEqual({ x: 0.5, y: 0.5 });
    expect(state.osmode).toBe(4133);
    expect(e.log).toEqual([]);
  });

  test("a facade with no engine behind it (the mock) reads as every variable missing, and the toggles still read", () => {
    const state = readEngine({ settings: () => ({ ...SETTINGS }), execute: () => ({ ok: false, error: "unknown command" }) });
    expect(state.missing).toEqual([...DRAFTING_VARS]);
    expect(state.gridOn).toBe(true);
    const plan = planCalls(state, { ...formOf(state), snapX: "abc", polarCustom: "-1", polarChoice: POLAR_CUSTOM, additionalAngles: "x", gridOn: false });
    // What could not be read is neither judged nor written; what could be is.
    expect(plan).toEqual({ ok: true, calls: [{ field: "gridOn", command: "grid", params: { on: false } }] });
  });
});

describe("hostile values from the engine", () => {
  const hostile: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, "0.5", null, undefined, [], [1], [1, Number.NaN], [-1, 1], [0, 1], {}, { x: 1 }, { x: "1", y: 1 }, true, 1e400];

  test("an unusable snap spacing shows the default, is named unusable, and never throws", () => {
    for (const value of hostile) {
      const state = fresh({}, { SNAPUNIT: value });
      expect(state.snap).toBeNull();
      expect(state.unusable).toEqual(["SNAPUNIT"]);
      expect([formOf(state).snapX, formOf(state).snapY]).toEqual(["0.5", "0.5"]);
    }
  });

  test("a grid spacing may be zero and may not be negative or not a number", () => {
    expect(fresh({}, { GRIDUNIT: [0, 0] }).grid).toEqual({ x: 0, y: 0 });
    for (const value of [[-0.5, 1], [Number.NaN, 1], [1, Number.NEGATIVE_INFINITY], "1,1", null]) expect(fresh({}, { GRIDUNIT: value }).unusable).toEqual(["GRIDUNIT"]);
  });

  test("an unusable angle, angle list or polar mode shows the default", () => {
    for (const value of [Number.NaN, 0, -45, Number.POSITIVE_INFINITY, "45", null, [45]]) {
      const state = fresh({}, { POLARANG: value });
      expect(state.unusable).toEqual(["POLARANG"]);
      expect(formOf(state).polarChoice).toBe("90");
    }
    for (const value of ["15;abc", "1;2;3;4;5;6;7;8;9;10;11", Number.NaN, null, {}, [15]]) expect(fresh({}, { POLARADDANG: value }).unusable).toEqual(["POLARADDANG"]);
    for (const value of [Number.NaN, -1, 16, 2.5, "4", null]) {
      const state = fresh({}, { POLARMODE: value });
      expect(state.unusable).toEqual(["POLARMODE"]);
      expect(formOf(state).additionalOn).toBe(false);
    }
  });

  test("OK writes a usable value over an unusable one, though the form was not touched", () => {
    const state = fresh({}, { SNAPUNIT: [Number.NaN, -1], POLARANG: Number.NaN });
    expect(calls(state, {})).toEqual([
      { field: "snapX", command: "dsettings", params: { snapunit: [0.5, 0.5] } },
      { field: "polarAngle", command: "setvar", params: { name: "POLARANG", value: 90 } },
    ]);
  });

  test("OSMODE that is not a whole number from 0 up reads as nothing set, and the engine's fifteen bits are all that is kept", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, "7", null, undefined, {}, 2 ** 60]) expect(cleanOsmode(value)).toBe(0);
    expect(cleanOsmode(4133)).toBe(4133);
    expect(cleanOsmode(32768 + 65536 + 5)).toBe(5);
    expect(cleanOsmode(32767)).toBe(32767);
    const state = fresh({ osmode: Number.NaN });
    expect(state.osmode).toBe(0);
    expect(formOf(state).modes).toBe(0);
    expect(calls(state, {})).toEqual([]);
  });

  test("bits past the engine's fifteen are dropped on reading, so an untouched form writes nothing", () => {
    const state = fresh({ osmode: 4133 + 65536 });
    expect(state.osmode).toBe(4133);
    expect(calls(state, {})).toEqual([]);
  });

  test("a bit the form has no box for survives a round trip", () => {
    // Every one of the fifteen bits has a box or is the switch today; the rule is what is held.
    expect(osmodeOf({ modes: 1 | 2, osnapOn: true }, 4133)).toBe(3);
    expect(osmodeOf({ modes: 1 | 2, osnapOn: false }, 4133)).toBe(3 | OSNAP_OFF);
    expect(osmodeOf({ modes: Number.NaN, osnapOn: true }, 4133)).toBe(0);
    expect(osmodeOf({ modes: 65536 + 1, osnapOn: true }, 0)).toBe(1);
  });

  test("settings that are not an object, or toggles that are not booleans, read as off", () => {
    for (const settings of [null, undefined, "x", 7, [], { grid: 1, snap: "true", polar: null, otrack: {}, osmode: "4133" }]) {
      const state = readState(settings, VARS);
      expect([state.gridOn, state.snapOn, state.polarOn, state.otrackOn, state.osmode]).toEqual([false, false, false, false, 0]);
    }
    expect(readState({}, null as unknown as Record<DraftingVar, unknown>).missing).toEqual([...DRAFTING_VARS]);
  });
});

describe("judging what is typed", () => {
  test("a spacing is read as the properties palette reads a number, decimal comma included", () => {
    expect(judgeSpacing("0.25", false)).toEqual({ ok: true, value: 0.25 });
    expect(judgeSpacing(" 0,25 ", false)).toEqual({ ok: true, value: 0.25 });
    expect(judgeSpacing("1e-3", false)).toEqual({ ok: true, value: 0.001 });
    expect(judgeSpacing("２", false)).toEqual({ ok: true, value: 2 });
  });

  test("a snap spacing must be above zero; a grid spacing may be zero", () => {
    expect(judgeSpacing("0", false)).toEqual({ ok: false, error: "Snap spacing must be more than 0." });
    expect(judgeSpacing("-1", false)).toEqual({ ok: false, error: "Snap spacing must be more than 0." });
    expect(judgeSpacing("0", true)).toEqual({ ok: true, value: 0 });
    expect(judgeSpacing("-0.5", true)).toEqual({ ok: false, error: "Grid spacing cannot be negative." });
  });

  test("what is not one number is refused in words that say how to write it", () => {
    expect(judgeSpacing("", false)).toEqual({ ok: false, error: "Type a number." });
    expect(judgeSpacing("abc", false)).toEqual({ ok: false, error: "Type a number, such as 0.5." });
    expect(judgeSpacing("1,000.5", false)).toEqual({ ok: false, error: "Write the number with one decimal mark and no thousands separator." });
    expect(judgeSpacing("5mm", false)).toEqual({ ok: false, error: "Type the number alone, without a unit." });
    expect(judgeSpacing("1e999", false)).toEqual({ ok: false, error: "That number is too large." });
    for (const text of ["NaN", "Infinity", "0x10", "1 2", "=1+1", "<script>"]) expect(judgeSpacing(text, false).ok).toBe(false);
    expect(judgeSpacing(null as unknown as string, false).ok).toBe(false);
  });

  test("an increment angle is any angle above zero", () => {
    expect(judgeAngle("22,5")).toEqual({ ok: true, value: 22.5 });
    expect(judgeAngle("0")).toEqual({ ok: false, error: "The increment angle must be more than 0." });
    expect(judgeAngle("-90")).toEqual({ ok: false, error: "The increment angle must be more than 0." });
    expect(judgeAngle("north")).toEqual({ ok: false, error: "Type an angle in degrees, such as 22.5." });
    expect(judgeAngle("45°")).toEqual({ ok: false, error: "Type the number alone, without a unit." });
  });

  test("additional angles are separated by semicolons, so a comma stays a decimal mark", () => {
    expect(judgeAngleList("")).toEqual({ ok: true, value: [] });
    expect(judgeAngleList(" ; ;")).toEqual({ ok: true, value: [] });
    expect(judgeAngleList("15; 75")).toEqual({ ok: true, value: [15, 75] });
    expect(judgeAngleList("22,5;-30;0")).toEqual({ ok: true, value: [22.5, -30, 0] });
    expect(judgeAngleList("15, 75").ok).toBe(false);
    expect(judgeAngleList("15; east")).toEqual({ ok: false, error: '"east" is not an angle. Separate angles with semicolons: 15; 75' });
    expect(judgeAngleList("1;2;3;4;5;6;7;8;9;10").ok).toBe(true);
    expect(judgeAngleList("1;2;3;4;5;6;7;8;9;10;11")).toEqual({ ok: false, error: "Up to 10 angles: this is 11." });
    // A pasted paragraph is quoted short.
    const long = judgeAngleList("x".repeat(500));
    expect(long.ok === false && long.error.length < 100).toBe(true);
    expect(judgeAngleList(undefined as unknown as string)).toEqual({ ok: true, value: [] });
  });
});

describe("planning the calls", () => {
  test("a form nobody touched makes no call", () => {
    expect(calls(fresh(), {})).toEqual([]);
    expect(calls(fresh({ osmode: 4133 | OSNAP_OFF }, { POLARANG: 12.5, POLARADDANG: "15;75", POLARMODE: 7, SNAPUNIT: [1 / 3, 2 / 3] }), {})).toEqual([]);
  });

  test("the same number written another way is not a change", () => {
    expect(calls(fresh(), { snapX: "0,5", snapY: "+.5", gridX: "5e-1", polarChoice: POLAR_CUSTOM, polarCustom: "90.0" })).toEqual([]);
  });

  test("both spacings go in one dsettings call, with the part nobody moved in the engine's own digits", () => {
    const state = fresh({}, { SNAPUNIT: [1 / 3, 0.5] });
    expect(calls(state, { snapY: "0,25", gridX: "2" })).toEqual([{ field: "snapY", command: "dsettings", params: { snapunit: [1 / 3, 0.25], gridunit: [2, 0.5] } }]);
    expect(calls(fresh(), { gridY: "0" })).toEqual([{ field: "gridY", command: "dsettings", params: { gridunit: [0.5, 0] } }]);
  });

  test("the polar page: the angle from the list or typed, the angles joined by semicolons, the mode's one bit", () => {
    expect(calls(fresh(), { polarChoice: "45" })).toEqual([{ field: "polarAngle", command: "setvar", params: { name: "POLARANG", value: 45 } }]);
    expect(calls(fresh(), { polarChoice: POLAR_CUSTOM, polarCustom: "12,5" })).toEqual([{ field: "polarAngle", command: "setvar", params: { name: "POLARANG", value: 12.5 } }]);
    // The typed angle is not read while the list holds one.
    expect(calls(fresh(), { polarChoice: "90", polarCustom: "nonsense" })).toEqual([]);
    expect(calls(fresh(), { additionalAngles: "15; 75,5" })).toEqual([{ field: "additionalAngles", command: "setvar", params: { name: "POLARADDANG", value: "15;75.5" } }]);
    expect(calls(fresh({}, { POLARADDANG: "15;75" }), { additionalAngles: "" })).toEqual([{ field: "additionalAngles", command: "setvar", params: { name: "POLARADDANG", value: "" } }]);
    expect(calls(fresh({}, { POLARADDANG: "15;75" }), { additionalAngles: "75;15" }).length).toBe(1);
    expect(calls(fresh({}, { POLARMODE: 11 }), { additionalOn: true })).toEqual([{ field: "additionalOn", command: "setvar", params: { name: "POLARMODE", value: 15 } }]);
    expect(calls(fresh({}, { POLARMODE: 15 }), { additionalOn: false })).toEqual([{ field: "additionalOn", command: "setvar", params: { name: "POLARMODE", value: 11 } }]);
  });

  test("the switches run the status bar's own commands", () => {
    expect(calls(fresh(), { snapOn: true, gridOn: false, polarOn: false, otrackOn: false })).toEqual([
      { field: "snapOn", command: "snap", params: { on: true } },
      { field: "gridOn", command: "grid", params: { on: false } },
      { field: "polarOn", command: "polar", params: { on: false } },
      { field: "otrackOn", command: "otrack", params: { on: false } },
    ]);
  });

  test("the snap boxes and their switch are one osnap call, marked on what changed", () => {
    expect(calls(fresh(), { modes: OSNAP_ALL })).toEqual([{ field: "modes", command: "osnap", params: { osmode: 16383 } }]);
    expect(calls(fresh(), { modes: 0 })).toEqual([{ field: "modes", command: "osnap", params: { osmode: 0 } }]);
    expect(calls(fresh(), { osnapOn: false })).toEqual([{ field: "osnapOn", command: "osnap", params: { osmode: 4133 | OSNAP_OFF } }]);
    expect(calls(fresh({ osmode: 4133 | OSNAP_OFF }), { osnapOn: true, modes: 1 })).toEqual([{ field: "modes", command: "osnap", params: { osmode: 1 } }]);
  });

  test("the order is the drawing's spacings, the polar variables, the switches, the snaps", () => {
    const made = calls(fresh(), { snapX: "1", polarChoice: "45", additionalAngles: "15", additionalOn: true, snapOn: true, gridOn: false, modes: 1 });
    expect(made.map((call) => (call.command === "setvar" ? `setvar ${String(call.params["name"])}` : call.command))).toEqual(["dsettings", "setvar POLARANG", "setvar POLARADDANG", "setvar POLARMODE", "snap", "grid", "osnap"]);
  });

  test("one value the engine would refuse stops every call, and each refused field is named", () => {
    const state = fresh();
    const plan = planCalls(state, { ...formOf(state), snapX: "0", gridY: "-1", polarChoice: POLAR_CUSTOM, polarCustom: "", additionalAngles: "a;b", snapOn: true, modes: 1 });
    expect(plan).toEqual({
      ok: false,
      errors: {
        snapX: "Snap spacing must be more than 0.",
        gridY: "Grid spacing cannot be negative.",
        polarAngle: "Type a number.",
        additionalAngles: '"a" is not an angle. Separate angles with semicolons: 15; 75',
      },
    });
  });
});

describe("running the calls", () => {
  test("every call is run in order, and a clean run reports nothing", () => {
    const e = engine();
    const state = readEngine(e);
    const form = { ...formOf(state), snapX: "0,25", gridY: "2", polarChoice: "45", additionalOn: true, additionalAngles: "15;75", snapOn: true, modes: OSNAP_ALL, otrackOn: false };
    const plan = planCalls(state, form);
    if (!plan.ok) throw new Error("refused");
    expect(runCalls(e, plan.calls)).toEqual({});
    expect(e.log.map(([command]) => command)).toEqual(["dsettings", "setvar", "setvar", "setvar", "snap", "otrack", "osnap"]);
    const after = readEngine(e);
    expect(unapplied(after, form)).toEqual({});
    expect(formOf(after)).toEqual({ ...form, snapX: "0.25", polarCustom: "45", additionalAngles: "15; 75" });
  });

  test("a refusal is reported under its field with the engine's words, and the calls after it still run", () => {
    const e = engine(["setvar:POLARANG", "otrack"]);
    const state = readEngine(e);
    const form = { ...formOf(state), snapX: "1", polarChoice: "45", snapOn: true, otrackOn: false, modes: 1 };
    const plan = planCalls(state, form);
    if (!plan.ok) throw new Error("refused");
    expect(runCalls(e, plan.calls)).toEqual({ polarAngle: "setvar: refused", otrackOn: "otrack: refused" });
    expect(e.log.length).toBe(5);
    expect(e.vars["SNAPUNIT"]).toEqual([1, 0.5]);
    expect(e.toggles["snap"]).toBe(true);
    expect(e.toggles["osmode"]).toBe(1);
    // Read again, the form's own plan is what is left: the two refused changes and nothing else.
    expect(Object.keys(unapplied(readEngine(e), form)).sort()).toEqual(["otrackOn", "polarAngle"]);
  });

  test("a call the engine answered ok to and did not honour is found on reading again", () => {
    const e = engine([], true);
    const state = readEngine(e);
    const form = { ...formOf(state), snapX: "1", gridX: "3" };
    const plan = planCalls(state, form);
    if (!plan.ok) throw new Error("refused");
    expect(runCalls(e, plan.calls)).toEqual({});
    expect(unapplied(readEngine(e), form)).toEqual({ gridX: "The engine did not take this value." });
  });
});

describe("opening the dialog", () => {
  test("the command's name and its aliases open it, in any case, with the prefixes a command takes", () => {
    for (const text of ["dsettings", "DSETTINGS", " ds ", "SE", "'dsettings", "_dsettings", "._DS"]) expect(`${text}: ${opensDraftingSettings(text)}`).toBe(`${text}: true`);
    for (const text of ["", "d", "dsettings x", "osnap", "set", "settings", "se 1"]) expect(`${text}: ${opensDraftingSettings(text)}`).toBe(`${text}: false`);
    expect(opensDraftingSettings(null as unknown as string)).toBe(false);
  });

  test("a status toggle opens its own page, and a refused field brings its page forward", () => {
    expect(["grid", "snap", "ortho", "polar", "isodraft", "otrack", "osnap", "dynmode", "nonsense"].map(draftingTabFor)).toEqual(["snap-grid", "snap-grid", "snap-grid", "polar", "snap-grid", "osnap", "osnap", "snap-grid", "snap-grid"]);
    expect((["snapOn", "snapX", "snapY", "gridOn", "gridX", "gridY"] as const).map(tabOf)).toEqual(Array(6).fill("snap-grid"));
    expect((["polarOn", "polarAngle", "additionalOn", "additionalAngles"] as const).map(tabOf)).toEqual(Array(4).fill("polar"));
    expect((["osnapOn", "otrackOn", "modes"] as const).map(tabOf)).toEqual(Array(3).fill("osnap"));
  });
});
