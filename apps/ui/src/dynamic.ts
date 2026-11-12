/**
 * Dynamic input's rules, with no DOM and no engine in them: the command line brought to the
 * crosshair. While a command asks for something, a small prompt beside the pointer shows what is
 * asked and takes the answer there. This module says which fields a prompt gets, where each key
 * goes, what line the command line is sent for what was typed, where the cursor is held by a
 * typed value, what the fields show while they follow the pointer, and where the box stands.
 *
 * A field that holds typed text is locked: the pointer no longer sets it. A field with no text
 * is free and shows the pointer's own value. Emptying a field (Backspace) unlocks it.
 *
 * The conventions are the drafting ones, said here once:
 *  - The decimal separator is the dot. A comma never is: it means "the next coordinate", so
 *    typing one in a distance field turns the two fields into X and Y.
 *  - At a prompt that has a point to measure from, typed X,Y is relative to that point, as
 *    dynamic input has it in a CAD program (the line sent starts with `@`); `#` first makes it
 *    absolute, and `@` says relative where it would not be. A first point is absolute.
 *  - `<` goes on to the angle, as in `5<30`.
 *  - Anything with a letter in it is a word for the command line (a keyword, a snap override, a
 *    command): it is sent as typed, alone.
 */

import { formatOrdinate, MAX_POINT_DECIMALS, type PromptState } from "./prompt";

/** A point in world or screen units, as `view.ts` writes one. */
export interface Point {
  x: number;
  y: number;
}

/**
 * What a prompt is answered with beside the pointer: nothing typed (`none`: the prompt alone),
 * a point as X and Y (`point`), a point as a distance and an angle from the last one (`polar`),
 * one number (`number`: a radius, a count), or one line of text (`text`: a keyword, a name).
 */
export type DynamicKind = "none" | "point" | "polar" | "number" | "text";

/** How a typed point is measured: from the last point (`@`), from the origin (`#`), or as the kind's default (""). */
export type DynamicPrefix = "" | "@" | "#";

/** What has been typed beside the pointer, and where the next key goes. */
export interface Draft {
  kind: DynamicKind;
  /** The field the keys go to: 0 or 1. */
  active: number;
  /** Each field's typed text; "" is a free field, which follows the pointer. */
  text: readonly [string, string];
  prefix: DynamicPrefix;
  /** A `number` field that a point answers with its distance from the base (a radius). */
  measured: boolean;
}

/** The prompt's text as the quiet label beside the pointer: no command name, no option list, no colon. */
export function dynamicLabel(state: PromptState): string {
  let text = state.prompt.trim();
  const running = state.running ?? "";
  if (running !== "" && text.toLowerCase().startsWith(`${running.toLowerCase()} `)) text = text.slice(running.length + 1);
  return text
    .replace(/\s*(?:or\s*)?\[[^\]]*\]/g, "")
    .replace(/\s*:\s*$/, "")
    .trim();
}

/**
 * Which fields a prompt gets, from what it accepts and its anchor. A prompt that takes a number
 * takes one field, even when a point would answer it too (a radius, a rotation): the number typed
 * is the number meant. One that picks objects, or takes nothing, gets a field only when it offers
 * keywords, so there is somewhere to type one. A point with nothing to measure from, and a
 * window's other corner, are X and Y; any other next point is a distance and an angle.
 */
export function dynamicKind(state: PromptState): DynamicKind {
  if (state.running === null) return "none";
  const accept = state.accept;
  const worded: DynamicKind = state.keywords.length > 0 ? "text" : "none";
  if (accept === null || accept.select) return worded;
  if (accept.number) return "number";
  if (accept.point) {
    if (state.anchor.distance) return "number";
    return state.anchor.base === null || state.anchor.corner ? "point" : "polar";
  }
  return accept.text ? "text" : worded;
}

const NUMBER_NAMES: readonly (readonly [string, string])[] = [
  ["radius", "Radius"],
  ["diameter", "Diameter"],
  ["angle", "Angle"],
  ["height", "Height"],
  ["width", "Width"],
  ["length", "Length"],
  ["distance", "Distance"],
  ["scale", "Scale"],
];

/** The accessible names of a prompt's fields, in their Tab order. */
export function fieldNames(kind: DynamicKind, state: PromptState): readonly string[] {
  if (kind === "point") return ["X", "Y"];
  if (kind === "polar") return ["Distance", "Angle"];
  if (kind === "text") return [state.keywords.length > 0 ? "Option" : "Text"];
  if (kind === "none") return [];
  const label = dynamicLabel(state).toLowerCase();
  return [NUMBER_NAMES.find(([word]) => label.includes(word))?.[1] ?? (state.anchor.distance ? "Distance" : "Value")];
}

/** How many fields a kind has. */
export function fieldCount(kind: DynamicKind): number {
  return kind === "none" ? 0 : kind === "point" || kind === "polar" ? 2 : 1;
}

/** The draft a prompt starts with: nothing typed, the first field active. */
export function draftFor(state: PromptState): Draft {
  const kind = dynamicKind(state);
  return {
    kind,
    active: 0,
    text: ["", ""],
    prefix: kind === "point" && state.anchor.base !== null ? "@" : "",
    measured: kind === "number" && state.anchor.distance && state.anchor.base !== null,
  };
}

/**
 * Whether a field's text is a word for the command line, and not a number being typed: it has a
 * letter in it, or a mark that only a whole line carries (a pasted `@1,2`: typed, those keys
 * move between the fields and never land in one).
 */
export function isWord(text: string): boolean {
  return /[A-Za-z_!(*,<@#]/.test(text);
}

/** The word the draft holds, if its active field holds one. */
function wordOf(draft: Draft): string | null {
  const text = draft.text[draft.active] ?? "";
  return draft.kind !== "text" && isWord(text) ? text : null;
}

/** Whether anything is typed: a field is locked. */
export function hasTyped(draft: Draft): boolean {
  return draft.text[0] !== "" || draft.text[1] !== "";
}

/** Whether a field is locked: it holds typed text, so the pointer does not set it. */
export function isLocked(draft: Draft, index: number): boolean {
  return (draft.text[index] ?? "") !== "";
}

/** The draft with the active field's text replaced (what the field reports as it is edited). */
export function editDraft(draft: Draft, text: string): Draft {
  const next: [string, string] = [draft.text[0], draft.text[1]];
  next[draft.active === 1 ? 1 : 0] = text;
  return { ...draft, text: next };
}

/** The draft with another field active; the Tab order runs through the fields and round again. */
export function stepField(draft: Draft, back = false): Draft {
  const count = fieldCount(draft.kind);
  if (count < 2) return draft;
  return { ...draft, active: (draft.active + (back ? count - 1 : 1)) % count };
}

/** What a key does beside the pointer. */
export type KeyAction =
  /** The character goes into the active field (the field's own editing takes it). */
  | { kind: "type" }
  /** The draft changes and the key is used up. */
  | { kind: "draft"; draft: Draft }
  /** The line is sent (Enter, and Space where the command line reads it as Enter). */
  | { kind: "submit" }
  /** Typed text is dropped; the command keeps running. */
  | { kind: "clear" }
  /** The prompt's options are listed. */
  | { kind: "options" }
  /** The key is not dynamic input's: the shell has it (an empty Enter, the Escape that cancels). */
  | { kind: "pass" };

/**
 * Where a key goes. `fresh` is the draft the prompt starts with (`draftFor`): Backspace in an
 * empty first field goes back to it. Keys held with Ctrl, Alt or Meta are never asked about.
 */
export function routeKey(draft: Draft, key: string, shift: boolean, fresh: Draft): KeyAction {
  const count = fieldCount(draft.kind);
  const typed = hasTyped(draft) || draft.prefix !== fresh.prefix || draft.kind !== fresh.kind;
  if (key === "Enter") return typed ? { kind: "submit" } : { kind: "pass" };
  if (key === "Escape") return typed ? { kind: "clear" } : { kind: "pass" };
  if (key === "ArrowDown") return { kind: "options" };
  if (key === "Tab") return count < 2 ? { kind: "pass" } : { kind: "draft", draft: stepField(draft, shift) };
  if (count === 0) return { kind: "pass" };
  const text = draft.text[draft.active] ?? "";
  if (key === "Backspace") {
    if (text !== "") return { kind: "type" };
    if (draft.active === 1) return { kind: "draft", draft: { ...draft, active: 0 } };
    return { kind: "draft", draft: { ...fresh, text: draft.text } };
  }
  if (key.length !== 1) return { kind: "pass" };
  if (key === " ") {
    if (draft.kind === "text" && text !== "") return { kind: "type" };
    return typed ? { kind: "submit" } : { kind: "pass" };
  }
  // A word being typed, and a line of text, take every character as it is.
  if (draft.kind === "text" || isWord(text)) return { kind: "type" };
  if (key === ",") {
    if (draft.kind === "number") return { kind: "draft", draft };
    if (draft.kind === "polar") return { kind: "draft", draft: { ...draft, kind: "point", active: 1, prefix: draft.prefix === "" ? "@" : draft.prefix } };
    return { kind: "draft", draft: { ...draft, active: 1 } };
  }
  if (key === "<") {
    if (draft.kind === "number") return { kind: "draft", draft };
    return { kind: "draft", draft: { ...draft, kind: "polar", active: 1 } };
  }
  if ((key === "@" || key === "#") && draft.kind !== "number" && draft.active === 0 && text === "") {
    return { kind: "draft", draft: { ...draft, prefix: key } };
  }
  return { kind: "type" };
}

/** Where the pointer is, as the engine resolved it, and the point the prompt measures from. */
export interface Aim {
  point: Point;
  base: Point | null;
}

const ORIGIN: Point = { x: 0, y: 0 };

/** A typed number as a number; null for text that is not one (a word, feet and inches). */
function numberOf(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** A direction in degrees counterclockwise from +X, 0 up to 360. */
export function degreesOf(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  const turned = degrees < 0 ? degrees + 360 : degrees;
  return turned >= 360 ? 0 : turned;
}

function unitOf(degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/** What a polar draft measures from: the base for the relative form, the origin for `#`. */
function polarFrom(draft: Draft, aim: Aim): Point | null {
  return draft.prefix === "#" ? ORIGIN : aim.base;
}

/** What a typed X or Y is measured from. */
function pointFrom(draft: Draft, aim: Aim | null): Point | null {
  return draft.prefix === "@" ? (aim?.base ?? null) : ORIGIN;
}

/** How far along a typed direction the pointer is: its shadow on the ray, never behind the base. */
function along(from: Point, to: Point, degrees: number | null): number {
  if (degrees === null) return Math.hypot(to.x - from.x, to.y - from.y);
  const unit = unitOf(degrees);
  return Math.max(0, (to.x - from.x) * unit.x + (to.y - from.y) * unit.y);
}

const full = (value: number): string | null => formatOrdinate(value, MAX_POINT_DECIMALS);

/**
 * The line the command line is sent for the draft, written as the engine reads typed input.
 * A free field takes the pointer's value from `aim`, so the line is the point the rubber band
 * shows: a locked distance with a free angle is the polar form with the pointer's direction
 * (`@5<<30`: `<<` is the engine's "degrees counterclockwise from +X whatever the drawing's angle
 * settings", which is how the pointer's direction is measured); a locked angle takes the
 * pointer's distance along it; one typed ordinate takes the other from the pointer. Both typed
 * is the text as typed (`@5<30`, `@3,4`, `3,4`). With no pointer to read, a lone distance is sent
 * alone (the engine's direct distance entry, along its own cursor); any other half-typed point
 * cannot be said, and is null. Nothing typed is "".
 */
export function lineFor(draft: Draft, aim: Aim | null): string | null {
  const word = wordOf(draft);
  if (word !== null) return word;
  const [a, b] = draft.text;
  if (draft.kind === "none" || (a === "" && b === "")) return "";
  if (draft.kind === "text" || draft.kind === "number") return a;
  if (draft.kind === "point") {
    const from = pointFrom(draft, aim);
    const free = (axis: "x" | "y"): string | null => (aim === null || from === null ? null : full(aim.point[axis] - from[axis]));
    const x = a !== "" ? a : free("x");
    const y = b !== "" ? b : free("y");
    return x === null || y === null ? null : `${draft.prefix}${x},${y}`;
  }
  const prefix = draft.prefix === "" ? "@" : draft.prefix;
  if (a !== "" && b !== "") return `${prefix}${a}<${b}`;
  const from = aim === null ? null : polarFrom(draft, aim);
  if (a !== "") {
    if (aim === null || from === null) return draft.prefix === "" ? a : null;
    const degrees = full(degreesOf(aim.point.x - from.x, aim.point.y - from.y));
    return degrees === null ? null : `${prefix}${a}<<${degrees}`;
  }
  if (aim === null || from === null) return null;
  const distance = full(along(from, aim.point, numberOf(b)));
  return distance === null ? null : `${prefix}${distance}<${b}`;
}

/**
 * What the command line's own field shows while the draft is typed: the typed part alone, in
 * the command line's syntax, with nothing read from the pointer (`5`, `@5<30`, `@3,`, `c`).
 */
export function echoFor(draft: Draft): string {
  const word = wordOf(draft);
  if (word !== null) return word;
  const [a, b] = draft.text;
  if (draft.kind === "none") return "";
  if (draft.kind === "text" || draft.kind === "number") return a;
  if (a === "" && b === "") return "";
  const second = b !== "" || draft.active === 1;
  if (draft.kind === "point") return `${draft.prefix}${a}${second ? `,${b}` : ""}`;
  if (!second) return `${draft.prefix}${a}`;
  return `${draft.prefix === "" ? "@" : draft.prefix}${a}<${b}`;
}

/**
 * The cursor point with the typed values held: where the rubber band is drawn to and what a
 * click takes. `aim` is the pointer as the engine resolved it, so snap, ortho and polar have
 * already bent the free part (the direction of a locked distance, the free ordinate). Null when
 * nothing is locked, or what is typed is not a number that places a point (a word, an angle the
 * drawing counts in other units).
 */
export function constrain(draft: Draft, aim: Aim): Point | null {
  if (wordOf(draft) !== null) return null;
  const a = numberOf(draft.text[0]);
  const b = numberOf(draft.text[1]);
  let held: Point | null = null;
  if (draft.kind === "number") {
    if (!draft.measured || aim.base === null || a === null) return null;
    const unit = unitOf(degreesOf(aim.point.x - aim.base.x, aim.point.y - aim.base.y));
    held = { x: aim.base.x + unit.x * a, y: aim.base.y + unit.y * a };
  } else if (draft.kind === "polar") {
    const from = polarFrom(draft, aim);
    if (from === null || (a === null && b === null)) return null;
    const unit = unitOf(b ?? degreesOf(aim.point.x - from.x, aim.point.y - from.y));
    const distance = a ?? along(from, aim.point, b);
    held = { x: from.x + unit.x * distance, y: from.y + unit.y * distance };
  } else if (draft.kind === "point") {
    const from = pointFrom(draft, aim);
    if (from === null || (a === null && b === null)) return null;
    held = { x: a === null ? aim.point.x : from.x + a, y: b === null ? aim.point.y : from.y + b };
  }
  return held !== null && Number.isFinite(held.x) && Number.isFinite(held.y) ? held : null;
}

/** The decimals a length is shown with while it follows the pointer (the drawing's default precision). */
export const LIVE_LENGTH_DECIMALS = 4;
/** The decimals an angle is shown with while it follows the pointer. */
export const LIVE_ANGLE_DECIMALS = 2;

const NO_LIVE: readonly [string, string] = ["", ""];

/**
 * What the free fields show: the pointer's own values, at a fixed number of decimals so the
 * figures do not change width as it moves. "" where there is nothing to show (no pointer, a
 * plain number, text).
 */
export function liveValues(draft: Draft, aim: Aim | null): readonly [string, string] {
  if (aim === null) return NO_LIVE;
  const length = (value: number): string => (Number.isFinite(value) ? value.toFixed(LIVE_LENGTH_DECIMALS).replace(/^-(0\.0+)$/, "$1") : "");
  if (draft.kind === "point") {
    const from = pointFrom(draft, aim);
    return from === null ? NO_LIVE : [length(aim.point.x - from.x), length(aim.point.y - from.y)];
  }
  if (draft.kind === "polar") {
    const from = polarFrom(draft, aim);
    if (from === null) return NO_LIVE;
    const dx = aim.point.x - from.x;
    const dy = aim.point.y - from.y;
    const degrees = degreesOf(dx, dy).toFixed(LIVE_ANGLE_DECIMALS);
    return [length(Math.hypot(dx, dy)), `${degrees === (360).toFixed(LIVE_ANGLE_DECIMALS) ? (0).toFixed(LIVE_ANGLE_DECIMALS) : degrees}°`];
  }
  if (draft.kind === "number" && draft.measured && aim.base !== null) return [length(Math.hypot(aim.point.x - aim.base.x, aim.point.y - aim.base.y)), ""];
  return NO_LIVE;
}

/** A box on the canvas, in its CSS px. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far from the pointer the box stands, both ways (CSS px): clear of the crosshair and the pick box. */
export const DYNAMIC_GAP = 18;

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Whether the segment from `a` to `b` crosses a box (Liang and Barsky's clip). */
function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, a.x - box.x],
    [dx, box.x + box.w - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.h - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Where the box stands beside the pointer: its top left corner, in the canvas's CSS px. Below
 * and to the right by default, as a hint beside a pointer is. Of the four corners around the
 * pointer it takes the first that fits the canvas, is off the rubber band (the segment to
 * `toward`, where the band comes from) and off `avoid` (the snap label's box, which the canvas
 * has already placed); a corner that fails one of these is taken only when every corner fails
 * more. The box is then held inside the canvas.
 */
export function placeBeside(at: Point, box: { w: number; h: number }, canvas: { w: number; h: number }, toward: Point | null, avoid: Box | null, gap: number = DYNAMIC_GAP): Point {
  const corners: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  let best: Point = { x: at.x + gap, y: at.y + gap };
  let least = Number.POSITIVE_INFINITY;
  corners.forEach(([sx, sy], order) => {
    const spot: Box = { x: sx > 0 ? at.x + gap : at.x - gap - box.w, y: sy > 0 ? at.y + gap : at.y - gap - box.h, w: box.w, h: box.h };
    const over = Math.max(0, -spot.x) + Math.max(0, spot.x + spot.w - canvas.w) + Math.max(0, -spot.y) + Math.max(0, spot.y + spot.h - canvas.h);
    let cost = order + (over > 0 ? 1000 + over : 0);
    if (toward !== null && segmentHitsBox(at, toward, spot)) cost += 100;
    if (avoid !== null && boxesOverlap(spot, avoid)) cost += 200;
    if (cost < least) {
      least = cost;
      best = { x: spot.x, y: spot.y };
    }
  });
  return { x: Math.max(0, Math.min(best.x, canvas.w - box.w)), y: Math.max(0, Math.min(best.y, canvas.h - box.h)) };
}
