import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BudgetRepository } from "./budget-repository";
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
  const directory = mkdtempSync(join(tmpdir(), "finance-hero-budget-"));
  temporaryDirectories.push(directory);
  const database = openEncryptedDatabase(
    join(directory, "finance-hero.db"),
    Buffer.from("budget-test-key-with-at-least-32-characters"),
  );
  initializeFoundationSchema(database);
  seedAcceptedOpeningSnapshot(database);
  return {
    database,
    ledger: new LedgerRepository(database),
    repository: new BudgetRepository(database),
  };
}

describe("budget repository", () => {
  it("reads the accepted July allocation with category actuals", () => {
    const { database, repository } = createRepository();
    const budget = repository.getMonth("2026-07");

    expect(budget.plannedIncomePaise).toBe(30089300);
    expect(budget.regularBudgetPaise).toBe(6004800);
    expect(budget.lines.reduce((sum, line) => sum + line.plannedPaise, 0)).toBe(6004800);
    expect(budget.lines.find((line) => line.categoryId === "category-rent")).toMatchObject({
      plannedPaise: 2050000,
      spentPaise: 1643300,
      remainingPaise: 406700,
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
    expect(audit.action).toBe("budget.updated");
    database.close();
  });

  it("rejects unknown and duplicate budget categories", () => {
    const { database, repository } = createRepository();
    expect(() =>
      repository.updateMonth("2026-07", {
        lines: [{ categoryId: "category-not-real", plannedPaise: 10000 }],
      }),
    ).toThrow("Budget category does not exist");
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
