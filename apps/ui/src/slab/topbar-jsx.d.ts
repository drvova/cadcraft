/**
 * The element `slab/topbar.slab` defines (`./loader`: SLAB_TAGS), for the JSX type check, beside
 * those of `./jsx.d.ts` and `./chrome-jsx.d.ts`.
 */

import "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "cadcraft-topbar": HTMLAttributes<HTMLElement>;
    }
  }
}
