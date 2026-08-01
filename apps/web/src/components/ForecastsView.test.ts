import type { DashboardResponse } from "@finance-hero/contracts";
import { describe, expect, it } from "vitest";
import { forecastIncomeDefault, PERSONAL_MONTHLY_SALARY_PAISE } from "./ForecastsView";

describe("forecast scenario defaults", () => {
  it("uses the personalized salary when a month has no saved income", () => {
    expect(forecastIncomeDefault()).toBe(30089300);
    expect(PERSONAL_MONTHLY_SALARY_PAISE).toBe(30089300);
  });

  it("prefers an explicitly saved monthly salary", () => {
    expect(forecastIncomeDefault({ plannedIncomePaise: 32500000 } as DashboardResponse)).toBe(32500000);
  });
});
