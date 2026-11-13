/**
 * The Source panel's logic (`components/SourcePanel.tsx`): the drawing's script beside the text
 * the reader is editing, and what happens to the two when the drawing changes, the reader types,
 * applies or reverts. Pure: the panel holds one `SourceState` and replaces it through these.
 *
 * The rules it keeps:
 * - Text the reader has edited is never replaced by a refresh: while there are edits, a change of
 *   the drawing only marks the text as behind it.
 * - "Edited" is exactly "the text is not the drawing's script as the engine last wrote it".
 * - The panel never says the text is the drawing unless the engine's own script was read after
 *   the last change: a failed apply leaves the edits as edits.
 * - What is drawn is capped. A script past the caps is shown in part, read-only, and the part is
 *   never what is applied.
 */

import type { ScriptReport } from "./facade";

/** Longest script the editor holds (characters): past it the script is shown in part, read-only. */
export const MAX_EDIT_CHARS = 400_000;
/** Most lines the editor holds. */
export const MAX_EDIT_LINES = 5_000;
/** How much of a script past those caps is shown. */
export const PREVIEW_LINES = 1_000;
export const PREVIEW_CHARS = 100_000;
/** Most line numbers the gutter draws (the reader may paste more lines than the editor's cap). */
export const MAX_GUTTER_LINES = 20_000;
/** Where counting lines stops: a longer text is "more than" this many. */
export const MAX_COUNTED_LINES = 1_000_000;
/** Most characters of an engine message shown in the status line. */
export const MAX_MESSAGE_CHARS = 400;

/** What the last apply said, until the text or the drawing moves on. */
export type SourceOutcome =
  | { kind: "none" }
  /** The engine ran it. `rewritten`: the text now shown is the engine's writing of the drawing, not what was typed. */
  | { kind: "applied"; ran: number | null; rewritten: boolean }
  /** The engine refused it; the drawing is as it was. `line` is the 1-based line the error names. */
  | { kind: "failed"; error: string; line: number | null; ran: number | null }
  /** The drawing's script could not be read. */
  | { kind: "unreadable"; error: string };

export interface SourceState {
  /** The drawing's script as the engine last wrote it. */
  base: string;
  /** The text in the editor. */
  draft: string;
  /** The drawing changed under edits the editor still holds (said in the status line). */
  behind: boolean;
  outcome: SourceOutcome;
}

export const EMPTY_SOURCE: SourceState = { base: "", draft: "", behind: false, outcome: { kind: "none" } };

/** Whether the editor holds text that is not the drawing's script. */
export function isEdited(state: SourceState): boolean {
  return state.draft !== state.base;
}

/**
 * The drawing's script was read (the drawing may have changed). With no edits in the editor the
 * text follows it. With edits the text stays, whatever was read: the script becomes the new base,
 * and the state says the drawing moved under the edits.
 */
export function read(state: SourceState, text: string): SourceState {
  if (text === state.base) return state.outcome.kind === "unreadable" ? { ...state, outcome: { kind: "none" } } : state;
  if (!isEdited(state)) return { base: text, draft: text, behind: false, outcome: { kind: "none" } };
  // What the last apply said was about the drawing as it then was.
  return { base: text, draft: state.draft, behind: state.draft !== text, outcome: { kind: "none" } };
}

/** The drawing's script could not be read: the text stays, and the panel says so. */
export function unreadable(state: SourceState, error: string): SourceState {
  return { ...state, outcome: { kind: "unreadable", error: clip(error, MAX_MESSAGE_CHARS) } };
}

/** The reader typed. Text typed back to the drawing's script is no longer an edit. */
export function edited(state: SourceState, draft: string): SourceState {
  if (draft === state.draft) return state;
  return { ...state, draft, behind: state.behind && draft !== state.base };
}

/** The reader dropped the edits; `text` is the drawing's script read now. */
export function reverted(text: string): SourceState {
  return { base: text, draft: text, behind: false, outcome: { kind: "none" } };
}

/**
 * The engine answered an apply of `state.draft`. `text` is the drawing's script read after it
 * (null when it could not be read).
 *
 * Success: the editor shows the drawing's script, which is the engine's own writing of what the
 * draft built (a variable is written as its value, a comment is gone). Failure: the draft stays,
 * still an edit, and the base is the drawing as it is (the engine put it back).
 */
export function applied(state: SourceState, report: ScriptReport, text: string | null): SourceState {
  if (!report.ok) {
    const error = clip(report.error ?? "the script did not run", MAX_MESSAGE_CHARS);
    return { base: text ?? state.base, draft: state.draft, behind: false, outcome: { kind: "failed", error, line: errorLine(error), ran: report.ran } };
  }
  // It ran, but what the drawing now is could not be read: the draft is not claimed to be it.
  if (text === null) return { ...state, outcome: { kind: "unreadable", error: "the script ran, but the drawing could not be read back" } };
  return { base: text, draft: text, behind: false, outcome: { kind: "applied", ran: report.ran, rewritten: !sameScript(state.draft, text) } };
}

/** Two scripts that differ only in line ends and trailing blank space read as the same text. */
function sameScript(a: string, b: string): boolean {
  const norm = (s: string): string => s.replaceAll("\r\n", "\n").trimEnd();
  return norm(a) === norm(b);
}

/**
 * The 1-based line an engine error names (`line 3: CIRCLE 5,5: …`), or null when it names none.
 * Only a leading `line N:` counts; the number is read with a cap, never trusted past it.
 */
export function errorLine(error: string): number | null {
  const m = /^line (\d{1,7}):/.exec(error);
  if (m === null) return null;
  const n = Number.parseInt(m[1] ?? "", 10);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_COUNTED_LINES ? n : null;
}

/** `text` cut to `max` characters, with an ellipsis when it was longer. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

/**
 * The lines of `text`, as an editor counts them: one more than its line feeds (a text that ends
 * with a line feed has an empty last line). Counting stops at `cap`; `capped` says it did.
 */
export function countLines(text: string, cap: number = MAX_COUNTED_LINES): { lines: number; capped: boolean } {
  let lines = 1;
  let at = text.indexOf("\n");
  while (at !== -1) {
    if (lines >= cap) return { lines: cap, capped: true };
    lines += 1;
    at = text.indexOf("\n", at + 1);
  }
  return { lines, capped: false };
}

/** Whether the editor can hold `text` whole. */
export function fitsEditor(text: string): boolean {
  if (text.length > MAX_EDIT_CHARS) return false;
  return countLines(text, MAX_EDIT_LINES + 1).lines <= MAX_EDIT_LINES;
}

/** The start of a script too long for the editor: whole lines, and what was left out. */
export interface SourcePreview {
  /** The lines shown, joined by line feeds. */
  text: string;
  shownLines: number;
  /** The script's lines (up to `MAX_COUNTED_LINES`; `more` says there are more). */
  totalLines: number;
  more: boolean;
}

export function previewOf(text: string): SourcePreview {
  const total = countLines(text);
  let end = 0;
  let shown = 0;
  while (shown < PREVIEW_LINES) {
    const next = text.indexOf("\n", end);
    const stop = next === -1 ? text.length : next;
    if (stop > PREVIEW_CHARS) {
      // A line that runs past the cap is cut, and counted as shown in part.
      if (shown === 0) {
        end = PREVIEW_CHARS;
        shown = 1;
      }
      break;
    }
    shown += 1;
    end = stop;
    if (next === -1) break;
    end = next + 1;
  }
  const body = text.slice(0, end);
  return { text: body.endsWith("\n") ? body.slice(0, -1) : body, shownLines: shown, totalLines: total.lines, more: total.capped };
}

/** The gutter's numbers for `lines` lines, one a line, up to `MAX_GUTTER_LINES`. */
export function gutterText(lines: number): string {
  const n = Number.isFinite(lines) ? Math.max(1, Math.min(MAX_GUTTER_LINES, Math.floor(lines))) : 1;
  const out: string[] = [];
  for (let i = 1; i <= n; i += 1) out.push(String(i));
  return out.join("\n");
}

/** A count with its noun: `1 line`, `1,240 lines`. */
export function counted(n: number, noun: string): string {
  return `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
}

/** The status line: what the panel says under the text, and whether it is an error. */
export interface SourceStatus {
  tone: "quiet" | "ok" | "error";
  text: string;
}

export function statusOf(state: SourceState): SourceStatus {
  const o = state.outcome;
  if (o.kind === "failed") {
    const before = o.ran !== null && o.ran > 0 ? ` ${counted(o.ran, "statement")} ran before it.` : "";
    return { tone: "error", text: `Not applied: ${o.error}.${before} The drawing is as it was.` };
  }
  if (o.kind === "unreadable") return { tone: "error", text: `The drawing's script could not be read: ${o.error}` };
  if (isEdited(state) && state.behind) return { tone: "quiet", text: "Edited, and the drawing has changed since. Apply rebuilds it from this text; Revert shows the drawing." };
  if (isEdited(state)) return { tone: "quiet", text: "Edited: the drawing does not have these changes yet." };
  if (o.kind === "applied") {
    const ran = o.ran === null ? "Applied." : `Applied: ${counted(o.ran, "statement")} ran.`;
    return { tone: "ok", text: o.rewritten ? `${ran} The text is now the drawing as the engine writes it.` : ran };
  }
  return { tone: "quiet", text: "In step with the drawing." };
}

/**
 * The textarea offsets of a 1-based line: where it starts and where it ends (before its line
 * feed), for placing the caret on the line an error names. Null when the text has no such line.
 */
export function lineSpan(text: string, line: number): { start: number; end: number } | null {
  if (!Number.isInteger(line) || line < 1) return null;
  let start = 0;
  for (let i = 1; i < line; i += 1) {
    const next = text.indexOf("\n", start);
    if (next === -1) return null;
    start = next + 1;
  }
  const end = text.indexOf("\n", start);
  return { start, end: end === -1 ? text.length : end };
}
