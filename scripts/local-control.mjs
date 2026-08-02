import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIRECTORY = resolve(process.env.FINANCE_HERO_DATA_DIR ?? join(ROOT, "data"));
const DATABASE_PATH = join(DATA_DIRECTORY, "finance-hero.db");
const RUNTIME_PATH = join(DATA_DIRECTORY, ".runtime.json");
const LOG_DIRECTORY = join(DATA_DIRECTORY, "logs");
const LOG_PATH = join(LOG_DIRECTORY, "finance-hero.log");
const BACKUP_DIRECTORY = join(DATA_DIRECTORY, "backups");
const RECOVERY_DIRECTORY = join(DATA_DIRECTORY, "recovery");
const PHONE_ACCESS_CONFIG_PATH = join(ROOT, "data", "local-tls", "phone-access.json");
const KEYCHAIN_SERVICE = "finance-hero.database";
const KEYCHAIN_ACCOUNT = "primary";
const API_URL = "http://127.0.0.1:4317/api/v1/health";
const WEB_URL = process.env.FINANCE_HERO_WEB_PUBLIC_URL ?? "http://127.0.0.1:4318/";
const WEB_SECURE = Boolean(process.env.FINANCE_HERO_WEB_CERT && process.env.FINANCE_HERO_WEB_KEY);
const OLLAMA_URL = "http://127.0.0.1:11434/api/tags";

function print(message = "") {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`Finance Hero: ${message}\n`);
  process.exitCode = 1;
}

function ensureMacOS() {
  if (process.platform !== "darwin") {
    throw new Error("secure local control currently requires macOS.");
  }
}

function security(args, options = {}) {
  return spawnSync("security", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    ...options,
  });
}

function keychainHasKey() {
  ensureMacOS();
  return (
    security(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT], {
      stdio: "ignore",
    }).status === 0
  );
}

function readKeychainKey() {
  ensureMacOS();
  const result = security(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"]);
  if (result.status !== 0) {
    throw new Error("the database key is not available in macOS Keychain.");
  }
  const key = result.stdout.trim();
  if (key.length < 32) {
    throw new Error("the Keychain database key is too short.");
  }
  return key;
}

function storeKeychainKey(key) {
  ensureMacOS();
  if (key.length < 32) {
    throw new Error("the database key must contain at least 32 characters.");
  }
  const result = security(["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w", key]);
  if (result.status !== 0) {
    throw new Error("macOS Keychain rejected the database key.");
  }
}

function readDotEnvKey() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) {
    return undefined;
  }
  const match = readFileSync(path, "utf8").match(/^\s*FINANCE_HERO_DATABASE_KEY\s*=\s*(.+?)\s*$/m);
  if (!match) {
    return undefined;
  }
  return match[1].replace(/^(['"])(.*)\1$/, "$2");
}

function readDotEnvEnvironment() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) {
    return {};
  }

  const environment = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;

    const [, name, rawValue] = match;
    environment[name] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
  return environment;
}

function readPhoneAccessConfig() {
  if (!existsSync(PHONE_ACCESS_CONFIG_PATH)) return {};

  try {
    const config = JSON.parse(readFileSync(PHONE_ACCESS_CONFIG_PATH, "utf8"));
    return config && typeof config === "object" ? config : {};
  } catch {
    return {};
  }
}

function promptHidden(message) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("run setup from an interactive Terminal to enter the existing database key securely.");
  }
  process.stderr.write(message);
  return new Promise((resolvePrompt, rejectPrompt) => {
    let value = "";
    const finish = (error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stderr.write("\n");
      if (error) {
        rejectPrompt(error);
      } else {
        resolvePrompt(value);
      }
    };
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 3) {
          finish(new Error("setup was cancelled."));
          return;
        }
        if (byte === 13 || byte === 10) {
          finish();
          return;
        }
        if (byte === 127 || byte === 8) {
          value = value.slice(0, -1);
          continue;
        }
        value += String.fromCharCode(byte);
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

function ensureDatabaseBuild({ quiet = false } = {}) {
  const databaseModule = join(ROOT, "packages/database/dist/index.js");
  const result = spawnSync("pnpm", ["--filter", "@finance-hero/database", "build"], {
    cwd: ROOT,
    stdio: quiet ? "ignore" : "inherit",
  });
  if (result.status !== 0 || !existsSync(databaseModule)) {
    throw new Error("the encrypted database verifier could not be built.");
  }
  return databaseModule;
}

async function validateExistingDatabaseKey(key) {
  if (!existsSync(DATABASE_PATH) || statSync(DATABASE_PATH).size === 0) {
    return;
  }
  const databaseModule = ensureDatabaseBuild();
  const { openEncryptedDatabase } = await import(pathToFileURL(databaseModule).href);
  let database;
  try {
    database = openEncryptedDatabase(DATABASE_PATH, Buffer.from(key, "utf8"));
  } catch {
    throw new Error(
      "the supplied key cannot open the existing encrypted database, or the file is damaged. " +
        "The database was left unchanged. Recover the original Keychain item or verify a backup before continuing.",
    );
  } finally {
    database?.close();
  }
}

async function requireStoppedApp() {
  const [apiOpen, webOpen] = await Promise.all([portIsOpen(4317), portIsOpen(4318)]);
  if (apiOpen || webOpen) {
    throw new Error("stop Finance Hero with `pnpm stop:local` before this database operation.");
  }
}

function availableBackups() {
  if (!existsSync(BACKUP_DIRECTORY)) return [];
  const directories = [BACKUP_DIRECTORY, join(BACKUP_DIRECTORY, "automatic"), join(BACKUP_DIRECTORY, "manual")];
  return directories
    .flatMap((directory) =>
      existsSync(directory)
        ? readdirSync(directory)
            .filter((name) => name.endsWith(".db"))
            .map((name) => join(directory, name))
        : [],
    )
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
}

function requestedOrLatestBackup(requestedPath) {
  if (requestedPath) return resolve(requestedPath);
  const latest = availableBackups()[0];
  if (!latest) throw new Error("no local encrypted backups are available.");
  return latest;
}

async function backup() {
  ensureMacOS();
  await requireStoppedApp();
  if (!existsSync(DATABASE_PATH) || statSync(DATABASE_PATH).size === 0) {
    throw new Error("the active encrypted database does not exist or is empty.");
  }
  const key = readKeychainKey();
  const databaseModule = ensureDatabaseBuild();
  const { createVerifiedEncryptedBackup, openEncryptedDatabase } = await import(pathToFileURL(databaseModule).href);
  const database = openEncryptedDatabase(DATABASE_PATH, Buffer.from(key, "utf8"));
  try {
    const result = createVerifiedEncryptedBackup({
      database,
      databasePath: DATABASE_PATH,
      key: Buffer.from(key, "utf8"),
      backupDirectory: join(BACKUP_DIRECTORY, "manual"),
      reason: "manual",
    });
    print("Verified encrypted backup created.");
    print(result.backupPath);
    print(`Manifest: ${result.manifestPath}`);
  } finally {
    database.close();
  }
}

async function verifyBackup(requestedPath) {
  ensureMacOS();
  const backupPath = requestedOrLatestBackup(requestedPath);
  const key = readKeychainKey();
  const databaseModule = ensureDatabaseBuild();
  const { verifyEncryptedBackup } = await import(pathToFileURL(databaseModule).href);
  const result = verifyEncryptedBackup({ backupPath, key: Buffer.from(key, "utf8") });
  print("Encrypted backup verified successfully.");
  print(backupPath);
  print(`SHA-256: ${result.sha256}`);
  print(`Schema: ${result.schemaVersion ?? "pre-versioned"}`);
}

async function stageRestore(requestedPath) {
  ensureMacOS();
  await requireStoppedApp();
  const backupPath = requestedOrLatestBackup(requestedPath);
  const key = readKeychainKey();
  const databaseModule = ensureDatabaseBuild();
  const { stageVerifiedDatabaseRestore } = await import(pathToFileURL(databaseModule).href);
  const result = stageVerifiedDatabaseRestore({
    backupPath,
    key: Buffer.from(key, "utf8"),
    recoveryRoot: RECOVERY_DIRECTORY,
  });
  print("Verified restore staged without changing the active database.");
  print(result.recoveryDirectory);
  print("Review RESTORE_READY.json and the recovery runbook before any manual activation.");
}

function resolveStagedRestore(requestedDirectory) {
  if (!requestedDirectory) throw new Error("provide the staged restore directory to activate.");
  mkdirSync(RECOVERY_DIRECTORY, { recursive: true, mode: 0o700 });
  const root = realpathSync(RECOVERY_DIRECTORY);
  const requested = resolve(requestedDirectory);
  if (!existsSync(requested) || lstatSync(requested).isSymbolicLink() || !lstatSync(requested).isDirectory()) {
    throw new Error("the staged restore directory is missing or unsafe.");
  }
  const staged = realpathSync(requested);
  const child = relative(root, staged);
  if (!child || child.startsWith("..") || child.includes("/") || dirname(staged) !== root) {
    throw new Error("the staged restore must be a direct child of the configured recovery directory.");
  }
  const receiptPath = join(staged, "RESTORE_READY.json");
  if (!existsSync(receiptPath) || lstatSync(receiptPath).isSymbolicLink()) {
    throw new Error("the staged restore readiness receipt is missing or unsafe.");
  }
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (receipt?.formatVersion !== 1 || basename(receipt.databaseFilename ?? "") !== receipt.databaseFilename) {
    throw new Error("the staged restore readiness receipt is invalid.");
  }
  const databasePath = join(staged, receipt.databaseFilename);
  if (!existsSync(databasePath) || lstatSync(databasePath).isSymbolicLink() || !lstatSync(databasePath).isFile()) {
    throw new Error("the staged database is missing or unsafe.");
  }
  return { databasePath, receipt };
}

async function activateRestore(requestedDirectory) {
  ensureMacOS();
  await requireStoppedApp();
  if (!existsSync(DATABASE_PATH) || statSync(DATABASE_PATH).size === 0) {
    throw new Error("the active encrypted database does not exist or is empty.");
  }
  const { databasePath: stagedPath, receipt } = resolveStagedRestore(requestedDirectory);
  const key = Buffer.from(readKeychainKey(), "utf8");
  const databaseModule = ensureDatabaseBuild();
  const { createVerifiedEncryptedBackup, openEncryptedDatabase, verifyEncryptedDatabaseFile } = await import(
    pathToFileURL(databaseModule).href
  );
  const stagedVerification = verifyEncryptedDatabaseFile(stagedPath, key);
  if (stagedVerification.sha256 !== receipt.sha256 || stagedVerification.sizeBytes !== receipt.sizeBytes) {
    throw new Error("the staged database no longer matches its readiness receipt.");
  }

  const active = openEncryptedDatabase(DATABASE_PATH, key);
  let preRestoreBackup;
  try {
    preRestoreBackup = createVerifiedEncryptedBackup({
      database: active,
      databasePath: DATABASE_PATH,
      key,
      backupDirectory: join(BACKUP_DIRECTORY, "manual"),
      reason: "pre-restore",
    });
  } finally {
    active.close();
  }

  const id = randomUUID();
  const candidate = `${DATABASE_PATH}.restore-${id}.tmp`;
  const rollback = `${DATABASE_PATH}.rollback-${id}`;
  const sidecars = [];
  let activeMoved = false;
  let candidateActivated = false;
  try {
    copyFileSync(stagedPath, candidate, constants.COPYFILE_EXCL);
    chmodSync(candidate, 0o600);
    const candidateVerification = verifyEncryptedDatabaseFile(candidate, key);
    if (candidateVerification.sha256 !== receipt.sha256) throw new Error("the restore candidate changed.");
    for (const suffix of ["-wal", "-shm"]) {
      const original = `${DATABASE_PATH}${suffix}`;
      if (!existsSync(original)) continue;
      const saved = `${rollback}${suffix}`;
      renameSync(original, saved);
      sidecars.push({ original, saved });
    }
    renameSync(DATABASE_PATH, rollback);
    activeMoved = true;
    renameSync(candidate, DATABASE_PATH);
    candidateActivated = true;
    const verification = verifyEncryptedDatabaseFile(DATABASE_PATH, key);
    if (verification.sha256 !== receipt.sha256 || verification.sizeBytes !== receipt.sizeBytes) {
      throw new Error("the activated database failed verification.");
    }
    rmSync(rollback);
    activeMoved = false;
    for (const sidecar of sidecars) rmSync(sidecar.saved, { force: true });
    print("Staged restore activated and verified.");
    print(`Pre-restore backup: ${basename(preRestoreBackup.backupPath)}`);
  } catch (error) {
    if (activeMoved && existsSync(rollback)) {
      if (candidateActivated) rmSync(DATABASE_PATH, { force: true });
      renameSync(rollback, DATABASE_PATH);
      activeMoved = false;
    }
    for (const sidecar of sidecars) {
      if (existsSync(sidecar.saved)) {
        rmSync(sidecar.original, { force: true });
        renameSync(sidecar.saved, sidecar.original);
      }
    }
    verifyEncryptedDatabaseFile(DATABASE_PATH, key);
    throw error;
  } finally {
    rmSync(candidate, { force: true });
  }
}

async function setup() {
  ensureMacOS();
  mkdirSync(DATA_DIRECTORY, { recursive: true, mode: 0o700 });
  const explicitKey = process.env.FINANCE_HERO_DATABASE_KEY ?? readDotEnvKey();

  if (explicitKey) {
    await validateExistingDatabaseKey(explicitKey);
    storeKeychainKey(explicitKey);
    print("Finance Hero database key imported into macOS Keychain.");
    return;
  }

  if (keychainHasKey()) {
    await validateExistingDatabaseKey(readKeychainKey());
    print("Finance Hero Keychain setup is valid.");
    return;
  }

  const databaseExists = existsSync(DATABASE_PATH) && statSync(DATABASE_PATH).size > 0;
  const key = databaseExists
    ? await promptHidden("Enter the existing Finance Hero database key (input is hidden): ")
    : randomBytes(48).toString("base64");

  await validateExistingDatabaseKey(key);
  storeKeychainKey(key);
  print(
    databaseExists
      ? "Existing encrypted database linked to macOS Keychain."
      : "New Finance Hero database key created in macOS Keychain.",
  );
}

async function fetchState(url) {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    const body = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
    return { ok: response.ok, status: response.status, body };
  } catch {
    return null;
  }
}

function portIsOpen(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolvePort(true);
    });
    const unavailable = () => {
      socket.destroy();
      resolvePort(false);
    };
    socket.once("error", unavailable);
    socket.once("timeout", unavailable);
  });
}

async function webIsReady(secure = WEB_SECURE, url = WEB_URL) {
  // Node does not consistently use the macOS trust store for a local mkcert
  // certificate. A successful TLS listener is sufficient for launcher health;
  // the browser still performs the certificate validation.
  if (secure) return portIsOpen(4318);
  return (await fetchState(url))?.ok === true;
}

function readRuntime() {
  if (!existsSync(RUNTIME_PATH)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(RUNTIME_PATH, "utf8"));
  } catch {
    return null;
  }
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearStaleRuntime() {
  const runtime = readRuntime();
  if (runtime && !pidIsAlive(runtime.pid)) {
    if (runtime.ollamaPid && pidIsAlive(runtime.ollamaPid)) {
      killProcessGroup(runtime.ollamaPid);
    }
    rmSync(RUNTIME_PATH, { force: true });
    return null;
  }
  return runtime;
}

function writeRuntime(pid, ollamaPid = null) {
  mkdirSync(DATA_DIRECTORY, { recursive: true, mode: 0o700 });
  writeFileSync(
    RUNTIME_PATH,
    `${JSON.stringify(
      {
        pid,
        ollamaPid,
        startedAt: new Date().toISOString(),
        logPath: LOG_PATH,
        webUrl: WEB_URL,
        webSecure: WEB_SECURE,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  chmodSync(RUNTIME_PATH, 0o600);
}

function killProcessGroup(pid, signal = "SIGTERM") {
  try {
    process.kill(-pid, signal);
  } catch {
    if (pidIsAlive(pid)) {
      process.kill(pid, signal);
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForReady(timeoutMilliseconds = 40_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const [health, webReady] = await Promise.all([fetchState(API_URL), webIsReady()]);
    if (health?.body?.status === "ok" && health.body.database === "encrypted" && webReady) {
      return true;
    }
    await delay(500);
  }
  return false;
}

function recentLogs(lines = 30) {
  if (!existsSync(LOG_PATH)) {
    return "";
  }
  return readFileSync(LOG_PATH, "utf8").split(/\r?\n/).slice(-lines).join("\n");
}

async function start() {
  ensureMacOS();
  const runtime = clearStaleRuntime();
  const runningWebUrl = runtime?.webUrl ?? WEB_URL;
  const [health, webReady] = await Promise.all([
    fetchState(API_URL),
    webIsReady(runtime?.webSecure ?? WEB_SECURE, runningWebUrl),
  ]);
  const alreadyHealthy = health?.body?.status === "ok" && health.body.database === "encrypted" && webReady;
  if (alreadyHealthy) {
    print("Finance Hero is already running securely.");
    print(runningWebUrl);
    if (!keychainHasKey()) {
      print("Warning: run `pnpm setup:local` before the next Mac restart.");
    }
    return;
  }

  if (!keychainHasKey()) {
    throw new Error("run `pnpm setup:local` before starting Finance Hero.");
  }
  if (runtime) {
    throw new Error(`a managed Finance Hero process is still starting (PID ${runtime.pid}).`);
  }
  if ((await portIsOpen(4317)) || (await portIsOpen(4318))) {
    throw new Error("port 4317 or 4318 is occupied by another process. Stop the earlier local server first.");
  }

  mkdirSync(LOG_DIRECTORY, { recursive: true, mode: 0o700 });
  const logDescriptor = openSync(LOG_PATH, "a", 0o600);
  chmodSync(LOG_PATH, 0o600);
  // The secure launcher does not inherit variables from an interactive shell.
  // Load the uncommitted local configuration while preserving explicit overrides.
  const environment = { ...readDotEnvEnvironment(), ...process.env };
  delete environment.FINANCE_HERO_DATABASE_KEY;
  // Turbo runs each workspace task from its package directory. Keep every
  // process pinned to the single canonical encrypted database at the repo root.
  environment.FINANCE_HERO_DATA_DIR = DATA_DIRECTORY;
  let ollamaPid = null;
  if (!(await portIsOpen(11434))) {
    const ollamaExecutable = spawnSync("which", ["ollama"], { encoding: "utf8" }).stdout.trim();
    if (ollamaExecutable) {
      const ollama = spawn(ollamaExecutable, ["serve"], {
        cwd: ROOT,
        detached: true,
        env: {
          ...environment,
          OLLAMA_NO_CLOUD: "true",
          OLLAMA_FLASH_ATTENTION: "1",
          OLLAMA_KV_CACHE_TYPE: "q8_0",
        },
        stdio: ["ignore", logDescriptor, logDescriptor],
      });
      ollamaPid = ollama.pid ?? null;
      ollama.unref();
    }
  }
  const child = spawn(process.execPath, [join(ROOT, "node_modules/turbo/bin/turbo"), "dev"], {
    cwd: ROOT,
    detached: true,
    env: environment,
    stdio: ["ignore", logDescriptor, logDescriptor],
  });
  closeSync(logDescriptor);
  if (!child.pid) {
    throw new Error("the managed local process could not be created.");
  }
  writeRuntime(child.pid, ollamaPid);
  child.unref();

  if (!(await waitForReady())) {
    killProcessGroup(child.pid);
    if (ollamaPid) killProcessGroup(ollamaPid);
    rmSync(RUNTIME_PATH, { force: true });
    const logs = recentLogs();
    if (logs) {
      process.stderr.write(`${logs}\n`);
    }
    throw new Error(`startup did not become healthy. Review ${LOG_PATH}.`);
  }

  print("Finance Hero started securely.");
  print(WEB_URL);
}

async function stop() {
  const runtime = clearStaleRuntime();
  if (!runtime) {
    const [apiOpen, webOpen] = await Promise.all([portIsOpen(4317), portIsOpen(4318)]);
    if (apiOpen || webOpen) {
      throw new Error("Finance Hero is running outside the secure launcher. Stop its original Terminal process.");
    }
    print("Finance Hero is already stopped.");
    return;
  }

  killProcessGroup(runtime.pid);
  if (runtime.ollamaPid && pidIsAlive(runtime.ollamaPid)) {
    killProcessGroup(runtime.ollamaPid);
  }
  const deadline = Date.now() + 8_000;
  while (pidIsAlive(runtime.pid) && Date.now() < deadline) {
    await delay(200);
  }
  if (pidIsAlive(runtime.pid)) {
    killProcessGroup(runtime.pid, "SIGKILL");
  }
  rmSync(RUNTIME_PATH, { force: true });
  print("Finance Hero stopped.");
}

async function status() {
  const runtime = clearStaleRuntime();
  const [health, webReady] = await Promise.all([
    fetchState(API_URL),
    webIsReady(runtime?.webSecure ?? WEB_SECURE, runtime?.webUrl ?? WEB_URL),
  ]);
  print(`Keychain: ${keychainHasKey() ? "configured" : "missing"}`);
  print(
    `API: ${
      health?.body?.status === "ok" && health.body.database === "encrypted"
        ? "healthy / encrypted"
        : health
          ? `${health.body?.status ?? health.status} / ${health.body?.database ?? "unavailable"}`
          : "stopped"
    }`,
  );
  print(`PWA: ${webReady ? `running at ${runtime?.webUrl ?? WEB_URL}` : "stopped"}`);
  const ollama = await fetchState(OLLAMA_URL);
  print(`Assistant: ${ollama?.ok ? "local model service running" : "stopped"}`);
  print(`Launcher: ${runtime ? `managed (PID ${runtime.pid})` : "not managing a process"}`);
}

function logs() {
  const output = recentLogs(100);
  print(output || "No managed Finance Hero logs are available.");
}

function fileMode(path) {
  return existsSync(path) ? statSync(path).mode & 0o777 : null;
}

async function doctor() {
  ensureMacOS();
  const checks = [];
  const check = (label, ok, detail) => checks.push({ label, ok, detail });
  const dotEnv = readDotEnvEnvironment();
  const phoneAccess = readPhoneAccessConfig();
  const tlsCertificate = dotEnv.FINANCE_HERO_WEB_CERT ?? phoneAccess.certificatePath;
  const tlsKey = dotEnv.FINANCE_HERO_WEB_KEY ?? phoneAccess.keyPath;
  const phoneUrl = dotEnv.FINANCE_HERO_WEB_PUBLIC_URL ?? phoneAccess.url ?? WEB_URL;
  const databaseExists = existsSync(DATABASE_PATH) && statSync(DATABASE_PATH).size > 0;

  check("Node.js", Number(process.versions.node.split(".")[0]) >= 22, process.versions.node);
  check("macOS Keychain", keychainHasKey(), keychainHasKey() ? "configured" : "missing");
  check("Encrypted database", databaseExists, databaseExists ? "present" : "missing or empty");
  check(
    "Data directory permissions",
    !existsSync(DATA_DIRECTORY) || (fileMode(DATA_DIRECTORY) & 0o077) === 0,
    existsSync(DATA_DIRECTORY) ? fileMode(DATA_DIRECTORY).toString(8) : "created on first setup",
  );

  if (databaseExists && keychainHasKey()) {
    try {
      await validateExistingDatabaseKey(readKeychainKey());
      check("Database key verification", true, "database opens successfully");
    } catch (error) {
      check("Database key verification", false, error instanceof Error ? error.message : "verification failed");
    }
  } else {
    check("Database key verification", false, "requires both the database and Keychain item");
  }

  const backups = availableBackups();
  if (backups.length > 0 && keychainHasKey()) {
    try {
      const databaseModule = ensureDatabaseBuild();
      const { verifyEncryptedBackup } = await import(pathToFileURL(databaseModule).href);
      verifyEncryptedBackup({ backupPath: backups[0], key: Buffer.from(readKeychainKey(), "utf8") });
      check("Latest encrypted backup", true, `${backups.length} available; latest verifies`);
    } catch (error) {
      check("Latest encrypted backup", false, error instanceof Error ? error.message : "verification failed");
    }
  } else {
    check("Latest encrypted backup", false, "no verifiable backup is available");
  }

  check(
    "Phone TLS certificate",
    Boolean(tlsCertificate && existsSync(tlsCertificate)),
    tlsCertificate && existsSync(tlsCertificate) ? "present" : "not configured",
  );
  check(
    "Phone TLS private key",
    Boolean(tlsKey && existsSync(tlsKey) && (fileMode(tlsKey) & 0o077) === 0),
    tlsKey && existsSync(tlsKey) ? `present; mode ${fileMode(tlsKey).toString(8)}` : "not configured",
  );

  const runtime = clearStaleRuntime();
  const [apiOpen, webOpen, health, webReady] = await Promise.all([
    portIsOpen(4317),
    portIsOpen(4318),
    fetchState(API_URL),
    webIsReady(Boolean(tlsCertificate && tlsKey), phoneUrl),
  ]);
  const runtimeDetail = runtime ? `managed PID ${runtime.pid}` : "launcher stopped";
  check(
    "API port 4317",
    !apiOpen || health?.body?.database === "encrypted",
    apiOpen ? "healthy encrypted API" : runtimeDetail,
  );
  check(
    "Web port 4318",
    !webOpen || webReady,
    webOpen ? (webReady ? "healthy web app" : "listener failed readiness check") : "available",
  );

  for (const result of checks) {
    print(`${result.ok ? "PASS" : "FAIL"}  ${result.label}: ${result.detail}`);
  }
  const failures = checks.filter((result) => !result.ok).length;
  print(`\nDoctor result: ${checks.length - failures}/${checks.length} checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

async function main() {
  const command = process.argv[2] ?? "help";
  if (command === "setup") {
    await setup();
  } else if (command === "start") {
    await start();
  } else if (command === "stop") {
    await stop();
  } else if (command === "status") {
    await status();
  } else if (command === "logs") {
    logs();
  } else if (command === "backup") {
    await backup();
  } else if (command === "verify-backup") {
    await verifyBackup(process.argv[3]);
  } else if (command === "stage-restore") {
    await stageRestore(process.argv[3]);
  } else if (command === "activate-restore") {
    await activateRestore(process.argv[3]);
  } else if (command === "doctor") {
    await doctor();
  } else {
    print(
      "Usage: node scripts/local-control.mjs <setup|start|stop|status|logs|backup|verify-backup|stage-restore|activate-restore|doctor> [backup-or-staged-restore-path]",
    );
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
