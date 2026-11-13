/**
 * The command line's memory of what was submitted: the lines the Up and Down arrows walk, most
 * recent first, and where the walk is. No DOM: the field (`./components/CommandField`) writes
 * what `recall` returns.
 */

/** How many submitted lines the Up/Down walk keeps. */
export const MAX_HISTORY = 200;

export interface CommandHistory {
  /** Remember a submitted line (not an empty one, not the one just before it); the walk ends. */
  remember: (text: string) => void;
  /** Move the walk: +1 is older (Up), -1 is newer (Down). The line to show, or null beyond either end. */
  recall: (direction: number) => string | null;
  /** The walk ends (something was typed, or Escape). */
  reset: () => void;
}

export function commandHistory(max: number = MAX_HISTORY): CommandHistory {
  const lines: string[] = [];
  const cap = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : MAX_HISTORY;
  let walk = -1;
  return {
    remember: (text) => {
      if (text.trim() !== "" && lines[0] !== text) {
        lines.unshift(text);
        if (lines.length > cap) lines.length = cap;
      }
      walk = -1;
    },
    recall: (direction) => {
      if (lines.length === 0 || (direction !== 1 && direction !== -1)) return null;
      const next = walk + direction;
      if (next < -1 || next >= lines.length) return null;
      walk = next;
      return walk === -1 ? "" : (lines[walk] ?? "");
    },
    reset: () => {
      walk = -1;
    },
  };
}
