/**
 * The menu's pure rules: the chain of open submenus under the pointer and the click, what each key
 * on a row asks for, the walk between rows, where an opened menu is pulled to stay on screen, and
 * how many groups of a band fit before the key that opens the rest. Pinned here so the menu bar,
 * the compact menu and the tool strip's overflow menu cannot drift apart.
 */

import { describe, expect, test } from "bun:test";
import { clickPath, flips, hoverPath, isOnPath, leadingFit, menuBounds, menuShift, rowKeyAction, samePath, stackedBlock, walkIndex } from "./menu";

const press = (key: string) => ({ key, ctrlKey: false, metaKey: false, altKey: false });

describe("the open chain", () => {
  test("two paths are the same when every label is", () => {
    expect(samePath([], [])).toBe(true);
    expect(samePath(["Draw", "Circle"], ["Draw", "Circle"])).toBe(true);
    expect(samePath(["Draw"], ["Draw", "Circle"])).toBe(false);
    expect(samePath(["Draw", "Arc"], ["Draw", "Circle"])).toBe(false);
  });

  test("a submenu is open when the chain runs through its list to its label", () => {
    expect(isOnPath(["Draw", "Circle"], [], "Draw")).toBe(true);
    expect(isOnPath(["Draw", "Circle"], ["Draw"], "Circle")).toBe(true);
    expect(isOnPath(["Draw", "Circle"], ["Draw"], "Arc")).toBe(false);
    expect(isOnPath(["Draw", "Circle"], ["Modify"], "Circle")).toBe(false);
    expect(isOnPath([], [], "Draw")).toBe(false);
  });

  test("the pointer on a submenu's row opens it; on an item's row it closes what is below the list", () => {
    expect(hoverPath([], { id: null, label: "Circle" }, [])).toEqual(["Circle"]);
    expect(hoverPath(["Circle"], { id: "line", label: "Line" }, [])).toEqual([]);
    expect(hoverPath(["Draw", "Circle"], { id: "line", label: "Line" }, ["Draw"])).toEqual(["Draw"]);
    expect(hoverPath(["Draw", "Circle"], { id: null, label: "Arc" }, ["Draw"])).toEqual(["Draw", "Arc"]);
  });

  test("a hover that changes nothing returns the chain itself", () => {
    const chain = ["Draw", "Circle"];
    expect(hoverPath(chain, { id: null, label: "Circle" }, ["Draw"])).toBe(chain);
    const top: readonly string[] = [];
    expect(hoverPath(top, { id: "line", label: "Line" }, [])).toBe(top);
  });

  test("a click opens a closed submenu and closes an open one", () => {
    expect(clickPath([], [], "Circle", false)).toEqual(["Circle"]);
    expect(clickPath(["Circle"], [], "Circle", false)).toEqual([]);
    expect(clickPath(["Draw", "Circle", "More"], ["Draw"], "Circle", false)).toEqual(["Draw"]);
    expect(clickPath(["Draw", "Arc"], ["Draw"], "Circle", false)).toEqual(["Draw", "Circle"]);
  });

  test("the click that ends the hover which opened a submenu leaves it open", () => {
    const chain = ["Circle"];
    expect(clickPath(chain, [], "Circle", true)).toBe(chain);
    // The hover's submenu was closed since (by a key): the click opens it like any other.
    expect(clickPath([], [], "Circle", true)).toEqual(["Circle"]);
  });
});

describe("rowKeyAction", () => {
  test("Tab leaves, on any row", () => {
    expect(rowKeyAction("Tab", 0, false)).toBe("leave");
    expect(rowKeyAction("Tab", 2, true)).toBe("leave");
  });

  test("Escape closes one level: the menu from its own rows, a submenu back to its row", () => {
    expect(rowKeyAction("Escape", 0, false)).toBe("dismiss");
    expect(rowKeyAction("Escape", 1, false)).toBe("back");
    expect(rowKeyAction("Escape", 2, true)).toBe("back");
  });

  test("Left closes a submenu, and on the menu's own rows asks for the menu before", () => {
    expect(rowKeyAction("ArrowLeft", 1, false)).toBe("back");
    expect(rowKeyAction("ArrowLeft", 0, false)).toBe("previous");
    expect(rowKeyAction("ArrowLeft", 0, true)).toBe("previous");
  });

  test("Right moves into a submenu, and on an item asks for the menu after, at any depth", () => {
    expect(rowKeyAction("ArrowRight", 0, true)).toBe("into");
    expect(rowKeyAction("ArrowRight", 1, true)).toBe("into");
    expect(rowKeyAction("ArrowRight", 0, false)).toBe("next");
    expect(rowKeyAction("ArrowRight", 2, false)).toBe("next");
  });

  test("every other key is the walk's", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "a", "Enter", " "]) expect(rowKeyAction(key, 0, false)).toBe("walk");
  });
});

describe("walkIndex", () => {
  const labels = ["Undo", "Redo", "Cut", "Copy", "Paste"];

  test("Down and Up step and wrap, Home and End jump", () => {
    expect(walkIndex(press("ArrowDown"), labels, 0)).toBe(1);
    expect(walkIndex(press("ArrowDown"), labels, 4)).toBe(0);
    expect(walkIndex(press("ArrowUp"), labels, 0)).toBe(4);
    expect(walkIndex(press("ArrowUp"), labels, 3)).toBe(2);
    expect(walkIndex(press("Home"), labels, 3)).toBe(0);
    expect(walkIndex(press("End"), labels, 1)).toBe(4);
  });

  test("no row is skipped: the walk knows labels only, so an unavailable row keeps its place", () => {
    const seen: number[] = [];
    let at = 0;
    for (let step = 0; step < labels.length; step++) {
      at = walkIndex(press("ArrowDown"), labels, at) ?? -1;
      seen.push(at);
    }
    expect(seen).toEqual([1, 2, 3, 4, 0]);
  });

  test("a letter goes to the next row that starts with it, again to the one after, and wraps", () => {
    expect(walkIndex(press("c"), labels, 0)).toBe(2);
    expect(walkIndex(press("c"), labels, 2)).toBe(3);
    expect(walkIndex(press("C"), labels, 3)).toBe(2);
    expect(walkIndex(press("x"), labels, 0)).toBeNull();
  });

  test("the bar's arrows, Enter, Space and a chord move nowhere", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Enter", " ", "Escape", "Tab"]) expect(walkIndex(press(key), labels, 1)).toBeNull();
    expect(walkIndex({ key: "c", ctrlKey: true, metaKey: false, altKey: false }, labels, 0)).toBeNull();
    expect(walkIndex(press("ArrowDown"), [], 0)).toBeNull();
  });
});

describe("placement", () => {
  // A window 1280 by 800 whose status bar starts at 778, with the menu's 4px inset as the margin.
  const bounds = menuBounds(1280, 778, 4);

  test("the bounds are the window down to the floor, less the margin", () => {
    expect(bounds).toEqual({ left: 4, top: 4, right: 1276, bottom: 774 });
  });

  test("a menu that fits is not moved", () => {
    expect(menuShift({ left: 100, top: 30, right: 400, bottom: 500 }, bounds)).toEqual({ x: null, y: null });
    expect(menuShift({ left: 4, top: 4, right: 1276, bottom: 774 }, bounds)).toEqual({ x: null, y: null });
  });

  test("an overhang past the right or the floor is pulled back by the overhang", () => {
    expect(menuShift({ left: 1100, top: 30, right: 1400, bottom: 500 }, bounds)).toEqual({ x: -124, y: null });
    expect(menuShift({ left: 100, top: 600, right: 400, bottom: 900 }, bounds)).toEqual({ x: null, y: -126 });
  });

  test("a menu larger than the bounds starts at their top-left corner", () => {
    expect(menuShift({ left: 100, top: 100, right: 1500, bottom: 1000 }, bounds)).toEqual({ x: -96, y: -96 });
  });

  test("a menu past the left or the top is pushed in", () => {
    expect(menuShift({ left: -20, top: -10, right: 200, bottom: 300 }, bounds)).toEqual({ x: 24, y: 14 });
  });

  test("a submenu flips when its right edge passes the bounds, not when it only touches them", () => {
    expect(flips({ left: 1000, top: 30, right: 1277, bottom: 300 }, bounds)).toBe(true);
    expect(flips({ left: 1000, top: 30, right: 1276, bottom: 300 }, bounds)).toBe(false);
  });

  test("a group opened in place starts at the box's top only when it is longer than the box", () => {
    expect(stackedBlock(900, 600)).toBe("start");
    expect(stackedBlock(600, 600)).toBe("nearest");
    expect(stackedBlock(120, 600)).toBe("nearest");
  });
});

describe("leadingFit", () => {
  // Groups of 4, 2 and 3 keys of 24px with 2px between keys; 13px from group to group; the key
  // that opens the rest costs its 24px and a 2px gap.
  const sizes = [102, 50, 76];

  test("every group when they all fit, with no room kept for a key nobody needs", () => {
    expect(leadingFit(sizes, 254, 13, 26)).toBe(3);
    expect(leadingFit(sizes, 2000, 13, 26)).toBe(3);
  });

  test("one pixel short folds the last group away, whole", () => {
    expect(leadingFit(sizes, 253, 13, 26)).toBe(2);
  });

  test("the groups kept leave room for the key", () => {
    expect(leadingFit(sizes, 191, 13, 26)).toBe(2);
    expect(leadingFit(sizes, 190, 13, 26)).toBe(1);
    expect(leadingFit(sizes, 128, 13, 26)).toBe(1);
    expect(leadingFit(sizes, 127, 13, 26)).toBe(0);
  });

  test("no room, no groups, and a measure that is not a number keep nothing", () => {
    expect(leadingFit(sizes, 0, 13, 26)).toBe(0);
    expect(leadingFit(sizes, -5, 13, 26)).toBe(0);
    expect(leadingFit(sizes, Number.NaN, 13, 26)).toBe(0);
    expect(leadingFit([], 100, 13, 26)).toBe(0);
  });
});
