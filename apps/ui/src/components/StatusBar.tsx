/**
 * The status bar, as the editor's: on the left what the window is working on (which engine is
 * live, the current layer, how much the drawing holds), on the right the drafting toggles, the
 * coordinate readout and the selection count. The layout tabs (Model plus the drawing's layouts)
 * are the editor tabs over the drawing: `LayoutTabs`, below, which the shell places there.
 *
 * A toggle click calls `onCommand(id, { on: !current })`: the shell flips the setting through the
 * engine and pushes the new `settings()` back down. Coordinates are formatted by the facade
 * (`formatPoint`), never here — no units logic in TS.
 */

import { createEffect, For, Show, type JSX } from "solid-js";
import type { FacadeMode, SettingsState } from "../facade";
import { Tab } from "../ui/Tab";
import { scrollBand } from "./ToolStrip";

/** The boolean drafting settings a status toggle can flip. */
type ToggleKey = "grid" | "snap" | "ortho" | "polar" | "isodraft" | "otrack" | "osnap" | "lwdisplay" | "transparency" | "dynmode" | "qpmode";

/** One drafting toggle: the command id it invokes, the desktop's tooltip, and its settings key. */
export interface StatusToggle {
  id: string;
  label: string;
  short: string;
  key: ToggleKey;
}

/** The toggles, in `chrome.rs`'s order; ids and tooltips transcribed from that table. */
export const STATUS_TOGGLES: readonly StatusToggle[] = [
  { id: "grid", label: "Grid (F7)", short: "Grid", key: "grid" },
  { id: "snap", label: "Snap Mode (F9)", short: "Snap", key: "snap" },
  { id: "ortho", label: "Ortho Mode (F8)", short: "Ortho", key: "ortho" },
  { id: "polar", label: "Polar Tracking (F10)", short: "Polar", key: "polar" },
  { id: "isodraft", label: "Isometric Drafting", short: "Iso", key: "isodraft" },
  { id: "otrack", label: "Object Snap Tracking (F11)", short: "OTrack", key: "otrack" },
  { id: "osnap", label: "Object Snap (F3)", short: "OSnap", key: "osnap" },
  { id: "lwdisplay", label: "Show/Hide Lineweight", short: "LW", key: "lwdisplay" },
  { id: "transparencydisplay", label: "Show/Hide Transparency", short: "Transp", key: "transparency" },
  { id: "dynmode", label: "Dynamic Input (F12)", short: "Dyn", key: "dynmode" },
  { id: "qpmode", label: "Quick Properties", short: "QP", key: "qpmode" },
];

export interface LayoutTabsProps {
  /** The drawing's layout names in tab order (Model is rendered here, first). */
  layouts: readonly string[];
  /** "Model" or the active layout's name. */
  space: string;
  onLayout: (name: string) => void;
}

/** The editor tabs over the drawing: Model, then each layout; the active one is the pane's fill. */
export function LayoutTabs(props: LayoutTabsProps): JSX.Element {
  const tabs = (): readonly string[] => ["Model", ...props.layouts];
  let strip: HTMLDivElement | undefined;
  let mark: (() => void) | undefined;
  // A strip longer than the pane scrolls: when the layouts or the one in front change (a layout
  // made or switched to from the command line), bring the tab in front into view and re-mark the
  // clipped edges.
  createEffect(() => {
    const front = tabs().indexOf(props.space);
    strip?.children.item(front)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    mark?.();
  });
  return (
    <div
      class="editor-tabs"
      role="tablist"
      aria-label="Layouts"
      ref={(element) => {
        strip = element;
        mark = scrollBand(element);
      }}
    >
      <For each={tabs()}>
        {(name) => (
          <Tab size="md" selected={props.space === name} title={name === "Model" ? "Switch to model space" : `Switch to ${name}`} onClick={() => props.onLayout(name)}>
            {name}
          </Tab>
        )}
      </For>
    </div>
  );
}

export interface StatusBarProps {
  settings: SettingsState;
  /** Which engine is live (the wasm facade, or the mock). */
  mode: FacadeMode;
  currentLayer: string;
  entityCount: number;
  layerCount: number;
  cursor: { x: number; y: number } | null;
  formatPoint: (x: number, y: number) => string;
  selectionCount: number;
  onCommand: (id: string, params?: Record<string, unknown>) => void;
}

export function StatusBar(props: StatusBarProps): JSX.Element {
  return (
    <footer class="statusbar">
      <div class="status-left">
        <span class={props.mode.kind === "wasm" ? "status-item status-mode is-wasm" : "status-item status-mode is-mock"} title={props.mode.detail}>
          {props.mode.kind}
        </span>
        <span class="status-item status-layer" title="The current layer (CLAYER)">
          {props.currentLayer}
        </span>
        <span class="status-item status-count" title="Objects in the drawing">
          {props.entityCount === 1 ? "1 object" : `${props.entityCount} objects`}
        </span>
        <span class="status-item status-count" title="Layers in the drawing">
          {props.layerCount === 1 ? "1 layer" : `${props.layerCount} layers`}
        </span>
      </div>
      <div class="status-right">
        <div class="status-toggles" role="group" aria-label="Drafting settings" ref={scrollBand}>
          <For each={STATUS_TOGGLES}>
            {(toggle) => (
              <button
                class={props.settings[toggle.key] ? "status-toggle is-on" : "status-toggle"}
                type="button"
                title={toggle.label}
                aria-pressed={props.settings[toggle.key]}
                onClick={() => props.onCommand(toggle.id, { on: !props.settings[toggle.key] })}
              >
                {toggle.short}
              </button>
            )}
          </For>
        </div>
        <span class="status-sep" aria-hidden="true" />
        <span class="status-coord" title="Pointer position in the drawing's units">
          {props.cursor === null ? "\u2014" : props.formatPoint(props.cursor.x, props.cursor.y)}
        </span>
        <Show when={props.selectionCount > 0}>
          <span class="status-selection" title="Objects in the selection">
            {props.selectionCount} selected
          </span>
        </Show>
      </div>
    </footer>
  );
}
