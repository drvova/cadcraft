/**
 * The command line's state machine, text side only: it turns the facade's `cmdline()` /
 * `prompt()` replies (the engine's command-line state: prompt, keywords, running command,
 * output tail) into the visible prompt and the capped output log. No DOM, no engine calls —
 * the component renders what this returns.
 */

export interface CmdlineReply {
  prompt: string | null;
  running: string | null;
  keywords: readonly string[];
  accept: string | null;
  output: readonly string[];
  error: string | null;
}

export interface PromptState {
  /** The engine's current prompt text; "" when the engine does not name one. */
  prompt: string;
  keywords: readonly string[];
  /** The command being prompted for, if any (e.g. "circle" mid-prompt). */
  running: string | null;
  /** What the prompt accepts ("point", "number", …), if the engine says. */
  accept: string | null;
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
    accept: str("accept"),
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
