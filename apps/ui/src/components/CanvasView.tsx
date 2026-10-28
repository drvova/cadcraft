/**
 * The canvas surface: a `<canvas>` that draws `display()` through the view rectangle, pans by
 * dragging and zooms by wheel around the pointer. The component owns pointer state and the
 * device-pixel-ratio sizing; the actual drawing lives in ../canvas.ts and the view math in
 * ../view.ts.
 */

import { createEffect, onCleanup, onMount, type Accessor, type JSX } from "solid-js";
import type { DisplayList } from "../display";
import type { AppFacade } from "../facade";
import { drawDisplay, paletteFrom, type Palette } from "../canvas";
import { panBy, zoomAt, type Rect } from "../view";

export interface CanvasViewProps {
  facade: AppFacade;
  view: Accessor<Rect>;
  display: Accessor<DisplayList>;
  onViewChange: (rect: Rect) => void;
  onNotice: (message: string | null) => void;
}

const FALLBACK_PALETTE: Palette = { canvas: "#181818", gridMinor: "#202020", gridMajor: "#2a2a2a", axisX: "#552633", axisY: "#23412f" };

export function CanvasView(props: CanvasViewProps): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let stage: HTMLDivElement | undefined;
  let size = { w: 0, h: 0 };
  let palette: Palette = FALLBACK_PALETTE;
  let dragging: { pointerId: number; x: number; y: number } | null = null;

  const dpr = (): number => {
    const raw = typeof window === "undefined" ? 1 : window.devicePixelRatio;
    return Math.max(0.25, Math.min(8, Number.isFinite(raw) && raw > 0 ? raw : 1));
  };

  const redraw = (): void => {
    // Read the reactive sources first: an early return before these reads would leave the
    // effect untracked and the canvas would never redraw (the size arrives after first run).
    const list = props.display();
    const view = props.view();
    if (canvas === undefined || size.w <= 0 || size.h <= 0) return;
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
    drawDisplay(ctx, list, view, { width: size.w, height: size.h, dpr: scale, palette, grid: true });
  };

  // Redraw when the display list or the view changes (the revision is what the facade bumps).
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
        props.onViewChange(zoomAt(props.view(), size, anchor, factor));
      };
      canvas.addEventListener("wheel", onWheel, { passive: false });
      onCleanup(() => canvas?.removeEventListener("wheel", onWheel));
    }
  });

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return;
    dragging = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (dragging === null || dragging.pointerId !== e.pointerId) return;
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    dragging = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    props.onViewChange(panBy(props.view(), size, dx, dy));
  };

  const endDrag = (e: PointerEvent): void => {
    if (dragging === null || dragging.pointerId !== e.pointerId) return;
    dragging = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
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
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
