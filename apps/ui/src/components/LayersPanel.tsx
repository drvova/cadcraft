/**
 * The layers panel: `execute("layer", {})` rows with a colour swatch and on/frozen/lock toggles
 * that call `layer.set` / `layer.current`. Read-only view of the engine's state; no colour is
 * invented here — the swatch paints the engine's own `colorRgb`.
 *
 * Each state key is named for its layer and its flag ("Outline frozen") and says whether the flag
 * is set through `aria-pressed`; its tooltip keeps the sentence a pointer user reads.
 */

import { createSignal, Index, Show, type Accessor, type JSX } from "solid-js";
import type { LayerInfo } from "../facade";
import { ToolIcon } from "../icons";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { SectionLabel } from "../ui/SectionLabel";

export interface LayersPanelProps {
  layers: Accessor<LayerInfo[]>;
  currentLayer: Accessor<string>;
  onToggle: (name: string, flag: "on" | "frozen" | "locked", value: boolean) => void;
  onMakeCurrent: (name: string) => void;
}

function rgb(c: readonly [number, number, number]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** The name's hover text: the full name (a long one is clipped in the row), what a click does,
 *  and the layer's description when it has one. */
function layerHint(layer: LayerInfo): string {
  const action = layer.current ? `${layer.name} is the current layer` : `Make ${layer.name} current`;
  return layer.description !== "" ? `${action}: ${layer.description}` : action;
}

export function LayersPanel(props: LayersPanelProps): JSX.Element {
  /** The section folds to its heading, as the editor's sidebar sections do. The fold key is one
   *  element in both states (the stylesheet turns its chevron), so it keeps the keyboard's focus. */
  const [open, setOpen] = createSignal(true);
  // The rows are kept by position (`Index`), not rebuilt when the engine hands back new layer
  // records: a key pressed from the keyboard is still there, with the focus, after it has run.
  return (
    <aside class={open() ? "layers" : "layers is-folded"}>
      <div class="layers-head">
        <IconButton icon="chevron-down" size="sm" title={open() ? "Hide the layers" : "Show the layers"} onClick={() => setOpen(!open())} />
        <SectionLabel>Layers</SectionLabel>
        <span class="layers-count">{props.layers().length}</span>
      </div>
      <div class="layers-list" role="list" aria-label="Layers" hidden={!open()}>
        <Index each={props.layers()}>
          {(layer) => (
            <div class={layer().current ? "layer-row is-current" : "layer-row"} role="listitem" aria-current={layer().current ? "true" : undefined}>
              <span class="layer-swatch" role="img" aria-label={`Color ${layer().colorName}`} style={{ background: rgb(layer().colorRgb) }} title={`${layer().colorName} ${layer().colorRgb.join(",")}`} />
              <Row
                title={layerHint(layer())}
                onClick={() => props.onMakeCurrent(layer().name)}
              >
                <span class="layer-name-text">{layer().name}</span>
              </Row>
              <span
                class={layer().used ? "layer-used is-used" : "layer-used"}
                role="img"
                aria-label={layer().used ? "Has objects" : "No objects"}
                title={layer().used ? "Has objects" : "No objects"}
              />
              <span class="layer-toggles">
                <button
                  class={layer().on ? "toggle is-on" : "toggle"}
                  type="button"
                  title={layer().on ? "Layer is on" : "Layer is off"}
                  aria-label={`${layer().name} on`}
                  aria-pressed={layer().on}
                  onClick={() => props.onToggle(layer().name, "on", !layer().on)}
                >
                  <Show when={layer().on} fallback={<ToolIcon id="layer.off" />}>
                    <ToolIcon id="layer.on" />
                  </Show>
                </button>
                <button
                  class={layer().frozen ? "toggle is-frozen" : "toggle"}
                  type="button"
                  title={layer().frozen ? "Layer is frozen" : "Layer is thawed"}
                  aria-label={`${layer().name} frozen`}
                  aria-pressed={layer().frozen}
                  onClick={() => props.onToggle(layer().name, "frozen", !layer().frozen)}
                >
                  <Show when={layer().frozen} fallback={<ToolIcon id="layer.thawed" />}>
                    <ToolIcon id="layer.frozen" />
                  </Show>
                </button>
                <button
                  class={layer().locked ? "toggle is-locked" : "toggle"}
                  type="button"
                  title={layer().locked ? "Layer is locked" : "Layer is unlocked"}
                  aria-label={`${layer().name} locked`}
                  aria-pressed={layer().locked}
                  onClick={() => props.onToggle(layer().name, "locked", !layer().locked)}
                >
                  <Show when={layer().locked} fallback={<ToolIcon id="layer.unlocked" />}>
                    <ToolIcon id="layer.locked" />
                  </Show>
                </button>
              </span>
            </div>
          )}
        </Index>
      </div>
    </aside>
  );
}
