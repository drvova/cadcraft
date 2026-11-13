/**
 * The Tech Sheet's state (`./components/TechSheet`): the sheet read from the engine when the view
 * opens and when the drawing changes under it, the display mode and the background, and the four
 * stills drawn one at a time with each tile's phase. The sheet model is `./techsheet`'s, the stills
 * are `./render3d`'s, and this file holds the signals and the order things are done in (it was the
 * component's body).
 *
 * Each drawn still is held as an object URL (an `<img>`'s source; revoked when it is replaced). A
 * render that cannot run (no WebGL) leaves its tile `failed` with the words.
 */

import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js";
import type { Envelope } from "./facade";
import { renderPieceStill, type StillOptions } from "./render3d";
import { assembleSheet, failedCount, freshTiles, meshRequest, nextPending, setTile, wantsInk, type SheetBackground, type SheetModel, type Tile } from "./techsheet";
import { isDisplayMode, type DisplayMode, type PieceMesh, type StandardView, type Vec3 } from "./view3d";

/** What the sheet is given by the shell. */
export interface TechSheetStateProps {
  open: boolean;
  execute: (command: string, params: unknown) => Envelope | Promise<Envelope>;
  revision: number;
}

/** Each view is drawn at this many device pixels a side; a square tile frames a ring from any side. */
export const RENDER_PX = 640;
/** A mode or background change waits this long before the four stills are drawn again. */
export const DEBOUNCE_MS = 140;

/** Draws one still. Swapped in tests, where there is no WebGL. */
export type SheetStillDrawer = (mesh: PieceMesh, options: StillOptions) => Promise<Blob>;

export interface TechSheetOptions {
  /** The element whose tokens colour a still (`--paper`, `--paper-ink`); absent before it mounts. */
  colors: () => Element | undefined;
  draw?: SheetStillDrawer;
}

/** The drawn stills, by the view they are of. */
export type StillUrls = Partial<Record<StandardView, string>>;

export interface TechSheetState {
  model: Accessor<SheetModel | null>;
  loading: Accessor<boolean>;
  mode: Accessor<DisplayMode>;
  background: Accessor<SheetBackground>;
  tiles: Accessor<Tile[]>;
  urls: Accessor<StillUrls>;
  chooseMode: (value: string) => void;
  chooseBackground: (value: string) => void;
  /** The checks heading's words: "All pass", "1 of 4 fail", or "" with no piece. */
  checksNote: () => string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A token's colour as red, green and blue in 0…1 (the browser paints one pixel and it is read
 * back), so a still's background and ink come from the sheet's own tokens. Null when it cannot be read.
 */
function tokenColor(element: Element, token: string, probe: CanvasRenderingContext2D | null): Vec3 | null {
  const value = getComputedStyle(element).getPropertyValue(token).trim();
  if (value === "" || probe === null || typeof CSS === "undefined" || !CSS.supports("color", value)) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const pixel = probe.getImageData(0, 0, 1, 1).data;
  return [(pixel[0] ?? 0) / 255, (pixel[1] ?? 0) / 255, (pixel[2] ?? 0) / 255];
}

/** The checks heading's words for a sheet. */
export function checksNoteOf(sheet: SheetModel | null): string {
  if (sheet === null || sheet.piece === null) return "";
  const failed = failedCount(sheet);
  return failed === 0 ? "All pass" : `${failed} of ${sheet.checks.length} fail`;
}

export function createTechSheet(props: TechSheetStateProps, options: TechSheetOptions): TechSheetState {
  const draw = options.draw ?? renderPieceStill;
  let probe: CanvasRenderingContext2D | null | undefined;
  const probeOf = (): CanvasRenderingContext2D | null => {
    if (probe === undefined) probe = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    return probe;
  };
  const [model, setModel] = createSignal<SheetModel | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [mode, setMode] = createSignal<DisplayMode>("shaded");
  const [background, setBackground] = createSignal<SheetBackground>("surface");
  const [tiles, setTiles] = createSignal(freshTiles());
  /** The PNG of each drawn view, by the view it is of; revoked when it is replaced. */
  const [urls, setUrls] = createSignal<StillUrls>({});

  /** The newest read: a reply to an older one is dropped (the drawing may have changed under it). */
  let read = 0;
  /** The newest render run: a still from an older one is dropped. */
  let generation = 0;
  let debounce = 0;
  let disposed = false;

  const revokeAll = (): void => {
    for (const url of Object.values(urls())) if (url !== undefined) URL.revokeObjectURL(url);
  };

  /** Read the piece, its fine solid and the bench reply, and assemble the sheet from the three. */
  const load = async (): Promise<void> => {
    const mine = (read += 1);
    setLoading(true);
    const pieceEnv = await props.execute("piece", { query: true });
    if (mine !== read) return;
    const request = meshRequest(pieceEnv);
    const meshEnv: Envelope = request === null ? { ok: false, error: "the drawing has no piece to render" } : await props.execute("piecemesh", { ...request, quality: "fine" });
    if (mine !== read) return;
    const benchEnv = await props.execute("techsheet", {});
    if (mine !== read) return;
    setModel(assembleSheet(pieceEnv, meshEnv, benchEnv));
    setLoading(false);
  };

  /** Draw the four views, one after another, each on the sheet's surface or as a cut-out. */
  const renderAll = async (mesh: PieceMesh, chosen: DisplayMode, surface: SheetBackground): Promise<void> => {
    const mine = (generation += 1);
    revokeAll();
    setUrls({});
    setTiles(freshTiles());
    const host = options.colors();
    const background: Vec3 | null = surface === "surface" && host !== undefined ? (tokenColor(host, "--paper", probeOf()) ?? [0.98, 0.98, 0.98]) : null;
    const edgeInk: Vec3 | null = wantsInk(chosen, surface) && host !== undefined ? tokenColor(host, "--paper-ink", probeOf()) : null;
    let next = nextPending(tiles());
    while (next !== null) {
      if (mine !== generation || disposed) return;
      const view = next;
      setTiles((current) => setTile(current, view, "rendering"));
      try {
        const blob = await draw(mesh, { view, mode: chosen, width: RENDER_PX, height: RENDER_PX, background, edgeInk });
        if (mine !== generation || disposed) return;
        const url = URL.createObjectURL(blob);
        setUrls((current) => ({ ...current, [view]: url }));
        setTiles((current) => setTile(current, view, "done"));
      } catch (error) {
        if (mine !== generation || disposed) return;
        setTiles((current) => setTile(current, view, "failed", message(error)));
      }
      next = nextPending(tiles());
    }
  };

  // Read the sheet when the view opens, and again when the drawing changes under it.
  createEffect(
    on(
      () => [props.open, props.revision] as const,
      ([open]) => {
        if (open) void load();
      },
    ),
  );

  // Draw (or redraw) the views when the mesh, the mode or the background changes while open.
  createEffect(() => {
    const mesh = model()?.mesh ?? null;
    const open = props.open;
    const chosen = mode();
    const surface = background();
    if (debounce !== 0) window.clearTimeout(debounce);
    if (!open || mesh === null) return;
    debounce = window.setTimeout(() => {
      debounce = 0;
      void renderAll(mesh, chosen, surface);
    }, DEBOUNCE_MS);
  });

  onCleanup(() => {
    disposed = true;
    if (debounce !== 0) window.clearTimeout(debounce);
    revokeAll();
  });

  return {
    model,
    loading,
    mode,
    background,
    tiles,
    urls,
    chooseMode: (value) => {
      if (isDisplayMode(value)) setMode(value);
    },
    chooseBackground: (value) => {
      if (value === "surface" || value === "transparent") setBackground(value);
    },
    checksNote: () => checksNoteOf(model()),
  };
}
