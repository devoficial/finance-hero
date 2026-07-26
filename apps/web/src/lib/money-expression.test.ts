import { describe, expect, it } from "vitest";
import { parseRupeeExpression, rupeeInput } from "./money-expression";

describe("money expression", () => {
  it("adds and subtracts INR values", () => {
    expect(parseRupeeExpression("16,433 + 500 - 200")).toBe(1673300);
    expect(parseRupeeExpression("300893+17160")).toBe(31805300);
  });

  it("supports signed adjustments but rejects negative expense totals", () => {
    expect(parseRupeeExpression("-500+100", true)).toBe(-40000);
    expect(parseRupeeExpression("-500+100")).toBeNull();
  });

  it("rejects unsupported formulas", () => {
    expect(parseRupeeExpression("100*2")).toBeNull();
    expect(parseRupeeExpression("alert(1)")).toBeNull();
    expect(parseRupeeExpression("100+")).toBeNull();
  });

  it("preserves paise when preparing an editable value", () => {
    expect(rupeeInput(12345)).toBe("123.45");
    expect(rupeeInput(12300)).toBe("123");
  });
});
