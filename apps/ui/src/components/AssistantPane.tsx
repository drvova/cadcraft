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
 * Over the composer sits the stack (the reference board's "one surface over the input"): what is
 * queued behind the running turn, the turn's status with Stop, and the assistant's unresolved
 * changes to the drawing with Undo all and Keep. The canvas selection rides in the card as a chip.
 *
 * The turn and the conversation live in `../assistant-session.ts`, which outlives this panel; the
 * component owns only the view state (the provider popover, the scroll follow, the element refs)
 * and the attachment intake (paperclip, paste, drop — they travel to the model in the vision
 * shape).
 */

import { createEffect, createMemo, createSignal, For, Index, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js";
import { activityLine, atEnd, clampPanelWidth, MAX_REQUEST_CHARS, PANEL_WIDTH, parseBlocks, parseInline, PROVIDER_PRESETS, relativeTime, splitFences, type ChatImage, type ProseBlock, type ProviderConfig } from "../assistant";
import type { AssistantSession } from "../assistant-session";
import { ToolIcon } from "../icons";
import { Tooltip } from "../ui/Tooltip";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import "../assistant.css";

export interface AssistantPaneProps {
  /** The conversation, the draft and the running turn (the shell owns it; it outlives the panel). */
  session: AssistantSession;
  /** The canvas selection's handles (the shell's signal); drives the context chip. */
  selection: () => readonly string[];
  /** Every open chat's title, in tab order, and which one this panel shows. */
  chats: () => readonly string[];
  chatIndex: () => number;
  onSelectChat: (index: number) => void;
  /** Open a chat beside the others (the shell keeps this one). */
  onNewChat: () => void;
  onCloseChat: (index: number) => void;
  /** The panel's close button. */
  onClose: () => void;
}

/** The empty state's suggestions: one click fills the composer (the measured 32px suggestion row). */
const EXAMPLES: readonly { icon: string; text: string }[] = [
  { icon: "circle", text: "Draw a 20 mm circle at 0,0" },
  { icon: "dist", text: "What is the total length of the lines?" },
  { icon: "ui.dialog.layers", text: "List the layers and what is on them" },
];

/** How many pictures one message may carry, and how large each may be. */
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 4 << 20;

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

const headingLevel = (b: ProseBlock): number => (b.kind === "heading" ? b.level : 0);
const textOf = (b: ProseBlock): string => (b.kind === "list" ? "" : b.text);
const itemsOf = (b: ProseBlock): readonly string[] => (b.kind === "list" ? b.items : []);
const orderedList = (b: ProseBlock): boolean => b.kind === "list" && b.ordered;

const WIDTH_KEY = "cadcraft.assistant.width";

/** The panel's width as this browser last left it. */
function loadWidth(): number {
  if (typeof localStorage === "undefined") return PANEL_WIDTH.initial;
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    return raw === null ? PANEL_WIDTH.initial : clampPanelWidth(Number(raw), window.innerWidth);
  } catch {
    return PANEL_WIDTH.initial;
  }
}

function saveWidth(width: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // a full or blocked storage is not worth failing a resize over
  }
}

export function AssistantPane(props: AssistantPaneProps): JSX.Element {
  const s = props.session;
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<ProviderConfig>(s.provider());
  /** The panel's width; the reader drags its left edge, and it is kept for next time. */
  const [width, setWidth] = createSignal(loadWidth());
  let drag: { x: number; width: number } | null = null;
  const resizeTo = (wanted: number): void => {
    const next = clampPanelWidth(wanted, window.innerWidth);
    setWidth(next);
    saveWidth(next);
  };
  const onResizeKey = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") resizeTo(width() + step);
    else if (e.key === "ArrowRight") resizeTo(width() - step);
    else if (e.key === "Home") resizeTo(PANEL_WIDTH.initial);
    else return;
    e.preventDefault();
  };
  /** The changes row is open: the steps the assistant took are listed above it. */
  const [changesOpen, setChangesOpen] = createSignal(false);
  /** The transcript keeps to its end only while the reader is there. */
  const [following, setFollowing] = createSignal(true);
  /** The transcript's ages move: the clock is re-read twice a minute. */
  const [now, setNow] = createSignal(Date.now());
  let body: HTMLDivElement | undefined;
  let inputEl: HTMLTextAreaElement | undefined;
  let fileInput: HTMLInputElement | undefined;

  const tick = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(tick));

  // The transcript follows the conversation as it grows, while the reader is at its end.
  createEffect(() => {
    void s.entries.length;
    const last = s.entries[s.entries.length - 1];
    if (last !== undefined && last.kind !== "tool") void last.text;
    if (!following() || body === undefined) return;
    const el = body;
    queueMicrotask(() => (el.scrollTop = el.scrollHeight));
  });

  // A new selection is context again, even if the last one was left out. The shell hands a fresh
  // array after every command, so what is selected is compared, not the array.
  const selectionKey = createMemo(() => props.selection().join(","));
  createEffect(on(selectionKey, () => s.setSelectionIncluded(true), { defer: true }));
  const selectionShown = (): boolean => props.selection().length > 0 && s.selectionIncluded();

  onMount(() => {
    inputEl?.focus();
    if (inputEl !== undefined && s.input() !== "") grow(inputEl);
  });

  /** Add files from the picker, a paste or a drop: pictures only, within the caps. */
  const addFiles = async (files: readonly File[]): Promise<void> => {
    const pictures = files.filter((f) => f.type.startsWith("image/"));
    if (pictures.length === 0) return;
    const room = MAX_ATTACHMENTS - s.attached().length;
    if (room <= 0) {
      s.setStatus(`At most ${MAX_ATTACHMENTS} pictures per message.`);
      return;
    }
    const accepted: ChatImage[] = [];
    for (const file of pictures.slice(0, room)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        s.setStatus(`${file.name} is too large (limit ${Math.round(MAX_ATTACHMENT_BYTES / (1 << 20))} MB).`);
        continue;
      }
      try {
        accepted.push({ name: file.name === "" ? "pasted.png" : file.name, dataUrl: await readAsDataUrl(file) });
      } catch {
        s.setStatus(`${file.name} could not be read.`);
      }
    }
    if (accepted.length > 0) s.setAttached([...s.attached(), ...accepted]);
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

  const send = (): void => {
    const outcome = s.send();
    if (outcome === "unconfigured") {
      setDraft(s.provider());
      setMenuOpen(true);
      return;
    }
    if (outcome === "empty") return;
    if (inputEl !== undefined) inputEl.style.height = "";
    // The reader's own message always comes into view.
    setFollowing(true);
  };

  /** Copy a message or a tool's code (the turn-actions affordance). */
  const copyText = (text: string): void => {
    void navigator.clipboard?.writeText(text);
  };

  const newChat = (): void => {
    props.onNewChat();
    inputEl?.focus();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    send();
  };

  /** Escape closes the popover, or stops the turn; it never reaches the shell's own Escape. */
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (menuOpen()) {
      setMenuOpen(false);
      inputEl?.focus();
    } else if (s.running()) {
      s.stop();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const applyPreset = (id: string): void => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === id);
    if (preset === undefined) return;
    setDraft({ baseUrl: preset.baseUrl, model: preset.model, apiKey: draft().apiKey });
  };

  const saveDraft = (): void => {
    s.setProvider(draft());
    setMenuOpen(false);
    inputEl?.focus();
  };

  /** The model's words, with inline `code` and **bold** runs rendered as elements. */
  const richText = (text: string): JSX.Element => (
    <For each={parseInline(text)}>
      {(part) => (part.kind === "bold" ? <strong>{part.text}</strong> : part.kind === "code" ? <code>{part.text}</code> : part.text)}
    </For>
  );

  /** A reply's prose as its blocks: headings, lists and paragraphs, each with its inline runs. */
  const prose = (text: string): JSX.Element => (
    <Index each={parseBlocks(text)}>
      {(block) => (
        <Switch>
          <Match when={block().kind === "heading"}>
            <h3 class={headingLevel(block()) <= 2 ? "assistant-heading" : "assistant-heading assistant-heading--minor"}>{richText(textOf(block()))}</h3>
          </Match>
          <Match when={block().kind === "list" && orderedList(block())}>
            <ol class="assistant-list">
              <For each={itemsOf(block())}>{(item) => <li>{richText(item)}</li>}</For>
            </ol>
          </Match>
          <Match when={block().kind === "list"}>
            <ul class="assistant-list">
              <For each={itemsOf(block())}>{(item) => <li>{richText(item)}</li>}</For>
            </ul>
          </Match>
          <Match when={block().kind === "para"}>
            <div class="assistant-text">{richText(textOf(block()))}</div>
          </Match>
        </Switch>
      )}
    </Index>
  );

  return (
    <aside
      class="assistant-panel"
      role="complementary"
      aria-label="Assistant"
      style={{ "--assistant-width": `${width()}px` }}
      on:keydown={onEscape}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div
        class="assistant-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the assistant"
        aria-valuemin={PANEL_WIDTH.min}
        aria-valuemax={PANEL_WIDTH.max}
        aria-valuenow={width()}
        tabindex="0"
        onPointerDown={(e) => {
          drag = { x: e.clientX, width: width() };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          if (drag !== null) resizeTo(drag.width + (drag.x - e.clientX));
        }}
        onPointerUp={() => (drag = null)}
        onPointerCancel={() => (drag = null)}
        onDblClick={() => resizeTo(PANEL_WIDTH.initial)}
        onKeyDown={onResizeKey}
      />
      <div class="assistant-head">
        <Show
          when={props.chats().length > 1}
          fallback={
            <span class="assistant-title" title={s.title()}>
              {s.title()}
            </span>
          }
        >
          <div class="assistant-tabs" role="tablist" aria-label="Chats">
            <For each={props.chats()}>
              {(title, index) => (
                <div class={index() === props.chatIndex() ? "assistant-tab is-active" : "assistant-tab"}>
                  <div class="assistant-tab-row">
                    <Row selected={index() === props.chatIndex()} title={title} onClick={() => props.onSelectChat(index())}>
                      <span class="assistant-tab-text">{title}</span>
                    </Row>
                  </div>
                  <IconButton icon="close" size="sm" title={`Close ${title}`} onClick={() => props.onCloseChat(index())} />
                </div>
              )}
            </For>
          </div>
        </Show>
        <div class="assistant-head-actions">
          <Tooltip text="New chat" placement="bottom">
            <button class="assistant-icon" type="button" aria-label="New chat" onClick={newChat}>
              <ToolIcon id="plus" />
            </button>
          </Tooltip>
          <Tooltip text="Close the panel" placement="bottom">
            <button class="assistant-icon" type="button" aria-label="Close the panel" onClick={() => props.onClose()}>
              <ToolIcon id="close" />
            </button>
          </Tooltip>
        </div>
      </div>

      <div
        class="assistant-body"
        ref={body}
        onScroll={(e) => setFollowing(atEnd(e.currentTarget.scrollHeight, e.currentTarget.scrollTop, e.currentTarget.clientHeight))}
      >
        <Show when={s.entries.length === 0}>
          <div class="assistant-empty">
            <p>The assistant works in the open drawing: it draws, measures and changes it, and reports the numbers.</p>
            <For each={EXAMPLES}>
              {(example) => (
                <button
                  class="assistant-example"
                  type="button"
                  onClick={() => {
                    s.setInput(example.text);
                    inputEl?.focus();
                  }}
                >
                  <span class="assistant-example-icon">
                    <ToolIcon id={example.icon} />
                  </span>
                  <span class="assistant-example-text">{example.text}</span>
                  <span class="assistant-example-chevron">
                    <ToolIcon id="chevron-right" />
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>
        <For each={s.entries}>
          {(entry, index) => (
            <Switch>
              <Match when={entry.kind === "user"}>
                <div class="assistant-prompt">
                  {entry.kind === "user" ? entry.text : ""}
                  {entry.kind === "user" && entry.pictures > 0 ? <span class="assistant-prompt-pics">{` · ${entry.pictures} picture${entry.pictures === 1 ? "" : "s"}`}</span> : ""}
                </div>
              </Match>
              <Match when={entry.kind === "assistant"}>
                <Index each={splitFences(entry.kind === "assistant" ? entry.text : "")}>
                  {(part) => (
                    <Show when={part().kind === "code"} fallback={prose(part().text)}>
                      <div class="assistant-code-wrap">
                        <pre class="assistant-code">{part().text}</pre>
                        <span class="assistant-code-copy">
                          <IconButton icon="copy" size="sm" title="Copy the code" onClick={() => copyText(part().text)} />
                        </span>
                      </div>
                    </Show>
                  )}
                </Index>
                <div class="assistant-turn-actions">
                  <IconButton icon="copy" size="sm" title="Copy" onClick={() => copyText(entry.kind === "assistant" ? entry.text : "")} />
                  <time class="assistant-time">{relativeTime(entry.kind === "assistant" ? entry.at : now(), now())}</time>
                </div>
              </Match>
              <Match when={entry.kind === "failed"}>
                <div class="assistant-failed">{entry.kind === "failed" ? entry.text : ""}</div>
                <Show when={index() === s.entries.length - 1 && s.canRetry()}>
                  <div class="assistant-turn-actions">
                    <IconButton icon="retry" size="sm" title="Try again" onClick={s.retry} />
                  </div>
                </Show>
              </Match>
              <Match when={entry.kind === "tool"}>
                <button
                  class={entry.kind === "tool" && !entry.ok ? "assistant-tool assistant-tool--failed" : "assistant-tool"}
                  type="button"
                  onClick={() => s.toggleTool(index())}
                  aria-expanded={entry.kind === "tool" && entry.open}
                >
                  <span class="assistant-tool-name">{entry.kind === "tool" ? activityLine(entry.code) : ""}</span>
                  <span class="assistant-tool-note">{entry.kind === "tool" ? entry.note : ""}</span>
                  <span class="assistant-tool-chevron">
                    <ToolIcon id="chevron-right" />
                  </span>
                </button>
                <Show when={entry.kind === "tool" && entry.open}>
                  <div class="assistant-detail">
                    <div class="assistant-code-wrap">
                      <pre class="assistant-code">{entry.kind === "tool" ? entry.code : ""}</pre>
                      <span class="assistant-code-copy">
                        <IconButton icon="copy" size="sm" title="Copy the code" onClick={() => copyText(entry.kind === "tool" ? entry.code : "")} />
                      </span>
                    </div>
                    <Show when={entry.kind === "tool" && entry.report !== ""}>
                      <pre class="assistant-report">{entry.kind === "tool" ? entry.report : ""}</pre>
                    </Show>
                  </div>
                </Show>
              </Match>
            </Switch>
          )}
        </For>
        <Show when={!following()}>
          <div class="assistant-jump">
            <span class="assistant-jump-key">
              <IconButton icon="chevron-down" variant="soft" title="Jump to the latest" onClick={() => setFollowing(true)} />
            </span>
          </div>
        </Show>
      </div>

      <div class="assistant-composer">
        <Show when={s.running() || s.status() !== "" || s.queued.length > 0 || s.changes() !== null}>
          <div class="assistant-stack">
            <Show when={s.queued.length > 0}>
              <div class="assistant-stack-head">{s.queued.length === 1 ? "1 queued" : `${s.queued.length} queued`}</div>
              <For each={s.queued}>
                {(item, index) => (
                  <div class="assistant-stack-row">
                    <span class="assistant-stack-text">{item.text}</span>
                    <IconButton icon="send" size="sm" title="Send this now" disabled={s.running()} onClick={() => s.sendQueued(index())} />
                    <IconButton icon="close" size="sm" title="Remove from the queue" onClick={() => s.unqueue(index())} />
                  </div>
                )}
              </For>
            </Show>
            <Show when={s.changes()}>
              {(c) => (
                <>
                <Show when={changesOpen()}>
                  <ol class="assistant-stack-list">
                    <For each={c().labels}>{(label) => <li>{label}</li>}</For>
                  </ol>
                </Show>
                <div class="assistant-stack-row">
                  <Show when={c().labels.length > 0}>
                    <Show when={changesOpen()} fallback={<IconButton icon="chevron-right" size="sm" title="Show what ran" onClick={() => setChangesOpen(true)} />}>
                      <IconButton icon="chevron-down" size="sm" title="Hide what ran" onClick={() => setChangesOpen(false)} />
                    </Show>
                  </Show>
                  <span class="assistant-stack-text">{c().steps === 1 ? "1 change to the drawing" : `${c().steps} changes to the drawing`}</span>
                  <Button variant="ghost" size="sm" disabled={s.running()} onClick={s.undoChanges}>
                    Undo all
                  </Button>
                  <Button size="sm" disabled={s.running()} onClick={s.keepChanges}>
                    Keep
                  </Button>
                </div>
                </>
              )}
            </Show>
            <Show when={s.running() || s.status() !== ""}>
              <div class="assistant-stack-row" role="status">
                <Show when={s.running()}>
                  <span class="assistant-ripple" />
                </Show>
                <span class="assistant-stack-text">{s.status() === "" ? "Working" : s.status()}</span>
                <Show when={s.running()}>
                  <Button variant="ghost" size="sm" onClick={s.stop}>
                    Stop
                  </Button>
                  <kbd class="assistant-key">esc</kbd>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
        <div class="assistant-box">
          <Show when={selectionShown() || s.attached().length > 0}>
            <div class="assistant-attachments">
              <Show when={selectionShown()}>
                <span class="assistant-attachment assistant-attachment--context">
                  <span class="assistant-attachment-icon">
                    <ToolIcon id="pick" />
                  </span>
                  <span class="assistant-attachment-name">{props.selection().length === 1 ? "1 selected" : `${props.selection().length} selected`}</span>
                  <IconButton icon="close" size="sm" title="Leave the selection out" onClick={() => s.setSelectionIncluded(false)} />
                </span>
              </Show>
              <For each={s.attached()}>
                {(picture, index) => (
                  <span class="assistant-attachment">
                    <img src={picture.dataUrl} alt={picture.name} />
                    <span class="assistant-attachment-name">{picture.name}</span>
                    <IconButton icon="close" size="sm" title={`Remove ${picture.name}`} onClick={() => s.setAttached(s.attached().filter((_, i) => i !== index()))} />
                  </span>
                )}
              </For>
            </div>
          </Show>
          <textarea
            class="assistant-input"
            ref={inputEl}
            rows={1}
            placeholder={s.running() ? "Queue a follow-up" : "Ask, or say what to draw"}
            value={s.input()}
            onInput={(e) => {
              s.setInput(e.currentTarget.value);
              // A notice (a refused attachment, a restore) has been read once typing resumes.
              if (!s.running() && s.status() !== "") s.setStatus("");
              grow(e.currentTarget);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            aria-label="Ask the assistant"
          />
          <div class="assistant-row">
            <button
              class="assistant-ghost"
              type="button"
              title={s.ready() ? `${s.provider().baseUrl} · ${s.provider().model}` : "Choose a provider and model"}
              onClick={() => {
                setDraft(s.provider());
                setMenuOpen((v) => !v);
              }}
            >
              <span class="assistant-ghost-label">{s.ready() ? s.provider().model : "Set up model"}</span>
              <span class="assistant-ghost-caret">
                <ToolIcon id="chevron-down" />
              </span>
            </button>
            <div class="assistant-actions">
              <span class="assistant-context" title={`${s.used()} characters of the ${MAX_REQUEST_CHARS} the model can be sent`}>
                {s.used() === 0 ? "" : `${Math.round(s.used() / 100) / 10}k / ${Math.round(MAX_REQUEST_CHARS / 1000)}k`}
              </span>
              <IconButton icon="attach" title="Attach a picture (or paste, or drop one)" onClick={() => fileInput?.click()} />
              <Show
                when={s.running() && s.input().trim() === ""}
                fallback={
                  <IconButton
                    icon="send"
                    variant="inverted"
                    title={s.running() ? "Queue (Enter)" : "Send (Enter)"}
                    disabled={s.input().trim() === ""}
                    onClick={send}
                  />
                }
              >
                <IconButton icon="stop" variant="inverted" title="Stop (Esc)" onClick={s.stop} />
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
