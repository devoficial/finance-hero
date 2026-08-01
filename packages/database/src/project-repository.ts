import { randomUUID } from "node:crypto";
import type { FinanceHeroDatabase } from "./encrypted-database";
import type { LedgerRepository } from "./ledger-repository";

const HOME_CONSTRUCTION_ID = "project-home-construction";

export interface ProjectExpenseRecord {
  id: string;
  occurredOn: string;
  description: string;
  amountPaise: number;
  runningBalancePaise: number | null;
  includedInActual: boolean;
  reviewStatus: "confirmed" | "needs_review";
  linkedTransactionId: string | null;
  source: "imported" | "manual";
}

export interface ProjectCommitmentRecord {
  id: string;
  vendorName: string;
  estimatedPaise: number;
  pendingPaise: number;
  status: "open" | "settled" | "unknown";
}

export interface ProjectSummaryRecord {
  id: string;
  name: string;
  status: "active" | "completed" | "on_hold";
  freshness: "current" | "needs_update";
  sourceExpensePaise: number;
  actualExpensePaise: number;
  excludedPaise: number;
  commitmentEstimatePaise: number;
  pendingCommitmentPaise: number;
  fundBalancePaise: number;
  forecastPaise: number;
  latestExpenseOn: string | null;
  needsReviewCount: number;
  monthlySpend: Array<{ month: string; amountPaise: number }>;
  expenses: ProjectExpenseRecord[];
  commitments: ProjectCommitmentRecord[];
}

export interface CreateProjectExpenseInput {
  occurredOn: string;
  description: string;
  amountPaise: number;
  accountId: string;
  idempotencyKey: string;
}

export interface UpdateProjectExpenseInput {
  description?: string;
  includedInActual?: boolean;
  reviewStatus?: "confirmed" | "needs_review";
}

export interface CreateProjectCommitmentInput {
  vendorName: string;
  estimatedPaise: number;
  pendingPaise: number;
  status: "open" | "settled" | "unknown";
}

export interface UpdateProjectCommitmentInput {
  vendorName?: string;
  estimatedPaise?: number;
  pendingPaise?: number;
  status?: "open" | "settled" | "unknown";
}

export class ProjectRepository {
  constructor(
    private readonly database: FinanceHeroDatabase,
    private readonly ledger: LedgerRepository,
  ) {}

  getHomeConstruction(): ProjectSummaryRecord {
    const project = this.database.connection
      .prepare(`
        SELECT id, name, status, freshness
        FROM projects WHERE id = ?
      `)
      .get(HOME_CONSTRUCTION_ID) as
      | {
          id: string;
          name: string;
          status: ProjectSummaryRecord["status"];
          freshness: ProjectSummaryRecord["freshness"];
        }
      | undefined;
    if (!project) {
      throw new Error("Home Construction project does not exist.");
    }

    const expenses = this.database.connection
      .prepare(`
        SELECT id, occurred_on AS occurredOn, description, amount_paise AS amountPaise,
               running_balance_paise AS runningBalancePaise,
               included_in_actual AS includedInActual, review_status AS reviewStatus,
               linked_transaction_id AS linkedTransactionId,
               CASE WHEN linked_transaction_id IS NULL THEN 'imported' ELSE 'manual' END AS source
        FROM project_expenses
        WHERE project_id = ?
        ORDER BY occurred_on DESC, created_at DESC, id DESC
      `)
      .all(HOME_CONSTRUCTION_ID)
      .map((row) => {
        const expense = row as Omit<ProjectExpenseRecord, "includedInActual"> & { includedInActual: number };
        return { ...expense, includedInActual: expense.includedInActual === 1 };
      });
    const commitments = this.database.connection
      .prepare(`
        SELECT id, vendor_name AS vendorName, estimated_paise AS estimatedPaise,
               pending_paise AS pendingPaise, status
        FROM project_commitments
        WHERE project_id = ?
        ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,
                 pending_paise DESC, vendor_name
      `)
      .all(HOME_CONSTRUCTION_ID) as ProjectCommitmentRecord[];
    const sourceExpensePaise = expenses.reduce((sum, expense) => sum + expense.amountPaise, 0);
    const actualExpensePaise = expenses
      .filter((expense) => expense.includedInActual)
      .reduce((sum, expense) => sum + expense.amountPaise, 0);
    const commitmentEstimatePaise = commitments.reduce((sum, item) => sum + item.estimatedPaise, 0);
    const pendingCommitmentPaise = commitments.reduce((sum, item) => sum + item.pendingPaise, 0);
    const monthlySpendMap = new Map<string, number>();
    for (const expense of expenses) {
      if (expense.includedInActual) {
        const month = expense.occurredOn.slice(0, 7);
        monthlySpendMap.set(month, (monthlySpendMap.get(month) ?? 0) + expense.amountPaise);
      }
    }
    const fundBalance = this.database.connection
      .prepare(`
        SELECT MAX(0, ap.baseline_value_paise + COALESCE((
          SELECT SUM(p.amount_paise)
          FROM postings p
          JOIN journal_transactions t ON t.id = p.transaction_id
          WHERE p.account_id = ap.account_id AND t.status IN ('posted', 'reversed')
            AND t.created_at > ap.valued_at
        ), 0)) AS amountPaise
        FROM asset_positions ap
        WHERE ap.account_id = 'account-savings'
      `)
      .get() as { amountPaise: number } | undefined;

    return {
      ...project,
      sourceExpensePaise,
      actualExpensePaise,
      excludedPaise: sourceExpensePaise - actualExpensePaise,
      commitmentEstimatePaise,
      pendingCommitmentPaise,
      fundBalancePaise: fundBalance?.amountPaise ?? 0,
      forecastPaise: actualExpensePaise + pendingCommitmentPaise,
      latestExpenseOn: expenses[0]?.occurredOn ?? null,
      needsReviewCount: expenses.filter((expense) => expense.reviewStatus === "needs_review").length,
      monthlySpend: Array.from(monthlySpendMap, ([month, amountPaise]) => ({ month, amountPaise })).sort(
        (left, right) => left.month.localeCompare(right.month),
      ),
      expenses,
      commitments,
    };
  }

  createExpense(input: CreateProjectExpenseInput): ProjectExpenseRecord {
    let created: ProjectExpenseRecord | undefined;
    const write = this.database.connection.transaction(() => {
      const transaction = this.ledger.createProjectSpendTransaction({
        occurredOn: input.occurredOn,
        payee: input.description,
        memo: "Home Construction project expense",
        amountPaise: input.amountPaise,
        accountId: input.accountId,
        idempotencyKey: input.idempotencyKey,
      });
      const existing = this.database.connection
        .prepare("SELECT id FROM project_expenses WHERE linked_transaction_id = ?")
        .get(transaction.id) as { id: string } | undefined;
      if (existing) {
        created = this.findExpense(existing.id);
        return;
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      this.database.connection
        .prepare(`
          INSERT INTO project_expenses
            (id, project_id, occurred_on, description, amount_paise, running_balance_paise,
             included_in_actual, review_status, linked_transaction_id, source_ref, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NULL, 1, 'confirmed', ?, 'manual', ?, ?)
        `)
        .run(
          id,
          HOME_CONSTRUCTION_ID,
          input.occurredOn,
          input.description.trim(),
          input.amountPaise,
          transaction.id,
          now,
          now,
        );
      this.audit("project_expense.created", "project_expense", id, { transactionId: transaction.id }, now);
      created = this.findExpense(id);
    });
    write.immediate();
    if (!created) {
      throw new Error("Project expense could not be created.");
    }
    return created;
  }

  updateExpense(id: string, input: UpdateProjectExpenseInput): ProjectExpenseRecord {
    const existing = this.findExpense(id);
    if (existing.linkedTransactionId && input.includedInActual === false) {
      throw new Error("Reverse the linked ledger transaction instead of excluding a manual expense.");
    }
    if (existing.linkedTransactionId && input.description && input.description.trim() !== existing.description) {
      throw new Error("Correct the linked ledger transaction instead of renaming a manual expense.");
    }
    const next = {
      description: input.description?.trim() ?? existing.description,
      includedInActual: input.includedInActual ?? existing.includedInActual,
      reviewStatus: input.reviewStatus ?? existing.reviewStatus,
    };
    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          UPDATE project_expenses
          SET description = ?, included_in_actual = ?, review_status = ?, updated_at = ?
          WHERE id = ? AND project_id = ?
        `)
        .run(next.description, next.includedInActual ? 1 : 0, next.reviewStatus, now, id, HOME_CONSTRUCTION_ID);
      this.audit("project_expense.updated", "project_expense", id, { before: existing, after: next }, now);
    });
    write.immediate();
    return this.findExpense(id);
  }

  createCommitment(input: CreateProjectCommitmentInput): ProjectCommitmentRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          INSERT INTO project_commitments
            (id, project_id, vendor_name, estimated_paise, pending_paise, status, source_ref, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)
        `)
        .run(
          id,
          HOME_CONSTRUCTION_ID,
          input.vendorName.trim(),
          input.estimatedPaise,
          input.pendingPaise,
          input.status,
          now,
        );
      this.audit("project_commitment.created", "project_commitment", id, input, now);
    });
    write.immediate();
    return this.findCommitment(id);
  }

  updateCommitment(id: string, input: UpdateProjectCommitmentInput): ProjectCommitmentRecord {
    const existing = this.findCommitment(id);
    const next = {
      vendorName: input.vendorName?.trim() ?? existing.vendorName,
      estimatedPaise: input.estimatedPaise ?? existing.estimatedPaise,
      pendingPaise: input.pendingPaise ?? existing.pendingPaise,
      status: input.status ?? existing.status,
    };
    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          UPDATE project_commitments
          SET vendor_name = ?, estimated_paise = ?, pending_paise = ?, status = ?, updated_at = ?
          WHERE id = ? AND project_id = ?
        `)
        .run(next.vendorName, next.estimatedPaise, next.pendingPaise, next.status, now, id, HOME_CONSTRUCTION_ID);
      this.audit("project_commitment.updated", "project_commitment", id, { before: existing, after: next }, now);
    });
    write.immediate();
    return this.findCommitment(id);
  }

  private findExpense(id: string): ProjectExpenseRecord {
    const row = this.database.connection
      .prepare(`
        SELECT id, occurred_on AS occurredOn, description, amount_paise AS amountPaise,
               running_balance_paise AS runningBalancePaise,
               included_in_actual AS includedInActual, review_status AS reviewStatus,
               linked_transaction_id AS linkedTransactionId,
               CASE WHEN linked_transaction_id IS NULL THEN 'imported' ELSE 'manual' END AS source
        FROM project_expenses WHERE id = ? AND project_id = ?
      `)
      .get(id, HOME_CONSTRUCTION_ID) as
      | (Omit<ProjectExpenseRecord, "includedInActual"> & { includedInActual: number })
      | undefined;
    if (!row) {
      throw new Error("Project expense does not exist.");
    }
    return { ...row, includedInActual: row.includedInActual === 1 };
  }

  private findCommitment(id: string): ProjectCommitmentRecord {
    const row = this.database.connection
      .prepare(`
        SELECT id, vendor_name AS vendorName, estimated_paise AS estimatedPaise,
               pending_paise AS pendingPaise, status
        FROM project_commitments WHERE id = ? AND project_id = ?
      `)
      .get(id, HOME_CONSTRUCTION_ID) as ProjectCommitmentRecord | undefined;
    if (!row) {
      throw new Error("Project commitment does not exist.");
    }
    return row;
  }

  private audit(action: string, entityType: string, entityId: string, detail: unknown, createdAt: string): void {
    this.database.connection
      .prepare(`
        INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(randomUUID(), action, entityType, entityId, JSON.stringify(detail), createdAt);
  }
}
