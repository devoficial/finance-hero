import type { BudgetLine } from "@finance-hero/contracts";
import { describe, expect, it } from "vitest";
import { changedBudgetLine } from "./BudgetEditor";

const rentLine: BudgetLine = {
  categoryId: "category-rent",
  categoryName: "Rent",
  broadBucket: "regular_expense",
  budgetEligible: true,
  alertEligible: true,
  plannedPaise: 2_050_000,
  spentPaise: 1_643_300,
  remainingPaise: 406_700,
  comment: "",
  updatedAt: null,
};

describe("expense sheet updates", () => {
  it("includes the changed monthly limit in the save payload", () => {
    expect(changedBudgetLine(rentLine, rentLine.spentPaise, 2_050_100, "")).toEqual({
      categoryId: "category-rent",
      plannedPaise: 2_050_100,
    });
  });

  it("does not emit a row when nothing changed", () => {
    expect(changedBudgetLine(rentLine, rentLine.spentPaise, rentLine.plannedPaise, "")).toBeNull();
  });
});
