/**
 * The composer: the assistant's floating panel over the drawing area, built to Cursor's measured
 * composer recipe (`.design-system/cursor/recipes.md` §1) — the box is `input.background` with a
 * 1px border that turns active on focus, radius 5px, `padding: 6px`, `gap: 6px`, a
 * `0 0 4px 1px` shadow and the `border-color .1s ease-in-out, box-shadow .1s ease-in-out`
 * transition; the button row under the input is `flex` with a `4px` gap; the model chip is a
 * ghost button at `opacity .8` that rises to `1` on hover; the running state carries the
 * `ripple 1.2s` dot. The transcript above it follows the agent-panel grammar: a prompt in a quiet
 * inset block, the model's words plain on the surface, and each tool call one dim line that opens
 * on click to the code and the report.
 *
 * The turn itself lives in `../assistant.ts`; this component owns the view state, the provider
 * settings (kept in `localStorage`), and the `run` executor (the shell's own `engine.execute`).
 */

import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch, type JSX } from "solid-js";
import type { AppFacade } from "../facade";
import {
  MAX_REQUEST_CHARS,
  PROVIDER_PRESETS,
  runTurn,
  type AssistantEvent,
  type Briefing,
  type ChatMessage,
  type ProviderConfig,
} from "../assistant";
import { ToolIcon } from "../icons";
import "../assistant.css";

export interface AssistantPaneProps {
  facade: AppFacade;
  /** The drawing changed (a tool call ran): re-read what the surfaces show. */
  onChanged: () => void;
}

interface ToolEntry {
  kind: "tool";
  name: string;
  code: string;
  report: string;
  ok: boolean;
  note: string;
  open: boolean;
}

type Entry = { kind: "user"; text: string } | { kind: "assistant"; text: string } | { kind: "failed"; text: string } | ToolEntry;

const STORAGE_KEY = "cadcraft.assistant.provider";

/** The provider settings the pane keeps: the last one saved in this browser. */
function loadProvider(): ProviderConfig {
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

function saveProvider(p: ProviderConfig): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // a full or blocked storage is not worth failing the composer over
  }
}

/** How full the context is: the characters the conversation would send, against the budget. */
function contextUsed(conversation: readonly ChatMessage[]): number {
  return conversation.reduce(
    (n, m) => n + (m.content ?? "").length + (m.toolCalls ?? []).reduce((k, c) => k + c.name.length + JSON.stringify(c.args ?? {}).length, 0),
    0,
  );
}

export function AssistantPane(props: AssistantPaneProps): JSX.Element {
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [conversation, setConversation] = createSignal<ChatMessage[]>([]);
  const [input, setInput] = createSignal("");
  const [running, setRunning] = createSignal(false);
  const [status, setStatus] = createSignal("");
  const [provider, setProvider] = createSignal<ProviderConfig>(loadProvider());
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<ProviderConfig>(loadProvider());
  let transcript: HTMLDivElement | undefined;
  let controller: AbortController | null = null;

  const used = createMemo(() => contextUsed(conversation()));
  const ready = createMemo(() => provider().baseUrl !== "" && provider().model !== "");

  // The transcript follows the conversation as it grows.
  createEffect(() => {
    entries();
    if (transcript !== undefined) queueMicrotask(() => (transcript as HTMLDivElement).scrollTop = (transcript as HTMLDivElement).scrollHeight);
  });

  onCleanup(() => controller?.abort());

  /** The briefing the model is told about the drawing, read fresh at the start of every turn. */
  const briefing = (): Briefing => {
    const state = props.facade.drawingState();
    return {
      app: "CADCraft (browser)",
      drawing: state?.title ?? "",
      units: state?.units ?? "",
      objects: state?.entityCount ?? 0,
      selection: props.facade.selection().handles.length,
      extents: state?.extents === null || state?.extents === undefined ? null : [state.extents.x0, state.extents.y0, state.extents.x1, state.extents.y1],
    };
  };

  const onEvent = (e: AssistantEvent): void => {
    if (e.type === "text") {
      setStatus("");
      setEntries((prev) => {
        const last = prev[prev.length - 1];
        if (last?.kind === "assistant") return [...prev.slice(0, -1), { kind: "assistant", text: last.text + e.text }];
        return [...prev, { kind: "assistant", text: e.text }];
      });
      return;
    }
    if (e.type === "call") {
      setStatus(`Running ${e.name}…`);
      setEntries((prev) => [...prev, { kind: "tool", name: e.name, code: e.code, report: "", ok: true, note: "running…", open: false }]);
      return;
    }
    if (e.type === "result") {
      setStatus("");
      setEntries((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          const entry = next[i];
          if (entry?.kind === "tool" && entry.report === "") {
            next[i] = { ...entry, ok: e.ok, note: e.note, report: e.report };
            break;
          }
        }
        return next;
      });
      props.onChanged();
      return;
    }
    if (e.type === "failed") {
      setStatus("");
      setEntries((prev) => [...prev, { kind: "failed", text: e.error }]);
      return;
    }
    setStatus("");
  };

  const send = async (): Promise<void> => {
    const text = input().trim();
    if (text === "" || running()) return;
    if (!ready()) {
      setMenuOpen(true);
      setDraft(provider());
      return;
    }
    setInput("");
    setEntries((prev) => [...prev, { kind: "user", text }]);
    const next: ChatMessage[] = [...conversation(), { role: "user", content: text }];
    setConversation(next);
    setRunning(true);
    setStatus("Thinking…");
    controller = new AbortController();
    try {
      await runTurn({
        provider: provider(),
        briefing: briefing(),
        conversation: next,
        execute: (code, values) => {
          const env = props.facade.execute("run", values === null ? { code } : { code, values });
          return env.ok ? { ok: true, result: env.result } : { ok: false, error: env.error };
        },
        onEvent,
        signal: controller.signal,
      });
    } finally {
      setConversation([...next]);
      setRunning(false);
      setStatus("");
      controller = null;
    }
  };

  const stop = (): void => {
    controller?.abort();
  };

  const newChat = (): void => {
    controller?.abort();
    setEntries([]);
    setConversation([]);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    void send();
  };

  const applyPreset = (id: string): void => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === id);
    if (preset === undefined) return;
    setDraft({ baseUrl: preset.baseUrl, model: preset.model, apiKey: draft().apiKey });
  };

  const saveDraft = (): void => {
    const p = draft();
    setProvider(p);
    saveProvider(p);
    setMenuOpen(false);
  };

  const toggleTool = (index: number): void => {
    setEntries((prev) => prev.map((entry, i) => (i === index && entry.kind === "tool" ? { ...entry, open: !entry.open } : entry)));
  };

  const modelLabel = createMemo(() => (ready() ? provider().model : "Set up model"));

  return (
    <div class="assistant" role="region" aria-label="Assistant">
      <Show when={entries().length > 0}>
        <div class="assistant-transcript" ref={transcript}>
          <For each={entries()}>
            {(entry, index) => (
              <Switch>
                <Match when={entry.kind === "user"}>
                  <div class="assistant-prompt">{entry.kind === "user" ? entry.text : ""}</div>
                </Match>
                <Match when={entry.kind === "assistant"}>
                  <div class="assistant-text">{entry.kind === "assistant" ? entry.text : ""}</div>
                </Match>
                <Match when={entry.kind === "failed"}>
                  <div class="assistant-failed">{entry.kind === "failed" ? entry.text : ""}</div>
                </Match>
                <Match when={entry.kind === "tool"}>
                  <button class="assistant-tool" type="button" onClick={() => toggleTool(index())} aria-expanded={entry.kind === "tool" && entry.open}>
                    <span class="assistant-tool-arrow">{entry.kind === "tool" && entry.open ? "▾" : "▸"}</span>
                    <span class="assistant-tool-name">{entry.kind === "tool" ? entry.name : ""}</span>
                    <span class="assistant-tool-note">{entry.kind === "tool" ? entry.note : ""}</span>
                  </button>
                  <Show when={entry.kind === "tool" && entry.open}>
                    <div class="assistant-detail">
                      <pre class="assistant-code">{entry.kind === "tool" ? entry.code : ""}</pre>
                      <Show when={entry.kind === "tool" && entry.report !== ""}>
                        <pre class="assistant-report">{entry.kind === "tool" ? entry.report : ""}</pre>
                      </Show>
                    </div>
                  </Show>
                </Match>
              </Switch>
            )}
          </For>
        </div>
      </Show>

      <div class="assistant-box">
        <Show when={running()}>
          <div class="assistant-status">
            <span class="assistant-ripple" />
            <span>{status()}</span>
          </div>
        </Show>
        <textarea
          class="assistant-input"
          rows={1}
          placeholder="Ask the assistant…"
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          aria-label="Ask the assistant"
        />
        <div class="assistant-row">
          <button
            class="assistant-ghost"
            type="button"
            title={ready() ? `${provider().baseUrl} · ${provider().model}` : "Choose a provider and model"}
            onClick={() => {
              setDraft(provider());
              setMenuOpen((v) => !v);
            }}
          >
            <span class="assistant-ghost-label">{modelLabel()}</span>
            <span class="assistant-ghost-caret">▾</span>
          </button>
          <Show when={entries().length > 0}>
            <button class="assistant-ghost" type="button" title="Start a new conversation" onClick={newChat}>
              New chat
            </button>
          </Show>
          <div class="assistant-actions">
            <span class="assistant-context" title={`${used()} characters of the ${MAX_REQUEST_CHARS} the model can be sent`}>
              {used() === 0 ? "" : `${Math.round(used() / 100) / 10}k / ${Math.round(MAX_REQUEST_CHARS / 1000)}k`}
            </span>
            <Show
              when={running()}
              fallback={
                <button class="assistant-send" type="button" title="Send (Enter)" disabled={input().trim() === ""} onClick={() => void send()}>
                  <ToolIcon id="send" />
                </button>
              }
            >
              <button class="assistant-send" type="button" title="Stop" onClick={stop}>
                <ToolIcon id="stop" />
              </button>
            </Show>
          </div>
        </div>
        <Show when={menuOpen()}>
          <div class="assistant-menu">
            <div class="assistant-menu-title">Provider</div>
            <For each={PROVIDER_PRESETS}>
              {(preset) => (
                <button class="assistant-preset" type="button" onClick={() => applyPreset(preset.id)}>
                  <span>{preset.label}</span>
                  <span class="assistant-preset-url">{preset.baseUrl === "" ? "—" : preset.baseUrl.replace(/^https?:\/\//, "")}</span>
                </button>
              )}
            </For>
            <label class="assistant-field">
              <span>Base URL</span>
              <input value={draft().baseUrl} onInput={(e) => setDraft({ ...draft(), baseUrl: e.currentTarget.value })} placeholder="http://127.0.0.1:11434/v1" />
            </label>
            <label class="assistant-field">
              <span>Model</span>
              <input value={draft().model} onInput={(e) => setDraft({ ...draft(), model: e.currentTarget.value })} placeholder="llama3.2" />
            </label>
            <label class="assistant-field">
              <span>API key</span>
              <input type="password" value={draft().apiKey} onInput={(e) => setDraft({ ...draft(), apiKey: e.currentTarget.value })} placeholder="left empty for a local server" />
            </label>
            <div class="assistant-menu-actions">
              <button class="assistant-ghost" type="button" onClick={() => setMenuOpen(false)}>
                Cancel
              </button>
              <button class="assistant-save" type="button" onClick={saveDraft}>
                Save
              </button>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
