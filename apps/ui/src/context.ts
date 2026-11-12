/**
 * What a right-click menu holds: pure functions from the shell's state (the selection's count, the
 * running prompt and its keywords, the commands that ran, the registry's commands and their
 * `enabled` flags, a layer, a layout) to the rows of a menu and what each row does. No DOM and no
 * engine calls: `components/ContextMenu.tsx` places and shows a menu, and the shell (`app.tsx`)
 * carries out the action of the row that was chosen.
 *
 * A row stands for a command of the registry. A command the registry does not have has no row (a
 * group left with none has no separator either), and a row is available only while the registry
 * says its command is enabled, and the thing it acts on allows it (a layer with no objects has
 * none to select).
 */

import { typedName } from "./commands";
import type { CommandInfo, LayerInfo } from "./facade";
import type { MenuItem } from "./menu";
import type { PromptAccept } from "./prompt";

/** What choosing a row does. The shell carries it out. */
export type ContextAction =
  /** Start the command as its menu-bar row does. `layout`: bring that layout to the front first. */
  | { kind: "invoke"; id: string; layout?: string }
  /** Send one line to the command line: Enter (the empty line), a keyword, a transparent command. */
  | { kind: "submit"; text: string }
  /** Send these lines and put the keyboard in the command line: the person types what is left. */
  | { kind: "type"; lines: readonly string[] }
  /** Cancel the running command, as Escape does. */
  | { kind: "cancel" }
  /** Run the command's JSON form with these parameters: no prompt, no dialog. */
  | { kind: "execute"; id: string; params: Record<string, unknown> }
  /** Show the sidebar's Properties, unfolding the sidebar if it is folded away. */
  | { kind: "properties" }
  /** Isolate a layer: the objects on it are found (`qselect`) and handed to `layiso`. */
  | { kind: "isolate"; layer: string }
  /** Invoke an option of a grip's menu (`gripOption`): it acts at once, or leaves a grip edit asking for a point. */
  | { kind: "grip"; grip: string; option: string };

/** A menu: its accessible name, its rows, and each row's action by the row's id. */
export interface ContextMenuModel {
  label: string;
  items: MenuItem[];
  actions: ReadonlyMap<string, ContextAction>;
}

/** The registry, as the facade lists it. */
export type Registry = readonly CommandInfo[];

/** A right press released within this long (ms), without moving, is a quick click. */
export const QUICK_CLICK_MS = 250;

/** A finger held still on the drawing this long (ms) opens the menu. */
export const LONG_PRESS_MS = 500;

/** How many commands the Recent Commands submenu lists. */
export const RECENT_LIMIT = 6;

/** How the menu was asked for. */
export type ContextSource = "pointer" | "touch" | "keyboard";

/**
 * What a right click on the drawing means. While a command runs, a quick right click (released
 * within `QUICK_CLICK_MS`, inside the click slop) is Enter, as a drafter's hand expects, and a
 * longer or a moved one shows the menu. At rest every right click shows the menu. A finger's long
 * press and the keyboard's menu key always show it.
 */
export function rightClickAction(running: boolean, source: ContextSource, heldMs: number, moved: boolean): "enter" | "menu" {
  if (source !== "pointer" || !running) return "menu";
  return !moved && heldMs >= 0 && heldMs < QUICK_CLICK_MS ? "enter" : "menu";
}

/** The line the engine writes to the history when a command starts ("Command: LINE"). */
const STARTED = /^Command: (\S+)$/;

/**
 * The commands that ran in this session, newest first and each once, read from the command
 * line's history: the engine writes "Command: NAME" for each one it starts, whatever started it
 * (a menu, the palette, a typed name or alias, the empty Enter that repeats).
 */
export function ranCommands(output: readonly string[]): string[] {
  const ran: string[] = [];
  for (let at = output.length - 1; at >= 0; at -= 1) {
    const id = STARTED.exec(output[at] ?? "")?.[1]?.toLowerCase();
    if (id !== undefined && !ran.includes(id)) ran.push(id);
  }
  return ran;
}

/** A label without the dots that say a dialog follows ("Quick Select..."). */
const plain = (label: string): string => (label.endsWith("...") ? label.slice(0, -3) : label);

/** Collects a menu's rows and their actions; a row whose command the registry lacks is not added. */
class MenuBuilder {
  private readonly items: MenuItem[] = [];
  private readonly actions = new Map<string, ContextAction>();
  private lead = false;
  private readonly registry: Registry;
  private readonly label: string;

  constructor(registry: Registry, label: string) {
    this.registry = registry;
    this.label = label;
  }

  private find(id: string): CommandInfo | undefined {
    return this.registry.find((command) => command.id === id);
  }

  /** Whether the registry has every one of these commands. */
  has(...ids: readonly string[]): boolean {
    return ids.every((id) => this.find(id) !== undefined);
  }

  /** The next row added starts a group: a separator is drawn above it. */
  group(): this {
    this.lead = true;
    return this;
  }

  private push(item: MenuItem): void {
    this.items.push(this.lead && this.items.length > 0 ? { ...item, group: true } : item);
    this.lead = false;
  }

  /** A row of the shell's own, with no command behind it. */
  row(key: string, label: string, action: ContextAction, enabled = true, shortcut = ""): this {
    this.actions.set(key, action);
    this.push({ label, id: key, shortcut, enabled, children: [] });
    return this;
  }

  /**
   * A row for the command `id`, if the registry has it: its label (or `label`), its shortcut and
   * typed name, enabled while the registry says so and `allowed` holds. `action` is what it does
   * when that is not starting the command as the menu bar does; such a row prints no typed name,
   * since typing the name would not do what the row does.
   */
  command(id: string, options: { label?: string; action?: ContextAction; allowed?: boolean; key?: string } = {}): this {
    const command = this.find(id);
    if (command === undefined) return this;
    const label = options.label ?? command.label;
    const key = options.key ?? `invoke:${id}`;
    this.actions.set(key, options.action ?? { kind: "invoke", id });
    const enabled = command.enabled && options.allowed !== false;
    if (options.action === undefined) this.push({ label, id: key, shortcut: command.shortcut, enabled, children: [], name: typedName(command, label) });
    else this.push({ label, id: key, shortcut: "", enabled, children: [] });
    return this;
  }

  /** A submenu of rows for these commands, each started as the menu bar does; none when none is in the registry. */
  submenu(label: string, ids: readonly string[], keyPrefix: string): this {
    const children: MenuItem[] = [];
    for (const id of ids) {
      const command = this.find(id);
      if (command === undefined) continue;
      const key = `${keyPrefix}:${id}`;
      this.actions.set(key, { kind: "invoke", id });
      children.push({ label: command.label, id: key, shortcut: command.shortcut, enabled: command.enabled, children: [], name: typedName(command, command.label) });
    }
    if (children.length > 0) this.push({ label, id: null, shortcut: "", enabled: true, children });
    return this;
  }

  build(): ContextMenuModel {
    return { label: this.label, items: this.items, actions: this.actions };
  }
}

/** What the drawing's menu is made from. */
export interface DrawingContext {
  registry: Registry;
  /** How many objects are selected. */
  selected: number;
  /** The running command's id, or null at rest. */
  running: string | null;
  /** The running prompt's keywords, as the chips over the command line show them. */
  keywords: readonly string[];
  /** What the running prompt accepts, if the engine says. */
  accept: PromptAccept | null;
  /** The command line's history (`PromptState.output`). */
  output: readonly string[];
  /** The commands the palette remembers running, newest first. */
  remembered: readonly string[];
}

/** "Repeat Line": the empty Enter, named for the command it repeats. None before a command ran. */
function repeatRow(menu: MenuBuilder, context: DrawingContext): void {
  const last = ranCommands(context.output)[0];
  if (last === undefined) return;
  const command = context.registry.find((candidate) => candidate.id === last);
  menu.row("repeat", `Repeat ${command === undefined ? last.toUpperCase() : plain(command.label)}`, { kind: "submit", text: "" }, true, "Enter");
}

/** The drawing's menu at rest with nothing selected. */
export function restMenu(context: DrawingContext): ContextMenuModel {
  const menu = new MenuBuilder(context.registry, "Drawing");
  repeatRow(menu, context);
  const ran = ranCommands(context.output);
  const recent = [...ran, ...context.remembered.filter((id) => !ran.includes(id))].filter((id) => menu.has(id)).slice(0, RECENT_LIMIT);
  menu.submenu("Recent Commands", recent, "recent");
  menu.group().command("u").command("redo");
  menu.group().command("pan").command("zoom.window").command("zoom.extents");
  menu.group().command("selectall").command("qselect");
  menu.group().command("pasteclip");
  menu.group().command("options");
  return menu.build();
}

/** The drawing's menu at rest with objects selected. */
export function selectionMenu(context: DrawingContext): ContextMenuModel {
  const menu = new MenuBuilder(context.registry, context.selected === 1 ? "1 selected object" : `${context.selected} selected objects`);
  repeatRow(menu, context);
  menu.group().command("erase").command("move").command("copy").command("rotate").command("scale").command("mirror");
  menu.group().command("cutclip").command("copyclip", { label: "Copy to Clipboard" }).command("pasteclip");
  menu.group().submenu("Draw Order", ["draworder.front", "draworder.back", "draworder.above", "draworder.under"], "order");
  menu.group().command("select", { label: "Deselect All", key: "deselect", action: { kind: "execute", id: "select", params: { clear: true } } });
  menu.row("properties", "Properties", { kind: "properties" });
  return menu.build();
}

/**
 * The drawing's menu while a command runs: Enter and Cancel, the prompt's keywords (each sent as
 * its chip sends it; Undo is one of them when the prompt offers it), then Pan and Zoom, which are
 * typed transparently ('PAN, 'ZOOM) so the running command resumes after them.
 */
export function commandMenu(context: DrawingContext): ContextMenuModel {
  const menu = new MenuBuilder(context.registry, context.running === null ? "Command" : context.running.toUpperCase());
  menu.row("enter", "Enter", { kind: "submit", text: "" }, context.accept?.enter !== false, "Enter");
  menu.row("cancel", "Cancel", { kind: "cancel" }, true, "Esc");
  menu.group();
  for (const keyword of context.keywords) menu.row(`keyword:${keyword}`, keyword, { kind: "submit", text: keyword });
  menu.group();
  menu.command("pan", { key: "transparent:pan", action: { kind: "submit", text: "'PAN" } });
  menu.command("zoom", { key: "transparent:zoom", action: { kind: "submit", text: "'ZOOM" } });
  return menu.build();
}

/** The drawing's menu for the state it is in: a running command's, the selection's, or the one at rest. */
export function drawingMenu(context: DrawingContext): ContextMenuModel {
  if (context.running !== null) return commandMenu(context);
  return context.selected > 0 ? selectionMenu(context) : restMenu(context);
}

/** The layers every drawing keeps: the engine renames neither and deletes neither. */
const KEPT_LAYERS: readonly string[] = ["0", "defpoints"];

/**
 * A layer row's menu. The state rows say what a press does now (Turn Off, Thaw), as the row's own
 * keys do. Rename needs a name typed: it starts -RENAME for this layer and leaves the prompt for
 * the new name on the command line. Delete runs only on a layer the engine would let go (no
 * objects, not current, not layer 0 or Defpoints).
 */
export function layerMenu(registry: Registry, layer: LayerInfo): ContextMenuModel {
  const menu = new MenuBuilder(registry, `Layer ${layer.name}`);
  const name = layer.name;
  const kept = KEPT_LAYERS.includes(name.toLowerCase());
  const set = (flag: "on" | "frozen" | "locked", value: boolean): ContextAction => ({ kind: "execute", id: "layer.set", params: { name, [flag]: value } });
  menu.command("layer.current", { allowed: !layer.current, action: { kind: "execute", id: "layer.current", params: { name } } });
  menu.group();
  menu.command("layer.set", { key: "layer:on", label: layer.on ? "Turn Off" : "Turn On", action: set("on", !layer.on) });
  menu.command("layer.set", { key: "layer:frozen", label: layer.frozen ? "Thaw" : "Freeze", allowed: layer.frozen || !layer.current, action: set("frozen", !layer.frozen) });
  menu.command("layer.set", { key: "layer:locked", label: layer.locked ? "Unlock" : "Lock", action: set("locked", !layer.locked) });
  menu.group();
  menu.command("qselect", { key: "layer:select", label: "Select Objects", allowed: layer.used, action: { kind: "execute", id: "qselect", params: { layer: name } } });
  if (menu.has("qselect")) menu.command("layiso", { key: "layer:isolate", label: "Isolate", allowed: layer.used, action: { kind: "isolate", layer: name } });
  menu.group();
  menu.command("rename", { key: "layer:rename", label: "Rename...", allowed: !kept, action: { kind: "type", lines: ["-RENAME", "LAyer", name] } });
  menu.command("layer.delete", { label: "Delete", allowed: !layer.used && !layer.current && !kept, action: { kind: "execute", id: "layer.delete", params: { name } } });
  return menu.build();
}

/** The tab of model space, which is not a layout: it is neither renamed nor deleted. */
export const MODEL_TAB = "Model";

/**
 * A layout tab's menu. New Layout and Page Setup Manager start as their menu-bar rows do (page
 * setup acts on the layout in front, so the tab is brought there first). Rename starts -LAYOUT's
 * Rename for this tab and leaves the prompt for the new name on the command line.
 */
export function layoutMenu(registry: Registry, name: string): ContextMenuModel {
  const menu = new MenuBuilder(registry, name === MODEL_TAB ? "Model space" : `Layout ${name}`);
  const layout = name !== MODEL_TAB;
  menu.command("layout.new");
  menu.group();
  menu.command("layout", { key: "layout:rename", label: "Rename...", allowed: layout, action: { kind: "type", lines: ["-LAYOUT", "Rename", name] } });
  menu.command("layout.delete", { label: "Delete", allowed: layout, action: { kind: "execute", id: "layout.delete", params: { name } } });
  menu.group();
  menu.command("pagesetup", { action: { kind: "invoke", id: "pagesetup", layout: name } });
  return menu.build();
}

/** One row of a grip's menu, as the facade lists it (`gripOptions`). */
export interface GripChoice {
  /** What `gripOption` takes. */
  id: string;
  /** The row's text ("Add Vertex"). */
  label: string;
}

/**
 * A multifunctional grip's menu: the engine's options for that grip, in its order, each invoked
 * on that grip. A grip the engine lists no option for has no menu.
 */
export function gripMenu(grip: string, options: readonly GripChoice[]): ContextMenuModel {
  const menu = new MenuBuilder([], "Grip");
  for (const option of options) menu.row(`grip:${option.id}`, option.label, { kind: "grip", grip, option: option.id });
  return menu.build();
}
