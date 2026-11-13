/**
 * The assistant panel's frame as the Slab document takes it (`slab/assistant.slab`): scalars and
 * typed lists, shaped here from what the SolidJS panel hands a frame
 * (`../components/AssistantPane`: `AssistantFrame`). Nothing is decided here that the panel
 * decides: which chats there are, what a chip is, whether Send is off and why are the panel's.
 * This file words them for the kernel, breaks the chips into lines (an `each` under a `wrap` is
 * one box at the pinned commit), says what the toolbar's line has room for, and reads a signal's
 * item key back to the thing it stands for, so a stale or forged signal does nothing.
 */

import type { ChatImage } from "../assistant";
import { mentionLabel, type Mention } from "../mentions";
import { assistantGlyph, CHIP_PX, KEY_PX } from "./assistant-icons";
import { paramText } from "./bench-params";
import type { TextMeasure } from "./measure";

// ---- The title band ------------------------------------------------------------------------

/** One item of the band's `chats` list: an `AssistantChat` of the document. */
export interface ChatParam {
  key: string;
  /** The chat's title: the tab's label and its accessible name. */
  name: string;
  /** The close key's accessible name. */
  shut: string;
  front: boolean;
  lead: boolean;
  /** The widest the tab may be, in px. */
  cap: number;
}

/** The most chats the band draws as tabs (a Slab list is laid out whole). */
export const MAX_CHAT_TABS = 64;

/** The most characters of a title a tab shows before it clips (ui.css: `.ui-tab--sm`, 18ch). */
export const CHAT_CAP_CH = 18;

/** A tab's own inset each side (ui.css: `.ui-tab--sm`). */
const CHAT_INSET = 6;

/** A chat's key is its place in the band (see `./tabs-params` for why a key is a place). */
const chatKey = (index: number): string => `chat-${index}`;

/** The widest a chat's tab may be: `CHAT_CAP_CH` characters of the label face, and its insets. */
export function chatCap(measure: TextMeasure): number {
  const zero = measure("label", "0");
  return Math.ceil(CHAT_CAP_CH * (Number.isFinite(zero) && zero > 0 ? zero : 7)) + 2 * CHAT_INSET;
}

/** The band's tabs: every open chat in order, the one shown in front. */
export function chatParams(titles: readonly string[], front: number, cap: number): ChatParam[] {
  const width = Number.isFinite(cap) && cap > 0 ? Math.min(cap, 4096) : 0;
  return titles.slice(0, MAX_CHAT_TABS).map((title, index) => {
    const name = paramText(title);
    return { key: chatKey(index), name, shut: `Close ${name}`, front: index === front, lead: index > 0, cap: width };
  });
}

/** The chat a tab's item key stands for, by its place; null when the key names no tab that is there. */
export function pressedChat(itemKey: string, count: number): number | null {
  const m = /^chat-(\d{1,3})$/.exec(itemKey);
  if (m === null) return null;
  const index = Number(m[1]);
  return index < Math.min(count, MAX_CHAT_TABS) ? index : null;
}

/** Whether a tab cuts its title: the hint then says it whole. */
export function chatClipped(name: string, cap: number, measure: TextMeasure): boolean {
  return measure("label", name) > cap - 2 * CHAT_INSET;
}

// ---- The empty state -----------------------------------------------------------------------

/** One item of the empty state's `ideas` list: an `AssistantIdea` of the document. */
export interface IdeaParam {
  key: string;
  words: string;
  glyph: string;
}

const ideaKey = (index: number): string => `idea-${index}`;

/** The empty state's suggestions, each with the name of its glyph in the document. */
export function ideaParams(examples: readonly { icon: string; text: string }[]): IdeaParam[] {
  return examples.slice(0, 8).map((example, index) => ({ key: ideaKey(index), words: paramText(example.text), glyph: assistantGlyph(example.icon, KEY_PX) }));
}

/** The words a pressed suggestion puts in the composer (its own, never the drawn ones); null for a key of none. */
export function pressedIdea(itemKey: string, examples: readonly { icon: string; text: string }[]): string | null {
  const m = /^idea-(\d)$/.exec(itemKey);
  return m === null ? null : (examples[Number(m[1])]?.text ?? null);
}

// ---- The chips -----------------------------------------------------------------------------

/** One thing a message carries besides its words, as the panel has it. */
export type ChipSource = { kind: "selection"; count: number } | { kind: "mention"; mention: Mention } | { kind: "picture"; picture: ChatImage };

/** One item of a line's `chips` list: an `AssistantChip` of the document. */
export interface ChipParam {
  key: string;
  name: string;
  /** The accessible name of the key that takes the chip out. */
  shut: string;
  glyph: string;
  /** The name the picture's thumbnail is registered under; "" for a chip with a glyph. */
  thumb: string;
  tinted: boolean;
  pictured: boolean;
  lead: boolean;
  /** The widest the name may be, in px. */
  cap: number;
}

/** One item of the card's `chip_lines` list: an `AssistantChipLine` of the document. */
export interface ChipLineParam {
  key: string;
  lead: boolean;
  chips: ChipParam[];
}

/** The most chips the card draws (the panel allows four pictures and a handful of mentions). */
export const MAX_CHIPS = 32;

/** A chip's measures (assistant.css: `.assistant-attachment` and below). */
export const CHIP_METRICS = { pad: 5, gap: 4, glyph: CHIP_PX, thumb: 20, close: 20, closeCoarse: 24, nameCap: 120, between: 4, nameMin: 24 } as const;

const chipKey = (index: number): string => `chip-${index}`;

/** The chips in the order the panel draws them: the selection, what was pointed at, the pictures. */
export function chipSources(selectionShown: boolean, selected: number, mentions: readonly Mention[], pictures: readonly ChatImage[]): ChipSource[] {
  const out: ChipSource[] = [];
  if (selectionShown) out.push({ kind: "selection", count: selected });
  for (const mention of mentions) if (mention.kind !== "selection") out.push({ kind: "mention", mention });
  for (const picture of pictures) out.push({ kind: "picture", picture });
  return out.slice(0, MAX_CHIPS);
}

/** What a chip says: its name, and the name of the key that takes it out (the panel's own words). */
export function chipWords(source: ChipSource): { name: string; shut: string } {
  if (source.kind === "selection") return { name: source.count === 1 ? "1 selected" : `${source.count} selected`, shut: "Leave the selection out" };
  if (source.kind === "mention") {
    const name = paramText(mentionLabel(source.mention));
    return { name, shut: `Leave ${name} out` };
  }
  const name = paramText(source.picture.name);
  return { name, shut: `Remove ${name}` };
}

/** The second line of a chip's hint when its name is cut or says less than there is: a bench line's value, or "Layer". */
export function chipNote(source: ChipSource): string | undefined {
  if (source.kind !== "mention") return undefined;
  return source.mention.kind === "bench" ? paramText(source.mention.value) : source.mention.kind === "layer" ? "Layer" : undefined;
}

function chipGlyph(source: ChipSource): string {
  if (source.kind === "selection") return assistantGlyph("pick", CHIP_PX);
  if (source.kind === "mention") return assistantGlyph(source.mention.kind === "layer" ? "list" : "gem", CHIP_PX);
  return "";
}

/**
 * The chips broken into lines for a card `width` px wide inside its insets: a chip that does not
 * fit what is left of a line starts the next, and one wider than a whole line has its name cut to
 * the line. `thumbOf` is the name a picture's thumbnail is registered under ("" when it has none
 * yet: the chip keeps its place and shows no picture). Under a finger (`coarse`) a chip's close
 * key is the wider one the document draws.
 */
export function chipLines(sources: readonly ChipSource[], width: number, measure: TextMeasure, thumbOf: (picture: ChatImage) => string, coarse = false): ChipLineParam[] {
  const m = CHIP_METRICS;
  const room = Number.isFinite(width) && width > 0 ? width : Number.POSITIVE_INFINITY;
  const lines: ChipLineParam[] = [];
  let line: ChipParam[] = [];
  let used = 0;
  const close = (): void => {
    if (line.length === 0) return;
    lines.push({ key: `line-${lines.length}`, lead: lines.length > 0, chips: line });
    line = [];
    used = 0;
  };
  for (const [index, source] of sources.slice(0, MAX_CHIPS).entries()) {
    const words = chipWords(source);
    const pictured = source.kind === "picture";
    const rest = 2 * m.pad + (pictured ? m.thumb : m.glyph) + 2 * m.gap + (coarse ? m.closeCoarse : m.close);
    const natural = Math.min(m.nameCap, Math.ceil(measure("chip", words.name)));
    if (line.length > 0 && used + m.between + rest + natural > room) close();
    const before = line.length > 0 ? m.between : 0;
    const cap = Math.max(m.nameMin, Math.min(natural, room - used - before - rest));
    line.push({
      key: chipKey(index),
      name: words.name,
      shut: words.shut,
      glyph: chipGlyph(source),
      thumb: pictured ? thumbOf(source.picture) : "",
      tinted: !pictured,
      pictured,
      lead: line.length > 0,
      cap: Number.isFinite(cap) ? cap : m.nameCap,
    });
    used += before + rest + (Number.isFinite(cap) ? cap : natural);
  }
  close();
  return lines;
}

/** The chip an item key stands for, by its place; null when the key names no chip that is there. */
export function pressedChip(itemKey: string, sources: readonly ChipSource[]): ChipSource | null {
  const m = /^chip-(\d{1,2})$/.exec(itemKey);
  return m === null ? null : (sources[Number(m[1])] ?? null);
}

/** Whether a chip's name is cut at this cap. */
export function chipClipped(name: string, cap: number, measure: TextMeasure): boolean {
  return measure("chip", name) > cap + 0.5;
}

// ---- The toolbar ---------------------------------------------------------------------------

/** The toolbar's measures (assistant.css: `.assistant-row`, `.assistant-ghost`, `.assistant-context`). */
export const TOOL_METRICS = { padStart: 4, padEnd: 6, gap: 4, key: 24, slotPad: 8, caret: CHIP_PX, caretGap: 2, meterEnd: 4, slotMin: 48 } as const;

/** What the toolbar shows, as the panel has it. */
export interface ToolbarState {
  /** A model is set up, and its name. */
  ready: boolean;
  model: string;
  /** The model slot's hint and its second line. */
  hint: string;
  note: string | undefined;
  /** The context meter's figures ("" for none), and what they count. */
  meter: string;
  used: number;
  budget: number;
  running: boolean;
  draft: string;
  /** How far the draft is over one message, or 0. */
  over: number;
  sendNote: string | undefined;
}

export interface ToolbarParams {
  model: string;
  model_said: string;
  model_cap: number;
  unset: boolean;
  meter: string;
  meter_said: string;
  metered: boolean;
  stopping: boolean;
  send_name: string;
  send_said: string;
  send_off: boolean;
}

/** The send key as the panel decides it: Send, Queue behind a running turn, or (nothing typed while one runs) Stop. */
export function sendKey(state: Pick<ToolbarState, "running" | "draft" | "over" | "sendNote">): { stopping: boolean; name: string; keys: string; note: string; off: boolean } {
  const empty = state.draft.trim() === "";
  if (state.running && empty) return { stopping: true, name: "Stop the turn", keys: "Esc", note: "", off: false };
  return { stopping: false, name: state.running ? "Queue" : "Send", keys: "Enter", note: state.sendNote ?? "", off: empty || state.over > 0 };
}

/**
 * The toolbar for a line `width` px wide (the card's inside). What gives way in a narrow panel is
 * the SolidJS toolbar's order: the meter goes first, and only then is the model's name cut. The
 * attach and send keys never give way.
 */
export function toolbarParams(state: ToolbarState, width: number, measure: TextMeasure): ToolbarParams {
  const t = TOOL_METRICS;
  const model = state.ready ? paramText(state.model) : "Set up a model";
  const slot = 2 * t.slotPad + Math.ceil(measure("body", model)) + (state.ready ? t.caretGap + t.caret : 0);
  const meterWidth = state.meter === "" ? 0 : Math.ceil(measure("mono", state.meter)) + t.meterEnd;
  // The line's five parts (slot, spacer, meter, attach, send) stand four gaps apart.
  const fixed = t.padStart + t.padEnd + 4 * t.gap + 2 * t.key;
  const room = Number.isFinite(width) && width > 0 ? width : 4096;
  const metered = meterWidth > 0 && slot + meterWidth + fixed <= room;
  const send = sendKey(state);
  return {
    model,
    model_said: paramText([state.hint, state.note].filter((line) => line !== undefined && line !== "").join(". ")),
    model_cap: Math.max(t.slotMin, Math.min(4096, room - fixed - (metered ? meterWidth : 0))),
    unset: !state.ready,
    meter: paramText(state.meter),
    meter_said: state.meter === "" ? "" : `Context the next request carries: ${state.used.toLocaleString()} of ${state.budget.toLocaleString()} characters`,
    metered,
    stopping: send.stopping,
    send_name: send.name,
    send_said: paramText(send.note),
    send_off: send.off,
  };
}

// ---- The scene's keys ------------------------------------------------------------------------

/** The controls of the frame a hint or a focus is told apart by. */
export type AssistantControl = "new" | "close" | "model" | "attach" | "send" | "meter" | "chat" | "chat-shut" | "idea" | "chip" | "chip-drop";

/** The document's keys for the controls that are no list's items. */
export const KEYS = {
  new: "#panel/#head/#keys/#new",
  close: "#panel/#head/#keys/#close",
  model: "#panel/#footbox/#foot/#card/#tools/#model",
  attach: "#panel/#footbox/#foot/#card/#tools/#attach",
  send: "#panel/#footbox/#foot/#card/#tools/#send",
  card: "#panel/#footbox/#foot/#card",
  tabs: "#panel/#head/#name/#tabs",
} as const;

/** Which control a scene key is, by where it stands in the document; null for a key of none. */
export function controlOfKey(key: string): AssistantControl | null {
  if (key.length > 512) return null;
  if (key === KEYS.new) return "new";
  if (key === KEYS.close) return "close";
  if (key === KEYS.model) return "model";
  if (key === KEYS.attach) return "attach";
  if (key === KEYS.send) return "send";
  if (key.includes("/#meterbox/")) return "meter";
  if (key.includes("/#tabs/")) return key.endsWith("/#shut") ? "chat-shut" : "chat";
  if (key.includes("/#ideas/")) return "idea";
  if (key.includes("/#chips/")) return key.endsWith("/#drop") ? "chip-drop" : "chip";
  return null;
}

/** What of a scene node is read to find the control under the pointer. */
export interface ControlBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  role?: string;
}

/** The roles of the nodes a hint belongs to. */
const HINTED_ROLES: ReadonlySet<string> = new Set(["button", "tab", "img"]);

/**
 * The key of the control under a point of the surface (in its own px): the innermost node there
 * with a role a hint belongs to (the scene lists a node before what is inside it), or a chip's
 * face when the point is on a chip and on none of its keys. Null over nothing with a hint.
 */
export function controlAt(scene: readonly ControlBox[], x: number, y: number): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let found: string | null = null;
  for (const node of scene) {
    if (!(x >= node.x && x < node.x + node.w && y >= node.y && y < node.y + node.h)) continue;
    const control = controlOfKey(node.key);
    if (control === null) continue;
    if (HINTED_ROLES.has(node.role ?? "") || (control === "chip" && found === null)) found = node.key;
  }
  return found;
}
