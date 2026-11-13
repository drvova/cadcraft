/**
 * The element `slab/properties.slab` defines (`./loader`: SLAB_TAGS), for the JSX type check,
 * beside those of `./jsx.d.ts`.
 */

import "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "slab-properties-panel": HTMLAttributes<HTMLElement>;
    }
  }
}
