import { resolve } from "node:path";
import { type DatabaseKeyProvider, MacOSKeychainDatabaseKeyProvider } from "@finance-hero/database";

export interface ServerConfig {
  host: string;
  port: number;
  dataDirectory: string;
  databaseKey?: string;
}

export function readConfig(environment = process.env): ServerConfig {
  const parsedPort = Number(environment.FINANCE_HERO_PORT ?? "4317");

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error("FINANCE_HERO_PORT must be a valid TCP port.");
  }

  return {
    host: environment.FINANCE_HERO_HOST ?? "127.0.0.1",
    port: parsedPort,
    dataDirectory: resolve(environment.FINANCE_HERO_DATA_DIR ?? "./data"),
    databaseKey: environment.FINANCE_HERO_DATABASE_KEY,
  };
}

export async function readRuntimeConfig(
  environment = process.env,
  keyProvider: DatabaseKeyProvider = new MacOSKeychainDatabaseKeyProvider(),
): Promise<ServerConfig> {
  const config = readConfig(environment);
  if (config.databaseKey) {
    return config;
  }

  try {
    const key = await keyProvider.getKey();
    return { ...config, databaseKey: key.toString("utf8") };
  } catch {
    return config;
  }
}
