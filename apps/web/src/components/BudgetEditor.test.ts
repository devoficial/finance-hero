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

const homeConstructionLine: BudgetLine = {
  ...rentLine,
  categoryId: "category-home-construction",
  categoryName: "Home construction",
  broadBucket: "asset_building",
  budgetEligible: false,
  alertEligible: false,
  plannedPaise: 0,
  spentPaise: 0,
  remainingPaise: 0,
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

  it("saves a plan limit for non-regular tracker categories", () => {
    expect(changedBudgetLine(homeConstructionLine, 0, 500_000, "")).toEqual({
      categoryId: "category-home-construction",
      plannedPaise: 500_000,
    });
  });
});
