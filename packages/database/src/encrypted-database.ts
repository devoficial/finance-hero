import Database from "better-sqlite3-multiple-ciphers";

export interface FinanceHeroDatabase {
  readonly connection: Database.Database;
  close(): void;
}

const MINIMUM_KEY_BYTES = 32;

export function openEncryptedDatabase(filename: string, key: Buffer): FinanceHeroDatabase {
  if (key.byteLength < MINIMUM_KEY_BYTES) {
    throw new Error(`Database key must contain at least ${MINIMUM_KEY_BYTES} bytes.`);
  }

  const connection = new Database(filename);

  try {
    connection.pragma("cipher='sqlcipher'");
    connection.pragma("legacy=4");
    connection.key(key);
    connection.pragma("foreign_keys=ON");
    connection.pragma("journal_mode=WAL");
    connection.pragma("secure_delete=ON");
    connection.prepare("SELECT count(*) AS count FROM sqlite_master").get();

    return {
      connection,
      close() {
        connection.pragma("wal_checkpoint(TRUNCATE)");
        connection.close();
      },
    };
  } catch (error) {
    connection.close();
    throw error;
  }
}

export function initializeFoundationSchema(database: FinanceHeroDatabase): void {
  database.connection.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('schema_version', 'phase-5', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at;

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      account_class TEXT NOT NULL CHECK (account_class IN ('asset', 'liability', 'income', 'expense', 'equity')),
      account_type TEXT NOT NULL,
      institution TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      broad_bucket TEXT NOT NULL,
      budget_eligible INTEGER NOT NULL DEFAULT 1 CHECK (budget_eligible IN (0, 1)),
      alert_eligible INTEGER NOT NULL DEFAULT 1 CHECK (alert_eligible IN (0, 1)),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS journal_transactions (
      id TEXT PRIMARY KEY NOT NULL,
      occurred_on TEXT NOT NULL CHECK (length(occurred_on) = 10),
      effective_month TEXT NOT NULL CHECK (length(effective_month) = 7),
      payee TEXT NOT NULL,
      memo TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'voided', 'reversed')),
      origin TEXT NOT NULL,
      source_ref TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS postings (
      id TEXT PRIMARY KEY NOT NULL,
      transaction_id TEXT NOT NULL REFERENCES journal_transactions(id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      category_id TEXT REFERENCES categories(id),
      amount_paise INTEGER NOT NULL CHECK (amount_paise <> 0),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS budget_periods (
      month TEXT PRIMARY KEY NOT NULL CHECK (length(month) = 7),
      planned_income_paise INTEGER NOT NULL DEFAULT 0,
      regular_budget_paise INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
      source_ref TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS budget_lines (
      month TEXT NOT NULL REFERENCES budget_periods(month),
      category_id TEXT NOT NULL REFERENCES categories(id),
      planned_paise INTEGER NOT NULL CHECK (planned_paise >= 0),
      PRIMARY KEY (month, category_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS monthly_expense_sheet_rows (
      month TEXT NOT NULL REFERENCES budget_periods(month),
      category_id TEXT NOT NULL REFERENCES categories(id),
      comment TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (month, category_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS monthly_cash_carryover_overrides (
      month TEXT PRIMARY KEY NOT NULL REFERENCES budget_periods(month),
      amount_paise INTEGER NOT NULL,
      source_ref TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS monthly_cash_adjustments (
      id TEXT PRIMARY KEY NOT NULL,
      month TEXT NOT NULL REFERENCES budget_periods(month),
      occurred_on TEXT NOT NULL CHECK (length(occurred_on) = 10),
      label TEXT NOT NULL,
      amount_paise INTEGER NOT NULL CHECK (amount_paise <> 0),
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS monthly_bank_reconciliations (
      month TEXT PRIMARY KEY NOT NULL REFERENCES budget_periods(month),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      statement_balance_paise INTEGER NOT NULL CHECK (statement_balance_paise >= 0),
      reconciled_on TEXT NOT NULL CHECK (length(reconciled_on) = 10),
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS debts (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
      lender TEXT NOT NULL,
      product_type TEXT NOT NULL,
      original_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (original_amount_paise >= 0),
      current_principal_paise INTEGER NOT NULL CHECK (current_principal_paise >= 0),
      emi_paise INTEGER NOT NULL DEFAULT 0 CHECK (emi_paise >= 0),
      annual_rate_bps INTEGER CHECK (annual_rate_bps >= 0),
      status TEXT NOT NULL CHECK (status IN ('active', 'cleared')),
      source_ref TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS personal_balances (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('payable', 'receivable')),
      amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
      status TEXT NOT NULL CHECK (status IN ('open', 'settled')),
      note TEXT,
      source_ref TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      project_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'on_hold')),
      freshness TEXT NOT NULL CHECK (freshness IN ('current', 'needs_update')),
      source_ref TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS project_expenses (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      occurred_on TEXT NOT NULL CHECK (length(occurred_on) = 10),
      description TEXT NOT NULL,
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      running_balance_paise INTEGER,
      included_in_actual INTEGER NOT NULL DEFAULT 1 CHECK (included_in_actual IN (0, 1)),
      review_status TEXT NOT NULL CHECK (review_status IN ('confirmed', 'needs_review')),
      linked_transaction_id TEXT REFERENCES journal_transactions(id),
      source_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS project_commitments (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      vendor_name TEXT NOT NULL,
      estimated_paise INTEGER NOT NULL DEFAULT 0 CHECK (estimated_paise >= 0),
      pending_paise INTEGER NOT NULL DEFAULT 0 CHECK (pending_paise >= 0),
      status TEXT NOT NULL CHECK (status IN ('open', 'settled', 'unknown')),
      source_ref TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS asset_positions (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
      asset_type TEXT NOT NULL CHECK (asset_type IN ('savings', 'investment', 'emergency_fund', 'restricted_wallet')),
      baseline_value_paise INTEGER NOT NULL CHECK (baseline_value_paise >= 0),
      monthly_contribution_paise INTEGER NOT NULL DEFAULT 0 CHECK (monthly_contribution_paise >= 0),
      restricted INTEGER NOT NULL DEFAULT 0 CHECK (restricted IN (0, 1)),
      as_of_date TEXT NOT NULL CHECK (length(as_of_date) = 10),
      valued_at TEXT NOT NULL,
      source_ref TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS financial_goals (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      target_paise INTEGER NOT NULL CHECK (target_paise > 0),
      target_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (target_mode IN ('fixed', 'emergency_cover')),
      coverage_months INTEGER CHECK (coverage_months IS NULL OR coverage_months BETWEEN 1 AND 24),
      target_date TEXT CHECK (target_date IS NULL OR length(target_date) = 10),
      priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 5),
      status TEXT NOT NULL CHECK (status IN ('active', 'achieved', 'paused')),
      monthly_contribution_paise INTEGER NOT NULL DEFAULT 0 CHECK (monthly_contribution_paise >= 0),
      notes TEXT,
      source_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS goal_allocations (
      goal_id TEXT NOT NULL REFERENCES financial_goals(id),
      asset_position_id TEXT NOT NULL REFERENCES asset_positions(id),
      amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
      effective_date TEXT NOT NULL CHECK (length(effective_date) = 10),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (goal_id, asset_position_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS import_artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      filename TEXT NOT NULL,
      content_hash TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      account_id TEXT REFERENCES accounts(id),
      status TEXT NOT NULL CHECK (status IN ('parsed', 'needs_parser', 'failed')),
      parser_message TEXT,
      row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS import_candidates (
      id TEXT PRIMARY KEY NOT NULL,
      artifact_id TEXT NOT NULL REFERENCES import_artifacts(id),
      source_row INTEGER NOT NULL CHECK (source_row > 0),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      occurred_on TEXT CHECK (occurred_on IS NULL OR length(occurred_on) = 10),
      payee TEXT NOT NULL,
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
      account_id TEXT REFERENCES accounts(id),
      category_id TEXT REFERENCES categories(id),
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
      warnings_json TEXT NOT NULL,
      source_json TEXT NOT NULL,
      transaction_id TEXT REFERENCES journal_transactions(id),
      rejection_reason TEXT,
      normalized_payee TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL DEFAULT '',
      duplicate_of_candidate_id TEXT REFERENCES import_candidates(id),
      duplicate_confidence INTEGER CHECK (duplicate_confidence IS NULL OR duplicate_confidence BETWEEN 0 AND 100),
      duplicate_resolution TEXT NOT NULL DEFAULT 'none'
        CHECK (duplicate_resolution IN ('none', 'suspected', 'distinct', 'merged')),
      splits_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (artifact_id, source_row)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS merchant_rules (
      id TEXT PRIMARY KEY NOT NULL,
      normalized_payee TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
      account_id TEXT REFERENCES accounts(id),
      category_id TEXT REFERENCES categories(id),
      source_candidate_id TEXT REFERENCES import_candidates(id),
      times_applied INTEGER NOT NULL DEFAULT 0 CHECK (times_applied >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (normalized_payee, direction)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS postings_transaction_idx ON postings(transaction_id);
    CREATE INDEX IF NOT EXISTS postings_account_idx ON postings(account_id);
    CREATE INDEX IF NOT EXISTS transactions_month_idx ON journal_transactions(effective_month, occurred_on);
    CREATE INDEX IF NOT EXISTS personal_balances_direction_idx ON personal_balances(direction, status);
    CREATE INDEX IF NOT EXISTS project_expenses_project_date_idx ON project_expenses(project_id, occurred_on);
    CREATE UNIQUE INDEX IF NOT EXISTS project_expenses_transaction_idx
      ON project_expenses(linked_transaction_id) WHERE linked_transaction_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS project_commitments_project_idx ON project_commitments(project_id, status);
    CREATE INDEX IF NOT EXISTS asset_positions_type_idx ON asset_positions(asset_type);
    CREATE INDEX IF NOT EXISTS financial_goals_status_priority_idx ON financial_goals(status, priority);
    CREATE INDEX IF NOT EXISTS goal_allocations_asset_idx ON goal_allocations(asset_position_id);
    CREATE INDEX IF NOT EXISTS import_artifacts_created_idx ON import_artifacts(created_at DESC);
    CREATE INDEX IF NOT EXISTS import_candidates_status_idx ON import_candidates(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS import_candidates_artifact_idx ON import_candidates(artifact_id, source_row);
    CREATE INDEX IF NOT EXISTS import_candidates_fingerprint_idx ON import_candidates(fingerprint, status);
    CREATE INDEX IF NOT EXISTS import_candidates_duplicate_idx ON import_candidates(duplicate_of_candidate_id);
    CREATE INDEX IF NOT EXISTS merchant_rules_match_idx ON merchant_rules(normalized_payee, direction);
  `);

  const debtColumns = database.connection.prepare("PRAGMA table_info(debts)").all() as Array<{ name: string }>;
  if (!debtColumns.some((column) => column.name === "original_amount_paise")) {
    database.connection.exec(
      "ALTER TABLE debts ADD COLUMN original_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (original_amount_paise >= 0)",
    );
    database.connection.exec("UPDATE debts SET original_amount_paise = current_principal_paise");
  }

  const goalColumns = database.connection.prepare("PRAGMA table_info(financial_goals)").all() as Array<{
    name: string;
  }>;
  if (!goalColumns.some((column) => column.name === "target_mode")) {
    database.connection.exec("ALTER TABLE financial_goals ADD COLUMN target_mode TEXT NOT NULL DEFAULT 'fixed'");
  }
  if (!goalColumns.some((column) => column.name === "coverage_months")) {
    database.connection.exec("ALTER TABLE financial_goals ADD COLUMN coverage_months INTEGER");
  }

  const importCandidateColumns = database.connection.prepare("PRAGMA table_info(import_candidates)").all() as Array<{
    name: string;
  }>;
  if (!importCandidateColumns.some((column) => column.name === "normalized_payee")) {
    database.connection.exec("ALTER TABLE import_candidates ADD COLUMN normalized_payee TEXT NOT NULL DEFAULT ''");
  }
  if (!importCandidateColumns.some((column) => column.name === "fingerprint")) {
    database.connection.exec("ALTER TABLE import_candidates ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ''");
  }
  if (!importCandidateColumns.some((column) => column.name === "duplicate_of_candidate_id")) {
    database.connection.exec("ALTER TABLE import_candidates ADD COLUMN duplicate_of_candidate_id TEXT");
  }
  if (!importCandidateColumns.some((column) => column.name === "duplicate_confidence")) {
    database.connection.exec("ALTER TABLE import_candidates ADD COLUMN duplicate_confidence INTEGER");
  }
  if (!importCandidateColumns.some((column) => column.name === "duplicate_resolution")) {
    database.connection.exec(
      "ALTER TABLE import_candidates ADD COLUMN duplicate_resolution TEXT NOT NULL DEFAULT 'none'",
    );
  }
  if (!importCandidateColumns.some((column) => column.name === "splits_json")) {
    database.connection.exec("ALTER TABLE import_candidates ADD COLUMN splits_json TEXT NOT NULL DEFAULT '[]'");
  }
  database.connection.exec(`
    CREATE INDEX IF NOT EXISTS import_candidates_fingerprint_idx ON import_candidates(fingerprint, status);
    CREATE INDEX IF NOT EXISTS import_candidates_duplicate_idx ON import_candidates(duplicate_of_candidate_id);
  `);
  database.connection
    .prepare(`
      UPDATE financial_goals
      SET target_mode = 'emergency_cover', coverage_months = COALESCE(coverage_months, 3)
      WHERE id = 'goal-emergency-fund'
    `)
    .run();
}
