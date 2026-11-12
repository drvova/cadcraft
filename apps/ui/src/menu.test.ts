/**
 * The menu's pure rules: the chain of open submenus under the pointer and the click, what each key
 * on a row asks for, the walk between rows, the columns of a tall menu and the separators between
 * its groups, where an opened menu is pulled to stay on screen, and how many groups of a band fit
 * before the key that opens the rest. Pinned here so the menu bar,
 * the compact menu and the tool strip's overflow menu cannot drift apart.
 */

import { describe, expect, test } from "bun:test";
import { clickPath, flips, hoverPath, isOnPath, leadingFit, menuBounds, menuColumns, menuShift, ROW_TRACKS, rowKeyAction, samePath, SEPARATOR_TRACKS, stackedBlock, walkIndex } from "./menu";

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

describe("menuColumns", () => {
  /** The rows of groups of these sizes: `true` on the first row of each. */
  const rowsOf = (sizes: readonly number[]): boolean[] => sizes.flatMap((size) => Array.from({ length: size }, (_, at) => at === 0));
  /** The columns as they would be drawn: each a list of rows (`r`) and separators (`-`), with its height in tracks. */
  const drawn = (sizes: readonly number[], capacity: number): { text: string[]; heights: number[] } => {
    const leads = rowsOf(sizes);
    const plan = menuColumns(leads, capacity);
    const text: string[] = [];
    leads.forEach((_, row) => {
      if (row === 0 || plan.starts[row]) text.push("");
      text[text.length - 1] += `${plan.separators[row] ? "-" : ""}r`;
    });
    return { text, heights: text.map((column) => [...column].reduce((sum, cell) => sum + (cell === "r" ? ROW_TRACKS : SEPARATOR_TRACKS), 0)) };
  };

  test("a row is two tracks and a separator one", () => {
    expect([ROW_TRACKS, SEPARATOR_TRACKS]).toEqual([2, 1]);
  });

  test("one column while everything fits: a separator above each group but the first", () => {
    expect(drawn([2, 3, 1], 14).text).toEqual(["rr-rrr-r"]);
    expect(menuColumns(rowsOf([2, 3, 1]), 14).starts).toEqual([false, false, false, false, false, false]);
    expect(menuColumns(rowsOf([2, 3, 1]), 14).separators).toEqual([false, false, true, false, false, true]);
  });

  test("the first row never has a separator, whether or not it is marked", () => {
    expect(menuColumns([true, false], 100).separators).toEqual([false, false]);
    expect(menuColumns([false, true], 100).separators).toEqual([false, true]);
  });

  test("no limit (a menu that scrolls, a height that is not a number) is one column", () => {
    for (const capacity of [Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(drawn([8, 7, 3, 5, 3, 4], capacity).text).toEqual(["rrrrrrrr-rrrrrrr-rrr-rrrrr-rrr-rrrr"]);
    }
  });

  test("a menu one track too tall takes two columns, cut between groups and as short as that allows", () => {
    // Thirty rows in six groups: 65 tracks with the separators, in a box of 60.
    const { text, heights } = drawn([8, 7, 3, 5, 3, 4], 60);
    expect(text).toEqual(["rrrrrrrr-rrrrrrr", "rrr-rrrrr-rrr-rrrr"]);
    expect(heights).toEqual([31, 33]);
  });

  test("a column never ends on a separator and never starts with one", () => {
    for (const sizes of [[8, 7, 3, 5, 3, 4], [2, 2, 5, 6, 3, 6, 2, 4], [1, 1, 1, 1, 1, 1, 1], [30], [3, 27], [12, 1, 12]]) {
      for (let capacity = 2; capacity <= 70; capacity += 1) {
        const { text, heights } = drawn(sizes, capacity);
        for (const column of text) {
          expect(column.startsWith("-")).toBe(false);
          expect(column.endsWith("-")).toBe(false);
        }
        // No column is taller than the box, and every row is drawn once.
        expect(Math.max(...heights)).toBeLessThanOrEqual(Math.max(capacity, ROW_TRACKS));
        expect(text.join("").replaceAll("-", "").length).toBe(sizes.reduce((sum, size) => sum + size, 0));
      }
    }
  });

  test("keeping the groups whole never costs a column over simply filling them", () => {
    const filled = (sizes: readonly number[], capacity: number): number => {
      let columns = 1;
      let used = 0;
      for (const lead of rowsOf(sizes)) {
        let need = (lead && used > 0 ? SEPARATOR_TRACKS : 0) + ROW_TRACKS;
        if (used > 0 && used + need > capacity) {
          columns += 1;
          used = 0;
          need = ROW_TRACKS;
        }
        used += need;
      }
      return columns;
    };
    for (const sizes of [[8, 7, 3, 5, 3, 4], [2, 3, 7, 6, 8, 4], [2, 4, 4, 2, 3, 5, 4], [30], [1, 29]]) {
      for (let capacity = 2; capacity <= 70; capacity += 1) expect(drawn(sizes, capacity).text.length).toBe(filled(sizes, capacity));
    }
  });

  test("a group longer than a column is cut where a column ends, and the columns are still evened", () => {
    expect(drawn([7, 2], 8).text).toEqual(["rrr", "rrr", "r-rr"]);
  });

  test("where no height keeps the groups whole in as few columns, the rows fill each column", () => {
    // Nine rows need two columns of 10 tracks; whole, the last group would ask for a third.
    expect(drawn([7, 2], 10).text).toEqual(["rrrrr", "rr-rr"]);
  });

  test("an empty menu and a box shorter than a row", () => {
    expect(menuColumns([], 10)).toEqual({ starts: [], separators: [] });
    expect(drawn([2, 1], 0).text).toEqual(["r", "r", "r"]);
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
