/**
 * The app shell: owns the session state (drawing summary, prompt, layers, display list, view,
 * settings, selection, properties, layouts, chrome visibility, theme, animations) and wires the
 * surfaces together. All engine access goes through `AppFacade`; this file contains no geometry
 * and no drawing logic.
 *
 * Invocation contract (PLAN.md, phase 2): engine ids go through `facade.start(id)` exactly as a
 * menu click does on the desktop; the file ids the browser must handle itself (open/qsave/saveas/
 * new, and their `ui.*` twins) are intercepted here; `ui.*` visibility/theme/animation ids act on
 * local signals; anything else classified "none" does nothing.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { AppFacade, type CommandInfo, type DrawingState, type LayerInfo, type SettingsState } from "./facade";
import type { DisplayList } from "./display";
import { padView, regionCovers, regionOf, VIEW_PAD, type DisplayRegion } from "./display-cache";
import { emptyPrompt, type PromptState } from "./prompt";
import { padRect, UNIT_RECT, type Rect } from "./view";
import { pickAperture, toggleHandle } from "./selection";
import { parseProperties, type PropertiesReply } from "./props";
import { classify, isMacPlatform, shortcutLabel, UI_ITEMS } from "./commands";
import { paletteItems, rememberCommand } from "./palette";
import { defaultFileName, downloadBytes, pickFile } from "./files";
import { TopBar } from "./components/TopBar";
import { MenuBar } from "./components/MenuBar";
import { ToolStrip } from "./components/ToolStrip";
import { LayoutTabs, StatusBar } from "./components/StatusBar";
import { CommandPalette } from "./components/CommandPalette";
import { AssistantPane } from "./components/AssistantPane";
import { createAssistantSession, type AssistantSession } from "./assistant-session";
import { CanvasView } from "./components/CanvasView";
import { LayersPanel } from "./components/LayersPanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { CommandLine } from "./components/CommandLine";

export interface AppProps {
  facade: AppFacade;
}

type ThemeChoice = "dark" | "light" | "system";
type AnimChoice = "on" | "off" | "system";

/** The engine's file ids (and their `ui.*` twins) the browser handles itself. */
const FILE_IDS: Readonly<Record<string, "open" | "save" | "new" | "sample">> = {
  open: "open",
  "ui.open": "open",
  qsave: "save",
  saveas: "save",
  "ui.saveas": "save",
  new: "new",
  "ui.sample": "sample",
};

/**
 * The command the shell starts to cancel a running one. The facade has no cancel of its own:
 * starting any command ends the running one through the engine's own cancel (the one its Escape
 * uses), whatever the prompt was asking for, and this command does nothing else to the drawing.
 */
const CANCEL_VIA = "redraw";

/** What takes the keyboard's focus inside a region when nothing names a better control. */
const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

/** The shell's regions in the order F6 walks them; `first` is the control that takes the focus. */
const REGIONS: readonly { root: string; first: string | null }[] = [
  { root: ".sidebar", first: FOCUSABLE },
  { root: ".canvas-stage", first: null },
  { root: ".cmdline", first: ".cmd-input" },
  { root: ".assistant-panel", first: "textarea" },
];

/** Where a key belongs to what has the focus: fields, the palette, the assistant, the menus. */
const OWN_KEYS = "input, textarea, select, [contenteditable], dialog, .assistant-panel, [role='menubar'], [role='menu']";

/** Whether an element is drawn (a region folded away or hidden by the window's width is not). */
function isShown(el: Element): boolean {
  return el.getClientRects().length > 0;
}

/** The control a region hands the focus to; null when the region is not on screen. */
function regionTarget(region: { root: string; first: string | null }): HTMLElement | null {
  const root = document.querySelector<HTMLElement>(region.root);
  if (root === null || !isShown(root)) return null;
  if (region.first === null) return root;
  for (const el of root.querySelectorAll<HTMLElement>(region.first)) {
    if (isShown(el)) return el;
  }
  return null;
}

/** Whether a keydown types a character (and is not a shortcut or part of a composition). */
function typesCharacter(e: KeyboardEvent): boolean {
  if (e.key.length !== 1 || e.key === " " || e.isComposing) return false;
  // AltGr reports Ctrl+Alt on Windows and still types ("@" on many layouts).
  return !(e.ctrlKey || e.metaKey || e.altKey) || e.getModifierState("AltGraph");
}

const RECENT_KEY = "cadcraft.palette.recent";

/** The commands the palette ran last in this browser, newest first. */
function loadRecent(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, 32) : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: readonly string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // a full or blocked storage is not worth failing a command over
  }
}

export function App(props: AppProps): JSX.Element {
  const [drawing, setDrawing] = createSignal<DrawingState | null>(null);
  const [prompt, setPrompt] = createSignal<PromptState>(emptyPrompt());
  const [layers, setLayers] = createSignal<LayerInfo[]>([]);
  const [display, setDisplay] = createSignal<DisplayList>({ revision: 0, bounds: UNIT_RECT, verts: [], prims: [] });
  const [view, setView] = createSignal<Rect>(UNIT_RECT);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [commands, setCommands] = createSignal<CommandInfo[]>([]);
  const [settings, setSettings] = createSignal<SettingsState>({
    grid: false,
    snap: false,
    ortho: false,
    polar: false,
    isodraft: false,
    otrack: false,
    osnap: false,
    dynmode: false,
    lwdisplay: false,
    transparency: false,
    qpmode: false,
    osmode: 0,
    pickbox: 3,
  });
  const [selection, setSelection] = createSignal<readonly string[]>([]);
  const [properties, setProperties] = createSignal<PropertiesReply | null>(null);
  const [layouts, setLayouts] = createSignal<readonly string[]>([]);
  const [space, setSpace] = createSignal("Model");
  const [cursor, setCursor] = createSignal<{ x: number; y: number } | null>(null);
  // Chrome visibility, driven by the ui.* items in the Window menu.
  const [showMenubar, setShowMenubar] = createSignal(true);
  const [showToolbar, setShowToolbar] = createSignal(true);
  const [showStatusbar, setShowStatusbar] = createSignal(true);
  const [showCmdline, setShowCmdline] = createSignal(true);
  const [showLayers, setShowLayers] = createSignal(true);
  const [showAssistant, setShowAssistant] = createSignal(false);
  /** The left sidebar as a whole (its palettes keep their own switches inside it). */
  const [showSidebar, setShowSidebar] = createSignal(true);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [recentCommands, setRecentCommands] = createSignal<readonly string[]>(loadRecent());
  const [showProperties, setShowProperties] = createSignal(true);
  const [theme, setTheme] = createSignal<ThemeChoice>("dark");
  const [animations, setAnimations] = createSignal<AnimChoice>("on");

  /**
   * The window the current display list covers (the view the fetch was made for, padded) and the
   * revision it was built at. Not reactive: it guards fetches, it does not drive the DOM.
   */
  let displayRegion: DisplayRegion | null = null;
  /**
   * The revision the engine last reported — the shell's idea of "the drawing changed". The held
   * list's own revision cannot serve here: it never changes until a fetch, so a fetch could
   * never be triggered by one.
   */
  let engineRevision = -1;

  /**
   * Fetch the display list for `rect`, asking the engine for a window [`VIEW_PAD`] wider than the
   * view so a pan inside that window needs no further call. The engine's own view stays `rect`
   * (the culling window is the margin argument), so view commands still read what the canvas
   * shows.
   */
  const fetchDisplay = (rect: Rect): void => {
    const env = props.facade.setView(rect);
    if (!env.ok) setNotice(env.error);
    const list = props.facade.displayList(VIEW_PAD);
    // The region carries the revision of the list we now hold: a later edit makes the engine's
    // revision differ from it, which is exactly what triggers the next fetch.
    displayRegion = regionOf(padView(rect), list.revision);
    setDisplay(list);
  };

  /** Fetch only when the cached window no longer answers for the view (or the drawing changed). */
  const syncDisplay = (): void => {
    const rect = view();
    if (!regionCovers(displayRegion, rect, engineRevision)) fetchDisplay(rect);
  };

  /** Pull everything the surfaces read from the facade, in one place. */
  const refresh = (): void => {
    const state = props.facade.drawingState();
    engineRevision = state?.revision ?? engineRevision;
    const layerRows = props.facade.layers();
    setDrawing(state);
    setLayers(layerRows);
    setSettings(props.facade.settings());
    setSelection(props.facade.selection().handles);
    setProperties(parseProperties(props.facade.properties(), layerRows.map((l) => l.name)));
    setLayouts(props.facade.layouts().map((l) => l.name));
    setSpace(state?.space ?? "Model");
    setCommands(props.facade.commands());
    syncDisplay();
  };

  // The page's title names the drawing; the desktop app shows it as the window's title.
  createEffect(() => {
    const d = drawing();
    document.title = d === null ? "CADCraft" : `${d.title}${d.dirty ? " (modified)" : ""} - CADCraft`;
  });

  // The assistant's chats outlive its panel: closing the panel hides the view, not the chats.
  // Each chat is its own session (its conversation, draft and running turn); a new chat is added
  // beside the others, as the editor keeps its chats in tabs, and never wipes one.
  const newChat = (): AssistantSession => createAssistantSession({ facade: props.facade, onChanged: () => refresh() });
  const [chats, setChats] = createSignal<readonly AssistantSession[]>([newChat()]);
  const [chatIndex, setChatIndex] = createSignal(0);
  const assistant = createMemo(() => chats()[Math.min(chatIndex(), chats().length - 1)]);
  onCleanup(() => chats().forEach((chat) => chat.stop()));
  /** Open a new chat, unless the one in front is still empty (then it is the new chat). */
  const onNewChat = (): void => {
    if ((assistant()?.entries.length ?? 0) === 0) return;
    setChats([...chats(), newChat()]);
    setChatIndex(chats().length - 1);
  };
  /** Close a chat: stop its turn and drop it; the last one is replaced by a fresh chat. */
  const onCloseChat = (index: number): void => {
    chats()[index]?.stop();
    const rest = chats().filter((_, i) => i !== index);
    setChats(rest.length === 0 ? [newChat()] : rest);
    setChatIndex(Math.max(0, Math.min(chatIndex() > index ? chatIndex() - 1 : chatIndex(), rest.length - 1)));
  };

  /**
   * Re-read the view the facade is showing (a space switch or a zoom command moves it) and fetch
   * for it when the cached window no longer answers.
   */
  const syncView = (): void => {
    const rect = props.facade.viewRect();
    if (rect !== null) setView(rect);
    syncDisplay();
  };

  onMount(() => {
    const initial = props.facade.viewRect();
    const list = props.facade.displayList(VIEW_PAD);
    setDisplay(list);
    const start = initial ?? padRect(list.bounds, 0.06);
    setView(start);
    engineRevision = list.revision;
    displayRegion = regionOf(padView(start), list.revision);
    setPrompt(props.facade.currentPrompt());
    refresh();
    // The facade starts showing its own default view; keep the canvas on it.
    if (initial !== null) props.facade.setView(initial);

    // A menu or the palette that is open when Escape goes down takes that Escape; by the time the
    // key reaches the shell's handler it has already closed, so the fact is read on the way in.
    let overlayTookEscape = false;
    const onKeyCapture = (e: KeyboardEvent): void => {
      if (e.key === "Escape") overlayTookEscape = document.querySelector(".menu-drop, dialog[open]") !== null;
    };
    // The shell's keys. A key that is not handled here is left alone (no preventDefault).
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // The editor's own keys: the palette, the sidebar, the panel, the assistant.
      if ((mod && e.shiftKey && key === "p") || e.key === "F1") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      // Ctrl+1 and Ctrl+9 are the keys the Window menu prints beside Properties Inspector and
      // Command Line (the desktop's; a browser keeps them for its tabs, the desktop window does not).
      if (mod && !e.shiftKey && !e.altKey && (key === "7" || key === "b" || key === "j" || key === "1" || key === "9")) {
        e.preventDefault();
        if (key === "7") setShowAssistant((v) => !v);
        else if (key === "b") setShowSidebar((v) => !v);
        else if (key === "1") setShowProperties((v) => !v);
        else if (key === "9") setShowCmdline((v) => !v);
        else panelKey();
        return;
      }
      // F6 / Shift+F6 walk the regions, as the editor does.
      if (e.key === "F6" && !mod && !e.altKey) {
        e.preventDefault();
        focusRegion(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      // Typing with the drawing (or nothing editable) in focus starts at the command line: the
      // focus moves during the keydown, so the character itself lands in the field.
      if (typesCharacter(e) && target?.closest(OWN_KEYS) == null) {
        focusCommandLine();
        return;
      }
      if (e.key !== "Escape" || overlayTookEscape) return;
      // Escape cancels the running command; with none running it clears the selection (PLAN.md C6).
      if (prompt().running !== null) {
        e.preventDefault();
        cancelCommand();
      } else if (selection().length > 0) {
        e.preventDefault();
        props.facade.execute("select", { clear: true });
        refresh();
      }
    };
    window.addEventListener("keydown", onKeyCapture, true);
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyCapture, true);
      window.removeEventListener("keydown", onKey);
    });
  });

  /** Show the command line if it is folded away and put the keyboard in its field. */
  const focusCommandLine = (): void => {
    setShowCmdline(true);
    regionTarget({ root: ".cmdline", first: ".cmd-input" })?.focus();
  };

  /**
   * Ctrl+J, the panel's key: it brings the command line up and takes the keyboard there; pressed
   * while the keyboard is already in it, it folds the panel away and hands the focus to the drawing.
   */
  const panelKey = (): void => {
    if (showCmdline() && document.activeElement?.closest(".cmdline") != null) {
      setShowCmdline(false);
      regionTarget({ root: ".canvas-stage", first: null })?.focus();
    } else {
      focusCommandLine();
    }
  };

  /** Move the focus to the next (+1) or previous (-1) region on screen, wrapping round. */
  const focusRegion = (step: 1 | -1): void => {
    const targets = REGIONS.map((region) => ({ region, target: regionTarget(region) })).filter(
      (r): r is { region: (typeof REGIONS)[number]; target: HTMLElement } => r.target !== null,
    );
    if (targets.length === 0) return;
    const here = targets.findIndex((r) => document.activeElement?.closest(r.region.root) != null);
    const next = here === -1 ? (step === 1 ? 0 : targets.length - 1) : (here + step + targets.length) % targets.length;
    targets[next]?.target.focus();
  };

  /**
   * Cancel the running command, as Escape does in a CAD program. The engine cancels it when
   * another command starts (see [`CANCEL_VIA`]); the lines that start adds to the history are
   * taken out again, so the history reads `*Cancel*` as it does on the desktop.
   */
  const cancelCommand = (): void => {
    setNotice(null);
    const before = prompt();
    repeatOnEnter = before.running;
    const started = props.facade.start(CANCEL_VIA, before);
    if (started.running !== null) {
      // A facade that does not know the command (the stand-in engine): an empty Enter ends its prompts.
      setPrompt(props.facade.cmdline("", before));
    } else {
      // The start adds its echo, the engine's `*Cancel*` and its own `Command:` line (a full
      // history is capped, so the count of new lines is not always the difference in length).
      const added = Math.max(3, started.output.length - before.output.length);
      const own = new Set([CANCEL_VIA, `Command: ${CANCEL_VIA.toUpperCase()}`]);
      const kept = started.output.slice(0, -added);
      const tail = started.output.slice(-added).filter((line) => !own.has(line));
      setPrompt({ ...started, output: [...kept, ...tail], error: null });
    }
    refresh();
  };

  // The theme: dark/light/system; "system" follows the browser live.
  const systemDark = (): MediaQueryList | null => (typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)"));
  createEffect(() => {
    const choice = theme();
    const apply = (): void => {
      const resolved = choice === "system" ? (systemDark()?.matches === false ? "light" : "dark") : choice;
      document.documentElement.dataset["theme"] = resolved;
    };
    apply();
    const mq = systemDark();
    if (choice === "system" && mq !== null) {
      const listener = (): void => apply();
      mq.addEventListener("change", listener);
      onCleanup(() => mq.removeEventListener("change", listener));
    }
  });

  // The animation choice: on/off/system, where "system" follows prefers-reduced-motion live.
  const systemReduced = (): MediaQueryList | null => (typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)"));
  createEffect(() => {
    const choice = animations();
    const apply = (): void => {
      const resolved = choice === "system" ? (systemReduced()?.matches === true ? "off" : "on") : choice;
      document.documentElement.dataset["animations"] = resolved;
    };
    apply();
    const mq = systemReduced();
    if (choice === "system" && mq !== null) {
      const listener = (): void => apply();
      mq.addEventListener("change", listener);
      onCleanup(() => mq.removeEventListener("change", listener));
    }
  });

  /**
   * The canvas moved. Panning inside the fetched window is a pure redraw — the display signal is
   * untouched and the canvas effect re-runs on the view alone; only leaving the window (or a
   * drawing change) fetches again.
   */
  const onViewChange = (rect: Rect): void => {
    setView(rect);
    if (!regionCovers(displayRegion, rect, engineRevision)) fetchDisplay(rect);
  };

  /**
   * The command Escape cancelled last, until another line is entered. The engine's empty Enter
   * repeats the last command started, which after a cancel is the shell's own [`CANCEL_VIA`]:
   * the shell sends the cancelled command's name instead, so Enter repeats what the user ran.
   */
  let repeatOnEnter: string | null = null;

  const onCommand = (text: string): void => {
    setNotice(null);
    const line = text.trim() === "" && prompt().running === null && repeatOnEnter !== null ? repeatOnEnter : text;
    repeatOnEnter = null;
    setPrompt(props.facade.cmdline(line, prompt()));
    refresh();
  };

  /** Start a command by id, exactly as the desktop menu does; the prompt becomes interactive. */
  const startCommand = (id: string): void => {
    setNotice(null);
    repeatOnEnter = null;
    const state = props.facade.start(id, prompt());
    setPrompt(state);
    if (state.error !== null) setNotice(state.error);
    refresh();
    syncView();
  };

  const openDrawing = async (): Promise<void> => {
    setNotice(null);
    const file = await pickFile(".dxf,.dwg");
    if (file === null) return;
    const env = props.facade.openBytes(file.name, file.bytes);
    if (!env.ok) {
      setNotice(env.error);
      return;
    }
    refresh();
    // Fit the new drawing the way the facade fitted its own view.
    syncView();
  };

  const saveDrawing = (): void => {
    setNotice(null);
    const bytes = props.facade.saveBytes();
    if (bytes === null) {
      setNotice("the drawing could not be saved");
      return;
    }
    const title = drawing()?.title ?? "Drawing1";
    downloadBytes(defaultFileName(title), bytes);
  };

  const newDrawing = (): void => {
    setNotice(null);
    const env = props.facade.execute("new", {});
    if (!env.ok) {
      setNotice(env.error);
      return;
    }
    refresh();
    syncView();
  };

  const loadSample = (): void => {
    setNotice(null);
    const env = props.facade.loadSample();
    if (!env.ok) {
      setNotice(env.error);
      return;
    }
    refresh();
    syncView();
  };

  /** Everything the palette can run: the registry's commands and the shell's own items. */
  const palette = createMemo(() => paletteItems(commands(), UI_ITEMS));

  /** The palette ran a command: close it, remember the command, and run it like a menu would. */
  const onPaletteRun = (id: string): void => {
    setPaletteOpen(false);
    const next = rememberCommand(recentCommands(), id);
    setRecentCommands(next);
    saveRecent(next);
    onInvoke(id);
  };

  /** A menu/toolbar invocation: classify and dispatch (the contract in the file header). */
  const onInvoke = (id: string): void => {
    const file = FILE_IDS[id];
    if (file === "open") {
      void openDrawing();
      return;
    }
    if (file === "save") {
      saveDrawing();
      return;
    }
    if (file === "new") {
      newDrawing();
      return;
    }
    if (file === "sample") {
      loadSample();
      return;
    }
    switch (classify(id)) {
      case "engine":
        startCommand(id);
        return;
      case "visibility":
        toggleVisibility(id);
        return;
      case "theme":
        setTheme(id === "ui.theme.light" ? "light" : id === "ui.theme.system" ? "system" : "dark");
        return;
      case "animations":
        setAnimations(id === "ui.animations.off" ? "off" : id === "ui.animations.system" ? "system" : "on");
        return;
      case "palette":
        setPaletteOpen(true);
        return;
      case "focus":
        if (id === "ui.focus.cmdline") focusCommandLine();
        else focusRegion(id === "ui.focus.previous" ? -1 : 1);
        return;
      default:
        return;
    }
  };

  const toggleVisibility = (id: string): void => {
    switch (id) {
      case "ui.panel.layers":
        setShowLayers((v) => !v);
        return;
      case "ui.panel.properties":
        setShowProperties((v) => !v);
        return;
      case "ui.toggle.assistant":
        setShowAssistant((v) => !v);
        return;
      case "ui.toggle.sidebar":
        setShowSidebar((v) => !v);
        return;
      case "ui.toggle.cmdline":
        setShowCmdline((v) => !v);
        return;
      case "ui.toggle.statusbar":
        setShowStatusbar((v) => !v);
        return;
      case "ui.toggle.toolbar":
        setShowToolbar((v) => !v);
        return;
      case "ui.toggle.menubar":
        setShowMenubar((v) => !v);
        return;
      default:
        return;
    }
  };

  /** A canvas click: pick through the engine's own `select`, with this canvas's aperture. */
  const onPick = (point: { x: number; y: number }, add: boolean, worldPerPixel: number): void => {
    setNotice(null);
    const aperture = pickAperture(worldPerPixel, settings().pickbox);
    const env = props.facade.execute("select", { at: [point.x, point.y], aperture, add: false });
    if (!env.ok) {
      setNotice(env.error);
      return;
    }
    // The reply is `{selected, handles}`; read the handles with checked narrowing.
    const picked: string[] =
      env.result !== null && typeof env.result === "object" && "handles" in env.result && Array.isArray(env.result.handles)
        ? env.result.handles.filter((h): h is string => typeof h === "string")
        : [];
    if (add) {
      // Shift-click toggles the picked handle: `select {handles}` sets the whole selection.
      const first = picked[0];
      const next = first !== undefined ? toggleHandle(selection(), first, true) : [...selection()];
      const applied = props.facade.execute("select", { handles: next });
      if (!applied.ok) setNotice(applied.error);
    }
    refresh();
  };

  const onLayerToggle = (name: string, flag: "on" | "frozen" | "locked", value: boolean): void => {
    const env = props.facade.setLayerFlag(name, flag, value);
    setNotice(env.ok ? null : env.error);
    refresh();
  };

  const onLayerCurrent = (name: string): void => {
    const env = props.facade.setCurrentLayer(name);
    setNotice(env.ok ? null : env.error);
    refresh();
  };

  const onSetProperties = (patch: Record<string, unknown>): void => {
    const env = props.facade.setProperties(patch);
    setNotice(env.ok ? null : env.error);
    refresh();
  };

  const onLayout = (name: string): void => {
    const env = props.facade.setLayout(name);
    if (!env.ok) {
      setNotice(env.error);
      return;
    }
    setNotice(null);
    refresh();
    syncView();
  };

  /** Status-bar toggles: the engine's own drafting commands, transparently. */
  const onStatusCommand = (id: string, params: Record<string, unknown> = {}): void => {
    const env = props.facade.execute(id, params);
    setNotice(env.ok ? null : env.error);
    refresh();
  };

  const currentLayer = createMemo(() => drawing()?.currentLayer ?? layers().find((l) => l.current)?.name ?? "0");

  return (
    <div class="app">
      <TopBar
        drawing={drawing}
        menu={
          <Show when={showMenubar()}>
            <MenuBar commands={commands()} onInvoke={onInvoke} />
          </Show>
        }
        paletteShortcut={shortcutLabel("Cmd+Shift+P", isMacPlatform())}
        onOpenPalette={() => setPaletteOpen(true)}
        sidebarOpen={showSidebar}
        onToggleSidebar={() => setShowSidebar((v) => !v)}
        panelOpen={showCmdline}
        onTogglePanel={() => setShowCmdline((v) => !v)}
        assistantOpen={showAssistant}
        onToggleAssistant={() => setShowAssistant((v) => !v)}
      />
      <Show when={showToolbar()}>
        <ToolStrip onInvoke={onInvoke} />
      </Show>
      <div class={showAssistant() ? "workspace has-assistant" : "workspace"}>
        <Show when={showSidebar() && (showLayers() || showProperties())}>
          <aside class="sidebar" aria-label="Drawing">
            <Show when={showLayers()}>
              <LayersPanel layers={layers} currentLayer={currentLayer} onToggle={onLayerToggle} onMakeCurrent={onLayerCurrent} />
            </Show>
            <Show when={showProperties()}>
              <PropertiesPanel properties={properties()} selectionCount={selection().length} layers={layers().map((l) => l.name)} onSet={onSetProperties} onNotice={setNotice} />
            </Show>
          </aside>
        </Show>
        <div class="editor">
          <LayoutTabs layouts={layouts()} space={space()} onLayout={onLayout} />
          <main class="stage">
            <CanvasView
              facade={props.facade}
              view={view}
              display={display}
              selection={selection}
              onViewChange={onViewChange}
              onNotice={setNotice}
              onPick={onPick}
              onCursor={setCursor}
            />
          </main>
          <Show when={showCmdline()}>
            <CommandLine prompt={prompt} notice={notice} onSubmit={onCommand} />
          </Show>
        </div>
        <Show when={showAssistant() ? assistant() : undefined} keyed>
          {(chat) => (
            <AssistantPane
              session={chat}
              selection={selection}
              commands={palette}
              onRunCommand={onPaletteRun}
              chats={() => chats().map((c) => c.title())}
              chatIndex={chatIndex}
              onSelectChat={setChatIndex}
              onNewChat={onNewChat}
              onCloseChat={onCloseChat}
              onClose={() => setShowAssistant(false)}
            />
          )}
        </Show>
      </div>
      <Show when={showStatusbar()}>
        <StatusBar
          settings={settings()}
          mode={props.facade.mode}
          currentLayer={currentLayer()}
          entityCount={drawing()?.entityCount ?? 0}
          layerCount={drawing()?.layerCount ?? 0}
          cursor={cursor()}
          formatPoint={(x, y) => props.facade.formatPoint(x, y)}
          selectionCount={selection().length}
          onCommand={onStatusCommand}
        />
      </Show>
      <CommandPalette open={paletteOpen} items={palette} recent={recentCommands} onRun={onPaletteRun} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
