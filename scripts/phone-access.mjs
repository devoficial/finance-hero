import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const TLS_DIRECTORY = join(ROOT, "data", "local-tls");
const CONFIG_PATH = join(TLS_DIRECTORY, "phone-access.json");
const CERTIFICATE_PATH = join(TLS_DIRECTORY, "finance-hero.pem");
const KEY_PATH = join(TLS_DIRECTORY, "finance-hero-key.pem");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error?.code === "ENOENT") {
    throw new Error(`${command} is not installed. Install it with: brew install ${command}`);
  }
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `${command} failed.`);
  return result.stdout?.trim() ?? "";
}

function lanAddress() {
  for (const device of ["en0", "en1"]) {
    const result = spawnSync("ipconfig", ["getifaddr", device], { encoding: "utf8" });
    const address = result.stdout?.trim();
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return address;
  }
  throw new Error("No Wi-Fi LAN address was found. Connect this Mac to Wi-Fi and retry.");
}

function setup() {
  const address = lanAddress();
  mkdirSync(TLS_DIRECTORY, { recursive: true, mode: 0o700 });
  run("mkcert", ["-install"], { stdio: "inherit" });
  run("mkcert", ["-cert-file", CERTIFICATE_PATH, "-key-file", KEY_PATH, "localhost", "127.0.0.1", "::1", address], {
    stdio: "inherit",
  });
  chmodSync(CERTIFICATE_PATH, 0o600);
  chmodSync(KEY_PATH, 0o600);
  const config = {
    host: "0.0.0.0",
    lanAddress: address,
    url: `https://${address}:4318`,
    certificatePath: CERTIFICATE_PATH,
    keyPath: KEY_PATH,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
  const root = run("mkcert", ["-CAROOT"]);
  console.log(`Phone access configured at ${config.url}`);
  console.log(`Install ${join(root, "rootCA.pem")} on the iPhone and enable full trust for it.`);
  console.log("Then run: pnpm stop:local && pnpm start:phone");
}

function readConfig() {
  if (!existsSync(CONFIG_PATH)) throw new Error("Phone access is not configured. Run `pnpm setup:phone` first.");
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

function start() {
  const config = readConfig();
  console.log(`Starting Finance Hero for trusted-LAN access at ${config.url}`);
  const result = spawnSync("pnpm", ["start:local"], {
    cwd: ROOT,
    env: {
      ...process.env,
      FINANCE_HERO_WEB_HOST: config.host,
      FINANCE_HERO_WEB_CERT: config.certificatePath,
      FINANCE_HERO_WEB_KEY: config.keyPath,
      FINANCE_HERO_WEB_PUBLIC_URL: config.url,
    },
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
}

function status() {
  const config = readConfig();
  console.log(`Phone URL: ${config.url}`);
  console.log(`Certificate: ${config.certificatePath}`);
  console.log("The API remains bound to localhost and is reached only through the HTTPS web proxy.");
}

try {
  const command = process.argv[2];
  if (command === "setup") setup();
  else if (command === "start") start();
  else if (command === "status") status();
  else throw new Error("Usage: node scripts/phone-access.mjs <setup|start|status>");
} catch (error) {
  console.error(`Finance Hero phone access: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
