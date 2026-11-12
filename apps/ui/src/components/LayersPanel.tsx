/**
 * The layers panel: `execute("layer", {})` rows with a colour swatch and on/frozen/lock toggles
 * that call `layer.set` / `layer.current`. Read-only view of the engine's state; no colour is
 * invented here — the swatch paints the engine's own `colorRgb`.
 *
 * Each state key is the layer's `Toggle`, named for its layer and its flag ("Outline frozen"): the
 * name does not change with the state, so a screen reader hears one key that is pressed or not,
 * never two names for one key. Its hint is what a press does now ("Freeze", "Thaw"), for the eye,
 * beside the glyph that draws the state, and its `tone` says which state is the one to notice
 * (off, frozen, locked). No native `title`: the swatch, the used mark and the count carry the
 * system's hint (`data-hint`) for the pointer, and each has its own name.
 *
 * A name too long for its track keeps both ends (`splitName`): layer names tell each other apart
 * at the end ("…-PHASE-1", "…-PHASE-2") as often as at the start. The two halves are for the eye
 * only; the row's name for assistive tech is the whole name, once, and the system's hint shows it
 * whole under the pointer and on keyboard focus.
 */

import { createSignal, Index, Show, type Accessor, type JSX } from "solid-js";
import type { LayerInfo } from "../facade";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { SectionLabel } from "../ui/SectionLabel";
import { Toggle } from "../ui/Toggle";
import { Tooltip } from "../ui/Tooltip";

export interface LayersPanelProps {
  layers: Accessor<LayerInfo[]>;
  currentLayer: Accessor<string>;
  onToggle: (name: string, flag: "on" | "frozen" | "locked", value: boolean) => void;
  onMakeCurrent: (name: string) => void;
}

function rgb(c: readonly [number, number, number]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** How many characters of a long name stay visible after the ellipsis: room for a phase, a
 *  revision or a level suffix ("PHASE-1", "-REV-12") beside a readable start in the name track. */
const NAME_TAIL = 7;

/** Right-to-left letters and explicit direction marks. A name holding any is never split: its
 *  halves would each be laid out alone, and the pieces of one right-to-left run would swap. */
const RTL_TEXT = /[֐-ࣿ‏‪-‮⁦-⁩יִ-﷿ﹰ-﻿\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * A layer name as the row draws it: a head that gives way with an ellipsis, and a tail that never
 * does. Cut between whole characters (an accent or a paired symbol stays in one piece). A short
 * name, or one with right-to-left text, is all head: it clips at its own end. A space at the cut
 * becomes a no-break space, which the edge of a box does not swallow.
 */
export function splitName(name: string): { head: string; tail: string } {
  if (RTL_TEXT.test(name)) return { head: name, tail: "" };
  const parts = Array.from(graphemes.segment(name), (part) => part.segment);
  if (parts.length <= NAME_TAIL) return { head: name, tail: "" };
  return {
    head: parts.slice(0, -NAME_TAIL).join("").replace(/ $/, " "),
    tail: parts.slice(-NAME_TAIL).join("").replace(/^ /, " "),
  };
}

/** A name inside a sentence: in quotation marks, and isolated (U+2068, U+2069) so a
 *  right-to-left name does not reorder the words around it. */
function quoted(name: string): string {
  return `“⁨${name}⁩”`;
}

/** The name's hint: the full name (a long one is clipped in the row), what a click does, and the
 *  layer's description when it has one. */
function layerHint(layer: LayerInfo): string {
  const action = layer.current ? `${quoted(layer.name)} is the current layer` : `Make ${quoted(layer.name)} current`;
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
        <IconButton icon="chevron-down" size="sm" title={open() ? "Hide the layers" : "Show the layers"} expanded={open()} controls="layers-list" onClick={() => setOpen(!open())} />
        <SectionLabel>Layers</SectionLabel>
        <span class="layers-count" data-hint={props.layers().length === 1 ? "1 layer" : `${props.layers().length} layers`}>
          {props.layers().length}
          <span class="status-label">{props.layers().length === 1 ? " layer" : " layers"}</span>
        </span>
      </div>
      <div class="layers-list" id="layers-list" role="list" aria-label="Layers" hidden={!open()}>
        <Index each={props.layers()}>
          {(layer) => (
            <div
              class={layer().current ? "layer-row is-current" : "layer-row"}
              role="listitem"
              aria-current={layer().current ? "true" : undefined}
              aria-description={layer().description !== "" ? layer().description : undefined}
            >
              <span class="layer-swatch" role="img" aria-label={`Color: ${layer().colorName}`} style={{ background: rgb(layer().colorRgb) }} data-hint={`${layer().colorName}, RGB ${layer().colorRgb.join(", ")}`} />
              <Tooltip text={layerHint(layer())}>
                <Row onClick={() => props.onMakeCurrent(layer().name)}>
                  <span class="layer-name-text">
                    <span class="layer-name-head" dir="auto" aria-hidden="true">
                      {splitName(layer().name).head}
                    </span>
                    <Show when={splitName(layer().name).tail}>
                      {(tail) => (
                        <span class="layer-name-tail" aria-hidden="true">
                          {tail()}
                        </span>
                      )}
                    </Show>
                    <span class="layer-name-full">{layer().name}</span>
                  </span>
                </Row>
              </Tooltip>
              <span
                class={layer().used ? "layer-used is-used" : "layer-used"}
                role="img"
                aria-label={layer().used ? "Has objects" : "No objects"}
                data-hint={layer().used ? "Has objects" : "No objects"}
              />
              <span class="layer-toggles">
                <Toggle
                  size="sm"
                  tone="absent"
                  icon="layer.off"
                  iconOn="layer.on"
                  ariaLabel={`${layer().name} on`}
                  hint={layer().on ? "Turn off" : "Turn on"}
                  pressed={layer().on}
                  onChange={(on) => props.onToggle(layer().name, "on", on)}
                />
                <Toggle
                  size="sm"
                  tone="info"
                  icon="layer.thawed"
                  iconOn="layer.frozen"
                  ariaLabel={`${layer().name} frozen`}
                  hint={layer().frozen ? "Thaw" : "Freeze"}
                  pressed={layer().frozen}
                  onChange={(frozen) => props.onToggle(layer().name, "frozen", frozen)}
                />
                <Toggle
                  size="sm"
                  tone="caution"
                  icon="layer.unlocked"
                  iconOn="layer.locked"
                  ariaLabel={`${layer().name} locked`}
                  hint={layer().locked ? "Unlock" : "Lock"}
                  pressed={layer().locked}
                  onChange={(locked) => props.onToggle(layer().name, "locked", locked)}
                />
              </span>
            </div>
          )}
        </Index>
      </div>
    </aside>
  );
}
