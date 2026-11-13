import { describe, expect, test } from "bun:test";
import { parseProperties, type PropRow, type PropertiesReply } from "./props";
import { createPropEdit, propertiesSubject, propertiesTitle, rowMode, type PropEditHost } from "./props-edit";

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

function rowOf(reply: PropertiesReply, key: string): PropRow {
  const found = reply.rows.find((row) => row.key === key);
  if (found === undefined) throw new Error(`no row ${key}`);
  return found;
}

describe("the row editing", () => {
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
