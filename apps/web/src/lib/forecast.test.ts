import { describe, expect, it } from "vitest";
import { buildTwelveMonthForecast } from "./forecast";

describe("12-month forecast", () => {
  it("projects assets and debt from monthly cash flow without double counting EMI", () => {
    const forecast = buildTwelveMonthForecast({
      startMonth: "2026-07",
      plannedIncomePaise: 3_000_000,
      regularExpensePaise: 1_000_000,
      currentAssetPaise: 5_000_000,
      receivablePaise: 0,
      personalPayablePaise: 0,
      debts: [
        {
          id: "debt",
          name: "Debt",
          principalPaise: 12_000_000,
          emiPaise: 1_000_000,
          annualRateBps: 0,
        },
      ],
      extraDebtPaymentPaise: 0,
      annualIncomeGrowthPercentage: 0,
      annualExpenseInflationPercentage: 0,
    });

    expect(forecast.months).toHaveLength(12);
    expect(forecast.remainingDebtPaise).toBe(0);
    expect(forecast.projectedAssetPaise).toBe(17_000_000);
    expect(forecast.projectedNetWorthPaise).toBe(17_000_000);
  });

  it("applies expense inflation monthly and reports lower cumulative surplus", () => {
    const stable = buildTwelveMonthForecast({
      startMonth: "2026-07",
      plannedIncomePaise: 3_000_000,
      regularExpensePaise: 1_000_000,
      currentAssetPaise: 0,
      receivablePaise: 0,
      personalPayablePaise: 0,
      debts: [],
      extraDebtPaymentPaise: 0,
      annualIncomeGrowthPercentage: 0,
      annualExpenseInflationPercentage: 0,
    });
    const inflated = buildTwelveMonthForecast({
      startMonth: "2026-07",
      plannedIncomePaise: 3_000_000,
      regularExpensePaise: 1_000_000,
      currentAssetPaise: 0,
      receivablePaise: 0,
      personalPayablePaise: 0,
      debts: [],
      extraDebtPaymentPaise: 0,
      annualIncomeGrowthPercentage: 0,
      annualExpenseInflationPercentage: 12,
    });

    expect(inflated.cumulativeSurplusPaise).toBeLessThan(stable.cumulativeSurplusPaise);
    expect(inflated.months.at(-1)?.regularExpensePaise).toBeGreaterThan(1_000_000);
  });
});
