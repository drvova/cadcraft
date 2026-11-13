/**
 * The Piece section drawn by Slab (`slab/piece.slab`): the same props as
 * `../components/PiecePanel`, the same state (`createPieceSection`), the same row editing
 * (`createRowEdit`), the same handlers. Only the view is Slab's: the rows, results and checks are
 * typed list params, and every press, pick, tick and typed value comes back as a signal with the
 * row's key.
 *
 * What the host does because the kernel owns the controls:
 *
 * - **A typed value** is the kernel's field. Its text is the row's draft: `row_edit` carries every
 *   change, `row_submit` is Enter, and the field losing the kernel's focus (seen after each frame)
 *   or the surface losing the page's is the commit a blur makes. A value the engine changed is
 *   written into the field's buffer unless it is being typed into.
 * - **A choice** opens its values as a list under its row (a Slab surface cannot paint outside
 *   its own box, so there is no popup): the row's button says `expanded`, the values are options,
 *   Escape or leaving the list closes it, and a pick returns the focus to the button.
 * - **The keys.** One tab stop and the arrows, as in the Bench section; Up and Down leave a
 *   field for the row above or below, since Left and Right are the caret's. Keys typed in a field
 *   are kept from the shell (`./fields`).
 *
 * Mounted by the shell in the sidebar, after `loadSlab("piece")` has defined the element.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, untrack, type JSX } from "solid-js";
import type { PiecePanelProps } from "../components/PiecePanel";
import type { PieceRow } from "../piece";
import { createPieceSection, createRowEdit, type RowEdit } from "../piece-edit";
import { fieldKeepsKey, isSlabFieldHost, type SlabFieldHost } from "./fields";
import { fieldNode, fieldNodeLike, focusedRow, heldOption, hiddenEnds, optionNode, pickedValue, piecePanelParams, signalRow, startKind, startNode, stepNode, choiceNode, PIECE_LISTS, PIECE_SCALARS, PIECE_SIGNALS, UNCAPPED, type PiecePanelParams } from "./piece-params";
import { attachSurface } from "./surface";
import { isSlabHost, signalDetail } from "./types";
import "./slab-piece.css";

/** The share of the rail the section may take before its body scrolls (interaction.css: `.piece`). */
const PIECE_SHARE = 0.44;
/** The least the body is given, so a squeezed rail still shows three rows. */
const MIN_BODY = 66;

/** Whether a signal came from a key (Enter, Space) and not the pointer: the driver names the key. */
function byKeyboard(event: Event): boolean {
  if (!(event instanceof CustomEvent)) return false;
  const detail: unknown = event.detail;
  const meta: unknown = typeof detail === "object" && detail !== null && "meta" in detail ? detail.meta : null;
  const key: unknown = typeof meta === "object" && meta !== null && "pressed_key" in meta ? meta.pressed_key : "";
  return typeof key === "string" && key !== "";
}

/**
 * Hand the params over. A list is sent only when it changed: the scalars alone change when the
 * body scrolls (`above`, `below`), and a list written again is laid out again.
 */
function apply(host: SlabFieldHost, params: PiecePanelParams, sent: Map<string, string>): void {
  for (const name of PIECE_SCALARS) host.setParam(name, params[name]);
  for (const name of PIECE_LISTS) {
    const now = JSON.stringify(params[name]);
    if (sent.get(name) === now) continue;
    if (host.setList(name, "", params[name])) sent.set(name, now);
  }
}

/** What the host holds for a row: its draft and the machine that decides what becomes of it. */
interface RowState {
  row: PieceRow;
  draft: string;
  dirty: boolean;
  edit: RowEdit;
}

export function SlabPiece(props: PiecePanelProps): JSX.Element {
  /** The section folds to its heading, as the rail's other sections do. */
  const [open, setOpen] = createSignal(true);
  const { piece, system, setPicked, rows, facts, refused, setRefused, run } = createPieceSection(props);
  /** The choice row whose values are listed under it. */
  const [openChoice, setOpenChoice] = createSignal<string | null>(null);
  /** The faults found here, before the engine was asked, by row key. */
  const [faults, setFaults] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [bodyMax, setBodyMax] = createSignal(UNCAPPED);
  /** The ends of the body that hide rows, read from each solve. */
  const [hidden, setHidden] = createSignal({ above: false, below: false }, { equals: (a, b) => a.above === b.above && a.below === b.below });

  /** Every marked row and why: a fault found here, else the engine's refusal. */
  const marked = createMemo((): ReadonlyMap<string, string> => {
    const out = new Map(faults());
    const held = refused();
    if (held !== null && !out.has(held.key)) out.set(held.key, held.message);
    return out;
  });

  const params = createMemo(() =>
    piecePanelParams(props.state, rows(), facts(), piece()?.checks ?? [], {
      open: open(),
      system: system(),
      openChoice: openChoice(),
      faults: marked(),
      gallery: props.onTemplates !== undefined,
      bodyMax: bodyMax(),
      hidden: hidden(),
    }),
  );

  let element: HTMLElement | undefined;

  onMount(() => {
    if (element === undefined || !isSlabHost(element) || !isSlabFieldHost(element)) return;
    const host = element;
    const states = new Map<string, RowState>();
    /** The row whose field had the kernel's focus at the last look. */
    let editing: string | null = null;

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
      if (state.row.kind === "choice" || state.row.kind === "tick") return;
      const scene = host.sceneSnapshot();
      // A row the scene does not have yet (the rows were just handed over) is written by the key
      // its field will have: a sibling's, with this row's name in it.
      const key = fieldNode(scene, state.row.key) ?? fieldNodeLike(scene, state.row.key);
      if (key !== null && host.fieldText(key) !== state.draft) host.setFieldText(key, state.draft);
    };

    const stateFor = (row: PieceRow): RowState => {
      const found = states.get(row.key);
      if (found !== undefined) {
        found.row = row;
        return found;
      }
      const state: RowState = {
        row,
        draft: row.value,
        dirty: false,
        edit: createRowEdit({
          row: () => state.row,
          system: () => untrack(system),
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
          engineFault: () => {
            const held = untrack(refused);
            return held !== null && held.key === state.row.key ? held.message : null;
          },
          forget: () => {
            const held = untrack(refused);
            if (held !== null && held.key === state.row.key) setRefused(null);
          },
          pick: (value) => setPicked(value),
          run,
          notice: (message) => props.onNotice?.(message),
        }),
      };
      states.set(row.key, state);
      return state;
    };

    // The rows as the engine last described them: a row that left takes its unfinished edit with
    // it, and a value that changed re-seeds its draft unless it is being typed into.
    createEffect(() => {
      const shown = rows();
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
      const openNow = untrack(openChoice);
      if (openNow !== null && !keys.has(openNow)) setOpenChoice(null);
    });

    /**
     * The kernel's focus came to a field or left one. Seen after each solve, and straight after
     * the driver has had a press or a key (so the change is in the frame that shows it).
     *
     * - Left: what a blur does. The edit is committed, and the field's buffer is written again,
     *   which is the one call that clears its scroll: the kernel scrolls a focused field 8 to
     *   keep the caret inside it and leaves it scrolled.
     * - Arrived: the value is selected whole, as a tabbed-to input's is, with the caret at its
     *   end. That is the place the document's insets are written for (`slab/piece.slab`), so the
     *   text does not move as the focus comes and goes.
     *
     * Known flaw: when the body is scrolled by the wheel under a field that has the focus, the
     * kernel paints the field unscrolled again while still holding its scroll, and the value
     * stands 8 to the right until the caret next reaches its end (End, or a typed character).
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
      const scene = host.sceneSnapshot();
      const focused = host.focusedKey();
      const at = focusedRow(focused);
      for (const state of states.values()) if (!state.dirty) pushDraft(state);
      // The focus moved out of an open list (the arrows walked past its end, or a press elsewhere).
      const listed = untrack(openChoice);
      if (listed !== null && focused !== null && at !== listed) setOpenChoice(null);
      // The body fades at the ends that hide rows (the next solve paints it).
      setHidden(hiddenEnds(scene));
    };
    host.addEventListener("slab-frame", afterFrame);

    /** The keyboard left the surface: what a blur does to a field, and to an open list. */
    const onFocusOut = (e: FocusEvent): void => {
      const to = e.relatedTarget;
      if (to instanceof Node && (to === host || host.contains(to) || host.shadowRoot?.contains(to) === true)) return;
      // The kernel's focus stays on the field it was on; the page's has gone, which is the blur.
      const left = editing;
      if (left !== null) states.get(left)?.edit.commitText(true);
      setOpenChoice(null);
    };
    host.addEventListener("focusout", onFocusOut);

    /** Move the kernel's focus once the next solve has the node. */
    const focusWhenSettled = (find: () => string | null, visible = true): void => {
      // The node that has the page's focus may be about to leave the scene (a picked value, a
      // pressed start button). The driver then lets the page's focus fall to the body and does
      // not take it back, so the keyboard would be nowhere: it is put on the surface's tab stop.
      const had = document.activeElement === host;
      void host.whenSettled().then(() => {
        const key = find();
        if (key !== null) host.setFocus(key, visible);
        if (!had) return;
        void host.whenSettled().then(() => {
          if (document.activeElement !== document.body) return;
          const stop = host.shadowRoot?.querySelector('[tabindex="0"]');
          if (stop instanceof HTMLElement) stop.focus({ preventScroll: true });
        });
      });
    };

    /** The kernel's focus when the key went down, before the driver moved it for that key. */
    let focusBefore: string | null = null;
    // On the way in, ahead of the driver and of `attachSurface` (which keeps Tab to the browser).
    const onKeyCapture = (e: KeyboardEvent): void => {
      if (e.target !== host) return;
      focusBefore = host.focusedKey();
      const at = focusedRow(focusBefore);
      // While a field is edited the page's focus is on the driver's hidden text area, and the
      // next tab stop after it is the field's own node: Tab would take two presses to leave.
      // The focus is put on that node first, so the one press leaves the surface.
      if (e.key === "Tab" && !e.shiftKey && at !== null && focusBefore === fieldNode(host.sceneSnapshot(), at)) {
        const stop = host.shadowRoot?.querySelector('[tabindex="0"]');
        if (stop instanceof HTMLElement) stop.focus({ preventScroll: true });
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
        const listed = openChoice();
        if (listed !== null) {
          e.preventDefault();
          e.stopPropagation();
          setOpenChoice(null);
          focusWhenSettled(() => choiceNode(host.sceneSnapshot(), listed));
        } else if (inField && at !== null && states.get(at)?.edit.cancel() === true) {
          // Escape cancels this edit only; with nothing to cancel it is the shell's.
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

    const detach = attachSurface(host, PIECE_SIGNALS, (name, event) => {
      const detail = signalDetail(event);
      const item = detail?.item ?? "";
      if (name === "fold") {
        setOpenChoice(null);
        setOpen(!open());
        return;
      }
      if (name === "start") {
        const kind = startKind(item);
        // The pressed button leaves with the empty state: the keyboard goes on to the piece's first row.
        if (kind !== null && run({ kind })) focusWhenSettled(() => choiceNode(host.sceneSnapshot(), "kind"), byKeyboard(event));
        return;
      }
      if (name === "templates") {
        props.onTemplates?.();
        return;
      }
      if (name === "remove") {
        // The pressed button leaves with the piece: the keyboard goes on to the first kind to start.
        if (run({ remove: true })) focusWhenSettled(() => startNode(host.sceneSnapshot()), byKeyboard(event));
        return;
      }
      if (name === "option_pick") {
        const listed = openChoice();
        const row = listed === null ? null : signalRow(rows(), listed);
        const value = pickedValue(row, item);
        if (row === null || listed === null || value === null) return;
        setOpenChoice(null);
        const state = stateFor(row);
        state.draft = value;
        state.edit.commit(value);
        focusWhenSettled(() => choiceNode(host.sceneSnapshot(), listed), byKeyboard(event));
        return;
      }
      const row = signalRow(rows(), item);
      if (row === null) return;
      const state = stateFor(row);
      if (name === "row_choose" && row.kind === "choice") {
        const opening = openChoice() !== row.key;
        setOpenChoice(opening ? row.key : null);
        const held = heldOption(row);
        // Opened, the list starts on the value the row holds, as a native list does.
        if (opening && held !== null) focusWhenSettled(() => optionNode(host.sceneSnapshot(), row.key, held), byKeyboard(event));
      } else if (name === "row_tick" && row.kind === "tick") {
        const value = row.value === "true" ? "false" : "true";
        state.draft = value;
        state.edit.commit(value);
      } else if (name === "row_edit" && row.kind !== "choice" && row.kind !== "tick") {
        const text = detail?.text;
        if (typeof text === "string" && text !== state.draft) state.edit.typed(text);
      } else if (name === "row_submit" && row.kind !== "choice" && row.kind !== "tick") {
        state.edit.commitText(false);
      }
    });

    // The body's cap follows the rail: a share of it, less the heading.
    const rail = host.parentElement;
    let sizes: ResizeObserver | undefined;
    if (rail !== null && typeof ResizeObserver === "function") {
      const measure = (): void => {
        const head = host.getToken("size.control-h-input");
        const room = Math.floor(rail.clientHeight * PIECE_SHARE) - (typeof head === "number" ? head : 24);
        setBodyMax(rail.clientHeight > 0 ? Math.max(MIN_BODY, room) : UNCAPPED);
      };
      sizes = new ResizeObserver(measure);
      sizes.observe(rail);
      measure();
    }

    onCleanup(() => {
      detach();
      sizes?.disconnect();
      host.removeEventListener("slab-frame", afterFrame);
      host.removeEventListener("focusout", onFocusOut);
      host.removeEventListener("pointerdown", onInput);
      host.removeEventListener("keydown", onInput);
      host.removeEventListener("keydown", onKeyCapture, true);
      host.removeEventListener("keydown", onKeyDown);
      for (const state of states.values()) state.edit.gone();
    });
    /** The lists as last handed over. */
    const sent = new Map<string, string>();
    createEffect(() => {
      apply(host, params(), sent);
      // Before the frame that shows the rows, so a value is not drawn once on the other edge.
      for (const state of states.values()) if (!state.dirty) pushDraft(state);
    });
  });

  return <slab-piece-panel ref={element} class="slab-piece" />;
}
