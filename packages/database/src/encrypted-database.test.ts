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
});
