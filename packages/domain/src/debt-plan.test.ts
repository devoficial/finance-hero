import { describe, expect, it } from "vitest";
import { simulateDebtPlan } from "./debt-plan";

describe("debt plan", () => {
  it("amortizes a zero-interest loan to the paise", () => {
    const result = simulateDebtPlan(
      [{ id: "loan", name: "Loan", principalPaise: 120_000, emiPaise: 10_000, annualRateBps: 0 }],
      "snowball",
      0,
      "2026-07",
    );

    expect(result.debtFree).toBe(true);
    expect(result.payoffMonths).toBe(12);
    expect(result.debtFreeMonth).toBe("2027-07");
    expect(result.totalInterestPaise).toBe(0);
    expect(result.totalPaymentPaise).toBe(120_000);
  });

  it("changes the first payoff target between snowball and avalanche", () => {
    const debts = [
      { id: "small", name: "Small balance", principalPaise: 100_000, emiPaise: 1_000, annualRateBps: 0 },
      { id: "costly", name: "High rate", principalPaise: 200_000, emiPaise: 10_000, annualRateBps: 2_400 },
    ];

    const snowball = simulateDebtPlan(debts, "snowball", 10_000, "2026-07");
    const avalanche = simulateDebtPlan(debts, "avalanche", 10_000, "2026-07");

    expect(snowball.payoffOrder[0]?.id).toBe("small");
    expect(avalanche.payoffOrder[0]?.id).toBe("costly");
    expect(avalanche.totalInterestPaise).toBeLessThan(snowball.totalInterestPaise);
  });

  it("reports an unresolved plan when no payment can reduce the debt", () => {
    const result = simulateDebtPlan(
      [{ id: "stalled", name: "Stalled", principalPaise: 100_000, emiPaise: 0, annualRateBps: 0 }],
      "snowball",
      0,
      "2026-07",
    );

    expect(result.debtFree).toBe(false);
    expect(result.payoffMonths).toBeNull();
    expect(result.months).toHaveLength(1);
  });
});
