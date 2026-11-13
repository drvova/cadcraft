/**
 * The interface's one hint (`../ui/Tooltip`) for the controls of a Slab surface.
 *
 * The hint is wired to the page: a control asks by carrying `data-hint`, and the box is placed
 * beside the element under the pointer or the focus. A Slab surface is one element to the page,
 * whatever it draws, so the page never sees which of its controls the pointer is on. Two things
 * make up for it:
 *
 * - **Slab says where the pointer is.** A document binds `pointer-move=` on each control with a
 *   hint and on its root; the signal names the node the pointer is over (`meta.key`), and the
 *   root's means it is over none. The host passes each to `over`.
 * - **The host stands an element there.** For the control named, an invisible element is laid
 *   over its rectangle (read from the solved scene) beside the surface, carrying the hint's
 *   attributes, and the pointer or focus event the hint listens for is sent from it. The box is
 *   then placed, timed and dismissed by `../ui/Tooltip` exactly as for any other control.
 *
 * The keyboard's focus is read from the kernel after each frame, so an arrow key that moves the
 * focus inside the surface raises the hint of the control it lands on.
 */

import { HINT_ATTR, HINT_KEYS_ATTR, HINT_NOTE_ATTR, HINT_PLACEMENT_ATTR, installHints, type TooltipPlacement } from "../ui/Tooltip";
import { sceneNode, type SlabControlHost } from "./scene";

/** What a control's hint says. */
export interface SlabHint {
  /** The first line. */
  text: string;
  /** The control's shortcut, drawn as a key cap. */
  keys?: string;
  /** A second, quieter line. */
  note?: string;
  /** The words the control already draws: a hint that only repeats them is not shown. */
  shows?: string;
  placement?: TooltipPlacement;
}

/** The most controls of one surface that keep a stand-in element (a bar has a dozen). */
const MAX_ANCHORS = 64;

const ANCHOR_CLASS = "slab-hint-anchor";

export interface SlabHints {
  /** The pointer is over the control with this key, or (null) over none of the surface's. */
  over: (key: string | null) => void;
  detach: () => void;
}

/**
 * Give the controls of `host` the interface's hint. `frame` is the positioned element the surface
 * stands in (the stand-ins are laid in it); `hintFor` says what a control's hint is, by its key,
 * or null for a node that has none.
 */
export function attachHints(host: SlabControlHost, frame: HTMLElement, hintFor: (key: string) => SlabHint | null): SlabHints {
  installHints(host.ownerDocument);
  const anchors = new Map<string, HTMLElement>();
  let hovered: string | null = null;
  let focused: string | null = null;
  let pointerType = "mouse";

  const anchorFor = (key: string): HTMLElement | null => {
    const hint = hintFor(key);
    const node = sceneNode(host, key);
    if (hint === null || node === undefined) return null;
    let anchor = anchors.get(key);
    if (anchor === undefined) {
      if (anchors.size >= MAX_ANCHORS) {
        for (const old of anchors.values()) old.remove();
        anchors.clear();
      }
      anchor = host.ownerDocument.createElement("span");
      anchor.className = ANCHOR_CLASS;
      anchor.setAttribute("aria-hidden", "true");
      frame.appendChild(anchor);
      anchors.set(key, anchor);
    }
    anchor.setAttribute(HINT_ATTR, hint.text);
    anchor.setAttribute(HINT_KEYS_ATTR, hint.keys ?? "");
    anchor.setAttribute(HINT_NOTE_ATTR, hint.note ?? "");
    anchor.setAttribute(HINT_PLACEMENT_ATTR, hint.placement ?? "bottom");
    anchor.textContent = hint.shows ?? "";
    const surface = host.getBoundingClientRect();
    const around = frame.getBoundingClientRect();
    anchor.style.setProperty("--slab-hint-x", `${Math.round(surface.left - around.left + node.x)}px`);
    anchor.style.setProperty("--slab-hint-y", `${Math.round(surface.top - around.top + node.y)}px`);
    anchor.style.setProperty("--slab-hint-w", `${Math.round(node.w)}px`);
    anchor.style.setProperty("--slab-hint-h", `${Math.round(node.h)}px`);
    return anchor;
  };

  const over = (key: string | null): void => {
    if (key === hovered) return;
    hovered = key;
    // From the surface itself when the pointer is on nothing with a hint: the box is put away.
    const from = (key === null ? null : anchorFor(key)) ?? host;
    if (typeof PointerEvent === "function") from.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType }));
  };

  const onPointer = (event: PointerEvent): void => {
    pointerType = event.pointerType;
  };
  const onLeave = (): void => {
    // The page's own events say the pointer is elsewhere; the next entry starts afresh.
    hovered = null;
  };
  const onFrame = (): void => {
    const key = host.matches(":focus-within") ? host.focusedKey() : null;
    if (key === focused) return;
    focused = key;
    if (key === null) return;
    (anchorFor(key) ?? host).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  };
  const onBlur = (): void => {
    focused = null;
  };

  host.addEventListener("pointerover", onPointer, true);
  host.addEventListener("pointerdown", onPointer, true);
  host.addEventListener("pointerleave", onLeave);
  host.addEventListener("slab-frame", onFrame);
  host.addEventListener("focusout", onBlur);

  return {
    over,
    detach: () => {
      host.removeEventListener("pointerover", onPointer, true);
      host.removeEventListener("pointerdown", onPointer, true);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("slab-frame", onFrame);
      host.removeEventListener("focusout", onBlur);
      for (const anchor of anchors.values()) anchor.remove();
      anchors.clear();
    },
  };
}
