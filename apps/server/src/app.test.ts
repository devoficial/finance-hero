import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dashboardResponseSchema,
  expenseYearResponseSchema,
  healthResponseSchema,
  ledgerTransactionSchema,
  liabilitiesResponseSchema,
  liabilitySchema,
  personalBalanceSchema,
} from "@finance-hero/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("local API", () => {
  it("reports an encrypted database when configured", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-server-"));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({
      config: {
        host: "127.0.0.1",
        port: 4317,
        dataDirectory,
        databaseKey: "server-test-key-with-at-least-32-characters",
      },
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).database).toBe("encrypted");

    const dashboard = await app.inject({ method: "GET", url: "/api/v1/dashboard?month=2026-07" });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboardResponseSchema.parse(dashboard.json()).regularExpensePaise).toBe(6004800);

    const expenseYear = await app.inject({ method: "GET", url: "/api/v1/expenses/year?year=2026" });
    expect(expenseYear.statusCode).toBe(200);
    expect(expenseYearResponseSchema.parse(expenseYear.json()).months).toHaveLength(12);

    const liabilities = await app.inject({ method: "GET", url: "/api/v1/liabilities" });
    expect(liabilities.statusCode).toBe(200);
    expect(liabilitiesResponseSchema.parse(liabilities.json()).totalPrincipalPaise).toBe(724854600);
    expect(liabilitiesResponseSchema.parse(liabilities.json()).otherLiabilityPaise).toBe(20000000);
    expect(liabilitiesResponseSchema.parse(liabilities.json()).receivablePaise).toBe(8700000);

    const liabilityUpdate = await app.inject({
      method: "PATCH",
      url: "/api/v1/liabilities/debt-groww",
      payload: { currentPrincipalPaise: 30000000, emiPaise: 1200000 },
    });
    expect(liabilityUpdate.statusCode).toBe(200);
    expect(liabilitySchema.parse(liabilityUpdate.json()).currentPrincipalPaise).toBe(30000000);

    const personalBalance = await app.inject({
      method: "POST",
      url: "/api/v1/personal-balances",
      payload: { name: "Test friend", direction: "payable", amountPaise: 240000 },
    });
    expect(personalBalance.statusCode).toBe(201);
    const createdPersonalBalance = personalBalanceSchema.parse(personalBalance.json());
    const personalBalanceUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/personal-balances/${createdPersonalBalance.id}`,
      payload: { status: "settled" },
    });
    expect(personalBalanceUpdate.statusCode).toBe(200);
    expect(personalBalanceSchema.parse(personalBalanceUpdate.json()).status).toBe("settled");

    const manual = await app.inject({
      method: "POST",
      url: "/api/v1/transactions/manual",
      payload: {
        occurredOn: "2026-07-19",
        payee: "Test Pharmacy",
        kind: "expense",
        amountPaise: 79900,
        assetAccountId: "account-primary-bank",
        categoryId: "category-medical",
        idempotencyKey: "api-test-device:1",
      },
    });
    expect(manual.statusCode).toBe(201);
    expect(ledgerTransactionSchema.parse(manual.json()).amountPaise).toBe(79900);
    await app.close();
  });
});
