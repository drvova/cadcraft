import { describe, expect, test } from "bun:test";
import { parsePiece, pieceRows, type Piece, type PieceChoices, type PieceRow } from "./piece";
import { createRowEdit, type RowEditHost } from "./piece-edit";

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

function rowOf(p: Piece, key: string): PieceRow {
  const found = pieceRows(p, CHOICES, "us").find((r) => r.key === key);
  if (found === undefined) throw new Error(`no row ${key}`);
  return found;
}

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

describe("a row's editing", () => {
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
