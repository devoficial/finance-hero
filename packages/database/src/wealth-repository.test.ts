import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeFoundationSchema, openEncryptedDatabase } from "./encrypted-database";
import { LedgerRepository } from "./ledger-repository";
import { seedAcceptedOpeningSnapshot } from "./opening-seed";
import { WealthRepository } from "./wealth-repository";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createRepositories() {
  const directory = mkdtempSync(join(tmpdir(), "finance-hero-wealth-"));
  temporaryDirectories.push(directory);
  const database = openEncryptedDatabase(
    join(directory, "finance-hero.db"),
    Buffer.from("wealth-test-key-with-at-least-32-characters"),
  );
  initializeFoundationSchema(database);
  seedAcceptedOpeningSnapshot(database);
  return {
    database,
    ledger: new LedgerRepository(database),
    wealth: new WealthRepository(database),
  };
}

describe("wealth repository", () => {
  it("loads accepted savings, restricted wallet, goal allocation, and net worth", () => {
    const { database, wealth } = createRepositories();
    const snapshot = wealth.getWealth("2026-07-23");

    expect(snapshot.totalAssetPaise).toBe(12760800);
    expect(snapshot.savingsPaise).toBe(11880800);
    expect(snapshot.restrictedWalletPaise).toBe(880000);
    expect(snapshot.allocatablePaise).toBe(0);
    expect(snapshot.allocatedPaise).toBe(11880800);
    expect(snapshot.netWorthPaise).toBe(-723393800);
    expect(snapshot.assets.find((asset) => asset.name === "Pluxee food wallet")?.restricted).toBe(true);
    expect(snapshot.goals[0]).toMatchObject({
      name: "Emergency fund",
      targetPaise: 56249700,
      targetMode: "emergency_cover",
      coverageMonths: 3,
      monthlyNeedPaise: 18749900,
      allocatedPaise: 11880800,
      remainingPaise: 44368900,
      progressPercentage: 21,
      forecastDate: null,
    });
    database.close();
  });

  it("counts Pluxee purchases as expenses and reduces the food-wallet balance", () => {
    const { database, ledger, wealth } = createRepositories();
    const before = ledger.getDashboard("2026-07", 23);

    ledger.createManualTransaction({
      occurredOn: "2026-07-23",
      payee: "Grocery order",
      kind: "expense",
      amountPaise: 100000,
      accountId: "account-pluxee",
      categoryId: "category-groceries",
      idempotencyKey: "wealth-test:pluxee-expense-1",
    });

    const after = ledger.getDashboard("2026-07", 23);
    const pluxee = wealth.getWealth("2026-07-23").assets.find((asset) => asset.id === "asset-pluxee");
    expect(pluxee?.currentValuePaise).toBe(780000);
    expect(after.regularExpensePaise).toBe(before.regularExpensePaise + 100000);
    expect(after.totalExpensePaise).toBe(before.totalExpensePaise + 100000);
    database.close();
  });

  it("reflects new ledger transfers in an asset position without counting an allocation twice", () => {
    const { database, ledger, wealth } = createRepositories();
    const transfer = ledger.createManualTransaction({
      occurredOn: "2026-07-23",
      payee: "Move to savings",
      kind: "transfer",
      amountPaise: 500000,
      accountId: "account-primary-bank",
      destinationAccountId: "account-savings",
      idempotencyKey: "wealth-test:transfer-1",
    });

    const snapshot = wealth.getWealth("2026-07-23");
    const savings = snapshot.assets.find((asset) => asset.id === "asset-savings");
    expect(savings?.currentValuePaise).toBe(12380800);
    expect(savings?.allocatedPaise).toBe(11880800);
    expect(savings?.availablePaise).toBe(500000);

    ledger.reverseTransaction(transfer.id, {
      reason: "Transfer entered in error",
      idempotencyKey: "wealth-test:transfer-1-reversal",
    });
    expect(wealth.getWealth("2026-07-23").assets.find((asset) => asset.id === "asset-savings")?.currentValuePaise).toBe(
      11880800,
    );
    database.close();
  });

  it("creates goals, forecasts completion, and rejects restricted or excessive allocations", () => {
    const { database, wealth } = createRepositories();
    const goal = wealth.createGoal(
      {
        name: "Travel reserve",
        targetPaise: 12000000,
        targetDate: "2027-12-31",
        priority: 3,
        monthlyContributionPaise: 1000000,
      },
      "2026-07-23",
    );

    expect(goal.forecastDate).toBe("2027-07-23");
    expect(goal.onTrack).toBe(true);
    expect(() =>
      wealth.updateGoalAllocations(goal.id, [{ assetId: "asset-pluxee", amountPaise: 10000 }], "2026-07-23"),
    ).toThrow("Restricted wallets cannot fund financial goals.");
    expect(() =>
      wealth.updateGoalAllocations(goal.id, [{ assetId: "asset-savings", amountPaise: 10000 }], "2026-07-23"),
    ).toThrow("Savings does not have enough unallocated value.");

    const asset = wealth.createAsset({
      name: "Travel fund",
      assetType: "savings",
      institution: "Manual",
      currentValuePaise: 2000000,
      monthlyContributionPaise: 1000000,
      restricted: false,
      asOfDate: "2026-07-23",
    });
    const allocated = wealth.updateGoalAllocations(
      goal.id,
      [{ assetId: asset.id, amountPaise: 2000000 }],
      "2026-07-23",
    );
    expect(allocated.progressPercentage).toBe(17);
    expect(allocated.forecastDate).toBe("2027-05-23");
    database.close();
  });

  it("deletes unused assets but protects allocated or active financial positions", () => {
    const { database, ledger, wealth } = createRepositories();
    const unused = wealth.createAsset({
      name: "Unused cash envelope",
      assetType: "savings",
      institution: "Manual",
      currentValuePaise: 0,
      monthlyContributionPaise: 0,
      restricted: false,
      asOfDate: "2026-07-23",
    });
    wealth.deleteAsset(unused.id);
    expect(wealth.getWealth("2026-07-23").assets.some((asset) => asset.id === unused.id)).toBe(false);

    expect(() => wealth.deleteAsset("asset-savings")).toThrow("goal allocations");
    ledger.createManualTransaction({
      occurredOn: "2026-07-23",
      payee: "Wallet order",
      kind: "expense",
      amountPaise: 10000,
      accountId: "account-pluxee",
      categoryId: "category-groceries",
      idempotencyKey: "wealth-test:protected-asset",
    });
    expect(() => wealth.deleteAsset("asset-pluxee")).toThrow("financial activity");
    database.close();
  });
});
