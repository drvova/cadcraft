/**
 * The proposal cards' contract: a labelled region per proposal with its figures as a table, the
 * checks it would fail said first and in words, Accept and Reject in the Tab order, one Reject
 * all over the variants of one `propose`, and a stale proposal that offers only Reject.
 */

import { describe, expect, test } from "bun:test";
import { AppFacade } from "../facade";
import { MockFacade } from "../mock";
import { createProposals, createStillCache } from "../proposals";
import { mount } from "../test-utils";
import { ProposalCards } from "./ProposalCards";

function harness(propose: Record<string, unknown>, opts: { busy?: boolean; stale?: boolean } = {}) {
  const facade = new AppFacade(new MockFacade(), { kind: "mock", detail: "test" });
  facade.execute("piece", { kind: "solitaire" });
  const model = createProposals({ execute: (c, p) => facade.execute(c, p) });
  expect(facade.execute("propose", propose).ok).toBe(true);
  if (opts.stale === true) facade.execute("piece", { width: 2.5 });
  model.sync();
  const decided: (string | null)[] = [];
  const stills = createStillCache(
    (c, p) => facade.execute(c, p),
    async () => ({ message: "The still could not be drawn: WebGL is not available." }),
  );
  const container = mount(() => <ProposalCards model={model} stills={stills} busy={opts.busy === true} onDecided={(t) => decided.push(t)} />);
  return { facade, model, container, decided };
}

const buttons = (el: Element): HTMLButtonElement[] => [...el.querySelectorAll("button")];
const named = (el: Element, name: string): HTMLButtonElement[] => buttons(el).filter((b) => b.textContent?.trim() === name);

describe("ProposalCards", () => {
  test("one proposal: a labelled region, the figures as a table, Accept and Reject", () => {
    const { container, model, decided } = harness({ steps: [{ command: "piece", params: { width: 2.8 } }], title: "Wider" });
    const region = container.querySelector("[role=region]");
    expect(region).not.toBeNull();
    const title = region?.querySelector(`#${region.getAttribute("aria-labelledby") ?? "none"}`);
    expect(title?.textContent).toBe("Wider");
    const row = [...container.querySelectorAll("tbody tr")].find((tr) => tr.querySelector("th")?.textContent === "Width");
    expect([...(row?.querySelectorAll("td") ?? [])].map((td) => td.textContent)).toEqual(["2.2 mm", "2.8 mm", "+0.6 mm"]);
    expect([...container.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Figure", "Before", "After", "Change"]);
    // Both are real buttons, so both are in the Tab order and Enter presses them.
    expect(named(container, "Reject")).toHaveLength(1);
    const accept = named(container, "Accept")[0];
    expect(accept?.getAttribute("aria-disabled")).not.toBe("true");
    expect(container.querySelector("[role=status]")?.textContent).toContain("Proposal to review: Wider");
    accept?.click();
    expect(decided).toEqual(["Wider"]);
    expect(model.list()).toEqual([]);
  });

  test("three variants: one Reject all, an Accept each, and the broken check said first", () => {
    const { container, model, decided } = harness({
      variants: [
        { title: "Wider", steps: [{ command: "piece", params: { width: 2.8 } }] },
        { title: "Thin wall", steps: [{ command: "piece", params: { wall: 0.5 } }] },
        { title: "Platinum", steps: [{ command: "piece", params: { metal: "platinum" } }] },
      ],
    });
    expect(container.querySelectorAll("[role=region]")).toHaveLength(3);
    expect(container.querySelector("[role=group]")?.getAttribute("aria-labelledby")).not.toBeNull();
    expect(named(container, "Accept")).toHaveLength(3);
    expect(named(container, "Reject all")).toHaveLength(1);
    const thin = [...container.querySelectorAll("[role=region]")][1];
    const broken = thin?.querySelector("ul[aria-label='Checks it would fail']");
    expect(broken?.textContent).toContain("Would fail");
    expect(broken?.textContent).toContain("0.5 mm");
    // It stands before the table of figures.
    const order = [...(thin?.children ?? [])].map((c) => c.tagName);
    expect(order.indexOf("UL")).toBeLessThan(order.indexOf("TABLE"));
    named(container, "Reject all")[0]?.click();
    expect(model.list()).toEqual([]);
    expect(decided).toEqual([null]);
  });

  test("a stale proposal says so and offers only Reject", () => {
    const { container } = harness({ steps: [{ command: "piece", params: { width: 3 } }] }, { stale: true });
    expect(container.textContent).toContain("Out of date");
    expect(container.textContent).toContain("The drawing changed since this was proposed");
    expect(named(container, "Accept")).toHaveLength(0);
    expect(named(container, "Reject")).toHaveLength(1);
  });

  test("while a turn runs, Accept waits and says why", () => {
    const { container, model } = harness({ steps: [{ command: "piece", params: { width: 3 } }] }, { busy: true });
    const accept = named(container, "Accept")[0];
    expect(accept?.getAttribute("aria-disabled")).toBe("true");
    accept?.click();
    expect(model.list()).toHaveLength(1);
  });

  test("a change with no piece: the objects line, and no stills", () => {
    const facade = new AppFacade(new MockFacade(), { kind: "mock", detail: "test" });
    const model = createProposals({ execute: (c, p) => facade.execute(c, p) });
    facade.execute("propose", { steps: [{ command: "circle", params: { center: [0, 0], radius: 2 } }, { command: "circle", params: { center: [5, 0], radius: 2 } }] });
    model.sync();
    const container = mount(() => <ProposalCards model={model} busy={false} onDecided={() => {}} />);
    expect(container.textContent).toContain("2 objects added");
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("figure")).toBeNull();
  });
});
