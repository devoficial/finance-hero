import { randomUUID } from "node:crypto";
import type { FinanceHeroDatabase } from "./encrypted-database";

export type WealthAssetType = "savings" | "investment" | "emergency_fund" | "restricted_wallet";
export type FinancialGoalStatus = "active" | "achieved" | "paused";

export interface WealthAssetRecord {
  id: string;
  accountId: string;
  name: string;
  assetType: WealthAssetType;
  institution: string | null;
  currentValuePaise: number;
  monthlyContributionPaise: number;
  allocatedPaise: number;
  availablePaise: number;
  restricted: boolean;
  asOfDate: string;
}

export interface FinancialGoalRecord {
  id: string;
  name: string;
  targetPaise: number;
  targetDate: string | null;
  priority: number;
  status: FinancialGoalStatus;
  monthlyContributionPaise: number;
  notes: string | null;
  allocatedPaise: number;
  remainingPaise: number;
  progressPercentage: number;
  forecastDate: string | null;
  onTrack: boolean | null;
  allocations: Array<{ assetId: string; assetName: string; amountPaise: number }>;
}

export interface WealthRecord {
  totalAssetPaise: number;
  savingsPaise: number;
  investmentPaise: number;
  restrictedWalletPaise: number;
  allocatablePaise: number;
  allocatedPaise: number;
  debtPaise: number;
  receivablePaise: number;
  netWorthPaise: number;
  monthlyContributionPaise: number;
  assets: WealthAssetRecord[];
  goals: FinancialGoalRecord[];
}

export interface CreateWealthAssetInput {
  name: string;
  assetType: WealthAssetType;
  institution?: string | null;
  currentValuePaise: number;
  monthlyContributionPaise: number;
  restricted: boolean;
  asOfDate: string;
}

export type UpdateWealthAssetInput = Partial<CreateWealthAssetInput>;

export interface CreateFinancialGoalInput {
  name: string;
  targetPaise: number;
  targetDate?: string | null;
  priority: number;
  status?: FinancialGoalStatus;
  monthlyContributionPaise: number;
  notes?: string | null;
}

export type UpdateFinancialGoalInput = Partial<CreateFinancialGoalInput>;

interface StoredAssetRow {
  id: string;
  accountId: string;
  name: string;
  assetType: WealthAssetType;
  institution: string | null;
  baselineValuePaise: number;
  movementPaise: number;
  monthlyContributionPaise: number;
  allocatedPaise: number;
  restricted: number;
  asOfDate: string;
  valuedAt: string;
}

function addMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

function currentLocalDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

export class WealthRepository {
  constructor(private readonly database: FinanceHeroDatabase) {}

  getWealth(today = currentLocalDate()): WealthRecord {
    const assets = this.listAssets();
    const goals = this.listGoals(assets, today);
    const totalAssetPaise = assets.reduce((sum, asset) => sum + asset.currentValuePaise, 0);
    const savingsPaise = assets
      .filter((asset) => asset.assetType === "savings" || asset.assetType === "emergency_fund")
      .reduce((sum, asset) => sum + asset.currentValuePaise, 0);
    const investmentPaise = assets
      .filter((asset) => asset.assetType === "investment")
      .reduce((sum, asset) => sum + asset.currentValuePaise, 0);
    const restrictedWalletPaise = assets
      .filter((asset) => asset.restricted)
      .reduce((sum, asset) => sum + asset.currentValuePaise, 0);
    const allocatedPaise = assets.reduce((sum, asset) => sum + asset.allocatedPaise, 0);
    const allocatablePaise = assets.reduce((sum, asset) => sum + asset.availablePaise, 0);
    const monthlyContributionPaise = assets.reduce((sum, asset) => sum + asset.monthlyContributionPaise, 0);
    const debt = this.database.connection
      .prepare(`
        SELECT
          COALESCE((SELECT SUM(current_principal_paise) FROM debts WHERE status = 'active'), 0) +
          COALESCE((SELECT SUM(amount_paise) FROM personal_balances
                    WHERE direction = 'payable' AND status = 'open'), 0) AS debtPaise,
          COALESCE((SELECT SUM(amount_paise) FROM personal_balances
                    WHERE direction = 'receivable' AND status = 'open'), 0) AS receivablePaise
      `)
      .get() as { debtPaise: number; receivablePaise: number };

    return {
      totalAssetPaise,
      savingsPaise,
      investmentPaise,
      restrictedWalletPaise,
      allocatablePaise,
      allocatedPaise,
      debtPaise: debt.debtPaise,
      receivablePaise: debt.receivablePaise,
      netWorthPaise: totalAssetPaise + debt.receivablePaise - debt.debtPaise,
      monthlyContributionPaise,
      assets,
      goals,
    };
  }

  createAsset(input: CreateWealthAssetInput): WealthAssetRecord {
    if (input.assetType === "restricted_wallet" && !input.restricted) {
      throw new Error("Restricted wallets must remain restricted.");
    }
    const id = `asset-${randomUUID()}`;
    const accountId = `account-${randomUUID()}`;
    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          INSERT INTO accounts
            (id, name, account_class, account_type, institution, is_active, created_at)
          VALUES (?, ?, 'asset', ?, ?, 1, ?)
        `)
        .run(accountId, input.name, input.assetType, input.institution ?? null, now);
      this.database.connection
        .prepare(`
          INSERT INTO asset_positions
            (id, account_id, asset_type, baseline_value_paise, monthly_contribution_paise,
             restricted, as_of_date, valued_at, source_ref, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual asset valuation', ?)
        `)
        .run(
          id,
          accountId,
          input.assetType,
          input.currentValuePaise,
          input.monthlyContributionPaise,
          input.restricted ? 1 : 0,
          input.asOfDate,
          now,
          now,
        );
      this.insertAudit("wealth_asset.created", "asset_position", id, { after: input }, now);
    });
    write.immediate();
    return this.requireAsset(id);
  }

  updateAsset(id: string, input: UpdateWealthAssetInput): WealthAssetRecord {
    const existing = this.requireStoredAsset(id);
    const next = {
      name: input.name ?? existing.name,
      assetType: input.assetType ?? existing.assetType,
      institution: input.institution === undefined ? existing.institution : input.institution,
      currentValuePaise: input.currentValuePaise ?? Math.max(0, existing.baselineValuePaise + existing.movementPaise),
      monthlyContributionPaise: input.monthlyContributionPaise ?? existing.monthlyContributionPaise,
      restricted: input.restricted ?? existing.restricted === 1,
      asOfDate: input.asOfDate ?? existing.asOfDate,
    };
    if (next.assetType === "restricted_wallet" && !next.restricted) {
      throw new Error("Restricted wallets must remain restricted.");
    }
    if (next.restricted && existing.allocatedPaise > 0) {
      throw new Error("Remove this asset's goal allocations before restricting it.");
    }
    if (next.currentValuePaise < existing.allocatedPaise) {
      throw new Error("Asset value cannot be lower than its active goal allocations.");
    }

    const now = new Date().toISOString();
    const resetValuation = input.currentValuePaise !== undefined;
    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare("UPDATE accounts SET name = ?, account_type = ?, institution = ? WHERE id = ?")
        .run(next.name, next.assetType, next.institution, existing.accountId);
      this.database.connection
        .prepare(`
          UPDATE asset_positions
          SET asset_type = ?, baseline_value_paise = ?, monthly_contribution_paise = ?,
              restricted = ?, as_of_date = ?, valued_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          next.assetType,
          resetValuation ? next.currentValuePaise : existing.baselineValuePaise,
          next.monthlyContributionPaise,
          next.restricted ? 1 : 0,
          next.asOfDate,
          resetValuation ? now : existing.valuedAt,
          now,
          id,
        );
      this.insertAudit("wealth_asset.updated", "asset_position", id, { before: existing, after: next }, now);
    });
    write.immediate();
    return this.requireAsset(id);
  }

  createGoal(input: CreateFinancialGoalInput, today = currentLocalDate()): FinancialGoalRecord {
    const id = `goal-${randomUUID()}`;
    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          INSERT INTO financial_goals
            (id, name, target_paise, target_date, priority, status, monthly_contribution_paise,
             notes, source_ref, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual financial goal', ?, ?)
        `)
        .run(
          id,
          input.name,
          input.targetPaise,
          input.targetDate ?? null,
          input.priority,
          input.status ?? "active",
          input.monthlyContributionPaise,
          input.notes ?? null,
          now,
          now,
        );
      this.insertAudit("financial_goal.created", "financial_goal", id, { after: input }, now);
    });
    write.immediate();
    return this.requireGoal(id, today);
  }

  updateGoal(id: string, input: UpdateFinancialGoalInput, today = currentLocalDate()): FinancialGoalRecord {
    const existing = this.requireGoal(id, today);
    const next = {
      name: input.name ?? existing.name,
      targetPaise: input.targetPaise ?? existing.targetPaise,
      targetDate: input.targetDate === undefined ? existing.targetDate : input.targetDate,
      priority: input.priority ?? existing.priority,
      status: input.status ?? existing.status,
      monthlyContributionPaise: input.monthlyContributionPaise ?? existing.monthlyContributionPaise,
      notes: input.notes === undefined ? existing.notes : input.notes,
    };
    if (next.targetPaise < existing.allocatedPaise) {
      throw new Error("Goal target cannot be lower than its allocated savings.");
    }
    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          UPDATE financial_goals
          SET name = ?, target_paise = ?, target_date = ?, priority = ?, status = ?,
              monthly_contribution_paise = ?, notes = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          next.name,
          next.targetPaise,
          next.targetDate,
          next.priority,
          next.status,
          next.monthlyContributionPaise,
          next.notes,
          now,
          id,
        );
      this.insertAudit("financial_goal.updated", "financial_goal", id, { before: existing, after: next }, now);
    });
    write.immediate();
    return this.requireGoal(id, today);
  }

  updateGoalAllocations(
    goalId: string,
    allocations: Array<{ assetId: string; amountPaise: number }>,
    today = currentLocalDate(),
  ): FinancialGoalRecord {
    const goal = this.requireGoal(goalId, today);
    const uniqueIds = new Set(allocations.map((allocation) => allocation.assetId));
    if (uniqueIds.size !== allocations.length) {
      throw new Error("Each asset can be allocated to a goal only once.");
    }
    if (allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0) > goal.targetPaise) {
      throw new Error("Goal allocations cannot exceed the goal target.");
    }

    const assets = new Map(this.listAssets().map((asset) => [asset.id, asset]));
    for (const allocation of allocations) {
      const asset = assets.get(allocation.assetId);
      if (!asset) {
        throw new Error("Goal allocation asset does not exist.");
      }
      if (asset.restricted && allocation.amountPaise > 0) {
        throw new Error("Restricted wallets cannot fund financial goals.");
      }
      const allocationToOtherGoals =
        asset.allocatedPaise - (goal.allocations.find((item) => item.assetId === asset.id)?.amountPaise ?? 0);
      if (allocationToOtherGoals + allocation.amountPaise > asset.currentValuePaise) {
        throw new Error(`${asset.name} does not have enough unallocated value.`);
      }
    }

    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      this.database.connection.prepare("DELETE FROM goal_allocations WHERE goal_id = ?").run(goalId);
      const insert = this.database.connection.prepare(`
        INSERT INTO goal_allocations
          (goal_id, asset_position_id, amount_paise, effective_date, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const allocation of allocations.filter((item) => item.amountPaise > 0)) {
        insert.run(goalId, allocation.assetId, allocation.amountPaise, today, now);
      }
      const allocatedPaise = allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0);
      const status =
        allocatedPaise >= goal.targetPaise ? "achieved" : goal.status === "achieved" ? "active" : goal.status;
      this.database.connection
        .prepare("UPDATE financial_goals SET status = ?, updated_at = ? WHERE id = ?")
        .run(status, now, goalId);
      this.insertAudit(
        "financial_goal.allocations_updated",
        "financial_goal",
        goalId,
        { before: goal.allocations, after: allocations },
        now,
      );
    });
    write.immediate();
    return this.requireGoal(goalId, today);
  }

  private listAssets(): WealthAssetRecord[] {
    return this.storedAssets().map((asset) => ({
      id: asset.id,
      accountId: asset.accountId,
      name: asset.name,
      assetType: asset.assetType,
      institution: asset.institution,
      currentValuePaise: Math.max(0, asset.baselineValuePaise + asset.movementPaise),
      monthlyContributionPaise: asset.monthlyContributionPaise,
      allocatedPaise: asset.allocatedPaise,
      availablePaise: asset.restricted
        ? 0
        : Math.max(0, asset.baselineValuePaise + asset.movementPaise - asset.allocatedPaise),
      restricted: asset.restricted === 1,
      asOfDate: asset.asOfDate,
    }));
  }

  private storedAssets(): StoredAssetRow[] {
    return this.database.connection
      .prepare(`
        SELECT ap.id, ap.account_id AS accountId, a.name, ap.asset_type AS assetType,
               a.institution, ap.baseline_value_paise AS baselineValuePaise,
               COALESCE(SUM(CASE
                 WHEN t.status IN ('posted', 'reversed') AND t.created_at > ap.valued_at THEN p.amount_paise
                 ELSE 0
               END), 0) AS movementPaise,
               ap.monthly_contribution_paise AS monthlyContributionPaise,
               COALESCE((SELECT SUM(ga.amount_paise) FROM goal_allocations ga
                         WHERE ga.asset_position_id = ap.id), 0) AS allocatedPaise,
               ap.restricted, ap.as_of_date AS asOfDate, ap.valued_at AS valuedAt
        FROM asset_positions ap
        JOIN accounts a ON a.id = ap.account_id
        LEFT JOIN postings p ON p.account_id = ap.account_id
        LEFT JOIN journal_transactions t ON t.id = p.transaction_id
        GROUP BY ap.id, ap.account_id, a.name, ap.asset_type, a.institution,
                 ap.baseline_value_paise, ap.monthly_contribution_paise, ap.restricted,
                 ap.as_of_date, ap.valued_at
        ORDER BY ap.restricted, ap.asset_type, a.name
      `)
      .all() as StoredAssetRow[];
  }

  private listGoals(assets: WealthAssetRecord[], today: string): FinancialGoalRecord[] {
    const rows = this.database.connection
      .prepare(`
        SELECT id, name, target_paise AS targetPaise, target_date AS targetDate, priority,
               status, monthly_contribution_paise AS monthlyContributionPaise, notes
        FROM financial_goals
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, priority, target_date, name
      `)
      .all() as Array<{
      id: string;
      name: string;
      targetPaise: number;
      targetDate: string | null;
      priority: number;
      status: FinancialGoalStatus;
      monthlyContributionPaise: number;
      notes: string | null;
    }>;
    const assetNames = new Map(assets.map((asset) => [asset.id, asset.name]));
    const allocationRows = this.database.connection
      .prepare(`
        SELECT goal_id AS goalId, asset_position_id AS assetId, amount_paise AS amountPaise
        FROM goal_allocations
        WHERE amount_paise > 0
        ORDER BY goal_id, rowid
      `)
      .all() as Array<{ goalId: string; assetId: string; amountPaise: number }>;

    return rows.map((row) => {
      const allocations = allocationRows
        .filter((allocation) => allocation.goalId === row.id)
        .map((allocation) => ({
          assetId: allocation.assetId,
          assetName: assetNames.get(allocation.assetId) ?? "Unknown asset",
          amountPaise: allocation.amountPaise,
        }));
      const allocatedPaise = allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0);
      const remainingPaise = Math.max(0, row.targetPaise - allocatedPaise);
      const months =
        remainingPaise === 0
          ? 0
          : row.monthlyContributionPaise > 0
            ? Math.ceil(remainingPaise / row.monthlyContributionPaise)
            : null;
      const forecastDate = months === null ? null : addMonths(today, months);
      return {
        ...row,
        allocatedPaise,
        remainingPaise,
        progressPercentage: Math.min(100, Math.round((allocatedPaise / row.targetPaise) * 100)),
        forecastDate,
        onTrack: row.targetDate && forecastDate ? forecastDate <= row.targetDate : null,
        allocations,
      };
    });
  }

  private requireStoredAsset(id: string): StoredAssetRow {
    const asset = this.storedAssets().find((item) => item.id === id);
    if (!asset) {
      throw new Error("Wealth asset does not exist.");
    }
    return asset;
  }

  private requireAsset(id: string): WealthAssetRecord {
    const asset = this.listAssets().find((item) => item.id === id);
    if (!asset) {
      throw new Error("Wealth asset does not exist.");
    }
    return asset;
  }

  private requireGoal(id: string, today: string): FinancialGoalRecord {
    const goal = this.listGoals(this.listAssets(), today).find((item) => item.id === id);
    if (!goal) {
      throw new Error("Financial goal does not exist.");
    }
    return goal;
  }

  private insertAudit(action: string, entityType: string, entityId: string, detail: unknown, createdAt: string): void {
    this.database.connection
      .prepare(`
        INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(randomUUID(), action, entityType, entityId, JSON.stringify(detail), createdAt);
  }
}
