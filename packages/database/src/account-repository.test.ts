import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountRepository } from "./account-repository";
import { BudgetRepository } from "./budget-repository";
import { initializeFoundationSchema, openEncryptedDatabase } from "./encrypted-database";
import { LedgerRepository } from "./ledger-repository";
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
    expect(accounts.accounts.find((account) => account.id === "account-savings")).toMatchObject({
      name: "Jupiter construction account",
      institution: "Jupiter",
    });
    expect(accounts.accounts.find((account) => account.id === "account-icici-expense-reserve")).toMatchObject({
      name: "ICICI expense reserve",
      institution: "ICICI Bank",
      balancePaise: 0,
      managedBy: "wealth",
    });
    const reserve = database.connection
      .prepare(`
        SELECT monthly_contribution_paise AS monthlyContributionPaise
        FROM asset_positions WHERE id = 'asset-icici-expense-reserve'
      `)
      .get() as { monthlyContributionPaise: number };
    expect(reserve.monthlyContributionPaise).toBe(2000000);
    expect(
      new BudgetRepository(database)
        .getMonth(currentMonth)
        .lines.find((line) => line.categoryId === "category-extra-savings")?.plannedPaise,
    ).toBe(2000000);
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

  it("consolidates an owned-account transfer without changing total assets", () => {
    const { database, repository } = createRepository();
    const ledger = new LedgerRepository(database);
    const before = repository.getAccounts();
    const primaryBefore = before.accounts.find((account) => account.id === "account-primary-bank")?.balancePaise ?? 0;
    const reserveBefore =
      before.accounts.find((account) => account.id === "account-icici-expense-reserve")?.balancePaise ?? 0;
    const occurredOn = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(new Date());

    ledger.createManualTransaction({
      occurredOn,
      payee: "Monthly ICICI reserve funding",
      kind: "transfer",
      amountPaise: 2000000,
      accountId: "account-primary-bank",
      destinationAccountId: "account-icici-expense-reserve",
      idempotencyKey: "account-test:icici-transfer",
    });

    const after = repository.getAccounts();
    expect(after.accounts.find((account) => account.id === "account-primary-bank")?.balancePaise).toBe(
      primaryBefore - 2000000,
    );
    expect(after.accounts.find((account) => account.id === "account-icici-expense-reserve")?.balancePaise).toBe(
      reserveBefore + 2000000,
    );
    expect(after.totalAssetBalancePaise).toBe(before.totalAssetBalancePaise);
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

  it("deletes only empty wealth-managed accounts without financial history", () => {
    const { database, repository } = createRepository();
    const disposable = repository.createAccount({
      name: "Unused envelope",
      accountType: "savings",
      openingBalancePaise: 0,
      restricted: false,
    });

    repository.deleteAccount(disposable.id);
    expect(repository.getAccounts().accounts.some((account) => account.id === disposable.id)).toBe(false);
    expect(() => repository.deleteAccount("account-pluxee")).toThrow("remaining balance");
    expect(() => repository.deleteAccount("account-primary-bank")).toThrow("remaining balance");

    const archived = repository.createAccount({
      name: "Historical envelope",
      accountType: "savings",
      openingBalancePaise: 0,
      restricted: false,
    });
    const ledger = new LedgerRepository(database);
    const occurredOn = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(new Date());
    ledger.createManualTransaction({
      occurredOn,
      payee: "Temporary funding",
      kind: "transfer",
      amountPaise: 10000,
      accountId: "account-primary-bank",
      destinationAccountId: archived.id,
      idempotencyKey: "account-test:archive-fund",
    });
    ledger.createManualTransaction({
      occurredOn,
      payee: "Return temporary funding",
      kind: "transfer",
      amountPaise: 10000,
      accountId: archived.id,
      destinationAccountId: "account-primary-bank",
      idempotencyKey: "account-test:archive-return",
    });
    repository.deleteAccount(archived.id);
    expect(repository.getAccounts().accounts.find((account) => account.id === archived.id)?.isActive).toBe(false);
    database.close();
  });

  it("clears and archives an empty liability account while retaining its history", () => {
    const { database, repository } = createRepository();

    repository.deleteAccount("account-debt-axis-neo");

    expect(repository.getAccounts().accounts.find((account) => account.id === "account-debt-axis-neo")?.isActive).toBe(
      false,
    );
    const debt = database.connection
      .prepare("SELECT status, emi_paise AS emiPaise FROM debts WHERE id = 'debt-axis-neo'")
      .get() as { status: string; emiPaise: number };
    expect(debt).toEqual({ status: "cleared", emiPaise: 0 });
    database.close();
  });
});
