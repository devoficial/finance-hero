import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeFoundationSchema, openEncryptedDatabase } from "./encrypted-database";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("encrypted database", () => {
  it("persists data and rejects the wrong key", () => {
    const directory = mkdtempSync(join(tmpdir(), "finance-hero-db-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "finance-hero.db");
    const correctKey = Buffer.from("correct-development-key-with-32-bytes-minimum");
    const wrongKey = Buffer.from("incorrect-development-key-with-32-bytes-min");

    const database = openEncryptedDatabase(filename, correctKey);
    initializeFoundationSchema(database);
    database.close();

    expect(() => {
      const invalid = openEncryptedDatabase(filename, wrongKey);
      invalid.close();
    }).toThrow();

    const reopened = openEncryptedDatabase(filename, correctKey);
    const row = reopened.connection.prepare("SELECT value FROM app_metadata WHERE key = ?").get("schema_version") as {
      value: string;
    };
    expect(row.value).toBe("phase-5");
    const importArtifactColumns = (
      reopened.connection.prepare("PRAGMA table_info(import_artifacts)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(importArtifactColumns).toEqual(
      expect.arrayContaining([
        "statement_period_start",
        "statement_period_end",
        "opening_balance_asset_paise",
        "opening_balance_liability_paise",
        "closing_balance_paise",
        "reconciled_at",
      ]),
    );
    reopened.close();
  });

  it("migrates a pre-deduplication import schema before creating its indexes", () => {
    const directory = mkdtempSync(join(tmpdir(), "finance-hero-legacy-db-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "finance-hero.db");
    const key = Buffer.from("legacy-development-key-with-32-bytes-minimum");
    const database = openEncryptedDatabase(filename, key);
    database.connection.exec(`
      CREATE TABLE import_artifacts (
        id TEXT PRIMARY KEY NOT NULL,
        filename TEXT NOT NULL,
        content_hash TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        account_id TEXT,
        status TEXT NOT NULL,
        parser_message TEXT,
        row_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE import_candidates (
        id TEXT PRIMARY KEY NOT NULL,
        artifact_id TEXT NOT NULL REFERENCES import_artifacts(id),
        source_row INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        occurred_on TEXT,
        payee TEXT NOT NULL,
        amount_paise INTEGER NOT NULL,
        direction TEXT NOT NULL,
        account_id TEXT,
        category_id TEXT,
        status TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        warnings_json TEXT NOT NULL,
        source_json TEXT NOT NULL,
        transaction_id TEXT,
        rejection_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (artifact_id, source_row)
      ) STRICT;
    `);

    expect(() => initializeFoundationSchema(database)).not.toThrow();
    const columns = (
      database.connection.prepare("PRAGMA table_info(import_candidates)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(columns).toEqual(
      expect.arrayContaining([
        "normalized_payee",
        "fingerprint",
        "duplicate_of_candidate_id",
        "duplicate_confidence",
        "duplicate_resolution",
        "splits_json",
      ]),
    );
    const indexes = (
      database.connection.prepare("PRAGMA index_list(import_candidates)").all() as Array<{ name: string }>
    ).map((index) => index.name);
    expect(indexes).toEqual(
      expect.arrayContaining(["import_candidates_fingerprint_idx", "import_candidates_duplicate_idx"]),
    );
    database.close();
  });
});
