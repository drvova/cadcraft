/**
 * The status bar, as the editor's: at the start what the window is working on (which engine is
 * live, the current layer, how much the drawing holds, how much of it is selected), at the end the
 * drafting toggles and the coordinate readout. The layout tabs (Model plus the drawing's layouts)
 * are the editor tabs over the drawing: `LayoutTabs`, below, which the shell places there.
 *
 * A toggle click calls `onCommand(id, { on: !current })`: the shell flips the setting through the
 * engine and pushes the new `settings()` back down. Coordinates are formatted by the facade
 * (`formatPoint`), never here — no units logic in TS.
 */

import { createEffect, createMemo, For, Show, type JSX } from "solid-js";
import type { FacadeMode, SettingsState } from "../facade";
import { Tab } from "../ui/Tab";
import { Toggle } from "../ui/Toggle";
import { rovingBand, scrollBand } from "./ToolStrip";

/** The boolean drafting settings a status toggle can flip. */
type ToggleKey = "grid" | "snap" | "ortho" | "polar" | "isodraft" | "otrack" | "osnap" | "lwdisplay" | "transparency" | "dynmode" | "qpmode";

/**
 * One drafting toggle: the command id it invokes, its settings key, the full words (the toggle's
 * accessible name and its hint: a setting, not an action, because `aria-pressed` says whether it
 * is on), the terse face the bar draws, and the function key the engine gives the command.
 */
export interface StatusToggle {
  id: string;
  label: string;
  short: string;
  key: ToggleKey;
  shortcut?: string;
}

/** The toggles, in `chrome.rs`'s order; ids and function keys transcribed from that table. */
export const STATUS_TOGGLES: readonly StatusToggle[] = [
  { id: "grid", label: "Grid", short: "Grid", key: "grid", shortcut: "F7" },
  { id: "snap", label: "Snap mode", short: "Snap", key: "snap", shortcut: "F9" },
  { id: "ortho", label: "Ortho mode", short: "Ortho", key: "ortho", shortcut: "F8" },
  { id: "polar", label: "Polar tracking", short: "Polar", key: "polar", shortcut: "F10" },
  { id: "isodraft", label: "Isometric drafting", short: "Iso", key: "isodraft" },
  { id: "otrack", label: "Object snap tracking", short: "OTrack", key: "otrack", shortcut: "F11" },
  { id: "osnap", label: "Object snap", short: "OSnap", key: "osnap", shortcut: "F3" },
  { id: "lwdisplay", label: "Lineweight display", short: "LW", key: "lwdisplay" },
  { id: "transparencydisplay", label: "Transparency display", short: "Transp", key: "transparency" },
  { id: "dynmode", label: "Dynamic input", short: "Dyn", key: "dynmode", shortcut: "F12" },
  { id: "qpmode", label: "Quick properties", short: "QP", key: "qpmode" },
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
        // The tabs pattern with manual activation: the strip is one Tab stop (the tab in front),
        // the arrows only move the focus, and Enter or Space (the tab's own click) switches.
        // Moving does not select because a switch redraws the whole drawing, which is slow on a
        // large one: walking past three layouts must not load each of them.
        rovingBand(element, '[role="tab"]', () => element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'));
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

/** A count as it is read: grouped in threes ("1,284,019"), so a large drawing's is not a run of digits. */
const count = (n: number): string => n.toLocaleString("en-US");

/** The fewest characters a long layer name keeps in a bar too short for all of it. */
const LAYER_FLOOR = 6;

/**
 * The coordinate readout's width in characters: room for three four-digit ordinates with a sign
 * ("-1234.5678, -1234.5678, 0.0000") to start with, and the most a longer position may claim.
 */
const COORD_FLOOR = 30;
const COORD_CEILING = 48;

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

/**
 * The bar gives up room by need (chrome.css has the order and how). What can only be read stands
 * in a `status-fit` box, in which it is whole or gone; the layer's name narrows instead, and the
 * toggles wrap. Each value is read with what it is: the words a sighted reader gets from the
 * value's place are in a `status-label`, which is not drawn.
 *
 * Every hint here is the system's (`data-hint`, opening above the bar), never a native `title`.
 * A toggle is the layer's `Toggle` with the word as its face: its hint is its full name with its
 * function key as a key cap; the name is its `aria-label` and the key its `aria-keyshortcuts`.
 * The run is one Tab stop (`rovingBand` sets each key's `tabIndex`). A fact's hint is for the pointer only (a `<span>` takes no
 * focus), so it holds nothing a keyboard user needs: the fact itself is the text.
 */
export function StatusBar(props: StatusBarProps): JSX.Element {
  const coord = (): string => (props.cursor === null ? "\u2014" : props.formatPoint(props.cursor.x, props.cursor.y));
  // The readout's width in characters: the widest text it has held, so the box is widened once by
  // a drawing far from the origin and not again at every digit. Capped, so one stray position (a
  // pointer over a view zoomed out to nothing) does not hold the room for good.
  const coordWidth = createMemo<number>((widest) => Math.max(widest, Math.min([...coord()].length, COORD_CEILING)), COORD_FLOOR);
  return (
    <footer class="statusbar">
      <span class="status-fit status-fit-mode">
        <span class={props.mode.kind === "wasm" ? "status-item status-mode is-wasm" : "status-item status-mode is-mock"} data-hint={props.mode.detail} data-hint-placement="top">
          <span class="status-label">Engine: </span>
          {props.mode.kind}
        </span>
      </span>
      <span
        class="status-item status-layer"
        data-hint="Set with CLAYER"
        data-hint-placement="top"
        // How narrow the name may be squeezed (chrome.css): never to fewer letters than it has.
        style={{ "--layer-floor": Math.min([...props.currentLayer].length, LAYER_FLOOR) }}
      >
        <span class="status-label">Current layer: </span>
        {props.currentLayer}
      </span>
      <span class="status-fit status-fit-objects">
        <span class="status-item status-count" data-hint="Objects in the drawing" data-hint-placement="top">
          {props.entityCount === 1 ? "1 object" : `${count(props.entityCount)} objects`}
        </span>
      </span>
      <span class="status-fit status-fit-layers">
        <span class="status-item status-count" data-hint="Layers in the drawing" data-hint-placement="top">
          {props.layerCount === 1 ? "1 layer" : `${count(props.layerCount)} layers`}
        </span>
      </span>
      {/* A live region, there from the start so that what arrives in it is announced: the count is
          said when the selection changes, politely, and nothing is said when it empties. It is the
          last of the facts, before the toggles: what comes and goes stands where it moves nothing. */}
      <span class="status-fit status-fit-selection" role="status">
        <Show when={props.selectionCount > 0}>
          <span class="status-item status-selection" data-hint="Objects in the selection" data-hint-placement="top">
            {`${count(props.selectionCount)} selected`}
          </span>
        </Show>
      </span>
      <div class="status-toggles" role="toolbar" aria-label="Drafting settings" ref={(element) => rovingBand(element, "button")}>
        <For each={STATUS_TOGGLES}>
          {(toggle) => (
            <Toggle
              variant="text"
              size="sm"
              ariaLabel={toggle.label}
              hint={toggle.label}
              shortcut={toggle.shortcut}
              placement="top"
              pressed={props.settings[toggle.key]}
              onChange={(on) => props.onCommand(toggle.id, { on })}
            >
              {toggle.short}
            </Toggle>
          )}
        </For>
      </div>
      {/* Not a live region: the position changes with every move of the pointer. */}
      <span class="status-fit status-fit-coord">
        <span class="status-coord" data-hint="In the drawing's units" data-hint-placement="top" style={{ "--coord-ch": coordWidth() }}>
          <span class="status-label">Pointer position: </span>
          {coord()}
        </span>
      </span>
    </footer>
  );
}
