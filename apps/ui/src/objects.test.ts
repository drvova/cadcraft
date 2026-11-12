import { describe, expect, test } from "bun:test";
import { highlight } from "./palette";
import {
  bandName,
  buildTree,
  CHILD_CAP,
  kindLabel,
  kindPlural,
  layout,
  matchIndices,
  MAX_OBJECTS,
  MAX_VISIBLE_ROWS,
  moreId,
  moreLabel,
  objectsSummary,
  parseObjects,
  PIECE_ID,
  pressSelection,
  revealTarget,
  searchTokens,
  selectedCount,
  selectedState,
  showMore,
  stoneName,
  treeKey,
  type ObjectNode,
  type TreeView,
  type VisibleNode,
} from "./objects";

const VIEW: TreeView = { query: "", expanded: new Set(), collapsed: new Set(), shown: new Map() };
const view = (over: Partial<TreeView>): TreeView => ({ ...VIEW, ...over });

/** A solitaire with a halo as the engine lists it, two loose stones, a loose band and some drafting. */
const REPLY = {
  objects: [
    { handle: "10", kind: "insert", layer: "Metal", name: "RING-PIECE", group: ["JEWELRY_PIECE"] },
    { handle: "11", kind: "insert", layer: "Stones", name: "GEM-ROUND-6.5", group: ["JEWELRY_PIECE"] },
    { handle: "12", kind: "insert", layer: "Stones", name: "GEM-ROUND-1.3", group: ["JEWELRY_PIECE"] },
    { handle: "13", kind: "insert", layer: "Stones", name: "GEM-ROUND-1.3", group: ["JEWELRY_PIECE"] },
    { handle: "14", kind: "insert", layer: "Stones", name: "GEM-ROUND-1.3", group: ["JEWELRY_PIECE"] },
    { handle: "15", kind: "lwpolyline", layer: "Metal", group: ["JEWELRY_PIECE"] },
    { handle: "16", kind: "lwpolyline", layer: "Metal", group: ["JEWELRY_PIECE"] },
    { handle: "17", kind: "circle", layer: "Settings", size: "0.8000", group: ["JEWELRY_PIECE"] },
    { handle: "20", kind: "insert", layer: "Stones", name: "GEM-OVAL-8x6-SAPPHIRE" },
    { handle: "21", kind: "insert", layer: "Stones", name: "GEM-ROUND-1.5" },
    { handle: "22", kind: "insert", layer: "Stones", name: "GEM-ROUND-1.5" },
    { handle: "23", kind: "insert", layer: "0", name: "RING-16.51x2.4" },
    { handle: "30", kind: "text", layer: "Notes", text: "18k yellow gold" },
    { handle: "31", kind: "mtext", layer: "Notes", text: "Polish all over" },
    { handle: "32", kind: "dimension", layer: "0" },
    { handle: "33", kind: "dimension", layer: "0" },
    { handle: "34", kind: "line", layer: "0", size: "5.0000" },
    { handle: "35", kind: "insert", layer: "0", name: "TITLE" },
  ],
  total: 18,
  truncated: false,
  space: "Model",
};

const tree = (): ObjectNode[] => buildTree(parseObjects(REPLY));
const labels = (nodes: readonly { label: string }[]): string[] => nodes.map((n) => n.label);
const find = (nodes: readonly ObjectNode[], id: string): ObjectNode => {
  const all: ObjectNode[] = [];
  const walk = (list: readonly ObjectNode[]): void => {
    for (const n of list) {
      all.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  const hit = all.find((n) => n.id === id);
  if (hit === undefined) throw new Error(`no node ${id}`);
  return hit;
};

describe("reading the reply", () => {
  test("a reply that is not a list is no list", () => {
    for (const bad of [null, undefined, 3, "objects", [], {}, { objects: "many" }, { objects: null, total: 3 }]) expect(parseObjects(bad)).toBeNull();
  });

  test("rows are narrowed, clipped and sanitised; malformed and repeated ones are dropped", () => {
    const list = parseObjects({
      objects: [
        { handle: "1A", kind: "LINE", layer: "Metal", size: "5.0000" },
        { handle: "1A", kind: "line", layer: "Twice" },
        { handle: "not hex", kind: "line", layer: "0" },
        { handle: "12345678901234567", kind: "line", layer: "0" },
        { handle: "2", layer: "0" },
        { handle: 3, kind: "line" },
        { kind: "line" },
        null,
        "row",
        [1, 2],
        { handle: "4", kind: "text", layer: 7, text: `a\u0000b\n${"x".repeat(500)}`, name: {}, size: 5, group: "G" },
        { handle: "5", kind: "insert", layer: "L".repeat(1000), name: "N".repeat(1000), group: [...Array.from({ length: 30 }, (_, i) => `G${i}`), 4, null, "g".repeat(500)] },
      ],
      total: 12,
      truncated: false,
      space: "Model",
    });
    expect(list?.rows.map((r) => r.handle)).toEqual(["1A", "4", "5"]);
    expect(list?.rows[0]).toEqual({ handle: "1A", kind: "line", layer: "Metal", name: "", text: "", size: "5.0000", groups: [] });
    const text = list?.rows[1];
    expect(text?.layer).toBe("0");
    expect(text?.text.startsWith("a b xxx")).toBe(true);
    expect([...(text?.text ?? "")].length).toBe(80);
    expect(text?.name).toBe("");
    expect(text?.size).toBe("");
    expect(text?.groups).toEqual([]);
    const insert = list?.rows[2];
    expect(insert?.layer.length).toBe(128);
    expect(insert?.name.length).toBe(64);
    expect(insert?.groups.length).toBe(8);
    // More than the rows that were read: the list says it is not whole.
    expect(list?.total).toBe(12);
    expect(list?.truncated).toBe(true);
  });

  test("the reply is capped, and the totals stay honest", () => {
    const many = { objects: Array.from({ length: MAX_OBJECTS + 50 }, (_, i) => ({ handle: (i + 1).toString(16), kind: "point", layer: "0" })), total: 99_999, truncated: true, space: "Model" };
    const list = parseObjects(many);
    expect(list?.rows.length).toBe(MAX_OBJECTS);
    expect(list?.total).toBe(99_999);
    expect(list?.truncated).toBe(true);
    expect(objectsSummary(list)).toBe("5,000 of 99,999");
    for (const total of [Number.NaN, -5, "9", null, Infinity]) {
      const odd = parseObjects({ objects: [{ handle: "1", kind: "line", layer: "0" }], total });
      expect(odd?.total).toBe(1);
      expect(odd?.truncated).toBe(false);
      expect(odd?.space).toBe("Model");
    }
  });

  test("the heading's summary", () => {
    expect(objectsSummary(null)).toBe("");
    expect(objectsSummary(parseObjects({ objects: [], total: 0 }))).toBe("0 objects");
    expect(objectsSummary(parseObjects({ objects: [{ handle: "1", kind: "line", layer: "0" }], total: 1 }))).toBe("1 object");
    expect(objectsSummary(parseObjects(REPLY))).toBe("18 objects");
  });
});

describe("names", () => {
  test("kinds, one and several", () => {
    expect([kindLabel("lwpolyline"), kindPlural("lwpolyline")]).toEqual(["Polyline", "Polylines"]);
    expect([kindLabel("mtext"), kindPlural("mtext")]).toEqual(["Text", "Text"]);
    expect([kindLabel("hatch"), kindPlural("hatch")]).toEqual(["Hatch", "Hatches"]);
    expect([kindLabel("acad_proxy_entity"), kindPlural("acad_proxy_entity")]).toEqual(["Acad proxy entity", "Acad proxy entity objects"]);
    // A kind named like something every object has is still only a kind.
    expect(kindLabel("constructor")).toBe("Constructor");
    expect(kindPlural("__proto__")).toBe("  proto   objects");
  });

  test("a stone's block name reads as the bench sheet writes it", () => {
    expect(stoneName("GEM-ROUND-1.3")).toEqual({ label: "Round 1.3 mm", area: 1.3 * 1.3 });
    expect(stoneName("GEM-OVAL-8x6-SAPPHIRE")?.label).toBe("Oval 8×6 mm, sapphire");
    expect(stoneName("GEM-OVAL-8x6-SG4.2-D4.1")?.label).toBe("Oval 8×6 mm, SG 4.2, depth 4.1 mm");
    expect(stoneName("gem-old-mine-6.50")?.label).toBe("Old mine 6.5 mm");
    expect(stoneName("GEM-CUSTOM")).toEqual({ label: "Custom", area: 0 });
    expect(stoneName("GEM-2.5")?.label).toBe("Stone 2.5 mm");
    for (const not of ["", "GEM", "GEM-", "RING-PIECE", "GEMSTONE", "TITLE"]) expect(stoneName(not)).toBeNull();
    expect(stoneName(`GEM-${"A-".repeat(40)}9999999999`)?.area).toBe(0);
  });

  test("a band's block name", () => {
    expect(bandName("RING-16.51x2.4")).toBe("Band 16.51×2.4 mm");
    expect(bandName("RING-PIECE")).toBe("Band");
    expect(bandName("RING-1e9x2")).toBe("Band");
  });
});

describe("the tree", () => {
  test("the piece with its parts, the stones by cut and size, the bands, then layer › kind", () => {
    const t = tree();
    expect(labels(t)).toEqual(["Piece", "Stones", "Bands", "Blocks", "Dimensions", "Lines", "Notes › Text"]);
    const piece = find(t, PIECE_ID);
    expect(labels(piece.children)).toEqual(["Band", "Round 6.5 mm", "Round 1.3 mm", "Metal › Polylines", "Settings › Circles"]);
    expect(piece.handles).toEqual(["10", "11", "12", "13", "14", "15", "16", "17"]);
    // Three alike open to their stones; the one centre stone is its own row.
    expect(labels(find(t, "piece/stones/GEM-ROUND-1.3").children)).toEqual(["Stone 1", "Stone 2", "Stone 3"]);
    expect(find(t, "o/11").children).toEqual([]);
    // Objects with no telling fact are numbered; a circle says its diameter.
    expect(labels(find(t, "piece/layer/Metal/Polylines").children)).toEqual(["Polyline 1", "Polyline 2"]);
    expect(labels(find(t, "piece/layer/Settings/Circles").children)).toEqual(["Circle ⌀ 0.8000"]);
    // Loose stones: the big one first.
    const stones = find(t, "stones");
    expect(labels(stones.children)).toEqual(["Oval 8×6 mm, sapphire", "Round 1.5 mm"]);
    expect(stones.handles).toEqual(["20", "21", "22"]);
    expect(labels(find(t, "bands").children)).toEqual(["Band 16.51×2.4 mm"]);
    // TEXT and MTEXT are one kind to a reader, named by their first words.
    expect(labels(find(t, "layer/Notes/Text").children)).toEqual(["Text “18k yellow gold”", "Text “Polish all over”"]);
    expect(labels(find(t, "layer/0/Blocks").children)).toEqual(["Block TITLE"]);
    expect(labels(find(t, "layer/0/Lines").children)).toEqual(["Line 5.0000"]);
  });

  test("every object is under exactly one row", () => {
    const all = tree().flatMap((n) => n.handles);
    expect(all.length).toBe(18);
    expect(new Set(all).size).toBe(18);
  });

  test("no list is no tree, and a drawing with no piece has no piece row", () => {
    expect(buildTree(null)).toEqual([]);
    const plain = buildTree(parseObjects({ objects: [{ handle: "1", kind: "circle", layer: "Metal", size: "2.0000" }], total: 1 }));
    expect(labels(plain)).toEqual(["Metal › Circles"]);
  });
});

describe("what is drawn", () => {
  test("groups start folded, with their counts and places", () => {
    const l = layout(tree(), VIEW);
    expect(l.rows.map((r) => [r.label, r.kind, r.count, r.level, r.position, r.siblings])).toEqual([
      ["Piece", "group", 8, 1, 1, 7],
      ["Stones", "group", 3, 1, 2, 7],
      ["Bands", "group", 1, 1, 3, 7],
      ["Blocks", "group", 1, 1, 4, 7],
      ["Dimensions", "group", 2, 1, 5, 7],
      ["Lines", "group", 1, 1, 6, 7],
      ["Notes › Text", "group", 2, 1, 7, 7],
    ]);
    expect(l.cut).toBe(false);
    expect(l.matches).toBe(18);
  });

  test("an open group shows its children a level down, nested under it", () => {
    const l = layout(tree(), view({ expanded: new Set([PIECE_ID, "piece/stones/GEM-ROUND-1.3"]) }));
    expect(l.rows.slice(0, 9).map((r) => `${r.level} ${r.label}`)).toEqual(["1 Piece", "2 Band", "2 Round 6.5 mm", "2 Round 1.3 mm", "3 Stone 1", "3 Stone 2", "3 Stone 3", "2 Metal › Polylines", "2 Settings › Circles"]);
    const piece = l.nodes[0];
    expect(piece?.open).toBe(true);
    expect(piece?.children.length).toBe(5);
    expect(piece?.children[2]?.children.map((c) => c.parent)).toEqual(["piece/stones/GEM-ROUND-1.3", "piece/stones/GEM-ROUND-1.3", "piece/stones/GEM-ROUND-1.3"]);
    expect(l.rows.find((r) => r.id === "o/10")?.kind).toBe("leaf");
  });

  test("a search shows the matching rows and their parents, opened, with the match marked", () => {
    const l = layout(tree(), view({ query: "round 1.3" }));
    expect(l.rows.map((r) => `${r.level} ${r.label} ${r.count}`)).toEqual(["1 Piece 3", "2 Round 1.3 mm 3", "3 Stone 1 0", "3 Stone 2 0", "3 Stone 3 0"]);
    expect(l.matches).toBe(3);
    const row = l.rows[1];
    expect(highlight(row?.label ?? "", row?.hits ?? [])).toEqual([
      { text: "Round", hit: true },
      { text: " ", hit: false },
      { text: "1.3", hit: true },
      { text: " mm", hit: false },
    ]);
    // By text, by layer, by block, by kind, by group name; any case.
    expect(layout(tree(), view({ query: "YELLOW" })).rows.map((r) => r.label)).toEqual(["Notes › Text", "Text “18k yellow gold”"]);
    expect(layout(tree(), view({ query: "settings" })).rows.map((r) => r.label)).toEqual(["Piece", "Settings › Circles", "Circle ⌀ 0.8000"]);
    expect(layout(tree(), view({ query: "title" })).rows.map((r) => r.label)).toEqual(["Blocks", "Block TITLE"]);
    expect(layout(tree(), view({ query: "lwpolyline" })).matches).toBe(2);
    expect(layout(tree(), view({ query: "jewelry_piece" })).matches).toBe(8);
    expect(layout(tree(), view({ query: "sapphire" })).rows.map((r) => r.label)).toEqual(["Stones", "Oval 8×6 mm, sapphire"]);
    expect(layout(tree(), view({ query: "no such thing" })).rows).toEqual([]);
    expect(layout(tree(), view({ query: "   " })).rows.length).toBe(7);
  });

  test("a group closed by hand stays closed in a search", () => {
    const l = layout(tree(), view({ query: "round", collapsed: new Set([PIECE_ID]) }));
    expect(l.rows.map((r) => r.label)).toEqual(["Piece", "Stones", "Round 1.5 mm", "Stone 1", "Stone 2"]);
  });

  test("search words are bounded", () => {
    expect(searchTokens("  Round   1.3 ")).toEqual(["round", "1.3"]);
    expect(searchTokens(Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ")).length).toBe(8);
    expect(searchTokens("x".repeat(10_000))[0]?.length).toBe(64);
    expect(matchIndices("Round 1.3 mm", [])).toEqual([]);
    expect(matchIndices("aaa", ["aa"])).toEqual([0, 1, 2]);
    expect(matchIndices("née ✓ Round", ["round"])).toEqual([6, 7, 8, 9, 10]);
  });

  const big = (count: number): ObjectNode[] => buildTree(parseObjects({ objects: Array.from({ length: count }, (_, i) => ({ handle: (i + 1).toString(16), kind: "circle", layer: "Metal", size: `${i + 1}.0` })), total: count }));

  test("a long group shows its first rows and a row that shows more", () => {
    const t = big(180);
    const open = new Set(["layer/Metal/Circles"]);
    const first = layout(t, view({ expanded: open }));
    expect(first.rows.length).toBe(1 + CHILD_CAP + 1);
    const more = first.rows[first.rows.length - 1];
    expect([more?.kind, more?.label, more?.id, more?.parent, more?.level]).toEqual(["more", "Show 50 more of 130", moreId("layer/Metal/Circles"), "layer/Metal/Circles", 2]);
    const shown = showMore(showMore(new Map(), "layer/Metal/Circles"), "layer/Metal/Circles");
    const third = layout(t, view({ expanded: open, shown }));
    expect(third.rows.length).toBe(1 + 150 + 1);
    expect(third.rows[third.rows.length - 1]?.label).toBe("Show 30 more");
    expect(layout(t, view({ expanded: open, shown: showMore(shown, "layer/Metal/Circles") })).rows.length).toBe(181);
    expect(moreLabel(1)).toBe("Show 1 more");
    // A cap below the floor is the floor.
    expect(layout(t, view({ expanded: open, shown: new Map([["layer/Metal/Circles", -5]]) })).rows.length).toBe(1 + CHILD_CAP + 1);
  });

  test("the whole tree is held to its row cap, whatever is open and shown", () => {
    const t = big(5_000);
    const l = layout(t, view({ expanded: new Set(["layer/Metal/Circles"]), shown: new Map([["layer/Metal/Circles", 100_000]]) }));
    expect(l.rows.length).toBe(MAX_VISIBLE_ROWS);
    expect(l.cut).toBe(true);
    const searched = layout(t, view({ query: "circle", shown: new Map([["layer/Metal/Circles", 100_000]]) }));
    expect(searched.rows.length).toBe(MAX_VISIBLE_ROWS);
    expect(searched.matches).toBe(5_000);
  });

  test("the tree's own rows are capped too", () => {
    const layers = buildTree(parseObjects({ objects: Array.from({ length: 120 }, (_, i) => ({ handle: (i + 1).toString(16), kind: "line", layer: `L${String(i).padStart(3, "0")}` })), total: 120 }));
    const l = layout(layers, VIEW);
    expect(l.rows.length).toBe(CHILD_CAP + 1);
    expect(l.rows[CHILD_CAP]?.id).toBe(moreId(""));
    expect(layout(layers, view({ shown: showMore(new Map(), "") })).rows.length).toBe(101);
  });
});

describe("selection", () => {
  test("a row is current when every object of it is selected", () => {
    expect(selectedState(["1", "2"], new Set(["1", "2", "3"]))).toBe("all");
    expect(selectedState(["1", "2"], new Set(["2"]))).toBe("some");
    expect(selectedState(["1", "2"], new Set(["1"]))).toBe("some");
    expect(selectedState(["1", "2"], new Set(["9"]))).toBe("none");
    expect(selectedState([], new Set(["1"]))).toBe("none");
    expect(selectedState(["1"], new Set())).toBe("none");
    expect(selectedCount(["1", "2", "3"], new Set(["3", "1", "9"]))).toBe(2);
    expect(selectedCount(["1"], new Set())).toBe(0);
  });

  test("a press selects the row; a second lets go; Ctrl adds and takes out", () => {
    expect(pressSelection(["1", "2"], [], false)).toEqual(["1", "2"]);
    expect(pressSelection(["1", "2"], ["9"], false)).toEqual(["1", "2"]);
    expect(pressSelection(["1", "2"], ["2", "1"], false)).toEqual([]);
    expect(pressSelection(["1", "2"], ["9", "1"], true)).toEqual(["9", "1", "2"]);
    expect(pressSelection(["1", "2"], ["9", "1", "2"], true)).toEqual(["9"]);
    expect(pressSelection([], ["9"], false)).toEqual(["9"]);
    expect(pressSelection(Array.from({ length: 4_000 }, (_, i) => `a${i}`), Array.from({ length: 4_000 }, (_, i) => `b${i}`), true).length).toBe(MAX_OBJECTS);
  });

  test("a selection made on the drawing is found in the tree, with the way to it", () => {
    const t = tree();
    expect(revealTarget(t, new Set())).toBeNull();
    expect(revealTarget(t, new Set(["zz"]))).toBeNull();
    // One halo stone: its row, under its group, under the piece.
    expect(revealTarget(t, new Set(["13"]))).toEqual({ id: "o/13", open: [PIECE_ID, "piece/stones/GEM-ROUND-1.3"], shown: new Map() });
    // The whole group: the group's own row; it need not open.
    expect(revealTarget(t, new Set(["12", "13", "14"]))).toEqual({ id: "piece/stones/GEM-ROUND-1.3", open: [PIECE_ID], shown: new Map() });
    expect(revealTarget(t, new Set(t.flatMap((n) => n.handles)))?.id).toBe(PIECE_ID);
    expect(revealTarget(t, new Set(["31", "33"]))).toEqual({ id: "o/33", open: ["layer/0/Dimensions"], shown: new Map() });
  });

  test("a row past a group's cap raises the cap far enough", () => {
    const t = buildTree(parseObjects({ objects: Array.from({ length: 200 }, (_, i) => ({ handle: (i + 1).toString(16), kind: "circle", layer: "Metal", size: `${i}` })), total: 200 }));
    const reveal = revealTarget(t, new Set([(121).toString(16)]));
    expect(reveal?.id).toBe("o/79");
    expect(reveal?.shown).toEqual(new Map([["layer/Metal/Circles", 150]]));
    const l = layout(t, view({ expanded: new Set(reveal?.open), shown: reveal?.shown ?? new Map() }));
    expect(l.rows.some((r) => r.id === "o/79")).toBe(true);
  });
});

describe("the keyboard", () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}): { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean } => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  const rows = (): VisibleNode[] => layout(tree(), view({ expanded: new Set([PIECE_ID]) })).rows;

  test("Up and Down move and stop at the ends; Home and End go to them", () => {
    const r = rows();
    expect(treeKey(key("ArrowDown"), r, PIECE_ID)).toEqual({ type: "focus", id: "o/10" });
    expect(treeKey(key("ArrowUp"), r, "o/10")).toEqual({ type: "focus", id: PIECE_ID });
    expect(treeKey(key("ArrowUp"), r, PIECE_ID)).toBeNull();
    expect(treeKey(key("ArrowDown"), r, "layer/Notes/Text")).toBeNull();
    expect(treeKey(key("End"), r, PIECE_ID)).toEqual({ type: "focus", id: "layer/Notes/Text" });
    expect(treeKey(key("Home"), r, "layer/Notes/Text")).toEqual({ type: "focus", id: PIECE_ID });
    expect(treeKey(key("Home"), r, PIECE_ID)).toBeNull();
  });

  test("Right opens a group, then goes to its first child; Left closes it, or goes to the parent", () => {
    const r = rows();
    expect(treeKey(key("ArrowRight"), r, "stones")).toEqual({ type: "open", id: "stones" });
    expect(treeKey(key("ArrowRight"), r, PIECE_ID)).toEqual({ type: "focus", id: "o/10" });
    expect(treeKey(key("ArrowRight"), r, "o/10")).toBeNull();
    expect(treeKey(key("ArrowLeft"), r, PIECE_ID)).toEqual({ type: "close", id: PIECE_ID });
    expect(treeKey(key("ArrowLeft"), r, "o/10")).toEqual({ type: "focus", id: PIECE_ID });
    expect(treeKey(key("ArrowLeft"), r, "piece/layer/Metal/Polylines")).toEqual({ type: "focus", id: PIECE_ID });
    expect(treeKey(key("ArrowLeft"), r, "stones")).toBeNull();
  });

  test("Enter and Space select; with Ctrl or Cmd they add; on the more row they show more", () => {
    const r = rows();
    expect(treeKey(key("Enter"), r, "o/10")).toEqual({ type: "select", id: "o/10", additive: false });
    expect(treeKey(key(" "), r, "stones")).toEqual({ type: "select", id: "stones", additive: false });
    expect(treeKey(key("Enter", { ctrlKey: true }), r, "stones")).toEqual({ type: "select", id: "stones", additive: true });
    expect(treeKey(key(" ", { metaKey: true }), r, "stones")).toEqual({ type: "select", id: "stones", additive: true });
    const long = layout(buildTree(parseObjects({ objects: Array.from({ length: 60 }, (_, i) => ({ handle: (i + 1).toString(16), kind: "point", layer: "0" })), total: 60 })), view({ expanded: new Set(["layer/0/Points"]) })).rows;
    expect(treeKey(key("Enter"), long, moreId("layer/0/Points"))).toEqual({ type: "more", parent: "layer/0/Points" });
  });

  test("a letter jumps to the next row that starts with it, and round again", () => {
    const r = rows();
    expect(treeKey(key("s"), r, PIECE_ID)).toEqual({ type: "focus", id: "piece/layer/Settings/Circles" });
    expect(treeKey(key("S"), r, "piece/layer/Settings/Circles")).toEqual({ type: "focus", id: "stones" });
    expect(treeKey(key("b"), r, "bands")).toEqual({ type: "focus", id: "layer/0/Blocks" });
    expect(treeKey(key("z"), r, PIECE_ID)).toBeNull();
    expect(treeKey(key("s", { ctrlKey: true }), r, PIECE_ID)).toBeNull();
  });

  test("keys that are not the tree's, an empty tree and a lost row", () => {
    const r = rows();
    for (const k of ["Tab", "Escape", "F2", "PageDown", "Shift", "Dead"]) expect(treeKey(key(k), r, PIECE_ID)).toBeNull();
    expect(treeKey(key("ArrowDown", { altKey: true }), r, PIECE_ID)).toBeNull();
    expect(treeKey(key("ArrowDown"), [], null)).toBeNull();
    // A row that is gone (the drawing changed): the keyboard enters at the top.
    expect(treeKey(key("ArrowDown"), r, "o/gone")).toEqual({ type: "focus", id: PIECE_ID });
    expect(treeKey(key("ArrowUp"), r, null)).toEqual({ type: "focus", id: PIECE_ID });
  });
});
