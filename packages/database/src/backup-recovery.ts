import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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
  retention: BackupRetentionResult;
}

export interface StagedDatabaseRestore {
  recoveryDirectory: string;
  databasePath: string;
  readinessPath: string;
  verification: VerifiedDatabaseFile;
}

export interface BackupRetentionResult {
  keptCount: number;
  removedCount: number;
  skippedCount: number;
}

export interface ActivatedDatabaseRestore {
  verification: VerifiedDatabaseFile;
  preRestoreBackup: CreatedDatabaseBackup;
}

interface RestoreReadiness {
  formatVersion: 1;
  databaseFilename: string;
  sha256: string;
  sizeBytes: number;
}

const DEFAULT_BACKUP_RETENTION_COUNT = 30;

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

function assertSafeRegularFile(path: string, label: string): void {
  if (!existsSync(path)) throw new Error(`${label} is missing.`);
  const details = lstatSync(path);
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new Error(`${label} must be a regular file and cannot be a symbolic link.`);
  }
}

function resolveDirectRestoreDirectory(recoveryRoot: string, stagedRestoreDirectory: string): string {
  mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
  const root = realpathSync(resolve(recoveryRoot));
  const unresolvedCandidate = resolve(stagedRestoreDirectory);
  if (
    !existsSync(unresolvedCandidate) ||
    lstatSync(unresolvedCandidate).isSymbolicLink() ||
    !lstatSync(unresolvedCandidate).isDirectory()
  ) {
    throw new Error("The staged restore directory is missing or unsafe.");
  }
  const candidate = realpathSync(unresolvedCandidate);
  const relativePath = relative(root, candidate);
  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    dirname(candidate) !== root ||
    !basename(candidate).startsWith("restore-")
  ) {
    throw new Error("Restore activation accepts only a direct staged restore under the configured recovery root.");
  }
  return candidate;
}

function readRestoreReadiness(stagedRestoreDirectory: string): RestoreReadiness {
  const readinessPath = join(stagedRestoreDirectory, "RESTORE_READY.json");
  assertSafeRegularFile(readinessPath, "Restore readiness receipt");
  const receipt = JSON.parse(readFileSync(readinessPath, "utf8")) as Record<string, unknown>;
  if (
    receipt.formatVersion !== 1 ||
    receipt.databaseFilename !== "finance-hero.db" ||
    typeof receipt.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
    typeof receipt.sizeBytes !== "number" ||
    !Number.isSafeInteger(receipt.sizeBytes) ||
    receipt.sizeBytes <= 0
  ) {
    throw new Error("Restore readiness receipt is invalid.");
  }
  return receipt as unknown as RestoreReadiness;
}

export function pruneEncryptedBackups(input: { backupDirectory: string; keepCount?: number }): BackupRetentionResult {
  const keepCount = input.keepCount ?? DEFAULT_BACKUP_RETENTION_COUNT;
  if (!Number.isSafeInteger(keepCount) || keepCount < 1) {
    throw new Error("Backup retention count must be a positive integer.");
  }
  const backupDirectory = resolve(input.backupDirectory);
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const complete: Array<{ backupPath: string; manifestPath: string; createdAt: number; filename: string }> = [];
  let skippedCount = 0;

  for (const filename of readdirSync(backupDirectory).filter((entry) => entry.endsWith(".db"))) {
    const backupPath = join(backupDirectory, filename);
    const manifestPath = `${backupPath}.manifest.json`;
    try {
      assertSafeRegularFile(backupPath, "Backup");
      assertSafeRegularFile(manifestPath, "Backup manifest");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<BackupManifest>;
      const createdAt = Date.parse(manifest.createdAt ?? "");
      if (manifest.formatVersion !== 1 || manifest.backupFilename !== filename || !Number.isFinite(createdAt)) {
        throw new Error("Incomplete backup pair");
      }
      complete.push({ backupPath, manifestPath, createdAt, filename });
    } catch {
      skippedCount += 1;
    }
  }

  complete.sort((left, right) => right.createdAt - left.createdAt || right.filename.localeCompare(left.filename));
  const removable = complete.slice(keepCount);
  for (const entry of removable) {
    rmSync(entry.backupPath);
    rmSync(entry.manifestPath);
  }
  return {
    keptCount: complete.length - removable.length,
    removedCount: removable.length,
    skippedCount,
  };
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
  retentionCount?: number;
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

  const retention = pruneEncryptedBackups({
    backupDirectory,
    keepCount: input.retentionCount,
  });
  return { backupPath, manifestPath, manifest, retention };
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

export function activateStagedDatabaseRestore(input: {
  stagedRestoreDirectory: string;
  recoveryRoot: string;
  databasePath: string;
  backupDirectory: string;
  key: Buffer;
  now?: Date;
  retentionCount?: number;
}): ActivatedDatabaseRestore {
  const stagedRestoreDirectory = resolveDirectRestoreDirectory(input.recoveryRoot, input.stagedRestoreDirectory);
  const receipt = readRestoreReadiness(stagedRestoreDirectory);
  const stagedDatabasePath = join(stagedRestoreDirectory, receipt.databaseFilename);
  assertSafeRegularFile(stagedDatabasePath, "Staged database");
  const stagedVerification = verifyEncryptedDatabaseFile(stagedDatabasePath, input.key);
  if (stagedVerification.sha256 !== receipt.sha256 || stagedVerification.sizeBytes !== receipt.sizeBytes) {
    throw new Error("Staged database no longer matches its readiness receipt.");
  }

  const databasePath = resolve(input.databasePath);
  assertSafeRegularFile(databasePath, "Active database");
  const activeDatabase = openEncryptedDatabase(databasePath, input.key);
  let preRestoreBackup: CreatedDatabaseBackup;
  try {
    preRestoreBackup = createVerifiedEncryptedBackup({
      database: activeDatabase,
      databasePath,
      key: input.key,
      backupDirectory: input.backupDirectory,
      reason: "pre-restore",
      now: input.now,
      retentionCount: input.retentionCount,
    });
  } finally {
    activeDatabase.close();
  }

  const operationId = randomUUID();
  const candidatePath = `${databasePath}.restore-${operationId}.tmp`;
  const rollbackPath = `${databasePath}.rollback-${operationId}`;
  const movedSidecars: Array<{ original: string; rollback: string }> = [];
  let activeMoved = false;
  let candidateActivated = false;
  try {
    copyFileSync(stagedDatabasePath, candidatePath, constants.COPYFILE_EXCL);
    chmodSync(candidatePath, 0o600);
    const candidateVerification = verifyEncryptedDatabaseFile(candidatePath, input.key);
    if (candidateVerification.sha256 !== receipt.sha256) {
      throw new Error("Restore candidate changed before activation.");
    }

    for (const suffix of ["-wal", "-shm"]) {
      const original = `${databasePath}${suffix}`;
      if (!existsSync(original)) continue;
      const rollback = `${rollbackPath}${suffix}`;
      renameSync(original, rollback);
      movedSidecars.push({ original, rollback });
    }
    renameSync(databasePath, rollbackPath);
    activeMoved = true;
    renameSync(candidatePath, databasePath);
    candidateActivated = true;

    const verification = verifyEncryptedDatabaseFile(databasePath, input.key);
    if (verification.sha256 !== receipt.sha256 || verification.sizeBytes !== receipt.sizeBytes) {
      throw new Error("Activated database failed post-swap verification.");
    }
    rmSync(rollbackPath);
    activeMoved = false;
    for (const sidecar of movedSidecars) {
      try {
        rmSync(sidecar.rollback, { force: true });
      } catch {
        // The activated database is already verified; stale rollback sidecars are harmless.
      }
    }
    return { verification, preRestoreBackup };
  } catch (error) {
    let rolledBack = false;
    if (activeMoved && existsSync(rollbackPath)) {
      if (candidateActivated && existsSync(databasePath)) rmSync(databasePath, { force: true });
      renameSync(rollbackPath, databasePath);
      activeMoved = false;
      rolledBack = true;
    }
    for (const sidecar of movedSidecars) {
      if (existsSync(sidecar.rollback)) {
        rmSync(sidecar.original, { force: true });
        renameSync(sidecar.rollback, sidecar.original);
      }
    }
    if (rolledBack) {
      verifyEncryptedDatabaseFile(databasePath, input.key);
    }
    throw error;
  } finally {
    rmSync(candidatePath, { force: true });
  }
}
