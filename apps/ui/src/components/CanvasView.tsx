/**
 * The canvas surface: a `<canvas>` that draws `display()` through the view rectangle and is worked
 * with the pointer. The wheel zooms about the pointer; the middle button's drag pans, and so does a
 * finger's; the left button's drag is a selection rectangle (`onSelectRect`, or a pan without it); two fingers
 * pan and pinch about their centre; two middle clicks zoom to the drawing's extents. A left press
 * that stayed inside the click slop is a pick (`onPick(worldPoint, shiftKey, worldPerPixel)`);
 * every pointer move reports the world position through `onCursor`, and leaving reports null.
 *
 * While a command runs, `wants` says what the pointer is for. A command that wants a point takes
 * it from the left press, where it goes down (`onPoint`), under a crosshair, and the drag that
 * may follow draws no rectangle. One that wants objects takes a click as a point too (the engine
 * picks there) and a rectangle through `onSelectRect`, as at rest. One that wants only what is
 * typed takes nothing from the left button. The middle button and the wheel work throughout.
 *
 * The right button asks for the drawing's menu (`onMenu`), and the browser's own menu is kept off
 * the drawing. The canvas reports the press and decides nothing: where it was released, how long
 * it was held and whether it moved (the shell reads a quick click during a command as Enter). A
 * finger held still for `LONG_PRESS_MS` asks for the menu too, and that press is then over: its
 * lift is no pick and no point, and its travel no pan. The keyboard's menu key (a `contextmenu`
 * no button made) asks for it where the pointer last was, or at the middle of the drawing.
 *
 * What follows a mouse or a pen is the engine's answer, asked at most once a frame and drawn on a
 * second canvas over the drawing: at rest and while a command wants objects, the outline of what a
 * click would pick; while a command runs, its rubber band (the dragged objects are the display
 * list's own primitives under the engine's matrix) and, when it wants a point, the object-snap
 * marker with its name, at the point the click will take. That point is the engine's own
 * resolution of the pointer (`facade.pointer`, one call a frame): object snap, grid snap, polar
 * and object-snap tracking, ortho, with Shift and Ctrl as they are held. What bent it is drawn
 * with it: the ortho or polar ray dashed, with its distance and angle in the label; a dot where
 * grid snap put the point; a small cross on each point tracking holds. It is cleared when the
 * pointer leaves and when the command ends. The engine is told the canvas's size whenever it
 * changes.
 *
 * A selection shows its grips, drawn on that second canvas too. They are listed when the
 * selection, the drawing or the command line changes, never per frame. At rest the grip under the
 * pointer is warm, before any object is, and a left press on it starts its edit instead of a
 * pick or a rectangle (`onGripStart`); from there the edit is the running command, so the press
 * that is dragged commits where it is released and the press that was a click commits at the
 * next click. Shift on a grip collects it for the next edit. A grip with a menu shows it when the
 * pointer has rested on it, and on a right click of it (`onGripMenu`).
 *
 * The component owns the pointer state, the device-pixel-ratio sizing and the frame: however many
 * wheel, pointer or resize events arrive between two frames, the shell hears of one view and the
 * display list is drawn once, and nothing is drawn while nothing changes. The drawing lives in
 * ../canvas.ts, the view math in ../view.ts and the selection rules in ../selection.ts.
 *
 * The canvas is pointer-only by nature, so its wrapper is exposed as an image named "Drawing"
 * whose description says how to work without a pointer: the command line is the keyboard path.
 * The wrapper takes the keyboard's focus (Tab, F6, a press on the drawing) so the drawing is a
 * place the keyboard can be: the shell sends what is typed there to the command line and cancels
 * on Escape. It shows the focus ring only when the keyboard brought the focus (`data-focus-ring`):
 * a key pressed while the pointer is working in the drawing frames nothing.
 *
 * The props accept the value or the accessor form (the shell may hand either); the component
 * reads both.
 */

import { createEffect, createUniqueId, onCleanup, onMount, type Accessor, type JSX } from "solid-js";
import { LONG_PRESS_MS } from "../context";
import type { DisplayList } from "../display";
import { EMPTY_PREVIEW, NO_GRIPS, type AppFacade, type CommandPreview, type Grip, type GripList, type SnapPoint } from "../facade";
import { drawDisplay, drawOverlay, guideIsEmpty, overlayIsEmpty, paletteFrom, placeLabel, samePalette, type OverlayGuide, type Palette } from "../canvas";
import type { PointerWants } from "../prompt";
import { clickSlop, dragKind, gripGesture, gripPress, keptGrips, pickReach, sameSelection } from "../selection";
import { fitAspect, holdsFit, panBy, pinchOf, pinchView, resizeView, screenToWorld, wheelZoomFactor, worldToScreen, zoomAt, type Point, type Rect, type ScreenBox, type ScreenSize } from "../view";
import type { MenuPoint } from "./ContextMenu";
import "../canvas.css";

export { CLICK_SLOP } from "../selection";

export interface CanvasViewProps {
  facade: AppFacade;
  view: Rect | Accessor<Rect>;
  display: DisplayList | Accessor<DisplayList>;
  /** Handles to highlight (the engine's hex strings); absent highlights nothing. */
  selection?: readonly string[] | Accessor<readonly string[]>;
  /** The view the pointer or a resize made, and the canvas's size in CSS px it is shown on. */
  onViewChange: (rect: Rect, screen: ScreenSize) => void;
  onNotice: (message: string | null) => void;
  /**
   * A click that did not move the view: the world point, whether Shift was held, and the world
   * size of one CSS pixel (so the caller can size the engine's pick aperture for this canvas; a
   * finger's or a pen's is wider, see `pickReach`).
   */
  onPick?: (point: Point, add: boolean, worldPerPixel: number) => void;
  /** The world position under the pointer; null when the pointer leaves the canvas. */
  onCursor?: (point: Point | null) => void;
  /**
   * A left drag released as a selection rectangle: its world corners, its kind (dragged to the
   * right a window, to the left a crossing) and whether Shift was held. While the shell does not
   * pass this, a left drag pans, as it always has; passing it turns the left drag into the
   * rectangle (the engine's `select {window, crossing}`) and leaves panning to the middle button.
   */
  onSelectRect?: (rect: Rect, kind: "window" | "crossing", shift: boolean, worldPerPixel: number) => void;
  /**
   * The drawing's extents, when the shell knows them: a canvas whose bottom edge moves keeps a
   * fitted view where it is while they still show (`holdsFit`).
   */
  extents?: Rect | null | Accessor<Rect | null>;
  /** What the pointer is for while the running command's prompt is up; absent is at rest. */
  wants?: PointerWants | Accessor<PointerWants>;
  /**
   * A point given to the running command: the world point and the world size of one CSS pixel.
   * Called for a left press while `wants` is "point", and for a click while it is "select".
   */
  onPoint?: (point: Point, worldPerPixel: number) => void;
  /**
   * The drawing's menu was asked for: by the right button (`pointer`: where it was released, how
   * long it was held in ms and whether it left the click slop), by a finger held still (`touch`)
   * or by the keyboard's menu key (`keyboard`).
   */
  onMenu?: (request: { at: MenuPoint; heldMs: number; moved: boolean }) => void;
  /**
   * The engine's state as the shell last read it (the prompt, the drafting settings): any value
   * that is a new one whenever a command, a click or a toggle may have changed what the engine
   * would draw under the pointer. A change asks the engine again with the pointer where it is.
   */
  engineState?: Accessor<unknown>;
  /**
   * Called before the canvas asks the engine about the pointer (`pick`, `pointer`, `preview`), so
   * the shell can tell the engine the view on screen: the engine sizes its pick box and its snap
   * aperture by it.
   */
  onBeforeQuery?: () => void;
  /**
   * Where the running command's rubber band comes from (the last point given, world), or null:
   * the label beside the point a click will take stands on the far side of it.
   */
  base?: Accessor<Point | null>;
  /** The running command is a grip edit: its mode is named beside the pointer. */
  gripEditing?: Accessor<boolean>;
  /**
   * A press on a grip asks for its edit, with the grips Shift collected (the pressed one first).
   * The shell starts it (`facade.gripStart`) and says whether an edit now runs; from then on it
   * is the running command, and takes its points through `onPoint`.
   */
  onGripStart?: (ids: readonly string[]) => boolean;
  /**
   * A grip's menu is asked for: by the pointer resting on it (`rest`), by a right click of it or
   * by a press on a list grip. Null: the pointer has gone from the grip whose rested menu is up.
   */
  onGripMenu?: (request: { grip: Grip; at: MenuPoint; rest: boolean } | null) => void;
}

const FALLBACK_PALETTE: Palette = (() => {
  const selection = "#81a1c1";
  return { canvas: "#181818", gridMinor: "#202020", gridMajor: "#2a2a2a", axisX: "#552633", axisY: "#23412f", selection, gripHover: selection, gripHot: selection };
})();

/** What the canvas is and how to work on it without a pointer: its accessible description. */
export const CANVAS_HELP =
  "The drawing area. With a pointer: click an object to add it to the selection, drag a rectangle to add several (to the right for those inside it, to the left for those it touches), hold Shift to remove from the selection instead, drag with the middle button to pan, turn the wheel to zoom. A selected object shows grips: drag one, or click it and then click where it goes, to stretch the object; Space or Enter changes the edit to Move, Rotate, Scale or Mirror. While a command asks for a point, a click gives it that point; while it asks for objects, clicks and rectangles pick them. A right click, or a finger held still, opens a menu of commands for what is selected or for the running command; while a command runs a quick right click is Enter. With the keyboard: type a command, such as LINE, ZOOM or PAN, and it goes to the command line; Enter or Space repeats the last command, or accepts the running command's default; Escape cancels the running command; the menu key or Shift+F10 opens the drawing's menu; F6 moves to the next part of the window.";

/** Two middle presses this close in time (ms) are a double click: zoom to the extents. */
const DOUBLE_CLICK_MS = 400;

/** Read a prop that may be a value or an accessor. */
function read<T>(value: T | Accessor<T> | undefined): T | undefined {
  if (value === undefined) return undefined;
  return typeof value === "function" ? (value as Accessor<T>)() : value;
}

/** How far a view's aspect may be from the canvas's (as a fraction) before it counts as stretched. */
const ASPECT_TOLERANCE = 1e-6;

/** Whether drawing `rect` on `screen` would scale x and y differently (a stretched drawing). */
function isStretched(rect: Rect, screen: ScreenSize): boolean {
  const spanX = rect.x1 - rect.x0;
  const spanY = rect.y1 - rect.y0;
  if (!(spanX > 0) || !(spanY > 0) || !(screen.w > 0) || !(screen.h > 0)) return false;
  const have = spanX / spanY;
  const want = screen.w / screen.h;
  return Number.isFinite(have) && Math.abs(have - want) > ASPECT_TOLERANCE * want;
}

/** One pointer's press, from down to up. */
interface Drag {
  pointerId: number;
  pointerType: string;
  button: number;
  /** What moving it does: pan the view, or stretch the selection rectangle. */
  mode: "pan" | "select";
  /** Where it went down (client px). */
  downX: number;
  downY: number;
  /** Where it was last applied to the view (client px). */
  x: number;
  y: number;
  /** Whether it left the click slop; from then on it is a drag and never a click. */
  moved: boolean;
}

/** What lies over the drawing under the pointer, as the engine last answered. */
interface Under {
  /** The handle a click would select, or null. */
  hover: string | null;
  /** The running command's rubber band; `EMPTY_PREVIEW` when there is none. */
  preview: CommandPreview;
  /** The object snap the pointer takes, or null. */
  snap: SnapPoint | null;
  /** What the drafting aids drew the point with (a ray, the grid dot, acquired points), or null. */
  guide: OverlayGuide | null;
  /**
   * The words beside the point the click will take, or null: a grip edit's mode ("Stretch"), and
   * the snap's name or the constraint's measure ("Polar: 4.25 < 45°"). Either may be "".
   */
  label: { mode: string; text: string; at: Point } | null;
  /** The grip under the pointer at rest, or null: it is warm, and no object is hovered with it. */
  grip: Grip | null;
}

const NOTHING_UNDER: Under = { hover: null, preview: EMPTY_PREVIEW, snap: null, guide: null, label: null, grip: null };

/** The press that started a grip edit, while its button is down. */
interface GripHold {
  pointerId: number;
  pointerType: string;
  /** Where it went down (client px). */
  downX: number;
  downY: number;
  /** It left the click slop: the edit is being dragged, and the release commits it. */
  dragged: boolean;
}

/** How long the pointer rests on a grip that has a menu before the menu shows (ms). */
export const GRIP_REST_MS = 1000;

/** How far from a grip (CSS px) the pointer may be on the drawing before the menu its rest opened goes. */
const GRIP_MENU_LEASH = 32;

/** No grips collected: one set, so an unchanged collection is the same value. */
const NONE_COLLECTED: ReadonlySet<string> = new Set();

/** A grip edit's mode as the label beside the pointer writes it: "stretch" is "Stretch". */
function modeName(mode: string | null): string {
  return mode === null || mode === "" ? "" : mode.charAt(0).toUpperCase() + mode.slice(1);
}

/**
 * How long after the engine says a tracking point is being acquired the canvas asks again with
 * the pointer at rest (ms): the engine's dwell (0.4 s) and a frame, so the answer has changed.
 */
const DWELL_MS = 420;

/** What the engine was last asked with: asking again with the same is skipped. */
interface Asked {
  rect: Rect;
  state: unknown;
  wants: PointerWants;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}

/** What the last frame drew: a frame asked for with the same inputs draws nothing. */
interface Drawn {
  list: DisplayList;
  rect: Rect;
  selection: readonly string[];
  pixels: ScreenSize;
  dpr: number;
  palette: Palette;
}

export function CanvasView(props: CanvasViewProps): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  /** The canvas over the drawing that holds what follows the pointer (canvas.css). */
  let overlay: HTMLCanvasElement | undefined;
  /** The words beside the point the click will take: the snap's name, or the constraint's measure. */
  let snapLabel: HTMLDivElement | undefined;
  /** The label's two parts: the grip edit's mode, quieter, and the snap or the constraint. */
  let labelMode: HTMLSpanElement | undefined;
  let labelText: HTMLSpanElement | undefined;
  let stage: HTMLDivElement | undefined;
  let marquee: HTMLDivElement | undefined;
  const helpId = createUniqueId();
  /** The canvas in CSS px: its backing store's whole device pixels over the pixel ratio. */
  let size: ScreenSize = { w: 0, h: 0 };
  /** The backing store the canvas should have, in device pixels. */
  let pixels: ScreenSize = { w: 0, h: 0 };
  /** The box the view was last fitted to; it survives the canvas being hidden (a size of zero). */
  let shown: ScreenBox | null = null;
  let palette: Palette = FALLBACK_PALETTE;
  /** The view the pointer has made since the last frame; the shell hears of it at the frame. */
  let local: Rect | null = null;
  /**
   * The view as it was given before it was fitted to the canvas's shape (the first view of a
   * drawing, a view a command set), while the hand has not moved it since. A canvas that changes
   * size re-fits that view, so a drawing nobody has panned or zoomed stays whole and centred; once
   * the pointer moves the view this is null and a size change keeps the drawing where it is.
   */
  let fitted: Rect | null = null;
  /** The box `fitted` was last fitted to: a row more or less of command line keeps that fit (`holdsFit`). */
  let fitBox: ScreenBox | null = null;
  /** Where a mouse or a pen is over the canvas (client px); null when it is not, and for a finger. */
  let pointer: Point | null = null;
  /** The pointer moved since the engine was last asked what is under it. */
  let pointerMoved = false;
  let under: Under = NOTHING_UNDER;
  let asked: Asked | null = null;
  /** The keys held with the pointer: Shift flips ortho, Ctrl turns ARC, while they are down. */
  let held = { shift: false, ctrl: false };
  /** The pending ask after a dwell (the engine is acquiring a tracking point), or 0. */
  let dwell = 0;
  /** What the overlay canvas shows; null when it is clear. */
  let overlaid: { under: Under; list: DisplayList; rect: Rect; dpr: number; palette: Palette; grips: GripList; collected: ReadonlySet<string>; selected: boolean } | null = null;
  /** The selection's grips, as the engine last listed them. */
  let grips: GripList = NO_GRIPS;
  /** What the grips were listed for: the same selection, drawing and engine state lists nothing again. */
  let gripsFor: { selection: readonly string[]; revision: number; state: unknown; editing: boolean } | null = null;
  /** The grips Shift+click has collected for the next edit: hot here before the engine hears of them. */
  let collected: ReadonlySet<string> = NONE_COLLECTED;
  /** The running grip edit's mode, as the engine last named it; null with no edit. */
  let gripMode: string | null = null;
  /** The press that started the running grip edit, while it is down. */
  let gripHold: GripHold | null = null;
  /** The grip the pointer rests on (one with a menu), the pending wait for its menu, and where the menu it opened hangs (client px). */
  let restOn: string | null = null;
  let rest = 0;
  let restMenu: Point | null = null;
  /** The canvas size the engine was last told. */
  let toldSize: ScreenSize = { w: 0, h: 0 };
  /** The pending animation frame, or 0. */
  let frame = 0;
  let drawn: Drawn | null = null;
  /** The live single-pointer press. */
  let drag: Drag | null = null;
  /** The touches that are down (client px), by pointer id; the first two drive the view. */
  const touches = new Map<number, Point>();
  /** The last lone middle press, for the double click. */
  let lastMiddle: { at: number; x: number; y: number } | null = null;
  /** The right button's press in hand: when and where it went down (client px). */
  let rightDown: { at: number; x: number; y: number } | null = null;
  /** The pending long press of a lone finger, or 0. */
  let longPress = 0;

  const dpr = (): number => {
    const raw = typeof window === "undefined" ? 1 : window.devicePixelRatio;
    return Math.max(0.25, Math.min(8, Number.isFinite(raw) && raw > 0 ? raw : 1));
  };

  const view = (): Rect => local ?? read(props.view) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };

  const wants = (): PointerWants => read(props.wants) ?? "idle";

  const measured = (): boolean => size.w > 0 && size.h > 0;

  /** A client point in the canvas's own CSS px, or null when the canvas has no box. */
  const localPoint = (clientX: number, clientY: number): Point | null => {
    const rect = canvas?.getBoundingClientRect();
    if (rect === undefined || !measured()) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  /** The world point under a client point, or null when the canvas box is unavailable. */
  const worldAt = (clientX: number, clientY: number): Point | null => {
    const p = localPoint(clientX, clientY);
    return p === null ? null : screenToWorld(view(), size, p);
  };

  /** The world size of one CSS pixel in the view on screen; 0 when it cannot be said. */
  const worldPerPixel = (): number => {
    const rect = view();
    const perPixel = measured() ? (rect.x1 - rect.x0) / size.w : 0;
    return Number.isFinite(perPixel) && perPixel > 0 ? perPixel : 0;
  };

  const paint = (): void => {
    const list = read(props.display);
    const selection = read(props.selection) ?? [];
    if (canvas === undefined || !measured() || list === undefined) return;
    const rect = view();
    const scale = dpr();
    const same =
      drawn !== null &&
      drawn.list === list &&
      drawn.palette === palette &&
      drawn.dpr === scale &&
      drawn.pixels.w === pixels.w &&
      drawn.pixels.h === pixels.h &&
      drawn.rect.x0 === rect.x0 &&
      drawn.rect.y0 === rect.y0 &&
      drawn.rect.x1 === rect.x1 &&
      drawn.rect.y1 === rect.y1 &&
      sameSelection(drawn.selection, selection);
    if (same && canvas.width === pixels.w && canvas.height === pixels.h) return;
    if (canvas.width !== pixels.w) canvas.width = pixels.w;
    if (canvas.height !== pixels.h) canvas.height = pixels.h;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      props.onNotice("this browser has no 2D canvas context");
      return;
    }
    const highlighted = selection.length > 0 ? new Set(selection) : undefined;
    drawDisplay(ctx, list, rect, { width: size.w, height: size.h, dpr: scale, palette, grid: true, ...(highlighted === undefined ? {} : { selection: highlighted }) });
    drawn = { list, rect, selection, pixels, dpr: scale, palette };
  };

  /** Whether a press is being dragged (a pan, a rectangle) or fingers are down: no hover then. */
  const inGesture = (): boolean => (drag !== null && drag.moved) || touches.size > 0;

  /** Ask again once the engine's dwell has passed, the pointer still where it is; `false` drops the wait. */
  const awaitDwell = (wait: boolean): void => {
    if (dwell !== 0) clearTimeout(dwell);
    dwell = !wait
      ? 0
      : window.setTimeout(() => {
          dwell = 0;
          pointerMoved = true;
          schedule();
        }, DWELL_MS);
  };

  /**
   * List the selection's grips again when what they were listed for has changed: the selection,
   * the drawing's revision, or the engine's state (every command-line reply is a new one, which
   * is what keeps the hot flags and the edit's mode true while an edit runs). Nothing selected
   * and no edit running asks the engine nothing.
   */
  const syncGrips = (): void => {
    const selection = read(props.selection) ?? [];
    const revision = read(props.display)?.revision ?? 0;
    const state = props.engineState?.();
    const editing = props.gripEditing?.() === true;
    if (gripsFor !== null && gripsFor.selection === selection && gripsFor.revision === revision && gripsFor.state === state && gripsFor.editing === editing) return;
    gripsFor = { selection, revision, state, editing };
    if (selection.length === 0 && !editing) {
      grips = NO_GRIPS;
      collected = NONE_COLLECTED;
      gripMode = null;
      return;
    }
    grips = props.facade.grips();
    collected = keptGrips(collected, grips.grips);
    gripMode = editing ? (props.facade.gripEdit()?.mode ?? gripMode) : null;
  };

  /** Whether the selection shows grips now. */
  const gripsShown = (): boolean => grips.shown && grips.grips.length > 0;

  /** The grip under a client point as the engine decides it, in the view on screen; null for none. */
  const gripUnder = (clientX: number, clientY: number): Grip | null => {
    const world = worldAt(clientX, clientY);
    if (world === null) return null;
    props.onBeforeQuery?.();
    return props.facade.gripAt(world);
  };

  /** Where a grip's menu hangs: just past the grip's corner, so the grip stays in sight (client px). */
  const gripMenuAt = (grip: Grip): MenuPoint | null => {
    const box = canvas?.getBoundingClientRect();
    if (box === undefined || !measured()) return null;
    const at = worldToScreen(view(), size, grip.point);
    const off = grips.size / 2 + 4;
    return { x: box.left + at.x + off, y: box.top + at.y + off, source: "pointer" };
  };

  /** Stop waiting for the rest that shows a grip's menu; the grip stays noted, so the wait does not start again on it. */
  const stopRest = (): void => {
    if (rest !== 0) clearTimeout(rest);
    rest = 0;
  };

  /**
   * Note the grip the pointer is on, for its menu: one with a menu that can be edited starts the
   * wait, and the wait goes on while the pointer stays on that grip, wherever on it. A menu shown
   * is not shown again until the pointer has been off the grip, and neither is one for a grip that
   * came under a still pointer (`arm` false: the grip an edit just left where the hand is).
   */
  const awaitRest = (grip: Grip | null, arm = true): void => {
    const id = grip !== null && grip.multi && !grip.locked ? grip.id : null;
    if (id === restOn) return;
    stopRest();
    restOn = id;
    if (grip === null || id === null || !arm) return;
    rest = window.setTimeout(() => {
      rest = 0;
      const at = gripMenuAt(grip);
      if (at === null || under.grip?.id !== id || pointer === null || drag !== null || gripHold !== null || rightDown !== null || wants() !== "idle") return;
      restMenu = { x: at.x, y: at.y };
      props.onGripMenu?.({ grip, at, rest: true });
    }, GRIP_REST_MS);
  };

  /** What is under the pointer at rest: the same value while it has not changed, so nothing is drawn again. */
  const atRest = (hover: string | null, grip: Grip | null): Under => {
    const same = under.preview === EMPTY_PREVIEW && under.snap === null && under.guide === null && under.label === null && under.hover === hover && (under.grip?.id ?? null) === (grip?.id ?? null);
    return same ? under : { ...NOTHING_UNDER, hover, grip };
  };

  /**
   * Ask the engine what is under the pointer, at most once a frame and only when something
   * changed. While a command wants a point: the engine's resolution of the pointer, in one call
   * (the point a click takes, what bent it, the rubber band there; it tells the engine where the
   * pointer is, which direct distance entry reads). While it wants objects or only typed input:
   * where the pointer is, the rubber band, and what a click would pick. At rest: what a click
   * would pick, as the engine's selection preview decides it; when the selection shows grips, the
   * grip under the pointer first, and with one there no object is hovered. At rest the
   * pick is made when the pointer moves or the engine's state changes, never because the view
   * did: a wheel zoom under a still pointer picks nothing, and the hover (which was true of the
   * pick box at the old zoom) is dropped until the pointer moves again.
   */
  const ask = (): void => {
    const world = pointer !== null && measured() ? worldAt(pointer.x, pointer.y) : null;
    if (world === null) {
      under = NOTHING_UNDER;
      asked = null;
      awaitDwell(false);
      awaitRest(null);
      return;
    }
    const rect = view();
    const want = wants();
    const state = props.engineState?.();
    const moved = pointerMoved;
    const fresh = moved || asked === null || asked.state !== state || asked.wants !== want;
    const viewMoved = asked !== null && !sameRect(asked.rect, rect);
    pointerMoved = false;
    asked = { rect, state, wants: want };
    const facade = props.facade;
    if (want === "point") {
      if (!fresh && !viewMoved) return;
      props.onBeforeQuery?.();
      const at = facade.pointer(world, { now: performance.now(), shift: held.shift, ctrl: held.ctrl });
      const guide: OverlayGuide = { paths: at.paths, dot: at.constraint === "grid" ? at.point : null, acquired: at.acquired };
      const text = at.snap !== null ? at.snap.name : at.label;
      const mode = props.gripEditing?.() === true ? modeName(gripMode) : "";
      under = { hover: null, preview: at.preview, snap: at.snap, guide: guideIsEmpty(guide) ? null : guide, label: text === "" && mode === "" ? null : { mode, text, at: at.point }, grip: null };
      awaitDwell(at.wait);
      awaitRest(null);
      return;
    }
    awaitDwell(false);
    if (want !== "idle" || inGesture()) awaitRest(null);
    if (want !== "idle") {
      if (!fresh && !viewMoved) return;
      props.onBeforeQuery?.();
      facade.setCursor(world);
      const preview = facade.preview(world);
      under = { ...NOTHING_UNDER, preview, hover: want === "select" && !inGesture() ? facade.hover(world) : null };
      return;
    }
    if (inGesture()) {
      under = NOTHING_UNDER;
      return;
    }
    if (fresh) {
      props.onBeforeQuery?.();
      const grip = gripsShown() ? facade.gripAt(world) : null;
      under = atRest(grip === null ? facade.hover(world) : null, grip);
      awaitRest(grip, moved);
      return;
    }
    if (viewMoved) {
      under = NOTHING_UNDER;
      awaitRest(null);
    }
  };

  /**
   * Put the label beside the point it names: clear of the marker, off the rubber band and on the
   * far side of where the band comes from, kept inside the canvas (`placeLabel`); hidden with
   * nothing to say.
   */
  const placeSnapLabel = (label: Under["label"], rect: Rect, runsOn: boolean): void => {
    if (snapLabel === undefined || labelMode === undefined || labelText === undefined) return;
    if (label === null) {
      if (!snapLabel.hidden) snapLabel.hidden = true;
      return;
    }
    if (labelMode.textContent !== label.mode) labelMode.textContent = label.mode;
    if (labelText.textContent !== label.text) labelText.textContent = label.text;
    snapLabel.hidden = false;
    const base = props.base?.() ?? null;
    const toward = base === null ? null : worldToScreen(rect, size, base);
    const to = placeLabel(worldToScreen(rect, size, label.at), { w: snapLabel.offsetWidth, h: snapLabel.offsetHeight }, size, toward, runsOn);
    snapLabel.style.transform = `translate(${Math.round(to.x)}px, ${Math.round(to.y)}px)`;
  };

  /**
   * Draw what follows the pointer on its own canvas, once, and only when it differs from what is
   * there: a pointer crossing empty drawing at rest draws nothing, and the display list is not
   * drawn again for a rubber band.
   */
  const paintOverlay = (): void => {
    const list = read(props.display);
    if (overlay === undefined || !measured() || list === undefined) return;
    const rect = view();
    const scale = dpr();
    const marks = gripsShown() ? { size: grips.size, list: grips.grips, hover: under.grip?.id ?? null, collected } : null;
    const empty = overlayIsEmpty(under) && under.label === null && marks === null;
    const sized = overlay.width === pixels.w && overlay.height === pixels.h;
    if (empty && overlaid === null && sized) return;
    const was = overlaid;
    const selected = under.hover !== null && (read(props.selection) ?? []).includes(under.hover);
    if (was !== null && sized && was.under === under && was.list === list && was.palette === palette && was.dpr === scale && was.grips === grips && was.collected === collected && was.selected === selected && sameRect(was.rect, rect)) return;
    if (overlay.width !== pixels.w) overlay.width = pixels.w;
    if (overlay.height !== pixels.h) overlay.height = pixels.h;
    placeSnapLabel(under.label, rect, under.guide !== null && under.guide.paths.prims.length > 0);
    const ctx = overlay.getContext("2d");
    if (ctx === null) return;
    if (empty) {
      // Resizing cleared it already; a canvas that kept its size is wiped.
      if (sized) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
      overlaid = null;
      return;
    }
    drawOverlay(ctx, list, rect, { width: size.w, height: size.h, dpr: scale, palette, hover: under.hover, hoverSelected: selected, preview: under.preview, snap: under.snap, guide: under.guide, grips: marks });
    overlaid = { under, list, rect, dpr: scale, palette, grips, collected, selected };
  };

  /**
   * The frame: hand the shell the view the pointer made, then draw once. A view whose shape is
   * not the canvas's would draw stretched (the first view of a drawing, a view an engine command
   * set), so it is widened around its centre first. Telling the shell re-runs the effect below,
   * which asks for another frame; that request is dropped, since this frame draws what it wants.
   */
  const flush = (): void => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    if (measured() && isStretched(view(), size)) {
      fitted = view();
      fitBox = shown;
      local = fitAspect(fitted, size);
    }
    if (local !== null) {
      const next = local;
      local = null;
      props.onViewChange(next, size);
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    }
    paint();
    syncGrips();
    ask();
    paintOverlay();
  };

  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(flush);
  };

  /** Move the view from the pointer: applied now for the math, shown and reported at the frame. */
  const setLocal = (rect: Rect): void => {
    fitted = null;
    local = rect;
    schedule();
  };

  // A frame when the display list, the view or the selection changes (the revision is what the
  // facade bumps). The sources are read here so the effect tracks them; the frame reads them again.
  createEffect(() => {
    read(props.display);
    read(props.view);
    read(props.selection);
    read(props.wants);
    props.engineState?.();
    props.gripEditing?.();
    props.base?.();
    schedule();
  });

  onCleanup(() => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    awaitDwell(false);
    awaitRest(null);
    if (longPress !== 0) clearTimeout(longPress);
  });

  onMount(() => {
    if (stage !== undefined) {
      const host = stage;
      palette = paletteFrom(host);
      /**
       * Take the canvas's size. The backing store is the box in whole device pixels (the
       * observer's own count where the browser gives one, so a fractional CSS box or a fractional
       * pixel ratio still maps one canvas pixel to one device pixel), and the drawing's CSS size
       * is that count over the ratio. The observer runs before the frame is painted and the draw
       * happens in it, so a panel dragged wider never shows a stretched or an empty frame.
       */
      const measure = (entry?: ResizeObserverEntry): void => {
        const scale = dpr();
        const box = host.getBoundingClientRect();
        const device = entry?.devicePixelContentBoxSize?.[0];
        // The observer's count is the snapped one, so it is within a pixel of the box times the
        // ratio; a count further off was taken at another ratio (an emulated screen) and is not used.
        const snap = (counted: number | undefined, css: number): number =>
          counted !== undefined && Math.abs(counted - css * scale) <= 1 ? Math.round(counted) : Math.round(css * scale);
        const pxW = snap(device?.inlineSize, box.width);
        const pxH = snap(device?.blockSize, box.height);
        // Hidden (the assistant covers the editor in a narrow window): there is nothing to draw
        // on, and the view waits as it is for the canvas to come back.
        if (!(pxW > 0) || !(pxH > 0)) {
          size = { w: 0, h: 0 };
          return;
        }
        if (pixels.w !== pxW || pixels.h !== pxH) pixels = { w: pxW, h: pxH };
        const next: ScreenBox = { left: box.left, top: box.top, w: pxW / scale, h: pxH / scale };
        size = { w: next.w, h: next.h };
        // The canvas changed size (a panel folded, a window resize): a view the hand has moved
        // stays where it is in the window, at its zoom; a view still as it was fitted is fitted
        // again. A first measure has no box to keep and goes to the fit.
        // A fitted view under which only the bottom edge moved a little (the command line took
        // or gave back a row) stays put too, so a point about to be picked does not move.
        if (shown !== null && (shown.w !== next.w || shown.h !== next.h)) {
          if (fitted === null) local = resizeView(view(), shown, next);
          else if (fitBox !== null && holdsFit(fitted, fitBox, next, read(props.extents) ?? null)) local = resizeView(fitAspect(fitted, fitBox), fitBox, next);
          else {
            local = fitAspect(fitted, next);
            fitBox = next;
          }
        }
        shown = next;
        // The engine sizes its pick box and its snap aperture by the canvas: tell it the truth.
        if ((toldSize.w !== next.w || toldSize.h !== next.h) && props.facade.setViewport(next.w, next.h).ok) toldSize = { w: next.w, h: next.h };
        flush();
      };
      const observer = new ResizeObserver((entries) => measure(entries[entries.length - 1]));
      observer.observe(host);
      onCleanup(() => observer.disconnect());
      // A change of pixel ratio alone (the window moved to another screen, the page zoomed with
      // the box unchanged) resizes nothing: watch the ratio itself, and watch again from each new
      // one. The first call is the first measure.
      let ratio: MediaQueryList | null = null;
      const onRatio = (): void => {
        ratio?.removeEventListener("change", onRatio);
        ratio = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        ratio.addEventListener("change", onRatio);
        measure();
      };
      onRatio();
      onCleanup(() => ratio?.removeEventListener("change", onRatio));
      // The inks are tokens, and a theme may change them under a canvas that is already drawn.
      const onTheme = (): void => {
        const next = paletteFrom(host);
        if (samePalette(next, palette)) return;
        palette = next;
        schedule();
      };
      const theme = new MutationObserver(onTheme);
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
      onCleanup(() => theme.disconnect());
    }
    if (stage !== undefined) {
      const host = stage;
      // The focus ring shows only when the keyboard brought the focus here: Tab, F6, or the
      // panel's key handing it over. A press on the drawing brings it with no ring, and a key
      // pressed afterwards (a function key, Escape, a letter on its way to the command line)
      // frames nothing. A focus handed back by something that had borrowed it (a menu closing on
      // Escape) shows what showed when it was lent.
      let arrival: "walk" | "key" | null = null;
      let ringWas = false;
      const setRing = (on: boolean): void => {
        if (on) host.dataset["focusRing"] = "";
        else delete host.dataset["focusRing"];
      };
      const onKeyArrival = (e: KeyboardEvent): void => {
        if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
        const walk = e.key === "Tab" || e.key === "F6" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j");
        arrival = walk ? "walk" : "key";
      };
      const onPressArrival = (e: PointerEvent): void => {
        arrival = null;
        if (e.target instanceof Node && host.contains(e.target)) setRing(false);
      };
      const onFocus = (e: FocusEvent): void => {
        if (e.target === host) setRing(arrival === "walk" || (arrival === "key" && ringWas));
      };
      const onBlur = (e: FocusEvent): void => {
        if (e.target !== host) return;
        ringWas = host.dataset["focusRing"] !== undefined;
        setRing(false);
      };
      window.addEventListener("keydown", onKeyArrival, true);
      window.addEventListener("pointerdown", onPressArrival, true);
      host.addEventListener("focus", onFocus);
      host.addEventListener("blur", onBlur);
      onCleanup(() => {
        window.removeEventListener("keydown", onKeyArrival, true);
        window.removeEventListener("pointerdown", onPressArrival, true);
        host.removeEventListener("focus", onFocus);
        host.removeEventListener("blur", onBlur);
      });
    }
    // Shift and Ctrl bend the point while they are held (ortho's override, ARC's direction): a key
    // that goes down or up under a still pointer asks the engine again, without a move or a click.
    const onModifier = (e: KeyboardEvent): void => {
      if (e.key !== "Shift" && e.key !== "Control") return;
      if (held.shift === e.shiftKey && held.ctrl === e.ctrlKey) return;
      held = { shift: e.shiftKey, ctrl: e.ctrlKey };
      if (pointer === null || wants() !== "point") return;
      pointerMoved = true;
      schedule();
    };
    // A window that loses the keyboard never hears the key come up.
    const onBlur = (): void => {
      held = { shift: false, ctrl: false };
    };
    window.addEventListener("keydown", onModifier);
    window.addEventListener("keyup", onModifier);
    window.addEventListener("blur", onBlur);
    onCleanup(() => {
      window.removeEventListener("keydown", onModifier);
      window.removeEventListener("keyup", onModifier);
      window.removeEventListener("blur", onBlur);
    });
    if (canvas !== undefined) {
      // Wheel must be non-passive to stop the page from scrolling (and, for a pinch, the browser
      // from zooming the page) while the drawing zooms.
      const onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const anchor = localPoint(e.clientX, e.clientY);
        if (anchor === null) return;
        const factor = wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey);
        if (factor === 1) return;
        const next = zoomAt(view(), size, anchor, factor);
        const now = view();
        if (next.x0 === now.x0 && next.y0 === now.y0 && next.x1 === now.x1 && next.y1 === now.y1) return;
        setLocal(next);
      };
      canvas.addEventListener("wheel", onWheel, { passive: false });
      onCleanup(() => canvas?.removeEventListener("wheel", onWheel));
    }
  });

  /** Give the running command the point under a client position, in the view on screen. */
  const givePoint = (clientX: number, clientY: number): void => {
    // The shell and the engine read the view: hand it over before the point made in it.
    flush();
    const world = worldAt(clientX, clientY);
    if (world !== null) props.onPoint?.(world, worldPerPixel());
  };

  /** Name the gesture in hand on the canvas, which is what sets its cursor (canvas.css). */
  const setGesture = (gesture: "pan" | "select" | null): void => {
    if (canvas === undefined) return;
    if (gesture === null) delete canvas.dataset["gesture"];
    else if (canvas.dataset["gesture"] !== gesture) canvas.dataset["gesture"] = gesture;
  };

  const hideMarquee = (): void => {
    if (marquee !== undefined && !marquee.hidden) marquee.hidden = true;
  };

  /** Stretch the selection rectangle between the press and the pointer (the stage's CSS px). */
  const showMarquee = (d: Drag, clientX: number, clientY: number): void => {
    const box = stage?.getBoundingClientRect();
    if (marquee === undefined || box === undefined) return;
    const kind = dragKind(clientX - d.downX, clientY - d.downY, clickSlop(d.pointerType));
    if (kind === "click") {
      hideMarquee();
      return;
    }
    marquee.dataset["kind"] = kind;
    marquee.style.setProperty("--marquee-x", `${Math.min(d.downX, clientX) - box.left}px`);
    marquee.style.setProperty("--marquee-y", `${Math.min(d.downY, clientY) - box.top}px`);
    marquee.style.setProperty("--marquee-w", `${Math.abs(clientX - d.downX)}px`);
    marquee.style.setProperty("--marquee-h", `${Math.abs(clientY - d.downY)}px`);
    marquee.hidden = false;
  };

  /** Two middle clicks: the engine's own zoom to the extents, adopted as the view. */
  const zoomExtents = (): void => {
    const env = props.facade.zoomExtents();
    if (!env.ok) {
      props.onNotice(env.error);
      return;
    }
    const rect = props.facade.viewRect();
    if (rect !== null) setLocal(rect);
  };

  /** Hold the pointer for the element, so the gesture goes on outside the canvas and the window. */
  const capture = (e: PointerEvent): void => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const release = (e: PointerEvent): void => {
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  /**
   * Wait for a lone finger's press to become a long one, or (null) stop waiting. A press that is
   * still in hand, still inside the click slop and still alone when the time is up asks for the
   * menu and is over: nothing follows from its travel or its lift.
   */
  const awaitLongPress = (d: Drag | null): void => {
    if (longPress !== 0) clearTimeout(longPress);
    longPress =
      d === null
        ? 0
        : window.setTimeout(() => {
            longPress = 0;
            if (drag !== d || d.moved || touches.size !== 1) return;
            drag = null;
            props.onMenu?.({ at: { x: d.downX, y: d.downY, source: "touch" }, heldMs: LONG_PRESS_MS, moved: false });
          }, LONG_PRESS_MS);
  };

  /** Note where a mouse or a pen is, for the frame to ask the engine about. */
  const track = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return;
    pointer = { x: e.clientX, y: e.clientY };
    held = { shift: e.shiftKey, ctrl: e.ctrlKey };
    pointerMoved = true;
    // The menu a rest opened goes when the pointer has left its grip for the drawing (on its way
    // to the menu it crosses a few pixels of drawing, and is then off the canvas).
    if (restMenu !== null && Math.hypot(e.clientX - restMenu.x, e.clientY - restMenu.y) > GRIP_MENU_LEASH) {
      restMenu = null;
      props.onGripMenu?.(null);
    }
    schedule();
  };

  /**
   * A left press at rest while the selection shows grips: true when a grip took it, so it is no
   * pick and starts no rectangle. A plain press starts the grip's edit and holds the press, to
   * see whether it is dragged; Shift collects the grip; a list grip opens its choices.
   */
  const pressGrip = (e: PointerEvent): boolean => {
    if (!gripsShown()) return false;
    // The engine sizes a grip's reach by the view: hand it the view on screen first.
    flush();
    const grip = gripUnder(e.clientX, e.clientY);
    const press = gripPress(grip, e.shiftKey, collected);
    if (grip === null || press.kind === "none") return false;
    stopRest();
    restMenu = null;
    if (press.kind === "collect") {
      collected = press.collected.size === 0 ? NONE_COLLECTED : press.collected;
      schedule();
      return true;
    }
    if (press.kind === "menu") {
      const at = gripMenuAt(grip);
      if (at !== null) props.onGripMenu?.({ grip, at, rest: false });
      return true;
    }
    collected = NONE_COLLECTED;
    if (props.onGripStart?.(press.ids) === true) {
      gripHold = { pointerId: e.pointerId, pointerType: e.pointerType, downX: e.clientX, downY: e.clientY, dragged: false };
      capture(e);
    }
    schedule();
    return true;
  };

  const onPointerDown = (e: PointerEvent): void => {
    track(e);
    if (e.pointerType === "touch") {
      // A third finger (or a palm) joins nothing: the first two hold the view.
      if (touches.size >= 2) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // The second finger makes it a pan and pinch; whatever the first was doing is not a click.
      drag = touches.size === 1 ? { pointerId: e.pointerId, pointerType: e.pointerType, button: 0, mode: "pan", downX: e.clientX, downY: e.clientY, x: e.clientX, y: e.clientY, moved: false } : null;
      awaitLongPress(drag);
      hideMarquee();
      setGesture(null);
      e.preventDefault();
      capture(e);
      return;
    }
    // The right button's press is only noted: its release asks for the menu. One made while a
    // press is in hand (a pen's barrel button over a finger's pan) asks for nothing.
    if (e.button === 2) {
      rightDown = drag === null && touches.size === 0 ? { at: e.timeStamp, x: e.clientX, y: e.clientY } : null;
      return;
    }
    // One press at a time: a second button, or a pen while a finger is down, starts nothing.
    if (drag !== null || gripHold !== null || touches.size > 0) return;
    if (e.button !== 0 && e.button !== 1) return;
    // A left press is left to the browser, which moves the keyboard into the drawing as a click
    // does (without the keyboard's focus ring), so what is typed next goes to the command line;
    // the stage selects no text (canvas.css), so the drag that follows selects none either.
    if (e.button === 1) {
      // The middle press is ours alone: no autoscroll, no paste.
      e.preventDefault();
      const again = lastMiddle !== null && e.timeStamp - lastMiddle.at <= DOUBLE_CLICK_MS && dragKind(e.clientX - lastMiddle.x, e.clientY - lastMiddle.y, clickSlop(e.pointerType)) === "click";
      lastMiddle = again ? null : { at: e.timeStamp, x: e.clientX, y: e.clientY };
      if (again) {
        zoomExtents();
        return;
      }
    }
    if (e.button === 0) {
      const want = wants();
      // A grip under the press takes it, before a pick or a rectangle.
      if (want === "idle" && pressGrip(e)) return;
      // A command that wants a point takes it where the button goes down, as a CAD program does:
      // there is no release to wait for, and the travel that may follow is not a rectangle.
      if (want === "point") {
        givePoint(e.clientX, e.clientY);
        return;
      }
      // One that wants a keyword, a number or text takes nothing from the left button.
      if (want === "typed") return;
    }
    // A finger has no second button: its drag pans, and two fingers pan and pinch. A mouse or a pen
    // drags a selection rectangle with the left button and pans with the middle one.
    const mode = e.button === 0 && e.pointerType !== "touch" && props.onSelectRect !== undefined ? "select" : "pan";
    drag = { pointerId: e.pointerId, pointerType: e.pointerType, button: e.button, mode, downX: e.clientX, downY: e.clientY, x: e.clientX, y: e.clientY, moved: false };
    capture(e);
  };

  /** Move the live press: nothing inside the click slop, then the whole travel from the press. */
  const moveDrag = (d: Drag, e: PointerEvent): void => {
    if (!d.moved) {
      if (dragKind(e.clientX - d.downX, e.clientY - d.downY, clickSlop(d.pointerType)) === "click") return;
      d.moved = true;
      lastMiddle = null;
      awaitLongPress(null);
      setGesture(d.mode);
    }
    if (d.mode === "select") {
      showMarquee(d, e.clientX, e.clientY);
      return;
    }
    // The pan starts from where the press went down, so the point that was grabbed is the point
    // under the pointer: the slop is not lost travel.
    if (measured()) setLocal(panBy(view(), size, e.clientX - d.x, e.clientY - d.y));
    d.x = e.clientX;
    d.y = e.clientY;
  };

  /** Apply a pointer's move to the gesture it belongs to, if any. */
  const movePointer = (e: PointerEvent): void => {
    if (e.pointerType === "touch") {
      const was = touches.get(e.pointerId);
      if (was === undefined) return;
      const now = { x: e.clientX, y: e.clientY };
      touches.set(e.pointerId, now);
      if (touches.size === 2) {
        const origin = canvas?.getBoundingClientRect();
        const other = [...touches].find(([id]) => id !== e.pointerId)?.[1];
        if (origin === undefined || other === undefined || !measured()) return;
        const at = (p: Point): Point => ({ x: p.x - origin.left, y: p.y - origin.top });
        setLocal(pinchView(view(), size, pinchOf(at(was), at(other)), pinchOf(at(now), at(other))));
        return;
      }
    }
    if (gripHold !== null && gripHold.pointerId === e.pointerId && !gripHold.dragged) {
      gripHold.dragged = gripGesture(e.clientX - gripHold.downX, e.clientY - gripHold.downY, gripHold.pointerType) === "drag";
    }
    if (drag !== null && drag.pointerId === e.pointerId) moveDrag(drag, e);
  };

  const onPointerMove = (e: PointerEvent): void => {
    movePointer(e);
    track(e);
    // Reported after the move is applied: while panning, the point under the pointer is the one
    // that was grabbed, and the readout says so.
    const world = worldAt(e.clientX, e.clientY);
    if (world !== null) props.onCursor?.(world);
  };

  /**
   * A pointer is done: lifted (`up`), cancelled by the system, or its capture was taken away.
   * Only a lift can pick or select; the other two just let go, so no press is ever left stuck.
   */
  const endPointer = (e: PointerEvent, up: boolean): void => {
    if (e.pointerType === "touch") {
      if (!touches.delete(e.pointerId)) return;
      awaitLongPress(null);
      // One of two fingers lifted: the other carries on as a pan from where it is, and its lift
      // will not be a click.
      if (touches.size === 1 && drag === null) {
        const rest = [...touches][0];
        if (rest !== undefined) drag = { pointerId: rest[0], pointerType: "touch", button: 0, mode: "pan", downX: rest[1].x, downY: rest[1].y, x: rest[1].x, y: rest[1].y, moved: true };
        release(e);
        return;
      }
    }
    // The press that started a grip edit is done. Dragged, its lift is the point that commits the
    // edit, if the edit still runs and wants one (Escape may have ended it under the hand); a
    // press that was a click leaves the edit following the pointer, for the next click to commit.
    const hold = gripHold;
    if (hold !== null && hold.pointerId === e.pointerId) {
      gripHold = null;
      release(e);
      if (up && e.button === 0 && hold.dragged && wants() === "point" && measured()) givePoint(e.clientX, e.clientY);
      return;
    }
    const d = drag;
    if (d === null || d.pointerId !== e.pointerId) return;
    drag = null;
    setGesture(null);
    hideMarquee();
    release(e);
    // The gesture is over: what is under the pointer shows again.
    if (d.moved) track(e);
    if (!up || d.button !== 0 || !measured()) return;
    // The shell picks and selects through the engine's view: hand it the view first.
    flush();
    const want = wants();
    if (!d.moved) {
      // A finger's tap while a command wants a point, and any click while it wants objects, is
      // that point; a click at rest picks.
      if (want === "point" || want === "select") givePoint(e.clientX, e.clientY);
      else if (want === "idle") {
        const world = worldAt(e.clientX, e.clientY);
        if (world !== null) props.onPick?.(world, e.shiftKey, worldPerPixel() * pickReach(d.pointerType));
      }
      return;
    }
    if (d.mode !== "select") return;
    const kind = dragKind(e.clientX - d.downX, e.clientY - d.downY, clickSlop(d.pointerType));
    const a = worldAt(d.downX, d.downY);
    const b = worldAt(e.clientX, e.clientY);
    if (kind === "click" || a === null || b === null) return;
    props.onSelectRect?.({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }, kind, e.shiftKey, worldPerPixel());
  };

  /** The right button came up over the drawing: its press asks for the menu, where it was released. */
  const onPointerUp = (e: PointerEvent): void => {
    const press = e.button === 2 && e.pointerType !== "touch" ? rightDown : null;
    if (press === null) {
      endPointer(e, true);
      return;
    }
    rightDown = null;
    const moved = dragKind(e.clientX - press.x, e.clientY - press.y, clickSlop(e.pointerType)) !== "click";
    // A right click on a grip is the grip's: its own menu when it has one, and never the
    // selection's menu, which is for the objects.
    if (wants() === "idle" && gripsShown()) {
      flush();
      const grip = gripUnder(e.clientX, e.clientY);
      if (grip !== null) {
        const at = grip.multi ? gripMenuAt(grip) : null;
        stopRest();
        restMenu = null;
        if (at !== null) props.onGripMenu?.({ grip, at, rest: false });
        return;
      }
    }
    props.onMenu?.({ at: { x: e.clientX, y: e.clientY, source: "pointer" }, heldMs: e.timeStamp - press.at, moved });
  };

  /**
   * The browser's menu never opens over the drawing. The right button's own menu is asked for
   * when the button comes up (`onPointerUp`: this event arrives before that on some systems and
   * after it on others) and a finger's when its press has lasted (`awaitLongPress`). What is left
   * is the keyboard's menu key: the menu opens where the pointer last was, or at the middle of
   * the drawing, unless a press is in hand.
   */
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    if (e.button === 2 || (typeof PointerEvent !== "undefined" && e instanceof PointerEvent && e.pointerType === "touch")) return;
    const box = stage?.getBoundingClientRect();
    if (drag !== null || touches.size > 0 || box === undefined) return;
    const at = pointer ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    props.onMenu?.({ at: { x: at.x, y: at.y, source: "keyboard" }, heldMs: 0, moved: false });
  };

  /** The pointer left: what followed it is cleared at once, not at the next frame. */
  const onPointerLeave = (): void => {
    props.onCursor?.(null);
    if (pointer === null) return;
    pointer = null;
    flush();
  };

  return (
    <div class="canvas-stage" ref={stage} role="img" aria-label="Drawing" aria-describedby={helpId} tabindex="0" onContextMenu={onContextMenu}>
      <canvas
        ref={canvas}
        class="canvas"
        data-wants={wants() === "point" ? "point" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => endPointer(e, false)}
        onLostPointerCapture={(e) => endPointer(e, false)}
        onPointerLeave={onPointerLeave}
      />
      <canvas ref={overlay} class="canvas-overlay" aria-hidden="true" />
      <div class="canvas-snap-label" ref={snapLabel} hidden aria-hidden="true">
        <span class="canvas-snap-mode" ref={labelMode} />
        <span ref={labelText} />
      </div>
      <div class="canvas-marquee" ref={marquee} hidden aria-hidden="true" />
      <p id={helpId} hidden>
        {CANVAS_HELP}
      </p>
    </div>
  );
}
