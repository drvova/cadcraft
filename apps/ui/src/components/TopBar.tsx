/**
 * The top bar: the drawing's title and dirty state from `state()`, a few counts, which facade is
 * live (wasm or mock), and Zoom extents. Pure flex layout.
 */

import { Show, type Accessor, type JSX } from "solid-js";
import type { DrawingState, FacadeMode } from "../facade";
import { Button } from "../ui/Button";

export interface TopBarProps {
  drawing: Accessor<DrawingState | null>;
  mode: FacadeMode;
  entityCount: Accessor<number>;
  currentLayer: Accessor<string>;
  onZoomExtents: () => void;
}

export function TopBar(props: TopBarProps): JSX.Element {
  const title = (): string => props.drawing()?.title ?? "Untitled";
  const dirty = (): boolean => props.drawing()?.dirty ?? false;
  const layerCount = (): number => props.drawing()?.layerCount ?? 0;
  return (
    <header class="topbar">
      <span class="doc-title" title={title()}>
        {title()}
      </span>
      <span class={dirty() ? "dirty is-dirty" : "dirty"} title={dirty() ? "Unsaved changes" : "No unsaved changes"}>
        {dirty() ? "modified" : "saved"}
      </span>
      <span class="topbar-spacer" />
      <span class="chip" title="The current layer (CLAYER)">
        layer {props.currentLayer()}
      </span>
      <span class="chip" title="Objects in the drawing">
        {props.entityCount()} objects
      </span>
      <span class="chip" title="Layers in the drawing">
        {layerCount()} layers
      </span>
      <Show when={props.drawing() !== null}>
        <span class="chip" title="The active space">
          {props.drawing()?.space ?? "model"}
        </span>
      </Show>
      <span class={props.mode.kind === "wasm" ? "chip mode is-wasm" : "chip mode is-mock"} title={props.mode.detail}>
        {props.mode.kind}
      </span>
      <Button size="sm" title="Zoom extents" onClick={() => props.onZoomExtents()}>
        Zoom extents
      </Button>
    </header>
  );
}
