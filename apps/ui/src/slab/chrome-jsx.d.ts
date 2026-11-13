/**
 * The elements `slab/statusbar.slab` and `slab/tabs.slab` define (`./loader`: SLAB_TAGS), for the
 * JSX type check, beside those of `./jsx.d.ts`.
 */

import "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "cadcraft-statusbar": HTMLAttributes<HTMLElement>;
      "cadcraft-tabs": HTMLAttributes<HTMLElement>;
      "cadcraft-ribbon": HTMLAttributes<HTMLElement>;
    }
  }
}
