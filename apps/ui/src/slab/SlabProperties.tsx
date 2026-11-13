/**
 * The Properties section drawn by Slab (`slab/properties.slab`): the same props as
 * `../components/PropertiesPanel`, the same rows (`../props`), the same row editing
 * (`../props-edit`), the same handlers. Only the view is Slab's: the rows are a typed list param,
 * and every press, tick and typed value comes back as a signal with the row's key.
 *
 * What the host does because the kernel owns the controls:
 *
 * - **A typed value** is the kernel's field, kept as the Piece section keeps its own
 *   (`./SlabPiece`): its text is the row's draft, `row_edit` carries every change, `row_submit` is
 *   Enter, and the field losing the kernel's focus (seen after each frame) or the surface losing
 *   the page's is the commit a blur makes. A value the engine changed is written into the field's
 *   buffer unless it is being typed into. A field the focus came to has its value selected whole.
 * - **A choice** opens its values as a popup over the page (`./popup`), anchored to the row's
 *   control: the control says `expanded`, the keyboard goes to the list, and a pick, Escape or
 *   Tab bring it back to the control. A press outside closes the popup; when that press is on the
 *   control that opened it, it is the closing and nothing more.
 * - **The keys.** One tab stop and the arrows, as in the rail's other sections; Up and Down
 *   leave a field for the row above or below, since Left and Right are the caret's; Alt+Down opens
 *   a choice, as it does a native list. Keys typed in a field are kept from the shell (`./fields`).
 * - **The hints** (`./hints`): a label, a choice's value or the heading's count that an ellipsis
 *   cuts is shown whole, and a refused field says why.
 *
 * A row that leaves (another selection) takes its unfinished edit and an open popup with it.
 *
 * Mounted by the shell in the sidebar, after `loadSlab("properties")` has defined the element.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, untrack, type JSX } from "solid-js";
import type { PropertiesPanelProps } from "../components/PropertiesPanel";
import type { PropRow } from "../props";
import { createPropEdit, propertiesSubject, rowMode, type PropEdit } from "../props-edit";
import { fieldKeepsKey, isSlabFieldHost, type SlabFieldHost } from "./fields";
import { trackSurface } from "./hints";
import { choiceNode, fieldNode, fieldNodeLike, focusedRow, hiddenEnds, stepNode, UNCAPPED } from "./piece-params";
import { isReopen, returnFocus, sceneBoxInWindow, SlabPopup, type OpenPopup, type PopupDismiss } from "./popup";
import { bodyNatural, choicePopup, linePart, listedRows, partHint, propertiesPanelParams, PROPERTIES_LISTS, PROPERTIES_SCALARS, PROPERTIES_SIGNALS, signalLine, type PropertiesPanelParams } from "./properties-params";
import { attachSurface } from "./surface";
import { isSlabHost, signalDetail } from "./types";
import "./slab-properties.css";

/** The share of the rail the section may take before its body scrolls (interaction.css: `.properties`). */
const PROPERTIES_SHARE = 0.6;
/** The least the section asks for, so a short rail's share still shows three rows. */
const MIN_BODY = 66;
/** The least the body is capped at: a row and the body's insets (slab-properties.css keeps the frame that tall). */
const ONE_ROW = 26;

/** Whether a signal came from a key (Enter, Space) and not the pointer: the driver names the key. */
function byKeyboard(event: Event): boolean {
  if (!(event instanceof CustomEvent)) return false;
  const detail: unknown = event.detail;
  const meta: unknown = typeof detail === "object" && detail !== null && "meta" in detail ? detail.meta : null;
  const key: unknown = typeof meta === "object" && meta !== null && "pressed_key" in meta ? meta.pressed_key : "";
  return typeof key === "string" && key !== "";
}

/**
 * Hand the params over. The list is sent only when it changed: the scalars alone change when the
 * body scrolls (`above`, `below`), and a list written again is laid out again.
 */
function apply(host: SlabFieldHost, params: PropertiesPanelParams, sent: Map<string, string>): void {
  for (const name of PROPERTIES_SCALARS) host.setParam(name, params[name]);
  for (const name of PROPERTIES_LISTS) {
    const now = JSON.stringify(params[name]);
    if (sent.get(name) === now) continue;
    if (host.setList(name, "", params[name])) sent.set(name, now);
  }
}

/** What the host holds for a row: its draft and the machine that decides what becomes of it. */
interface RowState {
  row: PropRow;
  draft: string;
  dirty: boolean;
  edit: PropEdit;
}

const isTyped = (row: PropRow): boolean => {
  const mode = rowMode(row);
  return mode === "text" || mode === "number";
};

export function SlabProperties(props: PropertiesPanelProps): JSX.Element {
  /** The section folds to its heading, as the rail's other sections do. */
  const [open, setOpen] = createSignal(true);
  /** The choice row whose popup is open, and the popup. */
  const [openChoice, setOpenChoice] = createSignal<string | null>(null);
  const [popup, setPopup] = createSignal<OpenPopup | null>(null);
  /** The refusals standing on rows, by row key. */
  const [faults, setFaults] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [bodyMax, setBodyMax] = createSignal(UNCAPPED);
  /** The height the body's content would take with nothing capping it; null before the first solve. */
  const [natural, setNatural] = createSignal<number | null>(null);
  /** The ends of the body that hide rows, read from each solve. */
  const [hidden, setHidden] = createSignal({ above: false, below: false }, { equals: (a, b) => a.above === b.above && a.below === b.below });

  const subject = createMemo((): string => propertiesSubject(props.properties));
  const params = createMemo(() =>
    propertiesPanelParams(props.properties, {
      open: open(),
      selectionCount: props.selectionCount,
      openChoice: openChoice(),
      faults: faults(),
      bodyMax: bodyMax(),
      hidden: hidden(),
    }),
  );

  let frame: HTMLDivElement | undefined;
  let element: HTMLElement | undefined;
  /** What the popup asks of the mounted surface; set once it is mounted. */
  let pick: (value: string, byKey: boolean) => void = () => undefined;
  let dismiss: (reason: PopupDismiss) => void = () => {
    setPopup(null);
    setOpenChoice(null);
  };

  onMount(() => {
    if (frame === undefined || element === undefined || !isSlabHost(element) || !isSlabFieldHost(element)) return;
    const host = element;
    const box = frame;
    const states = new Map<string, RowState>();
    /** The row whose field had the kernel's focus at the last look. */
    let editing: string | null = null;
    /** The row whose popup a press outside it closed, and when: that press is not a new opening. */
    let closedByPress: { row: string; at: number } | null = null;

    const setFault = (key: string, message: string | null): void => {
      const now = untrack(faults);
      if ((now.get(key) ?? null) === message) return;
      const next = new Map(now);
      if (message === null) next.delete(key);
      else next.set(key, message);
      setFaults(next);
    };

    /** Write a row's draft into its field's buffer when the kernel holds other text. */
    const pushDraft = (state: RowState): void => {
      if (!isTyped(state.row)) return;
      const scene = host.sceneSnapshot();
      // A row the scene does not have yet (the rows were just handed over) is written by the key
      // its field will have: a sibling's, with this row's name in it.
      const key = fieldNode(scene, state.row.key) ?? fieldNodeLike(scene, state.row.key);
      if (key !== null && host.fieldText(key) !== state.draft) host.setFieldText(key, state.draft);
    };

    const stateFor = (row: PropRow): RowState => {
      const found = states.get(row.key);
      if (found !== undefined) {
        found.row = row;
        return found;
      }
      const state: RowState = {
        row,
        draft: row.value,
        dirty: false,
        edit: createPropEdit({
          row: () => state.row,
          draft: () => state.draft,
          setDraft: (value) => {
            state.draft = value;
            pushDraft(state);
          },
          dirty: () => state.dirty,
          setDirty: (value) => {
            state.dirty = value;
          },
          fault: () => untrack(faults).get(state.row.key) ?? null,
          setFault: (message) => setFault(state.row.key, message),
          send: (patch) => props.onSet(patch),
          notice: (message) => props.onNotice?.(message),
        }),
      };
      states.set(row.key, state);
      return state;
    };

    const closePopup = (): void => {
      setPopup(null);
      setOpenChoice(null);
    };

    // The rows as the engine last described them. Another selection: no unfinished edit was for
    // it. A row that left takes its edit with it, and a value that changed re-seeds its draft
    // unless it is being typed into.
    let described = untrack(subject);
    createEffect(() => {
      const shown = listedRows(props.properties);
      const now = subject();
      if (now !== described) {
        described = now;
        for (const state of states.values()) state.edit.gone();
        states.clear();
        setFaults(new Map());
        closePopup();
      }
      const keys = new Set(shown.map((row) => row.key));
      for (const [key, state] of states) {
        if (keys.has(key)) continue;
        state.edit.gone();
        states.delete(key);
        setFault(key, null);
      }
      for (const row of shown) {
        const state = stateFor(row);
        if (!state.dirty) state.draft = row.value;
      }
      const listed = untrack(openChoice);
      const held = listed === null ? undefined : shown.find((row) => row.key === listed);
      if (listed !== null && (held === undefined || rowMode(held) !== "choice")) closePopup();
    });

    /**
     * The kernel's focus came to a field or left one (`./SlabPiece`: `syncEditing`). Left: what a
     * blur does, and the buffer is written again, the one call that clears the field's scroll.
     * Arrived: the value is selected whole with the caret at its end, by a press as by the
     * keyboard. A press that kept its own caret was tried and looks worse: the kernel scrolls a
     * field 8 only when the caret is at the end of its text, the document's insets are written
     * for that, and with the caret left where the press put it the value stands 8 to the right.
     */
    const syncEditing = (): void => {
      const scene = host.sceneSnapshot();
      const focused = host.focusedKey();
      const at = focusedRow(focused);
      const now = at !== null && focused === fieldNode(scene, at) ? at : null;
      if (now === editing) return;
      const left = editing;
      editing = now;
      if (left !== null) {
        const state = states.get(left);
        state?.edit.commitText(true);
        const key = fieldNode(scene, left);
        if (state !== undefined && key !== null) host.setFieldText(key, state.draft);
      }
      if (now !== null && focused !== null) host.setCaret(focused, [...(host.fieldText(focused) ?? "")].length, 0);
    };
    const onInput = (): void => syncEditing();
    host.addEventListener("pointerdown", onInput);
    host.addEventListener("keydown", onInput);

    /** After a solve: a field the focus left is committed, and the fields show their drafts. */
    const afterFrame = (): void => {
      syncEditing();
      for (const state of states.values()) if (!state.dirty) pushDraft(state);
      // The body fades at the ends that hide rows (the next solve paints it).
      const scene = host.sceneSnapshot();
      setHidden(hiddenEnds(scene));
      setNatural(bodyNatural(scene, untrack(open)));
    };
    host.addEventListener("slab-frame", afterFrame);

    /** The keyboard left the surface: what a blur does to a field. An open popup has it, and stays. */
    const onFocusOut = (e: FocusEvent): void => {
      const to = e.relatedTarget;
      if (to instanceof Node && (to === host || host.contains(to) || host.shadowRoot?.contains(to) === true)) return;
      // The kernel's focus stays on the field it was on; the page's has gone, which is the blur.
      const left = editing;
      if (left !== null) states.get(left)?.edit.commitText(true);
    };
    host.addEventListener("focusout", onFocusOut);

    /** Open a choice row's popup under its control. */
    const openPopup = (row: PropRow): void => {
      const key = row.key;
      const { options, held } = choicePopup(row, stateFor(row).draft);
      if (options.length === 0) return;
      setOpenChoice(key);
      setPopup({
        label: row.label,
        options,
        held,
        anchor: () => {
          const scene = host.sceneSnapshot();
          const node = choiceNode(scene, key);
          const part = node === null ? undefined : scene.find((n) => n.key === node);
          return part === undefined ? null : sceneBoxInWindow(host, part);
        },
      });
    };

    pick = (value, byKey) => {
      const key = untrack(openChoice);
      closePopup();
      if (key === null) return;
      const row = signalLine(props.properties, key);
      returnFocus(host, () => choiceNode(host.sceneSnapshot(), key), byKey);
      if (row !== null && rowMode(row) === "choice") stateFor(row).edit.pick(value);
    };
    dismiss = (reason) => {
      const key = untrack(openChoice);
      closePopup();
      if (key === null) return;
      if (reason === "outside") closedByPress = { row: key, at: performance.now() };
      // A press outside takes the focus itself when it lands on something that takes it; until
      // then, and for every other way out, the keyboard is back on the row's control.
      returnFocus(host, () => choiceNode(host.sceneSnapshot(), key), reason === "escape" || reason === "tab");
    };

    /** The kernel's focus when the key went down, before the driver moved it for that key. */
    let focusBefore: string | null = null;
    // On the way in, ahead of the driver and of `attachSurface` (which keeps Tab to the browser).
    const onKeyCapture = (e: KeyboardEvent): void => {
      if (e.target !== host) return;
      focusBefore = host.focusedKey();
      const at = focusedRow(focusBefore);
      const scene = host.sceneSnapshot();
      // While a field is edited the page's focus is on the driver's hidden text area, and the
      // next tab stop after it is the field's own node: Tab would take two presses to leave.
      // The focus is put on that node first, so the one press leaves the surface.
      if (e.key === "Tab" && !e.shiftKey && at !== null && focusBefore === fieldNode(scene, at)) {
        const stop = host.shadowRoot?.querySelector('[tabindex="0"]');
        if (stop instanceof HTMLElement) stop.focus({ preventScroll: true });
      }
      // Alt+Down opens a choice, as it opens a native list; the kernel never sees the key.
      if (e.key === "ArrowDown" && e.altKey && !e.ctrlKey && !e.metaKey && at !== null && focusBefore === choiceNode(scene, at)) {
        const row = signalLine(props.properties, at);
        if (row !== null && rowMode(row) === "choice") {
          e.preventDefault();
          e.stopImmediatePropagation();
          openPopup(row);
        }
      }
    };
    host.addEventListener("keydown", onKeyCapture, true);

    const onKeyDown = (e: KeyboardEvent): void => {
      // A key from inside a hole is not this surface's.
      if (e.target !== host) return;
      const focused = focusBefore;
      const at = focusedRow(focused);
      const inField = at !== null && focused === fieldNode(host.sceneSnapshot(), at);
      if (e.key === "Escape") {
        // Escape cancels this edit only; with nothing to cancel it is the shell's (it clears the selection).
        if (inField && at !== null && states.get(at)?.edit.cancel() === true) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (!inField || focused === null) return;
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        // Left and Right are the caret's; Up and Down leave the field for the row beside it.
        const next = stepNode(host.sceneSnapshot(), focused, e.key === "ArrowDown" ? 1 : -1);
        if (next !== null) host.setFocus(next, true);
        syncEditing();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (fieldKeepsKey(e)) e.stopPropagation();
    };
    host.addEventListener("keydown", onKeyDown);

    const detach = attachSurface(host, PROPERTIES_SIGNALS, (name, event) => {
      const detail = signalDetail(event);
      if (name === "fold") {
        closePopup();
        setOpen(!open());
        return;
      }
      const row = signalLine(props.properties, detail?.item ?? "");
      if (row === null) return;
      const mode = rowMode(row);
      const state = stateFor(row);
      if (name === "row_choose" && mode === "choice") {
        // The press that closed this row's popup is the closing, not a new opening.
        const closed = closedByPress;
        closedByPress = null;
        if (!byKeyboard(event) && closed !== null && closed.row === row.key && isReopen(closed.at, performance.now())) return;
        if (untrack(openChoice) === row.key) closePopup();
        else openPopup(row);
      } else if (name === "row_tick" && mode === "bool") {
        // A box that stands for objects that disagree is ticked by a press, as the layer's Checkbox is.
        state.edit.pick(state.draft === "true" ? "false" : "true");
      } else if (name === "row_edit" && isTyped(row)) {
        const text = detail?.text;
        if (typeof text === "string" && text !== state.draft) state.edit.typed(text);
      } else if (name === "row_submit" && isTyped(row)) {
        state.edit.commitText(false);
      }
    });

    // The face the rows are set in, measured as the driver paints it: what an ellipsis cuts is hinted whole.
    let width: ((text: string, chip: boolean) => number) | null = null;
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx !== null) {
      const style = getComputedStyle(document.documentElement);
      const family = style.getPropertyValue("--font-family").trim();
      const fonts = { body: `400 ${style.getPropertyValue("--font-body").trim()} ${family}`, chip: `400 ${style.getPropertyValue("--font-chip").trim()} ${family}` };
      if ("fontKerning" in ctx) ctx.fontKerning = "none";
      width = (text, chip) => {
        ctx.font = chip ? fonts.chip : fonts.body;
        return ctx.measureText(text).width;
      };
    }
    const tracking = trackSurface(host, box, {
      hint: (key) => {
        if (!key.endsWith("/#state") && linePart(key) === null) return null;
        const part = tracking.scene().find((node) => node.key === key);
        return part === undefined ? null : partHint(untrack(params), part, width);
      },
    });

    // The section's height is the rail's to give, as `.properties` is given its own
    // (interaction.css: its rows' height, at most a share of the rail, and less when the rail is
    // full: it is the one section that gives way). The frame asks for the rows' whole height
    // (`natural`, read from each solve) up to that share, the rail's flex layout answers, and the
    // body is capped at what the frame was given, so it scrolls inside and is never cut by the
    // section under it. The frame's height does not depend on the cap, so the two cannot chase
    // each other.
    const rail = box.parentElement;
    let sizes: ResizeObserver | undefined;
    if (rail !== null && typeof ResizeObserver === "function") {
      const headHeight = (): number => {
        const head = host.getToken("size.control-h-input");
        return typeof head === "number" && head > 0 ? head : 24;
      };
      const ask = (): void => {
        const want = untrack(natural);
        if (want === null || rail.clientHeight <= 0) {
          box.style.removeProperty("flex-basis");
          return;
        }
        const share = Math.max(MIN_BODY, Math.floor(rail.clientHeight * PROPERTIES_SHARE) - headHeight());
        box.style.flexBasis = `${headHeight() + Math.min(want, share)}px`;
      };
      const measure = (): void => {
        ask();
        const given = box.clientHeight - headHeight();
        setBodyMax(untrack(natural) === null || box.clientHeight <= 0 ? UNCAPPED : Math.max(ONE_ROW, given));
      };
      sizes = new ResizeObserver(measure);
      sizes.observe(rail);
      sizes.observe(box);
      createEffect(() => {
        natural();
        measure();
      });
    }

    onCleanup(() => {
      detach();
      tracking.detach();
      sizes?.disconnect();
      host.removeEventListener("slab-frame", afterFrame);
      host.removeEventListener("focusout", onFocusOut);
      host.removeEventListener("pointerdown", onInput);
      host.removeEventListener("keydown", onInput);
      host.removeEventListener("keydown", onKeyCapture, true);
      host.removeEventListener("keydown", onKeyDown);
      for (const state of states.values()) state.edit.gone();
    });
    /** The list as last handed over. */
    const sent = new Map<string, string>();
    createEffect(() => {
      apply(host, params(), sent);
      // Before the frame that shows the rows, so a value is not drawn once on the other edge.
      for (const state of states.values()) if (!state.dirty) pushDraft(state);
    });
  });

  return (
    <div ref={frame} class={open() ? "slab-properties" : "slab-properties is-folded"}>
      <slab-properties-panel ref={element} />
      <SlabPopup popup={popup} onPick={(value, byKey) => pick(value, byKey)} onClose={(reason) => dismiss(reason)} />
    </div>
  );
}
