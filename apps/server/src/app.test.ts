import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  budgetMonthResponseSchema,
  dashboardResponseSchema,
  expenseYearResponseSchema,
  financialAccountSchema,
  financialAccountsResponseSchema,
  financialGoalSchema,
  healthResponseSchema,
  ledgerTransactionSchema,
  liabilitiesResponseSchema,
  liabilitySchema,
  personalBalanceSchema,
  projectCommitmentSchema,
  projectExpenseSchema,
  projectSummaryResponseSchema,
  wealthAssetSchema,
  wealthResponseSchema,
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
    expect(dashboardResponseSchema.parse(dashboard.json()).regularExpensePaise).toBe(4567200);
    expect(dashboardResponseSchema.parse(dashboard.json()).totalExpensePaise).toBe(4590800);
    expect(dashboardResponseSchema.parse(dashboard.json()).cashOutflowPaise).toBe(20459200);

    const expenseYear = await app.inject({ method: "GET", url: "/api/v1/expenses/year?year=2026" });
    expect(expenseYear.statusCode).toBe(200);
    const parsedExpenseYear = expenseYearResponseSchema.parse(expenseYear.json());
    expect(parsedExpenseYear.months).toHaveLength(12);
    expect(parsedExpenseYear.months[5]?.cashOutflowPaise).toBe(23953400);

    const budget = await app.inject({ method: "GET", url: "/api/v1/budgets/2026-07" });
    expect(budget.statusCode).toBe(200);
    expect(budgetMonthResponseSchema.parse(budget.json()).regularBudgetPaise).toBe(6004800);
    const budgetUpdate = await app.inject({
      method: "PUT",
      url: "/api/v1/budgets/2026-08",
      payload: {
        plannedIncomePaise: 31000000,
        lines: [
          { categoryId: "category-rent", plannedPaise: 2100000 },
          {
            categoryId: "category-groceries",
            plannedPaise: 500000,
            actualPaise: 125000,
            comment: "API sheet edit",
          },
        ],
      },
    });
    expect(budgetUpdate.statusCode).toBe(200);
    expect(budgetMonthResponseSchema.parse(budgetUpdate.json())).toMatchObject({
      plannedIncomePaise: 31000000,
      regularBudgetPaise: 2600000,
      lines: expect.arrayContaining([
        expect.objectContaining({
          categoryId: "category-groceries",
          plannedPaise: 500000,
          spentPaise: 125000,
          comment: "API sheet edit",
        }),
      ]),
    });
    const augustDashboard = await app.inject({ method: "GET", url: "/api/v1/dashboard?month=2026-08" });
    expect(dashboardResponseSchema.parse(augustDashboard.json())).toMatchObject({
      regularExpensePaise: 125000,
      cashOutflowPaise: 125000,
      regularBudgetPaise: 2600000,
    });

    const liabilities = await app.inject({ method: "GET", url: "/api/v1/liabilities" });
    expect(liabilities.statusCode).toBe(200);
    expect(liabilitiesResponseSchema.parse(liabilities.json()).totalPrincipalPaise).toBe(724854600);
    expect(liabilitiesResponseSchema.parse(liabilities.json()).otherLiabilityPaise).toBe(20000000);
    expect(liabilitiesResponseSchema.parse(liabilities.json()).receivablePaise).toBe(8700000);

    const accounts = await app.inject({ method: "GET", url: "/api/v1/accounts" });
    expect(accounts.statusCode).toBe(200);
    expect(financialAccountsResponseSchema.parse(accounts.json()).accounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "account-debt-home", managedBy: "liability" })]),
    );
    const accountCreate = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: {
        name: "Test cash reserve",
        accountType: "investment",
        institution: null,
        openingBalancePaise: 150000,
        restricted: false,
      },
    });
    expect(accountCreate.statusCode).toBe(201);
    const createdAccount = financialAccountSchema.parse(accountCreate.json());
    expect(createdAccount.balancePaise).toBe(150000);
    const accountUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/accounts/${createdAccount.id}`,
      payload: { name: "Updated cash reserve" },
    });
    expect(accountUpdate.statusCode).toBe(200);
    expect(financialAccountSchema.parse(accountUpdate.json())).toMatchObject({
      name: "Updated cash reserve",
      isActive: true,
    });

    const liabilityUpdate = await app.inject({
      method: "PATCH",
      url: "/api/v1/liabilities/debt-groww",
      payload: { currentPrincipalPaise: 30000000, emiPaise: 1200000 },
    });
    expect(liabilityUpdate.statusCode).toBe(200);
    expect(liabilitySchema.parse(liabilityUpdate.json()).currentPrincipalPaise).toBe(30000000);

    const liabilityClear = await app.inject({
      method: "PATCH",
      url: "/api/v1/liabilities/debt-groww",
      payload: { status: "cleared" },
    });
    expect(liabilityClear.statusCode).toBe(200);
    expect(liabilitySchema.parse(liabilityClear.json()).canUndoClear).toBe(true);
    const liabilityUndo = await app.inject({
      method: "POST",
      url: "/api/v1/liabilities/debt-groww/undo-clear",
    });
    expect(liabilityUndo.statusCode).toBe(200);
    const restoredLiability = liabilitySchema.parse(liabilityUndo.json());
    expect(restoredLiability.status).toBe("active");
    expect(restoredLiability.currentPrincipalPaise).toBe(30000000);
    expect(restoredLiability.emiPaise).toBe(1200000);

    const liabilityCreate = await app.inject({
      method: "POST",
      url: "/api/v1/liabilities",
      payload: {
        name: "Test education loan",
        productType: "personal_loan",
        originalAmountPaise: 10000000,
        currentPrincipalPaise: 7500000,
        emiPaise: 250000,
        annualRateBps: 1025,
        status: "active",
      },
    });
    expect(liabilityCreate.statusCode).toBe(201);
    const createdLiability = liabilitySchema.parse(liabilityCreate.json());
    expect(createdLiability.name).toBe("Test education loan");
    expect(createdLiability.currentPrincipalPaise).toBe(7500000);

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

    const construction = await app.inject({
      method: "GET",
      url: "/api/v1/projects/home-construction",
    });
    expect(construction.statusCode).toBe(200);
    const parsedConstruction = projectSummaryResponseSchema.parse(construction.json());
    expect(parsedConstruction.expenses).toHaveLength(144);
    expect(parsedConstruction.actualExpensePaise).toBe(122581000);
    expect(parsedConstruction.freshness).toBe("needs_update");

    const reviewedExpense = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/home-construction/expenses/${parsedConstruction.expenses.find((item) => item.reviewStatus === "needs_review")?.id}`,
      payload: { reviewStatus: "confirmed" },
    });
    expect(reviewedExpense.statusCode).toBe(200);
    expect(projectExpenseSchema.parse(reviewedExpense.json()).reviewStatus).toBe("confirmed");

    const commitment = await app.inject({
      method: "POST",
      url: "/api/v1/projects/home-construction/commitments",
      payload: {
        vendorName: "Test carpenter",
        estimatedPaise: 500000,
        pendingPaise: 200000,
        status: "open",
      },
    });
    expect(commitment.statusCode).toBe(201);
    expect(projectCommitmentSchema.parse(commitment.json()).vendorName).toBe("Test carpenter");

    const wealth = await app.inject({ method: "GET", url: "/api/v1/wealth" });
    expect(wealth.statusCode).toBe(200);
    const parsedWealth = wealthResponseSchema.parse(wealth.json());
    expect(parsedWealth.savingsPaise).toBe(11880800);
    expect(parsedWealth.restrictedWalletPaise).toBe(880000);
    expect(parsedWealth.goals[0]?.progressPercentage).toBe(21);

    const wealthAsset = await app.inject({
      method: "POST",
      url: "/api/v1/wealth/assets",
      payload: {
        name: "Test investment",
        assetType: "investment",
        institution: "Test broker",
        currentValuePaise: 2500000,
        monthlyContributionPaise: 500000,
        restricted: false,
        asOfDate: "2026-07-23",
      },
    });
    expect(wealthAsset.statusCode).toBe(201);
    const createdWealthAsset = wealthAssetSchema.parse(wealthAsset.json());

    const financialGoal = await app.inject({
      method: "POST",
      url: "/api/v1/wealth/goals",
      payload: {
        name: "Test goal",
        targetPaise: 10000000,
        targetDate: "2027-12-31",
        priority: 2,
        monthlyContributionPaise: 500000,
      },
    });
    expect(financialGoal.statusCode).toBe(201);
    const createdGoal = financialGoalSchema.parse(financialGoal.json());
    const goalAllocation = await app.inject({
      method: "PUT",
      url: `/api/v1/wealth/goals/${createdGoal.id}/allocations`,
      payload: { allocations: [{ assetId: createdWealthAsset.id, amountPaise: 2000000 }] },
    });
    expect(goalAllocation.statusCode).toBe(200);
    expect(financialGoalSchema.parse(goalAllocation.json()).allocatedPaise).toBe(2000000);

    const manual = await app.inject({
      method: "POST",
      url: "/api/v1/transactions/manual",
      payload: {
        occurredOn: "2026-07-19",
        payee: "Test Pharmacy",
        kind: "expense",
        amountPaise: 79900,
        accountId: "account-primary-bank",
        categoryId: "category-medical",
        idempotencyKey: "api-test-device:1",
      },
    });
    expect(manual.statusCode).toBe(201);
    expect(ledgerTransactionSchema.parse(manual.json()).amountPaise).toBe(79900);

    const constructionExpense = await app.inject({
      method: "POST",
      url: "/api/v1/projects/home-construction/expenses",
      payload: {
        occurredOn: "2026-07-19",
        description: "Test window fitting",
        amountPaise: 150000,
        accountId: "account-primary-bank",
        idempotencyKey: "api-project-test:1",
      },
    });
    expect(constructionExpense.statusCode).toBe(201);
    expect(projectExpenseSchema.parse(constructionExpense.json()).linkedTransactionId).not.toBeNull();
    await app.close();
  });
});
