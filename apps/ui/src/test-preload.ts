/**
 * The test DOM: happy-dom registers the globals, and three seams make Solid's hyperscript usable
 * under bun's own JSX transform (the app's JSX is compiled by the Vite plugin; bun has none).
 * Which transform bun uses depends on its version: the classic one calls `React.createElement`,
 * so `globalThis.React` is pointed at `solid-js/h` (the same hyperscript `src/icons.ts` draws
 * with); the automatic one imports `jsxDEV` from `solid-js/jsx-dev-runtime`, so that specifier is
 * answered by a virtual module over the same factory. The h runtime's own `solid-js/web` import is
 * remapped to the client build, because bun resolves the package's `node` condition to the server
 * build otherwise. Tests only; the app never loads this file.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

import { plugin } from "bun";
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

const Fragment = (props: { children?: unknown }): unknown => props.children;

// The classic transform (`React.createElement(type, props, ...children)`), which older buns emit.
(globalThis as unknown as { React: { createElement: ElementFactory; Fragment: typeof Fragment } }).React = {
  createElement,
  Fragment,
};

/**
 * The automatic transform (`jsxDEV(type, props)`, children inside the props), which bun 1.4 emits
 * for this tsconfig (`jsx: preserve` with a `jsxImportSource`). Solid maps `solid-js/jsx-runtime` and
 * `solid-js/jsx-dev-runtime` to its main module, which exports no `jsx`/`jsxDEV` (its JSX is
 * compiled by the Vite plugin, never called), so both specifiers are answered here instead.
 */
const jsx = (type: unknown, props?: Record<string, unknown> | null, key?: unknown): unknown => {
  const { children, ...rest } = props ?? {};
  const all = key === undefined ? rest : { ...rest, key };
  return Array.isArray(children) ? createElement(type, all, ...(children as unknown[])) : createElement(type, all, children);
};

const jsxRuntime = { jsx, jsxs: jsx, jsxDEV: jsx, Fragment };

plugin({
  name: "solid-jsx-runtime-for-tests",
  setup(build) {
    for (const specifier of ["solid-js/jsx-runtime", "solid-js/jsx-dev-runtime"]) {
      build.module(specifier, () => ({ exports: jsxRuntime, loader: "object" }));
    }
  },
});
