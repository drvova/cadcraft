/**
 * The Drafting Settings dialog's pure logic: what the engine holds read into a form, the form
 * judged by the engine's own rules, and the calls that make the engine hold what the form says.
 * No JSX and no DOM here: `components/DraftingSettings.tsx` draws it and the tests drive all of it.
 *
 * The engine has no "drafting settings" object to read and no transaction to write one in, so
 * both go through commands that exist (`crates/engine/src/cmd/settings.rs`, `sysvars.rs`):
 *
 *   - read: the facade's `settings()` (the status bar's toggles and `osmode`) and one
 *     `execute("getvar", { name })` each for SNAPUNIT, GRIDUNIT, POLARANG, POLARADDANG, POLARMODE;
 *   - write: `dsettings { snapunit, gridunit }` (the two spacings are the drawing's own header
 *     variables, so one call is one undo step), `setvar` for POLARANG, POLARADDANG and POLARMODE,
 *     the status bar's own `grid`, `snap`, `polar` and `otrack` with `{ on }`, and
 *     `osnap { osmode }` for the running snaps and their switch together. Everything but the two
 *     spacings is session state the engine records no undo step for.
 *
 * Only what the form changed is sent. A form with a value the engine would refuse sends nothing
 * (`planCalls`), every refusal comes back with the field it belongs to (`runCalls`), and what
 * the engine holds afterwards is read again and planned against the same form: a call the engine
 * answered `ok` to and did not honour (`dsettings` drops a spacing it does not like without
 * saying so) is a refusal too (`unapplied`).
 *
 * Numbers typed are read by the properties palette's `readNumber`, so a decimal comma, a unit
 * and a thousands separator mean in this dialog what they mean there; numbers shown are its
 * `numberText`. Two numbers are the same value when they are shown the same, which is what keeps
 * a spacing of 1/3 (shown as 0.333333) from being rewritten rounded by a form nobody touched.
 */

import type { SnapShape } from "./canvas";
import type { Envelope, SettingsState } from "./facade";
import { asNumber, asString, isRecord } from "./json";
import { numberText, readNumber, type NumberFault } from "./props";

/** OSMODE's "running snaps are off" bit (`snap::mode::OFF`): F3 sets and clears it. */
export const OSNAP_OFF = 16384;

/** Every bit OSMODE can hold: the engine keeps the low fifteen and drops the rest. */
const OSMODE_MASK = 0x7fff;

/** POLARMODE's "track along the additional angles too" bit (`polarmode::ADDITIONAL`). */
export const POLAR_ADDITIONAL = 4;

/** The most additional angles POLARADDANG takes (`sysvars::parse_angle_list`). */
export const MAX_ADDITIONAL_ANGLES = 10;

/** One object snap: its OSMODE bit (which is also what `snapGlyph` in `canvas.ts` draws by) and its name. */
export interface OsnapMode {
  bit: number;
  label: string;
}

/** The object snaps, in the engine's own order (`snap::mode::ALL`). */
export const OSNAP_MODES: readonly OsnapMode[] = [
  { bit: 1, label: "Endpoint" },
  { bit: 2, label: "Midpoint" },
  { bit: 4, label: "Center" },
  { bit: 1024, label: "Geometric center" },
  { bit: 8, label: "Node" },
  { bit: 16, label: "Quadrant" },
  { bit: 32, label: "Intersection" },
  { bit: 4096, label: "Extension" },
  { bit: 64, label: "Insertion" },
  { bit: 128, label: "Perpendicular" },
  { bit: 256, label: "Tangent" },
  { bit: 512, label: "Nearest" },
  { bit: 2048, label: "Apparent intersection" },
  { bit: 8192, label: "Parallel" },
];

/** Every bit the form has a box for. */
export const OSNAP_ALL: number = OSNAP_MODES.reduce((bits, mode) => bits | mode.bit, 0);

/** The increment angles a drafter picks from, in degrees, as the list shows them. */
export const POLAR_ANGLES: readonly string[] = ["90", "45", "30", "22.5", "18", "15", "10", "5"];

/** The list's value for "none of these: I will type one". */
export const POLAR_CUSTOM = "custom";

/** The engine's own defaults, shown where it reports something that cannot be used. */
const DEFAULT_SPACING = 0.5;
const DEFAULT_POLAR_ANGLE = 90;

/** The system variables the dialog reads one by one. */
export type DraftingVar = "SNAPUNIT" | "GRIDUNIT" | "POLARANG" | "POLARADDANG" | "POLARMODE";

export const DRAFTING_VARS: readonly DraftingVar[] = ["SNAPUNIT", "GRIDUNIT", "POLARANG", "POLARADDANG", "POLARMODE"];

/** A spacing along each axis, in drawing units. */
export interface Spacing {
  x: number;
  y: number;
}

/** What the engine holds, cleaned. A value is null when the engine did not answer for it
 *  (`missing`) or answered with something that cannot be used (`unusable`). */
export interface DraftingState {
  snapOn: boolean;
  gridOn: boolean;
  polarOn: boolean;
  otrackOn: boolean;
  /** OSMODE as the engine keeps it: a whole number from 0 to 32767. */
  osmode: number;
  snap: Spacing | null;
  grid: Spacing | null;
  /** POLARANG, in degrees. */
  polarAngle: number | null;
  /** POLARADDANG, in degrees. */
  additional: readonly number[] | null;
  /** POLARMODE's four bits. */
  polarMode: number | null;
  /** The engine did not answer for these: their controls are blocked and nothing is sent for them. */
  missing: readonly DraftingVar[];
  /** The engine answered with a value that cannot be used: the default is shown, and OK writes it. */
  unusable: readonly DraftingVar[];
}

/** The form's controls, by the key a message is shown beside. */
export type DraftingField = "snapOn" | "snapX" | "snapY" | "gridOn" | "gridX" | "gridY" | "polarOn" | "polarAngle" | "additionalOn" | "additionalAngles" | "osnapOn" | "otrackOn" | "modes";

/** The form as the dialog holds it: ticks, the text of each field, and the snap boxes as OSMODE bits. */
export interface DraftingForm {
  snapOn: boolean;
  snapX: string;
  snapY: string;
  gridOn: boolean;
  gridX: string;
  gridY: string;
  polarOn: boolean;
  /** One of `POLAR_ANGLES`, or `POLAR_CUSTOM` when the angle is the typed one. */
  polarChoice: string;
  /** The typed increment angle, read only while `polarChoice` is `POLAR_CUSTOM`. */
  polarCustom: string;
  additionalOn: boolean;
  /** The additional angles as typed: degrees separated by semicolons ("15; 75"). */
  additionalAngles: string;
  osnapOn: boolean;
  otrackOn: boolean;
  /** The ticked snap boxes, as OSMODE bits. */
  modes: number;
}

/** A message per field that has one. */
export type DraftingErrors = Partial<Record<DraftingField, string>>;

/** One command to run, and the field a refusal of it is shown beside. */
export interface DraftingCall {
  field: DraftingField;
  command: string;
  params: Record<string, unknown>;
}

/** What `execute` and `settings` the dialog needs of the facade: `AppFacade` is one. */
export interface DraftingEngine {
  settings(): Pick<SettingsState, "grid" | "snap" | "polar" | "otrack" | "osmode">;
  execute(command: string, params?: unknown): Envelope;
}

/** OSMODE as the engine would keep it. Anything that is not a whole number from 0 up reads as 0. */
export function cleanOsmode(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return 0;
  return value % (OSMODE_MASK + 1);
}

/** A spacing the engine may hold: both parts finite, a snap spacing above zero, a grid spacing not below it. */
function spacingOf(value: unknown, zeroAllowed: boolean): Spacing | null {
  const pair = Array.isArray(value) ? value : isRecord(value) ? [value["x"], value["y"]] : [];
  const x = asNumber(pair[0]);
  const y = asNumber(pair[1]);
  if (x === null || y === null) return null;
  const fits = (n: number): boolean => (zeroAllowed ? n >= 0 : n > 0);
  return fits(x) && fits(y) ? { x, y } : null;
}

/** POLARADDANG as the engine shows it (degrees separated by `;`), or a lone number. */
function anglesOf(value: unknown): number[] | null {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : null;
  const text = asString(value);
  if (text === null) return null;
  const out: number[] = [];
  for (const part of text.split(";")) {
    if (part.trim() === "") continue;
    const angle = Number(part);
    if (!Number.isFinite(angle) || out.length >= MAX_ADDITIONAL_ANGLES) return null;
    out.push(angle);
  }
  return out;
}

/**
 * What the engine said, cleaned. `vars` holds a `getvar` value per variable the engine answered
 * for; a variable it has no key for is `missing`. Never throws, whatever either argument holds.
 */
export function readState(settings: unknown, vars: Partial<Record<DraftingVar, unknown>>): DraftingState {
  const s = isRecord(settings) ? settings : {};
  const has = (name: DraftingVar): boolean => isRecord(vars) && Object.prototype.hasOwnProperty.call(vars, name);
  const missing = DRAFTING_VARS.filter((name) => !has(name));
  const unusable: DraftingVar[] = [];
  const read = <T>(name: DraftingVar, parse: (value: unknown) => T | null): T | null => {
    if (!has(name)) return null;
    const value = parse(vars[name]);
    if (value === null) unusable.push(name);
    return value;
  };
  const angle = (value: unknown): number | null => {
    const n = asNumber(value);
    return n !== null && n > 0 ? n : null;
  };
  const flags = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 15 ? value : null);
  return {
    snapOn: s["snap"] === true,
    gridOn: s["grid"] === true,
    polarOn: s["polar"] === true,
    otrackOn: s["otrack"] === true,
    osmode: cleanOsmode(s["osmode"]),
    snap: read("SNAPUNIT", (value) => spacingOf(value, false)),
    grid: read("GRIDUNIT", (value) => spacingOf(value, true)),
    polarAngle: read("POLARANG", angle),
    additional: read("POLARADDANG", anglesOf),
    polarMode: read("POLARMODE", flags),
    missing,
    unusable,
  };
}

/** Ask the engine for everything the dialog shows. A variable whose `getvar` fails is left out. */
export function readEngine(engine: DraftingEngine): DraftingState {
  const vars: Partial<Record<DraftingVar, unknown>> = {};
  for (const name of DRAFTING_VARS) {
    const reply = engine.execute("getvar", { name });
    if (reply.ok && isRecord(reply.result) && "value" in reply.result) vars[name] = reply.result["value"];
  }
  return readState(engine.settings(), vars);
}

/** The form that shows `state`: the engine's values, and its defaults where it gave none. */
export function formOf(state: DraftingState): DraftingForm {
  const snap = state.snap ?? { x: DEFAULT_SPACING, y: DEFAULT_SPACING };
  const grid = state.grid ?? { x: DEFAULT_SPACING, y: DEFAULT_SPACING };
  const angle = numberText(state.polarAngle ?? DEFAULT_POLAR_ANGLE);
  const listed = POLAR_ANGLES.includes(angle);
  return {
    snapOn: state.snapOn,
    snapX: numberText(snap.x),
    snapY: numberText(snap.y),
    gridOn: state.gridOn,
    gridX: numberText(grid.x),
    gridY: numberText(grid.y),
    polarOn: state.polarOn,
    polarChoice: listed ? angle : POLAR_CUSTOM,
    polarCustom: angle,
    additionalOn: ((state.polarMode ?? 0) & POLAR_ADDITIONAL) !== 0,
    additionalAngles: (state.additional ?? []).map(numberText).join("; "),
    osnapOn: (state.osmode & OSNAP_OFF) === 0,
    otrackOn: state.otrackOn,
    modes: state.osmode & OSNAP_ALL,
  };
}

/** OSMODE for a form: its ticked boxes, the switch, and any bit of the engine's the form has no box for. */
export function osmodeOf(form: Pick<DraftingForm, "modes" | "osnapOn">, held: number): number {
  const kept = cleanOsmode(held) & ~OSNAP_ALL & ~OSNAP_OFF;
  return (cleanOsmode(form.modes) & OSNAP_ALL) | kept | (form.osnapOn ? 0 : OSNAP_OFF);
}

const FAULT_WORDS: Readonly<Record<NumberFault, string>> = {
  empty: "Type a number.",
  separators: "Write the number with one decimal mark and no thousands separator.",
  unit: "Type the number alone, without a unit.",
  range: "That number is too large.",
  form: "Type a number, such as 0.5.",
};

type Judged<T> = { ok: true; value: T } | { ok: false; error: string };

/** A typed spacing, by the engine's rule for it: a snap spacing above zero, a grid spacing zero or more. */
export function judgeSpacing(text: string, zeroAllowed: boolean): Judged<number> {
  const reading = readNumber(text);
  if (!reading.ok) return { ok: false, error: FAULT_WORDS[reading.fault] };
  if (zeroAllowed ? reading.value < 0 : reading.value <= 0) return { ok: false, error: zeroAllowed ? "Grid spacing cannot be negative." : "Snap spacing must be more than 0." };
  return { ok: true, value: reading.value };
}

/** A typed increment angle: the engine takes any angle above zero. */
export function judgeAngle(text: string): Judged<number> {
  const reading = readNumber(text);
  if (!reading.ok) return { ok: false, error: reading.fault === "form" ? "Type an angle in degrees, such as 22.5." : FAULT_WORDS[reading.fault] };
  if (reading.value <= 0) return { ok: false, error: "The increment angle must be more than 0." };
  return { ok: true, value: reading.value };
}

/** The typed additional angles: degrees separated by semicolons, ten at most. Empty is none. */
export function judgeAngleList(text: string): Judged<number[]> {
  const parts = (typeof text === "string" ? text : "").split(";").map((part) => part.trim()).filter((part) => part !== "");
  if (parts.length > MAX_ADDITIONAL_ANGLES) return { ok: false, error: `Up to ${MAX_ADDITIONAL_ANGLES} angles: this is ${parts.length}.` };
  const out: number[] = [];
  for (const part of parts) {
    const reading = readNumber(part);
    if (!reading.ok) return { ok: false, error: `"${part.length > 16 ? `${part.slice(0, 16)}…` : part}" is not an angle. Separate angles with semicolons: 15; 75` };
    out.push(reading.value);
  }
  return { ok: true, value: out };
}

/** Whether two numbers are one value to this dialog: they are shown the same. */
const same = (a: number, b: number): boolean => numberText(a) === numberText(b);

/** Whether a variable can be written: the engine answered for it. */
const readable = (state: DraftingState, name: DraftingVar): boolean => !state.missing.includes(name);

/**
 * The calls that make the engine hold what `form` says, given that it holds `state` now, in the
 * order they run; or the form's errors, in which case nothing may be sent. A variable the engine
 * did not answer for is neither judged nor written.
 */
export function planCalls(state: DraftingState, form: DraftingForm): { ok: true; calls: DraftingCall[] } | { ok: false; errors: DraftingErrors } {
  const errors: DraftingErrors = {};
  const calls: DraftingCall[] = [];
  const number = (field: DraftingField, judged: Judged<number>): number | null => {
    if (judged.ok) return judged.value;
    errors[field] = judged.error;
    return null;
  };

  // The two spacings, in one `dsettings` call: one undo step for what is one edit to the drawing.
  const spacing: Record<string, unknown> = {};
  const spacingFields: DraftingField[] = [];
  const pair = (name: "SNAPUNIT" | "GRIDUNIT", key: string, xField: DraftingField, yField: DraftingField, held: Spacing | null, xText: string, yText: string): void => {
    if (!readable(state, name)) return;
    const x = number(xField, judgeSpacing(xText, name === "GRIDUNIT"));
    const y = number(yField, judgeSpacing(yText, name === "GRIDUNIT"));
    if (x === null || y === null) return;
    const xMoved = held === null || !same(held.x, x);
    const yMoved = held === null || !same(held.y, y);
    if (!xMoved && !yMoved) return;
    // A part the form did not move keeps the engine's own digits, not the six shown.
    spacing[key] = [xMoved || held === null ? x : held.x, yMoved || held === null ? y : held.y];
    spacingFields.push(xMoved ? xField : yField);
  };
  pair("SNAPUNIT", "snapunit", "snapX", "snapY", state.snap, form.snapX, form.snapY);
  pair("GRIDUNIT", "gridunit", "gridX", "gridY", state.grid, form.gridX, form.gridY);
  const spacingField = spacingFields[0];
  if (spacingField !== undefined) calls.push({ field: spacingField, command: "dsettings", params: spacing });

  if (readable(state, "POLARANG")) {
    const angle = number("polarAngle", judgeAngle(form.polarChoice === POLAR_CUSTOM ? form.polarCustom : form.polarChoice));
    if (angle !== null && (state.polarAngle === null || !same(state.polarAngle, angle))) calls.push({ field: "polarAngle", command: "setvar", params: { name: "POLARANG", value: angle } });
  }
  if (readable(state, "POLARADDANG")) {
    const judged = judgeAngleList(form.additionalAngles);
    if (!judged.ok) errors.additionalAngles = judged.error;
    else {
      const held = state.additional;
      const moved = held === null || held.length !== judged.value.length || held.some((angle, index) => !same(angle, judged.value[index] ?? Number.NaN));
      if (moved) calls.push({ field: "additionalAngles", command: "setvar", params: { name: "POLARADDANG", value: judged.value.map(numberText).join(";") } });
    }
  }
  if (readable(state, "POLARMODE")) {
    const held = state.polarMode;
    const wanted = ((held ?? 0) & ~POLAR_ADDITIONAL) | (form.additionalOn ? POLAR_ADDITIONAL : 0);
    if (held !== wanted) calls.push({ field: "additionalOn", command: "setvar", params: { name: "POLARMODE", value: wanted } });
  }

  // The switches, through the commands the status bar's toggles run.
  const toggle = (field: DraftingField, command: string, held: boolean, wanted: boolean): void => {
    if (held !== wanted) calls.push({ field, command, params: { on: wanted } });
  };
  toggle("snapOn", "snap", state.snapOn, form.snapOn);
  toggle("gridOn", "grid", state.gridOn, form.gridOn);
  toggle("polarOn", "polar", state.polarOn, form.polarOn);
  toggle("otrackOn", "otrack", state.otrackOn, form.otrackOn);

  // The running snaps and their switch are one number: one call.
  const osmode = osmodeOf(form, state.osmode);
  if (osmode !== state.osmode) {
    const switched = (osmode & OSNAP_OFF) !== (state.osmode & OSNAP_OFF);
    const boxes = (osmode & OSNAP_ALL) !== (state.osmode & OSNAP_ALL);
    calls.push({ field: switched && !boxes ? "osnapOn" : "modes", command: "osnap", params: { osmode } });
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, calls };
}

/** Run the calls in order, every one of them: a refusal does not stop the settings after it,
 *  which do not depend on it. Returns each refusal under its field. */
export function runCalls(engine: Pick<DraftingEngine, "execute">, calls: readonly DraftingCall[]): DraftingErrors {
  const errors: DraftingErrors = {};
  for (const call of calls) {
    const reply = engine.execute(call.command, call.params);
    if (!reply.ok) errors[call.field] ??= reply.error;
  }
  return errors;
}

/**
 * What the engine still does not hold after the calls ran: `after` (read again) planned against
 * the same form. A call the engine answered `ok` to without honouring it shows up here.
 */
export function unapplied(after: DraftingState, form: DraftingForm): DraftingErrors {
  const plan = planCalls(after, form);
  if (!plan.ok) return plan.errors;
  const errors: DraftingErrors = {};
  for (const call of plan.calls) errors[call.field] ??= "The engine did not take this value.";
  return errors;
}

/** The names typed at the command line that open the dialog: the command's id and its aliases (`settings.rs`). */
export const DRAFTING_COMMAND_NAMES: readonly string[] = ["dsettings", "ds", "se"];

/** Whether a line typed at an idle command line asks for the dialog ("DSETTINGS", "ds", "'se"). */
export function opensDraftingSettings(text: string): boolean {
  if (typeof text !== "string") return false;
  const name = text.trim().replace(/^['_.]+/, "").toLowerCase();
  return DRAFTING_COMMAND_NAMES.includes(name);
}

/** The dialog's pages, and the page a status toggle's own settings are on. */
export type DraftingTab = "snap-grid" | "polar" | "osnap";

/** The page for a status bar toggle's command id ("osnap" opens Object Snap); Snap and Grid for any other. */
export function draftingTabFor(toggleId: string): DraftingTab {
  if (toggleId === "polar") return "polar";
  if (toggleId === "osnap" || toggleId === "otrack") return "osnap";
  return "snap-grid";
}

/** The page that holds a field, so the first refused field can be brought to the front. */
export function tabOf(field: DraftingField): DraftingTab {
  if (field === "polarOn" || field === "polarAngle" || field === "additionalOn" || field === "additionalAngles") return "polar";
  if (field === "osnapOn" || field === "otrackOn" || field === "modes") return "osnap";
  return "snap-grid";
}

/** One stroke of a snap marker (`snapGlyph` in `canvas.ts`) as an SVG path's `d`; a circle is the two arcs of one. */
export function snapShapePath(shape: SnapShape): string {
  if (shape.kind === "circle") {
    const { cx, cy, r } = shape;
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
  }
  const points = shape.points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  return shape.closed ? `${points} Z` : points;
}
