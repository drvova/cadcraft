/**
 * The ribbon: the tools under the title bar, as a row of tabs naming the kinds of work (Home,
 * Jewelry, Draw, Modify, Annotate, View) over one band that holds the tab in front's tools, each
 * a glyph over its label, in named groups with a hairline between them. The model is `../ribbon`
 * (the tabs, their groups, what fits, what the browser remembers); this file draws it.
 *
 * Each tool starts its command id through `onInvoke`, exactly as the command's menu item does. Its
 * name is the command's label; its hint is what the label leaves out: the name typed at the
 * command line, the shortcut as a key cap (and `aria-keyshortcuts`), or why it is blocked. The
 * glyphs come from `icons.ts` (original code-drawn paths).
 *
 * The tab row is a tablist with one Tab stop: Left, Right, Home and End move along it and bring
 * that tab's tools to the front as they go. The band is the tab's panel and a tool bar with one
 * Tab stop of its own (`rovingBand`). The key at the tab row's end folds the band away to leave
 * the tab row alone, and so does a double click on a tab; a click on a tab brings the band back.
 * The tab in front and the fold are remembered by the browser.
 *
 * The band never scrolls and never wraps. Every tool of the tab is laid out; the ones that end
 * past the band's room are hidden where they stand and listed by the overflow key at the band's
 * end, which opens them as a menu (`MenuKey`, `./Menu.tsx`) in the band's own groups. A tool run
 * from the menu returns the focus to the overflow key.
 *
 * A window as narrow as a phone (`COMPACT_QUERY`) has no height to give a band: the ribbon is
 * one row there, the tab a `Select` at its start and the tab's tools icon keys after it, folded
 * into the overflow menu in the same way.
 */

import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { isMacPlatform, shortcutLabel } from "../commands";
import type { CommandInfo } from "../facade";
import { ToolIcon } from "../icons";
import { foldedRows, loadRibbon, RIBBON, RIBBON_TOOLS, ribbonTab, saveRibbon, toolCaption, toolsFit, type RibbonGroup, type ToolbarEntry } from "../ribbon";
import { rovingIndex } from "../roving";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Select } from "../ui/Select";
import { Tab } from "../ui/Tab";
import { MenuKey } from "./Menu";
import "../ribbon.css";

export type { ToolbarEntry } from "../ribbon";

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
  observer.observe(band, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected", "data-folded"] });
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

/**
 * Every tool of the ribbon once, a group to a row: what the icon set must hold a path for. The
 * tabs and their groups are `RIBBON` (`../ribbon`).
 */
export const TOOLBAR: readonly (readonly ToolbarEntry[])[] = [RIBBON_TOOLS];

export interface ToolStripProps {
  onInvoke: (id: string) => void;
  /** The engine's commands, when the caller has them: a tool whose command the engine reports as
   *  not available is drawn disabled. Without them every tool is live, as it is in the menus
   *  before the engine answers. */
  commands?: readonly CommandInfo[];
}

/** Whether a tool can run now: the engine's own answer for its command. A tool the engine does not
 *  list (the shell's own `ui.*` ids, or no list at all) is live. */
export function toolEnabled(id: string, commands: readonly CommandInfo[] | undefined): boolean {
  return commands?.find((command) => command.id === id)?.enabled ?? true;
}

/** The second line of a tool's hint: why it is blocked, or the name that starts it at the command line. */
export function toolNote(entry: ToolbarEntry, enabled: boolean): string | undefined {
  if (!enabled) return "Not available now";
  return entry.alias === "" ? undefined : `Type ${entry.alias}`;
}

/**
 * The hint of a labelled tool, whose label is already on it: the note, or the label again when a
 * shortcut is all there is to add (the box then draws the key cap beside it, and a hint equal to
 * the name is not read twice).
 */
export function toolHint(entry: ToolbarEntry, enabled: boolean): string | undefined {
  return toolNote(entry, enabled) ?? (entry.shortcut === "" ? undefined : entry.label);
}

/** The window that gets the one-row ribbon: the width at which the shell shows one part at a time (styles.css). */
export const COMPACT_QUERY = "(max-width: 560px)";

/** The band's own keys: the tools drawn and the overflow key, not the tools folded away nor the rows of the overflow menu. */
const BAND_KEYS = ".ribbon-cell:not([data-folded]) > button, .tool-more > button";

/**
 * Decides by measurement how many leading tools of the band are drawn, and tells `apply`. Every
 * tool is laid out, drawn or not, so where each ends is read from the page (`toolsFit`). A group
 * drawn in part is told how wide its drawn part is (`--ribbon-shown`), so its caption stays under
 * the tools that show. The band is measured when its box changes (a `ResizeObserver`, so once a
 * frame at most, after layout and before paint), when the pointer's kind changes the keys' gaps,
 * when the page's fonts arrive, and whenever the caller asks (the returned function: the tab or
 * the arrangement changed). Call it from the band's `ref`.
 */
function fitTools(bar: HTMLElement, apply: (count: number) => void): () => void {
  const measure = (): void => {
    const tools = bar.querySelector<HTMLElement>(":scope > .ribbon-tools");
    // A band that is not drawn has nothing to measure: what it shows stays as it was.
    if (tools === null || bar.clientWidth === 0) return;
    const style = getComputedStyle(bar);
    const start = tools.getBoundingClientRect().left;
    const room = bar.getBoundingClientRect().right - (Number.parseFloat(style.paddingRight) || 0) - start;
    const cells = Array.from(tools.querySelectorAll<HTMLElement>(".ribbon-cell"));
    const ends = cells.map((cell) => cell.getBoundingClientRect().right - start);
    const key = (Number.parseFloat(style.getPropertyValue("--control-h-input")) || 0) + (Number.parseFloat(style.columnGap) || 0);
    const count = toolsFit(ends, room, key);
    for (const group of tools.querySelectorAll<HTMLElement>(":scope > .ribbon-group")) {
      const own = cells.filter((cell) => group.contains(cell));
      const drawn = own.filter((cell) => cells.indexOf(cell) < count);
      const last = drawn[drawn.length - 1];
      if (last === undefined || drawn.length === own.length) group.style.removeProperty("--ribbon-shown");
      else group.style.setProperty("--ribbon-shown", `${last.getBoundingClientRect().right - group.getBoundingClientRect().left}px`);
    }
    apply(count);
  };
  const observer = new ResizeObserver(measure);
  observer.observe(bar);
  const coarse = window.matchMedia("(pointer: coarse)");
  coarse.addEventListener("change", measure);
  let gone = false;
  void document.fonts?.ready.then(() => {
    if (!gone) measure();
  });
  onCleanup(() => {
    gone = true;
    observer.disconnect();
    coarse.removeEventListener("change", measure);
  });
  return measure;
}

/** Whether the window is as narrow as a phone now, kept current. False where there is no window to ask. */
function useCompact(): () => boolean {
  const query = typeof window === "undefined" || typeof window.matchMedia !== "function" ? null : window.matchMedia(COMPACT_QUERY);
  const [compact, setCompact] = createSignal(query?.matches ?? false);
  const onChange = (event: MediaQueryListEvent): void => {
    setCompact(event.matches);
  };
  query?.addEventListener("change", onChange);
  onCleanup(() => query?.removeEventListener("change", onChange));
  return compact;
}

/** Every strip's tabs and panel name each other by `id`: a count per strip. */
let strips = 0;

export function ToolStrip(props: ToolStripProps): JSX.Element {
  strips += 1;
  const base = `ribbon-${strips}`;
  const panelId = `${base}-panel`;
  const tabId = (id: string): string => `${base}-tab-${id}`;
  let bar: HTMLElement | undefined;
  let measure: (() => void) | undefined;
  const remembered = loadRibbon();
  const [tabKey, setTabKey] = createSignal(remembered.tab);
  const [folded, setFolded] = createSignal(remembered.folded);
  const compact = useCompact();
  const tab = createMemo(() => ribbonTab(tabKey()));
  const count = createMemo(() => tab().groups.reduce((sum, group) => sum + group.tools.length, 0));
  /** How many leading tools of the tab are drawn; the rest are the overflow menu's rows. */
  const [shown, setShown] = createSignal(Number.POSITIVE_INFINITY);
  const [moreOpen, setMoreOpen] = createSignal(false);
  const moreKey = (): HTMLElement | null => bar?.querySelector<HTMLElement>(":scope > .tool-more > button") ?? null;
  const enabled = (id: string): boolean => toolEnabled(id, props.commands);
  const overflow = createMemo(() => foldedRows(tab(), shown(), enabled));
  /** The band is away: folded, in a window that has a band to fold. */
  const away = (): boolean => folded() && !compact();

  createEffect(() => saveRibbon({ tab: tabKey(), folded: folded() }));
  // Another tab's tools, or the other arrangement of the same ones, are laid out now: fit them.
  createEffect(
    on([tab, compact, away], () => {
      setMoreOpen(false);
      measure?.();
    }),
  );
  onMount(() => measure?.());

  const fit = (next: number): void => {
    if (next === shown() || (next >= count() && shown() >= count())) return;
    const held = bar?.contains(document.activeElement) === true;
    // The menu listed the tools folded at the other width: it closes.
    setMoreOpen(false);
    setShown(next);
    // A tool folded away (or a row gone with the menu) while it had the focus hands it on: to the
    // overflow key, or to the first tool when every tool is drawn again.
    const lost = document.activeElement instanceof HTMLElement && document.activeElement.closest("[data-folded]") !== null;
    if (held && (lost || bar?.contains(document.activeElement) !== true)) (moreKey() ?? bar?.querySelector<HTMLElement>(BAND_KEYS))?.focus();
  };

  /** Whether the first click of the double click now arriving is the one that brought the band back. */
  let broughtBack = false;
  const pick = (id: string, event?: MouseEvent): void => {
    if (event === undefined || event.detail <= 1) broughtBack = folded();
    setTabKey(id);
    if (event !== undefined) setFolded(false);
  };
  const onTabKey = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const at = RIBBON.findIndex((entry) => entry.id === tabKey());
    const next = RIBBON[rovingIndex(event.key, at, RIBBON.length, "horizontal") ?? -1];
    if (next === undefined) return;
    event.preventDefault();
    pick(next.id);
    document.getElementById(tabId(next.id))?.focus();
  };

  /** Where a group's first tool stands among the tab's tools. */
  const groupStart = (index: number): number => tab().groups.slice(0, index).reduce((sum, group) => sum + group.tools.length, 0);

  const key = (entry: ToolbarEntry): JSX.Element => (
    <Show
      when={!compact()}
      fallback={
        <IconButton
          icon={entry.icon}
          title={entry.label}
          shortcut={entry.shortcut === "" ? undefined : shortcutLabel(entry.shortcut, isMacPlatform())}
          description={toolNote(entry, enabled(entry.id))}
          disabled={!enabled(entry.id)}
          onClick={() => props.onInvoke(entry.id)}
        />
      }
    >
      <Button
        variant="ghost"
        ariaLabel={entry.short === undefined ? undefined : entry.label}
        title={toolHint(entry, enabled(entry.id))}
        shortcut={entry.shortcut === "" ? undefined : shortcutLabel(entry.shortcut, isMacPlatform())}
        disabled={!enabled(entry.id)}
        onClick={() => props.onInvoke(entry.id)}
      >
        <ToolIcon id={entry.icon} />
        <span class="ribbon-tool-label">{toolCaption(entry)}</span>
      </Button>
    </Show>
  );

  const group = (entry: RibbonGroup, index: () => number): JSX.Element => {
    const captionId = `${base}-group-${index()}`;
    return (
      <>
        <Show when={index() > 0}>
          <span class="tool-divider" aria-hidden="true" data-folded={groupStart(index()) >= shown() ? "" : undefined} />
        </Show>
        <div class="ribbon-group" role="group" aria-labelledby={compact() ? undefined : captionId} aria-label={compact() ? entry.name : undefined} data-folded={groupStart(index()) >= shown() ? "" : undefined}>
          <div class="ribbon-group-tools" role="none">
            <For each={entry.tools}>
              {(item, at) => (
                <span class="ribbon-cell" role="none" data-folded={groupStart(index()) + at() >= shown() ? "" : undefined}>
                  {key(item)}
                </span>
              )}
            </For>
          </div>
          <Show when={!compact()}>
            <span class="ribbon-caption" id={captionId}>
              {entry.name}
            </span>
          </Show>
        </div>
      </>
    );
  };

  return (
    <div class="toolstrip ribbon" classList={{ "is-compact": compact(), "is-folded": away() }}>
      <Show when={!compact()}>
        <div class="ribbon-head">
          <div
            class="ribbon-tabs"
            role="tablist"
            aria-label="Tools"
            onKeyDown={onTabKey}
            onDblClick={(event) => {
              if (!(event.target instanceof Element) || event.target.closest('[role="tab"]') === null) return;
              // The double click that opened a folded band leaves it open; any other folds it.
              if (!broughtBack) setFolded(true);
              broughtBack = false;
            }}
          >
            <For each={RIBBON}>
              {(entry) => (
                <Tab size="sm" id={tabId(entry.id)} controls={panelId} selected={tabKey() === entry.id} tabIndex={tabKey() === entry.id ? 0 : -1} onClick={(event) => pick(entry.id, event)}>
                  {entry.label}
                </Tab>
              )}
            </For>
          </div>
          <IconButton icon="chevron-up" title="Tool band" description={folded() ? "Show the tools" : "Hide the tools"} expanded={!folded()} controls={panelId} onClick={() => setFolded((value) => !value)} />
        </div>
      </Show>
      <div class="ribbon-band" id={panelId} role={compact() ? undefined : "tabpanel"} aria-labelledby={compact() ? undefined : tabId(tabKey())} hidden={away()}>
        <Show when={compact()}>
          <Select ariaLabel="Tools" title="The kind of tools shown" value={tabKey()} options={RIBBON.map((entry) => ({ value: entry.id, label: entry.label }))} onChange={(id) => pick(id)} />
        </Show>
        <div
          class="ribbon-bar"
          role="toolbar"
          aria-label={compact() ? "Tool bar" : `${tab().label} tools`}
          ref={(element) => {
            bar = element;
            measure = fitTools(element, fit);
            rovingBand(element, BAND_KEYS);
          }}
        >
          <div class="ribbon-tools" role="none">
            <For each={tab().groups}>{(entry, index) => group(entry, index)}</For>
          </div>
          <Show when={shown() < count()}>
            <MenuKey
              class="tool-more"
              icon="chevron-down"
              title="More tools"
              items={overflow()}
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
        </div>
      </div>
    </div>
  );
}
