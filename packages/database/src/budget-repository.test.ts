import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BudgetRepository } from "./budget-repository";
import { initializeFoundationSchema, openEncryptedDatabase } from "./encrypted-database";
import { ImportRepository } from "./import-repository";
import { LedgerRepository } from "./ledger-repository";
import { seedAcceptedOpeningSnapshot } from "./opening-seed";
import { WealthRepository } from "./wealth-repository";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), "finance-hero-budget-"));
  temporaryDirectories.push(directory);
  const database = openEncryptedDatabase(
    join(directory, "finance-hero.db"),
    Buffer.from("budget-test-key-with-at-least-32-characters"),
  );
  initializeFoundationSchema(database);
  seedAcceptedOpeningSnapshot(database);
  const ledger = new LedgerRepository(database);
  return {
    database,
    imports: new ImportRepository(database, ledger),
    ledger,
    repository: new BudgetRepository(database),
    wealth: new WealthRepository(database),
  };
}

describe("budget repository", () => {
  it("reads the accepted July allocation with category actuals", () => {
    const { database, repository } = createRepository();
    const budget = repository.getMonth("2026-07");

    expect(budget.plannedIncomePaise).toBe(30089300);
    expect(budget.regularBudgetPaise).toBe(6004800);
    expect(budget.lines.reduce((sum, line) => sum + line.plannedPaise, 0)).toBe(6004800);
    expect(budget.lines).toHaveLength(18);
    expect(budget.lines.find((line) => line.categoryId === "category-rent")).toMatchObject({
      plannedPaise: 2050000,
      spentPaise: 1643300,
      remainingPaise: 406700,
    });
    expect(budget.lines.find((line) => line.categoryId === "category-loan-charges")).toMatchObject({
      categoryName: "Loan and bank charges",
      budgetEligible: false,
      spentPaise: 23600,
    });
    expect(budget.lines.find((line) => line.categoryId === "category-loan-repayments")).toMatchObject({
      categoryName: "Loan repayments",
      budgetEligible: false,
      spentPaise: 0,
    });
    database.close();
  });

  it("restores historical limits without treating the source import as a page edit", () => {
    const { database, repository } = createRepository();
    const may = repository.getMonth("2026-05");

    expect(may.updatedAt).toBeNull();
    expect(may.plannedIncomePaise).toBe(30089300);
    expect(may.regularBudgetPaise).toBe(6004800);
    expect(may.unallocatedIncomePaise).toBe(24084500);
    expect(may.lines.find((line) => line.categoryId === "category-rent")).toMatchObject({
      plannedPaise: 2050000,
      spentPaise: 2050000,
    });
    expect(may.lines.find((line) => line.categoryId === "category-emi-payments")).toMatchObject({
      plannedPaise: 0,
      spentPaise: 11273100,
    });
    database.close();
  });

  it("carries June closing cash into July", () => {
    const { database, repository } = createRepository();
    const june = repository.getMonth("2026-06");
    const july = repository.getMonth("2026-07");

    expect(june.cashBridge).toMatchObject({
      carryoverPaise: 17133100,
      adjustmentTotalPaise: 31805300,
      fundsAvailablePaise: 48938400,
      cashOutflowPaise: 23953400,
      closingBalancePaise: 24985000,
    });
    expect(june.cashBridge.adjustments).toEqual([
      expect.objectContaining({
        occurredOn: "2026-06-28",
        label: "June salary",
        amountPaise: 30089300,
      }),
      expect.objectContaining({
        occurredOn: "2026-06-30",
        label: "Extra income",
        amountPaise: 1716000,
      }),
    ]);
    expect(july.cashBridge).toMatchObject({
      carryoverPaise: 24985000,
      adjustmentTotalPaise: 40800,
      fundsAvailablePaise: 25025800,
      cashOutflowPaise: 20459200,
      closingBalancePaise: 4566600,
    });
    expect(repository.getMonth("2026-08").cashBridge).toMatchObject({
      carryoverPaise: 4566600,
      adjustmentTotalPaise: 0,
      cashOutflowPaise: 0,
      closingBalancePaise: 4566600,
    });
    database.close();
  });

  it("recalculates later carryover when an earlier month cash entry changes", () => {
    const { database, repository } = createRepository();
    const june = repository.getMonth("2026-06");

    repository.updateMonth("2026-06", {
      cashAdjustments: [
        ...june.cashBridge.adjustments,
        {
          occurredOn: "2026-06-30",
          label: "Bank correction",
          amountPaise: -50000,
        },
      ],
    });

    expect(repository.getMonth("2026-06").cashBridge.closingBalancePaise).toBe(24935000);
    expect(repository.getMonth("2026-07").cashBridge.carryoverPaise).toBe(24935000);
    expect(repository.getMonth("2026-08").cashBridge.carryoverPaise).toBe(4516600);
    database.close();
  });

  it("uses a bank-confirmed closing balance and exposes the reconciliation difference", () => {
    const { database, repository } = createRepository();

    const july = repository.updateMonth("2026-07", {
      reconciliation: {
        statementBalancePaise: 1216050,
        reconciledOn: "2026-07-26",
      },
    });

    expect(july.cashBridge).toMatchObject({
      calculatedClosingBalancePaise: 4566600,
      statementBalancePaise: 1216050,
      reconciliationDifferencePaise: -3350550,
      reconciledOn: "2026-07-26",
      closingBalancePaise: 1216050,
    });
    expect(repository.getMonth("2026-08").cashBridge.carryoverPaise).toBe(1216050);
    database.close();
  });

  it("shows approved imported credits as editable extra income without duplicating cash", () => {
    const { database, imports, ledger, repository } = createRepository();
    imports.createArtifact({
      filename: "salary-account.csv",
      contentHash: "imported-credit-cash-bridge",
      mimeType: "text/csv",
      sizeBytes: 120,
      accountId: "account-primary-bank",
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-07-13",
          payee: "UPI credit",
          amountPaise: 15300,
          direction: "credit",
          confidence: 85,
          warnings: [],
          source: {},
        },
      ],
    });
    const candidate = imports.getQueue().candidates[0];
    if (!candidate) throw new Error("Expected imported credit.");
    const approved = imports.approveCandidates([candidate.id]);
    const transactionId = approved.candidates[0]?.transactionId;
    if (!transactionId) throw new Error("Expected approved credit transaction.");

    const july = repository.getMonth("2026-07");
    expect(july.cashBridge.adjustmentTotalPaise).toBe(56100);
    expect(july.cashBridge.adjustments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          occurredOn: "2026-07-13",
          label: "UPI credit",
          amountPaise: 15300,
          source: "imported_credit",
          transactionId,
        }),
      ]),
    );

    repository.updateMonth("2026-07", {
      cashAdjustments: july.cashBridge.adjustments.map((adjustment) =>
        adjustment.transactionId === transactionId
          ? { ...adjustment, label: "Refund received", amountPaise: 20000 }
          : adjustment,
      ),
    });
    expect(repository.getMonth("2026-07").cashBridge.adjustmentTotalPaise).toBe(60800);
    expect(ledger.listTransactions("2026-07").find((transaction) => transaction.id === transactionId)).toMatchObject({
      payee: "Refund received",
      amountPaise: 20000,
    });
    expect(imports.getQueue().candidates[0]).toMatchObject({
      payee: "Refund received",
      amountPaise: 20000,
    });
    imports.resetCandidatesToPending([candidate.id]);
    expect(repository.getMonth("2026-07").cashBridge.adjustmentTotalPaise).toBe(40800);
    database.close();
  });

  it("rejects a cash entry outside the selected month", () => {
    const { database, repository } = createRepository();
    expect(() =>
      repository.updateMonth("2026-06", {
        cashAdjustments: [
          {
            occurredOn: "2026-07-01",
            label: "Wrong month",
            amountPaise: 10000,
          },
        ],
      }),
    ).toThrow("inside the selected month");
    database.close();
  });

  it("edits a sheet row and updates the ledger, dashboard, monthly cards, and emergency-cover target", () => {
    const { database, ledger, repository, wealth } = createRepository();
    const dashboardBefore = ledger.getDashboard("2026-07", 18);
    const emergencyBefore = wealth.getWealth("2026-07-26").goals.find((goal) => goal.id === "goal-emergency-fund");

    const updated = repository.updateMonth("2026-07", {
      lines: [
        {
          categoryId: "category-groceries",
          actualPaise: 100000,
          plannedPaise: 250000,
          comment: "Edited from monthly expense sheet",
        },
      ],
    });

    expect(updated.updatedAt).not.toBeNull();
    expect(updated.regularBudgetPaise).toBe(6054800);
    expect(updated.lines.find((line) => line.categoryId === "category-groceries")).toMatchObject({
      spentPaise: 100000,
      plannedPaise: 250000,
      remainingPaise: 150000,
      comment: "Edited from monthly expense sheet",
    });
    const editedRow = updated.lines.find((line) => line.categoryId === "category-groceries");
    expect(editedRow?.updatedAt).toBe(updated.updatedAt);

    const dashboardAfter = ledger.getDashboard("2026-07", 18);
    expect(dashboardAfter.regularExpensePaise).toBe(dashboardBefore.regularExpensePaise + 43200);
    expect(dashboardAfter.cashOutflowPaise).toBe(dashboardBefore.cashOutflowPaise + 43200);
    expect(dashboardAfter.regularBudgetPaise).toBe(6054800);
    expect(ledger.getExpenseYear("2026").months[6]).toMatchObject({
      regularExpensePaise: dashboardAfter.regularExpensePaise,
      cashOutflowPaise: dashboardAfter.cashOutflowPaise,
      regularBudgetPaise: 6054800,
    });
    expect(
      database.connection
        .prepare("SELECT payee, origin FROM journal_transactions WHERE id = ?")
        .get("migration-expense-history-2026-07-category-groceries"),
    ).toEqual({
      payee: "Groceries, food and eating out",
      origin: "expense_sheet_aggregate",
    });

    const emergencyAfter = wealth.getWealth("2026-07-26").goals.find((goal) => goal.id === "goal-emergency-fund");
    expect(emergencyAfter?.monthlyNeedPaise).toBe((emergencyBefore?.monthlyNeedPaise ?? 0) + 50000);
    expect(emergencyAfter?.targetPaise).toBe((emergencyBefore?.targetPaise ?? 0) + 150000);
    database.close();
  });

  it("uses a signed sheet correction when a total is lower than detailed transactions", () => {
    const { database, ledger, repository } = createRepository();
    ledger.createManualTransaction({
      occurredOn: "2026-08-05",
      payee: "Neighbourhood store",
      kind: "expense",
      amountPaise: 75000,
      accountId: "account-primary-bank",
      categoryId: "category-groceries",
      idempotencyKey: "budget-sheet:detailed-august-grocery",
    });

    const corrected = repository.updateMonth("2026-08", {
      lines: [{ categoryId: "category-groceries", actualPaise: 50000 }],
    });
    expect(corrected.lines.find((line) => line.categoryId === "category-groceries")?.spentPaise).toBe(50000);
    expect(ledger.getDashboard("2026-08", 5).cashOutflowPaise).toBe(50000);

    const updated = repository.updateMonth("2026-08", {
      plannedIncomePaise: 32500000,
      lines: [
        {
          categoryId: "category-groceries",
          actualPaise: 125000,
          plannedPaise: 200000,
          comment: "Includes manual store purchase",
        },
      ],
    });
    expect(updated.lines.find((line) => line.categoryId === "category-groceries")).toMatchObject({
      spentPaise: 125000,
      plannedPaise: 200000,
      comment: "Includes manual store purchase",
    });
    expect(ledger.getDashboard("2026-08", 5)).toMatchObject({
      regularExpensePaise: 125000,
      cashOutflowPaise: 125000,
      regularBudgetPaise: 200000,
    });
    database.close();
  });

  it("creates a future plan, derives the category total, and updates dashboard percentages", () => {
    const { database, ledger, repository } = createRepository();
    const updated = repository.updateMonth("2026-08", {
      plannedIncomePaise: 32500000,
      lines: [
        { categoryId: "category-rent", plannedPaise: 2100000 },
        { categoryId: "category-groceries", plannedPaise: 800000 },
      ],
    });

    expect(updated.plannedIncomePaise).toBe(32500000);
    expect(updated.regularBudgetPaise).toBe(2900000);
    expect(updated.unallocatedIncomePaise).toBe(29600000);
    expect(ledger.getDashboard("2026-08", 1)).toMatchObject({
      plannedIncomePaise: 32500000,
      regularBudgetPaise: 2900000,
      budgetUsedPercentage: 0,
    });
    const audit = database.connection
      .prepare("SELECT action FROM audit_events WHERE entity_id = '2026-08' ORDER BY created_at DESC LIMIT 1")
      .get() as { action: string };
    expect(audit.action).toBe("expense_sheet.updated");
    database.close();
  });

  it("rejects unknown and duplicate budget categories", () => {
    const { database, repository } = createRepository();
    expect(() =>
      repository.updateMonth("2026-07", {
        lines: [{ categoryId: "category-not-real", plannedPaise: 10000 }],
      }),
    ).toThrow("Expense sheet category does not exist");
    expect(() =>
      repository.updateMonth("2026-07", {
        lines: [
          { categoryId: "category-rent", plannedPaise: 10000 },
          { categoryId: "category-rent", plannedPaise: 20000 },
        ],
      }),
    ).toThrow("provided more than once");
    database.close();
  });
});
