/**
 * The command palette's pure logic: what it lists, how a typed query matches, and the order the
 * matches come in. The list is the engine's command registry plus the `ui.*` items the shell
 * honours, the same set the menu bar draws, so every command is one keystroke-search away.
 *
 * A query matches a command by its label (what the menu calls it), its id (what a person types
 * at the command line) or an alias. Matching is a subsequence match that prefers a run of
 * letters, the start of a word and a short label; the letters that matched in the label are
 * reported so the list can light them.
 *
 * No JSX and no DOM here: the tests drive all of it.
 */

import type { UiItem } from "./commands";
import type { CommandInfo } from "./facade";

/** One row the palette can run. */
export interface PaletteItem {
  id: string;
  label: string;
  /** Where the menu bar keeps it ("Draw > Circle"), empty when it has no menu placement. */
  path: string;
  shortcut: string;
  aliases: readonly string[];
  enabled: boolean;
}

/** A row that matched, with the label's matched letters. */
export interface PaletteMatch {
  item: PaletteItem;
  score: number;
  /** Indices into `item.label` of the letters the query matched (empty when it matched the id). */
  indices: readonly number[];
}

/** The most rows the palette draws at once; the reader narrows by typing. */
export const PALETTE_LIMIT = 60;
/** How many commands the palette remembers as recently used. */
export const RECENT_LIMIT = 8;

/** Where a menu path keeps its command: the path without its last segment (the command itself). */
function parentPath(segments: readonly string[]): string {
  return segments
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .slice(0, -1)
    .join(" > ");
}

/** The rows the palette lists: the registry's commands, then the shell's own items, by label. */
export function paletteItems(commands: readonly CommandInfo[], uiItems: readonly UiItem[]): PaletteItem[] {
  const items: PaletteItem[] = [];
  const seen = new Set<string>();
  for (const c of commands) {
    if (c.label === "" || seen.has(c.id)) continue;
    seen.add(c.id);
    items.push({ id: c.id, label: c.label, path: parentPath(c.menu.split(/[>›/]/)), shortcut: c.shortcut, aliases: c.aliases, enabled: c.enabled });
  }
  for (const u of uiItems) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    items.push({ id: u.id, label: u.label, path: parentPath(u.menu), shortcut: u.shortcut ?? "", aliases: [], enabled: true });
  }
  return items.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

const isWordStart = (text: string, at: number): boolean => at === 0 || /[^a-z0-9]/.test(text[at - 1] ?? "");

/**
 * Match `query` against `text`, ignoring case. A whole-run match scores highest (more at the
 * start of the text or of a word); otherwise the letters must appear in order, and the score
 * falls with every gap. `null` when the letters are not all there.
 */
export function fuzzy(query: string, text: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q === "") return { score: 0, indices: [] };
  if (q.length > t.length) return null;
  const run = t.indexOf(q);
  if (run >= 0) {
    const bonus = run === 0 ? 300 : isWordStart(t, run) ? 150 : 0;
    const indices = Array.from({ length: q.length }, (_, i) => run + i);
    return { score: 1000 + bonus - run - (t.length - q.length), indices };
  }
  const indices: number[] = [];
  let from = 0;
  let score = 400;
  for (const ch of q) {
    const at = t.indexOf(ch, from);
    if (at < 0) return null;
    score += isWordStart(t, at) ? 30 : 0;
    score -= (at - from) * 3;
    indices.push(at);
    from = at + 1;
  }
  return { score: score - (t.length - q.length), indices };
}

/** The best match of a query against one row: its label, its id, or an alias. */
function matchItem(query: string, item: PaletteItem): PaletteMatch | null {
  const q = query.trim().toLowerCase();
  const byLabel = fuzzy(q, item.label);
  let best: PaletteMatch | null = byLabel === null ? null : { item, score: byLabel.score, indices: byLabel.indices };
  for (const name of [item.id, ...item.aliases]) {
    const lower = name.toLowerCase();
    // What a person types at the command line: an exact name beats everything, a prefix is strong.
    const score = lower === q ? 2000 : lower.startsWith(q) ? 1200 - (lower.length - q.length) : -1;
    if (score > (best?.score ?? -1)) best = { item, score, indices: [] };
  }
  return best;
}

/**
 * The rows for a query, best first. With nothing typed: the recently used commands in their
 * order, then everything by label. A disabled command still shows (so the reader learns it
 * exists) but sinks below the ones that can run.
 */
export function rankCommands(query: string, items: readonly PaletteItem[], recent: readonly string[], limit: number = PALETTE_LIMIT): PaletteMatch[] {
  if (query.trim() === "") {
    const byId = new Map(items.map((item) => [item.id, item]));
    const first = recent.map((id) => byId.get(id)).filter((item): item is PaletteItem => item !== undefined);
    const firstIds = new Set(first.map((item) => item.id));
    return [...first, ...items.filter((item) => !firstIds.has(item.id))].slice(0, limit).map((item) => ({ item, score: 0, indices: [] }));
  }
  const matches: PaletteMatch[] = [];
  for (const item of items) {
    const m = matchItem(query, item);
    if (m !== null) matches.push(item.enabled ? m : { ...m, score: m.score - 5000 });
  }
  return matches.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label)).slice(0, limit);
}

/** How many commands the composer's slash list shows. */
export const SLASH_LIMIT = 6;

/**
 * What a composer draft asks the slash list for: the text after a leading `/`, while the draft is
 * still one word (`/`, `/zo`, `/zoom.extents`). `null` once it is anything else: a message that
 * merely starts with a slash and goes on ("/ is the root"), or no slash at all.
 */
export function slashQuery(draft: string): string | null {
  return /^\/[^\s/]*$/.test(draft) ? draft.slice(1) : null;
}

/** A label cut into runs, the matched letters marked, for the list to draw. */
export function highlight(label: string, indices: readonly number[]): { text: string; hit: boolean }[] {
  const hits = new Set(indices);
  const runs: { text: string; hit: boolean }[] = [];
  [...label].forEach((ch, i) => {
    const hit = hits.has(i);
    const last = runs[runs.length - 1];
    if (last !== undefined && last.hit === hit) last.text += ch;
    else runs.push({ text: ch, hit });
  });
  return runs;
}

/** The recently used list after running `id`: newest first, no repeats, bounded. */
export function rememberCommand(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, RECENT_LIMIT);
}
