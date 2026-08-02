import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createVerifiedEncryptedBackup,
  stageVerifiedDatabaseRestore,
  verifyEncryptedBackup,
  verifyEncryptedDatabaseFile,
} from "./backup-recovery";
import { initializeFoundationSchema, openEncryptedDatabase } from "./encrypted-database";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "finance-hero-backup-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "finance-hero.db");
  const key = Buffer.from("verified-backup-development-key-with-32-bytes");
  const database = openEncryptedDatabase(databasePath, key);
  initializeFoundationSchema(database);
  database.connection
    .prepare("INSERT INTO categories (id, name, broad_bucket, created_at) VALUES (?, ?, ?, ?)")
    .run("test-category", "Test category", "test", "2026-08-02T00:00:00.000Z");
  return { directory, databasePath, key, database };
}

describe("encrypted backup and recovery", () => {
  it("refuses plaintext SQLite files before opening them", () => {
    const directory = mkdtempSync(join(tmpdir(), "finance-hero-plaintext-backup-"));
    temporaryDirectories.push(directory);
    const plaintextPath = join(directory, "plaintext.db");
    writeFileSync(plaintextPath, Buffer.from("SQLite format 3\0not-encrypted"));

    expect(() =>
      verifyEncryptedDatabaseFile(plaintextPath, Buffer.from("unused-key-that-is-still-at-least-32-bytes")),
    ).toThrow(/plaintext SQLite file/i);
  });

  it("creates a verified encrypted snapshot with a non-secret manifest", () => {
    const fixture = createFixture();
    const result = createVerifiedEncryptedBackup({
      database: fixture.database,
      databasePath: fixture.databasePath,
      key: fixture.key,
      backupDirectory: join(fixture.directory, "backups"),
      reason: "before schema migration",
      now: new Date("2026-08-02T01:02:03.004Z"),
    });

    expect(existsSync(result.backupPath)).toBe(true);
    expect(statSync(result.backupPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(result.backupPath).subarray(0, 16).toString("utf8")).not.toBe("SQLite format 3\0");
    expect(JSON.stringify(result.manifest)).not.toContain(fixture.key.toString("utf8"));
    expect(verifyEncryptedBackup({ backupPath: result.backupPath, key: fixture.key }).schemaVersion).toBe("phase-5");
    expect(() =>
      verifyEncryptedDatabaseFile(result.backupPath, Buffer.from("wrong-key-that-is-still-at-least-32-bytes")),
    ).toThrow(/cannot unlock the existing encrypted database/i);
    fixture.database.close();
  });

  it("refuses a modified snapshot or manifest", () => {
    const fixture = createFixture();
    const result = createVerifiedEncryptedBackup({
      database: fixture.database,
      databasePath: fixture.databasePath,
      key: fixture.key,
      backupDirectory: join(fixture.directory, "backups"),
      reason: "manual",
    });
    const originalManifest = readFileSync(result.manifestPath, "utf8");
    const manifest = JSON.parse(originalManifest) as { sha256: string };
    writeFileSync(result.manifestPath, JSON.stringify({ ...manifest, sha256: "0".repeat(64) }));
    expect(() => verifyEncryptedBackup({ backupPath: result.backupPath, key: fixture.key })).toThrow(
      /manifest verification failed/i,
    );

    writeFileSync(result.manifestPath, originalManifest);
    appendFileSync(result.backupPath, "tamper");
    expect(() => verifyEncryptedBackup({ backupPath: result.backupPath, key: fixture.key })).toThrow(
      /manifest verification failed/i,
    );
    fixture.database.close();
  });

  it("stages a verified restore without replacing or deleting the active database", () => {
    const fixture = createFixture();
    const result = createVerifiedEncryptedBackup({
      database: fixture.database,
      databasePath: fixture.databasePath,
      key: fixture.key,
      backupDirectory: join(fixture.directory, "backups"),
      reason: "manual",
    });
    const activeHashBefore = verifyEncryptedDatabaseFile(fixture.databasePath, fixture.key).sha256;
    const staged = stageVerifiedDatabaseRestore({
      backupPath: result.backupPath,
      key: fixture.key,
      recoveryRoot: join(fixture.directory, "recovery"),
      now: new Date("2026-08-02T02:00:00.000Z"),
    });

    expect(staged.databasePath).not.toBe(fixture.databasePath);
    expect(existsSync(staged.readinessPath)).toBe(true);
    expect(readFileSync(staged.readinessPath, "utf8")).toContain("active database has not been replaced or deleted");
    expect(verifyEncryptedDatabaseFile(fixture.databasePath, fixture.key).sha256).toBe(activeHashBefore);
    fixture.database.close();
  });
});
