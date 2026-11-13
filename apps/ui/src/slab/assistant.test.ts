/**
 * The assistant panel's frame drawn by Slab: the glyphs generated from the interface's own
 * paths, the panel's state as the document takes it (`./assistant-params`), a signal's key read
 * back to what it stands for, what the document declares, and how the frame reaches the page
 * (the SolidJS panel takes a frame; the standard shell names no Slab module).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatImage } from "../assistant";
import { ICON_PATHS } from "../icons";
import type { Mention } from "../mentions";
import { ASSISTANT_GLYPHS, assistantGlyph, assistantIconBlock, assistantIconSource, CHIP_PX, ICONS_BEGIN, ICONS_END, KEY_PX, withAssistantIcons } from "./assistant-icons";
import {
  CHAT_CAP_CH,
  chatCap,
  chatClipped,
  chatParams,
  CHIP_METRICS,
  chipClipped,
  chipLines,
  chipNote,
  chipSources,
  chipWords,
  controlAt,
  controlOfKey,
  ideaParams,
  KEYS,
  MAX_CHAT_TABS,
  MAX_CHIPS,
  pressedChat,
  pressedChip,
  pressedIdea,
  sendKey,
  TOOL_METRICS,
  toolbarParams,
  type ControlBox,
  type ToolbarState,
} from "./assistant-params";
import { MAX_PARAM_TEXT } from "./bench-params";
import type { TextMeasure } from "./measure";
import { gridStroke, ICON_GRID } from "./ribbon-icons";
import { mapTokens } from "./tokens";

const ui = join(import.meta.dir, "..", "..");
const documentPath = join(ui, "slab", "assistant.slab");
// `ASSISTANT_ICONS=write bun test src/slab/assistant.test.ts` writes the generated glyphs into
// the document again (after `icons.ts` or the table of glyphs changed); the tests below then hold.
if (process.env["ASSISTANT_ICONS"] === "write") {
  const next = withAssistantIcons(readFileSync(documentPath, "utf8"));
  if (next !== null) writeFileSync(documentPath, next);
}
const source = readFileSync(documentPath, "utf8");
const host = readFileSync(join(ui, "src", "slab", "SlabAssistant.tsx"), "utf8");
const pane = readFileSync(join(ui, "src", "components", "AssistantPane.tsx"), "utf8");

/** Every character 6 px wide, in every style: widths that can be counted by hand. */
const six: TextMeasure = (_style, text) => [...text].length * 6;

const EXAMPLES = [
  { icon: "ring", text: "Draw a size 7 platinum band, 2.5 mm wide" },
  { icon: "gem", text: "Set a 6 mm oval sapphire with a halo" },
  { icon: "dist", text: "Total the stones, carats and grams" },
] as const;

const picture = (name: string): ChatImage => ({ name, dataUrl: "data:image/png;base64,AAAA" });
const layer = (name: string): Mention => ({ kind: "layer", name });
const benchLine: Mention = { kind: "bench", label: "Round 1.5 mm", value: "14 pc · 0.18 ct", handles: ["2A"] };

const state = (over: Partial<ToolbarState> = {}): ToolbarState => ({ ready: true, model: "llama3.2", hint: "Change the model", note: "http://127.0.0.1:11434/v1", meter: "0.8k / 60k", used: 812, budget: 60_000, running: false, draft: "", over: 0, sendNote: "Type a message first", ...over });

describe("the frame's glyphs", () => {
  test("the document's block is the generator's output, character for character", () => {
    expect(assistantIconBlock(source)).toBe(assistantIconSource());
    expect(withAssistantIcons(source)).toBe(source);
    expect(assistantIconBlock("no markers")).toBeNull();
    expect(assistantIconBlock(`${ICONS_END}\n${ICONS_BEGIN}`)).toBeNull();
  });

  test("every declared path is the interface's own, at the stroke its size takes, and nothing else is declared", () => {
    const drawn = [...source.matchAll(/^icon ([a-z-]+) viewbox=(\d+) \{\n {2}path "([^"]+)" bg=none stroke=current stroke-w=([\d.]+)\n\}$/gm)].map((d) => ({ name: d[1] ?? "", grid: d[2] ?? "", path: d[3] ?? "", stroke: d[4] ?? "" }));
    expect(drawn.map((d) => d.name)).toEqual(ASSISTANT_GLYPHS.map((g) => assistantGlyph(g.id, g.px)));
    expect([...source.matchAll(/^icon /gm)].length).toBe(ASSISTANT_GLYPHS.length);
    expect(new Set(drawn.map((d) => d.name)).size).toBe(drawn.length);
    for (const [index, glyph] of ASSISTANT_GLYPHS.entries()) {
      expect(Object.hasOwn(ICON_PATHS, glyph.id)).toBe(true);
      expect(drawn[index]?.path).toBe(ICON_PATHS[glyph.id] ?? "missing");
      expect(drawn[index]?.grid).toBe(String(ICON_GRID));
      expect(drawn[index]?.stroke).toBe(gridStroke(glyph.px));
    }
  });

  test("every glyph the document draws by name is declared, and one that is not has no name", () => {
    const declared = new Set(ASSISTANT_GLYPHS.map((g) => assistantGlyph(g.id, g.px)));
    for (const use of source.matchAll(/^\s+icon (a-[a-z-]+) size=/gm)) expect(declared.has(use[1] ?? "")).toBe(true);
    for (const example of EXAMPLES) expect(declared.has(assistantGlyph(example.icon, KEY_PX))).toBe(true);
    for (const id of ["pick", "list", "gem", "close", "chevron-down"]) expect(declared.has(assistantGlyph(id, CHIP_PX))).toBe(true);
    expect(assistantGlyph("nosuch", KEY_PX)).toBe("");
    expect(assistantGlyph("pick", KEY_PX)).toBe("");
    // A name of the document may not end in a number: the size is a word.
    for (const name of declared) expect(name).toMatch(/^a-[a-z-]+-(md|sm)$/);
  });
});

describe("the title band", () => {
  test("every open chat is a tab in order, the one shown in front, each with its close key's name", () => {
    const tabs = chatParams(["Draw a band", "New chat", "Total the stones"], 1, 120);
    expect(tabs.map((t) => t.name)).toEqual(["Draw a band", "New chat", "Total the stones"]);
    expect(tabs.map((t) => t.front)).toEqual([false, true, false]);
    expect(tabs.map((t) => t.lead)).toEqual([false, true, true]);
    expect(tabs.map((t) => t.shut)).toEqual(["Close Draw a band", "Close New chat", "Close Total the stones"]);
    expect(tabs.map((t) => t.key)).toEqual(["chat-0", "chat-1", "chat-2"]);
    expect(tabs.every((t) => t.cap === 120)).toBe(true);
  });

  test("a pressed tab is read back by its place; a stale or forged key selects and closes nothing", () => {
    expect(pressedChat("chat-0", 3)).toBe(0);
    expect(pressedChat("chat-2", 3)).toBe(2);
    for (const key of ["", "chat-3", "chat--1", "chat-1e2", "chat-1 ", "chat", "1", "__proto__", "chat-9999", "idea-0", "chat-0/row@0"]) expect(pressedChat(key, 3)).toBeNull();
    expect(pressedChat("chat-0", 0)).toBeNull();
  });

  test("the band is capped, a title is one line, and a tab is as wide as eighteen characters at most", () => {
    const many = Array.from({ length: 500 }, (_, i) => `Chat ${i}`);
    expect(chatParams(many, 0, 120)).toHaveLength(MAX_CHAT_TABS);
    expect(pressedChat(`chat-${MAX_CHAT_TABS}`, many.length)).toBeNull();
    const odd = chatParams(["a\nb c", "x".repeat(5000)], 0, Number.NaN);
    expect(odd[0]?.name).toBe("a b c");
    expect(odd[1]?.name.length).toBeLessThanOrEqual(MAX_PARAM_TEXT);
    expect(odd[0]?.cap).toBe(0);
    expect(chatCap(six)).toBe(CHAT_CAP_CH * 6 + 12);
    expect(chatCap(() => Number.NaN)).toBeGreaterThan(0);
    expect(chatClipped("short", chatCap(six), six)).toBe(false);
    expect(chatClipped("x".repeat(CHAT_CAP_CH + 1), chatCap(six), six)).toBe(true);
  });
});

describe("the empty state", () => {
  test("the suggestions are the panel's, each with its glyph; a press gives back the panel's own words", () => {
    const ideas = ideaParams(EXAMPLES);
    expect(ideas.map((i) => i.words)).toEqual(EXAMPLES.map((e) => e.text));
    expect(ideas.map((i) => i.glyph)).toEqual(["a-ring-md", "a-gem-md", "a-dist-md"]);
    expect(pressedIdea("idea-1", EXAMPLES)).toBe(EXAMPLES[1].text);
    for (const key of ["", "idea-3", "idea--1", "idea-10", "chat-0", "idea-0/row@0"]) expect(pressedIdea(key, EXAMPLES)).toBeNull();
  });
});

describe("the chips", () => {
  const sources = chipSources(true, 32, [layer("Metal"), { kind: "selection", handles: [] }, benchLine], [picture("sketch.png")]);

  test("the order and the words are the SolidJS card's: the selection, what was pointed at, the pictures", () => {
    expect(sources.map((s) => s.kind)).toEqual(["selection", "mention", "mention", "picture"]);
    expect(sources.map((s) => chipWords(s).name)).toEqual(["32 selected", "Metal", "Round 1.5 mm", "sketch.png"]);
    expect(sources.map((s) => chipWords(s).shut)).toEqual(["Leave the selection out", "Leave Metal out", "Leave Round 1.5 mm out", "Remove sketch.png"]);
    expect(chipWords({ kind: "selection", count: 1 }).name).toBe("1 selected");
    expect(sources.map(chipNote)).toEqual([undefined, "Layer", "14 pc · 0.18 ct", undefined]);
    // A selection left out draws no chip; a mention of the selection never draws a second one.
    expect(chipSources(false, 32, [{ kind: "selection", handles: [] }], [])).toEqual([]);
  });

  test("context is tinted and carries a glyph; a picture carries its thumbnail's name", () => {
    const chips = chipLines(sources, 1000, six, () => "thumb-7").flatMap((line) => line.chips);
    expect(chips.map((c) => c.glyph)).toEqual(["a-pick-sm", "a-list-sm", "a-gem-sm", ""]);
    expect(chips.map((c) => c.tinted)).toEqual([true, true, true, false]);
    expect(chips.map((c) => c.pictured)).toEqual([false, false, false, true]);
    expect(chips.map((c) => c.thumb)).toEqual(["", "", "", "thumb-7"]);
    expect(chips.map((c) => c.key)).toEqual(["chip-0", "chip-1", "chip-2", "chip-3"]);
  });

  test("a chip that does not fit what is left of a line starts the next", () => {
    const m = CHIP_METRICS;
    const width = (name: string, pictured: boolean): number => 2 * m.pad + (pictured ? m.thumb : m.glyph) + 2 * m.gap + m.close + [...name].length * 6;
    const one = width("32 selected", false);
    const two = one + m.between + width("Metal", false);
    expect(chipLines(sources, two, six, () => "").map((line) => line.chips.map((c) => c.name))).toEqual([["32 selected", "Metal"], ["Round 1.5 mm"], ["sketch.png"]]);
    expect(chipLines(sources, two - 1, six, () => "").map((line) => line.chips.length)).toEqual([1, 1, 1, 1]);
    const wide = chipLines(sources, 100_000, six, () => "");
    expect(wide).toHaveLength(1);
    expect(wide[0]?.lead).toBe(false);
    expect(wide[0]?.chips.map((c) => c.lead)).toEqual([false, true, true, true]);
    const lines = chipLines(sources, two, six, () => "");
    expect(lines.map((l) => l.lead)).toEqual([false, true, true]);
    expect(lines.map((l) => l.key)).toEqual(["line-0", "line-1", "line-2"]);
  });

  test("a name is cut at 120 px, and to the line when the line is shorter; hostile widths lay out", () => {
    const long = chipSources(false, 0, [layer("L".repeat(60))], []);
    const roomy = chipLines(long, 1000, six, () => "")[0]?.chips[0];
    expect(roomy?.cap).toBe(CHIP_METRICS.nameCap);
    expect(chipClipped(roomy?.name ?? "", roomy?.cap ?? 0, six)).toBe(true);
    const tight = chipLines(long, 100, six, () => "")[0]?.chips[0];
    expect(tight?.cap).toBeLessThan(CHIP_METRICS.nameCap);
    expect(tight?.cap).toBeGreaterThanOrEqual(CHIP_METRICS.nameMin);
    for (const width of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const lines = chipLines(sources, width, six, () => "");
      expect(lines.flatMap((l) => l.chips)).toHaveLength(4);
      for (const chip of lines.flatMap((l) => l.chips)) expect(Number.isFinite(chip.cap)).toBe(true);
    }
    expect(chipLines([], 300, six, () => "")).toEqual([]);
    // Under a finger the close key is 4 wider, and a line that just held two chips holds one.
    const m = CHIP_METRICS;
    const pair = chipSources(true, 32, [layer("Metal")], []);
    const two = 2 * (2 * m.pad + m.glyph + 2 * m.gap + m.close) + m.between + ("32 selected".length + "Metal".length) * 6;
    expect(chipLines(pair, two, six, () => "")).toHaveLength(1);
    expect(chipLines(pair, two, six, () => "", true)).toHaveLength(2);
    expect(chipLines(pair, two + 2 * (m.closeCoarse - m.close), six, () => "", true)).toHaveLength(1);
    expect(source).toMatch(/act=chip_shut \{\s+when coarse \{ w=size\.control-h-input h=size\.control-h-input \}/);
  });

  test("the chips are capped, and a key is read back by place or not at all", () => {
    const many = chipSources(true, 1, Array.from({ length: 100 }, (_, i) => layer(`L${i}`)), []);
    expect(many).toHaveLength(MAX_CHIPS);
    expect(pressedChip("chip-0", sources)).toEqual({ kind: "selection", count: 32 });
    expect(pressedChip("chip-3", sources)?.kind).toBe("picture");
    for (const key of ["", "chip-4", "chip--1", "chip-999", "line-0", "chip-0/row@0", "__proto__"]) expect(pressedChip(key, sources)).toBeNull();
  });
});

describe("the toolbar", () => {
  test("the model slot says the model, or the call to set one up, and what a press does", () => {
    const ready = toolbarParams(state(), 320, six);
    expect(ready.model).toBe("llama3.2");
    expect(ready.unset).toBe(false);
    expect(ready.model_said).toBe("Change the model. http://127.0.0.1:11434/v1");
    const unset = toolbarParams(state({ ready: false, model: "", hint: "Choose a provider and model", note: undefined, meter: "" }), 320, six);
    expect(unset.model).toBe("Set up a model");
    expect(unset.unset).toBe(true);
    expect(unset.model_said).toBe("Choose a provider and model");
    expect(unset.metered).toBe(false);
  });

  test("in a narrow panel the meter goes first, and only then is the model's name cut; the keys never give way", () => {
    const t = TOOL_METRICS;
    const fixed = t.padStart + t.padEnd + 4 * t.gap + 2 * t.key;
    const slot = 2 * t.slotPad + "llama3.2".length * 6 + t.caretGap + t.caret;
    const meter = "0.8k / 60k".length * 6 + t.meterEnd;
    const fits = toolbarParams(state(), fixed + slot + meter, six);
    expect(fits.metered).toBe(true);
    expect(fits.model_cap).toBe(slot);
    const tight = toolbarParams(state(), fixed + slot + meter - 1, six);
    expect(tight.metered).toBe(false);
    expect(tight.model_cap).toBeGreaterThanOrEqual(slot);
    const narrow = toolbarParams(state(), fixed + 60, six);
    expect(narrow.metered).toBe(false);
    expect(narrow.model_cap).toBe(60);
    for (const width of [0, -10, Number.NaN, 30]) expect(toolbarParams(state(), width, six).model_cap).toBeGreaterThanOrEqual(t.slotMin);
    expect(fits.meter_said).toBe(`Context the next request carries: ${(812).toLocaleString()} of ${(60_000).toLocaleString()} characters`);
  });

  test("the send key is the panel's: Send, Queue behind a turn, Stop when a turn runs and nothing is typed", () => {
    expect(sendKey(state({ draft: "hello", sendNote: undefined }))).toEqual({ stopping: false, name: "Send", keys: "Enter", note: "", off: false });
    expect(sendKey(state({ draft: "  " }))).toEqual({ stopping: false, name: "Send", keys: "Enter", note: "Type a message first", off: true });
    expect(sendKey(state({ draft: "x", over: 3, sendNote: "The message is too long to send" })).off).toBe(true);
    expect(sendKey(state({ running: true, draft: "next", sendNote: "A turn is running: this waits for it to end" }))).toEqual({ stopping: false, name: "Queue", keys: "Enter", note: "A turn is running: this waits for it to end", off: false });
    expect(sendKey(state({ running: true, draft: "" }))).toEqual({ stopping: true, name: "Stop the turn", keys: "Esc", note: "", off: false });
    const p = toolbarParams(state({ running: true, draft: "" }), 320, six);
    expect([p.stopping, p.send_name, p.send_off]).toEqual([true, "Stop the turn", false]);
  });
});

describe("the scene's keys", () => {
  const CHAT = "#panel/#head/#name/#tabs/each@0~chat-1/row@0/row@0";
  const CHAT_SHUT = "#panel/#head/#name/#tabs/each@0~chat-1/row@0/#shut";
  const IDEA = "#panel/#main/#empty/#ideas/each@0~idea-0/row@0";
  const CHIP = "#panel/#footbox/#foot/#card/#chipbox/#chips/each@0~line-0/row@0/each@0~chip-1/row@0/row@0";
  const CHIP_DROP = `${CHIP}/#drop`;

  test("a control is told by where its key stands in the document", () => {
    expect(controlOfKey(KEYS.new)).toBe("new");
    expect(controlOfKey(KEYS.close)).toBe("close");
    expect(controlOfKey(KEYS.model)).toBe("model");
    expect(controlOfKey(KEYS.attach)).toBe("attach");
    expect(controlOfKey(KEYS.send)).toBe("send");
    expect(controlOfKey(`${KEYS.card}/#tools/#meterbox/text@0`)).toBe("meter");
    expect(controlOfKey(CHAT)).toBe("chat");
    expect(controlOfKey(CHAT_SHUT)).toBe("chat-shut");
    expect(controlOfKey(IDEA)).toBe("idea");
    expect(controlOfKey(CHIP)).toBe("chip");
    expect(controlOfKey(CHIP_DROP)).toBe("chip-drop");
    for (const key of ["", "#panel", "#panel/#head", KEYS.card, "x".repeat(600)]) expect(controlOfKey(key)).toBeNull();
    // The keys named here are the document's own ids, each written once.
    for (const id of ["#panel", "#head", "#name", "#tabs", "#keys", "#new", "#close", "#main", "#empty", "#ideas", "#footbox", "#foot", "#card", "#chipbox", "#chips", "#tools", "#model", "#meterbox", "#attach", "#send", "#shut", "#drop"]) {
      expect(source.split(new RegExp(`\\s${id}\\s`)).length).toBe(2);
    }
  });

  test("the control under the pointer is the innermost with a hint: a chip's key over the chip, a key over the band", () => {
    const scene: ControlBox[] = [
      { key: "#panel", x: 0, y: 0, w: 320, h: 600 },
      { key: KEYS.new, x: 270, y: 5, w: 24, h: 24, role: "button" },
      { key: KEYS.card, x: 8, y: 500, w: 304, h: 92 },
      { key: CHIP, x: 20, y: 508, w: 90, h: 26 },
      { key: CHIP_DROP, x: 85, y: 511, w: 20, h: 20, role: "button" },
      { key: KEYS.send, x: 282, y: 562, w: 24, h: 24, role: "button" },
    ];
    expect(controlAt(scene, 280, 10)).toBe(KEYS.new);
    expect(controlAt(scene, 30, 520)).toBe(CHIP);
    expect(controlAt(scene, 90, 520)).toBe(CHIP_DROP);
    expect(controlAt(scene, 290, 570)).toBe(KEYS.send);
    expect(controlAt(scene, 150, 300)).toBeNull();
    expect(controlAt(scene, 150, 550)).toBeNull();
    expect(controlAt(scene, Number.NaN, 5)).toBeNull();
    expect(controlAt([], 1, 1)).toBeNull();
  });
});

describe("the document", () => {
  test("declares every prop the host sets on a list's item, every param, and every signal the host answers", () => {
    const item = (def: string, sample: object): void => {
      for (const name of Object.keys(sample)) if (name !== "key") expect(source).toMatch(new RegExp(`def ${def}\\([^)]*\\b${name}=`));
    };
    item("AssistantChat", chatParams(["a"], 0, 100)[0] ?? {});
    item("AssistantIdea", ideaParams(EXAMPLES)[0] ?? {});
    const line = chipLines(chipSources(true, 1, [], []), 300, six, () => "")[0];
    item("AssistantChipLine", line ?? {});
    item("AssistantChip", line?.chips[0] ?? {});
    const scalars = /const SCALARS = \[([^\]]+)\]/.exec(host)?.[1] ?? "";
    const names = [...scalars.matchAll(/"([a-z_]+)"/g)].map((m) => m[1] ?? "");
    expect(names.length).toBeGreaterThan(15);
    for (const name of [...names, "chats", "ideas", "chip_lines"]) expect(source).toMatch(new RegExp(`^  ${name}\\s+(text|bool|num|list\\()`, "m"));
    // Every scalar the toolbar is shaped into is handed over.
    for (const name of Object.keys(toolbarParams(state(), 320, six))) expect(names).toContain(name);
    const signals = /attachSurface\(host, \[([^\]]+)\]/.exec(host)?.[1] ?? "";
    const answered = [...signals.matchAll(/"([a-z_]+)"/g)].map((m) => m[1] ?? "").sort();
    const bound = [...new Set([...source.matchAll(/\bact=([a-z_]+)/g)].map((m) => m[1] ?? ""))].sort();
    expect(answered).toEqual(bound);
  });

  test("binds no pointer move and eases nothing: each costs a solve a step", () => {
    const code = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/pointer-move=/);
    expect(code).not.toMatch(/\btransition=/);
    expect(code).not.toMatch(/\banimate=/);
  });

  test("every control has a role and a name, and the parts that come and go are children of a `when`", () => {
    for (const act of source.matchAll(/^(.*\bact=[a-z_]+.*)$/gm)) {
      const header = act[1] ?? "";
      const at = source.indexOf(header);
      const whole = `${source.slice(Math.max(0, at - 220), at)}${header}`;
      expect(/role=(button|tab)\b/.test(whole)).toBe(true);
      expect(/\blabel=/.test(whole)).toBe(true);
    }
    expect(source).toContain('role=tablist label="Chats"');
    expect(source).toMatch(/when blank \{\s+col #empty/);
    expect(source).toMatch(/when !setup \{\s+rect #seam/);
    expect(source).toMatch(/when chipped \{\s+col #chips/);
    expect(source).toMatch(/when metered \{\s+text param\.meter/);
    for (const hole of ["main", "stack", "editor"]) expect(source).toMatch(new RegExp(`hole ${hole} `));
    expect([...source.matchAll(/\bhole /g)].filter((m) => !source.slice(source.lastIndexOf("\n", m.index) + 1, m.index).includes("//")).length).toBe(3);
  });

  test("every colour and measure is a token of the bridge or the document's own, and no font, image or address is named", () => {
    const tokens = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8"));
    const inks = new Set([...source.matchAll(/color\.([a-z0-9-]+)/g)].map((m) => m[1] ?? ""));
    expect(inks.size).toBeGreaterThan(8);
    for (const name of inks) expect(tokens.colors.has(name)).toBe(true);
    for (const m of source.matchAll(/\b(space|size|radius)\.([a-z0-9-]+)/g)) expect(tokens.lengths.get(m[1] ?? "")?.has(m[2] ?? "")).toBe(true);
    const own = /assist \{([\s\S]*?)\n {2}\}/.exec(source)?.[1] ?? "";
    for (const m of source.matchAll(/\bassist\.([a-z-]+)/g)) expect(own).toMatch(new RegExp(`\\b${m[1]} [\\d.]+`));
    expect(source).toContain('import "gen/tokens.slab"');
    const code = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code.replace(/#[a-z][a-z-]*/g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\b(rgb|rgba|oklch|hsl)\(/);
    expect(code).not.toMatch(/font-family|family=|Inter|JetBrains|system-ui|url\(|https?:|\.(png|svg|woff2?|ttf)\b/);
    for (const m of code.matchAll(/\b(?:bg|color|stroke)=([^\s{]+)/g)) expect(m[1] ?? "").toMatch(/^(color\.[a-z-]+|none|current)$/);
  });

  test("the measures the host counts with are the document's and the sheet's", () => {
    const lengths = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8")).lengths;
    expect(lengths.get("size")?.get("control-h-input")).toBe(TOOL_METRICS.key);
    expect(lengths.get("size")?.get("control-h-chip")).toBe(CHIP_METRICS.close);
    expect(lengths.get("size")?.get("icon-size-sm")).toBe(CHIP_METRICS.glyph);
    expect(lengths.get("space")?.get("g4")).toBe(CHIP_METRICS.gap);
    expect(lengths.get("space")?.get("g8")).toBe(TOOL_METRICS.slotPad);
    expect(source).toContain(`chip-inset ${CHIP_METRICS.pad}`);
    expect(source).toContain(`thumb ${CHIP_METRICS.thumb}`);
    expect(source).toMatch(/#tools w=fill h=assist\.tools pad=space\.g6,space\.g6,space\.g6,space\.g4 gap=space\.g4/);
    expect(host).toMatch(/const FOOT_PAD = 8;/);
    expect(source).toMatch(/col #foot w=fill pad=space\.g8 /);
  });
});

describe("the panel and its frame", () => {
  test("the Slab panel is the SolidJS panel with a frame: nothing of it is forked", () => {
    expect(host).toContain('import { AssistantPane, type AssistantFrame, type AssistantPaneProps } from "../components/AssistantPane";');
    expect(host).toMatch(/return <AssistantPane \{\.\.\.props\} frame=\{\(view\) => <SlabFrame view=\{view\} \/>\} \/>;/);
    // The frame mounts the panel's own parts, each once, and decides nothing the session decides.
    for (const part of ["view.main(false)", "view.stack()", "view.editor()", "view.picker()"]) expect(host.split(part).length).toBe(2);
    expect(host).not.toMatch(/createAssistantSession|runTurn|requestChat|fetch\(/);
    expect(host).not.toMatch(/from "\.\.\/assistant-session"/);
  });

  test("the SolidJS panel draws itself unless it is handed a frame, and hands a frame its own parts", () => {
    expect(pane).toContain("frame?: (view: AssistantFrame) => JSX.Element;");
    expect(pane).toMatch(/<Show\s+when=\{props\.frame\}\s+fallback=\{/);
    for (const part of ["{resizeStrip()}", "{head()}", "{main(true)}", "{stack()}", "{chips()}", "{editor()}", "{toolbar()}", "{picker()}"]) expect(pane.split(part).length).toBe(2);
    expect(pane).not.toMatch(/from "\.\.\/slab\//);
    expect(pane).not.toContain("cadcraft-assistant");
  });

  test("the standard shell names no Slab module: the panel arrives as a part, and the SolidJS one shows without it", () => {
    const app = readFileSync(join(ui, "src", "app.tsx"), "utf8");
    expect(/from "\.\/slab\/(?!parts")/.test(app)).toBe(false);
    expect(app).toContain("props.slab?.Assistant ?? AssistantPane");
    expect(app).not.toContain("cadcraft-assistant");
    const main = readFileSync(join(ui, "src", "main.tsx"), "utf8");
    expect(main).toContain('await import("./slab/SlabAssistant")');
    expect(main).not.toMatch(/^import .*SlabAssistant/m);
    expect(main).toContain('slabPartNotice("assistant", assistant.reason)');
    expect(main).toContain(".then(withAssistant)");
    const loader = readFileSync(join(ui, "src", "slab", "loader.ts"), "utf8");
    expect(loader).toContain('assistant: "cadcraft-assistant"');
    const parts = readFileSync(join(ui, "src", "slab", "parts.ts"), "utf8");
    expect(parts).toContain("Assistant?: Component<AssistantPaneProps>;");
  });

  test("the frame keeps the kernel's own Tab and Escape from it, and leaves by the browser's order", () => {
    expect(host).toContain('host.addEventListener("keydown", onKeyCapture, true);');
    // Registered before `attachSurface`, whose own listener hands every Tab to the browser.
    expect(host.indexOf('host.addEventListener("keydown", onKeyCapture, true);')).toBeLessThan(host.indexOf("const detach = attachSurface("));
    expect(host).toContain("tabMove(list.length, at, e.shiftKey)");
    expect(host).toContain('new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })');
  });
});
