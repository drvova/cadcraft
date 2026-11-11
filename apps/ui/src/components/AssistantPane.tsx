/**
 * The assistant panel: the agent docked to the right of the workspace. The part title is the
 * classic recipe's (35px, padding 8px); the composer is the glass one measured on Cursor 3.27's
 * composer (`.design-system/research/cursor-recipes-2026-10-28.md` §2): the elevated surface at
 * radius 12 (docked; a floating card would take 20), no shadow, a 1px border that turns active on focus, an editor at 15px/24px with a
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
import { activityLine, atEnd, clampPanelWidth, failedNote, MAX_REQUEST_CHARS, PANEL_WIDTH, listModels, parseBlocks, parseInline, presetFor, PROVIDER_PRESETS, providerReady, reachedNote, relativeTime, saveBlocker, splitFences, type ChatImage, type ConnectionNote, type ProseBlock, type ProviderConfig } from "../assistant";
import type { AssistantSession } from "../assistant-session";
import { highlight, rankCommands, slashQuery, SLASH_LIMIT, type PaletteItem } from "../palette";
import { ToolIcon } from "../icons";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Field } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { Kbd } from "../ui/Kbd";
import { Row } from "../ui/Row";
import { SectionLabel } from "../ui/SectionLabel";
import { Tab } from "../ui/Tab";
import "../assistant.css";

export interface AssistantPaneProps {
  /** The conversation, the draft and the running turn (the shell owns it; it outlives the panel). */
  session: AssistantSession;
  /** The canvas selection's handles (the shell's signal); drives the context chip. */
  selection: () => readonly string[];
  /** Every open chat's title, in tab order, and which one this panel shows. */
  /** Every command the shell can run: a draft that starts with `/` searches them. */
  commands: () => readonly PaletteItem[];
  /** Run a command the reader picked from the slash list. */
  onRunCommand: (id: string) => void;
  chats: () => readonly string[];
  chatIndex: () => number;
  onSelectChat: (index: number) => void;
  /** Open a chat beside the others (the shell keeps this one). */
  onNewChat: () => void;
  onCloseChat: (index: number) => void;
  /** The panel's close button. */
  onClose: () => void;
}

/** How many of the models a provider lists the setup offers as chips; the rest are typed by name. */
const MODEL_CHIPS = 12;

/** The empty state's suggestions, once a model is set up: one click fills the composer and sends
 *  nothing (the measured 32px suggestion row). Each works on whatever drawing is open. */
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

/** A message in the provider's or the engine's words, shown as a sentence: its first letter capital. */
const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

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
  /** The queue folds to its heading. It starts open and only the reader folds it. The fold key is
   *  one element in both states (the stylesheet turns its chevron), so it keeps the keyboard's focus. */
  const [queueOpen, setQueueOpen] = createSignal(true);
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
  /** How full the context is, in thousands of characters; nothing until it rounds to a figure. */
  const meter = (): string => {
    const thousands = Math.round(s.used() / 100) / 10;
    return thousands === 0 ? "" : `${thousands}k / ${Math.round(MAX_REQUEST_CHARS / 1000)}k`;
  };
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
      s.setStatus(`At most ${MAX_ATTACHMENTS} pictures per message`);
      return;
    }
    const accepted: ChatImage[] = [];
    for (const file of pictures.slice(0, room)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        s.setStatus(`${file.name} is over the ${Math.round(MAX_ATTACHMENT_BYTES / (1 << 20))} MB limit. Attach a smaller picture.`);
        continue;
      }
      try {
        accepted.push({ name: file.name === "" ? "pasted.png" : file.name, dataUrl: await readAsDataUrl(file) });
      } catch {
        s.setStatus(`${file.name} could not be read. Try attaching it again.`);
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
      openSetup();
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

  /** The slash list: a draft that is one `/word` searches the shell's commands instead of asking. */
  const slash = createMemo(() => slashQuery(s.input()));
  const slashMatches = createMemo(() => {
    const query = slash();
    return query === null ? [] : rankCommands(query, props.commands(), [], SLASH_LIMIT);
  });
  const [slashIndex, setSlashIndex] = createSignal(0);
  createEffect(on(slash, () => setSlashIndex(0)));

  const runSlash = (index: number): void => {
    const item = slashMatches()[index]?.item;
    if (item === undefined || !item.enabled) return;
    s.setInput("");
    if (inputEl !== undefined) inputEl.style.height = "";
    props.onRunCommand(item.id);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const count = slashMatches().length;
    if (slash() !== null && count > 0) {
      if (e.key === "ArrowDown") setSlashIndex((i) => (i + 1) % count);
      else if (e.key === "ArrowUp") setSlashIndex((i) => (i - 1 + count) % count);
      else if (e.key === "Enter" || e.key === "Tab") runSlash(slashIndex());
      else if (e.key === "Escape") {
        s.setInput("");
        e.stopPropagation();
      } else return;
      e.preventDefault();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    send();
  };

  /** Escape closes the popover, or stops the turn; it never reaches the shell's own Escape. */
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (menuOpen()) {
      closeSetup();
    } else if (s.running()) {
      s.stop();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  /** The setup sheet: what the connection check found, and the models the server listed. */
  const [models, setModels] = createSignal<readonly string[]>([]);
  const [checkNote, setCheckNote] = createSignal<ConnectionNote | null>(null);
  const [checking, setChecking] = createSignal(false);
  /** The provider row the reader chose, or the one the base URL belongs to; none before either. */
  const [presetId, setPresetId] = createSignal<string | null>(null);
  /** The key field is in the sheet. Once shown it stays, so clearing the key never removes the
   *  field from under the reader's hands. */
  const [keyWanted, setKeyWanted] = createSignal(true);
  /** The key is shown as typed instead of masked. Every opening of the sheet starts masked. */
  const [keyVisible, setKeyVisible] = createSignal(false);
  let checkAbort: AbortController | null = null;
  let setupEl: HTMLElement | undefined;
  let fieldsEl: HTMLDivElement | undefined;
  let modelsEl: HTMLDivElement | undefined;
  /** What had the focus when the sheet opened: it gets the focus back when the sheet closes. */
  let opener: HTMLElement | null = null;
  onCleanup(() => checkAbort?.abort());
  const picked = createMemo(() => PROVIDER_PRESETS.find((p) => p.id === presetId()));
  /** Why Save is off, or null when the setup can work. */
  const blocker = createMemo(() => saveBlocker(draft(), picked()?.key === true, models().length));
  /** The address can be asked: there is one, and it is an http or https one. */
  const canCheck = (): boolean => providerReady({ ...draft(), model: "any" }) === null;
  /** The check's line: what is happening, what was found, or that nothing was checked yet. */
  const checkState = (): string => (checking() ? "checking" : (checkNote()?.state ?? "idle"));
  const checkText = (): string => {
    if (checking()) return "Checking the connection…";
    const note = checkNote();
    if (note !== null) return note.text;
    return canCheck() ? "Not checked yet." : "";
  };

  const openSetup = (): void => {
    const saved = s.provider();
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDraft(saved);
    setPresetId(saved.baseUrl.trim() === "" ? null : (presetFor(saved.baseUrl)?.id ?? null));
    setKeyWanted(saved.apiKey !== "" || picked()?.key !== false || picked()?.id === "custom");
    setKeyVisible(false);
    setModels([]);
    setCheckNote(null);
    setMenuOpen(true);
    // A first setup starts at the first decision, the provider; a return visit at the model.
    const first = s.ready() ? "input[aria-label='Model']" : ".assistant-setup-list button";
    queueMicrotask(() => setupEl?.querySelector<HTMLElement>(first)?.focus());
  };

  const closeSetup = (): void => {
    checkAbort?.abort();
    setChecking(false);
    setKeyVisible(false);
    setMenuOpen(false);
    const back = opener;
    opener = null;
    // The opener may be gone (the empty state's key leaves once a model is saved).
    queueMicrotask(() => (back !== null && back.isConnected ? back : inputEl)?.focus());
  };

  /** The address or the key changed: what the last check found is no longer about this setup. */
  const forgetCheck = (): void => {
    checkAbort?.abort();
    setChecking(false);
    setModels([]);
    setCheckNote(null);
  };

  const applyPreset = (id: string): void => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === id);
    // Choosing the row that is already chosen changes nothing: what was typed under it stays.
    if (preset === undefined || id === presetId()) return;
    setPresetId(id);
    setDraft({ baseUrl: preset.baseUrl, model: preset.model, apiKey: draft().apiKey });
    setKeyWanted(preset.key || preset.id === "custom" || draft().apiKey !== "");
    forgetCheck();
    fieldsEl?.scrollIntoView({ block: "nearest" });
  };

  const setBaseUrl = (value: string): void => {
    setDraft({ ...draft(), baseUrl: value });
    setPresetId(presetFor(value)?.id ?? null);
    if (picked()?.key !== false || picked()?.id === "custom") setKeyWanted(true);
    forgetCheck();
  };

  /** The model's name changed: the check's line keeps its count and drops what it said about the old name. */
  const setModel = (value: string): void => {
    setDraft({ ...draft(), model: value });
    if (checkNote()?.state === "reached") setCheckNote(reachedNote(models(), ""));
  };

  /** The provider list is one list to the arrow keys, as well as a run of Tab stops. */
  const onPresetKey = (e: KeyboardEvent & { currentTarget: HTMLDivElement }): void => {
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("button")];
    const at = rows.findIndex((row) => row === document.activeElement);
    if (at < 0) return;
    const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    rows[Math.min(Math.max(to, 0), rows.length - 1)]?.focus();
  };

  /** Ask the server for its models: proof the address and the key work before they are saved. */
  const checkConnection = async (): Promise<void> => {
    // The key stays enabled while a check runs (a disabled key would drop the keyboard's focus,
    // and Escape with it); a second press waits for the first.
    if (checking()) return;
    checkAbort?.abort();
    const mine = new AbortController();
    checkAbort = mine;
    setChecking(true);
    try {
      const ids = await listModels(draft(), mine.signal);
      if (mine.signal.aborted) return;
      setModels(ids);
      setCheckNote(reachedNote(ids, draft().model));
      // The list the check found is what the reader does next: it comes into view.
      queueMicrotask(() => modelsEl?.scrollIntoView({ block: "nearest" }));
    } catch (e) {
      if (mine.signal.aborted) return;
      setModels([]);
      setCheckNote(failedNote(e));
    } finally {
      if (checkAbort === mine) setChecking(false);
    }
  };

  const saveDraft = (): void => {
    if (blocker() !== null) return;
    s.setProvider({ baseUrl: draft().baseUrl.trim(), model: draft().model.trim(), apiKey: draft().apiKey.trim() });
    closeSetup();
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
                <Tab size="sm" selected={index() === props.chatIndex()} title={title} onClick={() => props.onSelectChat(index())} onClose={() => props.onCloseChat(index())} closeLabel={`Close ${title}`}>
                  {title}
                </Tab>
              )}
            </For>
          </div>
        </Show>
        <div class="assistant-head-actions">
          <IconButton icon="plus" title="New chat" onClick={newChat} />
          <IconButton icon="close" title="Close the assistant" onClick={() => props.onClose()} />
        </div>
      </div>

      <div class="assistant-main">
      <div
        class="assistant-body"
        ref={body}
        inert={menuOpen()}
        onScroll={(e) => setFollowing(atEnd(e.currentTarget.scrollHeight, e.currentTarget.scrollTop, e.currentTarget.clientHeight))}
      >
        <Show when={s.entries.length === 0}>
          <div class="assistant-empty">
            <p>The assistant works in the open drawing: it draws, measures and changes it, and reports the numbers.</p>
            <Show when={!s.ready()}>
              <div class="assistant-empty-setup">
                <Button variant="primary" onClick={openSetup}>
                  Set up a model
                </Button>
              </div>
            </Show>
            <For each={s.ready() ? EXAMPLES : []}>
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
                  <IconButton icon="copy" size="sm" title="Copy the reply" onClick={() => copyText(entry.kind === "assistant" ? entry.text : "")} />
                  <time class="assistant-time">{relativeTime(entry.kind === "assistant" ? entry.at : now(), now())}</time>
                </div>
              </Match>
              <Match when={entry.kind === "failed"}>
                <div class="assistant-failed">{entry.kind === "failed" ? sentence(entry.text) : ""}</div>
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
        <Show when={menuOpen()}>
          <section class="assistant-setup" id="assistant-setup" aria-label="Model setup" ref={setupEl}>
            <div class="assistant-setup-scroll">
              <div class="assistant-setup-group">
                <SectionLabel>Provider</SectionLabel>
                <div class="assistant-setup-list" onKeyDown={onPresetKey}>
                  <For each={PROVIDER_PRESETS}>
                    {(preset) => (
                      <Row selected={presetId() === preset.id} onClick={() => applyPreset(preset.id)}>
                        <span class="assistant-preset-label">{preset.label}</span>
                        <span class="assistant-preset-url">{preset.id === "custom" ? "any server" : preset.key ? "needs a key" : "no key"}</span>
                      </Row>
                    )}
                  </For>
                </div>
              </div>
              <div class="assistant-setup-group" ref={fieldsEl}>
                <SectionLabel>Connection</SectionLabel>
                <div class="assistant-field">
                  <span>Base URL</span>
                  <Field value={draft().baseUrl} ariaLabel="Base URL" placeholder="e.g. http://127.0.0.1:11434/v1" onInput={setBaseUrl} />
                  <span class="assistant-field-hint">
                    {picked()?.key === false && picked()?.id !== "custom"
                      ? "A server on this machine. It needs no key, but it must accept requests from this page."
                      : "The address requests go to: the root of an OpenAI-compatible API, usually ending in /v1."}
                  </span>
                </div>
                <Show when={keyWanted()}>
                  <div class="assistant-field">
                    <span>API key</span>
                    <div class="assistant-key" ref={(el) => queueMicrotask(() => el.querySelector("input")?.setAttribute("autocomplete", "off"))}>
                      <Field
                        type={keyVisible() ? "text" : "password"}
                        value={draft().apiKey}
                        ariaLabel="API key"
                        placeholder="e.g. sk-..."
                        onInput={(v) => {
                          setDraft({ ...draft(), apiKey: v });
                          forgetCheck();
                        }}
                      />
                      <Button variant="ghost" size="sm" title={keyVisible() ? "Hide the key" : "Show the key"} onClick={() => setKeyVisible(!keyVisible())}>
                        {keyVisible() ? "Hide" : "Show"}
                      </Button>
                    </div>
                    <span class="assistant-field-hint">Stored in this browser, not encrypted. Sent only to the base URL above.</span>
                  </div>
                </Show>
                <div class="assistant-field">
                  <span>Model</span>
                  <Field value={draft().model} ariaLabel="Model" placeholder="e.g. llama3.2" onInput={setModel} />
                  <Show when={models().length === 0}>
                    <span class="assistant-field-hint">The model's name as the provider spells it. Check connection lists the ones it serves.</span>
                  </Show>
                </div>
                <Show when={models().length > 0}>
                  <div class="assistant-setup-models" ref={modelsEl}>
                    <For each={models().slice(0, MODEL_CHIPS)}>
                      {(id) => (
                        <Chip tone={draft().model.trim() === id ? "accent" : "neutral"} title={`Use ${id}`} onClick={() => setModel(id)}>
                          {id}
                        </Chip>
                      )}
                    </For>
                  </div>
                  <Show when={models().length > MODEL_CHIPS}>
                    <span class="assistant-field-hint">{`And ${models().length - MODEL_CHIPS} more. Type the name of one that is not shown.`}</span>
                  </Show>
                </Show>
              </div>
            </div>
            <div class="assistant-setup-foot">
              <div class="assistant-setup-notes">
                <p class={`assistant-setup-note is-${checkState()}`} role="status" aria-live="polite" aria-atomic="true">
                  <Show when={checking()}>
                    <span class="assistant-ripple" />
                  </Show>
                  {checkText()}
                </p>
                <Show when={blocker()}>{(reason) => <p class="assistant-setup-reason">{reason()}</p>}</Show>
              </div>
              <div class="assistant-setup-actions">
                <Button variant="ghost" disabled={!canCheck()} onClick={() => void checkConnection()}>
                  Check connection
                </Button>
                <span class="assistant-setup-spacer" />
                <Button variant="ghost" onClick={closeSetup}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={blocker() !== null} title={blocker() ?? undefined} onClick={saveDraft}>
                  Save
                </Button>
              </div>
            </div>
          </section>
        </Show>
      </div>

      <div class="assistant-composer">
        <Show when={s.running() || s.status() !== "" || s.queued.length > 0 || s.changes() !== null}>
          <div class="assistant-stack">
            <Show when={s.queued.length > 0}>
              <div class={queueOpen() ? "assistant-stack-head" : "assistant-stack-head is-folded"}>
                <IconButton icon="chevron-down" size="sm" title={queueOpen() ? "Hide the queue" : "Show the queue"} expanded={queueOpen()} controls="assistant-queue" onClick={() => setQueueOpen(!queueOpen())} />
                <span class="assistant-stack-count">{`${s.queued.length} in queue`}</span>
              </div>
              <div class="assistant-stack-queue" id="assistant-queue" hidden={!queueOpen()}>
                <For each={s.queued}>
                  {(item, index) => (
                    <div class="assistant-stack-row">
                      <span class="assistant-stack-text" title={item.text}>{item.text}</span>
                      <IconButton icon="send" size="sm" title="Send this now" disabled={s.running()} onClick={() => s.sendQueued(index())} />
                      <IconButton icon="close" size="sm" title="Remove from the queue" onClick={() => s.unqueue(index())} />
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={s.changes()}>
              {(c) => (
                <>
                <ol class="assistant-stack-list" id="assistant-changes" hidden={!changesOpen()}>
                  <For each={c().labels}>{(label) => <li>{label}</li>}</For>
                </ol>
                <div class={changesOpen() ? "assistant-stack-row" : "assistant-stack-row is-folded"}>
                  <Show when={c().labels.length > 0}>
                    <IconButton
                      icon="chevron-down"
                      size="sm"
                      title={changesOpen() ? "Hide what ran" : "Show what ran"}
                      expanded={changesOpen()}
                      controls="assistant-changes"
                      onClick={() => setChangesOpen(!changesOpen())}
                    />
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
                <span class="assistant-stack-text">{s.status() === "" ? "Working…" : sentence(s.status())}</span>
                <Show when={s.running()}>
                  <Button variant="ghost" size="sm" onClick={s.stop}>
                    Stop
                  </Button>
                  <Kbd>esc</Kbd>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={slash() !== null}>
          <div class="assistant-stack assistant-slash" role="listbox" aria-label="Commands">
            <For each={slashMatches()}>
              {(match, index) => (
                <Row selected={index() === slashIndex()} disabled={!match.item.enabled} onClick={() => runSlash(index())}>
                  <span class="assistant-slash-label">
                    <For each={highlight(match.item.label, match.indices)}>{(part) => (part.hit ? <mark class="assistant-slash-hit">{part.text}</mark> : part.text)}</For>
                  </span>
                  <span class="assistant-slash-id">{match.item.id}</span>
                </Row>
              )}
            </For>
            <Show when={slashMatches().length === 0}>
              <div class="assistant-stack-row">
                <span class="assistant-stack-text">No command matches. Keep typing to send it as a message.</span>
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
            placeholder={s.running() ? "Queue a follow-up" : "Ask, or / for commands"}
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
              title={s.ready() ? `Change the model (${s.provider().model} at ${s.provider().baseUrl})` : "Choose a provider and model"}
              aria-expanded={menuOpen()}
              aria-controls="assistant-setup"
              onClick={() => (menuOpen() ? closeSetup() : openSetup())}
            >
              <span class="assistant-ghost-label">{s.ready() ? s.provider().model : "Set up a model"}</span>
              <span class="assistant-ghost-caret">
                <ToolIcon id="chevron-down" />
              </span>
            </button>
            <div class="assistant-actions">
              <span class="assistant-context" title={`Context sent to the model: ${s.used().toLocaleString()} of ${MAX_REQUEST_CHARS.toLocaleString()} characters`}>
                {meter()}
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
        </div>
      </div>
    </aside>
  );
}
