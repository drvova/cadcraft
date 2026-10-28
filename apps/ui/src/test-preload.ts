/**
 * The test DOM: happy-dom registers the globals, and two seams make Solid's hyperscript usable
 * under bun's own JSX transform. Bun compiles JSX to `React.createElement`, so `globalThis.React`
 * is pointed at `solid-js/h` (the same hyperscript `src/icons.ts` draws with), and the h runtime's
 * own `solid-js/web` import is remapped to the client build, because bun resolves the package's
 * `node` condition to the server build otherwise. Tests only; the app never loads this file.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

import { mock } from "bun:test";

mock.module("solid-js/web", () => import("solid-js/web/dist/web.js"));

const h = (await import("solid-js/h")).default;

type ElementFactory = (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;

/**
 * `solid-js/h` treats a zero-argument function prop as a reactive accessor and calls it at read
 * time. A test's `onClick={() => count++}` is a plain handler, so it is given an event parameter
 * before h sees it, and reads as a value again.
 */
function asHandlers(props: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    out[key] =
      key.startsWith("on") && typeof value === "function" && value.length === 0
        ? (event: Event) => (value as (event: Event) => unknown)(event)
        : value;
  }
  return out;
}

const createElement: ElementFactory = (type, props, ...children) => {
  const built = h(type, { ...asHandlers(props), children: children.length > 1 ? children : children[0] });
  return typeof built === "function" ? (built as () => unknown)() : built;
};

(globalThis as unknown as { React: { createElement: ElementFactory; Fragment: (props: { children?: unknown }) => unknown } }).React = {
  createElement,
  Fragment: (props) => props.children,
};
