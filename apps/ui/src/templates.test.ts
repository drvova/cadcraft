/**
 * The template gallery's logic: the preset list is well formed, a template becomes a `piece` call,
 * the list groups by kind, the thumbnail state machine steps one at a time, and a refused build or
 * preview of a template that names a missing feature reads as "needs a newer engine".
 */

import { describe, expect, test } from "bun:test";
import {
  BUILDABLE_KINDS,
  TEMPLATES,
  THUMB_HEIGHT,
  THUMB_WIDTH,
  chooseMessage,
  featureGapMessage,
  groupTemplates,
  initialThumbs,
  markDone,
  markFailed,
  markRendering,
  nextThumb,
  templateKind,
  templateParams,
  thumbMessage,
  type Template,
} from "./templates";

describe("the template list", () => {
  test("ids are unique, non-empty and hyphen-case", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  test("every template has a name, a short blurb and a kind", () => {
    for (const t of TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.name.length).toBeLessThanOrEqual(32);
      expect(t.blurb.length).toBeGreaterThan(0);
      expect(t.blurb.length).toBeLessThanOrEqual(80);
      expect(typeof t.params["kind"]).toBe("string");
    }
  });

  test("every params is a valid-looking piece object: a kind and finite, in-range numbers", () => {
    for (const t of TEMPLATES) {
      for (const [key, value] of Object.entries(t.params)) {
        if (typeof value === "number") {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(1000);
        }
        // Names are short strings; `count` may be null (as many as fit).
        if (typeof value === "string") expect(value.length).toBeLessThanOrEqual(24);
        expect(key.length).toBeGreaterThan(0);
      }
    }
  });

  test("a template on a kind the engine does not build today carries `requires`", () => {
    for (const t of TEMPLATES) {
      if (!BUILDABLE_KINDS.includes(templateKind(t))) expect(typeof t.requires).toBe("string");
    }
  });

  test("the list has a solitaire, a halo, a plain band, a comfort band, an eternity band and a signet", () => {
    const ids = new Set(TEMPLATES.map((t) => t.id));
    for (const id of ["solitaire-round", "halo-solitaire", "plain-band", "comfort-band", "eternity-band", "signet-band"]) {
      expect(ids.has(id)).toBe(true);
    }
    // At least a couple name a feature a newer engine adds.
    expect(TEMPLATES.filter((t) => t.requires !== undefined).length).toBeGreaterThanOrEqual(2);
  });
});

describe("templateParams", () => {
  test("is a fresh object that still carries the kind", () => {
    const t = TEMPLATES[0] as Template;
    const params = templateParams(t);
    expect(params["kind"]).toBe(t.params["kind"]);
    expect(params).not.toBe(t.params);
    params["kind"] = "changed";
    expect(t.params["kind"]).not.toBe("changed");
  });
});

describe("groupTemplates", () => {
  test("groups by kind, the known kinds first, every template placed once", () => {
    const groups = groupTemplates(TEMPLATES);
    const kinds = groups.map((g) => g.kind);
    expect(kinds.slice(0, 3)).toEqual(["solitaire", "band", "eternity"]);
    const placed = groups.flatMap((g) => g.templates);
    expect(placed.length).toBe(TEMPLATES.length);
    expect(new Set(placed.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const group of groups) {
      expect(group.templates.length).toBeGreaterThan(0);
      for (const t of group.templates) expect(templateKind(t)).toBe(group.kind);
    }
  });

  test("an unknown kind becomes its own group after the known ones", () => {
    const made: Template[] = [
      { id: "a", name: "A", blurb: "x", params: { kind: "band" } },
      { id: "b", name: "B", blurb: "x", params: { kind: "threestone" }, requires: "f" },
    ];
    const groups = groupTemplates(made);
    expect(groups.map((g) => g.kind)).toEqual(["band", "threestone"]);
    expect(groups[1]?.label).toBe("Threestones");
  });
});

describe("the thumbnail state machine", () => {
  test("starts every template idle and draws them one at a time, in order", () => {
    const ids = TEMPLATES.map((t) => t.id);
    const [id0, id1, id2] = [ids[0] as string, ids[1] as string, ids[2] as string];
    let thumbs = initialThumbs(TEMPLATES);
    for (const t of TEMPLATES) expect(thumbs[t.id]?.phase).toBe("idle");

    const first = nextThumb(thumbs, TEMPLATES);
    expect(first).toBe(id0);

    // While one is rendering, nothing else starts.
    thumbs = markRendering(thumbs, id0);
    expect(nextThumb(thumbs, TEMPLATES)).toBeNull();

    // When it finishes the next idle one is offered.
    thumbs = markDone(thumbs, id0, "blob:one");
    expect(thumbs[id0]).toEqual({ phase: "done", url: "blob:one", message: null });
    expect(nextThumb(thumbs, TEMPLATES)).toBe(id1);

    // A failure carries its words and still lets the next one start.
    thumbs = markRendering(thumbs, id1);
    thumbs = markFailed(thumbs, id1, "no WebGL");
    expect(thumbs[id1]).toEqual({ phase: "failed", url: null, message: "no WebGL" });
    expect(nextThumb(thumbs, TEMPLATES)).toBe(id2);
  });

  test("offers nothing once every thumbnail is done or failed", () => {
    let thumbs = initialThumbs(TEMPLATES);
    for (const t of TEMPLATES) thumbs = markDone(thumbs, t.id, `blob:${t.id}`);
    expect(nextThumb(thumbs, TEMPLATES)).toBeNull();
  });

  test("the render size is a sane, capped pair", () => {
    expect(THUMB_WIDTH).toBeGreaterThan(0);
    expect(THUMB_HEIGHT).toBeGreaterThan(0);
    expect(THUMB_WIDTH).toBeLessThanOrEqual(1024);
    expect(THUMB_HEIGHT).toBeLessThanOrEqual(1024);
  });
});

describe("not-in-build kinds", () => {
  const needsCourt = TEMPLATES.find((t) => t.id === "court-band") as Template;
  const plain = TEMPLATES.find((t) => t.id === "plain-band") as Template;

  test("a required feature maps a refusal to a friendly line; a plain template does not", () => {
    expect(featureGapMessage(needsCourt, "`profile` must be flat or dome")).toBe("Needs a newer engine for the court profile.");
    expect(featureGapMessage(plain, "`profile` must be flat or dome")).toBeNull();
    // An empty refusal is not dressed up.
    expect(featureGapMessage(needsCourt, "   ")).toBeNull();
  });

  test("chooseMessage and thumbMessage use the friendly line, else the engine's words", () => {
    expect(chooseMessage(needsCourt, "`profile` must be flat or dome")).toBe("Needs a newer engine for the court profile.");
    expect(chooseMessage(plain, "the band has no size")).toBe("the band has no size");
    expect(thumbMessage(needsCourt, "`kind` must be band, solitaire or eternity")).toBe("Needs a newer engine for the court profile.");
    // The whole command missing reads the same for every card.
    expect(thumbMessage(plain, "unknown command `piecemesh`")).toBe("3D preview is not available in this build.");
    expect(thumbMessage(plain, "the drawing has no piece")).toBe("the drawing has no piece");
  });
});
