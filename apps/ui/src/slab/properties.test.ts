/**
 * The Properties section ported to Slab: the params the document takes (`./properties-params`), a
 * signal's item key read back to a row (stale and forged keys do nothing), a choice's values for
 * the popup, the solved scene's parts and hints, the row editing both panels share
 * (`../props-edit`), and the document held against the names the host uses.
 *
 * The surface itself (the kernel's field, the popup over the page, the keyboard) needs the built
 * artifacts and a browser, and is checked there.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLOR_CHOICES, LINEWEIGHT_CHOICES, parseProperties, VARIES, type PropRow, type PropertiesReply } from "../props";
import { createPropEdit, propertiesSubject, propertiesTitle, rowMode, type PropEditHost } from "../props-edit";
import { UNCAPPED } from "./piece-params";
import {
  bodyNatural,
  choicePopup,
  lineParam,
  linePart,
  listedRows,
  MAX_PROP_OPTIONS,
  MAX_PROP_ROWS,
  partHint,
  PROPERTIES_LISTS,
  PROPERTIES_SCALARS,
  PROPERTIES_SIGNALS,
  propertiesPanelParams,
  signalLine,
  type PropertiesView,
} from "./properties-params";
import { mapTokens } from "./tokens";

const ui = join(import.meta.dir, "..", "..");

/** Spelled apart so the design-system check does not read the fixture as a colour in the interface. */
const H = "#";

const LAYERS = ["0", "Metal", "Stones"];

const line = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "Line",
  handle: "14D",
  layer: "Metal",
  color: "ByLayer",
  linetype: "CENTER",
  lineweight: "ByLayer",
  ltscale: 1,
  transparency: "ByLayer",
  thickness: 0,
  visible: true,
  length: 26,
  angle: 90,
  ...over,
});

function objects(...list: Record<string, unknown>[]): PropertiesReply {
  const reply = parseProperties({ count: list.length, objects: list }, LAYERS);
  if (reply === null) throw new Error("the reply did not parse");
  return reply;
}

const DEFAULTS = parseProperties({ selection: "No selection", color: "ByLayer", layer: "Metal", linetype: "ByLayer", linetypeScale: 1, lineweight: "ByLayer", textStyle: "Standard", dimStyle: "ISO-25", textHeight: 2.5 }, LAYERS);

const VIEW: PropertiesView = { open: true, selectionCount: 1, openChoice: null, faults: new Map(), bodyMax: 300, hidden: { above: false, below: false } };
const view = (over: Partial<PropertiesView> = {}): PropertiesView => ({ ...VIEW, ...over });

function rowOf(reply: PropertiesReply, key: string): PropRow {
  const found = reply.rows.find((row) => row.key === key);
  if (found === undefined) throw new Error(`no row ${key}`);
  return found;
}

describe("lineParam", () => {
  const one = objects(line());

  test("a choice is a choice, said with its value", () => {
    expect(lineParam(rowOf(one, "layer"), VIEW)).toEqual({ key: "layer", name: "Layer", shown: "Metal", said: "Layer: Metal", told: "", hint: "", ticked: "false", read: false, choice: true, tick: false, typed: false, open: false, on: false, varies: false, quiet: false, bad: false });
  });

  test("an open choice says so; another row's does not", () => {
    expect(lineParam(rowOf(one, "layer"), view({ openChoice: "layer" })).open).toBe(true);
    expect(lineParam(rowOf(one, "color"), view({ openChoice: "layer" })).open).toBe(false);
    // Only a choice opens: a key that names a typed row opens nothing.
    expect(lineParam(rowOf(one, "ltscale"), view({ openChoice: "ltscale" })).open).toBe(false);
  });

  test("a number and a text are typed", () => {
    const scale = lineParam(rowOf(one, "ltscale"), VIEW);
    expect([scale.typed, scale.choice, scale.tick, scale.read, scale.shown]).toEqual([true, false, false, false, "1"]);
    expect(lineParam(rowOf(one, "linetype"), VIEW).typed).toBe(true);
  });

  test("a tick says its state in the kernel's words, and shows no text", () => {
    const on = lineParam(rowOf(one, "visible"), VIEW);
    expect([on.tick, on.on, on.varies, on.ticked, on.shown, on.said]).toEqual([true, true, false, "true", "", "Visible"]);
    const off = lineParam(rowOf(objects(line({ visible: false })), "visible"), VIEW);
    expect([off.on, off.varies, off.ticked]).toEqual([false, false, "false"]);
  });

  test("a row that is only read is told whole, and is no control", () => {
    const type = lineParam(rowOf(one, "type"), VIEW);
    expect([type.read, type.typed, type.choice, type.tick, type.told]).toEqual([true, false, false, false, "Type: Line"]);
    // The drawing's defaults are read, whatever their kind.
    if (DEFAULTS === null) throw new Error("the defaults did not parse");
    for (const row of DEFAULTS.rows) expect(lineParam(row, VIEW).read).toBe(true);
  });

  test("objects that disagree: a quiet value, and a tick that is neither", () => {
    const mixed = objects(line(), line({ handle: "14E", layer: "Stones", linetype: "DASHED", visible: false }));
    const layer = lineParam(rowOf(mixed, "layer"), VIEW);
    expect([layer.shown, layer.quiet, layer.said]).toEqual([VARIES, true, `Layer: ${VARIES}`]);
    expect(lineParam(rowOf(mixed, "linetype"), VIEW).quiet).toBe(true);
    expect(lineParam(rowOf(mixed, "color"), VIEW).quiet).toBe(false);
    const visible = lineParam(rowOf(mixed, "visible"), VIEW);
    expect([visible.on, visible.varies, visible.ticked, visible.quiet]).toEqual([false, true, "mixed", false]);
  });

  test("a refusal marks its row and is its description", () => {
    const refused = lineParam(rowOf(one, "ltscale"), view({ faults: new Map([["ltscale", "Linetype scale needs a number above 0"]]) }));
    expect([refused.bad, refused.hint]).toEqual([true, "Linetype scale needs a number above 0"]);
    expect(lineParam(rowOf(one, "thickness"), view({ faults: new Map([["ltscale", "no"]]) })).bad).toBe(false);
  });

  test("text for the kernel is one line, without control characters", () => {
    const hostile = objects(line({ layer: "Me\u0000tal\nTwo Three", type: "Li\tne" }));
    expect(lineParam(rowOf(hostile, "layer"), VIEW).shown).toBe("Me tal Two Three");
    expect(lineParam(rowOf(hostile, "type"), VIEW).shown).toBe("Li ne");
    const long = lineParam(rowOf(objects(line({ linetype: "x".repeat(5000) })), "linetype"), VIEW);
    expect(long.shown.length).toBeLessThanOrEqual(240);
  });
});

describe("propertiesPanelParams", () => {
  test("the heading is the SolidJS panel's", () => {
    expect(propertiesPanelParams(null, view({ selectionCount: 0 })).summary).toBe("No selection");
    expect(propertiesPanelParams(null, view({ selectionCount: 1284 })).summary).toBe("1,284 selected");
    expect(propertiesPanelParams(DEFAULTS, VIEW).summary).toBe("No selection");
    expect(propertiesPanelParams(objects(line(), line({ handle: "2" })), VIEW).summary).toBe("2 selected");
  });

  test("one object: its common rows, then what is read of it", () => {
    const params = propertiesPanelParams(objects(line()), VIEW);
    expect(params.rows.map((row) => row.key)).toEqual(["layer", "color", "linetype", "lineweight", "ltscale", "transparency", "thickness", "visible", "type", "handle", "length", "angle"]);
    expect([params.open, params.listed, params.empty]).toEqual([true, true, false]);
  });

  test("folded, it is its heading alone", () => {
    const params = propertiesPanelParams(objects(line()), view({ open: false, hidden: { above: true, below: true } }));
    expect(params).toEqual({ summary: "1 selected", open: false, listed: false, empty: false, above: false, below: false, between: false, body_max: 300, rows: [] });
  });

  test("no reply, or one with no rows, says so in one line", () => {
    expect(propertiesPanelParams(null, VIEW).empty).toBe(true);
    const none = propertiesPanelParams(objects(), VIEW);
    expect([none.listed, none.empty, none.rows.length]).toEqual([false, true, 0]);
  });

  test("the hidden ends are one of three at most", () => {
    const ends = (above: boolean, below: boolean): boolean[] => {
      const p = propertiesPanelParams(objects(line()), view({ hidden: { above, below } }));
      return [p.above, p.below, p.between];
    };
    expect(ends(false, false)).toEqual([false, false, false]);
    expect(ends(true, false)).toEqual([true, false, false]);
    expect(ends(false, true)).toEqual([false, true, false]);
    expect(ends(true, true)).toEqual([false, false, true]);
  });

  test("a cap that is not a height is no cap", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) expect(propertiesPanelParams(null, view({ bodyMax: bad })).body_max).toBe(UNCAPPED);
    expect(propertiesPanelParams(null, view({ bodyMax: 1e12 })).body_max).toBe(UNCAPPED);
    expect(propertiesPanelParams(null, view({ bodyMax: 180.7 })).body_max).toBe(180);
  });
});

describe("the rows listed, and a signal's key", () => {
  const hostile: PropertiesReply = {
    kind: "defaults",
    rows: [
      { key: "layer", label: "Layer", value: "0", editable: true, kind: "choice", choices: LAYERS },
      { key: "a/b", label: "Slash", value: "", editable: true, kind: "text" },
      { key: "", label: "Empty", value: "", editable: true, kind: "text" },
      { key: "x".repeat(40), label: "Long", value: "", editable: true, kind: "text" },
      { key: "o-1", label: "Dash", value: "", editable: true, kind: "text" },
    ],
  };

  test("a key that cannot name an item is not listed", () => {
    expect(listedRows(hostile).map((row) => row.key)).toEqual(["layer"]);
    expect(listedRows(null)).toEqual([]);
  });

  test("the rows are capped", () => {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const many: PropertiesReply = { kind: "defaults", rows: Array.from({ length: 300 }, (_, i) => ({ key: `k${letters.charAt(i % 26)}${letters.charAt(Math.floor(i / 26))}`, label: "L", value: "", editable: false, kind: "text" as const })) };
    expect(listedRows(many).length).toBe(MAX_PROP_ROWS);
    expect(propertiesPanelParams(many, VIEW).rows.length).toBe(MAX_PROP_ROWS);
  });

  test("a signal names a listed row, or nothing", () => {
    const one = objects(line());
    expect(signalLine(one, "layer")?.key).toBe("layer");
    for (const forged of ["", "nope", "layer/x", "../layer", "o-0", "x".repeat(200), "constructor", "__proto__"]) expect(signalLine(one, forged)).toBeNull();
    expect(signalLine(null, "layer")).toBeNull();
    expect(signalLine(hostile, "a/b")).toBeNull();
  });
});

describe("choicePopup", () => {
  const one = objects(line());

  test("each value is its own label, and the list opens on the one held", () => {
    const { options, held } = choicePopup(rowOf(one, "layer"), "Metal");
    expect(options).toEqual(LAYERS.map((value) => ({ value, label: value })));
    expect(held).toBe("Metal");
    expect(choicePopup(rowOf(one, "color"), "ByLayer").options.length).toBe(COLOR_CHOICES.length);
    expect(choicePopup(rowOf(one, "lineweight"), "ByLayer").options.length).toBe(LINEWEIGHT_CHOICES.length + 1);
  });

  test("a value the list lacks is kept as one more at the top, as the Select keeps it", () => {
    const { options, held } = choicePopup(rowOf(one, "layer"), "Deleted");
    expect(options.map((o) => o.value)).toEqual(["Deleted", ...LAYERS]);
    expect(held).toBe("Deleted");
  });

  test("objects that disagree: no value is held, and the words for it are not a choice", () => {
    const { options, held } = choicePopup(rowOf(one, "layer"), VARIES);
    expect(held).toBeNull();
    expect(options.map((o) => o.value)).toEqual(LAYERS);
  });

  test("the values are capped, and a row with none has none", () => {
    const many: PropRow = { key: "layer", label: "Layer", value: "L0", editable: true, kind: "choice", choices: Array.from({ length: 5000 }, (_, i) => `L${i}`) };
    expect(choicePopup(many, "L0").options.length).toBe(MAX_PROP_OPTIONS);
    expect(choicePopup({ key: "layer", label: "Layer", value: VARIES, editable: true, kind: "choice" }, VARIES).options).toEqual([]);
  });
});

describe("the solved scene", () => {
  const ROW = "PropertiesPanel@0/col@0/#body/#rows/each@0~";
  const box = (key: string, x: number, y: number, w: number, h: number): { key: string; x: number; y: number; w: number; h: number } => ({ key, x, y, w, h });

  test("a key names a row's part, or nothing", () => {
    expect(linePart(`${ROW}layer/row@0/row@3/#choice`)).toEqual({ row: "layer", part: "choice" });
    expect(linePart(`${ROW}ltscale/row@0/row@2/#field`)).toEqual({ row: "ltscale", part: "field" });
    expect(linePart(`${ROW}visible/row@0/row@4/#tick`)).toEqual({ row: "visible", part: "tick" });
    expect(linePart(`${ROW}layer/row@0/row@0/#name`)).toEqual({ row: "layer", part: "name" });
    expect(linePart("PropertiesPanel@0/col@0/#head/#fold")).toBeNull();
    expect(linePart(`${ROW}layer/row@0`)).toBeNull();
    expect(linePart(`${ROW}a-b/row@0/row@0/#name`)).toBeNull();
    expect(linePart("")).toBeNull();
  });

  test("text an ellipsis cuts is hinted whole; text that fits has no hint", () => {
    const params = propertiesPanelParams(objects(line({ layer: "A very long layer name indeed" })), VIEW);
    const width = (text: string): number => text.length * 7;
    expect(partHint(params, box(`${ROW}layer/row@0/row@0/#name`, 24, 30, 100, 22), width)).toBeNull();
    expect(partHint(params, box(`${ROW}layer/row@0/row@0/#name`, 24, 30, 20, 22), width)).toBe("Layer");
    expect(partHint(params, box(`${ROW}layer/row@0/row@3/#choice`, 130, 31, 108, 20), width)).toBe("A very long layer name indeed");
    expect(partHint(params, box(`${ROW}color/row@0/row@3/#choice`, 130, 53, 108, 20), width)).toBeNull();
    expect(partHint(params, box("PropertiesPanel@0/col@0/#head/row@0/#state", 180, 0, 20, 24), width)).toBe("1 selected");
    expect(partHint(params, box("PropertiesPanel@0/col@0/#head/row@0/#state", 180, 0, 90, 24), width)).toBeNull();
  });

  test("where the page cannot measure, nothing is known to be cut", () => {
    const params = propertiesPanelParams(objects(line()), VIEW);
    expect(partHint(params, box(`${ROW}layer/row@0/row@0/#name`, 24, 30, 1, 22), null)).toBeNull();
  });

  test("a refused field says why; a part of no row says nothing", () => {
    const params = propertiesPanelParams(objects(line()), view({ faults: new Map([["ltscale", "Linetype scale needs a number above 0"]]) }));
    expect(partHint(params, box(`${ROW}ltscale/row@0/row@2/#field`, 130, 100, 100, 20), null)).toBe("Linetype scale needs a number above 0");
    expect(partHint(params, box(`${ROW}thickness/row@0/row@2/#field`, 130, 100, 100, 20), null)).toBeNull();
    expect(partHint(params, box(`${ROW}nope/row@0/row@2/#field`, 130, 100, 100, 20), null)).toBeNull();
    expect(partHint(params, box("PropertiesPanel@0/col@0/#head/#fold", 2, 2, 20, 20), null)).toBeNull();
  });

  test("the body's natural height is its content's extent and its insets, wherever it is scrolled", () => {
    const body = "PropertiesPanel@0/col@0/#body";
    const scene = [box("PropertiesPanel@0/col@0", 0, 0, 248, 200), box(body, 0, 24, 248, 176), box(`${body}/#rows`, 0, -40, 248, 264), box(`${body}/#rows/each@0`, 0, -40, 248, 264)];
    expect(bodyNatural(scene, true)).toBe(268);
    expect(bodyNatural(scene, false)).toBe(0);
    expect(bodyNatural([], true)).toBeNull();
    expect(bodyNatural([box(body, 0, 24, 248, 0)], true)).toBeNull();
    expect(bodyNatural([box(body, 0, 24, 248, 100), box(`${body}/#rows`, 0, Number.NaN, 248, Number.NaN)], true)).toBeNull();
  });
});

describe("the row editing both panels share", () => {
  interface Held {
    row: PropRow;
    draft: string;
    dirty: boolean;
    fault: string | null;
    sent: Record<string, unknown>[];
    said: string[];
  }

  function editing(row: PropRow): { held: Held; edit: ReturnType<typeof createPropEdit> } {
    const held: Held = { row, draft: row.value, dirty: false, fault: null, sent: [], said: [] };
    const host: PropEditHost = {
      row: () => held.row,
      draft: () => held.draft,
      setDraft: (value) => {
        held.draft = value;
      },
      dirty: () => held.dirty,
      setDirty: (value) => {
        held.dirty = value;
      },
      fault: () => held.fault,
      setFault: (message) => {
        held.fault = message;
      },
      send: (patch) => held.sent.push(patch),
      notice: (message) => held.said.push(message),
    };
    return { held, edit: createPropEdit(host) };
  }

  const one = objects(line());

  test("a pick is shown and sent, unless it is the value already there", () => {
    const { held, edit } = editing(rowOf(one, "layer"));
    edit.pick("Stones");
    expect([held.draft, held.sent]).toEqual(["Stones", [{ layer: "Stones" }]]);
    edit.pick("Metal");
    expect(held.sent.length).toBe(1);
  });

  test("a tick is sent as a boolean; a box that is neither is ticked", () => {
    const { held, edit } = editing(rowOf(one, "visible"));
    edit.pick("false");
    expect(held.sent).toEqual([{ visible: false }]);
    const mixed = editing(rowOf(objects(line(), line({ handle: "2", visible: false })), "visible"));
    mixed.edit.pick("true");
    expect(mixed.held.sent).toEqual([{ visible: true }]);
  });

  test("the first pick over objects that disagree replaces them all", () => {
    const { held, edit } = editing(rowOf(objects(line(), line({ handle: "2", layer: "Stones" })), "layer"));
    edit.pick("0");
    expect(held.sent).toEqual([{ layer: "0" }]);
  });

  test("typed text is sent on commit, as a number", () => {
    const { held, edit } = editing(rowOf(one, "ltscale"));
    edit.typed("2,5");
    expect(held.dirty).toBe(true);
    edit.commitText(false);
    expect([held.sent, held.dirty, held.fault]).toEqual([[{ ltscale: 2.5 }], false, null]);
  });

  test("nothing typed, nothing sent; the same number written another way keeps the engine's", () => {
    const { held, edit } = editing(rowOf(one, "ltscale"));
    edit.commitText(true);
    expect(held.sent).toEqual([]);
    edit.typed("1.0");
    edit.commitText(false);
    expect([held.sent, held.draft, held.dirty]).toEqual([[], "1", false]);
  });

  test("a refusal is said once, stays marked in the field, and is cleared by the next keystroke", () => {
    const { held, edit } = editing(rowOf(one, "ltscale"));
    edit.typed("abc");
    edit.commitText(false);
    expect([held.said, held.fault, held.draft, held.dirty]).toEqual([["Linetype scale needs a number above 0"], "Linetype scale needs a number above 0", "abc", true]);
    // Enter again on the same text does not say it twice.
    edit.commitText(false);
    expect(held.said.length).toBe(1);
    edit.typed("abcd");
    expect(held.fault).toBeNull();
    expect(held.sent).toEqual([]);
  });

  test("on the way out a refused value gives way to the engine's, without a second warning", () => {
    const { held, edit } = editing(rowOf(one, "ltscale"));
    edit.typed("-3");
    edit.commitText(false);
    edit.commitText(true);
    expect([held.said.length, held.draft, held.dirty, held.fault, held.sent]).toEqual([1, "1", false, null, []]);
    // Refused only on the way out: said once, and the value is back.
    edit.typed("0");
    edit.commitText(true);
    expect([held.said.length, held.draft]).toEqual([2, "1"]);
  });

  test("Escape cancels an edit or a refusal, and is the shell's when there is neither", () => {
    const { held, edit } = editing(rowOf(one, "thickness"));
    expect(edit.cancel()).toBe(false);
    edit.typed("7");
    expect(edit.cancel()).toBe(true);
    expect([held.draft, held.dirty, held.sent]).toEqual(["0", false, []]);
    expect(edit.cancel()).toBe(false);
  });

  test("a row that left sends nothing on the blur its field fires", () => {
    const { held, edit } = editing(rowOf(one, "ltscale"));
    edit.typed("4");
    edit.gone();
    edit.commitText(true);
    expect(held.sent).toEqual([]);
  });

  test("hostile text never throws and never reaches the engine as a number", () => {
    const { held, edit } = editing(rowOf(one, "thickness"));
    for (const text of ["NaN", "Infinity", "1e999", "0x10", "1,234,567", "\u0000", "💎".repeat(1000), "1e13"]) {
      edit.typed(text);
      edit.commitText(false);
    }
    expect(held.sent).toEqual([]);
  });

  test("the heading, the subject and the control a row gets", () => {
    expect(propertiesTitle(null, 0)).toBe("No selection");
    expect(propertiesTitle(one, 99)).toBe("1 selected");
    expect(propertiesSubject(null)).toBe("");
    expect(propertiesSubject(DEFAULTS)).toBe("defaults");
    expect(propertiesSubject(objects(line(), line({ handle: "2" })))).toBe("14D,2");
    expect(rowMode(rowOf(one, "layer"))).toBe("choice");
    expect(rowMode(rowOf(one, "type"))).toBe("readonly");
  });
});

describe("the document", () => {
  const source = readFileSync(join(ui, "slab", "properties.slab"), "utf8");
  const code = source
    .split("\n")
    .filter((text) => !text.trim().startsWith("//"))
    .join("\n");

  test("declares every param the host sets, and no other", () => {
    const head = /def PropertiesPanel\(([\s\S]*?)\) export/.exec(code)?.[1] ?? "";
    const declared = [...head.matchAll(/([a-z_]+)=/g)].map((m) => m[1] ?? "");
    expect([...declared].sort()).toEqual([...PROPERTIES_SCALARS, ...PROPERTIES_LISTS].sort());
  });

  test("fires the signals the host answers, and no other", () => {
    const fired = new Set([...code.matchAll(/\b(?:act|field|submit)=([a-z_]+)/g)].map((m) => m[1] ?? ""));
    expect([...fired].sort()).toEqual([...PROPERTIES_SIGNALS].sort());
  });

  test("the list items carry the fields the params give them", () => {
    const fields = [...(/def PropLine\(([\s\S]*?)\) export/.exec(code)?.[1] ?? "").matchAll(/([a-z_]+)=/g)].map((m) => m[1] ?? "").sort();
    const params = propertiesPanelParams(objects(line()), VIEW);
    expect(fields).toEqual(Object.keys(params.rows[0] ?? {}).filter((k) => k !== "key").sort());
  });

  test("takes its colours from the token sheet; the only literals are the fade mask's two alphas", () => {
    const t = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8"));
    const used = new Set([...code.matchAll(/color\.([a-z0-9-]+)/g)].map((m) => m[1] ?? ""));
    expect(used.size).toBeGreaterThan(8);
    for (const name of used) expect(t.colors.has(name)).toBe(true);
    const literals = code.split("\n").filter((text) => new RegExp(`${H}[0-9a-fA-F]{3,8}\\b`).test(text));
    expect(literals.length).toBe(3);
    for (const text of literals) expect(text).toMatch(/^\s*when (above|below|between) \{ mask=linear\(/);
    expect(code).not.toMatch(/family=|img |src=/);
  });

  test("every control says what it is", () => {
    // `act=` and `field=` give no role: each control's header must write one, or be a field (a textbox).
    const headers = code.replace(/\\\n\s*/g, " ").split("\n");
    for (const text of headers) {
      if (/\bact=/.test(text)) expect(text).toMatch(/\brole=(button|combobox|checkbox)\b/);
      if (/\bfield=/.test(text)) expect(text).toMatch(/\blabel=name\b/);
    }
  });

  test("a choice's values are not drawn here: the popup is the page's", () => {
    expect(code).not.toMatch(/\battach=|role=listbox|role=option/);
    expect(code).toMatch(/#choice[^\n]*\n[^\n]*role=combobox label=said expanded=open/);
  });
});
