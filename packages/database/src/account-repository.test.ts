import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountRepository } from "./account-repository";
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

    const updated = repository.updateAccount(account.id, { name: "Home cash" });
    expect(updated).toMatchObject({ name: "Home cash", isActive: true, balancePaise: 250000 });
    expect(() => repository.updateAccount(account.id, { isActive: false })).toThrow(
      "Move or reconcile the remaining balance before deactivating this account.",
    );
    database.close();
  });
});
