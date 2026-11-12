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

/** The longest a setup's values may be: what is typed, what is stored and what is sent all keep to these. */
export const PROVIDER_LIMITS = { baseUrl: 2_048, model: 200, apiKey: 4_096 } as const;

/** What is wrong with a setup, as one word; the callers put it in their own sentences. */
export type ProviderFault = "no-url" | "long-url" | "scheme" | "credentials" | "long-key" | "odd-key" | "no-model" | "long-model";

/** The name and password an address carries before its host (`user:pass` of `https://user:pass@host`), or "". */
function userInfo(baseUrl: string): string {
  const authority = (baseUrl.trim().split("://")[1] ?? "").split(/[/?#]/)[0] ?? "";
  const at = authority.lastIndexOf("@");
  return at < 0 ? "" : authority.slice(0, at);
}

/**
 * The first thing wrong with a setup, or null when it can be sent: the one check the turn, the
 * connection check, the setup sheet and the stored setup all share. The address is http or https,
 * carries no name or password (a browser refuses to ask such an address, and its error would
 * quote them), and every value keeps to [`PROVIDER_LIMITS`]. A key is printable ASCII: anything
 * else cannot travel in a header.
 */
export function providerFault(provider: ProviderConfig): ProviderFault | null {
  const base = provider.baseUrl.trim();
  if (base === "") return "no-url";
  if (base.length > PROVIDER_LIMITS.baseUrl) return "long-url";
  if (!base.startsWith("http://") && !base.startsWith("https://")) return "scheme";
  if (((base.split("://")[1] ?? "").split(/[/?#]/)[0] ?? "").includes("@")) return "credentials";
  const key = provider.apiKey.trim();
  if (key.length > PROVIDER_LIMITS.apiKey) return "long-key";
  if (/[^\x21-\x7e]/.test(key)) return "odd-key";
  const model = provider.model.trim();
  if (model === "") return "no-model";
  if (model.length > PROVIDER_LIMITS.model) return "long-model";
  return null;
}

/** Whether the provider is configured enough to send; the message names what is missing. */
export function providerReady(provider: ProviderConfig): string | null {
  const fault = providerFault(provider);
  if (fault === null) return null;
  if (fault === "no-url") return "Set a base URL in the model setup.";
  if (fault === "long-url") return `The base URL is longer than ${PROVIDER_LIMITS.baseUrl} characters.`;
  if (fault === "scheme") return `The base URL must start with http:// or https://, not "${clip(provider.baseUrl.trim(), 80)}".`;
  if (fault === "credentials") return "The base URL must not carry a user name or a password. Put the key in the API key field.";
  if (fault === "long-key") return `The API key is longer than ${PROVIDER_LIMITS.apiKey} characters.`;
  if (fault === "odd-key") return "The API key has a space, a line break or another character a key cannot hold. Paste it again.";
  if (fault === "no-model") return "Set a model name in the model setup.";
  return `The model name is longer than ${PROVIDER_LIMITS.model} characters.`;
}

/** The preset a base URL belongs to, or the "Other" preset when it matches none. */
export function presetFor(baseUrl: string): ProviderPreset | undefined {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return PROVIDER_PRESETS.find((p) => p.baseUrl !== "" && p.baseUrl === base) ?? PROVIDER_PRESETS.find((p) => p.id === "custom");
}

/** Where a provider lists its models (`GET {base}/models`, the OpenAI shape). */
export function modelsEndpoint(baseUrl: string): string {
  const base = baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "");
  return `${base}/models`;
}

/** The connection check's answer when the server replied with something that is not a model list. */
const NOT_A_MODEL_LIST = "The provider answered, but not with a model list. Type the model's name and save.";

/** A reply that is not the chat protocol: the address usually points somewhere else. */
const UNREADABLE_REPLY = "The provider's reply could not be read. The base URL may not point to an OpenAI-compatible server.";

/** A tool call the model sent broken (no name, or arguments that do not parse): the turn fails. */
const UNREADABLE_CALL = "The model asked to run code, but its request could not be read. Ask again, or try another model.";

/** The most model names a provider's list contributes (some hosts list thousands). */
export const MAX_LISTED_MODELS = 200;

/** How long the connection check waits for the model list, and a turn for the next piece of a reply. */
export const CHECK_TIMEOUT_MS = 20_000;
export const REPLY_IDLE_MS = 120_000;

/** The bounds on what a provider may send. Past one, the request is stopped and the reason said. */
export const MAX_REPLY_CHARS = 200_000;
export const MAX_CALLS_PER_REPLY = 32;
export const MAX_CALL_ARGS_CHARS = 100_000;
export const MAX_CALL_NAME_CHARS = 64;
export const MAX_STREAM_CHARS = 4_000_000;
export const MAX_MODEL_LIST_CHARS = 8_000_000;
const MAX_ERROR_BODY_CHARS = 16_000;

const count = (n: number): string => n.toLocaleString("en-US");

/** A reply that passed [`MAX_REPLY_CHARS`]: what arrived stays, and the reader is told where it ends. */
const REPLY_CUT = `The reply passed ${count(MAX_REPLY_CHARS)} characters and was stopped there. Ask for a shorter answer.`;

/** An answer past [`MAX_STREAM_CHARS`] that never became a reply. */
const REPLY_TOO_LARGE = "The provider sent more than can be read, so the request was stopped. The base URL may not point to an OpenAI-compatible server.";

/** More tool calls in one reply than [`MAX_CALLS_PER_REPLY`]: none of them is run. */
const TOO_MANY_CALLS = `The model asked to run code more than ${MAX_CALLS_PER_REPLY} times in one reply, so none of it was run. Ask for the work in smaller steps.`;

/** One tool call past [`MAX_CALL_ARGS_CHARS`]: it is not run. */
const CALL_TOO_LARGE = `The model sent more than ${count(MAX_CALL_ARGS_CHARS)} characters of code in one request, so it was not run. Ask for the work in smaller steps.`;

/** A model list past [`MAX_MODEL_LIST_CHARS`]. */
const LIST_TOO_LARGE = "The provider's model list is too large to read. Type the model's name and save.";

const silentText = (ms: number): string => {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `The provider sent nothing for ${seconds === 1 ? "1 second" : `${seconds} seconds`}, so the request was stopped. Check that the server is running, then ask again.`;
};

/**
 * How a connection check ended. `reached` and `no-list` are answers from the server (the second
 * without model names to pick from); the rest are failures: an address that cannot be asked
 * (`invalid`), a server that did not answer (`unreachable`), a key it turned down (`refused`),
 * and any other error it reported (`failed`).
 */
export type ConnectionState = "reached" | "no-list" | "refused" | "unreachable" | "invalid" | "failed";

/** What the setup shows after a check: which state it is, and the sentence that says so. */
export interface ConnectionNote {
  state: ConnectionState;
  text: string;
}

/** A connection check that failed, with the state it failed in. */
export class ConnectionError extends Error {
  readonly state: ConnectionState;
  constructor(state: ConnectionState, message: string) {
    super(message);
    this.name = "ConnectionError";
    this.state = state;
  }
}

/** A provider's message with the reader's key taken out of it (some providers quote the key back). */
export function withoutKey(text: string, apiKey: string): string {
  const key = apiKey.trim();
  return key === "" ? text : text.split(key).join("(your key)");
}

/** A name and password before a host, in any address: `https://user:pass@host` reads `https://host`. */
const URL_CREDENTIALS_RE = /([a-z][a-z0-9+.-]*:\/\/)[^/\s?#@"'<>]*@/gi;

/**
 * The one place every message about a provider passes before a person reads it (the transcript's
 * failure rows, the setup sheet's status): the key becomes "(your key)", and a name and password
 * in an address (the base URL's own, or any other) are taken out. `listModels` and `runTurn` call
 * it on everything they report, so no path of theirs can show a secret.
 */
export function redact(text: string, provider: ProviderConfig): string {
  let out = withoutKey(text, provider.apiKey);
  const info = userInfo(provider.baseUrl);
  if (info !== "") {
    out = out.split(`${info}@`).join("");
    const password = info.includes(":") ? info.slice(info.indexOf(":") + 1) : "";
    if (password !== "") out = out.split(password).join("(your password)");
  }
  return out.replace(URL_CREDENTIALS_RE, "$1");
}

/**
 * The note for a check the server answered: how many models it lists, and whether the typed one is
 * there. `total` is how many the provider listed in all, when that is more than the `ids` kept
 * ([`MAX_LISTED_MODELS`]): the note then says "the first 200 of 1,340", and a typed name that is
 * not among them is not said to be missing from the provider.
 */
export function reachedNote(ids: readonly string[], model: string, total: number = ids.length): ConnectionNote {
  if (ids.length === 0) return { state: "no-list", text: "Connected. The provider lists no models. Type the model's name." };
  const name = model.trim();
  if (total > ids.length) {
    const first = `The first ${count(ids.length)} of ${count(total)} models`;
    if (name === "") return { state: "reached", text: `Connected. ${first}.` };
    if (ids.includes(name)) return { state: "reached", text: `Connected. ${first}, including ${name}.` };
    return { state: "reached", text: `Connected. ${first}; ${name} is not among them. Pick one from the list, or keep the name you typed.` };
  }
  const listed = ids.length === 1 ? "1 model" : `${ids.length} models`;
  if (name === "") return { state: "reached", text: `Connected. ${listed}.` };
  if (ids.includes(name)) return { state: "reached", text: `Connected. ${listed}, including ${name}.` };
  return { state: "reached", text: `Connected. ${listed}, but not ${name}. Pick one from the list, or keep the name you typed.` };
}

/** The note for a check that threw: the error's own state and words, as a sentence. */
export function failedNote(e: unknown): ConnectionNote {
  const text = message(e);
  return { state: e instanceof ConnectionError ? e.state : "failed", text: text.charAt(0).toUpperCase() + text.slice(1) };
}

/**
 * Why a setup cannot be saved yet, in the sheet's own words, or null when it can. A hosted preset
 * (`needsKey`) is not saved without its key: every request would be refused. `listed` is how many
 * models the last check found, so the sentence can point at the list.
 */
export function saveBlocker(provider: ProviderConfig, needsKey: boolean, listed: number): string | null {
  // The address and the key are judged first, as the sheet lists them; the model is the last field.
  const fault = providerFault({ ...provider, model: "any" }) ?? (needsKey && provider.apiKey.trim() === "" ? "no-key" : providerFault(provider));
  if (fault === null) return null;
  if (fault === "no-url") return "To save, choose a provider or type a base URL.";
  if (fault === "long-url") return `To save, shorten the base URL to ${PROVIDER_LIMITS.baseUrl} characters or fewer.`;
  if (fault === "scheme") return "To save, start the base URL with http:// or https://.";
  if (fault === "credentials") return "To save, take the user name and password out of the base URL. The key goes in the API key field.";
  if (fault === "long-key") return `To save, shorten the API key to ${PROVIDER_LIMITS.apiKey} characters or fewer.`;
  if (fault === "odd-key") return "To save, paste the API key again: it has a space, a line break or another character a key cannot hold.";
  if (fault === "no-key") return "To save, add the API key this provider needs.";
  if (fault === "no-model") return listed > 0 ? "To save, pick a model from the list or type its name." : "To save, type a model name.";
  return `To save, shorten the model name to ${PROVIDER_LIMITS.model} characters or fewer.`;
}

/** What a provider's model list held: the names kept (at most [`MAX_LISTED_MODELS`]) and how many it listed in all. */
export interface ModelListing {
  ids: string[];
  total: number;
}

/**
 * Ask the provider which models it serves: the setup's connection check. Resolves with the model
 * ids (possibly none: some servers answer the route with an empty list) and how many the provider
 * listed in all; rejects with a message in the sheet's own words when the server cannot be
 * reached, does not answer in `timeoutMs`, refuses the key, or answers with something that is not
 * a model list. Every message it rejects with has passed [`redact`].
 */
export async function listProviderModels(provider: ProviderConfig, signal: AbortSignal, fetchImpl: typeof fetch = fetch, timeoutMs: number = CHECK_TIMEOUT_MS): Promise<ModelListing> {
  try {
    const listing = await askModels(provider, signal, fetchImpl, timeoutMs);
    // A name that holds the key is not a name to show.
    const ids = listing.ids.filter((id) => redact(id, provider) === id);
    return { ids, total: Math.max(ids.length, listing.total - (listing.ids.length - ids.length)) };
  } catch (e) {
    if (signal.aborted) throw new Error("stopped");
    throw new ConnectionError(e instanceof ConnectionError ? e.state : "failed", redact(message(e), provider));
  }
}

/** The names of [`listProviderModels`], without the count. */
export async function listModels(provider: ProviderConfig, signal: AbortSignal, fetchImpl: typeof fetch = fetch, timeoutMs: number = CHECK_TIMEOUT_MS): Promise<string[]> {
  return (await listProviderModels(provider, signal, fetchImpl, timeoutMs)).ids;
}

async function askModels(provider: ProviderConfig, signal: AbortSignal, fetchImpl: typeof fetch, timeoutMs: number): Promise<ModelListing> {
  const missing = providerReady({ ...provider, model: provider.model.trim() === "" ? "any" : provider.model });
  if (missing !== null) throw new ConnectionError("invalid", missing);
  const url = modelsEndpoint(provider.baseUrl);
  const headers: Record<string, string> = {};
  if (provider.apiKey.trim() !== "") headers["authorization"] = `Bearer ${provider.apiKey.trim()}`;
  const watch = watchRequest(signal, timeoutMs);
  try {
    let resp: Response;
    try {
      resp = await watch.race(fetchImpl(url, { method: "GET", headers, signal: watch.signal }));
    } catch (e) {
      throw new ConnectionError("unreachable", e instanceof SilentError ? e.message : unreachableText(e, url));
    }
    if (!resp.ok) {
      const refused = resp.status === 401 || resp.status === 403;
      const body = await readCapped(resp, MAX_ERROR_BODY_CHARS, watch).catch(() => ({ text: "", clipped: false }));
      throw new ConnectionError(refused ? "refused" : "failed", apiErrorText(resp.status, body.text, "sheet"));
    }
    let listing: { text: string; clipped: boolean };
    try {
      listing = await readCapped(resp, MAX_MODEL_LIST_CHARS, watch);
    } catch (e) {
      throw new ConnectionError("unreachable", e instanceof SilentError ? e.message : unreachableText(e, url));
    }
    if (listing.clipped) throw new ConnectionError("no-list", LIST_TOO_LARGE);
    let body: unknown;
    try {
      body = JSON.parse(listing.text);
    } catch {
      throw new ConnectionError("no-list", NOT_A_MODEL_LIST);
    }
    const root = asRecord(body);
    const rows = Array.isArray(root["data"]) ? root["data"] : Array.isArray(root["models"]) ? root["models"] : Array.isArray(body) ? body : null;
    if (rows === null) throw new ConnectionError("no-list", NOT_A_MODEL_LIST);
    const ids = modelIds(rows);
    // A full list may be the first of many more: the whole list is counted once, for the note.
    return { ids, total: ids.length < MAX_LISTED_MODELS ? ids.length : modelIds(rows, Number.POSITIVE_INFINITY).length };
  } finally {
    watch.done();
  }
}

/**
 * The model names in a provider's list: at most `limit` ([`MAX_LISTED_MODELS`]), each once. A row that is
 * not a name is skipped, and so is a name no model field could hold (longer than the limit, or
 * with a line break or another control character in it). Markup in a name is only text: the
 * sheet never renders HTML.
 */
export function modelIds(rows: readonly unknown[], limit: number = MAX_LISTED_MODELS): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.size >= limit) break;
    const r = asRecord(row);
    const raw = typeof row === "string" ? row : typeof r["id"] === "string" ? r["id"] : typeof r["name"] === "string" ? r["name"] : "";
    const id = raw.trim();
    if (id === "" || id.length > PROVIDER_LIMITS.model || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(id)) continue;
    ids.add(id);
  }
  return [...ids];
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
/**
 * The longest message a person may send: half the request's budget, so one message can never
 * crowd everything said before it out of what the model is sent. A longer draft is not sent and
 * not cut: the panel says by how much it is over.
 */
export const MAX_MESSAGE_CHARS = MAX_REQUEST_CHARS / 2;

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
  /** The text passed [`MAX_REPLY_CHARS`] and ends there; what the model asked to run is dropped. */
  clipped?: boolean;
}

/** The OpenAI SSE stream, accumulated: text deltas pass through, tool-call fragments join by index. */
export class StreamAssembler {
  private text = "";
  private calls = new Map<number, PartialCall>();
  private finish = "";
  private clipped = false;

  /** The text reached [`MAX_REPLY_CHARS`]: nothing more is read. */
  get full(): boolean {
    return this.clipped;
  }

  /**
   * Read one `data:` payload; returns a text fragment when the payload carried one. Throws on a
   * payload that is not the protocol, an error the provider reports, more than
   * [`MAX_CALLS_PER_REPLY`] tool calls, or one call past [`MAX_CALL_ARGS_CHARS`].
   */
  feed(payload: string): string | null {
    let v: unknown;
    try {
      v = JSON.parse(payload);
    } catch {
      throw new Error(UNREADABLE_REPLY);
    }
    const root = asRecord(v);
    const err = root["error"];
    if (err !== undefined && err !== null) throw new Error(apiErrorText(200, JSON.stringify({ error: err })));
    const choices = root["choices"];
    const choice = Array.isArray(choices) ? asRecord(choices[0]) : {};
    const reason = choice["finish_reason"];
    if (typeof reason === "string") this.finish = reason;
    const part = asRecord(choice["delta"] ?? choice["message"]);
    let fragment: string | null = null;
    const content = part["content"];
    if (typeof content === "string" && content !== "") {
      const room = MAX_REPLY_CHARS - this.text.length;
      const kept = content.length > room ? content.slice(0, room) : content;
      if (kept.length < content.length) this.clipped = true;
      this.text += kept;
      if (kept !== "") fragment = kept;
    }
    const calls = part["tool_calls"];
    if (Array.isArray(calls)) {
      for (const raw of calls) {
        const call = asRecord(raw);
        const index = typeof call["index"] === "number" ? call["index"] : 0;
        let entry = this.calls.get(index);
        if (entry === undefined) {
          if (this.calls.size >= MAX_CALLS_PER_REPLY) throw new Error(TOO_MANY_CALLS);
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
        checkCallSize(entry.id, entry.name, entry.args);
      }
    }
    return fragment;
  }

  /** The assembled reply. */
  finishReply(): Reply {
    if (this.clipped) return { text: this.text, toolCalls: [], finish: "length", clipped: true };
    const toolCalls: ToolCall[] = [];
    for (const [index, p] of [...this.calls.entries()].sort((a, b) => a[0] - b[0])) {
      if (p.name === "") throw new Error(UNREADABLE_CALL);
      toolCalls.push({ id: p.id === "" ? `call_${index}` : p.id, name: p.name, args: parseToolArgs(p.args) });
    }
    return { text: this.text, toolCalls, finish: this.finish };
  }
}

/** One tool call's bounds: a name or an id no real call has is unreadable; too much code is said so. */
function checkCallSize(id: string, name: string, args: string): void {
  if (name.length > MAX_CALL_NAME_CHARS || id.length > PROVIDER_LIMITS.model) throw new Error(UNREADABLE_CALL);
  if (args.length > MAX_CALL_ARGS_CHARS) throw new Error(CALL_TOO_LARGE);
}

/** A tool call's arguments: empty means `{}`; malformed JSON is an error, not a crash. */
export function parseToolArgs(raw: string): unknown {
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(UNREADABLE_CALL);
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
  /** How long a request may stay silent before it is stopped; [`REPLY_IDLE_MS`] when left out. */
  idleMs?: number;
}

/**
 * Run one turn to completion: ask the model, run what it asks for, feed the results back, repeat.
 * Every failure it reports has passed [`redact`].
 */
export async function runTurn(opts: TurnOptions): Promise<void> {
  const { provider, conversation, signal } = opts;
  const onEvent = (event: AssistantEvent): void => opts.onEvent(event.type === "failed" ? { type: "failed", error: redact(event.error, provider) } : event);
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
      reply = await requestChat(provider, sent, signal, (t) => onEvent({ type: "text", text: t }), opts.fetchImpl, opts.idleMs);
    } catch (e) {
      if (signal.aborted) {
        onEvent({ type: "done", reason: "stopped" });
        return;
      }
      onEvent({ type: "failed", error: message(e) });
      return;
    }
    if (reply.clipped === true) {
      conversation.push({ role: "assistant", content: reply.text });
      onEvent({ type: "failed", error: REPLY_CUT });
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
    error: `The assistant ran code ${MAX_ROUNDS} times in a row without answering, so it was stopped. Ask it to continue, or say what to do differently.`,
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

/** One run of the model's text: plain, **bold**, `code`, or a link to an http or https address. */
export interface InlinePart {
  kind: "text" | "bold" | "code" | "link";
  text: string;
  /** A link's address, exactly as [`safeHref`] passed it: an http or https one. Absent on every other run. */
  href?: string;
}

/** The longest address a link may carry, and the longest label a `[label](address)` link may show. */
export const MAX_HREF_CHARS = 2_048;
const MAX_LINK_LABEL_CHARS = 200;

/** `code`, **bold**, `[label](address)`, or a bare http or https address, in that order of precedence. */
const INLINE_RE = new RegExp(
  ["`([^`]+)`", "\\*\\*([^*]+)\\*\\*", `\\[([^\\]\\n]{1,${MAX_LINK_LABEL_CHARS}})\\]\\(([^()\\s]{1,${MAX_HREF_CHARS}})\\)`, `\\bhttps?://[^\\s<>"\`]{1,${MAX_HREF_CHARS}}`].join("|"),
  "gi",
);

/** An address a link may open: `http://` or `https://`, then a host with no name or password before it, then anything printable. */
const HREF_RE = /^https?:\/\/[^\s/?#@\\]+(?:[/?#][^\s\\]*)?$/i;

/**
 * The address a link in a reply may open, or null when what the model wrote must stay text. Only
 * an absolute http or https address passes: `javascript:`, `data:`, `vbscript:`, `file:`, a
 * scheme-relative `//host`, a path, an address with a name or a password before its host (the
 * reader would see one site's name and open another), one holding a backslash, a space, a
 * control character or a mark that turns the direction of the text (it would draw the address
 * other than it is), and one past [`MAX_HREF_CHARS`] do not. The address is returned as written
 * and never parsed, so this never throws.
 */
export function safeHref(candidate: string): string | null {
  if (candidate.length > MAX_HREF_CHARS || /[\u0000-\u0020\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/.test(candidate)) return null;
  return HREF_RE.test(candidate) ? candidate : null;
}

/** A bare address as the sentence around it meant it: without the stop, the comma or the closing bracket that follows it. */
function bareAddress(raw: string): string {
  let opened = 0;
  let closed = 0;
  for (const ch of raw) {
    if (ch === "(") opened += 1;
    else if (ch === ")") closed += 1;
  }
  let end = raw.length;
  for (; end > 0; end--) {
    const last = raw[end - 1] ?? "";
    // A closing bracket belongs to the address only when the address opened it.
    if (last === ")" && closed > opened) closed -= 1;
    else if (!".,;:!?'*_]}>".includes(last)) break;
  }
  return raw.slice(0, end);
}

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

// ---- What a tool call did, as a sentence a drafter reads -------------------------------------------
//
// The model writes AutoLISP (`RUN_DESCRIPTION`): `(cmd "id" '((KEY . value) …))` runs a command
// with an alist of parameters, `(cmdline "id" "answer" …)` types at the command line, and
// `(commands)`, `(describe "id")`, `(inspect)`, `(kept)`, `(forget "NAME")`, `(render)`,
// `(defun NAME …)` and `(setq NAME …)` are the namespace around them. The report is the value of
// the last form after `=> `, as an alist with upper-case keys (`((HANDLE . "12E"))`,
// `((MOVED . 3))`, `((DISTANCE . 5.0) …)`), or `error: …`. A tool row says that in words: the
// command's name and its telling arguments, and a note for what the result changed. The code and
// the report themselves stay in the row's opened detail.

/** One read value: a number, a text (`{ s }`), a symbol (upper case), or a list. A quote is dropped. */
type Sx = number | string | { s: string } | Sx[];

const isText = (x: Sx | undefined): x is { s: string } => typeof x === "object" && !Array.isArray(x);
const isList = (x: Sx | undefined): x is Sx[] => Array.isArray(x);

/** How much of a program or a report the reader looks at, and how deep: past these it stops. */
const MAX_READ_CHARS = 20_000;
const MAX_READ_NODES = 4_000;
const MAX_READ_DEPTH = 64;

/**
 * Read Lisp text into its top-level forms. Strict (`partial` false: a program), anything that is
 * not whole is null: an unclosed list or text, a stray `)`, more than the reader's bounds. Partial
 * (a report, which may be very long), it returns what it read up to the first of those. Never throws.
 */
function readForms(text: string, partial: boolean): Sx[] | null {
  if (!partial && text.length > MAX_READ_CHARS) return null;
  const end = Math.min(text.length, MAX_READ_CHARS);
  const root: Sx[] = [];
  const stack: Sx[][] = [root];
  let nodes = 0;
  let i = 0;
  while (i < end) {
    const c = text.charAt(i);
    if (c === "'" || /\s/.test(c)) {
      i++;
      continue;
    }
    if (c === ";") {
      while (i < end && text.charAt(i) !== "\n") i++;
      continue;
    }
    const top = stack[stack.length - 1] ?? root;
    if (c === ")") {
      if (stack.length === 1) {
        if (!partial) return null;
      } else stack.pop();
      i++;
      continue;
    }
    if (++nodes > MAX_READ_NODES || stack.length > MAX_READ_DEPTH) return partial ? root : null;
    if (c === "(") {
      const list: Sx[] = [];
      top.push(list);
      stack.push(list);
      i++;
      continue;
    }
    if (c === '"') {
      let s = "";
      let closed = false;
      i++;
      while (i < end) {
        const d = text.charAt(i);
        if (d === "\\") {
          const e = text.charAt(i + 1);
          s += e === "n" ? "\n" : e === "t" ? "\t" : e;
          i += 2;
          continue;
        }
        i++;
        if (d === '"') {
          closed = true;
          break;
        }
        s += d;
      }
      if (!closed && !partial) return null;
      top.push({ s });
      continue;
    }
    let j = i;
    while (j < end && !/[\s()'";]/.test(text.charAt(j))) j++;
    const word = text.slice(i, j);
    i = j;
    top.push(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(word) ? Number(word) : word.toUpperCase());
  }
  return stack.length > 1 && !partial ? null : root;
}

/** `(quote x)` is `x` (the reader already drops the `'` form). */
const unquote = (x: Sx | undefined): Sx | undefined => (isList(x) && x.length === 2 && x[0] === "QUOTE" ? x[1] : x);

/** An alist's pairs: `(KEY . value)` and `(KEY a b …)` (the same thing in Lisp) both give `[KEY, value]`. */
function pairsOf(x: Sx | undefined): [string, Sx][] {
  const list = unquote(x);
  if (!isList(list)) return [];
  const out: [string, Sx][] = [];
  for (const item of list) {
    if (!isList(item)) continue;
    const key = item[0];
    if (typeof key !== "string") continue;
    const rest = item.slice(1);
    const dotted = rest[0] === ".";
    const value = dotted ? rest.slice(1) : rest;
    out.push([key, dotted && value.length === 1 ? (unquote(value[0]) ?? []) : value]);
  }
  return out;
}

const valueOf = (pairs: readonly [string, Sx][], key: string): Sx | undefined => pairs.find(([k]) => k === key)?.[1];

/** A pair's value as one number: `5`, or the `(5)` an undotted pair reads as. */
function numberOf(pairs: readonly [string, Sx][], key: string): number | null {
  const v = valueOf(pairs, key);
  const x = isList(v) && v.length === 1 ? v[0] : v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/** A pair's value as one text. */
function textOf(pairs: readonly [string, Sx][], key: string): string | null {
  const v = valueOf(pairs, key);
  const x = isList(v) && v.length === 1 ? v[0] : v;
  return isText(x) && x.s.trim() !== "" ? oneLine(x.s) : null;
}

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The longest one argument and one whole sentence may run before they are cut with an ellipsis. */
const MAX_ARG_CHARS = 32;
const MAX_SENTENCE_CHARS = 140;
/** How many arguments a sentence names, and how many commands a list of them names. */
const MAX_ARGS = 3;
const MAX_NAMES = 4;

/**
 * A number as the status bar writes one: plain decimals, at most four of them, no trailing zeros,
 * no exponent, no "-0". One too large to write that way says so instead of printing its digits.
 */
export function shortNumber(x: number): string {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e15) return "a very large number";
  const fixed = x.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return fixed === "-0" ? "0" : fixed;
}

const objects = (n: number): string => (n === 1 ? "1 object" : `${count(n)} objects`);

const isPoint = (x: Sx | undefined): x is number[] => isList(x) && x.length >= 2 && x.length <= 3 && x.every((n) => typeof n === "number");
const pointText = (p: readonly number[]): string => p.map(shortNumber).join(", ");

/** One parameter as a few words: "radius 0.6", "center 3, 2.5", "3 objects", "points 0, 0 to 10, 0". */
function argText(key: string, v: Sx): string {
  const name = key.toLowerCase().replace(/[_-]+/g, " ");
  if (typeof v === "number") return `${name} ${shortNumber(v)}`;
  if (isText(v)) return key === "HANDLE" ? objects(1) : `${name} ${clip(oneLine(v.s), MAX_ARG_CHARS)}`;
  if (typeof v === "string") return v === "T" ? name : v === "NIL" ? `no ${name}` : `${name} ${clip(v.toLowerCase(), MAX_ARG_CHARS)}`;
  if (v.length === 0) return `no ${name}`;
  if (v.length === 1 && (typeof v[0] === "number" || (isText(v[0]) && key !== "HANDLES"))) return argText(key, v[0]);
  if (isPoint(v)) return `${name} ${pointText(v)}`;
  if (v.every((n) => typeof n === "number")) return `${name} ${count(v.length)} values`;
  if (v.every(isText)) return key === "HANDLES" ? objects(v.length) : `${name} ${count(v.length)} items`;
  if (v.every(isPoint)) return v.length === 2 ? `${name} ${pointText(v[0] ?? [])} to ${pointText(v[1] ?? [])}` : `${count(v.length)} ${name}`;
  return `${name} …`;
}

/** The telling arguments of a command: the first few, each a few words, then an ellipsis for the rest. */
function argTexts(params: readonly [string, Sx][], skip: readonly string[] = []): string[] {
  const told = params.filter(([k]) => !skip.includes(k));
  const out = told.slice(0, MAX_ARGS).map(([k, v]) => argText(k, v));
  if (told.length > MAX_ARGS) out.push("…");
  return out;
}

/** Whether a sentence says what was done, or what is being done now (the run row's status). */
export type ActivityTense = "past" | "present";

/** Each verb in both tenses. */
const VERBS = {
  ran: ["Ran", "Running"],
  typed: ["Typed", "Typing"],
  selected: ["Selected", "Selecting"],
  cleared: ["Cleared", "Clearing"],
  set: ["Set", "Setting"],
  added: ["Added", "Adding"],
  deleted: ["Deleted", "Deleting"],
  changed: ["Changed", "Changing"],
  measured: ["Measured", "Measuring"],
  read: ["Read", "Reading"],
  looked: ["Looked up", "Looking up"],
  listed: ["Listed", "Listing"],
  inspected: ["Inspected", "Inspecting"],
  defined: ["Defined", "Defining"],
  forgot: ["Forgot", "Forgetting"],
  rendered: ["Rendered", "Rendering"],
} as const satisfies Record<string, readonly [string, string]>;

type Verb = keyof typeof VERBS;

/** One thing a program does. */
interface Step {
  verb: Verb;
  /** A command's name, set in the mono face after the verb ("CIRCLE"). */
  name?: string;
  /** Plain words after the verb (and the name). */
  words?: string;
  /** The telling arguments, each after a middle dot. */
  args: string[];
  /** It only reads (the drawing, the command list): never the telling step beside one that acts. */
  reads: boolean;
  /** It acts, but not on the drawing's objects (a selection, a measurement, the view): no word about change. */
  quiet: boolean;
}

/** The commands that act without changing the drawing's objects. */
const QUIET_COMMANDS: readonly string[] = ["select", "qselect", "selectall", "selectsimilar", "ai_deselect", "dist", "area", "id", "list", "zoom", "pan", "regen", "redraw", "view"];

const upper = (id: string): string => clip(oneLine(id), MAX_ARG_CHARS).toUpperCase();

/** One `(cmd "id" params)`, in words. `result` is the report's alist when this command produced it. */
function commandStep(id: string, params: readonly [string, Sx][], result: readonly [string, Sx][] | null): Step {
  const key = id.trim().toLowerCase();
  const quiet = QUIET_COMMANDS.includes(key);
  const layer = textOf(params, "LAYER");
  const name = textOf(params, "NAME");
  if (key === "ai_deselect" || (key === "select" && valueOf(params, "CLEAR") === "T")) return { verb: "cleared", words: "the selection", args: [], reads: false, quiet: true };
  if (key === "select" || key === "qselect" || key === "selectall" || key === "selectsimilar") {
    const handles = valueOf(params, "HANDLES");
    const n = (result === null ? null : numberOf(result, "SELECTED")) ?? (key === "select" && isList(handles) && handles.length > 0 ? handles.length : null);
    const type = textOf(params, "TYPE");
    const what = n !== null ? objects(n) : key === "selectall" ? "all objects" : "objects";
    return { verb: "selected", words: `${what}${type === null ? "" : ` of type ${clip(type, MAX_ARG_CHARS)}`}${layer === null ? "" : ` on layer ${clip(layer, MAX_ARG_CHARS)}`}`, args: [], reads: false, quiet: true };
  }
  if (key === "dist") {
    const d = result === null ? null : numberOf(result, "DISTANCE");
    return { verb: "measured", words: d === null ? "a distance" : `distance ${shortNumber(d)}`, args: [], reads: false, quiet: true };
  }
  if (key === "describe") return { verb: "measured", words: "the drawing", args: [], reads: true, quiet: true };
  if (key === "entities") {
    const n = result === null ? null : numberOf(result, "COUNT");
    return { verb: "read", words: n === null ? "the objects" : objects(n), args: argTexts(params), reads: true, quiet: true };
  }
  if (name !== null && key.startsWith("layer.")) {
    const which = `layer ${clip(name, MAX_ARG_CHARS)}`;
    if (key === "layer.current") return { verb: "set", words: `${which} current`, args: [], reads: false, quiet: false };
    if (key === "layer.new") return { verb: "added", words: which, args: argTexts(params, ["NAME"]), reads: false, quiet: false };
    if (key === "layer.delete") return { verb: "deleted", words: which, args: [], reads: false, quiet: false };
    if (key === "layer.set") return { verb: "changed", words: which, args: argTexts(params, ["NAME"]), reads: false, quiet: false };
  }
  return { verb: "ran", name: upper(id), args: argTexts(params), reads: false, quiet };
}

/** The steps of one form: what it is when the namespace names it, else what the forms inside it are. */
function stepsOf(form: Sx | undefined, result: readonly [string, Sx][] | null, out: Step[], depth: number): void {
  const f = unquote(form);
  if (!isList(f) || depth > MAX_READ_DEPTH) return;
  const head = f[0];
  const first = f[1];
  const said = isText(first) ? oneLine(first.s) : null;
  const plain = (verb: Verb, words: string, reads: boolean): void => void out.push({ verb, words, args: [], reads, quiet: true });
  if (head === "CMD" && said !== null) out.push(commandStep(said, pairsOf(f[2]), result));
  else if (head === "CMDLINE" && said !== null) {
    const answers = f.slice(2).map((a) => (isText(a) ? clip(oneLine(a.s), MAX_ARG_CHARS) : typeof a === "number" ? shortNumber(a) : "…"));
    out.push({ verb: "typed", name: upper(said), args: answers.filter((a) => a !== "").slice(0, MAX_ARGS).concat(answers.length > MAX_ARGS ? ["…"] : []), reads: false, quiet: QUIET_COMMANDS.includes(said.toLowerCase()) });
  } else if (head === "COMMANDS") plain(said === null ? "listed" : "looked", said === null ? "the commands" : `the commands matching “${clip(said, MAX_ARG_CHARS)}”`, true);
  else if (head === "DESCRIBE" && said !== null) out.push({ verb: "looked", name: upper(said), args: [], reads: true, quiet: true });
  else if (head === "INSPECT") plain("inspected", "the drawing", true);
  else if (head === "KEPT") plain("listed", "the kept helpers", true);
  else if (head === "VALUES") plain("listed", "the named values", true);
  else if (head === "MAN") plain("read", "the manual", true);
  else if (head === "FORGET" && said !== null) plain("forgot", `the helper ${upper(said)}`, false);
  else if (head === "RENDER") plain("rendered", "the drawing", false);
  else if (head === "DEFUN" && typeof first === "string") plain("defined", `the helper ${clip(first, MAX_ARG_CHARS)}`, false);
  // Anything else is glue around the calls inside it (`setq`, `progn`, `cdr`, a loop): they are the steps.
  else for (const inner of f) stepsOf(inner, null, out, depth + 1);
}

/** The report's value as an alist: what follows `=> ` (`reportText`), or nothing. */
function resultPairs(report: string): [string, Sx][] {
  const at = report.startsWith("=> ") ? 0 : report.indexOf("\n=> ");
  if (at < 0) return [];
  return pairsOf((readForms(report.slice(at + (at === 0 ? 3 : 4)), true) ?? [])[0]);
}

/** A program as its steps, or null when it cannot be read. `single` is the result's alist when one command, alone, produced it. */
function readProgram(code: string, report: string): { steps: Step[]; forms: number; single: [string, Sx][] | null } | null {
  const forms = readForms(code, false);
  if (forms === null) return null;
  const last = unquote(forms[forms.length - 1]);
  const direct = report !== "" && isList(last) && last[0] === "CMD";
  const result = direct ? resultPairs(report) : null;
  const steps: Step[] = [];
  forms.forEach((form, i) => stepsOf(form, i === forms.length - 1 ? result : null, steps, 0));
  return { steps, forms: forms.length, single: direct && steps.length === 1 ? result : null };
}

const stepParts = (step: Step, tense: ActivityTense): InlinePart[] => {
  const parts: InlinePart[] = [{ kind: "text", text: VERBS[step.verb][tense === "past" ? 0 : 1] }];
  if (step.name !== undefined) parts.push({ kind: "text", text: " " }, { kind: "code", text: step.name });
  const tail = `${step.words === undefined ? "" : ` ${step.words}`}${step.args.map((a) => ` · ${a}`).join("")}`;
  if (tail !== "") parts.push({ kind: "text", text: tail });
  return parts;
};

/** A step as the few words a list of steps names it by. */
const stepName = (step: Step): InlinePart => (step.name !== undefined ? { kind: "code", text: step.name } : { kind: "text", text: `${VERBS[step.verb][0].toLowerCase()} ${step.words ?? ""}`.trim() });

/** The verb, the code's first line, clipped, and how many more follow: what a program that cannot be read shows. */
function codeFallback(code: string, tense: ActivityTense): InlinePart[] {
  const lines = code
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const parts: InlinePart[] = [
    { kind: "text", text: `${VERBS.ran[tense === "past" ? 0 : 1]} ` },
    { kind: "code", text: clip(lines[0] ?? "", MAX_SENTENCE_CHARS - 24) },
  ];
  if (lines.length > 1) parts.push({ kind: "text", text: ` +${count(lines.length - 1)} ${lines.length === 2 ? "line" : "lines"}` });
  return parts;
}

/** Cut a sentence's parts at [`MAX_SENTENCE_CHARS`], with an ellipsis where it was cut. */
function clipParts(parts: readonly InlinePart[]): InlinePart[] {
  const out: InlinePart[] = [];
  let room = MAX_SENTENCE_CHARS;
  for (const part of parts) {
    const size = [...part.text].length;
    if (size <= room) {
      out.push(part);
      room -= size;
      continue;
    }
    out.push({ kind: part.kind, text: clip(part.text, Math.max(0, room)) });
    break;
  }
  return out;
}

/**
 * What a tool call does, as a sentence in parts: plain words, with only a command's name as
 * `code` ("Ran `CIRCLE` · center 3, 2.5 · radius 0.6", "Selected 4 objects on layer Hatch",
 * "Ran 3 commands: `LINE`, `LINE`, `CIRCLE`"). One step that acts beside steps that only read back
 * is the sentence; `report` (the call's result, once there is one) fills in what only the result
 * knows (how many were selected, the distance measured). Empty code asks for the manual. A program
 * that cannot be read (malformed, too long, or nothing the namespace names) is its first line,
 * clipped. Never throws.
 */
export function activityParts(code: string, report: string = "", tense: ActivityTense = "past"): InlinePart[] {
  if (code.trim() === "") return [{ kind: "text", text: tense === "past" ? "Read the manual" : "Reading the manual" }];
  const program = readProgram(code, report);
  if (program === null || program.steps.length === 0) return codeFallback(code, tense);
  const acting = program.steps.filter((s) => !s.reads);
  const only = acting.length === 1 ? acting[0] : undefined;
  if (only !== undefined) return clipParts(stepParts(only, tense));
  const first = program.steps[0];
  if (acting.length === 0 && first !== undefined) {
    const more = program.steps.length - 1;
    return clipParts([...stepParts(first, tense), ...(more === 0 ? [] : [{ kind: "text" as const, text: `, then ${more === 1 ? "1 more lookup" : `${count(more)} more lookups`}` }])]);
  }
  const commands = acting.every((s) => s.name !== undefined);
  const parts: InlinePart[] = [{ kind: "text", text: `${VERBS.ran[tense === "past" ? 0 : 1]} ${count(acting.length)} ${commands ? "commands" : "steps"}: ` }];
  acting.slice(0, MAX_NAMES).forEach((step, i) => {
    if (i > 0) parts.push({ kind: "text", text: ", " });
    parts.push(stepName(step));
  });
  if (acting.length > MAX_NAMES) parts.push({ kind: "text", text: `, and ${count(acting.length - MAX_NAMES)} more` });
  return clipParts(parts);
}

/** [`activityParts`] as one line of text: the run row's status and the changes row's list. */
export function activityLine(code: string, report: string = "", tense: ActivityTense = "past"): string {
  return activityParts(code, report, tense)
    .map((p) => p.text)
    .join("");
}

/** What a call changed in the drawing, measured around it: objects more or fewer, and undo steps
 *  added (null when the facade does not say how deep its undo stack is). */
export interface DrawingDelta {
  objects: number;
  steps: number | null;
}

/** An engine or interpreter error in plain words: its first line, without the prefixes the report carries. */
function plainError(text: string): string {
  const line = oneLine((text.split("\n").find((l) => l.trim() !== "") ?? "").replace(/^error:\s*/i, ""))
    .replace(/^invalid parameters for `run`:\s*/i, "")
    .replace(/^;\s*error:\s*/i, "");
  const unknown = /^unknown command `([^`]*)`/i.exec(line);
  if (unknown !== null) return `There is no command named ${clip(unknown[1] ?? "", MAX_ARG_CHARS)}`;
  const undefinedFn = /^no function definition:\s*(.+)$/i.exec(line);
  if (undefinedFn !== null) return `There is no function named ${clip(undefinedFn[1] ?? "", MAX_ARG_CHARS)}`;
  if (/^malformed (list|string)|unexpected end/i.test(line)) return "The code is incomplete: a bracket or a quote is not closed";
  const params = /^invalid parameters for `([^`]*)`:\s*(.+)$/i.exec(line);
  if (params !== null) return clip(`${upper(params[1] ?? "")} needs other parameters: ${params[2] ?? ""}`, 160);
  return line === "" ? "It failed without saying why" : clip(line.charAt(0).toUpperCase() + line.slice(1), 160);
}

/**
 * The note beside a tool row's sentence: what the result says changed ("1 object added",
 * "3 objects moved", "Drawing unchanged"), the error in plain words, or nothing when there is
 * nothing to say (a lookup, a selection, a measurement the sentence already holds). `delta` is the
 * drawing measured before and after the call, when the caller could measure it. Never throws.
 */
export function resultNote(code: string, report: string, ok: boolean, delta: DrawingDelta | null = null): string {
  if (!ok || /^error:/i.test(report)) return plainError(report);
  if (code.trim() === "") return "";
  const program = readProgram(code, report);
  if (program === null || program.steps.length === 0) {
    // Plain code: its value is the news, when it is a short one.
    const value = (readForms(report.startsWith("=> ") ? report.slice(3) : (report.split("\n=> ")[1] ?? ""), true) ?? [])[0];
    if (delta !== null && delta.objects !== 0) return `${objects(Math.abs(delta.objects))} ${delta.objects > 0 ? "added" : "removed"}`;
    if (typeof value === "number") return shortNumber(value);
    return isText(value) ? clip(oneLine(value.s), MAX_ARG_CHARS) : "";
  }
  const acting = program.steps.filter((s) => !s.reads);
  // One command alone says what it did in its own word: `((MOVED . 3))` is "3 objects moved".
  const single = acting.length === 1 && acting[0]?.quiet === false ? program.single : null;
  for (const [key, value] of single ?? []) {
    const n = isList(value) && value.length === 1 ? value[0] : value;
    if (/^[A-Z]{2,24}ED$/.test(key) && typeof n === "number" && Number.isInteger(n) && n >= 0) return `${objects(n)} ${key.toLowerCase()}`;
  }
  if (delta === null) return "";
  if (delta.objects !== 0) return `${objects(Math.abs(delta.objects))} ${delta.objects > 0 ? "added" : "removed"}`;
  if (delta.steps === null) return "";
  if (delta.steps > 0) {
    const handles = single === null ? undefined : (valueOf(single, "HANDLES") ?? valueOf(single, "HANDLE"));
    const n = isList(handles) ? handles.length : isText(handles) ? 1 : 0;
    return n > 0 ? `${objects(n)} changed` : "Drawing changed";
  }
  return acting.some((s) => !s.quiet) ? "Drawing unchanged" : "";
}

/** One block of a reply's prose: a heading, a list, or a paragraph. */
export type ProseBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "para"; text: string };

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const ORDERED_RE = /^\s*\d{1,9}[.)]\s+(.*)$/;

/** The line under a table's header: a run of dashes per column, between pipes (`|---|:--:|`). */
const TABLE_RULE_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
/** How a table's cells are joined once it is read as text. */
const CELL_JOIN = " · ";
/** A table's header reads as a heading under the reply's own (`###` and deeper are the minor ones). */
const TABLE_HEADING_LEVEL = 4;

/** The cells of one table row: the text between its pipes (`\|` is a pipe inside a cell). */
function tableCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  const row = line.trim();
  for (let i = 0; i < row.length; i++) {
    const ch = row[i] ?? "";
    if (ch === "\\" && row[i + 1] === "|") {
      cell += "|";
      i += 1;
    } else if (ch === "|") {
      // The pipe that opens the row starts its first cell; it does not end an empty one.
      if (i > 0) cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  if (cell.trim() !== "") cells.push(cell.trim());
  return cells;
}

/** A table's row as one line of a list: its cells in order, the first in bold (it names the row). */
function tableItem(cells: readonly string[]): string {
  const [first = "", ...rest] = cells;
  // A cell with its own markers is left as it is: wrapped in bold it would break them.
  const lead = first === "" || /[*`]/.test(first) ? first : `**${first}**`;
  return [lead, ...rest].filter((cell) => cell !== "").join(CELL_JOIN);
}

/**
 * Split a reply's prose (what `splitFences` left outside the code) into the blocks models write:
 * `#` headings, `-`/`*` and `1.` lists, and paragraphs divided by blank lines (a port of the
 * desktop pane's `parse_markdown_lite`). Lines of one paragraph keep their breaks; a line that
 * continues a list item is folded into it. A Markdown table has no room in a panel a few hundred
 * pixels wide, and left alone it would be drawn as its pipes and dashes: it is read as text
 * instead, its header as a minor heading and each row as a list item, the cells joined by a
 * middle dot. Nothing is HTML: the pane maps blocks to elements and runs `parseInline` over each
 * text.
 */
export function parseBlocks(text: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const endPara = (): void => {
    if (para.length > 0) blocks.push({ kind: "para", text: para.join("\n") });
    para = [];
  };
  const endList = (): void => {
    if (list !== null) blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  const lines = text.split("\n");
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? "";
    if (line.trim() === "") {
      endPara();
      endList();
      continue;
    }
    const rule = lines[at + 1] ?? "";
    if (line.includes("|") && rule.includes("|") && TABLE_RULE_RE.test(rule) && tableCells(line).length === tableCells(rule).length) {
      endPara();
      endList();
      blocks.push({ kind: "heading", level: TABLE_HEADING_LEVEL, text: tableCells(line).join(CELL_JOIN) });
      const rows: string[] = [];
      for (at += 2; at < lines.length && (lines[at] ?? "").includes("|"); at++) rows.push(tableItem(tableCells(lines[at] ?? "")));
      at -= 1;
      if (rows.length > 0) blocks.push({ kind: "list", ordered: false, items: rows });
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      endPara();
      endList();
      blocks.push({ kind: "heading", level: (heading[1] ?? "#").length, text: heading[2] ?? "" });
      continue;
    }
    const bullet = BULLET_RE.exec(line);
    const ordered = bullet === null ? ORDERED_RE.exec(line) : null;
    const item = bullet ?? ordered;
    if (item !== null) {
      endPara();
      const isOrdered = bullet === null;
      if (list !== null && list.ordered !== isOrdered) endList();
      if (list === null) list = { ordered: isOrdered, items: [] };
      list.items.push(item[1] ?? "");
      continue;
    }
    if (list !== null && /^\s+\S/.test(line)) {
      // An indented line under an item continues it.
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ""} ${line.trim()}`;
      continue;
    }
    endList();
    para.push(line);
  }
  endPara();
  endList();
  return blocks;
}

/** One block of a reply as the transcript draws it: a block of prose, or a fenced block of code. */
export type ReplyBlock = ProseBlock | { kind: "code"; text: string };

/** A whole reply as its blocks: `splitFences`, then `parseBlocks` over each run of prose. */
export function replyBlocks(text: string): ReplyBlock[] {
  return splitFences(text).flatMap((part): ReplyBlock[] => (part.kind === "code" ? [part] : parseBlocks(part.text)));
}

/** Whether two blocks say the same thing. */
export function sameBlock(a: ReplyBlock, b: ReplyBlock): boolean {
  if (a.kind === "list" || b.kind === "list") {
    return a.kind === "list" && b.kind === "list" && a.ordered === b.ordered && a.items.length === b.items.length && a.items.every((item, i) => item === b.items[i]);
  }
  if (a.kind === "heading" || b.kind === "heading") return a.kind === "heading" && b.kind === "heading" && a.level === b.level && a.text === b.text;
  return a.kind === b.kind && a.text === b.text;
}

/**
 * A reply parsed as it grows. `settled` are the blocks no later text can change, `tail` the ones
 * that still can; `settledChars` is how much of the text the settled blocks cover and `rest` the
 * text after that. A block that did not change between two parses is the same object in both, so
 * a list keyed by the object redraws only what changed.
 */
export interface ReplyParse {
  settled: readonly ReplyBlock[];
  tail: readonly ReplyBlock[];
  settledChars: number;
  rest: string;
}

/**
 * How far into `text` (which starts outside any fence) its blocks are final, whatever is written
 * after it: to the end of the last closed fence, to the opening of a fence that is still open, or
 * to the last blank line of the prose after them (a blank line ends a paragraph and a list).
 */
function settledLength(text: string): number {
  let at = 0;
  for (;;) {
    const open = text.indexOf("```", at);
    if (open === -1) break;
    const from = open + 3;
    const nl = text.indexOf("\n", from);
    const lang = (nl === -1 ? text.slice(from) : text.slice(from, nl)).trim();
    const bodyStart = nl !== -1 && /^[\w+#-]*$/.test(lang) ? nl + 1 : from;
    const close = text.indexOf("```", bodyStart);
    // The prose before a fence is over once the fence opens.
    if (close === -1) return open;
    at = close + 3;
  }
  const blank = text.lastIndexOf("\n\n");
  return blank >= at ? blank + 2 : at;
}

/**
 * Parse a reply that grew since `prev` was parsed from its beginning: only the text after the
 * settled part is read again, so the work follows the size of the last block, not of the reply.
 * The blocks are those of [`replyBlocks`] over the whole text. A text that is not `prev`'s with
 * more after it (another reply, an edited one) is parsed from its start.
 */
export function growReply(prev: ReplyParse | undefined, text: string): ReplyParse {
  const grown = prev !== undefined && text.length >= prev.settledChars + prev.rest.length && text.startsWith(prev.rest, prev.settledChars);
  const base: ReplyParse = grown ? prev : { settled: [], tail: [], settledChars: 0, rest: "" };
  const unsettled = text.slice(base.settledChars);
  if (unsettled === base.rest) return base;
  const cut = settledLength(unsettled);
  const rest = unsettled.slice(cut);
  const tail = replyBlocks(rest).map((block, i) => {
    // Nothing settled this time: a tail block that reads as before is the block it was.
    const before = cut === 0 ? base.tail[i] : undefined;
    return before !== undefined && sameBlock(before, block) ? before : block;
  });
  return {
    settled: cut === 0 ? base.settled : [...base.settled, ...replyBlocks(unsettled.slice(0, cut))],
    tail,
    settledChars: base.settledChars + cut,
    rest,
  };
}

/** The assistant panel's width, in CSS pixels: where it starts and how far a drag may take it. */
export const PANEL_WIDTH = { min: 280, initial: 340, max: 720 } as const;
/** What the drawing keeps beside the panel, however far the panel is dragged. */
export const STAGE_MIN_WIDTH = 320;

/**
 * The panel's width for a wanted width in a window `viewport` wide: inside its own limits, and
 * never so wide that the drawing keeps less than [`STAGE_MIN_WIDTH`]. A value that is not a
 * number (a stored setting someone edited) is the initial width.
 */
export function clampPanelWidth(wanted: number, viewport: number): number {
  if (!Number.isFinite(wanted)) return PANEL_WIDTH.initial;
  const room = Number.isFinite(viewport) ? viewport - STAGE_MIN_WIDTH : PANEL_WIDTH.max;
  const max = Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, room));
  return Math.round(Math.min(Math.max(wanted, PANEL_WIDTH.min), max));
}

/** How close to the end counts as "at the end" of the transcript, in CSS pixels. */
export const FOLLOW_SLACK = 24;

/** Whether a scroller is at its end, so new content should keep it there. */
export function atEnd(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= FOLLOW_SLACK;
}

/**
 * Whether the transcript keeps to its end after a scroll event. Only the person moves it up, so a
 * move up stops the following (unless it is the scroller settling at its very end, as when the
 * content got shorter); a move down, or none, resumes it at the end and otherwise leaves it as it
 * was. Content that grew under a transcript that follows moves nothing up, so a reply that
 * arrives faster than the view is brought to its end never stops the following by itself.
 */
export function followAfterScroll(following: boolean, lastTop: number, scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  if (scrollTop < lastTop) return scrollHeight - scrollTop - clientHeight <= 1;
  return following || atEnd(scrollHeight, scrollTop, clientHeight);
}

/**
 * Whether the focus is the panel's to move: it is inside the panel, or nowhere (on the page's
 * body, where it lands when what held it went away). A focus anywhere else was put there by the
 * person, and closing the setup sheet leaves it alone.
 */
export function focusIsOurs(panel: { contains: (node: Node | null) => boolean }, active: Element | null, body: Element | null): boolean {
  return active === null || active === body || panel.contains(active);
}

/**
 * Split the model's text into plain, bold, code and link runs. Backticks win over everything
 * inside them; a marker that never closes stays literal. A link is `[label](address)` or a bare
 * address, and only when [`safeHref`] passes the address: anything else (`[x](javascript:…)`, a
 * `data:` address) stays the text the model wrote, brackets and all, so the reader sees what it
 * was. No HTML is produced: the pane maps the parts to elements, so a model's words can never
 * inject markup.
 */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const index = m.index ?? 0;
    let part: InlinePart | null = null;
    let length = m[0].length;
    if (m[1] !== undefined) part = { kind: "code", text: m[1] };
    else if (m[2] !== undefined) part = { kind: "bold", text: m[2] };
    else if (m[3] !== undefined) {
      const href = safeHref(m[4] ?? "");
      if (href !== null) part = { kind: "link", text: m[3], href };
    } else {
      const address = bareAddress(m[0]);
      const href = safeHref(address);
      if (href !== null) part = { kind: "link", text: address, href };
      length = address.length;
    }
    // What is not a link stays in the text around it, exactly as written.
    if (part === null) continue;
    if (index > last) parts.push({ kind: "text", text: text.slice(last, index) });
    parts.push(part);
    last = index + length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  if (parts.length === 0) parts.push({ kind: "text", text });
  return parts;
}

// ---- The request ----------------------------------------------------------------------------------

/** A request that stayed silent past its limit. */
class SilentError extends Error {}

/** What a wait needs of the watch over its request. */
interface RequestWatch {
  /** The signal the request itself is sent with. */
  signal: AbortSignal;
  /** Settle a wait early when the request is stopped or has gone silent. */
  race: <T>(wait: Promise<T>) => Promise<T>;
  /** Something arrived: the silence clock starts again. */
  touch: () => void;
  /** The request is over: put the clock and the listener away. */
  done: () => void;
}

/**
 * The watch over one request: it ends the request when the person stops it, or when nothing has
 * arrived for `idleMs` (a server that accepts the connection and never answers, a stream that
 * stops mid-reply). `race` settles a wait early in either case, so a body that ignores the abort
 * cannot hold the turn.
 */
function watchRequest(outer: AbortSignal, idleMs: number): RequestWatch {
  const inner = new AbortController();
  const tripped = Promise.withResolvers<never>();
  // Nothing may be waiting when it trips: that is not an error of its own.
  tripped.promise.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const trip = (reason: Error): void => {
    tripped.reject(reason);
    inner.abort();
  };
  const onStop = (): void => trip(new Error("stopped"));
  const touch = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => trip(new SilentError(silentText(idleMs))), idleMs);
  };
  if (outer.aborted) onStop();
  else outer.addEventListener("abort", onStop, { once: true });
  touch();
  return {
    signal: inner.signal,
    race: (wait) => Promise.race([wait, tripped.promise]),
    touch,
    done: () => {
      clearTimeout(timer);
      outer.removeEventListener("abort", onStop);
    },
  };
}

/** A response's body as text, read no further than `max` characters (`clipped` says it was longer). */
async function readCapped(resp: Response, max: number, watch: RequestWatch): Promise<{ text: string; clipped: boolean }> {
  if (resp.body === null) return { text: "", clipped: false };
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await watch.race(reader.read());
      if (done) return { text, clipped: false };
      watch.touch();
      text += decoder.decode(value, { stream: true });
      if (text.length > max) return { text: text.slice(0, max), clipped: true };
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

/**
 * Send a conversation and stream the answer; `onText` sees each fragment as it arrives. The
 * request is bounded: silence past `idleMs` ends it, as does an answer past
 * [`MAX_STREAM_CHARS`]; a reply past [`MAX_REPLY_CHARS`] comes back `clipped`.
 */
export async function requestChat(
  provider: ProviderConfig,
  messages: readonly ChatMessage[],
  signal: AbortSignal,
  onText: (fragment: string) => void,
  fetchImpl: typeof fetch = fetch,
  idleMs: number = REPLY_IDLE_MS,
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
  const watch = watchRequest(signal, idleMs);
  try {
    let resp: Response;
    try {
      resp = await watch.race(fetchImpl(providerEndpoint(provider.baseUrl), { method: "POST", headers, body: JSON.stringify(body), signal: watch.signal }));
    } catch (e) {
      if (signal.aborted) throw new Error("stopped");
      if (e instanceof SilentError) throw e;
      throw new Error(unreachableText(e, providerEndpoint(provider.baseUrl)));
    }
    watch.touch();
    if (!resp.ok) {
      const failed = await readCapped(resp, MAX_ERROR_BODY_CHARS, watch).catch(() => ({ text: "", clipped: false }));
      throw new Error(apiErrorText(resp.status, failed.text));
    }
    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("event-stream") || resp.body === null) {
      // A provider that ignored `stream: true` (or a proxy that buffered it) still answers with one
      // JSON object; read it as one.
      const whole = await readCapped(resp, MAX_STREAM_CHARS, watch);
      if (whole.clipped) throw new Error(REPLY_TOO_LARGE);
      return oneShot(whole.text, onText);
    }
    const asm = new StreamAssembler();
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let read = 0;
    const feedLine = (line: string): boolean => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return false;
      const payload = trimmed.slice("data:".length).trim();
      if (payload === "") return false;
      if (payload === "[DONE]") return true;
      const fragment = asm.feed(payload);
      if (fragment !== null) onText(fragment);
      return asm.full;
    };
    try {
      for (;;) {
        const { done, value } = await watch.race(reader.read());
        if (done) break;
        watch.touch();
        const chunk = decoder.decode(value, { stream: true });
        read += chunk.length;
        if (read > MAX_STREAM_CHARS) throw new Error(REPLY_TOO_LARGE);
        buffer += chunk;
        let idx = buffer.indexOf("\n");
        while (idx >= 0) {
          const line = buffer.slice(0, idx).replace(/\r$/, "");
          buffer = buffer.slice(idx + 1);
          if (feedLine(line)) return asm.finishReply();
          idx = buffer.indexOf("\n");
        }
      }
    } finally {
      void reader.cancel().catch(() => undefined);
    }
    if (buffer !== "") feedLine(buffer);
    return asm.finishReply();
  } finally {
    watch.done();
  }
}

/** A reply that arrived as one JSON object instead of a stream. */
export function oneShot(body: string, onText: (fragment: string) => void): Reply {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    throw new Error(UNREADABLE_REPLY);
  }
  const root = asRecord(v);
  const err = root["error"];
  if (err !== undefined && err !== null) throw new Error(apiErrorText(200, JSON.stringify({ error: err })));
  const choices = root["choices"];
  const choice = Array.isArray(choices) ? asRecord(choices[0]) : {};
  const msg = asRecord(choice["message"]);
  const whole = typeof msg["content"] === "string" ? msg["content"] : "";
  const content = whole.slice(0, MAX_REPLY_CHARS);
  if (content !== "") onText(content);
  if (content.length < whole.length) return { text: content, toolCalls: [], finish: "length", clipped: true };
  const toolCalls: ToolCall[] = [];
  const calls = msg["tool_calls"];
  if (Array.isArray(calls)) {
    if (calls.length > MAX_CALLS_PER_REPLY) throw new Error(TOO_MANY_CALLS);
    calls.forEach((raw, i) => {
      const call = asRecord(raw);
      const f = asRecord(call["function"]);
      const name = typeof f["name"] === "string" ? f["name"] : "";
      if (name === "") return;
      const id = typeof call["id"] === "string" ? call["id"] : `call_${i}`;
      const args = typeof f["arguments"] === "string" ? f["arguments"] : "";
      checkCallSize(id, name, args);
      toolCalls.push({ id, name, args: parseToolArgs(args) });
    });
  }
  const finish = typeof choice["finish_reason"] === "string" ? choice["finish_reason"] : "";
  return { text: content, toolCalls, finish };
}

/** Where a message is read: the transcript (the setup is elsewhere), or the setup sheet itself. */
export type MessagePlace = "panel" | "sheet";

/**
 * What a status means, and the way out, in the pane's own words. A 2xx status is an error the
 * provider reported inside an answer that otherwise arrived, so there is no number worth naming.
 */
function statusText(status: number, where: MessagePlace): string {
  if (status === 401 || status === 403) return `The provider refused the request (${status}). Check the API key ${where === "sheet" ? "above" : "in the model setup"}.`;
  if (status === 404) return `The provider did not find what was asked for (${status}). The base URL or the model name may be wrong.`;
  if (status === 429) return `The provider is limiting requests (${status}). Wait a moment, then ask again.`;
  if (status >= 500) return `The provider is having trouble (${status}). Ask again in a moment.`;
  if (status >= 200 && status < 300) return "The provider reported an error.";
  return `The provider answered with an error (${status}).`;
}

/** The message a failed answer carries: what the status means, then the provider's own message. */
export function apiErrorText(status: number, body: string, where: MessagePlace = "panel"): string {
  const trimmed = body.trim();
  let detail = trimmed === "" ? "" : clip(trimmed, 400);
  try {
    const v = asRecord(JSON.parse(trimmed));
    // The error is an object with a message, or (some servers) the message itself.
    const m = typeof v["error"] === "string" ? v["error"] : asRecord(v["error"])["message"];
    if (typeof m === "string") detail = clip(m.trim(), 400);
  } catch {
    // not JSON; the clipped body stands
  }
  if (detail === "") return statusText(status, where);
  return `${statusText(status, where)} The provider said: ${/[.!?…]$/.test(detail) ? detail : `${detail}.`}`;
}

/**
 * A request that never got an answer, as one message that names the address. The browser reports
 * an unreachable server as a bare "Failed to fetch"; anything else is its own words, with the
 * address after them.
 */
function unreachableText(e: unknown, url: string): string {
  const m = message(e);
  if (/Failed to fetch|NetworkError|load failed/i.test(m)) {
    return `The provider at ${url} could not be reached. Check that the server is running and accepts requests from this page.`;
  }
  return `${m} (${url})`;
}

// ---- Small helpers ----------------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
