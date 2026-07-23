import { randomUUID } from "node:crypto";
import type { FinanceHeroDatabase } from "./encrypted-database";

export interface FinancialAccountRecord {
  id: string;
  name: string;
  accountClass: "asset" | "liability";
  accountType: string;
  institution: string | null;
  isActive: boolean;
  balancePaise: number;
  transactionCount: number;
  managedBy: "ledger" | "wealth" | "liability";
  restricted: boolean;
}

export interface FinancialAccountsRecord {
  accounts: FinancialAccountRecord[];
  totalAssetBalancePaise: number;
  totalLiabilityBalancePaise: number;
}

export interface CreateFinancialAccountInput {
  name: string;
  accountType: "bank" | "cash" | "savings" | "investment" | "wallet" | "other";
  institution?: string | null;
  openingBalancePaise: number;
  restricted: boolean;
}

export interface UpdateFinancialAccountInput {
  name?: string;
  institution?: string | null;
  isActive?: boolean;
}

export class AccountRepository {
  constructor(private readonly database: FinanceHeroDatabase) {}

  getAccounts(): FinancialAccountsRecord {
    const accounts = this.database.connection
      .prepare(`
        SELECT
          a.id,
          a.name,
          a.account_class AS accountClass,
          a.account_type AS accountType,
          a.institution,
          a.is_active AS isActive,
          CASE
            WHEN d.id IS NOT NULL THEN d.current_principal_paise
            WHEN ap.id IS NOT NULL THEN MAX(0, ap.baseline_value_paise + COALESCE((
              SELECT SUM(p.amount_paise)
              FROM postings p
              JOIN journal_transactions t ON t.id = p.transaction_id
              WHERE p.account_id = a.id
                AND t.status IN ('posted', 'reversed')
                AND t.created_at > ap.valued_at
            ), 0))
            ELSE COALESCE((
              SELECT SUM(p.amount_paise)
              FROM postings p
              JOIN journal_transactions t ON t.id = p.transaction_id
              WHERE p.account_id = a.id AND t.status = 'posted'
            ), 0)
          END AS balancePaise,
          COALESCE((
            SELECT COUNT(DISTINCT p.transaction_id)
            FROM postings p
            JOIN journal_transactions t ON t.id = p.transaction_id
            WHERE p.account_id = a.id AND t.status IN ('posted', 'reversed')
          ), 0) AS transactionCount,
          CASE WHEN d.id IS NOT NULL THEN 'liability'
               WHEN ap.id IS NOT NULL THEN 'wealth'
               ELSE 'ledger'
          END AS managedBy,
          COALESCE(ap.restricted, 0) AS restricted
        FROM accounts a
        LEFT JOIN debts d ON d.account_id = a.id
        LEFT JOIN asset_positions ap ON ap.account_id = a.id
        WHERE a.account_class IN ('asset', 'liability')
        ORDER BY a.is_active DESC, a.account_class, a.name
      `)
      .all()
      .map((row) => {
        const item = row as Omit<FinancialAccountRecord, "isActive" | "restricted"> & {
          isActive: number;
          restricted: number;
        };
        return { ...item, isActive: item.isActive === 1, restricted: item.restricted === 1 };
      });

    return {
      accounts,
      totalAssetBalancePaise: accounts
        .filter((account) => account.accountClass === "asset")
        .reduce((sum, account) => sum + account.balancePaise, 0),
      totalLiabilityBalancePaise: accounts
        .filter((account) => account.accountClass === "liability")
        .reduce((sum, account) => sum + account.balancePaise, 0),
    };
  }

  createAccount(input: CreateFinancialAccountInput): FinancialAccountRecord {
    const id = `account-${randomUUID()}`;
    const assetId = `asset-${randomUUID()}`;
    const now = new Date().toISOString();
    const asOfDate = now.slice(0, 10);
    const assetType =
      input.accountType === "investment" ? "investment" : input.restricted ? "restricted_wallet" : "savings";

    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          INSERT INTO accounts
            (id, name, account_class, account_type, institution, is_active, created_at)
          VALUES (?, ?, 'asset', ?, ?, 1, ?)
        `)
        .run(id, input.name, input.accountType, input.institution ?? null, now);
      this.database.connection
        .prepare(`
          INSERT INTO asset_positions
            (id, account_id, asset_type, baseline_value_paise, monthly_contribution_paise,
             restricted, as_of_date, valued_at, source_ref, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'manual account opening balance', ?)
        `)
        .run(assetId, id, assetType, input.openingBalancePaise, input.restricted ? 1 : 0, asOfDate, now, now);
      this.insertAudit("account.created", id, { after: input }, now);
    });
    write.immediate();
    return this.requireAccount(id);
  }

  updateAccount(id: string, input: UpdateFinancialAccountInput): FinancialAccountRecord {
    const existing = this.requireAccount(id);
    if (input.isActive === false && existing.balancePaise !== 0) {
      throw new Error(
        existing.managedBy === "liability"
          ? "Clear the linked liability before deactivating this account."
          : "Move or reconcile the remaining balance before deactivating this account.",
      );
    }
    const next = {
      name: input.name ?? existing.name,
      institution: input.institution === undefined ? existing.institution : input.institution,
      isActive: input.isActive ?? existing.isActive,
    };
    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare("UPDATE accounts SET name = ?, institution = ?, is_active = ? WHERE id = ?")
        .run(next.name, next.institution, next.isActive ? 1 : 0, id);
      if (existing.managedBy === "liability") {
        this.database.connection
          .prepare("UPDATE debts SET lender = ?, updated_at = ? WHERE account_id = ?")
          .run(next.name, now, id);
      }
      this.insertAudit("account.updated", id, { before: existing, after: next }, now);
    });
    write.immediate();
    return this.requireAccount(id);
  }

  private requireAccount(id: string): FinancialAccountRecord {
    const account = this.getAccounts().accounts.find((item) => item.id === id);
    if (!account) {
      throw new Error("Financial account does not exist.");
    }
    return account;
  }

  private insertAudit(action: string, entityId: string, detail: unknown, createdAt: string): void {
    this.database.connection
      .prepare(`
        INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
        VALUES (?, ?, 'account', ?, ?, ?)
      `)
      .run(randomUUID(), action, entityId, JSON.stringify(detail), createdAt);
  }
}
