/**
 * The chrome's pure logic: what an invoked id means, the menu bar tree, and the small helpers the
 * menu renders with (shortcut labels, submenu state, the keyboard walk order).
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
export type CommandAction = "engine" | "open" | "save" | "sample" | "visibility" | "theme" | "animations" | "none";

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
  { id: "ui.panel.properties", label: "Properties Inspector", menu: ["Window", "Properties Inspector"], shortcut: "Cmd+1" },
  { id: "ui.panel.layers", label: "Layers Palette", menu: ["Window", "Layers Palette"] },
  { id: "ui.animations.system", label: "Use System Setting", menu: ["View", "Accessibility", "Animation Effects", "Use System Setting"] },
  { id: "ui.animations.on", label: "On", menu: ["View", "Accessibility", "Animation Effects", "On"] },
  { id: "ui.animations.off", label: "Off", menu: ["View", "Accessibility", "Animation Effects", "Off"] },
  { id: "ui.toggle.toolbar", label: "Tool Bar", menu: ["Window", "Tool Bar"] },
  { id: "ui.toggle.statusbar", label: "Status Bar", menu: ["Window", "Status Bar"] },
  { id: "ui.toggle.cmdline", label: "Command Line", menu: ["Window", "Command Line"], shortcut: "Cmd+9" },
  { id: "ui.toggle.menubar", label: "In-window Menu Bar", menu: ["Window", "In-window Menu Bar"] },
  { id: "ui.theme.system", label: "Use System Setting", menu: ["View", "Interface Theme", "Use System Setting"] },
  { id: "ui.theme.light", label: "Light", menu: ["View", "Interface Theme", "Light"] },
  { id: "ui.theme.dark", label: "Dark", menu: ["View", "Interface Theme", "Dark"] },
];

/** Decide what the shell does with an invoked id (the `ui.*` commands the shell implements). */
export function classify(id: string): CommandAction {
  if (id === "ui.open") return "open";
  if (id === "ui.saveas") return "save";
  if (id === "ui.sample") return "sample";
  if (id.startsWith("ui.panel.") || id.startsWith("ui.toggle.")) return "visibility";
  if (id.startsWith("ui.theme.")) return "theme";
  if (id.startsWith("ui.animations.")) return "animations";
  if (id === "ui.dialog.commands") return "none";
  return "engine";
}

/** The top-level menus, in order (`MENUS` in `menus.rs`). */
export const MENU_TITLES: readonly string[] = ["File", "Edit", "View", "Insert", "Format", "Tools", "Draw", "Dimension", "Modify", "Window", "Help"];

/** One menu bar entry: an item (`id !== null`) or a submenu (`id === null`). */
export interface MenuNode {
  label: string;
  id: string | null;
  shortcut: string;
  enabled: boolean;
  children: MenuNode[];
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
 */
export function buildMenu(commands: readonly CommandInfo[], items: readonly UiItem[]): MenuNode[] {
  const roots = new Map<string, MenuNode>();
  const tree = MENU_TITLES.map((label): MenuNode => {
    const node: MenuNode = { label, id: null, shortcut: "", enabled: true, children: [] };
    roots.set(label, node);
    return node;
  });
  const seen = new Set<string>();
  const add = (path: readonly string[], label: string, id: string, shortcut: string, enabled: boolean): void => {
    if (path.length < 2 || seen.has(id)) return;
    const root = roots.get(path[0] ?? "");
    if (root === undefined) return;
    let children = root.children;
    for (let i = 1; i < path.length - 1; i++) {
      const segment = path[i] ?? "";
      let sub = children.find((child) => child.id === null && child.label === segment);
      if (sub === undefined) {
        sub = { label: segment, id: null, shortcut: "", enabled: true, children: [] };
        children.push(sub);
      }
      children = sub.children;
    }
    const last = path[path.length - 1] ?? "";
    children.push({ label: last === "" ? label : last, id, shortcut, enabled, children: [] });
    seen.add(id);
  };
  for (const command of commands) {
    if (command.menu === "") continue;
    add(command.menu.split(MENU_SEP), command.label, command.id, command.shortcut, command.enabled);
  }
  for (const item of items) {
    if (item.menu.length === 0) continue;
    add(item.menu, item.label, item.id, item.shortcut ?? "", true);
  }
  return tree;
}

/** One visible entry of an open dropdown, for the keyboard walk. */
export interface MenuEntry {
  node: MenuNode;
  /** How deep the node sits in the dropdown (0 = directly under the title). */
  depth: number;
  /** The submenu labels above the node, from the dropdown root. */
  path: readonly string[];
}

/**
 * The entries a keyboard walk sees in one dropdown: every node in order, plus the children of a
 * submenu that is open. `openPath` is relative to the list being rendered — `openPath[0]` names
 * the first submenu on the open chain.
 */

/** Whether two path arrays hold the same segments. */
export function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The open-path a pointer hover sets inside an open dropdown: a submenu appends its label, a leaf
 * returns to the parent path (closing any submenu). Returns `current` **by reference** when the
 * content would not change, so the caller's signal does not notify — a fresh array on every
 * hover would re-create the rows under the pointer and the pointerover would fire again forever.
 */
export function hoverPath(current: readonly string[], node: MenuNode, path: readonly string[]): readonly string[] {
  const next = node.id === null ? [...path, node.label] : path;
  return sameStrings(next, current) ? current : next;
}

export function menuEntries(nodes: readonly MenuNode[], openPath: readonly string[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  const walk = (list: readonly MenuNode[], path: readonly string[], open: readonly string[]): void => {
    for (const node of list) {
      out.push({ node, depth: path.length, path });
      if (node.id === null && open.length > 0 && open[0] === node.label) {
        walk(node.children, [...path, node.label], open.slice(1));
      }
    }
  };
  walk(nodes, [], openPath);
  return out;
}

/** True when the first name on the open chain is `label` (the chain is relative to the list). */
export function submenuIsOpen(openPath: readonly string[], label: string): boolean {
  return openPath[0] === label;
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

/** Whether the browser runs on macOS (the desktop decides the same way at runtime). */
export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
}
