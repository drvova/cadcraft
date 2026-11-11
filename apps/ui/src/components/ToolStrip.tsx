/**
 * The tool strip: the icon row of `chrome.rs`'s `TOOLBAR` table, in the same groups and order,
 * with a thin divider between groups. Each button invokes its command id through `onInvoke` and
 * its tooltip names the command and its shortcut, exactly as the desktop does.
 *
 * The icons come from `icons.ts` (original code-drawn paths); the table below is transcribed from
 * the Rust table, egui types removed.
 */

import { For, onCleanup, Show, type JSX } from "solid-js";
import { isMacPlatform, shortcutLabel } from "../commands";
import { rovingIndex } from "../roving";
import { IconButton } from "../ui/IconButton";

/**
 * Wires a band that scrolls sideways without a scrollbar (the tool strip, the editor tabs, the
 * status toggles): it marks the edges that hide something (`data-clip-start`, `data-clip-end`;
 * chrome.css fades the band there) and turns a mouse's vertical wheel along the band, which a
 * sideways-only scroller otherwise ignores. Call it from a component's `ref`. Returns the marking
 * function, for a caller whose content changes without the band's own box changing.
 */
export function scrollBand(band: HTMLElement): () => void {
  const mark = (): void => {
    const hidden = band.scrollWidth - band.clientWidth;
    band.toggleAttribute("data-clip-start", band.scrollLeft > 1);
    band.toggleAttribute("data-clip-end", band.scrollLeft < hidden - 1);
  };
  const onWheel = (event: WheelEvent): void => {
    // A trackpad's sideways swipe and a pinch (ctrl + wheel) are already what they should be.
    if (event.deltaX !== 0 || event.deltaY === 0 || event.ctrlKey || band.scrollWidth <= band.clientWidth) return;
    event.preventDefault();
    band.scrollLeft += event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : event.deltaY * band.clientHeight;
  };
  const observer = new ResizeObserver(mark);
  observer.observe(band);
  band.addEventListener("scroll", mark, { passive: true });
  band.addEventListener("wheel", onWheel, { passive: false });
  onCleanup(() => {
    observer.disconnect();
    band.removeEventListener("scroll", mark);
    band.removeEventListener("wheel", onWheel);
  });
  return mark;
}

/**
 * Makes a band of controls one Tab stop (the tool strip, the status toggles, the editor tabs):
 * exactly one item holds `tabindex="0"` and Left, Right, Home and End move the focus between the
 * items, wrapping at the ends (`rovingIndex`). The Tab stop is the item last focused, or `home()`
 * when the band has one (a tab strip's selected tab) and the focus is elsewhere. It is managed
 * from the container because the system's `IconButton` and `Tab` take no `tabindex`: the items
 * are whatever matches `selector` inside the band, so dividers are never stops, and the stop is
 * set again whenever the items or their selection change. Call it from a component's `ref`.
 */
export function rovingBand(band: HTMLElement, selector: string, home?: () => HTMLElement | null): void {
  let last: HTMLElement | null = null;
  const items = (): HTMLElement[] => Array.from(band.querySelectorAll<HTMLElement>(selector));
  const sync = (): void => {
    const list = items();
    const focused = list.find((item) => item === document.activeElement);
    const stop = focused ?? home?.() ?? (last !== null && list.includes(last) ? last : list[0]);
    for (const item of list) item.tabIndex = item === stop ? 0 : -1;
  };
  const onFocusIn = (event: FocusEvent): void => {
    if (!(event.target instanceof HTMLElement) || !items().includes(event.target)) return;
    last = event.target;
    sync();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !(event.target instanceof HTMLElement)) return;
    const list = items();
    const next = rovingIndex(event.key, list.indexOf(event.target), list.length, "horizontal");
    if (next === null || !list.includes(event.target)) return;
    event.preventDefault();
    // Focusing a key the band has scrolled away brings it into view (the browser's own scroll).
    list[next]?.focus();
  };
  const observer = new MutationObserver(sync);
  observer.observe(band, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
  band.addEventListener("focusin", onFocusIn);
  band.addEventListener("focusout", sync);
  band.addEventListener("keydown", onKeyDown);
  onCleanup(() => {
    observer.disconnect();
    band.removeEventListener("focusin", onFocusIn);
    band.removeEventListener("focusout", sync);
    band.removeEventListener("keydown", onKeyDown);
  });
  sync();
}

/** One toolbar button: the icon id, the command id it invokes, the label, and the shortcut. */
export interface ToolbarEntry {
  icon: string;
  id: string;
  label: string;
  shortcut: string;
}

/** The toolbar groups, mirroring `crates/ui-egui/src/chrome.rs`'s `TOOLBAR`. */
export const TOOLBAR: readonly (readonly ToolbarEntry[])[] = [
  [
    { icon: "new", id: "new", label: "New Drawing", shortcut: "Cmd+N" },
    { icon: "open", id: "open", label: "Open", shortcut: "Cmd+O" },
    { icon: "save", id: "qsave", label: "Save", shortcut: "Cmd+S" },
    { icon: "saveas", id: "saveas", label: "Save As", shortcut: "" },
  ],
  [
    { icon: "u", id: "u", label: "Undo", shortcut: "Cmd+Z" },
    { icon: "redo", id: "redo", label: "Redo", shortcut: "Cmd+Shift+Z" },
  ],
  [
    { icon: "plot", id: "plot", label: "Print", shortcut: "" },
    { icon: "publish", id: "publish", label: "Batch Publish", shortcut: "" },
    { icon: "pagesetup", id: "pagesetup", label: "Page Setup Manager", shortcut: "" },
    { icon: "preview", id: "preview", label: "Plot Preview", shortcut: "" },
  ],
  [
    { icon: "import", id: "import", label: "Import", shortcut: "" },
    { icon: "export", id: "export", label: "Export", shortcut: "" },
    { icon: "attach", id: "attach", label: "Attach", shortcut: "" },
    { icon: "share", id: "share", label: "Share", shortcut: "" },
  ],
  [
    { icon: "zoom.window", id: "zoom.window", label: "Zoom Window", shortcut: "" },
    { icon: "pan", id: "pan", label: "Pan", shortcut: "" },
    { icon: "3dorbit", id: "3dorbit", label: "Orbit", shortcut: "" },
  ],
  [
    { icon: "zoom.extents", id: "zoom.extents", label: "Zoom Extents", shortcut: "" },
    { icon: "ui.toggle.palettes", id: "ui.toggle.palettes", label: "Properties", shortcut: "" },
    { icon: "ui.dialog.layers", id: "ui.dialog.layers", label: "Layer Properties Manager", shortcut: "" },
    { icon: "ui.dialog.blocks", id: "ui.dialog.blocks", label: "Blocks", shortcut: "" },
  ],
  [
    { icon: "dist", id: "dist", label: "Measure Distance", shortcut: "" },
    { icon: "list", id: "list", label: "List", shortcut: "" },
    { icon: "area", id: "area", label: "Area", shortcut: "" },
  ],
  [{ icon: "ui.dialog.about", id: "ui.dialog.about", label: "Help", shortcut: "" }],
];

export interface ToolStripProps {
  onInvoke: (id: string) => void;
}

export function ToolStrip(props: ToolStripProps): JSX.Element {
  return (
    <nav
      class="toolstrip"
      role="toolbar"
      aria-label="Tool bar"
      ref={(element) => {
        scrollBand(element);
        rovingBand(element, "button");
      }}
    >
      <For each={TOOLBAR}>
        {(group, index) => (
          <>
            <Show when={index() > 0}>
              <span class="tool-divider" aria-hidden="true" />
            </Show>
            <For each={group}>
              {(entry) => (
                <IconButton
                  icon={entry.icon}
                  title={entry.shortcut === "" ? entry.label : `${entry.label} (${shortcutLabel(entry.shortcut, isMacPlatform())})`}
                  onClick={() => props.onInvoke(entry.id)}
                />
              )}
            </For>
          </>
        )}
      </For>
    </nav>
  );
}
