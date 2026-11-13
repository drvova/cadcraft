/**
 * How one row of the Piece section is edited, apart from what draws it: what a pick or a tick
 * sends, when typed text is committed, what a refusal leaves in the field, what Escape cancels.
 * `components/PiecePanel.tsx` (SolidJS) and `slab/SlabPiece.tsx` (Slab) both edit their rows
 * through this, so the two panels cannot drift: the view holds the row's draft, whether it was
 * typed into and the fault said on it (`RowEditHost`), and this decides what becomes of them.
 *
 * Nothing here touches the DOM, and no jewelry number is worked out: `judgePieceDraft` (`./piece`)
 * says what typed text is, and whether a number is in range is the engine's to refuse.
 */

import { createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import { failedChecks, judgePieceDraft, pieceFacts, pieceRows, refusalRow, refusalWords, type Piece, type PieceChoices, type PieceFact, type PieceRow, type PieceState } from "./piece";

/** The refusal standing on a row: which row, and the words for it. */
export interface Refused {
  key: string;
  message: string;
}

/** What the section is given (the part of the panel's props its state is made from). */
export interface PieceSectionProps {
  state: PieceState;
  choices: PieceChoices;
  onRun: (params: Record<string, unknown>) => string | null;
}

export interface PieceSection {
  /** The piece, or null when the drawing has none. */
  piece: Accessor<Piece | null>;
  /** The size system shown: the one picked here, else the one the piece holds. */
  system: Accessor<string>;
  setPicked: (system: string | null) => void;
  rows: Accessor<PieceRow[]>;
  facts: Accessor<PieceFact[]>;
  failed: Accessor<number>;
  refused: Accessor<Refused | null>;
  setRefused: (refused: Refused | null) => void;
  /** Send a patch; a refusal is put on the row it names. Answers whether it went through. */
  run: (params: Record<string, unknown>) => boolean;
}

/**
 * The state every drawing of the section holds, whatever draws it. Called in a component (it
 * makes signals and an effect); `props` is read reactively.
 */
export function createPieceSection(props: PieceSectionProps): PieceSection {
  const piece = createMemo(() => (props.state.kind === "piece" ? props.state.piece : null));

  /** The size system picked here; null while the section shows the one the piece holds. */
  const [picked, setPicked] = createSignal<string | null>(null);
  const system = (): string => picked() ?? piece()?.params.sizeSystem ?? "us";
  // The engine's system changed (a size was sent in another one, or another piece came): follow it.
  createEffect((before: string) => {
    const now = piece()?.params.sizeSystem ?? "";
    if (now !== before) setPicked(null);
    return now;
  }, piece()?.params.sizeSystem ?? "");

  const rows = createMemo((): PieceRow[] => {
    const held = piece();
    return held === null ? [] : pieceRows(held, props.choices, system());
  });
  const facts = createMemo(() => {
    const held = piece();
    return held === null ? [] : pieceFacts(held, system());
  });
  const failed = (): number => {
    const held = piece();
    return held === null ? 0 : failedChecks(held);
  };

  const [refused, setRefused] = createSignal<Refused | null>(null);

  const run = (params: Record<string, unknown>): boolean => {
    const error = props.onRun(params);
    if (error === null) {
      setRefused(null);
      return true;
    }
    const key = refusalRow(error, rows());
    setRefused(key === null ? null : { key, message: refusalWords(error) });
    return false;
  };

  return { piece, system, setPicked, rows, facts, failed, refused, setRefused, run };
}

/** What the view holds for a row, and what the row may ask of the section. */
export interface RowEditHost {
  /** The row as the engine last described it. */
  row(): PieceRow;
  /** The size system the section shows. */
  system(): string;
  /** The text in the control: what was typed, or the engine's value. */
  draft(): string;
  setDraft(value: string): void;
  /** Typed into since the last commit or cancel: only then is there an edit to keep or send. */
  dirty(): boolean;
  setDirty(value: boolean): void;
  /** Why the draft was refused before it reached the engine; null when it was not. */
  fault(): string | null;
  setFault(message: string | null): void;
  /** The engine's refusal standing on this row, if one is. */
  engineFault(): string | null;
  /** Let the engine's refusal on this row go. */
  forget(): void;
  /** The size system was picked: it changes what is shown, and nothing in the drawing. */
  pick(system: string): void;
  /** Send a patch to `piece`; answers whether it went through (a refusal is then on its row). */
  run(patch: Record<string, unknown>): boolean;
  /** Say a refusal made before the engine was asked. */
  notice(message: string): void;
}

export interface RowEdit {
  /** Why the row is marked: the fault found here, else the engine's refusal. */
  why(): string | null;
  /** Back to the engine's value, with no edit pending. */
  settle(): void;
  /** A picked value (a choice, a tick): sent unless it is the one already there. */
  commit(value: string): void;
  /** Text was typed into the field. */
  typed(value: string): void;
  /**
   * Commit the typed text. Text that is refused (here, or by the engine) is said once and stays
   * in the field, marked, while it has the focus (`leaving` false); on the way out the engine's
   * value comes back.
   */
  commitText(leaving: boolean): void;
  /** Escape: cancels this edit and answers true; with nothing to cancel the key is the shell's. */
  cancel(): boolean;
  /** The row left the page: the blur a removed field fires must not send anything. */
  gone(): void;
}

export function createRowEdit(host: RowEditHost): RowEdit {
  /** The text the last refusal was for, so Enter-then-blur neither warns nor sends twice. */
  let said: string | null = null;
  let gone = false;

  const why = (): string | null => host.fault() ?? host.engineFault();

  const settle = (): void => {
    said = null;
    host.setDirty(false);
    host.setFault(null);
    host.forget();
    host.setDraft(host.row().value);
  };

  const commit = (value: string): void => {
    if (host.row().key === "system") {
      host.pick(value);
      return;
    }
    const verdict = judgePieceDraft(host.row(), value, host.system());
    if (verdict.kind !== "send") return;
    // Refused, the control shows the engine's value again (the refusal is on its row).
    if (!host.run(verdict.patch)) host.setDraft(host.row().value);
  };

  const typed = (value: string): void => {
    said = null;
    host.setDirty(true);
    host.setFault(null);
    host.forget();
    host.setDraft(value);
  };

  const commitText = (leaving: boolean): void => {
    if (gone || !host.dirty()) return;
    const value = host.draft();
    if (said === value) {
      if (leaving) settle();
      return;
    }
    const verdict = judgePieceDraft(host.row(), value, host.system());
    if (verdict.kind === "keep") {
      settle();
      return;
    }
    if (verdict.kind === "refuse") {
      host.notice(verdict.message);
      if (leaving) {
        settle();
        return;
      }
      said = value;
      host.setFault(verdict.message);
      return;
    }
    // Not dirty while the engine answers: the refresh a rebuild brings re-seeds the field.
    host.setDirty(false);
    host.setFault(null);
    if (host.run(verdict.patch)) {
      said = null;
      return;
    }
    if (leaving) {
      settle();
      return;
    }
    said = value;
    host.setDirty(true);
  };

  const cancel = (): boolean => {
    if (!host.dirty() && why() === null) return false;
    settle();
    return true;
  };

  return {
    why,
    settle,
    commit,
    typed,
    commitText,
    cancel,
    gone: () => {
      gone = true;
    },
  };
}
