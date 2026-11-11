/**
 * The layers panel: `execute("layer", {})` rows with a colour swatch and on/frozen/lock toggles
 * that call `layer.set` / `layer.current`. Read-only view of the engine's state; no colour is
 * invented here — the swatch paints the engine's own `colorRgb`.
 */

import { createSignal, For, Show, type Accessor, type JSX } from "solid-js";
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

export function LayersPanel(props: LayersPanelProps): JSX.Element {
  /** The section folds to its heading, as the editor's sidebar sections do. */
  const [open, setOpen] = createSignal(true);
  return (
    <aside class={open() ? "layers" : "layers is-folded"}>
      <div class="layers-head">
        <Show when={open()} fallback={<IconButton icon="chevron-right" size="sm" title="Show the layers" onClick={() => setOpen(true)} />}>
          <IconButton icon="chevron-down" size="sm" title="Hide the layers" onClick={() => setOpen(false)} />
        </Show>
        <SectionLabel>Layers</SectionLabel>
        <span class="layers-count">{props.layers().length}</span>
      </div>
      <div class="layers-list" role="list" hidden={!open()}>
        <For each={props.layers()}>
          {(layer) => (
            <div class={layer.current ? "layer-row is-current" : "layer-row"} role="listitem">
              <span class="layer-swatch" style={{ background: rgb(layer.colorRgb) }} title={`${layer.colorName} ${layer.colorRgb.join(",")}`} />
              <Row
                title={layer.description !== "" ? layer.description : `Make ${layer.name} current`}
                onClick={() => props.onMakeCurrent(layer.name)}
              >
                <span class="layer-name-text">{layer.name}</span>
              </Row>
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
                  <ToolIcon id={layer.on ? "layer.on" : "layer.off"} />
                </button>
                <button
                  class={layer.frozen ? "toggle is-frozen" : "toggle"}
                  type="button"
                  title={layer.frozen ? "Layer is frozen" : "Layer is thawed"}
                  aria-pressed={layer.frozen}
                  onClick={() => props.onToggle(layer.name, "frozen", !layer.frozen)}
                >
                  <ToolIcon id={layer.frozen ? "layer.frozen" : "layer.thawed"} />
                </button>
                <button
                  class={layer.locked ? "toggle is-locked" : "toggle"}
                  type="button"
                  title={layer.locked ? "Layer is locked" : "Layer is unlocked"}
                  aria-pressed={layer.locked}
                  onClick={() => props.onToggle(layer.name, "locked", !layer.locked)}
                >
                  <ToolIcon id={layer.locked ? "layer.locked" : "layer.unlocked"} />
                </button>
              </span>
            </div>
          )}
        </For>
      </div>
      <div class="layers-foot" hidden={!open()}>
        <span class="hint">Click a name to make it current.</span>
      </div>
    </aside>
  );
}
