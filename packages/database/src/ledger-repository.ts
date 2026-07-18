import { createHash, randomUUID } from "node:crypto";
import { createJournalTransaction, Money } from "@finance-hero/domain";
import type { FinanceHeroDatabase } from "./encrypted-database";

export interface ManualTransactionInput {
  occurredOn: string;
  payee: string;
  memo?: string;
  kind: "expense" | "income";
  amountPaise: number;
  assetAccountId: string;
  categoryId?: string;
  idempotencyKey: string;
}

export interface LedgerTransactionRecord {
  id: string;
  occurredOn: string;
  payee: string;
  memo: string | null;
  kind: "expense" | "income";
  amountPaise: number;
  accountName: string;
  categoryName: string | null;
  origin: string;
}

export interface DashboardRecord {
  month: string;
  plannedIncomePaise: number;
  actualIncomePaise: number;
  regularExpensePaise: number;
  totalExpensePaise: number;
  cashOutflowPaise: number;
  debtPaymentPaise: number;
  assetBuildingPaise: number;
  regularBudgetPaise: number;
  totalEmiPaise: number;
  debtPrincipalPaise: number;
  availableAfterPlanPaise: number;
  budgetUsedPercentage: number;
  dangerAlert: boolean;
  transactionCount: number;
  categories: Array<{ id: string; name: string; amountPaise: number }>;
  expenseCategories: Array<{ id: string; name: string; amountPaise: number }>;
  snowballTarget: {
    name: string;
    principalPaise: number;
    emiPaise: number;
    annualRateBps: number | null;
  } | null;
}

export interface ReferenceDataRecord {
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
}

export interface ExpenseMonthSummaryRecord {
  month: string;
  regularExpensePaise: number;
  totalExpensePaise: number;
  cashOutflowPaise: number;
  debtPaymentPaise: number;
  assetBuildingPaise: number;
  regularBudgetPaise: number;
  budgetUsedPercentage: number;
  transactionCount: number;
}

export interface ExpenseYearRecord {
  year: string;
  months: ExpenseMonthSummaryRecord[];
}

export interface LiabilityRecord {
  id: string;
  name: string;
  productType: string;
  originalAmountPaise: number;
  currentPrincipalPaise: number;
  paidPaise: number;
  emiPaise: number;
  annualRateBps: number | null;
  status: "active" | "cleared";
  snowballRank: number | null;
  canUndoClear: boolean;
}

export interface LiabilitiesRecord {
  totalOriginalPaise: number;
  totalPrincipalPaise: number;
  totalEmiPaise: number;
  otherLiabilityPaise: number;
  receivablePaise: number;
  netObligationPaise: number;
  activeCount: number;
  clearedCount: number;
  liabilities: LiabilityRecord[];
  otherLiabilities: PersonalBalanceRecord[];
  receivables: PersonalBalanceRecord[];
}

export interface UpdateLiabilityInput {
  name?: string;
  productType?: string;
  originalAmountPaise?: number;
  currentPrincipalPaise?: number;
  emiPaise?: number;
  annualRateBps?: number | null;
  status?: "active" | "cleared";
}

export interface CreateLiabilityInput {
  name: string;
  productType: string;
  originalAmountPaise: number;
  currentPrincipalPaise: number;
  emiPaise: number;
  annualRateBps: number | null;
  status: "active" | "cleared";
}

export interface PersonalBalanceRecord {
  id: string;
  name: string;
  direction: "payable" | "receivable";
  amountPaise: number;
  status: "open" | "settled";
  note: string | null;
}

export interface CreatePersonalBalanceInput {
  name: string;
  direction: "payable" | "receivable";
  amountPaise: number;
  note?: string;
}

export interface UpdatePersonalBalanceInput {
  name?: string;
  amountPaise?: number;
  status?: "open" | "settled";
  note?: string | null;
}

export class LedgerRepository {
  constructor(private readonly database: FinanceHeroDatabase) {}

  private findClearSnapshot(id: string): { currentPrincipalPaise: number; emiPaise: number } | null {
    const events = this.database.connection
      .prepare(`
        SELECT detail_json AS detailJson
        FROM audit_events
        WHERE entity_type = 'debt' AND entity_id = ?
          AND action IN ('liability.cleared', 'liability.updated')
        ORDER BY created_at DESC, rowid DESC
      `)
      .all(id) as Array<{ detailJson: string }>;

    for (const event of events) {
      try {
        const detail = JSON.parse(event.detailJson) as {
          before?: { status?: string; currentPrincipalPaise?: number; emiPaise?: number };
          after?: { status?: string };
        };
        const principal = detail.before?.currentPrincipalPaise;
        const emi = detail.before?.emiPaise;
        if (
          detail.before?.status === "active" &&
          detail.after?.status === "cleared" &&
          Number.isSafeInteger(principal) &&
          Number.isSafeInteger(emi) &&
          (principal ?? -1) >= 0 &&
          (emi ?? -1) >= 0
        ) {
          return { currentPrincipalPaise: principal as number, emiPaise: emi as number };
        }
      } catch {
        // Ignore malformed historical audit data and continue to an earlier clear event.
      }
    }
    return null;
  }

  getReferenceData(): ReferenceDataRecord {
    return {
      accounts: this.database.connection
        .prepare("SELECT id, name FROM accounts WHERE account_class = 'asset' AND is_active = 1 ORDER BY name")
        .all() as ReferenceDataRecord["accounts"],
      categories: this.database.connection
        .prepare("SELECT id, name FROM categories WHERE budget_eligible = 1 ORDER BY name")
        .all() as ReferenceDataRecord["categories"],
    };
  }

  getExpenseYear(year: string): ExpenseYearRecord {
    const spending = this.database.connection
      .prepare(`
        SELECT t.effective_month AS month,
               COALESCE(SUM(CASE WHEN a.account_class = 'expense' AND c.alert_eligible = 1 THEN p.amount_paise ELSE 0 END), 0) AS regularExpensePaise,
               COALESCE(SUM(CASE WHEN a.account_class = 'expense' AND c.broad_bucket NOT IN ('debt_payment', 'asset_building', 'savings_investment') THEN p.amount_paise ELSE 0 END), 0) AS totalExpensePaise,
               COALESCE(SUM(CASE WHEN a.account_class = 'expense' THEN p.amount_paise ELSE 0 END), 0) AS cashOutflowPaise,
               COALESCE(SUM(CASE WHEN a.account_class = 'expense' AND c.broad_bucket = 'debt_payment' THEN p.amount_paise ELSE 0 END), 0) AS debtPaymentPaise,
               COALESCE(SUM(CASE WHEN a.account_class = 'expense' AND c.broad_bucket IN ('asset_building', 'savings_investment') THEN p.amount_paise ELSE 0 END), 0) AS assetBuildingPaise,
               COUNT(DISTINCT t.id) AS transactionCount
        FROM journal_transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE t.effective_month LIKE ? AND t.status = 'posted'
        GROUP BY t.effective_month
      `)
      .all(`${year}-%`) as Array<{
      month: string;
      regularExpensePaise: number;
      totalExpensePaise: number;
      cashOutflowPaise: number;
      debtPaymentPaise: number;
      assetBuildingPaise: number;
      transactionCount: number;
    }>;
    const budgets = this.database.connection
      .prepare(`
        SELECT month, regular_budget_paise AS regularBudgetPaise
        FROM budget_periods WHERE month LIKE ?
      `)
      .all(`${year}-%`) as Array<{ month: string; regularBudgetPaise: number }>;
    const spendingByMonth = new Map(spending.map((item) => [item.month, item]));
    const budgetByMonth = new Map(budgets.map((item) => [item.month, item.regularBudgetPaise]));

    return {
      year,
      months: Array.from({ length: 12 }, (_, index) => {
        const month = `${year}-${String(index + 1).padStart(2, "0")}`;
        const regularExpensePaise = spendingByMonth.get(month)?.regularExpensePaise ?? 0;
        const totalExpensePaise = spendingByMonth.get(month)?.totalExpensePaise ?? 0;
        const cashOutflowPaise = spendingByMonth.get(month)?.cashOutflowPaise ?? 0;
        const debtPaymentPaise = spendingByMonth.get(month)?.debtPaymentPaise ?? 0;
        const assetBuildingPaise = spendingByMonth.get(month)?.assetBuildingPaise ?? 0;
        const regularBudgetPaise = budgetByMonth.get(month) ?? 0;
        return {
          month,
          regularExpensePaise,
          totalExpensePaise,
          cashOutflowPaise,
          debtPaymentPaise,
          assetBuildingPaise,
          regularBudgetPaise,
          budgetUsedPercentage:
            regularBudgetPaise > 0 ? Math.round((regularExpensePaise / regularBudgetPaise) * 100) : 0,
          transactionCount: spendingByMonth.get(month)?.transactionCount ?? 0,
        };
      }),
    };
  }

  getLiabilities(): LiabilitiesRecord {
    const rows = this.database.connection
      .prepare(`
        SELECT id, lender AS name, product_type AS productType,
               original_amount_paise AS originalAmountPaise,
               current_principal_paise AS currentPrincipalPaise,
               emi_paise AS emiPaise, annual_rate_bps AS annualRateBps, status
        FROM debts
        ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, current_principal_paise DESC, lender ASC
      `)
      .all() as Array<Omit<LiabilityRecord, "paidPaise" | "snowballRank" | "canUndoClear">>;
    const snowballOrder = [...rows]
      .filter((item) => item.status === "active" && item.currentPrincipalPaise > 0)
      .sort((left, right) => left.currentPrincipalPaise - right.currentPrincipalPaise);
    const rankById = new Map(snowballOrder.map((item, index) => [item.id, index + 1]));
    const liabilities = rows.map((item) => ({
      ...item,
      paidPaise: Math.max(0, item.originalAmountPaise - item.currentPrincipalPaise),
      snowballRank: rankById.get(item.id) ?? null,
      canUndoClear: item.status === "cleared" && this.findClearSnapshot(item.id) !== null,
    }));
    const active = liabilities.filter((item) => item.status === "active");
    const personalBalances = this.listPersonalBalances();
    const otherLiabilities = personalBalances.filter((item) => item.direction === "payable");
    const receivables = personalBalances.filter((item) => item.direction === "receivable");
    const otherLiabilityPaise = otherLiabilities
      .filter((item) => item.status === "open")
      .reduce((sum, item) => sum + item.amountPaise, 0);
    const receivablePaise = receivables
      .filter((item) => item.status === "open")
      .reduce((sum, item) => sum + item.amountPaise, 0);
    const totalPrincipalPaise = active.reduce((sum, item) => sum + item.currentPrincipalPaise, 0);

    return {
      totalOriginalPaise: liabilities.reduce((sum, item) => sum + item.originalAmountPaise, 0),
      totalPrincipalPaise,
      totalEmiPaise: active.reduce((sum, item) => sum + item.emiPaise, 0),
      otherLiabilityPaise,
      receivablePaise,
      netObligationPaise: totalPrincipalPaise + otherLiabilityPaise - receivablePaise,
      activeCount: active.length,
      clearedCount: liabilities.length - active.length,
      liabilities,
      otherLiabilities,
      receivables,
    };
  }

  listPersonalBalances(): PersonalBalanceRecord[] {
    return this.database.connection
      .prepare(`
        SELECT id, name, direction, amount_paise AS amountPaise, status, note
        FROM personal_balances
        ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, name ASC
      `)
      .all() as PersonalBalanceRecord[];
  }

  createPersonalBalance(input: CreatePersonalBalanceInput): PersonalBalanceRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: PersonalBalanceRecord = {
      id,
      name: input.name.trim(),
      direction: input.direction,
      amountPaise: input.amountPaise,
      status: "open",
      note: input.note?.trim() || null,
    };

    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          INSERT INTO personal_balances
            (id, name, direction, amount_paise, status, note, source_ref, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
        `)
        .run(id, record.name, record.direction, record.amountPaise, record.status, record.note, now);
      this.database.connection
        .prepare(`
          INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
          VALUES (?, 'personal_balance.created', 'personal_balance', ?, ?, ?)
        `)
        .run(randomUUID(), id, JSON.stringify(record), now);
    });
    write.immediate();
    return record;
  }

  updatePersonalBalance(id: string, input: UpdatePersonalBalanceInput): PersonalBalanceRecord {
    const existing = this.listPersonalBalances().find((item) => item.id === id);
    if (!existing) {
      throw new Error("Personal balance does not exist.");
    }
    const next: PersonalBalanceRecord = {
      ...existing,
      name: input.name?.trim() ?? existing.name,
      amountPaise: input.amountPaise ?? existing.amountPaise,
      status: input.status ?? existing.status,
      note: input.note === undefined ? existing.note : input.note?.trim() || null,
    };
    const now = new Date().toISOString();

    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          UPDATE personal_balances
          SET name = ?, amount_paise = ?, status = ?, note = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(next.name, next.amountPaise, next.status, next.note, now, id);
      this.database.connection
        .prepare(`
          INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
          VALUES (?, 'personal_balance.updated', 'personal_balance', ?, ?, ?)
        `)
        .run(randomUUID(), id, JSON.stringify({ before: existing, after: next }), now);
    });
    write.immediate();
    return next;
  }

  createLiability(input: CreateLiabilityInput): LiabilityRecord {
    const id = `debt-${randomUUID()}`;
    const accountId = `account-${id}`;
    const now = new Date().toISOString();
    const principal = input.status === "cleared" ? 0 : input.currentPrincipalPaise;
    const emi = input.status === "cleared" ? 0 : input.emiPaise;

    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          INSERT INTO accounts
            (id, name, account_class, account_type, institution, is_active, created_at)
          VALUES (?, ?, 'liability', ?, ?, 1, ?)
        `)
        .run(accountId, input.name.trim(), input.productType.trim(), input.name.trim(), now);
      this.database.connection
        .prepare(`
          INSERT INTO debts
            (id, account_id, lender, product_type, original_amount_paise, current_principal_paise,
             emi_paise, annual_rate_bps, status, source_ref, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `)
        .run(
          id,
          accountId,
          input.name.trim(),
          input.productType.trim(),
          input.originalAmountPaise,
          principal,
          emi,
          input.annualRateBps,
          input.status,
          now,
        );
      this.database.connection
        .prepare(`
          INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
          VALUES (?, 'liability.created', 'debt', ?, ?, ?)
        `)
        .run(randomUUID(), id, JSON.stringify({ ...input, currentPrincipalPaise: principal, emiPaise: emi }), now);
    });
    write.immediate();

    const created = this.getLiabilities().liabilities.find((liability) => liability.id === id);
    if (!created) {
      throw new Error("Created liability could not be read.");
    }
    return created;
  }

  updateLiability(id: string, input: UpdateLiabilityInput): LiabilityRecord {
    const existing = this.database.connection
      .prepare(`
        SELECT id, account_id AS accountId, lender AS name, product_type AS productType,
               original_amount_paise AS originalAmountPaise,
               current_principal_paise AS currentPrincipalPaise,
               emi_paise AS emiPaise, annual_rate_bps AS annualRateBps, status
        FROM debts WHERE id = ?
      `)
      .get(id) as (Omit<LiabilityRecord, "paidPaise" | "snowballRank"> & { accountId: string }) | undefined;
    if (!existing) {
      throw new Error("Liability does not exist.");
    }

    const next = {
      name: input.name?.trim() ?? existing.name,
      productType: input.productType?.trim() ?? existing.productType,
      originalAmountPaise: input.originalAmountPaise ?? existing.originalAmountPaise,
      currentPrincipalPaise: input.currentPrincipalPaise ?? existing.currentPrincipalPaise,
      emiPaise: input.emiPaise ?? existing.emiPaise,
      annualRateBps: input.annualRateBps === undefined ? existing.annualRateBps : input.annualRateBps,
      status: input.status ?? existing.status,
    };
    if (next.status === "cleared") {
      next.currentPrincipalPaise = 0;
      next.emiPaise = 0;
    }
    const now = new Date().toISOString();

    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          UPDATE debts SET lender = ?, product_type = ?, original_amount_paise = ?,
            current_principal_paise = ?, emi_paise = ?, annual_rate_bps = ?, status = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          next.name,
          next.productType,
          next.originalAmountPaise,
          next.currentPrincipalPaise,
          next.emiPaise,
          next.annualRateBps,
          next.status,
          now,
          id,
        );
      this.database.connection
        .prepare("UPDATE accounts SET name = ?, account_type = ?, institution = ? WHERE id = ?")
        .run(next.name, next.productType, next.name, existing.accountId);
      this.database.connection
        .prepare(`
          INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
          VALUES (?, ?, 'debt', ?, ?, ?)
        `)
        .run(
          randomUUID(),
          existing.status === "active" && next.status === "cleared" ? "liability.cleared" : "liability.updated",
          id,
          JSON.stringify({ before: existing, after: next }),
          now,
        );
    });
    write.immediate();

    const updated = this.getLiabilities().liabilities.find((liability) => liability.id === id);
    if (!updated) {
      throw new Error("Updated liability could not be read.");
    }
    return updated;
  }

  undoLiabilityClear(id: string): LiabilityRecord {
    const existing = this.database.connection
      .prepare(`
        SELECT id, lender AS name, product_type AS productType,
               original_amount_paise AS originalAmountPaise,
               current_principal_paise AS currentPrincipalPaise,
               emi_paise AS emiPaise, annual_rate_bps AS annualRateBps, status
        FROM debts WHERE id = ?
      `)
      .get(id) as Omit<LiabilityRecord, "paidPaise" | "snowballRank" | "canUndoClear"> | undefined;
    if (!existing) {
      throw new Error("Liability does not exist.");
    }
    if (existing.status !== "cleared") {
      throw new Error("Only a cleared liability can be restored.");
    }

    const snapshot = this.findClearSnapshot(id);
    if (!snapshot) {
      throw new Error("No clear action is available to undo.");
    }
    const now = new Date().toISOString();
    const after = {
      ...existing,
      currentPrincipalPaise: snapshot.currentPrincipalPaise,
      emiPaise: snapshot.emiPaise,
      status: "active" as const,
    };

    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          UPDATE debts
          SET current_principal_paise = ?, emi_paise = ?, status = 'active', updated_at = ?
          WHERE id = ?
        `)
        .run(after.currentPrincipalPaise, after.emiPaise, now, id);
      this.database.connection
        .prepare(`
          INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
          VALUES (?, 'liability.clear_undone', 'debt', ?, ?, ?)
        `)
        .run(randomUUID(), id, JSON.stringify({ before: existing, after }), now);
    });
    write.immediate();

    const restored = this.getLiabilities().liabilities.find((liability) => liability.id === id);
    if (!restored) {
      throw new Error("Restored liability could not be read.");
    }
    return restored;
  }

  getDashboard(month: string, localDay: number): DashboardRecord {
    const period = this.database.connection
      .prepare(`
        SELECT planned_income_paise AS plannedIncomePaise,
               regular_budget_paise AS regularBudgetPaise
        FROM budget_periods WHERE month = ?
      `)
      .get(month) as { plannedIncomePaise: number; regularBudgetPaise: number } | undefined;

    const totals = this.database.connection
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN a.account_class = 'income' THEN -p.amount_paise ELSE 0 END), 0) AS actualIncomePaise,
          COALESCE(SUM(CASE WHEN a.account_class = 'expense' AND c.alert_eligible = 1 THEN p.amount_paise ELSE 0 END), 0) AS regularExpensePaise,
          COALESCE(SUM(CASE WHEN a.account_class = 'expense' AND c.broad_bucket NOT IN ('debt_payment', 'asset_building', 'savings_investment') THEN p.amount_paise ELSE 0 END), 0) AS totalExpensePaise,
          COALESCE(SUM(CASE WHEN a.account_class = 'expense' THEN p.amount_paise ELSE 0 END), 0) AS cashOutflowPaise,
          COALESCE(SUM(CASE WHEN a.account_class = 'expense' AND c.broad_bucket = 'debt_payment' THEN p.amount_paise ELSE 0 END), 0) AS debtPaymentPaise,
          COALESCE(SUM(CASE WHEN a.account_class = 'expense' AND c.broad_bucket IN ('asset_building', 'savings_investment') THEN p.amount_paise ELSE 0 END), 0) AS assetBuildingPaise,
          COUNT(DISTINCT t.id) AS transactionCount
        FROM journal_transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE t.effective_month = ? AND t.status = 'posted'
      `)
      .get(month) as {
      actualIncomePaise: number;
      regularExpensePaise: number;
      totalExpensePaise: number;
      cashOutflowPaise: number;
      debtPaymentPaise: number;
      assetBuildingPaise: number;
      transactionCount: number;
    };

    const debtTotals = this.database.connection
      .prepare(`
        SELECT COALESCE(SUM(current_principal_paise), 0) AS debtPrincipalPaise,
               COALESCE(SUM(emi_paise), 0) AS totalEmiPaise
        FROM debts WHERE status = 'active'
      `)
      .get() as { debtPrincipalPaise: number; totalEmiPaise: number };

    const categories = this.database.connection
      .prepare(`
        SELECT c.id, c.name, SUM(p.amount_paise) AS amountPaise
        FROM journal_transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id AND a.account_class = 'expense'
        JOIN categories c ON c.id = p.category_id AND c.alert_eligible = 1
        WHERE t.effective_month = ? AND t.status = 'posted'
        GROUP BY c.id, c.name
        HAVING SUM(p.amount_paise) > 0
        ORDER BY amountPaise DESC
      `)
      .all(month) as DashboardRecord["categories"];

    const expenseCategories = this.database.connection
      .prepare(`
        SELECT c.id, c.name, SUM(p.amount_paise) AS amountPaise
        FROM journal_transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id AND a.account_class = 'expense'
        JOIN categories c ON c.id = p.category_id
        WHERE t.effective_month = ? AND t.status = 'posted'
        GROUP BY c.id, c.name
        HAVING SUM(p.amount_paise) > 0
        ORDER BY amountPaise DESC
      `)
      .all(month) as DashboardRecord["expenseCategories"];

    const snowballTarget = this.database.connection
      .prepare(`
        SELECT lender AS name, current_principal_paise AS principalPaise,
               emi_paise AS emiPaise, annual_rate_bps AS annualRateBps
        FROM debts
        WHERE status = 'active' AND current_principal_paise > 0
        ORDER BY current_principal_paise ASC, id ASC
        LIMIT 1
      `)
      .get() as DashboardRecord["snowballTarget"];

    const plannedIncomePaise = period?.plannedIncomePaise ?? 0;
    const regularBudgetPaise = period?.regularBudgetPaise ?? 0;
    const budgetUsedPercentage =
      regularBudgetPaise > 0 ? Math.round((totals.regularExpensePaise / regularBudgetPaise) * 100) : 0;

    return {
      month,
      plannedIncomePaise,
      actualIncomePaise: totals.actualIncomePaise,
      regularExpensePaise: totals.regularExpensePaise,
      totalExpensePaise: totals.totalExpensePaise,
      cashOutflowPaise: totals.cashOutflowPaise,
      debtPaymentPaise: totals.debtPaymentPaise,
      assetBuildingPaise: totals.assetBuildingPaise,
      regularBudgetPaise,
      totalEmiPaise: debtTotals.totalEmiPaise,
      debtPrincipalPaise: debtTotals.debtPrincipalPaise,
      availableAfterPlanPaise: plannedIncomePaise - totals.cashOutflowPaise,
      budgetUsedPercentage,
      dangerAlert: localDay < 20 && budgetUsedPercentage >= 60,
      transactionCount: totals.transactionCount,
      categories,
      expenseCategories,
      snowballTarget: snowballTarget ?? null,
    };
  }

  listTransactions(month: string): LedgerTransactionRecord[] {
    return this.database.connection
      .prepare(`
        SELECT t.id, t.occurred_on AS occurredOn, t.payee, t.memo, t.origin,
               CASE WHEN a.account_class = 'income' THEN 'income' ELSE 'expense' END AS kind,
               ABS(p.amount_paise) AS amountPaise,
               COALESCE(asset.name, 'Migration opening balance') AS accountName,
               c.name AS categoryName
        FROM journal_transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id AND a.account_class IN ('income', 'expense')
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN postings asset_posting ON asset_posting.transaction_id = t.id AND asset_posting.id <> p.id
        LEFT JOIN accounts asset ON asset.id = asset_posting.account_id AND asset.account_class = 'asset'
        WHERE t.effective_month = ? AND t.status = 'posted'
        ORDER BY t.occurred_on DESC, t.created_at DESC
      `)
      .all(month) as LedgerTransactionRecord[];
  }

  createManualTransaction(input: ManualTransactionInput): LedgerTransactionRecord {
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = this.database.connection
      .prepare("SELECT request_hash AS requestHash, response_json AS responseJson FROM idempotency_keys WHERE key = ?")
      .get(input.idempotencyKey) as { requestHash: string; responseJson: string } | undefined;

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new Error("Idempotency key was already used with a different request.");
      }
      return JSON.parse(existing.responseJson) as LedgerTransactionRecord;
    }

    const asset = this.database.connection
      .prepare("SELECT id, name FROM accounts WHERE id = ? AND account_class = 'asset' AND is_active = 1")
      .get(input.assetAccountId) as { id: string; name: string } | undefined;
    if (!asset) {
      throw new Error("Selected asset account does not exist.");
    }

    const category = input.categoryId
      ? (this.database.connection.prepare("SELECT id, name FROM categories WHERE id = ?").get(input.categoryId) as
          | { id: string; name: string }
          | undefined)
      : undefined;
    if (input.kind === "expense" && !category) {
      throw new Error("Expense transactions require a category.");
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const counterpartyAccountId = input.kind === "expense" ? "account-regular-expense" : "account-salary-income";
    const counterpartyAmount = input.kind === "expense" ? input.amountPaise : -input.amountPaise;
    const assetAmount = -counterpartyAmount;

    createJournalTransaction({
      id,
      occurredOn: input.occurredOn,
      payee: input.payee,
      memo: input.memo,
      postings: [
        {
          accountId: counterpartyAccountId,
          accountClass: input.kind === "expense" ? "expense" : "income",
          amount: Money.fromPaise(BigInt(counterpartyAmount)),
          categoryId: category?.id,
        },
        {
          accountId: asset.id,
          accountClass: "asset",
          amount: Money.fromPaise(BigInt(assetAmount)),
        },
      ],
    });

    const result: LedgerTransactionRecord = {
      id,
      occurredOn: input.occurredOn,
      payee: input.payee.trim(),
      memo: input.memo?.trim() || null,
      kind: input.kind,
      amountPaise: input.amountPaise,
      accountName: asset.name,
      categoryName: category?.name ?? null,
      origin: "manual",
    };

    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          INSERT INTO journal_transactions
            (id, occurred_on, effective_month, payee, memo, status, origin, source_ref, created_at)
          VALUES (?, ?, ?, ?, ?, 'posted', 'manual', NULL, ?)
        `)
        .run(id, input.occurredOn, input.occurredOn.slice(0, 7), result.payee, result.memo, now);
      this.database.connection
        .prepare(`
          INSERT INTO postings (id, transaction_id, account_id, category_id, amount_paise, created_at)
          VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, NULL, ?, ?)
        `)
        .run(
          randomUUID(),
          id,
          counterpartyAccountId,
          category?.id ?? null,
          counterpartyAmount,
          now,
          randomUUID(),
          id,
          asset.id,
          assetAmount,
          now,
        );
      this.database.connection
        .prepare(`
          INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
          VALUES (?, 'transaction.created', 'journal_transaction', ?, ?, ?)
        `)
        .run(randomUUID(), id, JSON.stringify({ origin: "manual", amountPaise: input.amountPaise }), now);
      this.database.connection
        .prepare(`
          INSERT INTO idempotency_keys (key, request_hash, response_json, created_at)
          VALUES (?, ?, ?, ?)
        `)
        .run(input.idempotencyKey, requestHash, JSON.stringify(result), now);
    });
    write.immediate();

    return result;
  }
}
