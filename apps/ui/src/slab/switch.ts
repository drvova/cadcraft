/**
 * Which shell the interface is laid out by. The Slab shell is the default; `?shell=standard` in
 * the address asks for the SolidJS shell, and then no part of Slab is requested or mounted.
 * `?shell=slab` asks for the Slab shell by name, which changes one thing: when the toolchain was
 * never built here, the page says so. Without it the standard shell is shown and nothing is said,
 * since a checkout that has not built Slab is an ordinary one (the artifacts are never committed).
 */

export type ShellChoice = "standard" | "slab";

export interface ShellAsk {
  shell: ShellChoice;
  /** The address named the shell: its absence is then worth a line. */
  asked: boolean;
}

/** What the address asks for. */
export function shellChoice(search: string): ShellAsk {
  let value: string | null;
  try {
    value = new URLSearchParams(search).get("shell");
  } catch {
    return { shell: "slab", asked: false };
  }
  if (value === "standard") return { shell: "standard", asked: true };
  return { shell: "slab", asked: value === "slab" };
}

/** What is said, once, when the Slab shell was asked for by name and the toolchain was never built here. */
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
