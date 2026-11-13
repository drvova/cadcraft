/**
 * The command line drawn by Slab (`slab/cmdline.slab`): the same props as
 * `../components/CommandLine`, the same prompt, the same field. What the prompt says, what is
 * shown as refused and what a keyword answers are `../prompt`'s; the typed line, its keys, its
 * history and the link the drawing's dynamic input types through are `../components/CommandField`,
 * the one the SolidJS panel shows.
 *
 * What the kernel does: paints the band and its edge, lays out and scrolls the history (a
 * `virtual` list: the lines in view and four each side, whatever the history holds), selects its
 * text under a drag, paints the keywords and reports a pressed one (`keyword`), and paints what
 * was refused beside the typed line.
 *
 * **The typed line is the interface's own field, in a hole**, with the strip that draws its edge
 * and its prompt mark. It is the one control of the application that is typed in all day. The
 * kernel's text field was put in this panel's row and measured against it (headless Chromium, 300
 * keys each): from a key to the frame that painted its character, 12.5 ms median and 21.4 at the
 * 95th percentile in the kernel's field, 4.3 and 18 in this one, because a key there is a
 * dispatch into the kernel and a solve, and here it is the browser's own. A double click put the
 * caret in the word and selected nothing. A letter typed in it went on to the shell, which took
 * it as the start of a command and moved the keyboard away, until the key was held back by hand.
 * (A letter typed over the drawing did land in it whole, with the focus moved during the
 * keydown as the shell does: that was not a reason.) The kernel has no example text, and the
 * prompt is this field's: the browser draws it and takes it away as the first character or an
 * input method's first stroke arrives (`SlabObjects.tsx` saw composed text drawn over a host-made
 * one). And the strip follows the page's sheet under a finger (16px type), where a document's
 * `when coarse` does not hold under a named theme. So nothing between a key and its character
 * goes through the kernel: typing costs what it costs in the SolidJS panel, and no frame of any
 * surface is solved while a line is typed.
 *
 * What this file does, because the driver at the pinned commit does not:
 * - **The panel's height.** A surface is as tall as its element; the height is worked out from
 *   the params (`cmdline-params.ts`) and set with them, and the shell's bar follows the element.
 * - **Following the tail.** The history is scrolled to its last line when a line arrives, once
 *   with the params and once after the frame that laid them out (an offset is clamped to what
 *   was laid out before).
 * - **Page Up and Page Down in the field** scroll the history: selectable text takes no focus in
 *   the kernel, so the history is not a stop of its own as the SolidJS one is when it scrolls.
 * - **The error's whole text.** The SolidJS panel shows it while the error has the focus; here it
 *   is the interface's hint, raised by the focus or by the pointer resting on it.
 * - **The panel coming back at a keystroke.** A letter typed over the drawing while the panel is
 *   folded away brings it back and lands in the field, which must be drawn in that same turn. An
 *   element fetches its document when it is connected and mounts it a turn later, and until then
 *   nothing slotted into it is drawn. The document's bytes are kept after the first fetch, and an
 *   element made later is handed them before it is connected, so it mounts at once.
 * - **The kernel's focus**, cleared when the field takes the keyboard, so no keyword keeps a ring.
 *
 * Mounted by the Slab shell in the editor pane, after `loadSlab("cmdline")` has defined the element.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { CommandLineProps } from "../components/CommandLine";
import { CommandField, readProp } from "../components/CommandField";
import { freshError, promptText, type PromptState } from "../prompt";
import { attachHints, type SlabHint } from "./chrome-hints";
import { CMD_MEASURES, cmdlineParams, droppedLines, pagedScroll, panelHeight, pressedKeyword, tailScroll, type CmdlineParams, type CmdPage } from "./cmdline-params";
import { computedColor } from "./layers-params";
import { pageMeasure, type TextMeasure } from "./measure";
import { isSlabControlHost, nodeAt, ringForKeysOnly, type SlabControlHost } from "./scene";
import { attachSurface } from "./surface";
import { signalDetail, type SlabHost } from "./types";
import "./slab-chrome.css";
import "./slab-cmdline.css";

/** The document's keys: the scrolling history and the error beside the field. */
const OUT = "#band/#body/#out";
const ERROR = "#band/#body/#entry/#error";

/** The element the document defines (`./loader`: SLAB_TAGS). */
const TAG = "cadcraft-cmdline";

/** The compiled document, kept once it has been fetched (see "the panel coming back", above). */
let documentBytes: Uint8Array | null = null;
let documentAsked = false;

function keepDocument(): void {
  if (documentAsked || typeof customElements === "undefined" || typeof fetch !== "function") return;
  documentAsked = true;
  const cls: unknown = customElements.get(TAG);
  const url: unknown = typeof cls === "function" && "slir" in cls ? cls.slir : null;
  if (typeof url !== "string" || url === "") return;
  void fetch(url)
    .then((reply) => (reply.ok ? reply.arrayBuffer() : null))
    .then((buffer) => {
      if (buffer !== null && buffer.byteLength > 0) documentBytes = new Uint8Array(buffer);
    })
    .catch(() => undefined);
}

/** Mount the document on an element that is not connected yet, when its bytes are at hand. */
function mountAtOnce(element: HTMLElement): void {
  if (documentBytes === null || element.isConnected) return;
  const load: unknown = "loadSlir" in element ? element.loadSlir : undefined;
  if (typeof load === "function") Reflect.apply(load, element, [documentBytes]);
}

const SCALARS = ["out_h", "pad_t", "pad_b", "out_gap", "keys_gap", "entry_h", "said", "failed", "error", "err_w"] as const;
const LISTS = ["lines", "key_rows"] as const;

function apply(host: SlabHost, params: CmdlineParams): void {
  for (const name of SCALARS) host.setParam(name, params[name]);
  for (const name of LISTS) host.setList(name, "", params[name]);
}

export function SlabCommandLine(props: CommandLineProps): JSX.Element {
  const state = (): PromptState => readProp(props.prompt);
  const [width, setWidth] = createSignal(0);
  const [measure, setMeasure] = createSignal<TextMeasure | null>(null);

  /** The number of the history's first line: it goes up as the capped tail lets its oldest lines go. */
  const numbered = createMemo<{ output: readonly string[]; first: number }>(
    (prev) => {
      const output = state().output;
      return output === prev.output ? prev : { output, first: prev.first + droppedLines(prev.output, output) };
    },
    { output: [], first: 0 },
  );
  const error = createMemo(() => freshError(state(), readProp(props.notice)));
  const params = createMemo((): CmdlineParams => {
    const m = measure();
    const page: CmdPage = {
      width: width(),
      monoAdvance: m?.("mono", "0") ?? 0,
      labelAdvance: m?.("label", "0") ?? 0,
      keyWidth: (word) => m?.("chip", word) ?? word.length * 6,
      errorWidth: (text) => m?.("label", text) ?? Number.POSITIVE_INFINITY,
    };
    return cmdlineParams(state(), error(), numbered().first, page);
  });
  const height = createMemo(() => panelHeight(params()));

  let element: HTMLElement | undefined;
  let frame: HTMLElement | undefined;
  let ink: HTMLSpanElement | undefined;
  let surface: SlabControlHost | undefined;
  let submit: (text: string) => void = () => undefined;

  /**
   * The field's keys that are the panel's. Page Up and Page Down scroll the history. Tab goes on
   * to the error while there is one, as in the SolidJS panel (for the browser the surface's one
   * stop comes before the field).
   */
  const onPanelKey = (event: KeyboardEvent): boolean => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    const host = surface;
    if (event.key === "Tab" && host !== undefined && params().failed) {
      // The page's focus goes into the surface (on its one stop), and the kernel is told the error.
      const stop = host.shadowRoot?.querySelector<HTMLElement>('.slab-a11y-node[tabindex="0"]') ?? null;
      if (stop === null) return false;
      event.preventDefault();
      stop.focus({ preventScroll: true });
      host.setFocus(ERROR, true);
      return true;
    }
    if (event.key !== "PageUp" && event.key !== "PageDown") return false;
    if (host === undefined || params().lines.length * CMD_MEASURES.line <= params().out_h) return false;
    event.preventDefault();
    host.setScroll(OUT, 0, pagedScroll(host.getScroll(OUT, 0), event.key === "PageUp" ? -1 : 1, params()));
    return true;
  };

  keepDocument();

  onMount(() => {
    setMeasure(() => pageMeasure());
    if (element === undefined || frame === undefined || !isSlabControlHost(element)) return;
    const host = element;
    const around = frame;
    surface = host;

    const hintFor = (key: string): SlabHint | null => {
      // The error's own words are what it shows: the hint is its whole text, where two lines cut it.
      return key === ERROR && params().errCut ? { text: params().error, placement: "top" } : null;
    };
    const hints = attachHints(host, around, hintFor);
    const onPointerMove = (event: PointerEvent): void => {
      if (!params().failed) return;
      const box = host.getBoundingClientRect();
      hints.over(nodeAt(host, event.clientX - box.left, event.clientY - box.top, (key) => key === ERROR)?.key ?? null);
    };
    host.addEventListener("pointermove", onPointerMove);

    const detach = attachSurface(host, ["keyword"], (_name, event) => {
      const word = pressedKeyword(state().keywords, signalDetail(event)?.item ?? "");
      if (word !== null) submit(word);
    });
    const calm = ringForKeysOnly(host);

    /**
     * Tab with the keyboard on the error, ahead of `attachSurface` (which hands every Tab to the
     * browser): backwards is the field, which stands before the error for the eye; forwards
     * leaves the panel, past the field.
     */
    const onTab = (event: KeyboardEvent): void => {
      if (event.key !== "Tab" || event.target !== host || event.altKey || event.ctrlKey || event.metaKey || host.focusedKey() !== ERROR) return;
      const field = host.querySelector<HTMLInputElement>(".cmd-input");
      if (field === null) return;
      if (event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        field.focus();
        return;
      }
      // Out of the Tab order while the browser picks the next stop, then back.
      field.tabIndex = -1;
      setTimeout(() => field.removeAttribute("tabindex"), 0);
    };
    host.addEventListener("keydown", onTab, true);

    /** The field took the keyboard: no keyword keeps the keyboard's ring behind it. */
    const onFocusIn = (event: FocusEvent): void => {
      if (event.target !== host) host.clearFocus();
    };
    host.addEventListener("focusin", onFocusIn);

    // The error's ink is a `color-mix` of the sheet's: it is read from the page, in both themes
    // (and first at the first frame: at the mount the panel is not in the page yet).
    let inked = false;
    const readInk = (): void => {
      const color = ink === undefined ? null : computedColor(getComputedStyle(ink).color);
      if (color === null) return;
      inked = true;
      host.setParam("err_ink", color);
    };
    const themes = new MutationObserver(readInk);
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    /** A line arrived: the frame that lays it out is followed by a scroll to the tail. */
    let follow = false;
    const onFrame = (): void => {
      if (!inked) readInk();
      if (!follow) return;
      follow = false;
      host.setScroll(OUT, 0, tailScroll(params()));
    };
    host.addEventListener("slab-frame", onFrame);

    const sizes = new ResizeObserver(() => setWidth(host.clientWidth));
    sizes.observe(host);
    setWidth(host.clientWidth);

    onCleanup(() => {
      detach();
      calm();
      hints.detach();
      sizes.disconnect();
      themes.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("keydown", onTab, true);
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("slab-frame", onFrame);
      surface = undefined;
    });

    let shown: readonly unknown[] | null = null;
    createEffect(() => {
      const next = params();
      apply(host, next);
      if (shown === next.lines) return;
      // The history changed (a line arrived, or the panel's width cut it anew): show its tail.
      shown = next.lines;
      host.setScroll(OUT, 0, tailScroll(next));
      follow = true;
    });
  });

  return (
    <section ref={frame} class="cmdline slab-cmdline" aria-label="Command line">
      <cadcraft-cmdline
        ref={(el: HTMLElement) => {
          element = el;
          mountAtOnce(el);
        }}
        class="slab-cmdline-surface"
        style={{ height: `${height()}px` }}
      >
        <div slot="field" class="slab-cmdline-field" classList={{ "has-error": params().failed }}>
          <CommandField
            placeholder={promptText(state())}
            running={state().running !== null}
            onSubmit={(text) => props.onSubmit(text)}
            submitter={(run) => {
              submit = run;
            }}
            onPanelKey={onPanelKey}
          />
        </div>
      </cadcraft-cmdline>
      <span ref={ink} class="cmd-error" hidden />
    </section>
  );
}
