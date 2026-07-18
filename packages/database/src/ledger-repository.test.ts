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
    expect(dashboard.regularExpensePaise).toBe(6004800);
    expect(dashboard.totalEmiPaise).toBe(12745100);
    expect(dashboard.debtPrincipalPaise).toBe(724854600);
    expect(dashboard.availableAfterPlanPaise).toBe(11339400);
    expect(dashboard.transactionCount).toBe(11);

    const expenseYear = repository.getExpenseYear("2026");
    expect(expenseYear.months).toHaveLength(12);
    expect(expenseYear.months[6]?.regularExpensePaise).toBe(6004800);
    expect(expenseYear.months[0]?.regularExpensePaise).toBe(0);

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
      assetAccountId: "account-primary-bank",
      categoryId: "category-groceries",
      idempotencyKey: "test-device:1",
    };

    const first = repository.createManualTransaction(input);
    const retry = repository.createManualTransaction(input);

    expect(retry.id).toBe(first.id);
    expect(repository.getDashboard("2026-07", 19).regularExpensePaise).toBe(6047300);
    const balance = database.connection
      .prepare("SELECT SUM(amount_paise) AS total FROM postings WHERE transaction_id = ?")
      .get(first.id) as { total: number };
    expect(balance.total).toBe(0);
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
