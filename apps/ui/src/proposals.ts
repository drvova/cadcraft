/**
 * Proposals: a change to the drawing read before it is made (the engine's `propose`, `accept`,
 * `reject` and `proposals`, `crates/engine/src/cmd/proposal.rs`). This module is the interface's
 * side of them, for the cards that draw them:
 *
 * - **The reports, read strictly** (`parseProposals`): a reply is the engine's, but nothing in it
 *   is trusted to have a shape; a report that is not one is left out, never half-read.
 * - **The rows a card shows** (`changeRows`, `checkLines`, `objectsLine`): every figure to the
 *   precision the engine gave it, a signed difference with its unit, money in its currency.
 * - **The holder** (`createProposals`): what waits, read again after every change the shell sees
 *   (a command, the assistant's run), grouped by the `propose` it came from, with `accept`,
 *   `reject`, `rejectGroup` and `rejectAll`, and one polite sentence for a screen reader when a
 *   proposal arrives or is decided.
 * - **The stills** (`createStillCache`): the piece before and after, drawn by the 3D stage's own
 *   renderer from `piecemesh` of a side's parameters (which reads no drawing), one at a time, and
 *   kept by those parameters so a card drawn again draws nothing again.
 *
 * Nothing here touches the DOM, and derived values are plain functions (not memos), so the module
 * behaves the same under the tests' non-reactive Solid build.
 */

import { batch, createSignal } from "solid-js";
import { formatMoney, metalText, trim } from "./bench";
import type { Envelope } from "./facade";
import { isRecord } from "./json";
import { renderPieceStill } from "./render3d";
import { parseMeshReply } from "./view3d";

// ---- the reports ----

/** The most proposals the engine keeps waiting (`MAX_PENDING`); a longer list is cut here. */
export const MAX_PROPOSALS = 16;
/** The most rows, checks and steps a card reads from one report. */
const MAX_ROWS = 64;
const MAX_TITLE = 120;
const MAX_TEXT = 400;

/** One side of a proposal: the figures of the drawing as it was, or as it would be. */
export interface ProposalSide {
  /** The piece's parameters (what `piecemesh` draws), when the side has a piece. */
  params: Readonly<Record<string, unknown>> | null;
  stones: { count: number; carat: number } | null;
  grams: number | null;
  cost: { total: number; currency: string; unpriced: number } | null;
}

/** One figure that differs: the engine's row as it gave it. */
export interface ProposalChange {
  key: string;
  label: string;
  before: unknown;
  after: unknown;
  delta: number | null;
  unit: string | null;
}

export interface ProposalCheck {
  id: string;
  message: string;
}

export interface Proposal {
  id: number;
  group: number;
  title: string;
  steps: readonly { command: string; params: unknown }[];
  before: ProposalSide;
  after: ProposalSide;
  changes: readonly ProposalChange[];
  checks: { fixed: readonly ProposalCheck[]; broken: readonly ProposalCheck[]; failing: readonly ProposalCheck[] };
  objects: { before: number; after: number; added: number; removed: number; modified: number };
  unchanged: boolean;
  /** The drawing changed since it was proposed: `accept` would refuse it. */
  stale: boolean;
  message: string;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), Number.MAX_SAFE_INTEGER) : 0);
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max = MAX_TEXT): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "");

function side(v: unknown): ProposalSide {
  const s = isRecord(v) ? v : {};
  const piece = isRecord(s["piece"]) ? s["piece"] : null;
  const params = piece !== null && isRecord(piece["params"]) ? piece["params"] : null;
  const stones = isRecord(s["stones"]) ? { count: count(s["stones"]["count"]), carat: finite(s["stones"]["carat"]) ?? 0 } : null;
  const cost = isRecord(s["cost"]) && finite(s["cost"]["total"]) !== null ? { total: finite(s["cost"]["total"]) ?? 0, currency: text(s["cost"]["currency"], 8) || "USD", unpriced: count(s["cost"]["unpriced"]) } : null;
  return { params, stones, grams: finite(s["grams"]), cost };
}

function checkList(v: unknown): ProposalCheck[] {
  if (!Array.isArray(v)) return [];
  const out: ProposalCheck[] = [];
  for (const c of v.slice(0, MAX_ROWS)) {
    if (isRecord(c) && typeof c["id"] === "string") out.push({ id: text(c["id"], 40), message: text(c["message"]) });
  }
  return out;
}

/** One report as `propose` and `proposals` reply it, or null when it is not one. */
export function parseProposal(v: unknown): Proposal | null {
  if (!isRecord(v)) return null;
  const id = finite(v["id"]);
  const group = finite(v["group"]);
  if (id === null || group === null || !Number.isInteger(id) || !Number.isInteger(group) || id < 0 || group < 0) return null;
  const changes: ProposalChange[] = [];
  if (Array.isArray(v["changes"])) {
    for (const row of v["changes"].slice(0, MAX_ROWS)) {
      if (!isRecord(row) || typeof row["key"] !== "string") continue;
      changes.push({ key: text(row["key"], 40), label: text(row["label"], 60) || text(row["key"], 40), before: row["before"] ?? null, after: row["after"] ?? null, delta: finite(row["delta"]), unit: typeof row["unit"] === "string" ? text(row["unit"], 8) : null });
    }
  }
  const checks = isRecord(v["checks"]) ? v["checks"] : {};
  const objects = isRecord(v["objects"]) ? v["objects"] : {};
  const steps = Array.isArray(v["steps"])
    ? v["steps"].slice(0, MAX_ROWS).flatMap((s) => (isRecord(s) && typeof s["command"] === "string" ? [{ command: text(s["command"], 40), params: s["params"] ?? {} }] : []))
    : [];
  return {
    id,
    group,
    title: text(v["title"], MAX_TITLE) || `Proposal ${id}`,
    steps,
    before: side(v["before"]),
    after: side(v["after"]),
    changes,
    checks: { fixed: checkList(checks["fixed"]), broken: checkList(checks["broken"]), failing: checkList(checks["failing"]) },
    objects: { before: count(objects["before"]), after: count(objects["after"]), added: count(objects["added"]), removed: count(objects["removed"]), modified: count(objects["modified"]) },
    unchanged: v["unchanged"] === true,
    stale: v["stale"] === true,
    message: text(v["message"]),
  };
}

/** The reports of a `proposals {}` (or `propose`) reply, in the engine's order. */
export function parseProposals(result: unknown): Proposal[] {
  if (!isRecord(result) || !Array.isArray(result["proposals"])) return [];
  const out: Proposal[] = [];
  const seen = new Set<number>();
  for (const raw of result["proposals"].slice(0, MAX_PROPOSALS)) {
    const p = parseProposal(raw);
    if (p !== null && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/** The proposals of one `propose`: one, or the variants that are alternatives to each other. */
export interface ProposalGroup {
  group: number;
  items: readonly Proposal[];
}

/** The proposals by the `propose` they came from, each group where its first member stands. */
export function groupProposals(list: readonly Proposal[]): ProposalGroup[] {
  const groups: { group: number; items: Proposal[] }[] = [];
  for (const p of list) {
    const at = groups.find((g) => g.group === p.group);
    if (at === undefined) groups.push({ group: p.group, items: [p] });
    else at.items.push(p);
  }
  return groups;
}

// ---- the rows a card shows ----

/** A number to the engine's precision: at most three decimals, no trailing zeros, thousands grouped. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  const t = trim(Math.abs(n), 3);
  const [whole = "0", frac] = t.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 && t !== "0" ? "−" : ""}${grouped}${frac === undefined ? "" : `.${frac}`}`;
}

/** The units a card writes after a figure ("pc" is the row's own label's to say: "Stones 1 → 19"). */
const shownUnit = (unit: string | null): string => (unit === null || unit === "pc" ? "" : unit);

/** A figure of a change row as a person reads it. Money when the row is the estimate. */
export function formatValue(value: unknown, row: Pick<ProposalChange, "key" | "unit">): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    if (row.key === "cost.total") return formatMoney(value, row.unit ?? "USD");
    const unit = shownUnit(row.unit);
    return unit === "" ? formatNumber(value) : `${formatNumber(value)} ${unit}`;
  }
  if (typeof value === "string") {
    const t = text(value, 60);
    return row.key === "piece.metal" ? metalText(t) : t;
  }
  return "";
}

/** A difference with its sign and unit: "+0.6 mm", "−0.96 g", "+$120.00"; null for none. */
export function formatDelta(row: Pick<ProposalChange, "key" | "unit" | "delta">): string | null {
  const d = row.delta;
  if (d === null || !Number.isFinite(d)) return null;
  if (d === 0) return "±0";
  const sign = d > 0 ? "+" : "−";
  if (row.key === "cost.total") return `${sign}${formatMoney(Math.abs(d), row.unit ?? "USD")}`;
  const unit = shownUnit(row.unit);
  return `${sign}${formatNumber(Math.abs(d))}${unit === "" ? "" : ` ${unit}`}`;
}

/** One row of a card's table of changes. */
export interface ChangeRow {
  key: string;
  label: string;
  before: string;
  after: string;
  delta: string | null;
}

export function changeRows(p: Proposal): ChangeRow[] {
  return p.changes.map((row) => ({ key: row.key, label: row.label, before: formatValue(row.before, row), after: formatValue(row.after, row), delta: formatDelta(row) }));
}

/** The checks a card names: those the change would make fail, those it would make pass, and how
 *  many more fail on both sides (failing before and still failing after). */
export function checkLines(p: Proposal): { broken: readonly ProposalCheck[]; fixed: readonly ProposalCheck[]; stillFailing: number } {
  const broken = new Set(p.checks.broken.map((c) => c.id));
  return { broken: p.checks.broken, fixed: p.checks.fixed, stillFailing: p.checks.failing.filter((c) => !broken.has(c.id)).length };
}

const plural = (n: number, one: string, many: string): string => `${formatNumber(n)} ${n === 1 ? one : many}`;

/**
 * What a change does to the drawing's objects, for a card with no piece to describe (two circles,
 * a layer's contents) or whose piece's figures do not move: "2 objects added", "1 added, 3 changed".
 * Null when the card has figures to show instead.
 */
export function objectsLine(p: Proposal): string | null {
  const noPiece = p.before.params === null && p.after.params === null;
  if (!noPiece && p.changes.length > 0) return null;
  if (p.unchanged) return "Nothing in the drawing changes";
  const { added, removed, modified } = p.objects;
  const parts: [number, string][] = [
    [added, "added"],
    [removed, "removed"],
    [modified, "changed"],
  ];
  const shown = parts.filter(([n]) => n > 0);
  if (shown.length === 0) return "The objects stay; their settings change";
  if (shown.length === 1) {
    const [n, word] = shown[0] ?? [0, ""];
    return `${plural(n, "object", "objects")} ${word}`;
  }
  return shown.map(([n, word], i) => (i === 0 ? `${plural(n, "object", "objects")} ${word}` : `${formatNumber(n)} ${word}`)).join(", ");
}

/** Both sides have a piece and it differs: the card draws a still of each (two pictures of the
 *  same piece say nothing a change of two circles needs said). */
export const hasStills = (p: Proposal): boolean => p.before.params !== null && p.after.params !== null && stillKey(p.before.params) !== stillKey(p.after.params);

/** What a screen reader hears when proposals arrive. */
export function arrivalSentence(arrived: readonly Proposal[]): string {
  const [first] = arrived;
  if (first === undefined) return "";
  if (arrived.length === 1) return `Proposal to review: ${first.message || first.title}`;
  return `${formatNumber(arrived.length)} proposals to review: ${arrived.map((p) => p.title).join(", ")}`;
}

/** A piece edit's patch as a proposal's title: `{width: 2.8}` is "Width 2.8". */
export function patchTitle(patch: Readonly<Record<string, unknown>>): string {
  const parts = Object.entries(patch)
    .slice(0, 4)
    .map(([key, value]) => {
      const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      const shown = typeof value === "number" ? formatNumber(value) : typeof value === "boolean" ? (value ? "on" : "off") : typeof value === "string" ? text(value, 24) : "";
      return `${words} ${shown}`.trim();
    });
  const joined = parts.join(", ");
  return joined === "" ? "Piece edit" : joined.charAt(0).toUpperCase() + joined.slice(1);
}

// ---- the holder ----

export interface ProposalsOptions {
  execute: (command: string, params: unknown) => Envelope;
  /** Whether the engine has the proposal commands (an engine without them is never asked). */
  available?: () => boolean;
  /** An accepted proposal changed the drawing: the shell reads its surfaces again. */
  onChanged?: () => void;
  /** Proposals the holder had not seen arrived (the shell can bring the assistant's panel out). */
  onArrive?: (arrived: readonly Proposal[]) => void;
}

export function createProposals(opts: ProposalsOptions) {
  const [list, setList] = createSignal<readonly Proposal[]>([]);
  /** One sentence for a polite live region: what arrived, or what was decided. */
  const [said, setSaid] = createSignal("");
  /** The engine's refusal of an accept or a reject, by the proposal it was about. */
  const [refusals, setRefusals] = createSignal<Readonly<Record<number, string>>>({});
  /** The ids and staleness last read: a read that finds the same list changes no signal. */
  let signature = "";
  let known = new Set<number>();

  const say = (sentence: string): void => {
    // The same words twice in a row are announced again only if the region changes: clear first.
    if (said() === sentence) setSaid("");
    setSaid(sentence);
  };

  /** Read what waits again. Cheap when nothing waits; called after every change the shell sees. */
  const sync = (): void => {
    if (opts.available !== undefined && !opts.available()) return;
    const env = opts.execute("proposals", {});
    const next = env.ok ? parseProposals(env.result) : [];
    const sig = next.map((p) => `${p.id}${p.stale ? "s" : ""}`).join(",");
    if (sig === signature) return;
    signature = sig;
    const arrived = next.filter((p) => !known.has(p.id));
    known = new Set(next.map((p) => p.id));
    batch(() => {
      setList(next);
      const left = refusals();
      const kept = Object.fromEntries(Object.entries(left).filter(([id]) => known.has(Number(id))));
      if (Object.keys(kept).length !== Object.keys(left).length) setRefusals(kept);
      if (arrived.length > 0) say(arrivalSentence(arrived));
    });
    if (arrived.length > 0) opts.onArrive?.(arrived);
  };

  const refuse = (id: number, error: string): void => void setRefusals({ ...refusals(), [id]: error });
  const messageOf = (env: Envelope, fallback: string): string => (env.ok && isRecord(env.result) && typeof env.result["message"] === "string" ? text(env.result["message"]) : fallback);

  /** Make the change. Null when it went through, else the engine's refusal (also kept for the card). */
  const accept = (id: number): string | null => {
    const p = list().find((x) => x.id === id);
    const env = opts.execute("accept", { id });
    if (!env.ok) {
      refuse(id, env.error);
      sync();
      return env.error;
    }
    say(messageOf(env, `Accepted: ${p?.title ?? `proposal ${id}`}`));
    opts.onChanged?.();
    sync();
    return null;
  };

  /** Forget one proposal. The drawing is not touched. */
  const reject = (id: number): string | null => {
    const env = opts.execute("reject", { id });
    if (!env.ok) {
      refuse(id, env.error);
      sync();
      return env.error;
    }
    say(messageOf(env, "Rejected the proposal; the drawing is as it was"));
    sync();
    return null;
  };

  /** Forget every variant of one `propose`. */
  const rejectGroup = (group: number): string | null => {
    const ids = list()
      .filter((p) => p.group === group)
      .map((p) => p.id);
    let error: string | null = null;
    for (const id of ids) {
      const env = opts.execute("reject", { id });
      if (!env.ok && error === null) error = env.error;
    }
    say(ids.length === 1 ? "Rejected the proposal; the drawing is as it was" : `Rejected ${formatNumber(ids.length)} proposals; the drawing is as it was`);
    sync();
    return error;
  };

  /** Forget everything that waits (`reject {}`). */
  const rejectAll = (): string | null => {
    const env = opts.execute("reject", {});
    say(messageOf(env, env.ok ? "Rejected every proposal" : env.error));
    sync();
    return env.ok ? null : env.error;
  };

  return {
    list,
    groups: (): ProposalGroup[] => groupProposals(list()),
    said,
    refusal: (id: number): string | null => refusals()[id] ?? null,
    sync,
    accept,
    reject,
    rejectGroup,
    rejectAll,
  };
}

export type ProposalsModel = ReturnType<typeof createProposals>;

// ---- the stills ----

/** A still is drawn this many device pixels a side, and shown at most half a card wide. */
export const STILL_WIDTH = 240;
export const STILL_HEIGHT = 180;
/** The most stills kept; the oldest give their object URL back. */
const MAX_STILLS = 32;

export type StillState = { kind: "pending" } | { kind: "done"; url: string } | { kind: "failed"; message: string };

/** Draws one side's still from its piece's parameters. Swapped in tests, where there is no WebGL. */
export type ProposalStillDrawer = (params: Readonly<Record<string, unknown>>, execute: ProposalsOptions["execute"]) => Promise<{ url: string } | { message: string }>;

const sentenceOf = (message: string): string => {
  const t = message.trim();
  return t === "" ? "The picture could not be drawn." : `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}`;
};

export const drawProposalStill: ProposalStillDrawer = async (params, execute) => {
  const env = execute("piecemesh", { ...params, quality: "draft" });
  if (!env.ok) return { message: sentenceOf(`the picture could not be made: ${env.error}`) };
  const reply = parseMeshReply(env.result);
  if (!reply.ok) return { message: sentenceOf(`the picture could not be made: ${reply.error}`) };
  try {
    const blob = await renderPieceStill(reply.mesh, { view: "three-quarter", width: STILL_WIDTH, height: STILL_HEIGHT, background: null });
    return { url: URL.createObjectURL(blob) };
  } catch (e) {
    return { message: sentenceOf(e instanceof Error ? e.message : "the picture could not be drawn") };
  }
};

/** The parameters as one key, whatever order their fields came in. */
export function stillKey(params: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(params).sort();
  return JSON.stringify(keys.map((k) => [k, params[k]]));
}

export function createStillCache(execute: ProposalsOptions["execute"], draw: ProposalStillDrawer = drawProposalStill) {
  const [states, setStates] = createSignal<Readonly<Record<string, StillState>>>({});
  const order: string[] = [];
  let disposed = false;

  const put = (key: string, state: StillState): void => void setStates({ ...states(), [key]: state });

  /** Ask for a side's still: drawn once per parameters, in the renderer's one line. */
  const request = (params: Readonly<Record<string, unknown>>): void => {
    const key = stillKey(params);
    if (states()[key] !== undefined) return;
    put(key, { kind: "pending" });
    order.push(key);
    while (order.length > MAX_STILLS) {
      const old = order.shift();
      if (old === undefined) break;
      const was = states()[old];
      if (was?.kind === "done" && typeof URL !== "undefined") URL.revokeObjectURL(was.url);
      const { [old]: _gone, ...rest } = states();
      setStates(rest);
    }
    void draw(params, execute)
      .catch((e: unknown) => ({ message: sentenceOf(e instanceof Error ? e.message : "the picture could not be drawn") }))
      .then((drawn) => {
        if (disposed || states()[key] === undefined) {
          if ("url" in drawn && typeof URL !== "undefined") URL.revokeObjectURL(drawn.url);
          return;
        }
        put(key, "url" in drawn ? { kind: "done", url: drawn.url } : { kind: "failed", message: drawn.message });
      });
  };

  return {
    request,
    state: (params: Readonly<Record<string, unknown>>): StillState | undefined => states()[stillKey(params)],
    dispose: (): void => {
      disposed = true;
      for (const s of Object.values(states())) if (s.kind === "done" && typeof URL !== "undefined") URL.revokeObjectURL(s.url);
      setStates({});
    },
  };
}

export type StillCache = ReturnType<typeof createStillCache>;
