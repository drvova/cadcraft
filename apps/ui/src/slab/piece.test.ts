/**
 * The Piece section ported to Slab: the params the document takes (`./piece-params`), a signal's
 * item key read back to a row or a value (stale and forged keys do nothing), the solved scene's
 * keys, the keys a Slab field keeps from the shell (`./fields`), the row editing both panels
 * share (`../piece-edit`), and the document held against the names the host uses.
 *
 * The surface itself (the kernel's field, the list under a choice, the keyboard) needs the built
 * artifacts and a browser, and is checked there.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_CHECKS, parsePiece, pieceFacts, pieceRows, PIECE_KINDS, type Piece, type PieceChoices, type PieceRow, type PieceState } from "../piece";
import { createRowEdit, type RowEditHost } from "../piece-edit";
import { fieldKeepsKey, isSlabFieldHost } from "./fields";
import {
  choiceNode,
  fieldNode,
  fieldNodeLike,
  focusedRow,
  hiddenEnds,
  MAX_PIECE_OPTIONS,
  MAX_PIECE_ROWS,
  pickedValue,
  PIECE_LISTS,
  PIECE_SCALARS,
  PIECE_SIGNALS,
  piecePanelParams,
  piecePopup,
  rowParam,
  sentenceText,
  signalRow,
  startKind,
  STARTS_PER_LINE,
  startNode,
  stepNode,
  UNCAPPED,
  type PieceView,
} from "./piece-params";
import { mapTokens } from "./tokens";
import type { SlabHost } from "./types";

const ui = join(import.meta.dir, "..", "..");

/** Spelled apart so the design-system check does not read the fixture as a colour in the interface. */
const H = "#";

function reply(kind: string, over: Record<string, unknown> = {}, rest: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    params: { kind, size: 6.5, sizeText: "6½", sizeSystem: "us", wall: 1.8, width: 2.2, profile: "flat", metal: "gold18", cut: "round", stoneLength: 6.5, stoneWidth: 6.5, stone: "diamond", prongs: 6, halo: false, melee: 1.8, count: null, gap: 0.2, ...over },
    handles: ["2A"],
    size: { diameter: 16.92, usText: "6½", uk: "M½", eu: 53, jp: 13, cn: 13 },
    metal: { name: "gold18", grams: 3.4567 },
    stones: { count: 1, carat: 1.034 },
    checks: [
      { id: "wall", ok: true, message: "The wall is thick enough to cast" },
      { id: "head", ok: false, message: "The head stands 0.2 mm into the finger" },
    ],
    ...rest,
  };
}

function piece(kind: string, over: Record<string, unknown> = {}, rest: Record<string, unknown> = {}): Piece {
  const read = parsePiece(reply(kind, over, rest));
  if (read === null) throw new Error("the piece did not parse");
  return read;
}

const CHOICES: PieceChoices = {
  metals: [
    { value: "gold18", label: "18k gold" },
    { value: "platinum", label: "Platinum" },
  ],
  cuts: [
    { value: "round", label: "Round" },
    { value: "oval", label: "Oval" },
  ],
  stones: [{ value: "diamond", label: "Diamond" }],
  round: ["round"],
};

const VIEW: PieceView = { open: true, system: "us", openChoice: null, faults: new Map(), gallery: true, bodyMax: 300, hidden: { above: false, below: false } };

function panel(p: Piece, view: Partial<PieceView> = {}): ReturnType<typeof piecePanelParams> {
  const all = { ...VIEW, ...view };
  return piecePanelParams({ kind: "piece", piece: p }, pieceRows(p, CHOICES, all.system), pieceFacts(p, all.system), p.checks, all);
}

function rowOf(p: Piece, key: string): PieceRow {
  const found = pieceRows(p, CHOICES, "us").find((r) => r.key === key);
  if (found === undefined) throw new Error(`no row ${key}`);
  return found;
}

describe("the piece panel's params", () => {
  test("with no piece: the kinds the SolidJS panel offers, and the gallery when the shell has one", () => {
    const none = piecePanelParams({ kind: "none" }, [], [], [], VIEW);
    expect(none.none).toBe(true);
    expect(none.held).toBe(false);
    const starts = none.lines.flatMap((line) => line.starts);
    expect(starts.map((s) => s.key)).toEqual(PIECE_KINDS.map((k) => k.value));
    expect(starts.map((s) => s.name)).toEqual(["Band", "Solitaire", "Three-stone", "Eternity"]);
    expect(starts[2]?.hint).toBe("Start a three-stone");
    // Broken into lines here (the kernel does not wrap a list's items); the gallery ends the last.
    expect(none.lines.map((line) => line.starts.length)).toEqual([STARTS_PER_LINE, PIECE_KINDS.length - STARTS_PER_LINE]);
    expect(none.lines.map((line) => line.more)).toEqual([false, true]);
    expect(new Set(none.lines.map((line) => line.key)).size).toBe(none.lines.length);
    const plain = piecePanelParams({ kind: "none" }, [], [], [], { ...VIEW, gallery: false });
    expect(plain.lines.some((line) => line.more)).toBe(false);
    expect(plain.lines.flatMap((line) => line.starts)).toEqual(starts);
    expect(none.rows).toEqual([]);
    expect(none.summary).toBe("");
  });

  test("an engine without the command says so and offers nothing", () => {
    const off = piecePanelParams({ kind: "unavailable" }, [], [], [], VIEW);
    expect(off.unavailable).toBe(true);
    expect(off.none).toBe(false);
    expect(off.lines).toEqual([]);
  });

  test("a row is the control its kind of value takes", () => {
    const params = panel(piece("solitaire"));
    expect(params.held).toBe(true);
    expect(params.summary).toBe("Solitaire · US 6½");
    const by = new Map(params.rows.map((r) => [r.key, r]));
    expect(params.rows.map((r) => r.key)).toEqual(pieceRows(piece("solitaire"), CHOICES, "us").map((r) => r.key));
    expect(by.get("kind")).toMatchObject({ name: "Kind", shown: "Solitaire", said: "Kind: Solitaire", choice: true, tick: false, typed: false, open: false });
    expect(by.get("metal")).toMatchObject({ shown: "18k gold", choice: true });
    expect(by.get("wall")).toMatchObject({ name: "Wall, mm", shown: "1.8", typed: true, choice: false, tick: false });
    expect(by.get("size")).toMatchObject({ shown: "6½", typed: true });
    expect(by.get("halo")).toMatchObject({ tick: true, on: false, typed: false, shown: "", said: "Halo" });
    expect(panel(piece("solitaire", { halo: 1.3 })).rows.find((r) => r.key === "halo")?.on).toBe(true);
    // Every row is exactly one kind of control.
    for (const r of params.rows) expect([r.choice, r.tick, r.typed].filter(Boolean).length).toBe(1);
  });

  test("only the open choice says it is open; its values are the popup's, opened on the held one", () => {
    const band = piece("band", { profile: "comfort" });
    const params = panel(band, { openChoice: "profile" });
    expect(params.rows.filter((r) => r.open).map((r) => r.key)).toEqual(["profile"]);
    // A typed row cannot be opened.
    expect(panel(piece("band"), { openChoice: "wall" }).rows.find((r) => r.key === "wall")?.open).toBe(false);
    const profile = rowOf(band, "profile");
    const listed = piecePopup(profile);
    expect(listed.options.map((o) => o.value)).toEqual((profile.choices ?? []).map((c) => c.value));
    expect(listed.options.find((o) => o.value === listed.held)?.label).toBe("Comfort fit");
    // A value its choices do not hold opens the list on none; a row that is no choice has no list.
    expect(piecePopup({ key: "cut", label: "Cut", value: "gone", kind: "choice", choices: CHOICES.cuts }).held).toBeNull();
    expect(piecePopup(rowOf(band, "wall"))).toEqual({ options: [], held: null });
    expect(piecePopup({ key: "cut", label: "Cut", value: "round", kind: "choice" }).options).toEqual([]);
  });

  test("a refusal marks its row and is what a screen reader is told", () => {
    const params = panel(piece("band"), { faults: new Map([["wall", "Wall needs a number"]]) });
    expect(params.rows.find((r) => r.key === "wall")).toMatchObject({ bad: true, hint: "Wall needs a number" });
    expect(params.rows.find((r) => r.key === "width")).toMatchObject({ bad: false, hint: "" });
  });

  test("the results and the checks say themselves, the verdict in a word", () => {
    const params = panel(piece("solitaire"));
    expect(params.counted).toBe(true);
    expect(params.facts[0]).toEqual({ key: "fact-0", name: "Metal weight", amount: "3.46 g 18k gold", said: "Metal weight: 3.46 g 18k gold" });
    expect(params.judged).toBe(true);
    expect(params.checks_name).toBe("Checks, 1 failed");
    expect(params.checks).toEqual([
      { key: "check-0", note: "The wall is thick enough to cast", mark: "Pass", said: "Pass: The wall is thick enough to cast", failed: false },
      { key: "check-1", note: "The head stands 0.2 mm into the finger", mark: "Fail", said: "Fail: The head stands 0.2 mm into the finger", failed: true },
    ]);
    const passing = panel(piece("band", {}, { checks: [{ id: "wall", ok: true, message: "Fine" }] }));
    expect(passing.checks_name).toBe("Checks, all pass");
    expect(panel(piece("band", {}, { checks: [] })).judged).toBe(false);
  });

  test("the size system shown is the heading's and the size row's", () => {
    const params = panel(piece("band"), { system: "uk" });
    expect(params.summary).toBe("Band · UK M½");
    expect(params.rows.find((r) => r.key === "size")?.shown).toBe("M½");
    expect(params.rows.find((r) => r.key === "system")?.shown).toBe("UK");
  });

  test("folded, nothing is handed over but the heading", () => {
    const params = panel(piece("solitaire"), { open: false, openChoice: "kind" });
    expect(params).toMatchObject({ open: false, held: false, none: false, counted: false, judged: false, rows: [], facts: [], checks: [], lines: [] });
    expect(params.summary).toBe("Solitaire · US 6½");
  });

  test("the body's cap and its hidden ends", () => {
    expect(panel(piece("band"), { bodyMax: 231.7 }).body_max).toBe(231);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(panel(piece("band"), { bodyMax: bad }).body_max).toBe(UNCAPPED);
    expect(panel(piece("band"), { hidden: { above: true, below: false } })).toMatchObject({ above: true, below: false, between: false });
    expect(panel(piece("band"), { hidden: { above: false, below: true } })).toMatchObject({ above: false, below: true, between: false });
    expect(panel(piece("band"), { hidden: { above: true, below: true } })).toMatchObject({ above: false, below: false, between: true });
  });

  test("hostile text is one capped line, and the lists are capped", () => {
    expect(sentenceText("a\u0000b c\n d")).toBe("a b c d");
    expect(sentenceText("x".repeat(5_000)).length).toBe(400);
    const row: PieceRow = { key: "metal", label: "Me\u0007tal\n", value: "v0", kind: "choice", choices: Array.from({ length: 500 }, (_, i) => ({ value: `v${i}`, label: `L${i}\u0000` })) };
    const shaped = rowParam(row, { openChoice: "metal", faults: new Map([["metal", "no\u0000 ".repeat(400)]]) });
    expect(shaped.name).toBe("Me tal");
    const listed = piecePopup(row);
    expect(listed.options.length).toBe(MAX_PIECE_OPTIONS);
    expect(listed.options[1]).toEqual({ value: "v1", label: "L1" });
    expect(shaped.hint.length).toBeLessThanOrEqual(400);
    const p = piece("band");
    const many = Array.from({ length: 300 }, (_, i): PieceRow => ({ key: `k${"a".repeat(i % 20)}`, label: "L", value: "1", kind: "number" }));
    const checks = Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, ok: i % 2 === 0, message: "m" }));
    const state: PieceState = { kind: "piece", piece: p };
    const params = piecePanelParams(state, many, Array.from({ length: 300 }, () => ({ label: "l", value: "v" })), checks, VIEW);
    expect(params.rows.length).toBe(MAX_PIECE_ROWS);
    expect(params.checks.length).toBe(MAX_CHECKS);
    expect(params.facts.length).toBeLessThanOrEqual(12);
  });
});

describe("a signal's item key", () => {
  const rows = pieceRows(piece("solitaire"), CHOICES, "us");

  test("names a row that is shown, and nothing else", () => {
    expect(signalRow(rows, "wall")?.key).toBe("wall");
    expect(signalRow(rows, "melee")).toBeNull();
    for (const forged of ["", "0", "wall/..", "__proto__", "constructor", "w".repeat(200), "wall "]) expect(signalRow(rows, forged)).toBeNull();
  });

  test("a pick is a value of that row's choices only", () => {
    const metal = rowOf(piece("solitaire"), "metal");
    expect(pickedValue(metal, "platinum")).toBe("platinum");
    expect(pickedValue(metal, "Platinum")).toBeNull();
    expect(pickedValue(rowOf(piece("solitaire"), "wall"), "1.8")).toBeNull();
    for (const forged of ["", "o-1", "gone", "platinum ", "__proto__"]) expect(pickedValue(metal, forged)).toBeNull();
    expect(pickedValue(null, "platinum")).toBeNull();
    // Past the cap a value is not one the popup listed.
    const many: PieceRow = { key: "metal", label: "Metal", value: "v0", kind: "choice", choices: Array.from({ length: 500 }, (_, i) => ({ value: `v${i}`, label: `L${i}` })) };
    expect(pickedValue(many, `v${MAX_PIECE_OPTIONS - 1}`)).toBe(`v${MAX_PIECE_OPTIONS - 1}`);
    expect(pickedValue(many, `v${MAX_PIECE_OPTIONS}`)).toBeNull();
  });

  test("a start is one of the kinds", () => {
    expect(startKind("eternity")).toBe("eternity");
    for (const forged of ["", "remove", "Band", "toString"]) expect(startKind(forged)).toBeNull();
  });
});

describe("the solved scene's keys", () => {
  const BODY = "PiecePanel@0/col@0/#body";
  const ROW = (row: string): string => `${BODY}/#rows/each@0~${row}/col@0/row@0/row@0`;
  const scene = [
    { key: "PiecePanel@0/col@0/#head/#fold" },
    { key: `${ROW("kind")}/#choice` },
    { key: `${ROW("size")}/row@0/#field` },
    { key: `${ROW("wall")}/row@0/#field` },
    { key: `${ROW("halo")}/row@1/#tick` },
    { key: `${BODY}/#foot/#remove` },
  ];

  test("a node's row", () => {
    expect(focusedRow(`${ROW("wall")}/row@0/#field`)).toBe("wall");
    expect(focusedRow(`${ROW("kind")}/#choice`)).toBe("kind");
    expect(focusedRow(`${BODY}/#foot/#remove`)).toBeNull();
    expect(focusedRow(null)).toBeNull();
  });

  test("a row's parts are found by the row's name, and only a name", () => {
    expect(fieldNode(scene, "wall")).toBe(`${ROW("wall")}/row@0/#field`);
    expect(fieldNode(scene, "kind")).toBeNull();
    expect(choiceNode(scene, "kind")).toBe(`${ROW("kind")}/#choice`);
    for (const forged of ["", "wall/", "~wall", ".*"]) {
      expect(fieldNode(scene, forged)).toBeNull();
      expect(choiceNode(scene, forged)).toBeNull();
    }
  });

  test("a row the scene does not show yet takes a sibling's key", () => {
    expect(fieldNodeLike(scene, "width")).toBe(`${ROW("width")}/row@0/#field`);
    expect(fieldNodeLike([{ key: `${ROW("kind")}/#choice` }], "width")).toBeNull();
    expect(fieldNodeLike(scene, "wid/th")).toBeNull();
  });

  test("Up and Down step through the rows' controls and stop at the ends", () => {
    expect(stepNode(scene, `${ROW("size")}/row@0/#field`, 1)).toBe(`${ROW("wall")}/row@0/#field`);
    expect(stepNode(scene, `${ROW("size")}/row@0/#field`, -1)).toBe(`${ROW("kind")}/#choice`);
    expect(stepNode(scene, `${ROW("halo")}/row@1/#tick`, 1)).toBe(`${BODY}/#foot/#remove`);
    expect(stepNode(scene, `${BODY}/#foot/#remove`, 1)).toBeNull();
    expect(stepNode(scene, `${ROW("kind")}/#choice`, -1)).toBeNull();
    expect(stepNode(scene, "nowhere", 1)).toBeNull();
  });

  test("the first start button", () => {
    const START = (line: number, kind: string): string => `${BODY}/#starts/each@0~line-${line}/row@0/each@0~${kind}/row@0/#start`;
    expect(startNode([{ key: `${BODY}/#starts` }, { key: `${BODY}/#starts/each@0~line-0/row@0/#templates` }, { key: START(0, "band") }, { key: START(0, "solitaire") }])).toBe(START(0, "band"));
    expect(startNode(scene)).toBeNull();
  });

  test("the ends of the body that hide rows", () => {
    const body = { key: BODY, y: 24, h: 200 };
    const at = (y: number, h: number): { above: boolean; below: boolean } =>
      hiddenEnds([body, { key: `${BODY}/#rows`, y, h }, { key: `${BODY}/#rows/each@0~kind/col@0`, y: -500, h: 2000 }, { key: `${BODY}/#foot`, y: y + h, h: 32 }]);
    expect(at(26, 100)).toEqual({ above: false, below: false });
    expect(at(26, 400)).toEqual({ above: false, below: true });
    expect(at(-100, 400)).toEqual({ above: true, below: true });
    expect(at(-208, 400)).toEqual({ above: true, below: false });
    expect(hiddenEnds([])).toEqual({ above: false, below: false });
    expect(hiddenEnds([{ key: BODY, y: 24, h: 0 }, { key: `${BODY}/#rows`, y: 0, h: 900 }])).toEqual({ above: false, below: false });
    expect(hiddenEnds([body, { key: `${BODY}/#rows`, y: Number.NaN, h: 5 }])).toEqual({ above: false, below: false });
  });
});

describe("the keys a Slab field keeps from the shell", () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}): { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean } => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

  test("typing, the caret and Enter are the field's", () => {
    for (const k of ["a", "7", ".", " ", "Enter", "Backspace", "Delete", "ArrowLeft", "Home", "End"]) expect(fieldKeepsKey(key(k))).toBe(true);
  });

  test("its own chords are the field's: undo, redo, select all, the clipboard, by word", () => {
    for (const k of ["z", "Z", "y", "a", "c", "x", "v"]) {
      expect(fieldKeepsKey(key(k, { ctrlKey: true }))).toBe(true);
      expect(fieldKeepsKey(key(k, { metaKey: true }))).toBe(true);
    }
    expect(fieldKeepsKey(key("ArrowLeft", { ctrlKey: true }))).toBe(true);
    expect(fieldKeepsKey(key("Backspace", { ctrlKey: true }))).toBe(true);
  });

  test("the shell's keys pass: the function keys, Tab, Escape, its chords, a bare modifier", () => {
    for (const k of ["F1", "F6", "F12", "Tab", "Escape"]) expect(fieldKeepsKey(key(k))).toBe(false);
    for (const k of ["s", "b", "p", "P", "n", "o", "7", "9"]) expect(fieldKeepsKey(key(k, { ctrlKey: true }))).toBe(false);
    expect(fieldKeepsKey(key("Control", { ctrlKey: true }))).toBe(false);
    expect(fieldKeepsKey(key("Meta", { metaKey: true }))).toBe(false);
  });

  test("a surface without the driver's field calls is not taken for one that has them", () => {
    const bare = {} as SlabHost;
    expect(isSlabFieldHost(bare)).toBe(false);
    const full = { setFieldText: () => true, fieldText: () => "", setCaret: () => true, focusedKey: () => null, setFocus: () => true, whenSettled: () => Promise.resolve() } as unknown as SlabHost;
    expect(isSlabFieldHost(full)).toBe(true);
  });
});

/** A row's view as either panel holds it, with what it was asked to do written down. */
function bench(row: PieceRow, answer: (patch: Record<string, unknown>) => boolean = () => true, system = "us") {
  const log = { sent: [] as Record<string, unknown>[], said: [] as string[], picked: [] as string[], forgot: 0 };
  const view = { row, draft: row.value, dirty: false, fault: null as string | null, engine: null as string | null };
  const host: RowEditHost = {
    row: () => view.row,
    system: () => system,
    draft: () => view.draft,
    setDraft: (value) => {
      view.draft = value;
    },
    dirty: () => view.dirty,
    setDirty: (value) => {
      view.dirty = value;
    },
    fault: () => view.fault,
    setFault: (message) => {
      view.fault = message;
    },
    engineFault: () => view.engine,
    forget: () => {
      if (view.engine !== null) log.forgot += 1;
      view.engine = null;
    },
    pick: (value) => log.picked.push(value),
    run: (patch) => {
      log.sent.push(patch);
      const ok = answer(patch);
      if (!ok) view.engine = "refused by the engine";
      return ok;
    },
    notice: (message) => log.said.push(message),
  };
  return { edit: createRowEdit(host), view, log };
}

describe("a row's editing, as both panels do it", () => {
  const wall = (): PieceRow => rowOf(piece("band"), "wall");

  test("typed text is sent on Enter, once, and the field is no longer an edit", () => {
    const { edit, view, log } = bench(wall());
    edit.typed("2.1");
    expect(view).toMatchObject({ draft: "2.1", dirty: true });
    edit.commitText(false);
    expect(log.sent).toEqual([{ wall: 2.1 }]);
    expect(view.dirty).toBe(false);
    edit.commitText(true);
    expect(log.sent.length).toBe(1);
  });

  test("nothing typed, or the same number written another way, sends nothing", () => {
    const { edit, view, log } = bench(wall());
    edit.commitText(true);
    edit.typed("1.80");
    edit.commitText(false);
    expect(log.sent).toEqual([]);
    expect(view).toMatchObject({ draft: "1.8", dirty: false });
  });

  test("text that cannot be the value is said once and stays while the field has the focus", () => {
    const { edit, view, log } = bench(wall());
    edit.typed("abc");
    edit.commitText(false);
    expect(log.said).toEqual(["Wall needs a number"]);
    expect(view).toMatchObject({ draft: "abc", dirty: true, fault: "Wall needs a number" });
    expect(edit.why()).toBe("Wall needs a number");
    // Enter again, then leaving: neither warns nor sends twice, and the engine's value comes back.
    edit.commitText(false);
    edit.commitText(true);
    expect(log.said.length).toBe(1);
    expect(log.sent).toEqual([]);
    expect(view).toMatchObject({ draft: "1.8", dirty: false, fault: null });
  });

  test("refused on the way out, the engine's value comes back at once", () => {
    const { edit, view, log } = bench(wall());
    edit.typed("abc");
    edit.commitText(true);
    expect(log.said.length).toBe(1);
    expect(view).toMatchObject({ draft: "1.8", dirty: false, fault: null });
  });

  test("the engine's refusal keeps the text in the focused field, and leaving gives it up", () => {
    const { edit, view, log } = bench(wall(), () => false);
    edit.typed("-4");
    edit.commitText(false);
    expect(log.sent).toEqual([{ wall: -4 }]);
    expect(view).toMatchObject({ draft: "-4", dirty: true });
    expect(edit.why()).toBe("refused by the engine");
    edit.commitText(false);
    expect(log.sent.length).toBe(1);
    edit.commitText(true);
    expect(view).toMatchObject({ draft: "1.8", dirty: false, engine: null });
    expect(log.forgot).toBe(1);
  });

  test("typing again lets a refusal go", () => {
    const { edit, view } = bench(wall(), () => false);
    edit.typed("-4");
    edit.commitText(false);
    edit.typed("-");
    expect(view).toMatchObject({ fault: null, engine: null, dirty: true });
  });

  test("Escape cancels an edit, and is the shell's when there is none", () => {
    const { edit, view } = bench(wall());
    expect(edit.cancel()).toBe(false);
    edit.typed("9");
    expect(edit.cancel()).toBe(true);
    expect(view).toMatchObject({ draft: "1.8", dirty: false });
    expect(edit.cancel()).toBe(false);
  });

  test("a pick is sent unless it is the value held; a refused one shows the engine's value", () => {
    const profile = rowOf(piece("band"), "profile");
    const ok = bench(profile);
    ok.edit.commit("flat");
    expect(ok.log.sent).toEqual([]);
    ok.edit.commit("dome");
    expect(ok.log.sent).toEqual([{ profile: "dome" }]);
    const no = bench(profile, () => false);
    no.view.draft = "dome";
    no.edit.commit("dome");
    expect(no.view.draft).toBe("flat");
  });

  test("the size system is picked, never sent; a tick sends the halo", () => {
    const system = bench(rowOf(piece("band"), "system"));
    system.edit.commit("uk");
    expect(system.log.picked).toEqual(["uk"]);
    expect(system.log.sent).toEqual([]);
    const halo = bench(rowOf(piece("solitaire"), "halo"));
    halo.edit.commit("true");
    expect(halo.log.sent).toEqual([{ halo: true }]);
  });

  test("the size is sent in the system shown", () => {
    const { edit, log } = bench(rowOf(piece("band"), "size"), () => true, "us");
    edit.typed("7 1/2");
    edit.commitText(false);
    expect(log.sent).toEqual([{ system: "us", size: 7.5 }]);
  });

  test("a row that left the page sends nothing", () => {
    const { edit, log } = bench(wall());
    edit.typed("3");
    edit.gone();
    edit.commitText(true);
    expect(log.sent).toEqual([]);
  });
});

describe("the document", () => {
  const source = readFileSync(join(ui, "slab", "piece.slab"), "utf8");
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  test("declares every param the host sets, and no other", () => {
    const head = /def PiecePanel\(([\s\S]*?)\) export/.exec(code)?.[1] ?? "";
    const declared = [...head.matchAll(/([a-z_]+)=/g)].map((m) => m[1] ?? "");
    expect([...declared].sort()).toEqual([...PIECE_SCALARS, ...PIECE_LISTS].sort());
  });

  test("fires the signals the host answers, and no other", () => {
    const fired = new Set([...code.matchAll(/\b(?:act|field|submit)=([a-z_]+)/g)].map((m) => m[1] ?? ""));
    expect([...fired].sort()).toEqual([...PIECE_SIGNALS].sort());
  });

  test("the list items carry the fields the params give them", () => {
    const fields = (def: string): string[] => [...(new RegExp(`def ${def}\\(([\\s\\S]*?)\\) export`).exec(code)?.[1] ?? "").matchAll(/([a-z_]+)=/g)].map((m) => m[1] ?? "").sort();
    const params = panel(piece("solitaire"), { openChoice: "kind" });
    const none = piecePanelParams({ kind: "none" }, [], [], [], VIEW);
    const without = (item: object | undefined): string[] => Object.keys(item ?? {}).filter((k) => k !== "key").sort();
    expect(fields("PieceRow")).toEqual(without(params.rows[0]));
    // A choice's values are the page's popup, not items of the document.
    expect(code).not.toMatch(/def PieceOption|role=listbox|role=option|\battach=/);
    expect(fields("PieceFact")).toEqual(without(params.facts[0]));
    expect(fields("PieceCheck")).toEqual(without(params.checks[0]));
    expect(fields("PieceStartLine")).toEqual(without(none.lines[0]));
    expect(fields("PieceStart")).toEqual(without(none.lines[0]?.starts[0]));
  });

  test("takes its colours from the token sheet; the only literals are the fade mask's two alphas", () => {
    const t = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8"));
    const used = new Set([...code.matchAll(/color\.([a-z0-9-]+)/g)].map((m) => m[1] ?? ""));
    expect(used.size).toBeGreaterThan(8);
    for (const name of used) expect(t.colors.has(name)).toBe(true);
    const literals = code.split("\n").filter((line) => new RegExp(`${H}[0-9a-fA-F]{3,8}\\b`).test(line));
    expect(literals.length).toBe(3);
    for (const line of literals) expect(line).toMatch(/^\s*when (above|below|between) \{ mask=linear\(/);
    expect(code).not.toMatch(/family=|img |src=/);
  });

  test("every control says what it is", () => {
    // `act=` and `field=` give no role: each control's header must write one, or be a field (a textbox).
    const headers = code.replace(/\\\n\s*/g, " ").split("\n");
    for (const line of headers) {
      if (/\bact=/.test(line)) expect(line).toMatch(/\brole=(button|combobox|checkbox)\b/);
      if (/\bfield=/.test(line)) expect(line).toMatch(/\blabel=name\b/);
    }
  });
});
