/**
 * Save Render: a picture, a turntable or a contact sheet of the piece, in Realistic mode, saved as
 * a file for a client. It opens from the 3D tab's bar ("Save render…") and from the commands
 * `ui.render.image`, `ui.render.turntable` and `ui.render.sheet` (the palette and View ▸ Render),
 * each with its kind chosen. Every choice is a list (no free text to refuse). The drawing is
 * `../render-export-run`'s, off screen in one context; the file goes out the way Download STL's
 * does (`downloadBytes`), in the browser and the desktop app's webview alike.
 *
 * While a turntable is drawn the dialog says the frame it is on (a live status line and a
 * progress bar), Cancel stops it at the next frame, and the page stays responsive (the run
 * yields between frames). A render that cannot run says why in words.
 */

import { createEffect, createMemo, createSignal, on, Show, type JSX } from "solid-js";
import { downloadBytes } from "../files";
import {
  ANGLE_OPTIONS,
  ASPECT_OPTIONS,
  BACKGROUND_OPTIONS,
  exportFileName,
  FPS_OPTIONS,
  IMAGE_SIZES,
  isChoice,
  KIND_OPTIONS,
  pictureSize,
  TURNTABLE_SIZES,
  videoFormat,
  type AngleChoice,
  type AspectChoice,
  type BackgroundChoice,
  type ExportKind,
  type VideoFormat,
} from "../render-export";
import { Cancelled, loadPiece, renderContactSheet, renderStill, renderTurntable, webmType, type Control, type Execute, type Progress, type Rendered } from "../render-export-run";
import type { Camera } from "../view3d";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Select } from "../ui/Select";
import "../dialogs.css";

/** The one request to open the dialog, with the kind to show: the bar's button and the commands set it. */
const [request, setRequest] = createSignal<ExportKind | null>(null);

/** Open Save Render on a kind (the bar's button, the `ui.render.*` commands). */
export function openRenderExport(kind: ExportKind): void {
  setRequest(kind);
}

/** The kind a `ui.render.*` command opens, or null for any other id. */
export function renderKindOf(id: string): ExportKind | null {
  if (id === "ui.render.image") return "image";
  if (id === "ui.render.turntable") return "turntable";
  if (id === "ui.render.sheet") return "sheet";
  return null;
}

/** The 3D tab bar's hook: one button that opens Save Render on a still. */
export function RenderExportButtons(): JSX.Element {
  return (
    <Button variant="quiet" size="sm" title="Save a picture, a turntable or a contact sheet for a client" onClick={() => openRenderExport("image")}>
      Save render…
    </Button>
  );
}

export interface RenderExportDialogProps {
  execute: Execute;
  /** The 3D stage's Perspective camera as it was left; null when the stage has not been shown. */
  camera: () => Camera | null;
}

const SECONDS = [2, 4, 6, 8, 10, 15, 20];
const TILTS = [0, 10, 20, 30, 45, 60];
const sizeOptions = (sizes: readonly number[]): { value: string; label: string }[] => sizes.map((n) => ({ value: String(n), label: `${n} px` }));
const FORMAT_OPTIONS: { value: VideoFormat; label: string }[] = [
  { value: "webm", label: "WebM video" },
  { value: "apng", label: "Animated PNG" },
];

function megabytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function words(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.charAt(0).toUpperCase() + text.slice(1) + (text.endsWith(".") ? "" : ".");
}

export function RenderExportDialog(props: RenderExportDialogProps): JSX.Element {
  const [kind, setKind] = createSignal<ExportKind>("image");
  const [imageSize, setImageSize] = createSignal(2048);
  const [videoSize, setVideoSize] = createSignal(720);
  const [aspect, setAspect] = createSignal<AspectChoice>("square");
  const [angle, setAngle] = createSignal<AngleChoice>("current");
  const [background, setBackground] = createSignal<BackgroundChoice>("studio");
  const [seconds, setSeconds] = createSignal(4);
  const [fps, setFps] = createSignal(30);
  const [tilt, setTilt] = createSignal(20);
  const [format, setFormat] = createSignal<VideoFormat>("webm");
  const [busy, setBusy] = createSignal(false);
  const [progress, setProgress] = createSignal<Progress | null>(null);
  const [said, setSaid] = createSignal("");
  const [failed, setFailed] = createSignal("");
  let control: Control = { cancelled: false };

  const open = (): boolean => request() !== null;
  // The kind the request named is the one shown when the dialog opens.
  createEffect(
    on(request, (asked) => {
      if (asked === null) return;
      setKind(asked);
      setSaid("");
      setFailed("");
    }),
  );

  const close = (): void => {
    control.cancelled = true;
    setRequest(null);
  };

  const recorder = webmType();
  const chosenFormat = createMemo(() => videoFormat(background(), recorder !== null, format()));

  const save = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    setSaid("");
    setFailed("");
    setProgress(null);
    const mine: Control = { cancelled: false, onProgress: setProgress };
    control = mine;
    try {
      const piece = await loadPiece(props.execute);
      if (typeof piece === "string") {
        setFailed(piece);
        return;
      }
      const title = piece.model.title;
      let done: Rendered;
      let name: string;
      if (kind() === "image") {
        const size = pictureSize(imageSize(), aspect());
        done = await renderStill(piece.mesh, { ...size, angle: angle(), background: background(), current: props.camera() });
        name = exportFileName(title, `${done.width}x${done.height}`, "png");
      } else if (kind() === "turntable") {
        const size = pictureSize(videoSize(), aspect());
        const pick = chosenFormat();
        done = await renderTurntable(piece.mesh, { ...size, seconds: seconds(), fps: fps(), tilt: tilt(), background: background(), format: pick.format }, mine);
        if (pick.note !== null) done = { ...done, note: done.note === null ? pick.note : `${pick.note} ${done.note}` };
        name = exportFileName(title, "turntable", pick.format === "webm" ? "webm" : "png");
      } else {
        done = await renderContactSheet(piece.mesh, piece.model, background());
        name = exportFileName(title, "contact sheet", "png");
      }
      if (mine.cancelled) return;
      const bytes = new Uint8Array(await done.blob.arrayBuffer());
      downloadBytes(name, bytes, done.blob.type === "" ? "application/octet-stream" : done.blob.type);
      const frames = done.frames > 4 ? `, ${done.frames} frames` : "";
      setSaid(`Saved “${name}”: ${done.width} × ${done.height}${frames}, ${megabytes(bytes.length)}, in ${(done.ms / 1000).toFixed(1)} s.${done.note === null ? "" : ` ${done.note}`}`);
    } catch (error) {
      if (error instanceof Cancelled) setSaid("Cancelled: nothing was saved.");
      else setFailed(words(error));
    } finally {
      if (control === mine) {
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const cancel = (): void => {
    if (busy()) {
      control.cancelled = true;
      return;
    }
    close();
  };

  const row = (label: string, id: string, control: JSX.Element): JSX.Element => (
    <div class="jewelry-row">
      <div class="drafting-pair">
        <label class="drafting-label" for={id}>
          {label}
        </label>
        {control}
      </div>
    </div>
  );

  const num = (setter: (n: number) => void) => (value: string) => {
    const n = Number(value);
    if (Number.isFinite(n)) setter(n);
  };

  return (
    <Dialog
      open={open()}
      title="Save Render"
      size="sm"
      describedBy="render-intro"
      dismissOnBackdrop={!busy()}
      onClose={() => cancel()}
      footer={
        <>
          <Button onClick={cancel}>{busy() ? "Stop" : "Close"}</Button>
          <Button variant="primary" type="submit" disabled={busy()} title={busy() ? "A render is being drawn" : undefined} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div class="jewelry">
        <p class="drafting-help" id="render-intro">
          The piece in Realistic mode, drawn off screen at up to twice the size and scaled down, saved as a file for a client.
        </p>
        {row("Export", "render-kind", <Select id="render-kind" value={kind()} options={KIND_OPTIONS} disabled={busy()} onChange={(v) => isChoice(KIND_OPTIONS, v) && setKind(v)} />)}
        <Show when={kind() !== "sheet"}>
          {row(
            "Size",
            "render-size",
            <Select
              id="render-size"
              value={String(kind() === "image" ? imageSize() : videoSize())}
              options={sizeOptions(kind() === "image" ? IMAGE_SIZES : TURNTABLE_SIZES)}
              disabled={busy()}
              onChange={num(kind() === "image" ? setImageSize : setVideoSize)}
            />,
          )}
          {row("Shape", "render-aspect", <Select id="render-aspect" value={aspect()} options={ASPECT_OPTIONS} disabled={busy()} onChange={(v) => isChoice(ASPECT_OPTIONS, v) && setAspect(v)} />)}
        </Show>
        <Show when={kind() === "image"}>
          {row("View", "render-angle", <Select id="render-angle" value={angle()} options={ANGLE_OPTIONS} disabled={busy()} onChange={(v) => isChoice(ANGLE_OPTIONS, v) && setAngle(v)} />)}
        </Show>
        {row("Background", "render-background", <Select id="render-background" value={background()} options={BACKGROUND_OPTIONS} disabled={busy()} onChange={(v) => isChoice(BACKGROUND_OPTIONS, v) && setBackground(v)} />)}
        <Show when={kind() === "turntable"}>
          {row("Length", "render-seconds", <Select id="render-seconds" value={String(seconds())} options={SECONDS.map((n) => ({ value: String(n), label: `${n} seconds` }))} disabled={busy()} onChange={num(setSeconds)} />)}
          {row("Frame rate", "render-fps", <Select id="render-fps" value={String(fps())} options={FPS_OPTIONS.map((n) => ({ value: String(n), label: `${n} frames a second` }))} disabled={busy()} onChange={num(setFps)} />)}
          {row("Tilt", "render-tilt", <Select id="render-tilt" value={String(tilt())} options={TILTS.map((n) => ({ value: String(n), label: `${n}° above` }))} disabled={busy()} onChange={num(setTilt)} />)}
          {row("Format", "render-format", <Select id="render-format" value={format()} options={FORMAT_OPTIONS} disabled={busy()} describedBy="render-format-note" onChange={(v) => isChoice(FORMAT_OPTIONS, v) && setFormat(v)} />)}
          <Show when={chosenFormat().note}>
            {(note) => (
              <p class="drafting-help" id="render-format-note">
                {note()}
              </p>
            )}
          </Show>
        </Show>
        <Show when={progress()}>
          {(p) => (
            <div class="jewelry-row">
              <progress class="render-progress" max={p().total} value={p().done} aria-label="Render progress" />
            </div>
          )}
        </Show>
        <p class="drafting-help" role="status" aria-live="polite">
          {progress() !== null ? `${progress()?.phase ?? ""} frame ${progress()?.done ?? 0} of ${progress()?.total ?? 0}…` : busy() ? "Drawing…" : said()}
        </p>
        <Show when={failed() !== ""}>
          <p class="drafting-summary" role="alert">
            {failed()}
          </p>
        </Show>
      </div>
    </Dialog>
  );
}
