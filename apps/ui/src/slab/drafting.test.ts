/**
 * The Drafting Settings dialog whose body Slab draws: the params it is handed
 * (`./drafting-params`), the editor both dialogs share (`../drafting-edit`), and the document
 * itself (`slab/drafting.slab`), read as text: the vendored compiler is not loaded under `bun test`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot } from "solid-js";
import { formOf, OSNAP_ALL, OSNAP_MODES, POLAR_ANGLES, POLAR_CUSTOM, readState, type DraftingEngine, type DraftingField, type DraftingState, type DraftingVar } from "../drafting";
import { createDraftingEdit, type DraftingEdit } from "../drafting-edit";
import type { Envelope } from "../facade";
import { ICON_PATHS } from "../icons";
import {
  ANGLE_OPTIONS,
  draftingLines,
  draftingParams,
  draftingSkips,
  draftingValues,
  DRAFTING_LISTS,
  DRAFTING_SCALARS,
  DRAFTING_SIGNALS,
  DRAFTING_TABS,
  GLYPH_BOX,
  isDraftingTab,
  lineOfField,
  modeBit,
  POLAR_CHOICE_LINE,
  snapBoxes,
  snapGlyphPath,
  tabAfter,
  tickField,
  typedField,
} from "./drafting-params";

const ui = join(import.meta.dir, "..", "..");
/** Spelled apart so the design-system check does not read the fixture as a colour in the interface. */
const H = "#";

const SETTINGS = { grid: true, snap: false, polar: true, otrack: true, osmode: 4133 };
const VARS: Record<DraftingVar, unknown> = { SNAPUNIT: [0.5, 0.5], GRIDUNIT: [0.5, 0.5], POLARANG: 90, POLARADDANG: "", POLARMODE: 0 };
const fresh = (vars: Partial<Record<DraftingVar, unknown>> = {}): DraftingState => readState(SETTINGS, { ...VARS, ...vars });
/** The engine with one variable it did not report. */
const without = (name: DraftingVar): DraftingState => {
  const vars: Partial<Record<DraftingVar, unknown>> = { ...VARS };
  delete vars[name];
  return readState(SETTINGS, vars);
};

const input = (state: DraftingState, over: Partial<Parameters<typeof draftingParams>[0]> = {}): Parameters<typeof draftingParams>[0] => ({ tab: "snap-grid", form: formOf(state), errors: {}, state, choiceOpen: false, summary: "", two: true, ...over });

/** Which kind each line is, by key. */
const kinds = (lines: ReturnType<typeof draftingLines>): string[] =>
  lines.map((line) => {
    const kind = (["tick", "typed", "wide", "choice", "read", "note"] as const).filter((name) => line[name]);
    return `${line.key}:${kind.join("+")}`;
  });

describe("the drafting body's params", () => {
  test("Snap and Grid: each switch over its two spacings, a group apart", () => {
    const p = draftingParams(input(fresh()));
    expect(kinds(p.lines)).toEqual(["snap-on:tick", "snap-x:typed", "snap-y:typed", "grid-on:tick", "grid-x:typed", "grid-y:typed"]);
    expect(p.lines.map((line) => line.lead)).toEqual([0, 8, 8, 16, 8, 8]);
    expect(p.lines.find((line) => line.key === "grid-on")?.ticked).toBe("true");
    expect(p.lines.find((line) => line.key === "snap-on")?.ticked).toBe("false");
    expect(p.lines.find((line) => line.key === "snap-x")?.shown).toBe("0.5");
    expect(p.osnap).toBe(false);
    expect(p.modes_a).toEqual([]);
    expect(p.page_name).toBe("Snap and Grid");
    expect(p.tabs.map((tab) => [tab.key, tab.on])).toEqual([
      ["snap-grid", true],
      ["polar", false],
      ["osnap", false],
    ]);
  });

  test("Polar Tracking: the increment angle is a choice; Custom adds the typed angle", () => {
    const state = fresh();
    const p = draftingParams(input(state, { tab: "polar" }));
    expect(kinds(p.lines)).toEqual(["polar-on:tick", "polar-choice:choice", "additional-on:tick", "additional-angles:wide"]);
    const choice = p.lines.find((line) => line.key === POLAR_CHOICE_LINE);
    expect(choice?.shown).toBe("90°");
    expect(choice?.said).toBe("Increment angle: 90°");
    const custom = draftingParams(input(state, { tab: "polar", form: { ...formOf(state), polarChoice: POLAR_CUSTOM }, choiceOpen: true }));
    expect(kinds(custom.lines)).toEqual(["polar-on:tick", "polar-choice:choice", "polar-custom:typed", "additional-on:tick", "additional-angles:wide"]);
    expect(custom.lines.find((line) => line.key === POLAR_CHOICE_LINE)?.open).toBe(true);
    expect(custom.lines.find((line) => line.key === "additional-angles")?.helped).toBe(true);
  });

  test("Object Snap: the two switches and a box per mode, across then down in two columns or all in one", () => {
    const p = draftingParams(input(fresh(), { tab: "osnap" }));
    expect(kinds(p.lines)).toEqual(["osnap-on:tick", "otrack-on:tick"]);
    expect(p.osnap).toBe(true);
    expect([...p.modes_a, ...p.modes_b].length).toBe(OSNAP_MODES.length);
    expect(p.modes_a.map((box) => box.name).slice(0, 2)).toEqual([OSNAP_MODES[0]?.label ?? "?", OSNAP_MODES[2]?.label ?? "?"]);
    expect(p.modes_b[0]?.name).toBe(OSNAP_MODES[1]?.label);
    // OSMODE 4133 is end, cen, int, ext.
    expect([...p.modes_a, ...p.modes_b].filter((box) => box.on).length).toBe(4);
    const one = snapBoxes(OSNAP_ALL, false);
    expect(one.a.length).toBe(OSNAP_MODES.length);
    expect(one.b).toEqual([]);
    expect(one.a.every((box) => box.ticked === "true")).toBe(true);
  });

  test("a variable the engine did not report is read, not edited, and says why", () => {
    const snap = draftingParams(input(without("SNAPUNIT")));
    expect(kinds(snap.lines)).toEqual(["snap-on:tick", "snap-x:read", "snap-y:read", "missing-snapunit:note", "grid-on:tick", "grid-x:typed", "grid-y:typed"]);
    expect(snap.lines.find((line) => line.key === "snap-x")?.said).toBe("Snap X spacing: 0.5");
    const polar = draftingParams(input(without("POLARANG"), { tab: "polar" }));
    expect(kinds(polar.lines)).toContain("polar-choice:read");
    const mode = draftingParams(input(without("POLARMODE"), { tab: "polar" }));
    expect(kinds(mode.lines)).toContain("additional-on:read");
  });

  test("a refusal marks its line in words; the modes' stands under the boxes", () => {
    const state = fresh();
    const p = draftingParams(input(state, { errors: { snapX: "Type a number, such as 0.5." }, summary: "Nothing was changed: 1 value needs correcting." }));
    const line = p.lines.find((l) => l.key === "snap-x");
    expect(line?.bad).toBe(true);
    expect(line?.hint).toBe("Type a number, such as 0.5.");
    expect(p.alerts).toEqual([{ key: "alert", note: "Nothing was changed: 1 value needs correcting." }]);
    const modes = draftingParams(input(state, { tab: "osnap", errors: { modes: "The engine refused the snap modes." } }));
    expect(modes.modes_bad).toBe(true);
    expect(modes.modes_hint).toBe("The engine refused the snap modes.");
    // The modes' refusal is not drawn on another page.
    expect(draftingParams(input(state, { errors: { modes: "x" } })).modes_bad).toBe(false);
  });

  test("a polar refusal stands on the choice, or on the typed angle under Custom", () => {
    const state = fresh();
    const errors = { polarAngle: "Type an angle." };
    const shown = draftingParams(input(state, { tab: "polar", errors }));
    expect(shown.lines.find((l) => l.key === POLAR_CHOICE_LINE)?.bad).toBe(true);
    const custom = draftingParams(input(state, { tab: "polar", errors, form: { ...formOf(state), polarChoice: POLAR_CUSTOM } }));
    expect(custom.lines.find((l) => l.key === POLAR_CHOICE_LINE)?.bad).toBe(false);
    expect(custom.lines.find((l) => l.key === "polar-custom")?.bad).toBe(true);
  });

  test("hostile typed text reaches the document as one capped line", () => {
    const state = fresh();
    const p = draftingParams(input(state, { form: { ...formOf(state), snapX: `1\n2${"9".repeat(5000)}` } }));
    const shown = p.lines.find((l) => l.key === "snap-x")?.shown ?? "";
    expect(shown).not.toContain("\n");
    expect(shown.length).toBeLessThan(1000);
  });

  test("the fields' buffers are held to the typed lines' values", () => {
    const state = fresh();
    const values = draftingValues(draftingParams(input(state, { tab: "polar", form: { ...formOf(state), polarChoice: POLAR_CUSTOM, polarCustom: "7.5", additionalAngles: "15; 75" } })));
    expect([...values.entries()]).toEqual([
      ["polar-custom", "7.5"],
      ["additional-angles", "15; 75"],
    ]);
  });
});

describe("a signal's item key and a form's field", () => {
  test("a line's key names its tick, its typed value or its snap mode; anything else names nothing", () => {
    expect(tickField("snap-on")).toBe("snapOn");
    expect(tickField("otrack-on")).toBe("otrackOn");
    expect(typedField("polar-custom")).toEqual({ form: "polarCustom", marks: "polarAngle" });
    expect(modeBit("mode-1024")).toBe(1024);
    for (const bad of ["", "constructor", "__proto__", "toString", "snap-x", "mode-3", "mode-99999", "mode-1e3", `mode-${"1".repeat(400)}`]) {
      expect(tickField(bad === "snap-x" ? "snap-x" : bad)).toBeNull();
      expect(modeBit(bad)).toBeNull();
    }
    for (const bad of ["", "constructor", "__proto__", "hasOwnProperty", "snap-on"]) expect(typedField(bad)).toBeNull();
  });

  test("a refusal's field is the line the keyboard is sent to", () => {
    const form = formOf(fresh());
    const fields: DraftingField[] = ["snapOn", "snapX", "snapY", "gridOn", "gridX", "gridY", "polarOn", "additionalOn", "additionalAngles", "osnapOn", "otrackOn"];
    for (const field of fields) {
      const line = lineOfField(field, form);
      expect(line).not.toBeNull();
      const named: string | undefined = tickField(line ?? "") ?? typedField(line ?? "")?.marks;
      expect(named).toBe(field);
    }
    expect(lineOfField("polarAngle", form)).toBe(POLAR_CHOICE_LINE);
    expect(lineOfField("polarAngle", { ...form, polarChoice: POLAR_CUSTOM })).toBe("polar-custom");
    expect(lineOfField("modes", form)).toBeNull();
  });

  test("the strip's keys: the arrows wrap, Home and End go to the ends", () => {
    expect(tabAfter("snap-grid", "tab_next")).toBe("polar");
    expect(tabAfter("osnap", "tab_next")).toBe("snap-grid");
    expect(tabAfter("snap-grid", "tab_prev")).toBe("osnap");
    expect(tabAfter("polar", "tab_first")).toBe("snap-grid");
    expect(tabAfter("polar", "tab_last")).toBe("osnap");
    expect(tabAfter("polar", "anything")).toBe("polar");
    expect(DRAFTING_TABS.every((tab) => isDraftingTab(tab.id))).toBe(true);
    for (const bad of ["", "Polar", "constructor", "osnap "]) expect(isDraftingTab(bad)).toBe(false);
  });

  test("the strip is one Tab stop and the parts that hold a mapped key are none", () => {
    const tab = (item: string): string => `#body/#tabs/each@0~${item}/row@0/#tab`;
    expect(draftingSkips(tab("polar"), "polar", "polar")).toBe(false);
    expect(draftingSkips(tab("osnap"), "osnap", "polar")).toBe(true);
    expect(draftingSkips("#body/#tabs", null, "polar")).toBe(true);
    expect(draftingSkips("#body/#page/#lines", null, "polar")).toBe(true);
    expect(draftingSkips("#body/#page/#modes", null, "osnap")).toBe(true);
    expect(draftingSkips("#body/#page/#lines/each@0~snap-on/col@0/col@0/row@0/#tick", "snap-on", "snap-grid")).toBe(false);
    expect(draftingSkips("#body/#page/#modes-head/#all", null, "osnap")).toBe(false);
  });
});

describe("the snap markers", () => {
  test("every mode's marker is path data inside its box, from the canvas's own strokes", () => {
    for (const mode of OSNAP_MODES) {
      const path = snapGlyphPath(mode.bit);
      expect(path).toMatch(/^M /);
      const numbers = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
      expect(numbers.length).toBeGreaterThan(0);
      for (const n of numbers) {
        expect(Number.isFinite(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(GLYPH_BOX);
      }
    }
    expect(new Set(OSNAP_MODES.map((mode) => snapGlyphPath(mode.bit))).size).toBe(OSNAP_MODES.length);
  });

  test("the increment angle's values are the SolidJS select's", () => {
    expect(ANGLE_OPTIONS.map((option) => option.label)).toEqual([...POLAR_ANGLES.map((angle) => `${angle}°`), "Custom"]);
    expect(ANGLE_OPTIONS.map((option) => option.value)).toEqual([...POLAR_ANGLES, POLAR_CUSTOM]);
  });
});

// ---------------------------------------------------------------------------------------------
// The editor both dialogs run on
// ---------------------------------------------------------------------------------------------

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
 * The editor over a dialog's props, as either view makes it. Under `bun test` Solid's core is its
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

describe("the drafting editor, as both dialogs run it", () => {
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

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

describe("the document", () => {
  const source = readFileSync(join(ui, "slab", "drafting.slab"), "utf8");
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  test("declares every param the host sets, and no other", () => {
    const declared = [...code.slice(code.indexOf("params {"), code.indexOf("col #body")).matchAll(/^\s+([a-z_]+)\s+(text|bool|num|list\()/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...DRAFTING_SCALARS, ...DRAFTING_LISTS].sort());
  });

  test("fires the signals the host answers, and no other", () => {
    const fired = new Set([...code.matchAll(/\b(?:act|field|submit)=([a-z_]+)/g)].map((m) => m[1]));
    for (const m of code.matchAll(/\bkeys=([A-Za-z:_,]+)/g)) for (const pair of (m[1] ?? "").split(",")) fired.add(pair.split(":")[1]);
    expect([...fired].sort()).toEqual([...DRAFTING_SIGNALS].sort());
  });

  test("each item carries the fields the params give it", () => {
    const p = draftingParams(input(fresh(), { tab: "osnap", summary: "x" }));
    const props = (name: string): string[] =>
      (new RegExp(`def ${name}\\(([^)]*)\\)`).exec(code.replace(/\\\n\s*/g, " "))?.[1] ?? "")
        .split(",")
        .map((part) => part.trim().split("=")[0] ?? "")
        .filter((part) => part !== "");
    const fields = (row: object | undefined): string[] => Object.keys(row ?? {}).filter((name) => name !== "key").sort();
    expect(fields(p.lines[0])).toEqual(props("SetLine").sort());
    expect(fields(p.tabs[0])).toEqual(props("PageTab").sort());
    expect(fields(p.modes_a[0])).toEqual(props("SnapBox").sort());
    expect(fields(p.alerts[0])).toEqual(props("FormAlert").sort());
  });

  test("has no hole: the increment angle's values open as the host's popup", () => {
    expect(code).not.toMatch(/\bhole\b/);
    expect(code).toMatch(/role=combobox/);
  });

  test("takes its colours from the token sheet, names no font, and draws only the interface's glyphs", () => {
    expect(code).not.toMatch(new RegExp(`${H}[0-9a-fA-F]{3,8}\\b`));
    expect(code).toContain('import "gen/tokens.slab"');
    expect(code).not.toMatch(/\bfamily\b|\.(ttf|otf|woff2?|shx|png|svg)\b/i);
    for (const m of code.matchAll(/\bstyle=([a-z.-]+)/g)) expect(m[1]).toMatch(/^text\.(body|label|chip)$/);
    // The chevron is `icons.ts`'s; the tick is the one the Properties section's boxes draw.
    const icons = Object.fromEntries([...code.matchAll(/^icon ([a-z-]+) viewbox=24 \{\n\s+path "([^"]+)"/gm)].map((m) => [m[1], m[2]]));
    expect(icons).toEqual({ mark: "M5 12.5l4.5 4.5 9.5-10", chevron: ICON_PATHS["chevron-down"] });
    expect(readFileSync(join(ui, "slab", "properties.slab"), "utf8")).toContain(`path "${icons["mark"] ?? "?"}"`);
  });

  test("every control says what it is: tabs, ticks, fields, the choice, the buttons", () => {
    expect(code).toMatch(/role=tablist label="Drafting settings"/);
    expect(code).toMatch(/role=tab label=name selected=on/);
    expect(code).toMatch(/role=tabpanel label=param\.page_name/);
    expect([...code.matchAll(/role=checkbox label=name/g)].length).toBe(2);
    for (const line of code.split("\n").filter((l) => /\bfield=/.test(l))) expect(line).toMatch(/\blabel=name\b.*\bdesc=(hint|help)\b/);
    expect(code).toMatch(/role=combobox label=said desc=hint expanded=open/);
    expect([...code.matchAll(/role=button label="([^"]+)"/g)].map((m) => m[1])).toEqual(["Select all", "Clear all"]);
    expect(code).toMatch(/role=alert/);
  });
});
