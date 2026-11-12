/**
 * The command palette's pure logic: what it lists, how a typed query matches, and the order the
 * matches come in. The list is the engine's command registry plus the `ui.*` items the shell
 * honours, the same set the menu bar draws, so every command is one keystroke-search away.
 *
 * A query matches a command by its label (what the menu calls it), its id or an alias (what a
 * person types at the command line), or a word of the menu path that holds it. The matches come
 * in tiers, best first: the exact name, a name that starts with the query, a word that starts
 * with it, the initials of the label's words, a word of the menu path, the letters inside a
 * word, the letters in order with gaps, and last a near miss (one slipped key). Inside a tier
 * the commands used last come first. The letters that matched in the label are reported so the
 * list can light them.
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
  /** The alias the query matched, when it was an alias and not the label or the id. */
  via?: string;
}

/** The rows the palette draws at first, and how many more each step down the list adds. */
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

/** The places `q`'s letters fall in `t`, in order, each the first one at or after `from`. */
function subsequence(q: string, t: string, from: number): number[] | null {
  const indices: number[] = [];
  let next = from;
  for (const ch of q) {
    const at = t.indexOf(ch, next);
    if (at < 0) return null;
    indices.push(at);
    next = at + 1;
  }
  return indices;
}

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
  const indices = subsequence(q, t, 0);
  if (indices === null) return null;
  let score = 400;
  let from = 0;
  for (const at of indices) {
    score += isWordStart(t, at) ? 30 : 0;
    score -= (at - from) * 3;
    from = at + 1;
  }
  return { score: score - (t.length - q.length), indices };
}

/** The tiers a match falls in, best last. A tier always outranks the one before it. */
const TIER = { typo: 0, fuzzy: 1, inner: 2, path: 3, initials: 4, word: 5, prefix: 6, exact: 7 } as const;

/** Within a tier: the label outranks the id, the id an alias, and all of them a path word. */
const SOURCE = { label: 3000, id: 2000, alias: 1000, path: 0 } as const;
/** What an id or alias typed whole adds, so it leads the exact tier (under the recency step). */
const EXACT_NAME = 4000;

/** One way a query (or one word of it) matched a row. */
interface Hit {
  tier: number;
  /** The order inside the tier: the source, then a short text and an early match. */
  quality: number;
  /** The label's matched letters. */
  indices: number[];
  via?: string;
}

/** What a row is matched against, lower-cased once per row. */
interface Indexed {
  label: string;
  id: string;
  aliases: string[];
  pathWords: string[];
  /** The whole words a slipped key is compared with: the label's, the id and its parts, the aliases. */
  words: string[];
}

const indexed = new WeakMap<PaletteItem, Indexed>();

const wordsOf = (text: string): string[] => text.split(/[^a-z0-9]+/).filter((w) => w !== "");

function indexOf(item: PaletteItem): Indexed {
  const known = indexed.get(item);
  if (known !== undefined) return known;
  const label = item.label.toLowerCase();
  const id = item.id.toLowerCase();
  const aliases = item.aliases.map((a) => a.toLowerCase());
  const entry: Indexed = { label, id, aliases, pathWords: wordsOf(item.path.toLowerCase()), words: [...new Set([...wordsOf(label), id, ...wordsOf(id), ...aliases])] };
  indexed.set(item, entry);
  return entry;
}

const run = (at: number, length: number): number[] => Array.from({ length }, (_, i) => at + i);

/** A short text and an early match come first among equals. */
const closeness = (text: string, at: number): number => 500 - Math.min(at, 100) - Math.min(text.length, 300);

/** The label's own tiers: the whole label, its start, a word's start, its initials, inside a word, in order. */
function labelHit(q: string, t: string): Hit | null {
  if (q.length > t.length) return null;
  const at = t.indexOf(q);
  if (at === 0) return { tier: t.length === q.length ? TIER.exact : TIER.prefix, quality: SOURCE.label + closeness(t, 0), indices: run(0, q.length) };
  for (let word = at; word >= 0; word = t.indexOf(q, word + 1)) {
    if (isWordStart(t, word)) return { tier: TIER.word, quality: SOURCE.label + closeness(t, word), indices: run(word, q.length) };
  }
  // "ze" is Zoom Extents: every letter starts a word, in the words' order.
  if (q.length > 1) {
    const initials: number[] = [];
    let from = 0;
    for (const ch of q) {
      let found = -1;
      for (let i = from; i < t.length && found < 0; i++) if (t[i] === ch && isWordStart(t, i)) found = i;
      if (found < 0) break;
      initials.push(found);
      from = found + 1;
    }
    if (initials.length === q.length) return { tier: TIER.initials, quality: SOURCE.label + closeness(t, initials[0] ?? 0), indices: initials };
  }
  if (at > 0) return { tier: TIER.inner, quality: SOURCE.label + closeness(t, at), indices: run(at, q.length) };
  // The letters in order ("ln" is Line): from a word's start, and close together, or it is noise.
  let best: number[] | null = null;
  for (let start = t.indexOf(q[0] ?? ""); start >= 0; start = t.indexOf(q[0] ?? "", start + 1)) {
    if (!isWordStart(t, start)) continue;
    const found = subsequence(q, t, start);
    if (found === null) break;
    const span = (found[found.length - 1] ?? start) - start + 1;
    if (span <= q.length * 2 + 2 && (best === null || span < (best[best.length - 1] ?? 0) - (best[0] ?? 0) + 1)) best = found;
  }
  return best === null ? null : { tier: TIER.fuzzy, quality: SOURCE.label + closeness(t, best[0] ?? 0) - ((best[best.length - 1] ?? 0) - (best[0] ?? 0)), indices: best };
}

/** A name typed at the command line (the id or an alias): the whole name, its start, a part's start, inside it. */
function nameHit(q: string, name: string, source: number, via: string | undefined): Hit | null {
  const at = name.indexOf(q);
  if (at < 0) return null;
  const hit = { quality: source + closeness(name, at), indices: [], via };
  // The exact name is the one thing a person types whole: it leads its tier whatever the label says.
  if (at === 0) return name.length === q.length ? { ...hit, tier: TIER.exact, quality: hit.quality + EXACT_NAME } : { ...hit, tier: TIER.prefix };
  for (let part = at; part >= 0; part = name.indexOf(q, part + 1)) if (isWordStart(name, part)) return { ...hit, tier: TIER.word };
  return { ...hit, tier: TIER.inner };
}

const better = (a: Hit | null, b: Hit | null): Hit | null => (b === null ? a : a === null || b.tier > a.tier || (b.tier === a.tier && b.quality > a.quality) ? b : a);

/** Optimal string alignment distance (an edit is a slipped, missing, extra or swapped letter), given up past `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let last = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1];
      let cost = Math.min((last[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (last[j - 1] ?? 0) + (same ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cost = Math.min(cost, (before[j - 2] ?? 0) + 1);
      row.push(cost);
    }
    before = last;
    last = row;
  }
  return last[b.length] ?? max + 1;
}

/** A near miss: one slipped key in a word of five letters or more ("cirlce"), two in a long one. */
function typoHit(q: string, entry: Indexed): Hit | null {
  if (q.length < 5 || q.length > 24) return null;
  const max = q.length >= 9 ? 2 : 1;
  let least = max + 1;
  for (const word of entry.words) {
    if (word.length < 5) continue;
    // The word as far as it has been typed, and the whole word.
    least = Math.min(least, editDistance(q, word.slice(0, q.length), max), editDistance(q, word, max));
  }
  return least > max ? null : { tier: TIER.typo, quality: 500 - least * 100 - Math.min(entry.label.length, 300), indices: [] };
}

/** The best way one stretch of the query (all of it, or one word of it) matches a row. */
function hitOf(q: string, entry: Indexed): Hit | null {
  const byLabel = labelHit(q, entry.label);
  let best = better(byLabel, nameHit(q, entry.id, SOURCE.id, undefined));
  for (const alias of entry.aliases) best = better(best, nameHit(q, alias, SOURCE.alias, alias));
  if (entry.pathWords.some((word) => word.startsWith(q))) best = better(best, { tier: TIER.path, quality: SOURCE.path + closeness(entry.label, 0), indices: [] });
  if (best === null) return typoHit(q, entry);
  // A row that ranks by its name still lights the letters its label shares with the query.
  return byLabel !== null && best !== byLabel ? { ...best, indices: byLabel.indices } : best;
}

/** The best match of a query against one row. Several words must each match something of the row. */
function matchItem(q: string, words: readonly string[], item: PaletteItem): Hit | null {
  const entry = indexOf(item);
  if (words.length < 2) return hitOf(q, entry);
  // The words together, as typed ("zoom e" starts Zoom Extents), or each on its own ("dim lin").
  const whole = labelHit(q, entry.label);
  const parts: Hit[] = [];
  for (const word of words) {
    const hit = hitOf(word, entry);
    if (hit === null) return whole;
    parts.push(hit);
  }
  const tier = Math.min(TIER.word, ...parts.map((p) => p.tier));
  const quality = Math.round(parts.reduce((sum, p) => sum + p.quality, 0) / parts.length);
  const indices = [...new Set(parts.flatMap((p) => p.indices))].sort((a, b) => a - b);
  return better({ tier, quality, indices }, whole);
}

/** What a disabled command gives up: it lists below every command that can run. */
const DISABLED = 100_000_000;

/**
 * The rows for a query, best first. With nothing typed: the recently used commands in their
 * order, then everything by label. Typed: by tier (see the file header), the recently used
 * first inside a tier. A disabled command still shows (so the reader learns it exists) but
 * sinks below the ones that can run.
 */
export function rankCommands(query: string, items: readonly PaletteItem[], recent: readonly string[], limit: number = PALETTE_LIMIT): PaletteMatch[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    const byId = new Map(items.map((item) => [item.id, item]));
    const first = recent.map((id) => byId.get(id)).filter((item): item is PaletteItem => item !== undefined);
    const firstIds = new Set(first.map((item) => item.id));
    return [...first, ...items.filter((item) => !firstIds.has(item.id))].slice(0, limit).map((item) => ({ item, score: 0, indices: [] }));
  }
  const words = q.split(/\s+/);
  const recency = new Map(recent.map((id, i) => [id, recent.length - i]));
  const sure: PaletteMatch[] = [];
  const guesses: PaletteMatch[] = [];
  for (const item of items) {
    const hit = matchItem(q, words, item);
    if (hit === null) continue;
    const score = hit.tier * 1_000_000 + (recency.get(item.id) ?? 0) * 10_000 + hit.quality - (item.enabled ? 0 : DISABLED);
    (hit.tier === TIER.typo ? guesses : sure).push(hit.via === undefined ? { item, score, indices: hit.indices } : { item, score, indices: hit.indices, via: hit.via });
  }
  // A near miss is a guess, offered only when nothing matched what was typed: "paste" lists the
  // Paste commands even while none of them can run, never a look-alike that can.
  const matches = sure.length > 0 ? sure : guesses;
  return matches.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label) || a.item.id.localeCompare(b.item.id)).slice(0, limit);
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

/** The name a row prints beside its label: the alias that matched, or the id where it says more than the label does. */
export function rowName(match: PaletteMatch): string {
  if (match.via !== undefined) return match.via;
  const { id, label } = match.item;
  return id.startsWith("ui.") || id.toLowerCase() === label.toLowerCase() ? "" : id;
}

/** The row the highlight lands on after a move of `by` rows; the arrows wrap, a page stops at the ends. */
export function stepActive(active: number, by: number, count: number, wrap: boolean): number {
  if (count <= 0) return 0;
  const next = active + by;
  return wrap ? ((next % count) + count) % count : Math.min(count - 1, Math.max(0, next));
}
