/**
 * The assistant's session: the conversation, the draft, the queue, the provider settings and the
 * running turn, held outside the panel so they outlive it. Closing the panel hides the view; the
 * session (and a turn in flight) carries on, and reopening shows it where it was.
 *
 * The turn itself is `./assistant.ts`'s `runTurn`; this module folds its events into the entries
 * the transcript draws, queues what the reader says while a turn runs, and keeps the drawing's
 * undo depth from before the assistant's unresolved changes so they can be taken back in one step
 * (the engine's `undoto`, the checkpoint the desktop pane keeps per request).
 *
 * Nothing here touches the DOM. Derived values are plain functions, not memos, so the module
 * behaves the same under the tests' non-reactive Solid build.
 */

import { batch, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { AppFacade } from "./facade";
import { activityLine, MAX_MESSAGE_CHARS, MAX_REQUEST_CHARS, PROVIDER_LIMITS, providerFault, runTurn, trimToBudget, type AssistantEvent, type Briefing, type ChatImage, type ChatMessage, type ProviderConfig, type TurnOptions } from "./assistant";

export interface ToolEntry {
  kind: "tool";
  name: string;
  code: string;
  report: string;
  ok: boolean;
  note: string;
  open: boolean;
  at: number;
}

export type Entry =
  | { kind: "user"; text: string; pictures: number; at: number }
  | { kind: "assistant"; text: string; at: number }
  | { kind: "failed"; text: string; at: number }
  | ToolEntry;

/** What the reader said while a turn ran, waiting for it to end. */
export interface QueuedMessage {
  text: string;
  pictures: readonly ChatImage[];
}

/** The assistant's changes the reader has neither kept nor undone: the undo depth before the
 *  first such request, and how many undo steps lie above it now. */
export interface Changes {
  depth: number;
  steps: number;
  /** What the assistant ran to make them, oldest first: one line per tool call that succeeded
   *  since the checkpoint (`activityLine` of its code). */
  labels: string[];
}

/** What the session needs of the facade (the real `AppFacade` satisfies it). */
export type SessionFacade = Pick<AppFacade, "drawingState" | "selection" | "execute">;

/** What `send` did: sent the draft, queued it behind the running turn, had nothing to send,
 *  needs a provider first, or kept a draft longer than one message may be (it is never cut). */
export type SendOutcome = "sent" | "queued" | "empty" | "unconfigured" | "too-long";

/**
 * The most rows a chat keeps. Past it, the oldest whole turns are let go when the next message is
 * sent, and `dropped()` says how many rows went. The model's context is bounded separately, by
 * `trimToBudget`.
 */
export const MAX_ENTRIES = 2_000;

/** The start of a turn at or after `from`: the first of the reader's messages there, or `from`. */
export function turnStart(entries: readonly Entry[], from: number): number {
  if (from <= 0) return 0;
  const at = Math.min(from, entries.length);
  for (let i = at; i < entries.length; i++) if (entries[i]?.kind === "user") return i;
  return at;
}

/**
 * How long the model may stay silent before the status stops saying it is thinking and says the
 * provider is being waited on: past this, the wait is more likely the server than the thought.
 */
export const SLOW_REPLY_MS = 8_000;

/** How long a reply's fragments may wait for a frame; a hidden page draws none, and the text is still due. */
const FRAME_FALLBACK_MS = 250;

/**
 * Run `flush` once, before the next frame is drawn. A reply arrives in many fragments per frame:
 * the session joins them and writes the transcript once per frame. Without frames (no window),
 * `flush` runs at once.
 */
function nextFrame(flush: () => void): void {
  if (typeof requestAnimationFrame !== "function") {
    flush();
    return;
  }
  let ran = false;
  const once = (): void => {
    if (ran) return;
    ran = true;
    clearTimeout(timer);
    flush();
  };
  const timer = setTimeout(once, FRAME_FALLBACK_MS);
  requestAnimationFrame(once);
}

export interface SessionOptions {
  facade: SessionFacade;
  /** The drawing changed (a tool call ran, or the changes were undone): re-read the surfaces. */
  onChanged: () => void;
  /** Injectable for tests; the real one is `fetch`. */
  fetchImpl?: typeof fetch;
  /** How long a request may stay silent before it is stopped (tests shorten it). */
  idleMs?: number;
  /** Runs its argument once before the next frame (tests drive it by hand); the real one is the browser's. */
  frame?: (flush: () => void) => void;
  /** How long the model may stay silent before the status names the provider ([`SLOW_REPLY_MS`]; tests shorten it). */
  slowMs?: number;
}

/** The one place the setup (and the key in it) is kept: this entry of the browser's storage. */
export const STORAGE_KEY = "cadcraft.assistant.provider";

/** "Not set up": what a missing, unreadable or unusable stored setup becomes. */
const NO_PROVIDER: ProviderConfig = { baseUrl: "", model: "", apiKey: "" };

/** The longest stored text worth parsing: the three values at their limits, with room for the JSON around them. */
const MAX_STORED_CHARS = 2 * (PROVIDER_LIMITS.baseUrl + PROVIDER_LIMITS.model + PROVIDER_LIMITS.apiKey);

/**
 * Read a stored setup. The text is whatever the browser's storage holds, which someone may have
 * edited or another build may have written, so nothing in it is trusted: it must be JSON for a
 * plain object whose `baseUrl` and `model` are strings (and `apiKey`, when present), without
 * control characters, and together a setup `providerFault` passes (an http or https address
 * without a name or password in it, every value inside its limit). Anything else is "not set up";
 * a setup is never half-read, and this never throws.
 */
export function parseStoredProvider(raw: string | null): ProviderConfig {
  if (raw === null || raw.length > MAX_STORED_CHARS) return { ...NO_PROVIDER };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ...NO_PROVIDER };
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { ...NO_PROVIDER };
  const { baseUrl, model, apiKey = "" } = v as Record<string, unknown>;
  if (typeof baseUrl !== "string" || typeof model !== "string" || typeof apiKey !== "string") return { ...NO_PROVIDER };
  const provider: ProviderConfig = { baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim() };
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(provider.baseUrl + provider.model + provider.apiKey)) return { ...NO_PROVIDER };
  return providerFault(provider) === null ? provider : { ...NO_PROVIDER };
}

/** The provider settings the session keeps: the last one saved in this browser. */
export function loadProvider(): ProviderConfig {
  if (typeof localStorage === "undefined") return { ...NO_PROVIDER };
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // a blocked storage is a browser without a saved setup
    return { ...NO_PROVIDER };
  }
  return parseStoredProvider(raw);
}

export function saveProvider(p: ProviderConfig): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // a full or blocked storage is not worth failing the composer over
  }
}

/** The size of a conversation as the budget counts it: its characters, pictures and tool calls. */
export function contextUsed(conversation: readonly ChatMessage[]): number {
  return conversation.reduce(
    (n, m) =>
      n +
      (m.content ?? "").length +
      (m.images ?? []).reduce((k, img) => k + img.dataUrl.length, 0) +
      (m.toolCalls ?? []).reduce((k, c) => k + c.name.length + JSON.stringify(c.args ?? {}).length, 0),
    0,
  );
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export function createAssistantSession(opts: SessionOptions) {
  const [entries, setEntries] = createStore<Entry[]>([]);
  const [queued, setQueued] = createStore<QueuedMessage[]>([]);
  const [conversation, setConversation] = createSignal<ChatMessage[]>([]);
  const [input, setInput] = createSignal("");
  const [attached, setAttached] = createSignal<readonly ChatImage[]>([]);
  const [running, setRunning] = createSignal(false);
  const [status, setStatus] = createSignal("");
  const [provider, setProviderSignal] = createSignal<ProviderConfig>(loadProvider());
  const [changes, setChanges] = createSignal<Changes | null>(null);
  /** Whether the briefing names the canvas selection; the reader can leave it out. */
  const [selectionIncluded, setSelectionIncluded] = createSignal(true);
  /** How many of the chat's oldest rows were let go (see `MAX_ENTRIES`). */
  const [dropped, setDropped] = createSignal(0);
  const frame = opts.frame ?? nextFrame;
  /** The reply's fragments since the last frame, and whether a frame is due to write them. */
  let pendingText = "";
  let frameDue = false;
  let controller: AbortController | null = null;
  let turn: Promise<void> = Promise.resolve();
  /** How the last turn ended; a queue only continues by itself after a clean end. */
  let lastEnd: "done" | "stopped" | "failed" = "done";
  /** Due when the model has been silent for `slowMs`: the status then names the provider. */
  let slow: ReturnType<typeof setTimeout> | undefined;
  /** The code of each tool call that succeeded since the open checkpoint. */
  let ranSince: string[] = [];

  /**
   * How much of the conversation the next request carries: while a turn runs, what it is sending;
   * otherwise what a message sent now would take with it. Turns that no longer fit the budget (a
   * reply cut at its limit, for one) are not counted, because they are not sent.
   */
  const used = (): number => {
    const all = conversation();
    return contextUsed(trimToBudget(running() ? all : [...all, { role: "user", content: "" }], MAX_REQUEST_CHARS));
  };
  /** How far the draft is over what one message may hold, or 0. */
  const overBy = (): number => Math.max(0, input().trim().length - MAX_MESSAGE_CHARS);
  /** A setup that can be sent: the same check the turn itself makes, not only "something is typed". */
  const ready = (): boolean => providerFault(provider()) === null;
  const title = (): string => {
    const first = entries.find((e) => e.kind === "user");
    if (first === undefined || first.kind !== "user") return "New chat";
    const line = first.text.split("\n")[0] ?? "";
    return line.length > 48 ? `${line.slice(0, 48)}…` : line;
  };
  const undoDepth = (): number | null => opts.facade.drawingState()?.undoDepth ?? null;

  /** The briefing the model is told about the drawing, read fresh at the start of every turn. */
  const briefing = (): Briefing => {
    const state = opts.facade.drawingState();
    return {
      app: "CADCraft (browser)",
      drawing: state?.title ?? "",
      units: state?.units ?? "",
      objects: state?.entityCount ?? 0,
      selection: selectionIncluded() ? opts.facade.selection().handles.length : 0,
      extents: state?.extents === null || state?.extents === undefined ? null : [state.extents.x0, state.extents.y0, state.extents.x1, state.extents.y1],
    };
  };

  /**
   * The status row says what the turn is doing now, in four phases. The model has the conversation
   * and has said nothing yet: it is thinking, and past `slowMs` of silence it is the provider that
   * is being waited on. Its words are arriving: it is writing. It asked for a command: that
   * command is running, by its first line. A command runs within one frame, so its name stays in
   * the row while the model reads the report (`ran`): "Ran …. Thinking…".
   */
  const awaitReply = (ran = ""): void => {
    clearTimeout(slow);
    setStatus(ran === "" ? "Thinking…" : `${ran}. Thinking…`);
    slow = setTimeout(() => setStatus("Waiting for the provider…"), opts.slowMs ?? SLOW_REPLY_MS);
  };
  const heard = (doing: string): void => {
    clearTimeout(slow);
    if (status() !== doing) setStatus(doing);
  };

  /** Write the fragments that arrived since the last frame: one change to the transcript. */
  const flushText = (): void => {
    frameDue = false;
    if (pendingText === "") return;
    const text = pendingText;
    pendingText = "";
    setEntries(
      produce((list) => {
        const last = list[list.length - 1];
        if (last?.kind === "assistant") last.text += text;
        else list.push({ kind: "assistant", text, at: Date.now() });
      }),
    );
  };

  const onEvent = (e: AssistantEvent): void => {
    if (e.type === "text") {
      heard("Writing…");
      pendingText += e.text;
      if (!frameDue) {
        frameDue = true;
        frame(flushText);
      }
      return;
    }
    // Anything else comes after the words before it: they are written first.
    flushText();
    if (e.type === "call") {
      heard(e.code.trim() === "" ? "Reading the manual…" : `Running ${activityLine(e.code)}…`);
      setEntries(produce((list) => void list.push({ kind: "tool", name: e.name, code: e.code, report: "", ok: true, note: "running…", open: false, at: Date.now() })));
      return;
    }
    if (e.type === "result") {
      setEntries(
        produce((list) => {
          for (let i = list.length - 1; i >= 0; i--) {
            const entry = list[i];
            if (entry?.kind === "tool" && entry.report === "") {
              entry.ok = e.ok;
              entry.note = e.note;
              entry.report = e.report;
              if (e.ok) ranSince.push(entry.code);
              break;
            }
          }
        }),
      );
      opts.onChanged();
      // The report goes back to the model: the turn waits on its next words.
      awaitReply(e.code.trim() === "" ? "Read the manual" : `Ran ${activityLine(e.code)}`);
      return;
    }
    if (e.type === "failed") {
      lastEnd = "failed";
      setEntries(produce((list) => void list.push({ kind: "failed", text: e.error, at: Date.now() })));
      return;
    }
    if (e.reason === "stopped") lastEnd = "stopped";
  };

  const run = async (next: ChatMessage[]): Promise<void> => {
    lastEnd = "done";
    setRunning(true);
    awaitReply();
    controller = new AbortController();
    const options: TurnOptions = {
      provider: provider(),
      briefing: briefing(),
      conversation: next,
      execute: (code, values) => {
        const env = opts.facade.execute("run", values === null ? { code } : { code, values });
        return env.ok ? { ok: true, result: env.result } : { ok: false, error: env.error };
      },
      onEvent,
      signal: controller.signal,
    };
    if (opts.fetchImpl !== undefined) options.fetchImpl = opts.fetchImpl;
    if (opts.idleMs !== undefined) options.idleMs = opts.idleMs;
    try {
      await runTurn(options);
    } finally {
      flushText();
      // Only what can still be sent is kept: turns the budget has passed are never sent again.
      setConversation(trimToBudget(next, MAX_REQUEST_CHARS));
      setRunning(false);
      clearTimeout(slow);
      setStatus("");
      controller = null;
    }
  };

  /** Start a turn on a conversation that already ends with the reader's message. */
  const start = (next: ChatMessage[]): void => {
    // The checkpoint: the undo depth before this request, unless older changes are still open.
    const before = changes()?.depth ?? undoDepth();
    turn = run(next).then(() => {
      const now = undoDepth();
      const changed = before !== null && now !== null && now > before;
      if (!changed) ranSince = [];
      setChanges(changed ? { depth: before, steps: now - before, labels: ranSince.map(activityLine) } : null);
      // A queued message goes as soon as the turn before it ended cleanly.
      if (lastEnd === "done") sendQueued(0);
    });
  };

  const begin = (text: string, pictures: readonly ChatImage[]): void => {
    // A chat past its bound lets its oldest whole turns go, here and never in the middle of a turn.
    const over = entries.length + 1 - MAX_ENTRIES;
    const cut = over > 0 ? turnStart(entries, over) : 0;
    batch(() => {
      if (cut > 0) setDropped(dropped() + cut);
      setEntries(
        produce((list) => {
          if (cut > 0) list.splice(0, cut);
          list.push({ kind: "user", text, pictures: pictures.length, at: Date.now() });
        }),
      );
    });
    const message: ChatMessage = pictures.length === 0 ? { role: "user", content: text } : { role: "user", content: text, images: pictures };
    const next: ChatMessage[] = [...conversation(), message];
    setConversation(next);
    start(next);
  };

  /** Send the draft, or queue it behind the running turn. The turn runs in the background;
   *  `whenIdle()` resolves when it (and whatever the queue sent after it) is over. */
  const send = (): SendOutcome => {
    const text = input().trim();
    if (text === "") return "empty";
    if (!ready()) return "unconfigured";
    if (text.length > MAX_MESSAGE_CHARS) return "too-long";
    const pictures = attached();
    setInput("");
    setAttached([]);
    if (running()) {
      setQueued(produce((list) => void list.push({ text, pictures })));
      return "queued";
    }
    begin(text, pictures);
    return "sent";
  };

  /** Send one queued message now (only when no turn runs). */
  const sendQueued = (index: number): void => {
    if (running()) return;
    const item = queued[index];
    if (item === undefined) return;
    const { text, pictures } = item;
    setQueued(produce((list) => void list.splice(index, 1)));
    begin(text, pictures);
  };

  const unqueue = (index: number): void => {
    setQueued(produce((list) => void list.splice(index, 1)));
  };

  const stop = (): void => {
    controller?.abort();
  };

  /**
   * Whether the last request can simply be asked again: it failed, and no tool ran since the
   * reader's message (a turn that already changed the drawing is not repeated blindly).
   */
  const canRetry = (): boolean => {
    if (running()) return false;
    if (entries[entries.length - 1]?.kind !== "failed") return false;
    for (let i = entries.length - 1; i >= 0; i--) {
      const kind = entries[i]?.kind;
      if (kind === "user") return true;
      if (kind === "tool" || kind === "assistant") return false;
    }
    return false;
  };

  /** Ask again: drop the failure rows and run the same conversation. */
  const retry = (): void => {
    if (!canRetry()) return;
    setEntries(
      produce((list) => {
        while (list[list.length - 1]?.kind === "failed") list.pop();
      }),
    );
    start([...conversation()]);
  };

  /** Take the drawing back to before the assistant's unresolved changes (`undoto`). */
  const undoChanges = (): void => {
    const c = changes();
    if (c === null || running()) return;
    const env = opts.facade.execute("undoto", { depth: c.depth });
    ranSince = [];
    setChanges(null);
    setStatus(env.ok ? `Undid ${plural(c.steps, "change", "changes")} to the drawing` : env.error);
    opts.onChanged();
  };

  const keepChanges = (): void => {
    ranSince = [];
    setChanges(null);
  };

  /** A new chat: stop the turn and forget the conversation, the queue, the draft and the bar. */
  const clear = (): void => {
    controller?.abort();
    pendingText = "";
    setDropped(0);
    setEntries(produce((list) => void list.splice(0, list.length)));
    setQueued(produce((list) => void list.splice(0, list.length)));
    setConversation([]);
    setAttached([]);
    setInput("");
    ranSince = [];
    setChanges(null);
    setStatus("");
  };

  const toggleTool = (index: number): void => {
    setEntries(
      produce((list) => {
        const entry = list[index];
        if (entry?.kind === "tool") entry.open = !entry.open;
      }),
    );
  };

  const setProvider = (p: ProviderConfig): void => {
    setProviderSignal(p);
    saveProvider(p);
  };

  return {
    entries,
    queued,
    running,
    status,
    setStatus,
    provider,
    setProvider,
    input,
    setInput,
    attached,
    setAttached,
    changes,
    selectionIncluded,
    setSelectionIncluded,
    used,
    overBy,
    dropped,
    ready,
    title,
    send,
    sendQueued,
    unqueue,
    stop,
    canRetry,
    retry,
    undoChanges,
    keepChanges,
    clear,
    toggleTool,
    /** Resolves when no turn runs and the queue has nothing more to send by itself. */
    whenIdle: async (): Promise<void> => {
      let seen: Promise<void> | null = null;
      while (seen !== turn) {
        seen = turn;
        await seen;
      }
    },
  };
}

export type AssistantSession = ReturnType<typeof createAssistantSession>;
