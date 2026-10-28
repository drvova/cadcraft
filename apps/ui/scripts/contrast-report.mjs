#!/usr/bin/env node
// contrast-report.mjs: the measured contrast report for the web system's colours.
//
// Reads the single token source (src/tokens.css), composites every translucent value over every
// surface it can sit on, and prints the WCAG 2.x contrast ratio of every foreground/surface pair
// in each theme, as Markdown the colors.md page pastes verbatim. The numbers on that page are
// never typed in: run this script and paste its command and output.
//
// Usage: node scripts/contrast-report.mjs
// Exit 0 always: it is a report. The build's failing check is check-system.mjs.

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
// Surfaces: every colour a foreground can sit on. Foregrounds: the ink roles (4.5:1 text AA,
// 3:1 for icons and borders, per WCAG 1.4.3 and 1.4.11) and the translucent fills, which carry
// no contrast threshold; their cell is the ratio of the composited fill against the surface
// (perceptibility of a hover or selected step).
const SURFACES = ["chrome", "chrome-dark", "panel", "tab-active", "control", "control-hover", "surface-elevated", "canvas", "list-bg", "cmd-bg"];
const INK = {
  text: 4.5, "text-dim": 4.5, "text-faint": 4.5, "text-disabled": null, icon: 3, "icon-accent": 3, "icon-point": 3,
  accent: 3, warn: 3, error: 3, snap: 3, "toggle-on": 3, "cmd-keyword": 4.5,
};
// The action fills: the ink on them is --on-accent, not a surface pair.
const ACTIONS = ["accent", "accent-hover", "accent-pressed", "error", "error-hover", "error-pressed", "selection"];
const FILLS = ["hover", "fill-active", "fill-pressed", "fill-disabled", "accent-soft", "cmd-keyword-hover", "border", "border-soft", "scrollbar", "scrollbar-hover", "composer-border", "composer-border-active", "cmd-history"];

function report(theme, name) {
  const color = (token) => parseColor(theme[token], theme);
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
  const onAccent = color("on-accent");
  if (onAccent) {
    const cells = ACTIONS.map((a) => {
      const fill = color(a);
      if (!fill) return "?";
      const r = ratio(over(onAccent, fill), fill);
      const bad = r < 4.5;
      if (bad) below.push(`on-accent over ${a} ${fmt(r)}:1 (needs 4.5:1)`);
      return `\`--${a}\` ${fmt(r)}${bad ? " ✗" : " ✓"}`;
    });
    lines.push("", `\`--on-accent\` on the action fills: ${cells.join("; ")}.`);
  }
  lines.push("", below.length ? `Below threshold: ${below.join("; ")}` : "Every ink pair is at or above its threshold.");
  return { lines, below };
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("usage: node scripts/contrast-report.mjs\nPrints the WCAG contrast grid for src/tokens.css, both themes, as Markdown.");
  process.exit(0);
}
const out = [];
out.push("Contrast, measured by `node scripts/contrast-report.mjs` (run from the app folder), WCAG 2.x. Every cell is the foreground composited over that surface: ratio, then ✓ at the token's threshold (4.5:1 text, 3:1 icons and borders), ✗ below it, · for the fills, which carry no threshold — their cell shows how visible the step is against the surface.");
for (const [theme, name] of [[dark, "dark (default)"], [light, "light"]]) {
  const r = report(theme, name);
  out.push("", ...r.lines);
}
const missing = ["text", "icon", "accent", "error"].filter((t) => !parseColor(dark[t], dark) || !parseColor(light[t], light));
if (missing.length) out.push("", `Unresolved tokens: ${missing.join(", ")}`);
console.log(out.join("\n"));
