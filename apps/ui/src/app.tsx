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
import { classify } from "./commands";
import { defaultFileName, downloadBytes, pickFile } from "./files";
import { TopBar } from "./components/TopBar";
import { MenuBar } from "./components/MenuBar";
import { ToolStrip } from "./components/ToolStrip";
import { StatusBar } from "./components/StatusBar";
import { AssistantPane } from "./components/AssistantPane";
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

    // Escape clears the selection (PLAN.md C6); the command line clears its own input.
    // Ctrl/Cmd+7 toggles the assistant, the desktop's ⌘7.
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === "7") {
        e.preventDefault();
        setShowAssistant((v) => !v);
        return;
      }
      if (e.key !== "Escape") return;
      if (selection().length > 0) {
        props.facade.execute("select", { clear: true });
        refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

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

  const onCommand = (text: string): void => {
    setNotice(null);
    setPrompt(props.facade.cmdline(text, prompt()));
    refresh();
  };

  /** Start a command by id, exactly as the desktop menu does; the prompt becomes interactive. */
  const startCommand = (id: string): void => {
    setNotice(null);
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

  /**
   * Zoom extents: the engine's own `zoom` command fits the drawing's extents to the canvas's
   * aspect and the facade mirrors the result into the canvas view (`view()`), so adopting the
   * view and fetching for it is the whole job.
   */
  const zoomExtents = (): void => {
    const env = props.facade.zoomExtents();
    setNotice(env.ok ? null : env.error);
    syncView();
  };

  const currentLayer = createMemo(() => drawing()?.currentLayer ?? layers().find((l) => l.current)?.name ?? "0");

  return (
    <div class="app">
      <TopBar
        drawing={drawing}
        mode={props.facade.mode}
        entityCount={() => drawing()?.entityCount ?? 0}
        currentLayer={currentLayer}
        onZoomExtents={zoomExtents}
      />
      <Show when={showMenubar()}>
        <MenuBar commands={commands()} onInvoke={onInvoke} />
      </Show>
      <Show when={showToolbar()}>
        <ToolStrip onInvoke={onInvoke} />
      </Show>
      <div class={showAssistant() ? "workspace has-assistant" : "workspace"}>
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
        <Show when={showAssistant()}>
          <AssistantPane facade={props.facade} onChanged={refresh} onClose={() => setShowAssistant(false)} />
        </Show>
        <aside class="rail">
          <Show when={showLayers()}>
            <LayersPanel layers={layers} currentLayer={currentLayer} onToggle={onLayerToggle} onMakeCurrent={onLayerCurrent} />
          </Show>
          <Show when={showProperties()}>
            <PropertiesPanel properties={properties()} selectionCount={selection().length} layers={layers().map((l) => l.name)} onSet={onSetProperties} onNotice={setNotice} />
          </Show>
        </aside>
      </div>
      <Show when={showCmdline()}>
        <CommandLine prompt={prompt} notice={notice} onSubmit={onCommand} />
      </Show>
      <Show when={showStatusbar()}>
        <StatusBar
          settings={settings()}
          layouts={layouts()}
          space={space()}
          cursor={cursor()}
          formatPoint={(x, y) => props.facade.formatPoint(x, y)}
          selectionCount={selection().length}
          onCommand={onStatusCommand}
          onLayout={onLayout}
        />
      </Show>
    </div>
  );
}
