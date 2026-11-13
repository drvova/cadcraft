/**
 * The ribbon's pure model (`components/ToolStrip.tsx` draws it): the tabs that name the kinds of
 * work, each tab's named groups of tools, how many tools of a band fit before the key that opens
 * the rest as a menu, and what a browser remembers of the ribbon (the tab in front, whether the
 * band is folded away). No JSX and no DOM here: the tests drive all of it.
 *
 * Every id is a command the engine registers (`crates/engine/src/cmd/*`) or one the shell runs
 * itself (`UI_ITEMS`, `./commands`); each shortcut and alias is that command's own, and each label
 * its label without the dialog's dots. A tool may stand in two tabs (Line is in Home and in Draw):
 * Home gathers the most used of every kind, and the other tabs are each kind in full.
 */

import type { MenuItem } from "./menu";

/**
 * One tool: the icon id (`icons.ts`), the command id it invokes, the label (its accessible name
 * everywhere), the shortcut, and the name typed at the command line that starts the same command
 * (the engine's first alias, in the capitals a drafter writes it in; empty when the command has
 * none of three letters or fewer). `short` is the word drawn under the glyph where the group's
 * caption already says the rest ("Linear" in the group "Dimension"); the name stays `label`.
 */
export interface ToolbarEntry {
  icon: string;
  id: string;
  label: string;
  shortcut: string;
  alias: string;
  short?: string;
}

/** A named group of a tab: the caption under it and its tools. */
export interface RibbonGroup {
  name: string;
  tools: readonly ToolbarEntry[];
}

/** One tab of the ribbon: its key (part of an element id), its label and its groups. */
export interface RibbonTab {
  id: string;
  label: string;
  groups: readonly RibbonGroup[];
}

const tool = (icon: string, id: string, label: string, alias = "", shortcut = "", short?: string): ToolbarEntry => (short === undefined ? { icon, id, label, shortcut, alias } : { icon, id, label, shortcut, alias, short });

const NEW = tool("new", "new", "New Drawing", "", "Cmd+N", "New");
const OPEN = tool("open", "open", "Open", "", "Cmd+O");
const SAVE = tool("save", "qsave", "Save", "", "Cmd+S");
const PRINT = tool("plot", "plot", "Print");
const UNDO = tool("u", "u", "Undo", "", "Cmd+Z");
const REDO = tool("redo", "redo", "Redo", "", "Cmd+Shift+Z");

const LINE = tool("line", "line", "Line", "L");
const POLYLINE = tool("polyline", "pline", "Polyline", "PL");
const RECTANGLE = tool("rectangle", "rectang", "Rectangle", "REC");
const POLYGON = tool("polygon", "polygon", "Polygon", "POL");
const CIRCLE = tool("circle", "circle", "Circle", "C");
const ARC = tool("arc", "arc", "Arc", "A");
const ELLIPSE = tool("ellipse", "ellipse", "Ellipse", "EL");
const SPLINE = tool("spline", "spline", "Spline", "SPL");
const HATCH = tool("hatch", "hatch", "Hatch", "H");

const MOVE = tool("move", "move", "Move", "M");
const COPY = tool("copy-objects", "copy", "Copy", "CO");
const ROTATE = tool("rotate", "rotate", "Rotate", "RO");
const MIRROR = tool("mirror", "mirror", "Mirror", "MI");
const SCALE = tool("scale", "scale", "Scale", "SC");
const OFFSET = tool("offset", "offset", "Offset", "O");
const TRIM = tool("trim", "trim", "Trim", "TR");
const EXTEND = tool("extend", "extend", "Extend", "EX");
const FILLET = tool("fillet", "fillet", "Fillet", "F");
const CHAMFER = tool("chamfer", "chamfer", "Chamfer", "CHA");
const ERASE = tool("erase", "erase", "Erase", "E");

const RING = tool("ring", "ring", "Ring");
const GEM = tool("gem", "gem", "Gem");
const SETTING = tool("setting", "setting", "Setting");
const PAVE = tool("pave", "pave", "Pavé");
const RING_SIZES = tool("ringsizes", "ringsizes", "Ring Sizes");
const GEM_FIT = tool("gemfit", "gemfit", "Gem Fit");
const TECH_SHEET = tool("techsheet", "techsheet", "Tech Sheet", "BOM");
const BENCH = tool("bench", "ui.panel.bench", "Bench Sheet");
const TEMPLATES = tool("ui.dialog.templates", "ui.dialog.templates", "Templates");

const TEXT = tool("text", "mtext", "Multiline Text", "T", "", "Text");
const LEADER = tool("mleader", "mleader", "Multileader", "MLD", "", "Leader");
const TABLE = tool("table", "table", "Table", "TB");
const DIM_LINEAR = tool("dimension-linear", "dimlinear", "Linear Dimension", "DLI", "", "Linear");
const DIM_ALIGNED = tool("dimension-aligned", "dimaligned", "Aligned Dimension", "DAL", "", "Aligned");
const DIM_RADIUS = tool("dimension-radius", "dimradius", "Radius Dimension", "DRA", "", "Radius");
const DIM_ANGULAR = tool("dimension-angular", "dimangular", "Angular Dimension", "DAN", "", "Angular");
const DISTANCE = tool("dist", "dist", "Measure Distance", "DI", "", "Distance");

const ZOOM_EXTENTS = tool("zoom.extents", "zoom.extents", "Zoom Extents", "", "", "Extents");
const ZOOM_WINDOW = tool("zoom.window", "zoom.window", "Zoom Window", "", "", "Window");
const PAN = tool("pan", "pan", "Pan", "P");
const LAYERS = tool("ui.dialog.layers", "layer", "Layers", "LA");
const PROPERTIES = tool("properties", "ui.panel.properties", "Properties", "", "Cmd+1");

/**
 * The ribbon: Home first (the most used of every kind, so a session can stay on it), then the
 * jeweler's own tools, because this is a jewelry tool, then each kind of drafting work in full.
 * Within a tab the groups run from the most used to the least, so a narrow window's overflow
 * menu takes the least used.
 */
const HOME: RibbonTab = {
  id: "home",
  label: "Home",
  groups: [
    { name: "File", tools: [NEW, OPEN, SAVE, PRINT] },
    { name: "History", tools: [UNDO, REDO] },
    { name: "Draw", tools: [LINE, POLYLINE, CIRCLE, ARC, RECTANGLE] },
    { name: "Modify", tools: [MOVE, COPY, ROTATE, TRIM, ERASE] },
    { name: "Zoom", tools: [ZOOM_EXTENTS, ZOOM_WINDOW, PAN] },
  ],
};

/** The tabs, in the order they are drawn. */
export const RIBBON: readonly RibbonTab[] = [
  HOME,
  {
    id: "jewelry",
    label: "Jewelry",
    groups: [
      // The blank, a stone, the metal that holds it, and melee. A piece built whole belongs here
      // when the engine has its command.
      { name: "Start", tools: [TEMPLATES] },
      { name: "Build", tools: [RING, GEM, SETTING, PAVE] },
      { name: "Check", tools: [RING_SIZES, GEM_FIT] },
      { name: "Bench", tools: [TECH_SHEET, BENCH] },
    ],
  },
  {
    id: "draw",
    label: "Draw",
    groups: [
      { name: "Lines", tools: [LINE, POLYLINE, RECTANGLE, POLYGON] },
      { name: "Curves", tools: [CIRCLE, ARC, ELLIPSE, SPLINE] },
      { name: "Fill", tools: [HATCH] },
    ],
  },
  {
    id: "modify",
    label: "Modify",
    groups: [
      { name: "Place", tools: [MOVE, COPY, ROTATE, MIRROR, SCALE] },
      { name: "Shape", tools: [OFFSET, TRIM, EXTEND, FILLET, CHAMFER] },
      { name: "Remove", tools: [ERASE] },
    ],
  },
  {
    id: "annotate",
    label: "Annotate",
    groups: [
      { name: "Notes", tools: [TEXT, LEADER, TABLE] },
      { name: "Dimension", tools: [DIM_LINEAR, DIM_ALIGNED, DIM_RADIUS, DIM_ANGULAR] },
      { name: "Measure", tools: [DISTANCE] },
      { name: "Fill", tools: [HATCH] },
    ],
  },
  {
    id: "view",
    label: "View",
    groups: [
      { name: "Zoom", tools: [ZOOM_EXTENTS, ZOOM_WINDOW, PAN] },
      { name: "Drawing", tools: [LAYERS, DISTANCE] },
      // The sidebar, the command line and the assistant have their keys in the title bar.
      { name: "Panels", tools: [PROPERTIES, BENCH] },
    ],
  },
];

/** Every tool of the ribbon once, in the order it first appears. */
export const RIBBON_TOOLS: readonly ToolbarEntry[] = [...new Set(RIBBON.flatMap((tab) => tab.groups.flatMap((group) => group.tools)))];

/** The tab with this id, or the first one: an id a browser kept from another version names none. */
export function ribbonTab(id: string | null | undefined): RibbonTab {
  return RIBBON.find((tab) => tab.id === id) ?? HOME;
}

/** The word drawn under a tool's glyph. */
export function toolCaption(entry: ToolbarEntry): string {
  return entry.short ?? entry.label;
}

/**
 * How many leading tools of a band are drawn, from where each one ends when all are laid out
 * (`ends`, measured from the band's start, in order). Every tool is drawn when the last one ends
 * inside `room`; otherwise the tools that end before the overflow key do, which takes `tail` of
 * the room at the band's end. A number that is not one (a band not laid out) folds nothing.
 */
export function toolsFit(ends: readonly number[], room: number, tail: number): number {
  const last = ends[ends.length - 1];
  if (last === undefined || !Number.isFinite(room) || !Number.isFinite(tail) || ends.some((end) => !Number.isFinite(end))) return ends.length;
  if (last <= room) return ends.length;
  const fits = ends.findIndex((end) => !(end <= room - tail));
  return fits === -1 ? ends.length : fits;
}

/**
 * The overflow menu's rows for a tab drawn up to its first `shown` tools: the tools folded away,
 * in their groups (a separator where the band has a divider), each with its glyph, its typed name
 * and its shortcut. `enabled` is the engine's answer for an id.
 */
export function foldedRows(tab: RibbonTab, shown: number, enabled: (id: string) => boolean): MenuItem[] {
  let at = 0;
  const rows: MenuItem[] = [];
  for (const group of tab.groups) {
    let lead = true;
    for (const entry of group.tools) {
      if (at >= shown) {
        rows.push({ label: entry.label, id: entry.id, shortcut: entry.shortcut, enabled: enabled(entry.id), children: [], icon: entry.icon, name: entry.alias, group: lead });
        lead = false;
      }
      at += 1;
    }
  }
  return rows;
}

/** Where the browser keeps the tab in front and whether the band is folded away. */
export const RIBBON_TAB_KEY = "cadcraft.ribbon.tab";
export const RIBBON_FOLDED_KEY = "cadcraft.ribbon.folded";

/** The part of `Storage` the ribbon uses, so a test passes its own. */
export interface RibbonStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's store, or none where there is no browser (the tests, a worker) or it is refused. */
function browserStore(): RibbonStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** What a browser remembers of the ribbon. */
export interface RibbonMemory {
  tab: string;
  folded: boolean;
}

/** Reads what was remembered: the first tab, unfolded, when nothing was or the store refuses. */
export function loadRibbon(store: RibbonStore | null = browserStore()): RibbonMemory {
  try {
    return { tab: ribbonTab(store?.getItem(RIBBON_TAB_KEY)).id, folded: store?.getItem(RIBBON_FOLDED_KEY) === "1" };
  } catch {
    return { tab: ribbonTab(null).id, folded: false };
  }
}

/** Remembers the tab in front and the fold. A store that refuses (private browsing, a full disk) is left alone. */
export function saveRibbon(memory: RibbonMemory, store: RibbonStore | null = browserStore()): void {
  try {
    store?.setItem(RIBBON_TAB_KEY, memory.tab);
    store?.setItem(RIBBON_FOLDED_KEY, memory.folded ? "1" : "0");
  } catch {
    // Nothing to do: the ribbon works without its memory.
  }
}
