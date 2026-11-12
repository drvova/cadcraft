/**
 * The tool strip: the icon row of `chrome.rs`'s `TOOLBAR` table, in the same groups and order,
 * with a thin divider between groups. Each button invokes its command id through `onInvoke`; its
 * name is the command's label, and its shortcut is a key cap in the hint and `aria-keyshortcuts`.
 *
 * The icons come from `icons.ts` (original code-drawn paths); the table below is transcribed from
 * the Rust table, egui types removed.
 *
 * A window narrower than the strip keeps the leading groups that fit, whole, and folds the rest
 * behind one overflow key at the strip's end, which opens them as a menu (`MenuKey`, `./Menu.tsx`):
 * each row is the tool's glyph, its label and its shortcut, walked by the keys of every menu. The
 * strip never scrolls. The keys drawn and the overflow key are one Tab stop (`rovingBand`); a
 * tool run from the menu returns the focus to the overflow key.
 */

import { createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { isMacPlatform, shortcutLabel } from "../commands";
import { leadingFit, type MenuItem } from "../menu";
import { rovingIndex } from "../roving";
import { IconButton } from "../ui/IconButton";
import { MenuKey } from "./Menu";

/**
 * Wires a band that scrolls sideways without a scrollbar (the editor tabs; the tool strip folds
 * its keys into a menu instead): it marks the edges that hide something (`data-clip-start`, `data-clip-end`;
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
    // The keyboard's focus (an arrow, or Tab arriving on the band) is brought clear of the band's
    // faded edge: the band's scroll padding (chrome.css) is the fade's width, and the browser's
    // own scroll on focus leaves a key that is in view where it is, fade or not. A pointer's
    // focus is left alone: a key that moved under the press would lose its click.
    if (event.target.matches(":focus-visible")) event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !(event.target instanceof HTMLElement)) return;
    const list = items();
    const next = rovingIndex(event.key, list.indexOf(event.target), list.length, "horizontal");
    if (next === null || !list.includes(event.target)) return;
    event.preventDefault();
    // Focusing a key the band has scrolled away brings it into view (`onFocusIn`).
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

/** The strip's own keys: the tools drawn and the overflow key, not the rows of the overflow menu. */
const STRIP_KEYS = ":scope > button, :scope > .tool-more > button";

/**
 * Decides by measurement how many leading groups of the strip are drawn as keys, and tells
 * `apply`. The strip is measured when its box changes (a `ResizeObserver`, so once a frame at
 * most, after layout and before paint) and when the pointer's kind changes the gap between keys.
 * A key's and a divider's sizes are read from the ones drawn and kept for the frames that draw
 * none; the groups' widths follow from them (`leadingFit`), so a folded group is never laid out
 * to be measured. Call it from the strip's `ref`.
 */
function fitGroups(band: HTMLElement, groups: readonly number[], apply: (count: number) => void): void {
  let key = 0;
  let divider = 0;
  const measure = (): void => {
    const style = getComputedStyle(band);
    const button = band.querySelector<HTMLElement>(STRIP_KEYS);
    const rule = band.querySelector<HTMLElement>(":scope > .tool-divider");
    if (button !== null && button.offsetWidth > 0) key = button.offsetWidth;
    if (rule !== null) {
      const margins = getComputedStyle(rule);
      divider = rule.offsetWidth + (Number.parseFloat(margins.marginLeft) || 0) + (Number.parseFloat(margins.marginRight) || 0);
    }
    // A strip that is not drawn has nothing to measure: what it shows stays as it was.
    if (key === 0 || band.clientWidth === 0) return;
    const gap = Number.parseFloat(style.columnGap) || 0;
    const room = band.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
    const between = gap + divider + gap;
    apply(
      leadingFit(
        groups.map((keys) => keys * key + (keys - 1) * gap),
        room,
        between,
        between + key,
      ),
    );
  };
  const observer = new ResizeObserver(measure);
  observer.observe(band);
  const coarse = window.matchMedia("(pointer: coarse)");
  coarse.addEventListener("change", measure);
  onCleanup(() => {
    observer.disconnect();
    coarse.removeEventListener("change", measure);
  });
}

export function ToolStrip(props: ToolStripProps): JSX.Element {
  let strip: HTMLElement | undefined;
  /** How many leading groups are drawn as keys; the rest are the overflow menu's rows. */
  const [shown, setShown] = createSignal(TOOLBAR.length);
  const [moreOpen, setMoreOpen] = createSignal(false);
  const moreKey = (): HTMLElement | null => strip?.querySelector<HTMLElement>(":scope > .tool-more > button") ?? null;

  const folded = createMemo((): MenuItem[] =>
    TOOLBAR.slice(shown())
      .flat()
      .map((entry) => ({ label: entry.label, id: entry.id, shortcut: entry.shortcut, enabled: true, children: [], icon: entry.icon })),
  );

  const fit = (count: number): void => {
    if (count === shown()) return;
    const held = strip?.contains(document.activeElement) === true;
    // The menu listed the tools folded at the other width: it closes.
    setMoreOpen(false);
    setShown(count);
    // A key folded away (or a row gone with the menu) while it had the focus hands it on: to the
    // overflow key, or to the first key when every tool is drawn again.
    if (held && strip?.contains(document.activeElement) !== true) (moreKey() ?? strip?.querySelector<HTMLElement>(STRIP_KEYS))?.focus();
  };

  return (
    <nav
      class="toolstrip"
      role="toolbar"
      aria-label="Tool bar"
      ref={(element) => {
        strip = element;
        fitGroups(
          element,
          TOOLBAR.map((group) => group.length),
          fit,
        );
        rovingBand(element, STRIP_KEYS);
      }}
    >
      <For each={TOOLBAR}>
        {(group, index) => (
          <Show when={index() < shown()}>
            <Show when={index() > 0}>
              <span class="tool-divider" aria-hidden="true" />
            </Show>
            <For each={group}>
              {(entry) => (
                <IconButton
                  icon={entry.icon}
                  title={entry.label}
                  shortcut={entry.shortcut === "" ? undefined : shortcutLabel(entry.shortcut, isMacPlatform())}
                  onClick={() => props.onInvoke(entry.id)}
                />
              )}
            </For>
          </Show>
        )}
      </For>
      <Show when={shown() < TOOLBAR.length}>
        <MenuKey
          class="tool-more"
          icon="chevron-down"
          title="More tools"
          items={folded()}
          open={moreOpen()}
          onOpen={() => setMoreOpen(true)}
          onClose={() => setMoreOpen(false)}
          stacked
          onInvoke={(id) => {
            // The row that ran the tool is gone with the menu: the focus returns to the key.
            moreKey()?.focus();
            props.onInvoke(id);
          }}
        />
      </Show>
    </nav>
  );
}
