/**
 * Browser file I/O for the shell: pick a drawing file, hand bytes to the browser as a download,
 * and turn a drawing title into a file name. No DOM work happens at import time; the functions
 * only touch `document` when the shell calls them (the tests drive `defaultFileName` alone).
 */

/** Open the browser's file picker and read the chosen file; null when nothing was chosen. */
export function pickFile(accept: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  const { promise, resolve } = Promise.withResolvers<{ name: string; bytes: Uint8Array } | null>();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.style.display = "none";
  let settled = false;
  const finish = (value: { name: string; bytes: Uint8Array } | null): void => {
    if (settled) return;
    settled = true;
    window.removeEventListener("focus", onWindowFocus);
    input.remove();
    resolve(value);
  };
  // A cancelled picker fires no `change`; the window regaining focus is the only signal.
  const onWindowFocus = (): void => {
    window.setTimeout(() => {
      if (!settled && (input.files === null || input.files.length === 0)) finish(null);
    }, 300);
  };
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file === undefined) {
      finish(null);
      return;
    }
    file
      .arrayBuffer()
      .then((buffer) => finish({ name: file.name, bytes: new Uint8Array(buffer) }))
      .catch(() => finish(null));
  });
  window.addEventListener("focus", onWindowFocus);
  document.body.append(input);
  input.click();
  return promise;
}

/** Save bytes as a download; the object URL is revoked once the browser has taken the blob. */
export function downloadBytes(name: string, bytes: Uint8Array, mime = "application/dxf"): void {
  // `bytes` is typed `Uint8Array<ArrayBufferLike>`; `BlobPart` wants an ArrayBuffer-backed view,
  // and `slice()` (a copy) is exactly that — downloads are rare, so the copy is not worth an
  // unsafe cast around a possibly-`SharedArrayBuffer` view.
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * A drawing title as a file name: path-hostile characters become underscores, an empty title
 * becomes "Drawing", and a missing extension becomes ".dxf" (an existing one is kept).
 */
export function defaultFileName(title: string): string {
  const cleaned = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  const base = cleaned === "" ? "Drawing" : cleaned;
  if (base.endsWith(".")) return `${base}dxf`;
  if (/\.[A-Za-z0-9]{1,8}$/.test(base)) return base;
  return `${base}.dxf`;
}
