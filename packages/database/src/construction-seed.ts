import { constructionSeedCommitments, constructionSeedExpenses } from "./construction-seed-data";
import type { FinanceHeroDatabase } from "./encrypted-database";

const PROJECT_ID = "project-home-construction";
const SOURCE = "Finance tracker 2025:Home Construction Details";
const SEEDED_AT = "2026-07-18T12:00:00.000Z";
const SEED_VERSION = "2026-07-v1";

export function seedHomeConstructionSnapshot(database: FinanceHeroDatabase): void {
  const seed = database.connection.transaction(() => {
    const existing = database.connection
      .prepare("SELECT value FROM app_metadata WHERE key = 'accepted_construction_seed'")
      .get() as { value: string } | undefined;
    if (existing?.value === SEED_VERSION) {
      return;
    }

    database.connection
      .prepare(`
        INSERT INTO projects (id, name, project_type, status, freshness, source_ref, updated_at)
        VALUES (?, 'Home Construction', 'home_construction', 'active', 'needs_update', ?, ?)
        ON CONFLICT(id) DO NOTHING
      `)
      .run(PROJECT_ID, SOURCE, SEEDED_AT);

    const insertExpense = database.connection.prepare(`
      INSERT OR IGNORE INTO project_expenses
        (id, project_id, occurred_on, description, amount_paise, running_balance_paise,
         included_in_actual, review_status, linked_transaction_id, source_ref, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `);
    for (const expense of constructionSeedExpenses) {
      insertExpense.run(
        expense.id,
        PROJECT_ID,
        expense.occurredOn,
        expense.description,
        expense.amountPaise,
        expense.runningBalancePaise,
        expense.includedInActual ? 1 : 0,
        expense.reviewStatus,
        SOURCE,
        SEEDED_AT,
        SEEDED_AT,
      );
    }

    const insertCommitment = database.connection.prepare(`
      INSERT OR IGNORE INTO project_commitments
        (id, project_id, vendor_name, estimated_paise, pending_paise, status, source_ref, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const commitment of constructionSeedCommitments) {
      insertCommitment.run(
        commitment.id,
        PROJECT_ID,
        commitment.vendorName,
        commitment.estimatedPaise,
        commitment.pendingPaise,
        commitment.status,
        SOURCE,
        SEEDED_AT,
      );
    }

    database.connection
      .prepare(`
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES ('accepted_construction_seed', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(SEED_VERSION, SEEDED_AT);
  });
  seed.immediate();
}
