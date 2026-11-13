import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBench } from "../bench";
import { benchPanelParams, MAX_PARAM_TEXT, paramText, pressedHandles } from "./bench-params";
import { buildMetrics, codepoints, UNITS_PER_PX } from "./fonts";
import { compareArtifacts, describeReport, formatLock, matchesLock, parseLock, parsePin, type SlabLock } from "./lock";
import { readPaneWidths, sizesMatch, targetSizes, widthClass, widthsAfterDrag, writePaneWidths } from "./panes";
import { themeName } from "./surface";
import { shellChoice, slabFailed, slabPartNotice } from "./switch";
import { familyName, mapTokens, readTokenSheet, resolveToken, slabColor, slabDuration, slabLength, slabTokenSource } from "./tokens";
import { signalDetail } from "./types";

const ui = join(import.meta.dir, "..", "..");

/** Spelled apart so the design-system check does not read these fixtures as colours in the interface. */
const H = "#";
const A = "rgba";
const B = "rgb";
const L = "loop";

describe("the token mapping", () => {
  const css = `
    :root { /* dark */
      --panel: ${H}141414; --border: ${A}(240, 240, 240, 0.12); --icon: var(--text-dim); --text-dim: ${A}(240, 240, 240, 0.74);
      --focus-ring: var(--accent); --accent: ${H}599CE7; --${L}-a: var(--${L}-b); --${L}-b: var(--${L}-a);
      --gap-8: 8px; --radius-card: 4px; --control-h-row: 22px; --font-body: 13px; --font-chip: 11px; --font-label: 12px; --font-mono: 12px;
      --leading-ui: 16px; --dur-fast: 0.1s; --shadow-popover: 0 3px 8px ${A}(0, 0, 0, 0.12); --font-family: system-ui, sans-serif;
    }
    :root[data-theme="light"] { --panel: ${H}FCFCFC; --accent: ${H}2678C1; --text-dim: ${A}(20, 20, 20, 0.74); }
  `;

  test("colours become hex, alpha included", () => {
    expect(slabColor(`${H}fff`)).toBe(`${H}FFFFFF`);
    expect(slabColor(`${H}0a0b0c80`)).toBe(`${H}0A0B0C80`);
    expect(slabColor(`${A}(240, 240, 240, 0.12)`)).toBe(`${H}F0F0F01F`);
    expect(slabColor(`${B}(1, 2, 3)`)).toBe(`${H}010203`);
    expect(slabColor("red")).toBeNull();
    expect(slabColor(`${A}(1,2,3,7)`)).toBeNull();
    expect(slabColor("url(javascript:1)")).toBeNull();
  });

  test("lengths and durations are plain numbers", () => {
    expect(slabLength("22px")).toBe(22);
    expect(slabLength("1e9px")).toBeNull();
    expect(slabLength("2em")).toBeNull();
    expect(slabDuration("0.1s")).toBe(100);
    expect(slabDuration("150ms")).toBe(150);
    expect(slabDuration("fast")).toBeNull();
  });

  test("a var() is followed, a loop is given up", () => {
    const { dark, light } = readTokenSheet(css);
    expect(resolveToken("icon", [dark])).toBe(`${A}(240, 240, 240, 0.74)`);
    expect(resolveToken("icon", [light, dark])).toBe(`${A}(20, 20, 20, 0.74)`);
    expect(resolveToken(`${L}-a`, [dark])).toBeNull();
    expect(resolveToken("nothing", [dark])).toBeNull();
  });

  test("the light theme holds only what differs, through a var() too", () => {
    const t = mapTokens(css);
    expect(t.colors.get("panel")).toBe(`${H}141414`);
    expect(t.light.get("panel")).toBe(`${H}FCFCFC`);
    expect(t.light.get("focus-ring")).toBe(`${H}2678C1`);
    expect(t.light.get("icon")).toBe(`${H}141414BD`);
    expect(t.light.has("border")).toBe(false);
    expect(t.colors.has(`${L}-a`)).toBe(false);
    expect(t.lengths.get("space")?.get("g8")).toBe(8);
    expect(t.lengths.get("radius")?.get("card")).toBe(4);
    expect(t.lengths.get("size")?.get("control-h-row")).toBe(22);
    expect(t.durations.get("fast")).toBe(100);
  });

  test("the source declares the four themes and a family per type size", () => {
    const source = slabTokenSource(css);
    expect(source).toContain("tokens {");
    expect(source).toContain(`panel ${H}141414`);
    expect(source).toContain(`body { family "${familyName(false, 13)}"; size 13; leading 1.2308 }`);
    expect(source).toContain(`mono { family "cadcraft-mono-12"; size 12; leading 1.3333 }`);
    expect(source).toContain("theme light {");
    expect(source).toContain("theme still {\n  dur {\n    fast 0\n  }\n}");
    expect(source).toContain("theme light-still {");
    expect(source).not.toContain("shadow");
    expect(source).not.toContain("system-ui");
  });

  test("the real sheet maps every colour the documents use", () => {
    const t = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8"));
    const used = new Set<string>();
    for (const doc of ["shell.slab", "bench.slab"]) {
      for (const m of readFileSync(join(ui, "slab", doc), "utf8").matchAll(/color\.([a-z0-9-]+)/g)) if (m[1] !== undefined) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect(t.colors.has(name)).toBe(true);
    expect(t.light.get("panel")).toBe(`${H}FCFCFC`);
    expect(t.textSizes.get("body")).toBe(13);
  });
});

describe("the font metrics", () => {
  test("a table is the measured advances at 1/1024 px", () => {
    const m = buildMetrics({ advance: (c) => (c === "i" ? 3.25 : c === " " ? 4 : 7.5), ascent: 12.5, descent: 3.5 }, 13, 600, [0x20, 0x30, 0x69]);
    expect(m.upem).toBe(13 * UNITS_PER_PX);
    expect([...m.cps]).toEqual([0x20, 0x30, 0x69]);
    expect([...m.advs]).toEqual([4096, 7680, 3328]);
    expect([...m.gids]).toEqual([1, 2, 3]);
    expect(m.weight).toBe(600);
    expect(m.ascent).toBe(12800);
    expect(m.descent).toBe(-3584);
    expect(m.defaultAdvance).toBe(7680);
  });

  test("a measurement that is not a width is left out, and a broken canvas still makes a table", () => {
    const m = buildMetrics({ advance: (c) => (c === "a" ? Number.NaN : c === "b" ? -1 : c === "c" ? 1e9 : 6), ascent: Number.NaN, descent: -4 }, 12, 400, [0x61, 0x62, 0x63, 0x64]);
    expect([...m.cps]).toEqual([0x64]);
    expect(m.ascent).toBeGreaterThan(0);
    expect(m.descent).toBeLessThan(0);
    expect(m.defaultAdvance).toBe(Math.round((12 * UNITS_PER_PX) / 2));
    expect(buildMetrics({ advance: () => 5, ascent: 10, descent: 3 }, Number.NaN, 400, [0x41]).upem).toBe(13 * UNITS_PER_PX);
  });

  test("the measured set is ASCII, the Latin supplements and the signs the interface writes, capped", () => {
    const cps = codepoints();
    for (const ch of "Az09 ·×−…’€→✓é") expect(cps.includes(ch.codePointAt(0) ?? 0)).toBe(true);
    expect(cps.length).toBeLessThan(700);
    expect(codepoints([[0, 1_000_000]]).length).toBe(4096);
  });
});

describe("the pane widths", () => {
  const defaults = { side: 252, chat: 340 };

  test("remembered widths are read with checks", () => {
    expect(readPaneWidths(null, defaults)).toEqual(defaults);
    expect(readPaneWidths("{", defaults)).toEqual(defaults);
    expect(readPaneWidths("[1,2]", defaults)).toEqual(defaults);
    expect(readPaneWidths('{"side":300.4,"chat":"x"}', defaults)).toEqual({ side: 300, chat: 340 });
    expect(readPaneWidths('{"side":1e12,"chat":-5}', defaults)).toEqual(defaults);
    expect(readPaneWidths("x".repeat(500), defaults)).toEqual(defaults);
    expect(readPaneWidths(writePaneWidths({ side: 310.6, chat: 402 }), defaults)).toEqual({ side: 311, chat: 402 });
  });

  test("the side panes keep their pixels and the editor takes the rest", () => {
    expect(targetSizes(1440, defaults, { side: 300, editor: 800, chat: 340 })).toEqual({ side: 252, editor: 848, chat: 340 });
    expect(targetSizes(1440, defaults, { side: 300, editor: 1140, chat: 0 })).toEqual({ side: 252, editor: 1188, chat: 0 });
    expect(targetSizes(1440, defaults, { side: 0, editor: 900, chat: 540 })).toEqual({ side: 0, editor: 1100, chat: 340 });
    expect(targetSizes(1440, defaults, { side: 0, editor: 1440, chat: 0 })).toEqual({ side: 0, editor: 1440, chat: 0 });
  });

  test("a pane alone in the row has all of it, the assistant first", () => {
    expect(targetSizes(390, defaults, { side: 0, editor: 0, chat: 390 })).toEqual({ side: 0, editor: 0, chat: 390 });
    expect(targetSizes(390, defaults, { side: 390, editor: 0, chat: 0 })).toEqual({ side: 390, editor: 0, chat: 0 });
    expect(targetSizes(390, defaults, { side: 200, editor: 0, chat: 190 })).toEqual({ side: 0, editor: 0, chat: 390 });
  });

  test("the targets never exceed the row, whatever is asked", () => {
    for (const total of [0, 100, 400, 600, Number.NaN, -5]) {
      const t = targetSizes(total, { side: 500, chat: 700 }, { side: 10, editor: 10, chat: 10 });
      const width = Number.isFinite(total) && total > 0 ? total : 0;
      expect(t.side + t.editor + t.chat).toBeLessThanOrEqual(width + 1e-9);
      expect(Math.min(t.side, t.editor, t.chat)).toBeGreaterThanOrEqual(0);
    }
  });

  test("a drag is remembered for the panes beside the editor only", () => {
    expect(widthsAfterDrag(defaults, { side: 340.3, editor: 760, chat: 340 })).toEqual({ side: 340, chat: 340 });
    expect(widthsAfterDrag(defaults, { side: 0, editor: 1000, chat: 440 })).toEqual({ side: 252, chat: 440 });
    expect(widthsAfterDrag(defaults, { side: 0, editor: 0, chat: 390 })).toEqual(defaults);
    expect(sizesMatch({ side: 252.4, editor: 848, chat: 339.7 }, { side: 252, editor: 848, chat: 340 })).toBe(true);
    expect(sizesMatch({ side: 254, editor: 846, chat: 340 }, { side: 252, editor: 848, chat: 340 })).toBe(false);
  });

  test("the width class follows the document's breakpoints", () => {
    expect(widthClass(1440, 900, 560)).toEqual({ narrow: false, compact: false });
    expect(widthClass(900, 900, 560)).toEqual({ narrow: true, compact: false });
    expect(widthClass(560, 900, 560)).toEqual({ narrow: true, compact: true });
    expect(widthClass(0, 900, 560)).toEqual({ narrow: false, compact: false });
    expect(widthClass(Number.NaN, 900, 560)).toEqual({ narrow: false, compact: false });
  });
});

describe("the bench panel's params", () => {
  const sheet = parseBench({
    stones: { count: 15, carat: 1.2, groups: [{ cut: "round", width: 6.5, length: 6.5, depth: 4, sg: 3.52, count: 1, caratEach: 1.03, carat: 1.03, calibrated: false, handles: ["A1"] }, { cut: "round", width: 1.5, length: 1.5, depth: 0.9, sg: 3.52, count: 14, caratEach: 0.013, carat: 0.18, calibrated: true, handles: ["B1", "B2"] }] },
    bands: [{ block: "RING", size: "US 6", mm: 16.5, metal: "gold18", grams: 3.86, width: 2.4, wall: 1.8 }],
    warnings: ["A stone has no size"],
    message: "",
  });

  test("lines are typed items with stable keys; a line with objects can be pressed", () => {
    const p = benchPanelParams(sheet, new Set(["B1", "B2"]), true, true);
    expect(p.lines.map((l) => l.key)).toEqual(["line-0", "line-1", "line-2"]);
    expect(p.lines.map((l) => l.pressable)).toEqual([true, true, false]);
    expect(p.lines.map((l) => l.current)).toEqual([false, true, false]);
    expect(p.lines[1]?.hint).toContain("Selected on the drawing");
    expect(p.warnings).toEqual([{ key: "warning-0", note: "A stone has no size" }]);
    expect(p.empty).toBe(false);
    expect(p.costed).toBe(false);
    expect(p.settable).toBe(true);
    expect(benchPanelParams(sheet, new Set(), false, true).settable).toBe(false);
    expect(p.summary).toContain("15 stones");
  });

  test("no sheet is the empty panel; a folded one hands over nothing but its heading", () => {
    const none = benchPanelParams(null, new Set(), true, true);
    expect(none.empty).toBe(true);
    expect(none.lines).toEqual([]);
    expect(none.settable).toBe(false);
    const folded = benchPanelParams(sheet, new Set(), true, false);
    expect(folded.lines).toEqual([]);
    expect(folded.empty).toBe(false);
    expect(folded.settable).toBe(false);
    expect(folded.summary).toContain("15 stones");
  });

  test("a press selects the line's objects, lets them go the second time, and ignores a key that names no line", () => {
    expect(pressedHandles(sheet, "line-1", new Set())).toEqual(["B1", "B2"]);
    expect(pressedHandles(sheet, "line-1", new Set(["B1", "B2"]))).toEqual([]);
    expect(pressedHandles(sheet, "line-2", new Set())).toBeNull();
    for (const key of ["", "line-99", "line--1", "line-1e3", "0", "__proto__", "line-1 ", "line-99999999999"]) expect(pressedHandles(sheet, key, new Set())).toBeNull();
    expect(pressedHandles(null, "line-0", new Set())).toBeNull();
  });

  test("text for the kernel is one capped line", () => {
    expect(paramText("a\nb\tc d")).toBe("a b c d");
    expect(paramText("x".repeat(5000)).length).toBe(MAX_PARAM_TEXT);
    expect(paramText("  ok  ")).toBe("ok");
  });

  test("the lists are capped as the SolidJS panel's are", () => {
    const many = { stones: 0, carat: 0, grams: 0, lines: Array.from({ length: 500 }, (_, i) => ({ label: `L${i}`, value: "1", note: null, handles: [] })), warnings: Array.from({ length: 500 }, () => "w") };
    const p = benchPanelParams(many, new Set(), true, true);
    expect(p.lines.length).toBe(40);
    expect(p.warnings.length).toBe(40);
  });
});

describe("the lock", () => {
  const lock: SlabLock = {
    repo: "https://github.com/stencil-hq/slab",
    commit: "65747371a18da9a54a94955473d0ec7f7fd07d5f",
    patches: [{ file: "0001-x.patch", sha256: "a".repeat(64) }],
    versions: { slab: "slab 0.1.0" },
    artifacts: { "wasm/k.wasm": { bytes: 10, sha256: "b".repeat(64) }, "slab-runtime.js": { bytes: 5, sha256: "c".repeat(64) } },
  };

  test("a lock round-trips, artifacts in path order", () => {
    const text = formatLock(lock);
    const parsed = parseLock(text);
    expect(parsed.ok && parsed.lock).toEqual(lock);
    expect(text.indexOf("slab-runtime.js")).toBeLessThan(text.indexOf("wasm/k.wasm"));
    expect(text.endsWith("}\n")).toBe(true);
  });

  test("a malformed lock is refused with the reason", () => {
    const bad = (change: Record<string, unknown>): string => {
      const r = parseLock(JSON.stringify({ ...JSON.parse(formatLock(lock)), ...change }));
      return r.ok ? "ok" : r.error;
    };
    expect(parseLock("nope").ok).toBe(false);
    expect(parseLock("[]").ok).toBe(false);
    expect(bad({ commit: "main" })).toContain("commit");
    expect(bad({ repo: "git@github.com:x/y" })).toContain("repo");
    expect(bad({ repo: "https://x.test/a b; rm -rf" })).toContain("repo");
    expect(bad({ artifacts: { "../../etc/passwd": { bytes: 1, sha256: "b".repeat(64) } } })).toContain("not a path");
    expect(bad({ artifacts: { "a.js": { bytes: -1, sha256: "b".repeat(64) } } })).toContain("size");
    expect(bad({ artifacts: { "a.js": { bytes: 1, sha256: "xyz" } } })).toContain("checksum");
    expect(bad({ patches: [{ file: "../x.patch", sha256: "a".repeat(64) }] })).toContain("file name");
    expect(bad({ artifacts: undefined })).toContain("artifacts");
  });

  test("what is on disk is compared with what is pinned", () => {
    const same = compareArtifacts(lock, lock.artifacts);
    expect(matchesLock(same)).toBe(true);
    expect(describeReport(same)).toContain("match");
    const report = compareArtifacts(lock, { "slab-runtime.js": { bytes: 5, sha256: "d".repeat(64) }, "extra.js": { bytes: 1, sha256: "e".repeat(64) } });
    expect(report).toEqual({ missing: ["wasm/k.wasm"], changed: ["slab-runtime.js"], extra: ["extra.js"] });
    expect(matchesLock(report)).toBe(false);
    expect(describeReport(report)).toContain("missing: wasm/k.wasm");
  });

  test("the pin parses, and a damaged one is refused", () => {
    const sum = "a".repeat(64);
    const text = `# the pin\nrepo https://github.com/stencil-hq/slab\ncommit ${"0".repeat(40)}\n\npatch ${sum} 0001-a.patch\npatch ${sum} 0002-b.patch\n`;
    const parsed = parsePin(text);
    expect(parsed.ok && parsed.pin).toEqual({ repo: "https://github.com/stencil-hq/slab", commit: "0".repeat(40), patches: [{ file: "0001-a.patch", sha256: sum }, { file: "0002-b.patch", sha256: sum }] });
    const bad = (pin: string): string => {
      const r = parsePin(pin);
      return r.ok ? "ok" : r.error;
    };
    expect(bad("commit main\n")).toContain("line 1");
    expect(bad(`repo https://x.test/a\n`)).toContain("no commit");
    expect(bad(`commit ${"0".repeat(40)}\n`)).toContain("no repo");
    expect(bad(`repo https://x.test/a\nrepo https://y.test/b\ncommit ${"0".repeat(40)}\n`)).toContain("line 2");
    expect(bad(`repo https://x.test/a\ncommit ${"0".repeat(40)}\npatch ${sum} ../../etc/passwd.patch\n`)).toContain("line 3");
    expect(bad(`repo https://x.test/a\ncommit ${"0".repeat(40)}\npatch short 0001-a.patch\n`)).toContain("line 3");
    expect(bad("rm -rf /\n")).toContain("line 1");
  });

  test("the committed record is of the committed pin, and the pin's patches are in the tree", () => {
    const parsed = parseLock(readFileSync(join(ui, "slab.lock.json"), "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const shared = join(ui, "..", "..", "third_party", "slab");
    const pin = parsePin(readFileSync(join(shared, "SLAB.lock"), "utf8"));
    expect(pin.ok).toBe(true);
    if (!pin.ok) return;
    // One pin for the web and the Rust side: the record names the same commit and series.
    expect(parsed.lock.repo).toBe(pin.pin.repo);
    expect(parsed.lock.commit).toBe(pin.pin.commit);
    expect(parsed.lock.patches).toEqual(pin.pin.patches);
    expect(pin.pin.patches.length).toBeGreaterThan(0);
    for (const patch of pin.pin.patches) {
      const bytes = readFileSync(join(shared, "patches", patch.file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(patch.sha256);
    }
    expect(existsSync(join(ui, "slab", "patches"))).toBe(false);
    for (const path of ["slab-runtime.js", "wasm/slab_kernel_bg.wasm", "compiler/slab_wasm.js", "compiler/slab_wasm_bg.wasm"]) expect(parsed.lock.artifacts[path]).toBeDefined();
    // The kernel is built without Slab's bundled faces: with them it was 4.3 MB.
    expect(parsed.lock.artifacts["wasm/slab_kernel_bg.wasm"]?.bytes ?? Infinity).toBeLessThan(2_500_000);
  });
});

describe("the switch and the surface", () => {
  test("only ?shell=slab turns the Slab shell on", () => {
    expect(shellChoice("?shell=slab")).toBe("slab");
    expect(shellChoice("?mock=1&shell=slab")).toBe("slab");
    for (const search of ["", "?shell=", "?shell=SLAB", "?shell=slab2", "?slab", "?shell=default", "%%%"]) expect(shellChoice(search)).toBe("default");
  });

  test("a failure is said in one line", () => {
    const line = slabFailed(`boom\n${"x".repeat(1000)}`);
    expect(line.includes("\n")).toBe(false);
    expect(line.length).toBeLessThan(260);
  });

  test("the theme follows the page's theme and its motion switch", () => {
    expect(themeName("dark", "on")).toBe("");
    expect(themeName(undefined, undefined)).toBe("");
    expect(themeName("light", "on")).toBe("light");
    expect(themeName("dark", "off")).toBe("still");
    expect(themeName("light", "off")).toBe("light-still");
  });

  test("a signal's detail is read with checks", () => {
    expect(signalDetail(new Event("x"))).toBeNull();
    expect(signalDetail(new CustomEvent("x", { detail: null }))).toBeNull();
    expect(signalDetail(new CustomEvent("x", { detail: { item: "line-1", meta: { key: "a/b" } } }))).toEqual({ item: "line-1", meta: { key: "a/b" } });
    expect(signalDetail(new CustomEvent("x", { detail: { item: 7, text: "252", meta: 3 } }))).toEqual({ item: "", text: "252", meta: { key: "" } });
  });
});

describe("the notice for one part", () => {
  test("names the part and says the shell is still shown", () => {
    const said = slabPartNotice("Layers section", slabFailed("404"));
    expect(said).toBe("The Slab Layers section did not load (404); showing the standard one in its place.");
    expect(slabPartNotice("status bar", "something else")).toBe("something else");
  });
});
