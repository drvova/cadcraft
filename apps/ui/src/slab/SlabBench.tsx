/**
 * The Bench section drawn by Slab (`slab/bench.slab`): the same props as
 * `../components/BenchPanel`, the same sheet, the same handlers. Only the view is Slab's: the
 * lines are a typed list param, a press comes back as the `line_pressed` signal with the line's
 * key, the fold key as `fold`, and the two price buttons as `edit_prices`.
 *
 * Mounted by the Slab shell in the sidebar, after `loadSlab("bench")` has defined the element.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { BenchPanelProps } from "../components/BenchPanel";
import { benchPanelParams, pressedHandles, type BenchPanelParams } from "./bench-params";
import { attachSurface } from "./surface";
import { isSlabHost, signalDetail, type SlabHost } from "./types";

const SCALARS = ["summary", "open", "empty", "costed", "labored", "settable", "metal", "stones", "labor", "total"] as const;
const LISTS = ["lines", "warnings", "unpriced"] as const;

function apply(host: SlabHost, params: BenchPanelParams): void {
  for (const name of SCALARS) host.setParam(name, params[name]);
  for (const name of LISTS) host.setList(name, "", params[name]);
}

export function SlabBench(props: BenchPanelProps): JSX.Element {
  /** The section folds to its heading, as the rail's other sections do. */
  const [open, setOpen] = createSignal(true);
  const selected = createMemo(() => new Set(props.selection));
  const params = createMemo(() => benchPanelParams(props.sheet, selected(), props.canPrice, open()));
  let element: HTMLElement | undefined;

  onMount(() => {
    if (element === undefined || !isSlabHost(element)) return;
    const host = element;
    const detach = attachSurface(host, ["line_pressed", "fold", "edit_prices"], (name, event) => {
      if (name === "fold") setOpen(!open());
      else if (name === "edit_prices") props.onEditPrices();
      else {
        const handles = pressedHandles(props.sheet, signalDetail(event)?.item ?? "", selected());
        if (handles !== null) props.onSelect(handles);
      }
    });
    onCleanup(detach);
    createEffect(() => apply(host, params()));
  });

  return <slab-bench-panel ref={element} class="slab-bench" />;
}
