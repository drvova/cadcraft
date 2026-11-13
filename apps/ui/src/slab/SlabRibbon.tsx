/**
 * The ribbon drawn by Slab (`slab/ribbon.slab`): the props of `../components/ToolStrip` (and the
 * running command, which this one marks: `./parts`), the same model (`../ribbon`: the tabs, their
 * groups, `toolsFit`, `foldedRows`, what the browser remembers), the same handler. Only the view
 * is Slab's. A tool's press comes back as the `tool`
 * signal with the tool's item key and runs `onInvoke(id)` as the SolidJS key's click does; `tab`,
 * `fold` and `more` are the tab row's, the fold key's and the overflow key's presses. Which control
 * the pointer rests on, for the interface's own hint (`./chrome-hints`), is read from the solved
 * scene on the page's own pointer events: a `pointer-move` binder in the document would have the
 * kernel solve a frame for every move of the pointer over the ribbon.
 *
 * What the SolidJS strip reads from the page is worked out here before the surface is laid out
 * (`./ribbon-params`: where each tool ends, so how many fit): the document is handed only the
 * tools that are drawn, and the rest are the rows of the overflow menu.
 *
 * Two parts stay the interface's own components, stood where the document says:
 * - the overflow menu is `../components/Menu`, hung from the document's overflow key (and mounted
 *   outside the shell, whose holes cut what stands past their edge);
 * - the one-row ribbon's tab select is `../ui/Select` in a hole of the document, so a phone's
 *   picker and the keyboard's type-ahead are the platform's.
 *
 * What the driver at the pinned commit leaves to the host, done here: Tab stops at the tab row,
 * the fold key and the tools in turn (the kernel has one ring for the whole surface); the arrows,
 * Home and End stay inside the stop they are in and wrap; the keyboard's ring is kept to the
 * keyboard (`./scene`).
 *
 * Nothing here runs at rest: a param or a list is set when the tab, the fold, the window's width
 * class, the surface's width or a command's state changes, and at no other time.
 *
 * Mounted by the Slab shell in its `ribbon` hole, after `loadSlab("ribbon")` has defined the
 * element. When that document does not load, the SolidJS strip is shown.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { isMacPlatform } from "../commands";
import { Menu, type MenuHandle } from "../components/Menu";
import { COMPACT_QUERY, toolEnabled } from "../components/ToolStrip";
import { foldedRows, loadRibbon, RIBBON, ribbonTab, saveRibbon } from "../ribbon";
import { rovingIndex } from "../roving";
import { Select } from "../ui/Select";
import { attachHints, type SlabHint } from "./chrome-hints";
import { pageMeasure, type TextMeasure } from "./measure";
import type { RibbonProps } from "./parts";
import { controlAt, foldSaid, groupParams, keyGoes, nextStop, pressedTab, pressedTool, pressTab, RIBBON_METRICS, ribbonMetrics, stopOfKey, tabParams, tabTools, toolHintFor, toolsShown, type RibbonHead, type RibbonStop } from "./ribbon-params";
import { isSlabControlHost, itemOfKey, keysWithRole, ringForKeysOnly, sceneNode, type SlabControlHost } from "./scene";
import { roundStrokes } from "./strokes";
import { attachSurface } from "./surface";
import { signalDetail } from "./types";
import "./slab-chrome.css";
import "./slab-ribbon.css";

/** The most characters of a label a tab shows before it clips (ui.css: `.ui-tab--sm`, 18ch). */
const TAB_CAP_CH = 18;

/** How long after a Tab press a focus that arrives is taken for that key's. */
const TAB_WINDOW_MS = 250;

/** What holds the focus for a while and hands it back: a menu, a dialog. */
const POPUP = '[role="menu"], dialog[open]';

/** What a page with no canvas measures text as: a guess, so the band still shows its tools. */
const roughMeasure: TextMeasure = (_style, text) => [...text].length * 6;

/** A number of a signal's `meta` (how many presses in a row, where the pointer was); null when it carries none. */
function metaNumber(event: Event, name: string): number | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  const meta: unknown = typeof detail === "object" && detail !== null && "meta" in detail ? detail.meta : null;
  const value: unknown = typeof meta === "object" && meta !== null ? Reflect.get(meta, name) : null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Whether a signal came from the keyboard (Enter or Space on the control): it carries no pointer position. */
const byKeyboard = (event: Event): boolean => (metaNumber(event, "x") ?? -1) < 0;

/** The keys of the tool bar's own controls, in the order drawn: the tools, then the overflow key. */
const barKeys = (host: SlabControlHost): string[] => keysWithRole(host, "button").filter((key) => stopOfKey(key) === "tools");
const tabKeys = (host: SlabControlHost): string[] => keysWithRole(host, "tab");
const foldKey = (host: SlabControlHost): string | undefined => keysWithRole(host, "button").find((key) => stopOfKey(key) === "fold");
const isMoreKey = (key: string | null): boolean => key !== null && key.endsWith("/#more");

export function SlabRibbon(props: RibbonProps): JSX.Element {
  const remembered = loadRibbon();
  const [head, setHead] = createSignal<RibbonHead>({ tab: remembered.tab, folded: remembered.folded, broughtBack: false });
  const compactQuery = typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_QUERY) : null;
  const coarseQuery = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
  const [compact, setCompact] = createSignal(compactQuery?.matches ?? false);
  const [coarse, setCoarse] = createSignal(coarseQuery?.matches ?? false);
  const [width, setWidth] = createSignal(0);
  const [pickWidth, setPickWidth] = createSignal(0);
  const [metrics, setMetrics] = createSignal(RIBBON_METRICS);
  const [moreOpen, setMoreOpen] = createSignal(false);
  /** The widest a tab may be, in px: 0 until the page's face is measured. */
  const [tabCap, setTabCap] = createSignal(0);
  const measure = pageMeasure() ?? roughMeasure;
  const mac = isMacPlatform();
  /** The overflow key's menu: the Slab shell's (`SlabParts.Menu`) when it has one. */
  const MenuView = props.menuView ?? Menu;

  const tab = createMemo(() => ribbonTab(head().tab));
  const folded = (): boolean => head().folded;
  /** The band is away: folded, in a window that has a band to fold. */
  const away = (): boolean => folded() && !compact();
  const enabled = (id: string): boolean => toolEnabled(id, props.commands);
  const count = createMemo(() => tabTools(tab()).length);
  const shown = createMemo(() => toolsShown(tab(), { slim: compact(), coarse: coarse() }, width(), pickWidth(), measure, metrics()));
  const groups = createMemo(() => groupParams(tab(), { slim: compact(), coarse: coarse(), shown: shown(), enabled, running: props.running ?? null, mac }, measure, metrics()));
  const overflow = createMemo(() => foldedRows(tab(), shown(), enabled));
  const more = (): boolean => !away() && shown() < count();

  createEffect(() => saveRibbon({ tab: head().tab, folded: head().folded }));
  // Another tab's tools, the other arrangement, or other tools folded: the menu listed the old ones.
  createEffect(() => {
    tab();
    compact();
    away();
    shown();
    setMoreOpen(false);
  });

  const onCompact = (event: MediaQueryListEvent): void => {
    setCompact(event.matches);
  };
  const onCoarse = (event: MediaQueryListEvent): void => {
    setCoarse(event.matches);
  };
  compactQuery?.addEventListener("change", onCompact);
  coarseQuery?.addEventListener("change", onCoarse);
  onCleanup(() => {
    compactQuery?.removeEventListener("change", onCompact);
    coarseQuery?.removeEventListener("change", onCoarse);
  });

  let element: HTMLElement | undefined;
  let frame: HTMLDivElement | undefined;
  let pick: HTMLDivElement | undefined;
  let menuBox: HTMLDivElement | undefined;
  let menu: MenuHandle | undefined;
  /** Puts the page's focus on the overflow key; set once the surface is mounted. */
  let focusMore: () => void = () => undefined;
  /** Stands the menu's box under the overflow key; set once the surface is mounted. */
  let placeMenu: () => void = () => undefined;

  onMount(() => {
    if (element === undefined || frame === undefined || !isSlabControlHost(element)) return;
    const host = element;
    const around = frame;
    roundStrokes(host);

    /** The page's focus onto the surface's one stop, and the kernel's onto `key` with the ring. */
    const surfaceStop = (): HTMLElement | null => host.shadowRoot?.querySelector<HTMLElement>('.slab-a11y-node[tabindex="0"]') ?? null;
    /** The accessible node the driver keeps for a control: the element that holds the page's focus while the control has the kernel's. */
    const nodeOf = (key: string): HTMLElement | null => {
      for (const node of host.shadowRoot?.querySelectorAll<HTMLElement>(".slab-a11y-node") ?? []) if (node.dataset["slabKey"] === key) return node;
      return null;
    };
    const takeKeyboard = (key: string): void => {
      host.setFocus(key, true);
      // On the control's own node: the driver takes the page's focus landing on a node for a
      // wish to focus that node's control, so the surface's stop would win if it is another.
      // (The driver writes `tabindex` on its one stop only; a node without it takes no focus.)
      const node = nodeOf(key);
      if (node !== null && !node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
      (node ?? surfaceStop())?.focus({ preventScroll: true });
    };
    /** The one-row ribbon's select: the interface's own, in the document's hole. */
    const select = (): HTMLSelectElement | null => pick?.querySelector("select") ?? null;
    /** Out of the Tab order while the browser picks the next stop, then back as it was. */
    const skipOnce = (stop: HTMLElement): void => {
      const was = stop.getAttribute("tabindex");
      stop.tabIndex = -1;
      setTimeout(() => {
        if (was === null) stop.removeAttribute("tabindex");
        else stop.setAttribute("tabindex", was);
      }, 0);
    };
    focusMore = (): void => {
      const key = barKeys(host).find(isMoreKey);
      if (key !== undefined) takeKeyboard(key);
    };
    placeMenu = (): void => {
      const key = barKeys(host).find(isMoreKey);
      const at = key === undefined ? undefined : sceneNode(host, key);
      const bar = host.sceneSnapshot().find((node) => node.key.endsWith("/#bar"));
      if (menuBox === undefined || at === undefined || bar === undefined) return;
      const surface = host.getBoundingClientRect();
      // As wide as the key and as tall as the band: the menu hangs from the key's end, under the
      // band. In the window's own coordinates: the box stands outside the shell (see the markup).
      menuBox.style.setProperty("--slab-menu-x", `${Math.round(surface.left + at.x)}px`);
      menuBox.style.setProperty("--slab-menu-y", `${Math.round(surface.top + bar.y)}px`);
      menuBox.style.setProperty("--slab-menu-w", `${Math.round(at.w)}px`);
      menuBox.style.setProperty("--slab-menu-h", `${Math.round(bar.h)}px`);
      menuBox.style.setProperty("--slab-menu-top", `${Math.round(surface.top + bar.y + bar.h)}px`);
    };

    /** The tool the keyboard was last on, by its item key: where Tab comes back to in the tools. */
    let lastTool = "";
    const stopKey = (stop: RibbonStop): string | undefined => {
      if (stop === "fold") return foldKey(host);
      if (stop === "tabs") return tabKeys(host).find((key) => itemOfKey(key) === head().tab);
      const keys = barKeys(host);
      return (lastTool === "" ? undefined : keys.find((key) => (lastTool === "more" ? isMoreKey(key) : itemOfKey(key) === lastTool))) ?? keys[0];
    };
    const noteTool = (key: string | null): void => {
      if (key === null || stopOfKey(key) !== "tools") return;
      lastTool = isMoreKey(key) ? "more" : itemOfKey(key);
    };

    const hintFor = (key: string): SlabHint | null => {
      if (isMoreKey(key)) return moreOpen() ? null : { text: "More tools" };
      if (stopOfKey(key) === "fold") return { text: "Tool band", note: foldSaid(folded()) };
      const entry = pressedTool(tab(), shown(), itemOfKey(key));
      return entry === null ? null : toolHintFor(entry, enabled(entry.id), compact(), mac);
    };
    const hints = attachHints(host, around, hintFor);

    /** Whether the overflow menu was open when the pointer last went down: that press closed it. */
    let openAtPress = false;
    /** The pointer is down on the surface: the focus that follows is the pointer's, not Tab's. */
    let pointerHeld = false;
    const onDocumentDown = (): void => {
      openAtPress = moreOpen();
    };
    // Ahead of the menu's own listener (it is made later), which closes the menu on the same press.
    document.addEventListener("pointerdown", onDocumentDown, true);

    const openMenu = (into: "first" | "last" | null): void => {
      setMoreOpen(true);
      placeMenu();
      if (into !== null && menu?.enter(into === "last") !== true) focusMore();
    };

    // Tab, the arrows, Home and End, ahead of `attachSurface` (which hands every Tab to the
    // browser) and of the kernel (whose arrows walk one ring through the whole surface).
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target !== host || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = host.focusedKey();
      const stop = key === null ? null : stopOfKey(key);
      if (key === null || stop === null) return;
      const take = (): void => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      if (event.key === "Tab") {
        const next = nextStop(stop, event.shiftKey, { head: !compact(), tools: barKeys(host).length > 0 });
        const to = next === null ? undefined : stopKey(next);
        if (to === undefined) {
          // Leaving the tools of the one-row ribbon: its select stands before them for the eye
          // and after the surface for the browser. Back goes to it; on goes past it.
          const field = select();
          if (field === null) return;
          if (event.shiftKey) {
            take();
            field.focus();
          } else skipOnce(field);
          return;
        }
        take();
        host.setFocus(to, true);
        noteTool(to);
        return;
      }
      if (event.shiftKey) return;
      if (isMoreKey(key)) {
        if (event.key === "Escape" && moreOpen()) {
          take();
          setMoreOpen(false);
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          take();
          if (!event.repeat) openMenu(event.key === "ArrowUp" ? "last" : "first");
          return;
        }
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // The kernel would walk on to the next control; a row of keys has nothing above or below.
        take();
        return;
      }
      const keys = stop === "tabs" ? tabKeys(host) : stop === "tools" ? barKeys(host) : [key];
      const next = keys[rovingIndex(event.key, keys.indexOf(key), keys.length, "horizontal") ?? -1];
      if (next === undefined) return;
      take();
      if (stop === "tabs") {
        // As in the SolidJS strip: the arrows bring that tab's tools to the front as they go.
        const to = pressedTab(itemOfKey(next));
        if (to !== null) setHead(pressTab(head(), to.id, null));
      }
      host.setFocus(next, true);
      noteTool(next);
    };
    host.addEventListener("keydown", onKeyDown, true);

    /**
     * The control under the pointer, for the hint. Over the select (a child of the surface, in
     * its hole) the surface's own hint is put away and the select is announced again, so the
     * page's hint for it is not the one put away.
     */
    const onPointerMove = (event: PointerEvent): void => {
      if (event.target !== host) {
        if (overKey === null) return;
        overKey = null;
        hints.over(null);
        if (event.target instanceof Element && typeof PointerEvent === "function") event.target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: event.pointerType }));
        return;
      }
      const box = host.getBoundingClientRect();
      const key = controlAt(host.sceneSnapshot(), event.clientX - box.left, event.clientY - box.top);
      if (key === overKey) return;
      overKey = key;
      hints.over(key);
    };
    const onPointerLeave = (): void => {
      overKey = null;
    };
    let overKey: string | null = null;
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerleave", onPointerLeave);

    const detach = attachSurface(host, ["tab", "tool", "fold", "more"], (name, event) => {
      const detail = signalDetail(event);
      if (name === "tab") {
        const to = pressedTab(detail?.item ?? "");
        if (to !== null) setHead(pressTab(head(), to.id, byKeyboard(event) ? 0 : (metaNumber(event, "clicks") ?? 1)));
      } else if (name === "fold") setHead({ ...head(), folded: !folded() });
      else if (name === "tool") {
        const entry = pressedTool(tab(), shown(), detail?.item ?? "");
        noteTool(detail?.meta.key ?? null);
        // A tool the engine will not run now keeps its place and refuses its press.
        if (entry !== null && enabled(entry.id)) props.onInvoke(entry.id);
      } else if (byKeyboard(event)) {
        // Enter or Space on the overflow key: open the menu and move into it.
        if (moreOpen()) setMoreOpen(false);
        else openMenu("first");
      } else if (openAtPress) {
        // The press that ends here closed the menu when it went down.
        openAtPress = false;
        setMoreOpen(false);
      } else openMenu(null);
    });

    const calm = ringForKeysOnly(host);

    /**
     * The frames after a press in which the ring is put away again. `ringForKeysOnly` does it at
     * the pointer's release; but the driver, in the frame after the press, moves the page's focus
     * onto the pressed control's accessible node, and takes that for the keyboard's.
     */
    let calmFrames = 0;
    const CALM_FRAMES = 3;
    const onPointerDown = (): void => {
      pointerHeld = true;
      calmFrames = CALM_FRAMES;
    };
    const onPointerUp = (): void => {
      pointerHeld = false;
      calmFrames = CALM_FRAMES;
      noteTool(host.focusedKey());
    };
    const onAnyKey = (): void => {
      calmFrames = 0;
    };
    host.addEventListener("keydown", onAnyKey, true);
    /** When Tab was last pressed anywhere in the page: a focus that arrives right after is the keyboard's. */
    let tabAt = Number.NEGATIVE_INFINITY;
    const onWindowKey = (event: KeyboardEvent): void => {
      if (event.key === "Tab") tabAt = event.timeStamp;
    };
    window.addEventListener("keydown", onWindowKey, true);
    /**
     * The keyboard arriving from after the ribbon (Shift+Tab) lands on the tools, the last stop,
     * where the kernel's one stop would be the tab row.
     */
    const onFocusIn = (event: FocusEvent): void => {
      const from = event.relatedTarget;
      // Only a focus the Tab key just moved: a press, or the page putting the focus somewhere, is left where it is.
      if (pointerHeld || !(from instanceof Node) || host.contains(from) || !(event.timeStamp - tabAt < TAB_WINDOW_MS)) return;
      const back = (host.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      const field = select();
      const tools = barKeys(host).length > 0 ? stopKey("tools") : undefined;
      if (event.target === host) {
        // Onto the surface's stop. From after the ribbon that is the tools; from before it, in
        // the one-row ribbon, the select comes first.
        if (back && tools !== undefined) host.setFocus(tools, true);
        else if (!back && field !== null) field.focus();
      } else if (event.target === field && back && tools !== undefined) takeKeyboard(tools);
    };
    /** Tab on the one-row ribbon's select: on to the tools, which the browser has before it; back past them. */
    const onPickKey = (event: KeyboardEvent): void => {
      if (event.key !== "Tab" || event.target !== select() || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.shiftKey) {
        const stop = surfaceStop();
        if (stop !== null) skipOnce(stop);
        return;
      }
      const tools = barKeys(host).length > 0 ? stopKey("tools") : undefined;
      if (tools === undefined) return;
      event.preventDefault();
      takeKeyboard(tools);
    };
    pick?.addEventListener("keydown", onPickKey);
    host.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    host.addEventListener("focusin", onFocusIn);
    /** With the keyboard elsewhere, the surface's one stop is where Tab should arrive: the tab in
     *  front, or the tools where there is no tab row. A menu or a dialog that is open gives the
     *  focus back to the control it was on, so the stop stays there until it has. */
    const restStop = (): void => {
      if (document.querySelector(POPUP) !== null) return;
      const stop = stopKey(compact() ? "tools" : "tabs");
      if (stop !== undefined && host.focusedKey() !== stop) host.setFocus(stop, false);
    };
    const onFocusOut = (event: FocusEvent): void => {
      const to = event.relatedTarget;
      if (to instanceof Node && (to === host || host.contains(to))) return;
      noteTool(host.focusedKey());
      restStop();
    };
    host.addEventListener("focusout", onFocusOut);

    /** The control the keyboard was on is going: once the new ones are laid out, the keyboard is handed on. */
    let handOn = false;
    /** The document's tokens are read once it has solved a frame. */
    let tokensRead = false;
    const onFrame = (): void => {
      if (!tokensRead) {
        tokensRead = true;
        const read = ribbonMetrics((path) => host.getToken(path));
        // Only when one differs: a signal that is set asks for the lists again.
        if (Object.entries(read).some(([name, value]) => Reflect.get(RIBBON_METRICS, name) !== value)) setMetrics(read);
      }
      if (moreOpen()) placeMenu();
      if (handOn) {
        const keys = barKeys(host);
        const to = keys.find(isMoreKey) ?? keys[0];
        // Not laid out yet (the overflow key comes with its own param): the next frame has it.
        if (to !== undefined && (isMoreKey(to) || !untrack(more))) {
          handOn = false;
          takeKeyboard(to);
          noteTool(to);
        }
      }
      if (calmFrames > 0) {
        calmFrames -= 1;
        const held = host.focusedKey();
        if (held !== null && host.matches(":focus-within")) host.setFocus(held, false);
      }
      // The controls may have changed under a keyboard that is elsewhere. Nothing is taken from the page.
      if (!host.matches(":focus-within")) restStop();
    };
    host.addEventListener("slab-frame", onFrame);

    const sizes = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === around) setWidth(around.clientWidth);
        else if (entry.target === pick) setPickWidth(Math.ceil(pick.getBoundingClientRect().width));
      }
    });
    sizes.observe(around);
    if (pick !== undefined) sizes.observe(pick);
    setWidth(around.clientWidth);
    setPickWidth(pick === undefined ? 0 : Math.ceil(pick.getBoundingClientRect().width));

    onCleanup(() => {
      detach();
      calm();
      hints.detach();
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      sizes.disconnect();
      document.removeEventListener("pointerdown", onDocumentDown, true);
      host.removeEventListener("keydown", onKeyDown, true);
      host.removeEventListener("keydown", onAnyKey, true);
      window.removeEventListener("keydown", onWindowKey, true);
      host.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      host.removeEventListener("focusin", onFocusIn);
      pick?.removeEventListener("keydown", onPickKey);
      host.removeEventListener("focusout", onFocusOut);
      host.removeEventListener("slab-frame", onFrame);
    });

    setTabCap(Math.ceil(TAB_CAP_CH * measure("label", "0")));
    createEffect(() => host.setParam("compact", compact()));
    createEffect(() => host.setParam("open", !folded()));
    createEffect(() => host.setParam("fold_said", foldSaid(folded())));
    createEffect(() => host.setParam("band", !away()));
    createEffect(() => host.setParam("bar_name", compact() ? "Tool bar" : `${tab().label} tools`));
    createEffect(() => host.setParam("panel", tab().label));
    createEffect(() => host.setParam("more", more()));
    createEffect(() => host.setParam("more_open", moreOpen()));
    createEffect(() => host.setParam("pick_w", compact() ? pickWidth() : 0));
    createEffect(() => host.setList("tabs", "", tabParams(head().tab, tabCap())));
    createEffect(() => {
      const next = groups();
      // A control that goes while the keyboard is on it (a tool folded away, the overflow key
      // when every tool is drawn again) hands the keyboard on, as in the SolidJS strip: to the
      // overflow key, or to the first tool. The kernel's own restoration would drop it: the
      // overflow key is new to its ring. Done once the new controls are laid out (`onFrame`).
      const held = host.matches(":focus-within") ? host.focusedKey() : null;
      if (held !== null && stopOfKey(held) === "tools" && keyGoes(held, untrack(shown), untrack(more))) handOn = true;
      host.setList("groups", "", next);
    });
  });

  return (
    <div ref={frame} class="slab-ribbon">
      <cadcraft-ribbon ref={element} class="slab-surface">
        <div slot="pick" ref={pick} class="slab-ribbon-pick">
          <Show when={compact()}>
            <Select ariaLabel="Tools" title="The kind of tools shown" value={head().tab} options={RIBBON.map((entry) => ({ value: entry.id, label: entry.label }))} onChange={(id) => setHead(pressTab(untrack(head), id, null))} />
          </Show>
        </div>
      </cadcraft-ribbon>
      {/* Outside the shell: a hole of the shell's document cuts what stands past its edge, and the
          menu opens under the band, over the drawing. */}
      <Show when={moreOpen()}>
        <Portal>
          <div
            class="slab-ribbon-menu"
            ref={(box) => {
              menuBox = box;
              placeMenu();
            }}
            onFocusOut={(event) => {
              // The focus going to something outside closes the menu; the focus merely dropped does not.
              if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== element) setMoreOpen(false);
            }}
          >
            <MenuView
              label="More tools"
              items={overflow()}
              stacked
              within={() => menuBox}
              handle={(handle) => {
                menu = handle;
              }}
              onInvoke={(id, byKey) => {
                // From the keyboard the focus is on the row that is about to go: it returns to the key.
                if (byKey) focusMore();
                setMoreOpen(false);
                props.onInvoke(id);
              }}
              onDismiss={(reason) => {
                if (reason !== "outside") focusMore();
                setMoreOpen(false);
              }}
            />
          </div>
        </Portal>
      </Show>
    </div>
  );
}
