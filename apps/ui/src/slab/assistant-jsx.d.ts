/**
 * The element `slab/assistant.slab` defines (`./loader`: SLAB_TAGS), for the JSX type check,
 * beside those of `./jsx.d.ts`.
 */

import "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "cadcraft-assistant": HTMLAttributes<HTMLElement>;
    }
  }
}
