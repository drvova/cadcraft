#!/usr/bin/env node
// contrast-report.mjs: the measured contrast report for the web system's colours.
//
// Reads the single token source (src/tokens.css), composites every translucent value over every
// surface it can sit on, and prints the WCAG 2.x contrast ratio of every foreground/surface pair
// in each theme, as Markdown the colors.md page pastes verbatim. The numbers on that page are
// never typed in: run this script and paste its command and output.
//
// Usage: node scripts/contrast-report.mjs
// Exit 0 with the report; a pair below its threshold is printed, not failed (the build's failing
// check is check-system.mjs). Exit 1, naming the token, when a token this script lists is not
// defined in src/tokens.css or is not a colour: a pair that cannot be measured is never skipped.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const css = readFileSync(join(root, "src/tokens.css"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

// ---- the two theme blocks: the default :root and :root[data-theme="light"] ----
function block(selector) {
  const at = css.indexOf(selector);
  if (at < 0) return {};
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  const out = {};
  for (const m of css.slice(open + 1, close).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
// The light theme restates only the roles that change; the rest keep the dark values, as CSS does.
const dark = block(":root {");
const light = { ...dark, ...block(':root[data-theme="light"]') };

// ---- colour parsing, with var() resolved against the theme ----
function parseColor(value, theme, depth = 0) {
  if (value === undefined || depth > 8) return null;
  const v = String(value).trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) return parseColor(theme[ref[1].slice(2)], theme, depth + 1);
  let m;
  if ((m = /^#([0-9a-f]{3})$/i.exec(v))) { const [r, g, b] = [...m[1]].map((c) => parseInt(c + c, 16)); return { r, g, b, a: 1 }; }
  if ((m = /^#([0-9a-f]{6})$/i.exec(v))) { const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }; }
  if ((m = /^#([0-9a-f]{8})$/i.exec(v))) { const n = parseInt(m[1], 16); return { r: (n >>> 24) & 255, g: (n >> 16) & 255, b: (n >> 8) & 255, a: (n & 255) / 255 }; }
  if ((m = /^rgba?\(([^)]+)\)$/i.exec(v))) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  return null;
}
const over = (fg, bg) => (fg.a >= 1 ? { ...fg, a: 1 } : { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const luminance = ({ r, g, b }) => {
  const f = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const fmt = (x) => (Math.round(x * 10) / 10).toFixed(1);

// ---- the pairs ----
// Surfaces: every colour a theme ink can sit on. Foregrounds: the ink roles (4.5:1 text AA,
// 3:1 for icons, borders and the focus ring, per WCAG 1.4.3 and 1.4.11) and the translucent
// fills, which carry no contrast threshold; their cell is the ratio of the composited fill
// against the surface (perceptibility of a hover or selected step).
const SURFACES = ["chrome", "chrome-dark", "panel", "tab-active", "control", "control-hover", "surface-elevated", "surface-inset", "list-bg", "cmd-bg"];
const INK = {
  text: 4.5, "text-dim": 4.5, "text-faint": 4.5, "text-disabled": null, "text-accent": 4.5, icon: 3,
  accent: 3, "focus-ring": 3, warn: 3, error: 3, "toggle-on": 3,
};
// The action fills and the ink each one carries: a label pair (4.5:1), not a surface pair.
const ON = { "on-accent": ["accent", "accent-hover", "accent-pressed"], "on-error": ["error", "error-hover", "error-pressed"] };
// The focus ring also crosses the two state fills a focused control can carry (3:1 over each surface).
const RING_FILLS = ["hover", "fill-active"];
// The drawing is the same dark surface in both themes, so no theme ink is paired with it: these
// are the only strokes the interface draws over it (3:1).
const CANVAS_INK = ["selection", "canvas-focus-ring"];
const FILLS = ["hover", "fill-active", "fill-pressed", "fill-disabled", "accent-soft", "border", "border-soft", "scrollbar", "scrollbar-hover", "composer-border", "composer-border-active"];
// The hint box is its own surface in both themes, and these are the inks drawn on it: the text, the
// second line and the key cap (4.5:1 each).
const HINT_INK = ["text", "text-dim", "text-faint"];

// Every token asked for that tokens.css does not define, or defines as something other than a colour.
const unresolved = new Set();

function report(theme, name) {
  const color = (token) => {
    const parsed = parseColor(theme[token], theme);
    if (!parsed) unresolved.add(token);
    return parsed;
  };
  const lines = [`### ${name}`, "", `| foreground \\ surface | ${SURFACES.map((s) => `\`--${s}\``).join(" | ")} |`, `| --- | ${SURFACES.map(() => "---").join(" | ")} |`];
  const below = [];
  for (const [fg, threshold] of Object.entries(INK)) {
    const base = color(fg);
    if (!base) continue;
    const cells = SURFACES.map((s) => {
      const surface = color(s);
      if (!surface) return "?";
      const r = ratio(over(base, surface), surface);
      const bad = threshold !== null && r < threshold;
      if (bad) below.push(`${fg} over ${s} ${fmt(r)}:1 (needs ${threshold}:1)`);
      return `${fmt(r)}${threshold === null ? " ·" : bad ? " ✗" : " ✓"}`;
    });
    lines.push(`| \`--${fg}\` | ${cells.join(" | ")} |`);
  }
  for (const fg of FILLS) {
    const base = color(fg);
    if (!base) continue;
    const cells = SURFACES.map((s) => {
      const surface = color(s);
      if (!surface) return "?";
      return `${fmt(ratio(over(base, surface), surface))} ·`;
    });
    lines.push(`| \`--${fg}\` (fill) | ${cells.join(" | ")} |`);
  }
  // One sentence of pairs: `ink` over each ground (a token, or that token under a fill), at `threshold`.
  const pairs = (ink, grounds, threshold, ground = color, where = (g) => g) =>
    grounds.map((g) => {
      const base = color(ink);
      const bg = ground(g);
      if (!base || !bg) return `\`--${g}\` ?`;
      const r = ratio(over(base, bg), bg);
      const bad = r < threshold;
      if (bad) below.push(`${ink} over ${where(g)} ${fmt(r)}:1 (needs ${threshold}:1)`);
      return `\`--${g}\` ${fmt(r)}${bad ? " ✗" : " ✓"}`;
    });
  for (const [ink, fills] of Object.entries(ON)) {
    lines.push("", `\`--${ink}\` on its action fills: ${pairs(ink, fills, 4.5).join("; ")}.`);
  }
  for (const fill of RING_FILLS) {
    const under = (s) => { const surface = color(s); const top = color(fill); return surface && top ? over(top, surface) : null; };
    lines.push("", `\`--focus-ring\` against \`--${fill}\` over each surface: ${pairs("focus-ring", SURFACES, 3, under, (s) => `${fill} over ${s}`).join("; ")}.`);
  }
  const canvas = color("canvas");
  if (canvas) {
    const cells = CANVAS_INK.flatMap((ink) => pairs(ink, ["canvas"], 3).map((cell) => cell.replace("`--canvas`", `\`--${ink}\``)));
    lines.push("", `On the drawing (\`--canvas\`, one dark surface in both themes): ${cells.join("; ")}.`);
  }
  const hint = HINT_INK.flatMap((ink) => pairs(ink, ["tooltip-bg"], 4.5).map((cell) => cell.replace("`--tooltip-bg`", `\`--${ink}\``)));
  lines.push("", `On the hint (\`--tooltip-bg\`): ${hint.join("; ")}.`);
  lines.push("", below.length ? `Below threshold: ${below.join("; ")}` : "Every ink pair is at or above its threshold.");
  return { lines, below };
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("usage: node scripts/contrast-report.mjs\nPrints the WCAG contrast grid for src/tokens.css, both themes, as Markdown.");
  process.exit(0);
}
const out = [];
out.push("Contrast, measured by `node scripts/contrast-report.mjs` (run from the app folder), WCAG 2.x. Every cell is the foreground composited over that surface: ratio, then ✓ at the token's threshold (4.5:1 text, 3:1 icons, borders and the focus ring), ✗ below it, · for the fills, which carry no threshold — their cell shows how visible the step is against the surface. The drawing keeps one dark surface in both themes, so it is not a column: the strokes drawn over it are listed under each grid.");
for (const [theme, name] of [[dark, "dark (default)"], [light, "light"]]) {
  const r = report(theme, name);
  out.push("", ...r.lines);
}
if (unresolved.size > 0) {
  console.error(`contrast-report: not defined as a colour in src/tokens.css: ${[...unresolved].map((t) => `--${t}`).join(", ")}. Define the token, or remove its name from this script.`);
  process.exit(1);
}
console.log(out.join("\n"));
