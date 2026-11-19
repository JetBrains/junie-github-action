import { describe, expect, test } from "bun:test";
import { parseWorkflowDispatchPrNumber } from "../src/github/context";

describe("parseWorkflowDispatchPrNumber", () => {
  test("parses a numeric PR number", () => {
    expect(parseWorkflowDispatchPrNumber("42")).toBe(42);
    expect(parseWorkflowDispatchPrNumber(42)).toBe(42);
  });

  test("returns undefined for missing or invalid values", () => {
    expect(parseWorkflowDispatchPrNumber(undefined)).toBeUndefined();
    expect(parseWorkflowDispatchPrNumber("invalid")).toBeUndefined();
    expect(parseWorkflowDispatchPrNumber("0")).toBeUndefined();
    expect(parseWorkflowDispatchPrNumber(Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
  });
});