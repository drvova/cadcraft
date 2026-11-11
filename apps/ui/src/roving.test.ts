/**
 * The keyboard walk's pure rules: the arrows wrap, Home and End jump, a key off the widget's axis
 * is left alone, and a typed letter steps through the labels that start with it. Pinned here so
 * the menu bar, the tool strip, the status toggles and the editor tabs cannot drift apart.
 */

import { describe, expect, test } from "bun:test";
import { isTypeaheadKey, rovingIndex, typeaheadIndex } from "./roving";

describe("rovingIndex", () => {
  test("the axis's arrows step and wrap", () => {
    expect(rovingIndex("ArrowRight", 0, 3, "horizontal")).toBe(1);
    expect(rovingIndex("ArrowRight", 2, 3, "horizontal")).toBe(0);
    expect(rovingIndex("ArrowLeft", 0, 3, "horizontal")).toBe(2);
    expect(rovingIndex("ArrowLeft", 2, 3, "horizontal")).toBe(1);
    expect(rovingIndex("ArrowDown", 2, 3, "vertical")).toBe(0);
    expect(rovingIndex("ArrowUp", 0, 3, "vertical")).toBe(2);
  });

  test("Home and End jump on either axis", () => {
    for (const axis of ["horizontal", "vertical"] as const) {
      expect(rovingIndex("Home", 2, 5, axis)).toBe(0);
      expect(rovingIndex("End", 1, 5, axis)).toBe(4);
    }
  });

  test("a key that is not the walk's is left alone, including the other axis's arrows", () => {
    expect(rovingIndex("ArrowDown", 1, 3, "horizontal")).toBeNull();
    expect(rovingIndex("ArrowUp", 1, 3, "horizontal")).toBeNull();
    expect(rovingIndex("ArrowRight", 1, 3, "vertical")).toBeNull();
    expect(rovingIndex("ArrowLeft", 1, 3, "vertical")).toBeNull();
    for (const key of ["Enter", " ", "Tab", "Escape", "a", "PageDown"]) {
      expect(rovingIndex(key, 1, 3, "horizontal")).toBeNull();
    }
  });

  test("one item stays where it is; no items is nothing to walk", () => {
    expect(rovingIndex("ArrowRight", 0, 1, "horizontal")).toBe(0);
    expect(rovingIndex("ArrowLeft", 0, 1, "horizontal")).toBe(0);
    for (const count of [0, -1, NaN, 1.5, Infinity]) {
      expect(rovingIndex("ArrowRight", 0, count, "horizontal")).toBeNull();
      expect(rovingIndex("Home", 0, count, "horizontal")).toBeNull();
    }
  });

  test("a current outside the items enters at the first going forward, the last going back", () => {
    for (const current of [-1, 3, 99, NaN, 0.5]) {
      expect(rovingIndex("ArrowRight", current, 3, "horizontal")).toBe(0);
      expect(rovingIndex("ArrowLeft", current, 3, "horizontal")).toBe(2);
    }
  });
});

describe("isTypeaheadKey", () => {
  const press = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  });

  test("one visible character types", () => {
    for (const key of ["a", "Z", "3", ",", "é"]) expect(isTypeaheadKey(press(key))).toBe(true);
  });

  test("Space, named keys and chords do not", () => {
    for (const key of [" ", "Enter", "Tab", "Escape", "ArrowDown", "F1", ""]) expect(isTypeaheadKey(press(key))).toBe(false);
    expect(isTypeaheadKey(press("s", { ctrlKey: true }))).toBe(false);
    expect(isTypeaheadKey(press("s", { metaKey: true }))).toBe(false);
    expect(isTypeaheadKey(press("s", { altKey: true }))).toBe(false);
  });
});

describe("typeaheadIndex", () => {
  const labels = ["New Drawing", "Open", "Save", "Save As", "Close", "  spaced"];

  test("jumps to the next label that starts with the letter, whatever its case", () => {
    expect(typeaheadIndex(labels, 0, "o")).toBe(1);
    expect(typeaheadIndex(labels, 0, "O")).toBe(1);
    expect(typeaheadIndex(labels, 0, "c")).toBe(4);
  });

  test("the same letter again steps through the labels that share it, and wraps", () => {
    expect(typeaheadIndex(labels, 0, "s")).toBe(2);
    expect(typeaheadIndex(labels, 2, "s")).toBe(3);
    expect(typeaheadIndex(labels, 3, "s")).toBe(5);
    expect(typeaheadIndex(labels, 5, "s")).toBe(2);
  });

  test("the only match is the current row itself", () => {
    expect(typeaheadIndex(labels, 1, "o")).toBe(1);
  });

  test("no match, no labels and an empty letter move nowhere", () => {
    expect(typeaheadIndex(labels, 0, "x")).toBeNull();
    expect(typeaheadIndex([], 0, "a")).toBeNull();
    expect(typeaheadIndex(labels, 0, "")).toBeNull();
    expect(typeaheadIndex(labels, 0, " ")).toBeNull();
  });

  test("a current outside the labels searches from the top", () => {
    for (const current of [-1, 99, NaN]) expect(typeaheadIndex(labels, current, "n")).toBe(0);
  });
});
