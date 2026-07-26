import { randomUUID } from "node:crypto";
import type { FinanceHeroDatabase } from "./encrypted-database";

export interface BudgetLineRecord {
  categoryId: string;
  categoryName: string;
  broadBucket: string;
  budgetEligible: boolean;
  alertEligible: boolean;
  plannedPaise: number;
  spentPaise: number;
  remainingPaise: number;
  comment: string;
  updatedAt: string | null;
}

export interface BudgetMonthRecord {
  month: string;
  state: "open" | "closed";
  plannedIncomePaise: number;
  regularBudgetPaise: number;
  unallocatedIncomePaise: number;
  updatedAt: string | null;
  lines: BudgetLineRecord[];
}

export interface UpdateBudgetMonthInput {
  plannedIncomePaise?: number;
  lines?: Array<{
    categoryId: string;
    plannedPaise?: number;
    actualPaise?: number;
    comment?: string;
  }>;
}

interface StoredCategory {
  id: string;
  name: string;
  budgetEligible: number;
}

const SHEET_CATEGORY_ORDER = [
  "category-rent",
  "category-home",
  "category-household",
  "category-utilities",
  "category-groceries",
  "category-transport",
  "category-personal",
  "category-learning",
  "category-medical",
  "category-insurance",
  "category-misc",
  "category-credit-card-bills",
  "category-emi-payments",
  "category-home-construction",
  "category-extra-savings",
  "category-loan-charges",
  "category-loan-repayments",
  "category-emergency-fund",
] as const;

function expenseSheetDate(month: string): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  if (today.startsWith(month)) {
    return today;
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year ?? 2000, monthNumber ?? 1, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

export class BudgetRepository {
  constructor(private readonly database: FinanceHeroDatabase) {}

  getMonth(month: string): BudgetMonthRecord {
    const period = this.database.connection
      .prepare(`
        SELECT planned_income_paise AS plannedIncomePaise,
               regular_budget_paise AS regularBudgetPaise, state,
               updated_at AS updatedAt
        FROM budget_periods
        WHERE month = ?
      `)
      .get(month) as
      | {
          plannedIncomePaise: number;
          regularBudgetPaise: number;
          state: BudgetMonthRecord["state"];
          updatedAt: string;
        }
      | undefined;
    const lines = this.database.connection
      .prepare(`
        SELECT c.id AS categoryId, c.name AS categoryName, c.broad_bucket AS broadBucket,
               c.budget_eligible AS budgetEligible, c.alert_eligible AS alertEligible,
               COALESCE(bl.planned_paise, 0) AS plannedPaise,
               COALESCE(SUM(CASE
                 WHEN t.status = 'posted' AND a.account_class = 'expense' THEN p.amount_paise
                 ELSE 0
               END), 0) AS spentPaise,
               COALESCE(sheet.comment, '') AS comment,
               sheet.updated_at AS updatedAt
        FROM categories c
        LEFT JOIN budget_lines bl ON bl.category_id = c.id AND bl.month = ?
        LEFT JOIN monthly_expense_sheet_rows sheet ON sheet.category_id = c.id AND sheet.month = ?
        LEFT JOIN postings p ON p.category_id = c.id
        LEFT JOIN journal_transactions t ON t.id = p.transaction_id AND t.effective_month = ?
        LEFT JOIN accounts a ON a.id = p.account_id
        GROUP BY c.id, c.name, c.broad_bucket, c.budget_eligible, c.alert_eligible,
                 bl.planned_paise, sheet.comment, sheet.updated_at
        ORDER BY CASE c.id
          ${SHEET_CATEGORY_ORDER.map((categoryId, index) => `WHEN '${categoryId}' THEN ${index + 1}`).join("\n")}
          ELSE 999
        END, c.name
      `)
      .all(month, month, month)
      .map((row) => {
        const line = row as Omit<BudgetLineRecord, "alertEligible" | "budgetEligible" | "remainingPaise"> & {
          alertEligible: number;
          budgetEligible: number;
        };
        return {
          ...line,
          alertEligible: line.alertEligible === 1,
          budgetEligible: line.budgetEligible === 1,
          remainingPaise: line.budgetEligible ? line.plannedPaise - line.spentPaise : 0,
        };
      });
    const plannedIncomePaise = period?.plannedIncomePaise ?? 0;
    const regularBudgetPaise = lines
      .filter((line) => line.budgetEligible)
      .reduce((sum, line) => sum + line.plannedPaise, 0);
    return {
      month,
      state: period?.state ?? "open",
      plannedIncomePaise,
      regularBudgetPaise,
      unallocatedIncomePaise: plannedIncomePaise - regularBudgetPaise,
      updatedAt: period?.updatedAt ?? null,
      lines,
    };
  }

  updateMonth(month: string, input: UpdateBudgetMonthInput): BudgetMonthRecord {
    const before = this.getMonth(month);
    const categories = this.database.connection
      .prepare(`
        SELECT id, name, budget_eligible AS budgetEligible
        FROM categories
      `)
      .all() as StoredCategory[];
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const seen = new Set<string>();
    for (const line of input.lines ?? []) {
      const category = categoryById.get(line.categoryId);
      if (!category) {
        throw new Error("Expense sheet category does not exist.");
      }
      if (seen.has(line.categoryId)) {
        throw new Error("Expense sheet category was provided more than once.");
      }
      if (line.plannedPaise !== undefined && category.budgetEligible !== 1 && line.plannedPaise !== 0) {
        throw new Error("Only regular expense categories can have a monthly limit.");
      }
      seen.add(line.categoryId);
    }

    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          INSERT INTO budget_periods
            (month, planned_income_paise, regular_budget_paise, state, source_ref, updated_at)
          VALUES (?, ?, 0, 'open', 'monthly expense sheet', ?)
          ON CONFLICT(month) DO UPDATE SET
            planned_income_paise = excluded.planned_income_paise,
            source_ref = excluded.source_ref,
            updated_at = excluded.updated_at
        `)
        .run(month, input.plannedIncomePaise ?? before.plannedIncomePaise, now);

      const upsertLine = this.database.connection.prepare(`
        INSERT INTO budget_lines (month, category_id, planned_paise)
        VALUES (?, ?, ?)
        ON CONFLICT(month, category_id) DO UPDATE SET planned_paise = excluded.planned_paise
      `);
      const existingSheetRow = this.database.connection.prepare(`
        SELECT comment FROM monthly_expense_sheet_rows WHERE month = ? AND category_id = ?
      `);
      const upsertSheetRow = this.database.connection.prepare(`
        INSERT INTO monthly_expense_sheet_rows (month, category_id, comment, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(month, category_id) DO UPDATE SET
          comment = excluded.comment,
          updated_at = excluded.updated_at
      `);

      for (const line of input.lines ?? []) {
        const category = categoryById.get(line.categoryId);
        if (!category) continue;
        if (line.plannedPaise !== undefined && category.budgetEligible === 1) {
          upsertLine.run(month, line.categoryId, line.plannedPaise);
        }
        if (line.actualPaise !== undefined) {
          this.setCategoryActual(month, category, line.actualPaise, now);
        }
        const existing = existingSheetRow.get(month, line.categoryId) as { comment: string | null } | undefined;
        upsertSheetRow.run(month, line.categoryId, line.comment ?? existing?.comment ?? null, now);
      }

      const total = this.database.connection
        .prepare(`
          SELECT COALESCE(SUM(bl.planned_paise), 0) AS total
          FROM budget_lines bl
          JOIN categories c ON c.id = bl.category_id AND c.budget_eligible = 1
          WHERE bl.month = ?
        `)
        .get(month) as { total: number };
      this.database.connection
        .prepare("UPDATE budget_periods SET regular_budget_paise = ?, updated_at = ? WHERE month = ?")
        .run(total.total, now, month);
      const after = this.getMonth(month);
      this.database.connection
        .prepare(`
          INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
          VALUES (?, 'expense_sheet.updated', 'budget_period', ?, ?, ?)
        `)
        .run(randomUUID(), month, JSON.stringify({ before, after }), now);
    });
    write.immediate();
    return this.getMonth(month);
  }

  private setCategoryActual(month: string, category: StoredCategory, desiredPaise: number, now: string) {
    const historicalId = `migration-expense-history-${month}-${category.id}`;
    const sheetId = `expense-sheet-${month}-${category.id}`;
    const existingAggregate = this.database.connection
      .prepare(`
        SELECT id
        FROM journal_transactions
        WHERE id IN (?, ?)
        ORDER BY CASE id WHEN ? THEN 0 ELSE 1 END
        LIMIT 1
      `)
      .get(historicalId, sheetId, historicalId) as { id: string } | undefined;
    const aggregateIds = [historicalId, sheetId];
    const base = this.database.connection
      .prepare(`
        SELECT COALESCE(SUM(p.amount_paise), 0) AS amountPaise
        FROM journal_transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id AND a.account_class = 'expense'
        WHERE t.effective_month = ? AND t.status = 'posted' AND p.category_id = ?
          AND t.id NOT IN (?, ?)
      `)
      .get(month, category.id, ...aggregateIds) as { amountPaise: number };
    const aggregatePaise = desiredPaise - base.amountPaise;
    if (aggregatePaise < 0) {
      throw new Error(
        `${category.name} already has ${base.amountPaise / 100} INR in detailed ledger transactions. Correct those entries before lowering the sheet total.`,
      );
    }

    if (existingAggregate) {
      this.database.connection.prepare("DELETE FROM postings WHERE transaction_id = ?").run(existingAggregate.id);
      if (aggregatePaise === 0) {
        this.database.connection.prepare("DELETE FROM journal_transactions WHERE id = ?").run(existingAggregate.id);
        return;
      }
      this.database.connection
        .prepare(`
          UPDATE journal_transactions
          SET occurred_on = ?, payee = ?, memo = ?, status = 'posted',
              origin = 'expense_sheet_aggregate', source_ref = ?
          WHERE id = ?
        `)
        .run(
          expenseSheetDate(month),
          category.name,
          "Monthly category total edited from the expense sheet.",
          `monthly-expense-sheet:${month}:${category.id}`,
          existingAggregate.id,
        );
      this.insertAggregatePostings(existingAggregate.id, category.id, aggregatePaise, now);
      return;
    }

    if (aggregatePaise === 0) {
      return;
    }
    this.database.connection
      .prepare(`
        INSERT INTO journal_transactions
          (id, occurred_on, effective_month, payee, memo, status, origin, source_ref, created_at)
        VALUES (?, ?, ?, ?, ?, 'posted', 'expense_sheet_aggregate', ?, ?)
      `)
      .run(
        sheetId,
        expenseSheetDate(month),
        month,
        category.name,
        "Monthly category total edited from the expense sheet.",
        `monthly-expense-sheet:${month}:${category.id}`,
        now,
      );
    this.insertAggregatePostings(sheetId, category.id, aggregatePaise, now);
  }

  private insertAggregatePostings(transactionId: string, categoryId: string, amountPaise: number, createdAt: string) {
    this.database.connection
      .prepare(`
        INSERT INTO postings (id, transaction_id, account_id, category_id, amount_paise, created_at)
        VALUES (?, ?, 'account-regular-expense', ?, ?, ?),
               (?, ?, 'account-migration-equity', NULL, ?, ?)
      `)
      .run(
        randomUUID(),
        transactionId,
        categoryId,
        amountPaise,
        createdAt,
        randomUUID(),
        transactionId,
        -amountPaise,
        createdAt,
      );
  }
}
