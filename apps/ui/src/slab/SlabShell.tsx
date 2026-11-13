/**
 * The application's outer layout drawn by Slab (`slab/shell.slab`), hosting the interface's
 * existing components in its holes. `../app.tsx` composes the same components for either shell;
 * this one hands each region to a named slot and lets the kernel place it.
 *
 * What the kernel decides: where every region is and how big, which panes show (from the same
 * switches the standard shell reads, and the window's width class), the dividers' drag, clamps
 * and keys. What this file does: measures each bar's natural height and reports it, tells the
 * kernel the width class, remembers the side panes' widths and puts them back (`./panes`), and
 * takes a pane the kernel gave no room out of the page, so nothing in it can take the focus.
 */

import { createEffect, onCleanup, onMount, type Accessor, type JSX } from "solid-js";
import { PANES_KEY, readPaneWidths, sizesMatch, targetSizes, widthClass, widthsAfterDrag, writePaneWidths, type PaneSizes, type PaneWidths } from "./panes";
import { attachSurface } from "./surface";
import { isSlabHost, type SlabHost } from "./types";
import "./slab-shell.css";

/** The regions the shell places. Each is the content of one hole of the document. */
export interface ShellRegions {
  topbar: () => JSX.Element;
  ribbon: () => JSX.Element;
  rail: () => JSX.Element;
  bench: () => JSX.Element;
  recovery: () => JSX.Element;
  tabs: () => JSX.Element;
  stage: () => JSX.Element;
  cmdline: () => JSX.Element;
  assistant: () => JSX.Element;
  status: () => JSX.Element;
}

export interface SlabShellProps {
  regions: ShellRegions;
  /** The shell's switches: the signals the standard shell shows and hides its regions by. */
  sidebar: Accessor<boolean>;
  assistant: Accessor<boolean>;
  toolbar: Accessor<boolean>;
  cmdline: Accessor<boolean>;
  statusbar: Accessor<boolean>;
}

/** The bars: a region as tall as its content, whose height the kernel is told. */
const BARS: readonly { slot: keyof ShellRegions; param: string }[] = [
  { slot: "topbar", param: "top_h" },
  { slot: "ribbon", param: "ribbon_h" },
  { slot: "recovery", param: "recovery_h" },
  { slot: "tabs", param: "tabs_h" },
  { slot: "cmdline", param: "cmd_h" },
  { slot: "status", param: "status_h" },
  { slot: "bench", param: "bench_h" },
];

/** The bars whose menus and lists open past their own edge, and how far each is raised over the rest. */
const OPEN_PAST_EDGE: readonly (readonly [keyof ShellRegions, number])[] = [
  ["topbar", 4],
  ["ribbon", 3],
  ["cmdline", 2],
  ["status", 2],
];

/** The panes' keys in the document, and the slots each pane holds. */
const WORK = "#shell/#work";
const PANES: readonly { name: keyof PaneSizes; key: string; slots: readonly (keyof ShellRegions)[] }[] = [
  { name: "side", key: `${WORK}/#side`, slots: ["rail", "bench"] },
  { name: "editor", key: `${WORK}/#editor`, slots: ["recovery", "tabs", "stage", "cmdline"] },
  { name: "chat", key: `${WORK}/#chat`, slots: ["assistant"] },
];

/** The share of the sidebar the bench sheet may take before it scrolls (interaction.css: `.bench`). */
const BENCH_SHARE = 0.4;

const tokenNumber = (host: SlabHost, path: string, fallback: number): number => {
  const value = host.getToken(path);
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
};

function loadWidths(defaults: PaneWidths): PaneWidths {
  try {
    return readPaneWidths(localStorage.getItem(PANES_KEY), defaults);
  } catch {
    return { ...defaults };
  }
}

function saveWidths(widths: PaneWidths): void {
  try {
    localStorage.setItem(PANES_KEY, writePaneWidths(widths));
  } catch {
    // Private mode or a full store: the widths last for this window only.
  }
}

export function SlabShell(props: SlabShellProps): JSX.Element {
  let element: HTMLElement | undefined;
  const slots = new Map<keyof ShellRegions, HTMLElement>();
  const slot = (name: keyof ShellRegions) => (el: HTMLElement) => {
    slots.set(name, el);
  };

  onMount(() => {
    if (element === undefined || !isSlabHost(element)) return;
    const host = element;
    let widths: PaneWidths | null = null;
    /** A divider is held: the kernel is moving the panes and is left to. */
    let dragging = false;
    let benchNatural = 0;

    const solvedPanes = (): { total: number; height: number; sizes: PaneSizes } | null => {
      const scene = host.sceneSnapshot();
      const rect = (key: string): { w: number; h: number } | undefined => scene.find((node) => node.key === key);
      const work = rect(WORK);
      if (work === undefined) return null;
      const sizes: PaneSizes = { side: 0, editor: 0, chat: 0 };
      for (const pane of PANES) sizes[pane.name] = rect(pane.key)?.w ?? 0;
      return { total: work.w, height: work.h, sizes };
    };

    /** The bench height last reported: a param that is set asks for a frame, and this is called from one. */
    let benchReported = -1;
    const reportBench = (height: number): void => {
      const next = Math.max(0, Math.min(benchNatural, Math.floor(height * BENCH_SHARE)));
      if (next === benchReported) return;
      benchReported = next;
      host.setParam("bench_h", next);
    };

    const detach = attachSurface(host, ["panes_resized"], () => {
      // A divider was let go (or moved by a key): what the panes are now is what is remembered.
      if (widths === null) return;
      const sizes: PaneSizes = { side: 0, editor: 0, chat: 0 };
      for (const pane of PANES) sizes[pane.name] = host.getSplit(pane.key);
      widths = widthsAfterDrag(widths, sizes);
      saveWidths(widths);
    });

    /**
     * The driver clips every hole (`overflow: hidden`), and a hole is painted under the ones after
     * it. A bar's menus and lists open past its edge, so the bars' holes are let out and raised:
     * without this the menu bar's menus are open and cannot be seen.
     */
    const released = new Set<HTMLElement>();
    const releaseBars = (): void => {
      for (const [name, lift] of OPEN_PAST_EDGE) {
        const hole = slots.get(name)?.assignedSlot?.parentElement;
        if (hole === null || hole === undefined || released.has(hole)) continue;
        hole.style.overflow = "visible";
        hole.style.zIndex = String(lift);
        released.add(hole);
      }
    };

    const onFrame = (): void => {
      releaseBars();
      const solved = solvedPanes();
      if (solved === null) return;
      if (widths === null) {
        // The first solved frame: the document's tokens can be read.
        widths = loadWidths({ side: tokenNumber(host, "pane.side", 252), chat: tokenNumber(host, "pane.chat", 340) });
        applyWidthClass();
      }
      reportBench(solved.height);
      // A pane the kernel gave no room is out of the page: nothing in it takes the focus or a key.
      for (const pane of PANES) {
        const gone = solved.sizes[pane.name] < 1;
        for (const name of pane.slots) {
          const el = slots.get(name);
          if (el !== undefined && el.hidden !== gone) el.hidden = gone;
        }
      }
      if (dragging) return;
      const target = targetSizes(solved.total, widths, solved.sizes);
      if (!sizesMatch(solved.sizes, target)) {
        for (const pane of PANES) host.setSplit(pane.key, target[pane.name]);
        return;
      }
      if (!host.hasAttribute("data-ready")) host.setAttribute("data-ready", "");
    };
    host.addEventListener("slab-frame", onFrame);

    const applyWidthClass = (): void => {
      if (widths === null) return;
      const cls = widthClass(host.clientWidth, tokenNumber(host, "bp.narrow", 900), tokenNumber(host, "bp.compact", 560));
      host.setParam("narrow", cls.narrow);
      host.setParam("compact", cls.compact);
    };

    const sizes = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === host) {
          applyWidthClass();
          continue;
        }
        const bar = BARS.find((b) => slots.get(b.slot) === entry.target);
        if (bar === undefined) continue;
        // The border box: a bar's own hairline is part of its height.
        const height = Math.ceil(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
        if (bar.slot === "bench") {
          benchNatural = height;
          reportBench(solvedPanes()?.height ?? 0);
        } else host.setParam(bar.param, height);
      }
    });
    sizes.observe(host);
    for (const bar of BARS) {
      const el = slots.get(bar.slot);
      if (el !== undefined) sizes.observe(el);
    }

    const onDown = (e: PointerEvent): void => {
      // The pointer went down on the surface itself (a divider), not in a hole.
      if (e.target === host) dragging = true;
    };
    const onUp = (): void => {
      dragging = false;
    };
    host.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    onCleanup(() => {
      detach();
      sizes.disconnect();
      host.removeEventListener("slab-frame", onFrame);
      host.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    });

    createEffect(() => host.setParam("sidebar", props.sidebar()));
    createEffect(() => host.setParam("assistant", props.assistant()));
    createEffect(() => host.setParam("toolbar", props.toolbar()));
    createEffect(() => host.setParam("cmdline", props.cmdline()));
    createEffect(() => host.setParam("statusbar", props.statusbar()));
  });

  return (
    <cadcraft-shell ref={element} class="slab-shell">
      <div slot="topbar" ref={slot("topbar")} class="slab-slot slab-bar">
        {props.regions.topbar()}
      </div>
      <div slot="ribbon" ref={slot("ribbon")} class="slab-slot slab-bar">
        {props.regions.ribbon()}
      </div>
      <div slot="rail" ref={slot("rail")} class="slab-slot slab-fill">
        {props.regions.rail()}
      </div>
      <div slot="bench" ref={slot("bench")} class="slab-slot slab-bar">
        {props.regions.bench()}
      </div>
      <div slot="recovery" ref={slot("recovery")} class="slab-slot slab-bar">
        {props.regions.recovery()}
      </div>
      <div slot="tabs" ref={slot("tabs")} class="slab-slot slab-bar">
        {props.regions.tabs()}
      </div>
      <div slot="stage" ref={slot("stage")} class="slab-slot slab-fill">
        {props.regions.stage()}
      </div>
      <div slot="cmdline" ref={slot("cmdline")} class="slab-slot slab-bar">
        {props.regions.cmdline()}
      </div>
      <div slot="assistant" ref={slot("assistant")} class="slab-slot slab-fill">
        {props.regions.assistant()}
      </div>
      <div slot="status" ref={slot("status")} class="slab-slot slab-bar">
        {props.regions.status()}
      </div>
    </cadcraft-shell>
  );
}
