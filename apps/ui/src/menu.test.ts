/**
 * The menu's pure rules: the chain of open submenus under the pointer and the click, what each key
 * on a row asks for, the walk between rows, the columns of a tall menu and the separators between
 * its groups, where an opened menu is pulled to stay on screen, where a submenu stands beside its
 * menu and when a pointer is heading for it, which typed names a row draws, and how many groups of
 * a band fit before the key that opens the rest. Pinned here so the menu bar,
 * the compact menu and the tool strip's overflow menu cannot drift apart.
 */

import { describe, expect, test } from "bun:test";
import { AIM_GRACE_MS, aimsAt, clickPath, flips, hoverPath, isOnPath, leadingFit, menuBounds, menuColumns, menuShift, NAME_SHOWN_MAX, ROW_TRACKS, rowKeyAction, samePath, SEPARATOR_TRACKS, showsName, stackedBlock, submenuPlacement, walkIndex } from "./menu";

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

describe("a submenu's place beside its menu", () => {
  const bounds = menuBounds(1280, 778, 4);
  // The Draw menu as measured at 1280 wide: two columns of rows inside a 4px inset and a hairline.
  const draw = { left: 258, top: 34, right: 636, bottom: 440 };
  const first = { left: 263, top: 267, right: 441, bottom: 291 };
  const last = { left: 445, top: 255, right: 631, bottom: 279 };

  test("a row of the first column opens its submenu past the whole menu, not over the second column", () => {
    const place = submenuPlacement(first, draw, 168, 2, bounds);
    expect(place).toEqual({ flipped: false, reach: 195 });
    // Its left edge: the row's right edge, the reach, the gap. That is the menu's edge and the gap.
    expect(first.right + place.reach + 2).toBe(draw.right + 2);
  });

  test("a row of the last column reaches only the menu's inset and hairline, as a menu of one column", () => {
    expect(submenuPlacement(last, draw, 168, 2, bounds)).toEqual({ flipped: false, reach: 5 });
    const one = { left: 4, top: 34, right: 312, bottom: 500 };
    expect(submenuPlacement({ left: 9, top: 471, right: 307, bottom: 495 }, one, 200, 2, bounds)).toEqual({ flipped: false, reach: 5 });
  });

  test("with no room on the right it opens on the left of the whole menu, from either column", () => {
    const near = { left: 880, top: 34, right: 1258, bottom: 440 };
    const row = (box: { left: number; top: number; right: number; bottom: number }) => ({ ...box, left: box.left + 622, right: box.right + 622 });
    // From the last column the reach is the first column's width and more: the submenu clears it.
    expect(submenuPlacement(row(last), near, 168, 2, bounds)).toEqual({ flipped: true, reach: 187 });
    expect(submenuPlacement(row(first), near, 168, 2, bounds)).toEqual({ flipped: true, reach: 5 });
  });

  test("it flips when its right edge would pass the bounds, not when it only touches them", () => {
    const menu = { left: 700, top: 34, right: 1074, bottom: 440 };
    const row = { left: 705, top: 100, right: 1069, bottom: 124 };
    expect(submenuPlacement(row, menu, 200, 2, bounds).flipped).toBe(false);
    expect(submenuPlacement(row, menu, 201, 2, bounds).flipped).toBe(true);
  });

  test("a row that somehow lies outside its menu reaches nothing rather than backwards", () => {
    expect(submenuPlacement({ left: 700, top: 0, right: 900, bottom: 24 }, { left: 100, top: 0, right: 400, bottom: 300 }, 100, 2, bounds).reach).toBe(0);
  });
});

describe("a pointer heading for an open submenu", () => {
  // Circle's submenu, past the second column of Draw; the pointer starts on Circle's row.
  const submenu = { left: 638, top: 262, right: 806, bottom: 416 };
  const from = { x: 368, y: 279 };

  test("a move straight across the rows between is heading for it", () => {
    expect(aimsAt(from, { x: 460, y: 279 }, submenu)).toBe(true);
    expect(aimsAt(from, { x: 540, y: 300 }, submenu)).toBe(true);
  });

  test("a move toward one of its far rows is, a steeper one is not", () => {
    // Halfway there the triangle runs from y 270.5 to 347.5.
    expect(aimsAt(from, { x: 503, y: 345 }, submenu)).toBe(true);
    expect(aimsAt(from, { x: 503, y: 352 }, submenu)).toBe(false);
    expect(aimsAt(from, { x: 503, y: 266 }, submenu)).toBe(false);
  });

  test("a move up or down the pointer's own column, or away, is not", () => {
    expect(aimsAt(from, { x: 368, y: 51 }, submenu)).toBe(false);
    expect(aimsAt(from, { x: 368, y: 303 }, submenu)).toBe(false);
    expect(aimsAt(from, { x: 300, y: 279 }, submenu)).toBe(false);
  });

  test("a pointer already past the near edge has arrived, and one that did not move is not moving", () => {
    expect(aimsAt(from, { x: 700, y: 300 }, submenu)).toBe(false);
    expect(aimsAt(from, from, submenu)).toBe(false);
  });

  test("a submenu opened on the left is aimed at through its right edge", () => {
    const left = { left: 88, top: 262, right: 256, bottom: 416 };
    expect(aimsAt({ x: 540, y: 279 }, { x: 400, y: 290 }, left)).toBe(true);
    expect(aimsAt({ x: 540, y: 279 }, { x: 600, y: 279 }, left)).toBe(false);
  });

  test("the wait is a third of a second", () => {
    expect(AIM_GRACE_MS).toBe(300);
  });
});

describe("the typed name a row draws", () => {
  test("a name of up to eight characters is drawn, a longer one is left to the row's description", () => {
    expect(NAME_SHOWN_MAX).toBe(8);
    expect(showsName("L")).toBe(true);
    expect(showsName("CLOSEALL")).toBe(true);
    expect(showsName("EXPORTPDF")).toBe(false);
    expect(showsName("STYLESMANAGER")).toBe(false);
  });

  test("a row with no typed name draws none", () => {
    expect(showsName("")).toBe(false);
  });

  test("the length is counted in characters, not in code units", () => {
    expect(showsName("PAVÉ")).toBe(true);
    expect(showsName("𝒜𝒜𝒜𝒜𝒜𝒜𝒜𝒜")).toBe(true);
    expect(showsName("𝒜𝒜𝒜𝒜𝒜𝒜𝒜𝒜𝒜")).toBe(false);
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
