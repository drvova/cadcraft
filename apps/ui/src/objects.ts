/**
 * The drawing as a list of things, for the sidebar's Objects section: the engine's `objects`
 * reply read with checked narrowing, arranged as the tree a jeweler reads (the piece and its
 * parts, the stones by cut and size, the bands, then everything else by layer and kind), filtered
 * by what is typed, laid out under the caps that keep a big drawing's list short, and walked by
 * the keyboard. Nothing is measured here: a size is the engine's own text.
 *
 * No DOM: `components/ObjectsPanel.tsx` draws what `layout` returns and acts on what `treeKey`
 * and `pressSelection` say.
 */

import { asBool, asNumber, asString, isRecord } from "./json";
import { trim } from "./bench";
import { isTypeaheadKey, typeaheadIndex, type TypedKey } from "./roving";

// ---- The reply ----

/** One object of the space, as the engine lists it. */
export interface ObjectRow {
  handle: string;
  /** The engine's kind name: `line`, `lwpolyline`, `insert`, `text`… */
  kind: string;
  layer: string;
  /** A block reference's block; empty otherwise. */
  name: string;
  /** A text's first words; empty otherwise. */
  text: string;
  /** One measurement, already written in the drawing's units; empty when the engine gave none. */
  size: string;
  /** The groups the object belongs to. */
  groups: string[];
}

export interface ObjectList {
  rows: ObjectRow[];
  /** How many objects the space holds (the rows may be fewer). */
  total: number;
  truncated: boolean;
  space: string;
}

/** The most objects of a reply that are read (the engine's own cap). */
export const MAX_OBJECTS = 5_000;
/** The objects the shell asks the engine for. */
export const OBJECTS_LIMIT = 2_000;
/** The most children of one group drawn before a "Show more" row, and how many each press adds. */
export const CHILD_CAP = 50;
/** The most rows the tree draws at once, whatever is open. */
export const MAX_VISIBLE_ROWS = 300;
/** The most words of a search that are matched, and the most characters of each. */
const MAX_TOKENS = 8;
const MAX_TOKEN_CHARS = 64;

const MAX_KIND_CHARS = 32;
const MAX_LAYER_CHARS = 128;
const MAX_NAME_CHARS = 64;
const MAX_TEXT_CHARS = 80;
const MAX_SIZE_CHARS = 24;
const MAX_GROUPS = 8;

/** The group a parametric piece is kept as (`docs/jewelry.md`). */
export const PIECE_GROUP = "JEWELRY_PIECE";

/** An object handle as the engine writes it: hexadecimal, at most sixteen digits. */
const HANDLE_RE = /^[0-9A-Fa-f]{1,16}$/;

/** A string field clipped to `max` characters with control characters taken out; empty when it is not a string. */
function clipped(value: unknown, max: number): string {
  const text = asString(value);
  if (text === null) return "";
  return [...text.slice(0, max * 4).replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")].slice(0, max).join("").trim();
}

function parseRow(value: unknown): ObjectRow | null {
  if (!isRecord(value)) return null;
  const handle = asString(value["handle"]);
  const kind = clipped(value["kind"], MAX_KIND_CHARS).toLowerCase();
  if (handle === null || !HANDLE_RE.test(handle) || kind === "") return null;
  const groups: string[] = [];
  if (Array.isArray(value["group"])) {
    for (const item of value["group"].slice(0, MAX_GROUPS)) {
      const name = clipped(item, MAX_NAME_CHARS);
      if (name !== "") groups.push(name);
    }
  }
  return {
    handle,
    kind,
    layer: clipped(value["layer"], MAX_LAYER_CHARS) || "0",
    name: clipped(value["name"], MAX_NAME_CHARS),
    text: clipped(value["text"], MAX_TEXT_CHARS),
    size: clipped(value["size"], MAX_SIZE_CHARS),
    groups,
  };
}

/** Read an `objects` reply; null when it is not one. Malformed rows and repeated handles are dropped. */
export function parseObjects(result: unknown): ObjectList | null {
  if (!isRecord(result) || !Array.isArray(result["objects"])) return null;
  const rows: ObjectRow[] = [];
  const seen = new Set<string>();
  for (const item of result["objects"].slice(0, MAX_OBJECTS)) {
    const row = parseRow(item);
    if (row === null || seen.has(row.handle)) continue;
    seen.add(row.handle);
    rows.push(row);
  }
  const said = asNumber(result["total"]);
  const total = Math.max(rows.length, said === null ? 0 : Math.min(Math.round(said), Number.MAX_SAFE_INTEGER));
  return {
    rows,
    total,
    truncated: asBool(result["truncated"]) === true || total > rows.length || result["objects"].length > MAX_OBJECTS,
    space: clipped(result["space"], MAX_NAME_CHARS) || "Model",
  };
}

/** The heading's summary: how many objects the space holds; empty when there is no list. */
export function objectsSummary(list: ObjectList | null): string {
  if (list === null) return "";
  const total = list.total.toLocaleString("en-US");
  if (list.truncated && list.rows.length < list.total) return `${list.rows.length.toLocaleString("en-US")} of ${total}`;
  return list.total === 1 ? "1 object" : `${total} objects`;
}

// ---- Names ----

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** A kind as a jeweler reads it: one of them, and several. */
const KIND_LABELS: Readonly<Record<string, readonly [string, string]>> = {
  line: ["Line", "Lines"],
  lwpolyline: ["Polyline", "Polylines"],
  polyline: ["Polyline", "Polylines"],
  circle: ["Circle", "Circles"],
  arc: ["Arc", "Arcs"],
  ellipse: ["Ellipse", "Ellipses"],
  spline: ["Spline", "Splines"],
  helix: ["Helix", "Helixes"],
  point: ["Point", "Points"],
  ray: ["Ray", "Rays"],
  xline: ["Construction line", "Construction lines"],
  text: ["Text", "Text"],
  mtext: ["Text", "Text"],
  attdef: ["Attribute", "Attributes"],
  insert: ["Block", "Blocks"],
  dimension: ["Dimension", "Dimensions"],
  leader: ["Leader", "Leaders"],
  multileader: ["Leader", "Leaders"],
  mline: ["Multiline", "Multilines"],
  hatch: ["Hatch", "Hatches"],
  solid: ["Solid", "Solids"],
  trace: ["Trace", "Traces"],
  "3dface": ["Face", "Faces"],
  region: ["Region", "Regions"],
  viewport: ["Viewport", "Viewports"],
  image: ["Image", "Images"],
  wipeout: ["Wipeout", "Wipeouts"],
  acad_table: ["Table", "Tables"],
  tolerance: ["Tolerance", "Tolerances"],
};

/** A kind's name, one of them ("Polyline"); a kind this list does not know keeps its own name. */
export function kindLabel(kind: string): string {
  return Object.hasOwn(KIND_LABELS, kind) ? (KIND_LABELS[kind]?.[0] ?? kind) : capital(kind.replace(/_/g, " "));
}

/** A kind's name, several of them ("Polylines", "Text"). */
export function kindPlural(kind: string): string {
  return Object.hasOwn(KIND_LABELS, kind) ? (KIND_LABELS[kind]?.[1] ?? kind) : `${capital(kind.replace(/_/g, " "))} objects`;
}

/** What a `GEM-…` block name says: the cut and size as the bench sheet writes them, and how big. */
export interface StoneName {
  label: string;
  /** Length × width in square millimetres, to put the big stones first; 0 when the name gives no size. */
  area: number;
}

const SIZE_RE = /^(\d{1,4}(?:\.\d{1,4})?)(?:[xX×](\d{1,4}(?:\.\d{1,4})?))?$/;

/**
 * A stone's block name read back (`GEM-<CUT>-<SIZE>` and then the material, the specific gravity
 * and the depth when they are not the default; `docs/jewelry.md`); null when the name is not a
 * stone's. A name with no size keeps what it says ("GEM-CUSTOM" is "Custom").
 */
export function stoneName(block: string): StoneName | null {
  if (!/^GEM-./i.test(block)) return null;
  const parts = block.slice(4).split("-").filter((part) => part !== "");
  const at = parts.findIndex((part) => SIZE_RE.test(part));
  const words = (list: readonly string[]): string => list.join(" ").toLowerCase();
  if (at < 0) return { label: capital(words(parts)) || "Stone", area: 0 };
  const size = SIZE_RE.exec(parts[at] ?? "");
  const first = Number(size?.[1] ?? 0);
  const second = size?.[2] === undefined ? first : Number(size[2]);
  const cut = at === 0 ? "stone" : words(parts.slice(0, at));
  const mm = second === first ? `${trim(first, 2)} mm` : `${trim(first, 2)}×${trim(second, 2)} mm`;
  const extras: string[] = [];
  for (const part of parts.slice(at + 1)) {
    const sg = /^SG(\d+(?:\.\d+)?)$/i.exec(part);
    const depth = /^D(\d+(?:\.\d+)?)$/i.exec(part);
    if (sg !== null) extras.push(`SG ${sg[1]}`);
    else if (depth !== null) extras.push(`depth ${depth[1]} mm`);
    else extras.push(part.toLowerCase());
  }
  return { label: `${capital(cut)} ${mm}${extras.length > 0 ? `, ${extras.join(", ")}` : ""}`, area: first * second };
}

/** Whether a block is a band's (`RING-…`). */
export function isBandBlock(block: string): boolean {
  return /^RING-/i.test(block);
}

/** A band as its block names it: "Band 16.51×2.4 mm" from `RING-16.51x2.4`, "Band" otherwise. */
export function bandName(block: string): string {
  const size = /^RING-(\d{1,4}(?:\.\d{1,4})?)[xX](\d{1,4}(?:\.\d{1,4})?)$/.exec(block);
  return size === null ? "Band" : `Band ${trim(Number(size[1]), 2)}×${trim(Number(size[2]), 2)} mm`;
}

/** An object named by its kind and its most telling fact; `null` fact when it has none. */
function leafName(row: ObjectRow): { label: string; told: boolean } {
  const kind = kindLabel(row.kind);
  if (row.kind === "insert" && row.name !== "") {
    const stone = stoneName(row.name);
    if (stone !== null) return { label: stone.label, told: true };
    if (isBandBlock(row.name)) return { label: bandName(row.name), told: true };
    return { label: `${kind} ${row.name}`, told: true };
  }
  if (row.text !== "") return { label: `${kind} “${row.text}”`, told: true };
  if (row.size !== "") {
    const mark = row.kind === "circle" ? "⌀ " : row.kind === "arc" ? "R " : "";
    return { label: `${kind} ${mark}${row.size}`, told: true };
  }
  return { label: kind, told: false };
}

// ---- The tree ----

/** A row of the tree: a group of objects, or one object. */
export interface ObjectNode {
  /** Stable while the drawing keeps the same things: what is open and where the keyboard is are kept by it. */
  id: string;
  label: string;
  /** Every object under the node (itself, for a leaf): what a press selects. */
  handles: string[];
  /** Empty for one object. */
  children: ObjectNode[];
  /** A leaf's search text, lower case: its name, kind, layer, block, text, groups and the names of the groups above it. */
  hay: string;
}

/** Lower case, one character at a time, so a match's place in the text is its place in the lowered text. */
function lower(text: string): string {
  let out = "";
  for (const ch of text) {
    const low = ch.toLowerCase();
    out += [...low].length === 1 ? low : ch;
  }
  return out;
}

function leaf(row: ObjectRow, label: string, above: readonly string[]): ObjectNode {
  const hay = lower([label, kindLabel(row.kind), kindPlural(row.kind), row.kind, row.layer, row.name, row.text, ...row.groups, ...above].join("\n"));
  return { id: `o/${row.handle}`, label, handles: [row.handle], children: [], hay };
}

function group(id: string, label: string, children: ObjectNode[]): ObjectNode {
  const handles: string[] = [];
  for (const child of children) for (const handle of child.handles) handles.push(handle);
  return { id, label, handles, children, hay: "" };
}

/** Leaves named by kind and fact; the ones with no fact are numbered so two never read alike. */
function leaves(rows: readonly ObjectRow[], above: readonly string[]): ObjectNode[] {
  let plain = 0;
  const names = rows.map((row) => leafName(row));
  const numbered = names.filter((name) => !name.told).length > 1;
  return rows.map((row, i) => {
    const name = names[i];
    const told = name?.told === true;
    if (!told) plain++;
    return leaf(row, told || !numbered ? (name?.label ?? kindLabel(row.kind)) : `${name?.label ?? ""} ${plain}`, above);
  });
}

/** Rows gathered under a key, in the order the keys were first met. */
function gather<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list === undefined) out.set(k, [row]);
    else list.push(row);
  }
  return out;
}

const isStone = (row: ObjectRow): boolean => row.kind === "insert" && stoneName(row.name) !== null;
const isBand = (row: ObjectRow): boolean => row.kind === "insert" && isBandBlock(row.name);

/** Stones by block (two stones share a block exactly when they are interchangeable), the big ones first. */
function stoneGroups(rows: readonly ObjectRow[], prefix: string, above: readonly string[]): ObjectNode[] {
  const byBlock = [...gather(rows, (row) => row.name.toUpperCase())].map(([block, stones]) => ({ block, stones, name: stoneName(block) ?? { label: "Stone", area: 0 } }));
  byBlock.sort((a, b) => b.name.area - a.name.area);
  return byBlock.map(({ block, stones, name }) => {
    const only = stones[0];
    // One stone of its kind is its own row; several open to "Stone 1", "Stone 2"…
    if (stones.length === 1 && only !== undefined) return leaf(only, name.label, above);
    const up = [...above, name.label];
    return group(`${prefix}/${block}`, name.label, stones.map((stone, i) => leaf(stone, `Stone ${i + 1}`, up)));
  });
}

/** The label of a layer's objects of one kind: "Metal › Polylines"; layer 0 is nobody's layer and is not named. */
function layerKindLabel(layer: string, plural: string): string {
  return layer === "0" || layer.toLowerCase() === plural.toLowerCase() ? plural : `${layer} › ${plural}`;
}

/** Everything that is neither a stone nor a band, by layer and then by kind. */
function layerGroups(rows: readonly ObjectRow[], prefix: string, above: readonly string[]): ObjectNode[] {
  const keyed = [...gather(rows, (row) => `${row.layer}\n${kindPlural(row.kind)}`)].map(([key, members]) => {
    const [layer = "0", plural = ""] = key.split("\n");
    return { key, layer, plural, members };
  });
  keyed.sort((a, b) => a.layer.localeCompare(b.layer, "en") || a.plural.localeCompare(b.plural, "en"));
  return keyed.map(({ key, layer, plural, members }) => {
    const label = layerKindLabel(layer, plural);
    return group(`${prefix}/${key.replace("\n", "/")}`, label, leaves(members, [...above, label]));
  });
}

/** The id of the piece's row, which starts open. */
export const PIECE_ID = "piece";

/**
 * The tree of a list: the piece with its parts (when the drawing has one), the loose stones by
 * cut and size, the loose bands, then the rest by layer and kind. Every object is under exactly
 * one row.
 */
export function buildTree(list: ObjectList | null): ObjectNode[] {
  if (list === null) return [];
  const tree: ObjectNode[] = [];
  const inPiece = list.rows.filter((row) => row.groups.includes(PIECE_GROUP));
  const loose = inPiece.length === 0 ? list.rows : list.rows.filter((row) => !row.groups.includes(PIECE_GROUP));
  if (inPiece.length > 0) {
    const up = ["Piece"];
    const parts = [
      ...inPiece.filter(isBand).map((row) => leaf(row, bandName(row.name), up)),
      ...stoneGroups(inPiece.filter(isStone), "piece/stones", up),
      ...layerGroups(inPiece.filter((row) => !isStone(row) && !isBand(row)), "piece/layer", up),
    ];
    tree.push(group(PIECE_ID, "Piece", parts));
  }
  const stones = loose.filter(isStone);
  if (stones.length > 0) tree.push(group("stones", "Stones", stoneGroups(stones, "stones", ["Stones"])));
  const bands = loose.filter(isBand);
  if (bands.length > 0) tree.push(group("bands", "Bands", bands.map((row) => leaf(row, bandName(row.name), ["Bands"]))));
  tree.push(...layerGroups(loose.filter((row) => !isStone(row) && !isBand(row)), "layer", []));
  return tree;
}

// ---- Search ----

/** The words of a search, lower case: every one must be found in a row. */
export function searchTokens(query: string): string[] {
  return lower(query)
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, MAX_TOKENS)
    .map((word) => [...word].slice(0, MAX_TOKEN_CHARS).join(""));
}

/** The characters of `label` (counted as the palette's `highlight` counts them) that the words match. */
export function matchIndices(label: string, tokens: readonly string[]): number[] {
  if (tokens.length === 0) return [];
  const chars = [...lower(label)];
  const hits = new Set<number>();
  for (const token of tokens) {
    const want = [...token];
    if (want.length === 0) continue;
    for (let at = 0; at + want.length <= chars.length; at++) {
      if (want.every((ch, i) => chars[at + i] === ch)) for (let i = 0; i < want.length; i++) hits.add(at + i);
    }
  }
  return [...hits].sort((a, b) => a - b);
}

// ---- What is drawn ----

/** What the panel holds between drawings: what is open, and how far each long group is shown. */
export interface TreeView {
  query: string;
  /** The groups open while nothing is searched. */
  expanded: ReadonlySet<string>;
  /** The groups closed by hand while a search holds every matching group open. */
  collapsed: ReadonlySet<string>;
  /** A group's id (the root is "") to how many of its children are drawn, when more than the cap. */
  shown: ReadonlyMap<string, number>;
}

/** A row as it is drawn. */
export interface VisibleNode {
  id: string;
  /** `more` is the row that shows the rest of a long group. */
  kind: "group" | "leaf" | "more";
  /** 1 for the tree's own rows. */
  level: number;
  label: string;
  /** The label's matched characters. */
  hits: number[];
  /** A group's objects (the matching ones, in a search); 0 on other rows. */
  count: number;
  handles: readonly string[];
  /** A group: whether its children are drawn. */
  open: boolean;
  children: VisibleNode[];
  /** The group the row is in; null for the tree's own rows. */
  parent: string | null;
  /** The row's place among its siblings, from 1, and how many they are (the hidden ones counted). */
  position: number;
  siblings: number;
}

export interface TreeLayout {
  nodes: VisibleNode[];
  /** Rows in reading order: what the keyboard walks. */
  rows: VisibleNode[];
  /** Rows that were open and are not drawn, past `MAX_VISIBLE_ROWS`. */
  cut: boolean;
  /** Objects that match the search (every object, with none). */
  matches: number;
}

/** A node as a search leaves it: the matching objects under it, and the children that hold any. */
interface Kept {
  node: ObjectNode;
  handles: readonly string[];
  children: Kept[];
}

function keep(node: ObjectNode, tokens: readonly string[]): Kept | null {
  if (node.children.length === 0) return tokens.every((token) => node.hay.includes(token)) ? { node, handles: node.handles, children: [] } : null;
  const children: Kept[] = [];
  const handles: string[] = [];
  for (const child of node.children) {
    const kept = keep(child, tokens);
    if (kept === null) continue;
    children.push(kept);
    for (const handle of kept.handles) handles.push(handle);
  }
  return children.length === 0 ? null : { node, handles, children };
}

/** The label of the row that shows more of a group with `rest` rows undrawn. */
export function moreLabel(rest: number): string {
  return rest <= CHILD_CAP ? `Show ${rest.toLocaleString("en-US")} more` : `Show ${CHILD_CAP} more of ${rest.toLocaleString("en-US")}`;
}

/** The id of the "Show more" row of a group. */
export const moreId = (parent: string): string => `${parent}/+more`;

/**
 * The rows to draw: the tree under the search, each group open or folded as the view says, a long
 * group cut at its cap with a "Show more" row, and the whole held to `MAX_VISIBLE_ROWS`.
 */
export function layout(tree: readonly ObjectNode[], view: TreeView): TreeLayout {
  const tokens = searchTokens(view.query);
  const searching = tokens.length > 0;
  const kept: Kept[] = [];
  if (searching) {
    for (const node of tree) {
      const k = keep(node, tokens);
      if (k !== null) kept.push(k);
    }
  }
  const rows: VisibleNode[] = [];
  let cut = false;
  const place = (items: readonly Kept[] | readonly ObjectNode[], level: number, parent: string | null): VisibleNode[] => {
    const cap = Math.max(CHILD_CAP, view.shown.get(parent ?? "") ?? CHILD_CAP);
    const out: VisibleNode[] = [];
    const siblings = items.length;
    for (let i = 0; i < items.length && i < cap; i++) {
      if (rows.length >= MAX_VISIBLE_ROWS) {
        cut = true;
        return out;
      }
      const item = items[i];
      if (item === undefined) continue;
      const node = "node" in item ? item.node : item;
      const handles = item.handles;
      const isGroup = node.children.length > 0;
      const open = isGroup && (searching ? !view.collapsed.has(node.id) : view.expanded.has(node.id));
      const row: VisibleNode = {
        id: node.id,
        kind: isGroup ? "group" : "leaf",
        level,
        label: node.label,
        hits: matchIndices(node.label, tokens),
        count: isGroup ? handles.length : 0,
        handles,
        open,
        children: [],
        parent,
        position: i + 1,
        siblings,
      };
      rows.push(row);
      out.push(row);
      if (open) row.children = place("node" in item ? item.children : node.children, level + 1, node.id);
    }
    if (items.length > cap && !cut) {
      if (rows.length >= MAX_VISIBLE_ROWS) {
        cut = true;
        return out;
      }
      const row: VisibleNode = {
        id: moreId(parent ?? ""),
        kind: "more",
        level,
        label: moreLabel(items.length - cap),
        hits: [],
        count: 0,
        handles: [],
        open: false,
        children: [],
        parent,
        position: cap + 1,
        siblings,
      };
      rows.push(row);
      out.push(row);
    }
    return out;
  };
  const top: readonly Kept[] | readonly ObjectNode[] = searching ? kept : tree;
  const nodes = place(top, 1, null);
  let matches = 0;
  for (const item of top) matches += item.handles.length;
  return { nodes, rows, cut, matches };
}

/** The view after a press on a "Show more" row: the group shows one cap more. */
export function showMore(shown: ReadonlyMap<string, number>, parent: string): Map<string, number> {
  const next = new Map(shown);
  next.set(parent, Math.max(CHILD_CAP, next.get(parent) ?? CHILD_CAP) + CHILD_CAP);
  return next;
}

// ---- Selection ----

/** How much of a row is selected on the drawing. */
export type Selected = "all" | "some" | "none";

/** Whether every object of a row is in the selection (the row is current), some are, or none. */
export function selectedState(handles: readonly string[], selection: ReadonlySet<string>): Selected {
  if (handles.length === 0 || selection.size === 0) return "none";
  let hit = 0;
  for (const handle of handles) {
    if (selection.has(handle)) hit++;
    else if (hit > 0) return "some";
  }
  return hit === handles.length ? "all" : hit > 0 ? "some" : "none";
}

/** How many of a row's objects are selected: a group that is partly selected says "3/18". */
export function selectedCount(handles: readonly string[], selection: ReadonlySet<string>): number {
  if (selection.size === 0) return 0;
  let hit = 0;
  for (const handle of handles) if (selection.has(handle)) hit++;
  return hit;
}

/**
 * The selection a press on a row asks for. A plain press selects the row's objects, and lets the
 * selection go when they are all selected already (as a bench line does); with Ctrl or Cmd it adds
 * them to what is selected, or takes them out when they are all in it.
 */
export function pressSelection(handles: readonly string[], selection: readonly string[], additive: boolean): string[] {
  if (handles.length === 0) return [...selection];
  const selected = new Set(selection);
  const all = handles.every((handle) => selected.has(handle));
  if (!additive) return all ? [] : [...handles];
  if (all) {
    const out = new Set(handles);
    return selection.filter((handle) => !out.has(handle));
  }
  return [...selection, ...handles.filter((handle) => !selected.has(handle))].slice(0, MAX_OBJECTS);
}

/** Where a selection made on the drawing shows in the tree: the row to bring into view, the groups to open above it, and the caps to raise. */
export interface Reveal {
  id: string;
  open: string[];
  /** Group id (the root is "") to the number of children that must be drawn for the row to be among them. */
  shown: Map<string, number>;
}

/**
 * The first row, reading down, whose objects are all selected, with the way to it; null when
 * nothing of the tree is selected. A group that is wholly selected is the row (it need not open).
 */
export function revealTarget(tree: readonly ObjectNode[], selection: ReadonlySet<string>): Reveal | null {
  if (selection.size === 0) return null;
  const walk = (nodes: readonly ObjectNode[], parent: string, open: string[], shown: Map<string, number>): Reveal | null => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node === undefined) continue;
      const state = selectedState(node.handles, selection);
      if (state === "none") continue;
      const here = new Map(shown);
      if (i >= CHILD_CAP) here.set(parent, (Math.floor(i / CHILD_CAP) + 1) * CHILD_CAP);
      if (state === "all" || node.children.length === 0) return { id: node.id, open, shown: here };
      const found = walk(node.children, node.id, [...open, node.id], here);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(tree, "", [], new Map());
}

// ---- The keyboard ----

/** What a key asks of the tree. */
export type TreeAction =
  | { type: "focus"; id: string }
  | { type: "open"; id: string }
  | { type: "close"; id: string }
  | { type: "select"; id: string; additive: boolean }
  | { type: "more"; parent: string };

/**
 * What a key does with the keyboard on row `active` of `rows` (the rows drawn, in reading order):
 * Up and Down move without wrapping, Right opens a group or goes to its first child, Left closes
 * one or goes to the parent, Home and End go to the ends, Enter and Space select (with Ctrl or
 * Cmd: add), and a letter jumps to the next row that starts with it. Null when the key is not the
 * tree's, or would change nothing.
 */
export function treeKey(event: TypedKey, rows: readonly VisibleNode[], active: string | null): TreeAction | null {
  if (rows.length === 0) return null;
  const found = rows.findIndex((row) => row.id === active);
  const at = found < 0 ? 0 : found;
  const row = rows[at];
  if (row === undefined) return null;
  const to = (index: number): TreeAction | null => {
    const next = rows[index];
    return next === undefined || (next.id === row.id && found >= 0) ? null : { type: "focus", id: next.id };
  };
  if (event.altKey) return null;
  switch (event.key) {
    case "ArrowDown":
      return to(Math.min(rows.length - 1, found < 0 ? 0 : at + 1));
    case "ArrowUp":
      return to(Math.max(0, at - 1));
    case "Home":
      return to(0);
    case "End":
      return to(rows.length - 1);
    case "ArrowRight":
      if (row.kind !== "group") return null;
      return row.open ? to(at + 1) : { type: "open", id: row.id };
    case "ArrowLeft":
      if (row.kind === "group" && row.open) return { type: "close", id: row.id };
      return row.parent === null ? null : { type: "focus", id: row.parent };
    case "Enter":
    case " ":
      if (row.kind === "more") return { type: "more", parent: row.parent ?? "" };
      return { type: "select", id: row.id, additive: event.ctrlKey || event.metaKey };
    default: {
      if (!isTypeaheadKey(event)) return null;
      const index = typeaheadIndex(rows.map((r) => r.label), found, event.key);
      return index === null ? null : to(index);
    }
  }
}

// ---- What the panel says ----
//
// The words and the small decisions every drawing of the tree shares (the SolidJS panel and the
// one drawn by Slab, `slab/SlabObjects.tsx`): a view draws them and decides nothing.

const count = (n: number): string => n.toLocaleString("en-US");

/** The longest search the panel keeps (the field's `maxLength`). */
export const MAX_QUERY_CHARS = 200;

/** The window height, in CSS pixels, from which the section starts open: where the rail has the room for a fifth section. */
export const ROOMY_WINDOW = 860;

/** A row's name for assistive tech: its label, and for a group how much it holds and how much of that is selected. */
export function rowName(node: VisibleNode, selected: number): string {
  if (node.kind !== "group") return node.label;
  const holds = `${node.label}, ${count(node.count)} ${node.count === 1 ? "object" : "objects"}`;
  return selected > 0 && selected < node.count ? `${holds}, ${count(selected)} selected` : holds;
}

/** What a group shows at its row's end: how many objects it holds ("18"), or how many of them are selected ("3/18"); empty on other rows. */
export function rowTally(node: VisibleNode, selected: number): string {
  if (node.kind !== "group") return "";
  return selected > 0 && selected < node.count ? `${count(selected)}/${count(node.count)}` : count(node.count);
}

/** The heading's count: how many objects, or how many of them a search found; empty with no list. */
export function panelSummary(list: ObjectList | null, available: boolean, query: string, matches: number): string {
  if (!available || list === null) return "";
  return searchTokens(query).length > 0 ? `${count(matches)} of ${count(list.rows.length)}` : objectsSummary(list);
}

/** What stands in the place of the tree, or under it: one line each. */
export function panelNotes(list: ObjectList | null, available: boolean, drawn: TreeLayout, query: string): string[] {
  if (!available) return ["The object list is not in this build."];
  if (list === null) return ["The objects could not be listed."];
  const out: string[] = [];
  if (list.rows.length === 0) out.push(list.total === 0 ? "Nothing drawn yet." : "The objects could not be listed.");
  else if (drawn.rows.length === 0) out.push(`Nothing matches “${query.trim().slice(0, 40)}”.`);
  if (drawn.cut) out.push("More rows are open than the list shows. Search to narrow it.");
  if (list.truncated && list.rows.length > 0 && list.rows.length < list.total) out.push(`The first ${count(list.rows.length)} of ${count(list.total)} objects are listed.`);
  return out;
}

/** Whether the search and the tree show at all: the engine listed at least one object. */
export function panelListed(list: ObjectList | null, available: boolean): boolean {
  return available && list !== null && list.rows.length > 0;
}

/** The groups open by hand (`expanded`, with no search) and closed by hand (`collapsed`, under one). */
export interface OpenGroups {
  expanded: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
}

/**
 * The view after a group is opened or closed. A search holds every matching group open, so under
 * one a group is closed by naming it in `collapsed`; with none it is open by being in `expanded`.
 */
export function withGroupOpen(groups: OpenGroups, searching: boolean, id: string, open: boolean): OpenGroups {
  const next = new Set(searching ? groups.collapsed : groups.expanded);
  if (open === searching) next.delete(id);
  else next.add(id);
  return searching ? { expanded: groups.expanded, collapsed: next } : { expanded: next, collapsed: groups.collapsed };
}

/**
 * The view that shows a selection made on the drawing: the groups above its row opened and the
 * caps raised to reach it. The same sets are handed back when nothing has to change.
 */
export function withReveal(reveal: Reveal, expanded: ReadonlySet<string>, shown: ReadonlyMap<string, number>): { expanded: ReadonlySet<string>; shown: ReadonlyMap<string, number> } {
  const opened = reveal.open.some((id) => !expanded.has(id)) ? new Set([...expanded, ...reveal.open]) : expanded;
  if (reveal.shown.size === 0) return { expanded: opened, shown };
  const caps = new Map(shown);
  for (const [id, cap] of reveal.shown) caps.set(id, Math.max(cap, caps.get(id) ?? 0));
  return { expanded: opened, shown: caps };
}
