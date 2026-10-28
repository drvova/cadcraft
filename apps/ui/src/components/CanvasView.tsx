/**
 * The canvas surface: a `<canvas>` that draws `display()` through the view rectangle, pans by
 * dragging and zooms by wheel around the pointer. A left click that did not move the view is a
 * pick (`onPick(worldPoint, shiftKey)`); every pointer move reports the world position through
 * `onCursor`, and leaving the canvas reports null. The component owns pointer state and the
 * device-pixel-ratio sizing; the actual drawing lives in ../canvas.ts and the view math in
 * ../view.ts.
 *
 * The props accept the value or the accessor form (the shell may hand either); the component
 * reads both.
 */

import { createEffect, onCleanup, onMount, type Accessor, type JSX } from "solid-js";
import type { DisplayList } from "../display";
import type { AppFacade } from "../facade";
import { drawDisplay, paletteFrom, type Palette } from "../canvas";
import { panBy, screenToWorld, zoomAt, type Point, type Rect } from "../view";

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

/** Read a prop that may be a value or an accessor. */
function read<T>(value: T | Accessor<T> | undefined): T | undefined {
  if (value === undefined) return undefined;
  return typeof value === "function" ? (value as Accessor<T>)() : value;
}

export function CanvasView(props: CanvasViewProps): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let stage: HTMLDivElement | undefined;
  let size = { w: 0, h: 0 };
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
    const pxW = Math.max(1, Math.round(size.w * scale));
    const pxH = Math.max(1, Math.round(size.h * scale));
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      props.onNotice("this browser has no 2D canvas context");
      return;
    }
    const highlighted = selection !== undefined && selection.length > 0 ? new Set(selection) : undefined;
    drawDisplay(ctx, list, rect, { width: size.w, height: size.h, dpr: scale, palette, grid: true, ...(highlighted === undefined ? {} : { selection: highlighted }) });
  };

  // Redraw when the display list, the view or the selection changes (the revision is what the
  // facade bumps).
  createEffect(redraw);

  onMount(() => {
    if (stage !== undefined) {
      palette = paletteFrom(stage);
      const measure = (): void => {
        size = { w: stage?.clientWidth ?? 0, h: stage?.clientHeight ?? 0 };
        redraw();
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(stage);
      onCleanup(() => observer.disconnect());
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
    <div class="canvas-stage" ref={stage}>
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
    </div>
  );
}
