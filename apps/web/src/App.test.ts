import { describe, expect, it } from "vitest";
import { parseRouteHash, routeHash } from "./App";

describe("dashboard routes", () => {
  it("restores a persisted section and reporting period", () => {
    expect(parseRouteHash("#/liabilities?month=2026-05&year=2026")).toEqual({
      nav: "Liabilities",
      month: "2026-05",
      year: "2026",
    });
  });

  it("falls back safely when route values are invalid", () => {
    expect(parseRouteHash("#/unknown?month=July&year=26")).toEqual({
      nav: "Home",
      month: "2026-07",
      year: "2026",
    });
  });

  it("builds a reload-safe hash route", () => {
    expect(routeHash("Expenses", "2025-12", "2025")).toBe("#/expenses?month=2025-12&year=2025");
    expect(parseRouteHash("#/projects?month=2026-07&year=2026").nav).toBe("Projects");
  });
});
