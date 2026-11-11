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

import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { AppFacade } from "./facade";
import { activityLine, runTurn, type AssistantEvent, type Briefing, type ChatImage, type ChatMessage, type ProviderConfig, type TurnOptions } from "./assistant";

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

/** What `send` did: sent the draft, queued it behind the running turn, had nothing to send, or
 *  needs a provider first. */
export type SendOutcome = "sent" | "queued" | "empty" | "unconfigured";

export interface SessionOptions {
  facade: SessionFacade;
  /** The drawing changed (a tool call ran, or the changes were undone): re-read the surfaces. */
  onChanged: () => void;
  /** Injectable for tests; the real one is `fetch`. */
  fetchImpl?: typeof fetch;
}

const STORAGE_KEY = "cadcraft.assistant.provider";

/** The provider settings the session keeps: the last one saved in this browser. */
export function loadProvider(): ProviderConfig {
  const empty: ProviderConfig = { baseUrl: "", model: "", apiKey: "" };
  if (typeof localStorage === "undefined") return empty;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return empty;
    const v = JSON.parse(raw) as Record<string, unknown>;
    return {
      baseUrl: typeof v["baseUrl"] === "string" ? v["baseUrl"] : "",
      model: typeof v["model"] === "string" ? v["model"] : "",
      apiKey: typeof v["apiKey"] === "string" ? v["apiKey"] : "",
    };
  } catch {
    return empty;
  }
}

export function saveProvider(p: ProviderConfig): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // a full or blocked storage is not worth failing the composer over
  }
}

/** How full the context is: the characters the conversation would send, against the budget. */
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
  let controller: AbortController | null = null;
  let turn: Promise<void> = Promise.resolve();
  /** How the last turn ended; a queue only continues by itself after a clean end. */
  let lastEnd: "done" | "stopped" | "failed" = "done";
  /** Tool calls made so far this turn, for the status line. */
  let steps = 0;
  /** The code of each tool call that succeeded since the open checkpoint. */
  let ranSince: string[] = [];

  const used = (): number => contextUsed(conversation());
  const ready = (): boolean => provider().baseUrl !== "" && provider().model !== "";
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

  const onEvent = (e: AssistantEvent): void => {
    if (e.type === "text") {
      setEntries(
        produce((list) => {
          const last = list[list.length - 1];
          if (last?.kind === "assistant") last.text += e.text;
          else list.push({ kind: "assistant", text: e.text, at: Date.now() });
        }),
      );
      return;
    }
    if (e.type === "call") {
      steps += 1;
      setStatus(`Working, ${plural(steps, "step", "steps")}…`);
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
    steps = 0;
    setRunning(true);
    setStatus("Thinking…");
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
    try {
      await runTurn(options);
    } finally {
      setConversation([...next]);
      setRunning(false);
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
    setEntries(produce((list) => void list.push({ kind: "user", text, pictures: pictures.length, at: Date.now() })));
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
