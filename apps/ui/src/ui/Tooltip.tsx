/**
 * Tooltip — the layer's one hint. The measured recipe is Cursor's hover box
 * (`.design-system/research/cursor-recipes-2026-10-28.md` §8: the chrome fill, radius 3, the .15
 * hairline, the 2px/8px shadow, 12px type) and its arrival over 0.1s.
 *
 * One box serves the whole window. It hangs off `<body>` in the viewport's own coordinates, so no
 * pane's `overflow` clips it and it never widens the page; it is placed beside whichever control
 * asks for it (below it unless the host prefers above), flipped to the other side when the
 * preferred one has no room, and held inside the window's edges. A control asks by carrying `data-hint`: `IconButton` sets it from its `title`,
 * and the `Tooltip` wrapper sets it on a host around any other control.
 *
 * The hint shows after a short delay under a mouse or a pen (at once when another hint was up a
 * moment ago, so sweeping a tool bar reads every key), at once on keyboard focus, and never on
 * touch. Escape, a press, a click, a scroll and a resize put it away. It never takes the pointer,
 * and it is hidden from assistive tech: the control's own `aria-label` is its name, and the box
 * repeats that name for the eye.
 */

import type { JSX } from "solid-js";

/** The side of the control the box prefers. It flips to the other side when this one has no room. */
export type TooltipPlacement = "top" | "bottom";

/** The attribute a control carries to ask for the hint; its value is the hint's text. */
export const HINT_ATTR = "data-hint";
/** The attribute that names the preferred side (`bottom` when absent). */
export const HINT_PLACEMENT_ATTR = "data-hint-placement";

/** How long the pointer rests on a control before its hint shows. */
export const HINT_DELAY_MS = 400;
/** After a hint goes away, the next one under the pointer shows without the delay for this long. */
export const HINT_WARM_MS = 300;

const BOX_CLASS = "ui-tooltip";
const SHOWN_CLASS = "ui-tooltip--shown";
/** The token that holds the box off its control and off the window's edges. */
const GAP_TOKEN = "--gap-6";

export interface HintAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HintSize {
  width: number;
  height: number;
}

/**
 * Where the box goes: centred on the control on the preferred side, `gap` away from it; on the
 * other side when the preferred one would cross the window's edge and the other would not; and
 * slid along the edge it would cross so the whole box stays `gap` inside the window.
 */
export function placeHint(
  anchor: HintAnchor,
  box: HintSize,
  view: HintSize,
  prefer: TooltipPlacement,
  gap: number,
): { left: number; top: number; placement: TooltipPlacement } {
  const above = anchor.top - gap - box.height;
  const below = anchor.top + anchor.height + gap;
  const fitsAbove = above >= gap;
  const fitsBelow = below + box.height <= view.height - gap;
  const other: TooltipPlacement = prefer === "top" ? "bottom" : "top";
  const fits = { top: fitsAbove, bottom: fitsBelow };
  const placement = !fits[prefer] && fits[other] ? other : prefer;
  const centred = anchor.left + anchor.width / 2 - box.width / 2;
  const left = Math.max(gap, Math.min(centred, view.width - gap - box.width));
  const top = Math.max(gap, Math.min(placement === "top" ? above : below, view.height - gap - box.height));
  return { left: Math.round(left), top: Math.round(top), placement };
}

interface HintState {
  box: HTMLElement | null;
  /** The control under the pointer, and the one holding keyboard focus. */
  hovered: Element | null;
  focused: Element | null;
  /** The control the box is for (shown, waiting to show, or put away until the pointer or focus moves on). */
  current: Element | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  hiddenAt: number;
}

const states = new WeakMap<Document, HintState>();

function hintHost(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(`[${HINT_ATTR}]`) : null;
}

function boxOf(doc: Document, state: HintState): HTMLElement {
  if (state.box !== null && state.box.isConnected) return state.box;
  const box = doc.createElement("div");
  box.className = BOX_CLASS;
  box.setAttribute("aria-hidden", "true");
  doc.body.appendChild(box);
  state.box = box;
  return box;
}

function putAway(state: HintState): void {
  clearTimeout(state.timer);
  state.timer = undefined;
  if (state.box?.classList.contains(SHOWN_CLASS) === true) {
    state.box.classList.remove(SHOWN_CLASS);
    state.hiddenAt = Date.now();
  }
}

function show(doc: Document, state: HintState, host: Element): void {
  const text = host.getAttribute(HINT_ATTR) ?? "";
  if (state.current !== host || !host.isConnected || text === "") return;
  const view = doc.defaultView;
  if (view === null) return;
  const box = boxOf(doc, state);
  box.textContent = text;
  const gap = Number.parseFloat(view.getComputedStyle(box).getPropertyValue(GAP_TOKEN)) || 0;
  const prefer: TooltipPlacement = host.getAttribute(HINT_PLACEMENT_ATTR) === "top" ? "top" : "bottom";
  const at = placeHint(host.getBoundingClientRect(), box.getBoundingClientRect(), { width: view.innerWidth, height: view.innerHeight }, prefer, gap);
  box.style.left = `${at.left}px`;
  box.style.top = `${at.top}px`;
  box.classList.add(SHOWN_CLASS);
}

/** Brings the box in line with the pointer and the focus: the control under the pointer wins. */
function sync(doc: Document, state: HintState): void {
  const host = state.hovered ?? state.focused;
  if (host === state.current) return;
  putAway(state);
  state.current = host;
  if (host === null) return;
  const byFocus = state.hovered === null;
  const warm = Date.now() - state.hiddenAt < HINT_WARM_MS;
  if (byFocus || warm) show(doc, state, host);
  else state.timer = setTimeout(() => show(doc, state, host), HINT_DELAY_MS);
}

/**
 * Wires the hint to a document, once: every control carrying `data-hint`, now or later, gets it.
 * `IconButton` and `Tooltip` call this as they render, so no surface has to.
 */
export function installHints(doc: Document = document): void {
  if (states.has(doc)) return;
  const state: HintState = { box: null, hovered: null, focused: null, current: null, timer: undefined, hiddenAt: 0 };
  states.set(doc, state);
  doc.addEventListener("pointerover", (event) => {
    // A finger has no hover: a tap would leave the box up over the thing it just pressed.
    state.hovered = event.pointerType === "touch" ? null : hintHost(event.target);
    sync(doc, state);
  });
  doc.addEventListener("pointerout", (event) => {
    if (event.relatedTarget !== null) return;
    state.hovered = null;
    sync(doc, state);
  });
  doc.addEventListener("focusin", (event) => {
    // Only focus the keyboard brought: a click focuses its button too, and has just put the box away.
    const host = hintHost(event.target);
    state.focused = host !== null && event.target instanceof Element && event.target.matches(":focus-visible") ? host : null;
    sync(doc, state);
  });
  doc.addEventListener("focusout", () => {
    state.focused = null;
    sync(doc, state);
  });
  // Dismissed, the box stays away until the pointer or the focus moves to another control.
  const dismiss = (): void => putAway(state);
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dismiss();
  });
  doc.addEventListener("pointerdown", dismiss, true);
  doc.addEventListener("click", dismiss, true);
  doc.addEventListener("scroll", dismiss, true);
  doc.defaultView?.addEventListener("resize", dismiss);
  doc.defaultView?.addEventListener("blur", dismiss);
}

export interface TooltipProps {
  /** The hint. Keep it a short sentence fragment: "New chat", "Copy the code". */
  text: string;
  /** The side the box prefers: `bottom` (the default, where the platform's own hint falls, clear
   *  of the bar above a tool row) or `top`. It flips by itself when the preferred side has no
   *  room, and slides along the window's edge rather than cross it. */
  placement?: TooltipPlacement;
  /** The control the hint describes. Not an `IconButton`: that one carries the hint itself. */
  children: JSX.Element;
}

export function Tooltip(props: TooltipProps): JSX.Element {
  if (typeof document !== "undefined") installHints();
  return (
    <span class="ui-tooltip-host" data-hint={props.text} data-hint-placement={props.placement}>
      {props.children}
    </span>
  );
}
