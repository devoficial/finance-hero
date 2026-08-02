import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type { FinanceHeroDatabase } from "./encrypted-database";
import { openEncryptedDatabase } from "./encrypted-database";

const SQLITE_PLAINTEXT_HEADER = Buffer.from("SQLite format 3\0", "utf8");

export interface VerifiedDatabaseFile {
  path: string;
  sizeBytes: number;
  sha256: string;
  schemaVersion: string | null;
  verifiedAt: string;
}

export interface BackupManifest extends VerifiedDatabaseFile {
  formatVersion: 1;
  backupFilename: string;
  createdAt: string;
  reason: string;
}

export interface CreatedDatabaseBackup {
  backupPath: string;
  manifestPath: string;
  manifest: BackupManifest;
}

export interface StagedDatabaseRestore {
  recoveryDirectory: string;
  databasePath: string;
  readinessPath: string;
  verification: VerifiedDatabaseFile;
}

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function safeReason(reason: string): string {
  const value = reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return value || "manual";
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readSchemaVersion(database: FinanceHeroDatabase): string | null {
  const hasMetadata = database.connection
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'app_metadata'")
    .get();
  if (!hasMetadata) return null;
  const row = database.connection.prepare("SELECT value FROM app_metadata WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function assertDatabaseIntegrity(database: FinanceHeroDatabase): void {
  const integrity = database.connection.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
    throw new Error("Database integrity verification failed; the file was preserved unchanged.");
  }
  const foreignKeyFailures = database.connection.pragma("foreign_key_check") as unknown[];
  if (foreignKeyFailures.length > 0) {
    throw new Error("Database relationship verification failed; the file was preserved unchanged.");
  }
}

export function verifyEncryptedDatabaseFile(path: string, key: Buffer): VerifiedDatabaseFile {
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath) || statSync(absolutePath).size === 0) {
    throw new Error(`Encrypted database file does not exist or is empty: ${absolutePath}`);
  }
  const header = readFileSync(absolutePath).subarray(0, SQLITE_PLAINTEXT_HEADER.length);
  if (header.equals(SQLITE_PLAINTEXT_HEADER)) {
    throw new Error("Backup verification refused a plaintext SQLite file; no restore was staged.");
  }

  const database = openEncryptedDatabase(absolutePath, key);
  let schemaVersion: string | null;
  try {
    assertDatabaseIntegrity(database);
    schemaVersion = readSchemaVersion(database);
  } finally {
    database.close();
  }
  return {
    path: absolutePath,
    sizeBytes: statSync(absolutePath).size,
    sha256: sha256File(absolutePath),
    schemaVersion,
    verifiedAt: new Date().toISOString(),
  };
}

export function createVerifiedEncryptedBackup(input: {
  database: FinanceHeroDatabase;
  databasePath: string;
  key: Buffer;
  backupDirectory: string;
  reason: string;
  now?: Date;
}): CreatedDatabaseBackup {
  const now = input.now ?? new Date();
  const backupDirectory = resolve(input.backupDirectory);
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });

  assertDatabaseIntegrity(input.database);
  input.database.connection.pragma("wal_checkpoint(TRUNCATE)");

  const filename = `${timestampForFilename(now)}-${safeReason(input.reason)}-${randomUUID().slice(0, 8)}.db`;
  const backupPath = join(backupDirectory, filename);
  copyFileSync(resolve(input.databasePath), backupPath, constants.COPYFILE_EXCL);
  chmodSync(backupPath, 0o600);

  const verification = verifyEncryptedDatabaseFile(backupPath, input.key);
  const manifest: BackupManifest = {
    ...verification,
    path: filename,
    formatVersion: 1,
    backupFilename: filename,
    createdAt: now.toISOString(),
    reason: input.reason,
  };
  const manifestPath = `${backupPath}.manifest.json`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(manifestPath, 0o600);

  return { backupPath, manifestPath, manifest };
}

export function verifyEncryptedBackup(input: {
  backupPath: string;
  key: Buffer;
  manifestPath?: string;
}): VerifiedDatabaseFile {
  const verification = verifyEncryptedDatabaseFile(input.backupPath, input.key);
  const manifestPath = input.manifestPath ?? `${resolve(input.backupPath)}.manifest.json`;
  if (!existsSync(manifestPath)) {
    throw new Error("Backup manifest is missing; the backup was not accepted for restore.");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<BackupManifest>;
  if (
    manifest.formatVersion !== 1 ||
    manifest.backupFilename !== basename(input.backupPath) ||
    manifest.sha256 !== verification.sha256 ||
    manifest.sizeBytes !== verification.sizeBytes
  ) {
    throw new Error("Backup manifest verification failed; the backup was not accepted for restore.");
  }
  return verification;
}

export function stageVerifiedDatabaseRestore(input: {
  backupPath: string;
  key: Buffer;
  recoveryRoot: string;
  manifestPath?: string;
  now?: Date;
}): StagedDatabaseRestore {
  const sourceVerification = verifyEncryptedBackup(input);
  const now = input.now ?? new Date();
  const recoveryRoot = resolve(input.recoveryRoot);
  mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
  const recoveryDirectory = join(recoveryRoot, `restore-${timestampForFilename(now)}-${randomUUID().slice(0, 8)}`);
  mkdirSync(recoveryDirectory, { recursive: false, mode: 0o700 });
  const databasePath = join(recoveryDirectory, "finance-hero.db");
  copyFileSync(resolve(input.backupPath), databasePath, constants.COPYFILE_EXCL);
  chmodSync(databasePath, 0o600);

  const verification = verifyEncryptedDatabaseFile(databasePath, input.key);
  if (verification.sha256 !== sourceVerification.sha256) {
    throw new Error("Staged restore differs from its verified backup; the current database was not touched.");
  }

  const readinessPath = join(recoveryDirectory, "RESTORE_READY.json");
  writeFileSync(
    readinessPath,
    `${JSON.stringify(
      {
        formatVersion: 1,
        stagedAt: now.toISOString(),
        sourceBackup: basename(input.backupPath),
        databaseFilename: basename(databasePath),
        sha256: verification.sha256,
        sizeBytes: verification.sizeBytes,
        schemaVersion: verification.schemaVersion,
        note: "Verified recovery copy only. The active database has not been replaced or deleted.",
      },
      null,
      2,
    )}\n`,
    { mode: 0o600, flag: "wx" },
  );
  chmodSync(readinessPath, 0o600);

  return { recoveryDirectory, databasePath, readinessPath, verification };
}
