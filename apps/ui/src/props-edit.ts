/**
 * How the properties palette is edited, apart from what draws it: the heading's words, what the
 * rows describe, and what becomes of one row's value (a pick or a tick is sent unless it is the
 * one already there; typed text is committed on Enter and on the way out, a refusal is said once
 * and stays marked while the field has the focus, Escape cancels the edit).
 * `components/PropertiesPanel.tsx` (SolidJS) and `slab/SlabProperties.tsx` (Slab) both go through
 * this, so the two panels cannot drift: the view holds a row's draft, whether it was typed into
 * and the refusal standing on it (`PropEditHost`), and this decides what becomes of them.
 *
 * Nothing here touches the DOM and no property is named: `judgeDraft` (`./props`) says what typed
 * text is.
 */

import { judgeDraft, type PropRow, type PropertiesReply } from "./props";

/** A count as the status bar writes it: grouped in threes ("1,284"). */
export const countText = (n: number): string => n.toLocaleString("en-US");

/** One count, one name: the heading says what the status bar says ("21 selected"). */
export function propertiesTitle(reply: PropertiesReply | null, selectionCount: number): string {
  if (reply === null) return selectionCount > 0 ? `${countText(selectionCount)} selected` : "No selection";
  if (reply.kind === "defaults") return "No selection";
  return `${countText(reply.count)} selected`;
}

/** What the rows describe: a row drops its unfinished edit when this changes under it. */
export function propertiesSubject(reply: PropertiesReply | null): string {
  if (reply === null) return "";
  if (reply.kind === "defaults") return "defaults";
  return reply.objects.map((o) => String(o["handle"])).join(",");
}

/** Which control a row gets: a row that cannot be edited is read, whatever its kind. */
export function rowMode(row: PropRow): "readonly" | PropRow["kind"] {
  return row.editable ? row.kind : "readonly";
}

/** What the view holds for a row, and what the row may ask of the panel. */
export interface PropEditHost {
  /** The row as the engine last described it. */
  row(): PropRow;
  /** The text in the control: what was typed or picked, or the engine's value. */
  draft(): string;
  setDraft(value: string): void;
  /** Typed into since the last commit or cancel: only then is there an edit to keep or send. */
  dirty(): boolean;
  setDirty(value: boolean): void;
  /** Why the draft was refused as it stands; null when it was not. */
  fault(): string | null;
  setFault(message: string | null): void;
  /** Send a patch to `properties.set`. */
  send(patch: Record<string, unknown>): void;
  /** Say a refusal. */
  notice(message: string): void;
}

export interface PropEdit {
  /** Back to the engine's value, with no edit pending. */
  settle(): void;
  /** A picked value (a choice, a tick): shown, and sent unless it is the one already there. */
  pick(value: string): void;
  /** Text was typed into the field. */
  typed(value: string): void;
  /**
   * Commit the typed text. A number that cannot be one is said once and stays in the field,
   * marked, while it has the focus (`leaving` false); on the way out the old value comes back.
   */
  commitText(leaving: boolean): void;
  /** Escape: cancels this edit and answers true; with nothing to cancel the key is the shell's. */
  cancel(): boolean;
  /** The row left the page: the blur a removed field fires must not send anything. */
  gone(): void;
}

export function createPropEdit(host: PropEditHost): PropEdit {
  /** The text the last number warning was for, so Enter-then-blur does not warn twice. */
  let warned = "";
  let gone = false;

  const settle = (): void => {
    warned = "";
    host.setDirty(false);
    host.setFault(null);
    host.setDraft(host.row().value);
  };

  const pick = (value: string): void => {
    host.setDraft(value);
    const verdict = judgeDraft(host.row(), value);
    if (verdict.kind === "send") host.send(verdict.patch);
  };

  const typed = (value: string): void => {
    host.setDirty(true);
    host.setFault(null);
    host.setDraft(value);
  };

  const commitText = (leaving: boolean): void => {
    if (gone || !host.dirty()) return;
    const value = host.draft();
    const verdict = judgeDraft(host.row(), value);
    if (verdict.kind === "refuse") {
      if (warned !== value) host.notice(verdict.message);
      if (leaving) {
        settle();
        return;
      }
      warned = value;
      host.setFault(verdict.message);
      return;
    }
    if (verdict.kind === "keep") {
      settle();
      return;
    }
    warned = "";
    host.setDirty(false);
    host.setFault(null);
    host.send(verdict.patch);
  };

  const cancel = (): boolean => {
    if (!host.dirty() && host.fault() === null) return false;
    settle();
    return true;
  };

  return {
    settle,
    pick,
    typed,
    commitText,
    cancel,
    gone: () => {
      gone = true;
    },
  };
}
