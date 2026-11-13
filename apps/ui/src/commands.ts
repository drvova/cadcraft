/**
 * The chrome's pure logic: what an invoked id means, the menu bar tree (its rows, their groups
 * and the names typed at the command line), and the shortcut labels and chords.
 *
 * Everything here mirrors the desktop chrome:
 *   - `crates/ui-egui/src/menus.rs` — `MENUS` (the top-level order), `UI_COMMANDS` (the `ui.*`
 *     subset transcribed into `UI_ITEMS`), `tree()` (the path rules) and `shortcut_label()`.
 *   - `crates/ui-egui/src/chrome.rs` — the toolbar and the status toggles; the components copy
 *     those tables, this module owns the menu logic.
 *
 * No JSX and no DOM here: the tests drive all of it.
 */

import type { CommandInfo } from "./facade";

/** What the shell does with an invoked id. */
export type CommandAction = "engine" | "open" | "save" | "sample" | "visibility" | "theme" | "animations" | "palette" | "ask" | "focus" | "drafting" | "layers" | "jewelry" | "templates" | "none";

/** One `ui.*` command the web shell can honour, transcribed from `menus.rs`'s `UI_COMMANDS`. */
export interface UiItem {
  id: string;
  label: string;
  /** The menu path's segments; empty means the item has no menu placement. */
  menu: readonly string[];
  shortcut?: string;
}

/**
 * The `ui.*` ids the web shell implements, with the labels, menu paths and shortcuts of
 * `menus.rs`'s `UI_COMMANDS`. Only commands `app.tsx` can actually honour are here; the desktop's
 * remaining `ui.*` ids (dialogs, palettes, recent files) are not.
 */
export const UI_ITEMS: readonly UiItem[] = [
  { id: "ui.open", label: "Open...", menu: [], shortcut: "Cmd+O" },
  { id: "ui.saveas", label: "Save As...", menu: [] },
  { id: "ui.sample", label: "Open Sample Drawing", menu: ["Help", "Open Sample Drawing"] },
  { id: "ui.sample.bracket", label: "Open Sample Bracket", menu: ["Help", "Open Sample Bracket"] },
  { id: "ui.dialog.commands", label: "Command Palette...", menu: ["Help", "Command Palette..."], shortcut: "Cmd+Shift+P" },
  { id: "ui.toggle.sidebar", label: "Sidebar", menu: ["Window", "Sidebar"], shortcut: "Cmd+B" },
  { id: "ui.panel.properties", label: "Properties Inspector", menu: ["Window", "Properties Inspector"], shortcut: "Cmd+1" },
  { id: "ui.toggle.assistant", label: "Assistant", menu: ["Window", "Assistant"], shortcut: "Cmd+7" },
  // The web shell's own: the drawing as a script beside the drawing.
  { id: "ui.toggle.source", label: "Source", menu: ["Window", "Source"], shortcut: "Cmd+U" },
  // The web shell's own: one line over the drawing that asks the assistant, the editor's inline key.
  { id: "ui.assistant.ask", label: "Ask the Assistant...", menu: ["Window", "Ask the Assistant..."], shortcut: "Cmd+K" },
  { id: "ui.panel.layers", label: "Layers Palette", menu: ["Window", "Layers Palette"] },
  // The web shell's own: the piece's stones and metal beside the drawing.
  { id: "ui.panel.bench", label: "Bench Sheet", menu: ["Window", "Bench Sheet"] },
  // The web shell's own: the parametric ring's parameters, edited beside the drawing.
  { id: "ui.panel.piece", label: "Piece", menu: ["Window", "Piece"] },
  // The web shell's own: what the drawing holds, as a searchable tree beside it.
  { id: "ui.panel.objects", label: "Objects", menu: ["Window", "Objects"] },
  // The web shell's own: a gallery of preset pieces to start a new drawing from.
  { id: "ui.dialog.templates", label: "Templates...", menu: ["Window", "Templates..."] },
  // The web shell's own: the piece as a printable bench sheet, shown over the editor.
  { id: "ui.view.techsheet", label: "Tech Sheet", menu: ["Window", "Tech Sheet"] },
  { id: "ui.animations.system", label: "Use System Setting", menu: ["View", "Accessibility", "Animation Effects", "Use System Setting"] },
  { id: "ui.animations.on", label: "On", menu: ["View", "Accessibility", "Animation Effects", "On"] },
  { id: "ui.animations.off", label: "Off", menu: ["View", "Accessibility", "Animation Effects", "Off"] },
  { id: "ui.toggle.toolbar", label: "Tool Bar", menu: ["Window", "Tool Bar"] },
  { id: "ui.toggle.statusbar", label: "Status Bar", menu: ["Window", "Status Bar"] },
  { id: "ui.toggle.cmdline", label: "Command Line", menu: ["Window", "Command Line"], shortcut: "Cmd+9" },
  { id: "ui.toggle.menubar", label: "In-window Menu Bar", menu: ["Window", "In-window Menu Bar"] },
  // The shell's own focus keys (the web shell's, not transcribed from the desktop): where the
  // keyboard goes, as an editor's Focus commands.
  { id: "ui.focus.cmdline", label: "Focus Command Line", menu: ["Window", "Focus Command Line"], shortcut: "Cmd+J" },
  { id: "ui.focus.next", label: "Focus Next Part", menu: ["Window", "Focus Next Part"], shortcut: "F6" },
  { id: "ui.focus.previous", label: "Focus Previous Part", menu: ["Window", "Focus Previous Part"], shortcut: "Shift+F6" },
  { id: "ui.theme.system", label: "Use System Setting", menu: ["View", "Interface Theme", "Use System Setting"] },
  { id: "ui.theme.light", label: "Light", menu: ["View", "Interface Theme", "Light"] },
  { id: "ui.theme.dark", label: "Dark", menu: ["View", "Interface Theme", "Dark"] },
];

/** Decide what the shell does with an invoked id (the `ui.*` commands the shell implements). */
export function classify(id: string): CommandAction {
  if (id === "ui.open") return "open";
  if (id === "ui.saveas") return "save";
  if (id === "ui.sample" || id === "ui.sample.bracket") return "sample";
  if (id.startsWith("ui.panel.") || id.startsWith("ui.toggle.") || id.startsWith("ui.view.")) return "visibility";
  if (id.startsWith("ui.theme.")) return "theme";
  if (id.startsWith("ui.animations.")) return "animations";
  if (id.startsWith("ui.focus.")) return "focus";
  if (id === "ui.dialog.commands") return "palette";
  // The template gallery is the interface's own dialog of preset pieces.
  if (id === "ui.dialog.templates") return "templates";
  if (id === "ui.assistant.ask") return "ask";
  // Drafting Settings is the interface's dialog over the engine's settings, not a prompt sequence.
  if (id === "dsettings") return "drafting";
  // Layers is the Layer Properties Manager; `-layer` stays the command line's prompt sequence.
  if (id === "layer") return "layers";
  // Ring and Gem are the interface's dialogs over the commands' JSON forms; typed, they stay the prompts.
  if (id === "ring" || id === "gem") return "jewelry";
  return "engine";
}

/** The top-level menus, in order (`MENUS` in `menus.rs`). */
export const MENU_TITLES: readonly string[] = ["File", "Edit", "View", "Insert", "Format", "Tools", "Draw", "Dimension", "Modify", "Window", "Help"];

/**
 * One menu bar entry: an item (`id !== null`) or a submenu (`id === null`). `name` is the name
 * typed at the command line that runs the item (`typedName`; empty for a submenu and for the
 * shell's own items). `group` marks the first row of a group of its menu (`MENU_GROUPS`).
 */
export interface MenuNode {
  label: string;
  id: string | null;
  shortcut: string;
  enabled: boolean;
  children: MenuNode[];
  name: string;
  group: boolean;
}

/**
 * The name a menu row prints for a command: the shortest of its id and its aliases (the id on a
 * tie, then the earlier alias), in the capitals a drafter writes it in. The command line takes
 * any of them; the shortest is the one worth learning. Empty where it would only repeat the
 * row's label ("Erase", "Find...").
 */
export function typedName(command: Pick<CommandInfo, "id" | "aliases">, label: string): string {
  const name = [command.id, ...command.aliases].reduce((best, next) => (next.length < best.length ? next : best));
  const plain = label.endsWith("...") ? label.slice(0, -3) : label;
  return name.toLowerCase() === plain.toLowerCase() ? "" : name.toUpperCase();
}

/**
 * The groups of each menu's own rows, in the order they are drawn: a separator stands between two
 * groups. The engine's registry gives a command a menu path and nothing about groups or order, so
 * the rows of a menu arrive in the order the engine's modules register them; this table is the
 * conventional order of a drafting menu, written for this shell. A key is a command id: it names
 * the row that runs that command, or the submenu that holds it (`arc` is the Arc submenu). A row
 * no key names keeps its registered order in a last group of its own, and a key the registry
 * does not have is passed over: `commands.test.ts` reads the engine's sources and fails when a
 * key names no row of its menu, so a renamed command is caught there.
 */
export const MENU_GROUPS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  // Open and close; save; exchange with other formats; page setup and printing; repair.
  File: [
    ["new", "open", "close", "closeall"],
    ["qsave", "saveas"],
    ["import", "export", "exportpdf"],
    ["pagesetup", "plottermanager", "stylesmanager", "preview", "plot", "publish", "pdfbook"],
    ["audit"],
  ],
  // History; the clipboard and Clear; selecting and finding.
  Edit: [
    ["u", "redo"],
    ["cutclip", "cutbase", "copyclip", "copybase", "pasteclip", "pasteblock", "pasteorig", "erase.selection"],
    ["selectall", "qselect", "find"],
  ],
  // Moving the view; redrawing it; saved views and viewports; what is displayed; the interface.
  View: [
    ["zoom.realtime", "pan"],
    ["regen", "regenall", "redraw"],
    ["view", "mview.polygonal"],
    ["annovisible.current", "attdisp.normal"],
    ["ui.animations.system", "ui.theme.system"],
  ],
  // Blocks, references and data; images; layouts.
  Insert: [["insert", "xattach", "datalink"], ["imageattach", "imagetrace"], ["layout.new"]],
  // Layers; an object's properties; the named styles; the drawing's setup; renaming.
  Format: [
    ["layer", "layerstate.save", "layer.current"],
    ["color", "linetype", "lweight", "thickness", "plotstyle"],
    ["style", "dimstyle", "tablestyle", "mleaderstyle", "mlstyle", "ddptype"],
    ["units", "limits", "scalelistedit"],
    ["rename"],
  ],
  // Order, isolation and groups; inquiry; blocks and references; constraints and the express
  // tools; scripts and applications; settings last.
  Tools: [
    ["draworder.front", "isolateobjects", "group", "ungroup"],
    ["dist", "count", "compare", "dataextraction"],
    ["bedit", "refedit", "xopen"],
    ["autoconstrain", "breakline"],
    ["script", "appload"],
    ["aliasedit", "dsettings", "options"],
  ],
  // Lines and polylines; curves; points and marks; hatches and regions; blocks, tables and text;
  // jewellery.
  Draw: [
    ["line", "xline", "ray", "mline", "pline", "3dpoly", "rectang", "polygon"],
    ["arc", "circle", "donut", "ellipse", "spline", "helix", "revcloud"],
    ["point", "centermark", "centerline"],
    ["hatch", "gradient", "boundary", "region", "wipeout"],
    ["block", "table", "text"],
    ["piece", "ring", "gem", "pave", "setting"],
  ],
  // The general commands; lengths and positions; circles and angles; chains; leaders and
  // tolerances; changes to a placed dimension; the style.
  Dimension: [
    ["dim", "qdim"],
    ["dimlinear", "dimaligned", "dimarc", "dimordinate"],
    ["dimradius", "dimdiameter", "dimjogged", "dimangular"],
    ["dimbaseline", "dimcontinue"],
    ["mleader", "tolerance", "diminspect"],
    ["dimspace", "dimbreak", "dimjogline", "dimedit.oblique", "dimtedit.home"],
    ["dimstyle.dimension", "dimoverride", "dimstyle.update", "dimreassociate"],
  ],
  // Properties; editing by kind of object; erasing and copying; moving and resizing; trimming
  // and joining; taking apart and combining.
  Modify: [
    ["properties", "matchprop"],
    ["mledit", "objectscale", "vpclip"],
    ["erase", "overkill", "copy", "ncopy", "mirror", "offset", "arrayrect"],
    ["move", "rotate", "scale", "stretch", "lengthen", "align"],
    ["trim", "extend", "break", "breakatpoint", "join", "chamfer", "fillet", "blend"],
    ["explode", "flatten", "chspace", "union"],
  ],
  // The parts of the window; the palettes; where the keyboard goes.
  Window: [
    ["ui.toggle.sidebar", "ui.toggle.assistant", "ui.toggle.source", "ui.assistant.ask", "ui.toggle.cmdline", "ui.toggle.toolbar", "ui.toggle.statusbar", "ui.toggle.menubar"],
    ["ui.panel.piece", "ui.dialog.templates", "ui.panel.properties", "ui.panel.layers", "ui.panel.objects", "ui.panel.bench", "ui.view.techsheet", "xref"],
    ["ui.focus.cmdline", "ui.focus.next", "ui.focus.previous"],
  ],
};

/** Whether `row` runs the command `id`, or is a submenu that holds it. */
function holds(row: MenuNode, id: string): boolean {
  return row.id === id || row.children.some((child) => holds(child, id));
}

/**
 * A menu's rows in the order of its `groups`, the first row of each group marked. The rows no
 * key names follow in the order they came, as one more group.
 */
export function groupRows(rows: readonly MenuNode[], groups: readonly (readonly string[])[]): MenuNode[] {
  const placed = new Set<MenuNode>();
  const out: MenuNode[] = [];
  const place = (row: MenuNode, lead: boolean): void => {
    placed.add(row);
    row.group = lead;
    out.push(row);
  };
  for (const keys of groups) {
    let lead = true;
    for (const key of keys) {
      const row = rows.find((candidate) => !placed.has(candidate) && holds(candidate, key));
      if (row === undefined) continue;
      place(row, lead);
      lead = false;
    }
  }
  rows.filter((row) => !placed.has(row)).forEach((row, index) => place(row, index === 0));
  return out;
}

/** The separator `facade.ts` joins a command's menu path with. */
const MENU_SEP = " \u203a ";

/**
 * The full menu bar tree: the engine's commands (their `menu` is the facade's " › "-joined path)
 * plus the `ui.*` items the shell can honour, in registration order.
 *
 * Mirrors `menus.rs::tree`:
 *   - the top level is exactly `MENU_TITLES`, in that order; anything else is dropped;
 *   - a command with an empty path (or a path of one segment) is not in the tree;
 *   - a path's middle segments become submenus, created once in first-seen order;
 *   - the last segment is the item's label when non-empty (so `["Draw", "Circle",
 *     "Center, Radius"]` reads "Center, Radius"), else the command's own label;
 *   - an id that already landed in the tree is skipped (the first occurrence wins).
 *
 * A menu's own rows then stand in its groups (`MENU_GROUPS`), and an engine command's row
 * carries the name typed at the command line (`typedName`).
 */
export function buildMenu(commands: readonly CommandInfo[], items: readonly UiItem[]): MenuNode[] {
  const roots = new Map<string, MenuNode>();
  const tree = MENU_TITLES.map((label): MenuNode => {
    const node: MenuNode = { label, id: null, shortcut: "", enabled: true, children: [], name: "", group: false };
    roots.set(label, node);
    return node;
  });
  const seen = new Set<string>();
  const add = (path: readonly string[], label: string, id: string, shortcut: string, enabled: boolean, aliases: readonly string[] | null): void => {
    if (path.length < 2 || seen.has(id)) return;
    const root = roots.get(path[0] ?? "");
    if (root === undefined) return;
    let children = root.children;
    for (let i = 1; i < path.length - 1; i++) {
      const segment = path[i] ?? "";
      let sub = children.find((child) => child.id === null && child.label === segment);
      if (sub === undefined) {
        sub = { label: segment, id: null, shortcut: "", enabled: true, children: [], name: "", group: false };
        children.push(sub);
      }
      children = sub.children;
    }
    const last = path[path.length - 1] ?? "";
    const shown = last === "" ? label : last;
    children.push({ label: shown, id, shortcut, enabled, children: [], name: aliases === null ? "" : typedName({ id, aliases }, shown), group: false });
    seen.add(id);
  };
  for (const command of commands) {
    if (command.menu === "") continue;
    add(command.menu.split(MENU_SEP), command.label, command.id, command.shortcut, command.enabled, command.aliases);
  }
  for (const item of items) {
    if (item.menu.length === 0) continue;
    add(item.menu, item.label, item.id, item.shortcut ?? "", true, null);
  }
  for (const root of tree) {
    const groups = MENU_GROUPS[root.label];
    if (groups !== undefined) root.children = groupRows(root.children, groups);
  }
  return tree;
}

/**
 * The registry's shortcut ("Cmd+Shift+Z") in the form shown on this platform: macOS symbols
 * ("⇧⌘Z") or Windows/Linux text ("Ctrl+Shift+Z"). Mirrors `menus.rs::shortcut_label`.
 */
export function shortcutLabel(shortcut: string, mac: boolean): string {
  if (!mac) return shortcut.replaceAll("Cmd+", "Ctrl+");
  const shift = shortcut.includes("Shift+") ? "\u21e7" : "";
  const cmd = shortcut.includes("Cmd+") ? "\u2318" : "";
  return `${shift}${cmd}${shortcut.replaceAll("Cmd+", "").replaceAll("Shift+", "")}`;
}

/** The parts of a key press a registry shortcut is matched against. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * A key press in the registry's own form ("Cmd+Shift+Z", "Cmd+N"), or null when it is not a
 * command chord: only a press with Ctrl or Cmd held and no Alt is one, and its key must be a
 * single character. Ctrl and Cmd both read as "Cmd", as the registry writes them.
 */
export function pressShortcut(press: KeyPress): string | null {
  if (!(press.ctrlKey || press.metaKey) || press.altKey) return null;
  if (press.key.length !== 1 || press.key === " ") return null;
  return `Cmd+${press.shiftKey ? "Shift+" : ""}${press.key.toUpperCase()}`;
}

/** The chords a text field keeps for itself: its own undo, redo, select all and clipboard. */
const FIELD_CHORDS: ReadonlySet<string> = new Set(["Cmd+Z", "Cmd+Shift+Z", "Cmd+Y", "Cmd+A", "Cmd+C", "Cmd+X", "Cmd+V"]);

/**
 * The id a chord runs: the first enabled command or shell item whose shortcut is that chord.
 * A chord a text field owns is left to the field while the keyboard is in one.
 */
export function chordCommand(chord: string, commands: readonly { id: string; shortcut: string; enabled: boolean }[], items: readonly UiItem[], inField: boolean): string | null {
  if (inField && FIELD_CHORDS.has(chord)) return null;
  const same = (shortcut: string | undefined): boolean => shortcut !== undefined && shortcut.toLowerCase() === chord.toLowerCase();
  const item = items.find((i) => same(i.shortcut));
  if (item !== undefined) return item.id;
  const command = commands.find((c) => c.enabled && same(c.shortcut));
  return command === undefined ? null : command.id;
}

/** Whether the browser runs on macOS (the desktop decides the same way at runtime). */
export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
}
