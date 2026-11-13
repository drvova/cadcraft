/**
 * The tabs over the drawing drawn by Slab (`slab/tabs.slab`): the same props as
 * `../components/StatusBar`'s `LayoutTabs`, the same handlers. Only the view is Slab's. A press
 * comes back as the `tab_pressed` signal with the tab's item key and runs `onLayout` (or
 * `onView3d`) as the SolidJS tab's click does; a right click is `tab_menu` and asks for the tab's
 * menu at the pointer (`onMenu`), the menu key asks for it under the tab; `tab_hint` and
 * `tab_hint_off` say which tab the pointer rests on, for the interface's own hint (`./chrome-hints`).
 *
 * What the driver at the pinned commit leaves to the host, done here: the tab in front is kept
 * the strip's one Tab stop and in view; the edges that hide a tab are marked; a finger pans the
 * strip (the kernel scrolls by the wheel and the keys only).
 *
 * Mounted by the Slab shell in its `tabs` hole, after `loadSlab("tabs")` has defined the element.
 * When that document does not load, the SolidJS strip is shown.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { isMenuKey } from "../components/ContextMenu";
import type { LayoutTabsProps } from "../components/StatusBar";
import { attachHints, type SlabHint } from "./chrome-hints";
import { pageMeasure, type TextMeasure } from "./measure";
import { bandEnd, findNode, isSlabControlHost, itemOfKey, nodeAt, ringForKeysOnly, sceneNode, signalPoint } from "./scene";
import { attachSurface } from "./surface";
import { clippedEdges, pressedView, viewTabs } from "./tabs-params";
import { signalDetail } from "./types";
import "./slab-chrome.css";

/** The strip's key in the document: the row that scrolls. */
const STRIP = "#views/#strip";

/** The most characters of a name a tab shows before it clips (ui.css: `.ui-tab--md`, 24ch). */
const TAB_CAP_CH = 24;

/** How far a finger moves along the strip before the touch is a pan and no longer a press. */
const PAN_SLOP = 6;

/** What holds the focus for a while and hands it back: a menu, a dialog. */
const POPUP = '[role="menu"], dialog[open]';

const roughMeasure: TextMeasure = (_style, text) => [...text].length * 7;

/** A number a scene node carries beyond the fields `./types` lists; 0 when it carries none. */
function sceneNumber(node: object, name: string): number {
  const value: unknown = Reflect.get(node, name);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function SlabTabs(props: LayoutTabsProps): JSX.Element {
  const [cap, setCap] = createSignal(0);
  let element: HTMLElement | undefined;
  let frame: HTMLDivElement | undefined;

  onMount(() => {
    if (element === undefined || frame === undefined || !isSlabControlHost(element)) return;
    const host = element;
    const measure = pageMeasure() ?? roughMeasure;
    setCap(Math.ceil(TAB_CAP_CH * measure("body", "0")));
    const offers3d = (): boolean => props.onView3d !== undefined;
    const tabs = createMemo(() => viewTabs(props.layouts, props.space, props.view3d === true, offers3d(), cap()));
    /** The fade's width and a tab's inset, read from the document once it has solved a frame. */
    let fade = 24;
    let inset = 12;

    /** The real name of the layout a key's tab stands for; null for the 3D tab and for no tab. */
    const layoutOf = (key: string): string | null => {
      const view = pressedView(itemOfKey(key), props.layouts, offers3d());
      return view !== null && view.kind === "layout" ? view.name : null;
    };

    const hintFor = (key: string): SlabHint | null => {
      const tab = tabs().find((t) => t.key === itemOfKey(key));
      if (tab === undefined) return null;
      // A name the tab cuts is said whole, as a clipped label's hint is anywhere else.
      return measure("body", tab.name) > tab.cap - 2 * inset ? { text: tab.name, note: tab.hint } : { text: tab.hint };
    };
    const hints = attachHints(host, frame, hintFor);

    const detach = attachSurface(host, ["tab_pressed", "tab_menu", "tab_hint", "tab_hint_off"], (name, event) => {
      const detail = signalDetail(event);
      if (name === "tab_hint") hints.over(detail?.meta.key ?? null);
      else if (name === "tab_hint_off") hints.over(null);
      else if (name === "tab_pressed") {
        const view = pressedView(detail?.item ?? "", props.layouts, offers3d());
        if (view === null) return;
        if (view.kind === "3d") props.onView3d?.();
        else props.onLayout(view.name);
      } else {
        const layout = pressedView(detail?.item ?? "", props.layouts, offers3d());
        const at = signalPoint(event);
        if (layout === null || layout.kind !== "layout" || at === null) return;
        const box = host.getBoundingClientRect();
        props.onMenu?.(layout.name, { x: box.left + at.x, y: box.top + at.y, source: "pointer" });
      }
    });

    // The right button's menu is the document's `tab_menu`; the page's own event is only kept
    // from opening the browser's menu over a layout's tab. A long press has no such signal: the
    // tab under it is found in the scene.
    const onContextMenu = (event: MouseEvent): void => {
      if (props.onMenu === undefined) return;
      const box = host.getBoundingClientRect();
      const layout = layoutOf(nodeAt(host, event.clientX - box.left, event.clientY - box.top, (key) => itemOfKey(key) !== "")?.key ?? "");
      if (layout === null) return;
      event.preventDefault();
      if (event instanceof PointerEvent && event.pointerType === "touch") props.onMenu(layout, { x: event.clientX, y: event.clientY, source: "touch" });
    };
    // Home and End go to the first and the last tab, as in the SolidJS strip (the kernel would
    // scroll the strip with them and leave the focus where it was). The menu key and Shift+F10
    // with the keyboard on a layout's tab: its menu, under the tab.
    const onKeyDown = (event: KeyboardEvent): void => {
      const end = bandEnd(host, "tab", event);
      if (end !== null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        host.setFocus(end, true);
        host.reveal(end, fade);
        return;
      }
      if (!isMenuKey(event) || props.onMenu === undefined) return;
      const key = host.focusedKey() ?? "";
      const layout = layoutOf(key);
      const node = sceneNode(host, key);
      if (layout === null || node === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const box = host.getBoundingClientRect();
      props.onMenu(layout, { x: box.left + node.x, y: box.top + node.y + node.h, source: "keyboard" });
    };
    const calm = ringForKeysOnly(host);
    host.addEventListener("contextmenu", onContextMenu);
    host.addEventListener("keydown", onKeyDown, true);

    /** The tabs or the one in front changed: once they are laid out, the one in front is brought into view. */
    let reveal = true;
    let clipped = { start: false, end: false };
    let tokensRead = false;
    const onFrame = (): void => {
      if (!tokensRead) {
        tokensRead = true;
        const fadeToken = host.getToken("size.control-h-input");
        const insetToken = host.getToken("space.g12");
        if (typeof fadeToken === "number" && fadeToken > 0) fade = fadeToken;
        if (typeof insetToken === "number" && insetToken > 0) inset = insetToken;
      }
      const strip = sceneNode(host, STRIP);
      if (strip === undefined) return;
      const edges = clippedEdges(host.getScroll(STRIP, 0), strip.w, sceneNumber(strip, "content_main"));
      // Only when it changed: a param that is set asks for another frame, and this is one.
      if (edges.start !== clipped.start) host.setParam("clip_start", edges.start);
      if (edges.end !== clipped.end) host.setParam("clip_end", edges.end);
      clipped = edges;
      const front = tabs().find((tab) => tab.front)?.key;
      const node = front === undefined ? undefined : findNode(host, (key) => itemOfKey(key) === front);
      if (node === undefined) return;
      if (reveal) {
        reveal = false;
        host.reveal(node.key, fade);
      }
      // The strip is one Tab stop, and with the keyboard elsewhere it is the tab in front (the
      // driver's stop is the node the kernel's focus is on). Nothing is taken from the page. A
      // menu or a dialog that is open gives the focus back to the tab it was on, so the stop
      // stays there until it has.
      if (!host.matches(":focus-within") && host.focusedKey() !== node.key && document.querySelector(POPUP) === null) host.setFocus(node.key, false);
    };
    host.addEventListener("slab-frame", onFrame);

    // A finger along the strip pans it. The press the kernel saw go down is let go when the pan
    // starts, so the finger's release switches to nothing.
    let pan: { id: number; x: number; from: number; moved: boolean } | null = null;
    const onPanDown = (event: PointerEvent): void => {
      if (event.pointerType === "touch") pan = { id: event.pointerId, x: event.clientX, from: host.getScroll(STRIP, 0), moved: false };
    };
    const onPanMove = (event: PointerEvent): void => {
      if (pan === null || event.pointerId !== pan.id) return;
      const dx = event.clientX - pan.x;
      if (!pan.moved && Math.abs(dx) < PAN_SLOP) return;
      const from = pan.from;
      if (!pan.moved) {
        pan.moved = true;
        // The kernel is told its press is over. This is the page's event too, so the pan is
        // told from the real one by `isTrusted` (`onPanEnd`).
        host.dispatchEvent(new PointerEvent("pointercancel", { pointerId: event.pointerId, pointerType: "touch" }));
      }
      host.setScroll(STRIP, 0, Math.max(0, from - dx));
    };
    const onPanEnd = (event: PointerEvent): void => {
      if (pan !== null && event.pointerId === pan.id && event.isTrusted) pan = null;
    };
    host.addEventListener("pointerdown", onPanDown);
    host.addEventListener("pointermove", onPanMove);
    host.addEventListener("pointerup", onPanEnd);
    host.addEventListener("pointercancel", onPanEnd);

    onCleanup(() => {
      detach();
      calm();
      hints.detach();
      host.removeEventListener("contextmenu", onContextMenu);
      host.removeEventListener("keydown", onKeyDown, true);
      host.removeEventListener("slab-frame", onFrame);
      host.removeEventListener("pointerdown", onPanDown);
      host.removeEventListener("pointermove", onPanMove);
      host.removeEventListener("pointerup", onPanEnd);
      host.removeEventListener("pointercancel", onPanEnd);
    });

    createEffect(() => {
      reveal = true;
      host.setList("tabs", "", tabs());
    });
  });

  return (
    <div ref={frame} class="slab-tabs">
      <cadcraft-tabs ref={element} class="slab-surface" />
    </div>
  );
}
