/**
 * The bench sheet as the Slab Bench panel takes it (`slab/bench.slab`): typed scalar and list
 * params, nothing else. Every figure is the engine's, already read with checked narrowing by
 * `../bench`; this file only shapes it, caps it again (a Slab list is laid out whole) and reads a
 * pressed line back to the objects it selects. The behaviour stays where it was: `../bench` and
 * the shell's handlers.
 */

import { benchSummary, lineSelected, MAX_BENCH_LINES, type BenchSheet } from "../bench";

/** One item of the panel's `lines` list: a `BenchLine` of the document. */
export interface BenchLineParam {
  /** The item's identity in the kernel: its place in the sheet. */
  key: string;
  name: string;
  amount: string;
  /** What a screen reader is told beyond the name: the amount, a note, whether it is selected. */
  hint: string;
  pressable: boolean;
  current: boolean;
}

export interface BenchNoteParam {
  key: string;
  note: string;
}

export interface BenchPanelParams {
  summary: string;
  open: boolean;
  empty: boolean;
  costed: boolean;
  labored: boolean;
  settable: boolean;
  metal: string;
  stones: string;
  labor: string;
  total: string;
  lines: BenchLineParam[];
  warnings: BenchNoteParam[];
  unpriced: BenchNoteParam[];
}

/** The longest text handed to the kernel for one run (a label is a dozen characters). */
export const MAX_PARAM_TEXT = 240;

/** One run of text for the kernel: a single line, no control characters, capped. */
export function paramText(value: string): string {
  let line = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // Control characters and the line and paragraph separators (U+2028, U+2029) become a space.
    line += code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 ? " " : char;
    if (line.length > MAX_PARAM_TEXT * 2) break;
  }
  line = line.replace(/ {2,}/g, " ").trim();
  return line.length > MAX_PARAM_TEXT ? `${line.slice(0, MAX_PARAM_TEXT - 1)}\u2026` : line;
}

/** The key of the line at `index`. */
const lineKey = (index: number): string => `line-${index}`;

/** The panel's params for a sheet, the drawing's selection, and whether the section is open. */
export function benchPanelParams(sheet: BenchSheet | null, selection: ReadonlySet<string>, canPrice: boolean, open: boolean): BenchPanelParams {
  const summary = paramText(benchSummary(sheet));
  // A folded section is its heading alone: nothing under it is laid out, focusable or read out.
  if (!open) return { summary, open, empty: false, costed: false, labored: false, settable: false, metal: "", stones: "", labor: "", total: "", lines: [], warnings: [], unpriced: [] };
  const lines = (sheet?.lines ?? []).slice(0, MAX_BENCH_LINES);
  const cost = sheet?.cost ?? null;
  const empty = lines.length === 0;
  return {
    summary,
    open,
    empty,
    costed: cost !== null,
    labored: cost !== null && cost.labor !== null,
    settable: canPrice && !empty && cost === null,
    metal: paramText(cost?.metal ?? ""),
    stones: paramText(cost?.stones ?? ""),
    labor: paramText(cost?.labor ?? ""),
    total: paramText(cost?.total ?? ""),
    lines: lines.map((line, index) => {
      const pressable = line.handles.length > 0;
      const current = pressable && lineSelected(line, selection);
      const said = [line.value, line.note ?? "", current ? "Selected on the drawing" : ""].filter((part) => part !== "");
      return { key: lineKey(index), name: paramText(line.label), amount: paramText(line.value), hint: paramText(said.join(". ")), pressable, current };
    }),
    warnings: (sheet?.warnings ?? []).slice(0, MAX_BENCH_LINES).map((warning, index) => ({ key: `warning-${index}`, note: paramText(warning) })),
    unpriced: (cost?.lines ?? [])
      .filter((line) => line.amount === null)
      .slice(0, MAX_BENCH_LINES)
      .map((line, index) => ({ key: `unpriced-${index}`, note: paramText(`${line.what} — unpriced${line.note === null ? "" : ` (${line.note})`}`) })),
  };
}

/**
 * What a press on the line with this item key selects: its objects, or nothing when they are all
 * selected already (the second press lets the selection go). Null when the key names no line of
 * the sheet that can be pressed, so a stale or forged signal does nothing.
 */
export function pressedHandles(sheet: BenchSheet | null, itemKey: string, selection: ReadonlySet<string>): readonly string[] | null {
  const m = /^line-(\d{1,4})$/.exec(itemKey);
  if (sheet === null || m === null) return null;
  const index = Number(m[1]);
  if (index >= MAX_BENCH_LINES) return null;
  const line = sheet.lines[index];
  if (line === undefined || line.handles.length === 0) return null;
  return lineSelected(line, selection) ? [] : line.handles;
}
