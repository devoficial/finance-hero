import type { DatabaseKeyProvider } from "@finance-hero/database";
import { describe, expect, it } from "vitest";
import { readConfig, readRuntimeConfig } from "./config";

const keychainKey = "keychain-test-key-with-at-least-32-characters";

class TestKeyProvider implements DatabaseKeyProvider {
  constructor(private readonly value: string | Error) {}

  async getKey(): Promise<Buffer> {
    if (this.value instanceof Error) {
      throw this.value;
    }
    return Buffer.from(this.value, "utf8");
  }
}

describe("server configuration", () => {
  it("parses the local defaults", () => {
    const config = readConfig({});

    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 4317,
      databaseKey: undefined,
    });
  });

  it("uses the environment key when one is explicitly provided", async () => {
    const environmentKey = "environment-test-key-with-at-least-32-characters";
    const config = await readRuntimeConfig(
      { FINANCE_HERO_DATABASE_KEY: environmentKey },
      new TestKeyProvider(new Error("Keychain should not be read.")),
    );

    expect(config.databaseKey).toBe(environmentKey);
  });

  it("falls back to the macOS Keychain provider", async () => {
    const config = await readRuntimeConfig({}, new TestKeyProvider(keychainKey));

    expect(config.databaseKey).toBe(keychainKey);
  });

  it("keeps the API in setup mode when no key is available", async () => {
    const config = await readRuntimeConfig({}, new TestKeyProvider(new Error("Missing key")));

    expect(config.databaseKey).toBeUndefined();
  });
});
