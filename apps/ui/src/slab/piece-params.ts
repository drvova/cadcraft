/**
 * The Piece section as the Slab panel takes it (`slab/piece.slab`): typed scalar and list params,
 * nothing else. Every figure is the engine's, read with checked narrowing by `../piece`; the rows,
 * the results, the heading and the checks are the ones `../piece` makes for the SolidJS panel.
 * This file only shapes them, caps them again (a Slab list is laid out whole), reads a signal's
 * item key back to the row it names and makes a choice's values for the popup (`./popup`). The
 * behaviour stays where it was: `../piece`, `../piece-edit` and the shell's handlers.
 */

import { MAX_CHECKS, PIECE_KINDS, pieceHeading, type PieceCheck, type PieceFact, type PieceRow, type PieceState } from "../piece";
import { paramText } from "./bench-params";
import type { PopupOption } from "./popup";

/** One kind a piece starts as: a `PieceStart` of the document. Its key is the kind. */
export interface PieceStartParam {
  key: string;
  name: string;
  /** The button's accessible name ("Start a band"). */
  hint: string;
}

/** One line of the kinds: a `PieceStartLine`. The last one carries the way to the template gallery. */
export interface PieceStartLineParam {
  key: string;
  /** The line ends with the "Templates…" button. */
  more: boolean;
  starts: PieceStartParam[];
}

/** One parameter: a `PieceRow`. Its key is the row's key, so a field keeps its text across a refresh. */
export interface PieceRowParam {
  key: string;
  name: string;
  /** The value as it reads: a choice's label, the text a typed field starts from. */
  shown: string;
  /** The row as a screen reader is told a choice ("Kind: Solitaire"): its text is not in the tree while it is scrolled out of sight. */
  said: string;
  /** The refusal standing on the row, as a screen reader is told it. */
  hint: string;
  choice: boolean;
  tick: boolean;
  typed: boolean;
  /** The choice's popup is open. */
  open: boolean;
  /** The tick is set. */
  on: boolean;
  /** The row is marked as refused. */
  bad: boolean;
}

export interface PieceFactParam {
  key: string;
  name: string;
  amount: string;
  /** The line as a screen reader is told it ("Metal weight: 3.53 g 18k gold"). */
  said: string;
}

export interface PieceCheckParam {
  key: string;
  note: string;
  /** "Pass" or "Fail": the word says it, the ink only repeats it. */
  mark: string;
  /** The line as a screen reader is told it, the verdict first ("Fail: The wall is…"). */
  said: string;
  failed: boolean;
}

export interface PiecePanelParams {
  summary: string;
  open: boolean;
  unavailable: boolean;
  none: boolean;
  held: boolean;
  counted: boolean;
  judged: boolean;
  /** The body hides rows above its box, below it, or at both ends (one of the three at most). */
  above: boolean;
  below: boolean;
  between: boolean;
  checks_name: string;
  body_max: number;
  lines: PieceStartLineParam[];
  rows: PieceRowParam[];
  facts: PieceFactParam[];
  checks: PieceCheckParam[];
}

/** The document's scalar params, its list params and the signals the host answers (`slab/piece.slab`). */
export const PIECE_SCALARS = ["summary", "open", "unavailable", "none", "held", "counted", "judged", "above", "below", "between", "checks_name", "body_max"] as const;
export const PIECE_LISTS = ["lines", "rows", "facts", "checks"] as const;
export const PIECE_SIGNALS = ["fold", "start", "templates", "remove", "row_choose", "row_tick", "row_edit", "row_submit"] as const;

/** What the host holds beside the engine's state: the view's own switches. */
export interface PieceView {
  /** The section is unfolded. */
  open: boolean;
  /** The size system shown. */
  system: string;
  /** The key of the choice row whose popup is open; null when none is. */
  openChoice: string | null;
  /** The refusal standing on each marked row, by row key. */
  faults: ReadonlyMap<string, string>;
  /** The shell offers the template gallery. */
  gallery: boolean;
  /** The most the body may be tall before it scrolls, in px. */
  bodyMax: number;
  /** The ends of the body that hide rows, as the last solve painted it. */
  hidden: { above: boolean; below: boolean };
}

/** The most rows, values of one choice and results laid out (a solitaire with a halo has fifteen rows). */
export const MAX_PIECE_ROWS = 40;
export const MAX_PIECE_OPTIONS = 80;
export const MAX_PIECE_FACTS = 12;

/** A body that never scrolls: the cap when the rail has not been measured. */
export const UNCAPPED = 100_000;

/** The longest sentence handed to the kernel (`../piece` clips a check to 400 characters). */
const MAX_SENTENCE = 400;

/** A sentence for the kernel, read whole: one line, no control characters, capped. */
export function sentenceText(value: string): string {
  let line = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    line += code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 ? " " : char;
    if (line.length > MAX_SENTENCE * 2) break;
  }
  line = line.replace(/ {2,}/g, " ").trim();
  return line.length > MAX_SENTENCE ? `${line.slice(0, MAX_SENTENCE - 1)}…` : line;
}

/** The kinds on one line of the empty state: three fit the rail at its starting width, as the SolidJS panel wraps them. */
export const STARTS_PER_LINE = 3;

/**
 * The kinds a piece starts as, as lines of the document's buttons. The kernel cannot wrap the
 * items of a list (an `each` in a `wrap` is one block), so the lines are broken here, by count.
 * With a gallery the last line ends with its button, on a line of its own when that one is full.
 */
export function startLines(gallery: boolean): PieceStartLineParam[] {
  const starts: PieceStartParam[] = PIECE_KINDS.map((kind) => ({ key: kind.value, name: paramText(kind.label), hint: paramText(`Start a ${kind.label.toLowerCase()}`) }));
  const lines: PieceStartLineParam[] = [];
  for (let at = 0; at < starts.length; at += STARTS_PER_LINE) lines.push({ key: `line-${lines.length}`, more: false, starts: starts.slice(at, at + STARTS_PER_LINE) });
  if (!gallery) return lines;
  const last = lines[lines.length - 1];
  if (last !== undefined && last.starts.length < STARTS_PER_LINE) last.more = true;
  else lines.push({ key: `line-${lines.length}`, more: true, starts: [] });
  return lines;
}

/** A choice's label for the value it holds; the value itself when the list does not name it. */
function choiceLabel(row: PieceRow): string {
  return row.choices?.find((c) => c.value === row.value)?.label ?? row.value;
}

/** One row as the document takes it. */
export function rowParam(row: PieceRow, view: Pick<PieceView, "openChoice" | "faults">): PieceRowParam {
  const choice = row.kind === "choice";
  const tick = row.kind === "tick";
  const open = choice && view.openChoice === row.key;
  const fault = view.faults.get(row.key) ?? null;
  const name = paramText(row.label);
  const shown = paramText(choice ? choiceLabel(row) : tick ? "" : row.value);
  return {
    key: row.key,
    name,
    shown,
    said: shown === "" ? name : `${name}: ${shown}`,
    hint: fault === null ? "" : sentenceText(fault),
    choice,
    tick,
    typed: !choice && !tick,
    open,
    on: tick && row.value === "true",
    bad: fault !== null,
  };
}

/**
 * A choice row's values for the popup (`./popup`), capped: the value handed back and its label.
 * `held` is the value the popup opens on: the row's, or none when its choices do not hold it.
 */
export function piecePopup(row: PieceRow): { options: PopupOption[]; held: string | null } {
  if (row.kind !== "choice") return { options: [], held: null };
  const options = (row.choices ?? []).slice(0, MAX_PIECE_OPTIONS).map((c) => ({ value: c.value, label: paramText(c.label) }));
  return { options, held: options.some((option) => option.value === row.value) ? row.value : null };
}

/** The panel with nothing under its heading. */
function blank(summary: string, open: boolean, body_max: number): PiecePanelParams {
  return { summary, open, unavailable: false, none: false, held: false, counted: false, judged: false, above: false, below: false, between: false, checks_name: "", body_max, lines: [], rows: [], facts: [], checks: [] };
}

/** The panel's params for the engine's state and the view's switches. */
export function piecePanelParams(state: PieceState, rows: readonly PieceRow[], facts: readonly PieceFact[], checks: readonly PieceCheck[], view: PieceView): PiecePanelParams {
  const summary = paramText(pieceHeading(state, view.system));
  const body_max = Number.isFinite(view.bodyMax) && view.bodyMax > 0 ? Math.min(UNCAPPED, Math.floor(view.bodyMax)) : UNCAPPED;
  // A folded section is its heading alone: nothing under it is laid out, focusable or read out.
  if (!view.open) return blank(summary, false, body_max);
  if (state.kind === "unavailable") return { ...blank(summary, true, body_max), unavailable: true };
  if (state.kind === "none") return { ...blank(summary, true, body_max), none: true, lines: startLines(view.gallery) };
  const shownChecks = checks.slice(0, MAX_CHECKS);
  const failed = shownChecks.filter((c) => !c.ok).length;
  const shownFacts = facts.slice(0, MAX_PIECE_FACTS);
  return {
    summary,
    open: true,
    unavailable: false,
    none: false,
    held: true,
    counted: shownFacts.length > 0,
    judged: shownChecks.length > 0,
    above: view.hidden.above && !view.hidden.below,
    below: view.hidden.below && !view.hidden.above,
    between: view.hidden.above && view.hidden.below,
    checks_name: failed === 0 ? "Checks, all pass" : `Checks, ${failed} failed`,
    body_max,
    lines: [],
    rows: rows.slice(0, MAX_PIECE_ROWS).map((row) => rowParam(row, view)),
    facts: shownFacts.map((fact, index) => {
      const name = paramText(fact.label);
      const amount = sentenceText(fact.value);
      return { key: `fact-${index}`, name, amount, said: `${name}: ${amount}` };
    }),
    checks: shownChecks.map((check, index) => {
      const note = sentenceText(check.message);
      const mark = check.ok ? "Pass" : "Fail";
      return { key: `check-${index}`, note, mark, said: `${mark}: ${note}`, failed: !check.ok };
    }),
  };
}

/**
 * The row a signal's item key names, among the rows shown; null when it names none (a stale or
 * forged signal does nothing).
 */
export function signalRow(rows: readonly PieceRow[], itemKey: string): PieceRow | null {
  if (!/^[a-zA-Z]{1,24}$/.test(itemKey)) return null;
  return rows.slice(0, MAX_PIECE_ROWS).find((row) => row.key === itemKey) ?? null;
}

/**
 * The value a pick names, when it is one of the row's choices; null when it is not (a pick that
 * arrives after the row's choices changed does nothing).
 */
export function pickedValue(row: PieceRow | null, value: string): string | null {
  if (row === null || row.kind !== "choice") return null;
  return (row.choices ?? []).slice(0, MAX_PIECE_OPTIONS).find((c) => c.value === value)?.value ?? null;
}

/** The kind a pressed start button stands for; null when the key is not one of the kinds. */
export function startKind(itemKey: string): string | null {
  return PIECE_KINDS.find((kind) => kind.value === itemKey)?.value ?? null;
}

// ---------------------------------------------------------------------------------------------
// The solved scene's keys
// ---------------------------------------------------------------------------------------------

/** A node of the solved scene, as far as it is read here. */
export interface KeyedNode {
  key: string;
}

/** The row an item of the `rows` list belongs to, from a node's full key; null outside the rows. */
export function focusedRow(key: string | null): string | null {
  if (key === null) return null;
  const m = /#rows\/each@\d+~([a-zA-Z]{1,24})\//.exec(key);
  return m === null || m[1] === undefined ? null : m[1];
}

const inRow = (key: string, row: string): boolean => focusedRow(key) === row;

/** The full key of a row's part (`#field`, `#choice`); null when the scene has none. */
function rowPart(scene: readonly KeyedNode[], row: string, part: string): string | null {
  if (!/^[a-zA-Z]{1,24}$/.test(row)) return null;
  return scene.find((node) => inRow(node.key, row) && node.key.endsWith(`/${part}`))?.key ?? null;
}

export const fieldNode = (scene: readonly KeyedNode[], row: string): string | null => rowPart(scene, row, "#field");
export const choiceNode = (scene: readonly KeyedNode[], row: string): string | null => rowPart(scene, row, "#choice");

/**
 * The key a row's field will have, for a row the scene does not show yet: another row's field
 * key with this row's name in the item's place (every item of a list has the template's keys).
 * Null when the scene has no field to go by.
 */
export function fieldNodeLike(scene: readonly KeyedNode[], row: string): string | null {
  if (!/^[a-zA-Z]{1,24}$/.test(row)) return null;
  const sibling = scene.find((node) => focusedRow(node.key) !== null && node.key.endsWith("/#field"))?.key;
  return sibling === undefined ? null : sibling.replace(/(#rows\/each@\d+~)[a-zA-Z]{1,24}\//, `$1${row}/`);
}

/** A node of the solved scene with its painted box. */
export interface BoxedNode extends KeyedNode {
  y: number;
  h: number;
}

/**
 * Which ends of the scrolling body hide content: what lies above its box, what lies below it.
 * Read from the painted scene (a scrolled child is painted where it was moved to).
 */
export function hiddenEnds(scene: readonly BoxedNode[]): { above: boolean; below: boolean } {
  const body = scene.find((node) => node.key.endsWith("/#body"));
  if (body === undefined || !(body.h > 0)) return { above: false, below: false };
  let top = Infinity;
  let bottom = -Infinity;
  for (const node of scene) {
    if (!node.key.startsWith(`${body.key}/`) || node.key.indexOf("/", body.key.length + 1) >= 0) continue;
    if (!Number.isFinite(node.y) || !Number.isFinite(node.h)) continue;
    top = Math.min(top, node.y);
    bottom = Math.max(bottom, node.y + node.h);
  }
  return { above: top < body.y - 1, below: bottom > body.y + body.h + 1 };
}

/** The full key of the first kind's start button; null when the scene shows a piece. */
export function startNode(scene: readonly KeyedNode[]): string | null {
  return scene.find((node) => /#starts\/each@\d+~line-\d{1,2}\/.*~[a-z]{1,24}\/row@\d+\/#start$/.test(node.key))?.key ?? null;
}

/** The control of the row before or after the one `from` is in; null at either end. */
export function stepNode(scene: readonly KeyedNode[], from: string, step: 1 | -1): string | null {
  const controls = scene.filter((node) => /\/#(field|choice|tick|remove)$/.test(node.key)).map((node) => node.key);
  const at = controls.indexOf(from);
  return at < 0 ? null : (controls[at + step] ?? null);
}
