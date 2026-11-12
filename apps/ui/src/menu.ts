/**
 * The pure rules of a menu (`components/Menu.tsx`): which submenus are open, what a key on a row
 * means, which row a key moves to, how a tall menu's rows and the separators between its groups
 * are cut into columns, where an opened menu is pulled to stay inside the window, where a submenu
 * stands beside its menu and when a pointer is heading for it, which typed names a row draws, and
 * how many leading groups of a band fit before the key that opens the rest as a menu. No DOM here: the
 * component reads the rectangles and owns the focus.
 */

import { isTypeaheadKey, rovingIndex, typeaheadIndex, type TypedKey } from "./roving";

/**
 * One row of a menu: an item that runs `id`, or a submenu (`id === null`) holding `children`. A
 * `MenuNode` of `commands.ts` is one as it stands; `icon` (an id of `icons.ts`) is drawn before
 * the label by a menu whose rows have one. `name` is the name typed at the command line that
 * runs the item, drawn quiet before the shortcut. `group` marks the first row of a group: a
 * separator is drawn above it, unless the row leads its menu or its column. A separator is not an
 * item: the rows are the whole list, so the keys, the typeahead and a count of the rows never
 * meet one.
 */
export interface MenuItem {
  label: string;
  id: string | null;
  shortcut: string;
  enabled: boolean;
  children: readonly MenuItem[];
  icon?: string;
  name?: string;
  group?: boolean;
}

/** The labels of the submenus open one inside the other, from the menu's own rows down. */
export type MenuPath = readonly string[];

/** Whether two paths hold the same labels. */
export function samePath(a: MenuPath, b: MenuPath): boolean {
  return a.length === b.length && a.every((label, index) => label === b[index]);
}

/** Whether the submenu `label`, a row of the list at `path`, is on the open `chain`. */
export function isOnPath(chain: MenuPath, path: MenuPath, label: string): boolean {
  return chain[path.length] === label && samePath(chain.slice(0, path.length), path);
}

/**
 * The chain after the pointer comes to rest on a row of the list at `path`: a submenu's row opens
 * it, an item's row closes whatever was open below its list. Returns `chain` itself when nothing
 * changes, so a signal holding it does not notify on every move of the pointer.
 */
export function hoverPath(chain: MenuPath, item: Pick<MenuItem, "id" | "label">, path: MenuPath): MenuPath {
  const next = item.id === null ? [...path, item.label] : path;
  return samePath(next, chain) ? chain : next;
}

/**
 * The chain after a pointer's click on the submenu row `label` of the list at `path`: the click
 * opens it or closes it, except the click that ends the hover which has just opened it (`byHover`),
 * which leaves it open. Returns `chain` itself when nothing changes.
 */
export function clickPath(chain: MenuPath, path: MenuPath, label: string, byHover: boolean): MenuPath {
  const open = isOnPath(chain, path, label);
  if (byHover && open) return chain;
  return open ? path : [...path, label];
}

/**
 * What a key pressed on a row asks for. `leave`: Tab, the menu closes and the browser's Tab goes
 * on. `dismiss`: Escape on the menu's own rows. `back`: Escape or Left in a submenu, which closes
 * to its row. `into`: Right on a submenu's row. `previous` and `next`: Left on the menu's own rows
 * and Right on an item, which a menu bar answers by moving to the menu beside. `walk`: any other
 * key, which `walkIndex` reads.
 */
export type RowKeyAction = "leave" | "dismiss" | "back" | "into" | "previous" | "next" | "walk";

/** The action of `key` on a row `depth` submenus down (0: the menu's own rows). */
export function rowKeyAction(key: string, depth: number, submenu: boolean): RowKeyAction {
  if (key === "Tab") return "leave";
  if (key === "Escape") return depth > 0 ? "back" : "dismiss";
  if (key === "ArrowLeft") return depth > 0 ? "back" : "previous";
  if (key === "ArrowRight") return submenu ? "into" : "next";
  return "walk";
}

/**
 * The row a key moves to from row `at` of a list with these `labels`, or `null` when the key
 * moves nowhere: Down and Up step and wrap, Home and End jump, a typed letter goes to the next
 * row that starts with it. Every row keeps its place in the walk, an unavailable one too: none is
 * skipped.
 */
export function walkIndex(event: TypedKey, labels: readonly string[], at: number): number | null {
  return isTypeaheadKey(event) ? typeaheadIndex(labels, at, event.key) : rovingIndex(event.key, at, labels.length, "vertical");
}

/**
 * A row's and a separator's heights in the tracks of a menu's grid: a track is half a row
 * (chrome.css), so a separator is half a row tall.
 */
export const ROW_TRACKS = 2;
export const SEPARATOR_TRACKS = 1;

/** How a menu's rows stand in columns, per row: whether it starts a column, and whether a separator is drawn above it. */
export interface MenuColumns {
  starts: boolean[];
  separators: boolean[];
}

/**
 * The first row of each column when groups of these `sizes` (in rows) fill columns `capacity`
 * tracks tall, one after the other. A separator stands between two groups of a column and takes
 * its track only when the row after it fits too, so a column never ends on one and never starts
 * with one. `whole`: a group that does not fit in what is left of a column, and fits in a column
 * of its own, starts the next column instead of being cut.
 */
function columnStarts(sizes: readonly number[], capacity: number, whole: boolean): number[] {
  const starts = [0];
  let used = 0;
  let row = 0;
  for (const size of sizes) {
    const group = size * ROW_TRACKS;
    if (whole && used > 0 && used + SEPARATOR_TRACKS + group > capacity && group <= capacity) {
      starts.push(row);
      used = 0;
    }
    for (let at = 0; at < size; at += 1, row += 1) {
      let lead = at === 0 && used > 0 ? SEPARATOR_TRACKS : 0;
      if (used > 0 && used + lead + ROW_TRACKS > capacity) {
        starts.push(row);
        used = 0;
        lead = 0;
      }
      used += lead + ROW_TRACKS;
    }
  }
  return starts;
}

/**
 * The columns of a menu whose rows are grouped (`leads[i]`: row `i` is the first of a group) in a
 * box `capacity` tracks tall. One column while everything fits. A taller menu takes the fewest
 * columns that hold it, and those as short as they can be with every group whole, so the columns
 * break between groups and come out even; where no height keeps the groups whole in that many
 * columns, the rows simply fill each column. A separator is drawn above the first row of a group
 * except where that row leads the menu or a column. A capacity that is not a number is no limit.
 */
export function menuColumns(leads: readonly boolean[], capacity: number): MenuColumns {
  const sizes: number[] = [];
  leads.forEach((lead, row) => {
    if (lead || row === 0) sizes.push(1);
    else sizes[sizes.length - 1] = (sizes[sizes.length - 1] ?? 0) + 1;
  });
  const room = Number.isFinite(capacity) ? Math.max(ROW_TRACKS, Math.floor(capacity)) : Number.POSITIVE_INFINITY;
  let columns = columnStarts(sizes, room, false);
  if (columns.length > 1) {
    for (let height = Math.max(ROW_TRACKS, Math.ceil((leads.length * ROW_TRACKS) / columns.length)); height <= room; height += 1) {
      const even = columnStarts(sizes, height, true);
      if (even.length <= columns.length) {
        columns = even;
        break;
      }
    }
  }
  const first = new Set(columns);
  return {
    starts: leads.map((_, row) => row > 0 && first.has(row)),
    separators: leads.map((lead, row) => lead && row > 0 && !first.has(row)),
  };
}

/** A rectangle in the window's coordinates. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The part of the window a menu must stay in: the window's width, down to `floor` (the top of the
 * status bar, or the window's height where there is none), less the `margin` kept from each edge.
 */
export function menuBounds(windowWidth: number, floor: number, margin: number): Box {
  return { left: margin, top: margin, right: windowWidth - margin, bottom: floor - margin };
}

/** Whether a submenu opened on the right of its row has no room there, and opens on the left. */
export function flips(box: Box, bounds: Box): boolean {
  return box.right > bounds.right;
}

/** Where a submenu opens beside its parent menu. */
export interface SubmenuPlacement {
  /** It opens on the left of the parent menu: the right has no room for it. */
  flipped: boolean;
  /**
   * How far the parent menu's edge on that side is from the row's own: the submenu starts past
   * it, so it stands outside the whole menu and not only outside its row's column.
   */
  reach: number;
}

/**
 * Where the submenu of `row` opens. A submenu never covers its parent menu's other rows: a row in
 * the first column of a menu that stands in columns would otherwise open its submenu over the
 * second. So it opens on the right of the whole `parent` menu, `gap` from its edge, and on the
 * left of the whole menu when a box `width` wide has no room there (`flips`). Either way its first
 * row stays level with the row that opened it. What still overhangs the window after that is
 * `menuShift`'s to pull back.
 */
export function submenuPlacement(row: Box, parent: Box, width: number, gap: number, bounds: Box): SubmenuPlacement {
  const left = parent.right + gap;
  const flipped = flips({ left, top: row.top, right: left + width, bottom: row.bottom }, bounds);
  return { flipped, reach: Math.max(0, flipped ? row.left - parent.left : parent.right - row.right) };
}

/** A point in the window's coordinates. */
export interface Point {
  x: number;
  y: number;
}

/**
 * How long a pointer heading for an open submenu may rest on a row in its way before that row
 * answers it, in milliseconds.
 */
export const AIM_GRACE_MS = 300;

/**
 * Whether a pointer that moved from `from` to `to` is heading for `box`, the open submenu: `to`
 * lies inside the triangle between `from` and the two corners of the box's near edge. A submenu
 * that opens past the other columns of its menu is reached across their rows, and a row crossed
 * on the way there must not close it. A pointer that did not move toward the box, or is already
 * past its near edge, is not heading for it.
 */
export function aimsAt(from: Point, to: Point, box: Box): boolean {
  const near = Math.abs(box.left - from.x) <= Math.abs(box.right - from.x) ? box.left : box.right;
  const toward = near - from.x;
  const moved = to.x - from.x;
  if (toward === 0 || moved === 0 || Math.sign(moved) !== Math.sign(toward) || Math.abs(moved) > Math.abs(toward)) return false;
  // The triangle's two edges at `to.x`: the lines from `from` to the near edge's top and bottom.
  const along = moved / toward;
  const top = from.y + (box.top - from.y) * along;
  const bottom = from.y + (box.bottom - from.y) * along;
  return to.y >= Math.min(top, bottom) && to.y <= Math.max(top, bottom);
}

/** The most characters of a typed name a menu row draws. */
export const NAME_SHOWN_MAX = 8;

/**
 * Whether a row draws the name typed at the command line that runs it. A name of up to eight
 * characters is a hint read at a glance beside its label; a longer one ("STYLESMANAGER") is a
 * second label, louder than the first, and is left to the row's description, which says every
 * name.
 */
export function showsName(name: string): boolean {
  return name !== "" && [...name].length <= NAME_SHOWN_MAX;
}

/**
 * How far a menu is pulled back to stay inside `bounds`, per axis: the overhang past the far edge,
 * never past the near one (a menu larger than the bounds starts at their top-left corner). `null`
 * on an axis the menu already fits.
 */
export function menuShift(box: Box, bounds: Box): { x: number | null; y: number | null } {
  const x = Math.max(Math.min(0, bounds.right - box.right), bounds.left - box.left);
  const y = Math.max(Math.min(0, bounds.bottom - box.bottom), bounds.top - box.top);
  return {
    x: box.right > bounds.right || box.left < bounds.left ? x : null,
    y: box.bottom > bounds.bottom || box.top < bounds.top ? y : null,
  };
}

/**
 * How a group opened in place is scrolled into view with the row that opened it: one longer than
 * the box that scrolls starts at the box's top, under its row; a shorter one moves the least.
 */
export function stackedBlock(groupHeight: number, boxHeight: number): "start" | "nearest" {
  return groupHeight > boxHeight ? "start" : "nearest";
}

/**
 * How many leading groups of a band are drawn in `room`: all of them when they fit with `between`
 * from one to the next, else the most that leave room for the key that opens the rest (`tail`:
 * the key and what separates it from the last group). Whole groups only; none when not even the
 * first fits beside the key.
 */
export function leadingFit(sizes: readonly number[], room: number, between: number, tail: number): number {
  let used = 0;
  let count = 0;
  for (const size of sizes) {
    const next = used + (count > 0 ? between : 0) + size;
    if (!(next + tail <= room)) break;
    used = next;
    count += 1;
  }
  if (count === sizes.length) return count;
  const all = sizes.reduce((sum, size) => sum + size, 0) + between * Math.max(0, sizes.length - 1);
  return all <= room ? sizes.length : count;
}
