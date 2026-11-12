/**
 * The elements the compiled Slab documents define (`./loader`: SLAB_TAGS), for the JSX type check.
 * They are ordinary custom elements to SolidJS; their params are set through `./types`.
 */

import "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "cadcraft-shell": HTMLAttributes<HTMLElement>;
      "slab-bench-panel": HTMLAttributes<HTMLElement>;
    }
  }
}
