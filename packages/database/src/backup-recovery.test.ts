import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateStagedDatabaseRestore,
  createVerifiedEncryptedBackup,
  pruneEncryptedBackups,
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

function readTestCategory(databasePath: string, key: Buffer): string {
  const database = openEncryptedDatabase(databasePath, key);
  try {
    const row = database.connection.prepare("SELECT name FROM categories WHERE id = 'test-category'").get() as {
      name: string;
    };
    return row.name;
  } finally {
    database.close();
  }
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

  it("prunes only the oldest complete backup pairs", () => {
    const fixture = createFixture();
    const backupDirectory = join(fixture.directory, "backups");
    const backups = ["2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z", "2026-08-03T00:00:00.000Z"].map(
      (createdAt) =>
        createVerifiedEncryptedBackup({
          database: fixture.database,
          databasePath: fixture.databasePath,
          key: fixture.key,
          backupDirectory,
          reason: "retention test",
          now: new Date(createdAt),
          retentionCount: 10,
        }),
    );
    writeFileSync(join(backupDirectory, "orphan.db"), "preserve me");

    const result = pruneEncryptedBackups({ backupDirectory, keepCount: 2 });
    const [oldest, middle, newest] = backups;
    if (!oldest || !middle || !newest) {
      throw new Error("Expected three backup fixtures");
    }

    expect(result).toEqual({ keptCount: 2, removedCount: 1, skippedCount: 1 });
    expect(existsSync(oldest.backupPath)).toBe(false);
    expect(existsSync(oldest.manifestPath)).toBe(false);
    expect(existsSync(middle.backupPath)).toBe(true);
    expect(existsSync(newest.backupPath)).toBe(true);
    expect(existsSync(join(backupDirectory, "orphan.db"))).toBe(true);
    fixture.database.close();
  });

  it("activates only a staged restore under the configured recovery root and preserves a pre-restore backup", () => {
    const active = createFixture();
    active.database.connection
      .prepare("UPDATE categories SET name = ? WHERE id = 'test-category'")
      .run("Active category");
    const source = createFixture();
    source.database.connection
      .prepare("UPDATE categories SET name = ? WHERE id = 'test-category'")
      .run("Restored category");
    const sourceBackup = createVerifiedEncryptedBackup({
      database: source.database,
      databasePath: source.databasePath,
      key: source.key,
      backupDirectory: join(source.directory, "backups"),
      reason: "restore source",
    });
    const recoveryRoot = join(active.directory, "recovery");
    const staged = stageVerifiedDatabaseRestore({
      backupPath: sourceBackup.backupPath,
      key: active.key,
      recoveryRoot,
    });
    const activeHash = verifyEncryptedDatabaseFile(active.databasePath, active.key).sha256;
    active.database.close();
    source.database.close();

    const activated = activateStagedDatabaseRestore({
      stagedRestoreDirectory: staged.recoveryDirectory,
      recoveryRoot,
      databasePath: active.databasePath,
      backupDirectory: join(active.directory, "backups", "manual"),
      key: active.key,
    });

    expect(readTestCategory(active.databasePath, active.key)).toBe("Restored category");
    expect(verifyEncryptedBackup({ backupPath: activated.preRestoreBackup.backupPath, key: active.key }).sha256).toBe(
      activeHash,
    );
    const differentRecoveryRoot = join(active.directory, "different-recovery");
    mkdirSync(differentRecoveryRoot, { recursive: true });
    expect(() =>
      activateStagedDatabaseRestore({
        stagedRestoreDirectory: staged.recoveryDirectory,
        recoveryRoot: differentRecoveryRoot,
        databasePath: active.databasePath,
        backupDirectory: join(active.directory, "backups"),
        key: active.key,
      }),
    ).toThrow(/configured recovery root/i);
  });

  it("refuses a tampered staged restore without changing the active database", () => {
    const fixture = createFixture();
    const backup = createVerifiedEncryptedBackup({
      database: fixture.database,
      databasePath: fixture.databasePath,
      key: fixture.key,
      backupDirectory: join(fixture.directory, "backups"),
      reason: "tamper test",
    });
    const recoveryRoot = join(fixture.directory, "recovery");
    const staged = stageVerifiedDatabaseRestore({ backupPath: backup.backupPath, key: fixture.key, recoveryRoot });
    const activeHash = verifyEncryptedDatabaseFile(fixture.databasePath, fixture.key).sha256;
    fixture.database.close();
    appendFileSync(staged.databasePath, "tamper");

    expect(() =>
      activateStagedDatabaseRestore({
        stagedRestoreDirectory: staged.recoveryDirectory,
        recoveryRoot,
        databasePath: fixture.databasePath,
        backupDirectory: join(fixture.directory, "pre-restore"),
        key: fixture.key,
      }),
    ).toThrow(/readiness receipt/i);
    expect(verifyEncryptedDatabaseFile(fixture.databasePath, fixture.key).sha256).toBe(activeHash);
  });
});
