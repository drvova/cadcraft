/**
 * The one switch the Slab shell is behind: `?shell=slab` in the address. Anything else, and no
 * part of Slab is requested, compiled into the first paint or mounted: the interface is the
 * SolidJS shell it has always been.
 */

export type ShellChoice = "default" | "slab";

/** What the address asks for. */
export function shellChoice(search: string): ShellChoice {
  let value: string | null;
  try {
    value = new URLSearchParams(search).get("shell");
  } catch {
    return "default";
  }
  return value === "slab" ? "slab" : "default";
}

/** What is said, once, when the switch is on and the toolchain was never built here. */
export const SLAB_ABSENT = "The Slab shell is not built here (bun run build:slab in apps/ui); showing the standard interface.";

/** What is said when the artifacts are there and do not load. */
export function slabFailed(reason: string): string {
  const line = reason.replace(/\s+/g, " ").trim().slice(0, 160);
  return `The Slab shell did not load (${line === "" ? "unknown error" : line}); showing the standard interface.`;
}

/**
 * The same, for one part of the shell (a section, the status bar, the tabs): the shell itself is
 * shown, and only that part is the standard one. `reason` is what the loader said of the document.
 */
export function slabPartNotice(part: string, reason: string): string {
  return reason.replace("The Slab shell did not load", `The Slab ${part} did not load`).replace("showing the standard interface.", "showing the standard one in its place.");
}
