/**
 * The assistant panel with its frame drawn by Slab (`slab/assistant.slab`): the same props as
 * `../components/AssistantPane`, and the same component. The panel is not forked: it is mounted
 * as it is, and handed a `frame` that draws the title band, the empty state, the chips and the
 * composer's card and toolbar with the kernel, and mounts the panel's own parts in holes. Every
 * decision (what a press sends, what a chip is, when the setup opens, where the focus returns)
 * stays in `AssistantPane` and `../assistant-session`; this file shapes the panel's state for
 * the document (`./assistant-params`) and answers its signals with the panel's own actions.
 *
 * **What stays SolidJS, in holes, and why.**
 *
 * - **The editor** (`editor`): the interface's `TextArea`. The kernel's field of several lines
 *   (`field=` with `multiline` and `submit=`) was built and measured as this editor. What worked:
 *   typing, Shift+Enter for a new line and Enter to send, growing a line at a time, Ctrl+A and
 *   the clipboard, its own undo, and a pasted picture still reaching the host (the `paste` event
 *   is seen before the kernel takes its text). What did not: a double click selects no word and a
 *   triple click no line; it has no placeholder for a screen reader and no `aria-multiline`; it
 *   cannot be the combobox of the `@` and `/` lists (its node is in the surface's own tree and
 *   cannot point at a listbox of the page, nor the reverse); and what the Objects search found
 *   holds here too (`./SlabObjects`: an input method's text drawn over the placeholder, no Paste
 *   by the pointer).
 * - **What stands over the card** (`stack`): the queue, the unresolved changes, the status with
 *   Stop, and the slash and `@` lists. The lists are the editor's listbox and must be in the
 *   page's tree for the editor to point into them.
 * - **The conversation** (`main`). It was built in Slab (one flat list of blocks, each a `para`
 *   of runs from the panel's own `growReply` and `parseInline`, in a `select` scroller) and
 *   measured against the SolidJS transcript on the same replies. It can be drawn: paragraphs,
 *   bold, inline code, a link's ink and underline, lists, headings, a code block with its lines.
 *   It is not as good to read or to copy, so it is not shipped:
 *   - a paragraph that wraps is copied with a line break at the end of every drawn line (a URL
 *     broken across two lines is copied in two pieces); the SolidJS one is copied as written;
 *   - a double click selects no word and a triple click no paragraph; a selection is a drag only;
 *   - a link does not open: a run of a paragraph takes no press, and has no role;
 *   - a screen reader is given the words and one button a step, with no heading, list or link
 *     (the SolidJS transcript has them);
 *   - streaming: with 60 paragraphs arriving over 5.7 s, the SolidJS transcript took 0.12 s of
 *     script (frames 16.7 ms median, 17.1 p95, none over 34); the Slab one took 3.7 to 3.9 s of
 *     script, 18 to 20 ms a frame median and 31 p95, 2 to 15 frames over 34 ms. Writing only the
 *     runs of the block being written (by list path) brought the write to 0.1 ms and left the
 *     frame where it was: the kernel lays the whole list out again and the driver syncs every
 *     node. A `virtual` list would bound it, but its rows must be one height unless the host
 *     sets extents, and the web element has no call for that.
 * - **The setup sheet** (`main`, over the conversation): a form of text fields.
 *
 * **What this file does, because the driver at the pinned commit does not:**
 *
 * - **Tab.** The kernel walks its own ring on Tab and wraps, and the page sees one stop for the
 *   whole surface with every hole after it. Here Tab walks the frame's controls and the controls
 *   in the holes one at a time in reading order (the rule of `./modal`: `orderStops`, `tabMove`),
 *   and leaves at either end by the browser's own order. So the order is the SolidJS panel's: the title's keys, the
 *   conversation, the stack, the chips, the editor, the model slot, attach, send.
 * - **Escape** on a control of the frame is handed to the panel (it closes the setup or stops the
 *   turn) and then to the shell, as from any control of the SolidJS panel.
 * - **The holes' heights.** A hole that hugs cannot shrink: the host measures the stack and the
 *   editor and sets two numbers.
 * - **Hints**, round stroke ends, the ring kept to the keyboard, the theme and the motion switch
 *   (`./chrome-hints`, `./scene`, `./surface`).
 * - **A picture's thumbnail**: decoded by the page, cut to a square and registered with the
 *   kernel as pixels.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, untrack, type JSX } from "solid-js";
import type { ChatImage } from "../assistant";
import { AssistantPane, type AssistantFrame, type AssistantPaneProps } from "../components/AssistantPane";
import {
  chatCap,
  chatClipped,
  chatParams,
  chipClipped,
  chipLines,
  chipNote,
  chipSources,
  chipWords,
  controlAt,
  controlOfKey,
  ideaParams,
  KEYS,
  pressedChat,
  pressedChip,
  pressedIdea,
  sendKey,
  toolbarParams,
  type ChipSource,
  type ToolbarState,
} from "./assistant-params";
import { attachHints, type SlabHint } from "./chrome-hints";
import { isSlabFieldHost, type SlabFieldHost } from "./fields";
import { pageMeasure, type TextMeasure } from "./measure";
import { acceptsFocus, orderStops, tabMove, type StopBox } from "./modal";
import { isSlabControlHost, itemOfKey, ringForKeysOnly, type SlabControlHost } from "./scene";
import { attachSurface } from "./surface";
import { isSlabHost, signalDetail } from "./types";
import "./slab-assistant.css";

type FrameHost = SlabFieldHost & SlabControlHost;

/** The driver's image registry, when the build has it (a picture's chip shows no thumbnail without). */
interface ImageHost {
  imgRegister(name: string, width: number, height: number, format: number, bytes: Uint8Array): number;
  imgUnregister(name: string): boolean;
}

function isImageHost(host: object): host is ImageHost {
  return ["imgRegister", "imgUnregister"].every((name) => name in host && typeof Reflect.get(host, name) === "function");
}

/** Straight-alpha RGBA8, the kernel's `format=1`. */
const RGBA8 = 1;

/** A thumbnail's side in pixels: the chip draws it at 20, twice that for a dense screen. */
const THUMB_PX = 40;

/** The most thumbnails registered at once (the panel allows four pictures a message). */
const MAX_THUMBS = 16;

/** See `./SlabRibbon`: the driver strokes with flat ends, and the interface's glyphs are round. */
const ROUND_STROKES = ".slab-ops svg path { stroke-linecap: round; stroke-linejoin: round; }";

function roundStrokes(host: HTMLElement): void {
  const root = host.shadowRoot;
  if (root === null) return;
  if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in root) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(ROUND_STROKES);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return;
    } catch {
      // An engine that refuses a constructed sheet takes the element below.
    }
  }
  const style = host.ownerDocument.createElement("style");
  style.textContent = ROUND_STROKES;
  root.appendChild(style);
}

const roughMeasure: TextMeasure = (_style, text) => [...text].length * 7;

/** The controls of the page a Tab press lands on (`./modal`'s list). */
const TABBABLE = "input:not([type='hidden']), select, textarea, button, a[href], [tabindex]";

function tabbable(el: HTMLElement): boolean {
  if (el.tabIndex < 0 || el.closest("[hidden], [inert]") !== null) return false;
  return !("disabled" in el && el.disabled === true);
}

/** How long after a Tab press a focus arriving on the surface is taken to be that press's. */
const TAB_WINDOW_MS = 400;

/** The card's and the foot's insets around the chips and the toolbar (the document's `pad`s). */
const FOOT_PAD = 8;
const CARD_EDGE = 1;
const CHIPS_PAD = 12;

const SCALARS = [
  "title",
  "quiet",
  "tabbed",
  "setup",
  "blank",
  "line",
  "suggest",
  "stack_h",
  "editor_h",
  "typing",
  "chipped",
  "model",
  "model_said",
  "model_cap",
  "unset",
  "meter",
  "meter_said",
  "metered",
  "stopping",
  "send_name",
  "send_said",
  "send_off",
] as const;
const LISTS = ["chats", "ideas", "chip_lines"] as const;

/** A picture's pixels for its chip: decoded, cut to a centred square, `THUMB_PX` a side. Null where the page cannot. */
async function thumbnail(picture: ChatImage): Promise<Uint8Array | null> {
  if (typeof Image !== "function" || !picture.dataUrl.startsWith("data:image/")) return null;
  try {
    const image = new Image();
    image.src = picture.dataUrl;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (side <= 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_PX;
    canvas.height = THUMB_PX;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return null;
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, THUMB_PX, THUMB_PX);
    return new Uint8Array(ctx.getImageData(0, 0, THUMB_PX, THUMB_PX).data.buffer);
  } catch {
    return null;
  }
}

function SlabFrame(p: { view: AssistantFrame }): JSX.Element {
  const view = p.view;
  const s = view.session;
  const props = view.props;
  const [width, setWidth] = createSignal(0);
  const [stackHeight, setStackHeight] = createSignal(0);
  const [editorHeight, setEditorHeight] = createSignal(20);
  const [typing, setTyping] = createSignal(false);
  const [measure, setMeasure] = createSignal<TextMeasure>(roughMeasure);
  /** The pointer is a finger: the document draws its small keys wider (`when coarse`), and the chips are broken to that. */
  const [coarse, setCoarse] = createSignal(false);
  /** The name each attached picture's thumbnail is registered under, once it is. */
  const [thumbs, setThumbs] = createSignal<ReadonlyMap<ChatImage, string>>(new Map());
  let element: HTMLElement | undefined;
  let around: HTMLDivElement | undefined;
  let stackFit: HTMLDivElement | undefined;
  let editorFit: HTMLDivElement | undefined;

  const blank = (): boolean => s.entries.length === 0 && !view.setupOpen();
  const sources = createMemo((): ChipSource[] => chipSources(view.selectionShown(), props.selection().length, view.mentionChips(), s.attached()));
  const cardWidth = (): number => Math.max(0, width() - 2 * FOOT_PAD - 2 * CARD_EDGE);
  const cap = createMemo(() => chatCap(measure()));
  const toolbarState = (): ToolbarState => ({
    ready: s.ready(),
    model: s.provider().model,
    hint: view.modelHint(),
    note: view.modelNote(),
    meter: view.meter(),
    used: view.used(),
    budget: view.budget,
    running: s.running(),
    draft: s.input(),
    over: view.over(),
    sendNote: view.sendNote(),
  });
  const params = createMemo(() => {
    const tabbed = props.chats().length > 1 && !view.setupOpen();
    const lines = chipLines(sources(), cardWidth() - 2 * CHIPS_PAD, measure(), (picture) => thumbs().get(picture) ?? "", coarse());
    return {
      title: view.setupOpen() ? "Set up a model" : "Assistant",
      quiet: !view.setupOpen(),
      tabbed,
      chats: tabbed ? chatParams(props.chats(), props.chatIndex(), cap()) : [],
      setup: view.setupOpen(),
      blank: blank(),
      line: view.emptyLine,
      suggest: s.ready(),
      ideas: ideaParams(view.examples),
      stack_h: stackHeight(),
      editor_h: editorHeight(),
      typing: typing(),
      chipped: lines.length > 0,
      chip_lines: lines,
      ...toolbarParams(toolbarState(), cardWidth(), measure()),
    };
  });

  onMount(() => {
    if (element === undefined || around === undefined || !isSlabHost(element) || !isSlabFieldHost(element) || !isSlabControlHost(element)) return;
    const host: FrameHost = element;
    const frame = around;
    setMeasure(() => pageMeasure() ?? roughMeasure);
    roundStrokes(host);
    const finger = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
    const onFinger = (): void => void setCoarse(finger?.matches === true);
    finger?.addEventListener("change", onFinger);
    onFinger();

    // -- sizes ----------------------------------------------------------------------------
    const fit = (): void => {
      setWidth(host.clientWidth);
      if (stackFit !== undefined) setStackHeight(stackFit.offsetHeight);
      if (editorFit !== undefined && editorFit.offsetHeight > 0) setEditorHeight(editorFit.offsetHeight);
    };
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    sizes?.observe(host);
    if (stackFit !== undefined) sizes?.observe(stackFit);
    if (editorFit !== undefined) sizes?.observe(editorFit);
    fit();

    // The panel puts the keyboard in its editor as it mounts (a panel that was opened, a chat
    // that was started). Mounted in a hole, the editor is not drawn until the surface has laid
    // its holes out, and takes no focus before: it is given the keyboard at the first frame,
    // unless something else took it meanwhile.
    const doc = host.ownerDocument;
    const onFirstFrame = (): void => {
      host.removeEventListener("slab-frame", onFirstFrame);
      if (doc.activeElement === null || doc.activeElement === doc.body) view.focusEditor();
    };
    host.addEventListener("slab-frame", onFirstFrame);

    // -- the keyboard ---------------------------------------------------------------------
    const inside = (node: unknown): boolean => node instanceof Node && (node === host || host.contains(node) || host.shadowRoot?.contains(node) === true);

    interface Stop extends StopBox {
      el: HTMLElement;
      /** The node's full key; null for a control in a hole. */
      key: string | null;
    }
    const box = (el: HTMLElement): StopBox => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, left: rect.left, height: rect.height };
    };
    /** The frame's stops in reading order: the kernel's focusable nodes and the controls in the holes. */
    const stops = (): Stop[] => {
      const out: Stop[] = [];
      const focusable = new Set<string>();
      for (const node of host.sceneSnapshot()) if (acceptsFocus(node)) focusable.add(node.key);
      if (focusable.size > 0) {
        for (const el of Array.from(host.shadowRoot?.querySelectorAll<HTMLElement>(".slab-a11y-node") ?? [])) {
          const key = el.dataset["slabKey"];
          if (key !== undefined && focusable.delete(key)) out.push({ el, key, ...box(el) });
        }
      }
      for (const el of Array.from(host.querySelectorAll<HTMLElement>(TABBABLE))) if (tabbable(el)) out.push({ el, key: null, ...box(el) });
      return orderStops(out);
    };
    const focusStop = (stop: Stop): void => {
      if (stop.key === null) {
        // The kernel would keep its ring on the key the keyboard just left.
        host.clearFocus();
        stop.el.focus();
        return;
      }
      if (!host.setFocus(stop.key, true)) return;
      // The driver mirrors the kernel's focus onto the page only while its own tree has it, and
      // a node that has not had the focus yet carries no `tabindex` to take it by.
      if (!stop.el.hasAttribute("tabindex")) stop.el.tabIndex = -1;
      stop.el.focus({ preventScroll: true });
    };
    /** Put the keyboard on a control of the frame by its key, once the scene has it. */
    const focusKey = (key: string, tries = 8): void => {
      const stop = stops().find((candidate) => candidate.key === key);
      if (stop !== undefined) focusStop(stop);
      else if (tries > 0) void host.whenSettled().then(() => focusKey(key, tries - 1));
    };

    /** A Tab press is on its way out of the frame: nothing arriving meanwhile is an entry. */
    let leaving = false;
    /** The last Tab press in the window: a focus arriving on the surface just after it came by that key. */
    let tabbed: { shift: boolean; at: number } | null = null;
    const onWindowKey = (e: KeyboardEvent): void => {
      tabbed = e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey ? { shift: e.shiftKey, at: performance.now() } : null;
    };
    const onWindowPointer = (): void => {
      tabbed = null;
    };
    doc.addEventListener("keydown", onWindowKey, true);
    doc.addEventListener("pointerdown", onWindowPointer, true);

    // Ahead of the driver (which would hand Tab and Escape to the kernel) and of `attachSurface`
    // (which leaves Tab to the browser: one stop for the whole surface).
    const onKeyCapture = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && e.target === host) {
        // The panel's own Escape (it closes the setup, or stops the turn), then the shell's.
        e.stopImmediatePropagation();
        e.preventDefault();
        frame.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        return;
      }
      if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
      // This press is answered here: the focus it moves is no arrival from outside.
      tabbed = null;
      const list = stops();
      const at = e.target instanceof Node && e.target !== host && host.contains(e.target) ? list.findIndex((stop) => stop.key === null && (stop.el === e.target || stop.el.contains(e.target as Node))) : list.findIndex((stop) => stop.key !== null && stop.key === host.focusedKey());
      const move = tabMove(list.length, at, e.shiftKey);
      e.stopImmediatePropagation();
      if (move.kind === "stop") {
        const stop = list[move.index];
        if (stop === undefined) return;
        e.preventDefault();
        focusStop(stop);
        return;
      }
      // Leaving: the browser picks the next stop of the page itself, from where the keyboard is
      // (the stop may be inside another surface's tree, which no query from here reaches, and
      // the order the browser walks the holes and the frame's own stop in is the driver's).
      // Every control in the holes is out of the Tab order while it picks, so it picks nothing
      // of this frame.
      const held = Array.from(host.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => el.tabIndex >= 0);
      const was = held.map((el) => el.getAttribute("tabindex"));
      for (const el of held) el.tabIndex = -1;
      leaving = true;
      setTimeout(() => {
        leaving = false;
        for (const [index, el] of held.entries()) {
          const before = was[index];
          if (before === null || before === undefined) el.removeAttribute("tabindex");
          else el.setAttribute("tabindex", before);
        }
      }, 0);
    };
    host.addEventListener("keydown", onKeyCapture, true);

    const onFocusIn = (e: FocusEvent): void => {
      // A hole's control took the page's focus: the kernel's ring goes.
      if (e.target instanceof Node && e.target !== host && host.contains(e.target) && host.focusedKey() !== null) host.clearFocus();
      setTyping(editorFit !== undefined && e.target instanceof Node && editorFit.contains(e.target));
      const came = tabbed;
      tabbed = null;
      if (leaving || inside(e.relatedTarget) || came === null || performance.now() - came.at > TAB_WINDOW_MS) return;
      const list = stops();
      const stop = came.shift ? list[list.length - 1] : list[0];
      if (stop !== undefined) focusStop(stop);
    };
    const onFocusOut = (e: FocusEvent): void => {
      if (editorFit !== undefined && !(e.relatedTarget instanceof Node && editorFit.contains(e.relatedTarget))) setTyping(false);
    };
    host.addEventListener("focusin", onFocusIn);
    host.addEventListener("focusout", onFocusOut);

    // -- hints ----------------------------------------------------------------------------
    const hintFor = (key: string): SlabHint | null => {
      const control = controlOfKey(key);
      const item = itemOfKey(key);
      switch (control) {
        case "new":
          return { text: "New chat" };
        case "close":
          return { text: "Close the assistant" };
        case "model": {
          const note = view.modelNote();
          return note === undefined ? { text: view.modelHint(), placement: "top" } : { text: view.modelHint(), note, placement: "top" };
        }
        case "attach":
          return { text: "Attach a picture", note: "Or paste one, or drop one on the panel", placement: "top" };
        case "send": {
          const send = sendKey(toolbarState());
          return send.note === "" ? { text: send.name, keys: send.keys, placement: "top" } : { text: send.name, keys: send.keys, note: send.note, placement: "top" };
        }
        case "meter":
          return { text: "Context in the next request", note: `${view.used().toLocaleString()} of ${view.budget.toLocaleString()} characters`, placement: "top" };
        case "chat": {
          const index = pressedChat(item, props.chats().length);
          const tab = index === null ? undefined : chatParams(props.chats(), props.chatIndex(), cap())[index];
          return tab !== undefined && chatClipped(tab.name, tab.cap, measure()) ? { text: tab.name } : null;
        }
        case "chat-shut": {
          const index = pressedChat(item, props.chats().length);
          const title = index === null ? undefined : props.chats()[index];
          return title === undefined ? null : { text: `Close ${title}` };
        }
        case "chip":
        case "chip-drop": {
          const source = pressedChip(item, sources());
          if (source === null) return null;
          const words = chipWords(source);
          if (control === "chip-drop") return { text: words.shut, placement: "top" };
          const note = chipNote(source);
          const line = params().chip_lines.flatMap((l) => l.chips).find((chip) => chip.key === item);
          const clipped = line !== undefined && chipClipped(words.name, line.cap, measure());
          if (note !== undefined) return { text: words.name, note, placement: "top" };
          return clipped ? { text: words.name, placement: "top" } : null;
        }
        default:
          return null;
      }
    };
    const hints = attachHints(host, frame, hintFor);
    let overKey: string | null = null;
    const onPointerMove = (event: PointerEvent): void => {
      if (event.target !== host) {
        // Over a hole: the frame's own hint is put away, and the page's hint has the control there.
        if (overKey === null) return;
        overKey = null;
        hints.over(null);
        if (event.target instanceof Element && typeof PointerEvent === "function") event.target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: event.pointerType }));
        return;
      }
      const rect = host.getBoundingClientRect();
      const key = controlAt(host.sceneSnapshot(), event.clientX - rect.left, event.clientY - rect.top);
      if (key === overKey) return;
      overKey = key;
      hints.over(key);
    };
    const onPointerLeave = (): void => {
      overKey = null;
    };
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerleave", onPointerLeave);
    const calm = ringForKeysOnly(host);

    // A press on the card that is on none of its controls lands in the editor, as a press on the
    // SolidJS card's inset does (there the editor's label takes it).
    const onCardPress = (event: PointerEvent): void => {
      if (event.target !== host || event.button !== 0) return;
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const scene = host.sceneSnapshot();
      const card = scene.find((node) => node.key === KEYS.card);
      if (card === undefined || !(x >= card.x && x < card.x + card.w && y >= card.y && y < card.y + card.h) || controlAt(scene, x, y) !== null) return;
      event.preventDefault();
      host.clearFocus();
      view.focusEditor();
    };
    host.addEventListener("pointerdown", onCardPress);

    // -- signals --------------------------------------------------------------------------
    /** The control of the frame the setup was opened from: the keyboard goes back to it. */
    let opener: string | null = null;
    const detach = attachSurface(host, ["new_chat", "close", "chat", "chat_shut", "suggest", "chip_shut", "model", "attach", "send"], (name, event) => {
      const item = signalDetail(event)?.item ?? "";
      switch (name) {
        case "new_chat":
          host.clearFocus();
          view.newChat();
          return;
        case "close":
          props.onClose();
          return;
        case "chat": {
          const index = pressedChat(item, props.chats().length);
          if (index !== null) props.onSelectChat(index);
          return;
        }
        case "chat_shut": {
          const index = pressedChat(item, props.chats().length);
          if (index !== null) props.onCloseChat(index);
          return;
        }
        case "suggest": {
          const words = pressedIdea(item, view.examples);
          if (words === null) return;
          host.clearFocus();
          view.useExample(words);
          return;
        }
        case "chip_shut": {
          const source = pressedChip(item, sources());
          if (source === null) return;
          // The chip's key goes with it: the keyboard goes to the editor the chip was in.
          const held = host.matches(":focus-within") && host.focusedKey() !== null;
          view.drop(source.kind === "selection" ? "selection" : source.kind === "mention" ? source.mention : source.picture);
          if (held) {
            host.clearFocus();
            view.focusEditor();
          }
          return;
        }
        case "model":
          opener = host.focusedKey();
          view.toggleSetup();
          return;
        case "attach":
          view.attach();
          return;
        case "send": {
          const send = sendKey(toolbarState());
          if (send.stopping) s.stop();
          else if (!send.off) {
            opener = host.focusedKey();
            view.send();
          }
          return;
        }
      }
    });

    // The setup closed: the panel gives the focus back to what had it, and a control of the
    // frame is no element of the page it could remember. The keyboard goes back to that control.
    createEffect<boolean>((was) => {
      const open = view.setupOpen();
      if (was && !open) {
        const key = opener;
        opener = null;
        queueMicrotask(() =>
          queueMicrotask(() => {
            const active = doc.activeElement;
            if (key !== null && (active === null || active === doc.body || active === host)) focusKey(key);
          }),
        );
      }
      return open;
    }, view.setupOpen());

    // -- thumbnails -----------------------------------------------------------------------
    let serial = 0;
    const registered = new Map<ChatImage, string>();
    createEffect(() => {
      const pictures = s.attached();
      if (!isImageHost(host)) return;
      const images: ImageHost = host;
      for (const [picture, name] of registered) {
        if (pictures.includes(picture)) continue;
        images.imgUnregister(name);
        registered.delete(picture);
      }
      for (const picture of pictures) {
        if (registered.has(picture) || registered.size >= MAX_THUMBS) continue;
        const name = `thumb-${serial++}`;
        registered.set(picture, name);
        void thumbnail(picture).then((pixels) => {
          // The picture may have left while it was decoded.
          if (pixels === null || registered.get(picture) !== name) return;
          if (images.imgRegister(name, THUMB_PX, THUMB_PX, RGBA8, pixels) >= 0) setThumbs(new Map(registered));
        });
      }
      const have = untrack(thumbs);
      setThumbs(new Map([...registered].filter(([picture]) => have.has(picture))));
    });

    const sent = new Map<string, string>();
    // Only what changed is written: the driver draws a frame for every write, whether or not the
    // value is new, and a draft changes with every key typed (300 characters cost 60 to 77
    // frames of nothing before this; they cost the handful that change something).
    createEffect(() => {
      const now = params();
      for (const name of SCALARS) {
        const value = now[name];
        const text = String(value);
        if (sent.get(name) === text) continue;
        if (host.setParam(name, value)) sent.set(name, text);
      }
      for (const name of LISTS) {
        const text = JSON.stringify(now[name]);
        if (sent.get(name) === text) continue;
        if (host.setList(name, "", now[name])) sent.set(name, text);
      }
    });

    onCleanup(() => {
      sizes?.disconnect();
      finger?.removeEventListener("change", onFinger);
      detach();
      calm();
      hints.detach();
      host.removeEventListener("slab-frame", onFirstFrame);
      doc.removeEventListener("keydown", onWindowKey, true);
      doc.removeEventListener("pointerdown", onWindowPointer, true);
      host.removeEventListener("keydown", onKeyCapture, true);
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("focusout", onFocusOut);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      host.removeEventListener("pointerdown", onCardPress);
    });
  });

  return (
    <div ref={around} class="slab-assistant">
      <cadcraft-assistant ref={element} class="slab-assistant-surface">
        <div slot="main" class="slab-assistant-main">
          {view.main(false)}
        </div>
        <div slot="stack" class="slab-assistant-stack">
          <div ref={stackFit}>{view.stack()}</div>
        </div>
        <div slot="editor" class="slab-assistant-editor">
          <div ref={editorFit}>{view.editor()}</div>
          {view.picker()}
        </div>
      </cadcraft-assistant>
    </div>
  );
}

export function SlabAssistant(props: AssistantPaneProps): JSX.Element {
  return <AssistantPane {...props} frame={(view) => <SlabFrame view={view} />} />;
}
