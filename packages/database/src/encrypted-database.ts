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
    VALUES ('schema_version', 'phase-3', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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

    CREATE INDEX IF NOT EXISTS postings_transaction_idx ON postings(transaction_id);
    CREATE INDEX IF NOT EXISTS postings_account_idx ON postings(account_id);
    CREATE INDEX IF NOT EXISTS transactions_month_idx ON journal_transactions(effective_month, occurred_on);
    CREATE INDEX IF NOT EXISTS personal_balances_direction_idx ON personal_balances(direction, status);
  `);

  const debtColumns = database.connection.prepare("PRAGMA table_info(debts)").all() as Array<{ name: string }>;
  if (!debtColumns.some((column) => column.name === "original_amount_paise")) {
    database.connection.exec(
      "ALTER TABLE debts ADD COLUMN original_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (original_amount_paise >= 0)",
    );
    database.connection.exec("UPDATE debts SET original_amount_paise = current_principal_paise");
  }
}
