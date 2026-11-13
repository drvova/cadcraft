import { describe, expect, test } from "bun:test";
import { AppFacade, type Envelope } from "./facade";
import { MockFacade } from "./mock";
import { arrivalSentence, changeRows, checkLines, createProposals, createStillCache, formatDelta, formatNumber, formatValue, groupProposals, hasStills, objectsLine, parseProposal, parseProposals, patchTitle, stillKey, type ProposalStillDrawer } from "./proposals";

/** A report as the engine wrote it for `piece {wall: 0.5}` on a solitaire with a price book set
 *  (`cadcraft-cli run --metric`, 2026-11-13), cut to what a card reads. */
const THIN_WALL = {
  id: 2,
  group: 1,
  title: "Thin wall",
  steps: [{ command: "piece", params: { wall: 0.5 } }],
  before: { piece: { params: { kind: "solitaire", wall: 1.8, width: 2.2, metal: "gold18" }, checks: [{ id: "wall", ok: true, message: "The wall is 1.8 mm" }] }, stones: { count: 1, carat: 1.031 }, grams: 3.53, cost: { total: 1793.6, metal: 247.1, stones: 1546.5, currency: "USD", unpriced: 0 } },
  after: { piece: { params: { kind: "solitaire", wall: 0.5, width: 2.2, metal: "gold18" }, checks: [{ id: "wall", ok: false, message: "The wall is 0.5 mm" }] }, stones: { count: 1, carat: 1.031 }, grams: 0.91, cost: { total: 1610.2, metal: 63.7, stones: 1546.5, currency: "USD", unpriced: 0 } },
  changes: [
    { after: 0.5, before: 1.8, delta: -1.3, key: "piece.wall", label: "Wall", unit: "mm" },
    { after: 0.91, before: 3.53, delta: -2.62, key: "grams", label: "Metal weight", unit: "g" },
    { after: 1610.2, before: 1793.6, delta: -183.4, key: "cost.total", label: "Estimate", unit: "USD" },
  ],
  checks: { broken: [{ id: "wall", message: "The wall is 0.5 mm, under the 0.8 mm a bench casts without it failing" }], failing: [{ id: "wall", message: "The wall is 0.5 mm, under the 0.8 mm a bench casts without it failing" }], fixed: [] },
  objects: { added: 13, after: 13, before: 13, modified: 0, removed: 13 },
  unchanged: false,
  message: "Thin wall: Wall 1.8 → 0.5 mm; Metal weight 3.53 → 0.91 g; Estimate 1793.6 → 1610.2 USD; 1 check(s) would fail",
};

const TWO_CIRCLES = {
  id: 5,
  group: 4,
  title: "circle",
  steps: [{ command: "circle", params: { center: [0, 0], radius: 3 } }],
  before: { piece: null, stones: { count: 0, carat: 0 }, grams: null, cost: null },
  after: { piece: null, stones: { count: 0, carat: 0 }, grams: null, cost: null },
  changes: [],
  checks: { fixed: [], broken: [], failing: [] },
  objects: { before: 6, after: 8, added: 2, removed: 0, modified: 0 },
  unchanged: false,
  message: "circle: 2 added, 0 removed, 0 changed",
};

describe("reading a report", () => {
  test("the engine's report reads whole", () => {
    const p = parseProposal(THIN_WALL);
    expect(p).not.toBeNull();
    if (p === null) return;
    expect(p.id).toBe(2);
    expect(p.group).toBe(1);
    expect(p.title).toBe("Thin wall");
    expect(p.before.params?.["wall"]).toBe(1.8);
    expect(p.after.cost).toEqual({ total: 1610.2, currency: "USD", unpriced: 0 });
    expect(p.changes).toHaveLength(3);
    expect(p.checks.broken[0]?.id).toBe("wall");
    expect(p.stale).toBe(false);
    expect(hasStills(p)).toBe(true);
  });

  test("anything that is not a report is left out, never half-read", () => {
    for (const bad of [null, 3, "x", [], {}, { id: "2", group: 1 }, { id: 2 }, { id: -1, group: 1 }, { id: 1.5, group: 1 }, { id: Number.NaN, group: 1 }]) expect(parseProposal(bad)).toBeNull();
    expect(parseProposals(null)).toEqual([]);
    expect(parseProposals({ proposals: "x" })).toEqual([]);
    // A duplicate id is read once; a long list is cut to what the engine keeps.
    const many = { proposals: Array.from({ length: 40 }, (_, i) => ({ ...THIN_WALL, id: i % 20 })) };
    expect(parseProposals(many).length).toBe(16);
    expect(parseProposals({ proposals: [THIN_WALL, THIN_WALL] })).toHaveLength(1);
  });

  test("hostile fields stay inside their bounds", () => {
    const p = parseProposal({ ...THIN_WALL, title: `a\u0000${"b".repeat(5000)}`, changes: [{ key: "x", before: { deep: 1 }, after: [1] }, ...Array.from({ length: 200 }, () => ({ key: "y" }))], objects: { added: -4, removed: Number.POSITIVE_INFINITY, modified: "3" } });
    expect(p?.title.length).toBeLessThanOrEqual(120);
    expect(p?.title.includes("\u0000")).toBe(false);
    expect(p?.changes.length).toBe(64);
    expect(p?.objects).toEqual({ before: 0, after: 0, added: 0, removed: 0, modified: 0 });
    expect(changeRows(p ?? (THIN_WALL as never))[0]).toEqual({ key: "x", label: "x", before: "", after: "", delta: null });
  });
});

describe("the rows a card shows", () => {
  test("numbers to the engine's precision, signed deltas with units, money in its currency", () => {
    const p = parseProposal(THIN_WALL);
    if (p === null) throw new Error("no report");
    expect(changeRows(p)).toEqual([
      { key: "piece.wall", label: "Wall", before: "1.8 mm", after: "0.5 mm", delta: "−1.3 mm" },
      { key: "grams", label: "Metal weight", before: "3.53 g", after: "0.91 g", delta: "−2.62 g" },
      { key: "cost.total", label: "Estimate", before: "$1,793.60", after: "$1,610.20", delta: "−$183.40" },
    ]);
  });

  test("values of every kind", () => {
    const row = { key: "piece.width", unit: "mm" };
    expect(formatValue(2.8, row)).toBe("2.8 mm");
    expect(formatValue(1.031, { key: "stones.carat", unit: "ct" })).toBe("1.031 ct");
    expect(formatValue(19, { key: "stones.count", unit: "pc" })).toBe("19");
    expect(formatValue(null, row)).toBe("None");
    expect(formatValue(false, { key: "piece.halo", unit: null })).toBe("No");
    expect(formatValue("gold18", { key: "piece.metal", unit: null })).toBe("18k gold");
    expect(formatValue("platinum", { key: "piece.metal", unit: null })).toBe("platinum");
    expect(formatValue({ a: 1 }, row)).toBe("");
    expect(formatValue(Number.NaN, row)).toBe("");
    expect(formatValue(160000, { key: "cost.total", unit: "JPY" })).toBe("¥160,000");
    expect(formatNumber(12345.6789)).toBe("12,345.679");
    expect(formatNumber(-0.0001)).toBe("0");
    expect(formatDelta({ key: "piece.width", unit: "mm", delta: 0.6 })).toBe("+0.6 mm");
    expect(formatDelta({ key: "stones.count", unit: "pc", delta: 18 })).toBe("+18");
    expect(formatDelta({ key: "piece.width", unit: "mm", delta: 0 })).toBe("±0");
    expect(formatDelta({ key: "piece.kind", unit: null, delta: null })).toBeNull();
    expect(formatDelta({ key: "cost.total", unit: "EUR", delta: 120 })).toBe("+€120.00");
  });

  test("the checks it would break, those it would fix, and those failing either way", () => {
    const p = parseProposal({ ...THIN_WALL, checks: { broken: [{ id: "wall", message: "thin" }], fixed: [{ id: "size", message: "standard" }], failing: [{ id: "wall", message: "thin" }, { id: "spacing", message: "tight" }] } });
    if (p === null) throw new Error("no report");
    const lines = checkLines(p);
    expect(lines.broken.map((c) => c.id)).toEqual(["wall"]);
    expect(lines.fixed.map((c) => c.id)).toEqual(["size"]);
    expect(lines.stillFailing).toBe(1);
  });

  test("a change with no piece says what happens to the objects", () => {
    const p = parseProposal(TWO_CIRCLES);
    if (p === null) throw new Error("no report");
    expect(hasStills(p)).toBe(false);
    // Two circles beside an unchanged piece: no pair of identical pictures.
    const piece = { params: { kind: "band", width: 2 }, stones: null, grams: 3, cost: null };
    expect(hasStills({ ...p, before: piece, after: { ...piece, params: { width: 2, kind: "band" } } })).toBe(false);
    expect(objectsLine(p)).toBe("2 objects added");
    expect(objectsLine({ ...p, objects: { before: 6, after: 6, added: 1, removed: 1, modified: 3 } })).toBe("1 object added, 1 removed, 3 changed");
    expect(objectsLine({ ...p, unchanged: true, objects: { before: 6, after: 6, added: 0, removed: 0, modified: 0 } })).toBe("Nothing in the drawing changes");
    // A piece whose figures move has rows instead.
    expect(objectsLine(parseProposal(THIN_WALL) ?? p)).toBeNull();
  });

  test("groups, arrivals and an edit's title", () => {
    const a = parseProposal({ ...THIN_WALL, id: 2, group: 1, title: "A" });
    const b = parseProposal({ ...THIN_WALL, id: 3, group: 1, title: "B" });
    const c = parseProposal({ ...TWO_CIRCLES, id: 5, group: 4 });
    if (a === null || b === null || c === null) throw new Error("no report");
    expect(groupProposals([a, c, b]).map((g) => [g.group, g.items.map((p) => p.id)])).toEqual([
      [1, [2, 3]],
      [4, [5]],
    ]);
    expect(arrivalSentence([a])).toBe(`Proposal to review: ${THIN_WALL.message}`);
    expect(arrivalSentence([a, b])).toBe("2 proposals to review: A, B");
    expect(arrivalSentence([])).toBe("");
    expect(patchTitle({ width: 2.8 })).toBe("Width 2.8");
    expect(patchTitle({ stoneLength: 7, halo: true })).toBe("Stone length 7, halo on");
    expect(patchTitle({})).toBe("Piece edit");
  });
});

/** The mock facade as the shell sees it, with a solitaire on it. */
function mockWithPiece(): AppFacade {
  const facade = new AppFacade(new MockFacade(), { kind: "mock", detail: "test" });
  expect(facade.execute("piece", { kind: "solitaire" }).ok).toBe(true);
  return facade;
}

const width = (facade: AppFacade): unknown => {
  const env = facade.execute("piece", { query: true });
  return env.ok ? (env.result as { piece: { params: { width: number } } }).piece.params.width : null;
};

describe("the holder, on the mock facade", () => {
  test("a proposal is read, changes nothing, and Accept makes it", () => {
    const facade = mockWithPiece();
    const revision = facade.drawingState()?.revision;
    let changed = 0;
    const arrivals: number[][] = [];
    const model = createProposals({ execute: (c, p) => facade.execute(c, p), onChanged: () => changed++, onArrive: (list) => arrivals.push(list.map((p) => p.id)) });
    model.sync();
    expect(model.list()).toEqual([]);
    const env = facade.execute("propose", { steps: [{ command: "piece", params: { width: 2.8 } }], title: "Wider" });
    expect(env.ok).toBe(true);
    expect(width(facade)).toBe(2.2);
    expect(facade.drawingState()?.revision).toBe(revision);
    model.sync();
    expect(model.list().map((p) => p.title)).toEqual(["Wider"]);
    expect(arrivals).toHaveLength(1);
    expect(model.said()).toContain("Proposal to review: Wider");
    const p = model.list()[0];
    if (p === undefined) throw new Error("nothing waits");
    expect(changeRows(p).find((r) => r.key === "piece.width")).toEqual({ key: "piece.width", label: "Width", before: "2.2 mm", after: "2.8 mm", delta: "+0.6 mm" });
    // Reading the same list again changes nothing and announces nothing.
    model.sync();
    expect(arrivals).toHaveLength(1);
    expect(model.accept(p.id)).toBeNull();
    expect(width(facade)).toBe(2.8);
    expect(changed).toBe(1);
    expect(model.list()).toEqual([]);
    expect(model.said()).toBe("Accepted: Wider");
  });

  test("accepting one variant drops the others; a stale one is marked and refused", () => {
    const facade = mockWithPiece();
    const model = createProposals({ execute: (c, p) => facade.execute(c, p) });
    facade.execute("propose", {
      variants: [
        { title: "Wider", steps: [{ command: "piece", params: { width: 2.8 } }] },
        { title: "Thin wall", steps: [{ command: "piece", params: { wall: 0.5 } }] },
        { title: "Platinum", steps: [{ command: "piece", params: { metal: "platinum" } }] },
      ],
    });
    model.sync();
    expect(model.groups()).toHaveLength(1);
    expect(model.groups()[0]?.items.map((p) => p.title)).toEqual(["Wider", "Thin wall", "Platinum"]);
    const thin = model.list()[1];
    expect(thin === undefined ? [] : checkLines(thin).broken.map((c) => c.id)).toEqual(["wall"]);
    const platinum = model.list()[2];
    if (platinum === undefined) throw new Error("no variant");
    expect(model.accept(platinum.id)).toBeNull();
    expect(model.list()).toEqual([]);

    facade.execute("propose", { steps: [{ command: "piece", params: { width: 3 } }] });
    model.sync();
    facade.execute("piece", { width: 2.5 });
    model.sync();
    const stale = model.list()[0];
    expect(stale?.stale).toBe(true);
    if (stale === undefined) throw new Error("nothing waits");
    expect(model.accept(stale.id)).toContain("the drawing changed since");
    expect(model.refusal(stale.id)).toContain("the drawing changed since");
    expect(width(facade)).toBe(2.5);
    expect(model.reject(stale.id)).toBeNull();
    expect(model.list()).toEqual([]);
    expect(model.said()).toBe("Rejected the proposal; the drawing is as it was");
  });

  test("Reject all of a group, and of everything", () => {
    const facade = mockWithPiece();
    const model = createProposals({ execute: (c, p) => facade.execute(c, p) });
    const variants = [
      { title: "A", steps: [{ command: "piece", params: { width: 2.4 } }] },
      { title: "B", steps: [{ command: "piece", params: { width: 2.6 } }] },
    ];
    facade.execute("propose", { variants });
    facade.execute("propose", { steps: [{ command: "circle", params: { center: [0, 0], radius: 2 } }] });
    model.sync();
    expect(model.groups().map((g) => g.items.length)).toEqual([2, 1]);
    const first = model.groups()[0]?.group ?? -1;
    expect(model.rejectGroup(first)).toBeNull();
    expect(model.said()).toBe("Rejected 2 proposals; the drawing is as it was");
    expect(model.groups().map((g) => g.items.length)).toEqual([1]);
    const circle = model.list()[0];
    expect(circle === undefined ? null : objectsLine(circle)).toBe("1 object added");
    facade.execute("propose", { variants });
    model.sync();
    expect(model.rejectAll()).toBeNull();
    expect(model.list()).toEqual([]);
  });

  test("an engine without the commands is never asked", () => {
    const asked: string[] = [];
    const model = createProposals({ execute: (c) => (asked.push(c), { ok: false, error: "unknown command" }), available: () => false });
    model.sync();
    expect(asked).toEqual([]);
  });
});

describe("the stills", () => {
  test("each side is drawn once per parameters, and a drawing that fails says why", async () => {
    const drawn: string[] = [];
    const draw: ProposalStillDrawer = async (params) => {
      drawn.push(stillKey(params));
      return params["kind"] === "band" ? { message: "The still could not be drawn: WebGL is not available." } : { url: `blob:${drawn.length}` };
    };
    const execute = (): Envelope => ({ ok: true, result: {} });
    const cache = createStillCache(execute, draw);
    cache.request({ kind: "solitaire", width: 2.2 });
    cache.request({ width: 2.2, kind: "solitaire" });
    cache.request({ kind: "band" });
    expect(cache.state({ kind: "solitaire", width: 2.2 })).toEqual({ kind: "pending" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(drawn).toHaveLength(2);
    expect(cache.state({ width: 2.2, kind: "solitaire" })).toEqual({ kind: "done", url: "blob:1" });
    expect(cache.state({ kind: "band" })).toEqual({ kind: "failed", message: "The still could not be drawn: WebGL is not available." });
    cache.dispose();
    expect(cache.state({ kind: "band" })).toBeUndefined();
  });
});
