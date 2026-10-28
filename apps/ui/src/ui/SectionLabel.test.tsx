/**
 * SectionLabel's contract: a real heading, so a screen reader can jump between panels.
 */

import { describe, expect, test } from "bun:test";
import { SectionLabel } from "./SectionLabel";
import { mount } from "./test-utils";

describe("SectionLabel", () => {
  test("renders an h2 heading with its text", () => {
    const container = mount(() => <SectionLabel>Layers</SectionLabel>);
    const heading = container.querySelector("h2");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("Layers");
    expect(heading?.classList.contains("ui-section-label")).toBe(true);
  });
});
