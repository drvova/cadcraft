/**
 * What main.tsx hands the app when the Slab shell is on: the shell and the panels already ported
 * to Slab, as components. `../app.tsx` imports this type only, so the standard interface carries
 * no code of the Slab shell.
 */

import type { Component } from "solid-js";
import type { BenchPanelProps } from "../components/BenchPanel";
import type { LayersPanelProps } from "../components/LayersPanel";
import type { PiecePanelProps } from "../components/PiecePanel";
import type { ObjectsPanelProps } from "../components/ObjectsPanel";
import type { SlabShellProps } from "./SlabShell";

export interface SlabParts {
  Shell: Component<SlabShellProps>;
  /** The Bench section; absent when its document did not load, and the SolidJS one is shown. */
  Bench?: Component<BenchPanelProps>;
  /** The Layers section; absent when its document did not load, and the SolidJS one is shown. */
  Layers?: Component<LayersPanelProps>;
  /** The Piece section; absent when its document did not load, and the SolidJS one is shown. */
  Piece?: Component<PiecePanelProps>;
  /** The Objects section; absent when its document did not load, and the SolidJS one is shown. */
  Objects?: Component<ObjectsPanelProps>;
}
