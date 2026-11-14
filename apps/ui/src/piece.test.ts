/**
 * The Piece section's logic: the `piece` reply narrowed (hostile input never throws and never
 * reaches the page unclipped), the rows of each kind, typed text into a patch or a refusal, an
 * engine refusal onto its row, the heading, and the mock's `piece` through the same reader.
 */

import { describe, expect, test } from "bun:test";
import { AppFacade } from "./facade";
import { MockFacade } from "./mock";
import {
  AUTO,
  CUSTOM_PROFILE_LABEL,
  MAX_CHECKS,
  MAX_PIECE_HANDLES,
  NO_CHOICES,
  NO_PIECE,
  failedChecks,
  isUnknownCommand,
  judgePieceDraft,
  parsePiece,
  parsePieceReply,
  pieceFacts,
  pieceHeading,
  pieceGroups,
  pieceRows,
  pieceSummary,
  passingLine,
  profileChoices,
  profileUpdate,
  rowShownName,
  rowUnit,
  readPieceChoices,
  refusalRow,
  refusalWords,
  rowName,
  sizeIn,
  type Piece,
  type PieceChoices,
  type PieceRow,
  type PieceState,
} from "./piece";

/** The reply `PieceParams::json` and `RingSize::json` make for a kind (the figures are made up). */
function reply(kind: string, over: Record<string, unknown> = {}, rest: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    params: { kind, system: "us", size: 6.5, sizeText: "6½", sizeSystem: "us", wall: 1.8, width: 2.2, profile: "flat", metal: "gold18", cut: "round", stoneLength: 6.5, stoneWidth: 6.5, stone: "diamond", prongs: 6, halo: false, melee: 1.8, count: null, gap: 0.2, ...over },
    handles: ["2A", "2B", "zz", 7],
    size: { mm: 16.92, diameter: 16.92, circumference: 53.16, us: 6.5, usText: "6½", uk: "M½", eu: 53, jp: 13, cn: 13 },
    metal: { name: "gold18", density: 15.5, grams: 3.4567 },
    stones: { count: 1, carat: 1.034 },
    checks: [
      { id: "wall", ok: true, message: "The wall is thick enough to cast" },
      { id: "head", ok: false, message: "The head stands 0.2 mm into the finger" },
    ],
    at: [0, 0],
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

const keys = (rows: readonly PieceRow[]): string[] => rows.map((r) => r.key);

function row(p: Piece, key: string, system = "us"): PieceRow {
  const found = pieceRows(p, CHOICES, system).find((r) => r.key === key);
  if (found === undefined) throw new Error(`no row ${key}`);
  return found;
}

describe("parsePieceReply", () => {
  test("a query with no piece, a removal and a built piece", () => {
    expect(parsePieceReply({ ok: true, result: { piece: null } })).toEqual(NO_PIECE);
    expect(parsePieceReply({ ok: true, result: { piece: null, removed: 14 } })).toEqual(NO_PIECE);
    const built = parsePieceReply({ ok: true, result: { piece: reply("solitaire"), message: "piece: a solitaire" } });
    expect(built.kind).toBe("piece");
  });

  test("an engine without the command is unavailable; any other refusal changes nothing", () => {
    expect(parsePieceReply({ ok: false, error: "unknown command `piece`" })).toEqual({ kind: "unavailable" });
    const held: PieceState = { kind: "piece", piece: piece("band") };
    expect(parsePieceReply({ ok: false, error: "piece: `wall` must be a number of millimetres from 0.3 to 10" }, held)).toBe(held);
    expect(parsePieceReply({ ok: false, error: "unreadable reply from `piece`" })).toEqual(NO_PIECE);
    expect(isUnknownCommand("piece: unknown command")).toBe(false);
    expect(isUnknownCommand(null)).toBe(false);
  });

  test("a reply that is not the engine's shape is no piece, and never throws", () => {
    for (const hostile of [null, 7, "piece", [], { piece: 7 }, { piece: [] }, { piece: {} }, { piece: { params: null } }, { piece: { params: { kind: "tiara" } } }, { piece: { params: { kind: 3 } } }]) {
      expect(parsePieceReply({ ok: true, result: hostile })).toEqual(NO_PIECE);
    }
  });
});

describe("parsePiece", () => {
  test("the engine's figures are kept as they came", () => {
    const p = piece("solitaire");
    expect(p.params.kind).toBe("solitaire");
    expect(p.params.sizeText).toBe("6½");
    expect(p.params.wall).toBe(1.8);
    expect(p.params.halo).toBeNull();
    expect(p.params.count).toBeNull();
    expect(p.size).toEqual({ diameter: 16.92, us: "6½", uk: "M½", eu: "53", jp: "13", cn: "13" });
    expect(p.metal).toEqual({ name: "gold18", grams: 3.4567 });
    expect(p.stones).toEqual({ count: 1, carat: 1.034 });
    expect(p.checks.map((c) => c.ok)).toEqual([true, false]);
    expect(failedChecks(p)).toBe(1);
  });

  test("handles are checked and capped", () => {
    expect(piece("band").handles).toEqual(["2A", "2B"]);
    const many = Array.from({ length: MAX_PIECE_HANDLES + 50 }, (_, i) => i.toString(16));
    expect(piece("band", {}, { handles: many }).handles.length).toBe(MAX_PIECE_HANDLES);
    expect(piece("band", {}, { handles: "2A" }).handles).toEqual([]);
  });

  test("numbers that are not finite, or below zero, are left out rather than shown", () => {
    const p = piece("eternity", { wall: Number.NaN, width: Infinity, gap: -1, count: "12", prongs: 1e300, melee: "1.8" }, { metal: { name: "gold18", grams: Number.NaN }, stones: { count: -4, carat: "1" }, size: { diameter: Infinity, eu: "53", uk: 7 } });
    expect(p.params.wall).toBeNull();
    expect(p.params.width).toBeNull();
    expect(p.params.gap).toBeNull();
    expect(p.params.count).toBeNull();
    expect(p.params.prongs).toBeNull();
    expect(p.params.melee).toBeNull();
    expect(p.metal.grams).toBeNull();
    expect(p.stones).toEqual({ count: null, carat: null });
    expect(p.size.diameter).toBeNull();
    expect(p.size.eu).toBeNull();
    expect(p.size.uk).toBeNull();
    expect(pieceFacts(p, "us").map((f) => f.label)).toEqual([]);
  });

  test("every string is clipped and the checks are capped", () => {
    const long = "x".repeat(5000);
    const checks = Array.from({ length: MAX_CHECKS * 3 }, (_, i) => ({ id: `c${i}`, ok: i % 2 === 0, message: `${long} ${i}` }));
    const p = piece("band", { metal: long, profile: `fl\nat`, sizeText: long, sizeSystem: long }, { checks, size: { usText: long, uk: long } });
    expect(p.checks.length).toBe(MAX_CHECKS);
    expect(p.checks.every((c) => c.message.length <= 400)).toBe(true);
    expect(p.params.metal).toBe("");
    expect(p.params.profile).toBe("");
    expect(p.params.sizeSystem).toBe("us");
    expect((p.params.sizeText ?? "").length).toBeLessThanOrEqual(40);
    expect((p.size.us ?? "").length).toBeLessThanOrEqual(40);
    expect((p.size.uk ?? "").length).toBeLessThanOrEqual(40);
  });

  test("a check that does not say whether it passed is not shown", () => {
    const p = piece("band", {}, { checks: [{ id: "a", message: "No verdict" }, { id: "b", ok: "yes", message: "Nor here" }, 7, null, { id: "wall", ok: false }, { ok: true }] });
    expect(p.checks).toEqual([{ id: "wall", ok: false, message: "wall" }]);
  });

  test("a halo is its melee width, and false is none", () => {
    expect(piece("solitaire", { halo: 1.3 }).params.halo).toBe(1.3);
    expect(piece("solitaire", { halo: false }).params.halo).toBeNull();
    expect(piece("solitaire", { halo: "wide" }).params.halo).toBeNull();
  });
});

describe("pieceRows", () => {
  test("a band is the finger and the band", () => {
    expect(keys(pieceRows(piece("band"), CHOICES, "us"))).toEqual(["kind", "system", "size", "wall", "width", "profile", "metal"]);
  });

  test("a solitaire adds its stone and head; the halo's rows come with the halo", () => {
    expect(keys(pieceRows(piece("solitaire"), CHOICES, "us"))).toEqual(["kind", "system", "size", "wall", "width", "profile", "metal", "cut", "stone", "stoneWidth", "head", "prongs", "halo"]);
    expect(keys(pieceRows(piece("solitaire", { halo: 1.3 }), CHOICES, "us")).slice(-3)).toEqual(["halo", "haloWidth", "gap"]);
  });

  test("a bezel head trades the prongs for its wall and height, in the Head group", () => {
    const rows = pieceRows(piece("solitaire", { head: "bezel", bezelWall: 0.7 }), CHOICES, "us");
    expect(keys(rows)).toEqual(["kind", "system", "size", "wall", "width", "profile", "metal", "cut", "stone", "stoneWidth", "head", "bezelWall", "bezelHeight", "halo"]);
    expect(rows.find((r) => r.key === "bezelWall")?.value).toBe("0.7");
    expect(rows.find((r) => r.key === "bezelHeight")?.value).toBe("");
    const head = pieceGroups(rows, "solitaire").find((g) => g.name === "Head");
    expect(head?.rows.map((r) => r.key)).toEqual(["head", "bezelWall", "bezelHeight", "halo"]);
    const three = keys(pieceRows(piece("threestone", { head: "bezel" }), CHOICES, "us"));
    expect(three).not.toContain("sideProngs");
    expect(judgePieceDraft(rows.find((r) => r.key === "head")!, "prong")).toEqual({ kind: "send", patch: { head: "prong" } });
  });

  test("the new kinds show their own rows", () => {
    expect(keys(pieceRows(piece("halfeternity"), CHOICES, "us")).slice(-3)).toEqual(["melee", "count", "gap"]);
    expect(keys(pieceRows(piece("dome"), CHOICES, "us")).slice(-2)).toEqual(["topWidth", "topWall"]);
    const signet = pieceRows(piece("signet", { face: "cushion" }), CHOICES, "us");
    expect(keys(signet).slice(-5)).toEqual(["topWidth", "face", "faceLength", "faceWidth", "topWall"]);
    expect(signet.find((r) => r.key === "face")?.value).toBe("cushion");
    expect(pieceGroups(signet, "signet").map((g) => g.name)).toEqual(["Ring", "Band"]);
  });

  test("a round stone is one diameter; any other cut is a length and a width", () => {
    expect(row(piece("solitaire"), "stoneWidth")).toEqual({ key: "stoneWidth", label: "Stone, mm", value: "6.5", kind: "number", both: true });
    const oval = pieceRows(piece("solitaire", { cut: "oval", stoneLength: 8, stoneWidth: 6 }), CHOICES, "us");
    expect(oval.filter((r) => r.key.startsWith("stone") && r.kind === "number").map((r) => [r.label, r.value])).toEqual([
      ["Stone length, mm", "8"],
      ["Stone width, mm", "6"],
    ]);
    // A cut the engine did not list as round is not assumed to be one.
    expect(keys(pieceRows(piece("solitaire"), NO_CHOICES, "us"))).toContain("stoneLength");
  });

  test("an eternity adds its stones, their count and the gap", () => {
    const rows = pieceRows(piece("eternity", { count: 24 }), CHOICES, "us");
    expect(keys(rows)).toEqual(["kind", "system", "size", "wall", "width", "profile", "metal", "cut", "stone", "melee", "count", "gap"]);
    expect(row(piece("eternity", { count: 24 }), "count").value).toBe("24");
    expect(row(piece("eternity"), "count").value).toBe(AUTO);
  });

  test("the size is the engine's name for the finger in the system shown", () => {
    const p = piece("band");
    expect(row(p, "size", "us").value).toBe("6½");
    expect(row(p, "size", "uk").value).toBe("M½");
    expect(row(p, "size", "eu").value).toBe("53");
    expect(row(p, "system", "uk").value).toBe("uk");
    expect(sizeIn(p, "martian")).toBe("6½");
  });

  test("a value the engine's lists do not hold is still one of the row's choices", () => {
    const metal = row(piece("band", { metal: "palladium" }), "metal");
    expect(metal.value).toBe("palladium");
    expect(metal.choices?.[0]).toEqual({ value: "palladium", label: "Palladium" });
    expect(pieceRows(piece("band"), NO_CHOICES, "us").find((r) => r.key === "metal")?.choices).toEqual([{ value: "gold18", label: "18k gold" }]);
  });

  test("the unit is said once, in the label", () => {
    expect(row(piece("band"), "wall").label).toBe("Wall, mm");
    expect(rowName(row(piece("band"), "wall"))).toBe("Wall");
    expect(rowName(row(piece("band"), "kind"))).toBe("Kind");
  });
});

describe("pieceHeading and pieceFacts", () => {
  test("the heading says what it is and its size", () => {
    expect(pieceHeading({ kind: "piece", piece: piece("solitaire") })).toBe("Solitaire · US 6½");
    expect(pieceHeading({ kind: "piece", piece: piece("eternity", { sizeSystem: "uk" }) })).toBe("Eternity · UK M½");
    expect(pieceHeading({ kind: "piece", piece: piece("band") }, "eu")).toBe("Band · EU 53");
    expect(pieceHeading({ kind: "piece", piece: piece("band", { sizeText: null }, { size: {} }) })).toBe("Band");
    expect(pieceHeading(NO_PIECE)).toBe("");
    expect(pieceHeading({ kind: "unavailable" })).toBe("");
  });

  test("the results are the engine's figures, with the size in the systems not shown", () => {
    expect(pieceFacts(piece("solitaire"), "us")).toEqual([
      { label: "Metal weight", value: "3.46 g 18k gold" },
      { label: "Stones", value: "1 pc · 1.03 ct" },
      { label: "Inside diameter", value: "16.92 mm" },
      { label: "Also", value: "UK M½ · EU 53 · JP 13 · CN 13" },
    ]);
    expect(pieceFacts(piece("solitaire"), "uk").at(-1)?.value).toBe("US 6½ · EU 53 · JP 13 · CN 13");
  });

  test("a band has no stones line", () => {
    expect(pieceFacts(piece("band", {}, { stones: { count: 0, carat: 0 } }), "us").map((f) => f.label)).toEqual(["Metal weight", "Inside diameter", "Also"]);
  });
});

describe("judgePieceDraft", () => {
  const band = piece("band");
  const solitaire = piece("solitaire");
  const eternity = piece("eternity");

  test("a typed length is sent as a number; a decimal comma is a decimal mark", () => {
    expect(judgePieceDraft(row(band, "wall"), "2")).toEqual({ kind: "send", patch: { wall: 2 } });
    expect(judgePieceDraft(row(band, "wall"), "2,25")).toEqual({ kind: "send", patch: { wall: 2.25 } });
    expect(judgePieceDraft(row(band, "width"), " 3.5 ")).toEqual({ kind: "send", patch: { width: 3.5 } });
  });

  test("an unchanged or emptied value sends nothing", () => {
    expect(judgePieceDraft(row(band, "wall"), "1.8")).toEqual({ kind: "keep" });
    expect(judgePieceDraft(row(band, "wall"), "1,80")).toEqual({ kind: "keep" });
    expect(judgePieceDraft(row(band, "wall"), "")).toEqual({ kind: "keep" });
    expect(judgePieceDraft(row(band, "wall"), "   ")).toEqual({ kind: "keep" });
    expect(judgePieceDraft(row(band, "metal"), "gold18")).toEqual({ kind: "keep" });
    expect(judgePieceDraft(row(band, "size"), "")).toEqual({ kind: "keep" });
    expect(judgePieceDraft(row(band, "size"), " 6½ ")).toEqual({ kind: "keep" });
  });

  test("text that is not a number is refused by the row's name; its range is the engine's to refuse", () => {
    expect(judgePieceDraft(row(band, "wall"), "thick")).toEqual({ kind: "refuse", message: "Wall needs a number" });
    expect(judgePieceDraft(row(band, "wall"), "2 mm")).toEqual({ kind: "refuse", message: "Wall takes a number without a unit" });
    expect(judgePieceDraft(row(band, "wall"), "1,234,5")).toEqual({ kind: "refuse", message: "Wall needs a number" });
    expect(judgePieceDraft(row(band, "wall"), "99")).toEqual({ kind: "send", patch: { wall: 99 } });
    expect(judgePieceDraft(row(band, "wall"), "0")).toEqual({ kind: "send", patch: { wall: 0 } });
  });

  test("a pick is sent under its parameter", () => {
    expect(judgePieceDraft(row(band, "kind"), "eternity")).toEqual({ kind: "send", patch: { kind: "eternity" } });
    expect(judgePieceDraft(row(band, "profile"), "dome")).toEqual({ kind: "send", patch: { profile: "dome" } });
    expect(judgePieceDraft(row(band, "metal"), "platinum")).toEqual({ kind: "send", patch: { metal: "platinum" } });
    expect(judgePieceDraft(row(solitaire, "cut"), "oval")).toEqual({ kind: "send", patch: { cut: "oval" } });
  });

  test("the size system changes what is shown and sends nothing", () => {
    expect(judgePieceDraft(row(band, "system"), "uk")).toEqual({ kind: "keep" });
  });

  test("a size is sent in the system shown", () => {
    expect(judgePieceDraft(row(band, "size", "us"), "7")).toEqual({ kind: "send", patch: { system: "us", size: 7 } });
    expect(judgePieceDraft(row(band, "size", "us"), "7½", "us")).toEqual({ kind: "send", patch: { system: "us", size: 7.5 } });
    expect(judgePieceDraft(row(band, "size", "us"), "7 1/4", "us")).toEqual({ kind: "send", patch: { system: "us", size: 7.25 } });
    expect(judgePieceDraft(row(band, "size", "us"), "7,5", "us")).toEqual({ kind: "send", patch: { system: "us", size: 7.5 } });
    expect(judgePieceDraft(row(band, "size", "eu"), "54", "eu")).toEqual({ kind: "send", patch: { system: "eu", size: 54 } });
    expect(judgePieceDraft(row(band, "size", "uk"), "n", "uk")).toEqual({ kind: "send", patch: { system: "uk", size: "n" } });
    expect(judgePieceDraft(row(band, "size", "uk"), "m½", "uk")).toEqual({ kind: "keep" });
  });

  test("a size that cannot be one in its system is refused with its shape", () => {
    expect(judgePieceDraft(row(band, "size", "us"), "M", "us")).toEqual({ kind: "refuse", message: "A US size is a number, such as 6.5" });
    expect(judgePieceDraft(row(band, "size", "eu"), "big", "eu")).toEqual({ kind: "refuse", message: "A EU size is a number, such as 52" });
    expect(judgePieceDraft(row(band, "size", "uk"), "12", "uk")).toEqual({ kind: "refuse", message: "A UK size is a letter, such as M or M½" });
    expect(judgePieceDraft(row(band, "size", "uk"), "MMMMMMMMMMMM", "uk").kind).toBe("refuse");
  });

  test("a round stone's one diameter is both its length and its width", () => {
    expect(judgePieceDraft(row(solitaire, "stoneWidth"), "7")).toEqual({ kind: "send", patch: { stoneWidth: 7, stoneLength: 7 } });
    const oval = piece("solitaire", { cut: "oval", stoneLength: 8, stoneWidth: 6 });
    expect(judgePieceDraft(row(oval, "stoneWidth"), "7")).toEqual({ kind: "send", patch: { stoneWidth: 7 } });
    expect(judgePieceDraft(row(oval, "stoneLength"), "9")).toEqual({ kind: "send", patch: { stoneLength: 9 } });
  });

  test("prongs are a whole number", () => {
    expect(judgePieceDraft(row(solitaire, "prongs"), "4")).toEqual({ kind: "send", patch: { prongs: 4 } });
    expect(judgePieceDraft(row(solitaire, "prongs"), "4.5")).toEqual({ kind: "refuse", message: "Prongs takes a whole number" });
    expect(judgePieceDraft(row(solitaire, "prongs"), "six")).toEqual({ kind: "refuse", message: "Prongs needs a number" });
  });

  test("the halo is on, off, or its melee width", () => {
    expect(judgePieceDraft(row(solitaire, "halo"), "true")).toEqual({ kind: "send", patch: { halo: true } });
    const haloed = piece("solitaire", { halo: 1.3 });
    expect(judgePieceDraft(row(haloed, "halo"), "false")).toEqual({ kind: "send", patch: { halo: false } });
    expect(judgePieceDraft(row(haloed, "halo"), "true")).toEqual({ kind: "keep" });
    expect(judgePieceDraft(row(haloed, "haloWidth"), "1,5")).toEqual({ kind: "send", patch: { halo: 1.5 } });
    expect(judgePieceDraft(row(haloed, "haloWidth"), "1.3")).toEqual({ kind: "keep" });
  });

  test("the count is a whole number or auto", () => {
    expect(judgePieceDraft(row(eternity, "count"), "24")).toEqual({ kind: "send", patch: { count: 24 } });
    expect(judgePieceDraft(row(eternity, "count"), "Auto")).toEqual({ kind: "keep" });
    expect(judgePieceDraft(row(eternity, "count"), "")).toEqual({ kind: "keep" });
    const counted = piece("eternity", { count: 24 });
    expect(judgePieceDraft(row(counted, "count"), "auto")).toEqual({ kind: "send", patch: { count: null } });
    expect(judgePieceDraft(row(counted, "count"), "")).toEqual({ kind: "send", patch: { count: null } });
    expect(judgePieceDraft(row(counted, "count"), "24.0")).toEqual({ kind: "keep" });
    expect(judgePieceDraft(row(counted, "count"), "24.5")).toEqual({ kind: "refuse", message: "Count takes a whole number, or auto" });
    expect(judgePieceDraft(row(counted, "count"), "many")).toEqual({ kind: "refuse", message: "Count takes a whole number, or auto" });
  });

  test("a draft that is not text sends nothing", () => {
    expect(judgePieceDraft(row(band, "wall"), 7 as unknown as string)).toEqual({ kind: "keep" });
  });
});

describe("refusalRow", () => {
  const solitaire = pieceRows(piece("solitaire", { cut: "oval", halo: 1.3 }), CHOICES, "us");
  const round = pieceRows(piece("solitaire"), CHOICES, "us");
  const band = pieceRows(piece("band"), CHOICES, "us");

  test("the parameter in backticks is the row", () => {
    expect(refusalRow("piece: `wall` must be a number of millimetres from 0.3 to 10", band)).toBe("wall");
    expect(refusalRow("piece: `width` must be a number of millimetres from 0.5 to 30", band)).toBe("width");
    expect(refusalRow("piece: `profile` must be flat or dome", band)).toBe("profile");
    expect(refusalRow("piece: `kind` must be band, solitaire or eternity", band)).toBe("kind");
    expect(refusalRow("piece: `prongs` must be a whole number from 3 to 8", solitaire)).toBe("prongs");
    expect(refusalRow("piece: `stoneLength` must be a number of millimetres from 0.5 to 30", solitaire)).toBe("stoneLength");
  });

  test("a value in the backticks is found by what the refusal says it is not", () => {
    expect(refusalRow("piece: `unobtainium` is not a metal (gold24|22|18, platinum)", band)).toBe("metal");
    expect(refusalRow("piece: `wall` is not a cut (GEMLIST lists them)", solitaire)).toBe("cut");
    expect(refusalRow("piece: `glass` is not a stone (GEMLIST lists them)", solitaire)).toBe("stone");
    expect(refusalRow("piece: `ZZ` is not a UK ring size", band)).toBe("size");
    expect(refusalRow("piece: 99 is not a US ring size", band)).toBe("size");
    expect(refusalRow("piece: `size` must be a number, or a UK letter", band)).toBe("size");
    expect(refusalRow("piece: `system` must be us, uk, eu, jp or cn", band)).toBe("size");
  });

  test("the halo's width and a round stone's one row take their parameter's refusal", () => {
    expect(refusalRow("piece: `halo` must be true, false or a melee width from 0.8 to 3 millimetres", solitaire)).toBe("haloWidth");
    expect(refusalRow("piece: `halo` must be true, false or a melee width from 0.8 to 3 millimetres", round)).toBe("halo");
    expect(refusalRow("piece: `stoneLength` must be a number of millimetres from 0.5 to 30", round)).toBe("stoneWidth");
  });

  test("a refusal that names no row shown belongs to none", () => {
    expect(refusalRow("piece: the drawing is read-only", band)).toBeNull();
    expect(refusalRow("piece: `at` must be a point", band)).toBeNull();
    expect(refusalRow("piece: `melee` must be a number of millimetres from 0.8 to 6", band)).toBeNull();
    expect(refusalRow("piece: `count` must be a whole number from 1 to 400", solitaire)).toBeNull();
    expect(refusalRow(undefined, band)).toBeNull();
    expect(refusalRow(`${"x".repeat(100_000)}\`wall\``, band)).toBeNull();
  });

  test("the engine's words are said on one line, clipped", () => {
    expect(refusalWords("piece: `wall`\n must be  a number")).toBe("piece: `wall` must be a number");
    expect(refusalWords("x".repeat(9000)).length).toBe(400);
    expect(refusalWords(7)).toBe("");
  });
});

describe("the mock's piece, through the same reader", () => {
  const facade = (): AppFacade => new AppFacade(new MockFacade(), { kind: "mock", detail: "test" });

  test("no piece, then each kind at the engine's defaults, then none again", () => {
    const f = facade();
    expect(parsePieceReply(f.execute("piece", { query: true }))).toEqual(NO_PIECE);
    for (const kind of ["band", "solitaire", "eternity"]) {
      const built = parsePieceReply(f.execute("piece", { kind }));
      expect(built.kind).toBe("piece");
      expect(pieceHeading(built)).toContain("US 6");
      expect(parsePieceReply(f.execute("piece", { query: true }))).toEqual(built);
    }
    expect(parsePieceReply(f.execute("piece", { remove: true }))).toEqual(NO_PIECE);
    expect(parsePieceReply(f.execute("piece", { query: true }))).toEqual(NO_PIECE);
  });

  test("a build changes the drawing's revision; a query and a refusal do not", () => {
    const f = facade();
    const before = f.drawingState()?.revision;
    f.execute("piece", { query: true });
    f.execute("piece", { wall: 2 });
    expect(f.drawingState()?.revision).toBe(before);
    f.execute("piece", { kind: "band" });
    expect(f.drawingState()?.revision).not.toBe(before);
  });

  test("a patch is merged over the piece, and a refusal names its row and changes nothing", () => {
    const f = facade();
    f.execute("piece", { kind: "solitaire" });
    const edited = parsePieceReply(f.execute("piece", { wall: 2.4, halo: true }));
    if (edited.kind !== "piece") throw new Error("no piece");
    expect(edited.piece.params.wall).toBe(2.4);
    expect(edited.piece.params.halo).toBe(1.3);
    const rows = pieceRows(edited.piece, readPieceChoices(f), "us");
    const refused = f.execute("piece", { wall: 40 });
    expect(refused.ok).toBe(false);
    expect(refusalRow(refused.ok ? "" : refused.error, rows)).toBe("wall");
    expect(parsePieceReply(refused, edited)).toBe(edited);
    expect(parsePieceReply(f.execute("piece", { query: true }))).toEqual(edited);
    const thin = parsePieceReply(f.execute("piece", { wall: 0.5 }));
    expect(thin.kind === "piece" ? failedChecks(thin.piece) : -1).toBe(1);
  });

  test("the choices come from the engine: the alloys from the parameter line, the cuts and stones from gemlist", () => {
    const choices = readPieceChoices(facade());
    expect(choices.metals.map((m) => m.value)).toEqual(["gold24", "gold22", "gold18", "gold14", "platinum", "silver"]);
    expect(choices.metals[2]?.label).toBe("18k gold");
    expect(choices.cuts.map((c) => c.value)).toEqual(["round", "princess", "oval", "emerald"]);
    expect(choices.stones.map((s) => s.value)).toEqual(["diamond", "sapphire", "ruby"]);
    expect(choices.round).toEqual(["round", "princess"]);
  });

  test("an engine that lists nothing gives empty lists, not a default to send", () => {
    const silent = { execute: () => ({ ok: false as const, error: "unknown command `gemlist`" }), commands: () => [] };
    expect(readPieceChoices(silent)).toEqual(NO_CHOICES);
  });
});

describe("the section's layout", () => {
  test("the summary is the size, the metal and the stones, then the centre stone in words", () => {
    const s = pieceSummary(piece("solitaire"), "us");
    expect(s.tiles).toEqual([
      { label: "Size", value: "US 6½", detail: "16.92 mm" },
      { label: "Metal", value: "3.46 g", detail: "18k gold" },
      { label: "Stones", value: "1.03 ct", detail: "1 pc" },
    ]);
    expect(s.centre).toMatch(/^6\.5 mm round diamond/);
  });

  test("the passing checks fold to a line that counts them", () => {
    expect(passingLine(4, 0)).toBe("All 4 checks pass");
    expect(passingLine(1, 0)).toBe("The check passes");
    expect(passingLine(3, 1)).toBe("3 checks pass");
    expect(passingLine(1, 2)).toBe("1 check passes");
  });

  test("a band has no stones tile and no centre stone", () => {
    const s = pieceSummary(piece("band", {}, { stones: { count: 0, carat: 0 } }), "us");
    expect(s.tiles.map((t) => t.label)).toEqual(["Size", "Metal"]);
    expect(s.centre).toBeNull();
  });

  test("the rows fall into ring, band, stones and head, in order, none lost", () => {
    for (const kind of ["band", "solitaire", "threestone", "eternity"]) {
      const rows = pieceRows(piece(kind), CHOICES, "us");
      const groups = pieceGroups(rows, kind);
      expect(groups.flatMap((g) => g.rows).length).toBe(rows.length);
      expect(groups[0]?.name).toBe("Ring");
    }
    const eternity = pieceGroups(pieceRows(piece("eternity"), CHOICES, "us"), "eternity");
    expect(eternity.find((g) => g.name === "Stones")?.rows.map((r) => r.key)).toContain("gap");
    expect(pieceGroups(pieceRows(piece("band"), CHOICES, "us"), "band").map((g) => g.name)).toEqual(["Ring", "Band"]);
  });

  test("a length's unit moves beside its value, and a round stone's size is named apart from its material", () => {
    const rows = pieceRows(piece("solitaire"), CHOICES, "us");
    const wall = rows.find((r) => r.key === "wall");
    expect(wall && [rowShownName(wall), rowUnit(wall)]).toEqual(["Wall", "mm"]);
    const kind = rows.find((r) => r.key === "kind");
    expect(kind && rowUnit(kind)).toBe("");
    const stone = rows.find((r) => r.key === "stoneWidth");
    expect(stone && rowShownName(stone)).toBe(stone?.both === true ? "Stone size" : "Stone width");
  });
});

describe("a profile drawn in the drawing", () => {
  const drawn = { profile: "custom", width: 3.2, wall: 1.9, profileCurve: { curve: "1a", points: [[-1.6, 0], [1.6, 0], [0, 1.9]] } };

  test("reads the curve's handle, and only for a custom profile", () => {
    expect(piece("band", drawn).params.profileCurve).toBe("1A");
    expect(piece("band", { ...drawn, profile: "flat" }).params.profileCurve).toBeNull();
    expect(piece("band", { ...drawn, profileCurve: { curve: "not a handle!" } }).params.profileCurve).toBeNull();
    expect(piece("band", { ...drawn, profileCurve: 7 }).params.profileCurve).toBeNull();
    expect(piece("band").params.profileCurve).toBeNull();
  });

  test("names it Custom (from drawing) and shows its wall and width read-only", () => {
    const rows = pieceRows(piece("band", drawn), CHOICES, "us");
    const row = (key: string) => rows.find((r) => r.key === key);
    expect(row("profile")?.value).toBe("custom");
    expect(row("profile")?.choices?.[0]).toEqual({ value: "custom", label: CUSTOM_PROFILE_LABEL });
    expect(row("wall")?.kind).toBe("readonly");
    expect(row("width")?.kind).toBe("readonly");
    expect(row("width")?.value).toBe("3.2");
    // A named profile is typed as before, and Custom is not offered.
    const named = pieceRows(piece("band"), CHOICES, "us");
    expect(named.find((r) => r.key === "wall")?.kind).toBe("number");
    expect(profileChoices("flat").some((c) => c.value === "custom")).toBe(false);
    // Typing into a read-only row sends nothing.
    const wall = rows.find((r) => r.key === "wall");
    if (wall === undefined) throw new Error("no wall row");
    expect(judgePieceDraft(wall, "2.5")).toEqual({ kind: "keep" });
  });

  test("Update from curve re-reads the stored handle", () => {
    expect(profileUpdate(piece("band", drawn))).toEqual({ profile: { curve: "1A" } });
    expect(profileUpdate(piece("band"))).toBeNull();
    expect(profileUpdate(piece("band", { ...drawn, profileCurve: { curve: null } }))).toBeNull();
  });
});

describe("pavé on the band", () => {
  const PAVE = { layout: "honeycomb", rows: 3, melee: 1.2, gap: 0.15, span: "top-half", from: 0, to: 90, symmetric: true, graduated: null };
  const find = (rows: readonly PieceRow[], key: string): PieceRow => {
    const found = rows.find((r) => r.key === key);
    if (found === undefined) throw new Error(`no ${key} row`);
    return found;
  };

  test("an engine without pavé shows no pavé rows; one with it shows a tick, and the group when it is on", () => {
    expect(keys(pieceRows(piece("band"), CHOICES, "us"))).not.toContain("pave");
    expect(keys(pieceRows(piece("band", { pave: false }), CHOICES, "us")).slice(-1)).toEqual(["pave"]);
    const rows = pieceRows(piece("solitaire", { pave: PAVE }), CHOICES, "us");
    expect(keys(rows).slice(-6)).toEqual(["pave", "paveLayout", "paveRows", "paveMelee", "paveGap", "paveSpan"]);
    expect(pieceGroups(rows, "solitaire").map((g) => g.name)).toEqual(["Ring", "Band", "Stones", "Head", "Pavé"]);
    expect(find(rows, "paveSpan").value).toBe("top-half");
    // A single row has no rows count; an eternity band has no pavé.
    expect(keys(pieceRows(piece("band", { pave: { ...PAVE, layout: "row" } }), CHOICES, "us"))).not.toContain("paveRows");
    expect(keys(pieceRows(piece("eternity", { pave: false }), CHOICES, "us"))).not.toContain("pave");
    // Angles instead of a named span read as custom.
    const custom = find(pieceRows(piece("band", { pave: { ...PAVE, span: null } }), CHOICES, "us"), "paveSpan");
    expect(custom.value).toBe("custom");
    expect(custom.choices?.[0]).toEqual({ value: "custom", label: "Custom angles" });
  });

  test("each pavé row sends its one field inside `pave`", () => {
    const rows = pieceRows(piece("band", { pave: PAVE }), CHOICES, "us");
    expect(judgePieceDraft(find(rows, "pave"), "false")).toEqual({ kind: "send", patch: { pave: false } });
    expect(judgePieceDraft(find(rows, "paveLayout"), "scallop")).toEqual({ kind: "send", patch: { pave: { layout: "scallop" } } });
    expect(judgePieceDraft(find(rows, "paveRows"), "2")).toEqual({ kind: "send", patch: { pave: { rows: 2 } } });
    expect(judgePieceDraft(find(rows, "paveRows"), "2.5")).toEqual({ kind: "refuse", message: "Rows takes a whole number" });
    expect(judgePieceDraft(find(rows, "paveMelee"), "1,3")).toEqual({ kind: "send", patch: { pave: { melee: 1.3 } } });
    expect(judgePieceDraft(find(rows, "paveGap"), "0.15")).toEqual({ kind: "keep" });
    expect(judgePieceDraft(find(rows, "paveSpan"), "full")).toEqual({ kind: "send", patch: { pave: { span: "full" } } });
    // The halo's tick still sends the halo.
    const halo = find(pieceRows(piece("solitaire"), CHOICES, "us"), "halo");
    expect(judgePieceDraft(halo, "true")).toEqual({ kind: "send", patch: { halo: true } });
    const off = find(pieceRows(piece("band", { pave: false }), CHOICES, "us"), "pave");
    expect(judgePieceDraft(off, "true")).toEqual({ kind: "send", patch: { pave: true } });
  });

  test("an engine refusal of a pavé key lands on its row", () => {
    const rows = pieceRows(piece("band", { pave: PAVE }), CHOICES, "us");
    expect(refusalRow("invalid parameters for `piece`: `pave.melee` must be a number of millimetres from 0.8 to 3", rows)).toBe("paveMelee");
    expect(refusalRow("`pave.rows` must be 1, 2 or 3", rows)).toBe("paveRows");
    expect(refusalRow("`pave.graduated.from` must be a stone size", rows)).toBe("pave");
  });
});

describe("the Setting group: prong styles", () => {
  test("an engine that offers prong styles shows them in their own group, and a pick sends the key", () => {
    const rows = pieceRows(piece("solitaire", { prongStyle: "claw", prongHeight: null, prongTip: 0.6, prongWire: null }), CHOICES, "us");
    const setting = pieceGroups(rows, "solitaire").find((g) => g.name === "Setting");
    expect(setting?.rows.map((r) => r.key)).toEqual(["prongStyle", "prongHeight", "prongTip", "prongWire"]);
    expect(rows.find((r) => r.key === "prongTip")?.value).toBe("0.6");
    const style = rows.find((r) => r.key === "prongStyle")!;
    expect(style.choices?.map((c) => c.value)).toEqual(["round", "claw", "tab", "v", "double"]);
    expect(judgePieceDraft(style, "v")).toEqual({ kind: "send", patch: { prongStyle: "v" } });
    expect(judgePieceDraft(rows.find((r) => r.key === "prongHeight")!, "1.3")).toEqual({ kind: "send", patch: { prongHeight: 1.3 } });
    expect(refusalRow("V prongs guard a stone's pointed corners, and a round has none", rows)).toBe("prongStyle");
  });
  test("a bezel and an engine without styles show no Setting group", () => {
    expect(keys(pieceRows(piece("solitaire", { head: "bezel", prongStyle: "claw" }), CHOICES, "us"))).not.toContain("prongStyle");
    expect(keys(pieceRows(piece("solitaire"), CHOICES, "us"))).not.toContain("prongStyle");
  });
});
