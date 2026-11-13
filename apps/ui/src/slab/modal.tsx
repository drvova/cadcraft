/**
 * The modal layer for dialogs whose body Slab draws.
 *
 * **The split.** Slab has no modal primitive: nothing in it takes the window, dims the page,
 * traps the keyboard or gives the focus back. The interface already has all of that in
 * `../ui/Dialog` (a native `<dialog>` opened with `showModal()`: the top layer, the inert page,
 * Escape, the backdrop, the title bar and its close key, the footer's keys, the focus returning
 * to the opener). So a Slab dialog *is* that dialog, and Slab draws what is inside its body: the
 * rows, their labels, the typed fields, the refusals, the engine's figures. The frame is the
 * same element in both shells, so its modality and its accessibility are the same by
 * construction, not by imitation.
 *
 * **What a surface inside the frame needs from this file**, because the driver does not do it:
 *
 * - **Tab.** The kernel walks its own focus ring on Tab and wraps at the ends: it never hands
 *   the key back, so a surface in a dialog would hold the keyboard and the footer could not be
 *   reached. And the driver gives the page one tab stop for the whole surface, with every hole
 *   after it, whatever the reading order. Neither is a form. Here Tab is taken from the kernel
 *   and from the browser both: the stops of the body (the kernel's focusable nodes and the
 *   controls mounted in holes) are put in reading order by where they stand, Tab and Shift+Tab
 *   walk them one control at a time, and at either end the focus is handed to the frame's next
 *   control (the footer's keys after the last stop, the close key before the first), where the
 *   platform's own trap takes over again.
 * - **Coming in.** Tab from the frame into the surface lands on whatever the driver last gave
 *   `tabindex=0`. It is put on the first stop (the last, with Shift).
 * - **Escape** is kept from the kernel, so the key is never marked as used and the dialog closes.
 * - **Two rings.** The kernel keeps its focus on a field while the keyboard is in a hole; its
 *   focus is cleared when a hole's control takes the page's.
 * - **A field's text.** The form holds every value; the kernel holds a field's buffer once it
 *   has been focused. The form's values are written into the buffers when they differ.
 * - **A field's focus.** As in the Piece section: arriving selects the value whole, leaving
 *   clears the scroll the kernel gave it.
 * - **The shell's keys.** A key typed in a kernel field is kept from the window (`./fields`).
 *
 * **The keyboard convention of a body**, whatever it holds (fields, ticks, buttons, tabs, a
 * table): every control is a Tab stop, in reading order, as in the SolidJS dialogs. A composite
 * is one stop, and the arrows move inside it: a strip of tabs (the tab in front is the stop;
 * Left, Right, Home and End change the page), a table (the row the keyboard is on is in the
 * walk, cell by cell; Up and Down change the row). A body says which of the kernel's focusable
 * nodes are not stops (`skip`) and where the arrows are let through to the kernel (`arrows`);
 * elsewhere an arrow on a tick or a button does nothing, where the kernel alone would walk its
 * whole ring by it. Enter and Space press the focused control (the kernel's activation); a body
 * that wants Enter to be the dialog's primary action on a tick, as a form's implicit submission
 * is, maps the key in its document.
 *
 * The standard shell imports nothing from here.
 */

import type { JSX } from "solid-js";
import { fieldKeepsKey, type SlabFieldHost } from "./fields";
import { attachSurface } from "./surface";

// ---------------------------------------------------------------------------------------------
// The order of the stops, and where Tab goes (pure: tested without a surface)
// ---------------------------------------------------------------------------------------------

/** Where a stop stands, in the window's coordinates. */
export interface StopBox {
  top: number;
  left: number;
  height: number;
}

/** Stops whose middles are this near in height are on one line, and read left to right. */
const SAME_LINE = 6;

/** The stops in reading order: down the body, and along a line. Stable for stops in one place. */
export function orderStops<T extends StopBox>(stops: readonly T[]): T[] {
  const middle = (s: StopBox): number => (Number.isFinite(s.top) ? s.top : 0) + (Number.isFinite(s.height) ? s.height : 0) / 2;
  return stops
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => {
      const dy = middle(a.stop) - middle(b.stop);
      if (Math.abs(dy) > SAME_LINE) return dy;
      const dx = (Number.isFinite(a.stop.left) ? a.stop.left : 0) - (Number.isFinite(b.stop.left) ? b.stop.left : 0);
      return dx !== 0 ? dx : a.index - b.index;
    })
    .map((entry) => entry.stop);
}

/** What a Tab press does: go to a stop of the surface, or leave it by one of its ends. */
export type TabMove = { kind: "stop"; index: number } | { kind: "leave"; forward: boolean };

/**
 * Where Tab goes from the stop at `at` among `count` (-1: the keyboard is on the surface but on
 * no stop, so the key enters at the end it came from).
 */
export function tabMove(count: number, at: number, shift: boolean): TabMove {
  if (!Number.isInteger(count) || count <= 0) return { kind: "leave", forward: !shift };
  if (!Number.isInteger(at) || at < 0 || at >= count) return { kind: "stop", index: shift ? count - 1 : 0 };
  const next = at + (shift ? -1 : 1);
  return next < 0 || next >= count ? { kind: "leave", forward: !shift } : { kind: "stop", index: next };
}

/**
 * The control of the frame the focus is handed to at an end of the surface: forward, the first
 * one after the surface (the footer), else the first of the frame; backward, the last one before
 * it (the close key), else the last of the frame. Null when the frame has no other control.
 */
export function leaveTarget<T>(before: readonly T[], after: readonly T[], forward: boolean): T | null {
  if (forward) return after[0] ?? before[0] ?? null;
  return before[before.length - 1] ?? after[after.length - 1] ?? null;
}

/**
 * The list item a node of the solved scene belongs to, from its full key (the innermost item:
 * `…/each@3~wall/…` is `wall`). Null outside a list, or for a key that is not one of ours.
 */
export function itemOfKey(key: string | null | undefined): string | null {
  if (typeof key !== "string" || key.length > 2_000) return null;
  let found: string | null = null;
  const re = /each@\d+~([a-z0-9-]{1,40})\//g;
  for (let m = re.exec(key); m !== null; m = re.exec(key)) found = m[1] ?? null;
  return found;
}

/** Whether a signal's item key is one of ours in shape (a stale or forged signal does nothing). */
export function isItemKey(value: string): boolean {
  return /^[a-z0-9-]{1,40}$/.test(value);
}

/**
 * Hand a document its params. A list is sent only when it changed: a list written again is laid
 * out again.
 */
export function applyParams<P extends object>(host: SlabFieldHost, params: P, scalars: readonly (keyof P & string)[], lists: readonly (keyof P & string)[], sent: Map<string, string>): void {
  for (const name of scalars) host.setParam(name, params[name]);
  for (const name of lists) {
    const now = JSON.stringify(params[name]);
    if (sent.get(name) === now) continue;
    if (host.setList(name, "", params[name])) sent.set(name, now);
  }
}

// ---------------------------------------------------------------------------------------------
// The surface in the frame
// ---------------------------------------------------------------------------------------------

/** The controls of the page a Tab press lands on. */
const TABBABLE = "input:not([type='hidden']), select, textarea, button, a[href], [tabindex]";

function tabbable(el: HTMLElement): boolean {
  if (el.tabIndex < 0 || el.closest("[hidden], [inert]") !== null) return false;
  return !("disabled" in el && el.disabled === true);
}

/** The scene's flag bits read here (Slab's `slir`: F_INERT, F_FOCUSABLE). */
const F_INERT = 1 << 5;
const F_FOCUSABLE = 1 << 6;

/** Whether a node of the solved scene takes the kernel's focus (the driver's own rule). */
export function acceptsFocus(node: unknown): node is { key: string } {
  if (typeof node !== "object" || node === null || !("key" in node) || typeof node.key !== "string") return false;
  const flags: unknown = "flags" in node ? node.flags : 0;
  const disabled: unknown = "disabled" in node ? node.disabled : false;
  return typeof flags === "number" && (flags & F_FOCUSABLE) !== 0 && (flags & F_INERT) === 0 && disabled !== true;
}

/** One stop of the body: a node the kernel focuses, or a control in a hole. */
interface Stop extends StopBox {
  /** The element that takes the page's focus. */
  el: HTMLElement;
  /** The node's full key; null for a control in a hole. */
  key: string | null;
  /** The node is a text field of the kernel's. */
  field: boolean;
}

export interface ModalSurfaceOptions {
  /** The document's signals the host answers, and the answer (`./surface`). */
  signals: readonly string[];
  on: (name: string, event: Event) => void;
  /** The form's value for each field, by the key of its list item. */
  values: () => ReadonlyMap<string, string>;
  /**
   * A focusable node (by full key) that is not a Tab stop: a tab behind the one in front (a strip
   * of tabs is one stop), a cell of a table's row the keyboard is not on, a node that is
   * focusable only because it holds a mapped key. Absent: every focusable node is a stop.
   */
  skip?: (key: string) => boolean;
  /**
   * Whether the arrows walk the kernel's ring from a node that is not a field (by full key).
   * Given, an arrow on a node it answers false for never reaches the kernel's walk, so a tick or
   * a button answers the arrows as the page's own do: not at all. A `keys=` binding of the
   * document on an ancestor (a strip of tabs, a table's row) still hears them only where this
   * answers true. Absent: the kernel's walk, as it was.
   */
  arrows?: (key: string) => boolean;
  /**
   * False for a body with no text field of the kernel's: nothing is synced after each frame (the
   * walk of every stop it costs grows with the scene). Absent: the fields are synced.
   */
  fields?: boolean;
}

export interface ModalSurface {
  /**
   * Put the keyboard on a stop once the scene has it: a field by its list item's key, or a
   * control mounted in a hole. With nothing given, the first stop.
   */
  focus(target?: string | HTMLElement): void;
  /** Write the form's values into the buffers of the fields that are not being typed into (the form changed). */
  sync(): void;
  dispose(): void;
}

/** How many solves a stop is waited for before the focus is given up (a dialog opens in two). */
const FOCUS_TRIES = 12;
/** The keys the kernel walks its focus ring by, besides Tab. */
const ARROWS: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
/** How long after a Tab press a focus arriving on the surface is taken to be that press's. */
const TAB_WINDOW_MS = 400;

/** Wire a dialog body's surface into the frame it stands in. Returns the handle and the undoing. */
export function attachModalSurface(host: SlabFieldHost, options: ModalSurfaceOptions): ModalSurface {
  const frame: HTMLElement = host.closest("dialog") ?? host.ownerDocument.documentElement;
  let disposed = false;

  const inside = (node: unknown): boolean => node instanceof Node && (node === host || host.contains(node) || host.shadowRoot?.contains(node) === true);

  const box = (el: HTMLElement): StopBox => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top, left: rect.left, height: rect.height };
  };

  /** The body's stops, in reading order. */
  const stops = (): Stop[] => {
    const out: Stop[] = [];
    // The kernel's focusable nodes, read from the scene (the driver marks only the one that has
    // the focus with a `tabindex`), each with its element of the driver's accessibility layer.
    const focusable = new Set<string>();
    for (const node of host.sceneSnapshot()) if (acceptsFocus(node)) focusable.add(node.key);
    if (focusable.size > 0) {
      for (const el of Array.from(host.shadowRoot?.querySelectorAll<HTMLElement>(".slab-a11y-node") ?? [])) {
        const key = el.dataset["slabKey"];
        if (key === undefined || !focusable.delete(key)) continue;
        if (options.skip?.(key) === true) continue;
        out.push({ el, key, field: el.getAttribute("role") === "textbox", ...box(el) });
      }
    }
    for (const el of Array.from(host.querySelectorAll<HTMLElement>(TABBABLE))) {
      if (tabbable(el)) out.push({ el, key: null, field: false, ...box(el) });
    }
    return orderStops(out);
  };

  /** The frame's own controls, before and after the surface. */
  const outside = (): { before: HTMLElement[]; after: HTMLElement[] } => {
    const before: HTMLElement[] = [];
    const after: HTMLElement[] = [];
    for (const el of Array.from(frame.querySelectorAll<HTMLElement>(TABBABLE))) {
      if (inside(el) || !tabbable(el)) continue;
      (host.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING ? before : after).push(el);
    }
    return { before, after };
  };

  /** The stop the keyboard is on: the hole control a key came from, else the kernel's focused node. */
  const current = (list: readonly Stop[], target: EventTarget | null): number => {
    if (target instanceof Node && target !== host && host.contains(target)) return list.findIndex((stop) => stop.key === null && (stop.el === target || stop.el.contains(target)));
    const key = host.focusedKey();
    return key === null ? -1 : list.findIndex((stop) => stop.key === key);
  };

  const reveal = (el: HTMLElement): void => {
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  // -- a field's focus and text ------------------------------------------------------------

  /** The field that had the kernel's focus at the last look. */
  let editing: string | null = null;
  const fieldKeys = (): Set<string> => new Set(stops().filter((stop) => stop.field && stop.key !== null).map((stop) => stop.key ?? ""));

  /** The kernel's focus came to a field or left one (`./SlabPiece` says why each is done). */
  const syncEditing = (): void => {
    const focused = host.focusedKey();
    const now = focused !== null && fieldKeys().has(focused) ? focused : null;
    if (now === editing) return;
    const left = editing;
    editing = now;
    if (left !== null) {
      const text = host.fieldText(left);
      if (text !== undefined) host.setFieldText(left, text);
    }
    if (now !== null) host.setCaret(now, [...(host.fieldText(now) ?? "")].length, 0);
  };

  /** Write the form's values into the buffers that hold other text. The field being typed into
   *  is left alone: its buffer is ahead of the form until its signal is answered, and it is what
   *  was typed, to the letter (the form's copy is shaped for the kernel: `./bench-params`). */
  const push = (): void => {
    const values = options.values();
    const focused = host.focusedKey();
    for (const stop of stops()) {
      if (!stop.field || stop.key === null || stop.key === focused) continue;
      const item = itemOfKey(stop.key);
      const want = item === null ? undefined : values.get(item);
      if (want !== undefined && host.fieldText(stop.key) !== want) host.setFieldText(stop.key, want);
    }
  };

  // -- moving the keyboard -----------------------------------------------------------------

  /** Put the keyboard on a stop. False when the kernel would not take the focus (a node of a
   *  scene solved while the dialog was closed, at no width: the next solve has it). */
  const focusStop = (stop: Stop): boolean => {
    if (stop.key === null) {
      // The kernel would keep its ring on the field the keyboard just left.
      host.clearFocus();
      stop.el.focus();
    } else {
      if (!host.setFocus(stop.key, true)) return false;
      // The driver mirrors the kernel's focus onto the page only while its own tree has it. A
      // field is typed into through the driver's text area, as after a press on it (typing
      // into the field's own node, made editable a frame after it took the focus, is not
      // heard); any other node takes the page's focus itself, and one that has not had it yet
      // carries no `tabindex` to take it by.
      const editor = stop.field ? host.shadowRoot?.querySelector<HTMLElement>("textarea.slab-ime") : null;
      const to = editor ?? stop.el;
      if (editor != null) editor.removeAttribute("aria-hidden");
      else if (!to.hasAttribute("tabindex")) to.tabIndex = -1;
      to.focus({ preventScroll: true });
    }
    reveal(stop.el);
    syncEditing();
    return true;
  };

  const focus = (target?: string | HTMLElement, tries = FOCUS_TRIES): void => {
    if (disposed) return;
    const list = stops();
    const stop = target === undefined ? list[0] : typeof target === "string" ? list.find((s) => s.key !== null && itemOfKey(s.key) === target) : list.find((s) => s.el === target || s.el.contains(target));
    // A stop with no width is of a scene solved while the dialog was closed.
    if (stop !== undefined && stop.el.getBoundingClientRect().width > 0 && focusStop(stop)) return;
    // The rows were just handed over, or the dialog has just opened: the next solve has them.
    if (tries > 0) void host.whenSettled().then(() => focus(target, tries - 1));
  };

  /** The last Tab press in the frame: a focus arriving on the surface just after it came by that key. */
  let tabbed: { shift: boolean; at: number } | null = null;
  const onFrameKey = (e: KeyboardEvent): void => {
    tabbed = e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey ? { shift: e.shiftKey, at: performance.now() } : null;
  };
  const onFramePointer = (): void => {
    tabbed = null;
  };
  frame.addEventListener("keydown", onFrameKey, true);
  frame.addEventListener("pointerdown", onFramePointer, true);

  // On the way in, ahead of the driver (which would hand Tab to the kernel's ring and Escape to
  // the kernel) and of `attachSurface` (which leaves Tab to the browser: right for a rail, where
  // a surface is one stop, and wrong here).
  const onKeyCapture = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && e.target === host) {
      // Unused, so the frame's `cancel` closes the dialog.
      e.stopImmediatePropagation();
      return;
    }
    if (options.arrows !== undefined && ARROWS.has(e.key) && e.target === host) {
      const focused = host.focusedKey();
      // A field's arrows are its caret's.
      if (focused !== null && !fieldKeys().has(focused) && !options.arrows(focused)) e.stopImmediatePropagation();
      return;
    }
    if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
    const list = stops();
    const move = tabMove(list.length, current(list, e.target), e.shiftKey);
    e.stopImmediatePropagation();
    if (move.kind === "stop") {
      const stop = list[move.index];
      if (stop === undefined) return;
      e.preventDefault();
      focusStop(stop);
      return;
    }
    const { before, after } = outside();
    const to = leaveTarget(before, after, move.forward);
    // With no other control in the frame the key is the browser's.
    if (to === null) return;
    e.preventDefault();
    to.focus();
  };
  host.addEventListener("keydown", onKeyCapture, true);

  const onFocusIn = (e: FocusEvent): void => {
    // A hole's control took the page's focus (a press, or Tab): the kernel's ring goes.
    if (e.target instanceof Node && e.target !== host && host.contains(e.target)) {
      if (host.focusedKey() !== null) host.clearFocus();
      syncEditing();
    }
    if (inside(e.relatedTarget)) return;
    const came = tabbed;
    tabbed = null;
    if (came === null || performance.now() - came.at > TAB_WINDOW_MS) return;
    const list = stops();
    const stop = came.shift ? list[list.length - 1] : list[0];
    if (stop !== undefined) focusStop(stop);
  };
  host.addEventListener("focusin", onFocusIn);

  // The keyboard left the surface for the frame (a footer key was pressed): the kernel drops its
  // focus with the page's, and the field it was on is left as after a blur, so that coming back
  // to it (a refusal sends the keyboard back) selects its value again.
  const onFocusOut = (e: FocusEvent): void => {
    if (inside(e.relatedTarget) || editing === null) return;
    const left = editing;
    editing = null;
    const text = host.fieldText(left);
    if (text !== undefined) host.setFieldText(left, text);
  };
  host.addEventListener("focusout", onFocusOut);

  // After the driver has had the key: a field's own keys go no further than the surface.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.target !== host) return;
    syncEditing();
    const focused = host.focusedKey();
    if (focused !== null && fieldKeys().has(focused) && fieldKeepsKey(e)) e.stopPropagation();
  };
  host.addEventListener("keydown", onKeyDown);
  const onPointerDown = (): void => syncEditing();
  host.addEventListener("pointerdown", onPointerDown);

  const afterFrame = (): void => {
    if (options.fields === false) return;
    syncEditing();
    push();
  };
  host.addEventListener("slab-frame", afterFrame);

  const detach = attachSurface(host, options.signals, options.on);

  return {
    focus: (target) => focus(target),
    sync: () => push(),
    dispose: () => {
      disposed = true;
      detach();
      frame.removeEventListener("keydown", onFrameKey, true);
      frame.removeEventListener("pointerdown", onFramePointer, true);
      host.removeEventListener("keydown", onKeyCapture, true);
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("focusout", onFocusOut);
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("slab-frame", afterFrame);
    },
  };
}

/**
 * A control of the interface mounted in a hole of a dialog body (a `Select`, a free-text
 * `Field`). The refusal standing on it is drawn by the document under the hole; the same words
 * are kept here, hidden, so the control can be described by them (`aria-describedby` reads a
 * hidden element, and cannot reach into the surface's own tree).
 */
export function ModalHole(props: { name: string; describedId: string; refusal: string | undefined; children: JSX.Element }): JSX.Element {
  return (
    <div slot={props.name} class="slab-dialog-hole">
      {props.children}
      <span id={props.describedId} hidden>
        {props.refusal ?? ""}
      </span>
    </div>
  );
}
