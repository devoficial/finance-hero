import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DatabaseKeyProvider {
  getKey(): Promise<Buffer>;
}

export class EnvironmentDatabaseKeyProvider implements DatabaseKeyProvider {
  constructor(private readonly variableName = "FINANCE_HERO_DATABASE_KEY") {}

  async getKey(): Promise<Buffer> {
    const value = process.env[this.variableName];

    if (!value || value.length < 32) {
      throw new Error(`${this.variableName} must contain at least 32 characters.`);
    }

    return Buffer.from(value, "utf8");
  }
}

export class MacOSKeychainDatabaseKeyProvider implements DatabaseKeyProvider {
  constructor(
    private readonly service = "finance-hero.database",
    private readonly account = "primary",
  ) {}

  async getKey(): Promise<Buffer> {
    if (process.platform !== "darwin") {
      throw new Error("macOS Keychain provider is only available on macOS.");
    }

    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      this.service,
      "-a",
      this.account,
      "-w",
    ]);
    const value = stdout.trim();

    if (value.length < 32) {
      throw new Error("Keychain database key is missing or too short.");
    }

    return Buffer.from(value, "utf8");
  }
}
