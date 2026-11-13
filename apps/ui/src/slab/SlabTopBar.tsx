/**
 * The title bar drawn by Slab (`slab/topbar.slab`): the props of `../components/TopBar`, and the
 * menu bar's own (`./parts`: `TitleBarProps`), since here the titles are part of the one surface.
 * The same rules as the SolidJS bar and its menu bar, not a second copy of them: the tree is
 * `buildMenu`, a title's keys are `titleKeyAction` (`../components/MenuBar`), the widths at which
 * the titles give way are that file's queries, the command centre's name and the layout keys'
 * table are `../components/TopBar`'s. Only the view is Slab's. A press comes back as a signal:
 * `title` with the title's item key, `menukey`, `palette`, `side`, `panel`, `chat`.
 *
 * Two parts stay the interface's own components:
 * - **the menus** are `../components/Menu`, hung from a title's (or the Main menu key's)
 *   rectangle in a box mounted outside the shell: a Slab overlay cannot leave its surface's box
 *   (the menu's rows, submenus, placement, typeahead and its `menu`/`menuitem` tree are that
 *   component's, unchanged);
 * - **the command palette** is `../components/CommandPalette`, opened by the shell as before.
 *
 * What the SolidJS bar's grid does is worked out here before the surface is laid out
 * (`./topbar-params`: `titleBarLayout`), from the bar's width, the window's and the titles' own.
 *
 * What the driver at the pinned commit leaves to the host, done here: Tab stops at the menus, the
 * command centre and each layout key in turn, as in the SolidJS bar (the kernel has one ring for
 * the whole surface); the arrows stay in the titles and wrap; the keyboard's ring is kept to the
 * keyboard; a layout key says it is pressed, a title that it opens a menu, and each control its
 * shortcut (the language has no attribute for these: they are written on the driver's accessible
 * nodes); which control the pointer rests on, for the hint and for the open menu to follow the
 * pointer along the bar, is read from the solved scene on the page's own pointer events.
 *
 * Nothing here runs at rest. Mounted by the Slab shell in its `topbar` hole, after
 * `loadSlab("topbar")` has defined the element. When that document does not load, the SolidJS bar
 * is shown.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { buildMenu, isMacPlatform, shortcutLabel, UI_ITEMS } from "../commands";
import { Menu, type MenuDismiss, type MenuHandle } from "../components/Menu";
import { COMPACT_QUERY, STACKED_QUERY, titleKeyAction } from "../components/MenuBar";
import { commandCentreName, LAYOUT_KEYS } from "../components/TopBar";
import { ariaKeyShortcuts } from "../ui/Tooltip";
import { paramText } from "./bench-params";
import { attachHints, type SlabHint } from "./chrome-hints";
import { pageMeasure, type TextMeasure } from "./measure";
import type { TitleBarProps } from "./parts";
import { isSlabControlHost, itemOfKey, keysWithRole, ringForKeysOnly, sceneNode, signalPoint, type SlabControlHost } from "./scene";
import { roundStrokes } from "./strokes";
import { attachSurface } from "./surface";
import { controlAt, endStop, isMenuKeyKey, isTitleKey, nextStop, onDirtyDot, pressedTitle, saidExtras, stopOfKey, titleBarLayout, titleParams, TOPBAR_METRICS, topBarMetrics, type TopBarStop } from "./topbar-params";
import { signalDetail } from "./types";
import "../chrome.css";
import "./slab-chrome.css";
import "./slab-topbar.css";

/** `openIndex` when the open menu is the compact one, opened by the menu key, not by a title. */
const COMPACT = -1;

/** How long after a Tab press a focus that arrives is taken for that key's. */
const TAB_WINDOW_MS = 250;

/** What holds the focus for a while and hands it back: a menu, a dialog. */
const POPUP = '[role="menu"], dialog[open]';

/** The keys the kernel would walk its one ring with, and a row of unlike controls has no use for. */
const WALK_KEYS: readonly string[] = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];

/** What a page with no canvas measures text as: a guess, so the bar still shows its titles. */
const roughMeasure: TextMeasure = (_style, text) => [...text].length * 7;

const sameLabels = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((label, index) => label === b[index]);

const [SIDEBAR, PANEL, ASSISTANT] = LAYOUT_KEYS;

export function SlabTopBar(props: TitleBarProps): JSX.Element {
  const compactQuery = typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_QUERY) : null;
  const stackedQuery = typeof window.matchMedia === "function" ? window.matchMedia(STACKED_QUERY) : null;
  const [compact, setCompact] = createSignal(compactQuery?.matches ?? false);
  /** Whether the compact menu's submenus open in place (no room beside their parent). */
  const [stacked, setStacked] = createSignal(stackedQuery?.matches ?? false);
  const [width, setWidth] = createSignal(0);
  const [viewport, setViewport] = createSignal(window.innerWidth);
  const [metrics, setMetrics] = createSignal(TOPBAR_METRICS);
  /** The open title's index, `COMPACT` for the menu key's menu, `null` when nothing is open. */
  const [openIndex, setOpenIndex] = createSignal<number | null>(null);
  /** The title that is the bar's one Tab stop: the one last focused or opened. */
  const [tabStop, setTabStop] = createSignal(0);
  const measure = pageMeasure() ?? roughMeasure;
  const mac = isMacPlatform();

  const hasMenus = (): boolean => props.menus !== undefined && props.menus !== null;
  // Built anew whenever the command list is refreshed (after every command); the titles are not.
  const tree = createMemo(() => (props.menus === undefined || props.menus === null ? [] : buildMenu(props.menus.commands, UI_ITEMS)));
  const labels = createMemo<readonly string[]>(() => tree().map((title) => title.label), [], { equals: sameLabels });
  const title = (): string => props.drawing()?.title ?? "Untitled";
  const dirty = (): boolean => props.drawing()?.dirty ?? false;
  const layout = createMemo(() => titleBarLayout(width(), viewport(), { compact: compact(), menus: hasMenus(), titles: labels(), name: title(), dirty: dirty() }, measure, metrics()));
  /** The open menu, made anew for each title (as the SolidJS bar makes one per title). */
  const opened = createMemo(() => {
    const index = openIndex();
    return index === null ? null : { index };
  });
  /** A layout key's shortcut in this platform's words, as the menus print it. */
  const shortcut = (keys: string): string => shortcutLabel(keys, mac);
  /** The menu a title opens: the Slab shell's (`SlabParts.Menu`) when it has one. */
  const MenuView = props.menuView ?? Menu;

  let element: HTMLElement | undefined;
  let frame: HTMLDivElement | undefined;
  let menuBox: HTMLDivElement | undefined;
  let menu: MenuHandle | undefined;
  /** Puts the page's focus on what opened a menu (a title, or the menu key); set once the surface is mounted. */
  let focusOpener: (index: number) => void = () => undefined;
  /** Puts the page's focus on a stop of the bar; set once the surface is mounted. */
  let focusStop: (stop: TopBarStop) => void = () => undefined;
  /** Stands the menu's box under what opened it; set once the surface is mounted. */
  let placeMenu: () => void = () => undefined;

  const close = (): void => {
    setOpenIndex(null);
  };
  const open = (index: number): void => {
    // A title asked again while its menu is open starts from the menu's own rows.
    if (openIndex() === index) menu?.collapse();
    setOpenIndex(index);
    if (index !== COMPACT) setTabStop(index);
    placeMenu();
  };
  /** Opens a menu from the keyboard and moves into it; onto what opened it when it has no row. */
  const openInto = (index: number, last = false): void => {
    open(index);
    if (menu?.enter(last) !== true) focusOpener(index);
  };
  /** A menu asks to be closed: but for a press outside, the focus returns to what opened it. */
  const dismiss = (index: number, reason: MenuDismiss): void => {
    if (reason !== "outside") focusOpener(index);
    close();
  };
  const invoke = (index: number, id: string, byKey: boolean): void => {
    // From the keyboard the focus is on the row that is about to go: it returns to what opened the menu.
    if (byKey) focusOpener(index);
    close();
    props.menus?.onInvoke(id);
  };

  onMount(() => {
    if (element === undefined || frame === undefined || !isSlabControlHost(element)) return;
    const host: SlabControlHost = element;
    const around = frame;
    roundStrokes(host);

    /** The accessible node the driver keeps for a control: the element that holds the page's focus while the control has the kernel's. */
    const nodeOf = (key: string): HTMLElement | null => {
      for (const node of host.shadowRoot?.querySelectorAll<HTMLElement>(".slab-a11y-node") ?? []) if (node.dataset["slabKey"] === key) return node;
      return null;
    };
    const surfaceStop = (): HTMLElement | null => host.shadowRoot?.querySelector<HTMLElement>('.slab-a11y-node[tabindex="0"]') ?? null;
    /** The host is moving the focus itself: the focus that arrives is not the Tab key's. */
    let handing = false;
    const takeKeyboard = (key: string): void => {
      handing = true;
      host.setFocus(key, true);
      // On the control's own node: the driver takes the page's focus landing on a node for a
      // wish to focus that node's control. (It writes `tabindex` on its one stop only; a node
      // without it takes no focus.)
      const node = nodeOf(key);
      if (node !== null && !node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
      (node ?? surfaceStop())?.focus({ preventScroll: true });
      handing = false;
    };

    const titleKeys = (): string[] => keysWithRole(host, "menuitem").filter(isTitleKey);
    const titleKeyOf = (index: number): string | undefined => titleKeys().find((key) => pressedTitle(itemOfKey(key), labels().length) === index);
    const buttonKey = (stop: TopBarStop): string | undefined => keysWithRole(host, "button").find((key) => stopOfKey(key) === stop);
    const stopKey = (stop: TopBarStop): string | undefined => {
      if (stop !== "menus") return buttonKey(stop);
      if (compact()) return buttonKey("menus");
      return titleKeyOf(tabStop()) ?? titleKeys()[0];
    };
    const openerKey = (index: number): string | undefined => (index === COMPACT ? buttonKey("menus") : titleKeyOf(index));
    focusOpener = (index: number): void => {
      const key = openerKey(index);
      if (key !== undefined) takeKeyboard(key);
    };
    focusStop = (stop: TopBarStop): void => {
      const key = stopKey(stop);
      if (key !== undefined) takeKeyboard(key);
    };
    placeMenu = (): void => {
      const index = openIndex();
      const key = index === null ? undefined : openerKey(index);
      const at = key === undefined ? undefined : sceneNode(host, key);
      const band = host.sceneSnapshot().find((node) => node.key.endsWith("/#band"));
      if (menuBox === undefined || at === undefined || band === undefined) return;
      const surface = host.getBoundingClientRect();
      // As wide as what opened it and as tall as the band: the menu hangs from its start, under
      // the band (chrome.css: `.menubar-item`). In the window's own coordinates: the box stands
      // outside the shell.
      menuBox.style.setProperty("--slab-menu-x", `${Math.round(surface.left + at.x)}px`);
      menuBox.style.setProperty("--slab-menu-y", `${Math.round(surface.top + band.y)}px`);
      menuBox.style.setProperty("--slab-menu-w", `${Math.round(at.w)}px`);
      menuBox.style.setProperty("--slab-menu-h", `${Math.round(band.h)}px`);
    };

    const hintFor = (key: string): SlabHint | null => {
      if (key.endsWith("/#dirty")) return { text: "Unsaved changes" };
      const stop = stopOfKey(key);
      if (stop === "centre") return { text: "Command palette", keys: props.paletteShortcut };
      if (stop === "sidebar") return { text: SIDEBAR.title, keys: shortcut(SIDEBAR.shortcut) };
      if (stop === "panel") return { text: PANEL.title, keys: shortcut(PANEL.shortcut) };
      if (stop === "assistant") return { text: ASSISTANT.title, keys: shortcut(ASSISTANT.shortcut) };
      // A title says what it is; the menu key's hint gives way to its open menu.
      return isMenuKeyKey(key) && openIndex() !== COMPACT ? { text: "Main menu" } : null;
    };
    const hints = attachHints(host, around, hintFor);

    /** The menu that was open when the pointer last went down: that press closed it. */
    let openAtPress: number | null = null;
    /** The pointer is down on the surface: the focus that follows is the pointer's, not Tab's. */
    let pointerHeld = false;
    const onDocumentDown = (): void => {
      openAtPress = openIndex();
    };
    // Ahead of the menu's own listener (it is made later), which closes the menu on the same press.
    document.addEventListener("pointerdown", onDocumentDown, true);

    // Tab and the bar's own keys, ahead of `attachSurface` (which hands every Tab to the browser)
    // and of the kernel (whose arrows walk one ring through the whole surface).
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
        const next = nextStop(stop, event.shiftKey, { menus: hasMenus() });
        const to = next === null ? undefined : stopKey(next);
        // Past the bar's end the browser goes on by itself.
        if (to === undefined) return;
        take();
        host.setFocus(to, true);
        return;
      }
      if (isTitleKey(key)) {
        const index = pressedTitle(itemOfKey(key), labels().length);
        const action = index === null ? null : titleKeyAction(event, index, labels(), openIndex() !== null);
        if (index === null || action === null) return;
        take();
        if (action.kind === "close") close();
        else if (action.kind === "open") {
          if (!event.repeat) openInto(index, action.last);
        } else {
          // A menu that is open follows the focus along the bar, as it follows the pointer.
          if (openIndex() !== null) open(action.to);
          setTabStop(action.to);
          const to = titleKeyOf(action.to);
          if (to !== undefined) host.setFocus(to, true);
        }
        return;
      }
      if (isMenuKeyKey(key)) {
        if (event.key === "Escape" && openIndex() === COMPACT) {
          take();
          close();
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          take();
          if (!event.repeat) openInto(COMPACT, event.key === "ArrowUp");
          return;
        }
      }
      // The kernel would walk on to the next control; a key of the bar has no use for an arrow.
      if (!event.shiftKey && WALK_KEYS.includes(event.key)) take();
    };
    host.addEventListener("keydown", onKeyDown, true);

    /**
     * The control under the pointer: for the hint, and, while a title's menu is open, for the menu
     * to follow the pointer onto another title (`switch_on_hover`). Only a mouse hovers.
     */
    let overKey: string | null = null;
    const onPointerMove = (event: PointerEvent): void => {
      const box = host.getBoundingClientRect();
      const scene = host.sceneSnapshot();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      const control = controlAt(scene, x, y);
      const key = control !== null && stopOfKey(control) === "centre" && onDirtyDot(scene, x, y) ? (scene.find((node) => node.key.endsWith("/#dirty"))?.key ?? control) : control;
      if (key === overKey) return;
      overKey = key;
      hints.over(key !== null && isTitleKey(key) ? null : key);
      const at = openIndex();
      if (event.pointerType !== "mouse" || key === null || !isTitleKey(key) || at === null || at === COMPACT) return;
      const index = pressedTitle(itemOfKey(key), labels().length);
      if (index !== null && index !== at) open(index);
    };
    const onPointerLeave = (): void => {
      overKey = null;
    };
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerleave", onPointerLeave);

    const detach = attachSurface(host, ["title", "menukey", "palette", "side", "panel", "chat"], (name, event) => {
      const byKey = signalPoint(event) === null;
      if (name === "title") {
        const index = pressedTitle(signalDetail(event)?.item ?? "", labels().length);
        if (index === null) return;
        setTabStop(index);
        // Enter or Space: open it and move into it. A pointer's click opens or closes it (the
        // press that ends here closed an open one when it went down).
        if (byKey) openInto(index);
        else if (openAtPress !== index) open(index);
        openAtPress = null;
      } else if (name === "menukey") {
        if (byKey) openInto(COMPACT);
        else if (openAtPress !== COMPACT) open(COMPACT);
        openAtPress = null;
      } else if (name === "palette") props.onOpenPalette();
      else if (name === "side") props.onToggleSidebar();
      else if (name === "panel") props.onTogglePanel();
      else props.onToggleAssistant();
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
    /** The keyboard arriving from after the bar (Shift+Tab) lands on the last key, where the kernel's one stop would be the first. */
    const onFocusIn = (event: FocusEvent): void => {
      const from = event.relatedTarget;
      // Only a focus the Tab key just moved: a press, or the host putting the focus somewhere, is left where it is.
      if (handing || pointerHeld || !(from instanceof Node) || host.contains(from) || !(event.timeStamp - tabAt < TAB_WINDOW_MS)) return;
      const back = (host.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      const to = stopKey(endStop(back, { menus: hasMenus() }));
      if (event.target === host && to !== undefined) host.setFocus(to, true);
    };
    host.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    host.addEventListener("focusin", onFocusIn);
    /** With the keyboard elsewhere, the surface's one stop is where Tab should arrive: the bar's
     *  first stop. A menu or a dialog that is open gives the focus back to the control it was on,
     *  so the stop stays there until it has. */
    const restStop = (): void => {
      if (document.querySelector(POPUP) !== null) return;
      const stop = stopKey(endStop(false, { menus: hasMenus() }));
      if (stop !== undefined && host.focusedKey() !== stop) host.setFocus(stop, false);
    };
    const onFocusOut = (event: FocusEvent): void => {
      const to = event.relatedTarget;
      if (to instanceof Node && (to === host || host.contains(to))) return;
      // The focus going to something outside the menus (Tab, a click on another control) closes
      // the menu; the focus merely dropped (the window left) does not, and nor does it going into the menu.
      if (to instanceof Node && menuBox?.contains(to) !== true) close();
      restStop();
    };
    host.addEventListener("focusout", onFocusOut);

    /** The menus' control is being swapped (the titles for the key, or back) with the keyboard on it: the keyboard is handed to the one that now stands. */
    let handOn = false;
    /** The document's tokens are read once it has solved a frame. */
    let tokensRead = false;
    const sayExtras = (): void => {
      const state = { sidebar: props.sidebarOpen(), panel: props.panelOpen(), assistant: props.assistantOpen(), shortcuts: { centre: ariaKeyShortcuts(props.paletteShortcut), sidebar: ariaKeyShortcuts(shortcut(SIDEBAR.shortcut)), panel: ariaKeyShortcuts(shortcut(PANEL.shortcut)), assistant: ariaKeyShortcuts(shortcut(ASSISTANT.shortcut)) } };
      for (const node of host.shadowRoot?.querySelectorAll<HTMLElement>(".slab-a11y-node[role]") ?? []) {
        const extras = saidExtras(node.dataset["slabKey"] ?? "", state);
        if (extras === null) continue;
        for (const [name, value] of Object.entries(extras)) {
          if (value === null) node.removeAttribute(name);
          else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
        }
      }
    };
    const onFrame = (): void => {
      if (!tokensRead) {
        tokensRead = true;
        const read = topBarMetrics((path) => host.getToken(path));
        // Only when one differs: a signal that is set lays the bar out again.
        if (Object.entries(read).some(([name, value]) => Reflect.get(TOPBAR_METRICS, name) !== value)) setMetrics(read);
      }
      untrack(sayExtras);
      if (untrack(openIndex) !== null) placeMenu();
      if (handOn) {
        const to = untrack(() => stopKey("menus"));
        // Not laid out yet (the key and the titles come with their own params): the next frame has it.
        if (to !== undefined && isMenuKeyKey(to) === untrack(compact)) {
          handOn = false;
          takeKeyboard(to);
        }
      }
      if (calmFrames > 0) {
        calmFrames -= 1;
        const held = host.focusedKey();
        if (held !== null && host.matches(":focus-within")) host.setFocus(held, false);
      }
      // The controls may have changed under a keyboard that is elsewhere. Nothing is taken from the page.
      if (!host.matches(":focus-within")) untrack(restStop);
    };
    host.addEventListener("slab-frame", onFrame);

    // A window resized across either width swaps the titles for the key, or the submenus'
    // placement: a menu open at that moment was placed for the other arrangement, so it closes.
    // The focus, if it was in the menu or on the control that is being folded away, goes to the
    // control that now stands for the menus (as in the SolidJS bar: `closeForResize`).
    const closeForResize = (): void => {
      const held = host.focusedKey();
      const inBar = host.matches(":focus-within") && held !== null && stopOfKey(held) === "menus";
      const inMenu = menuBox?.contains(document.activeElement) === true;
      close();
      if (inBar || inMenu) handOn = true;
    };
    const onCompact = (event: MediaQueryListEvent): void => {
      closeForResize();
      setCompact(event.matches);
    };
    const onStacked = (event: MediaQueryListEvent): void => {
      closeForResize();
      setStacked(event.matches);
      // Nothing of the surface changes with this one: the keyboard is handed on now.
      if (handOn && untrack(compact) === (compactQuery?.matches ?? false)) queueMicrotask(() => {
        if (!handOn) return;
        handOn = false;
        focusStop("menus");
      });
    };
    compactQuery?.addEventListener("change", onCompact);
    stackedQuery?.addEventListener("change", onStacked);

    const onResize = (): void => {
      setViewport(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    const sizes = new ResizeObserver(() => setWidth(around.clientWidth));
    sizes.observe(around);
    setWidth(around.clientWidth);

    onCleanup(() => {
      detach();
      calm();
      hints.detach();
      sizes.disconnect();
      window.removeEventListener("resize", onResize);
      compactQuery?.removeEventListener("change", onCompact);
      stackedQuery?.removeEventListener("change", onStacked);
      document.removeEventListener("pointerdown", onDocumentDown, true);
      host.removeEventListener("keydown", onKeyDown, true);
      host.removeEventListener("keydown", onAnyKey, true);
      window.removeEventListener("keydown", onWindowKey, true);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      host.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("focusout", onFocusOut);
      host.removeEventListener("slab-frame", onFrame);
    });

    createEffect(() => host.setParam("bar", hasMenus() && !compact()));
    createEffect(() => host.setParam("key", hasMenus() && compact()));
    createEffect(() => host.setParam("key_open", openIndex() === COMPACT));
    createEffect(() => host.setParam("compact", compact()));
    createEffect(() => {
      const next = layout();
      host.setParam("start_w", next.start);
      host.setParam("centre_w", next.centre);
      host.setParam("end_w", next.end);
      host.setParam("name_w", next.name);
    });
    createEffect(() => host.setParam("name", paramText(title())));
    createEffect(() => host.setParam("said", paramText(commandCentreName(title(), dirty()))));
    createEffect(() => host.setParam("dirty", dirty()));
    createEffect(() => host.setParam("side", props.sidebarOpen()));
    createEffect(() => host.setParam("panel", props.panelOpen()));
    createEffect(() => host.setParam("chat", props.assistantOpen()));
    createEffect(() => host.setList("titles", "", titleParams(labels(), openIndex())));
    // The menus hidden (View ▸ Menu Bar) under an open menu: it goes with them.
    createEffect(() => {
      if (!hasMenus()) close();
    });
  });

  // The frame carries the SolidJS bar's class for what looks for the title bar by it; nothing of
  // that bar's own layout or paint applies (slab-topbar.css): the document draws all of it.
  return (
    <div ref={frame} class="slab-topbar">
      <cadcraft-topbar ref={element} class="slab-surface" />
      {/* Outside the shell: the menu opens under the band, over the ribbon and the drawing. */}
      <Show when={opened()} keyed>
        {(at) => (
          <Portal>
            <div
              class="slab-topbar-menu"
              ref={(box) => {
                menuBox = box;
                placeMenu();
                // Tab on a row, ahead of the menu's own handler (the page's, on the document):
                // on from the menus is the command centre, which the browser would pass by (the
                // surface is one stop to it). Back leaves the bar, as the menu itself has it. In
                // capture: ahead of a Slab menu's own handler, on its surface.
                box.addEventListener("keydown", (event) => {
                  if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
                  event.preventDefault();
                  event.stopPropagation();
                  focusStop("centre");
                  close();
                }, true);
              }}
              onFocusOut={(event) => {
                // The focus going to something outside closes the menu; the focus merely dropped does not.
                if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== element) close();
              }}
            >
              <MenuView
                label={at.index === COMPACT ? "Main menu" : (tree()[at.index]?.label ?? "")}
                items={at.index === COMPACT ? tree() : (tree()[at.index]?.children ?? [])}
                stacked={at.index === COMPACT && stacked()}
                within={() => menuBox}
                handle={(handle) => {
                  menu = handle;
                }}
                onInvoke={(id, byKey) => invoke(at.index, id, byKey)}
                onDismiss={(reason) => dismiss(at.index, reason)}
                {...(at.index === COMPACT ? {} : { onStep: (delta: 1 | -1) => openInto((at.index + delta + labels().length) % Math.max(1, labels().length)) })}
              />
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}
