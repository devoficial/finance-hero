import { randomUUID } from "node:crypto";
import type { FinanceHeroDatabase } from "./encrypted-database";

const SOURCE = "Finance tracker 2025:accepted opening snapshot";
const SEEDED_AT = "2026-07-18T12:00:00.000Z";

const categories = [
  ["category-rent", "Rent", "regular", 20500],
  ["category-home", "Home", "regular", 9000],
  ["category-household", "Cook, maid and gas", "regular", 5580],
  ["category-utilities", "Broadband and utilities", "regular", 1800],
  ["category-groceries", "Groceries and food", "regular", 2000],
  ["category-transport", "Transport", "regular", 3000],
  ["category-personal", "Shopping and personal care", "regular", 3000],
  ["category-learning", "Learning and subscriptions", "regular", 5268],
  ["category-medical", "Medical", "regular", 6000],
  ["category-insurance", "Insurance", "regular", 1900],
  ["category-misc", "Miscellaneous", "regular", 2000],
] as const;

const debts = [
  ["debt-personal-1", "Personal loan", "personal_loan", 500000, 305558, 10381, 1199, "active"],
  ["debt-home", "Home loan", "home_loan", 3989210, 3980210, 41663, 900, "active"],
  ["debt-personal-2", "Personal loan 2", "personal_loan", 2500000, 181869, 14976, 1075, "active"],
  ["debt-bajaj", "Bajaj personal loan", "personal_loan", 2099000, 2099000, 23190, 1350, "active"],
  ["debt-two-wheeler", "Two-wheeler loan", "vehicle_loan", 200000, 0, 0, 1623, "cleared"],
  ["debt-groww", "Groww personal loan", "personal_loan", 445000, 339487, 11181, 1699, "active"],
  ["debt-dmi", "DMI finance loan", "personal_loan", 360000, 238140, 11340, 1650, "active"],
  ["debt-icici-card", "ICICI Credit Card", "credit_card", 34265, 34265, 9863, null, "active"],
  ["debt-axis-flipkart", "Axis Flipkart Credit Card", "credit_card", 32256, 32256, 4857, null, "active"],
  ["debt-icici-rupay", "ICICI Rupay Credit Card", "credit_card", 37761, 37761, 0, null, "active"],
  ["debt-axis-neo", "Axis Neo Credit Card", "credit_card", 0, 0, 0, null, "active"],
] as const;

const personalBalances = [
  ["personal-payable-pradip", "Pradip", "payable", 100000],
  ["personal-payable-dheeraj", "Dheeraj Vadlani", "payable", 25000],
  ["personal-payable-soumya", "Soumya", "payable", 50000],
  ["personal-payable-vishant", "Vishant", "payable", 25000],
  ["personal-receivable-kishan", "Kishan", "receivable", 35000],
  ["personal-receivable-rabi", "Rabi", "receivable", 52000],
] as const;

function seedAcceptedPersonalBalances(database: FinanceHeroDatabase): void {
  const seed = database.connection.transaction(() => {
    const existing = database.connection
      .prepare("SELECT value FROM app_metadata WHERE key = 'accepted_personal_balance_seed'")
      .get() as { value: string } | undefined;
    if (existing) {
      return;
    }

    const insert = database.connection.prepare(`
      INSERT OR IGNORE INTO personal_balances
        (id, name, direction, amount_paise, status, note, source_ref, updated_at)
      VALUES (?, ?, ?, ?, 'open', NULL, ?, ?)
    `);
    for (const [id, name, direction, rupees] of personalBalances) {
      insert.run(id, name, direction, rupees * 100, `${SOURCE}:Personal balances`, SEEDED_AT);
    }
    database.connection
      .prepare(`
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES ('accepted_personal_balance_seed', '2026-07-v1', ?)
      `)
      .run(SEEDED_AT);
  });
  seed.immediate();
}

function seedAcceptedLiabilities(database: FinanceHeroDatabase): void {
  const seed = database.connection.transaction(() => {
    const existing = database.connection
      .prepare("SELECT value FROM app_metadata WHERE key = 'accepted_liability_seed'")
      .get() as { value: string } | undefined;
    if (existing) {
      return;
    }

    const insertDebtAccount = database.connection.prepare(`
      INSERT OR IGNORE INTO accounts
        (id, name, account_class, account_type, institution, is_active, created_at)
      VALUES (?, ?, 'liability', ?, ?, 1, ?)
    `);
    const upsertDebt = database.connection.prepare(`
      INSERT INTO debts
        (id, account_id, lender, product_type, original_amount_paise, current_principal_paise,
         emi_paise, annual_rate_bps, status, source_ref, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        lender = excluded.lender,
        product_type = excluded.product_type,
        original_amount_paise = excluded.original_amount_paise,
        current_principal_paise = excluded.current_principal_paise,
        emi_paise = excluded.emi_paise,
        annual_rate_bps = excluded.annual_rate_bps,
        status = excluded.status,
        source_ref = excluded.source_ref,
        updated_at = excluded.updated_at
    `);

    for (const [debtId, lender, productType, originalRupees, principalRupees, emiRupees, rateBps, status] of debts) {
      const accountId = `account-${debtId}`;
      insertDebtAccount.run(accountId, lender, productType, lender, SEEDED_AT);
      upsertDebt.run(
        debtId,
        accountId,
        lender,
        productType,
        originalRupees * 100,
        principalRupees * 100,
        emiRupees * 100,
        rateBps,
        status,
        `${SOURCE}:Liabilities`,
        SEEDED_AT,
      );
    }

    database.connection
      .prepare(`
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES ('accepted_liability_seed', '2026-07-v2', ?)
      `)
      .run(SEEDED_AT);
  });
  seed.immediate();
}

export function seedAcceptedOpeningSnapshot(database: FinanceHeroDatabase): void {
  seedAcceptedLiabilities(database);
  seedAcceptedPersonalBalances(database);

  const seed = database.connection.transaction(() => {
    const existing = database.connection
      .prepare("SELECT value FROM app_metadata WHERE key = 'accepted_opening_seed'")
      .get() as { value: string } | undefined;

    if (existing) {
      return;
    }

    const insertAccount = database.connection.prepare(`
      INSERT OR IGNORE INTO accounts
        (id, name, account_class, account_type, institution, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    insertAccount.run("account-primary-bank", "Primary salary account", "asset", "bank", null, SEEDED_AT);
    insertAccount.run("account-migration-equity", "Migration opening balance", "equity", "migration", null, SEEDED_AT);
    insertAccount.run("account-regular-expense", "Regular expenses", "expense", "expense", null, SEEDED_AT);
    insertAccount.run("account-salary-income", "Salary income", "income", "income", null, SEEDED_AT);

    const insertCategory = database.connection.prepare(`
      INSERT OR IGNORE INTO categories
        (id, name, broad_bucket, budget_eligible, alert_eligible, created_at)
      VALUES (?, ?, ?, 1, 1, ?)
    `);
    const insertBudgetLine = database.connection.prepare(`
      INSERT OR IGNORE INTO budget_lines (month, category_id, planned_paise)
      VALUES ('2026-07', ?, ?)
    `);

    database.connection
      .prepare(`
        INSERT OR IGNORE INTO budget_periods
          (month, planned_income_paise, regular_budget_paise, state, source_ref, updated_at)
        VALUES ('2026-07', 30089300, 7849900, 'open', ?, ?)
      `)
      .run(SOURCE, SEEDED_AT);

    for (const [categoryId, name, bucket, rupees] of categories) {
      insertCategory.run(categoryId, name, bucket, SEEDED_AT);
      insertBudgetLine.run(categoryId, rupees * 100);

      const transactionId = `migration-2026-07-${categoryId}`;
      database.connection
        .prepare(`
          INSERT OR IGNORE INTO journal_transactions
            (id, occurred_on, effective_month, payee, memo, status, origin, source_ref, created_at)
          VALUES (?, '2026-07-18', '2026-07', ?, 'Monthly category aggregate; replace when detailed statements are reconciled.', 'posted', 'historical_aggregate', ?, ?)
        `)
        .run(transactionId, name, `${SOURCE}:${name}`, SEEDED_AT);

      const postingCount = database.connection
        .prepare("SELECT count(*) AS count FROM postings WHERE transaction_id = ?")
        .get(transactionId) as { count: number };
      if (postingCount.count === 0) {
        database.connection
          .prepare(`
            INSERT INTO postings (id, transaction_id, account_id, category_id, amount_paise, created_at)
            VALUES (?, ?, 'account-regular-expense', ?, ?, ?),
                   (?, ?, 'account-migration-equity', NULL, ?, ?)
          `)
          .run(
            randomUUID(),
            transactionId,
            categoryId,
            rupees * 100,
            SEEDED_AT,
            randomUUID(),
            transactionId,
            rupees * -100,
            SEEDED_AT,
          );
      }
    }

    database.connection
      .prepare(`
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES ('accepted_opening_seed', '2026-07-v1', ?)
      `)
      .run(SEEDED_AT);
  });

  seed.immediate();
}
