/**
 * The elements `slab/pricebook.slab` and `slab/jewelry-dialog.slab` define (`./loader`:
 * SLAB_TAGS), for the JSX type check, beside those of `./jsx.d.ts`.
 */

import "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "cadcraft-pricebook": HTMLAttributes<HTMLElement>;
      "cadcraft-jewelry-dialog": HTMLAttributes<HTMLElement>;
      "cadcraft-drafting": HTMLAttributes<HTMLElement>;
      "cadcraft-template-gallery": HTMLAttributes<HTMLElement>;
      "cadcraft-layer-manager": HTMLAttributes<HTMLElement>;
    }
  }
}
