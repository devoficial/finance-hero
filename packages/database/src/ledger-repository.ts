import { createHash, randomUUID } from "node:crypto";
import { createJournalTransaction, Money, type PostingInput } from "@finance-hero/domain";
import { BudgetRepository } from "./budget-repository";
import type { FinanceHeroDatabase } from "./encrypted-database";

export interface ManualTransactionInput {
  occurredOn: string;
  payee: string;
  memo?: string;
  kind: "expense" | "income" | "transfer" | "debt_payment";
  amountPaise: number;
  accountId: string;
  destinationAccountId?: string;
  categoryId?: string;
  splits?: Array<{ categoryId: string; amountPaise: number }>;
  idempotencyKey: string;
}

export interface ProjectSpendTransactionInput {
  occurredOn: string;
  payee: string;
  memo?: string;
  amountPaise: number;
  accountId: string;
  idempotencyKey: string;
}

export interface LedgerTransactionRecord {
  id: string;
  occurredOn: string;
  payee: string;
  memo: string | null;
  kind: "expense" | "income" | "transfer" | "debt_payment";
  status: "posted" | "reversed";
  amountPaise: number;
  accountId: string;
  accountName: string;
  destinationAccountId: string | null;
  destinationAccountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  splits: Array<{ categoryId: string; categoryName: string; amountPaise: number }>;
  origin: string;
  correctedFromId: string | null;
  canReverse: boolean;
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
  cashBalancePaise: number;
  cashBalanceSource: "bank_statement" | "calculated";
  cashBalanceAsOf: string | null;
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
  accounts: Array<{
    id: string;
    name: string;
    accountClass: "asset" | "liability";
    accountType: string;
  }>;
  categories: Array<{ id: string; name: string }>;
}

export interface ReverseTransactionInput {
  reason: string;
  idempotencyKey: string;
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
        .prepare(`
          SELECT id, name, account_class AS accountClass, account_type AS accountType
          FROM accounts
          WHERE account_class IN ('asset', 'liability') AND is_active = 1
          ORDER BY CASE account_class WHEN 'asset' THEN 0 ELSE 1 END, name
        `)
        .all() as ReferenceDataRecord["accounts"],
      categories: this.database.connection
        .prepare(`
          SELECT id, name
          FROM categories
          ORDER BY CASE broad_bucket
            WHEN 'regular' THEN 1
            WHEN 'nonbudget_expense' THEN 2
            WHEN 'debt_payment' THEN 3
            WHEN 'asset_building' THEN 4
            WHEN 'savings_investment' THEN 5
            ELSE 6
          END, name
        `)
        .all() as ReferenceDataRecord["categories"],
    };
  }

  getExpenseYear(year: string): ExpenseYearRecord {
    const spending = this.database.connection
      .prepare(`
        SELECT t.effective_month AS month,
               COALESCE(SUM(CASE WHEN a.account_class = 'expense' AND c.alert_eligible = 1 THEN p.amount_paise ELSE 0 END), 0) AS regularExpensePaise,
               COALESCE(SUM(CASE WHEN a.account_class = 'expense' AND c.broad_bucket NOT IN ('debt_payment', 'asset_building', 'savings_investment') THEN p.amount_paise ELSE 0 END), 0) AS totalExpensePaise,
               COALESCE(SUM(CASE
                 WHEN a.account_class = 'expense' THEN p.amount_paise
                 WHEN t.origin = 'manual_debt_payment' AND a.account_class = 'asset' AND p.amount_paise < 0
                   THEN -p.amount_paise
                 ELSE 0
               END), 0) AS cashOutflowPaise,
               COALESCE(SUM(CASE
                 WHEN a.account_class = 'expense' AND c.broad_bucket = 'debt_payment' THEN p.amount_paise
                 WHEN t.origin = 'manual_debt_payment' AND a.account_class = 'asset' AND p.amount_paise < 0
                   THEN -p.amount_paise
                 ELSE 0
               END), 0) AS debtPaymentPaise,
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
    const spendingByMonth = new Map(spending.map((item) => [item.month, item]));
    const budgets = new BudgetRepository(this.database);

    return {
      year,
      months: Array.from({ length: 12 }, (_, index) => {
        const month = `${year}-${String(index + 1).padStart(2, "0")}`;
        const regularExpensePaise = spendingByMonth.get(month)?.regularExpensePaise ?? 0;
        const totalExpensePaise = spendingByMonth.get(month)?.totalExpensePaise ?? 0;
        const cashOutflowPaise = spendingByMonth.get(month)?.cashOutflowPaise ?? 0;
        const debtPaymentPaise = spendingByMonth.get(month)?.debtPaymentPaise ?? 0;
        const assetBuildingPaise = spendingByMonth.get(month)?.assetBuildingPaise ?? 0;
        const regularBudgetPaise = budgets.getMonth(month).regularBudgetPaise;
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
    const totals = this.database.connection
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN a.account_class = 'income' THEN -p.amount_paise ELSE 0 END), 0) AS actualIncomePaise,
          COALESCE(SUM(CASE WHEN a.account_class = 'expense' AND c.alert_eligible = 1 THEN p.amount_paise ELSE 0 END), 0) AS regularExpensePaise,
          COALESCE(SUM(CASE WHEN a.account_class = 'expense' AND c.broad_bucket NOT IN ('debt_payment', 'asset_building', 'savings_investment') THEN p.amount_paise ELSE 0 END), 0) AS totalExpensePaise,
          COALESCE(SUM(CASE
            WHEN a.account_class = 'expense' THEN p.amount_paise
            WHEN t.origin = 'manual_debt_payment' AND a.account_class = 'asset' AND p.amount_paise < 0
              THEN -p.amount_paise
            ELSE 0
          END), 0) AS cashOutflowPaise,
          COALESCE(SUM(CASE
            WHEN a.account_class = 'expense' AND c.broad_bucket = 'debt_payment' THEN p.amount_paise
            WHEN t.origin = 'manual_debt_payment' AND a.account_class = 'asset' AND p.amount_paise < 0
              THEN -p.amount_paise
            ELSE 0
          END), 0) AS debtPaymentPaise,
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

    const budget = new BudgetRepository(this.database).getMonth(month);
    const plannedIncomePaise = budget.plannedIncomePaise;
    const regularBudgetPaise = budget.regularBudgetPaise;
    const cashBridge = budget.cashBridge;
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
      cashBalancePaise: cashBridge.closingBalancePaise,
      cashBalanceSource: "calculated",
      cashBalanceAsOf: null,
      budgetUsedPercentage,
      dangerAlert: localDay < 20 && budgetUsedPercentage >= 60,
      transactionCount: totals.transactionCount,
      categories,
      expenseCategories,
      snowballTarget: snowballTarget ?? null,
    };
  }

  listTransactions(month: string): LedgerTransactionRecord[] {
    const rows = this.database.connection
      .prepare(`
        SELECT t.id, t.occurred_on AS occurredOn, t.payee, t.memo, t.status, t.origin,
               t.source_ref AS sourceRef
        FROM journal_transactions t
        WHERE t.effective_month = ?
          AND t.origin NOT IN ('reversal', 'historical_aggregate', 'expense_sheet_aggregate')
        ORDER BY t.occurred_on DESC, t.created_at DESC
      `)
      .all(month) as TransactionRow[];
    return rows.map((row) => this.hydrateTransaction(row));
  }

  private getTransaction(id: string): LedgerTransactionRecord {
    const row = this.database.connection
      .prepare(`
        SELECT id, occurred_on AS occurredOn, payee, memo, status, origin, source_ref AS sourceRef
        FROM journal_transactions
        WHERE id = ? AND origin <> 'reversal'
      `)
      .get(id) as TransactionRow | undefined;
    if (!row) {
      throw new Error("Transaction does not exist.");
    }
    return this.hydrateTransaction(row);
  }

  private hydrateTransaction(row: TransactionRow): LedgerTransactionRecord {
    const postings = this.database.connection
      .prepare(`
        SELECT p.account_id AS accountId, a.name AS accountName, a.account_class AS accountClass,
               p.category_id AS categoryId, c.name AS categoryName, p.amount_paise AS amountPaise
        FROM postings p
        JOIN accounts a ON a.id = p.account_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.transaction_id = ?
        ORDER BY p.created_at, p.rowid
      `)
      .all(row.id) as PostingRow[];

    const expensePostings = postings.filter((posting) => posting.accountClass === "expense" && posting.amountPaise > 0);
    const incomePostings = postings.filter((posting) => posting.accountClass === "income" && posting.amountPaise < 0);
    const isTransfer = row.origin === "manual_transfer";
    const isDebtPayment = row.origin === "manual_debt_payment";
    const kind: LedgerTransactionRecord["kind"] = isTransfer
      ? "transfer"
      : isDebtPayment
        ? "debt_payment"
        : incomePostings.length > 0
          ? "income"
          : "expense";
    const sourcePosting =
      kind === "expense"
        ? postings.find(
            (posting) =>
              posting.accountClass !== "expense" && posting.accountClass !== "income" && posting.amountPaise < 0,
          )
        : kind === "income"
          ? postings.find(
              (posting) =>
                posting.accountClass !== "expense" && posting.accountClass !== "income" && posting.amountPaise > 0,
            )
          : postings.find((posting) => posting.amountPaise < 0);
    const destinationPosting =
      kind === "transfer" || kind === "debt_payment" ? postings.find((posting) => posting.amountPaise > 0) : undefined;
    if (!sourcePosting) {
      throw new Error(`Transaction ${row.id} does not have a usable account posting.`);
    }

    const splits = expensePostings
      .filter(
        (
          posting,
        ): posting is PostingRow & {
          categoryId: string;
          categoryName: string;
        } => Boolean(posting.categoryId && posting.categoryName),
      )
      .map((posting) => ({
        categoryId: posting.categoryId,
        categoryName: posting.categoryName,
        amountPaise: posting.amountPaise,
      }));
    const amountPaise =
      kind === "expense"
        ? row.origin === "project_spend"
          ? Math.abs(sourcePosting.amountPaise)
          : expensePostings.reduce((sum, posting) => sum + posting.amountPaise, 0)
        : kind === "income"
          ? incomePostings.reduce((sum, posting) => sum + Math.abs(posting.amountPaise), 0)
          : Math.abs(sourcePosting.amountPaise);

    return {
      id: row.id,
      occurredOn: row.occurredOn,
      payee: row.payee,
      memo: row.memo,
      kind,
      status: row.status,
      amountPaise,
      accountId: sourcePosting.accountId,
      accountName: sourcePosting.accountName,
      destinationAccountId: destinationPosting?.accountId ?? null,
      destinationAccountName: destinationPosting?.accountName ?? null,
      categoryId: splits.length === 1 ? (splits[0]?.categoryId ?? null) : null,
      categoryName: splits.length === 1 ? (splits[0]?.categoryName ?? null) : null,
      splits,
      origin: row.origin,
      correctedFromId: row.sourceRef && row.origin.startsWith("manual_") ? row.sourceRef : null,
      canReverse: row.status === "posted",
    };
  }

  private getIdempotentResponse(key: string, requestHash: string): LedgerTransactionRecord | null {
    const existing = this.database.connection
      .prepare("SELECT request_hash AS requestHash, response_json AS responseJson FROM idempotency_keys WHERE key = ?")
      .get(key) as { requestHash: string; responseJson: string } | undefined;

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new Error("Idempotency key was already used with a different request.");
      }
      return JSON.parse(existing.responseJson) as LedgerTransactionRecord;
    }
    return null;
  }

  private validateManualInput(input: ManualTransactionInput): {
    account: AccountRow;
    destination?: AccountRow;
    splits: Array<{ categoryId: string; categoryName: string; amountPaise: number }>;
  } {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new Error("Transaction amount must be a positive whole number of paise.");
    }
    const account = this.database.connection
      .prepare(`
        SELECT id, name, account_class AS accountClass
        FROM accounts
        WHERE id = ? AND account_class IN ('asset', 'liability') AND is_active = 1
      `)
      .get(input.accountId) as AccountRow | undefined;
    if (!account) {
      throw new Error("Selected account does not exist.");
    }

    const destination = input.destinationAccountId
      ? (this.database.connection
          .prepare(`
            SELECT id, name, account_class AS accountClass
            FROM accounts
            WHERE id = ? AND account_class IN ('asset', 'liability') AND is_active = 1
          `)
          .get(input.destinationAccountId) as AccountRow | undefined)
      : undefined;
    if (input.destinationAccountId && !destination) {
      throw new Error("Selected destination account does not exist.");
    }
    if (destination?.id === account.id) {
      throw new Error("Source and destination accounts must be different.");
    }
    if (input.kind === "income" && account.accountClass !== "asset") {
      throw new Error("Income must be received into an asset account.");
    }
    if (input.kind === "transfer" && (account.accountClass !== "asset" || destination?.accountClass !== "asset")) {
      throw new Error("Transfers require two asset accounts.");
    }
    if (
      input.kind === "debt_payment" &&
      (account.accountClass !== "asset" || destination?.accountClass !== "liability")
    ) {
      throw new Error("Debt payments require an asset source and liability destination.");
    }

    const rawSplits =
      input.splits ?? (input.categoryId ? [{ categoryId: input.categoryId, amountPaise: input.amountPaise }] : []);
    if (input.kind === "expense" && rawSplits.length === 0) {
      throw new Error("Expense transactions require a category or split lines.");
    }
    if (input.kind !== "expense" && rawSplits.length > 0) {
      throw new Error("Only expense transactions can use categories.");
    }
    if (
      rawSplits.reduce((sum, split) => sum + split.amountPaise, 0) !==
      (input.kind === "expense" ? input.amountPaise : 0)
    ) {
      throw new Error("Split lines must equal the transaction amount.");
    }
    const categories = new Map(
      rawSplits.map((split) => {
        const category = this.database.connection
          .prepare("SELECT id, name FROM categories WHERE id = ?")
          .get(split.categoryId) as { id: string; name: string } | undefined;
        if (!category) {
          throw new Error("Selected category does not exist.");
        }
        if (!Number.isSafeInteger(split.amountPaise) || split.amountPaise <= 0) {
          throw new Error("Split amounts must be positive whole numbers of paise.");
        }
        return [category.id, category.name] as const;
      }),
    );
    const splits = rawSplits.map((split) => ({
      ...split,
      categoryName: categories.get(split.categoryId) as string,
    }));

    return { account, destination, splits };
  }

  private insertManualTransaction(input: ManualTransactionInput, correctedFromId?: string): LedgerTransactionRecord {
    const { account, destination, splits } = this.validateManualInput(input);
    const id = randomUUID();
    const now = new Date().toISOString();
    const origin =
      input.kind === "transfer"
        ? "manual_transfer"
        : input.kind === "debt_payment"
          ? "manual_debt_payment"
          : input.kind === "income"
            ? "manual_income"
            : "manual_expense";
    const journalPostings: PostingInput[] =
      input.kind === "expense"
        ? [
            ...splits.map((split) => ({
              accountId: "account-regular-expense",
              accountClass: "expense" as const,
              amount: Money.fromPaise(BigInt(split.amountPaise)),
              categoryId: split.categoryId,
            })),
            {
              accountId: account.id,
              accountClass: account.accountClass,
              amount: Money.fromPaise(BigInt(-input.amountPaise)),
            },
          ]
        : input.kind === "income"
          ? [
              {
                accountId: "account-salary-income",
                accountClass: "income" as const,
                amount: Money.fromPaise(BigInt(-input.amountPaise)),
              },
              {
                accountId: account.id,
                accountClass: account.accountClass,
                amount: Money.fromPaise(BigInt(input.amountPaise)),
              },
            ]
          : [
              {
                accountId: account.id,
                accountClass: account.accountClass,
                amount: Money.fromPaise(BigInt(-input.amountPaise)),
              },
              {
                accountId: destination?.id as string,
                accountClass: destination?.accountClass as "asset" | "liability",
                amount: Money.fromPaise(BigInt(input.amountPaise)),
              },
            ];

    createJournalTransaction({
      id,
      occurredOn: input.occurredOn,
      payee: input.payee,
      memo: input.memo,
      postings: journalPostings,
    });

    this.database.connection
      .prepare(`
        INSERT INTO journal_transactions
          (id, occurred_on, effective_month, payee, memo, status, origin, source_ref, created_at)
        VALUES (?, ?, ?, ?, ?, 'posted', ?, ?, ?)
      `)
      .run(
        id,
        input.occurredOn,
        input.occurredOn.slice(0, 7),
        input.payee.trim(),
        input.memo?.trim() || null,
        origin,
        correctedFromId ?? null,
        now,
      );
    const insertPosting = this.database.connection.prepare(`
      INSERT INTO postings (id, transaction_id, account_id, category_id, amount_paise, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const posting of journalPostings) {
      insertPosting.run(
        randomUUID(),
        id,
        posting.accountId,
        posting.categoryId ?? null,
        Number(posting.amount.paise),
        now,
      );
    }
    const liabilityMovementAccount =
      input.kind === "debt_payment" && destination
        ? destination
        : input.kind === "expense" && account.accountClass === "liability"
          ? account
          : undefined;
    if (liabilityMovementAccount) {
      const debt = this.database.connection
        .prepare(`
          SELECT id, current_principal_paise AS currentPrincipalPaise
          FROM debts WHERE account_id = ?
        `)
        .get(liabilityMovementAccount.id) as { id: string; currentPrincipalPaise: number } | undefined;
      if (debt) {
        const nextPrincipal =
          input.kind === "debt_payment"
            ? Math.max(0, debt.currentPrincipalPaise - input.amountPaise)
            : debt.currentPrincipalPaise + input.amountPaise;
        this.database.connection
          .prepare("UPDATE debts SET current_principal_paise = ?, updated_at = ? WHERE id = ?")
          .run(nextPrincipal, now, debt.id);
        this.database.connection
          .prepare(`
            INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
            VALUES (?, ?, 'debt', ?, ?, ?)
          `)
          .run(
            randomUUID(),
            input.kind === "debt_payment" ? "debt.payment_posted" : "debt.card_purchase_posted",
            debt.id,
            JSON.stringify({
              transactionId: id,
              beforePrincipalPaise: debt.currentPrincipalPaise,
              afterPrincipalPaise: nextPrincipal,
            }),
            now,
          );
      }
    }
    this.database.connection
      .prepare(`
        INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
        VALUES (?, 'transaction.created', 'journal_transaction', ?, ?, ?)
      `)
      .run(
        randomUUID(),
        id,
        JSON.stringify({ origin, amountPaise: input.amountPaise, correctedFromId: correctedFromId ?? null }),
        now,
      );
    return this.getTransaction(id);
  }

  createManualTransaction(input: ManualTransactionInput): LedgerTransactionRecord {
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = this.getIdempotentResponse(input.idempotencyKey, requestHash);
    if (existing) {
      return existing;
    }

    let result: LedgerTransactionRecord | undefined;
    const write = this.database.connection.transaction(() => {
      result = this.insertManualTransaction(input);
      this.database.connection
        .prepare(`
          INSERT INTO idempotency_keys (key, request_hash, response_json, created_at)
          VALUES (?, ?, ?, ?)
        `)
        .run(input.idempotencyKey, requestHash, JSON.stringify(result), new Date().toISOString());
    });
    write.immediate();
    if (!result) {
      throw new Error("Transaction could not be created.");
    }
    return result;
  }

  createProjectSpendTransaction(input: ProjectSpendTransactionInput): LedgerTransactionRecord {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new Error("Project spend must be a positive whole number of paise.");
    }
    const source = this.database.connection
      .prepare(`
        SELECT id FROM accounts
        WHERE id = ? AND account_class = 'asset' AND is_active = 1
      `)
      .get(input.accountId) as { id: string } | undefined;
    if (!source) {
      throw new Error("Project spending requires an active asset account.");
    }

    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = this.getIdempotentResponse(input.idempotencyKey, requestHash);
    if (existing) {
      return existing;
    }

    let result: LedgerTransactionRecord | undefined;
    const write = this.database.connection.transaction(() => {
      const id = randomUUID();
      const now = new Date().toISOString();
      this.database.connection
        .prepare(`
          INSERT INTO journal_transactions
            (id, occurred_on, effective_month, payee, memo, status, origin, source_ref, created_at)
          VALUES (?, ?, ?, ?, ?, 'posted', 'project_spend', NULL, ?)
        `)
        .run(id, input.occurredOn, input.occurredOn.slice(0, 7), input.payee.trim(), input.memo?.trim() || null, now);
      this.database.connection
        .prepare(`
          INSERT INTO postings (id, transaction_id, account_id, category_id, amount_paise, created_at)
          VALUES (?, ?, ?, NULL, ?, ?),
                 (?, ?, 'account-home-construction-use', NULL, ?, ?)
        `)
        .run(randomUUID(), id, input.accountId, -input.amountPaise, now, randomUUID(), id, input.amountPaise, now);
      result = this.getTransaction(id);
      this.database.connection
        .prepare(`
          INSERT INTO idempotency_keys (key, request_hash, response_json, created_at)
          VALUES (?, ?, ?, ?)
        `)
        .run(input.idempotencyKey, requestHash, JSON.stringify(result), now);
      this.database.connection
        .prepare(`
          INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
          VALUES (?, 'project_spend.created', 'journal_transaction', ?, ?, ?)
        `)
        .run(randomUUID(), id, JSON.stringify({ amountPaise: input.amountPaise }), now);
    });
    write.immediate();
    if (!result) {
      throw new Error("Project spend transaction could not be created.");
    }
    return result;
  }

  reverseTransaction(id: string, input: ReverseTransactionInput): LedgerTransactionRecord {
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ id, ...input }))
      .digest("hex");
    const existingResponse = this.getIdempotentResponse(input.idempotencyKey, requestHash);
    if (existingResponse) {
      return existingResponse;
    }

    let result: LedgerTransactionRecord | undefined;
    const write = this.database.connection.transaction(() => {
      const existing = this.getTransaction(id);
      if (!existing.canReverse) {
        throw new Error("Only a posted transaction can be reversed.");
      }
      const now = new Date().toISOString();
      const reversalId = randomUUID();
      const postings = this.database.connection
        .prepare(
          "SELECT account_id AS accountId, category_id AS categoryId, amount_paise AS amountPaise FROM postings WHERE transaction_id = ?",
        )
        .all(id) as Array<{ accountId: string; categoryId: string | null; amountPaise: number }>;
      const total = postings.reduce((sum, posting) => sum + posting.amountPaise, 0);
      if (total !== 0) {
        throw new Error("The original transaction is not balanced and cannot be reversed.");
      }
      this.database.connection
        .prepare(`
          INSERT INTO journal_transactions
            (id, occurred_on, effective_month, payee, memo, status, origin, source_ref, created_at)
          VALUES (?, ?, ?, ?, ?, 'reversed', 'reversal', ?, ?)
        `)
        .run(
          reversalId,
          existing.occurredOn,
          existing.occurredOn.slice(0, 7),
          `Reversal: ${existing.payee}`,
          input.reason.trim(),
          id,
          now,
        );
      const insertPosting = this.database.connection.prepare(`
        INSERT INTO postings (id, transaction_id, account_id, category_id, amount_paise, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const posting of postings) {
        insertPosting.run(randomUUID(), reversalId, posting.accountId, posting.categoryId, -posting.amountPaise, now);
      }
      this.database.connection.prepare("UPDATE journal_transactions SET status = 'reversed' WHERE id = ?").run(id);

      if (existing.kind === "debt_payment" && existing.destinationAccountId) {
        const debt = this.database.connection
          .prepare("SELECT id, current_principal_paise AS currentPrincipalPaise FROM debts WHERE account_id = ?")
          .get(existing.destinationAccountId) as { id: string; currentPrincipalPaise: number } | undefined;
        if (debt) {
          const nextPrincipal = debt.currentPrincipalPaise + existing.amountPaise;
          this.database.connection
            .prepare("UPDATE debts SET current_principal_paise = ?, updated_at = ? WHERE id = ?")
            .run(nextPrincipal, now, debt.id);
          this.database.connection
            .prepare(`
              INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
              VALUES (?, 'debt.payment_reversed', 'debt', ?, ?, ?)
            `)
            .run(randomUUID(), debt.id, JSON.stringify({ transactionId: id, nextPrincipal }), now);
        }
      } else if (existing.kind === "expense") {
        const debt = this.database.connection
          .prepare("SELECT id, current_principal_paise AS currentPrincipalPaise FROM debts WHERE account_id = ?")
          .get(existing.accountId) as { id: string; currentPrincipalPaise: number } | undefined;
        if (debt) {
          const nextPrincipal = Math.max(0, debt.currentPrincipalPaise - existing.amountPaise);
          this.database.connection
            .prepare("UPDATE debts SET current_principal_paise = ?, updated_at = ? WHERE id = ?")
            .run(nextPrincipal, now, debt.id);
          this.database.connection
            .prepare(`
              INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
              VALUES (?, 'debt.card_purchase_reversed', 'debt', ?, ?, ?)
            `)
            .run(randomUUID(), debt.id, JSON.stringify({ transactionId: id, nextPrincipal }), now);
        }
      }
      this.database.connection
        .prepare(`
          INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
          VALUES (?, 'transaction.reversed', 'journal_transaction', ?, ?, ?)
        `)
        .run(randomUUID(), id, JSON.stringify({ reversalId, reason: input.reason.trim() }), now);
      result = this.getTransaction(id);
      this.database.connection
        .prepare(`
          INSERT INTO idempotency_keys (key, request_hash, response_json, created_at)
          VALUES (?, ?, ?, ?)
        `)
        .run(input.idempotencyKey, requestHash, JSON.stringify(result), now);
    });
    write.immediate();
    if (!result) {
      throw new Error("Transaction could not be reversed.");
    }
    return result;
  }

  replaceTransaction(id: string, input: ManualTransactionInput): LedgerTransactionRecord {
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ id, ...input }))
      .digest("hex");
    const existingResponse = this.getIdempotentResponse(input.idempotencyKey, requestHash);
    if (existingResponse) {
      return existingResponse;
    }

    let replacement: LedgerTransactionRecord | undefined;
    const write = this.database.connection.transaction(() => {
      this.reverseTransaction(id, {
        reason: "Corrected with a replacement transaction.",
        idempotencyKey: `${input.idempotencyKey}:reverse`,
      });
      replacement = this.insertManualTransaction(input, id);
      const now = new Date().toISOString();
      this.database.connection
        .prepare(`
          INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
          VALUES (?, 'transaction.replaced', 'journal_transaction', ?, ?, ?)
        `)
        .run(randomUUID(), id, JSON.stringify({ replacementId: replacement.id }), now);
      this.database.connection
        .prepare(`
          INSERT INTO idempotency_keys (key, request_hash, response_json, created_at)
          VALUES (?, ?, ?, ?)
        `)
        .run(input.idempotencyKey, requestHash, JSON.stringify(replacement), now);
    });
    write.immediate();
    if (!replacement) {
      throw new Error("Transaction could not be replaced.");
    }
    return replacement;
  }
}

interface TransactionRow {
  id: string;
  occurredOn: string;
  payee: string;
  memo: string | null;
  status: "posted" | "reversed";
  origin: string;
  sourceRef: string | null;
}

interface PostingRow {
  accountId: string;
  accountName: string;
  accountClass: "asset" | "liability" | "income" | "expense" | "equity";
  categoryId: string | null;
  categoryName: string | null;
  amountPaise: number;
}

interface AccountRow {
  id: string;
  name: string;
  accountClass: "asset" | "liability";
}
