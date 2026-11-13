/**
 * Round stroke ends for the glyphs of a Slab surface (the ribbon's, the title bar's).
 */

/**
 * The interface's glyphs are drawn with round ends and round corners (`../icons`: `ToolIcon`), and
 * a point of a figure is a subpath of no length, which only a round end draws. The web driver at
 * the pinned commit strokes a path with the browser's defaults (flat ends, sharp corners; its SVG
 * export rounds both), and the language has no attribute for either. The surface's shadow tree is
 * open, so the two properties are given to its paths there. Nothing else in a surface that asks for this is a path.
 */
const ROUND_STROKES = ".slab-ops svg path { stroke-linecap: round; stroke-linejoin: round; }";

export function roundStrokes(host: HTMLElement): void {
  const root = host.shadowRoot;
  if (root === null) return;
  if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in root) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(ROUND_STROKES);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return;
    } catch {
      // An engine that refuses a constructed sheet takes the element below.
    }
  }
  const style = host.ownerDocument.createElement("style");
  style.textContent = ROUND_STROKES;
  root.appendChild(style);
}
