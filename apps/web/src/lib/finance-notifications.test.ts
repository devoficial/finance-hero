import { describe, expect, it } from "vitest";
import { financeNotificationDecisions } from "./finance-notifications";

const dashboard = {
  month: "2026-08",
  budgetUsedPercentage: 61,
  cashBalancePaise: 73_339_200,
  dangerAlert: true,
  totalEmiPaise: 14_357_000,
};

describe("financeNotificationDecisions", () => {
  it("creates both alerts during the first three days when the budget is in danger", () => {
    const decisions = financeNotificationDecisions(dashboard, new Date("2026-08-02T02:30:00.000Z"));

    expect(decisions.map((decision) => decision.key)).toEqual(["danger:2026-08", "month-start:2026-08"]);
    expect(decisions[0]?.body).toContain("61%");
    expect(decisions[1]?.body).toContain("Scheduled EMIs");
  });

  it("does not create a month-start alert after the third local day", () => {
    const decisions = financeNotificationDecisions(dashboard, new Date("2026-08-04T02:30:00.000Z"));

    expect(decisions.map((decision) => decision.key)).toEqual(["danger:2026-08"]);
  });

  it("does not create a danger alert when the live dashboard says the budget is safe", () => {
    const decisions = financeNotificationDecisions(
      { ...dashboard, dangerAlert: false },
      new Date("2026-08-10T02:30:00.000Z"),
    );

    expect(decisions).toEqual([]);
  });
});
