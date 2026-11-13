import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ICON_PATHS } from "../icons";
import {
  buildTree,
  layout,
  MAX_QUERY_CHARS,
  MAX_VISIBLE_ROWS,
  moreId,
  panelListed,
  panelNotes,
  panelSummary,
  parseObjects,
  PIECE_ID,
  revealTarget,
  rowName,
  rowTally,
  withGroupOpen,
  withReveal,
  type ObjectList,
  type TreeView,
  type VisibleNode,
} from "../objects";
import { MAX_PARAM_TEXT } from "./bench-params";
import {
  DEFAULT_STEP,
  itemOfKey,
  MAX_KEY_CHARS,
  MAX_ORDERED,
  MAX_RUNS,
  naturalHeight,
  objectRowParams,
  objectsPanelParams,
  onTwist,
  pressMeta,
  queryText,
  readingOrder,
  rowOfKey,
} from "./objects-params";

const ui = join(import.meta.dir, "..", "..");
const source = readFileSync(join(ui, "slab", "objects.slab"), "utf8");
const host = readFileSync(join(ui, "src", "slab", "SlabObjects.tsx"), "utf8");

const EACH = "#panel/#body/#tree/rows";
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
const drawn = (over: Partial<TreeView> = {}): ReturnType<typeof layout> => layout(buildTree(list()), { ...VIEW, ...over });

/** A drawing of `n` loose lines, as the engine lists it. */
const lines = (n: number): ObjectList => {
  const parsed = parseObjects({ objects: Array.from({ length: n }, (_, i) => ({ handle: (i + 100).toString(16), kind: "line", layer: `L${i % 40}`, size: "1.0" })), total: n, truncated: false, space: "Model" });
  if (parsed === null) throw new Error("the fixture did not parse");
  return parsed;
};

describe("the objects panel's rows", () => {
  test("a row per visible node, in reading order, keyed by the node's id, with the words the SolidJS panel says", () => {
    const view = drawn({ expanded: new Set([PIECE_ID]) });
    const keyed = objectRowParams(view.rows, new Set());
    expect(keyed.params.map((r) => r.key)).toEqual(view.rows.map((r) => r.id));
    for (const [at, node] of view.rows.entries()) {
      const row = keyed.params[at];
      expect(row?.name).toBe(rowName(node, 0));
      expect(row?.tally).toBe(rowTally(node, 0));
      expect(row?.group).toBe(node.kind === "group");
      expect(row?.opened).toBe(node.kind === "group" && node.open);
      expect([row?.depth, row?.place, row?.total]).toEqual([node.level, node.position, node.siblings]);
      expect(row?.indent).toBe((node.level - 1) * DEFAULT_STEP);
      expect(row?.runs.map((run) => run.t).join("")).toBe(node.label);
      expect(keyed.index.get(node.id)).toBe(at);
    }
    // The piece is open: a row of the second level is there, stepped in once.
    expect(keyed.params.some((r) => r.depth === 2 && r.indent === DEFAULT_STEP)).toBe(true);
  });

  test("the selection on the drawing marks whole rows and counts part of a group", () => {
    const view = drawn({ expanded: new Set([PIECE_ID]) });
    const piece = view.rows.find((r) => r.id === PIECE_ID);
    if (piece === undefined) throw new Error("no piece row");
    const all = objectRowParams(view.rows, new Set(piece.handles)).params[view.rows.indexOf(piece)];
    expect(all?.current).toBe(true);
    expect(all?.tally).toBe(String(piece.count));
    const part = objectRowParams(view.rows, new Set(["12", "13"])).params[view.rows.indexOf(piece)];
    expect(part?.current).toBe(false);
    expect(part?.tally).toBe(`2/${piece.count}`);
    expect(part?.name).toContain("2 selected");
  });

  test("a search's matches are runs of the name; the name is whole when read end to end", () => {
    const view = drawn({ query: "round 1.3" });
    const keyed = objectRowParams(view.rows, new Set());
    const hit = keyed.params.find((r) => r.runs.some((run) => run.hit));
    expect(hit).toBeDefined();
    expect(hit?.runs.filter((run) => run.hit).map((run) => run.t.toLowerCase()).join(" ")).toContain("round");
    for (const [at, row] of keyed.params.entries()) expect(row.runs.map((run) => run.t).join("")).toBe(view.rows[at]?.label ?? "");
  });

  test("the row that shows more of a long group is a row of its own, in the accent", () => {
    const view = layout(buildTree(lines(4000)), { ...VIEW, expanded: new Set(["layer/L0/Lines"]) });
    const keyed = objectRowParams(view.rows, new Set());
    const more = keyed.params.filter((r) => r.more);
    expect(more.map((r) => r.key)).toEqual([moreId("layer/L0/Lines")]);
    expect([more[0]?.group, more[0]?.current, more[0]?.tally]).toEqual([false, false, ""]);
    expect(rowOfKey(view, keyed, moreId("layer/L0/Lines"))?.kind).toBe("more");
  });

  test("a step that is not a sane length is the default's place, never a hostile number", () => {
    const view = drawn({ expanded: new Set([PIECE_ID]) });
    for (const step of [Number.NaN, Number.POSITIVE_INFINITY, -5, 1e9]) {
      const rows = objectRowParams(view.rows, new Set(), step).params;
      expect(rows.every((r) => Number.isFinite(r.indent) && r.indent >= 0 && r.indent <= 64 * 16)).toBe(true);
    }
  });

  test("hostile nodes never reach the kernel raw", () => {
    const node = (over: Partial<VisibleNode>): VisibleNode => ({ id: "x", kind: "object", label: "x", level: 1, position: 1, siblings: 1, count: 1, handles: ["1"], open: false, hits: [], ...over }) as VisibleNode;
    const long = "n".repeat(5000);
    const rows = objectRowParams(
      [
        node({ id: "a\nb", label: "two\nlines\u2028here" }),
        node({ id: long, label: long }),
        node({ id: long, label: "same long id" }),
        node({ id: "", label: "" }),
        node({ id: "lvl", level: Number.NaN, position: -3, siblings: Number.POSITIVE_INFINITY }),
        node({ id: "hits", label: "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijkl", hits: Array.from({ length: 32 }, (_, i) => i * 2) }),
      ],
      new Set(["1"]),
    );
    const keys = rows.params.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.length > 0 && k.length <= MAX_KEY_CHARS + 16)).toBe(true);
    for (const row of rows.params) {
      expect(row.name.length).toBeLessThanOrEqual(MAX_PARAM_TEXT);
      expect(row.runs.length).toBeLessThanOrEqual(MAX_RUNS);
      expect(row.runs.every((run) => !/[\n\r\u2028\u2029]/.test(run.t))).toBe(true);
      expect([row.depth, row.place, row.total].every((n) => Number.isSafeInteger(n) && n >= 1)).toBe(true);
      expect(row.place).toBeLessThanOrEqual(row.total);
    }
    expect(rows.params[5]?.runs.length).toBe(MAX_RUNS);
    expect(rows.params[5]?.runs.map((run) => run.t).join("")).toBe("abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijkl");
  });
});

describe("a drawing of thousands", () => {
  test("the rows handed to the kernel are capped whatever is open, and the panel says so", () => {
    const big = lines(4000);
    const tree = buildTree(big);
    const every = new Set<string>();
    const walk = (nodes: ReturnType<typeof buildTree>): void => {
      for (const n of nodes) {
        every.add(n.id);
        walk(n.children);
      }
    };
    walk(tree);
    const shown = new Map([...every].map((id) => [id, 100_000] as const));
    const view = layout(tree, { ...VIEW, expanded: every, shown });
    const keyed = objectRowParams(view.rows, new Set(big.rows.map((r) => r.handle)));
    expect(view.rows.length).toBeLessThanOrEqual(MAX_VISIBLE_ROWS);
    expect(keyed.params.length).toBeLessThanOrEqual(MAX_VISIBLE_ROWS);
    expect(view.cut).toBe(true);
    expect(panelNotes(big, true, view, "")).toContain("More rows are open than the list shows. Search to narrow it.");
    // More rows than the cap, handed over directly, are still cut.
    const flood = Array.from({ length: MAX_VISIBLE_ROWS * 3 }, (_, i): VisibleNode => ({ ...(view.rows[0] as VisibleNode), id: `f${i}` }));
    expect(objectRowParams(flood, new Set()).params.length).toBe(MAX_VISIBLE_ROWS);
  });

  test("the section's height is the heading, the search, the capped rows and the lines under", () => {
    const parts = { head: 25, search: 30, notes: 0, rowHeight: 22, pad: 2 };
    expect(naturalHeight({ ...parts, rows: 7 })).toBe(25 + 30 + 7 * 22 + 4);
    expect(naturalHeight({ ...parts, rows: 0, notes: 26 })).toBe(25 + 30 + 26);
    expect(naturalHeight({ ...parts, rows: 1e9 })).toBe(25 + 30 + MAX_VISIBLE_ROWS * 22 + 4);
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const h = naturalHeight({ head: bad, search: bad, notes: bad, rows: bad, rowHeight: bad, pad: bad });
      expect(Number.isFinite(h) && h >= 0).toBe(true);
    }
    expect(naturalHeight({ ...parts, rows: 3, rowHeight: 1e6 })).toBeLessThanOrEqual(25 + 30 + 3 * 64 + 4);
  });
});

describe("the panel's params", () => {
  const rows = objectRowParams(drawn().rows, new Set()).params;

  test("open over a list: the search and the tree show", () => {
    const p = objectsPanelParams({ summary: "10 objects", open: true, listed: true, notes: [], rows });
    expect([p.open, p.listed, p.filled]).toEqual([true, true, true]);
    expect(p.rows).toBe(rows);
    expect(p.summary).toBe("10 objects");
  });

  test("a search that found nothing keeps the search and gives the tree's room up", () => {
    const p = objectsPanelParams({ summary: "0 of 10", open: true, listed: true, notes: ["Nothing matches “zz”."], rows: [] });
    expect([p.listed, p.filled]).toEqual([true, false]);
    expect(p.notes).toEqual([{ key: "note-0", note: "Nothing matches “zz”." }]);
  });

  test("a folded section hands over its heading alone; an empty drawing its one line", () => {
    const folded = objectsPanelParams({ summary: "10 objects", open: false, listed: true, notes: ["x"], rows });
    expect([folded.open, folded.listed, folded.filled, folded.rows.length, folded.notes.length]).toEqual([false, false, false, 0, 0]);
    expect(folded.summary).toBe("10 objects");
    const empty = objectsPanelParams({ summary: "", open: true, listed: false, notes: ["Nothing drawn yet."], rows });
    expect([empty.listed, empty.filled, empty.rows.length]).toEqual([false, false, 0]);
    expect(empty.notes.map((n) => n.note)).toEqual(["Nothing drawn yet."]);
  });

  test("the lines under the tree are capped and cleaned", () => {
    const p = objectsPanelParams({ summary: "a\nb", open: true, listed: true, notes: Array.from({ length: 50 }, (_, i) => `note\n${i}`), rows });
    expect(p.notes.length).toBe(8);
    expect(p.notes.every((n) => !n.note.includes("\n"))).toBe(true);
    expect(p.summary).toBe("a b");
  });

  test("the words are the shared ones (src/objects.ts), not a copy", () => {
    const l = list();
    const view = drawn({ query: "round" });
    expect(panelSummary(l, true, "", 0)).toBe("10 objects");
    expect(panelSummary(l, true, "round", view.matches)).toBe(`${view.matches} of 10`);
    expect(panelSummary(null, true, "", 0)).toBe("");
    expect(panelNotes(l, false, view, "")).toEqual(["The object list is not in this build."]);
    expect(panelNotes(null, true, view, "")).toEqual(["The objects could not be listed."]);
    expect(panelNotes(l, true, drawn({ query: "zzzz" }), " zzzz ")).toEqual(["Nothing matches “zzzz”."]);
    expect(panelListed(l, true)).toBe(true);
    expect(panelListed(l, false)).toBe(false);
    expect(panelListed(null, true)).toBe(false);
    // Neither panel keeps words of its own: both files call the shared functions.
    const solid = readFileSync(join(ui, "src", "components", "ObjectsPanel.tsx"), "utf8");
    for (const name of ["panelSummary", "panelNotes", "panelListed", "withGroupOpen", "withReveal", "treeKey", "pressSelection", "revealTarget", "layout", "buildTree"]) {
      expect(solid.includes(`${name}(`)).toBe(true);
      expect(host.includes(`${name}(`)).toBe(true);
    }
    expect(host.includes("<ObjectsSearch")).toBe(true);
    expect(solid.includes("<ObjectsSearch")).toBe(true);
  });
});

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

describe("what the kernel says back", () => {
  test("a focused or pressed key names an item of the list, with the kernel's escapes undone", () => {
    expect(itemOfKey(`${EACH}~stones/row@0`, EACH)).toBe("stones");
    expect(itemOfKey(`${EACH}~stones%2FGEM-ROUND-1.5/row@0/#twist`, EACH)).toBe("stones/GEM-ROUND-1.5");
    expect(itemOfKey(`${EACH}~a%7Eb%25c%2Fd`, EACH)).toBe("a~b%c/d");
    for (const bad of ["", "#panel/#head/#fold", `${EACH}`, `${EACH}~`, `${EACH}~/row@0`, `#other/rows~x/row@0`, `${EACH}~${"k".repeat(MAX_KEY_CHARS * 5)}`]) expect(itemOfKey(bad, EACH)).toBeNull();
  });

  test("a press is on the twist only inside the row's twist cell", () => {
    expect(onTwist(`${EACH}~stones/row@0/#twist`, EACH)).toBe(true);
    expect(onTwist(`${EACH}~stones/row@0/#twist/icon@0`, EACH)).toBe(true);
    expect(onTwist(`${EACH}~stones/row@0/para@0`, EACH)).toBe(false);
    expect(onTwist(`${EACH}~stones/row@0`, EACH)).toBe(false);
    // A row whose own id says "#twist" is not its twist: the id is escaped in the key.
    expect(onTwist(`${EACH}~%23twist/row@0/para@0`, EACH)).toBe(false);
    expect(onTwist("#panel/#head/#twist", EACH)).toBe(false);
    expect(onTwist("", EACH)).toBe(false);
  });

  test("a signal's meta is read with checks: where the pointer was, and Ctrl or Cmd", () => {
    const signal = (detail: unknown): Event => new CustomEvent("row_pressed", { detail });
    expect(pressMeta(signal({ meta: { hit_key: "k", mods: 4 } }))).toEqual({ hitKey: "k", additive: true });
    expect(pressMeta(signal({ meta: { hit_key: "k", mods: 8 } })).additive).toBe(true);
    expect(pressMeta(signal({ meta: { hit_key: "k", mods: 1 } })).additive).toBe(false);
    expect(pressMeta(signal({ meta: { hit_key: "k", mods: 3 } })).additive).toBe(false);
    for (const bad of [null, 3, "x", {}, { meta: null }, { meta: 7 }, { meta: { hit_key: 5, mods: "4" } }, { meta: { mods: Number.NaN } }]) expect(pressMeta(signal(bad))).toEqual({ hitKey: "", additive: false });
    expect(pressMeta(new Event("row_pressed"))).toEqual({ hitKey: "", additive: false });
  });

  test("a key names the layout's row; a stale or forged one names none", () => {
    const view = drawn();
    const keyed = objectRowParams(view.rows, new Set());
    const first = view.rows[0];
    expect(rowOfKey(view, keyed, first?.id ?? "")).toBe(first ?? null);
    for (const bad of [null, "", "nope", "__proto__", "constructor"]) expect(rowOfKey(view, keyed, bad)).toBeNull();
    // The list moved on since the key was made: a place past its end names nothing.
    expect(rowOfKey(drawn({ query: "zzzz" }), keyed, first?.id ?? "")).toBeNull();
  });

  test("the search's text is one capped line", () => {
    expect(queryText("round 1.3")).toBe("round 1.3");
    expect(queryText("two\nlines\ttabbed")).toBe("two lines tabbed");
    expect(queryText("x".repeat(5000)).length).toBe(MAX_QUERY_CHARS);
    // Counted in characters, so a pair is never cut in half.
    expect(queryText("😀".repeat(300))).toBe("😀".repeat(MAX_QUERY_CHARS));
  });
});

describe("the tree for a screen reader", () => {
  test("rows already in reading order are left alone", () => {
    expect(readingOrder([0, 22, 44, 66])).toBeNull();
    expect(readingOrder([5, 5, 5])).toBeNull();
    expect(readingOrder([])).toBeNull();
    expect(readingOrder([10])).toBeNull();
  });

  test("rows the driver appended out of place are put back, top first, ties as they were", () => {
    // Seven rows, then a group's three appended after them though they stand under the first.
    expect(readingOrder([0, 88, 110, 22, 44, 66])).toEqual([0, 3, 4, 5, 1, 2]);
    expect(readingOrder([22, 0, 22, 0])).toEqual([1, 3, 0, 2]);
  });

  test("what is not a list's window is not touched", () => {
    expect(readingOrder([0, Number.NaN, 5])).toBeNull();
    expect(readingOrder([3, Number.POSITIVE_INFINITY, 1])).toBeNull();
    expect(readingOrder(Array.from({ length: MAX_ORDERED + 1 }, (_, i) => MAX_ORDERED - i))).toBeNull();
    expect(readingOrder(Array.from({ length: MAX_ORDERED }, (_, i) => MAX_ORDERED - i))?.length).toBe(MAX_ORDERED);
  });
});

describe("the document", () => {
  test("it defines the element the loader waits for, and binds exactly the signals the host handles", () => {
    // (The loader itself is Vite's to load: it is read here, not imported.)
    expect(readFileSync(join(ui, "src", "slab", "loader.ts"), "utf8").includes('objects: "cadcraft-objects"')).toBe(true);
    expect(host.includes("<cadcraft-objects")).toBe(true);
    const bound = new Set([...source.matchAll(/\bact=([a-z_]+)/g)].map((m) => m[1] ?? ""));
    const handled = /attachSurface\(host, \[([^\]]*)\]/.exec(host)?.[1] ?? "";
    expect([...bound].sort()).toEqual([...handled.matchAll(/"([a-z_]+)"/g)].map((m) => m[1] ?? "").sort());
    expect([...bound].sort()).toEqual(["fold", "row_pressed"]);
  });

  test("the keys the host reads are the document's", () => {
    for (const id of ["#panel", "#edge", "#head", "#fold", "#body", "#search", "#tree", "#notes", "#twist"]) expect(source.includes(` ${id} `)).toBe(true);
    expect(/each param\.rows key=rows virtual item-extent=22/.test(source)).toBe(true);
    expect(host.includes('const TREE = "#panel/#body/#tree";')).toBe(true);
    // The search is the page's own field, in a hole; the kernel edits no text here.
    expect(/\bhole search\b/.test(source)).toBe(true);
    expect(/\bfield=/.test(source)).toBe(false);
    expect(host.includes('slot="search"')).toBe(true);
  });

  test("the tree says what a tree must: role, level, place, set size, selected, expanded", () => {
    expect(/role=tree label="Objects"/.test(source)).toBe(true);
    for (const attr of ["role=treeitem", "label=name", "level=depth", "pos-in-set=place", "set-size=total", "selected=current", "expanded=opened"]) expect(source.includes(attr)).toBe(true);
    expect(host.includes('"aria-multiselectable"')).toBe(true);
  });

  test("the glyphs are the interface's own paths, character for character", () => {
    const drawnIcons = new Map([...source.matchAll(/^icon ([a-z-]+) viewbox=24 \{\s*path "([^"]+)"/gm)].map((m) => [m[1] ?? "", m[2] ?? ""]));
    const ids: Record<string, string> = { chevron: "chevron-down", twist: "chevron-right" };
    expect([...drawnIcons.keys()].sort()).toEqual(Object.keys(ids).sort());
    for (const [name, id] of Object.entries(ids)) expect(drawnIcons.get(name)).toBe(ICON_PATHS[id] ?? "missing");
  });

  test("every colour and measure is a token of the bridge, and no font is named", () => {
    expect(source.includes('import "gen/tokens.slab"')).toBe(true);
    const code = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(/#[0-9a-fA-F]{3,8}\b/.test(code.replace(/#[a-z][a-z-]*/g, ""))).toBe(false);
    expect(/\b(rgb|rgba|oklch|hsl)\(/.test(code)).toBe(false);
    expect(/\bfamily\s*=/.test(code)).toBe(false);
    for (const m of code.matchAll(/\b(?:bg|color|stroke|scrollbar-fg|scrollbar-bg)=([^\s{]+)/g)) expect(/^(color\.[a-z-]+|none|current)$/.test(m[1] ?? "")).toBe(true);
  });

  test("the standard shell names no Slab module: the panel arrives as a part", () => {
    const app = readFileSync(join(ui, "src", "app.tsx"), "utf8");
    expect(/from "\.\/slab\/(?!parts")/.test(app)).toBe(false);
    expect(/import type \{[^}]*\} from "\.\/slab\/parts"/.test(app)).toBe(true);
    expect(app.includes("props.slab?.Objects ?? ObjectsPanel")).toBe(true);
    const main = readFileSync(join(ui, "src", "main.tsx"), "utf8");
    expect(main.includes('await import("./slab/SlabObjects")')).toBe(true);
    expect(/^import .*SlabObjects/m.test(main)).toBe(false);
  });
});
