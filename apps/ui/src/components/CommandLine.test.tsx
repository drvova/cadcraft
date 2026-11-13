/**
 * The command line's JSON answers: which lines are records, and the words drawn above one.
 */

import { describe, expect, test } from "bun:test";
import { dataMessage, isData } from "./CommandLine";

describe("isData", () => {
  test("a record or a list is data; words are not", () => {
    expect(isData('{"a":1}')).toBe(true);
    expect(isData("  [1,2]")).toBe(true);
    expect(isData("Command: LINE")).toBe(false);
  });
});

describe("dataMessage", () => {
  test("reads the record's message on one line", () => {
    expect(dataMessage('{"message":"Price book\\n  updated.","book":{}}')).toBe("Price book updated.");
  });
  test("is null for no message, a list, an empty message or broken JSON", () => {
    expect(dataMessage('{"book":{}}')).toBeNull();
    expect(dataMessage('[{"message":"x"}]')).toBeNull();
    expect(dataMessage('{"message":"   "}')).toBeNull();
    expect(dataMessage('{"message":"x"')).toBeNull();
    expect(dataMessage('{"message":42}')).toBeNull();
  });
  test("clips a long message", () => {
    const words = dataMessage(JSON.stringify({ message: "a".repeat(500) }));
    expect(words?.length).toBe(240);
    expect(words?.endsWith("…")).toBe(true);
  });
});
