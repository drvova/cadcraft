/**
 * The layer's recipe, checked where a DOM test cannot see it: the stylesheet and the tokens.
 * Contrast is computed from `tokens.css` for the pairs `ui.css` draws (WCAG 2.x: 4.5:1 for text,
 * 3:1 for a focus ring), in both themes, over every surface a component sits on. The rest pins
 * the rules a later edit could drop without any component test failing: the coarse-pointer
 * targets, the editor tab's cap, and the one easing of a state transition.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const strip = (css: string): string => css.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
const tokensCss = strip(readFileSync(join(import.meta.dir, "..", "tokens.css"), "utf8"));
const uiCss = strip(readFileSync(join(import.meta.dir, "ui.css"), "utf8"));

type Rgba = { r: number; g: number; b: number; a: number };
type Theme = Record<string, string>;

function block(selector: string): Theme {
  const at = tokensCss.indexOf(selector);
  if (at < 0) throw new Error(`tokens.css has no ${selector} block`);
  const open = tokensCss.indexOf("{", at);
  const close = tokensCss.indexOf("}", open);
  const out: Theme = {};
  for (const m of tokensCss.slice(open + 1, close).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = m;
    if (name !== undefined && value !== undefined) out[name] = value.trim();
  }
  return out;
}

const dark = block(":root {");
const themes: Record<string, Theme> = { dark, light: { ...dark, ...block(':root[data-theme="light"]') } };

function color(theme: Theme, token: string, depth = 0): Rgba {
  const value = theme[token];
  if (value === undefined || depth > 8) throw new Error(`--${token} is not a colour token`);
  const ref = /^var\(--([\w-]+)\)$/.exec(value);
  if (ref?.[1] !== undefined) return color(theme, ref[1], depth + 1);
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1] !== undefined) {
    const n = Number.parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  const parts = rgb?.[1]?.split(/[,\s/]+/).filter(Boolean).map(Number) ?? [];
  const [r, g, b, a] = parts;
  if (r === undefined || g === undefined || b === undefined) throw new Error(`--${token}: cannot read ${value}`);
  return { r, g, b, a: a ?? 1 };
}

const over = (fg: Rgba, bg: Rgba): Rgba => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

function luminance({ r, g, b }: Rgba): number {
  const f = (c: number): number => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** The lowest ratio of `ink` over `fills` (bottom to top) across `surfaces`, in one theme. */
function lowest(theme: Theme, ink: string, fills: readonly string[], surfaces: readonly string[]): number {
  let worst = Number.POSITIVE_INFINITY;
  for (const surface of surfaces) {
    let bg = over(color(theme, surface), color(theme, "chrome"));
    for (const fill of fills) bg = over(color(theme, fill), bg);
    const [hi, lo] = [luminance(over(color(theme, ink), bg)), luminance(bg)].sort((x, y) => y - x);
    if (hi === undefined || lo === undefined) throw new Error("no luminance");
    worst = Math.min(worst, (hi + 0.05) / (lo + 0.05));
  }
  return worst;
}

const SURFACES = ["chrome", "chrome-dark", "panel", "tab-active", "control", "surface-elevated", "surface-inset", "cmd-bg", "list-bg"];

/** The declarations of the one rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, head, body] = m;
    if (head !== undefined && body !== undefined && head.trim().replace(/\s+/g, " ") === selector) return body;
  }
  throw new Error(`ui.css has no rule ${selector}`);
}

describe("the layer's contrast, from the tokens", () => {
  const text: [string, string, string[]][] = [
    ["the accent chip's label on its tint", "text-accent", ["accent-soft"]],
    ["the accent chip's label on the hover fill (also its pressed fill)", "text-accent", ["hover"]],
    ["the neutral chip's label on the pressed fill", "text-faint", ["fill-active"]],
    ["the primary button's label", "on-accent", ["accent"]],
    ["the primary button's label, hovered", "on-accent", ["accent-hover"]],
    ["the primary button's label, pressed", "on-accent", ["accent-pressed"]],
    ["the danger button's label", "on-error", ["error"]],
    ["the danger button's label, hovered", "on-error", ["error-hover"]],
    ["the danger button's label, pressed", "on-error", ["error-pressed"]],
    ["a row's label on the hover fill", "text-dim", ["hover"]],
    ["a key cap inside the selected row", "text-faint", ["fill-active"]],
  ];
  for (const [name, theme] of Object.entries(themes)) {
    for (const [what, ink, fills] of text) {
      test(`${name}: ${what} holds 4.5:1`, () => {
        expect(lowest(theme, ink, fills, SURFACES)).toBeGreaterThanOrEqual(4.5);
      });
    }
    test(`${name}: the focus ring holds 3:1 against the surface, the hover fill and the selected fill`, () => {
      expect(lowest(theme, "focus-ring", [], SURFACES)).toBeGreaterThanOrEqual(3);
      expect(lowest(theme, "focus-ring", ["hover"], SURFACES)).toBeGreaterThanOrEqual(3);
      expect(lowest(theme, "focus-ring", ["fill-active"], SURFACES)).toBeGreaterThanOrEqual(3);
    });
    test(`${name}: the inner ring of a filled control holds 3:1 against its fill`, () => {
      expect(lowest(theme, "on-accent", ["accent"], SURFACES)).toBeGreaterThanOrEqual(3);
      expect(lowest(theme, "on-error", ["error"], SURFACES)).toBeGreaterThanOrEqual(3);
      expect(lowest(theme, "on-accent", ["text"], SURFACES)).toBeGreaterThanOrEqual(3);
    });
  }

  test("the dark accent chip keeps the accent itself as its ink", () => {
    expect(dark["text-accent"]?.toLowerCase()).toBe(dark["accent"]?.toLowerCase());
  });

  for (const [name, theme] of Object.entries(themes)) {
    test(`${name}: the accent ink holds 4.5:1 as text on every surface and on the hovered row`, () => {
      expect(lowest(theme, "text-accent", [], [...SURFACES, "control-hover"])).toBeGreaterThanOrEqual(4.5);
      expect(lowest(theme, "text-accent", ["hover"], SURFACES)).toBeGreaterThanOrEqual(4.5);
    });
    test(`${name}: the drawing's ring and selection stroke hold 3:1 against the canvas`, () => {
      expect(lowest(theme, "canvas-focus-ring", [], ["canvas"])).toBeGreaterThanOrEqual(3);
      expect(lowest(theme, "selection", [], ["canvas"])).toBeGreaterThanOrEqual(3);
    });
  }

  test("light: a frozen layer's key, the accent ink, holds 3:1 hovered on the current row of the sidebar", () => {
    const light = themes["light"];
    if (light === undefined) throw new Error("no light theme");
    expect(lowest(light, "text-accent", ["fill-active", "hover"], ["panel"])).toBeGreaterThanOrEqual(3);
  });

  test("the canvas keeps one surface and one ring in both themes", () => {
    const light = block(':root[data-theme="light"]');
    expect(light["canvas"]).toBeUndefined();
    expect(light["canvas-focus-ring"]).toBeUndefined();
  });
});

describe("the app's own sheets speak the layer's colour vocabulary", () => {
  const sheets = ["styles.css", "interaction.css", "palette.css"].map(
    (file) => [file, strip(readFileSync(join(import.meta.dir, "..", file), "utf8"))] as const,
  );

  test("every ring is the focus ink, and the drawing's ring is the canvas's own", () => {
    for (const [file, css] of sheets) {
      for (const m of css.matchAll(/outline:\s*([^;]+);/g)) {
        const ring = m[1];
        if (ring === "none") continue;
        expect(`${file}: ${ring}`).toMatch(/: var\(--focus-outline-w\) solid var\(--(focus-ring|canvas-focus-ring)\)$/);
      }
    }
    const styles = sheets[0]?.[1] ?? "";
    expect(rule(styles, ".canvas-stage:focus-visible")).toContain("solid var(--canvas-focus-ring)");
    expect(rule(styles, ".cmd-input:focus")).toContain("border-color: var(--focus-ring)");
    expect(rule(sheets[1]?.[1] ?? "", ".prop-input:focus-visible, .prop-select:focus-visible")).toContain(
      "border-color: var(--focus-ring)",
    );
  });

  test("no text or glyph takes the accent fill as its ink, and no live text takes the disabled ink", () => {
    for (const [file, css] of sheets) {
      expect(`${file}: ${/(?<![\w-])color:\s*var\(--accent\)/.test(css)}`).toBe(`${file}: false`);
      expect(`${file}: ${/(?<![\w-])color:\s*var\(--text-disabled\)/.test(css)}`).toBe(`${file}: false`);
    }
  });
});

describe("the layer's recipe, from the stylesheet", () => {
  test("the accent chip's ink is the text step, and it holds the hover rung while pressed", () => {
    expect(rule(uiCss, ".ui-chip--accent")).toContain("color: var(--text-accent)");
    expect(rule(uiCss, ".ui-chip--accent.ui-chip--interactive:active")).toContain("background: var(--hover)");
  });

  test("every ring is the focus ink, and a filled control draws its label's ink inside the edge", () => {
    const rings = [...uiCss.matchAll(/outline:\s*([^;]+);/g)].map((m) => m[1]);
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) expect(ring).toBe("var(--focus-outline-w) solid var(--focus-ring)");
    expect(rule(uiCss, ".ui-button--primary:focus-visible")).toContain("outline-color: var(--on-accent)");
    expect(rule(uiCss, ".ui-button--danger:focus-visible")).toContain("outline-color: var(--on-error)");
    expect(rule(uiCss, ".ui-icon-button--inverted:focus-visible")).toContain("outline-color: var(--on-accent)");
  });

  test("a selected icon button keeps its fill under the pointer", () => {
    expect(uiCss).toContain('.ui-icon-button--ghost:hover:not(:disabled):not([aria-pressed="true"])');
  });

  test("the editor tab clips at 24ch and the compact tab at 18ch", () => {
    expect(rule(uiCss, ".ui-tab--md")).toContain("max-width: 24ch");
    expect(rule(uiCss, ".ui-tab--sm")).toContain("max-width: 18ch");
    expect(rule(uiCss, ".ui-tab")).toContain("text-overflow: ellipsis");
  });

  test("every state transition and the tooltip's arrival ease on the measured curve", () => {
    const easings = [...uiCss.matchAll(/var\(--ease-[\w-]+\)/g)].map((m) => m[0]);
    expect(easings.length).toBeGreaterThan(0);
    for (const easing of easings) expect(easing).toBe("var(--ease-standard)");
  });

  test("a coarse pointer gets 24px targets: an overhang on the 20px controls, a taller row and compact tab", () => {
    const at = uiCss.indexOf("@media (pointer: coarse)");
    expect(at).toBeGreaterThan(-1);
    const coarse = uiCss.slice(at);
    expect(rule(coarse, ".ui-icon-button--sm::after, .ui-chip--interactive::after")).toContain(
      "inset: calc((var(--control-h-chip) - var(--control-h-input)) / 2)",
    );
    expect(rule(coarse, ".ui-row, .ui-tab--sm")).toContain("height: var(--control-h-input)");
    expect(dark["control-h-input"]).toBe("24px");
    expect(dark["control-h-chip"]).toBe("20px");
    expect(uiCss.slice(0, at)).not.toContain("::after");
  });
});
