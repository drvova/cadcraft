/**
 * The assistant: the same one-tool contract the desktop pane and the MCP server publish, driven
 * from the browser. The model gets exactly one tool — `run`, which executes AutoLISP inside the
 * open drawing (`crates/engine/src/cmd/code.rs`) — and everything else is reached from code.
 *
 * The wire protocol is the OpenAI chat protocol with streaming, the same one `crates/ai` speaks
 * to the desktop's providers, so the prompt, the tool envelope, the SSE assembly and the report
 * text here are ports of `crates/ai/src/{agent,chat,client,code}.rs` — same shapes, same words.
 * The one deliberate difference is transport: `fetch` with a `ReadableStream` instead of a
 * blocking socket, and cancellation is an `AbortSignal`.
 *
 * Nothing here touches the DOM; the pane renders the events this module emits.
 */

export interface ProviderConfig {
  /** The API root, e.g. `http://127.0.0.1:11434/v1`; `/chat/completions` is added. */
  baseUrl: string;
  model: string;
  /** Sent as `Authorization: Bearer …`; left out when empty (a local server usually wants none). */
  apiKey: string;
}

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  key: boolean;
}

/** The well-known providers, most-used first (a port of `crates/ai/src/client.rs`'s `PRESETS`). */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5.1", key: true },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4.5", key: true },
  { id: "anthropic", label: "Anthropic (OpenAI-compatible)", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", key: true },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", key: true },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", key: true },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest", key: true },
  { id: "xai", label: "xAI", baseUrl: "https://api.x.ai/v1", model: "grok-4", key: true },
  { id: "together", label: "Together", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", key: true },
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2", key: false },
  { id: "lmstudio", label: "LM Studio (local)", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model", key: false },
  { id: "custom", label: "Other (OpenAI-compatible)", baseUrl: "", model: "", key: false },
];

/** The URL one request goes to (`Provider::endpoint`). */
export function providerEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

/** Whether the provider is configured enough to send; the message names what is missing. */
export function providerReady(provider: ProviderConfig): string | null {
  if (provider.baseUrl.trim() === "") return "Set the assistant's base URL (the model button below).";
  if (!provider.baseUrl.trim().startsWith("http://") && !provider.baseUrl.trim().startsWith("https://")) {
    return `The assistant's base URL must start with http:// or https://, not \`${provider.baseUrl.trim()}\`.`;
  }
  if (provider.model.trim() === "") return "Set the assistant's model name.";
  return null;
}

// ---- The tool: one, and only one -----------------------------------------------------------------

export const RUN_TOOL = "run";

/** The tool's description (`crates/ai/src/code.rs`'s `DESCRIPTION`, verbatim). */
export const RUN_DESCRIPTION =
  "Run code in the open drawing and return what it printed, what it was worth, and the pictures it " +
  "drew. The language is AutoLISP and the drawing is the object: `(cmd \"circle\" '((CENTER . (0 0) " +
  "(RADIUS . 5)))` draws, `(cmd \"entities\" '((TYPE . \"Circle\")))` reads back, `(cmdline \"zoom\" " +
  "\"e\")` types at the command line like a person. Call with empty `code` for the manual, which lists " +
  "the namespace and how to reach every command — then `(commands)`, then `(describe \"id\")` for the " +
  "parameters of one. Everything defined with `(defun NAME …)` or `(setq NAME literal)` is KEPT and " +
  "reloaded next session, so build helpers and reuse them: `(kept)`, `(forget \"NAME\")`. " +
  "`(render)` returns a PNG of the drawing, shown to you. THIS TOOL RUNS CODE WITH THE AUTHORITY OF " +
  "THE PROCESS: there is no code-free mode and no disable switch — the server is meant to be run " +
  "sandboxed (a container, a VM, a jail) when the model driving it is not trusted with the user's " +
  "files.";

/** The one tool's JSON Schema: `code`, the named values, and nothing else. */
export function runToolSchema(): unknown {
  return {
    type: "object",
    properties: {
      code: { type: "string", description: "AutoLISP to run in the open drawing. Empty or omitted: the manual." },
      values: {
        type: "object",
        description: "Long or literal texts to hand the code without escaping them inside `code`; read them with (value \"name\").",
        additionalProperties: { type: "string" },
      },
    },
  };
}

/** The tool as a chat API wants it: `{type: "function", function: {name, description, parameters}}`. */
export function runToolDefinition(): unknown {
  return { type: "function", function: { name: RUN_TOOL, description: RUN_DESCRIPTION, parameters: runToolSchema() } };
}

// ---- The briefing and the system prompt (a port of `crates/ai/src/agent.rs`) ---------------------

/** The state of the application the assistant is told about, fresh at the start of every turn. */
export interface Briefing {
  app: string;
  drawing: string;
  units: string;
  objects: number;
  selection: number;
  extents: readonly number[] | null;
}

/** The system prompt: who the model is, what the drawing holds, and how this application is driven. */
export function systemPrompt(b: Briefing): string {
  let s = "";
  s +=
    "You are the assistant inside CADCraft, a CAD application. The user works in the same window: " +
    "everything you do lands in the drawing in front of them. You are not writing instructions for " +
    "someone else to follow — you make the changes yourself, with the tools you have.\n\n";
  s += "The drawing right now:\n";
  s += `- Application: ${b.app === "" ? "CADCraft" : b.app}\n`;
  s += `- Drawing: ${b.drawing === "" ? "an unsaved drawing" : b.drawing}\n`;
  s += `- Units: ${b.units === "" ? "unknown" : b.units} (every coordinate you give is in these units)\n`;
  s += `- Objects in the active space: ${b.objects}`;
  if (b.selection > 0) s += `; ${b.selection} selected`;
  s += "\n";
  const e = b.extents;
  if (e !== null && e.length === 4) {
    s += `- Extents: (${fmt(e[0] ?? 0)}, ${fmt(e[1] ?? 0)}) to (${fmt(e[2] ?? 0)}, ${fmt(e[3] ?? 0)})\n`;
  }
  s +=
    "\nHow you work — one tool, and a language inside the drawing:\n" +
    "You have exactly one tool, `run`, which executes AutoLISP inside the open drawing. Empty code\n" +
    "returns the manual: read it once, at the start. Everything else is a function in that\n" +
    "namespace, so the whole application is reachable from code.\n" +
    "1. Discover before you act. `(commands)` lists every command with its id, label, aliases and\n" +
    "parameters; `(commands \"circ\")` filters; `(describe \"id\")` gives one command's real\n" +
    "parameters. Never guess a command id or a parameter name.\n" +
    "2. Act precisely with `(cmd \"id\" params)` — an alist of parameters:\n" +
    "`(cmd \"line\" '((POINTS . ((0 0) (10 0)))))`, `(cmd \"circle\" '((CENTER . (0 0)) (RADIUS . 5)))`.\n" +
    "Use `(cmdline \"line\" \"0,0\" \"10,0\")` when a command asks questions the way a person\n" +
    "answers them.\n" +
    "3. Verify with measurements. `(cmd \"describe\")` is the measured report of the drawing —\n" +
    "counts, extents, lengths, areas, layers; `(inspect)` is the state (layers, styles, blocks,\n" +
    "selection, undo). A result is the truth; an assumption is not. After a change, look again.\n" +
    "4. Build your own tooling. `(defun NAME …)` and `(setq NAME literal)` are KEPT and reloaded\n" +
    "in your next session — `(kept)` lists them, `(forget \"NAME\")` removes one. Write a helper\n" +
    "once, reuse it always.\n" +
    "5. This is the browser build: there is no filesystem. `(render)` and file paths answer with\n" +
    "an error, and `(defun …)` helpers are kept for this session only, not reloaded next time.\n" +
    "Everything else works: drawing, reading back, measuring.\n" +
    "6. Pictures the reader attaches are in the message and you can see them, but they have no\n" +
    "file path here, so they cannot be traced or measured with code — describe what you see.\n\n";
  s +=
    "How to report what you did:\n" +
    "- Say what you changed and **the numbers that came out of it**: how many objects, which handles or " +
    "layers, the size, the measured length, area or weight the tools reported. A report of a drawing is a " +
    "report of measurements — \"offset 2 mm\" is weaker than \"offset 2 mm; 14 outlines now total 412.6 mm " +
    "of path and enclose 1,284 mm², on layer Walls\".\n" +
    "- Name anything that came out different from what was asked, and why (a skipped object, a fit that " +
    "failed, a size that had to round). Silence about a surprise is the one thing a report must not do.\n" +
    "- Give what is worth checking in one line, when there is something: a measurement to confirm, a place " +
    "to look, a choice you made that the user may want the other way.\n" +
    "- No JSON dumps, no restating the request back, no apologies, no filler. Depth means substance, not " +
    "length: three measured sentences beat a page of adjectives.\n" +
    "- If a request is ambiguous in a way that changes the result (which object, which layer, which size), " +
    "ask one short question instead of guessing — or make the safe choice and say which one you made.\n" +
    "- You can see only what the tools tell you. If you have not looked at something, look before claiming it.\n";
  return s;
}

function fmt(x: number): string {
  return Number.isFinite(x) ? x.toFixed(3) : "0.000";
}

// ---- The report text (a port of `crates/ai/src/code.rs`) -----------------------------------------

export const MAX_TOOL_RESULT_CHARS = 8_000;
export const MAX_REQUEST_CHARS = 60_000;
export const MAX_ROUNDS = 12;

/** The report as the text a model reads (`Report::of(...).text()`), from the `run` command's result. */
export function reportText(result: unknown): string {
  const r = asRecord(result);
  const strings = (key: string): string[] => {
    const v = r[key];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  };
  const manual = typeof r["manual"] === "string" ? r["manual"] : null;
  if (manual !== null) return manual;
  const out: string[] = [];
  const error = typeof r["error"] === "string" ? r["error"] : null;
  if (error !== null) out.push(`error: ${error}`);
  const output = strings("output");
  if (output.length > 0) out.push(output.join("\n"));
  const value = typeof r["value"] === "string" ? r["value"] : null;
  if (value !== null && value !== "nil") out.push(`=> ${value}`);
  const kept = strings("kept");
  if (kept.length > 0) out.push(`kept: ${kept.join(", ")}`);
  const refused = strings("refused");
  if (refused.length > 0) {
    out.push(`refused: ${refused.join(", ")} would replace a built-in function; pick another name (the language is intact)`);
  }
  const broken = Array.isArray(r["broken"]) ? r["broken"] : [];
  for (const b of broken) {
    const row = asRecord(b);
    out.push(`kept definition \`${typeof row["name"] === "string" ? row["name"] : ""}\` did not load: ${typeof row["error"] === "string" ? row["error"] : ""}`);
  }
  for (const image of strings("images")) out.push(`rendered ${image}`);
  if (out.length === 0) out.push("(the code ran and returned nil)");
  return out.join("\n") + "\n";
}

/**
 * A short line for a tool row: what the result says in its own words when it says anything.
 * A string result (the report text, as `run` produces) contributes its first line.
 */
export function noteOf(result: unknown): string {
  if (typeof result === "string") {
    const line = (result.split("\n")[0] ?? "").trim();
    return line === "" ? clip(result, 160) : clip(line, 160);
  }
  const v = asRecord(result);
  const message = v["message"];
  if (typeof message === "string") {
    const line = (message.split("\n")[0] ?? "").trim();
    if (line !== "") return clip(line, 160);
  }
  for (const key of ["count", "placed", "handle", "handles", "objects", "total"]) {
    const x = v[key];
    if (x === undefined) continue;
    if (Array.isArray(x)) return `${key}: ${x.length}`;
    return clip(`${key}: ${JSON.stringify(x) ?? String(x)}`, 160);
  }
  return clip(JSON.stringify(result) ?? String(result), 160);
}

function clip(s: string, max: number): string {
  return [...s].length <= max ? s : `${[...s].slice(0, max).join("")}…`;
}

// ---- Messages ------------------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

/** A picture the reader attached: its name (for the model's text) and its data URL (for vision). */
export interface ChatImage {
  name: string;
  dataUrl: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  /** Pictures that travel with the message in the OpenAI vision shape. */
  images?: readonly ChatImage[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
}

/** The messages in the wire shape: `{role, content, tool_calls?, tool_call_id?, name?}`. */
export function wireMessages(messages: readonly ChatMessage[]): unknown[] {
  return messages.map((m) => {
    const o: Record<string, unknown> = { role: m.role };
    const images = m.images ?? [];
    if (images.length > 0) {
      // The OpenAI vision shape: one text part naming the pictures (the name is what the reader
      // called the file), then one image part per attachment. The desktop names the file's path
      // here; the browser has no path, so the name stands.
      let text = m.content ?? "";
      for (const img of images) text += `\n\n[attached picture: ${img.name}]`;
      o["content"] = [{ type: "text", text }, ...images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } }))];
    } else if (m.content !== undefined) o["content"] = m.content;
    else if (m.role === "assistant" && (m.toolCalls?.length ?? 0) > 0) o["content"] = null; // OpenAI wants null, not missing
    if ((m.toolCalls?.length ?? 0) > 0) {
      o["tool_calls"] = (m.toolCalls ?? []).map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
      }));
    }
    if (m.toolCallId !== undefined) o["tool_call_id"] = m.toolCallId;
    if (m.toolName !== undefined) o["name"] = m.toolName;
    return o;
  });
}

/**
 * The messages to send: as many whole turns as fit the budget, the newest first. A turn runs from
 * one user message to the next, so an assistant's tool call and the results it produced are never
 * separated. The newest turn is always sent, however large: it is the work in progress.
 */
export function trimToBudget(messages: readonly ChatMessage[], budget: number): ChatMessage[] {
  const cost = (m: ChatMessage): number =>
    (m.content ?? "").length +
    (m.images ?? []).reduce((n, img) => n + img.dataUrl.length, 0) +
    (m.toolCalls ?? []).reduce((n, c) => n + c.name.length + JSON.stringify(c.args ?? {}).length, 0);
  const starts: number[] = messages.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  if (starts.length === 0 || starts[0] !== 0) starts.unshift(0);
  let total = 0;
  let from = starts[starts.length - 1] ?? 0;
  for (let k = starts.length - 1; k >= 0; k--) {
    const s = starts[k] ?? 0;
    const end = starts[k + 1] ?? messages.length;
    const turnCost = messages.slice(s, end).reduce((n, m) => n + cost(m), 0);
    const newest = k === starts.length - 1;
    if (!newest && total + turnCost > budget) break;
    total += turnCost;
    from = s;
  }
  return messages.slice(from);
}

// ---- The stream (a port of `crates/ai/src/client.rs`'s `Stream`) ----------------------------------

interface PartialCall {
  id: string;
  name: string;
  args: string;
}

export interface Reply {
  text: string;
  toolCalls: ToolCall[];
  finish: string;
}

/** The OpenAI SSE stream, accumulated: text deltas pass through, tool-call fragments join by index. */
export class StreamAssembler {
  private text = "";
  private calls = new Map<number, PartialCall>();
  private finish = "";

  /** Read one `data:` payload; returns a text fragment when the payload carried one. */
  feed(payload: string): string | null {
    let v: unknown;
    try {
      v = JSON.parse(payload);
    } catch {
      throw new Error("the provider sent a line that is not JSON");
    }
    const root = asRecord(v);
    const err = root["error"];
    if (err !== undefined && err !== null) throw new Error(apiErrorText(200, JSON.stringify(err)));
    const choices = root["choices"];
    const choice = Array.isArray(choices) ? asRecord(choices[0]) : {};
    const reason = choice["finish_reason"];
    if (typeof reason === "string") this.finish = reason;
    const part = asRecord(choice["delta"] ?? choice["message"]);
    let fragment: string | null = null;
    const content = part["content"];
    if (typeof content === "string" && content !== "") {
      this.text += content;
      fragment = content;
    }
    const calls = part["tool_calls"];
    if (Array.isArray(calls)) {
      for (const raw of calls) {
        const call = asRecord(raw);
        const index = typeof call["index"] === "number" ? call["index"] : 0;
        let entry = this.calls.get(index);
        if (entry === undefined) {
          entry = { id: "", name: "", args: "" };
          this.calls.set(index, entry);
        }
        const id = call["id"];
        if (typeof id === "string") entry.id = id;
        const f = asRecord(call["function"]);
        const name = f["name"];
        if (typeof name === "string") entry.name += name;
        const args = f["arguments"];
        if (typeof args === "string") entry.args += args;
      }
    }
    return fragment;
  }

  /** The assembled reply. */
  finishReply(): Reply {
    const toolCalls: ToolCall[] = [];
    for (const [index, p] of [...this.calls.entries()].sort((a, b) => a[0] - b[0])) {
      if (p.name === "") throw new Error(`the model asked for a tool (call ${index}) without naming it`);
      toolCalls.push({ id: p.id === "" ? `call_${index}` : p.id, name: p.name, args: parseToolArgs(p.args) });
    }
    return { text: this.text, toolCalls, finish: this.finish };
  }
}

/** A tool call's arguments: empty means `{}`; malformed JSON is an error, not a crash. */
export function parseToolArgs(raw: string): unknown {
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`the model's tool arguments are not JSON: ${clip(raw, 120)}`);
  }
}

// ---- The turn -------------------------------------------------------------------------------------

export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "call"; name: string; code: string }
  | { type: "result"; name: string; ok: boolean; note: string; code: string; report: string }
  | { type: "done"; reason: string }
  | { type: "failed"; error: string };

/** What the tool call reaches: the shell's `run` command (`facade.execute("run", …)`). */
export type RunExecutor = (code: string, values: Record<string, string> | null) => { ok: true; result: unknown } | { ok: false; error: string };

export interface TurnOptions {
  provider: ProviderConfig;
  briefing: Briefing;
  /** The conversation so far; the turn appends to it (user/assistant/tool messages only). */
  conversation: ChatMessage[];
  execute: RunExecutor;
  onEvent: (event: AssistantEvent) => void;
  signal: AbortSignal;
  /** Injectable for tests; the real one is `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Run one turn to completion: ask the model, run what it asks for, feed the results back, repeat. */
export async function runTurn(opts: TurnOptions): Promise<void> {
  const { provider, conversation, onEvent, signal } = opts;
  const ready = providerReady(provider);
  if (ready !== null) {
    onEvent({ type: "failed", error: ready });
    return;
  }
  const system: ChatMessage = { role: "system", content: systemPrompt(opts.briefing) };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal.aborted) {
      onEvent({ type: "done", reason: "stopped" });
      return;
    }
    const sent = [system, ...trimToBudget(conversation, MAX_REQUEST_CHARS)];
    let reply: Reply;
    try {
      reply = await requestChat(provider, sent, signal, (t) => onEvent({ type: "text", text: t }), opts.fetchImpl);
    } catch (e) {
      if (signal.aborted) {
        onEvent({ type: "done", reason: "stopped" });
        return;
      }
      onEvent({ type: "failed", error: message(e) });
      return;
    }
    if (reply.toolCalls.length === 0) {
      conversation.push({ role: "assistant", content: reply.text });
      onEvent({ type: "done", reason: reply.finish === "" ? "stop" : reply.finish });
      return;
    }
    conversation.push({ role: "assistant", content: reply.text === "" ? undefined : reply.text, toolCalls: reply.toolCalls });
    for (const call of reply.toolCalls) {
      if (signal.aborted) {
        onEvent({ type: "done", reason: "stopped" });
        return;
      }
      const code = codeOf(call);
      onEvent({ type: "call", name: call.name, code });
      const outcome = runOne(opts.execute, call);
      if (outcome.ok) {
        const report = reportText(outcome.result);
        conversation.push({ role: "tool", content: report, toolCallId: call.id, toolName: call.name });
        onEvent({ type: "result", name: call.name, ok: true, note: noteOf(report), code, report });
      } else {
        const report = `error: ${outcome.error}`;
        conversation.push({ role: "tool", content: report, toolCallId: call.id, toolName: call.name });
        onEvent({ type: "result", name: call.name, ok: false, note: outcome.error, code, report });
      }
    }
  }
  onEvent({
    type: "failed",
    error: `The assistant asked to run tools ${MAX_ROUNDS} times without answering. Ask it to continue, or say what to do differently.`,
  });
}

/** The code a tool call wants run (empty when the call names no code). */
export function codeOf(call: ToolCall): string {
  const args = asRecord(call.args);
  return typeof args["code"] === "string" ? args["code"] : "";
}

/**
 * Run one tool call. There is one tool: `run`. A call to anything else is told so in one line;
 * a malformed call is a protocol error, and a failing run is a report the model reads.
 */
export function runOne(execute: RunExecutor, call: ToolCall): { ok: true; result: unknown } | { ok: false; error: string } {
  if (call.name !== RUN_TOOL) {
    return { ok: false, error: `\`${call.name}\` is not a tool here; there is one tool, \`${RUN_TOOL}\`, which runs AutoLISP in the drawing (call it with empty code for the manual).` };
  }
  const checked = checkRunArgs(call.args);
  if (typeof checked === "string") return { ok: false, error: checked };
  const env = execute(checked.code, checked.values);
  return env.ok ? { ok: true, result: env.result } : { ok: false, error: env.error };
}

/** Check a call's arguments: `{code?, values?}`; a string result is the error message. */
export function checkRunArgs(args: unknown): { code: string; values: Record<string, string> | null } | string {
  const object = args === null || args === undefined ? {} : asRecord(args);
  if (args !== null && args !== undefined && (typeof args !== "object" || Array.isArray(args))) {
    return `\`run\` takes an object of arguments, got ${JSON.stringify(args)}`;
  }
  const code = object["code"];
  if (code !== undefined && code !== null && typeof code !== "string") return "`run`'s `code` must be a string";
  const rawValues = object["values"];
  if (rawValues === undefined || rawValues === null) return { code: typeof code === "string" ? code : "", values: null };
  if (typeof rawValues !== "object" || Array.isArray(rawValues)) return "`run`'s `values` must be an object of name → text";
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawValues as Record<string, unknown>)) {
    values[k] = typeof v === "string" ? v : (JSON.stringify(v) ?? String(v));
  }
  return { code: typeof code === "string" ? code : "", values };
}

// ---- Inline text (the model's words, rendered) ----------------------------------------------------

/** One run of the model's text: plain, **bold**, or `code`. */
export interface InlinePart {
  kind: "text" | "bold" | "code";
  text: string;
}

const INLINE_RE = /`([^`]+)`|\*\*([^*]+)\*\*/g;

/**
 * Split one line of the model's text into plain, bold and code runs. Backticks win over bold
 * inside them; a marker that never closes stays literal. No HTML is produced: the pane maps the
 * parts to elements, so a model's words can never inject markup.
 */
/**
 * Split a reply into prose and fenced code: `[{ kind: "text", text }, { kind: "code", text }]`.
 * A fence opens on ``` (an optional language word on the same line is dropped) and closes on the
 * next ```; an unclosed fence runs to the end, useless to hide from the reader.
 */
export type ReplyPart = { kind: "text"; text: string } | { kind: "code"; text: string };

export function splitFences(text: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let rest = text;
  for (;;) {
    const open = rest.indexOf("```");
    if (open === -1) break;
    const before = rest.slice(0, open).replace(/\n+$/, "\n");
    if (before !== "" && before !== "\n") parts.push({ kind: "text", text: before });
    const from = open + 3;
    const nl = rest.indexOf("\n", from);
    const lang = (nl === -1 ? rest.slice(from) : rest.slice(from, nl)).trim();
    const bodyStart = nl !== -1 && /^[\w+#-]*$/.test(lang) ? nl + 1 : from;
    const close = rest.indexOf("```", bodyStart);
    const code = (close === -1 ? rest.slice(bodyStart) : rest.slice(bodyStart, close)).replace(/\n$/, "");
    if (code !== "") parts.push({ kind: "code", text: code });
    if (close === -1) { rest = ""; break; }
    rest = rest.slice(close + 3);
  }
  const tail = rest.replace(/^\n+/, "");
  if (tail !== "") parts.push({ kind: "text", text: tail });
  return parts;
}

/**
 * A turn's age, in the transcript's own words ("Just now", "2m ago", "1h ago", "3d ago"), the
 * measured timestamps' format (Cursor's turn actions row).
 */
export function relativeTime(then: number, now: number): string {
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 45) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const index = m.index ?? 0;
    if (index > last) parts.push({ kind: "text", text: text.slice(last, index) });
    if (m[1] !== undefined) parts.push({ kind: "code", text: m[1] });
    else parts.push({ kind: "bold", text: m[2] ?? "" });
    last = index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  if (parts.length === 0) parts.push({ kind: "text", text });
  return parts;
}

// ---- The request ----------------------------------------------------------------------------------

/** Send a conversation and stream the answer; `onText` sees each fragment as it arrives. */
export async function requestChat(
  provider: ProviderConfig,
  messages: readonly ChatMessage[],
  signal: AbortSignal,
  onText: (fragment: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<Reply> {
  const body: Record<string, unknown> = {
    model: provider.model.trim(),
    messages: wireMessages(messages),
    stream: true,
    tools: [runToolDefinition()],
    tool_choice: "auto",
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.apiKey.trim() !== "") headers["authorization"] = `Bearer ${provider.apiKey.trim()}`;
  let resp: Response;
  try {
    resp = await fetchImpl(providerEndpoint(provider.baseUrl), { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal.aborted) throw new Error("stopped");
    throw new Error(`${friendlyError(e)} (${providerEndpoint(provider.baseUrl)})`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(apiErrorText(resp.status, text));
  }
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("event-stream") || resp.body === null) {
    // A provider that ignored `stream: true` (or a proxy that buffered it) still answers with one
    // JSON object; read it as one.
    const text = await resp.text();
    return oneShot(text, onText);
  }
  const asm = new StreamAssembler();
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const feedLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return false;
    const payload = trimmed.slice("data:".length).trim();
    if (payload === "") return false;
    if (payload === "[DONE]") return true;
    const fragment = asm.feed(payload);
    if (fragment !== null) onText(fragment);
    return false;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (feedLine(line)) return asm.finishReply();
      idx = buffer.indexOf("\n");
    }
  }
  if (buffer !== "" && feedLine(buffer)) return asm.finishReply();
  return asm.finishReply();
}

/** A reply that arrived as one JSON object instead of a stream. */
export function oneShot(body: string, onText: (fragment: string) => void): Reply {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    throw new Error("the provider's reply is not JSON");
  }
  const root = asRecord(v);
  const err = root["error"];
  if (err !== undefined && err !== null) throw new Error(apiErrorText(200, JSON.stringify(err)));
  const choices = root["choices"];
  const choice = Array.isArray(choices) ? asRecord(choices[0]) : {};
  const msg = asRecord(choice["message"]);
  const content = typeof msg["content"] === "string" ? msg["content"] : "";
  if (content !== "") onText(content);
  const toolCalls: ToolCall[] = [];
  const calls = msg["tool_calls"];
  if (Array.isArray(calls)) {
    calls.forEach((raw, i) => {
      const call = asRecord(raw);
      const f = asRecord(call["function"]);
      const name = typeof f["name"] === "string" ? f["name"] : "";
      if (name === "") return;
      const id = typeof call["id"] === "string" ? call["id"] : `call_${i}`;
      toolCalls.push({ id, name, args: parseToolArgs(typeof f["arguments"] === "string" ? f["arguments"] : "") });
    });
  }
  const finish = typeof choice["finish_reason"] === "string" ? choice["finish_reason"] : "";
  return { text: content, toolCalls, finish };
}

/** The message a non-2xx answer carries, as the pane's own words. */
export function apiErrorText(status: number, body: string): string {
  const trimmed = body.trim();
  let detail = trimmed === "" ? "" : clip(trimmed, 400);
  try {
    const v = asRecord(JSON.parse(trimmed));
    const e = asRecord(v["error"]);
    const m = e["message"];
    if (typeof m === "string") detail = m;
  } catch {
    // not JSON; the clipped body stands
  }
  return detail === "" ? `the provider answered ${status}` : `the provider answered ${status}: ${detail}`;
}

/** A network failure in one line (the browser's own messages name the cause well enough). */
function friendlyError(e: unknown): string {
  const m = message(e);
  if (/Failed to fetch|NetworkError|load failed/i.test(m)) {
    return "the provider could not be reached (is the server running, and does it allow this page's origin?)";
  }
  return m;
}

// ---- Small helpers ----------------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
