import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeFoundationSchema, openEncryptedDatabase } from "./encrypted-database";
import { LedgerRepository } from "./ledger-repository";
import { seedAcceptedOpeningSnapshot } from "./opening-seed";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), "finance-hero-ledger-"));
  temporaryDirectories.push(directory);
  const database = openEncryptedDatabase(
    join(directory, "finance-hero.db"),
    Buffer.from("ledger-test-key-with-at-least-32-characters"),
  );
  initializeFoundationSchema(database);
  seedAcceptedOpeningSnapshot(database);
  return { database, repository: new LedgerRepository(database) };
}

describe("ledger repository", () => {
  it("calculates the accepted opening dashboard from persisted data", () => {
    const { database, repository } = createRepository();
    const dashboard = repository.getDashboard("2026-07", 18);

    expect(dashboard.plannedIncomePaise).toBe(30089300);
    expect(dashboard.regularExpensePaise).toBe(4567200);
    expect(dashboard.totalExpensePaise).toBe(4590800);
    expect(dashboard.cashOutflowPaise).toBe(20459200);
    expect(dashboard.debtPaymentPaise).toBe(11273100);
    expect(dashboard.assetBuildingPaise).toBe(4595300);
    expect(dashboard.regularBudgetPaise).toBe(6004800);
    expect(dashboard.budgetUsedPercentage).toBe(76);
    expect(dashboard.totalEmiPaise).toBe(12745100);
    expect(dashboard.debtPrincipalPaise).toBe(724854600);
    expect(dashboard.availableAfterPlanPaise).toBe(9630100);
    expect(dashboard.transactionCount).toBe(14);

    const expenseYear = repository.getExpenseYear("2026");
    expect(expenseYear.months).toHaveLength(12);
    expect(expenseYear.months.map((month) => month.regularExpensePaise)).toEqual([
      7959800, 9396000, 8372100, 6762500, 7549000, 3457400, 4567200, 0, 0, 0, 0, 0,
    ]);
    expect(expenseYear.months.map((month) => month.totalExpensePaise)).toEqual([
      7959800, 9396000, 8372100, 6762500, 7549000, 3457400, 4590800, 0, 0, 0, 0, 0,
    ]);
    expect(expenseYear.months.map((month) => month.cashOutflowPaise)).toEqual([
      49457600, 42068800, 27846300, 48958800, 40909100, 23953400, 20459200, 0, 0, 0, 0, 0,
    ]);
    expect(expenseYear.months.map((month) => month.debtPaymentPaise)).toEqual([
      13616000, 21991500, 13892900, 23756200, 28818600, 18029800, 11273100, 0, 0, 0, 0, 0,
    ]);
    expect(expenseYear.months.map((month) => month.assetBuildingPaise)).toEqual([
      27881800, 10681300, 5581300, 18440100, 4541500, 2466200, 4595300, 0, 0, 0, 0, 0,
    ]);
    expect(expenseYear.months.slice(0, 7).every((month) => month.transactionCount > 0)).toBe(true);

    const priorYear = repository.getExpenseYear("2025");
    expect(priorYear.months.map((month) => month.regularExpensePaise)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 5072300, 13860000, 8233300, 12338900,
    ]);
    expect(priorYear.months.map((month) => month.totalExpensePaise)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 5072300, 13860000, 8233300, 12338900,
    ]);
    expect(priorYear.months.map((month) => month.cashOutflowPaise)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 5072300, 32118900, 37470500, 39563700,
    ]);
    expect(priorYear.months.map((month) => month.debtPaymentPaise)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 15508200, 23148300, 21143000,
    ]);
    expect(priorYear.months.map((month) => month.assetBuildingPaise)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 2750700, 6088900, 6081800,
    ]);

    const june = repository.getDashboard("2026-06", 30);
    expect(june.regularExpensePaise).toBe(3457400);
    expect(june.totalExpensePaise).toBe(3457400);
    expect(june.cashOutflowPaise).toBe(23953400);
    expect(june.debtPaymentPaise).toBe(18029800);
    expect(june.assetBuildingPaise).toBe(2466200);
    expect(june.expenseCategories.find((item) => item.id === "category-credit-card-bills")?.amountPaise).toBe(6679400);

    const liabilities = repository.getLiabilities();
    expect(liabilities.totalPrincipalPaise).toBe(724854600);
    expect(liabilities.totalEmiPaise).toBe(12745100);
    expect(liabilities.otherLiabilityPaise).toBe(20000000);
    expect(liabilities.receivablePaise).toBe(8700000);
    expect(liabilities.netObligationPaise).toBe(736154600);
    expect(liabilities.activeCount).toBe(10);
    expect(liabilities.clearedCount).toBe(1);
    expect(liabilities.otherLiabilities).toHaveLength(4);
    expect(liabilities.receivables).toHaveLength(2);
    expect(liabilities.liabilities.find((item) => item.name === "Two-wheeler loan")?.status).toBe("cleared");
    database.close();
  });

  it("persists one balanced manual expense and handles an idempotent retry", () => {
    const { database, repository } = createRepository();
    const input = {
      occurredOn: "2026-07-19",
      payee: "Test Cafe",
      kind: "expense" as const,
      amountPaise: 42500,
      accountId: "account-primary-bank",
      categoryId: "category-groceries",
      idempotencyKey: "test-device:1",
    };

    const first = repository.createManualTransaction(input);
    const retry = repository.createManualTransaction(input);

    expect(retry.id).toBe(first.id);
    expect(repository.getDashboard("2026-07", 19).regularExpensePaise).toBe(4609700);
    expect(repository.getDashboard("2026-07", 19).totalExpensePaise).toBe(4633300);
    expect(repository.getDashboard("2026-07", 19).cashOutflowPaise).toBe(20501700);
    const balance = database.connection
      .prepare("SELECT SUM(amount_paise) AS total FROM postings WHERE transaction_id = ?")
      .get(first.id) as { total: number };
    expect(balance.total).toBe(0);
    database.close();
  });

  it("posts one split expense without duplicating the ledger row", () => {
    const { database, repository } = createRepository();
    const transaction = repository.createManualTransaction({
      occurredOn: "2026-07-20",
      payee: "Split supermarket bill",
      kind: "expense",
      amountPaise: 100000,
      accountId: "account-primary-bank",
      splits: [
        { categoryId: "category-groceries", amountPaise: 70000 },
        { categoryId: "category-household", amountPaise: 30000 },
      ],
      idempotencyKey: "test-device:split-1",
    });

    expect(transaction.splits).toEqual([
      { categoryId: "category-groceries", categoryName: "Groceries, food and eating out", amountPaise: 70000 },
      { categoryId: "category-household", categoryName: "Cook, maid and gas", amountPaise: 30000 },
    ]);
    expect(repository.listTransactions("2026-07").filter((item) => item.id === transaction.id)).toHaveLength(1);
    expect(repository.getDashboard("2026-07", 20).regularExpensePaise).toBe(4667200);
    const balance = database.connection
      .prepare("SELECT SUM(amount_paise) AS total FROM postings WHERE transaction_id = ?")
      .get(transaction.id) as { total: number };
    expect(balance.total).toBe(0);
    database.close();
  });

  it("keeps own-account transfers out of expenses", () => {
    const { database, repository } = createRepository();
    const before = repository.getDashboard("2026-07", 20);
    const transfer = repository.createManualTransaction({
      occurredOn: "2026-07-20",
      payee: "Move to savings",
      kind: "transfer",
      amountPaise: 500000,
      accountId: "account-primary-bank",
      destinationAccountId: "account-savings",
      idempotencyKey: "test-device:transfer-1",
    });

    expect(transfer.kind).toBe("transfer");
    expect(transfer.destinationAccountName).toBe("Savings");
    expect(repository.getDashboard("2026-07", 20).cashOutflowPaise).toBe(before.cashOutflowPaise);
    database.close();
  });

  it("updates debt principal and restores it when a debt payment is reversed", () => {
    const { database, repository } = createRepository();
    const payment = repository.createManualTransaction({
      occurredOn: "2026-07-20",
      payee: "DMI principal payment",
      kind: "debt_payment",
      amountPaise: 100000,
      accountId: "account-primary-bank",
      destinationAccountId: "account-debt-dmi",
      idempotencyKey: "test-device:debt-payment-1",
    });

    expect(payment.kind).toBe("debt_payment");
    expect(repository.getLiabilities().liabilities.find((item) => item.id === "debt-dmi")?.currentPrincipalPaise).toBe(
      23714000,
    );
    expect(repository.getDashboard("2026-07", 20).debtPaymentPaise).toBe(11373100);
    const reversed = repository.reverseTransaction(payment.id, {
      reason: "Test reversal",
      idempotencyKey: "test-device:debt-payment-reverse-1",
    });
    expect(reversed.status).toBe("reversed");
    expect(repository.getLiabilities().liabilities.find((item) => item.id === "debt-dmi")?.currentPrincipalPaise).toBe(
      23814000,
    );
    expect(repository.getDashboard("2026-07", 20).debtPaymentPaise).toBe(11273100);
    database.close();
  });

  it("adds card purchases to the card principal and removes them on reversal", () => {
    const { database, repository } = createRepository();
    const purchase = repository.createManualTransaction({
      occurredOn: "2026-07-20",
      payee: "Card grocery purchase",
      kind: "expense",
      amountPaise: 250000,
      accountId: "account-debt-icici-card",
      categoryId: "category-groceries",
      idempotencyKey: "test-device:card-purchase-1",
    });

    expect(
      repository.getLiabilities().liabilities.find((item) => item.id === "debt-icici-card")?.currentPrincipalPaise,
    ).toBe(3676500);
    repository.reverseTransaction(purchase.id, {
      reason: "Card purchase duplicated",
      idempotencyKey: "test-device:card-purchase-reverse-1",
    });
    expect(
      repository.getLiabilities().liabilities.find((item) => item.id === "debt-icici-card")?.currentPrincipalPaise,
    ).toBe(3426500);
    database.close();
  });

  it("corrects a posted expense by reversing and replacing it", () => {
    const { database, repository } = createRepository();
    const original = repository.createManualTransaction({
      occurredOn: "2026-07-20",
      payee: "Wrong cafe",
      kind: "expense",
      amountPaise: 100000,
      accountId: "account-primary-bank",
      categoryId: "category-groceries",
      idempotencyKey: "test-device:correction-original",
    });
    const replacement = repository.replaceTransaction(original.id, {
      occurredOn: "2026-07-20",
      payee: "Correct cafe",
      kind: "expense",
      amountPaise: 75000,
      accountId: "account-primary-bank",
      categoryId: "category-learning",
      idempotencyKey: "test-device:correction-replacement",
    });

    expect(repository.listTransactions("2026-07").find((item) => item.id === original.id)?.status).toBe("reversed");
    expect(replacement.correctedFromId).toBe(original.id);
    expect(replacement.categoryName).toBe("Learning, entertainment and subscriptions");
    expect(repository.getDashboard("2026-07", 20).regularExpensePaise).toBe(4642200);
    const audits = database.connection
      .prepare("SELECT action FROM audit_events WHERE entity_id = ? ORDER BY created_at, rowid")
      .all(original.id) as Array<{ action: string }>;
    expect(audits.map((item) => item.action)).toContain("transaction.replaced");
    database.close();
  });

  it("updates a liability and recalculates portfolio totals", () => {
    const { database, repository } = createRepository();
    const updated = repository.updateLiability("debt-dmi", {
      currentPrincipalPaise: 20000000,
      emiPaise: 1200000,
      annualRateBps: 1550,
    });

    expect(updated.currentPrincipalPaise).toBe(20000000);
    expect(updated.emiPaise).toBe(1200000);
    expect(updated.annualRateBps).toBe(1550);
    expect(repository.getLiabilities().totalPrincipalPaise).toBe(721040600);
    expect(repository.getLiabilities().totalEmiPaise).toBe(12811100);
    const audit = database.connection
      .prepare("SELECT action FROM audit_events WHERE entity_id = 'debt-dmi' ORDER BY created_at DESC LIMIT 1")
      .get() as { action: string };
    expect(audit.action).toBe("liability.updated");
    database.close();
  });

  it("creates an audited liability and includes it in portfolio totals", () => {
    const { database, repository } = createRepository();
    const created = repository.createLiability({
      name: "Test education loan",
      productType: "personal_loan",
      originalAmountPaise: 10000000,
      currentPrincipalPaise: 7500000,
      emiPaise: 250000,
      annualRateBps: 1025,
      status: "active",
    });

    expect(created.name).toBe("Test education loan");
    expect(created.currentPrincipalPaise).toBe(7500000);
    expect(created.emiPaise).toBe(250000);
    const portfolio = repository.getLiabilities();
    expect(portfolio.liabilities).toHaveLength(12);
    expect(portfolio.totalPrincipalPaise).toBe(732354600);
    expect(portfolio.totalEmiPaise).toBe(12995100);
    const audit = database.connection
      .prepare("SELECT action FROM audit_events WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(created.id) as { action: string };
    expect(audit.action).toBe("liability.created");
    database.close();
  });

  it("clears a liability and removes its principal and EMI from active totals", () => {
    const { database, repository } = createRepository();
    const cleared = repository.updateLiability("debt-dmi", { status: "cleared" });

    expect(cleared.status).toBe("cleared");
    expect(cleared.currentPrincipalPaise).toBe(0);
    expect(cleared.emiPaise).toBe(0);
    expect(cleared.canUndoClear).toBe(true);
    const portfolio = repository.getLiabilities();
    expect(portfolio.activeCount).toBe(9);
    expect(portfolio.clearedCount).toBe(2);
    expect(portfolio.totalPrincipalPaise).toBe(701040600);
    expect(portfolio.totalEmiPaise).toBe(11611100);

    const clearAudit = database.connection
      .prepare(
        "SELECT id, action FROM audit_events WHERE entity_id = 'debt-dmi' ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get() as { id: string; action: string };
    expect(clearAudit.action).toBe("liability.cleared");

    // Clear actions created by the previous app version used the generic action name.
    database.connection.prepare("UPDATE audit_events SET action = 'liability.updated' WHERE id = ?").run(clearAudit.id);
    const restored = repository.undoLiabilityClear("debt-dmi");
    expect(restored.status).toBe("active");
    expect(restored.currentPrincipalPaise).toBe(23814000);
    expect(restored.emiPaise).toBe(1134000);
    expect(restored.canUndoClear).toBe(false);
    expect(repository.getLiabilities().totalPrincipalPaise).toBe(724854600);
    expect(repository.getLiabilities().totalEmiPaise).toBe(12745100);
    const undoAudit = database.connection
      .prepare(
        "SELECT action FROM audit_events WHERE entity_id = 'debt-dmi' ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get() as { action: string };
    expect(undoAudit.action).toBe("liability.clear_undone");
    database.close();
  });

  it("does not offer undo for a liability that was already cleared in the source sheet", () => {
    const { database, repository } = createRepository();
    const twoWheeler = repository.getLiabilities().liabilities.find((item) => item.id === "debt-two-wheeler");

    expect(twoWheeler?.status).toBe("cleared");
    expect(twoWheeler?.canUndoClear).toBe(false);
    expect(() => repository.undoLiabilityClear("debt-two-wheeler")).toThrow("No clear action is available to undo.");
    database.close();
  });

  it("creates and settles an audited personal balance", () => {
    const { database, repository } = createRepository();
    const created = repository.createPersonalBalance({
      name: "New person",
      direction: "receivable",
      amountPaise: 125000,
      note: "Shared booking",
    });

    expect(repository.getLiabilities().receivablePaise).toBe(8825000);
    const settled = repository.updatePersonalBalance(created.id, { status: "settled", amountPaise: 120000 });
    expect(settled.status).toBe("settled");
    expect(repository.getLiabilities().receivablePaise).toBe(8700000);
    const audits = database.connection
      .prepare("SELECT action FROM audit_events WHERE entity_id = ? ORDER BY created_at")
      .all(created.id) as Array<{ action: string }>;
    expect(audits.map((item) => item.action)).toEqual(["personal_balance.created", "personal_balance.updated"]);
    database.close();
  });
});
