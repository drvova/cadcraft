/**
 * The Drafting Settings dialog as the Slab body takes it (`slab/drafting.slab`): typed scalar and
 * list params, nothing else. What is asked, typed and refused is `../drafting`'s and
 * `../drafting-edit`'s; this file shapes it and reads a signal's item key back to the part of the
 * form it names.
 */

import { SNAP_MARKER_HALF, snapGlyph, type SnapShape } from "../canvas";
import { OSNAP_MODES, POLAR_ANGLES, POLAR_CUSTOM, type DraftingErrors, type DraftingField, type DraftingForm, type DraftingState, type DraftingTab, type DraftingVar } from "../drafting";
import { paramText } from "./bench-params";
import { sentenceText } from "./piece-params";
import type { PopupOption } from "./popup";
import type { FormNoteParam } from "./pricebook-params";

/** A tab of the strip: a `PageTab` of the document. */
export interface PageTabParam {
  key: DraftingTab;
  name: string;
  on: boolean;
}

/** One line of a page: a `SetLine` of the document. Exactly one of the kinds is true. */
export interface SetLineParam {
  key: string;
  name: string;
  /** The value as it reads. */
  shown: string;
  /** A choice or a read value as a screen reader is told it ("Increment angle: 45°"). */
  said: string;
  /** The refusal standing on it; "" when there is none. */
  hint: string;
  /** The sentence under a wide field. */
  help: string;
  ticked: "true" | "false";
  /** The room over the line: 0 at the head of a page, 16 at the head of a group, 8 inside one. */
  lead: number;
  tick: boolean;
  typed: boolean;
  wide: boolean;
  choice: boolean;
  read: boolean;
  note: boolean;
  on: boolean;
  open: boolean;
  bad: boolean;
  helped: boolean;
}

/** One running snap: a `SnapBox` of the document. */
export interface SnapBoxParam {
  key: string;
  name: string;
  ticked: "true" | "false";
  on: boolean;
  /** The marker's strokes as path data, in the box the document draws it in. */
  glyph: string;
}

export interface DraftingParams {
  alerts: FormNoteParam[];
  tabs: PageTabParam[];
  page_name: string;
  lines: SetLineParam[];
  osnap: boolean;
  two: boolean;
  modes_a: SnapBoxParam[];
  modes_b: SnapBoxParam[];
  modes_hint: string;
  modes_bad: boolean;
}

export const DRAFTING_SCALARS = ["page_name", "osnap", "two", "modes_hint", "modes_bad"] as const;
export const DRAFTING_LISTS = ["alerts", "tabs", "lines", "modes_a", "modes_b"] as const;
export const DRAFTING_SIGNALS = ["tab_pick", "tab_prev", "tab_next", "tab_first", "tab_last", "line_tick", "line_choose", "line_submit", "field_edit", "field_submit", "mode_tick", "modes_all", "modes_none"] as const;

/** The pages, in the strip's order. */
export const DRAFTING_TABS: readonly { id: DraftingTab; label: string }[] = [
  { id: "snap-grid", label: "Snap and Grid" },
  { id: "polar", label: "Polar Tracking" },
  { id: "osnap", label: "Object Snap" },
];

/** The body's width under which the snap boxes stand in one column (two columns of 24ch, as `.drafting-modes`). */
export const TWO_COLUMNS_FROM = 362;

/** The tab a key of the strip leads to from `at`; the strip does not wrap at its ends going by Home and End, and wraps by the arrows (as `rovingIndex`). */
export function tabAfter(at: DraftingTab, signal: string): DraftingTab {
  const index = DRAFTING_TABS.findIndex((tab) => tab.id === at);
  const count = DRAFTING_TABS.length;
  const next = signal === "tab_first" ? 0 : signal === "tab_last" ? count - 1 : signal === "tab_next" ? (index + 1) % count : signal === "tab_prev" ? (index - 1 + count) % count : index;
  return DRAFTING_TABS[next]?.id ?? at;
}

/** Whether a text is one of the pages. */
export function isDraftingTab(value: string): value is DraftingTab {
  return DRAFTING_TABS.some((tab) => tab.id === value);
}

// ---------------------------------------------------------------------------------------------
// The lines
// ---------------------------------------------------------------------------------------------

/** The ticks of the form, by line key. */
const TICKS = { "snap-on": "snapOn", "grid-on": "gridOn", "polar-on": "polarOn", "additional-on": "additionalOn", "osnap-on": "osnapOn", "otrack-on": "otrackOn" } as const satisfies Record<string, keyof DraftingForm>;
/** The typed values of the form, by line key, and the field a refusal on each is filed under. */
const TYPED = {
  "snap-x": { form: "snapX", marks: "snapX" },
  "snap-y": { form: "snapY", marks: "snapY" },
  "grid-x": { form: "gridX", marks: "gridX" },
  "grid-y": { form: "gridY", marks: "gridY" },
  "polar-custom": { form: "polarCustom", marks: "polarAngle" },
  "additional-angles": { form: "additionalAngles", marks: "additionalAngles" },
} as const satisfies Record<string, { form: keyof DraftingForm; marks: DraftingField }>;

export type TickKey = keyof typeof TICKS;
export type TypedKey = keyof typeof TYPED;

/** The key of the increment angle's line. */
export const POLAR_CHOICE_LINE = "polar-choice";

/** The tick of the form a line's key names; null when it names none. */
export function tickField(item: string): (typeof TICKS)[TickKey] | null {
  return Object.hasOwn(TICKS, item) ? TICKS[item as TickKey] : null;
}

/** The typed value of the form a line's key names, and the field its refusal is filed under; null when it names none. */
export function typedField(item: string): (typeof TYPED)[TypedKey] | null {
  return Object.hasOwn(TYPED, item) ? TYPED[item as TypedKey] : null;
}

/** The line a refusal's field is shown on (where the keyboard is put), on the page that field is on. */
export function lineOfField(field: DraftingField, form: DraftingForm): string | null {
  if (field === "modes") return null;
  if (field === "polarAngle") return form.polarChoice === POLAR_CUSTOM ? "polar-custom" : POLAR_CHOICE_LINE;
  for (const [key, name] of Object.entries(TICKS)) if (name === field) return key;
  for (const [key, entry] of Object.entries(TYPED)) if (entry.marks === field) return key;
  return null;
}

/** The increment angle's values, for the popup. */
export const ANGLE_OPTIONS: readonly PopupOption[] = [...POLAR_ANGLES.map((angle) => ({ value: angle, label: `${angle}°` })), { value: POLAR_CUSTOM, label: "Custom" }];

const angleLabel = (choice: string): string => ANGLE_OPTIONS.find((option) => option.value === choice)?.label ?? choice;

const BLANK: Omit<SetLineParam, "key" | "name" | "lead"> = { shown: "", said: "", hint: "", help: "", ticked: "false", tick: false, typed: false, wide: false, choice: false, read: false, note: false, on: false, open: false, bad: false, helped: false };

/** What a page's lines are built from. */
export interface LinesInput {
  tab: DraftingTab;
  form: DraftingForm;
  errors: DraftingErrors;
  state: Pick<DraftingState, "missing" | "unusable">;
  /** The increment angle's popup is open. */
  choiceOpen: boolean;
}

/** The lines of the page in front, in order. */
export function draftingLines(input: LinesInput): SetLineParam[] {
  const { form, errors, state } = input;
  const out: SetLineParam[] = [];
  const lead = (group: boolean): number => (out.length === 0 ? 0 : group ? 16 : 8);
  const refusal = (field: DraftingField): Pick<SetLineParam, "hint" | "bad"> => {
    const words = errors[field];
    return { hint: words === undefined ? "" : sentenceText(words), bad: words !== undefined };
  };
  const missing = (name: DraftingVar): boolean => state.missing.includes(name);

  const read = (key: string, name: string, shown: string, group: boolean): void => {
    out.push({ ...BLANK, key, name, lead: lead(group), read: true, shown: paramText(shown), said: `${name}: ${paramText(shown)}` });
  };
  const tick = (key: TickKey, name: string, group: boolean, locked = false): void => {
    const on = form[TICKS[key]];
    if (locked) return read(key, name, on ? "On" : "Off", group);
    out.push({ ...BLANK, key, name, lead: lead(group), tick: true, on, ticked: on ? "true" : "false", ...refusal(TICKS[key]) });
  };
  const typed = (key: TypedKey, name: string, locked: boolean): void => {
    const value = form[TYPED[key].form];
    if (locked) return read(key, name, value, false);
    out.push({ ...BLANK, key, name, lead: lead(false), typed: true, shown: paramText(value), ...refusal(TYPED[key].marks) });
  };
  const notes = (name: DraftingVar, what: string): void => {
    if (missing(name)) out.push({ ...BLANK, key: `missing-${name.toLowerCase()}`, name: `The engine did not report ${what}, so it cannot be changed here.`, lead: lead(false), note: true });
    if (state.unusable.includes(name)) out.push({ ...BLANK, key: `unusable-${name.toLowerCase()}`, name: `The engine reported ${what} that cannot be used. The default is shown, and OK sets it.`, lead: lead(false), note: true });
  };

  if (input.tab === "snap-grid") {
    tick("snap-on", "Snap on", true);
    typed("snap-x", "Snap X spacing", missing("SNAPUNIT"));
    typed("snap-y", "Snap Y spacing", missing("SNAPUNIT"));
    notes("SNAPUNIT", "a snap spacing");
    tick("grid-on", "Grid on", true);
    typed("grid-x", "Grid X spacing", missing("GRIDUNIT"));
    typed("grid-y", "Grid Y spacing", missing("GRIDUNIT"));
    notes("GRIDUNIT", "a grid spacing");
  } else if (input.tab === "polar") {
    tick("polar-on", "Polar tracking on", true);
    const custom = form.polarChoice === POLAR_CUSTOM;
    const shown = angleLabel(form.polarChoice);
    if (missing("POLARANG")) read(POLAR_CHOICE_LINE, "Increment angle", shown, false);
    else out.push({ ...BLANK, key: POLAR_CHOICE_LINE, name: "Increment angle", lead: lead(false), choice: true, shown, said: `Increment angle: ${shown}`, open: input.choiceOpen, ...(custom ? {} : refusal("polarAngle")) });
    if (custom) typed("polar-custom", "Custom angle, in degrees", missing("POLARANG"));
    notes("POLARANG", "an increment angle");
    tick("additional-on", "Track additional angles", true, missing("POLARMODE"));
    if (missing("POLARADDANG")) read("additional-angles", "Additional angles", form.additionalAngles, false);
    else
      out.push({
        ...BLANK,
        key: "additional-angles",
        name: "Additional angles",
        lead: lead(false),
        wide: true,
        shown: paramText(form.additionalAngles),
        help: "Degrees, separated by semicolons. Up to 10. For example 15; 75",
        helped: true,
        ...refusal("additionalAngles"),
      });
    notes("POLARADDANG", "additional angles");
  } else {
    tick("osnap-on", "Object snap on", true);
    tick("otrack-on", "Object snap tracking on", false);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The snap boxes
// ---------------------------------------------------------------------------------------------

/** The side of the box a marker is drawn in (`--icon-size-md`): the marker's 6 px half and a pixel around it. */
export const GLYPH_BOX = 2 * (SNAP_MARKER_HALF + 1);

const coord = (unit: number): string => String(Number((GLYPH_BOX / 2 + (Number.isFinite(unit) ? unit : 0) * SNAP_MARKER_HALF).toFixed(3)));

/** One stroke of a marker as path data in the box's own pixels; a circle is four quarter curves. */
function shapePath(shape: SnapShape): string {
  if (shape.kind === "circle") {
    // A cubic per quarter (the usual 0.5523 handle): the normalizer's arcs are not needed.
    const { cx, cy, r } = shape;
    const k = r * 0.5523;
    const p = (x: number, y: number): string => `${coord(x)} ${coord(y)}`;
    return `M ${p(cx - r, cy)} C ${p(cx - r, cy - k)} ${p(cx - k, cy - r)} ${p(cx, cy - r)} C ${p(cx + k, cy - r)} ${p(cx + r, cy - k)} ${p(cx + r, cy)} C ${p(cx + r, cy + k)} ${p(cx + k, cy + r)} ${p(cx, cy + r)} C ${p(cx - k, cy + r)} ${p(cx - r, cy + k)} ${p(cx - r, cy)} Z`;
  }
  const points = shape.points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${coord(x)} ${coord(y)}`).join(" ");
  return shape.closed ? `${points} Z` : points;
}

/** The marker the drawing shows for a snap, as one path in a `GLYPH_BOX` square. */
export function snapGlyphPath(bit: number): string {
  return snapGlyph(bit).map(shapePath).join(" ");
}

const modeKey = (bit: number): string => `mode-${bit}`;

/** The snap bit a box's key names; null when it names none of the form's. */
export function modeBit(item: string): number | null {
  const m = /^mode-(\d{1,5})$/.exec(item);
  if (m === null) return null;
  const bit = Number(m[1]);
  return OSNAP_MODES.some((mode) => mode.bit === bit) ? bit : null;
}

/** The snap boxes: across then down in two columns, or all in the first. */
export function snapBoxes(modes: number, two: boolean): { a: SnapBoxParam[]; b: SnapBoxParam[] } {
  const all = OSNAP_MODES.map((mode): SnapBoxParam => {
    const on = (modes & mode.bit) !== 0;
    return { key: modeKey(mode.bit), name: mode.label, on, ticked: on ? "true" : "false", glyph: snapGlyphPath(mode.bit) };
  });
  if (!two) return { a: all, b: [] };
  return { a: all.filter((_, index) => index % 2 === 0), b: all.filter((_, index) => index % 2 === 1) };
}

/** The body's params. */
export function draftingParams(input: LinesInput & { summary: string; two: boolean }): DraftingParams {
  const osnap = input.tab === "osnap";
  const boxes = osnap ? snapBoxes(input.form.modes, input.two) : { a: [], b: [] };
  const modes = input.errors.modes;
  return {
    alerts: input.summary === "" ? [] : [{ key: "alert", note: sentenceText(input.summary) }],
    tabs: DRAFTING_TABS.map((tab) => ({ key: tab.id, name: tab.label, on: tab.id === input.tab })),
    page_name: DRAFTING_TABS.find((tab) => tab.id === input.tab)?.label ?? "",
    lines: draftingLines(input),
    osnap,
    two: input.two,
    modes_a: boxes.a,
    modes_b: boxes.b,
    modes_hint: osnap && modes !== undefined ? sentenceText(modes) : "",
    modes_bad: osnap && modes !== undefined,
  };
}

/** The form's value for every typed line, by line key: what the fields' buffers are held to. */
export function draftingValues(params: DraftingParams): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of params.lines) if (line.typed || line.wide) out.set(line.key, line.shown);
  return out;
}

/**
 * Whether a focusable node of the scene is left out of the Tab walk: the parts that hold a
 * mapped key (`#tabs`, `#lines`, `#modes`: a mapped key makes its node focusable) and the tabs
 * behind (the strip is one stop: the tab in front).
 */
export function draftingSkips(key: string, tabItem: string | null, tab: DraftingTab): boolean {
  if (/#(tabs|lines|modes)$/.test(key)) return true;
  return /#tabs\//.test(key) && tabItem !== tab;
}
