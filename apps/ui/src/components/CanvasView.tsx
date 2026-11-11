/**
 * The canvas surface: a `<canvas>` that draws `display()` through the view rectangle, pans by
 * dragging and zooms by wheel around the pointer. A left click that did not move the view is a
 * pick (`onPick(worldPoint, shiftKey)`); every pointer move reports the world position through
 * `onCursor`, and leaving the canvas reports null. The component owns pointer state and the
 * device-pixel-ratio sizing; the actual drawing lives in ../canvas.ts and the view math in
 * ../view.ts.
 *
 * The canvas is pointer-only by nature, so its wrapper is exposed as an image named "Drawing"
 * whose description says how to work without a pointer: the command line is the keyboard path.
 * The wrapper takes the keyboard's focus (Tab, F6) so the drawing is a place the keyboard can be:
 * the shell sends what is typed there to the command line and cancels on Escape.
 *
 * The props accept the value or the accessor form (the shell may hand either); the component
 * reads both.
 */

import { createEffect, createUniqueId, onCleanup, onMount, type Accessor, type JSX } from "solid-js";
import type { DisplayList } from "../display";
import type { AppFacade } from "../facade";
import { drawDisplay, paletteFrom, type Palette } from "../canvas";
import { fitAspect, panBy, screenToWorld, zoomAt, type Point, type Rect, type ScreenSize } from "../view";

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
   * size of one CSS pixel (so the caller can size the engine's pick aperture for this canvas).
   */
  onPick?: (point: Point, add: boolean, worldPerPixel: number) => void;
  /** The world position under the pointer; null when the pointer leaves the canvas. */
  onCursor?: (point: Point | null) => void;
}

/** How far (CSS px) the pointer may move and still count as a click rather than a drag. */
export const CLICK_SLOP = 3;

const FALLBACK_PALETTE: Palette = { canvas: "#181818", gridMinor: "#202020", gridMajor: "#2a2a2a", axisX: "#552633", axisY: "#23412f", selection: "#81a1c1" };

/** What the canvas is and how to work on it without a pointer: its accessible description. */
export const CANVAS_HELP =
  "The drawing area. With a pointer: drag to pan, turn the wheel to zoom, click an object to select it. With the keyboard: type a command, such as LINE, ZOOM or PAN, and it goes to the command line; Enter or Space repeats the last command, or accepts the running command's default; Escape cancels the running command; F6 moves to the next part of the window.";

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

/**
 * The view after the canvas changed size from `from` to `to`: the same world point at the centre
 * and the same world size per pixel (the zoom), so the drawing keeps its place and its scale and
 * the new room shows more of it (or less), as a CAD window does.
 */
function resizeView(rect: Rect, from: ScreenSize, to: ScreenSize): Rect {
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const halfW = ((rect.x1 - rect.x0) / from.w) * to.w * 0.5;
  const halfH = ((rect.y1 - rect.y0) / from.h) * to.h * 0.5;
  if (!Number.isFinite(halfW) || !Number.isFinite(halfH) || !(halfW > 0) || !(halfH > 0)) return rect;
  return { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH };
}

export function CanvasView(props: CanvasViewProps): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let stage: HTMLDivElement | undefined;
  const helpId = createUniqueId();
  /** The canvas in CSS px: its backing store's whole device pixels over the pixel ratio. */
  let size: ScreenSize = { w: 0, h: 0 };
  /** The backing store the canvas should have, in device pixels. */
  let pixels: ScreenSize = { w: 0, h: 0 };
  /** The size the view was last fitted to; it survives the canvas being hidden (a size of zero). */
  let shown: ScreenSize | null = null;
  let palette: Palette = FALLBACK_PALETTE;
  /** The live drag; `moved` records whether the pointer left the click slop. */
  let dragging: { pointerId: number; x: number; y: number; downX: number; downY: number; moved: boolean; button: number } | null = null;

  const dpr = (): number => {
    const raw = typeof window === "undefined" ? 1 : window.devicePixelRatio;
    return Math.max(0.25, Math.min(8, Number.isFinite(raw) && raw > 0 ? raw : 1));
  };

  const view = (): Rect => read(props.view) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };

  /** The world point under a pointer event, or null when the canvas box is unavailable. */
  const worldAt = (e: PointerEvent): Point | null => {
    const rect = canvas?.getBoundingClientRect();
    if (rect === undefined) return null;
    return screenToWorld(view(), size, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const redraw = (): void => {
    // Read the reactive sources first: an early return before these reads would leave the
    // effect untracked and the canvas would never redraw (the size arrives after first run).
    const list = read(props.display);
    const rect = view();
    const selection = read(props.selection);
    if (canvas === undefined || size.w <= 0 || size.h <= 0 || list === undefined) return;
    const scale = dpr();
    if (canvas.width !== pixels.w) canvas.width = pixels.w;
    if (canvas.height !== pixels.h) canvas.height = pixels.h;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      props.onNotice("this browser has no 2D canvas context");
      return;
    }
    const highlighted = selection !== undefined && selection.length > 0 ? new Set(selection) : undefined;
    drawDisplay(ctx, list, rect, { width: size.w, height: size.h, dpr: scale, palette, grid: true, ...(highlighted === undefined ? {} : { selection: highlighted }) });
  };

  /**
   * A view whose shape is not the canvas's would draw stretched (the first view of a drawing, a
   * view an engine command set): widen it around its centre until nothing is cropped.
   */
  const refit = (): void => {
    const rect = view();
    if (isStretched(rect, size)) props.onViewChange(fitAspect(rect, size));
  };

  // Redraw when the display list, the view or the selection changes (the revision is what the
  // facade bumps).
  createEffect(() => {
    refit();
    redraw();
  });

  onMount(() => {
    if (stage !== undefined) {
      const host = stage;
      palette = paletteFrom(host);
      /**
       * Take the canvas's size. The backing store is the box in whole device pixels (the
       * observer's own count where the browser gives one, so a fractional CSS box or a fractional
       * pixel ratio still maps one canvas pixel to one device pixel), and the drawing's CSS size
       * is that count over the ratio.
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
        pixels = { w: pxW, h: pxH };
        size = { w: pxW / scale, h: pxH / scale };
        // The canvas changed size (a panel folded, a window resize): the drawing keeps its centre
        // and its zoom. A first measure has no size to keep and goes straight to the fit.
        if (shown !== null && (shown.w !== size.w || shown.h !== size.h)) props.onViewChange(resizeView(view(), shown, size));
        shown = size;
        refit();
        redraw();
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
    }
    if (canvas !== undefined) {
      // Wheel must be non-passive to stop the page from scrolling while zooming.
      const onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const rect = canvas?.getBoundingClientRect();
        if (rect === undefined) return;
        const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const factor = Math.exp((Number.isFinite(e.deltaY) ? e.deltaY : 0) / 400);
        props.onViewChange(zoomAt(view(), size, anchor, factor));
      };
      canvas.addEventListener("wheel", onWheel, { passive: false });
      onCleanup(() => canvas?.removeEventListener("wheel", onWheel));
    }
  });

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return;
    dragging = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, downX: e.clientX, downY: e.clientY, moved: false, button: e.button };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent): void => {
    const world = worldAt(e);
    if (world !== null) props.onCursor?.(world);
    if (dragging === null || dragging.pointerId !== e.pointerId) return;
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    dragging = { ...dragging, x: e.clientX, y: e.clientY };
    if (!dragging.moved && Math.hypot(e.clientX - dragging.downX, e.clientY - dragging.downY) > CLICK_SLOP) {
      dragging = { ...dragging, moved: true };
    }
    props.onViewChange(panBy(view(), size, dx, dy));
  };

  const endDrag = (e: PointerEvent): void => {
    if (dragging === null || dragging.pointerId !== e.pointerId) return;
    const wasClick = !dragging.moved && dragging.button === 0;
    dragging = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!wasClick) return;
    const world = worldAt(e);
    if (world !== null) {
      const rect = view();
      const perPixel = size.w > 0 ? (rect.x1 - rect.x0) / size.w : 0;
      props.onPick?.(world, e.shiftKey, Number.isFinite(perPixel) && perPixel > 0 ? perPixel : 0);
    }
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
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
      <p id={helpId} hidden>
        {CANVAS_HELP}
      </p>
    </div>
  );
}
