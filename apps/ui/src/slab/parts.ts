/**
 * What main.tsx hands the app when the Slab shell is on: the shell and the panels already ported
 * to Slab, as components. `../app.tsx` imports this type only, so the standard interface carries
 * no code of the Slab shell.
 */

import type { Component } from "solid-js";
import type { BenchPanelProps } from "../components/BenchPanel";
import type { SlabShellProps } from "./SlabShell";

export interface SlabParts {
  Shell: Component<SlabShellProps>;
  /** The Bench section; absent when its document did not load, and the SolidJS one is shown. */
  Bench?: Component<BenchPanelProps>;
}
