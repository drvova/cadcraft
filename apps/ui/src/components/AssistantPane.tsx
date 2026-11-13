/**
 * The assistant panel: the agent docked to the right of the workspace. The part title is the
 * classic recipe's (the editor tabs' band); the composer is the glass one measured on Cursor
 * 3.27's composer (`.design-system/research/cursor-recipes-2026-10-28.md` §2), re-proportioned
 * for the shell's type (`../assistant.css` names each measure by its token): the elevated surface
 * at the panel's card corner, no shadow, a hairline that turns active on focus, an editor at
 * `--composer-font`/`--composer-leading` that rests on one line and grows with what is typed, and a toolbar row that holds
 * `--control-h-input` circles and the pill model chip; send and stop are the inverted circle. Its
 * controls are the system's own: `ui/TextArea` (the editor, bare: the card draws its box and its
 * focus), `ui/IconButton` (attach, remove-attachment, stop, send), `ui/Row` (the preset rows, the
 * empty state's suggestions and the slash list's options), `ui/Field` (the provider inputs) and
 * `ui/Button` (Cancel, Save). The running dot carries §1.14's `ripple 1.2s` to `scale(1.7)`.
 *
 * The transcript is the agent-panel grammar: a prompt in a quiet inset block, the model's words
 * plain on the surface (with inline `code`, **bold** runs and links to http and https addresses),
 * and each tool call one quiet row that says what ran as a sentence (`activityParts`) and what it
 * changed, and opens on click to its code and report.
 *
 * Setting a model up is a sheet over the panel (the composer is out of the page meanwhile): the
 * provider list alone first, then the connection that provider filled in. The composer is the way
 * in: before a model is set up its model slot reads "Set up a model" and opens the sheet, and so
 * does Send, which keeps the draft and sends it once the setup is saved.
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

import { batch, createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, untrack, type JSX } from "solid-js";
import { activityParts, clampPanelWidth, failedNote, focusIsOurs, followAfterScroll, growReply, listProviderModels, MAX_MESSAGE_CHARS, MAX_REQUEST_CHARS, PANEL_WIDTH, parseInline, presetFor, PROVIDER_PRESETS, providerReady, reachedNote, relativeTime, saveBlocker, setupStatus, type ChatImage, type ConnectionNote, type ProviderConfig, type ReplyBlock, type ReplyParse } from "../assistant";
import { turnStart, type AssistantSession } from "../assistant-session";
import type { BenchSheet } from "../bench";
import { mentionKey, mentionLabel, mentionOptions, mentionQuery, rankMentions, takeMention, type Mention } from "../mentions";
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
import { TextArea } from "../ui/TextArea";
import { describeByHint } from "../ui/Tooltip";
import "../assistant.css";

export interface AssistantPaneProps {
  /** The conversation, the draft and the running turn (the shell owns it; it outlives the panel). */
  session: AssistantSession;
  /** The canvas selection's handles (the shell's signal); drives the context chip. */
  selection: () => readonly string[];
  /** The drawing's layers by name, and its bench sheet: what a `@` in the composer can point at. */
  layers: readonly string[];
  bench: BenchSheet | null;
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
  /**
   * Draw the panel's frame another way (the Slab shell's `../slab/SlabAssistant`). Absent, the
   * panel draws itself as below. Either way every decision is this component's: the frame is
   * handed the state to show, the actions to run and the parts that stay as they are.
   */
  frame?: (view: AssistantFrame) => JSX.Element;
}

/** One thing a message carries besides its words: the canvas selection, something pointed at with `@`, or a picture. */
export type AssistantChip = ChatImage | "selection" | Mention;

/**
 * What a frame is handed (`AssistantPaneProps.frame`): what the title, the empty state, the
 * chips and the composer's toolbar show and do, and the parts of the panel that stay SolidJS,
 * each to be mounted once.
 */
export interface AssistantFrame {
  props: AssistantPaneProps;
  session: AssistantSession;
  /** The setup sheet is open: the title says so, and the composer is out of the page. */
  setupOpen: () => boolean;
  /** The model slot's press: open the setup, or close it. */
  toggleSetup: () => void;
  /** The model slot's hint, and under it where the requests go (when a model is set up). */
  modelHint: () => string;
  modelNote: () => string | undefined;
  /** The context meter's figures ("0.8k / 60k"); "" until there is something to say. */
  meter: () => string;
  /** How much the next request carries, in characters, and the most it may. */
  used: () => number;
  budget: number;
  /** The canvas selection rides in the message. */
  selectionShown: () => boolean;
  /** The picked things that draw a chip of their own. */
  mentionChips: () => readonly Mention[];
  /** Take a chip out of the message at once (a frame that plays no leaving). */
  drop: (item: AssistantChip) => void;
  /** Why the send key is off, or what a press does when that is not sending. */
  sendNote: () => string | undefined;
  /** How far the draft is over what one message may hold, or 0. */
  over: () => number;
  send: () => void;
  newChat: () => void;
  /** Open the file picker for a picture. */
  attach: () => void;
  /** The empty state: its one line, and the suggestions (a press fills the composer). */
  emptyLine: string;
  examples: readonly { icon: string; text: string }[];
  useExample: (text: string) => void;
  /** Put the keyboard in the composer's editor. */
  focusEditor: () => void;
  /** The transcript and the setup sheet over it; `drawsEmpty` false when the frame draws the empty state. */
  main: (drawsEmpty: boolean) => JSX.Element;
  /** What stands over the composer's card: the stack, the slash list and the `@` list. */
  stack: () => JSX.Element;
  /** The composer's editor in its label. */
  editor: () => JSX.Element;
  /** The hidden file input `attach` opens. */
  picker: () => JSX.Element;
}

/** How many of the models a provider lists the setup offers as chips; the rest are typed by name. */
const MODEL_CHIPS = 12;

/** The fewest rows the provider list keeps in a short panel; past that the sheet itself scrolls. */
const MIN_LIST_ROWS = 3;

/** The empty transcript's one line: what the assistant does in this product. */
const EMPTY_LINE = "Ask it to design, measure or change this piece.";

/** The empty state's suggestions, once a model is set up: one click fills the composer and sends
 *  nothing (each is one of the system's list rows). Each is a jeweler's sentence for any drawing. */
const EXAMPLES: readonly { icon: string; text: string }[] = [
  { icon: "ring", text: "Draw a size 7 platinum band, 2.5 mm wide" },
  { icon: "gem", text: "Set a 6 mm oval sapphire with a halo" },
  { icon: "dist", text: "Total the stones, carats and grams" },
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

/** The composer's editor rests on one line of `--composer-leading`, grows a line at a time with
 *  what is typed (upward: the card stands on the panel's foot, so its toolbar keeps its place), and
 *  scrolls past nine (whole lines, counted by the editor itself: no pixel floor or cap to drift from the type). */
const COMPOSER_ROWS = 1;
const COMPOSER_MAX_ROWS = 9;

const COMPOSER_ID = "assistant-editor";

const slashOptionId =(index: number): string => `assistant-slash-${index}`;

/**
 * How many of a chat's newest rows the transcript draws when it opens, and how many more each
 * "Show earlier" adds. Opening the panel and changing chats draw the transcript anew, so what
 * they cost follows this number and not the length of the chat.
 */
const TRANSCRIPT_WINDOW = 120;

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
  let panelEl: HTMLElement | undefined;
  let body: HTMLDivElement | undefined;
  let transcriptEl: HTMLDivElement | undefined;
  let inputEl: HTMLTextAreaElement | undefined;
  let fileInput: HTMLInputElement | undefined;
  /** Where the transcript stood when it last moved: a scroll to above it is the reader's. */
  let lastTop = 0;

  const tick = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(tick));

  /** Bring the transcript to its end. */
  const toEnd = (): void => {
    if (body === undefined) return;
    body.scrollTop = body.scrollHeight;
    lastTop = body.scrollTop;
  };

  // The transcript follows the conversation as it grows, while the reader is at its end. Whatever
  // changes its height (a reply's next words, a row that opens, the panel's width, the stack over
  // the composer taking room from it) is seen by the observer after the frame's layout and before
  // its paint: the move costs no layout of its own, and the reader never sees a frame out of place.
  onMount(() => {
    if (body === undefined || transcriptEl === undefined) return;
    const watcher = new ResizeObserver(() => {
      if (following()) toEnd();
    });
    watcher.observe(body);
    watcher.observe(transcriptEl);
    onCleanup(() => watcher.disconnect());
  });

  /** The first row the transcript draws: the rows before it wait behind "Show earlier". */
  const [start, setStart] = createSignal(turnStart(s.entries, s.entries.length - TRANSCRIPT_WINDOW));
  const from = createMemo(() => Math.min(start(), s.entries.length));
  const shown = createMemo(() => s.entries.slice(from()));
  createEffect(() => {
    const count = s.entries.length;
    const at = untrack(start);
    // A new chat starts at its first row. A long sitting at the transcript's end lets the rows
    // far above fall back behind "Show earlier", so the page does not grow with the chat.
    if (count <= at) setStart(0);
    else if (untrack(following) && count - at > 3 * TRANSCRIPT_WINDOW) setStart(turnStart(s.entries, count - TRANSCRIPT_WINDOW));
  });
  // Rows the chat let go were its first: the window keeps the rows it showed.
  createEffect(on(s.dropped, (now, before) => setStart(Math.max(0, start() - Math.max(0, now - (before ?? now)))), { defer: true }));
  const showEarlier = (): void => {
    const to = Math.max(0, from() - TRANSCRIPT_WINDOW);
    const turn = turnStart(s.entries, to);
    // The rows come in above the reader's place: what was in view stays where it was.
    const below = body === undefined ? 0 : body.scrollHeight - body.scrollTop;
    setStart(turn < from() ? turn : to);
    if (body !== undefined) body.scrollTop = body.scrollHeight - below;
    // The key leaves with the last hidden row; the focus it held goes to the first row's own key.
    queueMicrotask(() => {
      if (document.activeElement === document.body) (transcriptEl?.querySelector<HTMLElement>("button") ?? inputEl)?.focus({ preventScroll: true });
    });
  };

  // A new selection is context again, even if the last one was left out. The shell hands a fresh
  // array after every command, so what is selected is compared, not the array.
  const selectionKey = createMemo(() => props.selection().join(","));
  createEffect(on(selectionKey, () => s.setSelectionIncluded(true), { defer: true }));
  /** How much the next request carries, in thousands of characters; nothing until it rounds to a figure. */
  const used = createMemo(() => s.used());
  const meter = (): string => {
    const thousands = Math.round(used() / 100) / 10;
    return thousands === 0 ? "" : `${thousands}k / ${Math.round(MAX_REQUEST_CHARS / 1000)}k`;
  };
  /** How far the draft is over what one message may hold, or 0: it is said, and nothing is cut. */
  const over = createMemo(() => s.overBy());
  const selectionShown = (): boolean => props.selection().length > 0 && s.selectionIncluded();
  /** The second line of the send key's hint: why it is off, or what a press does when that is not sending. */
  const sendNote = (): string | undefined => {
    if (over() > 0) return "The message is too long to send";
    if (s.input().trim() === "") return "Type a message first";
    if (!s.ready()) return "No model yet: opens the setup, then sends";
    return s.running() ? "A turn is running: this waits for it to end" : undefined;
  };
  /** What the turn is doing now, or the last notice: the status row's words, over the composer and in the setup sheet. */
  const runStatus = (): string => (s.status() === "" ? "Working…" : sentence(s.status()));
  /** The model chip's hint: what a press does, and under it where the requests go. */
  const chipHint = (): string => (menuOpen() ? "Close the setup" : s.ready() ? "Change the model" : "Choose a provider and model");
  const chipNote = (): string | undefined => (s.ready() && !menuOpen() ? s.provider().baseUrl : undefined);

  onMount(() => inputEl?.focus());

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

  /** What is on its way out of the card (the canvas selection, a picture): drawn closing, then
   *  taken out of the message when that has played. */
  const [leaving, setLeaving] = createSignal<readonly (ChatImage | "selection" | Mention)[]>([]);
  const takeOut = (item: ChatImage | "selection" | Mention): void => {
    if (!leaving().includes(item)) return;
    setLeaving(leaving().filter((other) => other !== item));
    if (item === "selection") s.setSelectionIncluded(false);
    else if ("kind" in item) s.setMentions(s.mentions().filter((other) => other !== item));
    else s.setAttached(s.attached().filter((picture) => picture !== item));
  };
  const remove = (item: ChatImage | "selection" | Mention): void => {
    if (leaving().includes(item)) return;
    setLeaving([...leaving(), item]);
    // With the interface's motion off nothing plays, so nothing would end: it goes at once.
    if (document.documentElement.dataset["animations"] === "off") takeOut(item);
  };
  const drop = (item: AssistantChip): void => {
    if (!leaving().includes(item)) setLeaving([...leaving(), item]);
    takeOut(item);
  };
  const chipClass = (item: ChatImage | "selection" | Mention, base: string): string => (leaving().includes(item) ? `${base} is-leaving` : base);

  /** The box the chips sit in, the row inside it, and the height the row last had. */
  let chipsBox: HTMLDivElement | undefined;
  let chipsRow: HTMLDivElement | undefined;
  let chipsHeight = 0;
  /** Ease the chips' box from the height it had to the height the row needs now: a chip that
   *  starts or empties a line, the first chip and the last one all move the card smoothly. */
  const easeChips = (): void => {
    if (chipsBox === undefined) return;
    // Two chips can go in one frame: mid-move, the box starts again from where it is drawn now,
    // not from where it was going.
    const moving = chipsBox.getAnimations();
    const from = moving.length > 0 ? chipsBox.offsetHeight : chipsHeight;
    for (const move of moving) move.cancel();
    chipsHeight = chipsRow?.isConnected === true ? chipsRow.offsetHeight : 0;
    if (from === chipsHeight || document.documentElement.dataset["animations"] === "off") return;
    const tokens = getComputedStyle(chipsBox);
    const seconds = Number.parseFloat(tokens.getPropertyValue("--dur-med"));
    chipsBox.animate([{ height: `${from}px` }, { height: `${chipsHeight}px` }], {
      duration: Number.isFinite(seconds) ? seconds * 1000 : 0,
      easing: tokens.getPropertyValue("--ease-out-quint").trim() || "ease-out",
    });
  };
  onMount(() => {
    chipsHeight = chipsRow?.isConnected === true ? chipsRow.offsetHeight : 0;
  });
  createEffect(on([s.attached, selectionShown, s.mentions], () => queueMicrotask(easeChips), { defer: true }));

  const send = (): void => {
    // What the reader took out a moment ago is out, whether or not its chip has finished closing.
    for (const item of leaving()) takeOut(item);
    const outcome = s.send();
    if (outcome === "unconfigured") {
      // The draft stays in the composer under the sheet. Send was already pressed for it, so a
      // successful Save sends it; Cancel and Escape leave it as a draft.
      openSetup();
      sendAfterSetup = true;
      return;
    }
    // A draft that is too long stays as it is: the line over the composer says by how much.
    if (outcome === "empty" || outcome === "too-long") return;
    // The reader's own message always comes into view.
    setFollowing(true);
    toEnd();
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
  /** The `@` list: the word the caret is in starts with `@`, and lists what in the drawing the
   *  message can point at (`../mentions`). It shares the slash list's highlight, keys and pointer. */
  const [caret, setCaret] = createSignal(0);
  /** Where the `@word` the reader closed the list on starts: that word stays closed. */
  const [mentionClosed, setMentionClosed] = createSignal(-1);
  const mentionAt = createMemo(() => mentionQuery(s.input(), caret()), undefined, { equals: (a, b) => a?.query === b?.query && a?.start === b?.start && a?.end === b?.end });
  const mention = createMemo(() => (mentionAt()?.start === mentionClosed() ? null : (mentionAt() ?? null)));
  createEffect(() => {
    if (mentionAt() === null && untrack(mentionClosed) !== -1) setMentionClosed(-1);
  });
  /** What can still be pointed at: everything offered, less what this message already carries. */
  const mentionChoices = createMemo(() => {
    const picked = new Set(s.mentions().map(mentionKey));
    return mentionOptions(props.layers, props.bench, props.selection().length).filter((option) => !picked.has(option.key));
  });
  const mentionMatches = createMemo(() => {
    const asked = mention();
    return asked === null ? [] : rankMentions(mentionChoices(), asked.query);
  });
  /** The picked things that draw a chip of their own (the selection has its chip already). */
  const mentionChips = createMemo(() => s.mentions().filter((m) => m.kind !== "selection"));
  /** Which list the composer drives now, what it was asked, and how many rows it has. */
  const listed = (): "mention" | "slash" | null => (mention() !== null ? "mention" : slash() !== null ? "slash" : null);
  const listAsked = createMemo(() => (mention() !== null ? `@${mention()?.query ?? ""}` : slash()));
  const listCount = (): number => (listed() === "mention" ? mentionMatches().length : slashMatches().length);
  const [slashIndex, setSlashIndex] = createSignal(0);
  /** The lit row follows the keys into view; a row lit by the pointer is already under it. */
  let slashFollow = true;
  /** Where the pointer last was over the list, so a row arriving under a still pointer is not a move. */
  let slashPointer = "";
  const lightSlash = (index: number): void => {
    slashFollow = true;
    setSlashIndex(index);
  };
  createEffect(
    on(listAsked, (now, before) => {
      // The list opened: the pointer is found again where it already was before it counts as moving.
      if (now !== null && (before === null || before === undefined)) slashPointer = "";
      lightSlash(0);
    }),
  );
  createEffect(
    on(slashIndex, (index) => {
      if (slashFollow) document.getElementById(slashOptionId(index))?.scrollIntoView({ block: "nearest" });
    }),
  );

  /** The pointer moved over a row of the slash list: the highlight goes there, once it really moved. */
  const onSlashPointerMove = (e: PointerEvent, index: number): void => {
    const at = `${e.screenX},${e.screenY}`;
    if (at === slashPointer) return;
    const first = slashPointer === "";
    slashPointer = at;
    if (first || index === slashIndex()) return;
    slashFollow = false;
    setSlashIndex(index);
  };

  const runSlash = (index: number): void => {
    const item = slashMatches()[index]?.item;
    if (item === undefined || !item.enabled) return;
    s.setInput("");
    props.onRunCommand(item.id);
  };

  /** Point the message at a row of the `@` list: its `@word` leaves the draft and a chip arrives. */
  const pickMention = (index: number): void => {
    const option = mentionMatches()[index]?.option;
    const asked = mention();
    if (option === undefined || asked === null) return;
    const next = takeMention(s.input(), asked);
    batch(() => {
      // A selection chip on its way out stays: it was just asked for again.
      if (option.mention.kind === "selection") setLeaving(leaving().filter((item) => item !== "selection"));
      s.setInput(next.text);
      setCaret(next.caret);
      s.mention(option.mention);
    });
    queueMicrotask(() => {
      inputEl?.focus();
      inputEl?.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const count = listCount();
    if (listed() !== null && count > 0) {
      if (e.key === "ArrowDown") lightSlash((slashIndex() + 1) % count);
      else if (e.key === "ArrowUp") lightSlash((slashIndex() - 1 + count) % count);
      else if (e.key === "Enter" || e.key === "Tab") {
        if (listed() === "mention") pickMention(slashIndex());
        else runSlash(slashIndex());
      } else if (e.key === "Escape") {
        // The `@` list closes and the draft stays; a slash draft is only its `/word`, and goes.
        if (listed() === "mention") setMentionClosed(mention()?.start ?? -1);
        else s.setInput("");
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
  /** How many models the provider listed in all; `models` keeps the first of them. */
  const [modelTotal, setModelTotal] = createSignal(0);
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
  /** Send opened the sheet (no model was set up): saving it sends the draft that press was for. */
  let sendAfterSetup = false;
  let setupEl: HTMLElement | undefined;
  let fieldsEl: HTMLDivElement | undefined;
  let modelsEl: HTMLDivElement | undefined;
  let listEl: HTMLDivElement | undefined;
  let scrollEl: HTMLDivElement | undefined;
  /** The whole provider list is showing: before a provider is chosen, and after "Change provider".
   *  With one chosen, the list is that provider's line, and the fields it filled are under it. */
  const [listOpen, setListOpen] = createSignal(false);
  const listShown = (): boolean => presetId() === null || listOpen();
  /** How many rows of the provider list the sheet has room for: all of them in a tall panel, and in
   *  a short one a whole number of them (never part of a row), where the list scrolls by itself. */
  const [listRows, setListRows] = createSignal(PROVIDER_PRESETS.length);
  /** The list is cut: the line that says so has its place under it. */
  const [listCut, setListCut] = createSignal(false);
  /** Rows lie under the list's fold; the line says so until the last one is in view. */
  const [moreBelow, setMoreBelow] = createSignal(false);
  const measureList = (): void => {
    if (listEl !== undefined) setMoreBelow(listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight > 1);
  };
  /** Give the list the rows the sheet has room for beside everything else it holds. */
  const fitList = (): void => {
    const list = listEl;
    const scroll = scrollEl;
    const row = list?.firstElementChild;
    const last = scroll?.lastElementChild;
    if (list === undefined || scroll === undefined || !list.isConnected || !(row instanceof HTMLElement) || !(last instanceof HTMLElement) || row.offsetHeight === 0) return;
    const total = PROVIDER_PRESETS.length;
    const pitch = row.offsetHeight;
    const pad = Number.parseFloat(getComputedStyle(scroll).paddingBottom);
    /** The height of everything in the sheet but the list's rows, as it is laid out now. */
    const others = (): number => last.getBoundingClientRect().bottom - scroll.getBoundingClientRect().top + scroll.scrollTop + (Number.isFinite(pad) ? pad : 0) - list.offsetHeight;
    setListCut(false);
    if (others() + total * pitch <= scroll.clientHeight) setListRows(total);
    else {
      // The cut list brings its "more below" line: the rows are counted with that line in place.
      setListCut(true);
      setListRows(Math.min(total - 1, Math.max(MIN_LIST_ROWS, Math.floor((scroll.clientHeight - others()) / pitch))));
    }
    list.querySelector("[aria-current='true']")?.scrollIntoView({ block: "nearest" });
    measureList();
  };
  // The list is fitted again whenever what shares the sheet with it comes or goes.
  createEffect(on([menuOpen, listShown, presetId, keyWanted, models], () => queueMicrotask(fitList), { defer: true }));
  /** What had the focus when the sheet opened: it gets the focus back when the sheet closes. */
  let opener: HTMLElement | null = null;
  onCleanup(() => checkAbort?.abort());
  const picked = createMemo(() => PROVIDER_PRESETS.find((p) => p.id === presetId()));
  /** The chosen provider is a server on this machine: it takes no key. */
  const localPreset = (): boolean => picked()?.key === false && picked()?.id !== "custom";
  /** Why Save is off, or null when the setup can work. */
  const blocker = createMemo(() => saveBlocker(draft(), picked()?.key === true, models().length));
  /** The address can be asked: there is one, and it is an http or https one. */
  const canCheck = (): boolean => providerReady({ ...draft(), model: "any" }) === null;
  /** The foot's one line: the check running, else what it found, else what Save still needs, else nothing. */
  const status = createMemo(() => setupStatus(checking(), checkNote(), blocker()));

  const openSetup = (): void => {
    const saved = s.provider();
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDraft(saved);
    setPresetId(saved.baseUrl.trim() === "" ? null : (presetFor(saved.baseUrl)?.id ?? null));
    setKeyWanted(saved.apiKey !== "" || picked()?.key !== false || picked()?.id === "custom");
    setKeyVisible(false);
    setModels([]);
    setCheckNote(null);
    // A first setup is the first decision alone, the provider list; a return visit is the filled
    // form under the provider's line.
    setListOpen(false);
    setMenuOpen(true);
    queueMicrotask(() => {
      fitList();
      if (presetId() === null) setupEl?.querySelector<HTMLElement>(".assistant-setup-list button")?.focus();
      else focusField(s.ready());
    });
  };

  /** Move the focus into the fields: to the first empty one, or to the model when none is empty
   *  (`toModel`: a setup that already works is opened to change its model). */
  const focusField = (toModel = false): void => {
    const fields = [...(fieldsEl?.querySelectorAll<HTMLInputElement>("input") ?? [])];
    const model = fields[fields.length - 1];
    ((toModel ? undefined : fields.find((field) => field.value.trim() === "")) ?? model)?.focus();
  };

  /** "Change provider": the whole list again, the keyboard on the provider it is on. */
  const changeProvider = (): void => {
    setListOpen(true);
    queueMicrotask(() => {
      fitList();
      (listEl?.querySelector<HTMLElement>("[aria-current='true']") ?? listEl?.querySelector<HTMLElement>("button"))?.focus();
    });
  };

  const closeSetup = (): void => {
    // Escape pressed elsewhere in the window closes the sheet too: the focus stays where it is.
    const ours = panelEl === undefined || focusIsOurs(panelEl, document.activeElement, document.body);
    checkAbort?.abort();
    setChecking(false);
    setKeyVisible(false);
    setMenuOpen(false);
    sendAfterSetup = false;
    const back = opener;
    opener = null;
    if (!ours) return;
    // The opener may be gone (a key of the transcript that the chat has since let go): the editor then.
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
    if (preset === undefined) return;
    // Choosing the row that is already chosen changes nothing: what was typed under it stays.
    if (id !== presetId()) {
      setPresetId(id);
      setDraft({ baseUrl: preset.baseUrl, model: preset.model, apiKey: draft().apiKey });
      // A provider that takes no key shows no key field, unless a key is already typed.
      setKeyWanted(preset.key || preset.id === "custom" || draft().apiKey !== "");
      forgetCheck();
    }
    // The decision is made: the list folds to its line, and the keyboard goes to what is still to fill in.
    setListOpen(false);
    queueMicrotask(() => focusField());
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
    if (checkNote()?.state === "reached") setCheckNote(reachedNote(models(), "", modelTotal()));
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
      const listing = await listProviderModels(draft(), mine.signal);
      if (mine.signal.aborted) return;
      setModels(listing.ids);
      setModelTotal(listing.total);
      setCheckNote(reachedNote(listing.ids, draft().model, listing.total));
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
    const resend = sendAfterSetup;
    closeSetup();
    if (resend) send();
  };

  /** The model's words, with inline `code`, **bold** runs and links rendered as elements. A link
   *  is only ever an http or https address (`parseInline` keeps anything else as text); it opens
   *  outside the app, cut off from this page, and its hint is the address itself, whatever its
   *  label says. */
  const richText = (text: string): JSX.Element => (
    <For each={parseInline(text)}>
      {(part) =>
        part.kind === "bold" ? (
          <strong>{part.text}</strong>
        ) : part.kind === "code" ? (
          <code>{part.text}</code>
        ) : part.kind === "link" && part.href !== undefined ? (
          <a class="assistant-link" href={part.href} target="_blank" rel="noopener noreferrer" data-hint={part.href === part.text ? "Opens in the browser" : part.href}>
            {part.text}
          </a>
        ) : (
          part.text
        )
      }
    </For>
  );

  /** One block of a reply: a heading, a list or a paragraph with its inline runs, or fenced code.
   *  A block never changes once drawn; a block that reads differently is another block. */
  const blockView = (block: ReplyBlock): JSX.Element => {
    if (block.kind === "code") {
      return (
        <div class="assistant-code-wrap">
          <pre class="assistant-code">{block.text}</pre>
          <span class="assistant-code-copy">
            <IconButton icon="copy" size="sm" title="Copy the code" onClick={() => copyText(block.text)} />
          </span>
        </div>
      );
    }
    if (block.kind === "heading") return <h3 class={block.level <= 2 ? "assistant-heading" : "assistant-heading assistant-heading--minor"}>{richText(block.text)}</h3>;
    // A table's column names: a label over its rows, not a heading of the reply.
    if (block.kind === "caption") return <p class="assistant-caption">{richText(block.text)}</p>;
    if (block.kind === "para") return <div class="assistant-text">{richText(block.text)}</div>;
    const items = <For each={block.items}>{(item) => <li>{richText(item)}</li>}</For>;
    // The markers are the stylesheet's own; the role keeps the list a list where that would drop it.
    return block.ordered ? (
      <ol class="assistant-list" role="list">
        {items}
      </ol>
    ) : (
      <ul class="assistant-list" role="list">
        {items}
      </ul>
    );
  };

  /**
   * A reply as its blocks. It grows a few fragments a frame, and each time only the text after
   * its last settled block is parsed again (`growReply`); the blocks are keyed by their objects,
   * so the settled ones stay as drawn and the one being written is the only one drawn again. What
   * a frame costs follows the size of that block, not the length of the reply (a reply parsed and
   * drawn whole on every fragment held the page for seconds).
   */
  const Reply = (p: { text: string }): JSX.Element => {
    const parsed = createMemo<ReplyParse>((prev) => growReply(prev, p.text));
    return (
      <>
        <For each={parsed().settled}>{blockView}</For>
        <For each={parsed().tail}>{blockView}</For>
      </>
    );
  };

  const resizeStrip = (): JSX.Element => (
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
  );
  const head = (): JSX.Element => (
      <div class="assistant-head">
        {/* While a model is being set up the panel is that task: its title says so. One chat needs
            no title of its own (its first prompt is the first thing under this band, and a title cut
            from it would say it twice): the band names the panel, quietly. Several chats are told
            apart by their tabs. */}
        <Show
          when={props.chats().length > 1 && !menuOpen()}
          fallback={
            <span class={menuOpen() ? "assistant-title" : "assistant-title is-quiet"} data-hint="">
              {menuOpen() ? "Set up a model" : "Assistant"}
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
  );
  const main = (drawsEmpty: boolean): JSX.Element => (
      <div class="assistant-main">
      <div
        class="assistant-body"
        ref={body}
        inert={menuOpen()}
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop;
          setFollowing(followAfterScroll(following(), lastTop, top, e.currentTarget.scrollHeight, e.currentTarget.clientHeight));
          lastTop = top;
        }}
      >
        <div class="assistant-transcript" ref={transcriptEl}>
        <Show when={from() > 0}>
          <div class="assistant-earlier">
            <Button variant="ghost" size="sm" onClick={showEarlier}>
              Show earlier
            </Button>
            <span class="assistant-earlier-count">{`${from().toLocaleString()} more above`}</span>
          </div>
        </Show>
        <Show when={from() === 0 && s.dropped() > 0}>
          <p class="assistant-earlier-note">{`This chat is long: its oldest ${s.dropped().toLocaleString()} messages and steps are no longer kept.`}</p>
        </Show>
        <Show when={drawsEmpty && s.entries.length === 0}>
          <div class="assistant-empty">
            {/* One quiet line. Before a model is set up the composer under it is the way in (its
                model slot, or Send); after, the suggestions follow the line. */}
            <p>{EMPTY_LINE}</p>
            <Show when={s.ready()}>
              <div class="assistant-examples">
                <For each={EXAMPLES}>
                  {(example) => (
                    <Row
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
                    </Row>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
        <For each={shown()}>
          {(entry, shownIndex) => {
            /** The row's place in the chat (the transcript may start after the chat's first rows). */
            const index = (): number => from() + shownIndex();
            return (
            <Switch>
              <Match when={entry.kind === "user"}>
                <div class="assistant-prompt">
                  {entry.kind === "user" ? entry.text : ""}
                  {entry.kind === "user" && entry.pictures > 0 ? <span class="assistant-prompt-pics">{` · ${entry.pictures} picture${entry.pictures === 1 ? "" : "s"}`}</span> : ""}
                  {entry.kind === "user" && entry.context !== undefined && entry.context.length > 0 ? <span class="assistant-prompt-pics">{entry.context.map((label) => ` · @${label}`).join("")}</span> : ""}
                </div>
              </Match>
              <Match when={entry.kind === "assistant"}>
                <Reply text={entry.kind === "assistant" ? entry.text : ""} />
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
                  // The row is its own hint's host: a sentence or a note the panel cuts shows whole
                  // under the pointer and under the keyboard's focus alike.
                  data-hint=""
                  onClick={() => s.toggleTool(index())}
                  aria-expanded={entry.kind === "tool" && entry.open}
                >
                  {/* What ran, as a sentence on one line: plain words, with only a command's name in the mono face. */}
                  <span class="assistant-tool-name">
                    <For each={entry.kind === "tool" ? activityParts(entry.code, entry.report) : []}>{(part) => (part.kind === "code" ? <code>{part.text}</code> : part.text)}</For>
                  </span>
                  <Show when={entry.kind === "tool" && entry.note !== ""}>
                    <span class="assistant-tool-note">{entry.kind === "tool" ? entry.note : ""}</span>
                  </Show>
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
            );
          }}
        </For>
        </div>
        <Show when={!following()}>
          <div class="assistant-jump">
            <span class="assistant-jump-key">
              <IconButton
                icon="chevron-down"
                variant="soft"
                title="Jump to the latest"
                onClick={() => {
                  setFollowing(true);
                  toEnd();
                }}
              />
            </span>
          </div>
        </Show>
      </div>
        <Show when={menuOpen()}>
          <section class="assistant-setup" id="assistant-setup" aria-label="Model setup" ref={setupEl}>
            <div
              class="assistant-setup-scroll"
              ref={(el) => {
                scrollEl = el;
                // The panel's height changed: the list is given the rows there is room for now.
                const watcher = new ResizeObserver(fitList);
                watcher.observe(el);
                onCleanup(() => watcher.disconnect());
              }}
            >
              {/* The first decision. Until it is made the sheet holds nothing else; once it is, the
                  list gives way to the form, whose title is the chosen provider, and "Change"
                  beside that title brings the list back. */}
              <Show when={listShown()}>
                <div class="assistant-setup-group">
                  <SectionLabel>Provider</SectionLabel>
                  <div
                    class="assistant-setup-list"
                    style={{ "--assistant-list-rows": String(listRows()) }}
                    onKeyDown={onPresetKey}
                    onScroll={measureList}
                    ref={(el) => {
                      listEl = el;
                    }}
                  >
                    <For each={PROVIDER_PRESETS}>
                      {(preset) => (
                        <Row selected={presetId() === preset.id} onClick={() => applyPreset(preset.id)}>
                          <span class="assistant-preset-label">{preset.label}</span>
                          <span class="assistant-preset-url">{preset.id === "custom" ? "any server" : preset.key ? "needs a key" : "no key"}</span>
                        </Row>
                      )}
                    </For>
                  </div>
                  <Show when={listCut()}>
                    <span class={moreBelow() ? "assistant-field-hint" : "assistant-field-hint is-spent"} aria-hidden="true">
                      More providers below
                    </span>
                  </Show>
                  <Show when={presetId() === null}>
                    <p class="assistant-setup-next">Choosing one fills in its address and model.</p>
                  </Show>
                </div>
              </Show>
              {/* The second step is one short form: whose connection it is, the address, the key,
                  the model. The foot under it checks it, then saves it. */}
              <Show when={presetId() !== null}>
              <div class="assistant-setup-group" ref={fieldsEl}>
                <Show when={!listShown()}>
                  <div class="assistant-setup-chosen">
                    <h2 class="assistant-setup-title" data-hint="">{picked()?.label ?? ""}</h2>
                    <span class="assistant-setup-change">
                      <Button variant="quiet" size="sm" title="Choose another provider" onClick={changeProvider}>
                        Change
                      </Button>
                    </span>
                  </div>
                </Show>
                <div class="assistant-field">
                  <span>Base URL</span>
                  <Field
                    value={draft().baseUrl}
                    ariaLabel="Base URL"
                    describedBy="assistant-url-hint"
                    title={localPreset() ? "The server must accept requests from this page" : "Every request is sent to this address"}
                    spellcheck={false}
                    placeholder="e.g. http://127.0.0.1:11434/v1"
                    onInput={setBaseUrl}
                  />
                  <span class="assistant-field-hint" id="assistant-url-hint">
                    {localPreset() ? "A server on this machine. It needs no key." : "The root of an OpenAI-compatible API, usually ending in /v1."}
                  </span>
                </div>
                <Show when={keyWanted()}>
                  <div class="assistant-field">
                    <span>API key</span>
                    {/* The show/hide key stands inside the field's end, after the field in the Tab order. */}
                    <Field
                      type={keyVisible() ? "text" : "password"}
                      value={draft().apiKey}
                      ariaLabel="API key"
                      autocomplete="off"
                      spellcheck={false}
                      describedBy="assistant-key-hint"
                      title="Sent only to the base URL above"
                      placeholder="e.g. sk-..."
                      onInput={(v) => {
                        setDraft({ ...draft(), apiKey: v });
                        forgetCheck();
                      }}
                      end={<IconButton icon={keyVisible() ? "eye" : "eye-off"} size="sm" title={keyVisible() ? "Hide the key" : "Show the key"} onClick={() => setKeyVisible(!keyVisible())} />}
                    />
                    <span class="assistant-field-hint" id="assistant-key-hint">Stored in this browser, not encrypted.</span>
                  </div>
                </Show>
                <div class="assistant-field">
                  <span>Model</span>
                  <Field
                    value={draft().model}
                    ariaLabel="Model"
                    describedBy={models().length === 0 ? "assistant-model-hint" : undefined}
                    title="Check connection lists the models the provider serves"
                    spellcheck={false}
                    placeholder="e.g. llama3.2"
                    onInput={setModel}
                  />
                  <Show when={models().length === 0}>
                    <span class="assistant-field-hint" id="assistant-model-hint">The model's name, as the provider spells it.</span>
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
                    <span class="assistant-field-hint">{`And ${(Math.max(modelTotal(), models().length) - MODEL_CHIPS).toLocaleString()} more. Type the name of one that is not shown.`}</span>
                  </Show>
                </Show>
              </div>
              </Show>
            </div>
            <div class="assistant-setup-foot">
              {/* A turn may still be running under the sheet, and the row that says so is in the
                  composer the sheet took out of the page: its status and Stop stay in view here.
                  Escape closes the sheet first, so this row shows no key cap. */}
              <Show when={s.running()}>
                <div class="assistant-stack-row assistant-setup-run" role="status">
                  <span class="assistant-ripple" />
                  <span class="assistant-stack-text" data-hint="">{runStatus()}</span>
                  <Button variant="ghost" size="sm" onClick={s.stop}>
                    Stop
                  </Button>
                </div>
              </Show>
              {/* The status line, the check and Save come with the fields they are about; before a
                  provider is chosen the foot is the one way out. The line holds one message
                  (`setupStatus`): the check running, else what it found, else what Save needs. */}
              <Show when={presetId() !== null}>
                <p class={`assistant-setup-status is-${status()?.tone ?? "idle"}`} role="status" aria-live="polite" aria-atomic="true">
                  <Show when={status()?.tone === "checking"}>
                    <span class="assistant-ripple" />
                  </Show>
                  {status()?.text ?? ""}
                </p>
              </Show>
              {/* Cancel keeps its place in both steps, apart from the two keys that move the setup
                  on; those read in the order they are used, check then save, and only Save is filled. */}
              <div class="assistant-setup-actions">
                <Button variant="ghost" onClick={closeSetup}>
                  Cancel
                </Button>
                <span class="assistant-setup-spacer" />
                <Show when={presetId() !== null}>
                  <Button disabled={!canCheck()} title={canCheck() ? undefined : "Needs an http or https base URL"} onClick={() => void checkConnection()}>
                    Check connection
                  </Button>
                  {/* Why Save is off is the status line's to say; where a check's result has the
                      line, it is this key's hint. */}
                  <Button variant="primary" disabled={blocker() !== null} title={status()?.tone === "blocked" ? undefined : (blocker() ?? undefined)} onClick={saveDraft}>
                    Save
                  </Button>
                </Show>
              </div>
            </div>
          </section>
        </Show>
      </div>
  );
  const stack = (): JSX.Element => (
      <>
        <Show when={s.running() || s.status() !== "" || s.queued.length > 0 || s.changes() !== null || over() > 0}>
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
                      <span class="assistant-stack-text" data-hint="">{item.text}</span>
                      <IconButton icon="send" size="sm" title="Send this now" description={s.running() ? "It goes by itself when this turn ends" : undefined} disabled={s.running()} onClick={() => s.sendQueued(index())} />
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
                  <For each={c().labels}>{(label) => <li data-hint="">{label}</li>}</For>
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
                  {/* In two parts: a narrow panel keeps the count and lets "to the drawing" go, where an ellipsis would cut mid-word. */}
                  <span class="assistant-stack-text assistant-stack-text--parts">
                    <span>{c().steps === 1 ? "1 change" : `${c().steps} changes`}</span>
                    <span> to the drawing</span>
                  </span>
                  <Button variant="ghost" size="sm" disabled={s.running()} title={s.running() ? "Wait for this turn to end" : undefined} onClick={s.undoChanges}>
                    Undo all
                  </Button>
                  <Button size="sm" disabled={s.running()} title={s.running() ? "Wait for this turn to end" : undefined} onClick={s.keepChanges}>
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
                <span class="assistant-stack-text" data-hint="">{runStatus()}</span>
                <Show when={s.running()}>
                  <Button variant="ghost" size="sm" onClick={s.stop}>
                    Stop
                  </Button>
                  <Kbd>esc</Kbd>
                </Show>
              </div>
            </Show>
            <Show when={over() > 0}>
              <div class="assistant-stack-row assistant-stack-row--over" id="assistant-over">
                <span class="assistant-stack-text" data-hint={`One message holds ${MAX_MESSAGE_CHARS.toLocaleString()} characters`} data-hint-note="Nothing is cut: shorten it to send it">
                  {`${over().toLocaleString()} ${over() === 1 ? "character" : "characters"} too long to send`}
                </span>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={slash() !== null}>
          <div class="assistant-stack assistant-slash">
            <Show when={slashMatches().length > 0}>
              {/* A press on the list keeps the keyboard in the editor, which is the list's combobox. */}
              <div class="assistant-slash-list" id="assistant-slash" role="listbox" aria-label="Commands" onMouseDown={(e) => e.preventDefault()}>
                <For each={slashMatches()}>
                  {(match, index) => (
                    <Row option id={slashOptionId(index())} selected={index() === slashIndex()} disabled={!match.item.enabled} onPointerMove={(e) => onSlashPointerMove(e, index())} onClick={() => runSlash(index())}>
                      <span class="assistant-slash-label">
                        <For each={highlight(match.item.label, match.indices)}>{(part) => (part.hit ? <mark class="assistant-slash-hit">{part.text}</mark> : part.text)}</For>
                      </span>
                      <span class="assistant-slash-id">{match.via ?? match.item.id}</span>
                    </Row>
                  )}
                </For>
              </div>
            </Show>
            <Show when={slashMatches().length === 0}>
              <div class="assistant-stack-row">
                <span class="assistant-stack-text">No command matches. Keep typing to send it as a message.</span>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={mention() !== null}>
          <div class="assistant-stack assistant-slash">
            <Show when={mentionMatches().length > 0}>
              {/* The same listbox as the slash list's: the editor is its combobox and keeps the keyboard. */}
              <div class="assistant-slash-list" id="assistant-mentions" role="listbox" aria-label="Context from the drawing" onMouseDown={(e) => e.preventDefault()}>
                <For each={mentionMatches()}>
                  {(match, index) => (
                    <Row option id={slashOptionId(index())} selected={index() === slashIndex()} onPointerMove={(e) => onSlashPointerMove(e, index())} onClick={() => pickMention(index())}>
                      <span class="assistant-mention-icon">
                        <ToolIcon id={match.option.icon} />
                      </span>
                      <span class="assistant-slash-label">
                        <For each={highlight(match.option.label, match.indices)}>{(part) => (part.hit ? <mark class="assistant-slash-hit">{part.text}</mark> : part.text)}</For>
                      </span>
                      <span class="assistant-mention-detail">{match.option.detail}</span>
                    </Row>
                  )}
                </For>
              </div>
            </Show>
            <Show when={mentionMatches().length === 0}>
              <div class="assistant-stack-row">
                <span class="assistant-stack-text">No layer or bench line matches. Keep typing to send it as written.</span>
              </div>
            </Show>
          </div>
        </Show>
      </>
  );
  /* The chips' box is always there, so the card eases to and from the height of its row
     (`easeChips`). A chip that is taken away fades first (`is-leaving`) and leaves the
     message when that has played. */
  const chips = (): JSX.Element => (
          <div class="assistant-attachments-clip" ref={chipsBox}>
            <Show when={selectionShown() || s.attached().length > 0 || mentionChips().length > 0}>
              <div class="assistant-attachments-row" ref={chipsRow}>
                <Show when={selectionShown()}>
                  <span class={chipClass("selection", "assistant-attachment assistant-attachment--context")} onAnimationEnd={(e) => e.animationName === "assistant-attachment-out" && takeOut("selection")}>
                    <span class="assistant-attachment-icon">
                      <ToolIcon id="pick" />
                    </span>
                    <span class="assistant-attachment-name">{props.selection().length === 1 ? "1 selected" : `${props.selection().length} selected`}</span>
                    <IconButton icon="close" size="sm" title="Leave the selection out" onClick={() => remove("selection")} />
                  </span>
                </Show>
                <For each={mentionChips()}>
                  {(item) => (
                    <span class={chipClass(item, "assistant-attachment assistant-attachment--context")} onAnimationEnd={(e) => e.animationName === "assistant-attachment-out" && takeOut(item)}>
                      <span class="assistant-attachment-icon">
                        <ToolIcon id={item.kind === "layer" ? "list" : "gem"} />
                      </span>
                      <span class="assistant-attachment-name" data-hint="" data-hint-note={item.kind === "bench" ? item.value : "Layer"}>
                        {mentionLabel(item)}
                      </span>
                      <IconButton icon="close" size="sm" title={`Leave ${mentionLabel(item)} out`} onClick={() => remove(item)} />
                    </span>
                  )}
                </For>
                <For each={s.attached()}>
                  {(picture) => (
                    <span class={chipClass(picture, "assistant-attachment")} onAnimationEnd={(e) => e.animationName === "assistant-attachment-out" && takeOut(picture)}>
                      {/* The name is printed beside the thumbnail: an `alt` that repeated it would be read twice. */}
                      <img src={picture.dataUrl} alt="" />
                      <span class="assistant-attachment-name" data-hint="">
                        {picture.name}
                      </span>
                      <IconButton icon="close" size="sm" title={`Remove ${picture.name}`} onClick={() => remove(picture)} />
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </div>
  );
  const editor = (): JSX.Element => (
          <label class="assistant-input" for={COMPOSER_ID}>
            <TextArea
              variant="bare"
              ref={(el) => {
                inputEl = el;
                // The label around the editor names it by id: a press on the card's inset lands in it.
                el.id = COMPOSER_ID;
                // The `@` list follows the caret, which moves without the text changing.
                const sync = (): void => void setCaret(el.selectionEnd);
                for (const type of ["keyup", "click", "select", "focus"]) el.addEventListener(type, sync);
              }}
              rows={COMPOSER_ROWS}
              maxRows={COMPOSER_MAX_ROWS}
              placeholder={s.running() ? "Queue a follow-up" : "Ask, @ for context, / for commands"}
              value={s.input()}
              onInput={(value) => {
                batch(() => {
                  setCaret(inputEl?.selectionEnd ?? value.length);
                  s.setInput(value);
                });
                // A notice (a refused attachment, a restore) has been read once typing resumes.
                if (!s.running() && s.status() !== "") s.setStatus("");
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              ariaLabel="Ask the assistant"
              invalid={over() > 0}
              describedBy={over() > 0 ? "assistant-over" : undefined}
              role={listed() === null ? undefined : "combobox"}
              expanded={listed() === null ? undefined : listCount() > 0}
              controls={listCount() > 0 ? (listed() === "mention" ? "assistant-mentions" : "assistant-slash") : undefined}
              activeDescendant={listCount() > 0 ? slashOptionId(slashIndex()) : undefined}
              autocompleteKind={listed() === null ? undefined : "list"}
            />
          </label>
  );
  const toolbar = (): JSX.Element => (
          <div class="assistant-row">
            {/* The model chip and the context meter share one line: in a narrow panel the meter
                is the first to go, and only then does the model's name give way. */}
            <div class="assistant-row-model">
              <button
                class="assistant-ghost"
                type="button"
                ref={(el) => describeByHint(el, () => [chipHint(), chipNote()].filter((line) => line !== undefined).join(". "))}
                data-hint={chipHint()}
                data-hint-note={chipNote()}
                aria-expanded={menuOpen()}
                aria-controls="assistant-setup"
                onClick={() => (menuOpen() ? closeSetup() : openSetup())}
              >
                {/* No model yet: the slot is the call to action, in the accent's text ink, and it
                    opens the setup. It is not a picker until there is a model to change. */}
                <span class={s.ready() ? "assistant-ghost-label" : "assistant-ghost-label is-unset"}>{s.ready() ? s.provider().model : "Set up a model"}</span>
                <Show when={s.ready()}>
                  <span class="assistant-ghost-caret">
                    <ToolIcon id="chevron-down" />
                  </span>
                </Show>
              </button>
              <Show when={meter() !== ""}>
                <span
                  class="assistant-context"
                  role="img"
                  aria-label={`Context the next request carries: ${used().toLocaleString()} of ${MAX_REQUEST_CHARS.toLocaleString()} characters`}
                  data-hint="Context in the next request"
                  data-hint-note={`${used().toLocaleString()} of ${MAX_REQUEST_CHARS.toLocaleString()} characters`}
                >
                  {meter()}
                </span>
              </Show>
            </div>
            <div class="assistant-actions">
              <IconButton icon="attach" title="Attach a picture" description="Or paste one, or drop one on the panel" onClick={() => fileInput?.click()} />
              <Show
                when={s.running() && s.input().trim() === ""}
                fallback={
                  <IconButton
                    icon="send"
                    variant="inverted"
                    title={s.running() ? "Queue" : "Send"}
                    shortcut="Enter"
                    description={sendNote()}
                    disabled={s.input().trim() === "" || over() > 0}
                    onClick={send}
                  />
                }
              >
                {/* The status row over the card has the button named "Stop"; this key says what it stops, so a screen reader hears two controls with two names. */}
                <IconButton icon="stop" variant="inverted" title="Stop the turn" shortcut="Esc" onClick={s.stop} />
              </Show>
            </div>
          </div>
  );
  const picker = (): JSX.Element => (
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
  );
  const view: AssistantFrame = {
    props,
    session: s,
    setupOpen: menuOpen,
    toggleSetup: () => (menuOpen() ? closeSetup() : openSetup()),
    modelHint: chipHint,
    modelNote: chipNote,
    meter,
    used,
    budget: MAX_REQUEST_CHARS,
    selectionShown,
    mentionChips,
    drop,
    sendNote,
    over,
    send,
    newChat,
    attach: () => fileInput?.click(),
    emptyLine: EMPTY_LINE,
    examples: EXAMPLES,
    useExample: (text) => {
      s.setInput(text);
      inputEl?.focus();
    },
    focusEditor: () => inputEl?.focus(),
    main,
    stack,
    editor,
    picker,
  };

  return (
    <aside
      class="assistant-panel"
      ref={panelEl}
      role="complementary"
      aria-label="Assistant"
      style={{ "--assistant-width": `${width()}px` }}
      on:keydown={onEscape}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <Show
        when={props.frame}
        fallback={
          <>
            {resizeStrip()}
            {head()}
            {main(true)}
            {/* The setup sheet takes the panel to its foot: the composer, which cannot send without a
                model, is out of the page (and the tab order) until the sheet closes. */}
            <div class="assistant-composer" hidden={menuOpen()}>
              {stack()}
              <div class="assistant-box">
                {chips()}
                {editor()}
                {toolbar()}
                {picker()}
              </div>
            </div>
          </>
        }
      >
        {(frame) => frame()(view)}
      </Show>
    </aside>
  );
}
