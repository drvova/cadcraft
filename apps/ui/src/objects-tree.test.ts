import { describe, expect, test } from "bun:test";
import { buildTree, layout, parseObjects, revealTarget, withGroupOpen, withReveal, type ObjectList, type TreeView } from "./objects";

const VIEW: TreeView = { query: "", expanded: new Set(), collapsed: new Set(), shown: new Map() };

/** A piece with three stones of one size, two loose stones, a band and some drafting. */
const REPLY = {
  objects: [
    { handle: "10", kind: "insert", layer: "Metal", name: "RING-PIECE", group: ["JEWELRY_PIECE"] },
    { handle: "11", kind: "insert", layer: "Stones", name: "GEM-ROUND-6.5", group: ["JEWELRY_PIECE"] },
    { handle: "12", kind: "insert", layer: "Stones", name: "GEM-ROUND-1.3", group: ["JEWELRY_PIECE"] },
    { handle: "13", kind: "insert", layer: "Stones", name: "GEM-ROUND-1.3", group: ["JEWELRY_PIECE"] },
    { handle: "14", kind: "insert", layer: "Stones", name: "GEM-ROUND-1.3", group: ["JEWELRY_PIECE"] },
    { handle: "21", kind: "insert", layer: "Stones", name: "GEM-ROUND-1.5" },
    { handle: "22", kind: "insert", layer: "Stones", name: "GEM-ROUND-1.5" },
    { handle: "23", kind: "insert", layer: "0", name: "RING-16.51x2.4" },
    { handle: "30", kind: "text", layer: "Notes", text: "18k yellow gold" },
    { handle: "34", kind: "line", layer: "0", size: "5.0000" },
  ],
  total: 10,
  truncated: false,
  space: "Model",
};

const list = (): ObjectList => {
  const parsed = parseObjects(REPLY);
  if (parsed === null) throw new Error("the fixture did not parse");
  return parsed;
};

describe("opening, closing and showing a selection", () => {
  test("with no search a group is open by being named; under one it is closed by being named", () => {
    const none = { expanded: new Set<string>(), collapsed: new Set<string>() };
    const opened = withGroupOpen(none, false, "stones", true);
    expect([...opened.expanded]).toEqual(["stones"]);
    expect(opened.collapsed).toBe(none.collapsed);
    expect([...withGroupOpen(opened, false, "stones", false).expanded]).toEqual([]);
    const closed = withGroupOpen(none, true, "stones", false);
    expect([...closed.collapsed]).toEqual(["stones"]);
    expect(closed.expanded).toBe(none.expanded);
    expect([...withGroupOpen(closed, true, "stones", true).collapsed]).toEqual([]);
    // The sets handed in are never changed.
    expect(none.expanded.size + none.collapsed.size).toBe(0);
  });

  test("a selection made on the drawing opens the way to its row, and nothing more", () => {
    const tree = buildTree(list());
    const reveal = revealTarget(tree, new Set(["13"]));
    if (reveal === null) throw new Error("nothing to reveal");
    const expanded = new Set<string>();
    const shown = new Map<string, number>();
    const next = withReveal(reveal, expanded, shown);
    for (const id of reveal.open) expect(next.expanded.has(id)).toBe(true);
    expect(layout(tree, { ...VIEW, expanded: next.expanded, shown: next.shown }).rows.some((r) => r.id === reveal.id)).toBe(true);
    // Already open: the same sets come back, so nothing is drawn again.
    const again = withReveal(reveal, next.expanded, next.shown);
    expect(again.expanded).toBe(next.expanded);
    if (reveal.shown.size === 0) expect(again.shown).toBe(next.shown);
    expect(expanded.size).toBe(0);
  });
});
