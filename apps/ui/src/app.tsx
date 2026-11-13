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

import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack, type Component, type JSX } from "solid-js";
import { AppFacade, type CommandInfo, type DrawingState, type Grip, type GripOption, type LayerInfo, type SampleName, type ScriptReport, type SettingsState } from "./facade";
import type { DisplayList } from "./display";
import { padView, regionCovers, regionOf, VIEW_PAD, viewScale, type DisplayRegion } from "./display-cache";
import { emptyPrompt, formatPoint, formatSelectBox, pointerWants, type PromptState } from "./prompt";
import { keepHeldView, padRect, sameRect, unionRects, UNIT_RECT, type Rect, type ScreenSize } from "./view";
import { applyPick, pickAperture, type PickRule } from "./selection";
import { parseProperties, type PropertiesReply } from "./props";
import { chordCommand, classify, isMacPlatform, pressShortcut, shortcutLabel, UI_ITEMS } from "./commands";
import { paletteItems, rememberCommand } from "./palette";
import { drawingMenu, gripMenu, layerMenu, layoutMenu, rightClickAction, type ContextAction, type ContextMenuModel } from "./context";
import { defaultFileName, downloadBytes, pickFile } from "./files";
import { TopBar } from "./components/TopBar";
import { MenuBar } from "./components/MenuBar";
import { ToolStrip } from "./components/ToolStrip";
import { LayoutTabs, STATUS_TOGGLES, StatusBar } from "./components/StatusBar";
import type { LayoutTabsProps, StatusBarProps } from "./components/StatusBar";
import { CommandPalette } from "./components/CommandPalette";
import { DraftingSettings } from "./components/DraftingSettings";
import { draftingTabFor, opensDraftingSettings, type DraftingTab } from "./drafting";
import { ContextMenu, isMenuKey, type MenuPoint, type OpenContextMenu } from "./components/ContextMenu";
import { AssistantPane } from "./components/AssistantPane";
import { createAssistantSession, type AssistantSession } from "./assistant-session";
import { assistantStartsOpen } from "./assistant";
import { CanvasView } from "./components/CanvasView";
import { LayersPanel, type LayersPanelProps } from "./components/LayersPanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { SourcePanel } from "./components/SourcePanel";
import { Viewport3D } from "./components/Viewport3D";
import { TechSheet } from "./components/TechSheet";
import { BenchPanel, type BenchPanelProps } from "./components/BenchPanel";
import { ObjectsPanel } from "./components/ObjectsPanel";
import { OBJECTS_LIMIT, parseObjects, type ObjectList } from "./objects";
import { PiecePanel } from "./components/PiecePanel";
import { NO_CHOICES, NO_PIECE, parsePieceReply, readPieceChoices, type PieceChoices, type PieceState } from "./piece";
import { InlineAsk } from "./components/InlineAsk";
import { parseBench, type BenchSheet } from "./bench";
import { CommandLine, type CommandLineProps } from "./components/CommandLine";
import { createRecovery, RecoveryBar } from "./components/RecoveryBar";
import { GemDialog, RingDialog } from "./components/JewelryDialog";
import { PriceBookDialog } from "./components/PriceBookDialog";
import { LayerManager } from "./components/LayerManager";
import { TemplateGallery } from "./components/TemplateGallery";
import { opensLayerManager } from "./layer-manager";
import type { RibbonProps, SlabParts, TitleBarProps } from "./slab/parts";

export interface AppProps {
  facade: AppFacade;
  /**
   * The Slab shell's parts (the default; `?shell=standard` leaves them out: `./slab/parts`), loaded by main.tsx. Absent, the
   * shell is the standard one below and nothing of Slab is in the page.
   */
  slab?: SlabParts;
  /** Said once beside the command field: why the shell that was asked for is not the one shown. */
  shellNotice?: string;
}

type ThemeChoice = "dark" | "light" | "system";
type AnimChoice = "on" | "off" | "system";

/** The engine's file ids (and their `ui.*` twins) the browser handles itself. */
const FILE_IDS: Readonly<Record<string, "open" | "save" | "new" | "sample" | "bracket">> = {
  open: "open",
  "ui.open": "open",
  qsave: "save",
  saveas: "save",
  "ui.saveas": "save",
  new: "new",
  "ui.sample": "sample",
  "ui.sample.bracket": "bracket",
};

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

/** What takes Escape before the shell does while it is open: a menu, the palette, the assistant's setup sheet. */
const SHEET = ".assistant-setup";
const OVERLAYS = `.menu-drop, dialog[open], ${SHEET}`;

/** What has a right-click menu of its own: the drawing, a layer's row, a layout's tab. */
const MENU_OWNERS = ".canvas-stage, .layer-row, .editor-tabs [role='tab'], .status-toggles button";

/** What a right-click menu is for. */
type ContextTarget =
  | { kind: "drawing" }
  | { kind: "layer"; name: string }
  | { kind: "layout"; name: string }
  /** A grip's own menu: the engine's options for it, and whether the pointer's rest opened it. */
  | { kind: "grip"; id: string; options: readonly GripOption[]; rest: boolean };

/** The handles a `select` or `qselect` reply names (`{handles: [hex]}`), read with checked narrowing. */
function replyHandles(result: unknown): string[] {
  return result !== null && typeof result === "object" && "handles" in result && Array.isArray(result.handles) ? result.handles.filter((h): h is string => typeof h === "string") : [];
}

/** Whether a key went down on the drawing, or with the keyboard on nothing at all. */
function onDrawing(target: Element | null): boolean {
  return target === null || target === document.body || target.closest(".canvas-stage") !== null;
}

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

const ASSISTANT_OPEN_KEY = "cadcraft.assistant.open";

function loadAssistantOpen(): boolean {
  if (typeof window === "undefined") return false;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(ASSISTANT_OPEN_KEY);
  } catch {
    // a blocked storage leaves the width to decide
  }
  return assistantStartsOpen(stored, window.innerWidth);
}

function saveAssistantOpen(open: boolean): void {
  try {
    localStorage.setItem(ASSISTANT_OPEN_KEY, open ? "1" : "0");
  } catch {
    // a full or blocked storage is not worth failing a toggle over
  }
}

export function App(props: AppProps): JSX.Element {
  const [drawing, setDrawing] = createSignal<DrawingState | null>(null);
  const [prompt, setPrompt] = createSignal<PromptState>(emptyPrompt());
  const [layers, setLayers] = createSignal<LayerInfo[]>([]);
  const [display, setDisplay] = createSignal<DisplayList>({ revision: 0, bounds: UNIT_RECT, verts: [], prims: [] });
  const [view, setView] = createSignal<Rect>(UNIT_RECT);
  const [notice, putNotice] = createSignal<string | null>(props.shellNotice ?? null);
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
  /**
   * The readout's last text. The status bar reads it more than once for one pointer position;
   * the engine formats it once. A command may change the drawing's units, so a drawing state
   * read anew formats again.
   */
  let coordRead: { x: number; y: number; of: DrawingState | null; text: string } | null = null;
  const coordText = (x: number, y: number): string => {
    const of = drawing();
    if (coordRead === null || coordRead.x !== x || coordRead.y !== y || coordRead.of !== of) coordRead = { x, y, of, text: props.facade.formatPoint(x, y) };
    return coordRead.text;
  };
  // Chrome visibility, driven by the ui.* items in the Window menu.
  const [showMenubar, setShowMenubar] = createSignal(true);
  const [showToolbar, setShowToolbar] = createSignal(true);
  const [showStatusbar, setShowStatusbar] = createSignal(true);
  const [showCmdline, setShowCmdline] = createSignal(true);
  const [showLayers, setShowLayers] = createSignal(true);
  // The assistant is part of the window, as the editor's agent panel is: it starts open where
  // the window has the room for it beside the drawing, and stays as this browser last left it.
  const [showAssistant, setShowAssistant] = createSignal(loadAssistantOpen());
  createEffect(() => saveAssistantOpen(showAssistant()));
  /** The Source panel: the drawing's script beside the drawing. It starts closed. */
  const [showSource, setShowSource] = createSignal(false);
  /** The stage shows the piece's 3D view (the "3D" tab over the drawing) instead of the drawing. */
  const [stage3d, setStage3d] = createSignal(false);
  /** The left sidebar as a whole (its palettes keep their own switches inside it). */
  // In a window of a phone's width it would take the whole workspace (styles.css), so it starts closed there.
  const [showSidebar, setShowSidebar] = createSignal(typeof window === "undefined" || window.innerWidth > 560);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  /** The line over the drawing that asks the assistant (Ctrl+K). */
  const [askOpen, setAskOpen] = createSignal(false);
  const [recentCommands, setRecentCommands] = createSignal<readonly string[]>(loadRecent());
  const [showProperties, setShowProperties] = createSignal(true);
  const [showBench, setShowBench] = createSignal(true);
  /** The piece's stones and metal, as the engine last counted them. */
  const [bench, setBench] = createSignal<BenchSheet | null>(null);
  /** The revision and space the bench sheet was counted at: a refresh that changed nothing counts nothing. */
  let benchAt: string | null = null;
  /** Whether the Price Book editor is open. */
  const [pricebookOpen, setPricebookOpen] = createSignal(false);
  /** Whether the engine has the Price Book command (the running wasm may not yet). */
  const canPrice = createMemo(() => commands().some((c) => c.id === "pricebook"));
  /** The Piece section: the drawing's parametric ring, as the engine last described it. */
  const [showPiece, setShowPiece] = createSignal(true);
  const [piece, setPiece] = createSignal<PieceState>(NO_PIECE);
  /** What the engine lets a piece be made of; asked once, when the first piece is shown. */
  const [pieceChoices, setPieceChoices] = createSignal<PieceChoices>(NO_CHOICES);
  let pieceChoicesRead = false;
  /** The revision the piece was read at; and whether the engine said it has no `piece` (never asked again). */
  let pieceAt: string | null = null;
  let pieceMissing = false;
  /** The Objects section: what the space on screen holds, as the engine last listed it. */
  const [showObjects, setShowObjects] = createSignal(true);
  const [objects, setObjects] = createSignal<ObjectList | null>(null);
  /** Whether the engine has `objects` at all (an engine without it is asked once and never again). */
  const [objectsAvailable, setObjectsAvailable] = createSignal(true);
  /** The revision and space the objects were listed at. */
  let objectsAt: string | null = null;
  const [theme, setTheme] = createSignal<ThemeChoice>("dark");
  const [animations, setAnimations] = createSignal<AnimChoice>("on");

  /**
   * Say something beside the command field, or (null) end what is said there. There is one notice
   * at a time: the engine's last refusal, which the prompt carries, ends with it, so an error is
   * never left standing over an action that went through. A notice ends at the next command or
   * input sent, a change that succeeds (a property, a layer, a setting, a pick), and Escape.
   */
  const setNotice = (message: string | null): void => {
    if (prompt().error !== null) setPrompt({ ...prompt(), error: null });
    putNotice(message);
  };
  /** A refusal was said during the key being handled (the Properties rows commit on Enter). */
  let saidOnKey = false;

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
  /** The space the engine last reported as the one on screen; null until it has said. */
  let engineSpace: string | null = null;
  /**
   * The view the engine was last told the canvas shows. A pan or a zoom inside the fetched window
   * fetches nothing and so tells the engine nothing; `tellView` catches it up before a command
   * reads the view (ZOOM and PAN start from it, and a pick inside a command sizes its aperture by it).
   */
  let toldView: Rect | null = null;
  /** The canvas's size in CSS px, as it last reported it; null until it is measured. */
  let screen: ScreenSize | null = null;

  /** The zoom of a view on the canvas (CSS px per world unit); 0 while the canvas is unmeasured. */
  const scaleOf = (rect: Rect): number => (screen === null ? 0 : viewScale(rect, screen));

  /**
   * Fetch the display list for `rect`, asking the engine for a window [`VIEW_PAD`] wider than the
   * view so a pan inside that window needs no further call. The engine's own view stays `rect`
   * (the culling window is the margin argument), so view commands still read what the canvas
   * shows.
   */
  const fetchDisplay = (rect: Rect): void => {
    const env = props.facade.setView(rect);
    if (!env.ok) setNotice(env.error);
    else toldView = rect;
    const list = props.facade.displayList(VIEW_PAD);
    // The region carries the revision of the list we now hold: a later edit makes the engine's
    // revision differ from it, and a zoom past the scale it was built for makes its curves too
    // coarse: either is exactly what triggers the next fetch.
    displayRegion = regionOf(padView(rect), list.revision, scaleOf(rect), list.space ?? null);
    setDisplay(list);
  };

  /** Tell the engine the view on screen, if it has moved since the engine last heard of it. */
  const tellView = (): void => {
    const rect = view();
    if (toldView !== null && toldView.x0 === rect.x0 && toldView.y0 === rect.y0 && toldView.x1 === rect.x1 && toldView.y1 === rect.y1) return;
    if (props.facade.setView(rect).ok) toldView = rect;
  };

  /** Tell the engine the view on screen, and read back the view it holds for it before a command. */
  const engineView = (): Rect | null => {
    tellView();
    return props.facade.viewRect();
  };

  /**
   * The view a command or a tab set (`rect`), and what the canvas shows of it (`shown`), while
   * the hand has not moved it. The canvas fits again the last view it fitted itself when its box
   * changes (a command's echo takes a row of the history), and that view is from before the
   * command: `onViewChange` keeps this one instead, fitted to the canvas as it is by then.
   */
  let commanded: { rect: Rect; shown: Rect } | null = null;

  /**
   * Take the view the engine holds as the canvas's: a command moved it, or another space or
   * drawing is shown. It is taken before anything is fetched, because a fetch tells the engine
   * the view on screen, and would tell it the one from before.
   */
  const adoptView = (): void => {
    const rect = props.facade.viewRect();
    if (rect === null || sameRect(rect, view())) return;
    toldView = rect;
    commanded = { rect, shown: rect };
    setView(rect);
  };

  /**
   * After a command: the canvas follows the engine's view only when the command moved it (ZOOM,
   * PAN, a view restore). The engine keeps its own shape of the view it was told, so adopting it
   * after every command would refit the drawing at each line typed. Called before `refresh`.
   */
  const followView = (before: Rect | null): void => {
    const after = props.facade.viewRect();
    if (before === null || after === null || !sameRect(before, after)) adoptView();
  };

  /**
   * Fetch only when the cached list no longer answers for the view: the view left its window, the
   * drawing changed, or the list is of another space than the one on screen.
   */
  const syncDisplay = (): void => {
    const rect = view();
    if (!regionCovers(displayRegion, rect, engineRevision, scaleOf(rect), engineSpace)) fetchDisplay(rect);
  };

  /** Pull everything the surfaces read from the facade, in one place. */
  const refresh = (): void => {
    const state = props.facade.drawingState();
    engineRevision = state?.revision ?? engineRevision;
    engineSpace = state?.space ?? null;
    const layerRows = props.facade.layers();
    setDrawing(state);
    recovery.noteChange(state);
    setLayers(layerRows);
    setSettings(props.facade.settings());
    setSelection(props.facade.selection().handles);
    setProperties(parseProperties(props.facade.properties(), layerRows.map((l) => l.name)));
    setLayouts(props.facade.layouts().map((l) => l.name));
    setSpace(state?.space ?? "Model");
    setCommands(props.facade.commands());
    readBench(state);
    readPiece(state);
    readObjects(state);
    syncDisplay();
  };

  /** Count the piece again when the drawing changed under the sheet (or the panel came back). */
  const readBench = (state: DrawingState | null): void => {
    if (!showBench() || !showSidebar()) return;
    const at = state === null ? "" : `${state.revision}/${state.entityCount}/${state.title}`;
    if (at === benchAt) return;
    benchAt = at;
    const env = props.facade.execute("techsheet", {});
    setBench(env.ok ? parseBench(env.result) : null);
  };

  // The sheet is not counted while its panel is away; it is counted when the panel comes back.
  createEffect(() => {
    if (showBench() && showSidebar()) readBench(untrack(drawing));
  });

  /** A `piece` reply into the section: the piece, none, or (once and for good) no such command. */
  const takePiece = (env: Parameters<typeof parsePieceReply>[0]): void => {
    const next = parsePieceReply(env, untrack(piece));
    if (next.kind === "unavailable") pieceMissing = true;
    if (next.kind === "piece" && !pieceChoicesRead) {
      pieceChoicesRead = true;
      setPieceChoices(readPieceChoices(props.facade));
    }
    setPiece(next);
  };

  /** Ask the engine for the piece again when the drawing changed under the section (or it came back). */
  const readPiece = (state: DrawingState | null): void => {
    if (pieceMissing || !showPiece() || !showSidebar()) return;
    const at = state === null ? "" : `${state.revision}/${state.entityCount}/${state.title}`;
    if (at === pieceAt) return;
    pieceAt = at;
    // An engine that lists its commands without `piece` is not asked: its refusal of an unknown
    // command would stand on the command line as an error nobody caused.
    const listed = props.facade.commands();
    if (listed.length > 0 && !listed.some((c) => c.id === "piece")) {
      takePiece({ ok: false, error: "unknown command `piece`" });
      return;
    }
    takePiece(props.facade.execute("piece", { query: true }));
  };

  createEffect(() => {
    if (showPiece() && showSidebar()) readPiece(untrack(drawing));
  });

  /** List the space's objects again when the drawing changed under the section (or it came back). */
  const readObjects = (state: DrawingState | null): void => {
    if (!untrack(objectsAvailable) || !showObjects() || !showSidebar()) return;
    const at = state === null ? "" : `${state.revision}/${state.entityCount}/${state.title}/${state.space}`;
    if (at === objectsAt) return;
    objectsAt = at;
    // An engine that lists its commands without `objects` is not asked: its refusal of an unknown
    // command would stand on the command line as an error nobody caused. It is never asked again.
    const listed = props.facade.commands();
    if (listed.length > 0 && !listed.some((c) => c.id === "objects")) {
      setObjectsAvailable(false);
      setObjects(null);
      return;
    }
    const env = props.facade.execute("objects", { limit: OBJECTS_LIMIT });
    setObjects(env.ok ? parseObjects(env.result) : null);
  };

  createEffect(() => {
    if (showObjects() && showSidebar()) readObjects(untrack(drawing));
  });

  /**
   * The Piece section built, rebuilt or removed the piece. A refusal is said beside the command
   * field and handed back in the engine's words, for the row it names.
   */
  const onPieceRun = (params: Record<string, unknown>): string | null => {
    const env = props.facade.execute("piece", params);
    saidOnKey = !env.ok;
    setNotice(env.ok ? null : env.error);
    if (env.ok) pieceAt = null;
    // A piece started, or made another kind, is a new sheet: the drawing is framed on it. An
    // edit of one number leaves the view where the reader put it.
    if (env.ok && "kind" in params && props.facade.execute("zoom.extents", {}).ok) adoptView();
    refresh();
    return env.ok ? null : env.error;
  };

  /**
   * The template gallery chose a preset: start it from a clean slate. Any current piece is removed
   * first (so no stale parameter survives the merge), then the template's own parameters build it —
   * both through the Piece section's own handler, so a template reaches `piece` exactly as a start
   * button does. Answers null when it built, else the engine's refusal for the card to show.
   */
  const onTemplateChoose = (params: Record<string, unknown>): string | null => {
    if (untrack(piece).kind === "piece") onPieceRun({ remove: true });
    return onPieceRun(params);
  };

  // Recovery copies of unsaved work, and the bar that offers one after an unclean close.
  const recovery = createRecovery({
    facade: props.facade,
    afterRestore: () => {
      adoptView();
      refresh();
    },
  });

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

  onMount(() => {
    const initial = props.facade.viewRect();
    const list = props.facade.displayList(VIEW_PAD);
    setDisplay(list);
    const start = initial ?? padRect(list.bounds, 0.06);
    setView(start);
    engineRevision = list.revision;
    displayRegion = regionOf(padView(start), list.revision, 0, list.space ?? null);
    setPrompt(props.facade.currentPrompt());
    refresh();
    // The facade starts showing its own default view; keep the canvas on it.
    if (initial !== null) props.facade.setView(initial);

    // A menu, the palette or the assistant's setup sheet that is open when Escape goes down takes
    // that Escape; by the time the key reaches the shell's handler it may have closed already, so
    // the fact is read on the way in.
    let overlayTookEscape = false;
    const onKeyCapture = (e: KeyboardEvent): void => {
      saidOnKey = false;
      if (e.key === "Escape") overlayTookEscape = document.querySelector(OVERLAYS) !== null;
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
      // The menu key and Shift+F10 on something that has a menu of its own: the surface answers a
      // `contextmenu` no button made exactly as it answers the pointer's, and opens its menu
      // beside what has the focus. Anywhere else the key is the browser's.
      if (isMenuKey(e) && e.target instanceof Element && e.target.closest(MENU_OWNERS) !== null && document.querySelector(OVERLAYS) === null) {
        e.preventDefault();
        if (!e.repeat) e.target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
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
      // Every other command chord the menus and the tool strip print (Ctrl+N, Ctrl+O, Ctrl+S,
      // Ctrl+Z, Ctrl+Shift+Z...): the command that carries it runs as its menu item does. A text
      // field keeps its own undo and clipboard, and an open menu, palette or sheet keeps the key.
      const chord = pressShortcut(e);
      if (chord !== null && !e.repeat && document.querySelector(OVERLAYS) === null) {
        // Text selected on the page (a reply, the command history) is what Ctrl+C copies, as in a field.
        const textPicked = (window.getSelection()?.toString() ?? "") !== "";
        const field = textPicked || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable);
        const id = chordCommand(chord, commands(), UI_ITEMS, field);
        if (id !== null) {
          e.preventDefault();
          onInvoke(id);
          return;
        }
      }
      // F6 / Shift+F6 walk the regions, as the editor does.
      if (e.key === "F6" && !mod && !e.altKey) {
        e.preventDefault();
        focusRegion(e.shiftKey ? -1 : 1);
        return;
      }
      // A drafting toggle's function key (the cap its status key shows) flips that setting.
      if (!mod && !e.altKey && !e.shiftKey && !e.repeat) {
        const toggle = document.querySelector(OVERLAYS) === null ? STATUS_TOGGLES.find((t) => t.shortcut === e.key) : undefined;
        if (toggle !== undefined) {
          e.preventDefault();
          onStatusCommand(toggle.id, { on: !settings()[toggle.key] });
          return;
        }
      }
      const target = e.target instanceof Element ? e.target : null;
      // The setup sheet closes on its own Escape while the keyboard is in the assistant. From
      // anywhere else the key is handed to it, so the press that closes the sheet does nothing more.
      if (e.key === "Escape" && e.isTrusted) {
        const sheet = document.querySelector(SHEET);
        if (sheet !== null && !sheet.contains(target)) {
          e.preventDefault();
          sheet.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
          return;
        }
      }
      // Enter in a Properties field is a commit. One that went through, or changed nothing, ends
      // the notice; one refused during this key (or still marked on its row) keeps what was said.
      if (e.key === "Enter" && !saidOnKey && target?.closest(".prop-row") != null && target.closest(".prop-row")?.querySelector("[aria-invalid='true']") == null) {
        setNotice(null);
      }
      if (e.defaultPrevented) return;
      // Enter and Space on the drawing (or with the keyboard nowhere) are the command line's empty
      // Enter: they repeat the last command, or accept the running command's default. A control
      // that has the focus keeps both keys, and so does whatever is open over the window.
      if ((e.key === "Enter" || e.key === " ") && !mod && !e.altKey && !e.shiftKey && !e.isComposing && onDrawing(target) && document.querySelector(OVERLAYS) === null) {
        e.preventDefault();
        if (!e.repeat) onCommand("");
        return;
      }
      // Typing with the drawing (or nothing editable) in focus starts at the command line: the
      // focus moves during the keydown, so the character itself lands in the field.
      if (typesCharacter(e) && target?.closest(OWN_KEYS) == null) {
        focusCommandLine();
        return;
      }
      if (e.key !== "Escape" || overlayTookEscape) return;
      setNotice(null);
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

  /** Open the line that asks the assistant, or close it and give the keyboard back to the drawing. */
  const toggleAsk = (): void => {
    if (askOpen()) closeAsk();
    else setAskOpen(true);
  };
  const closeAsk = (): void => {
    setAskOpen(false);
    regionTarget({ root: ".canvas-stage", first: null })?.focus({ preventScroll: true });
  };
  /**
   * Send the line's draft to the chat in front and show its panel, where the turn is read. With
   * no model set up the draft stays in the composer, and the panel is where one is set up.
   */
  const sendAsk = (): void => {
    const chat = assistant();
    if (chat === undefined) return;
    const outcome = chat.send();
    if (outcome === "empty") return;
    setAskOpen(false);
    setShowAssistant(true);
    if (outcome === "too-long") setNotice("the message is too long to send; shorten it in the assistant's panel");
  };

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
   * Cancel the running command, as Escape does in a CAD program: the engine's own cancel, which
   * writes `*Cancel*` to the history and leaves its empty Enter repeating the cancelled command.
   */
  const cancelCommand = (): void => {
    setNotice(null);
    setPrompt(props.facade.cancel(prompt()));
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
   * drawing change) fetches again, and so does zooming in past the detail the list was built with
   * (a wider canvas or a closer view would show a circle's chords).
   */
  const onViewChange = (rect: Rect, size: ScreenSize): void => {
    const was = screen;
    screen = size;
    // A view a command set stays through a change of the canvas's size; anything else the canvas
    // reports is the hand's (a pan, a zoom) or its own fit, and the command's view ends with it.
    const resized = was !== null && (was.w !== size.w || was.h !== size.h);
    const held = commanded !== null && resized && sameRect(view(), commanded.shown) ? { rect: commanded.rect, shown: keepHeldView(commanded.rect, size) } : null;
    commanded = held;
    setView(held === null ? rect : held.shown);
    syncDisplay();
  };

  /**
   * A line for the command line: typed, a keyword chip, the drawing's Enter, or a point clicked on
   * the drawing. The engine hears the view on screen first, and the canvas follows a view the
   * command moved (ZOOM, PAN, a view restore).
   */
  /** The Drafting Settings dialog: whether it shows, and the page it opens on. */
  const [drafting, setDrafting] = createSignal<{ open: boolean; tab: DraftingTab }>({ open: false, tab: "snap-grid" });
  /** Whether the Layer Properties Manager shows. */
  const [layerManager, setLayerManager] = createSignal(false);
  /** Which of the Ring and Gem dialogs shows, if either. */
  const [jewelry, setJewelry] = createSignal<"ring" | "gem" | null>(null);
  /** Whether the "Start from a template" gallery shows. */
  const [showTemplates, setShowTemplates] = createSignal(false);
  /** Whether the Tech Sheet view (the printable bench sheet) shows over the editor. */
  const [showTechSheet, setShowTechSheet] = createSignal(false);
  /**
   * A ring or a stone was placed from its dialog: show it. Its weight is read on the Bench
   * section, which counts again here; the line beside the command field is for refusals, in the
   * error ink, and a placed piece is not one.
   */
  const onJewelryPlaced = (_message: string | null): void => {
    setNotice(null);
    refresh();
  };
  const openDrafting = (tab: DraftingTab = "snap-grid"): void => {
    setDrafting({ open: true, tab });
  };

  const onCommand = (text: string): void => {
    // Its name typed at an idle command line opens the dialog, as its menu item does.
    if (prompt().running === null && opensLayerManager(text)) {
      setLayerManager(true);
      return;
    }
    if (prompt().running === null && opensDraftingSettings(text)) {
      openDrafting();
      return;
    }
    setNotice(null);
    const before = engineView();
    setPrompt(props.facade.cmdline(text, prompt()));
    followView(before);
    refresh();
  };

  /** Start a command by id, exactly as the desktop menu does; the prompt becomes interactive. */
  const startCommand = (id: string): void => {
    setNotice(null);
    const before = engineView();
    const state = props.facade.start(id, prompt());
    setPrompt(state);
    if (state.error !== null) setNotice(state.error);
    followView(before);
    refresh();
  };

  const openDrawing = async (): Promise<void> => {
    setNotice(null);
    const file = await pickFile(".dxf,.dwg");
    if (file === null) return;
    // Unsaved work is copied before the drawing in front is replaced.
    recovery.flush();
    const env = props.facade.openBytes(file.name, file.bytes);
    if (!env.ok) {
      setNotice(env.error);
      return;
    }
    // Fit the new drawing the way the facade fitted its own view.
    adoptView();
    refresh();
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
    recovery.markSaved();
  };

  const newDrawing = (): void => {
    setNotice(null);
    recovery.flush();
    // A new drawing is millimetres: it is what a jeweler drafts in, and what the piece, the
    // stones and the bench sheet are said in.
    const env = props.facade.execute("new", { metric: true });
    if (!env.ok) {
      setNotice(env.error);
      return;
    }
    adoptView();
    refresh();
  };

  const loadSample = (name: SampleName): void => {
    setNotice(null);
    recovery.flush();
    const env = props.facade.loadSample(name);
    if (!env.ok) {
      setNotice(env.error);
      return;
    }
    adoptView();
    refresh();
  };

  /**
   * The Source panel applied its text: the drawing is rebuilt from the script, and the window
   * follows as after any command (a waiting command is cancelled first, as the engine would; the
   * view moves only if the script moved it; every surface reads the drawing again).
   */
  const applySource = (text: string): ScriptReport => {
    setNotice(null);
    recovery.flush();
    if (prompt().running !== null) setPrompt(props.facade.cancel(prompt()));
    const before = engineView();
    const report = props.facade.applyScript(text);
    followView(before);
    refresh();
    return report;
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
    if (file === "sample" || file === "bracket") {
      loadSample(file === "sample" ? "solitaire" : "bracket");
      return;
    }
    // The ribbon's and the menu's Tech Sheet open the printable view; typed at the command line
    // (TECHSHEET, BOM) the engine command still inserts its table, and `execute` still runs it.
    if (id === "techsheet") {
      setShowTechSheet(true);
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
      case "ask":
        toggleAsk();
        return;
      case "layers":
        setLayerManager(true);
        return;
      case "drafting":
        openDrafting();
        return;
      case "jewelry":
        setJewelry(id === "gem" ? "gem" : "ring");
        return;
      case "templates":
        setShowTemplates(true);
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
      case "ui.panel.bench":
        setShowBench((v) => !v);
        return;
      case "ui.panel.piece":
        setShowPiece((v) => !v);
        return;
      case "ui.panel.objects":
        setShowObjects((v) => !v);
        return;
      case "ui.view.techsheet":
        setShowTechSheet((v) => !v);
        return;
      case "ui.toggle.assistant":
        setShowAssistant((v) => !v);
        return;
      case "ui.toggle.source":
        setShowSource((v) => !v);
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

  /** What the Source panel reads the drawing's script again for: another drawing, or a change of this one. */
  const sourceStamp = createMemo(() => {
    const d = drawing();
    return d === null ? "" : `${d.revision}/${d.entityCount}/${d.layerCount}/${d.title}`;
  });

  /** What the pointer is for on the drawing: the running command's prompt decides. */
  const wants = createMemo(() => pointerWants(prompt()));

  /** The engine's `PICKADD` (picks add and Shift removes); on, its default, when it does not say. */
  const pickAdd = (): boolean => {
    const env = props.facade.execute("getvar", { name: "PICKADD" });
    const value: unknown = env.ok && env.result !== null && typeof env.result === "object" && "value" in env.result ? env.result.value : 1;
    return value !== 0 && value !== false;
  };

  /**
   * A pick at rest. The engine's `select` finds what the query holds (it has no query that leaves
   * the selection alone, so the find replaces it), then the selection is set to what the engine's
   * own pick rule makes of it: with `PICKADD` on a pick adds and Shift removes.
   */
  const pickAtRest = (query: Record<string, unknown>, gesture: PickRule["gesture"], shift: boolean): void => {
    const before = selection();
    const env = props.facade.execute("select", { ...query, add: false });
    if (!env.ok) {
      setNotice(env.error);
      refresh();
      return;
    }
    const next = applyPick(before, replyHandles(env.result), { gesture, shift, pickadd: pickAdd() });
    const applied = props.facade.execute("select", next.length === 0 ? { clear: true } : { handles: next });
    setNotice(applied.ok ? null : applied.error);
    refresh();
  };

  /** A canvas click at rest: pick with this canvas's aperture. */
  const onPick = (point: { x: number; y: number }, shift: boolean, worldPerPixel: number): void => {
    pickAtRest({ at: [point.x, point.y], aperture: pickAperture(worldPerPixel, settings().pickbox) }, "click", shift);
  };

  /**
   * A click while a command wants a point or objects: the engine takes it as a click (`click`),
   * resolved exactly as the canvas showed it (the snap marker, the grid dot, the ortho or polar
   * ray), with a deferred tangent or perpendicular intact. The history shows the point the engine
   * says it took, written as typed input would be.
   */
  const onPoint = (point: { x: number; y: number }, worldPerPixel: number): void => {
    setNotice(null);
    const before = engineView();
    const clicked = props.facade.click(point, 0, prompt(), (taken) => formatPoint(taken, worldPerPixel) ?? undefined);
    setPrompt(clicked.state);
    followView(before);
    refresh();
  };

  /**
   * A press on a grip: the engine makes the grips hot and starts their edit, which from here is
   * the running command `grip` (the pointer previews it, a click commits it, Enter cycles its
   * mode, Escape cancels it). Says whether an edit now runs; a refusal is said in its own words.
   */
  const onGripStart = (ids: readonly string[]): boolean => {
    setNotice(null);
    const started = props.facade.gripStart(ids, prompt());
    setPrompt(started.state);
    if (started.state.error !== null) setNotice(started.state.error);
    refresh();
    return started.edit !== null;
  };

  /** What the canvas watches to ask the engine again about the pointer: the prompt and the drafting settings. */
  const engineState = createMemo(() => ({ prompt: prompt(), settings: settings() }));

  /**
   * A rectangle dragged on the drawing. At rest it picks by window or crossing; while a command
   * asks for objects it goes to that command, as the engine's own box selection.
   */
  const onSelectRect = (rect: Rect, kind: "window" | "crossing", shift: boolean, worldPerPixel: number): void => {
    if (wants() === "select") {
      const text = formatSelectBox(rect, kind, worldPerPixel);
      if (text !== null) onCommand(text);
      return;
    }
    if (wants() !== "idle") return;
    const corners = [
      [rect.x0, rect.y0],
      [rect.x1, rect.y1],
    ];
    pickAtRest({ window: corners, crossing: kind === "crossing" }, "rect", shift);
  };

  /** A bench line was pressed: what it counts becomes the selection (none: the selection goes). */
  const onBenchSelect = (handles: readonly string[]): void => {
    const env = props.facade.execute("select", handles.length === 0 ? { clear: true } : { handles: [...handles] });
    setNotice(env.ok ? null : env.error);
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
    saidOnKey = !env.ok;
    setNotice(env.ok ? null : env.error);
    refresh();
  };

  /** A Properties row refused what was typed before it reached the engine. */
  const onPropertyNotice = (message: string): void => {
    saidOnKey = true;
    setNotice(message);
  };

  const onLayout = (name: string): void => {
    const env = props.facade.setLayout(name);
    if (!env.ok) {
      setNotice(env.error);
      return;
    }
    setNotice(null);
    adoptView();
    refresh();
  };

  /** Status-bar toggles: the engine's own drafting commands, transparently. */
  const onStatusCommand = (id: string, params: Record<string, unknown> = {}): void => {
    const env = props.facade.execute(id, params);
    setNotice(env.ok ? null : env.error);
    refresh();
  };

  /** The right-click menu that is open: where it stands and what it is for. */
  const [contextAt, setContextAt] = createSignal<{ at: MenuPoint; target: ContextTarget } | null>(null);

  /** The open menu's rows and their actions, from the state as it is now (`context.ts` decides them). */
  const contextModel = createMemo((): ContextMenuModel | null => {
    const target = contextAt()?.target;
    if (target === undefined) return null;
    if (target.kind === "layout") return layoutMenu(commands(), target.name);
    if (target.kind === "grip") return gripMenu(target.id, target.options);
    if (target.kind === "layer") {
      const layer = layers().find((l) => l.name === target.name);
      return layer === undefined ? null : layerMenu(commands(), layer);
    }
    const state = prompt();
    return drawingMenu({ registry: commands(), selected: selection().length, running: state.running, keywords: state.keywords, accept: state.accept, output: state.output, remembered: recentCommands() });
  });

  /** The menu to show: none while nothing asked for one, or what it was for is gone or has no row. */
  const contextMenu = createMemo((): OpenContextMenu | null => {
    const open = contextAt();
    const model = contextModel();
    return open === null || model === null || model.items.length === 0 ? null : { at: open.at, label: model.label, items: model.items };
  });

  /**
   * Open the menu of `target` at a point; says whether there is one to show (a registry with none
   * of its commands leaves it no row). The menu key held, or heard twice, opens it once.
   */
  const openContext = (target: ContextTarget, at: MenuPoint): boolean => {
    if (at.source === "keyboard" && contextMenu() !== null) return true;
    setContextAt({ at, target });
    if (contextMenu() !== null) return true;
    setContextAt(null);
    return false;
  };

  /**
   * The drawing's menu was asked for. While a command runs a quick right click is Enter (it ends
   * or accepts, as it always has) and a longer press shows the menu; at rest every right click
   * shows it (`rightClickAction`). The engine has no setting that chooses between the two. With
   * no menu to show, the right button is Enter, as it was before the drawing had a menu.
   */
  const onDrawingMenu = (request: { at: MenuPoint; heldMs: number; moved: boolean }): void => {
    const enter = rightClickAction(prompt().running !== null, request.at.source, request.heldMs, request.moved) === "enter";
    if (enter || (!openContext({ kind: "drawing" }, request.at) && request.at.source === "pointer")) onCommand("");
  };

  /**
   * A grip's menu was asked for (the pointer rested on it, a right click, a press on a list
   * grip): the engine's options for that grip, at the grip. Null: the pointer left the grip, and
   * the menu its rest opened goes with it, the keyboard back on the drawing.
   */
  const onGripMenu = (request: { grip: Grip; at: MenuPoint; rest: boolean } | null): void => {
    if (request === null) {
      const target = contextAt()?.target;
      if (target?.kind !== "grip" || !target.rest) return;
      setContextAt(null);
      if (document.activeElement === null || document.activeElement === document.body) regionTarget({ root: ".canvas-stage", first: null })?.focus({ preventScroll: true });
      return;
    }
    // A rest is not a request: it opens nothing over a menu, a dialog or a sheet that is already up.
    if (request.rest && document.querySelector(OVERLAYS) !== null) return;
    openContext({ kind: "grip", id: request.grip.id, options: props.facade.gripOptions(request.grip.id), rest: request.rest }, request.at);
  };

  /** Run a command's JSON form for a menu row: no prompt and no dialog; the canvas follows a view it moved. */
  const runQuiet = (id: string, params: Record<string, unknown>): void => {
    const before = engineView();
    const env = props.facade.execute(id, params);
    setNotice(env.ok ? null : env.error);
    followView(before);
    refresh();
  };

  /** Carry out the action of a menu row. */
  const runContextAction = (action: ContextAction): void => {
    switch (action.kind) {
      case "invoke":
        if (action.layout !== undefined && action.layout !== space()) onLayout(action.layout);
        onInvoke(action.id);
        return;
      case "submit":
        onCommand(action.text);
        return;
      case "type":
        // The command is started for the thing the menu was on, and the prompt that is left (a
        // new name) is the person's to answer at the command line.
        for (const line of action.lines) onCommand(line);
        return;
      case "cancel":
        cancelCommand();
        return;
      case "execute":
        runQuiet(action.id, action.params);
        return;
      case "properties":
        setShowSidebar(true);
        setShowProperties(true);
        return;
      case "isolate": {
        // LAYISO takes objects, not a name: the layer's objects are found, the selection is put
        // back as it was, and the objects are handed over.
        const held = selection();
        const found = props.facade.execute("qselect", { layer: action.layer });
        props.facade.execute("select", held.length === 0 ? { clear: true } : { handles: held });
        if (found.ok) runQuiet("layiso", { handles: replyHandles(found.result) });
        else {
          setNotice(found.error);
          refresh();
        }
        return;
      }
      case "grip": {
        // The option acts at once, or leaves a grip edit asking for a point on the drawing.
        const before = engineView();
        const chosen = props.facade.gripOption(action.grip, action.option, prompt());
        setPrompt(chosen.state);
        setNotice(chosen.state.error);
        followView(before);
        refresh();
        return;
      }
    }
  };

  /**
   * A row of the open menu was chosen: the menu closes, then the row's action runs. The focus is
   * back where it was, and on a layer's row or a tab the next Enter would press that control: a
   * command the row left running takes the keyboard to the command line, where Enter answers it.
   */
  const onContextInvoke = (id: string): void => {
    const action = contextModel()?.actions.get(id);
    setContextAt(null);
    if (action === undefined) return;
    runContextAction(action);
    if (prompt().running !== null && !onDrawing(document.activeElement)) focusCommandLine();
  };

  const currentLayer = createMemo(() => drawing()?.currentLayer ?? layers().find((l) => l.current)?.name ?? "0");

  /**
   * The shell's regions, composed once and placed by whichever shell is on: the standard one
   * below (a grid of bars and a flex workspace, `styles.css`), or the Slab shell, which hands
   * each region to a hole of `slab/shell.slab` (`./slab/SlabShell`). Neither forks a component.
   */
  const topBar = (Bar: Component<TitleBarProps> = TopBar): JSX.Element => (
    <Bar
      drawing={drawing}
      menus={showMenubar() ? { commands: commands(), onInvoke } : null}
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
  );
  /** The ribbon, drawn by `Strip`: the SolidJS one, or the one ported to Slab. */
  const ribbon = (Strip: Component<RibbonProps> = ToolStrip): JSX.Element => (
    <Show when={showToolbar()}>
      <Strip onInvoke={onInvoke} commands={commands()} running={prompt().running} />
    </Show>
  );
  /** The sidebar is on screen: its switch is on and it has a section to show. */
  const sidebarShown = (): boolean => showSidebar() && (showPiece() || showLayers() || showObjects() || showProperties() || showBench());
  /** The Layers section's panel: the SolidJS one, or the one ported to Slab when its document loaded. */
  const Layers: Component<LayersPanelProps> = props.slab?.Layers ?? LayersPanel;
  /** The Piece section: the SolidJS one, or the one ported to Slab when the Slab shell has it. */
  const PieceSection = props.slab?.Piece ?? PiecePanel;
  /** The Objects section: the SolidJS one, or the one ported to Slab when its document loaded. */
  const Objects = props.slab?.Objects ?? ObjectsPanel;
  /** The Properties section: the SolidJS one, or the one ported to Slab when its document loaded. */
  const Properties = props.slab?.Properties ?? PropertiesPanel;
  const railSections = (): JSX.Element => (
    <>
      <Show when={showPiece()}>
        <PieceSection state={piece()} choices={pieceChoices()} onRun={onPieceRun} onNotice={onPropertyNotice} onTemplates={() => setShowTemplates(true)} />
      </Show>
      <Show when={showLayers()}>
        <Layers layers={layers} currentLayer={currentLayer} onToggle={onLayerToggle} onMakeCurrent={onLayerCurrent} onMenu={(name, at) => openContext({ kind: "layer", name }, at)} />
      </Show>
      <Show when={showObjects()}>
        <Objects list={objects()} available={objectsAvailable()} selection={selection()} onSelect={onBenchSelect} />
      </Show>
      <Show when={showProperties()}>
        <Properties properties={properties()} selectionCount={selection().length} layers={layers().map((l) => l.name)} onSet={onSetProperties} onNotice={onPropertyNotice} />
      </Show>
    </>
  );
  /** The Bench section, drawn by `Panel`: the SolidJS one, or the one ported to Slab. */
  const benchSection = (Panel: Component<BenchPanelProps>): JSX.Element => (
    <Show when={showBench()}>
      <Panel sheet={bench()} selection={selection()} onSelect={onBenchSelect} canPrice={canPrice()} onEditPrices={() => setPricebookOpen(true)} />
    </Show>
  );
  const recoveryBar = (): JSX.Element => <RecoveryBar {...recovery.bar} />;
  /** The tabs over the drawing, drawn by `Tabs`: the SolidJS strip, or the one ported to Slab. */
  const layoutTabs = (Tabs: Component<LayoutTabsProps> = LayoutTabs): JSX.Element => (
    <Tabs
      layouts={layouts()}
      space={space()}
      onLayout={(name) => {
        // Back from the 3D view to the space that was under it: nothing is asked of the
        // engine, so the drawing is exactly as it was left.
        const from3d = stage3d();
        setStage3d(false);
        if (!from3d || name.toLowerCase() !== space().toLowerCase()) onLayout(name);
      }}
      onMenu={(name, at) => openContext({ kind: "layout", name }, at)}
      view3d={stage3d()}
      onView3d={() => setStage3d(true)}
    />
  );
  const editorRow = (): JSX.Element => (
    <div class="editor-row">
    <main class="stage">
      <CanvasView
        facade={props.facade}
        view={view}
        display={display}
        selection={selection}
        extents={() => unionRects(drawing()?.extents ?? null, display().sheet?.paper ?? null)}
        onViewChange={onViewChange}
        onNotice={setNotice}
        onPick={onPick}
        onSelectRect={onSelectRect}
        wants={wants}
        onPoint={onPoint}
        onMenu={onDrawingMenu}
        engineState={engineState}
        base={() => prompt().anchor.base}
        gripEditing={() => prompt().running === "grip"}
        onGripStart={onGripStart}
        onGripMenu={onGripMenu}
        onBeforeQuery={tellView}
        onCursor={setCursor}
      />
      {/* Over the drawing, which stays mounted under it at its own view. */}
      <Show when={stage3d()}>
        <Viewport3D execute={(command, params) => props.facade.execute(command, params)} revision={drawing()?.revision ?? 0} onNotice={setNotice} />
      </Show>
      <InlineAsk
        open={askOpen()}
        draft={assistant()?.input() ?? ""}
        onDraft={(text) => assistant()?.setInput(text)}
        selected={selection().length}
        ready={assistant()?.ready() ?? false}
        onSend={sendAsk}
        onClose={closeAsk}
        offer={prompt().running === null && !stage3d()}
        onOpen={() => setAskOpen(true)}
        shortcut={shortcutLabel("Cmd+K", isMacPlatform())}
      />
    </main>
    <SourcePanel
      open={showSource()}
      stamp={sourceStamp()}
      readSource={() => props.facade.scriptSource()}
      onApply={applySource}
      onClose={() => setShowSource(false)}
      applyShortcut={shortcutLabel("Cmd+Enter", isMacPlatform())}
    />
    </div>
  );
  /** The command line, drawn by `Line`: the SolidJS one, or the one ported to Slab. */
  const commandLine = (Line: Component<CommandLineProps> = CommandLine): JSX.Element => (
    <Show when={showCmdline()}>
      <Line prompt={prompt} notice={notice} onSubmit={onCommand} />
    </Show>
  );
  /** The assistant panel: the SolidJS one, or the one whose frame Slab draws when its document loaded. */
  const Assistant = props.slab?.Assistant ?? AssistantPane;
  const assistantPane = (): JSX.Element => (
    <Show when={showAssistant() ? assistant() : undefined} keyed>
      {(chat) => (
        <Assistant
          session={chat}
          selection={selection}
          layers={layers().map((l) => l.name)}
          bench={bench()}
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
  );
  /** The status bar, drawn by `Bar`: the SolidJS one, or the one ported to Slab. */
  const statusBar = (Bar: Component<StatusBarProps> = StatusBar): JSX.Element => (
    <Show when={showStatusbar()}>
      <Bar
        settings={settings()}
        mode={props.facade.mode}
        currentLayer={currentLayer()}
        entityCount={drawing()?.entityCount ?? 0}
        layerCount={drawing()?.layerCount ?? 0}
        cursor={cursor()}
        formatPoint={coordText}
        selectionCount={selection().length}
        onCommand={onStatusCommand}
        onSettings={(id) => openDrafting(draftingTabFor(id))}
      />
    </Show>
  );
  /** The Ring, Gem and Price Book dialogs: the SolidJS ones, or those whose body Slab draws when their documents loaded. */
  const Ring = props.slab?.Ring ?? RingDialog;
  const Gem = props.slab?.Gem ?? GemDialog;
  const PriceBook = props.slab?.PriceBook ?? PriceBookDialog;
  const Drafting = props.slab?.Drafting ?? DraftingSettings;
  const Templates = props.slab?.Templates ?? TemplateGallery;
  const overlays = (): JSX.Element => (
    <>
      <LayerManager facade={props.facade} open={layerManager()} onClose={() => setLayerManager(false)} onChanged={refresh} />
      <Ring facade={props.facade} open={jewelry() === "ring"} onClose={() => setJewelry(null)} onPlaced={onJewelryPlaced} />
      <Gem facade={props.facade} open={jewelry() === "gem"} onClose={() => setJewelry(null)} onPlaced={onJewelryPlaced} />
      <PriceBook
        facade={props.facade}
        open={pricebookOpen()}
        sheet={bench()}
        onClose={() => setPricebookOpen(false)}
        onSaved={() => {
          benchAt = null;
          readBench(drawing());
        }}
      />
      <Templates open={showTemplates()} onClose={() => setShowTemplates(false)} execute={(command, params) => props.facade.execute(command, params)} onChoose={onTemplateChoose} />
      <TechSheet open={showTechSheet()} execute={(command, params) => props.facade.execute(command, params)} revision={drawing()?.revision ?? 0} onClose={() => setShowTechSheet(false)} />
      <Drafting
        facade={props.facade}
        open={drafting().open}
        tab={drafting().tab}
        onClose={() => setDrafting((d) => ({ ...d, open: false }))}
        onApplied={refresh}
      />
      <CommandPalette open={paletteOpen} items={palette} recent={recentCommands} onRun={onPaletteRun} onClose={() => setPaletteOpen(false)} />
      <ContextMenu menu={contextMenu} onInvoke={onContextInvoke} onClose={() => setContextAt(null)} />
    </>
  );

  const slab = props.slab;
  if (slab !== undefined) {
    return (
      <div class="app" data-shell="slab">
        <slab.Shell
          regions={{
            topbar: () => topBar(slab.TopBar),
            ribbon: () => ribbon(slab.Ribbon),
            rail: () => (
              <Show when={sidebarShown()}>
                <aside class="sidebar" aria-label="Drawing">
                  {railSections()}
                  {slab.Bench === undefined ? benchSection(BenchPanel) : null}
                </aside>
              </Show>
            ),
            bench: () => <Show when={sidebarShown() && slab.Bench}>{(Bench) => benchSection(Bench())}</Show>,
            recovery: recoveryBar,
            tabs: () => layoutTabs(slab.Tabs),
            stage: editorRow,
            cmdline: () => commandLine(slab.CommandLine),
            assistant: assistantPane,
            status: () => statusBar(slab.StatusBar),
          }}
          sidebar={sidebarShown}
          assistant={showAssistant}
          toolbar={showToolbar}
          cmdline={showCmdline}
          statusbar={showStatusbar}
        />
        {overlays()}
      </div>
    );
  }

  return (
    <div class="app">
      {topBar()}
      {ribbon()}
      <div class={showAssistant() ? "workspace has-assistant" : "workspace"}>
        <Show when={sidebarShown()}>
          <aside class="sidebar" aria-label="Drawing">
            {railSections()}
            {benchSection(BenchPanel)}
          </aside>
        </Show>
        <div class="editor">
          {recoveryBar()}
          {layoutTabs()}
          {editorRow()}
          {commandLine()}
        </div>
        {assistantPane()}
      </div>
      {statusBar()}
      {overlays()}
    </div>
  );
}
