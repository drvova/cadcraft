import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createTemplateGallery, type TemplateGalleryEdit } from "./template-gallery-edit";
import type { Template, TemplateGroup } from "./templates";

function templateOfItem(groups: readonly TemplateGroup[], item: string): Template | null {
  for (const group of groups) for (const template of group.templates) if (template.id === item) return template;
  return null;
}

interface Opened {
  gallery: TemplateGalleryEdit;
  chosen: Record<string, unknown>[];
  closed: () => number;
  dispose: () => void;
}

/**
 * The gallery's state over a dialog's props, as the dialog makes it. Under `bun test` Solid's
 * core is its server build: effects never run, so the drawing of the stills is not exercised here
 * (it is in the browser run, and the drawer is swapped for one that is never called). The choice is.
 */
function opened(refuse: (params: Record<string, unknown>) => string | null): Opened {
  const chosen: Record<string, unknown>[] = [];
  let closed = 0;
  return createRoot((dispose) => {
    const gallery = createTemplateGallery(
      {
        open: true,
        onClose: () => (closed += 1),
        execute: () => ({ ok: false, error: "unused" }),
        onChoose: (params) => {
          chosen.push(params);
          return refuse(params);
        },
      },
      () => Promise.resolve({ message: "not drawn here" }),
    );
    return { gallery, chosen, closed: () => closed, dispose };
  });
}

describe("the gallery's state", () => {
  test("a template that is built closes the gallery, with its own copy of the parameters", () => {
    const o = opened(() => null);
    const template = templateOfItem(o.gallery.groups, "plain-band");
    if (template === null) throw new Error("no plain band");
    o.gallery.choose(template);
    expect(o.chosen).toEqual([{ ...template.params }]);
    expect(o.chosen[0]).not.toBe(template.params);
    expect(o.closed()).toBe(1);
    expect(o.gallery.note(template)).toBeNull();
    o.dispose();
  });

  test("a refused template leaves the gallery open with the refusal on its card", () => {
    const o = opened(() => "piece: unknown kind `threestone`");
    const template = templateOfItem(o.gallery.groups, "three-stone");
    if (template === null) throw new Error("no three-stone");
    o.gallery.choose(template);
    expect(o.closed()).toBe(0);
    expect(o.gallery.note(template)).toBe("Needs a newer engine for the three-stone setting.");
    const other = templateOfItem(o.gallery.groups, "plain-band");
    if (other === null) throw new Error("no plain band");
    expect(o.gallery.note(other)).toBeNull();
    o.dispose();
  });
});
