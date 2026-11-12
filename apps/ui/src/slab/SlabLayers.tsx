/**
 * The Layers section drawn by Slab (`slab/layers.slab`): the same props as
 * `../components/LayersPanel`, the same layers, the same handlers. Only the view is Slab's: the
 * rows are a typed list param; the name's press comes back as `make_current` with the row's key,
 * the three keys as `toggle_on`, `toggle_frozen` and `toggle_locked`, the fold key as `fold`.
 *
 * What the document cannot do, this file does (`./hints`): the hints are the interface's own
 * tooltip, told which part the pointer or the keyboard is on; a row's quiet keys show while the
 * pointer is anywhere on the row or the keyboard is in it; a right click or the menu key asks for
 * the layer's menu (`onMenu`) at the pointer or under the row, through the same `menuPoint`; a
 * name is split into a head and a tail only when it does not fit its track (the page's face is
 * measured, as the kernel's metrics were); the list is capped at the share of the rail `.layers`
 * takes; and the three key inks are read from the page's own `Toggle` rules.
 *
 * Mounted by the Slab shell in the sidebar, after `loadSlab("layers")` has defined the element.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { isMenuKey, menuPoint } from "../components/ContextMenu";
import type { LayersPanelProps } from "../components/LayersPanel";
import { trackSurface, focusedKey, type SceneBox } from "./hints";
import { computedColor, layerAt, layersPanelParams, NO_INKS, partHint, scenePart, TOGGLE_SIGNALS, type LayerInks, type LayersPanelParams } from "./layers-params";
import { attachSurface } from "./surface";
import { isSlabHost, signalDetail, type SlabHost } from "./types";
import "./slab-layers.css";

const SCALARS = ["open", "count", "count_said", "more", "capped", "cap"] as const;

/** The share of the rail the section may take before its list scrolls (styles.css: `.layers`). */
const RAIL_SHARE = 0.55;

/** Where every key is drawn all the time: no pointer to hover with (styles.css: `.layer-toggles`). */
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

function apply(host: SlabHost, params: LayersPanelParams): void {
  for (const name of SCALARS) host.setParam(name, params[name]);
  host.setList("rows", "", params.rows);
}

const tokenNumber = (host: SlabHost, path: string): number => {
  const value = host.getToken(path);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

export function SlabLayers(props: LayersPanelProps): JSX.Element {
  /** The section folds to its heading, as the rail's other sections do. */
  const [open, setOpen] = createSignal(true);
  const [hovered, setHovered] = createSignal(-1);
  const [focused, setFocused] = createSignal(-1);
  const [fine, setFine] = createSignal(true);
  const [inks, setInks] = createSignal<LayerInks>(NO_INKS);
  /** The width of a row's name track and the list's cap, in px; 0 until the surface is measured. */
  const [track, setTrack] = createSignal(0);
  const [cap, setCap] = createSignal(0);
  let frame: HTMLDivElement | undefined;
  let element: HTMLElement | undefined;
  let inkOff: HTMLSpanElement | undefined;
  let inkFrozen: HTMLSpanElement | undefined;
  let inkLocked: HTMLSpanElement | undefined;
  /** Measures a name in the face the rows are painted in; null where the page has no canvas. */
  let measure: ((text: string) => number) | null = null;

  const fits = (name: string): boolean => measure === null || track() <= 0 || measure(name) <= track();
  const params = createMemo(() =>
    layersPanelParams(props.layers(), { open: open(), shown: [hovered(), focused()], allKeys: !fine(), fits, inks: inks(), cap: cap() }),
  );

  onMount(() => {
    if (frame === undefined || element === undefined || !isSlabHost(element)) return;
    const host = element;
    const box = frame;

    const detach = attachSurface(host, ["make_current", "toggle_on", "toggle_frozen", "toggle_locked", "fold"], (name, event) => {
      if (name === "fold") {
        setOpen(!open());
        return;
      }
      const layer = layerAt(props.layers(), signalDetail(event)?.item ?? "");
      if (layer === null) return;
      const flag = TOGGLE_SIGNALS[name];
      if (flag === undefined) props.onMakeCurrent(layer.name);
      else props.onToggle(layer.name, flag, !layer[flag]);
    });

    const rowOf = (path: readonly SceneBox[]): { index: number; box: SceneBox } | null => {
      for (const node of path) {
        const at = scenePart(node.key);
        if (at.part === "row") return { index: at.row, box: node };
      }
      return null;
    };
    const tracking = trackSurface(host, box, {
      hint: (key) => partHint(props.layers(), open(), scenePart(key)),
      over: (path) => setHovered(rowOf(path)?.index ?? -1),
      focus: (key) => setFocused(key === null ? -1 : scenePart(key).row),
    });

    /** The row a menu is asked for: under the pointer, or (no button made the event) holding the keyboard. */
    const menuRow = (event: MouseEvent): { index: number; box: SceneBox } | null => {
      const touch = event instanceof PointerEvent && event.pointerType === "touch";
      if (touch || event.button === 2) return rowOf(tracking.pathAtClient(event.clientX, event.clientY));
      const key = focusedKey(host);
      const index = key === null ? -1 : scenePart(key).row;
      const scene = tracking.scene();
      const row = scene.find((node) => {
        const at = scenePart(node.key);
        return at.part === "row" && at.row === index;
      });
      return index < 0 || row === undefined ? null : { index, box: row };
    };
    const onContextMenu = (event: MouseEvent): void => {
      if (props.onMenu === undefined) return;
      const row = menuRow(event);
      const layer = row === null ? undefined : props.layers()[row.index];
      if (row === null || layer === undefined) return;
      event.preventDefault();
      props.onMenu(layer.name, menuPoint(event, tracking.anchor(row.box)));
    };
    /** The menu key and Shift+F10, as the shell answers them on a SolidJS row: a `contextmenu` no button made. */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target !== host || !isMenuKey(event) || props.onMenu === undefined) return;
      event.preventDefault();
      if (!event.repeat) host.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    };
    host.addEventListener("contextmenu", onContextMenu);
    host.addEventListener("keydown", onKeyDown);

    const pointer = window.matchMedia(FINE_POINTER);
    const onPointerKind = (): void => {
      setFine(pointer.matches);
    };
    onPointerKind();
    pointer.addEventListener("change", onPointerKind);

    const root = document.documentElement;
    const readInks = (): void => {
      const ink = (el: HTMLElement | undefined): string | null => (el === undefined ? null : computedColor(getComputedStyle(el).color));
      const [off, frozen, locked] = [ink(inkOff), ink(inkFrozen), ink(inkLocked)];
      if (off !== null && frozen !== null && locked !== null) setInks({ off, frozen, locked });
    };
    readInks();
    const themes = new MutationObserver(readInks);
    themes.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

    // The face the rows are set in: the interface's body type, measured as the driver paints it.
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx !== null) {
      const style = getComputedStyle(root);
      ctx.font = `400 ${style.getPropertyValue("--font-body").trim()} ${style.getPropertyValue("--font-family").trim()}`;
      if ("fontKerning" in ctx) ctx.fontKerning = "none";
      measure = (text) => ctx.measureText(text).width;
    }

    const rail = box.parentElement;
    const measureRoom = (): void => {
      const start = tokenNumber(host, "layer.name-start");
      const end = tokenNumber(host, "layer.name-end");
      const head = tokenNumber(host, "size.control-h-input");
      // Before the document is loaded its tokens read 0: nothing is measured against them.
      if (end > 0) setTrack(Math.max(0, host.clientWidth - start - end));
      if (rail !== null && head > 0) setCap(Math.max(0, Math.floor(rail.clientHeight * RAIL_SHARE) - head));
    };
    const sizes = new ResizeObserver(measureRoom);
    sizes.observe(host);
    if (rail !== null) sizes.observe(rail);
    // At mount the frame may not be in the page yet (no computed style) and the document not
    // loaded (no tokens): both are read again on the surface's frames until they are there.
    const onFirstFrame = (): void => {
      measureRoom();
      if (inks() === NO_INKS) readInks();
      if (track() > 0 && inks() !== NO_INKS) host.removeEventListener("slab-frame", onFirstFrame);
    };
    host.addEventListener("slab-frame", onFirstFrame);

    onCleanup(() => {
      detach();
      tracking.detach();
      themes.disconnect();
      sizes.disconnect();
      pointer.removeEventListener("change", onPointerKind);
      host.removeEventListener("contextmenu", onContextMenu);
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("slab-frame", onFirstFrame);
    });
    createEffect(() => apply(host, params()));
  });

  return (
    <div ref={frame} class="slab-layers">
      <slab-layers-panel ref={element} />
      <span ref={inkOff} class="ui-toggle--absent slab-ink--off" hidden />
      <span ref={inkFrozen} class="ui-toggle--info slab-ink--on" hidden />
      <span ref={inkLocked} class="ui-toggle--caution slab-ink--on" hidden />
    </div>
  );
}
