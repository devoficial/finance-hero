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
  regularBudgetPaise: number;
  totalEmiPaise: number;
  debtPrincipalPaise: number;
  availableAfterPlanPaise: number;
  budgetUsedPercentage: number;
  dangerAlert: boolean;
  transactionCount: number;
  categories: Array<{ id: string; name: string; amountPaise: number }>;
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

export class LedgerRepository {
  constructor(private readonly database: FinanceHeroDatabase) {}

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
          COUNT(DISTINCT t.id) AS transactionCount
        FROM journal_transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE t.effective_month = ? AND t.status = 'posted'
      `)
      .get(month) as { actualIncomePaise: number; regularExpensePaise: number; transactionCount: number };

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
      regularBudgetPaise,
      totalEmiPaise: debtTotals.totalEmiPaise,
      debtPrincipalPaise: debtTotals.debtPrincipalPaise,
      availableAfterPlanPaise: plannedIncomePaise - totals.regularExpensePaise - debtTotals.totalEmiPaise,
      budgetUsedPercentage,
      dangerAlert: localDay < 20 && budgetUsedPercentage >= 60,
      transactionCount: totals.transactionCount,
      categories,
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
