/**
 * The assistant panel: the agent docked to the right of the workspace. The part title is the
 * classic recipe's (35px, padding 8px); the composer is the glass one measured on Cursor 3.27's
 * composer (`.design-system/research/cursor-recipes-2026-10-28.md` §2): the elevated surface at
 * radius 20, no shadow, a 1px border that turns active on focus, an editor at 15px/24px with a
 * 64px min-height and 8px/12px padding, and a 40px toolbar row (padding 8px, `gap: 4px`) that
 * holds 24px circles and the pill model chip; send and stop are the inverted circle. Its controls
 * are the system's own: `ui/IconButton` (attach, remove-attachment, stop, send), `ui/Row` (the
 * preset rows), `ui/Field` (the provider inputs) and `ui/Button` (Cancel, Save). The running dot
 * carries §1.14's `ripple 1.2s` to `scale(1.7)`.
 *
 * The transcript is the agent-panel grammar: a prompt in a quiet inset block, the model's words
 * plain on the surface (with inline `code` and **bold** runs), and each tool call one dim line
 * that opens on click to its code and report.
 *
 * The turn itself lives in `../assistant.ts`; this component owns the view state, the provider
 * settings (kept in `localStorage`), the attachments (paperclip, paste, drop — they travel to the
 * model in the vision shape) and the `run` executor (the shell's own `engine.execute`).
 */

import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js";
import type { AppFacade } from "../facade";
import {
  MAX_REQUEST_CHARS,
  parseInline,
  PROVIDER_PRESETS,
  runTurn,
  type AssistantEvent,
  type Briefing,
  type ChatImage,
  type ChatMessage,
  type ProviderConfig,
} from "../assistant";
import { ToolIcon } from "../icons";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import "../assistant.css";

export interface AssistantPaneProps {
  facade: AppFacade;
  /** The drawing changed (a tool call ran): re-read what the surfaces show. */
  onChanged: () => void;
  /** The panel's close button. */
  onClose: () => void;
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

type Entry =
  | { kind: "user"; text: string; pictures: number }
  | { kind: "assistant"; text: string }
  | { kind: "failed"; text: string }
  | ToolEntry;

const STORAGE_KEY = "cadcraft.assistant.provider";

/** The empty state's examples: one click fills the composer. */
const EXAMPLES: readonly string[] = ["Draw a 20 mm circle at 0,0", "What is the total length of the lines?", "List the layers and what is on them"];

/** How many pictures one message may carry, and how large each may be. */
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 4 << 20;

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
    (n, m) =>
      n +
      (m.content ?? "").length +
      (m.images ?? []).reduce((k, img) => k + img.dataUrl.length, 0) +
      (m.toolCalls ?? []).reduce((k, c) => k + c.name.length + JSON.stringify(c.args ?? {}).length, 0),
    0,
  );
}

/** Read a file as a data URL (the wire wants base64; the reader's file is never uploaded). */
function readAsDataUrl(file: File): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error("could not read the file"));
  reader.readAsDataURL(file);
  return promise;
}

/** The textarea grows with its content between the recipe's min and max (64px … 240px). */
function grow(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 64), 240)}px`;
}

export function AssistantPane(props: AssistantPaneProps): JSX.Element {
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [conversation, setConversation] = createSignal<ChatMessage[]>([]);
  const [input, setInput] = createSignal("");
  const [attached, setAttached] = createSignal<readonly ChatImage[]>([]);
  const [running, setRunning] = createSignal(false);
  const [status, setStatus] = createSignal("");
  const [provider, setProvider] = createSignal<ProviderConfig>(loadProvider());
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<ProviderConfig>(loadProvider());
  let body: HTMLDivElement | undefined;
  let inputEl: HTMLTextAreaElement | undefined;
  let fileInput: HTMLInputElement | undefined;
  let controller: AbortController | null = null;

  const used = createMemo(() => contextUsed(conversation()));
  const ready = createMemo(() => provider().baseUrl !== "" && provider().model !== "");
  const title = createMemo(() => {
    const first = entries().find((e) => e.kind === "user");
    if (first === undefined || first.kind !== "user") return "New chat";
    const line = first.text.split("\n")[0] ?? "";
    return line.length > 48 ? `${line.slice(0, 48)}…` : line;
  });

  // The transcript follows the conversation as it grows.
  createEffect(() => {
    entries();
    if (body !== undefined) queueMicrotask(() => (body as HTMLDivElement).scrollTop = (body as HTMLDivElement).scrollHeight);
  });

  onMount(() => inputEl?.focus());
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

  /** Add files from the picker, a paste or a drop: pictures only, within the caps. */
  const addFiles = async (files: readonly File[]): Promise<void> => {
    const pictures = files.filter((f) => f.type.startsWith("image/"));
    if (pictures.length === 0) return;
    const room = MAX_ATTACHMENTS - attached().length;
    if (room <= 0) {
      setStatus(`At most ${MAX_ATTACHMENTS} pictures per message.`);
      return;
    }
    const accepted: ChatImage[] = [];
    for (const file of pictures.slice(0, room)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setStatus(`${file.name} is too large (limit ${Math.round(MAX_ATTACHMENT_BYTES / (1 << 20))} MB).`);
        continue;
      }
      try {
        accepted.push({ name: file.name === "" ? "pasted.png" : file.name, dataUrl: await readAsDataUrl(file) });
      } catch {
        setStatus(`${file.name} could not be read.`);
      }
    }
    if (accepted.length > 0) setAttached((prev) => [...prev, ...accepted]);
  };

  const onPaste = (e: ClipboardEvent): void => {
    const files = [...(e.clipboardData?.items ?? [])]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
  };

  const onDrop = (e: DragEvent): void => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
  };

  const send = async (): Promise<void> => {
    const text = input().trim();
    if (text === "" || running()) return;
    if (!ready()) {
      setDraft(provider());
      setMenuOpen(true);
      return;
    }
    const pictures = attached();
    setInput("");
    if (inputEl !== undefined) inputEl.style.height = "";
    setAttached([]);
    setEntries((prev) => [...prev, { kind: "user", text, pictures: pictures.length }]);
    const message: ChatMessage = pictures.length === 0 ? { role: "user", content: text } : { role: "user", content: text, images: pictures };
    const next: ChatMessage[] = [...conversation(), message];
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
    setAttached([]);
    setInput("");
    if (inputEl !== undefined) inputEl.style.height = "";
    inputEl?.focus();
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
    inputEl?.focus();
  };

  const toggleTool = (index: number): void => {
    setEntries((prev) => prev.map((entry, i) => (i === index && entry.kind === "tool" ? { ...entry, open: !entry.open } : entry)));
  };

  /** The model's words, with inline `code` and **bold** runs rendered as elements. */
  const richText = (text: string): JSX.Element => (
    <For each={parseInline(text)}>
      {(part) => (part.kind === "bold" ? <strong>{part.text}</strong> : part.kind === "code" ? <code>{part.text}</code> : part.text)}
    </For>
  );

  return (
    <aside
      class="assistant-panel"
      role="complementary"
      aria-label="Assistant"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div class="assistant-head">
        <span class="assistant-title" title={title()}>
          {title()}
        </span>
        <div class="assistant-head-actions">
          <button class="assistant-icon" type="button" title="New chat" aria-label="New chat" onClick={newChat}>
            <ToolIcon id="plus" />
          </button>
          <button class="assistant-icon" type="button" title="Close" aria-label="Close" onClick={() => props.onClose()}>
            <ToolIcon id="close" />
          </button>
        </div>
      </div>

      <div class="assistant-body" ref={body}>
        <Show when={entries().length === 0}>
          <div class="assistant-empty">
            <p>The assistant works in the open drawing: it draws, measures and changes it, and reports the numbers.</p>
            <For each={EXAMPLES}>
              {(example) => (
                <button
                  class="assistant-example"
                  type="button"
                  onClick={() => {
                    setInput(example);
                    inputEl?.focus();
                  }}
                >
                  {example}
                </button>
              )}
            </For>
          </div>
        </Show>
        <For each={entries()}>
          {(entry, index) => (
            <Switch>
              <Match when={entry.kind === "user"}>
                <div class="assistant-prompt">
                  {entry.kind === "user" ? entry.text : ""}
                  {entry.kind === "user" && entry.pictures > 0 ? <span class="assistant-prompt-pics">{` · ${entry.pictures} picture${entry.pictures === 1 ? "" : "s"}`}</span> : ""}
                </div>
              </Match>
              <Match when={entry.kind === "assistant"}>
                <div class="assistant-text">{entry.kind === "assistant" ? richText(entry.text) : ""}</div>
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

      <div class="assistant-composer">
        <div class="assistant-box">
          <Show when={attached().length > 0}>
            <div class="assistant-attachments">
              <For each={attached()}>
                {(picture, index) => (
                  <span class="assistant-attachment">
                    <img src={picture.dataUrl} alt={picture.name} />
                    <span class="assistant-attachment-name">{picture.name}</span>
                    <IconButton icon="close" size="sm" title={`Remove ${picture.name}`} onClick={() => setAttached((prev) => prev.filter((_, i) => i !== index()))} />
                  </span>
                )}
              </For>
            </div>
          </Show>
          <Show when={status() !== ""}>
            <div class="assistant-status">
              <Show when={running()}>
                <span class="assistant-ripple" />
              </Show>
              <span>{status()}</span>
            </div>
          </Show>
          <textarea
            class="assistant-input"
            ref={inputEl}
            rows={1}
            placeholder="Ask the assistant…"
            value={input()}
            onInput={(e) => {
              setInput(e.currentTarget.value);
              grow(e.currentTarget);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            aria-label="Ask the assistant"
          />
          <div class="assistant-row">
            <IconButton icon="attach" variant="soft" title="Attach a picture (or paste, or drop one)" onClick={() => fileInput?.click()} />
            <div class="assistant-actions">
              <button
                class="assistant-ghost"
                type="button"
                title={ready() ? `${provider().baseUrl} · ${provider().model}` : "Choose a provider and model"}
                onClick={() => {
                  setDraft(provider());
                  setMenuOpen((v) => !v);
                }}
              >
                <span class="assistant-ghost-label">{ready() ? provider().model : "Set up model"}</span>
                <span class="assistant-ghost-caret">▾</span>
              </button>
              <span class="assistant-context" title={`${used()} characters of the ${MAX_REQUEST_CHARS} the model can be sent`}>
                {used() === 0 ? "" : `${Math.round(used() / 100) / 10}k / ${Math.round(MAX_REQUEST_CHARS / 1000)}k`}
              </span>
              <Show
                when={running()}
                fallback={
                  <IconButton icon="send" variant="inverted" title="Send (Enter)" disabled={input().trim() === ""} onClick={() => void send()} />
                }
              >
                <IconButton icon="stop" variant="inverted" title="Stop" onClick={stop} />
              </Show>
            </div>
          </div>
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            ref={fileInput}
            onChange={(e) => {
              const files = [...(e.currentTarget.files ?? [])];
              e.currentTarget.value = "";
              void addFiles(files);
            }}
          />
          <Show when={menuOpen()}>
            <div class="assistant-menu">
              <div class="assistant-menu-title">Provider</div>
              <For each={PROVIDER_PRESETS}>
                {(preset) => (
                  <Row onClick={() => applyPreset(preset.id)}>
                    <span class="assistant-preset-label">{preset.label}</span>
                    <span class="assistant-preset-url">{preset.baseUrl === "" ? "—" : preset.baseUrl.replace(/^https?:\/\//, "")}</span>
                  </Row>
                )}
              </For>
              <div class="assistant-field">
                <span>Base URL</span>
                <Field value={draft().baseUrl} ariaLabel="Base URL" placeholder="http://127.0.0.1:11434/v1" onInput={(v) => setDraft({ ...draft(), baseUrl: v })} />
              </div>
              <div class="assistant-field">
                <span>Model</span>
                <Field value={draft().model} ariaLabel="Model" placeholder="llama3.2" onInput={(v) => setDraft({ ...draft(), model: v })} />
              </div>
              <div class="assistant-field">
                <span>API key</span>
                <Field type="password" value={draft().apiKey} ariaLabel="API key" placeholder="left empty for a local server" onInput={(v) => setDraft({ ...draft(), apiKey: v })} />
              </div>
              <div class="assistant-menu-actions">
                <Button variant="ghost" onClick={() => setMenuOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={saveDraft}>
                  Save
                </Button>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </aside>
  );
}
