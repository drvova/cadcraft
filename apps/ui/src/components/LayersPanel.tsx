/**
 * The layers panel: `execute("layer", {})` rows with a colour swatch and on/frozen/lock toggles
 * that call `layer.set` / `layer.current`. Read-only view of the engine's state; no colour is
 * invented here — the swatch paints the engine's own `colorRgb`.
 */

import { For, type Accessor, type JSX } from "solid-js";
import type { LayerInfo } from "../facade";

export interface LayersPanelProps {
  layers: Accessor<LayerInfo[]>;
  currentLayer: Accessor<string>;
  onToggle: (name: string, flag: "on" | "frozen" | "locked", value: boolean) => void;
  onMakeCurrent: (name: string) => void;
}

function rgb(c: readonly [number, number, number]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function LayersPanel(props: LayersPanelProps): JSX.Element {
  return (
    <aside class="layers">
      <div class="layers-head">
        <span class="section-label">Layers</span>
        <span class="layers-count">{props.layers().length}</span>
      </div>
      <div class="layers-list" role="list">
        <For each={props.layers()}>
          {(layer) => (
            <div class={layer.current ? "layer-row is-current" : "layer-row"} role="listitem">
              <span class="layer-swatch" style={{ background: rgb(layer.colorRgb) }} title={`${layer.colorName} ${layer.colorRgb.join(",")}`} />
              <button
                class="layer-name"
                type="button"
                title={layer.description !== "" ? layer.description : `Make ${layer.name} current`}
                onClick={() => props.onMakeCurrent(layer.name)}
              >
                {layer.name}
              </button>
              <span
                class={layer.used ? "layer-used is-used" : "layer-used"}
                title={layer.used ? "Has objects" : "No objects"}
                aria-hidden="true"
              />
              <span class="layer-toggles">
                <button
                  class={layer.on ? "toggle is-on" : "toggle"}
                  type="button"
                  title={layer.on ? "Layer is on" : "Layer is off"}
                  aria-pressed={layer.on}
                  onClick={() => props.onToggle(layer.name, "on", !layer.on)}
                >
                  <span class="dot" />
                </button>
                <button
                  class={layer.frozen ? "toggle is-frozen" : "toggle"}
                  type="button"
                  title={layer.frozen ? "Layer is frozen" : "Layer is thawed"}
                  aria-pressed={layer.frozen}
                  onClick={() => props.onToggle(layer.name, "frozen", !layer.frozen)}
                >
                  F
                </button>
                <button
                  class={layer.locked ? "toggle is-locked" : "toggle"}
                  type="button"
                  title={layer.locked ? "Layer is locked" : "Layer is unlocked"}
                  aria-pressed={layer.locked}
                  onClick={() => props.onToggle(layer.name, "locked", !layer.locked)}
                >
                  L
                </button>
              </span>
            </div>
          )}
        </For>
      </div>
      <div class="layers-foot">
        <span class="hint">Click a name to make it current.</span>
      </div>
    </aside>
  );
}
