/**
 * The popup of a choice on a Slab surface: a list of values that opens over the page, anchored to
 * the part of the surface that asked for it. A Slab surface paints inside its own box, and its
 * anchored overlays (SPEC §6.10) are placed against, and clipped by, that surface: a list of
 * twenty-four values under a row at the foot of the rail has no room there. So the popup is the
 * page's own: a `role="listbox"` of the layer's `Row` in its `option` form, drawn in the menus'
 * recipe (`./slab-popup.css`), placed in the window by the same bounds a menu keeps
 * (`../menu`: above the status bar, inside the window's inset), and walked by the same keys
 * (`walkIndex`: the arrows wrap, Home and End jump, a letter goes to the next value that starts
 * with it).
 *
 * The keyboard is on the list itself while it is open, and the list says which value the keys
 * are on (`aria-activedescendant`); the value the row holds is where it opens, and carries a
 * mark. Enter or Space pick, as a press does. It asks to be closed (`onClose`) on Escape, Tab, a
 * press outside it, a scroll or a wheel outside it, a resize, and the window losing the keyboard.
 * Escape and the letters are kept from the shell (Escape there clears the selection; a letter
 * starts a command).
 *
 * What opened it owns the rest: whether it is open, where it is anchored, what a pick does, and
 * where the focus goes when it closes (a Slab surface's focus is the kernel's: `returnFocus`).
 * Nothing here knows which surface, so any Slab section can open one.
 */

import { createSignal, createUniqueId, For, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { menuBounds, walkIndex, type Box } from "../menu";
import type { TypedKey } from "../roving";
import { Row } from "../ui/Row";
import type { SlabFieldHost } from "./fields";
import "./slab-popup.css";

/** One value of the list: what is handed back, and the words shown. */
export interface PopupOption {
  value: string;
  label: string;
}

/** An open popup. A new object is a new opening. */
export interface OpenPopup {
  /** The list's accessible name: the row's label. */
  label: string;
  options: readonly PopupOption[];
  /** The value the row holds, where the list opens; null when it holds none of them (objects that disagree). */
  held: string | null;
  /** Where the part it hangs from stands in the window now; null when that part has gone. */
  anchor: () => Box | null;
}

/**
 * Why a popup asks to be closed. `escape` and `tab`: the key, on the list. `outside`: a press
 * outside it, which moves the focus itself when it lands on something that takes it. `away`: the
 * page moved under it (a scroll, a wheel, a resize) or the window lost the keyboard.
 */
export type PopupDismiss = "escape" | "tab" | "outside" | "away";

export interface SlabPopupProps {
  /** The popup to show, or null for none. */
  popup: Accessor<OpenPopup | null>;
  /** A value was chosen, by the keyboard (`byKey`) or by a pointer. The owner closes the popup. */
  onPick: (value: string, byKey: boolean) => void;
  /** The popup asks to be closed. */
  onClose: (reason: PopupDismiss) => void;
  /** Where the list is put in the page; the body when absent. A modal dialog's own popup is put in the dialog: the page behind one is inert. */
  mount?: () => Node | undefined;
}

// ---------------------------------------------------------------------------------------------
// The rules without a DOM
// ---------------------------------------------------------------------------------------------

/** Where a popup stands: its top-left corner in the window, and the most it may be tall. */
export interface PopupPlace {
  left: number;
  top: number;
  maxHeight: number;
  /** It opened above its anchor: there was no room for it below, and more above. */
  above: boolean;
}

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

/**
 * Places a popup of `size` by its anchor inside `bounds`: under the anchor, `gap` away, its end
 * on the anchor's end (the values of a panel end on one edge); above it when it does not fit
 * below and there is more room above; never taller than the room on the side it stands (the list
 * scrolls), and pulled back along the other axis to stay inside. Numbers that are not finite read
 * as 0, so a hostile box places the popup at the bounds' corner and never off the page.
 */
export function popupPlace(anchor: Box, size: { width: number; height: number }, bounds: Box, gap: number): PopupPlace {
  const a = { left: finite(anchor.left), top: finite(anchor.top), right: finite(anchor.right), bottom: finite(anchor.bottom) };
  const width = Math.max(0, finite(size.width));
  const height = Math.max(0, finite(size.height));
  const g = Math.max(0, finite(gap));
  const below = bounds.bottom - (a.bottom + g);
  const over = a.top - g - bounds.top;
  const above = height > below && over > below;
  const room = Math.max(0, above ? over : below);
  const tall = Math.min(height, room);
  const top = above ? a.top - g - tall : a.bottom + g;
  const left = Math.max(bounds.left, Math.min(a.right - width, bounds.right - width));
  return { left: Math.round(left), top: Math.round(Math.max(bounds.top, top)), maxHeight: Math.floor(room), above };
}

/** What a key pressed on the open list does; null when it is not the list's. */
export type PopupKeyAction = { kind: "move"; index: number } | { kind: "pick"; index: number } | { kind: "dismiss"; reason: "escape" | "tab" } | { kind: "none" };

/**
 * The list's keys. `active` is the option the keys are on (-1: none yet). Enter and Space pick
 * it; Escape and Tab dismiss; the arrows, Home, End and a letter move (`walkIndex`). A key that
 * is the list's but changes nothing (Enter with no option, a letter no value starts with) is
 * `none`: it is still kept from the shell. Null: a key the list leaves alone (a function key, a
 * chord of the shell's).
 */
export function popupKey(event: TypedKey, labels: readonly string[], active: number): PopupKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === "Escape") return { kind: "dismiss", reason: "escape" };
  if (event.key === "Tab") return { kind: "dismiss", reason: "tab" };
  if (event.key === "Enter" || event.key === " ") return active >= 0 && active < labels.length ? { kind: "pick", index: active } : { kind: "none" };
  const next = walkIndex(event, labels, active);
  if (next !== null) return { kind: "move", index: next };
  // A letter no value starts with, and the arrows of the other axis, are the list's to swallow.
  return [...event.key].length === 1 || event.key === "ArrowLeft" || event.key === "ArrowRight" ? { kind: "none" } : null;
}

/** The option a list opens on: the one holding the row's value; -1 when none does. */
export function heldIndex(options: readonly PopupOption[], held: string | null): number {
  return held === null ? -1 : options.findIndex((option) => option.value === held);
}

/**
 * Whether the press that closed a popup also lands on the part that opened it: that part's own
 * answer to the press (opening its popup) is then not wanted, since the press was the closing.
 * `closedAt` is when the popup was closed by a press outside it (ms, the events' clock).
 */
export function isReopen(closedAt: number | null, now: number): boolean {
  return closedAt !== null && Number.isFinite(closedAt) && now >= closedAt && now - closedAt < REOPEN_GRACE_MS;
}

/** A press ends, and its signal arrives, well inside this; a second press on purpose comes after it. */
export const REOPEN_GRACE_MS = 400;

// ---------------------------------------------------------------------------------------------
// The focus of a Slab surface
// ---------------------------------------------------------------------------------------------

/**
 * Hand the keyboard back to a part of a Slab surface. The page's focus goes to the surface's one
 * tab stop at once (the kernel's focus never left the part that opened the popup, so that stop is
 * the part), which is what lets a Tab that closed the popup go on from there. Once the next solve
 * has the scene, the kernel's focus is put on the node `find` names (the part may have been laid
 * out anew by what closed the popup), unless something else took the keyboard meanwhile (a press
 * elsewhere). `visible` shows the focus ring, as after a key.
 */
export function returnFocus(host: SlabFieldHost, find: () => string | null, visible: boolean): void {
  const doc = host.ownerDocument;
  const toStop = (): void => {
    if (doc.activeElement === host) return;
    const stop = host.shadowRoot?.querySelector('[tabindex="0"]');
    if (stop instanceof HTMLElement) stop.focus({ preventScroll: true });
  };
  toStop();
  void host.whenSettled().then(() => {
    const active = doc.activeElement;
    if (active !== null && active !== doc.body && active !== host) return;
    const key = find();
    if (key !== null) host.setFocus(key, visible);
    toStop();
  });
}

/** A part of a surface as a box of the window, from its box in the solved scene. */
export function sceneBoxInWindow(host: Element, box: { x: number; y: number; w: number; h: number }): Box {
  const rect = host.getBoundingClientRect();
  return { left: rect.left + box.x, top: rect.top + box.y, right: rect.left + box.x + box.w, bottom: rect.top + box.y + box.h };
}

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

export function SlabPopup(props: SlabPopupProps): JSX.Element {
  return (
    // One instance per opening: a popup asked for while another is open takes its place.
    <Show when={props.popup()} keyed>
      {(popup) => (
        <Portal mount={props.mount?.()}>
          <OpenList popup={popup} onPick={props.onPick} onClose={props.onClose} />
        </Portal>
      )}
    </Show>
  );
}

function OpenList(props: { popup: OpenPopup; onPick: (value: string, byKey: boolean) => void; onClose: (reason: PopupDismiss) => void }): JSX.Element {
  let list: HTMLDivElement | undefined;
  const id = createUniqueId();
  const optionId = (index: number): string => `${id}-o${index}`;
  const held = heldIndex(props.popup.options, props.popup.held);
  const [active, setActive] = createSignal(held);
  const labels = (): string[] => props.popup.options.map((option) => option.label);

  const reveal = (index: number): void => {
    const option = list?.ownerDocument.getElementById(optionId(index));
    if (option !== null && option !== undefined && typeof option.scrollIntoView === "function") option.scrollIntoView({ block: "nearest" });
  };

  const place = (): void => {
    if (list === undefined) return;
    const anchor = props.popup.anchor();
    if (anchor === null) {
      props.onClose("away");
      return;
    }
    const style = getComputedStyle(list);
    const inset = Number.parseFloat(style.paddingLeft) || 0;
    const floor = document.querySelector(".statusbar")?.getBoundingClientRect().top ?? window.innerHeight;
    // Measured at its natural height, at least as wide as what it hangs from.
    list.style.setProperty("--popup-min-w", `${Math.round(anchor.right - anchor.left)}px`);
    list.style.removeProperty("--popup-max-h");
    const box = list.getBoundingClientRect();
    const at = popupPlace(anchor, { width: box.width, height: box.height }, menuBounds(window.innerWidth, floor, inset), inset / 2);
    list.style.setProperty("--popup-x", `${at.left}px`);
    list.style.setProperty("--popup-y", `${at.top}px`);
    list.style.setProperty("--popup-max-h", `${at.maxHeight}px`);
    list.toggleAttribute("data-above", at.above);
  };

  onMount(() => {
    if (list === undefined) return;
    const box = list;
    place();
    box.focus({ preventScroll: true });
    if (held >= 0) reveal(held);

    const inside = (event: Event): boolean => event.composedPath().includes(box);
    const onPress = (event: Event): void => {
      if (!inside(event)) props.onClose("outside");
    };
    const onAway = (event: Event): void => {
      if (!inside(event)) props.onClose("away");
    };
    const onLeave = (): void => props.onClose("away");
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("scroll", onAway, true);
    document.addEventListener("wheel", onAway, { capture: true, passive: true });
    window.addEventListener("resize", onLeave);
    window.addEventListener("blur", onLeave);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("scroll", onAway, true);
      document.removeEventListener("wheel", onAway, true);
      window.removeEventListener("resize", onLeave);
      window.removeEventListener("blur", onLeave);
    });
  });

  const onKeyDown = (event: KeyboardEvent): void => {
    const action = popupKey(event, labels(), active());
    if (action === null) return;
    // The list's own: Escape must not clear the selection, nor a letter start a command.
    event.stopPropagation();
    if (action.kind === "dismiss") {
      // Tab goes on from where the owner puts the focus back; Escape ends here.
      if (action.reason === "escape") event.preventDefault();
      props.onClose(action.reason);
      return;
    }
    event.preventDefault();
    if (action.kind === "move") {
      setActive(action.index);
      reveal(action.index);
    } else if (action.kind === "pick") {
      const option = props.popup.options[action.index];
      if (option !== undefined) props.onPick(option.value, true);
    }
  };

  return (
    <div
      ref={list}
      class="slab-popup"
      role="listbox"
      tabIndex={-1}
      aria-label={props.popup.label}
      aria-activedescendant={active() >= 0 ? optionId(active()) : undefined}
      onKeyDown={onKeyDown}
      // The popup stands over the drawing's own surfaces: the browser's menu stays away from it.
      onContextMenu={(event) => event.preventDefault()}
    >
      <For each={props.popup.options}>
        {(option, index) => (
          <Row option id={optionId(index())} selected={active() === index()} onPointerMove={() => setActive(index())} onClick={(event) => props.onPick(option.value, event.detail === 0)}>
            <span class="slab-popup-label">{option.label}</span>
            <Show when={index() === held}>
              <span class="slab-popup-mark" aria-hidden="true" />
            </Show>
          </Row>
        )}
      </For>
    </div>
  );
}
