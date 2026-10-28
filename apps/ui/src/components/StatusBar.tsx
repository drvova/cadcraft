/**
 * The status bar: the layout tabs (Model plus the drawing's layouts) on the left, the drafting
 * toggles, the coordinate readout and the selection count on the right — the same order and the
 * same ids as `crates/ui-egui/src/chrome.rs`'s `status_bar`.
 *
 * A toggle click calls `onCommand(id, { on: !current })`: the shell flips the setting through the
 * engine and pushes the new `settings()` back down. Coordinates are formatted by the facade
 * (`formatPoint`), never here — no units logic in TS.
 */

import { For, Show, type JSX } from "solid-js";
import type { SettingsState } from "../facade";

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

export interface StatusBarProps {
  settings: SettingsState;
  /** The drawing's layout names in tab order (Model is rendered here, first). */
  layouts: readonly string[];
  /** "Model" or the active layout's name. */
  space: string;
  cursor: { x: number; y: number } | null;
  formatPoint: (x: number, y: number) => string;
  selectionCount: number;
  onCommand: (id: string, params?: Record<string, unknown>) => void;
  onLayout: (name: string) => void;
}

export function StatusBar(props: StatusBarProps): JSX.Element {
  const tabs = (): readonly string[] => ["Model", ...props.layouts];
  return (
    <footer class="statusbar">
      <div class="status-tabs" role="tablist" aria-label="Layouts">
        <For each={tabs()}>
          {(name) => (
            <button
              class={props.space === name ? "layout-tab is-active" : "layout-tab"}
              type="button"
              role="tab"
              aria-selected={props.space === name}
              title={name === "Model" ? "Switch to model space" : `Switch to ${name}`}
              onClick={() => props.onLayout(name)}
            >
              {name}
            </button>
          )}
        </For>
      </div>
      <div class="status-right">
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
