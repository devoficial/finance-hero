import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountRepository } from "./account-repository";
import { initializeFoundationSchema, openEncryptedDatabase } from "./encrypted-database";
import { LedgerRepository } from "./ledger-repository";
import { seedAcceptedOpeningSnapshot } from "./opening-seed";
import { ProjectRepository } from "./project-repository";
import { WealthRepository } from "./wealth-repository";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), "finance-hero-projects-"));
  temporaryDirectories.push(directory);
  const database = openEncryptedDatabase(
    join(directory, "finance-hero.db"),
    Buffer.from("project-test-key-with-at-least-32-characters"),
  );
  initializeFoundationSchema(database);
  seedAcceptedOpeningSnapshot(database);
  const ledger = new LedgerRepository(database);
  return { database, ledger, repository: new ProjectRepository(database, ledger) };
}

describe("project repository", () => {
  it("preserves the imported Home Construction snapshot without changing the ledger", () => {
    const { database, ledger, repository } = createRepository();
    const before = ledger.getDashboard("2026-04", 30);
    const project = repository.getHomeConstruction();

    expect(project.freshness).toBe("needs_update");
    expect(project.expenses).toHaveLength(144);
    expect(project.commitments).toHaveLength(12);
    expect(project.sourceExpensePaise).toBe(123581000);
    expect(project.actualExpensePaise).toBe(122581000);
    expect(project.excludedPaise).toBe(1000000);
    expect(project.commitmentEstimatePaise).toBe(46286100);
    expect(project.pendingCommitmentPaise).toBe(25486100);
    expect(project.fundBalancePaise).toBe(11880800);
    expect(project.forecastPaise).toBe(148067100);
    expect(project.latestExpenseOn).toBe("2026-04-01");
    expect(project.needsReviewCount).toBe(8);
    expect(project.monthlySpend).toEqual([
      { month: "2025-09", amountPaise: 15902000 },
      { month: "2025-10", amountPaise: 8307000 },
      { month: "2025-11", amountPaise: 5268000 },
      { month: "2025-12", amountPaise: 13282100 },
      { month: "2026-01", amountPaise: 11346200 },
      { month: "2026-02", amountPaise: 37773300 },
      { month: "2026-03", amountPaise: 28002400 },
      { month: "2026-04", amountPaise: 2700000 },
    ]);
    expect(ledger.getDashboard("2026-04", 30)).toEqual(before);
    database.close();
  });

  it("reviews imported rows and audits the decision", () => {
    const { database, repository } = createRepository();
    const expense = repository.getHomeConstruction().expenses.find((item) => item.description === "Personal use");
    expect(expense).toBeDefined();

    const updated = repository.updateExpense(expense?.id ?? "", {
      includedInActual: false,
      reviewStatus: "confirmed",
    });
    expect(updated.includedInActual).toBe(false);
    expect(updated.reviewStatus).toBe("confirmed");

    const summary = repository.getHomeConstruction();
    expect(summary.actualExpensePaise).toBe(122581000 - (expense?.amountPaise ?? 0));
    expect(summary.needsReviewCount).toBe(7);
    const audit = database.connection
      .prepare("SELECT action FROM audit_events WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(expense?.id) as { action: string };
    expect(audit.action).toBe("project_expense.updated");
    database.close();
  });

  it("posts a manual construction expense to the balanced unified ledger exactly once", () => {
    const { database, ledger, repository } = createRepository();
    const input = {
      occurredOn: "2026-07-20",
      description: "Window installation",
      amountPaise: 250000,
      accountId: "account-primary-bank",
      idempotencyKey: "project-test:window-installation",
    };

    const first = repository.createExpense(input);
    const retry = repository.createExpense(input);
    expect(retry.id).toBe(first.id);
    expect(first.source).toBe("manual");
    expect(first.linkedTransactionId).not.toBeNull();

    const project = repository.getHomeConstruction();
    expect(project.actualExpensePaise).toBe(122831000);
    expect(project.monthlySpend.find((item) => item.month === "2026-07")?.amountPaise).toBe(250000);
    expect(ledger.getDashboard("2026-07", 20).assetBuildingPaise).toBe(4595300);
    const expensePosting = database.connection
      .prepare(`
        SELECT COALESCE(SUM(p.amount_paise), 0) AS amountPaise
        FROM postings p JOIN accounts a ON a.id = p.account_id
        WHERE p.transaction_id = ? AND a.account_class = 'expense'
      `)
      .get(first.linkedTransactionId) as { amountPaise: number };
    expect(expensePosting.amountPaise).toBe(0);

    const balance = database.connection
      .prepare("SELECT SUM(amount_paise) AS total FROM postings WHERE transaction_id = ?")
      .get(first.linkedTransactionId) as { total: number };
    expect(balance.total).toBe(0);
    database.close();
  });

  it("consolidates Jupiter transfers and construction spending into the project fund", () => {
    const { database, ledger, repository } = createRepository();
    const accounts = new AccountRepository(database);
    const wealth = new WealthRepository(database);
    const initialFund = repository.getHomeConstruction().fundBalancePaise;

    ledger.createManualTransaction({
      occurredOn: "2026-07-20",
      payee: "Fund Jupiter construction account",
      kind: "transfer",
      amountPaise: 500000,
      accountId: "account-primary-bank",
      destinationAccountId: "account-savings",
      idempotencyKey: "project-test:jupiter-funding",
    });
    expect(repository.getHomeConstruction().fundBalancePaise).toBe(initialFund + 500000);
    const fundedAccountBalance = accounts.getAccounts().accounts.find(
      (account) => account.id === "account-savings",
    )?.balancePaise;
    const fundedWealthBalance = wealth
      .getWealth("2026-07-20")
      .assets.find((asset) => asset.id === "asset-savings")?.currentValuePaise;

    repository.createExpense({
      occurredOn: "2026-07-21",
      description: "Construction material from Jupiter",
      amountPaise: 125000,
      accountId: "account-savings",
      idempotencyKey: "project-test:jupiter-spend",
    });
    const project = repository.getHomeConstruction();
    expect(project.fundBalancePaise).toBe(initialFund + 375000);
    expect(project.actualExpensePaise).toBe(122706000);
    expect(accounts.getAccounts().accounts.find((account) => account.id === "account-savings")?.balancePaise).toBe(
      (fundedAccountBalance ?? 0) - 125000,
    );
    expect(
      wealth.getWealth("2026-07-21").assets.find((asset) => asset.id === "asset-savings")?.currentValuePaise,
    ).toBe((fundedWealthBalance ?? 0) - 125000);
    const julyProjectExpensePostings = database.connection
      .prepare(`
        SELECT COALESCE(SUM(p.amount_paise), 0) AS amountPaise
        FROM project_expenses pe
        JOIN postings p ON p.transaction_id = pe.linked_transaction_id
        JOIN accounts a ON a.id = p.account_id
        WHERE pe.occurred_on LIKE '2026-07-%' AND a.account_class = 'expense'
      `)
      .get() as { amountPaise: number };
    expect(julyProjectExpensePostings.amountPaise).toBe(0);
    database.close();
  });
});
