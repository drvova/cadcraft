/**
 * The test preload imports Solid's client build by its deep path, because bun resolves the
 * package's `node` condition to the server build, which throws on every DOM call. The deep path
 * ships no types of its own, so they are re-exported from the package entry here.
 */
declare module "solid-js/web/dist/web.js" {
  export * from "solid-js/web";
}
