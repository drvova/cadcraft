/**
 * The status bar drawn by Slab (`slab/statusbar.slab`): the same props as
 * `../components/StatusBar`, the same toggles' table, the same handlers. Only the view is Slab's.
 * A toggle's press comes back as the `toggle` signal with the toggle's command as the item key,
 * and runs `onCommand(id, { on: !current })` as the SolidJS bar's click does; a right click on
 * one is `toggle_settings`; `hint` and `hint_off` say which control the pointer rests on, for the
 * interface's own hint (`./chrome-hints`).
 *
 * The pointer's position is one text param, set alone: a move of the pointer over the drawing
 * changes nothing else, the position's box is of a reserved width, and the bar's own height
 * stays, so the shell around it is not solved again.
 *
 * Mounted by the Slab shell in its `status` hole, after `loadSlab("statusbar")` has defined the
 * element. When that document does not load, the SolidJS bar is shown.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { isMenuKey } from "../components/ContextMenu";
import { COORD_CEILING, COORD_FLOOR, STATUS_TOGGLES, type StatusBarProps } from "../components/StatusBar";
import { paramText } from "./bench-params";
import { attachHints, type SlabHint } from "./chrome-hints";
import { pageMeasure, type TextMeasure } from "./measure";
import { bandEnd, idOfKey, isSlabControlHost, itemOfKey, keysWithRole, nodeAt, ringForKeysOnly } from "./scene";
import { layerClipped, pressedToggle, STATUS_METRICS, statusMetrics, statusParams, toggleParams, type StatusScalars } from "./statusbar-params";
import { attachSurface } from "./surface";
import { signalDetail } from "./types";
import "./slab-chrome.css";

const SCALARS: readonly (keyof StatusScalars)[] = ["mode", "live", "layer", "layer_w", "objects", "layers", "selection", "selected", "show_mode", "show_objects", "show_layers", "show_coord", "coord_w"];

/** What a page with no canvas measures text as: a guess, so the bar still shows its words. */
const roughMeasure: TextMeasure = (_style, text, tracking = 0) => [...text].length * (7 + tracking);

export function SlabStatusBar(props: StatusBarProps): JSX.Element {
  const coord = (): string => (props.cursor === null ? "—" : props.formatPoint(props.cursor.x, props.cursor.y));
  // As the SolidJS bar: the widest text the readout has held, so its box is widened once.
  const coordChars = createMemo<number>((widest) => Math.max(widest, Math.min([...coord()].length, COORD_CEILING)), COORD_FLOOR);
  const toggles = createMemo(() => toggleParams(STATUS_TOGGLES, props.settings));
  const [width, setWidth] = createSignal(0);
  const [metrics, setMetrics] = createSignal(STATUS_METRICS);
  let element: HTMLElement | undefined;
  let frame: HTMLDivElement | undefined;

  onMount(() => {
    if (element === undefined || frame === undefined || !isSlabControlHost(element)) return;
    const host = element;
    const around = frame;
    const measure = pageMeasure() ?? roughMeasure;
    const params = createMemo(() =>
      statusParams(
        { mode: props.mode.kind, currentLayer: props.currentLayer, entityCount: props.entityCount, layerCount: props.layerCount, selectionCount: props.selectionCount, coordChars: coordChars() },
        toggles(),
        width(),
        measure,
        metrics(),
      ),
    );

    // Each hint is the SolidJS bar's: above the bar, a toggle's with its function key.
    const hintFor = (key: string): SlabHint | null => {
      const toggle = pressedToggle(STATUS_TOGGLES, itemOfKey(key));
      if (toggle !== null) return { text: toggle.label, ...(toggle.shortcut === undefined ? {} : { keys: toggle.shortcut }), shows: toggle.short, placement: "top" };
      switch (idOfKey(key)) {
        case "mode":
          return { text: props.mode.detail, placement: "top" };
        case "layer":
          // A name the bar cuts is said whole, as a clipped label's hint is anywhere else.
          return layerClipped(props.currentLayer, params().scalars.layer_w, measure) ? { text: paramText(props.currentLayer), note: "Set with CLAYER", placement: "top" } : { text: "Set with CLAYER", placement: "top" };
        case "objects":
          return { text: "Objects in the drawing", placement: "top" };
        case "layers":
          return { text: "Layers in the drawing", placement: "top" };
        case "selection":
          return props.selectionCount > 0 ? { text: "Objects in the selection", placement: "top" } : null;
        case "coord":
          return { text: "In the drawing's units", placement: "top" };
        default:
          return null;
      }
    };
    const hints = attachHints(host, around, hintFor);

    const detach = attachSurface(host, ["toggle", "toggle_settings", "hint", "hint_off"], (name, event) => {
      const detail = signalDetail(event);
      if (name === "hint") hints.over(detail?.meta.key ?? null);
      else if (name === "hint_off") hints.over(null);
      else {
        const toggle = pressedToggle(STATUS_TOGGLES, detail?.item ?? "");
        if (toggle === null) return;
        if (name === "toggle") props.onCommand(toggle.id, { on: !props.settings[toggle.key] });
        else props.onSettings?.(toggle.id);
      }
    });

    // The right button's menu is the document's `toggle_settings`; the page's own event is only
    // kept from opening the browser's menu over a toggle. A long press has no such signal: the
    // toggle under it is found in the scene.
    const onContextMenu = (event: MouseEvent): void => {
      if (props.onSettings === undefined) return;
      const box = host.getBoundingClientRect();
      const toggle = pressedToggle(STATUS_TOGGLES, itemOfKey(nodeAt(host, event.clientX - box.left, event.clientY - box.top, (key) => itemOfKey(key) !== "")?.key ?? ""));
      if (toggle === null) return;
      event.preventDefault();
      if (event instanceof PointerEvent && event.pointerType === "touch") props.onSettings(toggle.id);
    };
    // Home and End go to the first and the last toggle, as in the SolidJS bar. The menu key and
    // Shift+F10 with the keyboard on a toggle: that toggle's settings.
    const onKeyDown = (event: KeyboardEvent): void => {
      const end = bandEnd(host, "switch", event);
      if (end !== null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        host.setFocus(end, true);
        return;
      }
      if (!isMenuKey(event) || props.onSettings === undefined) return;
      const toggle = pressedToggle(STATUS_TOGGLES, itemOfKey(host.focusedKey() ?? ""));
      if (toggle === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) props.onSettings(toggle.id);
    };
    host.addEventListener("contextmenu", onContextMenu);
    host.addEventListener("keydown", onKeyDown, true);

    // The document's tokens can be read once it has solved a frame. Under a finger the toggles
    // are wider (the document's `when coarse`), and the fold is worked out with that.
    const coarse = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
    const readMetrics = (): void => {
      setMetrics(statusMetrics((path) => host.getToken(path), coarse?.matches === true));
    };
    coarse?.addEventListener("change", readMetrics);
    const onFirstFrame = (): void => {
      host.removeEventListener("slab-frame", onFirstFrame);
      readMetrics();
    };
    host.addEventListener("slab-frame", onFirstFrame);

    const calm = ringForKeysOnly(host);

    // The run was broken anew (`toggleLines`): every line is a new item to the kernel, and its
    // focus went with the old ones. Once the new lines are laid out, it is put back on the
    // toggle it was on, with the ring if the keyboard is in the bar.
    let refocus: string | null = null;
    let breaks = "";
    const onFrame = (): void => {
      if (refocus === null) return;
      const id = refocus;
      const key = keysWithRole(host, "switch").find((k) => itemOfKey(k) === id);
      if (key === undefined) return;
      refocus = null;
      host.setFocus(key, host.matches(":focus"));
    };
    host.addEventListener("slab-frame", onFrame);

    const sizes = new ResizeObserver(() => setWidth(around.clientWidth));
    sizes.observe(around);
    setWidth(around.clientWidth);

    onCleanup(() => {
      detach();
      hints.detach();
      sizes.disconnect();
      coarse?.removeEventListener("change", readMetrics);
      calm();
      host.removeEventListener("slab-frame", onFrame);
      host.removeEventListener("contextmenu", onContextMenu);
      host.removeEventListener("keydown", onKeyDown, true);
      host.removeEventListener("slab-frame", onFirstFrame);
    });

    createEffect(() => {
      const next = params().scalars;
      for (const name of SCALARS) host.setParam(name, next[name]);
    });
    createEffect(() => {
      const lines = params().lines;
      const next = lines.map((line) => line.key).join(" ");
      if (next !== breaks) {
        const held = itemOfKey(host.focusedKey() ?? "");
        if (breaks !== "" && held !== "") refocus = held;
        breaks = next;
      }
      host.setList("lines", "", lines);
    });
    // Alone, so that a move of the pointer sets one param and nothing else.
    createEffect(() => host.setParam("coord", paramText(coord())));
  });

  // `statusbar` is the class the menus look for to stop above the bar (`../components/Menu`).
  return (
    <div ref={frame} class="statusbar slab-status">
      <cadcraft-statusbar ref={element} class="slab-surface" />
    </div>
  );
}
