/**
 * Tooltip — the layer's one hint. The measured recipe is Cursor's hover box
 * (`.design-system/research/cursor-recipes-2026-10-28.md` §8: the chrome fill, radius 3, the .15
 * hairline, the 2px/8px shadow, 12px type) and its arrival over 0.1s.
 *
 * One box serves the whole window. It hangs off `<body>` in the viewport's own coordinates, so no
 * pane's `overflow` clips it and it never widens the page; it is placed beside whichever control
 * asks for it (below it unless the host prefers above), flipped to the other side when the
 * preferred one has no room, and held inside the window's edges.
 *
 * A control asks by carrying `data-hint`, whoever rendered it: the layer's own components set it
 * from their `title`, the `Tooltip` wrapper sets it on a host around any other control, and an
 * element outside the layer may carry the attribute itself. Beside it, `data-hint-keys` holds a
 * shortcut (drawn as a key cap after the text) and `data-hint-note` a second, quieter line (why a
 * control is disabled). A hint that only repeats what the control already shows is not drawn,
 * unless the control's label is clipped: then the hint is the full label. What the control shows
 * is its text, or the text of the one element inside it marked `data-hint-label`.
 *
 * The hint shows after a short delay under a mouse or a pen (at once, and without the fade, when
 * another hint was up a moment ago, so sweeping a tool bar reads every key), at once when the
 * keyboard moves focus onto the control, and never on touch. Escape, a press, a click, typing, a
 * scroll and a resize put it away, and it stays away while the control has a menu or a dialog
 * open. It never takes the pointer, and it is hidden from assistive tech: the control's own name
 * and description say the same words (`describeByHint` ties the description).
 */

import { createRenderEffect, onCleanup, type JSX } from "solid-js";

/** The side of the control the box prefers. It flips to the other side when this one has no room. */
export type TooltipPlacement = "top" | "bottom";

/** The attribute a control carries to ask for the hint; its value is the hint's text. */
export const HINT_ATTR = "data-hint";
/** The attribute that holds the control's shortcut, drawn as a key cap after the text. */
export const HINT_KEYS_ATTR = "data-hint-keys";
/** The attribute that holds a second, quieter line: why the control is disabled, what it will do. */
export const HINT_NOTE_ATTR = "data-hint-note";
/** The attribute on the one element inside a control that holds the label it shows, where the
 *  control's own text is more than that label (a select holds every choice, and shows one). */
export const HINT_LABEL_ATTR = "data-hint-label";
/** The attribute that names the preferred side (`bottom` when absent). */
export const HINT_PLACEMENT_ATTR = "data-hint-placement";

/** How long the pointer rests on a control before its hint shows. */
export const HINT_DELAY_MS = 400;
/** After a hint goes away, the next one under the pointer shows without the delay for this long. */
export const HINT_WARM_MS = 300;

const BOX_CLASS = "ui-tooltip";
const SHOWN_CLASS = "ui-tooltip--shown";
/** On a box that follows another within the warm window: it arrives without the fade. */
const INSTANT_CLASS = "ui-tooltip--instant";
const NOTE_CLASS = "ui-tooltip-note";
const KEYS_CLASS = "ui-kbd";
const DESCRIPTIONS_CLASS = "ui-hint-descriptions";
/** The token that holds the box off its control and off the window's edges. */
const GAP_TOKEN = "--gap-6";
/** What a control opens over the page. While focus is inside one, only its own controls hint. */
const POPUP = '[role="menu"], [role="dialog"], dialog[open]';
/** A control whose own popup is open now. */
const OPEN_POPUP = '[aria-haspopup][aria-expanded="true"]';
/** The keys that move focus. Focus that arrives any other way (a click, a dialog closing) raises no hint. */
const FOCUS_KEYS = new Set(["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "F6"]);

const KEY = "(?:F\\d{1,2}|[A-Za-z0-9]|Esc|Escape|Enter|Return|Tab|Space|Del|Delete|Backspace|Home|End|PageUp|PageDown|Up|Down|Left|Right|[,./;'\\[\\]\\\\`=-])";
/** A title that ends in its shortcut in brackets: "Undo (Ctrl+Z)", "Snap Mode (F9)", "Redo (⇧⌘Z)". */
const TRAILING_KEYS = new RegExp(`^(.*\\S)\\s*\\(((?:(?:Ctrl|Control|Shift|Alt|Option|Cmd|Meta|Win)\\+)*${KEY}|[⌃⌥⇧⌘]+${KEY})\\)$`, "u");

/** The spoken form of each key `aria-keyshortcuts` wants (the `KeyboardEvent.key` names). */
const SPOKEN_KEYS: Record<string, string> = {
  Ctrl: "Control",
  Cmd: "Meta",
  Win: "Meta",
  Option: "Alt",
  Esc: "Escape",
  Return: "Enter",
  Del: "Delete",
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  "⌃": "Control",
  "⌥": "Alt",
  "⇧": "Shift",
  "⌘": "Meta",
};

/**
 * Splits a title written the old way, with its shortcut in brackets at the end, into the text and
 * the keys. A bracket that is not a shortcut ("Attach a picture (or paste, or drop one)") stays
 * in the text. New call sites pass the shortcut by itself (`shortcut`, `data-hint-keys`).
 */
export function splitHint(title: string): { text: string; keys: string | undefined } {
  const match = TRAILING_KEYS.exec(title.trim());
  const text = match?.[1];
  const keys = match?.[2];
  return text === undefined || keys === undefined ? { text: title.trim(), keys: undefined } : { text, keys };
}

/** A shortcut as the user reads it ("Ctrl+Shift+P", "⇧⌘Z") in the form `aria-keyshortcuts` takes ("Control+Shift+P", "Shift+Meta+Z"). */
export function ariaKeyShortcuts(keys: string): string {
  // The Mac form runs its modifier glyphs together before the key; the other form joins with "+".
  const glyphs = /^[⌃⌥⇧⌘]+/u.exec(keys)?.[0] ?? "";
  return [...glyphs, ...keys.slice(glyphs.length).split("+")]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => SPOKEN_KEYS[part] ?? part)
    .join("+");
}

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

/** Text as a person compares it: trimmed, with every run of white space one space. */
const plain = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/** Whether the control, or the label directly inside it, is cut short by its own box. */
function clipped(host: Element): boolean {
  return [host, ...host.children].some((el) => el.scrollWidth > el.clientWidth);
}

export interface HintContent {
  /** The first line. */
  text: string;
  /** The shortcut after the first line, when there is one. */
  keys: string;
  /** The second, quieter line, when there is one. */
  note: string;
}

/**
 * What the box says for a control, or `null` when it has nothing to add. A clipped label comes
 * first, in full, and what the hint adds drops to the second line. A hint that only repeats the
 * label the control already shows, with no shortcut and no note, says nothing.
 */
export function hintContent(host: Element): HintContent | null {
  const hint = plain(host.getAttribute(HINT_ATTR));
  const keys = plain(host.getAttribute(HINT_KEYS_ATTR));
  const note = plain(host.getAttribute(HINT_NOTE_ATTR));
  const label = plain((host.querySelector(`[${HINT_LABEL_ATTR}]`) ?? host).textContent);
  if (label !== "" && clipped(host)) {
    const rest = [hint, note].filter((line) => line !== "" && line !== label);
    return { text: label, keys, note: rest.join(". ") };
  }
  const repeats = hint === label;
  if (hint === "" || (repeats && keys === "" && note === "")) return null;
  return { text: hint, keys, note };
}

interface HintState {
  box: HTMLElement | null;
  /** The control under the pointer, and the one the keyboard moved focus onto. */
  hovered: Element | null;
  focused: Element | null;
  /** Which of the two moved last: its control is the one the box is for. */
  latest: "pointer" | "focus";
  /** The control the box is for (shown, waiting to show, or put away until the pointer or focus moves on). */
  current: Element | null;
  /** The last key pressed was one that moves focus, and no press has followed it. */
  focusKey: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  hiddenAt: number;
}

const states = new WeakMap<Document, HintState>();

function hintHost(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(`[${HINT_ATTR}]`) : null;
}

/** The box, as a child of `parent`: the body, or the modal dialog its control is in (the top layer covers the body). */
function boxIn(doc: Document, state: HintState, parent: Element): HTMLElement {
  const box = state.box ?? doc.createElement("div");
  if (state.box === null) {
    box.className = BOX_CLASS;
    box.setAttribute("aria-hidden", "true");
    state.box = box;
  }
  if (box.parentElement !== parent) parent.appendChild(box);
  return box;
}

function putAway(state: HintState): void {
  clearTimeout(state.timer);
  state.timer = undefined;
  if (state.box?.classList.contains(SHOWN_CLASS) === true) {
    state.box.classList.remove(SHOWN_CLASS, INSTANT_CLASS);
    state.hiddenAt = Date.now();
  }
}

/**
 * Whether the control has its own menu or dialog open (`aria-haspopup` with `aria-expanded`: a
 * fold key over a region in the page's flow keeps its hint), or focus sits in a popup the control
 * is not part of.
 */
function behindPopup(doc: Document, host: Element): boolean {
  if (host.matches(OPEN_POPUP) || host.querySelector(OPEN_POPUP) !== null) return true;
  const popup = doc.activeElement?.closest(POPUP) ?? null;
  return popup !== null && !popup.contains(host);
}

function fill(doc: Document, box: HTMLElement, content: HintContent): void {
  box.textContent = content.text;
  if (content.keys !== "") {
    const keys = doc.createElement("kbd");
    keys.className = KEYS_CLASS;
    keys.textContent = content.keys;
    box.appendChild(keys);
  }
  if (content.note !== "") {
    const note = doc.createElement("span");
    note.className = NOTE_CLASS;
    note.textContent = content.note;
    box.appendChild(note);
  }
}

function show(doc: Document, state: HintState, host: Element, instant: boolean): void {
  if (state.current !== host || !host.isConnected || behindPopup(doc, host)) return;
  const content = hintContent(host);
  const view = doc.defaultView;
  if (content === null || view === null) return;
  const box = boxIn(doc, state, host.closest("dialog[open]") ?? doc.body);
  fill(doc, box, content);
  const gap = Number.parseFloat(view.getComputedStyle(box).getPropertyValue(GAP_TOKEN)) || 0;
  const prefer: TooltipPlacement = host.getAttribute(HINT_PLACEMENT_ATTR) === "top" ? "top" : "bottom";
  const at = placeHint(host.getBoundingClientRect(), box.getBoundingClientRect(), { width: view.innerWidth, height: view.innerHeight }, prefer, gap);
  box.style.left = `${at.left}px`;
  box.style.top = `${at.top}px`;
  box.classList.toggle(INSTANT_CLASS, instant);
  box.classList.add(SHOWN_CLASS);
}

/** Brings the box in line with the pointer and the focus: whichever moved last names the control. */
function sync(doc: Document, state: HintState): void {
  const host = state.latest === "focus" ? (state.focused ?? state.hovered) : (state.hovered ?? state.focused);
  if (host === state.current) return;
  putAway(state);
  state.current = host;
  if (host === null) return;
  const warm = Date.now() - state.hiddenAt < HINT_WARM_MS;
  const byFocus = state.latest === "focus" ? host === state.focused : host !== state.hovered;
  if (byFocus) show(doc, state, host, false);
  else if (warm) show(doc, state, host, true);
  else state.timer = setTimeout(() => show(doc, state, host, false), HINT_DELAY_MS);
}

/**
 * Wires the hint to a document, once: every element carrying `data-hint`, now or later, inside the
 * layer or outside it, gets it. The layer's components call this as they render, so no surface
 * has to.
 */
export function installHints(doc: Document = document): void {
  if (states.has(doc)) return;
  const state: HintState = { box: null, hovered: null, focused: null, latest: "pointer", current: null, focusKey: false, timer: undefined, hiddenAt: 0 };
  states.set(doc, state);
  doc.addEventListener("pointerover", (event) => {
    // A finger has no hover: a tap would leave the box up over the thing it just pressed.
    state.hovered = event.pointerType === "touch" ? null : hintHost(event.target);
    state.latest = "pointer";
    sync(doc, state);
  });
  doc.addEventListener("pointerout", (event) => {
    if (event.relatedTarget !== null) return;
    state.hovered = null;
    sync(doc, state);
  });
  doc.addEventListener("focusin", (event) => {
    // Only focus a key moved here: a click focuses its button too, and so does a dialog handing
    // focus back as it closes, and neither is a person asking what the control is.
    state.focused = state.focusKey ? hintHost(event.target) : null;
    if (state.focused !== null) state.latest = "focus";
    sync(doc, state);
  });
  doc.addEventListener("focusout", () => {
    state.focused = null;
    sync(doc, state);
  });
  // Dismissed, the box stays away until the pointer or the focus moves to another control.
  const dismiss = (): void => putAway(state);
  doc.addEventListener(
    "keydown",
    (event) => {
      state.focusKey = FOCUS_KEYS.has(event.key);
      if (event.key === "Escape") dismiss();
    },
    true,
  );
  doc.addEventListener(
    "pointerdown",
    () => {
      state.focusKey = false;
      dismiss();
    },
    true,
  );
  doc.addEventListener("click", dismiss, true);
  doc.addEventListener("input", dismiss, true);
  doc.addEventListener("scroll", dismiss, true);
  doc.defaultView?.addEventListener("resize", dismiss);
  doc.defaultView?.addEventListener("blur", dismiss);
}

/** The hidden element that holds every hint's words for assistive tech, one line per control. */
function descriptionsOf(doc: Document): HTMLElement {
  const found = doc.body.querySelector<HTMLElement>(`:scope > .${DESCRIPTIONS_CLASS}`);
  if (found !== null) return found;
  const made = doc.createElement("div");
  made.className = DESCRIPTIONS_CLASS;
  made.hidden = true;
  doc.body.appendChild(made);
  return made;
}

let descriptionCount = 0;

/**
 * Makes a hint the control's accessible description. The hint box is for the eye and is hidden
 * from assistive tech; this keeps the same words in a hidden line on `<body>` and points the
 * control's `aria-describedby` at it, after any ids the caller ties itself (`also`). A hint that
 * only repeats the control's name is not described twice. Call it from the control's `ref`:
 * `ref={(el) => describeByHint(el, () => props.title)}`.
 */
export function describeByHint(el: Element, text: () => string | undefined, also?: () => string | undefined): void {
  const id = `ui-hint-${(descriptionCount += 1)}`;
  let line: HTMLElement | null = null;
  let gone = false;
  const tie = (words: string, own: string | undefined): void => {
    const name = plain(el.getAttribute("aria-label") ?? el.textContent);
    if (gone || words === "" || words === name) {
      line?.remove();
      line = null;
    } else {
      // The page's document, not the control's: before it is inserted, a control cloned from a
      // template still belongs to the template's own inert document, which has no body.
      line ??= document.createElement("span");
      line.id = id;
      line.textContent = words;
      if (!line.isConnected) descriptionsOf(document).appendChild(line);
    }
    const ids = [own, line === null ? undefined : id].filter((part) => part !== undefined && part !== "").join(" ");
    if (ids === "") el.removeAttribute("aria-describedby");
    else el.setAttribute("aria-describedby", ids);
  };
  createRenderEffect(() => {
    const words = plain(text());
    const own = also?.();
    tie(words, own);
    // A `ref` runs before the control's label is in it: the name is compared again once it is.
    queueMicrotask(() => tie(words, own));
  });
  onCleanup(() => {
    gone = true;
    line?.remove();
  });
}

export interface TooltipProps {
  /** The hint. Keep it a short sentence fragment: "New chat", "Copy the code". */
  text: string;
  /** The control's shortcut as the user reads it ("Ctrl+Z", "F9"): a key cap after the text. */
  shortcut?: string;
  /** The side the box prefers: `bottom` (the default, where the platform's own hint falls, clear
   *  of the bar above a tool row) or `top`. It flips by itself when the preferred side has no
   *  room, and slides along the window's edge rather than cross it. */
  placement?: TooltipPlacement;
  /** The control the hint describes. Not a layer component: those carry the hint themselves. */
  children: JSX.Element;
}

export function Tooltip(props: TooltipProps): JSX.Element {
  if (typeof document !== "undefined") installHints();
  return (
    <span class="ui-tooltip-host" data-hint={props.text} data-hint-keys={props.shortcut} data-hint-placement={props.placement}>
      {props.children}
    </span>
  );
}
