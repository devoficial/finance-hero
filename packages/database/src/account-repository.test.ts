import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountRepository } from "./account-repository";
import { BudgetRepository } from "./budget-repository";
import { initializeFoundationSchema, openEncryptedDatabase } from "./encrypted-database";
import { seedAcceptedOpeningSnapshot } from "./opening-seed";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), "finance-hero-accounts-"));
  directories.push(directory);
  const database = openEncryptedDatabase(
    join(directory, "finance-hero.db"),
    Buffer.from("account-test-key-with-at-least-32-characters"),
  );
  initializeFoundationSchema(database);
  seedAcceptedOpeningSnapshot(database);
  return { database, repository: new AccountRepository(database) };
}

describe("account repository", () => {
  it("lists ledger, wealth, and liability accounts with balances", () => {
    const { database, repository } = createRepository();
    const accounts = repository.getAccounts();

    expect(accounts.accounts.find((account) => account.id === "account-pluxee")).toMatchObject({
      balancePaise: 880000,
      managedBy: "wealth",
      restricted: true,
    });
    expect(accounts.accounts.find((account) => account.id === "account-debt-home")).toMatchObject({
      balancePaise: 398021000,
      managedBy: "liability",
    });
    const currentMonth = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(new Date());
    const currentClosingBalance = new BudgetRepository(database).getMonth(currentMonth).cashBridge.closingBalancePaise;
    expect(accounts.accounts.find((account) => account.id === "account-primary-bank")).toMatchObject({
      balancePaise: currentClosingBalance,
      managedBy: "ledger",
    });
    database.close();
  });

  it("creates and updates an asset account with an opening valuation", () => {
    const { database, repository } = createRepository();
    const account = repository.createAccount({
      name: "Cash reserve",
      accountType: "cash",
      institution: null,
      openingBalancePaise: 250000,
      restricted: false,
    });
    expect(account).toMatchObject({ name: "Cash reserve", balancePaise: 250000, managedBy: "wealth" });

    const updated = repository.updateAccount(account.id, { name: "Home cash", balancePaise: 325000 });
    expect(updated).toMatchObject({ name: "Home cash", isActive: true, balancePaise: 325000 });
    expect(() => repository.updateAccount(account.id, { isActive: false })).toThrow(
      "Move or reconcile the remaining balance before deactivating this account.",
    );
    database.close();
  });

  it("requires ledger and liability balances to be edited at their source", () => {
    const { database, repository } = createRepository();

    expect(() => repository.updateAccount("account-primary-bank", { balancePaise: 100000 })).toThrow(
      "Use the ledger or reconciliation to change this account balance.",
    );
    expect(() => repository.updateAccount("account-debt-home", { balancePaise: 100000 })).toThrow(
      "Edit the linked liability principal in Liabilities.",
    );
    database.close();
  });
});
