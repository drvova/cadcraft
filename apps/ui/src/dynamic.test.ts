/**
 * Dynamic input's rules: which fields a prompt gets, where each key goes, the line sent for
 * each combination of locked and free fields, the cursor a typed value holds, the values the
 * free fields show, and where the box stands.
 */

import { describe, expect, test } from "bun:test";
import {
  constrain,
  degreesOf,
  draftFor,
  DYNAMIC_GAP,
  dynamicKind,
  dynamicLabel,
  echoFor,
  editDraft,
  fieldCount,
  fieldNames,
  hasTyped,
  isLocked,
  isWord,
  lineFor,
  liveValues,
  placeBeside,
  routeKey,
  stepField,
  type Aim,
  type Draft,
} from "./dynamic";
import { emptyPrompt, NO_ANCHOR, type PromptAccept, type PromptAnchor, type PromptState } from "./prompt";

const accept = (flags: Partial<PromptAccept>): PromptAccept => ({ point: false, number: false, text: false, select: false, enter: true, ...flags });

const state = (prompt: string, flags: Partial<PromptAccept> | null, anchor: Partial<PromptAnchor> = {}, keywords: readonly string[] = [], running: string | null = "line"): PromptState => ({
  ...emptyPrompt(),
  prompt,
  running,
  keywords,
  accept: flags === null ? null : accept(flags),
  anchor: { ...NO_ANCHOR, ...anchor },
});

const BASE = { x: 10, y: 20 };
const first = state("LINE Specify first point:", { point: true });
const next = state("LINE Specify next point or [Close/Undo]:", { point: true }, { base: BASE }, ["Close", "Undo"]);
const corner = state("RECTANG Specify other corner point or [Area/Dimensions/Rotation]:", { point: true }, { base: BASE, corner: true }, ["Area", "Dimensions", "Rotation"], "rectang");
const radius = state("CIRCLE Specify radius of circle or [Diameter] <2.5000>:", { point: true, number: true }, { base: BASE, distance: true }, ["Diameter"], "circle");
const sides = state("POLYGON Enter number of sides <4>:", { number: true }, {}, [], "polygon");
const pick = state("ERASE Select objects:", { point: true, select: true }, {}, [], "erase");
const yesNo = state("AUDIT Fix any errors detected? [Yes/No] <N>:", { text: true }, {}, ["Yes", "No"], "audit");

const typed = (draft: Draft, a: string, b = "", active = 0): Draft => ({ ...draft, text: [a, b], active });
const aimAt = (x: number, y: number, base: { x: number; y: number } | null = BASE): Aim => ({ point: { x, y }, base });

describe("dynamicKind", () => {
  test("a first point is X and Y, a next point a distance and an angle, a window's corner X and Y again", () => {
    expect(dynamicKind(first)).toBe("point");
    expect(dynamicKind(next)).toBe("polar");
    expect(dynamicKind(corner)).toBe("point");
  });

  test("a prompt that takes a number is one field, even when a point would answer it", () => {
    expect(dynamicKind(radius)).toBe("number");
    expect(dynamicKind(sides)).toBe("number");
    expect(dynamicKind(state("ROTATE Specify rotation angle:", { point: true, number: true }, { base: BASE }))).toBe("number");
    expect(dynamicKind(state("Specify length:", { point: true }, { base: BASE, distance: true }))).toBe("number");
  });

  test("a prompt that picks objects or takes nothing has a field only for its keywords", () => {
    expect(dynamicKind(pick)).toBe("none");
    expect(dynamicKind({ ...pick, keywords: ["Fence"] })).toBe("text");
    expect(dynamicKind(yesNo)).toBe("text");
    expect(dynamicKind(state("Working", null))).toBe("none");
    expect(dynamicKind(state("Working", null, {}, ["Stop"]))).toBe("text");
  });

  test("with no command running there is nothing", () => {
    expect(dynamicKind(state("", { point: true }, {}, [], null))).toBe("none");
    expect(fieldCount("none")).toBe(0);
  });
});

describe("the label and the names", () => {
  test("the label is the prompt without the command, the options and the colon", () => {
    expect(dynamicLabel(next)).toBe("Specify next point");
    expect(dynamicLabel(radius)).toBe("Specify radius of circle <2.5000>");
    expect(dynamicLabel(yesNo)).toBe("Fix any errors detected? <N>");
    expect(dynamicLabel(state("", { point: true }))).toBe("");
  });

  test("the fields are named for what they take", () => {
    expect(fieldNames("point", first)).toEqual(["X", "Y"]);
    expect(fieldNames("polar", next)).toEqual(["Distance", "Angle"]);
    expect(fieldNames("number", radius)).toEqual(["Radius"]);
    expect(fieldNames("number", state("CIRCLE Specify diameter of circle or [Radius]:", { number: true }, {}, ["Radius"]))).toEqual(["Diameter"]);
    expect(fieldNames("number", sides)).toEqual(["Value"]);
    expect(fieldNames("number", state("Specify second point:", { point: true }, { base: BASE, distance: true }))).toEqual(["Distance"]);
    expect(fieldNames("text", yesNo)).toEqual(["Option"]);
    expect(fieldNames("text", state("Enter text:", { text: true }))).toEqual(["Text"]);
    expect(fieldNames("none", pick)).toEqual([]);
  });
});

describe("draftFor", () => {
  test("a prompt starts with nothing typed and the first field active", () => {
    expect(draftFor(next)).toEqual({ kind: "polar", active: 0, text: ["", ""], prefix: "", measured: false });
    expect(hasTyped(draftFor(next))).toBe(false);
  });

  test("X and Y after a point are relative to it; a first point is absolute", () => {
    expect(draftFor(corner).prefix).toBe("@");
    expect(draftFor(first).prefix).toBe("");
  });

  test("a radius is measured from the base", () => {
    expect(draftFor(radius).measured).toBe(true);
    expect(draftFor(sides).measured).toBe(false);
  });
});

describe("routeKey", () => {
  const fresh = draftFor(next);

  test("digits, the minus, the dot and letters go into the active field", () => {
    for (const key of ["5", "-", ".", "c", "'"]) expect(routeKey(fresh, key, false, fresh)).toEqual({ kind: "type" });
  });

  test("Tab goes round the fields and Shift+Tab back, without leaving them", () => {
    expect(routeKey(fresh, "Tab", false, fresh)).toEqual({ kind: "draft", draft: { ...fresh, active: 1 } });
    expect(routeKey({ ...fresh, active: 1 }, "Tab", false, fresh)).toEqual({ kind: "draft", draft: fresh });
    expect(routeKey(fresh, "Tab", true, fresh)).toEqual({ kind: "draft", draft: { ...fresh, active: 1 } });
    expect(stepField(typed(fresh, "5"))).toEqual(typed(fresh, "5", "", 1));
  });

  test("with one field or none Tab is the window's", () => {
    expect(routeKey(draftFor(radius), "Tab", false, draftFor(radius))).toEqual({ kind: "pass" });
    expect(routeKey(draftFor(pick), "Tab", false, draftFor(pick))).toEqual({ kind: "pass" });
  });

  test("a comma is the next coordinate: a distance becomes X, relative to the last point", () => {
    expect(routeKey(typed(fresh, "3"), ",", false, fresh)).toEqual({ kind: "draft", draft: { ...typed(fresh, "3", "", 1), kind: "point", prefix: "@" } });
    const xy = draftFor(first);
    expect(routeKey(typed(xy, "3"), ",", false, xy)).toEqual({ kind: "draft", draft: typed(xy, "3", "", 1) });
    // After `#` the point stays absolute.
    expect(routeKey({ ...typed(fresh, "3"), prefix: "#" }, ",", false, fresh)).toMatchObject({ draft: { kind: "point", prefix: "#" } });
  });

  test("a comma is never a decimal: in a number it types nothing", () => {
    const one = typed(draftFor(radius), "2");
    expect(routeKey(one, ",", false, draftFor(radius))).toEqual({ kind: "draft", draft: one });
  });

  test("`<` goes on to the angle, from a distance and from X", () => {
    expect(routeKey(typed(fresh, "5"), "<", false, fresh)).toEqual({ kind: "draft", draft: typed(fresh, "5", "", 1) });
    const xy = draftFor(corner);
    expect(routeKey(typed(xy, "5"), "<", false, xy)).toEqual({ kind: "draft", draft: { ...typed(xy, "5", "", 1), kind: "polar" } });
  });

  test("`@` and `#` before anything is typed say how the point is measured", () => {
    expect(routeKey(fresh, "#", false, fresh)).toEqual({ kind: "draft", draft: { ...fresh, prefix: "#" } });
    expect(routeKey(draftFor(first), "@", false, draftFor(first))).toEqual({ kind: "draft", draft: { ...draftFor(first), prefix: "@" } });
    // In a number, and after a digit, they are characters.
    expect(routeKey(draftFor(radius), "@", false, draftFor(radius))).toEqual({ kind: "type" });
    expect(routeKey(typed(fresh, "5"), "@", false, fresh)).toEqual({ kind: "type" });
  });

  test("a word being typed takes every character, as the command line does", () => {
    const word = typed(fresh, "BOX 1");
    for (const key of [",", "<", "@", "2"]) expect(routeKey(word, key, false, fresh)).toEqual({ kind: "type" });
    expect(isWord("end")).toBe(true);
    expect(isWord("_cen")).toBe(true);
    expect(isWord("-12.5")).toBe(false);
    expect(isWord("1'6\"")).toBe(false);
  });

  test("Enter sends what is typed, and is the shell's empty Enter with nothing typed", () => {
    expect(routeKey(typed(fresh, "5"), "Enter", false, fresh)).toEqual({ kind: "submit" });
    expect(routeKey(fresh, "Enter", false, fresh)).toEqual({ kind: "pass" });
  });

  test("Space is Enter, except inside a line of text", () => {
    expect(routeKey(typed(fresh, "5"), " ", false, fresh)).toEqual({ kind: "submit" });
    expect(routeKey(fresh, " ", false, fresh)).toEqual({ kind: "pass" });
    const text = draftFor(state("Enter text:", { text: true }));
    expect(routeKey(typed(text, "two"), " ", false, text)).toEqual({ kind: "type" });
    expect(routeKey(text, " ", false, text)).toEqual({ kind: "pass" });
  });

  test("Escape drops what is typed first, and is the shell's cancel with nothing typed", () => {
    expect(routeKey(typed(fresh, "5"), "Escape", false, fresh)).toEqual({ kind: "clear" });
    expect(routeKey({ ...fresh, kind: "point", prefix: "@" }, "Escape", false, fresh)).toEqual({ kind: "clear" });
    expect(routeKey(fresh, "Escape", false, fresh)).toEqual({ kind: "pass" });
  });

  test("Backspace edits a field that has text, and steps back out of an empty one", () => {
    expect(routeKey(typed(fresh, "5"), "Backspace", false, fresh)).toEqual({ kind: "type" });
    expect(routeKey(typed(fresh, "5", "", 1), "Backspace", false, fresh)).toEqual({ kind: "draft", draft: typed(fresh, "5") });
    // In an empty first field it undoes the comma or the `#`: the prompt's own fields are back.
    expect(routeKey({ ...fresh, kind: "point", prefix: "#" }, "Backspace", false, fresh)).toEqual({ kind: "draft", draft: fresh });
  });

  test("a field unlocks when it is emptied", () => {
    const locked = editDraft(fresh, "5");
    expect(isLocked(locked, 0)).toBe(true);
    expect(isLocked(locked, 1)).toBe(false);
    expect(isLocked(editDraft(locked, ""), 0)).toBe(false);
    expect(editDraft({ ...fresh, active: 1 }, "30").text).toEqual(["", "30"]);
  });

  test("the Down arrow lists the options; other keys are the shell's", () => {
    expect(routeKey(fresh, "ArrowDown", false, fresh)).toEqual({ kind: "options" });
    for (const key of ["F8", "ArrowUp", "Shift", "Delete"]) expect(routeKey(fresh, key, false, fresh)).toEqual({ kind: "pass" });
    expect(routeKey(draftFor(pick), "a", false, draftFor(pick))).toEqual({ kind: "pass" });
  });
});

describe("lineFor", () => {
  const polar = draftFor(next);
  const pointer = aimAt(13, 24);

  test("nothing typed sends nothing", () => {
    expect(lineFor(polar, pointer)).toBe("");
    expect(lineFor(draftFor(pick), pointer)).toBe("");
  });

  test("a locked distance and a locked angle are the polar form as typed", () => {
    expect(lineFor(typed(polar, "5", "30", 1), pointer)).toBe("@5<30");
    expect(lineFor(typed(polar, "5", "30", 1), null)).toBe("@5<30");
    expect(lineFor({ ...typed(polar, "5", "30"), prefix: "#" }, null)).toBe("#5<30");
  });

  test("a locked distance with a free angle takes the pointer's direction, in degrees from +X", () => {
    expect(lineFor(typed(polar, "5"), aimAt(10, 27))).toBe("@5<<90");
    expect(lineFor(typed(polar, "5"), aimAt(4, 20))).toBe("@5<<180");
    expect(lineFor(typed(polar, "2.5"), aimAt(11, 21))).toBe("@2.5<<45");
    expect(lineFor(typed(polar, "5"), aimAt(10, 19))).toBe("@5<<270");
  });

  test("a lone distance with no pointer to read is direct distance entry", () => {
    expect(lineFor(typed(polar, "5"), null)).toBe("5");
    expect(lineFor(typed(polar, "5"), aimAt(1, 1, null))).toBe("5");
  });

  test("a locked angle with a free distance takes the pointer's distance along it", () => {
    expect(lineFor(typed(polar, "", "0", 1), aimAt(13, 24))).toBe("@3<0");
    expect(lineFor(typed(polar, "", "90", 1), aimAt(13, 24))).toBe("@4<90");
    // Behind the base the distance is none, never negative.
    expect(lineFor(typed(polar, "", "0", 1), aimAt(7, 24))).toBe("@0<0");
    // An angle that is not a plain number (the drawing's own units) takes the pointer's own distance.
    expect(lineFor(typed(polar, "", "30d", 1), aimAt(13, 24))).toBe("30d");
    expect(lineFor(typed(polar, "", "30", 1), null)).toBeNull();
  });

  test("X and Y typed are the point as typed, relative after a point and absolute at first", () => {
    expect(lineFor(typed(draftFor(corner), "3", "2", 1), null)).toBe("@3,2");
    expect(lineFor(typed(draftFor(first), "3", "2", 1), null)).toBe("3,2");
    expect(lineFor({ ...typed(draftFor(corner), "3", "2", 1), prefix: "#" }, null)).toBe("#3,2");
    expect(lineFor(typed(draftFor(first), "-1.5", ".25", 1), null)).toBe("-1.5,.25");
  });

  test("one typed ordinate takes the other from the pointer", () => {
    expect(lineFor(typed(draftFor(corner), "3"), aimAt(11, 26))).toBe("@3,6");
    expect(lineFor(typed(draftFor(corner), "", "2", 1), aimAt(11, 26))).toBe("@1,2");
    expect(lineFor(typed(draftFor(first), "3"), aimAt(11, 26, null))).toBe("3,26");
    expect(lineFor(typed(draftFor(first), "3"), null)).toBeNull();
    expect(lineFor(typed(draftFor(corner), "3"), aimAt(11, 26, null))).toBeNull();
  });

  test("a number and a line of text are sent as typed", () => {
    expect(lineFor(typed(draftFor(radius), "2.5"), pointer)).toBe("2.5");
    expect(lineFor(typed(draftFor(yesNo), "Yes"), null)).toBe("Yes");
    expect(lineFor(typed(draftFor(state("Enter text:", { text: true })), "two words"), null)).toBe("two words");
  });

  test("a word in a point's field is sent alone, as the command line reads it", () => {
    expect(lineFor(typed(polar, "c"), pointer)).toBe("c");
    expect(lineFor(typed(polar, "5", "end", 1), pointer)).toBe("end");
    expect(lineFor(typed(draftFor(first), "@1,2"), null)).toBe("@1,2");
  });

  test("the pointer's direction is written in full, never as an exponent", () => {
    const line = lineFor(typed(polar, "5"), aimAt(10 + 1e-9, 20 + 1)) ?? "";
    expect(line.startsWith("@5<<89.99999994")).toBe(true);
    expect(line.includes("e")).toBe(false);
    expect(degreesOf(0, 0)).toBe(0);
    expect(degreesOf(1, -1e-300)).toBe(0);
  });
});

describe("echoFor", () => {
  const polar = draftFor(next);

  test("the command line's field shows the typed part alone", () => {
    expect(echoFor(polar)).toBe("");
    expect(echoFor(typed(polar, "5"))).toBe("5");
    expect(echoFor(typed(polar, "5", "", 1))).toBe("@5<");
    expect(echoFor(typed(polar, "5", "30", 1))).toBe("@5<30");
    expect(echoFor(typed(polar, "", "30", 1))).toBe("@<30");
    expect(echoFor(typed(draftFor(corner), "3", "", 1))).toBe("@3,");
    expect(echoFor(typed(draftFor(first), "3", "4", 1))).toBe("3,4");
    expect(echoFor(typed(draftFor(radius), "2.5"))).toBe("2.5");
    expect(echoFor(typed(polar, "und"))).toBe("und");
  });
});

describe("constrain", () => {
  const polar = draftFor(next);
  const near = (p: { x: number; y: number } | null, x: number, y: number): void => {
    expect(p).not.toBeNull();
    expect(p?.x).toBeCloseTo(x, 9);
    expect(p?.y).toBeCloseTo(y, 9);
  };

  test("nothing typed holds nothing", () => {
    expect(constrain(polar, aimAt(13, 24))).toBeNull();
    expect(constrain(draftFor(first), aimAt(13, 24))).toBeNull();
  });

  test("a locked distance keeps the pointer's direction and sets the length", () => {
    near(constrain(typed(polar, "10"), aimAt(13, 24)), 16, 28);
    near(constrain(typed(polar, "5"), aimAt(10, 20)), 15, 20);
  });

  test("a locked angle keeps the pointer's distance along it", () => {
    near(constrain(typed(polar, "", "90", 1), aimAt(13, 24)), 10, 24);
    near(constrain(typed(polar, "", "0", 1), aimAt(7, 24)), 10, 20);
  });

  test("both locked place the point whatever the pointer does", () => {
    near(constrain(typed(polar, "5", "90", 1), aimAt(99, -99)), 10, 25);
    near(constrain({ ...typed(polar, "5", "0", 1), prefix: "#" }, aimAt(99, -99)), 5, 0);
  });

  test("a typed ordinate is held and the other follows the pointer", () => {
    near(constrain(typed(draftFor(corner), "3"), aimAt(11, 26)), 13, 26);
    near(constrain(typed(draftFor(corner), "", "2", 1), aimAt(11, 26)), 11, 22);
    near(constrain(typed(draftFor(first), "3", "4", 1), aimAt(11, 26, null)), 3, 4);
  });

  test("a typed radius holds the circle to it, towards the pointer", () => {
    near(constrain(typed(draftFor(radius), "2"), aimAt(10, 30)), 10, 22);
    expect(constrain(typed(draftFor(sides), "6"), aimAt(10, 30))).toBeNull();
  });

  test("what is not a number, or has nothing to measure from, holds nothing", () => {
    expect(constrain(typed(polar, "c"), aimAt(13, 24))).toBeNull();
    expect(constrain(typed(polar, "1'6\""), aimAt(13, 24))).toBeNull();
    expect(constrain(typed(polar, "5"), aimAt(13, 24, null))).toBeNull();
    expect(constrain(typed(polar, "1e400"), aimAt(13, 24))).toBeNull();
  });

  test("the held point is the point the line sends", () => {
    const aim = aimAt(13, 24);
    const held = constrain(typed(polar, "10"), aim);
    const line = lineFor(typed(polar, "10"), aim) ?? "";
    const degrees = Number(line.split("<<")[1]);
    near(held, 10 + 10 * Math.cos((degrees * Math.PI) / 180), 20 + 10 * Math.sin((degrees * Math.PI) / 180));
  });
});

describe("liveValues", () => {
  test("a free distance and angle follow the pointer, at fixed decimals", () => {
    expect(liveValues(draftFor(next), aimAt(13, 24))).toEqual(["5.0000", "53.13°"]);
    expect(liveValues(draftFor(next), aimAt(10, 20))).toEqual(["0.0000", "0.00°"]);
    expect(liveValues(draftFor(next), aimAt(11, 20 - 1e-9))).toEqual(["1.0000", "0.00°"]);
  });

  test("X and Y are measured as the line will be: from the base when relative", () => {
    expect(liveValues(draftFor(corner), aimAt(13, 24))).toEqual(["3.0000", "4.0000"]);
    expect(liveValues(draftFor(first), aimAt(13, 24, null))).toEqual(["13.0000", "24.0000"]);
    expect(liveValues({ ...draftFor(corner), prefix: "#" }, aimAt(13, 24))).toEqual(["13.0000", "24.0000"]);
    expect(liveValues(draftFor(first), aimAt(-0.00001, 2, null))).toEqual(["0.0000", "2.0000"]);
  });

  test("a radius is the pointer's distance from the centre; a plain number shows nothing", () => {
    expect(liveValues(draftFor(radius), aimAt(13, 24))).toEqual(["5.0000", ""]);
    expect(liveValues(draftFor(sides), aimAt(13, 24))).toEqual(["", ""]);
  });

  test("with no pointer there is nothing to show", () => {
    expect(liveValues(draftFor(next), null)).toEqual(["", ""]);
    expect(liveValues(draftFor(next), aimAt(13, 24, null))).toEqual(["", ""]);
  });
});

describe("placeBeside", () => {
  const box = { w: 160, h: 44 };
  const canvas = { w: 1000, h: 600 };
  const at = { x: 500, y: 300 };

  test("it stands below and to the right of the pointer", () => {
    expect(placeBeside(at, box, canvas, null, null)).toEqual({ x: 500 + DYNAMIC_GAP, y: 300 + DYNAMIC_GAP });
  });

  test("it flips to stay inside the canvas", () => {
    expect(placeBeside({ x: 950, y: 300 }, box, canvas, null, null)).toEqual({ x: 950 - DYNAMIC_GAP - box.w, y: 300 + DYNAMIC_GAP });
    expect(placeBeside({ x: 500, y: 590 }, box, canvas, null, null)).toEqual({ x: 500 + DYNAMIC_GAP, y: 590 - DYNAMIC_GAP - box.h });
    expect(placeBeside({ x: 990, y: 590 }, box, canvas, null, null)).toEqual({ x: 990 - DYNAMIC_GAP - box.w, y: 590 - DYNAMIC_GAP - box.h });
  });

  test("it keeps off the rubber band", () => {
    // The band comes from below and to the right: that corner is the band's.
    expect(placeBeside(at, box, canvas, { x: 700, y: 400 }, null)).toEqual({ x: 500 + DYNAMIC_GAP, y: 300 - DYNAMIC_GAP - box.h });
    // A band from the left leaves the default corner free.
    expect(placeBeside(at, box, canvas, { x: 100, y: 300 }, null)).toEqual({ x: 500 + DYNAMIC_GAP, y: 300 + DYNAMIC_GAP });
  });

  test("it keeps off the snap label", () => {
    const label = { x: 510, y: 310, w: 80, h: 20 };
    expect(placeBeside(at, box, canvas, null, label)).toEqual({ x: 500 + DYNAMIC_GAP, y: 300 - DYNAMIC_GAP - box.h });
    expect(placeBeside(at, box, canvas, null, { x: 0, y: 0, w: 10, h: 10 })).toEqual({ x: 500 + DYNAMIC_GAP, y: 300 + DYNAMIC_GAP });
  });

  test("a canvas smaller than the box still holds its corner", () => {
    const to = placeBeside({ x: 20, y: 20 }, box, { w: 100, h: 30 }, null, null);
    expect(to.x).toBe(0);
    expect(to.y).toBe(0);
  });
});
