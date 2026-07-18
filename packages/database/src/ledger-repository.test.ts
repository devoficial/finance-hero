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
});
