import { randomUUID } from "node:crypto";
import type { FinanceHeroDatabase } from "./encrypted-database";

export interface BudgetLineRecord {
  categoryId: string;
  categoryName: string;
  broadBucket: string;
  alertEligible: boolean;
  plannedPaise: number;
  spentPaise: number;
  remainingPaise: number;
}

export interface BudgetMonthRecord {
  month: string;
  state: "open" | "closed";
  plannedIncomePaise: number;
  regularBudgetPaise: number;
  unallocatedIncomePaise: number;
  lines: BudgetLineRecord[];
}

export interface UpdateBudgetMonthInput {
  plannedIncomePaise?: number;
  lines?: Array<{ categoryId: string; plannedPaise: number }>;
}

export class BudgetRepository {
  constructor(private readonly database: FinanceHeroDatabase) {}

  getMonth(month: string): BudgetMonthRecord {
    const period = this.database.connection
      .prepare(`
        SELECT planned_income_paise AS plannedIncomePaise,
               regular_budget_paise AS regularBudgetPaise, state
        FROM budget_periods
        WHERE month = ?
      `)
      .get(month) as
      | {
          plannedIncomePaise: number;
          regularBudgetPaise: number;
          state: BudgetMonthRecord["state"];
        }
      | undefined;
    const lines = this.database.connection
      .prepare(`
        SELECT c.id AS categoryId, c.name AS categoryName, c.broad_bucket AS broadBucket,
               c.alert_eligible AS alertEligible,
               COALESCE(bl.planned_paise, 0) AS plannedPaise,
               COALESCE(SUM(CASE
                 WHEN t.status = 'posted' AND a.account_class = 'expense' THEN p.amount_paise
                 ELSE 0
               END), 0) AS spentPaise
        FROM categories c
        LEFT JOIN budget_lines bl ON bl.category_id = c.id AND bl.month = ?
        LEFT JOIN postings p ON p.category_id = c.id
        LEFT JOIN journal_transactions t ON t.id = p.transaction_id AND t.effective_month = ?
        LEFT JOIN accounts a ON a.id = p.account_id
        WHERE c.budget_eligible = 1
        GROUP BY c.id, c.name, c.broad_bucket, c.alert_eligible, bl.planned_paise
        ORDER BY CASE c.broad_bucket WHEN 'regular' THEN 0 ELSE 1 END, c.name
      `)
      .all(month, month)
      .map((row) => {
        const line = row as Omit<BudgetLineRecord, "alertEligible" | "remainingPaise"> & { alertEligible: number };
        return {
          ...line,
          alertEligible: line.alertEligible === 1,
          remainingPaise: line.plannedPaise - line.spentPaise,
        };
      });
    const plannedIncomePaise = period?.plannedIncomePaise ?? 0;
    const regularBudgetPaise = period?.regularBudgetPaise ?? lines.reduce((sum, line) => sum + line.plannedPaise, 0);
    return {
      month,
      state: period?.state ?? "open",
      plannedIncomePaise,
      regularBudgetPaise,
      unallocatedIncomePaise: plannedIncomePaise - regularBudgetPaise,
      lines,
    };
  }

  updateMonth(month: string, input: UpdateBudgetMonthInput): BudgetMonthRecord {
    const before = this.getMonth(month);
    const knownCategoryIds = new Set(before.lines.map((line) => line.categoryId));
    const seen = new Set<string>();
    for (const line of input.lines ?? []) {
      if (!knownCategoryIds.has(line.categoryId)) {
        throw new Error("Budget category does not exist or is not budget eligible.");
      }
      if (seen.has(line.categoryId)) {
        throw new Error("Budget category was provided more than once.");
      }
      seen.add(line.categoryId);
    }

    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          INSERT INTO budget_periods
            (month, planned_income_paise, regular_budget_paise, state, source_ref, updated_at)
          VALUES (?, ?, 0, 'open', 'manual budget plan', ?)
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
      for (const line of input.lines ?? []) {
        upsertLine.run(month, line.categoryId, line.plannedPaise);
      }

      const total = this.database.connection
        .prepare("SELECT COALESCE(SUM(planned_paise), 0) AS total FROM budget_lines WHERE month = ?")
        .get(month) as { total: number };
      this.database.connection
        .prepare("UPDATE budget_periods SET regular_budget_paise = ?, updated_at = ? WHERE month = ?")
        .run(total.total, now, month);
      const after = this.getMonth(month);
      this.database.connection
        .prepare(`
          INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
          VALUES (?, 'budget.updated', 'budget_period', ?, ?, ?)
        `)
        .run(randomUUID(), month, JSON.stringify({ before, after }), now);
    });
    write.immediate();
    return this.getMonth(month);
  }
}
