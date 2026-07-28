import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIRECTORY = resolve(process.env.FINANCE_HERO_DATA_DIR ?? join(ROOT, "data"));
const DATABASE_PATH = join(DATA_DIRECTORY, "finance-hero.db");
const RUNTIME_PATH = join(DATA_DIRECTORY, ".runtime.json");
const LOG_DIRECTORY = join(DATA_DIRECTORY, "logs");
const LOG_PATH = join(LOG_DIRECTORY, "finance-hero.log");
const KEYCHAIN_SERVICE = "finance-hero.database";
const KEYCHAIN_ACCOUNT = "primary";
const API_URL = "http://127.0.0.1:4317/api/v1/health";
const WEB_URL = "http://127.0.0.1:4318/";

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

function ensureDatabaseBuild() {
  const databaseModule = join(ROOT, "packages/database/dist/index.js");
  const result = spawnSync("pnpm", ["--filter", "@finance-hero/database", "build"], {
    cwd: ROOT,
    stdio: "inherit",
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
    throw new Error("the supplied key cannot open the existing encrypted database.");
  } finally {
    database?.close();
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
    rmSync(RUNTIME_PATH, { force: true });
    return null;
  }
  return runtime;
}

function writeRuntime(pid) {
  mkdirSync(DATA_DIRECTORY, { recursive: true, mode: 0o700 });
  writeFileSync(
    RUNTIME_PATH,
    `${JSON.stringify({ pid, startedAt: new Date().toISOString(), logPath: LOG_PATH }, null, 2)}\n`,
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
    const [health, web] = await Promise.all([fetchState(API_URL), fetchState(WEB_URL)]);
    if (health?.body?.status === "ok" && health.body.database === "encrypted" && web?.ok) {
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
  const [health, web] = await Promise.all([fetchState(API_URL), fetchState(WEB_URL)]);
  const alreadyHealthy = health?.body?.status === "ok" && health.body.database === "encrypted" && web?.ok;
  if (alreadyHealthy) {
    print("Finance Hero is already running securely.");
    print(WEB_URL);
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
  const environment = { ...process.env };
  delete environment.FINANCE_HERO_DATABASE_KEY;
  // Turbo runs each workspace task from its package directory. Keep every
  // process pinned to the single canonical encrypted database at the repo root.
  environment.FINANCE_HERO_DATA_DIR = DATA_DIRECTORY;
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
  writeRuntime(child.pid);
  child.unref();

  if (!(await waitForReady())) {
    killProcessGroup(child.pid);
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
  const [health, web] = await Promise.all([fetchState(API_URL), fetchState(WEB_URL)]);
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
  print(`PWA: ${web?.ok ? "running" : "stopped"}`);
  print(`Launcher: ${runtime ? `managed (PID ${runtime.pid})` : "not managing a process"}`);
}

function logs() {
  const output = recentLogs(100);
  print(output || "No managed Finance Hero logs are available.");
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
  } else {
    print("Usage: node scripts/local-control.mjs <setup|start|stop|status|logs>");
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
