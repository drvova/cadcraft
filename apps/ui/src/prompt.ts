/**
 * The command line's state machine, text side only: it turns the facade's `cmdline()` /
 * `prompt()` replies (the engine's command-line state: prompt, keywords, running command,
 * output tail) into the visible prompt and the capped output log. No DOM, no engine calls —
 * the component renders what this returns.
 */

/**
 * What a prompt takes, as the engine says it (`Accept` in `crates/engine/src/prompt.rs`): a
 * "Select objects" prompt is `select` and `point` together, a radius is `point` and `number`.
 */
export interface PromptAccept {
  point: boolean;
  number: boolean;
  text: boolean;
  select: boolean;
  /** Enter is meaningful (it ends the command or takes the default). */
  enter: boolean;
}

export interface CmdlineReply {
  prompt: string | null;
  running: string | null;
  keywords: readonly string[];
  accept: PromptAccept | null;
  output: readonly string[];
  error: string | null;
}

export interface PromptState {
  /** The engine's current prompt text; "" when the engine does not name one. */
  prompt: string;
  keywords: readonly string[];
  /** The command being prompted for, if any (e.g. "circle" mid-prompt). */
  running: string | null;
  /** What the prompt accepts, if the engine says; null with no prompt up. */
  accept: PromptAccept | null;
  /** The visible output tail, oldest first, capped at [`MAX_OUTPUT_LINES`]. */
  output: readonly string[];
  /** The last refused input, if any; cleared by the next readable reply. */
  error: string | null;
}

/** Shown while no command is running. */
export const IDLE_PROMPT = "Command:";
export const MAX_OUTPUT_LINES = 200;
export const MAX_KEYWORDS = 24;
const MAX_REPLY_BYTES = 4 * 1024 * 1024;

export function emptyPrompt(): PromptState {
  return { prompt: "", keywords: [], running: null, accept: null, output: [], error: null };
}

/**
 * Read a reply's `accept`: the engine's object of flags, or the one word a canned facade writes
 * ("point", "number", "text", "select"). Anything else is "not said".
 */
export function parseAccept(value: unknown): PromptAccept | null {
  if (typeof value === "string") {
    const word = value.trim().toLowerCase();
    if (word !== "point" && word !== "number" && word !== "text" && word !== "select") return null;
    return { point: word === "point" || word === "select", number: word === "number", text: word === "text", select: word === "select", enter: true };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  return { point: o["point"] === true, number: o["number"] === true, text: o["text"] === true, select: o["select"] === true, enter: o["enter"] === true };
}

/** Parse a facade command-line reply; null when it is not a JSON object. */
export function parseCmdlineReply(raw: string): CmdlineReply | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_REPLY_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const str = (k: string): string | null => (typeof o[k] === "string" ? (o[k] as string) : null);
  const list = (k: string): string[] => {
    const v = o[k];
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === "string") out.push(item);
      if (out.length >= MAX_OUTPUT_LINES) break;
    }
    return out;
  };
  return {
    prompt: str("prompt"),
    running: str("running"),
    keywords: list("keywords").slice(0, MAX_KEYWORDS),
    accept: parseAccept(o["accept"]),
    output: list("output"),
    error: str("error"),
  };
}

/** Keep the last `max` lines (the output tail is what the user reads). */
export function capLines(lines: readonly string[], max: number): string[] {
  const m = Math.max(0, Math.floor(max));
  return lines.length <= m ? [...lines] : lines.slice(lines.length - m);
}

/**
 * Fold a facade reply into the visible state. `echo`, when given, is the user's own line and
 * is prepended to the output (the engine's log does not echo it back through the facade).
 * An unreadable reply keeps the previous state and raises the error line.
 */
export function reducePrompt(prev: PromptState, raw: string, echo?: string): PromptState {
  const reply = parseCmdlineReply(raw);
  if (!reply) return { ...prev, error: "the command line returned an unreadable reply" };
  const added: string[] = [];
  if (echo !== undefined && echo.trim() !== "") added.push(echo);
  if (reply.output.length > 0) added.push(...reply.output);
  return {
    prompt: reply.prompt ?? prev.prompt,
    keywords: reply.keywords,
    running: reply.running,
    accept: reply.accept,
    output: capLines([...prev.output, ...added], MAX_OUTPUT_LINES),
    error: reply.error,
  };
}

/** The input's placeholder: the engine's current prompt, or the idle prompt. */
export function promptText(state: PromptState): string {
  return state.prompt.trim() !== "" ? state.prompt : IDLE_PROMPT;
}

/** The keyword hint ("Close/Undo"), or null when the prompt offers none. */
export function keywordHint(state: PromptState): string | null {
  return state.keywords.length > 0 ? state.keywords.join(" / ") : null;
}

/**
 * What the pointer does on the drawing while this prompt is up: nothing runs (`idle`: clicks and
 * rectangles select), the command wants a point (`point`: a click supplies it), it wants objects
 * (`select`: clicks and rectangles pick into the command), or it wants only what is typed, a
 * keyword, a number or text (`typed`: a click does nothing).
 */
export type PointerWants = "idle" | "point" | "select" | "typed";

export function pointerWants(state: PromptState): PointerWants {
  const accept = state.accept;
  if (accept === null) return state.running === null ? "idle" : "typed";
  if (accept.select) return "select";
  return accept.point ? "point" : "typed";
}

/** The most decimals a clicked ordinate is written with (a double holds about 15 to 17 digits). */
export const MAX_POINT_DECIMALS = 15;

/** How much finer than one pixel a clicked point is written: a thousandth of it. */
const SUBPIXEL_DIGITS = 3;

/**
 * One ordinate as the command line takes it: plain decimals, never an exponent, no trailing
 * zeros, no "-0". Null when it is not a number the engine could read back.
 */
export function formatOrdinate(value: number, decimals: number): string | null {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) return null;
  const places = Number.isFinite(decimals) ? Math.min(MAX_POINT_DECIMALS, Math.max(0, Math.round(decimals))) : MAX_POINT_DECIMALS;
  const fixed = value.toFixed(places);
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return trimmed === "-0" ? "0" : trimmed;
}

/**
 * A clicked world point as typed input (`x,y`, absolute), rounded a thousand times finer than
 * `worldPerPixel` (the world size of one CSS pixel), so the object lands under the pointer at any
 * zoom and the history stays readable. Without a usable pixel size it is written in full. Null
 * when the point is not finite: nothing is sent.
 */
export function formatPoint(point: { x: number; y: number }, worldPerPixel: number): string | null {
  const decimals = Number.isFinite(worldPerPixel) && worldPerPixel > 0 ? Math.ceil(-Math.log10(worldPerPixel)) + SUBPIXEL_DIGITS : MAX_POINT_DECIMALS;
  const x = formatOrdinate(point.x, decimals);
  const y = formatOrdinate(point.y, decimals);
  return x === null || y === null ? null : `${x},${y}`;
}

/**
 * A rectangle dragged while a command asks for objects, as typed input: the engine's `BOX` mode
 * with the corner the drag began at first, so left to right is a window and right to left a
 * crossing, as at rest. Null when a corner is not finite.
 */
export function formatSelectBox(rect: { x0: number; y0: number; x1: number; y1: number }, kind: "window" | "crossing", worldPerPixel: number): string | null {
  const from = formatPoint({ x: kind === "crossing" ? rect.x1 : rect.x0, y: rect.y0 }, worldPerPixel);
  const to = formatPoint({ x: kind === "crossing" ? rect.x0 : rect.x1, y: rect.y1 }, worldPerPixel);
  return from === null || to === null ? null : `BOX ${from} ${to}`;
}
