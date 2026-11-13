/**
 * The command line as the Slab panel takes it (`slab/cmdline.slab`): typed scalar and list
 * params, nothing else. What the prompt is, what was refused and what a keyword answers are
 * `../prompt`'s, as for the SolidJS panel; this file only shapes them for the kernel, and does
 * the three things the document cannot at the pinned commit:
 *
 * - **Wraps the history.** A `virtual` list's items are all one height, so a line longer than
 *   the panel is wide is cut here into painted lines, by the column: the face is monospaced and
 *   the page measured its advance.
 * - **Sets the keywords in rows.** An `each` directly under a `wrap` is one block, so the rows are
 *   made here from the words' measured widths.
 * - **Works out the panel's height.** A surface is as tall as its element, and every part's
 *   height is known from the params alone, so the height is set with them, in the same turn.
 *
 * Every string and every list handed to the kernel is bounded here.
 */

import { IDLE_PROMPT, MAX_KEYWORDS, promptText, type PromptState } from "../prompt";

/** One item of the panel's `lines` list: a `CmdLine` of the document. */
export interface CmdLineParam {
  /** The line's number since the panel came up, and the part of it this painted line is. */
  key: string;
  t: string;
  /** The line being answered: the stronger ink. */
  newest: boolean;
}

export interface CmdKeyParam {
  /** The keyword's place in the prompt's list (`k3`): what a press comes back with. */
  key: string;
  word: string;
  /** Not a row's first: it stands the keywords' gap after the one before it. */
  lead: boolean;
}

export interface CmdKeyRowParam {
  key: string;
  words: CmdKeyParam[];
}

export interface CmdlineParams {
  lines: CmdLineParam[];
  out_h: number;
  /** The band's inset above and below, and the room under the history and under the keywords. */
  pad_t: number;
  pad_b: number;
  out_gap: number;
  keys_gap: number;
  /** The typed line's row: the field's height, or an error's two lines when it wraps. */
  entry_h: number;
  key_rows: CmdKeyRowParam[];
  said: string;
  failed: boolean;
  error: string;
  err_w: number;
  /** The error is longer than its two lines: its whole text is the hint's. Not a param. */
  errCut: boolean;
}

/**
 * The document's measures the host needs before the kernel has solved anything (styles.css:
 * `.cmdline` and below). `line` is the list's `item-extent`, a constant of the document.
 */
export interface CmdMeasures {
  /** The band's top hairline. */
  edge: number;
  /** The band's inset above and below. */
  pad: number;
  /** The room between the band's parts. */
  gap: number;
  /** One line of the history. */
  line: number;
  /** The typed line's height, and a row of keywords'. */
  row: number;
  /** Where the history's text starts and how far before the panel's edge it ends. */
  column: number;
  end: number;
  /** A keyword's inset each side, the room between two, and where a row of them starts. */
  keyPad: number;
  keyGap: number;
  keyStart: number;
  /** How far an error of two lines stands over the typed line's row, above and below (styles.css: `.cmd-error`, two 14 lines in a row of 24). */
  errOver: number;
}

export const CMD_MEASURES: CmdMeasures = { edge: 1, pad: 6, gap: 4, line: 16, row: 24, column: 12, end: 8, keyPad: 8, keyGap: 4, keyStart: 4, errOver: 2 };

/** How many lines the history shows before it scrolls (styles.css: `.cmd-output`). */
export const MAX_SHOWN_LINES = 5;
/** The most painted lines handed to the kernel; the oldest give way. (Setting the list costs 0.7 ms at 200 lines and 4.6 ms at 2,000, measured; a frame costs the same whatever it holds.) */
export const MAX_PAINTED_LINES = 2_000;
/** The longest history line read; the rest of it is an ellipsis. */
export const MAX_LINE_CHARS = 4_000;
/** The most painted lines one history line is cut into; the rest of it is an ellipsis. */
export const MAX_LINE_PARTS = 64;
/** The fewest and the most columns a line is cut at, whatever the panel's width is said to be. */
export const MIN_COLUMNS = 8;
export const MAX_COLUMNS = 1_000;
/** The longest error handed to the kernel. */
export const MAX_ERROR_CHARS = 400;
/** The longest keyword drawn. */
export const MAX_KEYWORD_CHARS = 48;
/** An error is as wide as this many characters, or half the panel, the lesser (styles.css: `.cmd-error`). */
export const ERROR_CHARS = 40;
/** An error wraps to this many lines and is then cut. */
export const ERROR_LINES = 2;

/**
 * How many lines `text` takes in a box `width` wide, as the kernel wraps it: greedily, at
 * spaces, a word longer than the line broken where it must be. Counted up to `most` and no
 * further. `measure` is a run's width on one line.
 */
export function wrappedLines(text: string, width: number, measure: (run: string) => number, most: number = ERROR_LINES + 1): number {
  if (text === "") return 0;
  if (!(width > 0) || !Number.isFinite(width)) return most;
  const wide = (run: string): number => Math.max(0, finite(measure(run), Number.POSITIVE_INFINITY));
  const space = wide(" ");
  let lines = 1;
  let used = 0;
  for (const word of text.split(" ")) {
    const w = wide(word);
    if (used > 0 && used + space + w <= width) {
      used += space + w;
      continue;
    }
    if (used > 0) lines += 1;
    // A word wider than the line runs on over as many lines as it needs.
    const over = w > width ? Math.ceil(w / width) - 1 : 0;
    lines += Number.isFinite(over) ? over : most;
    used = w > width ? w % width : w;
    if (lines >= most) return most;
  }
  return Math.min(lines, most);
}

const finite = (n: number, fallback: number): number => (Number.isFinite(n) ? n : fallback);

/** A history line for the kernel: one line, a tab as a space, no control characters; its runs of spaces are kept (the lines are columns). */
export function lineText(value: string): string {
  let out = "";
  let count = 0;
  for (const char of value) {
    if (count >= MAX_LINE_CHARS) return `${out}…`;
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code < 0xa0) || code === 0x2028 || code === 0x2029 ? " " : char;
    count += 1;
  }
  return out;
}

/** How many columns of the mono face the history has, for a panel `width` wide and an advance of `advance`. */
export function columnsFor(width: number, advance: number, m: CmdMeasures = CMD_MEASURES): number {
  const room = finite(width, 0) - m.column - m.end;
  if (!(advance > 0) || !Number.isFinite(advance) || room <= 0) return MAX_COLUMNS;
  // A hair of slack: the kernel sums advances kept to 1/1024 px.
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.floor((room + 0.01) / advance)));
}

/**
 * A line cut into painted lines of `columns` characters at most: at the last space that fits
 * when there is one (the space stays at the end of its line), in the middle of a word longer than
 * the line. Never empty: an empty line is one empty painted line.
 */
export function wrapLine(text: string, columns: number): string[] {
  const chars = [...text];
  const width = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.floor(finite(columns, MAX_COLUMNS))));
  if (chars.length <= width) return [text];
  const out: string[] = [];
  let at = 0;
  while (at < chars.length) {
    if (out.length === MAX_LINE_PARTS - 1 && chars.length - at > width) {
      out.push(`${chars.slice(at, at + width - 1).join("")}…`);
      break;
    }
    let end = Math.min(chars.length, at + width);
    if (end < chars.length && chars[end] !== " ") {
      let space = end - 1;
      while (space > at && chars[space] !== " ") space -= 1;
      if (space > at) end = space + 1;
    }
    out.push(chars.slice(at, end).join(""));
    at = end;
  }
  return out;
}

/**
 * How many of `prev`'s first lines are gone from `next`: the history is a capped tail, so the
 * lines kept are the end of `prev` at the start of `next`. `prev.length` when nothing of it is
 * kept (another history). The lines' numbers go up by this, so a line keeps its key while it is
 * shown: the kernel's selection, and the node a screen reader has read, stay on it.
 */
export function droppedLines(prev: readonly string[], next: readonly string[]): number {
  if (prev.length === 0) return 0;
  for (let k = Math.max(0, prev.length - next.length); k < prev.length; k++) {
    let same = true;
    for (let i = k; i < prev.length; i++) {
      if (prev[i] !== next[i - k]) {
        same = false;
        break;
      }
    }
    if (same) return k;
  }
  return prev.length;
}

/** The history as painted lines: `first` is the number of `output`'s first line. */
export function historyLines(output: readonly string[], first: number, columns: number): CmdLineParam[] {
  const out: CmdLineParam[] = [];
  const base = Number.isSafeInteger(first) && first >= 0 ? first : 0;
  const last = output.length - 1;
  for (const [at, raw] of output.entries()) {
    const parts = wrapLine(lineText(raw), columns);
    for (const [part, t] of parts.entries()) out.push({ key: parts.length === 1 ? String(base + at) : `${base + at}.${part}`, t, newest: at === last });
  }
  return out.length > MAX_PAINTED_LINES ? out.slice(out.length - MAX_PAINTED_LINES) : out;
}

/** A keyword as drawn: one line, capped. */
function keyText(value: string): string {
  const line = lineText(value).trim();
  const chars = [...line];
  return chars.length > MAX_KEYWORD_CHARS ? `${chars.slice(0, MAX_KEYWORD_CHARS - 1).join("")}…` : line;
}

/**
 * The keywords in rows no wider than the panel: `measure` is a word's width in the chip's face.
 * A keyword wider than the panel has a row to itself.
 */
export function keyRows(keywords: readonly string[], width: number, measure: (word: string) => number, m: CmdMeasures = CMD_MEASURES): CmdKeyRowParam[] {
  const room = finite(width, 0) - m.keyStart - m.end;
  const rows: CmdKeyRowParam[] = [];
  let row: CmdKeyParam[] = [];
  let used = 0;
  for (const [at, raw] of keywords.slice(0, MAX_KEYWORDS).entries()) {
    const word = keyText(raw);
    if (word === "") continue;
    const w = Math.max(0, finite(measure(word), 0)) + 2 * m.keyPad;
    if (row.length > 0 && room > 0 && used + m.keyGap + w > room) {
      rows.push({ key: `r${rows.length}`, words: row });
      row = [];
      used = 0;
    }
    used += (row.length > 0 ? m.keyGap : 0) + w;
    row.push({ key: `k${at}`, word, lead: row.length > 0 });
  }
  if (row.length > 0) rows.push({ key: `r${rows.length}`, words: row });
  return rows;
}

/** The keyword a pressed key names (`k3`); null for a key the prompt no longer has. */
export function pressedKeyword(keywords: readonly string[], item: string): string | null {
  const m = /^k(\d{1,3})$/.exec(item);
  if (m === null) return null;
  const at = Number(m[1]);
  return at < MAX_KEYWORDS ? (keywords[at] ?? null) : null;
}

/** An error for the kernel: one line, capped. */
export function errorText(value: string | null): string {
  if (value === null) return "";
  const line = lineText(value).replace(/ {2,}/g, " ").trim();
  const chars = [...line];
  return chars.length > MAX_ERROR_CHARS ? `${chars.slice(0, MAX_ERROR_CHARS - 1).join("")}…` : line;
}

/** What the panel needs to know of the page: its width, and the advances the page measured. */
export interface CmdPage {
  width: number;
  /** One character of the history's face. */
  monoAdvance: number;
  /** One digit of the error's face (the sheet's `ch`). */
  labelAdvance: number;
  /** A keyword's width in the chip's face. */
  keyWidth: (word: string) => number;
  /** An error's width on one line, in its face. */
  errorWidth: (text: string) => number;
}

/** The panel's params for a prompt: `first` is the number of the history's first line; `error` what to show beside the field. */
export function cmdlineParams(state: PromptState, error: string | null, first: number, page: CmdPage, m: CmdMeasures = CMD_MEASURES): CmdlineParams {
  const lines = historyLines(state.output, first, columnsFor(page.width, page.monoAdvance, m));
  const rows = keyRows(state.keywords, page.width, page.keyWidth, m);
  const said = errorText(promptText(state));
  const text = errorText(error);
  const half = Math.max(0, finite(page.width, 0) / 2);
  const chars = ERROR_CHARS * (page.labelAdvance > 0 && Number.isFinite(page.labelAdvance) ? page.labelAdvance : 6);
  const cap = Math.max(1, Math.floor(Math.min(chars, half)));
  // A hair of slack: the kernel sums advances kept to 1/1024 px.
  const natural = text === "" ? 0 : Math.ceil(Math.max(0, finite(page.errorWidth(text), Number.POSITIVE_INFINITY)) + 0.5);
  // An error wider than its cap wraps to a second line. Two lines stand a little taller than the
  // field, and the row gives that back from the room above and below it, so the field, the band
  // and the drawing over it stay where they are.
  const tall = natural > cap;
  const over = tall ? m.errOver : 0;
  const above = rows.length > 0 ? "keys" : lines.length > 0 ? "out" : "pad";
  return {
    lines,
    out_h: Math.min(lines.length, MAX_SHOWN_LINES) * m.line,
    pad_t: m.pad - (above === "pad" ? over : 0),
    pad_b: m.pad - over,
    out_gap: lines.length > 0 ? m.gap - (above === "out" ? over : 0) : 0,
    keys_gap: rows.length > 0 ? m.gap - over : 0,
    entry_h: m.row + 2 * over,
    key_rows: rows,
    said: said === "" ? IDLE_PROMPT : said,
    failed: text !== "",
    error: text,
    err_w: Math.min(cap, Math.max(1, natural)),
    errCut: tall && wrappedLines(text, cap, page.errorWidth) > ERROR_LINES,
  };
}

/** The panel's height for its params: the edge, the band's insets, the history, the keywords and the typed line. */
export function panelHeight(params: Pick<CmdlineParams, "out_h" | "pad_t" | "pad_b" | "out_gap" | "keys_gap" | "key_rows" | "entry_h">, m: CmdMeasures = CMD_MEASURES): number {
  return Math.ceil(m.edge + params.pad_t + params.out_h + params.out_gap + params.key_rows.length * m.row + params.keys_gap + params.entry_h + params.pad_b);
}

/** Where the history is scrolled to after a page key: one view up (-1) or down (+1), kept inside it. */
export function pagedScroll(offset: number, direction: number, params: Pick<CmdlineParams, "lines" | "out_h">, m: CmdMeasures = CMD_MEASURES): number {
  const most = Math.max(0, params.lines.length * m.line - params.out_h);
  const step = Math.max(m.line, params.out_h - m.line);
  return Math.min(most, Math.max(0, finite(offset, 0) + Math.sign(direction) * step));
}

/** The offset that shows the history's last line. */
export function tailScroll(params: Pick<CmdlineParams, "lines" | "out_h">, m: CmdMeasures = CMD_MEASURES): number {
  return Math.max(0, params.lines.length * m.line - params.out_h);
}
