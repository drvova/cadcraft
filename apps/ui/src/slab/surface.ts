/**
 * What every Slab surface in the interface is given by its host, because the web driver at the
 * pinned commit does not do it (or does it another way than this interface):
 *
 * - **Theme.** A document's `when dark` follows the system; the interface's theme is the
 *   `data-theme` on `<html>`. The surface is told the theme by name (`./tokens` declares them).
 * - **Motion.** The driver does not read `prefers-reduced-motion`. The interface's switch is
 *   `data-animations` on `<html>`; with it off the surface takes the `still` themes, whose
 *   durations are all zero.
 * - **Tab.** The kernel walks its own focus ring on Tab and wraps: a surface is a trap. Tab is
 *   kept from the kernel, so a surface is one tab stop (the kernel's focused node, which the
 *   driver gives the one `tabindex=0`) and the arrows move inside it, as in a toolbar.
 * - **Copy.** Text selected in a surface is the kernel's selection, not the page's, so the
 *   shell's Ctrl+C would run the drawing's COPYCLIP over it. The surface is asked first.
 * - **Signals.** A document's signals are bubbling, composed events named by the document. Only
 *   the names a host listens for are let out of the element.
 */

import type { SlabHost } from "./types";

/** The Slab theme for the page's theme and motion settings (`./tokens` declares all four). */
export function themeName(theme: string | undefined, animations: string | undefined): string {
  const light = theme === "light";
  const still = animations === "off";
  if (light) return still ? "light-still" : "light";
  return still ? "still" : "";
}

/** Whether a keydown is the copy chord. */
function isCopy(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "c";
}

/**
 * Wire a surface to the page. `signals` are the document's signal names the host handles; each
 * is delivered to `on` and goes no further. Returns the undoing.
 */
export function attachSurface(host: SlabHost, signals: readonly string[], on: (name: string, event: Event) => void): () => void {
  const root = document.documentElement;
  const applyTheme = (): void => {
    host.setTheme(themeName(root.dataset["theme"], root.dataset["animations"]));
  };
  applyTheme();
  const themes = new MutationObserver(applyTheme);
  themes.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-animations"] });

  const onKeyDown = (e: KeyboardEvent): void => {
    // A key from inside a hole belongs to what is mounted there, not to this surface.
    if (e.target !== host) return;
    if (e.key === "Tab") {
      // Seen by the browser alone: it moves to the next tab stop of the page.
      e.stopImmediatePropagation();
      return;
    }
    if (isCopy(e) && typeof DataTransfer === "function" && typeof ClipboardEvent === "function") {
      const data = new DataTransfer();
      host.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, cancelable: true }));
      const text = data.getData("text/plain");
      if (text === "") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void navigator.clipboard?.writeText(text).catch(() => undefined);
    }
  };
  // Capture, on the element itself: ahead of the driver's own listener and of the shell's on the window.
  host.addEventListener("keydown", onKeyDown, true);

  const listeners = signals.map((name) => {
    const listener = (event: Event): void => {
      event.stopPropagation();
      on(name, event);
    };
    host.addEventListener(name, listener);
    return { name, listener };
  });

  return () => {
    themes.disconnect();
    host.removeEventListener("keydown", onKeyDown, true);
    for (const { name, listener } of listeners) host.removeEventListener(name, listener);
  };
}
