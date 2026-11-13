import { describe, expect, test } from "bun:test";
import { titleKeyAction } from "./components/MenuBar";
import { commandCentreName } from "./components/TopBar";

const TITLES = ["File", "Edit", "View", "Insert", "Format", "Tools", "Draw", "Dimension", "Modify", "Help"];

describe("the title bar", () => {
  test("the bar's keys are the SolidJS bar's, by the one rule", () => {
    const key = (k: string): { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean } => ({ key: k, ctrlKey: false, metaKey: false, altKey: false });
    expect(titleKeyAction(key("ArrowRight"), 9, TITLES, false)).toEqual({ kind: "move", to: 0 });
    expect(titleKeyAction(key("ArrowLeft"), 0, TITLES, true)).toEqual({ kind: "move", to: 9 });
    expect(titleKeyAction(key("Home"), 4, TITLES, false)).toEqual({ kind: "move", to: 0 });
    expect(titleKeyAction(key("End"), 4, TITLES, false)).toEqual({ kind: "move", to: 9 });
    expect(titleKeyAction(key("ArrowDown"), 3, TITLES, false)).toEqual({ kind: "open", last: false });
    expect(titleKeyAction(key("ArrowUp"), 3, TITLES, false)).toEqual({ kind: "open", last: true });
    expect(titleKeyAction(key("d"), 0, TITLES, false)).toEqual({ kind: "move", to: 6 });
    expect(titleKeyAction(key("d"), 6, TITLES, false)).toEqual({ kind: "move", to: 7 });
    expect(titleKeyAction(key("Escape"), 3, TITLES, true)).toEqual({ kind: "close" });
    expect(titleKeyAction(key("Escape"), 3, TITLES, false)).toBeNull();
    expect(titleKeyAction(key("q"), 3, TITLES, false)).toBeNull();
    expect(titleKeyAction({ ...key("d"), ctrlKey: true }, 0, TITLES, false)).toBeNull();
  });

  test("the command centre's name is the SolidJS one", () => {
    expect(commandCentreName("ring.dxf", false)).toBe("Search commands, ring.dxf");
    expect(commandCentreName("ring.dxf", true)).toBe("Search commands, ring.dxf, unsaved changes");
  });
});
