import { randomUUID } from "node:crypto";
import { seedHomeConstructionSnapshot } from "./construction-seed";
import type { FinanceHeroDatabase } from "./encrypted-database";

const SOURCE = "Finance tracker 2025:accepted opening snapshot";
const SEEDED_AT = "2026-07-18T12:00:00.000Z";
const EXPENSE_HISTORY_SEED = "2026-07-v7";
const ACCEPTED_MONTHLY_INCOME_PLAN_PAISE = 30089300;
const ICICI_EXPENSE_RESERVE_PAISE = 2000000;
const CREDIT_CARD_BILLS_CATEGORY = [
  "category-credit-card-bills",
  "Credit card bills (unreconciled)",
  "debt_payment",
] as const;
const CASH_FLOW_CATEGORIES = [
  ["category-emi-payments", "EMIs / debt payments", "debt_payment"],
  ["category-home-construction", "Home construction", "asset_building"],
  ["category-loan-charges", "Loan and bank charges", "nonbudget_expense"],
  ["category-extra-savings", "Lending / payback", "savings_investment"],
  ["category-loan-repayments", "Loan repayments", "debt_payment"],
  ["category-emergency-fund", "Emergency fund", "savings_investment"],
] as const;

const categories = [
  ["category-rent", "Rent", "regular", 20500],
  ["category-home", "Home", "regular", 9000],
  ["category-household", "Cook, maid and gas", "regular", 5580],
  ["category-utilities", "Broadband and electricity", "regular", 1800],
  ["category-groceries", "Groceries, food and eating out", "regular", 2000],
  ["category-transport", "Transport and travel", "regular", 3000],
  ["category-personal", "Shopping, personal care and gym", "regular", 3000],
  ["category-learning", "Learning, entertainment and subscriptions", "regular", 5268],
  ["category-medical", "Medical expenses", "regular", 6000],
  ["category-insurance", "Insurance and savings", "savings_investment", 1900],
  ["category-misc", "Miscellaneous, lending and others", "regular", 2000],
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

const historicalExpenseMonths = [
  {
    month: "2025-09",
    occurredOn: "2025-09-30",
    sourceSheet: "Daily Expenses Sept",
    regularBudgetRupees: 0,
    expenses: [
      ["category-home", 5392],
      ["category-groceries", 20199],
      ["category-transport", 6864],
      ["category-personal", 4416],
      ["category-learning", 6537],
      ["category-misc", 7315],
    ],
  },
  {
    month: "2025-10",
    occurredOn: "2025-10-31",
    sourceSheet: "Daily Expenses Oct",
    regularBudgetRupees: 60048,
    expenses: [
      ["category-rent", 12484],
      ["category-home", 13100],
      ["category-household", 6050],
      ["category-utilities", 2003],
      ["category-groceries", 24682],
      ["category-transport", 5379],
      ["category-personal", 30968],
      ["category-learning", 10773],
      ["category-medical", 4040],
      ["category-insurance", 1818],
      ["category-misc", 29121],
      ["category-credit-card-bills", 49279],
      ["category-emi-payments", 99628],
      ["category-home-construction", 25689],
      ["category-loan-repayments", 6175],
    ],
  },
  {
    month: "2025-11",
    occurredOn: "2025-11-30",
    sourceSheet: "Daily Expenses Nov",
    regularBudgetRupees: 60048,
    expenses: [
      ["category-rent", 13352],
      ["category-home", 14770],
      ["category-household", 9010],
      ["category-groceries", 24297],
      ["category-transport", 2727],
      ["category-personal", 2109],
      ["category-learning", 9327],
      ["category-insurance", 1818],
      ["category-misc", 6741],
      ["category-emi-payments", 101454],
      ["category-home-construction", 50000],
      ["category-loan-repayments", 130029],
      ["category-emergency-fund", 9071],
    ],
  },
  {
    month: "2025-12",
    occurredOn: "2025-12-31",
    sourceSheet: "Daily Expenses Dec",
    regularBudgetRupees: 60048,
    expenses: [
      ["category-rent", 19591],
      ["category-home", 13875],
      ["category-household", 3700],
      ["category-utilities", 1060],
      ["category-groceries", 35018],
      ["category-transport", 4551],
      ["category-personal", 11100],
      ["category-learning", 5077],
      ["category-medical", 20349],
      ["category-insurance", 1818],
      ["category-misc", 9068],
      ["category-credit-card-bills", 91554],
      ["category-emi-payments", 99846],
      ["category-home-construction", 59000],
      ["category-loan-repayments", 20030],
    ],
  },
  {
    month: "2026-01",
    occurredOn: "2026-01-31",
    sourceSheet: "Daily Expenses Jan 26",
    regularBudgetRupees: 60048,
    expenses: [
      ["category-rent", 15685],
      ["category-home", 9000],
      ["category-household", 5200],
      ["category-utilities", 1060],
      ["category-groceries", 27704],
      ["category-transport", 3531],
      ["category-personal", 3093],
      ["category-learning", 4195],
      ["category-medical", 5265],
      ["category-insurance", 1818],
      ["category-misc", 4865],
      ["category-credit-card-bills", 23750],
      ["category-emi-payments", 112410],
      ["category-home-construction", 227000],
      ["category-extra-savings", 50000],
    ],
  },
  {
    month: "2026-02",
    occurredOn: "2026-02-28",
    sourceSheet: "Daily Expenses Feb 26",
    regularBudgetRupees: 60048,
    expenses: [
      ["category-rent", 14260],
      ["category-home", 9000],
      ["category-household", 9500],
      ["category-utilities", 1458],
      ["category-groceries", 22658],
      ["category-transport", 16642],
      ["category-personal", 6609],
      ["category-learning", 3597],
      ["category-medical", 3663],
      ["category-insurance", 6813],
      ["category-misc", 6573],
      ["category-credit-card-bills", 106411],
      ["category-emi-payments", 113504],
      ["category-extra-savings", 100000],
    ],
  },
  {
    month: "2026-03",
    occurredOn: "2026-03-31",
    sourceSheet: "Daily Expenses Mar 26",
    regularBudgetRupees: 60048,
    expenses: [
      ["category-rent", 13304],
      ["category-home", 9000],
      ["category-household", 9500],
      ["category-utilities", 2680],
      ["category-groceries", 21063],
      ["category-transport", 6573],
      ["category-personal", 1404],
      ["category-learning", 3309],
      ["category-medical", 4270],
      ["category-insurance", 1813],
      ["category-misc", 12618],
      ["category-credit-card-bills", 27744],
      ["category-emi-payments", 111185],
      ["category-home-construction", 54000],
    ],
  },
  {
    month: "2026-04",
    occurredOn: "2026-04-30",
    sourceSheet: "Daily Expenses APR 26",
    regularBudgetRupees: 60048,
    expenses: [
      ["category-rent", 14658],
      ["category-home", 10000],
      ["category-household", 11150],
      ["category-utilities", 3488],
      ["category-groceries", 6077],
      ["category-transport", 2809],
      ["category-personal", 738],
      ["category-learning", 2420],
      ["category-medical", 7166],
      ["category-insurance", 1813],
      ["category-misc", 9119],
      ["category-credit-card-bills", 119338],
      ["category-emi-payments", 113504],
      ["category-home-construction", 177588],
      ["category-extra-savings", 5000],
      ["category-loan-repayments", 4720],
    ],
  },
  {
    month: "2026-05",
    occurredOn: "2026-05-31",
    sourceSheet: "Daily Expenses MAY 26",
    regularBudgetRupees: 60048,
    expenses: [
      ["category-rent", 20500],
      ["category-home", 18400],
      ["category-household", 19250],
      ["category-utilities", 1419],
      ["category-groceries", 1036],
      ["category-transport", 2326],
      ["category-personal", 361],
      ["category-learning", 3069],
      ["category-medical", 9029],
      ["category-insurance", 1813],
      ["category-misc", 100],
      ["category-credit-card-bills", 58505],
      ["category-emi-payments", 112731],
      ["category-home-construction", 24920],
      ["category-extra-savings", 18682],
      ["category-loan-repayments", 116950],
    ],
  },
  {
    month: "2026-06",
    occurredOn: "2026-06-30",
    sourceSheet: "Daily Expenses JUN 26",
    regularBudgetRupees: 60048,
    expenses: [
      ["category-home", 9500],
      ["category-household", 1000],
      ["category-utilities", 1519],
      ["category-groceries", 5714],
      ["category-transport", 1163],
      ["category-personal", 1814],
      ["category-learning", 3279],
      ["category-medical", 5800],
      ["category-insurance", 2052],
      ["category-misc", 4785],
      ["category-credit-card-bills", 66794],
      ["category-emi-payments", 113504],
      ["category-home-construction", 22610],
    ],
  },
  {
    month: "2026-07",
    occurredOn: "2026-07-18",
    sourceSheet: "Daily Expenses JULY 26",
    regularBudgetRupees: 60048,
    expenses: [
      ["category-rent", 16433],
      ["category-home", 9000],
      ["category-household", 8500],
      ["category-utilities", 579],
      ["category-groceries", 568],
      ["category-transport", 1567],
      ["category-personal", 2028],
      ["category-learning", 1388],
      ["category-medical", 5227],
      ["category-insurance", 1073],
      ["category-misc", 382],
      ["category-emi-payments", 112731],
      ["category-home-construction", 44880],
      ["category-loan-charges", 236],
    ],
  },
] as const;

function seedAcceptedPersonalBalances(database: FinanceHeroDatabase): void {
  const seed = database.connection.transaction(() => {
    const renameCategory = database.connection.prepare("UPDATE categories SET name = ? WHERE id = ?");
    for (const [categoryId, name] of categories) {
      renameCategory.run(name, categoryId);
    }
    for (const [categoryId, name] of CASH_FLOW_CATEGORIES) {
      renameCategory.run(name, categoryId);
    }
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

function seedAcceptedExpenseHistory(database: FinanceHeroDatabase): void {
  const categoryNames = new Map<string, string>(categories.map(([id, name]) => [id, name]));
  categoryNames.set(CREDIT_CARD_BILLS_CATEGORY[0], CREDIT_CARD_BILLS_CATEGORY[1]);
  for (const [id, name] of CASH_FLOW_CATEGORIES) {
    categoryNames.set(id, name);
  }
  const seed = database.connection.transaction(() => {
    const existing = database.connection
      .prepare("SELECT value FROM app_metadata WHERE key = 'accepted_expense_history_seed'")
      .get() as { value: string } | undefined;
    if (existing?.value === EXPENSE_HISTORY_SEED) {
      return;
    }

    // Replace the original July placeholder, which used category limits as actual spending.
    database.connection.prepare("DELETE FROM postings WHERE transaction_id LIKE 'migration-2026-07-category-%'").run();
    database.connection.prepare("DELETE FROM journal_transactions WHERE id LIKE 'migration-2026-07-category-%'").run();
    // Mapper v3 replaces only source-owned aggregates; manually entered ledger records are untouched.
    database.connection.prepare("DELETE FROM postings WHERE transaction_id LIKE 'migration-expense-history-%'").run();
    database.connection.prepare("DELETE FROM journal_transactions WHERE id LIKE 'migration-expense-history-%'").run();
    const upsertNonBudgetCategory = database.connection.prepare(`
      INSERT INTO categories
        (id, name, broad_bucket, budget_eligible, alert_eligible, created_at)
      VALUES (?, ?, ?, 0, 0, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        broad_bucket = excluded.broad_bucket,
        budget_eligible = excluded.budget_eligible,
        alert_eligible = excluded.alert_eligible
    `);
    upsertNonBudgetCategory.run(...CREDIT_CARD_BILLS_CATEGORY, SEEDED_AT);
    for (const category of CASH_FLOW_CATEGORIES) {
      upsertNonBudgetCategory.run(...category, SEEDED_AT);
    }
    database.connection
      .prepare(`
        UPDATE categories
        SET name = 'Insurance and savings', broad_bucket = 'savings_investment', alert_eligible = 0
        WHERE id = 'category-insurance'
      `)
      .run();

    const upsertBudgetPeriod = database.connection.prepare(`
      INSERT INTO budget_periods
        (month, planned_income_paise, regular_budget_paise, state, source_ref, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(month) DO UPDATE SET
        planned_income_paise = CASE
          WHEN budget_periods.planned_income_paise = 0 THEN excluded.planned_income_paise
          ELSE budget_periods.planned_income_paise
        END,
        regular_budget_paise = excluded.regular_budget_paise,
        state = excluded.state,
        source_ref = excluded.source_ref,
        updated_at = excluded.updated_at
    `);
    const insertHistoricalBudgetLine = database.connection.prepare(`
      INSERT OR IGNORE INTO budget_lines (month, category_id, planned_paise)
      VALUES (?, ?, ?)
    `);
    const insertTransaction = database.connection.prepare(`
      INSERT OR IGNORE INTO journal_transactions
        (id, occurred_on, effective_month, payee, memo, status, origin, source_ref, created_at)
      VALUES (?, ?, ?, ?, ?, 'posted', 'historical_aggregate', ?, ?)
    `);
    const insertPostings = database.connection.prepare(`
      INSERT INTO postings (id, transaction_id, account_id, category_id, amount_paise, created_at)
      VALUES (?, ?, 'account-regular-expense', ?, ?, ?),
             (?, ?, 'account-migration-equity', NULL, ?, ?)
    `);

    for (const monthData of historicalExpenseMonths) {
      const sourceRef = `Finance tracker 2025:${monthData.sourceSheet}`;
      upsertBudgetPeriod.run(
        monthData.month,
        ACCEPTED_MONTHLY_INCOME_PLAN_PAISE,
        monthData.regularBudgetRupees * 100,
        monthData.month === "2026-07" ? "open" : "closed",
        sourceRef,
        SEEDED_AT,
      );
      if (monthData.regularBudgetRupees > 0) {
        for (const [categoryId, , , rupees] of categories) {
          insertHistoricalBudgetLine.run(monthData.month, categoryId, rupees * 100);
        }
      }

      for (const [categoryId, rupees] of monthData.expenses) {
        const transactionId = `migration-expense-history-${monthData.month}-${categoryId}`;
        const categoryName = categoryNames.get(categoryId) ?? categoryId;
        insertTransaction.run(
          transactionId,
          monthData.occurredOn,
          monthData.month,
          categoryName,
          `Monthly category aggregate imported from ${monthData.sourceSheet}.`,
          `${sourceRef}:category aggregate`,
          SEEDED_AT,
        );

        const postingCount = database.connection
          .prepare("SELECT count(*) AS count FROM postings WHERE transaction_id = ?")
          .get(transactionId) as { count: number };
        if (postingCount.count === 0) {
          insertPostings.run(
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
    }

    database.connection
      .prepare(`
        INSERT OR IGNORE INTO audit_events
          (id, action, entity_type, entity_id, detail_json, created_at)
        VALUES (?, 'expense_history.imported', 'migration', ?, ?, ?)
      `)
      .run(
        `audit-expense-history-${EXPENSE_HISTORY_SEED}`,
        EXPENSE_HISTORY_SEED,
        JSON.stringify({ from: "2025-09", through: "2026-07", source: "Finance tracker 2025" }),
        SEEDED_AT,
      );
    database.connection
      .prepare(`
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES ('accepted_expense_history_seed', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(EXPENSE_HISTORY_SEED, SEEDED_AT);
  });
  seed.immediate();
}

function seedAcceptedCashBridge(database: FinanceHeroDatabase): void {
  const seed = database.connection.transaction(() => {
    const existing = database.connection
      .prepare("SELECT value FROM app_metadata WHERE key = 'accepted_cash_bridge_seed'")
      .get() as { value: string } | undefined;
    if (existing?.value === "2026-07-v1") {
      return;
    }

    database.connection
      .prepare(`
        INSERT OR IGNORE INTO monthly_cash_carryover_overrides
          (month, amount_paise, source_ref, updated_at)
        VALUES ('2026-06', 17133100, 'Daily Expenses JUN 26:A3 formula', ?)
      `)
      .run(SEEDED_AT);
    const insertAdjustment = database.connection.prepare(`
      INSERT OR IGNORE INTO monthly_cash_adjustments
        (id, month, occurred_on, label, amount_paise, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertAdjustment.run(
      "cash-adjustment-2026-06-salary",
      "2026-06",
      "2026-06-28",
      "June salary",
      30089300,
      1,
      SEEDED_AT,
    );
    insertAdjustment.run(
      "cash-adjustment-2026-06-extra",
      "2026-06",
      "2026-06-30",
      "Extra income",
      1716000,
      2,
      SEEDED_AT,
    );
    insertAdjustment.run("cash-adjustment-2026-07-extra", "2026-07", "2026-07-01", "Extra income", 40800, 1, SEEDED_AT);
    database.connection
      .prepare(`
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES ('accepted_cash_bridge_seed', '2026-07-v1', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(SEEDED_AT);
  });
  seed.immediate();
}

function seedAcceptedWealthSnapshot(database: FinanceHeroDatabase): void {
  const seed = database.connection.transaction(() => {
    const existing = database.connection
      .prepare("SELECT value FROM app_metadata WHERE key = 'accepted_wealth_seed'")
      .get() as { value: string } | undefined;
    if (existing) {
      return;
    }

    database.connection
      .prepare(`
        INSERT OR IGNORE INTO asset_positions
          (id, account_id, asset_type, baseline_value_paise, monthly_contribution_paise,
           restricted, as_of_date, valued_at, source_ref, updated_at)
        VALUES
          ('asset-savings', 'account-savings', 'savings', 11880800, 0, 0,
           '2026-07-18', ?, ?, ?),
          ('asset-pluxee', 'account-pluxee', 'restricted_wallet', 880000, 0, 1,
           '2026-07-18', ?, 'Owner-confirmed Pluxee food coupon balance', ?)
      `)
      .run(SEEDED_AT, `${SOURCE}:Savings`, SEEDED_AT, SEEDED_AT, SEEDED_AT);

    database.connection
      .prepare(`
        INSERT OR IGNORE INTO financial_goals
          (id, name, target_paise, target_mode, coverage_months, target_date,
           priority, status, monthly_contribution_paise,
           notes, source_ref, created_at, updated_at)
        VALUES
          ('goal-emergency-fund', 'Emergency fund', 56583000, 'emergency_cover', 3,
           NULL, 1, 'active', 0,
           'Imported from the accepted EF need in the finance tracker.',
           ?, ?, ?)
      `)
      .run(`${SOURCE}:EF need`, SEEDED_AT, SEEDED_AT);

    database.connection
      .prepare(`
        INSERT OR IGNORE INTO goal_allocations
          (goal_id, asset_position_id, amount_paise, effective_date, updated_at)
        VALUES ('goal-emergency-fund', 'asset-savings', 11880800, '2026-07-18', ?)
      `)
      .run(SEEDED_AT);

    database.connection
      .prepare(`
        INSERT INTO audit_events
          (id, action, entity_type, entity_id, detail_json, created_at)
        VALUES (?, 'wealth_snapshot.imported', 'migration', 'accepted-wealth',
                ?, ?)
      `)
      .run(
        randomUUID(),
        JSON.stringify({
          savingsPaise: 11880800,
          pluxeePaise: 880000,
          emergencyFundTargetPaise: 56583000,
        }),
        SEEDED_AT,
      );
    database.connection
      .prepare(`
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES ('accepted_wealth_seed', '2026-07-v1', ?)
      `)
      .run(SEEDED_AT);
  });
  seed.immediate();
}

function seedOwnerCashAccountPlan(database: FinanceHeroDatabase): void {
  const now = new Date().toISOString();
  const currentMonth = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date());

  const seed = database.connection.transaction(() => {
    const existing = database.connection
      .prepare("SELECT value FROM app_metadata WHERE key = 'owner_cash_account_plan'")
      .get() as { value: string } | undefined;
    if (existing?.value === "2026-08-v1") {
      return;
    }
    database.connection
      .prepare(
        "UPDATE accounts SET name = 'Jupiter construction account', institution = 'Jupiter' WHERE id = 'account-savings'",
      )
      .run();
    database.connection
      .prepare(`
        INSERT OR IGNORE INTO accounts
          (id, name, account_class, account_type, institution, is_active, created_at)
        VALUES ('account-icici-expense-reserve', 'ICICI expense reserve', 'asset', 'bank', 'ICICI Bank', 1, ?)
      `)
      .run(now);
    database.connection
      .prepare(`
        INSERT OR IGNORE INTO asset_positions
          (id, account_id, asset_type, baseline_value_paise, monthly_contribution_paise,
           restricted, as_of_date, valued_at, source_ref, updated_at)
        VALUES ('asset-icici-expense-reserve', 'account-icici-expense-reserve', 'savings', 0, ?, 0, ?, ?,
                'Owner-confirmed flexible extra-expense reserve', ?)
      `)
      .run(ICICI_EXPENSE_RESERVE_PAISE, currentDate, now, now);
    database.connection
      .prepare(`
        UPDATE asset_positions
        SET monthly_contribution_paise = ?, updated_at = ?
        WHERE id = 'asset-icici-expense-reserve'
      `)
      .run(ICICI_EXPENSE_RESERVE_PAISE, now);

    database.connection
      .prepare(`
        INSERT INTO budget_periods
          (month, planned_income_paise, regular_budget_paise, state, source_ref, updated_at)
        VALUES (?, COALESCE((
          SELECT planned_income_paise
          FROM budget_periods
          WHERE month < ? AND planned_income_paise > 0
          ORDER BY month DESC
          LIMIT 1
        ), ?), 0, 'open', 'owner monthly reserve plan', ?)
        ON CONFLICT(month) DO NOTHING
      `)
      .run(currentMonth, currentMonth, ACCEPTED_MONTHLY_INCOME_PLAN_PAISE, now);
    database.connection
      .prepare(`
        INSERT INTO budget_lines (month, category_id, planned_paise)
        SELECT month, 'category-extra-savings', ?
        FROM budget_periods
        WHERE month >= ?
        ON CONFLICT(month, category_id) DO UPDATE SET
          planned_paise = CASE
            WHEN budget_lines.planned_paise = 0 THEN excluded.planned_paise
            ELSE budget_lines.planned_paise
          END
      `)
      .run(ICICI_EXPENSE_RESERVE_PAISE, currentMonth);
    database.connection
      .prepare(`
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES ('owner_cash_account_plan', '2026-08-v1', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(now);
  });
  seed.immediate();
}

function reconcileHomeConstructionFunding(database: FinanceHeroDatabase): void {
  const now = new Date().toISOString();
  const rows = database.connection
    .prepare(`
      SELECT sheet.id AS transactionId, sheet.effective_month AS month,
             COALESCE((
               SELECT SUM(category_posting.amount_paise)
               FROM journal_transactions category_transaction
               JOIN postings category_posting ON category_posting.transaction_id = category_transaction.id
               WHERE category_transaction.effective_month = sheet.effective_month
                 AND category_transaction.status = 'posted'
                 AND category_posting.category_id = 'category-home-construction'
                 AND category_posting.amount_paise > 0
             ), 0) AS desiredPaise
      FROM journal_transactions sheet
      WHERE sheet.status = 'posted' AND sheet.origin = 'expense_sheet_aggregate'
        AND EXISTS (
          SELECT 1 FROM postings sheet_posting
          WHERE sheet_posting.transaction_id = sheet.id
            AND sheet_posting.category_id = 'category-home-construction'
        )
    `)
    .all() as Array<{ transactionId: string; month: string; desiredPaise: number }>;

  const reconcile = database.connection.transaction(() => {
    for (const row of rows) {
      const transfer = database.connection
        .prepare(`
          SELECT COALESCE(SUM(-source.amount_paise), 0) AS amountPaise
          FROM journal_transactions transfer_transaction
          JOIN postings source ON source.transaction_id = transfer_transaction.id
          WHERE transfer_transaction.effective_month = ?
            AND transfer_transaction.status = 'posted'
            AND transfer_transaction.origin = 'manual_transfer'
            AND source.account_id = 'account-primary-bank' AND source.amount_paise < 0
            AND EXISTS (
              SELECT 1 FROM postings destination
              WHERE destination.transaction_id = transfer_transaction.id
                AND destination.account_id = 'account-savings' AND destination.amount_paise > 0
            )
        `)
        .get(row.month) as { amountPaise: number };
      const supplementalFundingPaise = Math.max(0, row.desiredPaise - transfer.amountPaise);

      database.connection
        .prepare(`
          DELETE FROM postings
          WHERE transaction_id = ? AND account_id IN ('account-primary-bank', 'account-savings')
        `)
        .run(row.transactionId);
      if (supplementalFundingPaise > 0) {
        database.connection
          .prepare(`
            INSERT INTO postings (id, transaction_id, account_id, category_id, amount_paise, created_at)
            VALUES (?, ?, 'account-primary-bank', NULL, ?, ?),
                   (?, ?, 'account-savings', NULL, ?, ?)
          `)
          .run(
            randomUUID(),
            row.transactionId,
            -supplementalFundingPaise,
            now,
            randomUUID(),
            row.transactionId,
            supplementalFundingPaise,
            now,
          );
      }
    }
  });
  reconcile.immediate();
}

export function seedAcceptedOpeningSnapshot(database: FinanceHeroDatabase): void {
  seedAcceptedLiabilities(database);
  seedAcceptedPersonalBalances(database);
  seedHomeConstructionSnapshot(database);

  const seed = database.connection.transaction(() => {
    const insertAccount = database.connection.prepare(`
      INSERT OR IGNORE INTO accounts
        (id, name, account_class, account_type, institution, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    // Operational accounts remain additive so existing local databases receive new account types safely.
    insertAccount.run("account-primary-bank", "Primary salary account", "asset", "bank", null, SEEDED_AT);
    insertAccount.run("account-savings", "Savings", "asset", "savings", null, SEEDED_AT);
    insertAccount.run("account-pluxee", "Pluxee food wallet", "asset", "restricted_wallet", "Pluxee", SEEDED_AT);
    insertAccount.run(
      "account-home-construction-use",
      "Home construction project use",
      "equity",
      "project_use",
      null,
      SEEDED_AT,
    );
    database.connection
      .prepare("UPDATE categories SET name = 'Lending / payback' WHERE id = 'category-extra-savings'")
      .run();
    database.connection
      .prepare(`
        UPDATE journal_transactions
        SET origin = 'project_spend'
        WHERE id IN (
          SELECT linked_transaction_id FROM project_expenses
          WHERE linked_transaction_id IS NOT NULL
        ) AND origin = 'manual_expense'
      `)
      .run();
    database.connection
      .prepare(`
        UPDATE postings
        SET account_id = 'account-home-construction-use', category_id = NULL
        WHERE account_id = 'account-regular-expense'
          AND transaction_id IN (
            SELECT linked_transaction_id FROM project_expenses
            WHERE linked_transaction_id IS NOT NULL
          )
      `)
      .run();

    const existing = database.connection
      .prepare("SELECT value FROM app_metadata WHERE key = 'accepted_opening_seed'")
      .get() as { value: string } | undefined;

    if (existing) {
      return;
    }

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
  seedAcceptedExpenseHistory(database);
  seedAcceptedCashBridge(database);
  seedAcceptedWealthSnapshot(database);
  seedOwnerCashAccountPlan(database);
  reconcileHomeConstructionFunding(database);
}
