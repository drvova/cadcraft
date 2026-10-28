/**
 * The app shell: owns the session state (drawing summary, prompt, layers, display list, view)
 * and wires the four surfaces together. All engine access goes through `AppFacade`; this file
 * contains no geometry and no drawing logic.
 */

import { createMemo, createSignal, onMount, type JSX } from "solid-js";
import { AppFacade, type DrawingState, type LayerInfo } from "./facade";
import type { DisplayList } from "./display";
import { emptyPrompt, type PromptState } from "./prompt";
import { padRect, UNIT_RECT, type Rect } from "./view";
import { TopBar } from "./components/TopBar";
import { CanvasView } from "./components/CanvasView";
import { LayersPanel } from "./components/LayersPanel";
import { CommandLine } from "./components/CommandLine";

export interface AppProps {
  facade: AppFacade;
}

export function App(props: AppProps): JSX.Element {
  const [drawing, setDrawing] = createSignal<DrawingState | null>(null);
  const [prompt, setPrompt] = createSignal<PromptState>(emptyPrompt());
  const [layers, setLayers] = createSignal<LayerInfo[]>([]);
  const [display, setDisplay] = createSignal<DisplayList>({ revision: 0, bounds: UNIT_RECT, verts: [], prims: [] });
  const [view, setView] = createSignal<Rect>(UNIT_RECT);
  const [notice, setNotice] = createSignal<string | null>(null);

  /** Pull the drawing summary, the layer list and the display list from the facade. */
  const refresh = (): void => {
    setDrawing(props.facade.drawingState());
    setLayers(props.facade.layers());
    setDisplay(props.facade.displayList());
  };

  onMount(() => {
    const initial = props.facade.viewRect();
    const list = props.facade.displayList();
    setDisplay(list);
    setView(initial ?? padRect(list.bounds, 0.06));
    setPrompt(props.facade.currentPrompt());
    refresh();
    // The facade starts showing its own default view; keep the canvas on it.
    if (initial !== null) props.facade.setView(initial);
  });

  /** The canvas moved: push the view to the facade (so the engine culls) and take its list. */
  const onViewChange = (rect: Rect): void => {
    setView(rect);
    const env = props.facade.setView(rect);
    if (!env.ok) setNotice(env.error);
    setDisplay(props.facade.displayList());
  };

  const onCommand = (text: string): void => {
    setNotice(null);
    setPrompt(props.facade.cmdline(text, prompt()));
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

  // Zoom extents: the facade's canvas view is the source of truth (its `view()` is what the
  // canvas shows), and the engine's `zoom` command does not feed back into it — so the button
  // sets the view to the drawing's own bounds (from the display list) with a small margin.
  const zoomExtents = (): void => {
    const rect = padRect(props.facade.displayList().bounds, 0.06);
    const env = props.facade.setView(rect);
    if (!env.ok) {
      setNotice(env.error);
      return;
    }
    setNotice(null);
    setView(rect);
    setDisplay(props.facade.displayList());
    refresh();
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
      <div class="workspace">
        <main class="stage">
          <CanvasView facade={props.facade} view={view} display={display} onViewChange={onViewChange} onNotice={setNotice} />
        </main>
        <LayersPanel layers={layers} currentLayer={currentLayer} onToggle={onLayerToggle} onMakeCurrent={onLayerCurrent} />
      </div>
      <CommandLine prompt={prompt} notice={notice} onSubmit={onCommand} />
    </div>
  );
}
