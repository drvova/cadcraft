/**
 * The canvas surface: a `<canvas>` that draws `display()` through the view rectangle and is worked
 * with the pointer. The wheel zooms about the pointer; the middle button's drag pans, and so does a
 * finger's; the left button's drag is a selection rectangle (`onSelectRect`, or a pan without it); two fingers
 * pan and pinch about their centre; two middle clicks zoom to the drawing's extents. A left press
 * that stayed inside the click slop is a pick (`onPick(worldPoint, shiftKey, worldPerPixel)`);
 * every pointer move reports the world position through `onCursor`, and leaving reports null.
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
 * on Escape.
 *
 * The props accept the value or the accessor form (the shell may hand either); the component
 * reads both.
 */

import { createEffect, createUniqueId, onCleanup, onMount, type Accessor, type JSX } from "solid-js";
import type { DisplayList } from "../display";
import type { AppFacade } from "../facade";
import { drawDisplay, paletteFrom, samePalette, type Palette } from "../canvas";
import { clickSlop, dragKind, pickReach, sameSelection } from "../selection";
import { fitAspect, panBy, pinchOf, pinchView, resizeView, screenToWorld, wheelZoomFactor, zoomAt, type Point, type Rect, type ScreenBox, type ScreenSize } from "../view";
import "../canvas.css";

export { CLICK_SLOP } from "../selection";

export interface CanvasViewProps {
  facade: AppFacade;
  view: Rect | Accessor<Rect>;
  display: DisplayList | Accessor<DisplayList>;
  /** Handles to highlight (the engine's hex strings); absent highlights nothing. */
  selection?: readonly string[] | Accessor<readonly string[]>;
  onViewChange: (rect: Rect) => void;
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
  onSelectRect?: (rect: Rect, kind: "window" | "crossing", shift: boolean) => void;
}

const FALLBACK_PALETTE: Palette = { canvas: "#181818", gridMinor: "#202020", gridMajor: "#2a2a2a", axisX: "#552633", axisY: "#23412f", selection: "#81a1c1" };

/** What the canvas is and how to work on it without a pointer: its accessible description. */
export const CANVAS_HELP =
  "The drawing area. With a pointer: click an object to select it, drag a rectangle to select several (to the right for those inside it, to the left for those it touches), drag with the middle button to pan, turn the wheel to zoom. With the keyboard: type a command, such as LINE, ZOOM or PAN, and it goes to the command line; Enter or Space repeats the last command, or accepts the running command's default; Escape cancels the running command; F6 moves to the next part of the window.";

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
  /** The pending animation frame, or 0. */
  let frame = 0;
  let drawn: Drawn | null = null;
  /** The live single-pointer press. */
  let drag: Drag | null = null;
  /** The touches that are down (client px), by pointer id; the first two drive the view. */
  const touches = new Map<number, Point>();
  /** The last lone middle press, for the double click. */
  let lastMiddle: { at: number; x: number; y: number } | null = null;

  const dpr = (): number => {
    const raw = typeof window === "undefined" ? 1 : window.devicePixelRatio;
    return Math.max(0.25, Math.min(8, Number.isFinite(raw) && raw > 0 ? raw : 1));
  };

  const view = (): Rect => local ?? read(props.view) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };

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

  /**
   * The frame: hand the shell the view the pointer made, then draw once. A view whose shape is
   * not the canvas's would draw stretched (the first view of a drawing, a view an engine command
   * set), so it is widened around its centre first. Telling the shell re-runs the effect below,
   * which asks for another frame; that request is dropped, since this frame draws what it wants.
   */
  const flush = (): void => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    if (measured() && isStretched(view(), size)) local = fitAspect(view(), size);
    if (local !== null) {
      const next = local;
      local = null;
      props.onViewChange(next);
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    }
    paint();
  };

  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(flush);
  };

  /** Move the view from the pointer: applied now for the math, shown and reported at the frame. */
  const setLocal = (rect: Rect): void => {
    local = rect;
    schedule();
  };

  // A frame when the display list, the view or the selection changes (the revision is what the
  // facade bumps). The sources are read here so the effect tracks them; the frame reads them again.
  createEffect(() => {
    read(props.display);
    read(props.view);
    read(props.selection);
    schedule();
  });

  onCleanup(() => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
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
        // The canvas changed size (a panel folded, a window resize): the drawing stays where it
        // is in the window, at its zoom. A first measure has no box to keep and goes to the fit.
        if (shown !== null && (shown.w !== next.w || shown.h !== next.h)) local = resizeView(view(), shown, next);
        shown = next;
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

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "touch") {
      // A third finger (or a palm) joins nothing: the first two hold the view.
      if (touches.size >= 2) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // The second finger makes it a pan and pinch; whatever the first was doing is not a click.
      drag = touches.size === 1 ? { pointerId: e.pointerId, pointerType: e.pointerType, button: 0, mode: "pan", downX: e.clientX, downY: e.clientY, x: e.clientX, y: e.clientY, moved: false } : null;
      hideMarquee();
      setGesture(null);
      e.preventDefault();
      capture(e);
      return;
    }
    // One press at a time: a second button, or a pen while a finger is down, starts nothing.
    if (drag !== null || touches.size > 0) return;
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
    if (drag !== null && drag.pointerId === e.pointerId) moveDrag(drag, e);
  };

  const onPointerMove = (e: PointerEvent): void => {
    movePointer(e);
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
      // One of two fingers lifted: the other carries on as a pan from where it is, and its lift
      // will not be a click.
      if (touches.size === 1 && drag === null) {
        const rest = [...touches][0];
        if (rest !== undefined) drag = { pointerId: rest[0], pointerType: "touch", button: 0, mode: "pan", downX: rest[1].x, downY: rest[1].y, x: rest[1].x, y: rest[1].y, moved: true };
        release(e);
        return;
      }
    }
    const d = drag;
    if (d === null || d.pointerId !== e.pointerId) return;
    drag = null;
    setGesture(null);
    hideMarquee();
    release(e);
    if (!up || d.button !== 0 || !measured()) return;
    // The shell picks and selects through the engine's view: hand it the view first.
    flush();
    const rect = view();
    if (!d.moved) {
      const world = worldAt(e.clientX, e.clientY);
      const perPixel = ((rect.x1 - rect.x0) / size.w) * pickReach(d.pointerType);
      if (world !== null) props.onPick?.(world, e.shiftKey, Number.isFinite(perPixel) && perPixel > 0 ? perPixel : 0);
      return;
    }
    if (d.mode !== "select") return;
    const kind = dragKind(e.clientX - d.downX, e.clientY - d.downY, clickSlop(d.pointerType));
    const a = worldAt(d.downX, d.downY);
    const b = worldAt(e.clientX, e.clientY);
    if (kind === "click" || a === null || b === null) return;
    props.onSelectRect?.({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }, kind, e.shiftKey);
  };

  const onPointerLeave = (): void => {
    props.onCursor?.(null);
  };

  return (
    <div class="canvas-stage" ref={stage} role="img" aria-label="Drawing" aria-describedby={helpId} tabindex="0">
      <canvas
        ref={canvas}
        class="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, true)}
        onPointerCancel={(e) => endPointer(e, false)}
        onLostPointerCapture={(e) => endPointer(e, false)}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div class="canvas-marquee" ref={marquee} hidden aria-hidden="true" />
      <p id={helpId} hidden>
        {CANVAS_HELP}
      </p>
    </div>
  );
}
