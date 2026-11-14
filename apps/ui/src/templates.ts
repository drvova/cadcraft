/**
 * The "Start from a template" gallery's logic: the list of preset pieces (a const data table), the
 * thumbnail render state machine, turning a template into the parameters the engine's `piece`
 * command takes, grouping the list by kind, and the words a card shows when the engine cannot build
 * or preview a template. `components/TemplateGallery.tsx` draws it; nothing here touches the DOM.
 *
 * A template is only data — a named set of `piece` parameters. The engine (`crates/engine/src/cmd/
 * jewelry/piece.rs`, `docs/jewelry.md` "A parametric piece") builds a band, a solitaire or an
 * eternity band from them. A template may also name a kind or a profile a running engine does not
 * have yet (another agent is adding `threestone`, bezel heads and band profiles like `court`): its
 * `requires` marks it, so that when the engine refuses the build or the preview the card says "needs
 * a newer engine" rather than showing a raw error. The list stays a plain exported array so it is
 * easy to extend.
 */

import { isUnknownCommand, refusalWords } from "./piece";

/** The parameters sent to the engine's `piece` command; `kind` plus a handful of numbers and names. */
export type TemplateParams = Readonly<Record<string, unknown>>;

export interface Template {
  /** Unique id, lower case with hyphens. */
  id: string;
  /** The card's name, a few words. */
  name: string;
  /** One short sentence under the name. */
  blurb: string;
  /** The full `piece` parameter set this template builds. */
  params: TemplateParams;
  /**
   * A feature the running engine may not have yet (a kind, a head, a profile). When it is set and
   * the engine refuses the build or the preview, the card says the engine is too old for it instead
   * of showing the engine's words. Left out for templates every current engine builds.
   */
  requires?: string;
}

/** The piece kinds the engine builds today; a template on another kind carries `requires`. */
export const BUILDABLE_KINDS: readonly string[] = ["band", "solitaire", "eternity", "halfeternity", "dome", "signet"];

/**
 * The preset pieces, in the order the gallery reads them: the solitaires, the bands, the eternity
 * band, then the ones a newer engine adds. Each `params` is a full, valid-looking `piece` parameter
 * object. Changing this table changes the gallery; no behaviour lives here.
 */
export const TEMPLATES: readonly Template[] = [
  {
    id: "solitaire-round",
    name: "Round Solitaire",
    blurb: "A round brilliant held high in six prongs on a slim band.",
    params: { kind: "solitaire", cut: "round", stone: "diamond", stoneWidth: 6.5, stoneLength: 6.5, prongs: 6, wall: 1.8, width: 2.2, profile: "flat", metal: "gold18" },
  },
  {
    id: "halo-solitaire",
    name: "Halo Solitaire",
    blurb: "A round centre stone ringed with pavé melee.",
    params: { kind: "solitaire", cut: "round", stone: "diamond", stoneWidth: 6.5, stoneLength: 6.5, prongs: 6, halo: 1.3, gap: 0.15, wall: 1.8, width: 2.0, profile: "flat", metal: "gold18" },
  },
  {
    id: "three-stone",
    name: "Three-Stone",
    blurb: "A centre stone flanked by two — past, present and future.",
    params: { kind: "threestone", cut: "round", stone: "diamond", stoneWidth: 5, stoneLength: 5, prongs: 4, wall: 1.8, width: 2.2, profile: "flat", metal: "gold18" },
    requires: "the three-stone setting",
  },
  {
    id: "bezel-solitaire",
    name: "Bezel Solitaire",
    blurb: "A round stone in a smooth metal collar: nothing to snag.",
    params: { kind: "solitaire", head: "bezel", cut: "round", stone: "diamond", stoneWidth: 6.5, stoneLength: 6.5, wall: 1.8, width: 2.4, profile: "flat", metal: "gold18" },
  },
  {
    id: "bezel-three-stone",
    name: "Bezel Three-Stone",
    blurb: "Three stones, each in its own bezel, in platinum.",
    params: { kind: "threestone", head: "bezel", cut: "round", stone: "diamond", stoneWidth: 5, stoneLength: 5, wall: 1.8, width: 2.4, profile: "flat", metal: "platinum" },
    requires: "the three-stone setting",
  },
  {
    id: "plain-band",
    name: "Plain Band",
    blurb: "A simple flat band in 18k gold.",
    params: { kind: "band", wall: 1.5, width: 2, profile: "flat", metal: "gold18" },
  },
  {
    id: "voronoi-band",
    name: "Voronoi Band",
    blurb: "A wide band pierced into organic cells, seeded so Shuffle lays it anew.",
    params: { kind: "band", wall: 1.6, width: 6, profile: "flat", metal: "gold18", pattern: { voronoi: { cells: 24, seed: 1, jitter: 0.8, wall: 0.8 } } },
    requires: "pattern",
  },
  {
    id: "honeycomb-band",
    name: "Honeycomb Band",
    blurb: "A wide band pierced into a lattice of hexagons.",
    params: { kind: "band", wall: 1.6, width: 6, profile: "flat", metal: "gold18", pattern: { hex: { size: 2.4, wall: 0.7 } } },
    requires: "pattern",
  },
  {
    id: "comfort-band",
    name: "Comfort-Fit Band",
    blurb: "A domed wedding band, rounded for everyday wear.",
    params: { kind: "band", wall: 1.8, width: 4, profile: "dome", metal: "gold18" },
  },
  {
    id: "court-band",
    name: "Court Band",
    blurb: "A court profile, gently curved inside and out.",
    params: { kind: "band", wall: 2, width: 4, profile: "court", metal: "gold18" },
    requires: "the court profile",
  },
  {
    id: "eternity-band",
    name: "Eternity Band",
    blurb: "Round diamonds set all the way around, in platinum.",
    params: { kind: "eternity", cut: "round", stone: "diamond", melee: 1.8, count: null, gap: 0.2, wall: 1.8, width: 2.4, profile: "flat", metal: "platinum" },
  },
  {
    id: "half-eternity",
    name: "Half Eternity",
    blurb: "Diamonds across the top half; the plain bottom can be resized.",
    params: { kind: "halfeternity", cut: "round", stone: "diamond", melee: 2.0, count: null, gap: 0.2, wall: 1.8, width: 2.6, profile: "flat", metal: "gold18" },
  },
  {
    id: "dome-ring",
    name: "Dome Ring",
    blurb: "A bold dome, wide and high on top, tapering to a slim shank.",
    params: { kind: "dome", wall: 1.6, width: 2.5, topWidth: 9, topWall: 3.2, profile: "dome", metal: "gold18" },
  },
  {
    id: "signet-oval",
    name: "Oval Signet",
    blurb: "A flat oval face for engraving over a tapered shank.",
    params: { kind: "signet", face: "oval", faceLength: 12, faceWidth: 10, wall: 1.6, width: 3, profile: "comfort", metal: "gold18" },
  },
  {
    id: "signet-cushion",
    name: "Cushion Signet",
    blurb: "A square-cushion face in platinum, for a crest or initials.",
    params: { kind: "signet", face: "cushion", faceLength: 11, faceWidth: 11, wall: 1.7, width: 3, profile: "comfort", metal: "platinum" },
  },
  {
    id: "signet-band",
    name: "Wide Signet Band",
    blurb: "A broad flat band with a bold face to engrave.",
    params: { kind: "band", wall: 1.6, width: 9, profile: "flat", metal: "gold14" },
  },
];

/** The parameters a template sends to `piece`, as a fresh object (never the shared literal). */
export function templateParams(template: Template): Record<string, unknown> {
  return { ...template.params };
}

/** The kind a template builds, as a plain string ("band" when it names none). */
export function templateKind(template: Template): string {
  const kind = template.params["kind"];
  return typeof kind === "string" ? kind : "band";
}

// ---------------------------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------------------------

export interface TemplateGroup {
  kind: string;
  label: string;
  templates: Template[];
}

/** The heading a group of a kind reads. */
const GROUP_LABELS: Readonly<Record<string, string>> = {
  solitaire: "Solitaires",
  band: "Bands",
  eternity: "Eternity",
  halfeternity: "Half eternity",
  dome: "Dome rings",
  signet: "Signets",
};

const GROUP_ORDER: readonly string[] = ["solitaire", "band", "eternity", "halfeternity", "dome", "signet"];

/** A group heading for a kind the table knows, else the kind with a capital and an "s". */
function groupLabel(kind: string): string {
  return GROUP_LABELS[kind] ?? (kind === "" ? "Other" : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}s`);
}

/**
 * The templates grouped by kind, the known kinds first in `GROUP_ORDER`, then any others in the
 * order they first appear. Every template lands in exactly one group, and empty groups are dropped.
 */
export function groupTemplates(templates: readonly Template[]): TemplateGroup[] {
  const byKind = new Map<string, Template[]>();
  const order: string[] = [];
  for (const template of templates) {
    const kind = templateKind(template);
    let list = byKind.get(kind);
    if (list === undefined) {
      list = [];
      byKind.set(kind, list);
      order.push(kind);
    }
    list.push(template);
  }
  const kinds = [...GROUP_ORDER.filter((k) => byKind.has(k)), ...order.filter((k) => !GROUP_ORDER.includes(k))];
  return kinds.map((kind) => ({ kind, label: groupLabel(kind), templates: byKind.get(kind) ?? [] }));
}

// ---------------------------------------------------------------------------------------------
// The thumbnail state machine
// ---------------------------------------------------------------------------------------------

/** The size a thumbnail is rendered at, in device pixels (capped by `renderPieceStill`). */
export const THUMB_WIDTH = 320;
export const THUMB_HEIGHT = 240;

export type ThumbPhase = "idle" | "rendering" | "done" | "failed";

export interface Thumb {
  phase: ThumbPhase;
  /** A blob URL when the phase is `done`; null otherwise. */
  url: string | null;
  /** The card's note when the phase is `failed`; null otherwise. */
  message: string | null;
}

export type ThumbMap = Readonly<Record<string, Thumb>>;

const IDLE: Thumb = { phase: "idle", url: null, message: null };

/** Every template's thumbnail idle, waiting to be drawn. */
export function initialThumbs(templates: readonly Template[]): ThumbMap {
  const out: Record<string, Thumb> = {};
  for (const template of templates) out[template.id] = IDLE;
  return out;
}

/**
 * The next template whose thumbnail should be drawn, or null when there is none to start. Only one
 * is drawn at a time (the renderer keeps a single off-screen context in a queue), so while one is
 * `rendering` this answers null; otherwise it is the first `idle` template in the list's order.
 */
export function nextThumb(thumbs: ThumbMap, templates: readonly Template[]): string | null {
  if (templates.some((t) => thumbs[t.id]?.phase === "rendering")) return null;
  return templates.find((t) => (thumbs[t.id]?.phase ?? "idle") === "idle")?.id ?? null;
}

const withPhase = (thumbs: ThumbMap, id: string, thumb: Thumb): ThumbMap => ({ ...thumbs, [id]: thumb });

export function markRendering(thumbs: ThumbMap, id: string): ThumbMap {
  return withPhase(thumbs, id, { phase: "rendering", url: null, message: null });
}

export function markDone(thumbs: ThumbMap, id: string, url: string): ThumbMap {
  return withPhase(thumbs, id, { phase: "done", url, message: null });
}

export function markFailed(thumbs: ThumbMap, id: string, message: string): ThumbMap {
  return withPhase(thumbs, id, { phase: "failed", url: null, message });
}

// ---------------------------------------------------------------------------------------------
// The engine's refusal, in a jeweler's words
// ---------------------------------------------------------------------------------------------

/**
 * The "needs a newer engine" line for a template that names a feature the engine may not have,
 * when the engine refused it; null for a template that every current engine builds, or an empty
 * refusal. It does not look at the words of the refusal: a template that carries `requires` and is
 * refused is, by construction, hitting the feature it names.
 */
export function featureGapMessage(template: Template, error: string): string | null {
  if (template.requires === undefined || typeof error !== "string" || error.trim() === "") return null;
  return `Needs a newer engine for ${template.requires}.`;
}

/**
 * The note a card shows when the engine refuses to build a template: the "needs a newer engine"
 * line when the template names a missing feature, else the engine's own words.
 */
export function chooseMessage(template: Template, error: string): string {
  return featureGapMessage(template, error) ?? (refusalWords(error) || "This template could not be built.");
}

/**
 * The note a card shows when a thumbnail cannot be drawn: the whole engine lacking `piecemesh`
 * reads one way for every card, a missing feature another, and anything else is the engine's words.
 */
export function thumbMessage(template: Template, error: string): string {
  if (isUnknownCommand(error)) return "3D preview is not available in this build.";
  return featureGapMessage(template, error) ?? (refusalWords(error) || "The preview could not be drawn.");
}
