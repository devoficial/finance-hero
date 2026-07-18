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
    VALUES ('schema_version', 'phase-0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(key) DO NOTHING;
  `);
}
